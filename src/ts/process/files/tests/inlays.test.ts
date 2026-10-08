import fc from 'fast-check'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { readAppInlay } from '../inlayStore'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'
import type { InlayAsset } from '../inlays'
import {
    getInlayAsset,
    getInlayAssetBlob,
    listInlayAssets,
    postInlayAsset,
    removeInlayAsset,
    setInlayAsset,
    writeInlayImage,
} from '../inlays'

//#region module mocks

// happy-dom canvas getContext returns null
const fakeCtx = {
    drawImage: vi.fn(),
}
const origCreateElement = document.createElement.bind(document)
vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
    const el = origCreateElement(tag, options)
    if (tag === 'canvas') {
        ;(el as HTMLCanvasElement).getContext = (() => fakeCtx) as any
        ;(el as HTMLCanvasElement).toBlob = ((cb: BlobCallback) => {
            cb(new Blob(['fake-png'], { type: 'image/png' }))
        }) as any
    }
    return el
})

// The old LocalForage inlay database.
const store = new Map<string, unknown>()
let appStore: MemoryByteStore

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => store.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                store.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                store.delete(key)
            }),
            keys: vi.fn(async () => [...store.keys()]),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = { forageStorage: {} }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('uuid', () => ({
    v4: vi.fn(() => 'test-uuid-1234'),
}))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(),
}))

vi.mock(
    import('src/ts/util'),
    () =>
        ({
            asBuffer: (arr: Uint8Array) => arr,
        }) as typeof import('src/ts/util'),
)

//#endregion

const supportedAudioExts = ['wav', 'mp3', 'ogg', 'flac'] as const
const supportedVideoExts = ['webm', 'mp4', 'mkv'] as const
const supportedImageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'] as const
const allSupportedExts = [...supportedAudioExts, ...supportedVideoExts, ...supportedImageExts]

function makeImage(w: number, h: number): HTMLImageElement {
    const img = new Image()
    Object.defineProperty(img, 'width', { get: () => w })
    Object.defineProperty(img, 'height', { get: () => h })
    Object.defineProperty(img, 'onload', {
        set(fn: () => void) {
            fn?.()
        },
        get() {
            return null
        },
    })
    return img
}

/** Empties both stores and gives the page a new app store. */
function resetStores() {
    store.clear()
    appStore = createMemoryByteStore()
    injectAppStore(appStore)
}

/** What the app store holds for id, with its Blob data. */
async function stored(id: string): Promise<InlayAsset> {
    const found = await readAppInlay(id)
    expect(found).not.toBeNull()
    return found!
}

beforeEach(() => {
    vi.clearAllMocks()
    resetStores()
})

describe('setInlayAsset', () => {
    test('stores an asset in the app store and not in the old store', async () => {
        const asset: InlayAsset = {
            data: new Blob(['hello'], { type: 'text/plain' }),
            ext: 'png',
            height: 100,
            width: 100,
            name: 'test.png',
            type: 'image',
        }

        await setInlayAsset('asset-1', asset)

        expect(await stored('asset-1')).toMatchObject({ name: 'test.png', ext: 'png', width: 100, height: 100, type: 'image' })
        expect((await getInlayAsset('asset-1'))!.data).toMatch(/^data:/)
        expect(store.size).toBe(0)
    })

    test('overwrites an existing asset with the same id', async () => {
        const first: InlayAsset = {
            data: new Blob(['a']),
            ext: 'png',
            height: 10,
            name: 'first.png',
            type: 'image',
            width: 10,
        }
        const second: InlayAsset = {
            data: new Blob(['b']),
            ext: 'png',
            height: 20,
            name: 'second.png',
            type: 'image',
            width: 20,
        }

        await setInlayAsset('id-1', first)
        await setInlayAsset('id-1', second)

        expect(await stored('id-1')).toMatchObject({
            height: 20,
            name: 'second.png',
            type: 'image',
            width: 20,
        })
    })
})

describe('getInlayAsset', () => {
    test('returns null for a non-existent id', async () => {
        const result = await getInlayAsset('does-not-exist')
        expect(result).toBeNull()
    })

    test('returns asset with base64 data URI when stored as Blob', async () => {
        const blob = new Blob(['test-data'], { type: 'text/plain' })
        const asset: InlayAsset = {
            data: blob,
            ext: 'png',
            height: 50,
            width: 50,
            name: 'blob-asset.png',
            type: 'image',
        }
        store.set('blob-id', asset)

        const result = await getInlayAsset('blob-id')

        expect(result!.data).toMatch(/^data:/)
        expect(result!.name).toBe('blob-asset.png')
    })

    test('returns asset with string data as-is when stored as string', async () => {
        const b64 = 'data:image/png;base64,aGVsbG8='
        const asset: InlayAsset = {
            data: b64,
            ext: 'png',
            height: 50,
            width: 50,
            name: 'string-asset.png',
            type: 'image',
        }
        store.set('str-id', asset)

        const result = await getInlayAsset('str-id')
        expect(result!.data).toBe(b64)
    })
})

describe('getInlayAssetBlob', () => {
    test('returns null for a non-existent id', async () => {
        const result = await getInlayAssetBlob('does-not-exist')
        expect(result).toBeNull()
    })

    test('returns Blob data when stored as Blob', async () => {
        const blob = new Blob(['binary-data'], { type: 'image/png' })
        const asset: InlayAsset = {
            data: blob,
            ext: 'png',
            height: 64,
            width: 64,
            name: 'blob.png',
            type: 'image',
        }
        store.set('blob-id', asset)

        const result = await getInlayAssetBlob('blob-id')
        expect(result!.data).toBeInstanceOf(Blob)
    })

    test('returns Blob data decoded from a legacy string and leaves the stored value unchanged', async () => {
        const b64 = 'data:image/png;base64,aGVsbG8='
        const asset: InlayAsset = {
            data: b64,
            ext: 'png',
            height: 32,
            width: 32,
            name: 'legacy.png',
            type: 'image',
        }
        store.set('legacy-id', asset)

        const result = await getInlayAssetBlob('legacy-id')
        expect(result!.data).toBeInstanceOf(Blob)

        expect((store.get('legacy-id') as InlayAsset).data).toBe(b64)
        expect(appStore.files.size).toBe(0)
    })
})

describe('listInlayAssets', () => {
    test('returns empty array when no assets exist', async () => {
        const result = await listInlayAssets()
        expect(result).toEqual([])
    })

    test('returns every old-store asset as an [id, summary] tuple without its data', async () => {
        const asset1: InlayAsset = {
            data: new Blob(['a']),
            ext: 'png',
            height: 10,
            width: 10,
            name: 'a.png',
            type: 'image',
        }
        const asset2: InlayAsset = {
            data: new Blob(['b']),
            ext: 'mp3',
            height: 0,
            width: 0,
            name: 'b.mp3',
            type: 'audio',
        }
        store.set('id-a', asset1)
        store.set('id-b', asset2)

        const result = await listInlayAssets()
        expect(result).toMatchObject([
            ['id-a', { name: 'a.png', size: 1 }],
            ['id-b', { name: 'b.mp3', size: 1 }],
        ])
        expect(result.every(([, summary]) => !('data' in summary))).toBe(true)
    })
})

describe('removeInlayAsset', () => {
    test('does not throw when removing a non-existent id', async () => {
        await expect(removeInlayAsset('nope')).resolves.not.toThrow()
    })
})

describe('postInlayAsset', () => {
    test('stores audio asset and returns id', async () => {
        const data = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
        const result = await postInlayAsset({
            name: 'clip.mp3',
            data,
        })
        expect(result).toBe('test-uuid-1234')

        const found = await stored('test-uuid-1234')
        expect(found).toMatchObject({
            data: expect.any(Blob),
            ext: 'mp3',
            name: 'clip.mp3',
            type: 'audio',
        })
    })

    test('stores video asset and returns id', async () => {
        const data = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
        const result = await postInlayAsset({
            name: 'video.webm',
            data,
        })
        expect(result).toBe('test-uuid-1234')

        const found = await stored('test-uuid-1234')
        expect(found).toMatchObject({
            data: expect.any(Blob),
            ext: 'webm',
            name: 'video.webm',
            type: 'video',
        })
    })

    test('returns null for any unsupported extension', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 10 }).filter((ext) => !allSupportedExts.includes(ext as any)),
                async (ext) => {
                    resetStores()
                    const result = await postInlayAsset({
                        name: `file.${ext}`,
                        data: new Uint8Array([0x00]),
                    })
                    expect(result).toBeNull()
                },
            ),
        )
    })

    test('routes audio extensions to audio type', async () => {
        await fc.assert(
            fc.asyncProperty(fc.constantFrom(...supportedAudioExts), async (ext) => {
                resetStores()
                const result = await postInlayAsset({
                    name: `sound.${ext}`,
                    data: new Uint8Array([0x00]),
                })
                expect(result).not.toBeNull()
                const found = await stored(result as string)
                expect(found.type).toBe('audio')
                expect(found.ext).toBe(ext)
            }),
        )
    })

    test('routes video extensions to video type', async () => {
        await fc.assert(
            fc.asyncProperty(fc.constantFrom(...supportedVideoExts), async (ext) => {
                resetStores()
                const result = await postInlayAsset({
                    name: `clip.${ext}`,
                    data: new Uint8Array([0x00]),
                })
                expect(result).not.toBeNull()
                const found = await stored(result as string)
                expect(found.type).toBe('video')
                expect(found.ext).toBe(ext)
            }),
        )
    })
})

describe('writeInlayImage', () => {
    test('stores image asset with correct metadata and returns id', async () => {
        const imgObj = makeImage(200, 100)

        const result = await writeInlayImage(imgObj, {
            name: 'photo.jpg',
            ext: 'jpg',
            id: 'custom-id',
        })

        expect(result).toBe('custom-id')

        const found = await stored('custom-id')
        expect(found).toMatchObject({
            data: expect.any(Blob),
            ext: 'png',
            height: 100,
            name: 'photo.jpg',
            type: 'image',
            width: 200,
        })
    })

    test('generates uuid when no id is provided', async () => {
        const imgObj = makeImage(50, 50)

        const result = await writeInlayImage(imgObj)
        expect(result).toBe('test-uuid-1234')

        expect((await stored('test-uuid-1234')).name).toBe('test-uuid-1234')
    })

    test('output pixels never exceed 1024 * 1024', async () => {
        await fc.assert(
            fc.asyncProperty(fc.integer({ min: 1, max: 10000 }), fc.integer({ min: 1, max: 10000 }), async (w, h) => {
                resetStores()
                const img = makeImage(w, h)
                await writeInlayImage(img, { id: 'prop-img' })
                const found = await stored('prop-img')

                expect(found.width! * found.height!).toBeLessThanOrEqual(1024 * 1024)
                expect(found.width).toBeGreaterThan(0)
                expect(found.height).toBeGreaterThan(0)
            }),
        )
    })

    test('preserves aspect ratio when downscaling', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1025, max: 10000 }),
                fc.integer({ min: 1025, max: 10000 }),
                async (w, h) => {
                    resetStores()
                    const img = makeImage(w, h)
                    await writeInlayImage(img, { id: 'ratio-img' })
                    const found = await stored('ratio-img')

                    const originalRatio = w / h
                    const storedRatio = found.width! / found.height!
                    expect(Math.abs(originalRatio - storedRatio) / originalRatio).toBeLessThan(0.01)
                },
            ),
        )
    })

    test('does not resize images within pixel budget', async () => {
        await fc.assert(
            fc.asyncProperty(fc.integer({ min: 1, max: 1024 }), fc.integer({ min: 1, max: 1024 }), async (w, h) => {
                resetStores()
                const img = makeImage(w, h)
                await writeInlayImage(img, { id: 'small-img' })

                const found = await stored('small-img')
                expect(found).toMatchObject({
                    height: h,
                    width: w,
                })
            }),
        )
    })
})

describe('set -> get round-trip', () => {
    test('preserves metadata through setInlayAsset -> getInlayAsset', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 20 }),
                fc.string({ minLength: 1, maxLength: 30 }),
                fc.string({ minLength: 1, maxLength: 5 }),
                fc.nat({ max: 5000 }),
                fc.nat({ max: 5000 }),
                async (id, name, ext, width, height) => {
                    resetStores()
                    const blob = new Blob(['data'], { type: 'application/octet-stream' })
                    const asset: InlayAsset = {
                        data: blob,
                        ext,
                        height,
                        width,
                        name,
                        type: 'image',
                    }

                    await setInlayAsset(id, asset)

                    const result = await getInlayAsset(id)
                    expect(result).toMatchObject({
                        data: expect.any(String),
                        ext,
                        height,
                        width,
                        name,
                        type: 'image',
                    })
                },
            ),
        )
    })
})

describe('set -> remove -> get', () => {
    test('asset is always null after removal', async () => {
        await fc.assert(
            fc.asyncProperty(fc.string({ minLength: 1, maxLength: 20 }), async (id) => {
                resetStores()
                const asset: InlayAsset = {
                    data: new Blob(['x']),
                    ext: 'png',
                    height: 1,
                    width: 1,
                    name: 'tmp.png',
                    type: 'image',
                }

                await setInlayAsset(id, asset)
                expect(await getInlayAsset(id)).not.toBeNull()

                await removeInlayAsset(id)
                expect(await getInlayAsset(id)).toBeNull()
            }),
        )
    })
})

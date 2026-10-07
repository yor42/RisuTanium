/**
 * How a stored inlay reaches the page: a Blob handed to the store as it is, the
 * delivery branch the render takes on each kind of store, and a render cache that
 * never shows a body that a write or delete has replaced. The old `inlay`
 * LocalForage database is an in-memory map. Synthetic data only.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { resetBusyActionsForTest } from '../../memory/busyActions'
import { inlayMetaKey } from '../inlayKeys'
import { readAppInlay } from '../inlayStore'
import { runInlayCopy, type InlayCopyEnvironment } from '../inlayCopy'
import { createMemoryByteStore, type MemoryByteStore, type MemoryByteStoreOptions } from './memoryByteStore'
import {
    getInlayAsset,
    getInlayRender,
    removeInlayAsset,
    setInlayAsset,
    type InlayAsset,
} from '../inlays'

//#region module mocks

const h = vi.hoisted(() => ({
    legacy: new Map<string, unknown>(),
    android: false,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => h.legacy.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { h.legacy.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { h.legacy.delete(key) }),
            keys: vi.fn(async () => [...h.legacy.keys()]),
        }),
    },
}))

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, isAndroidTransport: () => h.android }
})

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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid') }))
vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn() }))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }))
vi.mock(import('src/ts/storage/database.svelte'), () => ({ getDatabase: vi.fn() }))
vi.mock(import('src/ts/util'), () => ({ asBuffer: (arr: Uint8Array) => arr }) as typeof import('src/ts/util'))

//#endregion

let appStore: MemoryByteStore
let objectUrls: Map<string, Blob>
let revoked: string[]
let createdCount: number
let counter = 0
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL

/** An id no earlier test used, so the page-wide render cache starts empty for it. */
const freshId = () => `seam-${++counter}`

function useStore(options: MemoryByteStoreOptions): MemoryByteStore {
    appStore = createMemoryByteStore(options)
    injectAppStore(appStore)
    return appStore
}

beforeEach(() => {
    h.legacy.clear()
    h.android = false
    objectUrls = new Map()
    revoked = []
    createdCount = 0
    URL.createObjectURL = vi.fn((blob: Blob) => {
        const url = `blob:test/${++createdCount}`
        objectUrls.set(url, blob)
        return url
    })
    URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url) })
    resetBusyActionsForTest()
    useStore({})
})

afterEach(() => {
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
})

function asset(data: string | Blob, extra: Record<string, unknown> = {}): InlayAsset {
    return { name: 'n.bin', ext: 'bin', type: 'video', data, ...extra } as InlayAsset
}

const bytesOf = (...values: number[]) => Uint8Array.from(values)

async function textOf(blob: Blob): Promise<string> {
    return new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))
}

function bodyKeyOf(store: MemoryByteStore): string {
    const keys = [...store.files.keys(), ...store.blobs.keys()].filter((key) => key.startsWith('inlays/b-'))
    expect(keys.length).toBe(1)
    return keys[0]
}

describe('a Blob is handed to a store that keeps Blobs as it is', () => {
    test('the body is stored as the very Blob and the input is never read into memory', async () => {
        const store = useStore({ blobs: true })
        const blob = new Blob([bytesOf(1, 2, 3, 4)], { type: 'video/mp4' })
        const arrayBuffer = vi.spyOn(blob, 'arrayBuffer')

        await setInlayAsset('v', asset(blob))

        expect(store.blobWrites.length).toBe(1)
        expect(store.blobs.get(bodyKeyOf(store))).toBe(blob)
        expect(arrayBuffer).not.toHaveBeenCalled()
        expect((await readAppInlay('v'))!.data).toBeInstanceOf(Blob)
    })

    test('a store without Blob members gets the bytes, as before', async () => {
        const store = useStore({})
        await setInlayAsset('v', asset(new Blob([bytesOf(1, 2, 3, 4)], { type: 'video/mp4' })))

        expect(Array.from(store.files.get(bodyKeyOf(store))!)).toEqual([1, 2, 3, 4])
        expect(store.blobWrites).toEqual([])
    })

    test('a string value is stored as bytes on a store that keeps Blobs', async () => {
        const store = useStore({ blobs: true })
        await setInlayAsset('s', asset('data:audio/mpeg;base64,AAAA', { type: 'audio' }))

        expect(store.blobWrites).toEqual([])
        expect(store.files.has(bodyKeyOf(store))).toBe(true)
    })

    test('the record length is the size of the Blob, and bytes read back through the byte consumers equal the original', async () => {
        useStore({ blobs: true })
        const payload = bytesOf(0, 1, 2, 250, 251, 252)
        await setInlayAsset('v', asset(new Blob([payload], { type: 'video/mp4' })))

        const bytes = await getInlayAsset('v')
        const reader = new FileReader()
        const expected = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(new Blob([payload], { type: 'video/mp4' }))
        })
        expect(bytes!.data).toBe(expected)
    })

    test('a failed metadata write leaves no body behind on a store that keeps Blobs', async () => {
        const store = useStore({ blobs: true })
        store.failWrite = (key) => (key.startsWith('inlays/m-') ? new Error('meta failed') : null)

        await expect(setInlayAsset('v', asset(new Blob(['x'])))).rejects.toThrow('meta failed')

        expect(store.blobs.size).toBe(0)
    })
})

describe('the copy of the old store on a store that keeps Blobs', () => {
    const MIB = 1024 * 1024
    let flags: Map<string, string>
    let env: InlayCopyEnvironment

    beforeEach(() => {
        flags = new Map()
        env = {
            flags: { getItem: (key) => flags.get(key) ?? null, setItem: (key, value) => { flags.set(key, value) } },
            estimate: async () => undefined,
            withTabLock: async (work) => { await work(); return true },
        }
    })

    test('hands the old Blob over without reading it into memory', async () => {
        const store = useStore({ blobs: true })
        const old = new Blob([bytesOf(9, 8, 7)], { type: 'video/mp4' })
        const arrayBuffer = vi.spyOn(old, 'arrayBuffer')
        h.legacy.set('old', asset(old))

        await expect(runInlayCopy(env)).resolves.toBe('done')

        expect(store.blobs.get(bodyKeyOf(store))).toBe(old)
        expect(arrayBuffer).not.toHaveBeenCalled()
        expect(h.legacy.get('old')).toEqual(asset(old))
    })

    test('a store without Blob members is copied as bytes', async () => {
        const store = useStore({})
        const old = new Blob([bytesOf(9, 8, 7)], { type: 'video/mp4' })
        h.legacy.set('old', asset(old))

        await expect(runInlayCopy(env)).resolves.toBe('done')

        expect(Array.from(store.files.get(bodyKeyOf(store))!)).toEqual([9, 8, 7])
    })

    test('the size limit is decided before the body is read or stored', async () => {
        const store = useStore({ blobs: true })
        class BigBlob extends Blob {
            override get size() { return 201 * MIB }
        }
        const big = new BigBlob(['b'], { type: 'video/mp4' })
        const slice = vi.spyOn(big, 'slice')
        const arrayBuffer = vi.spyOn(big, 'arrayBuffer')
        h.legacy.set('big', asset(big))

        await expect(runInlayCopy(env)).resolves.toBe('done')

        expect(JSON.parse(flags.get('inlayCopyDone')!).residual).toEqual(['big'])
        expect(slice).not.toHaveBeenCalled()
        expect(arrayBuffer).not.toHaveBeenCalled()
        expect(store.writes).toEqual([])
    })

    test('a Blob the browser cannot read is residue and is not stored', async () => {
        const store = useStore({ blobs: true })
        class UnreadableBlob extends Blob {
            override slice(): Blob {
                const piece = new Blob(['x'])
                piece.arrayBuffer = () => Promise.reject(new DOMException('The blob cannot be read', 'NotReadableError'))
                return piece
            }
        }
        h.legacy.set('bad', asset(new UnreadableBlob(['x'], { type: 'video/mp4' })))
        h.legacy.set('good', asset(new Blob(['g'], { type: 'video/mp4' })))

        await expect(runInlayCopy(env)).resolves.toBe('done')

        expect(JSON.parse(flags.get('inlayCopyDone')!).residual).toEqual(['bad'])
        expect(await readAppInlay('bad')).toBeNull()
        expect(await readAppInlay('good')).not.toBeNull()
        expect(store.blobWrites.length).toBe(1)
    })

    test('a copy keeps the object URL of a render made from the old entry valid', async () => {
        useStore({ blobs: true })
        const id = freshId()
        h.legacy.set(id, asset(new Blob(['o'], { type: 'video/mp4' })))
        const before = (await getInlayRender(id))!

        await runInlayCopy(env)

        expect(revoked).toEqual([])
        const after = (await getInlayRender(id))!
        expect(before.source).toBe('memory-blob')
        expect(after.source).toBe('stored-blob')
    })
})

describe('the source a render is delivered from', () => {
    test('a store that serves URLs gives its URL for the body and makes no object URL', async () => {
        const store = useStore({ urlFor: true, blobs: true })
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['v'], { type: 'video/mp4' })))

        const render = (await getInlayRender(id))!

        expect(render).toEqual({ type: 'video', url: `mem://${bodyKeyOf(store)}`, source: 'store-url' })
        expect(createdCount).toBe(0)
        expect(store.reads.filter((key) => key.startsWith('inlays/b-'))).toEqual([])
    })

    test('a store that cannot give a URL for the key falls back to the stored Blob, then to bytes', async () => {
        const failing = async () => { throw new Error('no token') }
        const blobStore = useStore({ urlFor: failing, blobs: true })
        const first = freshId()
        await setInlayAsset(first, asset(new Blob(['abc'], { type: 'video/mp4' })))
        expect((await getInlayRender(first))!.source).toBe('stored-blob')
        expect(objectUrls.get('blob:test/1')).toBe(blobStore.blobs.get(bodyKeyOf(blobStore)))

        useStore({ urlFor: failing })
        const second = freshId()
        await setInlayAsset(second, asset(new Blob(['abc'], { type: 'video/mp4' })))
        const render = (await getInlayRender(second))!
        expect(render.source).toBe('memory-blob')
        expect(await textOf(objectUrls.get(render.url)!)).toBe('abc')
    })

    test('a video on the Android transport is read into memory even where the store serves URLs, and an image is not', async () => {
        const store = useStore({ urlFor: true })
        h.android = true
        const video = freshId()
        const image = freshId()
        await setInlayAsset(video, asset(new Blob(['v'], { type: 'video/mp4' })))
        await setInlayAsset(image, asset(new Blob(['i'], { type: 'image/png' }), { type: 'image' }))

        expect((await getInlayRender(video))!.source).toBe('memory-blob')
        expect((await getInlayRender(image))!.source).toBe('store-url')
        expect(store.urlRequests.length).toBe(1)
    })

    test('a store that keeps Blobs shows the very Blob it holds through an object URL', async () => {
        const store = useStore({ blobs: true })
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['stored'], { type: 'video/mp4' })))

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('stored-blob')
        expect(objectUrls.get(render.url)).toBe(store.blobs.get(bodyKeyOf(store)))
        expect(createdCount).toBe(1)
        expect(store.reads.filter((key) => key.startsWith('inlays/b-'))).toEqual([])
    })

    test('a body stored as bytes on a store that keeps Blobs is read into memory', async () => {
        const store = useStore({ blobs: true })
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['bytes'], { type: 'video/mp4' })))
        const key = bodyKeyOf(store)
        store.blobs.delete(key)
        store.files.set(key, new TextEncoder().encode('bytes'))

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('memory-blob')
        expect(await textOf(objectUrls.get(render.url)!)).toBe('bytes')
    })

    test('a stored Blob whose size is not the recorded length is not shown, and the bytes are read instead', async () => {
        const store = useStore({ blobs: true })
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['right'], { type: 'video/mp4' })))
        store.readBlob = async () => new Blob(['much longer than recorded'])

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('memory-blob')
        expect(await textOf(objectUrls.get(render.url)!)).toBe('right')
    })

    test.each([
        ['serves URLs', { urlFor: true, blobs: true }],
        ['keeps Blobs', { blobs: true }],
        ['keeps bytes', {}],
    ] as Array<[string, MemoryByteStoreOptions]>)('a base64 data URI string is decoded into a memory Blob on a store that %s', async (_label, options) => {
        const store = useStore(options)
        const id = freshId()
        await setInlayAsset(id, asset('data:audio/mpeg;base64,aGVsbG8=', { type: 'audio' }))

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('memory-blob')
        const shown = objectUrls.get(render.url)!
        expect(shown.type).toBe('audio/mpeg')
        expect(await textOf(shown)).toBe('hello')
        expect(store.urlRequests).toEqual([])
        expect(store.blobReads).toEqual([])
    })

    test('a signature has no URL and is never delivered from the store', async () => {
        const store = useStore({ urlFor: true, blobs: true })
        const id = freshId()
        await setInlayAsset(id, asset('{"signatures":[]}', { type: 'signature', ext: 'json' }))

        expect(await getInlayRender(id)).toEqual({ type: 'signature', url: '', source: 'signature' })
        expect(store.urlRequests).toEqual([])
        expect(createdCount).toBe(0)
    })

    test('an inlay found only in the old store is shown through an object URL over the old store\'s own Blob', async () => {
        const store = useStore({ urlFor: true, blobs: true })
        const id = freshId()
        const old = new Blob(['old'], { type: 'image/png' })
        h.legacy.set(id, asset(old, { type: 'image' }))

        const render = (await getInlayRender(id))!

        expect(render).toMatchObject({ type: 'image', source: 'memory-blob' })
        expect(objectUrls.get(render.url)).toBe(old)
        expect(store.urlRequests).toEqual([])
    })

    test('an id that is nowhere gives null and is asked again', async () => {
        const id = freshId()
        expect(await getInlayRender(id)).toBeNull()
        const reads = appStore.reads.length
        expect(await getInlayRender(id)).toBeNull()
        expect(appStore.reads.length).toBeGreaterThan(reads)
    })

    test('an app store that cannot be read falls back to the old store', async () => {
        const id = freshId()
        appStore.failRead = () => new Error('disk gone')
        h.legacy.set(id, asset(new Blob(['o']), { type: 'image' }))

        expect((await getInlayRender(id))!.source).toBe('memory-blob')
    })
})

describe('the render cache', () => {
    test('a second render of an unchanged id reads no metadata and no body', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['x'], { type: 'video/mp4' })))
        const first = await getInlayRender(id)
        const reads = appStore.reads.length
        const blobReads = appStore.blobReads.length

        expect(await getInlayRender(id)).toEqual(first)

        expect(appStore.reads.length).toBe(reads)
        expect(appStore.blobReads.length).toBe(blobReads)
        expect(createdCount).toBe(1)
    })

    test('a rewrite shows the new body and revokes the object URL of the old one', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['old'], { type: 'video/mp4' })))
        const before = (await getInlayRender(id))!

        await setInlayAsset(id, asset(new Blob(['new'], { type: 'video/mp4' })))
        const after = (await getInlayRender(id))!

        expect(revoked).toEqual([before.url])
        expect(after.url).not.toBe(before.url)
        expect(await textOf(objectUrls.get(after.url)!)).toBe('new')
    })

    test('a rewrite shows the new body on a store that serves URLs', async () => {
        useStore({ urlFor: true })
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['old'], { type: 'video/mp4' })))
        const before = (await getInlayRender(id))!

        await setInlayAsset(id, asset(new Blob(['new'], { type: 'video/mp4' })))
        const after = (await getInlayRender(id))!

        expect(after.url).not.toBe(before.url)
        expect(after.url).toContain('mem://inlays/b-')
        expect(revoked).toEqual([])
    })

    test('a delete drops the render, revokes its object URL, and the next render finds nothing', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['x'], { type: 'video/mp4' })))
        const shown = (await getInlayRender(id))!

        await removeInlayAsset(id)

        expect(revoked).toEqual([shown.url])
        expect(await getInlayRender(id)).toBeNull()
        expect(await getInlayRender(freshId())).toBeNull()
    })

    test('a delete of an inlay that is only in the old store drops its render too', async () => {
        const id = freshId()
        h.legacy.set(id, asset(new Blob(['x']), { type: 'image' }))
        const shown = (await getInlayRender(id))!
        expect(shown.source).toBe('memory-blob')

        await removeInlayAsset(id)

        expect(revoked).toEqual([shown.url])
        expect(await getInlayRender(id)).toBeNull()
        expect(createdCount).toBe(1)
    })

    test('a delete that fails still drops the render', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['x'], { type: 'video/mp4' })))
        await getInlayRender(id)
        appStore.failDelete = () => new Error('delete failed')

        await expect(removeInlayAsset(id)).rejects.toThrow('delete failed')

        expect(revoked.length).toBe(1)
    })

    test('a write that fails still drops the render', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['old'], { type: 'video/mp4' })))
        await getInlayRender(id)
        appStore.failWrite = (key) => (key.startsWith('inlays/b-') ? new Error('body failed') : null)

        await expect(setInlayAsset(id, asset(new Blob(['new'], { type: 'video/mp4' })))).rejects.toThrow('body failed')

        expect(revoked.length).toBe(1)
        appStore.failWrite = null
        expect(await textOf(objectUrls.get((await getInlayRender(id))!.url)!)).toBe('old')
    })

    test('a render being resolved delays a rewrite of the same id, and the rewrite is shown by the next render', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['old'], { type: 'video/mp4' })))
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        let held = false
        const realRead = appStore.read.bind(appStore)
        appStore.read = async (key) => {
            if (key === inlayMetaKey(id) && !held) {
                held = true
                await gate
            }
            return await realRead(key)
        }
        const writesBefore = appStore.writes.length

        const render = getInlayRender(id)
        await vi.waitFor(() => expect(held).toBe(true))
        const rewrite = setInlayAsset(id, asset(new Blob(['new'], { type: 'video/mp4' })))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(appStore.writes.length).toBe(writesBefore)
        release()
        const shown = (await render)!
        await rewrite

        expect(await textOf(objectUrls.get(shown.url)!)).toBe('old')
        const next = (await getInlayRender(id))!
        expect(next.url).not.toBe(shown.url)
        expect(await textOf(objectUrls.get(next.url)!)).toBe('new')
    })

    test('a render requested while a rewrite is half done waits for it and never caches the replaced body', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['old'], { type: 'video/mp4' })))
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        let atCommit = false
        const realWrite = appStore.write.bind(appStore)
        appStore.write = async (key, bytes, condition) => {
            if (key === inlayMetaKey(id)) {
                atCommit = true
                await gate
            }
            return await realWrite(key, bytes, condition)
        }

        const rewrite = setInlayAsset(id, asset(new Blob(['new'], { type: 'video/mp4' })))
        await vi.waitFor(() => expect(atCommit).toBe(true))
        let rendered = false
        const render = getInlayRender(id).then((result) => { rendered = true; return result })
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(rendered).toBe(false)
        release()
        await rewrite
        const shown = (await render)!

        expect(await textOf(objectUrls.get(shown.url)!)).toBe('new')
        expect(createdCount).toBe(1)
        expect(revoked).toEqual([])
    })

    test('an old body is deleted only after the render of it was dropped', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob(['old'], { type: 'video/mp4' })))
        const before = (await getInlayRender(id))!
        let revokedAtDelete: string[] | null = null
        const realDelete = appStore.delete.bind(appStore)
        appStore.delete = async (key, condition) => {
            if (key.startsWith('inlays/b-') && revokedAtDelete === null) {
                revokedAtDelete = [...revoked]
            }
            return await realDelete(key, condition)
        }

        await setInlayAsset(id, asset(new Blob(['new'], { type: 'video/mp4' })))

        expect(revokedAtDelete).toEqual([before.url])
    })
})

/**
 * Inlays belong in the app store, and an undecodable string value is a miss,
 * not a throw. The old `inlay` LocalForage database is an in-memory map.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'
import {
    getInlayAssetBlob,
    postInlayAsset,
    saveInlayedSignature,
    writeInlayImage,
} from '../inlays'

//#region module mocks

const fakeCtx = { drawImage: vi.fn() }
const origCreateElement = document.createElement.bind(document)
vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = origCreateElement(tag, options)
    if (tag === 'canvas') {
        ;(el as HTMLCanvasElement).getContext = (() => fakeCtx) as unknown as HTMLCanvasElement['getContext']
        ;(el as HTMLCanvasElement).toBlob = ((cb: BlobCallback) => {
            cb(new Blob(['fake-png'], { type: 'image/png' }))
        }) as HTMLCanvasElement['toBlob']
    }
    return el
})

const legacy = vi.hoisted(() => ({ map: new Map<string, unknown>() }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => legacy.map.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { legacy.map.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { legacy.map.delete(key) }),
            keys: vi.fn(async () => [...legacy.map.keys()]),
            iterate: vi.fn(async () => { }),
        }),
    },
}))

vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid-1234') }))
vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = { forageStorage: {} }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})
vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn() }))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }))
vi.mock(import('src/ts/storage/database.svelte'), () => ({ getDatabase: vi.fn() }))
vi.mock(import('src/ts/util'), () => ({ asBuffer: (arr: Uint8Array) => arr }) as typeof import('src/ts/util'))

//#endregion

function makeImage(w: number, h: number): HTMLImageElement {
    const img = new Image()
    Object.defineProperty(img, 'width', { get: () => w })
    Object.defineProperty(img, 'height', { get: () => h })
    Object.defineProperty(img, 'onload', {
        set(fn: () => void) { fn?.() },
        get() { return null },
    })
    return img
}

let appStore: MemoryByteStore

beforeEach(() => {
    legacy.map.clear()
    appStore = createMemoryByteStore()
    injectAppStore(appStore)
})

describe('where new inlays are written', () => {
    test('an attached audio file is stored under the inlay prefix of the app store', async () => {
        await postInlayAsset({ name: 'clip.mp3', data: new Uint8Array([1, 2, 3]) })
        expect((await appStore.list('inlays/')).length).toBeGreaterThan(0)
        expect(legacy.map.size).toBe(0)
    })

    test('an attached video file is stored under the inlay prefix of the app store', async () => {
        await postInlayAsset({ name: 'clip.webm', data: new Uint8Array([1, 2, 3]) })
        expect((await appStore.list('inlays/')).length).toBeGreaterThan(0)
        expect(legacy.map.size).toBe(0)
    })

    test('a written image is stored under the inlay prefix of the app store', async () => {
        await writeInlayImage(makeImage(4, 4), { id: 'img-1' })
        expect((await appStore.list('inlays/')).length).toBeGreaterThan(0)
        expect(legacy.map.size).toBe(0)
    })

    test('a saved signature is stored under the inlay prefix of the app store', async () => {
        await saveInlayedSignature('sig-1', { signatures: [], sourceFormat: 0, source: 'x' } as unknown as Parameters<typeof saveInlayedSignature>[1])
        expect((await appStore.list('inlays/')).length).toBeGreaterThan(0)
        expect(legacy.map.size).toBe(0)
    })
})

describe('reading a string value as a Blob', () => {
    test('a stored signature reads as not found instead of throwing', async () => {
        legacy.map.set('sig-old', { name: 'sig-old', data: '{"signatures":[]}', ext: 'json', type: 'signature' })
        await expect(getInlayAssetBlob('sig-old')).resolves.toBeNull()
    })
})

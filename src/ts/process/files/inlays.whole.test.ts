/**
 * An inlay image above the whole-read limit on the Android transport is shown
 * as the empty image of a missing inlay: its render carries no URL, the store
 * is not asked for one, and the body is neither read as a Blob nor as bytes.
 * Audio keeps its URL at any size, and nothing changes off Android. The bodies
 * are Blobs built from one shared 1 MiB piece, so no test holds more than that.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { resetBusyActionsForTest } from '../memory/busyActions'
import { createMemoryByteStore, type MemoryByteStore } from './tests/memoryByteStore'
import { getInlayRender, setInlayAsset, type InlayAsset } from './inlays'
import { ANDROID_WHOLE_READ_URL_LIMIT_BYTES } from 'src/ts/storage/assetUrlGate'

//#region module mocks

const h = vi.hoisted(() => ({ android: true }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            keys: vi.fn(async () => []),
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

const MIB = 1024 * 1024
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL
let counter = 0
let store: MemoryByteStore

const freshId = () => `whole-${++counter}`

/** A Blob of exactly `mib` MiB plus `extra` bytes that shares one MiB of memory. */
function blobOfSize(mib: number, extra: number, type: string): Blob {
    const piece = new Blob([new Uint8Array(MIB)])
    const parts: BlobPart[] = Array.from({ length: mib }, () => piece)
    if (extra > 0) {
        parts.push(new Uint8Array(extra))
    }
    return new Blob(parts, { type })
}

function asset(data: Blob, type: 'image' | 'audio'): InlayAsset {
    return { name: 'n.bin', ext: 'bin', type, data } as InlayAsset
}

beforeEach(() => {
    h.android = true
    URL.createObjectURL = vi.fn(() => 'blob:test/created')
    URL.revokeObjectURL = vi.fn()
    resetBusyActionsForTest()
    store = createMemoryByteStore({ urlFor: true, blobs: true })
    injectAppStore(store)
})

afterEach(() => {
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
})

describe('an inlay above the whole-read limit on Android', () => {
    test('reproducer: an image over the limit has an empty URL, asks the store for none and reads no body', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(blobOfSize(64, 1, 'image/png'), 'image'))
        store.urlRequests.length = 0
        store.reads.length = 0

        const render = (await getInlayRender(id))!

        expect(render).toEqual({ type: 'image', url: '', source: 'store-url' })
        expect(store.urlRequests).toEqual([])
        expect(store.reads.filter((key) => key.startsWith('inlays/b-'))).toEqual([])
        expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    test('guard: an audio inlay over the limit keeps its URL', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(blobOfSize(64, 1, 'audio/mpeg'), 'audio'))

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('store-url')
        expect(render.url).not.toBe('')
    })

    test('guard: an image of exactly the limit keeps its URL', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(blobOfSize(ANDROID_WHOLE_READ_URL_LIMIT_BYTES / MIB, 0, 'image/png'), 'image'))

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('store-url')
        expect(render.url).not.toBe('')
    })

    test('guard: off Android an image over the limit keeps its URL', async () => {
        h.android = false
        const id = freshId()
        await setInlayAsset(id, asset(blobOfSize(64, 1, 'image/png'), 'image'))

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('store-url')
        expect(render.url).not.toBe('')
    })
})

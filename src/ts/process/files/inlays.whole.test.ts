/**
 * An inlay image above the whole-read limit on the Android transport is
 * withheld: its render names the file and its size, carries no URL, the store
 * is not asked for one, and the body is neither read as a Blob nor as bytes.
 * The draft preview of it is a name and size chip. Audio keeps its URL at any
 * size, and nothing changes off Android. The bodies are Blobs built from one
 * shared 1 MiB piece, so no test holds more than that.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { resetBusyActionsForTest } from '../memory/busyActions'
import { createMemoryByteStore, type MemoryByteStore } from './tests/memoryByteStore'
import { getInlayDraftPreview, getInlayRender, setInlayAsset, type InlayAsset } from './inlays'
import { cachedInlayRender } from './inlayRenderCache'
import { withInlayLock, writeAppInlay } from './inlayStore'
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

/**
 * A base64 data URI image body of `mib` MiB of payload, written the way the backup restore writes a text
 * inlay: a Blob body with the `string` repr, so the record's length is the Blob's size. The payload is
 * one shared MiB of `A`, which is a valid base64 run.
 */
async function writeStringImage(id: string, mib: number): Promise<number> {
    const piece = new Blob([new Uint8Array(MIB).fill(0x41)])
    const body = new Blob(['data:image/png;base64,', ...Array.from({ length: mib }, () => piece)])
    const value = { name: 'big.png', ext: 'png', type: 'image', data: body }
    await withInlayLock(id, async () => {
        await writeAppInlay(store, id, value, { textRepr: 'string' })
    })
    return body.size
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
    const named = (name: string, data: Blob): InlayAsset => ({ ...asset(data, 'image'), name })
    const bodyKeys = (keys: string[]) => keys.filter((key) => key.startsWith('inlays/b-'))

    test('reproducer: an image over the limit is withheld by name and size, asks the store for no URL and reads no body', async () => {
        const id = freshId()
        await setInlayAsset(id, named('big.png', blobOfSize(64, 1, 'image/png')))
        store.urlRequests.length = 0
        store.reads.length = 0

        const render = (await getInlayRender(id))!

        expect(render).toEqual({ type: 'image', url: '', source: 'withheld', name: 'big.png', size: 64 * MIB + 1 })
        expect(store.urlRequests).toEqual([])
        expect(bodyKeys(store.reads)).toEqual([])
        expect(bodyKeys(store.blobReads)).toEqual([])
        expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    test('reproducer: the draft preview of an image over the limit is a chip with its name and size', async () => {
        const id = freshId()
        await setInlayAsset(id, named('big.png', blobOfSize(64, 1, 'image/png')))

        expect(await getInlayDraftPreview(id)).toEqual({ kind: 'file', name: 'big.png', size: 64 * MIB + 1 })
    })

    test('reproducer: a string image whose decoded size is over the limit is withheld before its body is read', async () => {
        const id = freshId()
        const length = await writeStringImage(id, 86)
        store.reads.length = 0
        store.blobReads.length = 0

        const render = (await getInlayRender(id))!

        expect(render).toEqual({ type: 'image', url: '', source: 'withheld', name: 'big.png', size: Math.floor(length * 0.75) })
        expect(Math.floor(length * 0.75)).toBeGreaterThan(ANDROID_WHOLE_READ_URL_LIMIT_BYTES)
        expect(bodyKeys(store.reads)).toEqual([])
        expect(bodyKeys(store.blobReads)).toEqual([])
    })

    test('reproducer: the cached render of a withheld image keeps its name and size and costs no further read', async () => {
        const id = freshId()
        await setInlayAsset(id, named('big.png', blobOfSize(64, 1, 'image/png')))
        const first = (await getInlayRender(id))!
        const readsBefore = store.reads.length

        expect(cachedInlayRender(id)).toEqual({ type: 'image', url: '', source: 'withheld', name: 'big.png', size: 64 * MIB + 1 })
        expect(await getInlayRender(id)).toEqual(first)
        expect(store.reads.length).toBe(readsBefore)
    })

    test.each([['empty', ''], ['whitespace only', '   ']])('reproducer: a %s stored name falls back to the id', async (_label, stored) => {
        const id = freshId()
        await setInlayAsset(id, named(stored, blobOfSize(64, 1, 'image/png')))

        const render = (await getInlayRender(id))!

        expect(render).toMatchObject({ source: 'withheld', name: id })
    })

    test('guard: a string image under the limit once decoded, though its stored length is over, is shown as before', async () => {
        const id = freshId()
        const length = await writeStringImage(id, 64)
        expect(length).toBeGreaterThan(ANDROID_WHOLE_READ_URL_LIMIT_BYTES)
        expect(Math.floor(length * 0.75)).toBeLessThan(ANDROID_WHOLE_READ_URL_LIMIT_BYTES)

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('memory-blob')
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
        expect(await getInlayDraftPreview(id)).toMatchObject({ kind: 'media', type: 'image' })
    })

    test('guard: off Android an image over the limit keeps its URL', async () => {
        h.android = false
        const id = freshId()
        await setInlayAsset(id, asset(blobOfSize(64, 1, 'image/png'), 'image'))

        const render = (await getInlayRender(id))!

        expect(render.source).toBe('store-url')
        expect(render.url).not.toBe('')
        expect(await getInlayDraftPreview(id)).toMatchObject({ kind: 'media', type: 'image' })
    })
})

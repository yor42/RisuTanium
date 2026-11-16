/**
 * An inlay image above the whole-read limit on the Android transport is
 * withheld: its render names the file and its size, carries no URL, the store
 * is not asked for one, and the body is neither read as a Blob nor as bytes.
 * The draft preview of it is a name and size chip. A string-stored audio or
 * video over the same limit is withheld the same way, from its record alone;
 * a Blob audio keeps its URL at any size, and nothing changes off Android.
 * The bodies are Blobs built from one shared 1 MiB piece, so no test holds
 * more than that.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { resetBusyActionsForTest } from '../memory/busyActions'
import { createMemoryByteStore, type MemoryByteStore } from './tests/memoryByteStore'
import { getInlayDraftPreview, getInlayRender, setInlayAsset, type InlayAsset } from './inlays'
import { cachedInlayRender, dropInlayRender } from './inlayRenderCache'
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

interface StringMediaSpec {
    /** The data URI header, which counts toward the stored length. */
    header: string
    type: 'image' | 'video' | 'audio'
    ext: string
    /** A non-string name is a stored field the render must not trust. */
    name: string | number
    /** The payload is `mib` MiB plus `extra` bytes of `A`, which is a valid base64 run. */
    mib: number
    extra: number
}

/**
 * A base64 data URI body written the way the backup restore writes a text inlay: a Blob body with the
 * `string` repr, so the record's length is the Blob's size. The payload shares one MiB of memory.
 * Returns the stored length.
 */
async function writeStringMedia(id: string, spec: StringMediaSpec): Promise<number> {
    const piece = new Blob([new Uint8Array(MIB).fill(0x41)])
    const parts: BlobPart[] = [spec.header, ...Array.from({ length: spec.mib }, () => piece)]
    if (spec.extra > 0) {
        parts.push(new Uint8Array(spec.extra).fill(0x41))
    }
    const body = new Blob(parts)
    const value = { name: spec.name, ext: spec.ext, type: spec.type, data: body }
    await withInlayLock(id, async () => {
        await writeAppInlay(store, id, value, { textRepr: 'string' })
    })
    return body.size
}

function writeStringImage(id: string, mib: number): Promise<number> {
    return writeStringMedia(id, { header: 'data:image/png;base64,', type: 'image', ext: 'png', name: 'big.png', mib, extra: 0 })
}

/** The decoded size the render policy estimates for a stored string length. */
const estimateOf = (length: number) => Math.floor(length * 0.75)

beforeEach(() => {
    h.android = true
    URL.createObjectURL = vi.fn(() => 'blob:test/created')
    URL.revokeObjectURL = vi.fn()
    resetBusyActionsForTest()
    store = createMemoryByteStore({ urlFor: true, blobs: true })
    injectAppStore(store)
})

/** Ids whose render may hold a decoded Blob; the page-wide cache would keep it for the file's run. */
const renderedIds: string[] = []

afterEach(() => {
    for (const id of renderedIds.splice(0)) {
        dropInlayRender(id)
    }
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

describe('a string audio or video above the whole-read limit on Android', () => {
    const LIMIT = ANDROID_WHOLE_READ_URL_LIMIT_BYTES
    const bodyKeys = (keys: string[]) => keys.filter((key) => key.startsWith('inlays/b-'))

    // A payload of 85 MiB + 349 504 bytes is a multiple of 4, so it is valid base64. With the 22-character
    // audio header the decoded estimate is exactly the limit; each further header character adds one byte.
    const OVER = { mib: 85, extra: 349_504 }
    const AUDIO_22 = 'data:audio/ogg;base64,'
    const AUDIO_23 = 'data:audio/mpeg;base64,'
    const VIDEO_23 = 'data:video/webm;base64,'

    const audioSpec = (header: string, name: string | number = 'big.mp3'): StringMediaSpec => ({ header, type: 'audio', ext: 'mp3', name, ...OVER })

    async function renderOf(id: string) {
        renderedIds.push(id)
        return await getInlayRender(id)
    }

    test('reproducer: a string audio whose decoded size is over the limit is withheld before its body is read', async () => {
        const id = freshId()
        const length = await writeStringMedia(id, audioSpec(AUDIO_23))
        expect(estimateOf(length)).toBe(LIMIT + 1)
        store.reads.length = 0
        store.blobReads.length = 0
        store.urlRequests.length = 0

        const render = await renderOf(id)

        expect(render).toEqual({ type: 'audio', url: '', source: 'withheld', name: 'big.mp3', size: LIMIT + 1 })
        expect(bodyKeys(store.reads)).toEqual([])
        expect(bodyKeys(store.blobReads)).toEqual([])
        expect(store.urlRequests).toEqual([])
        expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    test('reproducer: the draft preview of a string audio over the limit is a chip with its name and size', async () => {
        const id = freshId()
        await writeStringMedia(id, audioSpec(AUDIO_23))
        renderedIds.push(id)

        expect(await getInlayDraftPreview(id)).toEqual({ kind: 'file', name: 'big.mp3', size: LIMIT + 1 })
    })

    test('reproducer: the cached render of a withheld string audio keeps its shape and costs no further read', async () => {
        const id = freshId()
        await writeStringMedia(id, audioSpec(AUDIO_23))
        const first = (await renderOf(id))!
        const readsBefore = store.reads.length

        expect(cachedInlayRender(id)).toEqual({ type: 'audio', url: '', source: 'withheld', name: 'big.mp3', size: LIMIT + 1 })
        expect(await getInlayRender(id)).toEqual(first)
        expect(store.reads.length).toBe(readsBefore)
    })

    test('reproducer: a string video over the limit is withheld before its body is read', async () => {
        const id = freshId()
        const length = await writeStringMedia(id, { header: VIDEO_23, type: 'video', ext: 'webm', name: 'big.webm', ...OVER })
        expect(estimateOf(length)).toBe(LIMIT + 1)
        store.reads.length = 0
        store.blobReads.length = 0
        store.urlRequests.length = 0

        const render = await renderOf(id)

        expect(render).toEqual({ type: 'video', url: '', source: 'withheld', name: 'big.webm', size: LIMIT + 1 })
        expect(bodyKeys(store.reads)).toEqual([])
        expect(bodyKeys(store.blobReads)).toEqual([])
        expect(store.urlRequests).toEqual([])
        expect(URL.createObjectURL).not.toHaveBeenCalled()
    })

    test.each([['empty', ''], ['whitespace only', '   '], ['not a string', 7]])('reproducer: a %s stored name falls back to the id', async (_label, stored) => {
        const id = freshId()
        await writeStringMedia(id, audioSpec(AUDIO_23, stored))

        const render = await renderOf(id)

        expect(render).toMatchObject({ source: 'withheld', name: id })
    })

    test('guard: a string audio of exactly the limit once decoded is shown as before', async () => {
        const id = freshId()
        const length = await writeStringMedia(id, audioSpec(AUDIO_22))
        expect(estimateOf(length)).toBe(LIMIT)

        const render = (await renderOf(id))!

        expect(render.source).toBe('memory-blob')
    })

    test('guard: a string audio under the limit once decoded, though its stored length is over, is shown as before', async () => {
        const id = freshId()
        const length = await writeStringMedia(id, { header: AUDIO_23, type: 'audio', ext: 'mp3', name: 'big.mp3', mib: 64, extra: 0 })
        expect(length).toBeGreaterThan(LIMIT)
        expect(estimateOf(length)).toBeLessThan(LIMIT)

        const render = (await renderOf(id))!

        expect(render.source).toBe('memory-blob')
    })

    test('guard: off Android a string audio over the limit is shown as before', async () => {
        h.android = false
        const id = freshId()
        const length = await writeStringMedia(id, audioSpec(AUDIO_23))
        expect(estimateOf(length)).toBeGreaterThan(LIMIT)

        const render = (await renderOf(id))!

        expect(render.source).toBe('memory-blob')
    })

    test('guard: a body that is not a data URI string keeps being read, whatever its length', async () => {
        const id = freshId()
        const piece = new Blob([new Uint8Array(MIB).fill(0x41)])
        const body = new Blob(Array.from({ length: 65 }, () => piece))
        const value = { name: 'big.mp3', ext: 'mp3', type: 'audio', data: body }
        await withInlayLock(id, async () => {
            await writeAppInlay(store, id, value, { textRepr: 'string16' })
        })
        store.reads.length = 0

        const render = await renderOf(id)

        expect(render).toBeNull()
        expect(bodyKeys(store.reads).length).toBeGreaterThan(0)
    })
})

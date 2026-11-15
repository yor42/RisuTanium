/**
 * What a plugin or a Lua script costs the page when it reads an inlay: a video or audio over the send
 * limit is reported as too large from its summary, without its body being read from the app store, and
 * the Lua multimodal seam leaves such a file out. Images, signatures, a size equal to the limit and an
 * unknown size are read as before. The old `inlay` LocalForage database is an in-memory map that counts
 * its reads. Synthetic data only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { resetBusyActionsForTest } from '../../memory/busyActions'
import { inlayMetaKey } from '../inlayKeys'
import { INLAY_SEND_LIMIT_BYTES } from '../inlaySendGate'
import type { InlayRecord } from '../inlayStore'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'
import { getInlayAssetCapped, setInlayAsset, type InlayAsset } from '../inlays'
import { multimodalsOfInlays } from '../inlayMultimodals'

//#region module mocks

const h = vi.hoisted(() => ({
    legacy: new Map<string, unknown>(),
    legacyGets: [] as string[],
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => { h.legacyGets.push(key); return h.legacy.get(key) ?? null }),
            setItem: vi.fn(async (key: string, value: unknown) => { h.legacy.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { h.legacy.delete(key) }),
            keys: vi.fn(async () => [...h.legacy.keys()]),
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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid') }))
vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn() }))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }))
vi.mock(import('src/ts/storage/database.svelte'), () => ({ getDatabase: vi.fn() }))
vi.mock(import('src/ts/util'), () => ({ asBuffer: (arr: Uint8Array) => arr }) as typeof import('src/ts/util'))

//#endregion

const MIB = 1024 * 1024
const HEAVY_TIMEOUT_MS = 30_000

/** A base64 data URI of about 21 MiB of file, over the limit once its decoded size is estimated. */
const BIG_VIDEO_TEXT = 'data:video/mp4;base64,' + 'A'.repeat(28 * MIB)
const BIG_IMAGE_TEXT = 'data:image/png;base64,' + 'A'.repeat(28 * MIB)
const SMALL_VIDEO_TEXT = 'data:video/mp4;base64,' + 'A'.repeat(400)

const ID = {
    videoOver: 'pr-video-over',
    videoExact: 'pr-video-exact',
    audioOver: 'pr-audio-over',
    audioSmall: 'pr-audio-small',
    imageSmall: 'pr-image-small',
    imageBigText: 'pr-image-big-text',
    videoBigText: 'pr-video-big-text',
    videoNoBody: 'pr-video-no-body',
    gone: 'pr-gone',
    legacyOver: 'pr-legacy-over',
    legacySmall: 'pr-legacy-small',
}

let appStore: MemoryByteStore

function asset(data: string | Blob, extra: Record<string, unknown> = {}): InlayAsset {
    return { name: 'clip.mp4', ext: 'mp4', type: 'video', data, ...extra } as InlayAsset
}

function blobOf(size: number, mime: string): Blob {
    return new Blob([new Uint8Array(size)], { type: mime })
}

function recordOf(store: MemoryByteStore, id: string): InlayRecord {
    const bytes = store.files.get(inlayMetaKey(id) as string)
    expect(bytes).toBeDefined()
    return JSON.parse(new TextDecoder().decode(bytes)) as InlayRecord
}

function bodyReadsOf(id: string): string[] {
    const body = recordOf(appStore, id).body
    return appStore.reads.filter((key) => key === body)
}

/** The warns that name this inlay, so unrelated warns from the inlays code do not count. */
function warnsNaming(warn: { mock: { calls: unknown[][] } }, id: string): unknown[][] {
    return warn.mock.calls.filter((args) => args.some((arg) => String(arg).includes(id)))
}

beforeAll(async () => {
    resetBusyActionsForTest()
    appStore = createMemoryByteStore({})
    injectAppStore(appStore)
    await setInlayAsset(ID.videoOver, asset(blobOf(INLAY_SEND_LIMIT_BYTES + 1, 'video/mp4')))
    await setInlayAsset(ID.videoExact, asset(blobOf(INLAY_SEND_LIMIT_BYTES, 'video/mp4')))
    await setInlayAsset(ID.audioOver, asset(blobOf(INLAY_SEND_LIMIT_BYTES + 1, 'audio/mp3'), { name: 'clip.mp3', ext: 'mp3', type: 'audio' }))
    await setInlayAsset(ID.audioSmall, asset(blobOf(1024, 'audio/mp3'), { name: 'clip.mp3', ext: 'mp3', type: 'audio' }))
    await setInlayAsset(ID.imageSmall, asset(blobOf(64, 'image/png'), { name: 'pic.png', ext: 'png', type: 'image' }))
    await setInlayAsset(ID.imageBigText, asset(BIG_IMAGE_TEXT, { name: 'pic.png', ext: 'png', type: 'image' }))
    await setInlayAsset(ID.videoBigText, asset(BIG_VIDEO_TEXT))
    await setInlayAsset(ID.videoNoBody, asset(blobOf(64, 'video/mp4')))
    appStore.files.delete(recordOf(appStore, ID.videoNoBody).body)
}, HEAVY_TIMEOUT_MS)

beforeEach(() => {
    h.legacy.clear()
    h.legacyGets.length = 0
    appStore.reads.length = 0
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('getInlayAssetCapped of the app store', () => {
    test('a video over the limit is too large and its body is never read', async () => {
        const result = await getInlayAssetCapped(ID.videoOver)

        expect(result).toMatchObject({ status: 'too-large', summary: { type: 'video', size: INLAY_SEND_LIMIT_BYTES + 1 } })
        expect(bodyReadsOf(ID.videoOver)).toEqual([])
    }, HEAVY_TIMEOUT_MS)

    test('an audio over the limit is too large and its body is never read', async () => {
        const result = await getInlayAssetCapped(ID.audioOver)

        expect(result).toMatchObject({ status: 'too-large', summary: { type: 'audio', size: INLAY_SEND_LIMIT_BYTES + 1 } })
        expect(bodyReadsOf(ID.audioOver)).toEqual([])
    }, HEAVY_TIMEOUT_MS)

    test('a data URI video whose decoded size is over the limit is too large and its body is never read', async () => {
        const result = await getInlayAssetCapped(ID.videoBigText)

        expect(result).toMatchObject({ status: 'too-large', summary: { type: 'video' } })
        expect(bodyReadsOf(ID.videoBigText)).toEqual([])
    }, HEAVY_TIMEOUT_MS)

    test('a video of exactly the limit is read as a data URI', async () => {
        const result = await getInlayAssetCapped(ID.videoExact)

        expect(result?.status).toBe('read')
        expect(result?.status === 'read' && result.asset.data.startsWith('data:')).toBe(true)
        expect(bodyReadsOf(ID.videoExact)).toHaveLength(1)
    }, HEAVY_TIMEOUT_MS)

    test('a small audio is read', async () => {
        const result = await getInlayAssetCapped(ID.audioSmall)

        expect(result?.status).toBe('read')
        expect(result?.status === 'read' && result.asset.type).toBe('audio')
    })

    test('an image over the limit is read whatever its size', async () => {
        const result = await getInlayAssetCapped(ID.imageBigText)

        expect(result?.status).toBe('read')
        expect(result?.status === 'read' && result.asset.data.length).toBe(BIG_IMAGE_TEXT.length)
        expect(bodyReadsOf(ID.imageBigText)).toHaveLength(1)
    }, HEAVY_TIMEOUT_MS)

    test('an absent id and a non-string id give null', async () => {
        expect(await getInlayAssetCapped(ID.gone)).toBeNull()
        expect(await getInlayAssetCapped(7 as unknown as string)).toBeNull()
    })

    test('a record whose body key is gone gives null', async () => {
        expect(await getInlayAssetCapped(ID.videoNoBody)).toBeNull()
    })
})

describe('getInlayAssetCapped of the old store', () => {
    test('a string video over the limit is too large after a single read of the old store', async () => {
        h.legacy.set(ID.legacyOver, asset(BIG_VIDEO_TEXT))

        const result = await getInlayAssetCapped(ID.legacyOver)

        expect(result).toMatchObject({ status: 'too-large', summary: { type: 'video' } })
        expect(h.legacyGets.filter((key) => key === ID.legacyOver)).toHaveLength(1)
    }, HEAVY_TIMEOUT_MS)

    test('a small string video is read and keeps its stored string', async () => {
        h.legacy.set(ID.legacySmall, asset(SMALL_VIDEO_TEXT))

        const result = await getInlayAssetCapped(ID.legacySmall)

        expect(result?.status).toBe('read')
        expect(result?.status === 'read' && result.asset.data).toBe(SMALL_VIDEO_TEXT)
    })
})

describe('multimodalsOfInlays', () => {
    test('leaves out a file over the limit with one warning, keeps an unreadable id as an empty part and never reads the body', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const parts = await multimodalsOfInlays([ID.imageSmall, ID.videoOver, ID.gone, ID.audioSmall])

        expect(parts.map((part) => part.type)).toEqual(['image', undefined, 'audio'])
        expect(parts[1]).toEqual({ type: undefined, base64: undefined, width: undefined, height: undefined })
        expect(bodyReadsOf(ID.videoOver)).toEqual([])
        expect(warnsNaming(warn, ID.videoOver)).toHaveLength(1)
        expect(warnsNaming(warn, ID.imageSmall)).toHaveLength(0)
        expect(warnsNaming(warn, ID.audioSmall)).toHaveLength(0)
    }, HEAVY_TIMEOUT_MS)

    test('an empty list gives no part', async () => {
        expect(await multimodalsOfInlays([])).toEqual([])
    })
})

/**
 * What a video, audio or image inlay costs the page before it is sent: the summary reads the metadata
 * record only, a staged draft is previewed through its render (never a data URI), and forgetting a
 * render releases it even when it is still being resolved. The old `inlay` LocalForage database is an
 * in-memory map. Synthetic data only.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { resetBusyActionsForTest } from '../../memory/busyActions'
import { inlayMetaKey } from '../inlayKeys'
import { cachedInlayRender } from '../inlayRenderCache'
import { inlaySendVerdict } from '../inlaySendGate'
import { LLMFlags } from 'src/ts/model/types'
import type { InlayRecord } from '../inlayStore'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'
import {
    forgetInlayRender,
    getInlayDraftPreview,
    getInlayRender,
    getInlaySummary,
    listInlayAssets,
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

const MIB = 1024 * 1024

let appStore: MemoryByteStore
let revoked: string[]
let createdCount: number
let counter = 0
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL

/** An id no earlier test used, so the page-wide render cache starts empty for it. */
const freshId = () => `media-reads-${++counter}`

beforeEach(() => {
    h.legacy.clear()
    h.android = false
    revoked = []
    createdCount = 0
    URL.createObjectURL = vi.fn(() => `blob:test/${++createdCount}`)
    URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url) })
    resetBusyActionsForTest()
    appStore = createMemoryByteStore({})
    injectAppStore(appStore)
})

afterEach(() => {
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
    vi.restoreAllMocks()
})

function asset(data: string | Blob, extra: Record<string, unknown> = {}): InlayAsset {
    return { name: 'clip.mp4', ext: 'mp4', type: 'video', data, ...extra } as InlayAsset
}

function bodyReads(store: MemoryByteStore): string[] {
    return store.reads.filter((key) => key.startsWith('inlays/b-'))
}

function recordOf(store: MemoryByteStore, id: string): InlayRecord {
    const bytes = store.files.get(inlayMetaKey(id) as string)
    expect(bytes).toBeDefined()
    return JSON.parse(new TextDecoder().decode(bytes)) as InlayRecord
}

describe('getInlaySummary of the app store', () => {
    test('a blob record is sized by its body length and its body is never read', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob([new Uint8Array(1234)], { type: 'video/mp4' })))
        appStore.reads.length = 0

        const summary = await getInlaySummary(id)

        expect(summary).toEqual({ name: 'clip.mp4', ext: 'mp4', type: 'video', size: 1234 })
        expect(bodyReads(appStore)).toEqual([])
    })

    test('a data URI string record is sized by the decoded estimate, so a file of about 16 MiB stays under a 20 MiB cap', async () => {
        const id = freshId()
        await setInlayAsset(id, asset('data:video/mp4;base64,' + 'A'.repeat(21 * MIB)))
        const record = recordOf(appStore, id)
        expect(record.repr).toBe('string')
        appStore.reads.length = 0

        const summary = await getInlaySummary(id)

        expect(summary!.size).toBe(Math.floor(record.len * 0.75))
        expect(summary!.size!).toBeLessThanOrEqual(20 * MIB)
        expect(record.len).toBeGreaterThan(20 * MIB)
        expect(inlaySendVerdict(summary!, [LLMFlags.hasVideoInput], false)).toBe('read')
        expect(bodyReads(appStore)).toEqual([])
    })

    test('a string that is not well-formed UTF-16 keeps its stored length', async () => {
        const id = freshId()
        await setInlayAsset(id, asset('\ud800abc'))
        const record = recordOf(appStore, id)
        expect(record.repr).toBe('string16')

        const summary = await getInlaySummary(id)

        expect(summary!.size).toBe(record.len)
    })

    test('a store that fails on the metadata falls through to the old store', async () => {
        const id = freshId()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        h.legacy.set(id, asset('data:video/mp4;base64,' + 'A'.repeat(400)))
        appStore.failRead = (key) => (key.startsWith('inlays/m-') ? new Error('meta failed') : null)

        const summary = await getInlaySummary(id)

        expect(summary).toEqual({ name: 'clip.mp4', ext: 'mp4', type: 'video', size: Math.floor((22 + 400) * 0.75) })
        expect(warn).toHaveBeenCalled()
    })

    test('an absent id and a non-string id have no summary', async () => {
        expect(await getInlaySummary(freshId())).toBeNull()
        expect(await getInlaySummary(7 as unknown as string)).toBeNull()
    })
})

describe('getInlaySummary of the old store', () => {
    test('a Blob is sized by the Blob and a string by the decoded estimate; the listing sizes the same way', async () => {
        const blobId = freshId()
        const textId = freshId()
        const blob = new Blob([new Uint8Array(777)])
        const text = 'data:audio/mpeg;base64,' + 'B'.repeat(1000)
        h.legacy.set(blobId, asset(blob))
        h.legacy.set(textId, asset(text, { type: 'audio', ext: 'mp3' }))

        expect((await getInlaySummary(blobId))!.size).toBe(777)
        expect((await getInlaySummary(textId))!.size).toBe(Math.floor(text.length * 0.75))

        const listed = new Map(await listInlayAssets())
        expect(listed.get(blobId)!.size).toBe(777)
        expect(listed.get(textId)!.size).toBe(Math.floor(text.length * 0.75))
    })
})

describe('getInlayDraftPreview', () => {
    test('a video, audio and image on the desktop are shown through their render URL, never a data URI', async () => {
        const urls: string[] = []
        for (const [type, ext] of [['video', 'mp4'], ['audio', 'mp3'], ['image', 'png']] as const) {
            const id = freshId()
            await setInlayAsset(id, asset(new Blob([new Uint8Array(8)]), { type, ext }))
            const preview = await getInlayDraftPreview(id)
            expect(preview).toMatchObject({ kind: 'media', type })
            urls.push((preview as { url: string }).url)
        }
        expect(urls.every((url) => url.startsWith('blob:test/'))).toBe(true)
        expect(urls.some((url) => url.startsWith('data:'))).toBe(false)
    })

    test('a video on Android is a chip with its name and size, and nothing is rendered or read', async () => {
        h.android = true
        const id = freshId()
        await setInlayAsset(id, asset(new Blob([new Uint8Array(4321)], { type: 'video/mp4' })))
        appStore.reads.length = 0
        appStore.blobReads.length = 0
        appStore.urlRequests.length = 0
        const created = createdCount

        const preview = await getInlayDraftPreview(id)

        expect(preview).toEqual({ kind: 'file', name: 'clip.mp4', size: 4321 })
        expect(bodyReads(appStore)).toEqual([])
        expect(appStore.blobReads).toEqual([])
        expect(appStore.urlRequests).toEqual([])
        expect(createdCount).toBe(created)
        expect(cachedInlayRender(id)).toBeNull()
    })

    test('an image on Android is still shown through its render', async () => {
        h.android = true
        const id = freshId()
        await setInlayAsset(id, asset(new Blob([new Uint8Array(8)]), { type: 'image', ext: 'png' }))

        expect(await getInlayDraftPreview(id)).toMatchObject({ kind: 'media', type: 'image' })
    })

    test('a signature and a body that cannot be shown are chips, and an absent id has no preview', async () => {
        const signatureId = freshId()
        await setInlayAsset(signatureId, asset('sig-data', { type: 'signature', ext: 'sig', name: 'sig.png' }))
        const brokenId = freshId()
        await setInlayAsset(brokenId, asset('not a data uri'))

        expect(await getInlayDraftPreview(signatureId)).toMatchObject({ kind: 'file', name: 'sig.png' })
        expect(await getInlayDraftPreview(brokenId)).toMatchObject({ kind: 'file', name: 'clip.mp4' })
        expect(await getInlayDraftPreview(freshId())).toBeNull()
    })
})

describe('forgetInlayRender', () => {
    test('revokes the cached render, and the next render is resolved again', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob([new Uint8Array(8)])))
        const first = await getInlayRender(id)
        expect(first!.source).toBe('memory-blob')

        await forgetInlayRender(id)

        expect(revoked).toEqual([first!.url])
        expect(cachedInlayRender(id)).toBeNull()
        const readsBefore = bodyReads(appStore).length
        const second = await getInlayRender(id)
        expect(second!.url).not.toBe(first!.url)
        expect(bodyReads(appStore).length).toBeGreaterThan(readsBefore)
    })

    test('a forget during a render in flight revokes that render once it is cached', async () => {
        const id = freshId()
        await setInlayAsset(id, asset(new Blob([new Uint8Array(8)])))
        let release: () => void = () => {}
        const held = new Promise<void>((resolve) => { release = resolve })
        let entered = false
        const read = appStore.read.bind(appStore)
        appStore.read = async (key) => {
            if (key.startsWith('inlays/b-')) {
                entered = true
                await held
            }
            return await read(key)
        }

        const rendering = getInlayRender(id)
        const forgetting = forgetInlayRender(id)
        await vi.waitFor(() => expect(entered).toBe(true))
        release()
        const render = await rendering
        await forgetting

        expect(render).not.toBeNull()
        expect(revoked).toEqual([render!.url])
        expect(cachedInlayRender(id)).toBeNull()
        appStore.read = read
        const readsBefore = bodyReads(appStore).length
        await getInlayRender(id)
        expect(bodyReads(appStore).length).toBeGreaterThan(readsBefore)
    })
})

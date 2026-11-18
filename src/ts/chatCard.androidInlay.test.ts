// @vitest-environment happy-dom

/**
 * An Android Blob inlay image in "Copy as card": the real inlay writer and render register the store URL with the
 * body length, and the card's real admission gate and whole-read queue decide from that registration. Only the
 * transport, the store's URL scheme, the platform flag and the image encoder are replaced, so a pass says nothing
 * about a real WebView or the native asset read.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { androidWholeReadQueue, resetAssetUrlGateForTest } from 'src/ts/storage/assetUrlGate'
import { resetBusyActionsForTest } from './process/memory/busyActions'
import { createMemoryByteStore } from './process/files/tests/memoryByteStore'
import { dropInlayRender } from './process/files/inlayRenderCache'
import { getInlayRender, setInlayAsset, type InlayAsset } from './process/files/inlays'
import { captureCardTheme, createCardCopyController, liveCardEnv, type CardReport, type EncodeAvatar } from './chatCard'

//#region module mocks

const h = vi.hoisted(() => ({ android: true }))
const encoder = vi.hoisted(() => ({ encodeAvatar: vi.fn() }))

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

vi.mock('./chatCardImage', () => ({
    encodeAvatar: (...args: unknown[]) => encoder.encodeAvatar(...args),
}))

vi.mock('./platform', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./platform')>()),
    isTauri: true,
}))

//#endregion

const MIB = 1024 * 1024
const theme = captureCardTheme(() => '')
const IMG = (n: number) => `data:image/jpeg;base64,IMG${n}`

/** A Blob of `mib` MiB that shares one MiB of memory. */
function blobOfSize(mib: number, type: string): Blob {
    const piece = new Blob([new Uint8Array(MIB)])
    return new Blob(Array.from({ length: mib }, () => piece), { type })
}

let counter = 0
const renderedIds: string[] = []
const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
let write: ReturnType<typeof vi.fn>
let resolvers: ((value: string | null) => void)[]
let sources: string[]

async function flush(): Promise<void> {
    for (let i = 0; i < 60; i++) {
        await Promise.resolve()
    }
}

beforeEach(() => {
    h.android = true
    resetBusyActionsForTest()
    resetAssetUrlGateForTest()
    injectAppStore(createMemoryByteStore({
        blobs: true,
        urlFor: async (key: string) => `http://asset.localhost/${encodeURIComponent(key)}`,
    }))
    resolvers = []
    sources = []
    encoder.encodeAvatar.mockReset()
    encoder.encodeAvatar.mockImplementation(((src, { signal }) => {
        sources.push(src)
        return new Promise<string | null>((resolve) => {
            resolvers.push(resolve)
            signal.addEventListener('abort', () => resolve(null), { once: true })
        })
    }) satisfies EncodeAvatar)
    write = vi.fn(async (items: ClipboardItem[]) => {
        for (const item of items) {
            for (const type of item.types) {
                await item.getType(type)
            }
        }
    })
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn(async () => {}) }, configurable: true })
})

afterEach(() => {
    for (const id of renderedIds.splice(0)) {
        dropInlayRender(id)
    }
    resetAssetUrlGateForTest()
    if (realClipboard) {
        Object.defineProperty(navigator, 'clipboard', realClipboard)
    } else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
})

/** Writes an image inlay of `mib` MiB through the real writer and returns the URL its real render gives. */
async function storedImageUrl(mib: number): Promise<string> {
    const id = `card-inlay-${++counter}`
    renderedIds.push(id)
    await setInlayAsset(id, { name: 'n.png', ext: 'png', type: 'image', data: blobOfSize(mib, 'image/png') } as InlayAsset)
    const render = (await getInlayRender(id))!
    expect(render.source).toBe('store-url')
    return render.url
}

async function copyCard(url: string) {
    const controller = createCardCopyController(liveCardEnv)
    const reports: CardReport[] = []
    controller.start({
        owner: {},
        captureText: () => 'hello',
        captureCard: () => ({
            copyText: 'hello',
            displayName: 'Ann',
            badge: 'AI',
            avatarPath: '',
            theme,
            parseBody: async () => `<div class="risu-inlay-image"><img src="${url}"/></div>`,
            resolveAvatarSrc: async (path: string) => path,
        }),
        report: (report) => reports.push(report),
    })
    await flush()
    return { kinds: () => reports.map((report) => report.kind) }
}

async function writtenHtml(): Promise<string> {
    const [items] = write.mock.calls[0]
    return await (await (items as ClipboardItem[])[0].getType('text/html')).text()
}

/** Whether a read of the queue's whole budget has to wait, that is, whether any grant is held. */
async function wholeBudgetProbeIsPending(): Promise<boolean> {
    let granted = false
    void androidWholeReadQueue().acquire(64 * MIB).then((grant) => {
        granted = true
        grant.release()
    })
    await flush()
    return !granted
}

describe('an Android Blob inlay image in the card', () => {
    test('an image under 8 MiB is embedded and holds no grant while it is read', async () => {
        const url = await storedImageUrl(1)

        const run = await copyCard(url)
        expect(sources).toEqual([url])
        expect(await wholeBudgetProbeIsPending()).toBe(false)

        resolvers[0](IMG(1))
        await flush()

        expect(await writtenHtml()).toContain(`src="${IMG(1)}"`)
        expect(run.kinds()).toEqual(['loading', 'copied'])
    })

    test('an image of 8 to 15 MiB holds a grant until its read ends, and is embedded', async () => {
        const url = await storedImageUrl(10)

        const run = await copyCard(url)
        expect(sources).toEqual([url])
        expect(await wholeBudgetProbeIsPending()).toBe(true)

        resolvers[0](IMG(1))
        await flush()

        expect(await wholeBudgetProbeIsPending()).toBe(false)
        expect(await writtenHtml()).toContain(`src="${IMG(1)}"`)
        expect(run.kinds()).toEqual(['loading', 'copied'])
    })

    test('an image over 15 MiB is never read and the card says simple', async () => {
        const url = await storedImageUrl(16)

        const run = await copyCard(url)

        expect(sources).toEqual([])
        expect(await writtenHtml()).not.toContain('<img')
        expect(run.kinds()).toEqual(['loading', 'simple'])
    })
})

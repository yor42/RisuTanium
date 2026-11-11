// @vitest-environment happy-dom

/**
 * The real generator of `avatarThumb.ts` on an Android page, with the app-wide
 * whole-read queue: a still of at least 8 MiB takes a grant of its stored size
 * from the queue before its URL decode and gives it back when that decode
 * settles or the task times out, so the thumbnails' decodes and the display
 * whole reads together stay within the queue's budget. Below 8 MiB, off Android,
 * and on every path that does not decode from the URL, nothing is acquired.
 *
 * The page is a Tauri one: the header comes through the real `readTauriHeader`
 * with `readRangedPieces` yielding one 64 KiB piece of a synthetic PNG whose
 * `total` is the declared stored size, as the real transport does. The stored
 * size, the Android switch and the asset URL are the module-boundary stand-ins of
 * `wholeReadQueue.testKit.ts`; the size verdict, the queue, the thumbnail queue
 * and `awaitQueuedWholeRead` are the real ones. The render step is a controllable
 * deferred, because the URL decode is exactly what the queue holds a grant for.
 *
 * "Pre-hold" = a grant the test takes from the queue itself, as display reads do.
 * "Probe" = an `acquire` the test issues to see whether the thumbnail holds a grant.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
            iterate: vi.fn(async () => {}),
        }),
    },
}))

const { readImageMock, urlForMock, ranged } = vi.hoisted(() => ({
    readImageMock: vi.fn(async (_loc: string) => undefined as Uint8Array | null | undefined),
    urlForMock: vi.fn(async (_loc: string) => ''),
    ranged: { wait: null as Promise<void> | null, headers: new Map<string, Uint8Array>(), defaultHeader: new Uint8Array(0) },
}))

vi.mock(
    import('../globalApi.svelte'),
    () =>
        ({
            readImage: readImageMock,
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('../globalApi.svelte'),
)

vi.mock(
    import('../stores.svelte'),
    () =>
        ({
            DBState: { db: { characters: [], characterOrder: [] } },
            selIdState: { state: -1 },
        }) as unknown as typeof import('../stores.svelte'),
)

vi.mock('../platform', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>()
    const mod: Record<string, unknown> = {}
    for (const key of Object.keys(actual)) {
        mod[key] = actual[key]
    }
    Object.defineProperty(mod, 'isNodeServer', { get: () => false, enumerable: true })
    Object.defineProperty(mod, 'isTauri', { get: () => true, enumerable: true })
    return mod
})

vi.mock('../tauriDesktop', () => ({ isTauriDesktop: false }))

vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => ({ urlFor: urlForMock }),
}))

vi.mock('../storage/tauriByteTransport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../storage/tauriByteTransport')>()
    return {
        ...actual,
        isAndroidTransport: () => androidTransport.android,
        transportKind: () => (androidTransport.android ? 'android' : 'desktop'),
        statStoredSize: async (key: string) => {
            const size = androidTransport.sizes[key]
            if (size === undefined) {
                throw new Error('failed to open (os error 2)')
            }
            return size
        },
        readRangedPieces: (key: string) => (async function* () {
            if (ranged.wait !== null) {
                await ranged.wait
            }
            yield {
                bytes: (ranged.headers.get(key) ?? ranged.defaultHeader).slice(),
                offset: 0,
                total: androidTransport.sizes[key] ?? 0,
                identity: 'synthetic',
            }
        })(),
    }
})

import { __avatarThumbTestHooks, THUMB_VERSION, getAvatarThumbSrc } from './avatarThumb'
import { androidWholeReadQueue, forgetStoredAssetSizes, resetAssetUrlGateForTest, type InFlightGrant } from '../storage/assetUrlGate'
import { HEADER_BYTES } from './avatarThumbHeader'
import {
    FakeImage,
    MIB,
    WHOLE_READ_BUDGET_BYTES,
    androidTransport,
    createMirroredGetCharImage,
    exposedBytes,
    resetAndroidTransport,
    seedSizes,
    urlOf,
} from './wholeReadQueue.testKit'

function ascii(s: string): Uint8Array {
    return Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)))
}

function u32be(n: number): Uint8Array {
    return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
    let at = 0
    for (const p of parts) {
        out.set(p, at)
        at += p.length
    }
    return out
}

function pngChunk(type: string, dataLen: number): Uint8Array {
    return concat(u32be(dataLen), ascii(type), new Uint8Array(dataLen), new Uint8Array(4))
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A synthetic still PNG of a few hundred KiB; its declared stored size is set apart from these bytes. */
function stillPng(): Uint8Array {
    return concat(PNG_SIGNATURE, pngChunk('IHDR', 13), pngChunk('IDAT', 300 * 1024), pngChunk('IEND', 0))
}

/** A synthetic animated PNG (an `acTL` chunk before the image data). */
function animatedPng(): Uint8Array {
    return concat(PNG_SIGNATURE, pngChunk('IHDR', 13), pngChunk('acTL', 8), pngChunk('IDAT', 300 * 1024), pngChunk('IEND', 0))
}

interface FakeStore {
    getItem: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
    iterate: ReturnType<typeof vi.fn>
}

function makeMemoryStore(): FakeStore {
    const map = new Map<string, unknown>()
    return {
        getItem: vi.fn(async (key: string) => map.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: unknown) => { map.set(key, value) }),
        removeItem: vi.fn(async (key: string) => { map.delete(key) }),
        iterate: vi.fn(async () => {}),
    }
}

interface Deferred {
    promise: Promise<void>
    resolve(): void
}

function deferred(): Deferred {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

type RenderResult = { src: string } | null

/** One URL render the thumbnail asked for; it settles only when the test says so. */
interface PendingRender {
    url: string
    open: boolean
    resolve(value: RenderResult): void
    reject(error: Error): void
}

interface Tracked {
    done: boolean
    value: string | null | undefined
}

const renderMock = vi.fn()
let store: FakeStore
let urlRenders: PendingRender[]
let heldGrants: InFlightGrant[]
let readWait: Deferred | null
let holdController: AbortController

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

function track(promise: Promise<string | null>): Tracked {
    const tracked: Tracked = { done: false, value: undefined }
    void promise.then((value) => {
        tracked.done = true
        tracked.value = value
    })
    return tracked
}

/** Takes `mib` from the queue the way a display read does and keeps the grant until the test releases it. */
async function preHold(mib: number): Promise<InFlightGrant> {
    const grant = await androidWholeReadQueue().acquire(mib * MIB)
    heldGrants.push(grant)
    return grant
}

/** An `acquire` of the whole budget; `granted` tells whether the queue admitted it. */
function probeGate(): { readonly granted: boolean, release(): void } {
    const probe = { granted: false, release: () => {} }
    void androidWholeReadQueue().acquire(WHOLE_READ_BUDGET_BYTES).then((grant) => {
        heldGrants.push(grant)
        probe.granted = true
        probe.release = () => grant.release()
    })
    return probe
}

function renderedStillSize(render: PendingRender): number {
    return androidTransport.sizes[render.url.slice(urlOf('').length)] ?? 0
}

/** Display reads and thumbnail decodes in flight, each counted at its stored size. */
function exposure(): number {
    return exposedBytes(document.body) + urlRenders.filter((render) => render.open).reduce((sum, render) => sum + renderedStillSize(render), 0)
}

function seedStill(loc: string, mib: number): void {
    seedSizes([loc], mib)
    ranged.headers.set(loc, ranged.defaultHeader)
}

beforeEach(() => {
    vi.useFakeTimers()
    __avatarThumbTestHooks.reset()
    resetAssetUrlGateForTest()
    resetAndroidTransport(true)
    FakeImage.all = []
    heldGrants = []
    urlRenders = []
    readWait = null
    holdController = new AbortController()
    ranged.wait = null
    ranged.headers.clear()
    ranged.defaultHeader = stillPng().slice(0, HEADER_BYTES)
    readImageMock.mockReset()
    readImageMock.mockImplementation(async () => {
        if (readWait !== null) {
            await readWait.promise
        }
        return stillPng()
    })
    urlForMock.mockReset()
    urlForMock.mockImplementation(async (loc: string) => urlOf(loc))
    renderMock.mockReset()
    renderMock.mockImplementation((source: { kind: string, url?: string }) => {
        if (source.kind === 'bytes') {
            return Promise.resolve({ src: 'thumb:bytes' })
        }
        return new Promise<RenderResult>((resolve, reject) => {
            const render: PendingRender = {
                url: source.url ?? '',
                open: true,
                resolve: (value) => { render.open = false; resolve(value) },
                reject: (error) => { render.open = false; reject(error) },
            }
            urlRenders.push(render)
        })
    })
    vi.stubGlobal('Image', FakeImage)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store = makeMemoryStore()
    __avatarThumbTestHooks.setStore(store as never)
    __avatarThumbTestHooks.setReadbackCheck(() => true)
    __avatarThumbTestHooks.setRenderThumb(renderMock)
})

afterEach(async () => {
    // The gate is reset in `beforeEach`, before anything is released. A waiting
    // thumbnail task survives `reset()` (it does not cancel a paused task), so
    // every grant is released and every render settled while the fake clock
    // still runs, until no task is left to leak into the next test.
    holdController.abort()
    for (let round = 0; round < 4; round++) {
        readWait?.resolve()
        for (const grant of heldGrants.splice(0)) {
            grant.release()
        }
        for (const render of urlRenders) {
            if (render.open) {
                render.resolve(null)
            }
        }
        await tick(20000)
    }
    expect(__avatarThumbTestHooks.stats().running).toBe(0)
    vi.useRealTimers()
    __avatarThumbTestHooks.reset()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('a still of 8 MiB or more on Android', () => {
    test('reproducer: its URL decode waits for a grant of the queue while the queue is full, and starts once it is admitted', async () => {
        const locs = ['assets/a.png', 'assets/b.png', 'assets/c.png', 'assets/d.png']
        for (const loc of locs) {
            seedStill(loc, 20)
        }
        const hold = await preHold(64)

        const results = locs.map((loc) => track(getAvatarThumbSrc(loc)))
        await tick()
        expect(urlRenders).toHaveLength(0)

        hold.release()
        await tick()
        expect(urlRenders).toHaveLength(2)
        for (const render of urlRenders) {
            render.resolve({ src: 'thumb:url' })
        }
        await tick()
        expect(results.filter((result) => result.done).map((result) => result.value)).toEqual(['thumb:url', 'thumb:url'])
    })

    test('reproducer: a still of exactly 8 MiB is queued', async () => {
        seedStill('assets/edge.png', 8)
        await preHold(60)

        const result = track(getAvatarThumbSrc('assets/edge.png'))
        await tick()
        expect(urlRenders).toHaveLength(0)
        expect(result.done).toBe(false)
    })

    test('reproducer: display reads and thumbnail decodes together stay within the queue budget, each at its real size', async () => {
        const getCharImage = createMirroredGetCharImage(() => false)
        seedSizes(['assets/d1.png', 'assets/d2.png'], 25)
        seedStill('assets/t1.png', 20)
        seedStill('assets/t2.png', 20)
        let peak = 0
        const sample = () => { peak = Math.max(peak, exposure()) }

        void getCharImage('assets/d1.png', 'plain', { signal: holdController.signal })
        void getCharImage('assets/d2.png', 'plain', { signal: holdController.signal })
        await tick()
        sample()
        expect(FakeImage.all).toHaveLength(2)

        const first = track(getAvatarThumbSrc('assets/t1.png'))
        const second = track(getAvatarThumbSrc('assets/t2.png'))
        await tick()
        sample()
        expect(urlRenders).toHaveLength(0)

        FakeImage.all[0].fire('load')
        await tick()
        sample()
        expect(urlRenders).toHaveLength(1)

        FakeImage.all[1].fire('load')
        await tick()
        sample()
        expect(urlRenders).toHaveLength(2)

        for (const render of urlRenders) {
            render.resolve({ src: 'thumb:url' })
            await tick()
            sample()
        }
        expect(first.value).toBe('thumb:url')
        expect(second.value).toBe('thumb:url')
        expect(peak).toBeGreaterThanOrEqual(50 * MIB)
        expect(peak).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
    })

    test('reproducer: the grant is given back when the decode resolves', async () => {
        seedStill('assets/a.png', 20)
        const result = track(getAvatarThumbSrc('assets/a.png'))
        await tick()
        expect(urlRenders).toHaveLength(1)
        const probe = probeGate()
        await tick()
        expect(probe.granted).toBe(false)

        urlRenders[0].resolve({ src: 'thumb:url' })
        await tick()

        expect(result.value).toBe('thumb:url')
        expect(probe.granted).toBe(true)
    })

    test('reproducer: the grant is given back when the decode rejects, before the whole read of the fallback, which is not queued', async () => {
        seedStill('assets/a.png', 20)
        readWait = deferred()
        const result = track(getAvatarThumbSrc('assets/a.png'))
        await tick()
        expect(urlRenders).toHaveLength(1)
        const probe = probeGate()
        await tick()
        expect(probe.granted).toBe(false)

        urlRenders[0].reject(new Error('the image failed to load'))
        await tick()

        expect(readImageMock).toHaveBeenCalledTimes(1)
        expect(result.done).toBe(false)
        expect(probe.granted).toBe(true)

        readWait.resolve()
        await tick()
        expect(result.value).toBe('thumb:bytes')
    })

    test('reproducer: a decode that never settles times out, gives the grant back, stores nothing and is retried by the next request', async () => {
        seedStill('assets/hung.png', 20)
        const result = track(getAvatarThumbSrc('assets/hung.png'))
        await tick()
        expect(urlRenders).toHaveLength(1)
        const probe = probeGate()
        await tick()
        expect(probe.granted).toBe(false)

        await tick(15000)

        expect(result.done).toBe(true)
        expect(result.value).toBeNull()
        expect(store.setItem).not.toHaveBeenCalled()
        expect(probe.granted).toBe(true)

        probe.release()
        const retry = track(getAvatarThumbSrc('assets/hung.png'))
        await tick()
        expect(urlRenders).toHaveLength(2)
        expect(retry.done).toBe(false)
    })

    test('reproducer: no grant is held while the asset URL is still being made', async () => {
        seedStill('assets/a.png', 20)
        const urlReady = deferred()
        urlForMock.mockImplementation(async (loc: string) => {
            await urlReady.promise
            return urlOf(loc)
        })
        const result = track(getAvatarThumbSrc('assets/a.png'))
        await tick()

        const probe = probeGate()
        await tick()
        expect(probe.granted).toBe(true)

        urlReady.resolve()
        await tick()
        expect(urlRenders).toHaveLength(0)

        probe.release()
        await tick()
        expect(urlRenders).toHaveLength(1)
        expect(result.done).toBe(false)
    })

    test('reproducer: a wait for a grant longer than the task timeout does not time the task out', async () => {
        seedStill('assets/a.png', 20)
        const hold = await preHold(64)
        const result = track(getAvatarThumbSrc('assets/a.png'))

        await tick(20000)
        expect(result.done).toBe(false)
        expect(urlRenders).toHaveLength(0)

        hold.release()
        await tick()
        expect(urlRenders).toHaveLength(1)
        await tick(1000)
        urlRenders[0].resolve({ src: 'thumb:url' })
        await tick()

        expect(result.value).toBe('thumb:url')
        expect(store.setItem).toHaveBeenCalledWith('assets/a.png', { v: THUMB_VERSION, src: 'thumb:url' })
    })

    test('reproducer: a decode that hangs after the grant times out 15 s after the grant', async () => {
        seedStill('assets/a.png', 20)
        const hold = await preHold(64)
        const result = track(getAvatarThumbSrc('assets/a.png'))
        await tick(20000)
        hold.release()
        await tick()
        expect(urlRenders).toHaveLength(1)

        await tick(14900)
        expect(result.done).toBe(false)
        await tick(100)

        expect(result.done).toBe(true)
        expect(result.value).toBeNull()
    })

    test('guard: the time before the grant stays bounded: a header read that takes 16 s times the task out without a render or a grant', async () => {
        seedStill('assets/slow.png', 20)
        ranged.wait = new Promise<void>((resolve) => { setTimeout(resolve, 16000) })
        const result = track(getAvatarThumbSrc('assets/slow.png'))
        await tick(15000)

        expect(result.done).toBe(true)
        expect(result.value).toBeNull()
        const probe = probeGate()
        await tick()
        expect(probe.granted).toBe(true)

        await tick(2000)
        expect(urlRenders).toHaveLength(0)
        expect(renderMock).not.toHaveBeenCalled()
    })

    test('reproducer: a size that is no longer known when the URL is ready is queued at 8 MiB', async () => {
        seedStill('assets/a.png', 20)
        await preHold(60)
        const gate = deferred()
        ranged.wait = gate.promise
        const result = track(getAvatarThumbSrc('assets/a.png'))
        await tick()

        forgetStoredAssetSizes(['assets/a.png'])
        gate.resolve()
        await tick()

        expect(urlRenders).toHaveLength(0)
        expect(result.done).toBe(false)
    })
})

describe('a still that is not queued', () => {
    test('guard: a still under 8 MiB is decoded at once with the queue full', async () => {
        seedStill('assets/small.png', 4)
        await preHold(64)

        const result = track(getAvatarThumbSrc('assets/small.png'))
        await tick()
        expect(urlRenders).toHaveLength(1)
        urlRenders[0].resolve({ src: 'thumb:url' })
        await tick()

        expect(result.value).toBe('thumb:url')
    })

    test('guard: under 8 MiB the task timer is neither paused nor restarted', async () => {
        seedStill('assets/small.png', 4)
        const headerDelay = deferred()
        ranged.wait = headerDelay.promise
        const result = track(getAvatarThumbSrc('assets/small.png'))
        await tick(10000)
        headerDelay.resolve()
        await tick()
        expect(urlRenders).toHaveLength(1)

        await tick(4900)
        expect(result.done).toBe(false)
        await tick(100)

        expect(result.done).toBe(true)
        expect(result.value).toBeNull()
    })

    test('guard: off Android a large still is decoded at once with the queue full', async () => {
        resetAndroidTransport(false)
        seedStill('assets/big.png', 20)
        await preHold(64)

        const result = track(getAvatarThumbSrc('assets/big.png'))
        await tick()
        expect(urlRenders).toHaveLength(1)
        urlRenders[0].resolve({ src: 'thumb:url' })
        await tick()

        expect(result.value).toBe('thumb:url')
    })

    test('guard: a skip verdict and an unreadable size are answered with the queue full', async () => {
        seedStill('assets/over.png', 65)
        await preHold(64)

        const over = track(getAvatarThumbSrc('assets/over.png'))
        const unreadable = track(getAvatarThumbSrc('assets/unknown.png'))
        await tick()

        expect(over.done).toBe(true)
        expect(over.value).toBeNull()
        expect(store.setItem).toHaveBeenCalledWith('assets/over.png', { v: THUMB_VERSION, skip: true })
        expect(unreadable.done).toBe(true)
        expect(unreadable.value).toBeNull()
        expect(store.setItem).toHaveBeenCalledTimes(1)
        expect(urlRenders).toHaveLength(0)
    })

    test('guard: an animated file is a skip with the queue full, before any grant is asked for', async () => {
        seedSizes(['assets/anim.png'], 20)
        ranged.headers.set('assets/anim.png', animatedPng().slice(0, HEADER_BYTES))
        await preHold(64)

        const result = track(getAvatarThumbSrc('assets/anim.png'))
        await tick()

        expect(result.done).toBe(true)
        expect(result.value).toBeNull()
        expect(store.setItem).toHaveBeenCalledWith('assets/anim.png', { v: THUMB_VERSION, skip: true })
        expect(urlRenders).toHaveLength(0)
    })

    test('guard: a waiting thumbnail and a display read queued after it both complete', async () => {
        const getCharImage = createMirroredGetCharImage(() => false)
        seedStill('assets/a.png', 20)
        seedSizes(['assets/b.png'], 20)
        const hold = await preHold(64)

        const thumb = track(getAvatarThumbSrc('assets/a.png'))
        await tick()
        let displayed: string | null | symbol | undefined
        let queued = false
        void getCharImage('assets/b.png', 'plain', { signal: holdController.signal, onWholeReadQueued: () => { queued = true } }).then((value) => { displayed = value })
        await tick()
        expect(FakeImage.all).toHaveLength(0)

        hold.release()
        await tick()
        expect(urlRenders).toHaveLength(1)
        expect(FakeImage.all).toHaveLength(1)
        urlRenders[0].resolve({ src: 'thumb:url' })
        FakeImage.all[0].fire('load')
        await tick()

        expect(thumb.value).toBe('thumb:url')
        expect(queued).toBe(true)
        expect(displayed).toBe(urlOf('assets/b.png'))
    })

    test('guard: once the URL decode is switched off for the page, the whole-read fallback of a large still takes no grant', async () => {
        seedStill('assets/first.png', 4)
        seedStill('assets/big.png', 20)

        const first = track(getAvatarThumbSrc('assets/first.png'))
        await tick()
        expect(urlRenders).toHaveLength(1)
        urlRenders[0].reject(new Error('the image failed to load'))
        await tick()
        expect(first.value).toBe('thumb:bytes')

        await preHold(64)
        const big = track(getAvatarThumbSrc('assets/big.png'))
        await tick()

        expect(urlRenders).toHaveLength(1)
        expect(big.done).toBe(true)
        expect(big.value).toBe('thumb:bytes')
    })
})

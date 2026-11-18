// @vitest-environment happy-dom

/**
 * The native-preview wiring of `avatarThumb.ts` that the bounded and whole-read
 * files do not cover: a task bound for the native lane gives its general slot
 * back (and only once), a caller that leaves is seen by the lane, and the
 * pixel render draws the native RGBA 1:1 under the JPEG's Exif orientation.
 *
 * MOCKED: `localforage`, `globalApi.svelte`, `stores.svelte`, `platform`, the
 * app store and the transport (`isAndroidTransport`, `statStoredSize`,
 * `readRangedPieces`). The native lane is replaced through
 * `__avatarThumbTestHooks.setNativePreview`; the render step is replaced
 * through `setRenderThumb` except in the rows that name the real renderer.
 * Over-limit sizes are declared numbers; no file body is made.
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

const { readImageMock, platformState, urlForMock, fetchMock, transport, readRangedPiecesMock } = vi.hoisted(() => ({
    readImageMock: vi.fn(async (_loc: string) => undefined as Uint8Array | null | undefined),
    platformState: { node: true },
    urlForMock: vi.fn(async (loc: string) => `http://node.test/api/asset/${loc}?risu-auth=t`),
    fetchMock: vi.fn(),
    transport: { android: true, stat: vi.fn() },
    readRangedPiecesMock: vi.fn(),
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
    Object.defineProperty(mod, 'isNodeServer', { get: () => platformState.node, enumerable: true })
    Object.defineProperty(mod, 'isTauri', { get: () => false, enumerable: true })
    return mod
})

vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => ({ urlFor: urlForMock }),
}))

vi.mock('../storage/tauriByteTransport', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>()
    return { ...actual, isAndroidTransport: () => transport.android, statStoredSize: (key: string) => transport.stat(key), readRangedPieces: readRangedPiecesMock }
})

import { __avatarThumbTestHooks, THUMB_VERSION, getAvatarThumbSrc, planPixelsDraw } from './avatarThumb'
import { ANDROID_WHOLE_READ_URL_LIMIT_BYTES, resetAssetUrlGateForTest } from '../storage/assetUrlGate'

const OVER = ANDROID_WHOLE_READ_URL_LIMIT_BYTES + 1
const HEADER_LIMIT = 65536

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

function stillPng(): Uint8Array {
    const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return concat(sig, pngChunk('IHDR', 13), pngChunk('IDAT', 300 * 1024), pngChunk('IEND', 0))
}

/** A JPEG prefix whose Exif holds only IFD0 with an Orientation: no thumbnail, so the native preview is the only source. */
function orientedJpegPrefix(orientation: number): Uint8Array {
    const tiff = [0x49, 0x49, 0x2A, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]
    const length = 2 + 6 + tiff.length
    const out = new Uint8Array(1024)
    out.set([0xFF, 0xD8, 0xFF, 0xE1, 0, length, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xFF, 0xDB, 0, 4, 0, 1, 0xFF, 0xD9], 0)
    return out
}

const files = new Map<string, Uint8Array>()

function fakeResponse(status: number, headers: Record<string, string>, body: Uint8Array | null) {
    let pos = 0
    return {
        status,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        body: body === null ? null : {
            getReader: () => ({
                read: async () => {
                    if (pos >= body.length) {
                        return { done: true }
                    }
                    const end = Math.min(pos + 16384, body.length)
                    const value = body.slice(pos, end)
                    pos = end
                    return { done: false, value }
                },
                cancel: async () => { pos = body.length },
            }),
        },
    }
}

function serveFilesWithRanges(): void {
    fetchMock.mockImplementation(async (url: string) => {
        const bytes = files.get(url.slice('http://node.test/api/asset/'.length).split('?')[0])
        if (!bytes) {
            return fakeResponse(404, {}, null)
        }
        const end = Math.min(HEADER_LIMIT, bytes.length)
        return fakeResponse(206, { 'content-range': `bytes 0-${end - 1}/${bytes.length}` }, bytes.subarray(0, end))
    })
}

/** The bounded prefix read of an over-limit avatar: the first piece of the file, declared as `total` bytes. */
function servePrefixPieces(prefixes: Map<string, Uint8Array>): void {
    readRangedPiecesMock.mockImplementation(async function* (loc: string) {
        yield { bytes: prefixes.get(loc) ?? stillPng(), offset: 0, total: OVER, identity: 'id' }
    })
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

function nativePixels(width = 280, height = 168): { kind: 'pixels', width: number, height: number, rgba: Uint8ClampedArray } {
    return { kind: 'pixels', width, height, rgba: new Uint8ClampedArray(width * height * 4) }
}

async function flush(turns = 60): Promise<void> {
    for (let i = 0; i < turns; i++) {
        await Promise.resolve()
    }
}

const renderMock = vi.fn()
const nativeMock = vi.fn()
let store: FakeStore

beforeEach(() => {
    __avatarThumbTestHooks.reset()
    resetAssetUrlGateForTest()
    files.clear()
    readImageMock.mockReset()
    readImageMock.mockImplementation(async (loc: string) => files.get(loc))
    fetchMock.mockReset()
    urlForMock.mockClear()
    transport.android = true
    transport.stat.mockReset()
    transport.stat.mockImplementation(async (key: string) => (key.includes('huge') ? OVER : 1000))
    readRangedPiecesMock.mockReset()
    servePrefixPieces(new Map())
    renderMock.mockReset()
    renderMock.mockImplementation(async (source: { kind: string }) => ({ src: `thumb:${source.kind}` }))
    nativeMock.mockReset()
    nativeMock.mockResolvedValue({ kind: 'transient' })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    platformState.node = true
    serveFilesWithRanges()
    store = makeMemoryStore()
    __avatarThumbTestHooks.setStore(store as never)
    __avatarThumbTestHooks.setReadbackCheck(() => true)
    __avatarThumbTestHooks.setRenderThumb(renderMock)
    __avatarThumbTestHooks.setNativePreview(nativeMock)
})

afterEach(() => {
    vi.useRealTimers()
    __avatarThumbTestHooks.reset()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('a task waiting on the native lane gives its general slot back', () => {
    test('guard: with concurrency 2, two native waits that never settle do not delay an ordinary thumbnail, and running never exceeds 2', async () => {
        __avatarThumbTestHooks.setLimits({ concurrency: 2 })
        let maxRunning = 0
        const sample = () => { maxRunning = Math.max(maxRunning, __avatarThumbTestHooks.stats().running) }
        nativeMock.mockImplementation(() => {
            sample()
            return new Promise(() => {})
        })
        renderMock.mockImplementation(async (source: { kind: string }) => {
            sample()
            return { src: `thumb:${source.kind}` }
        })
        files.set('assets/small.png', stillPng())

        void getAvatarThumbSrc('assets/huge1.png')
        void getAvatarThumbSrc('assets/huge2.png')
        await flush()
        const small = await getAvatarThumbSrc('assets/small.png')

        expect(small).toBe('thumb:url')
        expect(nativeMock).toHaveBeenCalledTimes(2)
        expect(maxRunning).toBeLessThanOrEqual(2)
        expect(__avatarThumbTestHooks.stats().running).toBe(0)
    })

    test('guard: the slot is given back once; settled native tasks leave running at 0 and a later batch of three never runs more than 2 at once', async () => {
        __avatarThumbTestHooks.setLimits({ concurrency: 2 })
        const finishers: Array<(outcome: unknown) => void> = []
        nativeMock.mockImplementation(() => new Promise((resolve) => { finishers.push(resolve) }))
        const first = getAvatarThumbSrc('assets/huge1.png')
        const second = getAvatarThumbSrc('assets/huge2.png')
        await flush()
        expect(finishers).toHaveLength(2)
        for (const finish of finishers) {
            finish(nativePixels())
        }
        expect(await first).toBe('thumb:pixels')
        expect(await second).toBe('thumb:pixels')
        expect(__avatarThumbTestHooks.stats().running).toBe(0)

        let active = 0
        let maxActive = 0
        const gates: Array<() => void> = []
        renderMock.mockImplementation((source: { kind: string }) => new Promise((resolve) => {
            active = __avatarThumbTestHooks.stats().running
            maxActive = Math.max(maxActive, active)
            gates.push(() => resolve({ src: `thumb:${source.kind}` }))
        }))
        for (const name of ['a', 'b', 'c']) {
            files.set(`assets/${name}.png`, stillPng())
        }
        const batch = ['a', 'b', 'c'].map((name) => getAvatarThumbSrc(`assets/${name}.png`))
        for (let i = 0; i < 40 && gates.length < 3; i++) {
            await flush()
            gates.splice(0).forEach((open) => open())
        }
        gates.splice(0).forEach((open) => open())
        await Promise.all(batch)

        expect(maxActive).toBeLessThanOrEqual(2)
        expect(__avatarThumbTestHooks.stats().running).toBe(0)
    })

    test('guard: a task that settles by the native answer after its queue timeout would have fired still lands, and running returns to 0', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setLimits({ timeoutMs: 50 })
        let finish: (outcome: unknown) => void = () => {}
        nativeMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))

        const pending = getAvatarThumbSrc('assets/huge1.png')
        await flush()
        await vi.advanceTimersByTimeAsync(500)
        finish(nativePixels())

        expect(await pending).toBe('thumb:pixels')
        expect(__avatarThumbTestHooks.stats().running).toBe(0)
    })
})

describe('a caller that leaves is seen by the native lane', () => {
    test('spec: stillWanted is true while a caller waits and false after the only signal-carrying caller aborted', async () => {
        let wanted: () => boolean = () => true
        nativeMock.mockImplementation((_key: string, options: { stillWanted: () => boolean }) => {
            wanted = options.stillWanted
            return new Promise(() => {})
        })
        const controller = new AbortController()

        const result = getAvatarThumbSrc('assets/huge1.png', { signal: controller.signal })
        await flush()
        expect(wanted()).toBe(true)

        controller.abort()
        await flush()

        expect(wanted()).toBe(false)
        void result
    })

    test('guard: a caller without a signal keeps the task wanted', async () => {
        let wanted: () => boolean = () => false
        nativeMock.mockImplementation((_key: string, options: { stillWanted: () => boolean }) => {
            wanted = options.stillWanted
            return new Promise(() => {})
        })
        const controller = new AbortController()

        void getAvatarThumbSrc('assets/huge1.png')
        void getAvatarThumbSrc('assets/huge1.png', { signal: controller.signal })
        await flush()
        controller.abort()
        await flush()

        expect(wanted()).toBe(true)
    })
})

describe('the real pixel renderer', () => {
    interface Drawn {
        w: number
        h: number
        puts: unknown[][]
        transforms: number[][]
        draws: unknown[][]
    }

    function installFakeCanvas(): { exported: Drawn[], zeroed: number } {
        const exported: Drawn[] = []
        const state = { zeroed: 0 }
        const realCreate = document.createElement.bind(document)
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
            if (tag !== 'canvas') {
                return realCreate(tag)
            }
            const draw: Drawn = { w: 0, h: 0, puts: [], transforms: [], draws: [] }
            const c2d = {
                putImageData: (...a: unknown[]) => { draw.puts.push(a) },
                setTransform: (...m: number[]) => { draw.transforms.push(m) },
                drawImage: (...a: unknown[]) => { draw.draws.push(a) },
            }
            const canvas = {
                get width() { return draw.w },
                set width(v: number) {
                    if (v === 0) state.zeroed++
                    draw.w = v
                },
                get height() { return draw.h },
                set height(v: number) { draw.h = v },
                getContext: () => c2d,
                toDataURL: () => {
                    exported.push({ ...draw, w: draw.w, h: draw.h })
                    return 'data:image/webp;base64,AAAA'
                },
            }
            return canvas as unknown as HTMLElement
        }) as typeof document.createElement)
        class FakeImageData {
            constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
        }
        vi.stubGlobal('ImageData', FakeImageData)
        return { exported, get zeroed() { return state.zeroed } }
    }

    test.each([
        [1, 4, 2, 4, 2, null],
        [6, 4, 2, 2, 4, [0, 1, -1, 0, 2, 0]],
        [8, 4, 2, 2, 4, [0, -1, 1, 0, 0, 4]],
    ])('spec: a JPEG of orientation %i draws its %ix%i native pixels 1:1 into a %ix%i oriented canvas and zeroes both canvases', async (orientation, w, h, canvasW, canvasH, transform) => {
        const canvases = installFakeCanvas()
        __avatarThumbTestHooks.reset()
        __avatarThumbTestHooks.setStore(store as never)
        __avatarThumbTestHooks.setReadbackCheck(() => true)
        __avatarThumbTestHooks.setNativePreview(nativeMock)
        servePrefixPieces(new Map([['assets/huge1.jpg', orientedJpegPrefix(orientation)]]))
        transport.stat.mockResolvedValue(OVER)
        nativeMock.mockResolvedValue(nativePixels(w, h))

        expect(await getAvatarThumbSrc('assets/huge1.jpg')).toBe('data:image/webp;base64,AAAA')

        expect(canvases.exported).toHaveLength(1)
        // One export, from the oriented canvas; its scratch twin held the pixels.
        expect(canvases.exported[0].w).toBe(canvasW)
        expect(canvases.exported[0].h).toBe(canvasH)
        expect(canvases.exported[0].transforms).toEqual(transform === null ? [] : [transform])
        expect(canvases.exported[0].draws).toHaveLength(1)
        expect(canvases.exported[0].draws[0].slice(1)).toEqual([0, 0])
        expect(canvases.zeroed).toBe(2)
        expect(store.setItem).toHaveBeenCalledWith('assets/huge1.jpg', { v: THUMB_VERSION, src: 'data:image/webp;base64,AAAA' })
    })

    test('guard: native pixels whose length does not match their size are not rendered and are retried next session', async () => {
        installFakeCanvas()
        __avatarThumbTestHooks.reset()
        __avatarThumbTestHooks.setStore(store as never)
        __avatarThumbTestHooks.setReadbackCheck(() => true)
        __avatarThumbTestHooks.setNativePreview(nativeMock)
        nativeMock.mockResolvedValue({ kind: 'pixels', width: 4, height: 2, rgba: new Uint8ClampedArray(7) })

        expect(await getAvatarThumbSrc('assets/huge1.png')).toBeNull()

        expect(store.setItem).not.toHaveBeenCalled()
    })
})

describe('planPixelsDraw', () => {
    test('spec: a thumbnail-sized frame draws 1:1; an empty, fractional or over-long frame has no plan', () => {
        expect(planPixelsDraw(280, 168)).toEqual({ sx: 0, sy: 0, sw: 280, sh: 168, dw: 280, dh: 168 })
        expect(planPixelsDraw(2048, 1)).not.toBeNull()
        expect(planPixelsDraw(0, 168)).toBeNull()
        expect(planPixelsDraw(280, 0)).toBeNull()
        expect(planPixelsDraw(2049, 100)).toBeNull()
        expect(planPixelsDraw(100, 2049)).toBeNull()
        expect(planPixelsDraw(10.5, 10)).toBeNull()
        expect(planPixelsDraw(Number.NaN, 10)).toBeNull()
    })
})

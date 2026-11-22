// @vitest-environment happy-dom

/**
 * The real generator of `avatarThumb.ts` on an Android page: an avatar whose
 * stored size is above the whole-read limit gets the native preview by key,
 * before any URL decode or byte read, when its bounded prefix (the first piece
 * of the ranged transport) holds no embedded thumbnail, on every path that
 * would read it (a still prefix and the page-wide URL-decode switch); a prefix that cannot be
 * read gives null with nothing stored (the embedded-thumbnail cases are in
 * `avatarThumbBounded.test.ts`); an avatar
 * whose size cannot be read gets `null` with nothing memoized or stored, so the
 * next request asks again. The stored size is a declared number from the
 * module-boundary stand-in `statStoredSize`; no file body is made. The header
 * and byte reads are those of a Node-hosted page (a range-capable stub), and
 * the render step is replaced as in `avatarThumbGenerate.test.ts`.
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

import { __avatarThumbTestHooks, THUMB_VERSION, getAvatarThumbSrc } from './avatarThumb'
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

/** A synthetic still PNG of a few hundred KiB; its declared stored size is set apart from these bytes. */
function stillPng(): Uint8Array {
    const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return concat(sig, pngChunk('IHDR', 13), pngChunk('IDAT', 300 * 1024), pngChunk('IEND', 0))
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

/** The bounded prefix read of an Android avatar over the limit: the first piece of `bytes`, declared as a file of `total` bytes. */
function servePrefixPiece(bytes: Uint8Array, total: number): void {
    readRangedPiecesMock.mockImplementation(async function* () {
        yield { bytes, offset: 0, total, identity: 'id' }
    })
}

const renderMock = vi.fn()
/** The native preview lane: a transient answer unless a row arranges another. */
const nativeMock = vi.fn()

function nativePixels(width = 280, height = 168): { kind: 'pixels', width: number, height: number, rgba: Uint8ClampedArray } {
    return { kind: 'pixels', width, height, rgba: new Uint8ClampedArray(width * height * 4) }
}

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
    readRangedPiecesMock.mockReset()
    renderMock.mockReset()
    renderMock.mockImplementation(async (source: { kind: string }) => ({ src: `thumb:${source.kind}` }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    platformState.node = true
    serveFilesWithRanges()
    store = makeMemoryStore()
    __avatarThumbTestHooks.setStore(store as never)
    __avatarThumbTestHooks.setReadbackCheck(() => true)
    __avatarThumbTestHooks.setRenderThumb(renderMock)
    nativeMock.mockReset()
    nativeMock.mockResolvedValue({ kind: 'transient' })
    // Optional: on the code before the native preview the hook does not exist, and a reproducer must fail on its assertions, not on setup.
    __avatarThumbTestHooks.setNativePreview?.(nativeMock)
})

afterEach(() => {
    vi.useRealTimers()
    __avatarThumbTestHooks.reset()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('an avatar over the whole-read limit on Android', () => {
    test('reproducer: a still header with a size over the limit gets the native preview by key, with no URL decode and no byte read', async () => {
        files.set('assets/huge.png', stillPng())
        transport.stat.mockResolvedValue(OVER)
        servePrefixPiece(stillPng(), OVER)
        nativeMock.mockResolvedValue(nativePixels())

        expect(await getAvatarThumbSrc('assets/huge.png')).toBe('thumb:pixels')

        expect(nativeMock).toHaveBeenCalledWith('assets/huge.png', expect.objectContaining({ shortSide: 168 }))
        expect(renderMock.mock.calls.map((call) => (call[0] as { kind: string }).kind)).toEqual(['pixels'])
        expect(urlForMock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith('assets/huge.png', { v: THUMB_VERSION, src: 'thumb:pixels' })
    })

    test('guard: a native refusal of an avatar over the limit is a persisted skip with no render and no byte read', async () => {
        files.set('assets/huge.png', stillPng())
        transport.stat.mockResolvedValue(OVER)
        servePrefixPiece(stillPng(), OVER)
        nativeMock.mockResolvedValue({ kind: 'refused', status: 2 })

        expect(await getAvatarThumbSrc('assets/huge.png')).toBeNull()

        expect(renderMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith('assets/huge.png', { v: THUMB_VERSION, skip: true })
    })

    test('reproducer: with the page-wide URL decode switched off, an avatar over the limit still gets the native preview and is not read whole', async () => {
        renderMock.mockImplementation(async (source: { kind: string }) => {
            if (source.kind === 'url') {
                throw new Error('the image failed to load')
            }
            return { src: source.kind === 'pixels' ? 'thumb:pixels' : 'thumb:bytes' }
        })
        files.set('assets/first.png', stillPng())
        files.set('assets/huge.png', stillPng())
        transport.stat.mockImplementation(async (key: string) => (key === 'assets/huge.png' ? OVER : 1000))
        servePrefixPiece(stillPng(), OVER)
        nativeMock.mockResolvedValue(nativePixels())

        expect(await getAvatarThumbSrc('assets/first.png')).toBe('thumb:bytes')
        readImageMock.mockClear()
        renderMock.mockClear()

        expect(await getAvatarThumbSrc('assets/huge.png')).toBe('thumb:pixels')

        expect(nativeMock).toHaveBeenCalledWith('assets/huge.png', expect.anything())
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderMock.mock.calls.map((call) => (call[0] as { kind: string }).kind)).toEqual(['pixels'])
        expect(store.setItem).toHaveBeenCalledWith('assets/huge.png', { v: THUMB_VERSION, src: 'thumb:pixels' })
    })

    test('reproducer: a prefix that cannot be read does not fall back to a whole read of an avatar over the limit, and stores nothing', async () => {
        readRangedPiecesMock.mockImplementation(async function* () {
            throw new Error('the range read failed')
        })
        files.set('assets/huge.png', stillPng())
        transport.stat.mockResolvedValue(OVER)

        expect(await getAvatarThumbSrc('assets/huge.png')).toBeNull()

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
        expect(store.setItem).not.toHaveBeenCalled()
    })
})

describe('an avatar whose size cannot be read', () => {
    test('reproducer: the result is null, nothing is stored, and the next request probes the size again', async () => {
        files.set('assets/a.png', stillPng())
        transport.stat.mockRejectedValue(new Error('failed to open (os error 2)'))

        expect(await getAvatarThumbSrc('assets/a.png')).toBeNull()
        expect(await getAvatarThumbSrc('assets/a.png')).toBeNull()

        expect(transport.stat).toHaveBeenCalledTimes(2)
        expect(store.setItem).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
    })
})

describe('a task that times out while its size is being read', () => {
    test('reproducer: the verdict that arrives afterwards starts no header read, URL decode or byte read', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setLimits({ timeoutMs: 50 })
        files.set('assets/slow.png', stillPng())
        let answerSize: ((size: number) => void) | undefined
        transport.stat.mockImplementation(() => new Promise<number>((resolve) => { answerSize = resolve }))

        const promise = getAvatarThumbSrc('assets/slow.png')
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(50)
        expect(await promise).toBeNull()

        answerSize?.(1000)
        await vi.advanceTimersByTimeAsync(0)

        expect(urlForMock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
        expect(store.setItem).not.toHaveBeenCalled()
    })
})

describe('an avatar within the limit, or off Android', () => {
    test('guard: a size at the limit gets its thumbnail decoded from the URL', async () => {
        files.set('assets/edge.png', stillPng())
        transport.stat.mockResolvedValue(ANDROID_WHOLE_READ_URL_LIMIT_BYTES)

        expect(await getAvatarThumbSrc('assets/edge.png')).toBe('thumb:url')
        expect(readImageMock).not.toHaveBeenCalled()
    })

    test('guard: off Android no size is probed and the thumbnail is made as before', async () => {
        transport.android = false
        files.set('assets/a.png', stillPng())
        transport.stat.mockResolvedValue(OVER)

        expect(await getAvatarThumbSrc('assets/a.png')).toBe('thumb:url')
        expect(transport.stat).not.toHaveBeenCalled()
    })
})

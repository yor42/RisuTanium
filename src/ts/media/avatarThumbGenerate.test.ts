// @vitest-environment happy-dom

/**
 * The real generator of `avatarThumb.ts` on each platform: what it reads, what
 * it classifies from, and which source the render step receives.
 *
 * Reproducers (fail against a generator that reads every avatar whole): the
 * animated and still cases on a Node-hosted page and on Tauri, the JPEG with
 * trailing bytes on the pure web build and after a URL failure, the
 * cancellation case, and the Tauri empty-file case.
 *
 * Guards (hold before and after the change; titles start with "guard:"): the
 * undecided APNG that is read whole and stays animated, a store without
 * `urlFor`, a 416 for an empty file, a short Tauri piece, a non-ranged Tauri
 * transport, and a URL failure followed by a decoded whole read turning the
 * URL decode off.
 *
 * Specifications of the switch-off rule (new behaviour; fail before the
 * change): a URL failure followed by a null whole read, by an animated whole
 * read, by a failure on both paths, or by a null byte render does not turn the
 * URL decode off.
 *
 * The render step (load, draw, export) is replaced through
 * `__avatarThumbTestHooks.setRenderThumb`, because happy-dom has no 2d canvas;
 * the tests assert which source it was handed. Every byte is synthetic.
 *
 * MOCKED: `localforage`, `globalApi.svelte` (`readImage` is `readImageMock`),
 * `stores.svelte`, `platform` (the two flags are live getters), the app store
 * (`urlFor`), and the Tauri transport's `readRangedPieces`/`transportKind`.
 * `fetch` is stubbed per test.
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

const { readImageMock, platformState, storeState, urlForMock, fetchMock, readRangedPiecesMock, transportKindMock } = vi.hoisted(() => ({
    readImageMock: vi.fn(async (_loc: string) => undefined as Uint8Array | null | undefined),
    platformState: { node: false, tauri: false },
    storeState: { hasUrlFor: true },
    urlForMock: vi.fn(async (loc: string) => `http://node.test/api/asset/${loc}?risu-auth=t`),
    fetchMock: vi.fn(),
    readRangedPiecesMock: vi.fn(),
    transportKindMock: vi.fn(() => 'desktop' as 'android' | 'desktop' | 'other'),
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
    Object.defineProperty(mod, 'isTauri', { get: () => platformState.tauri, enumerable: true })
    return mod
})

vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => (storeState.hasUrlFor ? { urlFor: urlForMock } : {}),
}))

vi.mock('../storage/tauriByteTransport', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>()
    return { ...actual, readRangedPieces: readRangedPiecesMock, transportKind: transportKindMock }
})

import { __avatarThumbTestHooks, THUMB_VERSION, getAvatarThumbSrc } from './avatarThumb'

//#region synthetic fixtures

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

const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngChunk(type: string, dataLen: number): Uint8Array {
    return concat(u32be(dataLen), ascii(type), new Uint8Array(dataLen), new Uint8Array(4))
}

function stillPng(idatLen: number): Uint8Array {
    return concat(PNG_SIG, pngChunk('IHDR', 13), pngChunk('IDAT', idatLen), pngChunk('IEND', 0))
}

function earlyApng(idatLen: number): Uint8Array {
    return concat(PNG_SIG, pngChunk('IHDR', 13), pngChunk('acTL', 8), pngChunk('IDAT', idatLen), pngChunk('IEND', 0))
}

function lateApng(): Uint8Array {
    return concat(PNG_SIG, pngChunk('IHDR', 13), pngChunk('tEXt', 100 * 1024), pngChunk('acTL', 8), pngChunk('IDAT', 64), pngChunk('IEND', 0))
}

function gif(totalLen: number): Uint8Array {
    return concat(ascii('GIF89a'), new Uint8Array(totalLen - 6))
}

function animatedWebp(totalLen: number): Uint8Array {
    const body = concat(ascii('VP8X'), u32be(10), Uint8Array.from([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array(totalLen - 30))
    return concat(ascii('RIFF'), u32be(4 + body.length), ascii('WEBP'), body)
}

function jpeg(totalLen: number, trailing = 0): Uint8Array {
    const head = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Array.from(ascii('JFIF')), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
    return concat(head, new Uint8Array(totalLen - head.length - 2), Uint8Array.from([0xff, 0xd9]), new Uint8Array(trailing))
}

//#endregion

//#region fakes

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
        setItem: vi.fn(async (key: string, value: unknown) => {
            map.set(key, value)
        }),
        removeItem: vi.fn(async (key: string) => {
            map.delete(key)
        }),
        iterate: vi.fn(async () => {}),
    }
}

/** What the stub server holds, by loc. */
const files = new Map<string, Uint8Array>()

interface FakeResponse {
    status: number
    headers: { get(name: string): string | null }
    body: { getReader(): { read(): Promise<{ done: boolean, value?: Uint8Array }>, cancel(): Promise<void> } } | null
}

function fakeResponse(status: number, headers: Record<string, string>, body: Uint8Array | null, chunkSize = 16384): FakeResponse {
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
                    const end = Math.min(pos + chunkSize, body.length)
                    const value = body.slice(pos, end)
                    pos = end
                    return { done: false, value }
                },
                cancel: async () => {
                    pos = body.length
                },
            }),
        },
    }
}

function locOfUrl(url: string): string {
    return url.slice('http://node.test/api/asset/'.length).split('?')[0]
}

/** A range-capable stub of the asset route: a request for the first 64 KiB
 *  answers 206 with the file's real size; an empty file answers 416. */
function serveFilesWithRanges(): void {
    fetchMock.mockImplementation(async (url: string) => {
        const bytes = files.get(locOfUrl(url))
        if (!bytes) {
            return fakeResponse(404, {}, null)
        }
        if (bytes.length === 0) {
            return fakeResponse(416, {}, null)
        }
        const end = Math.min(HEADER_LIMIT, bytes.length)
        return fakeResponse(206, { 'content-range': `bytes 0-${end - 1}/${bytes.length}` }, bytes.subarray(0, end))
    })
}

async function* piecesOf(bytes: Uint8Array, firstPieceBytes: number, closed: { value: boolean }) {
    try {
        const first = bytes.subarray(0, firstPieceBytes)
        yield { bytes: first, offset: 0, total: bytes.length, identity: 'id' }
    } finally {
        closed.value = true
    }
}

const renderMock = vi.fn()

function addFile(loc: string, bytes: Uint8Array): string {
    files.set(loc, bytes)
    return loc
}

function installPlatform(kind: 'web' | 'node' | 'tauri'): void {
    platformState.node = kind === 'node'
    platformState.tauri = kind === 'tauri'
}

function renderedKinds(): string[] {
    return renderMock.mock.calls.map((call) => (call[0] as { kind: string }).kind)
}

async function flush(turns = 20): Promise<void> {
    for (let i = 0; i < turns; i++) {
        await Promise.resolve()
    }
}

//#endregion

let store: FakeStore

beforeEach(() => {
    __avatarThumbTestHooks.reset()
    files.clear()
    readImageMock.mockReset()
    readImageMock.mockImplementation(async (loc: string) => files.get(loc))
    fetchMock.mockReset()
    readRangedPiecesMock.mockReset()
    transportKindMock.mockReset()
    transportKindMock.mockReturnValue('desktop')
    urlForMock.mockClear()
    storeState.hasUrlFor = true
    renderMock.mockReset()
    renderMock.mockImplementation(async (source: { kind: string }) => ({ src: `thumb:${source.kind}` }))
    vi.stubGlobal('fetch', fetchMock)
    installPlatform('web')
    store = makeMemoryStore()
    __avatarThumbTestHooks.setStore(store as never)
    __avatarThumbTestHooks.setReadbackCheck(() => true)
    __avatarThumbTestHooks.setRenderThumb(renderMock)
})

afterEach(() => {
    __avatarThumbTestHooks.reset()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('a Node-hosted page decides animation from the first 64 KiB', () => {
    beforeEach(() => {
        installPlatform('node')
        serveFilesWithRanges()
    })

    test.each([
        ['an animated GIF', () => gif(200 * 1024)],
        ['an animated WebP', () => animatedWebp(200 * 1024)],
        ['an APNG with an early acTL', () => earlyApng(200 * 1024)],
    ])('%s gets a skip record and is never read whole', async (_label, make) => {
        const loc = addFile('assets/a.bin', make())

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, skip: true })
    })

    test.each([
        ['a still PNG', () => stillPng(300 * 1024)],
        ['a JPEG over 64 KiB', () => jpeg(300 * 1024)],
    ])('%s gets a thumbnail decoded from the URL and is never read whole', async (_label, make) => {
        const loc = addFile('assets/a.bin', make())

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:url')

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['url'])
        expect(renderMock.mock.calls[0][0]).toMatchObject({ kind: 'url', url: `http://node.test/api/asset/${loc}?risu-auth=t` })
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, src: 'thumb:url' })
    })

    test('guard: an APNG whose acTL lies past the first 64 KiB is read whole and stays animated', async () => {
        const loc = addFile('assets/late.png', lateApng())

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).toHaveBeenCalledTimes(1)
        expect(renderMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, skip: true })
    })

    test('guard: a store without urlFor reads the avatar whole and decodes it from bytes', async () => {
        storeState.hasUrlFor = false
        const loc = addFile('assets/a.png', stillPng(300 * 1024))

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:bytes')

        expect(fetchMock).not.toHaveBeenCalled()
        expect(readImageMock).toHaveBeenCalledTimes(1)
        expect(renderedKinds()).toEqual(['bytes'])
    })

    test('guard: a failed header read (416 for an empty file) falls back to the whole read, which gives null', async () => {
        const loc = addFile('assets/empty.png', new Uint8Array(0))

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).toHaveBeenCalledTimes(1)
        expect(store.setItem).not.toHaveBeenCalled()
    })
})

describe('a JPEG with bytes after its end marker is a still JPEG on every platform', () => {
    test('pure web: the whole read gets a thumbnail from bytes with the JPEG type', async () => {
        const loc = addFile('assets/trailing.jpg', jpeg(100 * 1024, 16))

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:bytes')

        expect(renderMock).toHaveBeenCalledTimes(1)
        expect(renderMock.mock.calls[0][0]).toMatchObject({ kind: 'bytes', mime: 'image/jpeg' })
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, src: 'thumb:bytes' })
    })

    test('Node: a URL failure falls back to the whole read, gets a thumbnail and turns URL decode off', async () => {
        installPlatform('node')
        serveFilesWithRanges()
        renderMock.mockImplementation(async (source: { kind: string }) => {
            if (source.kind === 'url') {
                throw new Error('the image failed to load')
            }
            return { src: 'thumb:bytes' }
        })
        const first = addFile('assets/trailing.jpg', jpeg(100 * 1024, 16))
        const second = addFile('assets/next.png', stillPng(300 * 1024))

        expect(await getAvatarThumbSrc(first)).toBe('thumb:bytes')
        expect(renderedKinds()).toEqual(['url', 'bytes'])
        expect(renderMock.mock.calls[1][0]).toMatchObject({ kind: 'bytes', mime: 'image/jpeg' })

        fetchMock.mockClear()
        renderMock.mockClear()
        expect(await getAvatarThumbSrc(second)).toBe('thumb:bytes')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['bytes'])
    })
})

describe('the URL decode switch', () => {
    beforeEach(() => {
        installPlatform('node')
        serveFilesWithRanges()
        renderMock.mockImplementation(async (source: { kind: string }) => {
            if (source.kind === 'url') {
                throw new Error('the image failed to load')
            }
            return { src: 'thumb:bytes' }
        })
    })

    async function nextAvatarUsesUrl(): Promise<boolean> {
        renderMock.mockClear()
        renderMock.mockImplementation(async (source: { kind: string }) => ({ src: `thumb:${source.kind}` }))
        const loc = addFile('assets/probe.png', stillPng(300 * 1024))
        await getAvatarThumbSrc(loc)
        return renderedKinds()[0] === 'url'
    }

    test('a URL failure followed by a whole read that returns null does not turn it off', async () => {
        const loc = addFile('assets/a.png', stillPng(300 * 1024))
        readImageMock.mockResolvedValue(null)

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        readImageMock.mockImplementation(async (l: string) => files.get(l))
        expect(await nextAvatarUsesUrl()).toBe(true)
    })

    test('a URL failure followed by a whole read that classifies as animated does not turn it off', async () => {
        const loc = addFile('assets/a.png', stillPng(300 * 1024))
        readImageMock.mockResolvedValue(gif(1024))

        expect(await getAvatarThumbSrc(loc)).toBeNull()
        expect(renderedKinds()).toEqual(['url'])

        readImageMock.mockImplementation(async (l: string) => files.get(l))
        expect(await nextAvatarUsesUrl()).toBe(true)
    })

    test('a URL failure followed by a byte render that resolves null does not turn it off', async () => {
        const loc = addFile('assets/a.png', stillPng(300 * 1024))
        renderMock.mockImplementation(async (source: { kind: string }) => {
            if (source.kind === 'url') {
                throw new Error('the image failed to load')
            }
            return null
        })

        expect(await getAvatarThumbSrc(loc)).toBeNull()
        expect(renderedKinds()).toEqual(['url', 'bytes'])

        expect(await nextAvatarUsesUrl()).toBe(true)
    })

    test('a failure on both paths does not turn it off', async () => {
        const loc = addFile('assets/a.png', stillPng(300 * 1024))
        renderMock.mockImplementation(async () => {
            throw new Error('the image failed to decode')
        })

        expect(await getAvatarThumbSrc(loc)).toBeNull()
        expect(renderedKinds()).toEqual(['url', 'bytes'])

        expect(await nextAvatarUsesUrl()).toBe(true)
    })

    test('guard: a URL failure followed by a whole read that decodes turns it off for later avatars', async () => {
        const loc = addFile('assets/a.png', stillPng(300 * 1024))

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:bytes')

        expect(await nextAvatarUsesUrl()).toBe(false)
    })
})

describe('cancellation', () => {
    test('a task that times out during the header read aborts the request and persists nothing', async () => {
        vi.useFakeTimers()
        installPlatform('node')
        __avatarThumbTestHooks.setLimits({ timeoutMs: 50 })
        let signal: AbortSignal | undefined
        fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
            signal = init.signal
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }))
        readImageMock.mockImplementation(() => new Promise(() => {}))
        const loc = addFile('assets/a.png', stillPng(300 * 1024))

        const promise = getAvatarThumbSrc(loc)
        await flush()
        await vi.advanceTimersByTimeAsync(50)

        expect(await promise).toBeNull()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(signal?.aborted).toBe(true)
        await flush()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
        expect(store.setItem).not.toHaveBeenCalled()
    })

    test('a URL render that rejects after the task timed out starts no whole read and persists nothing', async () => {
        vi.useFakeTimers()
        installPlatform('node')
        serveFilesWithRanges()
        __avatarThumbTestHooks.setLimits({ timeoutMs: 50 })
        let rejectUrl: ((error: Error) => void) | undefined
        renderMock.mockImplementation(() => new Promise((_resolve, reject) => {
            rejectUrl = reject
        }))
        const loc = addFile('assets/a.png', stillPng(300 * 1024))

        const promise = getAvatarThumbSrc(loc)
        await flush(50)
        expect(renderedKinds()).toEqual(['url'])
        await vi.advanceTimersByTimeAsync(50)
        expect(await promise).toBeNull()

        rejectUrl?.(new Error('the image failed to load'))
        await flush(50)

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['url'])
        expect(store.setItem).not.toHaveBeenCalled()
    })
})

describe('Tauri reads one 64 KiB piece and decodes stills from the asset URL', () => {
    beforeEach(() => {
        installPlatform('tauri')
    })

    test('a still PNG gets a thumbnail from the URL after exactly one piece of 65536 bytes, and the piece reader is closed', async () => {
        const closed = { value: false }
        const loc = addFile('assets/a.png', stillPng(300 * 1024))
        readRangedPiecesMock.mockImplementation((_key: string, _pieceBytes: number) => piecesOf(files.get(loc)!, HEADER_LIMIT, closed))

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:url')

        expect(readRangedPiecesMock).toHaveBeenCalledTimes(1)
        expect(readRangedPiecesMock).toHaveBeenCalledWith(loc, HEADER_LIMIT)
        expect(closed.value).toBe(true)
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['url'])
    })

    test('an animated GIF gets a skip record without a whole read', async () => {
        const closed = { value: false }
        const loc = addFile('assets/a.gif', gif(200 * 1024))
        readRangedPiecesMock.mockImplementation(() => piecesOf(files.get(loc)!, HEADER_LIMIT, closed))

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, skip: true })
    })

    test('guard: a first piece shorter than the file and shorter than 64 KiB falls back to the whole read', async () => {
        const closed = { value: false }
        const loc = addFile('assets/a.png', lateApng())
        readRangedPiecesMock.mockImplementation(() => piecesOf(files.get(loc)!, 4096, closed))

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).toHaveBeenCalledTimes(1)
        expect(renderMock).not.toHaveBeenCalled()
    })

    test('an empty file gives null and no record', async () => {
        const closed = { value: false }
        const loc = addFile('assets/empty.png', new Uint8Array(0))
        readRangedPiecesMock.mockImplementation(() => piecesOf(files.get(loc)!, HEADER_LIMIT, closed))

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).not.toHaveBeenCalled()
        expect(store.setItem).not.toHaveBeenCalled()
    })

    test('guard: where the transport is not ranged the whole read is used and the piece reader is never called', async () => {
        transportKindMock.mockReturnValue('other')
        const loc = addFile('assets/a.png', stillPng(300 * 1024))

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:bytes')

        expect(readRangedPiecesMock).not.toHaveBeenCalled()
        expect(readImageMock).toHaveBeenCalledTimes(1)
        expect(renderedKinds()).toEqual(['bytes'])
    })
})

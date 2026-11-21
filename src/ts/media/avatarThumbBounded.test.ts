// @vitest-environment happy-dom

/**
 * The bounded thumbnail path of `avatarThumb.ts`: an avatar above the 64 MiB
 * limit is never read whole into JS where its size can be learned without
 * reading it, and on Android never reaches a URL decode. Its thumbnail comes
 * from the Exif thumbnail inside a prefix read of at most 256 KiB; without one
 * (or when its render fails) Tauri asks the native preview by key, and the
 * other platforms decode once per page load. The native lane is replaced
 * through `__avatarThumbTestHooks.setNativePreview`.
 *
 * The over-limit size is declared, never materialised: a mocked stat, a piece
 * `total` or a `Content-Range` total. Fixtures are built byte by byte in the layout a camera
 * writes (Exif 2.32: JFIF, an Exif APP1 holding IFD0 and IFD1 with a JPEG
 * thumbnail, then the main frame), in both byte orders.
 *
 * Reproducers fail against the generator before the bounded path existed
 * (titles start with "reproducer:"); rows that use the `boundedAboveBytes`
 * limit hook or the new draw plan are specifications of new code ("spec:");
 * "guard:" rows hold before and after.
 *
 * MOCKED: `localforage`, `globalApi.svelte` (`readImage` is `readImageMock`),
 * `stores.svelte`, `platform` (live getters), the app store, and the transport
 * (`readRangedPieces`, `transportKind`, `isAndroidTransport`, `statStoredSize`).
 * The render step is replaced through `__avatarThumbTestHooks.setRenderThumb`,
 * because happy-dom has no 2d canvas.
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

const { readImageMock, platformState, appState, urlForMock, fetchMock, transport, readRangedPiecesMock, transportKindMock } = vi.hoisted(() => ({
    readImageMock: vi.fn(async (_loc: string) => undefined as Uint8Array | null | undefined),
    platformState: { node: false, tauri: false },
    appState: { store: {} as Record<string, unknown> },
    urlForMock: vi.fn(async (loc: string) => `http://node.test/api/asset/${loc}?risu-auth=t`),
    fetchMock: vi.fn(),
    transport: { android: false, stat: vi.fn() },
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
    getAppStore: async () => appState.store,
}))

vi.mock('../storage/tauriByteTransport', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>()
    return {
        ...actual,
        isAndroidTransport: () => transport.android,
        statStoredSize: (key: string) => transport.stat(key),
        readRangedPieces: readRangedPiecesMock,
        transportKind: transportKindMock,
    }
})

import { __avatarThumbTestHooks, THUMB_SHORT_SIDE, THUMB_VERSION, getAvatarThumbSrc, planEmbeddedDraw, sweepAvatarThumbs } from './avatarThumb'
import { ANDROID_WHOLE_READ_URL_LIMIT_BYTES, androidWholeReadQueue, resetAssetUrlGateForTest } from '../storage/assetUrlGate'

const LIMIT = ANDROID_WHOLE_READ_URL_LIMIT_BYTES
const OVER = LIMIT + 1
const SCAN = 262144
const HEADER = 65536

//#region fixtures

type Bytes = number[]

function put16(v: number, le: boolean): Bytes {
    return le ? [v & 255, (v >>> 8) & 255] : [(v >>> 8) & 255, v & 255]
}

function put32(v: number, le: boolean): Bytes {
    const be = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
    return le ? be.reverse() : be
}

function seg(marker: number, payload: Bytes): Bytes {
    return [0xFF, marker, ...put16(payload.length + 2, false), ...payload]
}

function entry(tag: number, type: number, value: number, le: boolean): Bytes {
    return [...put16(tag, le), ...put16(type, le), ...put32(1, le),
        ...(type === 3 ? [...put16(value, le), 0, 0] : put32(value, le))]
}

interface ExifOpts {
    le?: boolean
    orientation?: number
    thumb?: { w: number, h: number }
    /** The main frame size; undefined gives 6000x4000, null leaves the frame header out. */
    main?: { w: number, h: number } | null
    /** Exif PixelXDimension and PixelYDimension. */
    pixelDims?: { w: number, h: number }
    /** The thumbnail carries an APP1 segment of its own. */
    thumbApp1?: boolean
    padTo?: number
}

function thumbJpeg(w: number, h: number, withApp1: boolean): Bytes {
    const out: Bytes = [0xFF, 0xD8]
    if (withApp1) out.push(...seg(0xE1, [0x61, 0x62, 0x63, 0x64, 0x65, 0x66]))
    out.push(...seg(0xDB, [0x00, 0x01]))
    out.push(...seg(0xC0, [8, ...put16(h, false), ...put16(w, false), 1, 1, 0x11, 0]))
    out.push(...seg(0xDA, [1, 1, 0, 0, 0x3F, 0]))
    for (let i = 0; i < 40; i++) out.push(0x11)
    out.push(0xFF, 0xD9)
    return out
}

/** A camera-style JPEG: JFIF, Exif (IFD0, optional Exif sub-IFD, IFD1 with a JPEG thumbnail), the main frame header, scan data, then zero padding. */
function exifJpeg(o: ExifOpts = {}): Uint8Array {
    const le = o.le ?? true
    const t = o.thumb ?? { w: 160, h: 120 }
    const thumb = thumbJpeg(t.w, t.h, o.thumbApp1 === true)
    const orientation = o.orientation ?? 6
    const dims = o.pixelDims ?? null
    const ifd0Entries = 1 + (dims ? 1 : 0)
    const subOff = 8 + 2 + 12 * ifd0Entries + 4
    const ifd1Off = subOff + (dims ? 2 + 24 + 4 : 0)
    const dataOff = ifd1Off + 2 + 36 + 4
    const tiff: Bytes = [...(le ? [0x49, 0x49] : [0x4D, 0x4D]), ...put16(42, le), ...put32(8, le)]
    tiff.push(...put16(ifd0Entries, le), ...entry(0x0112, 3, orientation, le))
    if (dims) tiff.push(...entry(0x8769, 4, subOff, le))
    tiff.push(...put32(ifd1Off, le))
    if (dims) tiff.push(...put16(2, le), ...entry(0xA002, 3, dims.w, le), ...entry(0xA003, 3, dims.h, le), ...put32(0, le))
    tiff.push(...put16(3, le), ...entry(0x0103, 3, 6, le), ...entry(0x0201, 4, dataOff, le), ...entry(0x0202, 4, thumb.length, le), ...put32(0, le))
    tiff.push(...thumb)

    const out: Bytes = [0xFF, 0xD8]
    out.push(...seg(0xE0, [0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))
    out.push(...seg(0xE1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]))
    out.push(...seg(0xDB, [0, 1, 2, 3]))
    const main = o.main === undefined ? { w: 6000, h: 4000 } : o.main
    if (main !== null) out.push(...seg(0xC0, [8, ...put16(main.h, false), ...put16(main.w, false), 1, 1, 0x11, 0]))
    out.push(...seg(0xDA, [1, 1, 0, 0, 0x3F, 0]))
    for (let i = 0; i < 20; i++) out.push(0x22)
    out.push(0xFF, 0xD9)
    const padded = new Uint8Array(Math.max(out.length, o.padTo ?? 300 * 1024))
    padded.set(out, 0)
    return padded
}

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

function stillPng(idatLen = 300 * 1024): Uint8Array {
    return concat(PNG_SIG, pngChunk('IHDR', 13), pngChunk('IDAT', idatLen), pngChunk('IEND', 0))
}

/** A PNG with 300 KiB of text before IDAT: its first 256 KiB cannot tell whether it is animated. */
function textHeavyPng(): Uint8Array {
    return concat(PNG_SIG, pngChunk('IHDR', 13), pngChunk('tEXt', 300 * 1024), pngChunk('IDAT', 64), pngChunk('IEND', 0))
}

function gif(totalLen: number): Uint8Array {
    return concat(ascii('GIF89a'), new Uint8Array(totalLen - 6))
}

//#endregion

//#region fakes

interface FakeStore {
    getItem: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
    iterate: ReturnType<typeof vi.fn>
}

function makeMemoryStore(seed: Record<string, unknown> = {}): FakeStore {
    const map = new Map<string, unknown>(Object.entries(seed))
    return {
        getItem: vi.fn(async (key: string) => map.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: unknown) => { map.set(key, value) }),
        removeItem: vi.fn(async (key: string) => { map.delete(key) }),
        iterate: vi.fn(async () => {}),
    }
}

/** What the stand-in server or disk holds, by loc, and the size it declares for it (default: the byte length). */
const files = new Map<string, Uint8Array>()
const declared = new Map<string, number>()

function addFile(loc: string, bytes: Uint8Array, total?: number): string {
    files.set(loc, bytes)
    if (total !== undefined) declared.set(loc, total)
    return loc
}

function totalOf(loc: string): number {
    return declared.get(loc) ?? files.get(loc)?.length ?? 0
}

interface ReaderLog {
    closed: number
    nexts: number
}

/** `readRangedPieces` of the files: the first piece is at most `pieceBytes` long, with the declared total. */
function serveRangedPieces(log: ReaderLog = { closed: 0, nexts: 0 }): ReaderLog {
    readRangedPiecesMock.mockImplementation(async function* (loc: string, pieceBytes: number) {
        try {
            const bytes = files.get(loc)
            if (!bytes) {
                throw new Error('failed to open (os error 2)')
            }
            log.nexts++
            yield { bytes: bytes.subarray(0, Math.min(pieceBytes, bytes.length)), offset: 0, total: totalOf(loc), identity: 'id' }
        } finally {
            log.closed++
        }
    })
    return log
}

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

/** A Node asset route that honours the requested range end and states the declared total. */
function serveNodeRanges(): void {
    fetchMock.mockImplementation(async (url: string, init: { headers: { Range: string } }) => {
        const loc = url.slice('http://node.test/api/asset/'.length).split('?')[0]
        const bytes = files.get(loc)
        if (!bytes) {
            return fakeResponse(404, {}, null)
        }
        const end = Math.min(Number(/bytes=0-(\d+)/.exec(init.headers.Range)?.[1]) + 1, bytes.length)
        return fakeResponse(206, { 'content-range': `bytes 0-${end - 1}/${totalOf(loc)}` }, bytes.subarray(0, end))
    })
}

function installPlatform(kind: 'android' | 'desktop' | 'node' | 'web'): void {
    platformState.node = kind === 'node'
    platformState.tauri = kind === 'desktop'
    transport.android = kind === 'android'
    appState.store = kind === 'node' || kind === 'desktop' ? { urlFor: urlForMock } : {}
    if (kind === 'android' || kind === 'desktop') {
        serveRangedPieces()
    }
    if (kind === 'node') {
        serveNodeRanges()
    }
}

const renderMock = vi.fn()
/** The native preview lane: a transient answer unless a row arranges another. */
const nativeMock = vi.fn()

function nativePixels(width = 280, height = 168): { kind: 'pixels', width: number, height: number, rgba: Uint8ClampedArray } {
    return { kind: 'pixels', width, height, rgba: new Uint8ClampedArray(width * height * 4) }
}

function renderedKinds(): string[] {
    return renderMock.mock.calls.map((call) => (call[0] as { kind: string }).kind)
}

async function flush(turns = 30): Promise<void> {
    for (let i = 0; i < turns; i++) {
        await Promise.resolve()
    }
}

/** Renders every source as `thumb:<kind>`; the URL decode may be made to fail. */
function renderOk(): void {
    renderMock.mockImplementation(async (source: { kind: string }) => ({ src: `thumb:${source.kind}` }))
}

function renderFailing(kinds: string[]): void {
    renderMock.mockImplementation(async (source: { kind: string }) => {
        if (kinds.includes(source.kind)) {
            throw new Error(`the ${source.kind} image failed to decode`)
        }
        return { src: `thumb:${source.kind}` }
    })
}

//#endregion

let store: FakeStore

beforeEach(() => {
    __avatarThumbTestHooks.reset()
    resetAssetUrlGateForTest()
    files.clear()
    declared.clear()
    readImageMock.mockReset()
    readImageMock.mockImplementation(async (loc: string) => files.get(loc))
    fetchMock.mockReset()
    readRangedPiecesMock.mockReset()
    transportKindMock.mockReset()
    transportKindMock.mockReturnValue('desktop')
    urlForMock.mockClear()
    transport.stat.mockReset()
    transport.stat.mockImplementation(async (loc: string) => totalOf(loc))
    renderMock.mockReset()
    renderOk()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    installPlatform('web')
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

describe('Android: an avatar over the limit gets its embedded thumbnail from one prefix read', () => {
    beforeEach(() => {
        installPlatform('android')
    })

    test('reproducer: a camera JPEG gives the embedded thumbnail, oriented and cropped, from one read of at most 256 KiB', async () => {
        const log = serveRangedPieces()
        const acquire = vi.spyOn(androidWholeReadQueue(), 'acquire')
        const loc = addFile('assets/cam.jpg', exifJpeg({ le: true, orientation: 6 }), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:embedded')

        expect(acquire).not.toHaveBeenCalled()
        expect(readRangedPiecesMock).toHaveBeenCalledTimes(1)
        expect(readRangedPiecesMock).toHaveBeenCalledWith(loc, SCAN)
        expect(log.nexts).toBe(1)
        expect(log.closed).toBe(1)
        expect(urlForMock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['embedded'])
        expect(nativeMock).not.toHaveBeenCalled()
        expect(renderMock.mock.calls[0][0]).toMatchObject({ orientation: 6, crop: { x: 0, y: 7, w: 160, h: 107 } })
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, src: 'thumb:embedded' })
    })

    test('reproducer: a big-endian camera JPEG is read the same way', async () => {
        const loc = addFile('assets/cam.jpg', exifJpeg({ le: false, orientation: 3 }), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:embedded')

        expect(renderMock.mock.calls[0][0]).toMatchObject({ kind: 'embedded', orientation: 3 })
    })

    test('reproducer: the orientation reaches the render and the thumbnail it gets holds no APP1', async () => {
        const loc = addFile('assets/cam.jpg', exifJpeg({ orientation: 8, thumbApp1: true }), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:embedded')

        const source = renderMock.mock.calls[0][0] as { orientation: number, bytes: Uint8Array }
        expect(source.orientation).toBe(8)
        for (let i = 0; i + 1 < source.bytes.length; i++) {
            expect(source.bytes[i] === 0xFF && source.bytes[i + 1] === 0xE1).toBe(false)
        }
    })

    test.each([
        [6, 107, 160, [0, 1, -1, 0, 107, 0]],
        [8, 107, 160, [0, -1, 1, 0, 0, 160]],
        [1, 160, 107, null],
    ])('spec: the real renderer sizes the canvas, applies the transform and draws the crop for orientation %i', async (orientation, canvasW, canvasH, transform) => {
        const draws: { w: number, h: number, setTransform: number[][], drawImage: unknown[][] }[] = []
        class FakeImage {
            naturalWidth = 160
            naturalHeight = 120
            src = ''
            crossOrigin = ''
            async decode(): Promise<void> {}
        }
        const realCreate = document.createElement.bind(document)
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
            if (tag !== 'canvas') {
                return realCreate(tag)
            }
            const draw = { w: 0, h: 0, setTransform: [] as number[][], drawImage: [] as unknown[][] }
            const c2d = {
                imageSmoothingQuality: '',
                setTransform: (...m: number[]) => { draw.setTransform.push(m) },
                drawImage: (...a: unknown[]) => { draw.drawImage.push(a) },
            }
            const canvas = {
                get width() { return draw.w },
                set width(v: number) { draw.w = v },
                get height() { return draw.h },
                set height(v: number) { draw.h = v },
                getContext: () => c2d,
                toDataURL: () => {
                    // The canvas is zeroed after the export, so the sizes are recorded here.
                    draws.push({ w: draw.w, h: draw.h, setTransform: draw.setTransform, drawImage: draw.drawImage })
                    return 'data:image/webp;base64,AAAA'
                },
            }
            return canvas as unknown as HTMLElement
        }) as typeof document.createElement)
        vi.stubGlobal('Image', FakeImage)
        const realCreateObjectUrl = URL.createObjectURL
        const realRevokeObjectUrl = URL.revokeObjectURL
        URL.createObjectURL = () => 'blob:thumb'
        URL.revokeObjectURL = () => {}
        try {
            __avatarThumbTestHooks.reset()
            __avatarThumbTestHooks.setStore(store as never)
            __avatarThumbTestHooks.setReadbackCheck(() => true)
            const loc = addFile('assets/cam.jpg', exifJpeg({ orientation: orientation as number }), OVER)

            expect(await getAvatarThumbSrc(loc)).toBe('data:image/webp;base64,AAAA')
        } finally {
            URL.createObjectURL = realCreateObjectUrl
            URL.revokeObjectURL = realRevokeObjectUrl
        }

        expect(draws).toHaveLength(1)
        expect(draws[0].w).toBe(canvasW)
        expect(draws[0].h).toBe(canvasH)
        expect(draws[0].setTransform).toEqual(transform === null ? [] : [transform])
        expect(draws[0].drawImage).toHaveLength(1)
        expect(draws[0].drawImage[0].slice(1)).toEqual([0, 7, 160, 107, 0, 0, 160, 107])
    })

    test.each([
        ['the main frame header', { main: { w: 6000, h: 4000 } }, { x: 0, y: 7, w: 160, h: 107 }],
        ['the Exif pixel dimensions when the prefix has no main frame header', { main: null, pixelDims: { w: 6000, h: 4000 } }, { x: 0, y: 7, w: 160, h: 107 }],
        ['an equal aspect (no crop)', { main: { w: 640, h: 480 } }, null],
    ])('spec: the crop comes from %s', async (_label, opts, crop) => {
        const loc = addFile('assets/cam.jpg', exifJpeg(opts), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:embedded')

        expect((renderMock.mock.calls[0][0] as { crop: unknown }).crop).toEqual(crop)
    })

    test('reproducer: a prefix read that fails gives null, stores nothing and is asked again by the next request', async () => {
        readRangedPiecesMock.mockImplementation(async function* () {
            throw new Error('the range read failed')
        })
        const loc = addFile('assets/cam.jpg', exifJpeg(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()
        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readRangedPiecesMock).toHaveBeenCalledTimes(2)
        expect(store.setItem).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
    })

    test.each([
        ['rejects', () => renderFailing(['embedded'])],
        ['resolves null', () => renderMock.mockImplementation(async () => null)],
    ])('spec: an embedded render that %s goes on to the native preview; its transient answer gives null, stores nothing and asks again', async (_label, arrange) => {
        arrange()
        const loc = addFile('assets/cam.jpg', exifJpeg(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()
        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(renderedKinds()).toEqual(['embedded', 'embedded'])
        expect(nativeMock).toHaveBeenCalledTimes(2)
        expect(store.setItem).not.toHaveBeenCalled()
        expect(urlForMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
    })

    test('reproducer: a still PNG over the limit gets the native preview by its key, with no URL, no grant, no whole read and no URL render', async () => {
        const acquire = vi.spyOn(androidWholeReadQueue(), 'acquire')
        nativeMock.mockResolvedValue(nativePixels())
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(nativeMock).toHaveBeenCalledTimes(1)
        expect(nativeMock).toHaveBeenCalledWith(loc, { shortSide: THUMB_SHORT_SIDE, stillWanted: expect.any(Function) })
        expect(acquire).not.toHaveBeenCalled()
        expect(urlForMock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['pixels'])
        expect(renderMock.mock.calls[0][0]).toMatchObject({ kind: 'pixels', width: 280, height: 168, orientation: 1 })
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, src: 'thumb:pixels' })
    })

    test('reproducer: a PNG whose first 256 KiB cannot decide animation gets the native preview, never a URL decode', async () => {
        nativeMock.mockResolvedValue(nativePixels())
        const loc = addFile('assets/text.png', textHeavyPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(nativeMock).toHaveBeenCalledWith(loc, expect.anything())
        expect(urlForMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['pixels'])
    })

    test('reproducer: a JPEG without an Exif thumbnail gets the native preview and an upright render', async () => {
        const plain = new Uint8Array(300 * 1024)
        plain.set([0xFF, 0xD8, 0xFF, 0xDB, 0, 4, 0, 1, 0xFF, 0xD9])
        nativeMock.mockResolvedValue(nativePixels())
        const loc = addFile('assets/plain.jpg', plain, OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(renderedKinds()).toEqual(['pixels'])
        expect(renderMock.mock.calls[0][0]).toMatchObject({ orientation: 1 })
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, src: 'thumb:pixels' })
    })

    test('reproducer: the IFD0 orientation of a JPEG without a usable thumbnail reaches the pixel render', async () => {
        // An IFD1 pointer of zero leaves no thumbnail while IFD0 still carries the orientation.
        const noThumb = exifJpeg({ orientation: 6 })
        const bytes = Array.from(noThumb.subarray(0, 64))
        const tiffAt = bytes.findIndex((_, i) => bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 42)
        const ifd0Entries = 1
        const nextPtrAt = tiffAt + 8 + 2 + 12 * ifd0Entries
        noThumb.set([0, 0, 0, 0], nextPtrAt)
        nativeMock.mockResolvedValue(nativePixels())
        const loc = addFile('assets/rot.jpg', noThumb, OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(renderedKinds()).toEqual(['pixels'])
        expect(renderMock.mock.calls[0][0]).toMatchObject({ kind: 'pixels', orientation: 6 })
    })

    test.each([1, 2, 3, 4, 5])('guard: a native refusal with status %i is a persisted skip with no render', async (status) => {
        nativeMock.mockResolvedValue({ kind: 'refused', status })
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(renderMock).not.toHaveBeenCalled()
        expect(urlForMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, skip: true })
    })

    test('guard: a transient native answer is not stored or memoized, and the next request asks again', async () => {
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()
        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(nativeMock).toHaveBeenCalledTimes(2)
        expect(store.setItem).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
    })

    test('guard: an animated GIF over the limit is a persisted skip and never asks the native preview', async () => {
        const loc = addFile('assets/a.gif', gif(300 * 1024), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(nativeMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, skip: true })
    })

    test('reproducer: a skip record of the previous rules version no longer hides the avatar', async () => {
        __avatarThumbTestHooks.setStore((store = makeMemoryStore({ 'assets/cam.jpg': { v: 1, skip: true } })) as never)
        const loc = addFile('assets/cam.jpg', exifJpeg(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:embedded')
    })

    test('reproducer: the literal skip record version 2 wrote no longer hides an over-limit PNG', async () => {
        const loc = 'assets/huge.png'
        __avatarThumbTestHooks.setStore((store = makeMemoryStore({ [loc]: { v: 2, skip: true } })) as never)
        addFile(loc, stillPng(), OVER)
        nativeMock.mockResolvedValue(nativePixels())

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(THUMB_VERSION).toBe(3)
        expect(nativeMock).toHaveBeenCalledTimes(1)
    })

    test('guard: a task that times out during the prefix read stores nothing and asks the reader to close', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setLimits({ timeoutMs: 50 })
        const returned = vi.fn(async () => ({ done: true as const, value: undefined }))
        readRangedPiecesMock.mockImplementation(() => ({
            next: () => new Promise(() => {}),
            return: returned,
            [Symbol.asyncIterator]() { return this },
        }))
        const loc = addFile('assets/cam.jpg', exifJpeg(), OVER)

        const promise = getAvatarThumbSrc(loc)
        await flush()
        await vi.advanceTimersByTimeAsync(50)

        expect(await promise).toBeNull()
        expect(returned).toHaveBeenCalled()
        expect(store.setItem).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
    })
})

describe('desktop: an avatar over the limit is never decoded from its URL when it has an embedded thumbnail', () => {
    beforeEach(() => {
        installPlatform('desktop')
    })

    test('reproducer: a camera JPEG gives the embedded thumbnail with no asset URL and no whole read', async () => {
        const loc = addFile('assets/cam.jpg', exifJpeg({ le: false }), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:embedded')

        expect(urlForMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['embedded'])
        expect(readRangedPiecesMock.mock.calls.map((call) => call[1])).toEqual([HEADER, SCAN])
    })

    test('reproducer: a first piece that cannot be read gives null with no whole read and nothing stored', async () => {
        readRangedPiecesMock.mockImplementation(async function* () {
            throw new Error('the range read failed')
        })
        const loc = addFile('assets/cam.jpg', exifJpeg(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
        expect(store.setItem).not.toHaveBeenCalled()
    })

    test('reproducer: an embedded render that rejects goes on to the native preview, not to a URL decode', async () => {
        renderFailing(['embedded'])
        nativeMock.mockResolvedValue(nativePixels())
        const loc = addFile('assets/cam.jpg', exifJpeg({ orientation: 6 }), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(renderedKinds()).toEqual(['embedded', 'pixels'])
        expect(nativeMock).toHaveBeenCalledWith(loc, { shortSide: THUMB_SHORT_SIDE, stillWanted: expect.any(Function) })
        expect(urlForMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
    })

    test('reproducer: a still PNG goes to the native preview, not to a URL decode, and is never read whole', async () => {
        nativeMock.mockResolvedValue(nativePixels())
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(renderedKinds()).toEqual(['pixels'])
        expect(urlForMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, src: 'thumb:pixels' })
    })

    test('guard: a pixel render that rejects is remembered for this page load only, stores nothing, and the next page load asks the native preview again', async () => {
        renderFailing(['pixels'])
        nativeMock.mockResolvedValue(nativePixels())
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()
        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(nativeMock).toHaveBeenCalledTimes(1)
        expect(store.setItem).not.toHaveBeenCalled()

        // A new page load tries again.
        __avatarThumbTestHooks.reset()
        __avatarThumbTestHooks.setStore(store as never)
        __avatarThumbTestHooks.setReadbackCheck(() => true)
        __avatarThumbTestHooks.setRenderThumb(renderMock)
        __avatarThumbTestHooks.setNativePreview?.(nativeMock)
        expect(await getAvatarThumbSrc(loc)).toBeNull()
        expect(nativeMock).toHaveBeenCalledTimes(2)
    })

    test('guard: a native preview that outlives the queue timeout still lands, because the task no longer holds a slot or a timer', async () => {
        vi.useFakeTimers()
        __avatarThumbTestHooks.setLimits({ timeoutMs: 50 })
        let finish: (outcome: unknown) => void = () => {}
        nativeMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        const pending = getAvatarThumbSrc(loc)
        await flush(60)
        await vi.advanceTimersByTimeAsync(500)
        finish(nativePixels())

        expect(await pending).toBe('thumb:pixels')
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, src: 'thumb:pixels' })
        expect(__avatarThumbTestHooks.stats().running).toBe(0)
    })

    test('reproducer: a PNG whose first 256 KiB cannot decide animation goes to the native preview and no whole read', async () => {
        nativeMock.mockResolvedValue(nativePixels())
        const loc = addFile('assets/text.png', textHeavyPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['pixels'])
    })

    test('guard: an animated GIF over the limit is a persisted skip', async () => {
        const loc = addFile('assets/a.gif', gif(300 * 1024), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(renderMock).not.toHaveBeenCalled()
        expect(readImageMock).not.toHaveBeenCalled()
        expect(store.setItem).toHaveBeenCalledWith(loc, { v: THUMB_VERSION, skip: true })
    })

    test('guard: a camera JPEG at exactly the limit keeps the URL decode and reads one 64 KiB piece', async () => {
        const loc = addFile('assets/cam.jpg', exifJpeg(), LIMIT)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:url')

        expect(readRangedPiecesMock).toHaveBeenCalledTimes(1)
        expect(readRangedPiecesMock).toHaveBeenCalledWith(loc, HEADER)
        expect(renderedKinds()).toEqual(['url'])
        expect(nativeMock).not.toHaveBeenCalled()
    })

    test('reproducer: with the URL decode switched off, an avatar over the limit still gets the native preview (not a URL decode) and no whole read', async () => {
        renderFailing(['url'])
        nativeMock.mockResolvedValue(nativePixels())
        const first = addFile('assets/first.png', stillPng(), 100 * 1024)
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        expect(await getAvatarThumbSrc(first)).toBe('thumb:bytes')
        readImageMock.mockClear()
        renderMock.mockClear()

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:pixels')

        expect(nativeMock).toHaveBeenCalledWith(loc, expect.anything())
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['pixels'])
    })
})

describe('Node-hosted page: a ranged GET of at most 256 KiB', () => {
    beforeEach(() => {
        installPlatform('node')
    })

    test('reproducer: a camera JPEG gives the embedded thumbnail and no GET asks for more than 256 KiB', async () => {
        const loc = addFile('assets/cam.jpg', exifJpeg(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:embedded')

        const ranges = fetchMock.mock.calls.map((call) => (call[1] as { headers: { Range: string } }).headers.Range)
        expect(ranges).toContain(`bytes=0-${SCAN - 1}`)
        for (const range of ranges) {
            expect(Number(/bytes=0-(\d+)/.exec(range)?.[1])).toBeLessThanOrEqual(SCAN - 1)
        }
        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['embedded'])
    })

    test('reproducer: a still PNG whose URL decode rejects is never read whole', async () => {
        renderFailing(['url'])
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['url'])
        expect(store.setItem).not.toHaveBeenCalled()
        expect(nativeMock).not.toHaveBeenCalled()
    })

    test('reproducer: a PNG whose first 256 KiB cannot decide animation gets one URL decode and no whole read', async () => {
        const loc = addFile('assets/text.png', textHeavyPng(), OVER)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:url')

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderedKinds()).toEqual(['url'])
        expect(nativeMock).not.toHaveBeenCalled()
    })

    test('guard: a camera JPEG at exactly the limit keeps the URL decode and makes one GET', async () => {
        const loc = addFile('assets/cam.jpg', exifJpeg(), LIMIT)

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:url')

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(renderedKinds()).toEqual(['url'])
        expect(nativeMock).not.toHaveBeenCalled()
    })

    test('reproducer: with the URL decode switched off, an avatar over the limit gets no URL decode and no whole read', async () => {
        renderFailing(['url'])
        const first = addFile('assets/first.png', stillPng(), 100 * 1024)
        const loc = addFile('assets/huge.png', stillPng(), OVER)

        expect(await getAvatarThumbSrc(first)).toBe('thumb:bytes')
        readImageMock.mockClear()
        renderMock.mockClear()

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
        expect(store.setItem).not.toHaveBeenCalledWith(loc, expect.anything())
    })

    test('spec: a 200 without a Content-Length gives null with no whole read and nothing stored', async () => {
        fetchMock.mockImplementation(async () => fakeResponse(200, {}, stillPng()))
        const loc = addFile('assets/a.png', stillPng())

        expect(await getAvatarThumbSrc(loc)).toBeNull()

        expect(readImageMock).not.toHaveBeenCalled()
        expect(renderMock).not.toHaveBeenCalled()
        expect(store.setItem).not.toHaveBeenCalled()
    })
})

describe('a store with no size source', () => {
    test('guard: a store that offers no size source reads the avatar whole, as before', async () => {
        appState.store = {}
        const loc = addFile('assets/a.png', stillPng(100 * 1024))

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:bytes')

        expect(readImageMock).toHaveBeenCalledTimes(1)
    })

    test('guard: an avatar above the limit on a store with no size source is read whole once and then gets the bounded rules', async () => {
        __avatarThumbTestHooks.setLimits({ boundedAboveBytes: SCAN })
        appState.store = {}
        const loc = addFile('assets/cam.jpg', exifJpeg({ padTo: 300 * 1024 }))

        expect(await getAvatarThumbSrc(loc)).toBe('thumb:embedded')

        expect(readImageMock).toHaveBeenCalledTimes(1)
        expect(renderedKinds()).toEqual(['embedded'])
    })
})

describe('the previous-version records', () => {
    test('reproducer: the sweep deletes a record of the previous rules version', async () => {
        const swept = makeMemoryStore()
        swept.iterate.mockImplementation(async (callback: (value: unknown, key: string) => void) => {
            callback({ v: 1, src: 'x' }, 'assets/a.png')
        })
        __avatarThumbTestHooks.setStore(swept as never)

        await sweepAvatarThumbs(new Set(['assets/a.png']))

        expect(swept.removeItem).toHaveBeenCalledWith('assets/a.png')
    })
})

describe('the draw plan of an embedded thumbnail', () => {
    test('spec: the crop is the source rectangle and a small thumbnail is not upscaled', () => {
        expect(planEmbeddedDraw(160, 120, { x: 0, y: 7, w: 160, h: 107 })).toEqual({ sx: 0, sy: 7, sw: 160, sh: 107, dw: 160, dh: 107 })
    })

    test('spec: a larger thumbnail scales to the thumbnail short side and keeps its aspect', () => {
        const plan = planEmbeddedDraw(480, 360, null)
        expect(plan).toEqual({ sx: 0, sy: 0, sw: 480, sh: 360, dw: 224, dh: 168 })
    })

    test('spec: a crop outside the decoded image is clamped into it', () => {
        const plan = planEmbeddedDraw(100, 80, { x: 90, y: 0, w: 50, h: 200 })
        expect(plan).toEqual({ sx: 90, sy: 0, sw: 10, sh: 80, dw: 10, dh: 80 })
    })

    test('spec: the long side is capped as a second guard', () => {
        const plan = planEmbeddedDraw(5000, 200, null)
        expect(Math.max(plan?.dw ?? 0, plan?.dh ?? 0)).toBeLessThanOrEqual(1024)
    })

    test('spec: an unusable decoded size has no plan', () => {
        expect(planEmbeddedDraw(0, 100, null)).toBeNull()
    })
})

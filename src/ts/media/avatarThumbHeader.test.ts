// @vitest-environment node

/**
 * The header readers behind the avatar thumbnails: a ranged GET against the
 * Node server's asset route (the real `server/node/server.cjs`, plus a stubbed
 * `fetch` for the answers a real server does not give) and the first piece of
 * the Tauri ranged transport (mocked: it needs the native command). These are
 * specifications of new code. Every byte is synthetic.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from '../storage/tests/nodeServerFixture'

const { readRangedPiecesMock, transportKindMock } = vi.hoisted(() => ({
    readRangedPiecesMock: vi.fn(),
    transportKindMock: vi.fn(() => 'desktop' as 'android' | 'desktop' | 'other'),
}))

vi.mock('../storage/tauriByteTransport', () => ({
    readRangedPieces: readRangedPiecesMock,
    transportKind: transportKindMock,
}))

import { HEADER_BYTES, readTauriHeader, readTauriPrefix, readUrlHeader, readUrlPrefix } from './avatarThumbHeader'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function bytesOf(length: number): Uint8Array {
    const out = new Uint8Array(length)
    out.set(PNG_SIG, 0)
    for (let i = PNG_SIG.length; i < length; i++) {
        out[i] = i & 0xff
    }
    return out
}

describe('readUrlHeader against the real Node server', () => {
    let fixture: NodeServerFixture

    beforeAll(async () => {
        fixture = await startNodeServer()
    }, 60_000)

    afterAll(async () => {
        await fixture?.stop()
    }, 30_000)

    async function urlOf(key: string, bytes: Uint8Array): Promise<string> {
        await writeFile(join(fixture.saveDir, hexOfKey(key)), bytes)
        const token = await fixture.signToken({ iat: Math.floor(Date.now() / 1000), aud: 'asset-read' })
        return `${fixture.baseUrl}/api/asset/${hexOfKey(key)}?risu-auth=${encodeURIComponent(token)}`
    }

    test('a file over 64 KiB gives its first 64 KiB, not whole', async () => {
        const bytes = bytesOf(200 * 1024)
        const header = await readUrlHeader(await urlOf('assets/big.png', bytes), new AbortController().signal)
        expect(header).not.toBeNull()
        expect(header!.whole).toBe(false)
        expect(header!.bytes.length).toBe(HEADER_BYTES)
        expect(header!.bytes).toEqual(bytes.subarray(0, HEADER_BYTES))
    })

    test('a small file gives every byte, whole', async () => {
        const bytes = bytesOf(5000)
        const header = await readUrlHeader(await urlOf('assets/small.png', bytes), new AbortController().signal)
        expect(header).toEqual({ bytes, whole: true })
    })

    test('a file of exactly 64 KiB is whole', async () => {
        const bytes = bytesOf(HEADER_BYTES)
        const header = await readUrlHeader(await urlOf('assets/exact.png', bytes), new AbortController().signal)
        expect(header?.whole).toBe(true)
        expect(header?.bytes.length).toBe(HEADER_BYTES)
    })

    test('an empty file (the server answers 416) is a failed header read', async () => {
        const header = await readUrlHeader(await urlOf('assets/empty.png', new Uint8Array(0)), new AbortController().signal)
        expect(header).toBeNull()
    })

    test('a missing file is a failed header read', async () => {
        const token = await fixture.signToken({ iat: Math.floor(Date.now() / 1000), aud: 'asset-read' })
        const url = `${fixture.baseUrl}/api/asset/${hexOfKey('assets/never.png')}?risu-auth=${encodeURIComponent(token)}`
        expect(await readUrlHeader(url, new AbortController().signal)).toBeNull()
    })
})

describe('readUrlHeader against a stubbed fetch', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
        fetchMock.mockReset()
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    /** A body that delivers `chunkSize` bytes per read and records a cancel. */
    function streamOf(bytes: Uint8Array, chunkSize: number, holdOpen: boolean): { body: ReadableStream<Uint8Array>, state: { cancelled: boolean } } {
        const state = { cancelled: false }
        let pos = 0
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (pos >= bytes.length) {
                    // A network body stays open until the server is done.
                    if (!holdOpen) {
                        controller.close()
                    }
                    return
                }
                const end = Math.min(pos + chunkSize, bytes.length)
                controller.enqueue(bytes.slice(pos, end))
                pos = end
            },
            cancel() {
                state.cancelled = true
            },
        })
        return { body, state }
    }

    function respondWith(status: number, headers: Record<string, string>, bytes: Uint8Array, chunkSize = 16384, holdOpen = false) {
        const { body, state } = streamOf(bytes, chunkSize, holdOpen)
        fetchMock.mockResolvedValue(new Response(body, { status, headers }))
        return state
    }

    test('asks for the first 64 KiB and passes the abort signal', async () => {
        respondWith(206, { 'content-range': 'bytes 0-99/100' }, bytesOf(100))
        const controller = new AbortController()

        await readUrlHeader('http://node.test/a', controller.signal)

        expect(fetchMock).toHaveBeenCalledWith('http://node.test/a', { headers: { Range: 'bytes=0-65535' }, signal: controller.signal })
    })

    test('a 200 with a large body keeps at most 64 KiB, even from one oversized chunk, and cancels the body', async () => {
        const state = respondWith(200, {}, bytesOf(300 * 1024), 300 * 1024, true)

        const header = await readUrlHeader('http://node.test/a', new AbortController().signal)

        expect(header?.bytes.length).toBe(HEADER_BYTES)
        expect(header?.whole).toBe(false)
        await vi.waitFor(() => expect(state.cancelled).toBe(true))
    })

    test('a 200 whose body ends within 64 KiB is whole when its Content-Length matches', async () => {
        respondWith(200, { 'content-length': '5000' }, bytesOf(5000))
        expect((await readUrlHeader('http://node.test/a', new AbortController().signal))?.whole).toBe(true)
    })

    test('a 200 without a Content-Length that ends within 64 KiB is a failed read', async () => {
        respondWith(200, {}, bytesOf(5000))
        expect(await readUrlHeader('http://node.test/a', new AbortController().signal)).toBeNull()
    })

    test('a 200 whose Content-Length differs from the bytes received is a failed read', async () => {
        respondWith(200, { 'content-length': '9000' }, bytesOf(5000))
        expect(await readUrlHeader('http://node.test/a', new AbortController().signal)).toBeNull()
    })

    test('a 200 of exactly 64 KiB with a matching Content-Length is whole', async () => {
        respondWith(200, { 'content-length': String(HEADER_BYTES) }, bytesOf(HEADER_BYTES))
        expect((await readUrlHeader('http://node.test/a', new AbortController().signal))?.whole).toBe(true)
    })

    test('a 206 over 64 KiB is a non-whole prefix', async () => {
        respondWith(206, { 'content-range': 'bytes 0-65535/200000' }, bytesOf(HEADER_BYTES))
        const header = await readUrlHeader('http://node.test/a', new AbortController().signal)
        expect(header?.whole).toBe(false)
        expect(header?.bytes.length).toBe(HEADER_BYTES)
    })

    test.each([
        ['a missing Content-Range', {}],
        ['an unparseable Content-Range', { 'content-range': 'bytes */200000' }],
        ['a Content-Range with an unknown total', { 'content-range': 'bytes 0-65535/*' }],
        ['a Content-Range that starts past 0', { 'content-range': 'bytes 100-65635/200000' }],
    ])('a 206 with %s is a failed read', async (_label, headers) => {
        respondWith(206, headers, bytesOf(HEADER_BYTES))
        expect(await readUrlHeader('http://node.test/a', new AbortController().signal)).toBeNull()
    })

    test('a 206 whose body is shorter than the range it states is a failed read', async () => {
        respondWith(206, { 'content-range': 'bytes 0-65535/200000' }, bytesOf(1000))
        expect(await readUrlHeader('http://node.test/a', new AbortController().signal)).toBeNull()
    })

    test('a 206 that states a total smaller than the bytes received is a failed read', async () => {
        respondWith(206, { 'content-range': 'bytes 0-99/100' }, bytesOf(HEADER_BYTES))
        expect(await readUrlHeader('http://node.test/a', new AbortController().signal)).toBeNull()
    })

    test.each([404, 416, 500])('a %i answer is a failed read', async (status) => {
        respondWith(status, {}, new Uint8Array(0))
        expect(await readUrlHeader('http://node.test/a', new AbortController().signal)).toBeNull()
    })

    test('a multipart body is a failed read', async () => {
        respondWith(206, { 'content-type': 'multipart/byteranges; boundary=x', 'content-range': 'bytes 0-99/100' }, bytesOf(100))
        expect(await readUrlHeader('http://node.test/a', new AbortController().signal)).toBeNull()
    })

    test('a thrown fetch is a failed read', async () => {
        fetchMock.mockRejectedValue(new TypeError('network down'))
        expect(await readUrlHeader('http://node.test/a', new AbortController().signal)).toBeNull()
    })

    test('an aborted request is a failed read', async () => {
        const controller = new AbortController()
        fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }))
        const pending = readUrlHeader('http://node.test/a', controller.signal)
        controller.abort()
        expect(await pending).toBeNull()
    })
})

describe('readTauriHeader', () => {
    interface FakePiece {
        bytes: Uint8Array
        offset: number
        total: number
        identity: string
    }

    function install(piece: FakePiece | Error): { closed: { value: boolean } } {
        const closed = { value: false }
        readRangedPiecesMock.mockImplementation(async function* () {
            try {
                if (piece instanceof Error) {
                    throw piece
                }
                yield piece
            } finally {
                closed.value = true
            }
        })
        return { closed }
    }

    beforeEach(() => {
        readRangedPiecesMock.mockReset()
        transportKindMock.mockReset()
        transportKindMock.mockReturnValue('desktop')
    })

    test('asks for one piece of 65536 bytes, closes the reader, and a file larger than the piece is not whole', async () => {
        const { closed } = install({ bytes: bytesOf(HEADER_BYTES), offset: 0, total: 300 * 1024, identity: 'id' })

        const header = await readTauriHeader('assets/a.png')

        expect(readRangedPiecesMock).toHaveBeenCalledTimes(1)
        expect(readRangedPiecesMock).toHaveBeenCalledWith('assets/a.png', 65536)
        expect(header?.whole).toBe(false)
        expect(header?.bytes.length).toBe(HEADER_BYTES)
        expect(closed.value).toBe(true)
    })

    test('a piece as long as the file is whole', async () => {
        install({ bytes: bytesOf(5000), offset: 0, total: 5000, identity: 'id' })
        expect((await readTauriHeader('assets/a.png'))?.whole).toBe(true)
    })

    test('an empty file is a whole, empty header', async () => {
        install({ bytes: new Uint8Array(0), offset: 0, total: 0, identity: 'id' })
        expect(await readTauriHeader('assets/a.png')).toEqual({ bytes: new Uint8Array(0), whole: true })
    })

    test('a short piece of a larger file is a failed read', async () => {
        const { closed } = install({ bytes: bytesOf(4096), offset: 0, total: 300 * 1024, identity: 'id' })
        expect(await readTauriHeader('assets/a.png')).toBeNull()
        expect(closed.value).toBe(true)
    })

    test('a piece longer than 64 KiB is cut to 64 KiB', async () => {
        install({ bytes: bytesOf(HEADER_BYTES + 1000), offset: 0, total: 300 * 1024, identity: 'id' })
        expect((await readTauriHeader('assets/a.png'))?.bytes.length).toBe(HEADER_BYTES)
    })

    test('a transport error, including a changed file, is a failed read', async () => {
        install(new Error('the file changed while it was read'))
        expect(await readTauriHeader('assets/a.png')).toBeNull()
    })

    test('where the transport is not ranged nothing is requested', async () => {
        transportKindMock.mockReturnValue('other')
        expect(await readTauriHeader('assets/a.png')).toBeNull()
        expect(readRangedPiecesMock).not.toHaveBeenCalled()
    })
})

describe('readTauriPrefix tells "no read", "failed read" and "piece" apart and reports the size', () => {
    const SCAN = 262144

    function install(piece: { bytes: Uint8Array, offset: number, total: number, identity: string } | Error): { closed: { value: boolean } } {
        const closed = { value: false }
        readRangedPiecesMock.mockImplementation(async function* () {
            try {
                if (piece instanceof Error) {
                    throw piece
                }
                yield piece
            } finally {
                closed.value = true
            }
        })
        return { closed }
    }

    beforeEach(() => {
        readRangedPiecesMock.mockReset()
        transportKindMock.mockReset()
        transportKindMock.mockReturnValue('desktop')
    })

    test('a ranged transport that is not there is "none" and requests nothing', async () => {
        transportKindMock.mockReturnValue('other')
        expect(await readTauriPrefix('assets/a.png')).toEqual({ kind: 'none' })
        expect(readRangedPiecesMock).not.toHaveBeenCalled()
    })

    test('a first-piece error is "failed", not a short piece', async () => {
        install(new Error('failed to open (os error 2)'))
        expect(await readTauriPrefix('assets/a.png')).toEqual({ kind: 'failed' })
    })

    test('a short piece of a larger file has no header but still reports the size, and the reader is closed', async () => {
        const { closed } = install({ bytes: bytesOf(4096), offset: 0, total: 300 * 1024, identity: 'id' })
        expect(await readTauriPrefix('assets/a.png')).toEqual({ kind: 'piece', header: null, total: 300 * 1024 })
        expect(closed.value).toBe(true)
    })

    test('a full piece gives its header and the size, and the byte count asked for is passed through', async () => {
        install({ bytes: bytesOf(SCAN), offset: 0, total: 80 * 1024 * 1024, identity: 'id' })

        const prefix = await readTauriPrefix('assets/a.png', SCAN)

        expect(readRangedPiecesMock).toHaveBeenCalledWith('assets/a.png', SCAN)
        expect(prefix.kind).toBe('piece')
        if (prefix.kind === 'piece') {
            expect(prefix.total).toBe(80 * 1024 * 1024)
            expect(prefix.header?.whole).toBe(false)
            expect(prefix.header?.bytes.length).toBe(SCAN)
        }
    })

    test('the default request is still one piece of 65536 bytes', async () => {
        install({ bytes: bytesOf(HEADER_BYTES), offset: 0, total: 300 * 1024, identity: 'id' })
        await readTauriPrefix('assets/a.png')
        expect(readRangedPiecesMock).toHaveBeenCalledWith('assets/a.png', 65536)
    })
})

describe('readUrlPrefix reports the size the server stated', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
        fetchMock.mockReset()
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function respond(status: number, headers: Record<string, string>, bytes: Uint8Array): void {
        fetchMock.mockResolvedValue(new Response(new Blob([bytes as BlobPart]), { status, headers }))
    }

    test('a 206 gives the Content-Range total', async () => {
        respond(206, { 'content-range': 'bytes 0-65535/90000000' }, bytesOf(HEADER_BYTES))
        const prefix = await readUrlPrefix('http://node.test/a', new AbortController().signal)
        expect(prefix?.total).toBe(90000000)
        expect(prefix?.header.whole).toBe(false)
    })

    test('a 200 gives the Content-Length total, and none gives null', async () => {
        respond(200, { 'content-length': String(HEADER_BYTES) }, bytesOf(HEADER_BYTES))
        expect((await readUrlPrefix('http://node.test/a', new AbortController().signal))?.total).toBe(HEADER_BYTES)

        // A body larger than the cut without a Content-Length: a usable prefix of unknown size.
        respond(200, {}, bytesOf(HEADER_BYTES + 10))
        const open = await readUrlPrefix('http://node.test/a', new AbortController().signal)
        expect(open?.total).toBeNull()
        expect(open?.header.bytes.length).toBe(HEADER_BYTES)
    })

    test('the byte count asked for sets the Range end and the cut', async () => {
        respond(206, { 'content-range': 'bytes 0-262143/90000000' }, bytesOf(262144))
        const header = await readUrlHeader('http://node.test/a', new AbortController().signal, 262144)
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Range: 'bytes=0-262143' } })
        expect(header?.bytes.length).toBe(262144)
        expect(header?.whole).toBe(false)
    })
})

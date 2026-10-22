/**
 * `TauriWriter` and `writeBackupEntry` in `src/ts/exportWriters.ts`, and the PNG chunk writer's end.
 *
 * `@tauri-apps/plugin-fs` is replaced by an in-memory file system that records every `writeFile` call (path, byte
 * count, `append`) and can be told to fail a call. A mocked file system is not evidence of native file behaviour.
 *
 * Labels: (R) marks a test that fails against the export path before this change (a `TauriWriter` that writes every
 * chunk at once with a `close` that does nothing, a chunk writer whose `end` does not await `close`, or a
 * `writeBackupEntry` that issues the four-write layout); (G) is a guard that passes with or without the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PngChunk } from 'src/ts/pngChunk'
import {
    BlobDownloadWriter,
    BACKUP_ENTRY_COALESCE_BYTES,
    TAURI_WRITE_CHUNK_BYTES,
    TauriWriter,
    encodeBackupEntryHeader,
    resetExportWriteStatsForTest,
    setExportWriteClockForTest,
    takeExportWriteStats,
    writeBackupEntry,
    type ByteWriter,
} from 'src/ts/exportWriters'

const fs = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    calls: [] as Array<{ path: string, length: number, append: boolean }>,
    failCall: null as null | ((index: number, append: boolean) => boolean),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async (path: string, data: Uint8Array, options?: { append?: boolean }) => {
        const append = options?.append === true
        const index = fs.calls.length
        fs.calls.push({ path, length: data.byteLength, append })
        if (fs.failCall?.(index, append)) {
            throw new Error('synthetic write failure')
        }
        const previous = append ? fs.files.get(path) ?? new Uint8Array() : new Uint8Array()
        const next = new Uint8Array(previous.byteLength + data.byteLength)
        next.set(previous, 0)
        next.set(data, previous.byteLength)
        fs.files.set(path, next)
    }),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertNormalWait: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))

/**
 * The Android save-dialog path: a fake operating-system plugin and a fake `export_append_b64` command that decodes the
 * text as Rust's strict standard engine would (padding required), truncates on `create` and appends otherwise.
 */
const android = vi.hoisted(() => ({
    os: null as string | null,
    calls: [] as Array<{ command: string, uri: string, text: unknown, create: boolean, last: boolean }>,
    files: new Map<string, Uint8Array>(),
    inFlight: 0,
    maxInFlight: 0,
    failCall: null as null | ((index: number) => boolean),
    replyFor: null as null | ((written: number, last: boolean) => unknown),
    encodeFails: false,
}))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (android.os === null) {
            throw new Error('no operating-system plugin')
        }
        return android.os
    },
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async (command: string, args: { uri: string, data: unknown, create: boolean, last: boolean }) => {
        const index = android.calls.length
        android.calls.push({ command, uri: args.uri, text: args.data, create: args.create, last: args.last })
        android.inFlight += 1
        android.maxInFlight = Math.max(android.maxInFlight, android.inFlight)
        try {
            await Promise.resolve()
            if (command !== 'export_append_b64') {
                throw new Error(`unexpected command ${command}`)
            }
            if (android.failCall?.(index)) {
                throw new Error('synthetic append failure')
            }
            const text = args.data as string
            const decoded = Buffer.from(text, 'base64')
            if (text.length % 4 !== 0 || decoded.toString('base64') !== text) {
                throw new Error('malformed: not strict base64')
            }
            const previous = args.create ? new Uint8Array() : android.files.get(args.uri) ?? new Uint8Array()
            const next = new Uint8Array(previous.byteLength + decoded.byteLength)
            next.set(previous, 0)
            next.set(decoded, previous.byteLength)
            android.files.set(args.uri, next)
            return android.replyFor ? android.replyFor(decoded.byteLength, args.last) : { written: decoded.byteLength, ...(args.last ? { synced: true } : {}) }
        } finally {
            android.inFlight -= 1
        }
    }),
}))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()
    return {
        ...original,
        bytesToBase64: (bytes: Uint8Array) => {
            if (android.encodeFails) {
                throw new Error('synthetic encode failure')
            }
            return original.bytesToBase64(bytes)
        },
    }
})

const PATH = 'synthetic/out.bin'
const URI = 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Frisu-backup.bin'

beforeEach(() => {
    fs.files.clear()
    fs.calls.length = 0
    fs.failCall = null
    android.os = null
    android.calls.length = 0
    android.files.clear()
    android.inFlight = 0
    android.maxInFlight = 0
    android.failCall = null
    android.replyFor = null
    android.encodeFails = false
})

function body(n: number, seed: number): Uint8Array {
    const out = new Uint8Array(n)
    let x = seed
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        out[i] = (x >> 16) & 0xff
    }
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.byteLength
    }
    return out
}

/** Byte equality without the element-wise diff of `toEqual`, which is far too slow for multi-MiB arrays. */
function expectBytes(actual: Uint8Array, expected: Uint8Array) {
    expect(actual.byteLength).toBe(expected.byteLength)
    const same = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)
        .equals(Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength))
    expect(same).toBe(true)
}

/** One entry as the container has always been written: four writes, in this order. */
function legacyEntryWrites(name: string, data: Uint8Array): Uint8Array[] {
    const encoded = new TextEncoder().encode(name)
    return [
        new Uint8Array(new Uint32Array([encoded.byteLength]).buffer),
        encoded,
        new Uint8Array(new Uint32Array([data.byteLength]).buffer),
        data,
    ]
}

function recordingWriter() {
    const writes: Uint8Array[] = []
    const writer: ByteWriter = { write: async (data) => { writes.push(data) } }
    return { writer, writes }
}

describe('writeBackupEntry', () => {
    const SIZES = [0, 1, 4000, BACKUP_ENTRY_COALESCE_BYTES - 1, BACKUP_ENTRY_COALESCE_BYTES, BACKUP_ENTRY_COALESCE_BYTES + 1, TAURI_WRITE_CHUNK_BYTES, TAURI_WRITE_CHUNK_BYTES + 1]

    test.each(SIZES)('(G) lays out the same bytes as the four-write layout for a %i byte body', async (size) => {
        const data = body(size, size + 1)
        const { writer, writes } = recordingWriter()
        await writeBackupEntry(writer, new TextEncoder().encode('assets/entry'), data)
        expectBytes(concat(writes), concat(legacyEntryWrites('assets/entry', data)))
    })

    test('(R) a body under 1 MiB goes out in one write', async () => {
        const { writer, writes } = recordingWriter()
        await writeBackupEntry(writer, new TextEncoder().encode('assets/entry'), body(BACKUP_ENTRY_COALESCE_BYTES - 1, 5))
        expect(writes).toHaveLength(1)
    })

    test('(R) a body of 1 MiB or more goes out after one header write and is not copied', async () => {
        const data = body(BACKUP_ENTRY_COALESCE_BYTES, 6)
        const { writer, writes } = recordingWriter()
        await writeBackupEntry(writer, new TextEncoder().encode('assets/entry'), data)
        expect(writes).toHaveLength(2)
        expect(writes[1]).toBe(data)
        expect(writes[0].byteLength).toBe(4 + 'assets/entry'.length + 4)
    })

    test('(G) a non-ASCII name keeps its UTF-8 bytes', async () => {
        const data = body(10, 7)
        const { writer, writes } = recordingWriter()
        await writeBackupEntry(writer, new TextEncoder().encode('assets/éあ'), data)
        expectBytes(concat(writes), concat(legacyEntryWrites('assets/éあ', data)))
    })
})

describe('encodeBackupEntryHeader', () => {
    test.each(['entry', 'assets/éあ', ''])('(G) the header of %j followed by the body is the entry writeBackupEntry writes', async (name) => {
        const data = body(BACKUP_ENTRY_COALESCE_BYTES + 3, 11)
        const encoded = new TextEncoder().encode(name)
        const { writer, writes } = recordingWriter()
        await writeBackupEntry(writer, encoded, data)

        expectBytes(concat([encodeBackupEntryHeader(encoded, data.byteLength), data]), concat(writes))
    })
})

describe('TauriWriter', () => {
    test('(R) holds small writes until close and then writes them in one call that creates the file', async () => {
        const writer = new TauriWriter(PATH)
        await writer.write(body(10, 1))
        await writer.write(body(20, 2))
        expect(fs.calls).toEqual([])
        await writer.close()
        expect(fs.calls).toEqual([{ path: PATH, length: 30, append: false }])
        expectBytes(fs.files.get(PATH)!, concat([body(10, 1), body(20, 2)]))
    })

    test('(R) flushes the collected bytes when the chunk size is reached, and the first flush is not an append', async () => {
        const writer = new TauriWriter(PATH)
        const half = TAURI_WRITE_CHUNK_BYTES / 2
        await writer.write(body(half, 1))
        expect(fs.calls).toEqual([])
        await writer.write(body(half, 2))
        expect(fs.calls).toEqual([{ path: PATH, length: TAURI_WRITE_CHUNK_BYTES, append: false }])
        await writer.write(body(7, 3))
        await writer.close()
        expect(fs.calls[1]).toEqual({ path: PATH, length: 7, append: true })
        expectBytes(fs.files.get(PATH)!, concat([body(half, 1), body(half, 2), body(7, 3)]))
    })

    test('(R) per-call bound: a body larger than the chunk size goes out right after the collected bytes in calls of at most the chunk size', async () => {
        const writer = new TauriWriter(PATH)
        const big = body(TAURI_WRITE_CHUNK_BYTES + 1, 9)
        await writer.write(body(10, 1))
        await writer.write(big)
        expect(fs.calls).toEqual([
            { path: PATH, length: 10, append: false },
            { path: PATH, length: TAURI_WRITE_CHUNK_BYTES, append: true },
            { path: PATH, length: 1, append: true },
        ])
        await writer.write(body(5, 2))
        await writer.close()
        expectBytes(fs.files.get(PATH)!, concat([body(10, 1), big, body(5, 2)]))
    })

    test('(R) per-call bound: a body of several chunks never makes a call above the chunk size, and the bytes arrive in order', async () => {
        const writer = new TauriWriter(PATH)
        const big = body(TAURI_WRITE_CHUNK_BYTES * 2 + 123, 10)
        await writer.write(big)
        await writer.close()
        expect(fs.calls.map((call) => call.length)).toEqual([TAURI_WRITE_CHUNK_BYTES, TAURI_WRITE_CHUNK_BYTES, 123])
        expect(fs.calls.map((call) => call.append)).toEqual([false, true, true])
        expectBytes(fs.files.get(PATH)!, big)
    })

    test('(R) a body of exactly the chunk size is one call, and one byte more is two', async () => {
        const writer = new TauriWriter(PATH)
        await writer.write(body(TAURI_WRITE_CHUNK_BYTES, 9))
        await writer.close()
        expect(fs.calls.map((call) => call.length)).toEqual([TAURI_WRITE_CHUNK_BYTES])
        fs.calls.length = 0
        const second = new TauriWriter('synthetic/two.bin')
        await second.write(body(TAURI_WRITE_CHUNK_BYTES + 1, 9))
        await second.close()
        expect(fs.calls.map((call) => call.length)).toEqual([TAURI_WRITE_CHUNK_BYTES, 1])
    })

    test('(R) the first call of a body larger than the chunk size creates the file', async () => {
        const writer = new TauriWriter(PATH)
        await writer.write(body(TAURI_WRITE_CHUNK_BYTES + 1, 9))
        expect(fs.calls).toEqual([
            { path: PATH, length: TAURI_WRITE_CHUNK_BYTES, append: false },
            { path: PATH, length: 1, append: true },
        ])
        await writer.close()
        expect(fs.calls).toHaveLength(2)
    })

    test('(G) an export with no bytes does not touch the file system', async () => {
        const writer = new TauriWriter(PATH)
        await writer.close()
        expect(fs.calls).toEqual([])
    })

    test('(R) touchedFile is false while writes are only held, and true once a call that may create the file was made, even when it failed', async () => {
        const held = new TauriWriter(PATH)
        await held.write(body(100, 1))
        expect(held.touchedFile).toBe(false)
        await held.close()
        expect(held.touchedFile).toBe(true)

        const failing = new TauriWriter(PATH)
        fs.failCall = () => true
        await expect(failing.write(body(TAURI_WRITE_CHUNK_BYTES + 1, 2))).rejects.toThrow('synthetic write failure')
        expect(failing.touchedFile).toBe(true)
    })

    test('(R) close rejects when the final flush fails', async () => {
        const writer = new TauriWriter(PATH)
        await writer.write(body(100, 1))
        fs.failCall = () => true
        await expect(writer.close()).rejects.toThrow('synthetic write failure')
    })

    test('(R) a failing append rejects the write that made it, and every later write and close', async () => {
        const writer = new TauriWriter(PATH)
        await writer.write(body(TAURI_WRITE_CHUNK_BYTES + 1, 1))
        fs.failCall = (_index, append) => append
        await writer.write(body(10, 2))
        await expect(writer.write(body(TAURI_WRITE_CHUNK_BYTES + 1, 3))).rejects.toThrow('synthetic write failure')
        await expect(writer.write(body(1, 4))).rejects.toThrow('synthetic write failure')
        await expect(writer.close()).rejects.toThrow('synthetic write failure')
    })

    test('(R) a failing first write of a body larger than the chunk size rejects write', async () => {
        const writer = new TauriWriter(PATH)
        fs.failCall = () => true
        await expect(writer.write(body(TAURI_WRITE_CHUNK_BYTES + 1, 1))).rejects.toThrow('synthetic write failure')
        await expect(writer.close()).rejects.toThrow('synthetic write failure')
    })

    test('(G) the bytes written through writeBackupEntry equal the four-write layout for mixed small, threshold and large bodies', async () => {
        const entries: Array<[string, Uint8Array]> = [
            ['assets/a', body(100, 1)],
            ['assets/b', body(BACKUP_ENTRY_COALESCE_BYTES - 1, 2)],
            ['assets/c', body(BACKUP_ENTRY_COALESCE_BYTES, 3)],
            ['cold/d', body(TAURI_WRITE_CHUNK_BYTES - 5, 4)],
            ['assets/e', body(TAURI_WRITE_CHUNK_BYTES + 1, 5)],
            ['assets/f', body(9 * 1024 * 1024, 6)],
            ['database.risudat', body(3000, 7)],
        ]
        const expected = concat(entries.flatMap(([name, data]) => legacyEntryWrites(name, data)))
        const writer = new TauriWriter(PATH)
        for (const [name, data] of entries) {
            await writeBackupEntry(writer, new TextEncoder().encode(name), data)
        }
        await writer.close()
        expectBytes(fs.files.get(PATH)!, expected)
        expect(fs.calls[0].append).toBe(false)
        expect(fs.calls.slice(1).every((call) => call.append)).toBe(true)
    })
})

describe('BlobDownloadWriter', () => {
    test('(R) holds the export in memory until close, and abort drops what it held without producing a download', async () => {
        const createUrl = vi.fn(() => 'blob:synthetic')
        const revoke = vi.fn()
        vi.spyOn(URL, 'createObjectURL').mockImplementation(createUrl)
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })

        const aborted = new BlobDownloadWriter('out.bin')
        await aborted.write(body(10, 1))
        expect(aborted.heldInMemory).toBe(true)
        await aborted.abort()
        expect(aborted.heldInMemory).toBe(true)
        expect(createUrl).not.toHaveBeenCalled()

        const closed = new BlobDownloadWriter('out.bin')
        await closed.write(body(10, 2))
        await closed.close()
        expect(closed.heldInMemory).toBe(false)
        expect(click).toHaveBeenCalledTimes(1)
        vi.restoreAllMocks()
    })
})

describe('the PNG chunk writer', () => {
    function pngBytes(): Uint8Array {
        const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        const iend = new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
        return concat([signature, iend])
    }

    test('(R) end rejects when closing the writer fails', async () => {
        const writer = {
            write: async () => { },
            close: async () => { throw new Error('synthetic close failure') },
        }
        const chunkWriter = new PngChunk.streamWriter(pngBytes(), writer as never)
        await chunkWriter.init()
        await expect(chunkWriter.end()).rejects.toThrow('synthetic close failure')
    })

    test('(R) end does not resolve before the writer has closed', async () => {
        let finishClose: () => void = () => { }
        const writer = {
            write: async () => { },
            close: () => new Promise<void>((resolve) => { finishClose = resolve }),
        }
        const chunkWriter = new PngChunk.streamWriter(pngBytes(), writer as never)
        await chunkWriter.init()
        let ended = false
        const ending = chunkWriter.end().then(() => { ended = true })
        for (let i = 0; i < 5; i++) {
            await new Promise<void>((resolve) => setImmediate(resolve))
        }
        expect(ended).toBe(false)
        finishClose()
        await ending
        expect(ended).toBe(true)
    })

    test('(R) a PNG written through TauriWriter is one file-system call and the same file as the concatenation of its writes', async () => {
        const recorded: Uint8Array[] = []
        const tauri = new TauriWriter(PATH)
        const tee = {
            write: async (data: Uint8Array) => { recorded.push(data.slice()); await tauri.write(data) },
            close: async () => { await tauri.close() },
        }
        const chunkWriter = new PngChunk.streamWriter(pngBytes(), tee as never)
        await chunkWriter.init()
        await chunkWriter.write('chara', 'synthetic-card-payload')
        await chunkWriter.write('chara-ext-asset_:1', body(5000, 3))
        await chunkWriter.end()
        expectBytes(fs.files.get(PATH)!, concat(recorded))
        expect(fs.calls).toHaveLength(1)
    })
})

// New behaviour of a measurement build (vitest runs as one): the per-call record the export notes report. The clock is
// the test's own, three readings per call (start, `writeFile` returned, promise settled), so every figure is exact.
describe('TauriWriter write timing', () => {
    function ticks(...values: number[]): () => number {
        let at = 0
        return () => values[Math.min(at++, values.length - 1)]
    }

    beforeEach(() => {
        resetExportWriteStatsForTest()
    })

    afterEach(() => {
        setExportWriteClockForTest(null)
        resetExportWriteStatsForTest()
    })

    test('records each file-system call with its bytes, the time until writeFile returned, the rest of the wait, and whether it appended', async () => {
        setExportWriteClockForTest(ticks(0, 2, 9, 10, 11, 15, 20, 26, 27))
        const writer = new TauriWriter(PATH)

        // A body over the chunk size goes out as consecutive calls of at most that size.
        await writer.write(body(2 * TAURI_WRITE_CHUNK_BYTES + TAURI_WRITE_CHUNK_BYTES / 2, 9))

        expect(takeExportWriteStats()).toEqual({
            calls: 3,
            bytes: 2 * TAURI_WRITE_CHUNK_BYTES + TAURI_WRITE_CHUNK_BYTES / 2,
            syncMs: 2 + 1 + 6,
            waitMs: 7 + 4 + 1,
            creates: 1,
            appendCalls: 0,
            encodeMs: 0,
            closeMs: 0,
            appendSynced: undefined,
            records: [
                { bytes: TAURI_WRITE_CHUNK_BYTES, syncMs: 2, waitMs: 7, append: false },
                { bytes: TAURI_WRITE_CHUNK_BYTES, syncMs: 1, waitMs: 4, append: true },
                { bytes: TAURI_WRITE_CHUNK_BYTES / 2, syncMs: 6, waitMs: 1, append: true },
            ],
        })
        expect(takeExportWriteStats()).toEqual({ calls: 0, bytes: 0, syncMs: 0, waitMs: 0, creates: 0, appendCalls: 0, encodeMs: 0, closeMs: 0, appendSynced: undefined, records: [] })
    })

    test('a rejected call is not recorded, its error reaches the caller, and the writer still refuses every later write', async () => {
        setExportWriteClockForTest(ticks(0, 1, 2))
        fs.failCall = () => true
        const writer = new TauriWriter(PATH)

        await expect(writer.write(body(TAURI_WRITE_CHUNK_BYTES + 1, 4))).rejects.toThrow('synthetic write failure')

        expect(takeExportWriteStats()?.calls).toBe(0)
        expect(writer.firstWrite).toBe(true)
        await expect(writer.write(body(1, 5))).rejects.toThrow('synthetic write failure')
        await expect(writer.close()).rejects.toThrow('synthetic write failure')
    })

    // Which of the three readings fails: the call starts, writeFile returns, or the promise settles.
    test.each([0, 1, 2])('a clock that throws on reading %i loses the record and nothing else: the file is the same and the second call appends', async (failing) => {
        let reading = 0
        setExportWriteClockForTest(() => {
            if (reading++ % 3 === failing) {
                throw new Error('the clock failed')
            }
            return reading
        })
        const writer = new TauriWriter(PATH)
        const data = body(TAURI_WRITE_CHUNK_BYTES + 100, 6)

        await writer.write(data)
        expect(writer.firstWrite).toBe(false)
        await writer.close()

        expect(fs.calls.map((call) => call.append)).toEqual([false, true])
        expectBytes(fs.files.get(PATH)!, data)
        expect(() => takeExportWriteStats()).not.toThrow()
    })
})

// The Android save dialog hands the app a `content://` document; its chunks go to `export_append_b64` as base64 text.
// The fake command above is not evidence about the native command or the document provider.
describe('TauriWriter on an Android content:// document', () => {
    function decodedLength(text: unknown): number {
        return Buffer.from(text as string, 'base64').byteLength
    }

    test('(R) sends every chunk to export_append_b64, none to writeFile: at most 4 MiB each, create first, last only at the end, one call in flight', async () => {
        android.os = 'android'
        const writer = new TauriWriter(URI)
        const big = body(TAURI_WRITE_CHUNK_BYTES * 2 + 123, 10)
        await writer.write(big)
        await writer.close()

        expect(fs.calls).toEqual([])
        expect(android.calls.map((call) => call.command)).toEqual(Array(4).fill('export_append_b64'))
        expect(android.calls.every((call) => typeof call.text === 'string' && call.uri === URI)).toBe(true)
        expect(android.calls.map((call) => decodedLength(call.text))).toEqual([TAURI_WRITE_CHUNK_BYTES, TAURI_WRITE_CHUNK_BYTES, 123, 0])
        expect(android.calls.map((call) => call.create)).toEqual([true, false, false, false])
        expect(android.calls.map((call) => call.last)).toEqual([false, false, false, true])
        expect(android.maxInFlight).toBe(1)
        expectBytes(android.files.get(URI)!, big)
    })

    test('(R) a file of exactly several chunks ends with one empty call that carries last', async () => {
        android.os = 'android'
        const writer = new TauriWriter(URI)
        await writer.write(body(TAURI_WRITE_CHUNK_BYTES / 2, 1))
        await writer.write(body(TAURI_WRITE_CHUNK_BYTES / 2, 2))
        await writer.write(body(TAURI_WRITE_CHUNK_BYTES, 3))
        await writer.close()

        expect(android.calls.map((call) => [decodedLength(call.text), call.create, call.last])).toEqual([
            [TAURI_WRITE_CHUNK_BYTES, true, false],
            [TAURI_WRITE_CHUNK_BYTES, false, false],
            [0, false, true],
        ])
    })

    test('(R) a small export is one call that creates the file and is the last', async () => {
        android.os = 'android'
        const writer = new TauriWriter(URI)
        await writer.write(body(10, 1))
        await writer.write(body(20, 2))
        expect(android.calls).toEqual([])
        await writer.close()

        expect(android.calls.map((call) => [decodedLength(call.text), call.create, call.last])).toEqual([[30, true, true]])
        expectBytes(android.files.get(URI)!, concat([body(10, 1), body(20, 2)]))
    })

    test('(G) a writer that never wrote makes no call and has not touched the file', async () => {
        android.os = 'android'
        const writer = new TauriWriter(URI)
        await writer.close()

        expect(android.calls).toEqual([])
        expect(fs.calls).toEqual([])
        expect(writer.touchedFile).toBe(false)
    })

    test('(R) the same writeBackupEntry sequence gives the same file as the writeFile path, for bodies small, at the limit and over a chunk', async () => {
        const entries: Array<[string, Uint8Array]> = [
            ['assets/a', body(100, 1)],
            ['assets/b', body(BACKUP_ENTRY_COALESCE_BYTES, 3)],
            ['cold/d', body(TAURI_WRITE_CHUNK_BYTES - 5, 4)],
            ['assets/e', body(TAURI_WRITE_CHUNK_BYTES + 1, 5)],
            ['assets/f', body(9 * 1024 * 1024, 6)],
            ['database.risudat', body(3000, 7)],
        ]
        const expected = concat(entries.flatMap(([name, data]) => legacyEntryWrites(name, data)))
        const oldWriter = new TauriWriter(PATH)
        android.os = 'android'
        const newWriter = new TauriWriter(URI)
        for (const [name, data] of entries) {
            await writeBackupEntry(oldWriter, new TextEncoder().encode(name), data)
            await writeBackupEntry(newWriter, new TextEncoder().encode(name), data)
        }
        await oldWriter.close()
        await newWriter.close()

        expectBytes(fs.files.get(PATH)!, expected)
        expectBytes(android.files.get(URI)!, expected)
        expect(android.calls.every((call) => decodedLength(call.text) <= TAURI_WRITE_CHUNK_BYTES)).toBe(true)
        expect(android.calls.filter((call) => call.create)).toHaveLength(1)
        expect(android.calls.filter((call) => call.last)).toHaveLength(1)
    })

    test('(G) the Android command is used only for an Android content:// path: a plain path, a file: URI, another platform and an unknown platform keep writeFile', async () => {
        const cases: Array<[string | null, string]> = [
            ['android', PATH],
            ['android', 'file:///data/out.bin'],
            ['windows', URI],
            ['linux', URI],
            [null, URI],
        ]
        for (const [os, path] of cases) {
            fs.calls.length = 0
            android.calls.length = 0
            android.os = os
            const writer = new TauriWriter(path)
            await writer.write(body(100, 1))
            await writer.close()
            expect(android.calls, `${os} ${path}`).toEqual([])
            expect(fs.calls, `${os} ${path}`).toHaveLength(1)
        }
    })

    test('(R) the platform is read once, at construction', async () => {
        android.os = 'android'
        const writer = new TauriWriter(URI)
        android.os = 'windows'
        await writer.write(body(100, 1))
        await writer.close()

        expect(fs.calls).toEqual([])
        expect(android.calls).toHaveLength(1)
    })

    test('(R) a rejected call fails the writer: later write and close reject with the same error, and the file counts as touched', async () => {
        android.os = 'android'
        android.failCall = (index) => index === 1
        const writer = new TauriWriter(URI)
        await writer.write(body(TAURI_WRITE_CHUNK_BYTES, 1))
        await expect(writer.write(body(TAURI_WRITE_CHUNK_BYTES, 2))).rejects.toThrow('synthetic append failure')
        expect(writer.touchedFile).toBe(true)
        await expect(writer.write(body(1, 3))).rejects.toThrow('synthetic append failure')
        await expect(writer.close()).rejects.toThrow('synthetic append failure')
        expect(android.calls).toHaveLength(2)
    })

    test('(R) a rejected closing call rejects close, and a second close rejects with the same error', async () => {
        android.os = 'android'
        android.failCall = () => true
        const writer = new TauriWriter(URI)
        await writer.write(body(100, 1))
        await expect(writer.close()).rejects.toThrow('synthetic append failure')
        await expect(writer.close()).rejects.toThrow('synthetic append failure')
        expect(writer.touchedFile).toBe(true)
    })

    test('(R) a reply that does not state the chunk length fails the writer', async () => {
        android.os = 'android'
        android.replyFor = (written) => ({ written: written - 1 })
        const writer = new TauriWriter(URI)
        await expect(writer.write(body(TAURI_WRITE_CHUNK_BYTES, 1))).rejects.toThrow('reported')
        expect(writer.touchedFile).toBe(true)
        await expect(writer.close()).rejects.toThrow('reported')
    })

    test.each([null, undefined, 'ok', {}])('(R) a reply of %j fails the writer', async (reply) => {
        android.os = 'android'
        android.replyFor = () => reply
        const writer = new TauriWriter(URI)
        await writer.write(body(10, 1))
        await expect(writer.close()).rejects.toThrow('reported')
    })

    test('(R) an encode that throws fails the writer and drops no silent bytes: later write and close reject with that error', async () => {
        android.os = 'android'
        android.encodeFails = true
        const writer = new TauriWriter(URI)
        await expect(writer.write(body(TAURI_WRITE_CHUNK_BYTES + 1, 1))).rejects.toThrow('synthetic encode failure')
        expect(writer.touchedFile).toBe(true)
        await expect(writer.write(body(1, 2))).rejects.toThrow('synthetic encode failure')
        await expect(writer.close()).rejects.toThrow('synthetic encode failure')

        const closing = new TauriWriter(URI)
        await closing.write(body(100, 1))
        await expect(closing.close()).rejects.toThrow('synthetic encode failure')
        await expect(closing.close()).rejects.toThrow('synthetic encode failure')
        expect(android.calls).toEqual([])
    })

    test('(R) a measurement build records the encode time of each command call, and the time of the call close made', async () => {
        android.os = 'android'
        resetExportWriteStatsForTest()
        let reading = 0
        const readings = [0, 1, 4, 5, 9]
        setExportWriteClockForTest(() => readings[Math.min(reading++, readings.length - 1)])
        try {
            const writer = new TauriWriter(URI)
            await writer.write(body(10, 1))
            await writer.close()

            expect(takeExportWriteStats()).toEqual({
                calls: 1,
                bytes: 10,
                syncMs: 5,
                waitMs: 4,
                creates: 1,
                appendCalls: 1,
                encodeMs: 3,
                closeMs: 9,
                appendSynced: true,
                records: [{ bytes: 10, syncMs: 5, waitMs: 4, append: false, encodeMs: 3, closing: true, synced: true }],
            })
        } finally {
            setExportWriteClockForTest(null)
            resetExportWriteStatsForTest()
        }
    })

    test('(new behaviour) a measurement build records the synced of the closing reply, false included, and none for a call that is not the closing one', async () => {
        android.os = 'android'
        android.replyFor = (written, last) => ({ written, synced: last ? false : true })
        resetExportWriteStatsForTest()
        try {
            const writer = new TauriWriter(URI)
            await writer.write(body(TAURI_WRITE_CHUNK_BYTES, 1))
            await writer.write(body(10, 2))
            await writer.close()

            const stats = takeExportWriteStats()
            expect(stats?.appendSynced).toBe(false)
            expect(stats?.records.map((record) => record.synced)).toEqual([undefined, false])
        } finally {
            resetExportWriteStatsForTest()
        }
    })

    test('(new behaviour) the synced of a measurement build is unknown when the closing reply does not state it', async () => {
        android.os = 'android'
        android.replyFor = (written) => ({ written })
        resetExportWriteStatsForTest()
        try {
            const writer = new TauriWriter(URI)
            await writer.write(body(10, 1))
            await writer.close()

            expect(takeExportWriteStats()?.appendSynced).toBeUndefined()
        } finally {
            resetExportWriteStatsForTest()
        }
    })
})

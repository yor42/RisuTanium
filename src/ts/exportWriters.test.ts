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
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PngChunk } from 'src/ts/pngChunk'
import {
    BlobDownloadWriter,
    BACKUP_ENTRY_COALESCE_BYTES,
    TAURI_WRITE_CHUNK_BYTES,
    TauriWriter,
    encodeBackupEntryHeader,
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

const PATH = 'synthetic/out.bin'

beforeEach(() => {
    fs.files.clear()
    fs.calls.length = 0
    fs.failCall = null
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

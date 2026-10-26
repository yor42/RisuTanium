/**
 * `indexBackupEntries` (`src/ts/drive/backupContainer.ts`) over files that
 * deliver fewer bytes than their own size promises.
 *
 * A file that is really cut off has a size that ends with it, so every read it
 * answers is whole and the walk keeps ending at a truncated tail as before. A
 * read inside the file's size that comes back short is a changed or
 * unreadable file (a platform that answers empty above 2^31, a file replaced
 * between reads): the walk must throw `BackupShortReadError` instead of
 * returning a prefix, which `LoadLocalBackup` reports as
 * `backupFileUnreadable` before it writes anything.
 *
 * Fixtures follow the `[u32 nameLength][name][u32 dataLength][data]` framing
 * `writeBackupEntry` produces. Every test is labelled `reproducer` (fails
 * when the throw is reverted) or `guard` (passes before and after).
 */
import { describe, test, expect } from 'vitest'
import {
    BACKUP_NAME_PREFIX_BYTES,
    BackupShortReadError,
    DEFAULT_BACKUP_WALK_WINDOW_BYTES,
    indexBackupEntries,
} from '../backupContainer'

//#region fixtures

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    out.set(u32le(nameBytes.length), 0)
    out.set(nameBytes, 4)
    out.set(u32le(data.length), 4 + nameBytes.length)
    out.set(data, 8 + nameBytes.length)
    return out
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
    }
    return out
}

const LONG_NAME = 'L'.repeat(2000)
const LONG_BODY_BYTES = 5000
const OVERSIZE_BODY_BYTES = 1000
const WINDOWS = [16, 64, 4096, DEFAULT_BACKUP_WALK_WINDOW_BYTES]
const SMALL_WINDOWS = [16, 64]

const FIRST = buildChunk('a.png', new Uint8Array(10).fill(1))
const LONG = buildChunk(LONG_NAME, new Uint8Array(LONG_BODY_BYTES).fill(2))
const DATABASE = buildChunk('database.risudat', new Uint8Array(20).fill(3))
const FILE_BYTES = concatChunks([FIRST, LONG, DATABASE])

const LONG_START = FIRST.length
const LONG_FIELD_START = LONG_START + 4 + LONG_NAME.length
const DATABASE_START = FIRST.length + LONG.length

/** Answers `slice(start, end).arrayBuffer()` with `deliver(start, wanted)` bytes of the real content while `size` stays the full length. */
function fileDelivering(bytes: Uint8Array, deliver: (start: number, wanted: number) => number): Blob {
    return {
        size: bytes.length,
        slice(start: number, end: number) {
            return {
                arrayBuffer: async () => {
                    const wanted = Math.max(0, Math.min(end, bytes.length) - start)
                    const got = Math.max(0, Math.min(wanted, deliver(start, wanted)))
                    return bytes.slice(start, start + got).buffer
                },
            }
        },
    } as unknown as Blob
}

/** A file whose reads come back empty from `cut` on, though its size is the full length. */
function fileLyingAfter(bytes: Uint8Array, cut: number): Blob {
    return fileDelivering(bytes, (start, wanted) => Math.min(wanted, Math.max(0, cut - start)))
}

/** A file that is really only `cut` bytes long: size and reads agree. */
function fileReallyCutAt(bytes: Uint8Array, cut: number): Blob {
    return fileDelivering(bytes.slice(0, cut), (_start, wanted) => wanted)
}

//#endregion

describe.each(WINDOWS)('walk over a file that delivers less than its size (window %i)', (windowBytes) => {
    test('reproducer: a header read that comes back short throws at every cut up to the last entry', async () => {
        for (let cut = 0; cut <= DATABASE_START; cut++) {
            await expect(indexBackupEntries(fileLyingAfter(FILE_BYTES, cut), { windowBytes })).rejects.toBeInstanceOf(BackupShortReadError)
        }
    })

    test('guard: a valid file lists every entry and the long name only when its body is oversized', async () => {
        const plain = await indexBackupEntries(fileDelivering(FILE_BYTES, (_start, wanted) => wanted), { windowBytes })
        expect(plain.entries.map((entry) => entry.headerOffset)).toEqual([0, LONG_START, DATABASE_START])
        expect([...plain.names.values()]).toEqual(['a.png', 'database.risudat'])

        const oversize = await indexBackupEntries(fileDelivering(FILE_BYTES, (_start, wanted) => wanted), { windowBytes, oversizeBodyBytes: OVERSIZE_BODY_BYTES })
        expect(oversize.entries).toHaveLength(3)
        expect(oversize.names.get(LONG_START)).toBe(LONG_NAME.slice(0, BACKUP_NAME_PREFIX_BYTES))
    })

    test('guard: a file genuinely cut off at any byte resolves with the entries that fit and never throws', async () => {
        for (let cut = 0; cut <= FILE_BYTES.length; cut++) {
            const result = await indexBackupEntries(fileReallyCutAt(FILE_BYTES, cut), { windowBytes })
            const fitting = [FIRST.length, FIRST.length + LONG.length, FILE_BYTES.length].filter((end) => end <= cut).length
            expect(result.hasMarker).toBe(false)
            expect(result.entries).toHaveLength(fitting)
        }
    })

    test('guard: a short read that still holds a whole header continues (the last entry, body cut)', async () => {
        // Only the final entry can be shortened without a later header read exposing it.
        const result = await indexBackupEntries(fileLyingAfter(FILE_BYTES, DATABASE_START + 8 + 'database.risudat'.length + 5), { windowBytes })
        expect(result.entries).toHaveLength(3)
    })
})

// A window larger than the 1032-byte header probe already holds the field and the name prefix, so those are reads of their own only in the small windows.
describe.each(SMALL_WINDOWS)('one range of a long-name entry shortened (window %i)', (windowBytes) => {
    test('reproducer: the data-length field read of a long name that comes back short throws', async () => {
        for (const delivered of [0, 2]) {
            const file = fileDelivering(FILE_BYTES, (start, wanted) => (start === LONG_FIELD_START ? delivered : wanted))
            const error = await indexBackupEntries(file, { windowBytes }).then(() => null, (e: unknown) => e)
            expect(error).toBeInstanceOf(BackupShortReadError)
            expect((error as BackupShortReadError).position).toBe(LONG_FIELD_START)
            expect((error as BackupShortReadError).received).toBe(delivered)
        }
    })

    test('reproducer: the oversize name read that comes back short throws (only that range is short)', async () => {
        // A changed-file shape: the header probe and the field read are whole, the later read of the name prefix is not.
        const file = fileDelivering(FILE_BYTES, (start, wanted) => (start === LONG_START + 4 ? 100 : wanted))
        const error = await indexBackupEntries(file, { windowBytes, oversizeBodyBytes: OVERSIZE_BODY_BYTES }).then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(BackupShortReadError)
        expect((error as BackupShortReadError).position).toBe(LONG_START + 4)
        expect((error as BackupShortReadError).requested).toBe(BACKUP_NAME_PREFIX_BYTES)
        expect((error as BackupShortReadError).received).toBe(100)
    })
})

describe('the encryption marker on a short read', () => {
    const MARKER_ENTRY = buildChunk('encryption.risudat', new TextEncoder().encode('{"type":"account"}'))
    const MARKER_BYTES = concatChunks([FIRST, MARKER_ENTRY])
    const MARKER_NAME_END = FIRST.length + 4 + 'encryption.risudat'.length

    test.each([16, DEFAULT_BACKUP_WALK_WINDOW_BYTES])('guard: a short read holding the complete marker name still resolves as the marker (window %i)', async (windowBytes) => {
        for (const cut of [MARKER_NAME_END, MARKER_NAME_END + 2]) {
            const result = await indexBackupEntries(fileLyingAfter(MARKER_BYTES, cut), { windowBytes })
            expect(result.hasMarker).toBe(true)
        }
    })

    test('reproducer: a short read that cuts the marker name itself throws, since the name is not complete', async () => {
        await expect(indexBackupEntries(fileLyingAfter(MARKER_BYTES, MARKER_NAME_END - 3), { windowBytes: DEFAULT_BACKUP_WALK_WINDOW_BYTES }))
            .rejects.toBeInstanceOf(BackupShortReadError)
    })
})

describe('a sparse file larger than 2 GiB whose reads at and above 2^31 come back empty', () => {
    const MiB = 1024 * 1024
    const TWO_GIB = 2 ** 31

    function sparseBackup(readsAboveTwoGiBEmpty: boolean): Blob {
        // Many small entries, three big assets, the database last; only the headers exist as bytes.
        const layout: [string, number][] = []
        for (let i = 0; i < 500; i++) layout.push([`s${i}.png`, 50000])
        layout.push(['asset-300MiB.mp4', 300 * MiB])
        for (let i = 0; i < 300; i++) layout.push([`m${i}.png`, 100000])
        layout.push(['asset-1000MiB.mp4', 1000 * MiB])
        layout.push(['asset-1030MiB.mp4', 1030 * MiB])
        for (let i = 0; i < 217; i++) layout.push([`t${i}.png`, 200000])
        layout.push(['database.risudat', 10103089])
        const headers: { start: number; header: Uint8Array }[] = []
        let position = 0
        for (const [name, dataLength] of layout) {
            const nameBytes = new TextEncoder().encode(name)
            const header = concatChunks([u32le(nameBytes.length), nameBytes, u32le(dataLength)])
            headers.push({ start: position, header })
            position += header.length + dataLength
        }
        const size = position
        return {
            size,
            slice(start: number, end: number) {
                return {
                    arrayBuffer: async () => {
                        if (readsAboveTwoGiBEmpty && start >= TWO_GIB) {
                            return new ArrayBuffer(0)
                        }
                        const to = Math.min(end, size)
                        const out = new Uint8Array(Math.max(0, to - start))
                        for (const { start: headerStart, header } of headers) {
                            const headerEnd = headerStart + header.length
                            if (headerEnd <= start || headerStart >= to) continue
                            const from = Math.max(headerStart, start)
                            const until = Math.min(headerEnd, to)
                            out.set(header.subarray(from - headerStart, until - headerStart), from - start)
                        }
                        return out.buffer
                    },
                }
            },
        } as unknown as Blob
    }

    test('guard: the same file with whole reads lists every entry through the database', async () => {
        const file = sparseBackup(false)
        expect(file.size).toBeGreaterThan(TWO_GIB)
        const result = await indexBackupEntries(file, {})
        expect(result.entries).toHaveLength(500 + 1 + 300 + 2 + 217 + 1)
        expect([...result.names.values()]).toContain('database.risudat')
    })

    test('reproducer: the walk throws at the first header at or above 2^31 instead of returning a prefix', async () => {
        const file = sparseBackup(true)
        const error = await indexBackupEntries(file, {}).then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(BackupShortReadError)
        expect((error as BackupShortReadError).position).toBeGreaterThanOrEqual(TWO_GIB)
        expect((error as BackupShortReadError).received).toBe(0)
        expect((error as BackupShortReadError).totalBytes).toBe(file.size)
    })
})

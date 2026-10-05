// @vitest-environment happy-dom

/**
 * `findEncryptionMarkerEntry` and `parseBackupEntryHeader`
 * (`src/ts/drive/backupContainer.ts`) have no side effects and no imports
 * beyond the platform's own `TextDecoder`/`DataView`, so every fixture here
 * is built directly over the `[u32 nameLength][name][u32 dataLength][data]`
 * framing those two functions read, with no dependency on `LoadLocalBackup`
 * or any of its module mocks.
 *
 * The binding rule under test: whenever a COMPLETE entry name decodes to
 * exactly `encryption.risudat`, the walk resolves `true`, whether or not
 * that entry's data-length field or body fits in the file. Otherwise --
 * fewer than 4 bytes left, a name cut short, a non-marker name whose
 * data-length field is cut short, or a body cut short -- the file's last
 * entry cannot be the marker, and the walk resolves `false`.
 */
import { describe, test, expect } from 'vitest'
import {
    findEncryptionMarkerEntry,
    indexBackupEntries,
    parseBackupEntryHeader,
    type BackupIndexEntry,
    BACKUP_ENCRYPTION_MARKER_NAME,
    DEFAULT_BACKUP_WALK_WINDOW_BYTES,
    MAX_MARKER_NAME_BYTES,
} from '../backupContainer'

//#region byte-layout helpers, matching findEncryptionMarkerEntry's own framing

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function buildChunkWithRawName(nameBytes: Uint8Array, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    let offset = 0
    out.set(u32le(nameBytes.length), offset); offset += 4
    out.set(nameBytes, offset); offset += nameBytes.length
    out.set(u32le(data.length), offset); offset += 4
    out.set(data, offset)
    return out
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    return buildChunkWithRawName(new TextEncoder().encode(name), data)
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((a, c) => a + c.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.length }
    return out
}

/** Narrows a `Uint8Array<ArrayBufferLike>` to the `Uint8Array<ArrayBuffer>` shape `BlobPart` requires; mirrors `asBuffer` in `src/ts/util.ts`. */
function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function filledBytes(size: number, seed = 0): Uint8Array {
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) data[i] = (i + seed) % 256
    return data
}

const MARKER_NAME = BACKUP_ENCRYPTION_MARKER_NAME
// The walk clamps every window to at least 4 bytes, so 4 is the smallest
// window size that actually differs from the default in practice.
const SMALL_WINDOWS = [4, 5, 13]
const WINDOWS = [...SMALL_WINDOWS, DEFAULT_BACKUP_WALK_WINDOW_BYTES]

function assetEntry(size = 16, name = 'asset1.png'): Uint8Array {
    return buildChunk(name, filledBytes(size))
}

/** A 53-byte entry name, the same shape LoadLocalBackup's cold-storage entries use. */
function coldEntry(): Uint8Array {
    return buildChunk('coldstorage_11111111-1111-1111-1111-111111111111.json', new TextEncoder().encode('{"message":[]}'))
}

function databaseEntry(): Uint8Array {
    return buildChunk('database.risudat', new TextEncoder().encode('fake-db-bytes'))
}

function markerEntry(body: Uint8Array = new TextEncoder().encode(JSON.stringify({ type: 'account' }))): Uint8Array {
    return buildChunk(MARKER_NAME, body)
}

//#endregion

//#region File wrappers over real happy-dom File/Blob instances

function fileOf(bytes: Uint8Array, name = 'backup.bin'): File {
    return new File([asBlobPart(bytes)], name)
}

/** A real File whose every `slice()` call is recorded (as its byte length) before delegating to the real implementation. */
function fileWithTrackedSlices(bytes: Uint8Array, name = 'backup.bin'): { file: File; sliceLengths: number[] } {
    const base = new File([asBlobPart(bytes)], name)
    const sliceLengths: number[] = []
    const file = new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (start = 0, end = target.size, contentType?: string) => {
                    sliceLengths.push(end - start)
                    return (target.slice as (...a: unknown[]) => Blob).call(target, start, end, contentType)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
    return { file, sliceLengths }
}

/** A real File whose `slice(...).arrayBuffer()` rejects from the `rejectFromCall`-th `slice()` call onward. */
function fileWithRejectingSlice(bytes: Uint8Array, rejectFromCall: number, name = 'backup.bin'): File {
    const base = new File([asBlobPart(bytes)], name)
    let calls = 0
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (...args: [number?, number?, string?]) => {
                    calls += 1
                    if (calls >= rejectFromCall) {
                        return {
                            arrayBuffer: () => Promise.reject(new Error('scratch: unreadable region')),
                        } as unknown as Blob
                    }
                    return (target.slice as (...a: unknown[]) => Blob).apply(target, args)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
}

//#endregion

describe('the walk finds a marker regardless of window size, in upstream entry order', () => {
    test.each(WINDOWS)('resolves true with a %i-byte window', async (windowBytes) => {
        const bytes = concatChunks([assetEntry(), coldEntry(), markerEntry(), databaseEntry()])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file, { windowBytes })).resolves.toBe(true)
    })
})

describe('the walk finds a marker wherever it sits in the file', () => {
    test.each(SMALL_WINDOWS)('resolves true when the marker is the first entry, with a %i-byte window', async (windowBytes) => {
        const bytes = concatChunks([markerEntry(), assetEntry(), coldEntry(), databaseEntry()])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file, { windowBytes })).resolves.toBe(true)
    })

    test.each(SMALL_WINDOWS)('resolves true when the marker is the last entry, with a %i-byte window', async (windowBytes) => {
        const bytes = concatChunks([assetEntry(), coldEntry(), databaseEntry(), markerEntry()])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file, { windowBytes })).resolves.toBe(true)
    })
})

describe('the walk resolves false when no entry name is the marker, at any window size', () => {
    test.each(WINDOWS)('resolves false with a %i-byte window', async (windowBytes) => {
        const bytes = concatChunks([assetEntry(), coldEntry(), databaseEntry()])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file, { windowBytes })).resolves.toBe(false)
    })
})

test('finds a marker beyond a pre-marker body twice the default window, with several entries, at the default window', async () => {
    const bigAsset = buildChunk('bigasset.png', filledBytes(DEFAULT_BACKUP_WALK_WINDOW_BYTES * 2 + 123, 7))
    const bytes = concatChunks([bigAsset, assetEntry(32, 'asset2.png'), coldEntry(), markerEntry(), databaseEntry()])
    const file = fileOf(bytes)

    await expect(findEncryptionMarkerEntry(file)).resolves.toBe(true)
})

test('finds a marker whose name straddles a window boundary', async () => {
    // A 10-byte window splits the 18-byte marker name across two reads: the
    // first covers only the name-length field and part of the name, forcing
    // the window to grow before the header resolves.
    const bytes = concatChunks([assetEntry(), markerEntry(), databaseEntry()])
    const file = fileOf(bytes)

    await expect(findEncryptionMarkerEntry(file, { windowBytes: 10 })).resolves.toBe(true)
})

describe('the four end-of-file shapes on a file with no marker each resolve false', () => {
    test('fewer than 4 bytes remain after the last complete entry', async () => {
        const bytes = concatChunks([assetEntry(), new Uint8Array([1, 2, 3])])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file)).resolves.toBe(false)
    })

    test('a name is cut off by the end of the file', async () => {
        const partialHeader = concatChunks([u32le(10), new TextEncoder().encode('abcde')])
        const bytes = concatChunks([assetEntry(), partialHeader])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file)).resolves.toBe(false)
    })

    test('a non-marker name is complete but its data-length field is cut off', async () => {
        const partialHeader = concatChunks([u32le(5), new TextEncoder().encode('abcde'), new Uint8Array([1, 2])])
        const bytes = concatChunks([assetEntry(), partialHeader])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file)).resolves.toBe(false)
    })

    test('a body is cut off by the end of the file', async () => {
        const nameBytes = new TextEncoder().encode('short.png')
        const declaredHeader = concatChunks([u32le(nameBytes.length), nameBytes, u32le(1000)])
        const bytes = concatChunks([assetEntry(), declaredHeader, new Uint8Array([1, 2, 3])])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file)).resolves.toBe(false)
    })
})

test('a complete marker name followed by a data-length field cut off at the end of the file resolves true, per the binding end-of-file rule', async () => {
    const nameBytes = new TextEncoder().encode(MARKER_NAME)
    const partialHeader = concatChunks([u32le(nameBytes.length), nameBytes, new Uint8Array([1, 2])])
    const bytes = concatChunks([assetEntry(), partialHeader])
    const file = fileOf(bytes)

    await expect(findEncryptionMarkerEntry(file)).resolves.toBe(true)
})

test('a complete marker name whose declared data length runs past the end of the file resolves true', async () => {
    const nameBytes = new TextEncoder().encode(MARKER_NAME)
    const header = concatChunks([u32le(nameBytes.length), nameBytes, u32le(500)])
    const bytes = concatChunks([assetEntry(), header])
    const file = fileOf(bytes)

    await expect(findEncryptionMarkerEntry(file)).resolves.toBe(true)
})

describe('long entry names are scanned past without ever being buffered whole', () => {
    test('finds a marker beyond a 53-byte cold-storage-style name and a 100 KiB name, reading only small windows', async () => {
        const hugeName = 'x'.repeat(1024 * 100)
        const hugeEntry = buildChunk(hugeName, new Uint8Array(4))
        const bytes = concatChunks([assetEntry(), coldEntry(), hugeEntry, markerEntry(), databaseEntry()])
        const { file, sliceLengths } = fileWithTrackedSlices(bytes)

        await expect(findEncryptionMarkerEntry(file)).resolves.toBe(true)

        // No single read should approach the 100 KiB name: the walk's first
        // window over this entry holds only part of the long name (up to
        // one window's worth of it), and the separate data-length-field read
        // that follows a skipped long name is a fixed few bytes. Bounded by
        // a literal, not by MAX_MARKER_NAME_BYTES itself, so raising that
        // constant cannot silently widen what this test allows.
        const maxAllowedRead = 4096 + 32
        expect(sliceLengths.length).toBeGreaterThan(0)
        expect(Math.max(...sliceLengths)).toBeLessThanOrEqual(maxAllowedRead)
    })
})

describe('byte sequences that must not be treated as the marker name', () => {
    test('a double byte-order-mark prefix does not count as the marker', async () => {
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF])
        const nameBytes = concatChunks([bom, bom, new TextEncoder().encode(MARKER_NAME)])
        const bytes = concatChunks([assetEntry(), buildChunkWithRawName(nameBytes, new Uint8Array(0)), databaseEntry()])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file)).resolves.toBe(false)
    })

    test('the marker name followed by a trailing NUL byte does not count as the marker', async () => {
        const nameBytes = concatChunks([new TextEncoder().encode(MARKER_NAME), new Uint8Array([0])])
        const bytes = concatChunks([assetEntry(), buildChunkWithRawName(nameBytes, new Uint8Array(0)), databaseEntry()])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file)).resolves.toBe(false)
    })

    test('the marker name with a fullwidth dot in place of the ASCII dot does not count as the marker', async () => {
        const nameBytes = new TextEncoder().encode('encryption．risudat')
        const bytes = concatChunks([assetEntry(), buildChunkWithRawName(nameBytes, new Uint8Array(0)), databaseEntry()])
        const file = fileOf(bytes)

        await expect(findEncryptionMarkerEntry(file)).resolves.toBe(false)
    })
})

test('a byte-order-mark-prefixed marker name resolves true', async () => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF])
    const nameBytes = concatChunks([bom, new TextEncoder().encode(MARKER_NAME)])
    const bytes = concatChunks([assetEntry(), buildChunkWithRawName(nameBytes, new Uint8Array(0)), databaseEntry()])
    const file = fileOf(bytes)

    await expect(findEncryptionMarkerEntry(file)).resolves.toBe(true)
})

test('an exception from slice().arrayBuffer() propagates as a rejection, not a resolved false', async () => {
    const bytes = concatChunks([assetEntry(), coldEntry(), databaseEntry()])
    const file = fileWithRejectingSlice(bytes, 2)

    await expect(findEncryptionMarkerEntry(file)).rejects.toThrow('scratch: unreadable region')
})

test('onProgress reports non-decreasing scanned bytes ending at the file size for a no-marker file', async () => {
    const bytes = concatChunks([assetEntry(), coldEntry(), databaseEntry()])
    const file = fileOf(bytes)
    const progressCalls: Array<[number, number]> = []

    const result = await findEncryptionMarkerEntry(file, {
        onProgress: (scanned, total) => { progressCalls.push([scanned, total]) },
    })

    expect(result).toBe(false)
    expect(progressCalls.length).toBeGreaterThan(0)
    for (let i = 1; i < progressCalls.length; i++) {
        expect(progressCalls[i][0]).toBeGreaterThanOrEqual(progressCalls[i - 1][0])
    }
    const [lastScanned, lastTotal] = progressCalls[progressCalls.length - 1]
    expect(lastScanned).toBe(bytes.length)
    expect(lastTotal).toBe(bytes.length)
})

describe('indexBackupEntries returns where every complete entry sits', () => {
    test('lists each entry with its offset, name length, data length and header length, at every window size', async () => {
        const entries = [assetEntry(16, 'a.png'), coldEntry(), assetEntry(300, 'bb.png'), databaseEntry()]
        const bytes = concatChunks(entries)
        const expected: BackupIndexEntry[] = []
        let offset = 0
        for (const entry of entries) {
            const nameLength = new DataView(entry.buffer, entry.byteOffset, 4).getUint32(0, true)
            const dataLength = entry.length - 8 - nameLength
            expected.push({ headerOffset: offset, nameLength, dataLength, headerLength: 8 + nameLength })
            offset += entry.length
        }

        for (const windowBytes of WINDOWS) {
            const result = await indexBackupEntries(fileOf(bytes), { windowBytes })
            expect(result.hasMarker).toBe(false)
            expect(result.entries).toEqual(expected)
        }
    })

    test('indexes an entry whose name is longer than the marker bound without decoding it', async () => {
        const hugeName = 'y'.repeat(1000)
        const bytes = concatChunks([assetEntry(), buildChunk(hugeName, new Uint8Array(7)), databaseEntry()])

        const result = await indexBackupEntries(fileOf(bytes))

        expect(result.entries).toHaveLength(3)
        expect(result.entries[1]).toEqual({
            headerOffset: assetEntry().length,
            nameLength: 1000,
            dataLength: 7,
            headerLength: 8 + 1000,
        })
    })

    test('stops at a truncated trailing entry, which is not listed', async () => {
        const bytes = concatChunks([assetEntry(), databaseEntry()]).slice(0, -3)

        const result = await indexBackupEntries(fileOf(bytes))

        expect(result.hasMarker).toBe(false)
        expect(result.entries).toHaveLength(1)
    })

    test('lists nothing when a marker is found', async () => {
        const bytes = concatChunks([assetEntry(), markerEntry(), databaseEntry()])

        const result = await indexBackupEntries(fileOf(bytes))

        expect(result).toEqual({ hasMarker: true, entries: [] })
    })
})

describe('parseBackupEntryHeader', () => {
    test('reports incomplete at the nameLength stage for a buffer under 4 bytes', () => {
        const result = parseBackupEntryHeader(new Uint8Array([1, 2, 3]))
        expect(result).toEqual({ status: 'incomplete', stage: 'nameLength', need: 4 })
    })

    test('reports incomplete at the name stage when the name itself is cut off', () => {
        const buffer = concatChunks([u32le(5), new TextEncoder().encode('ab')])
        const result = parseBackupEntryHeader(buffer)
        expect(result).toEqual({ status: 'incomplete', stage: 'name', need: 9, nameLength: 5 })
    })

    test('reports incomplete at the dataLength stage, with nameSkipped false, for a short complete name', () => {
        const buffer = concatChunks([u32le(5), new TextEncoder().encode('abcde'), new Uint8Array([1, 2])])
        const result = parseBackupEntryHeader(buffer)
        expect(result).toEqual({ status: 'incomplete', stage: 'dataLength', need: 13, nameLength: 5, nameSkipped: false })
    })

    test('reports incomplete at the dataLength stage, with nameSkipped true, when the name is longer than maxNameBytesToDecode', () => {
        const buffer = concatChunks([u32le(30), new Uint8Array(10)])
        const result = parseBackupEntryHeader(buffer, MAX_MARKER_NAME_BYTES)
        expect(result).toEqual({ status: 'incomplete', stage: 'dataLength', need: 38, nameLength: 30, nameSkipped: true })
    })

    test('reads a data length of 0xFFFFFFF8 as the unsigned value 4294967288, not a negative number', () => {
        const buffer = concatChunks([u32le(0), u32le(0xFFFFFFF8)])
        const result = parseBackupEntryHeader(buffer)

        expect(result.status).toBe('ok')
        if (result.status === 'ok') {
            expect(result.header.dataLength).toBe(4294967288)
            expect(result.header.dataLength).toBeGreaterThan(0)
        }
    })
})

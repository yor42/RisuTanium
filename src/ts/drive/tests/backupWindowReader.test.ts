// @vitest-environment happy-dom

/**
 * The windowed reader of the `.bin` container (`src/ts/drive/backupContainer.ts`): `createBlobWindowReader` and the
 * header walk `indexBackupEntries` that reads through it. Fixtures are built over the
 * `[u32 nameLength][name][u32 dataLength][data]` framing with no dependency on `LoadLocalBackup`.
 *
 * Labels: regression reproducer (red on the per-entry reader this replaced), compatibility guard (an oracle that keeps
 * the previous walk and the previous per-entry slices, which the new reader must match byte for byte), new behaviour
 * (the reader contract).
 */
import { describe, test, expect } from 'vitest'
import {
    BACKUP_ENCRYPTION_MARKER_NAME,
    createBlobWindowReader,
    indexBackupEntries,
    MAX_MARKER_NAME_BYTES,
    parseBackupEntryHeader,
    decodeEntryName,
    type BackupIndexEntry,
} from '../backupContainer'

//#region fixtures

function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function chunkOf(nameBytes: Uint8Array, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    out.set(u32le(nameBytes.length), 0)
    out.set(nameBytes, 4)
    out.set(u32le(data.length), 4 + nameBytes.length)
    out.set(data, 8 + nameBytes.length)
    return out
}

function chunk(name: string, data: Uint8Array): Uint8Array {
    return chunkOf(new TextEncoder().encode(name), data)
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of chunks) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function filled(size: number, seed = 0): Uint8Array {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        out[i] = (i * 7 + seed) % 256
    }
    return out
}

function fileOf(bytes: Uint8Array): File {
    return new File([asBlobPart(bytes)], 'backup.bin')
}

/** A real File whose every `slice()` is recorded before it delegates. */
function countingFile(bytes: Uint8Array): { file: File, slices: { start: number, end: number }[] } {
    const base = fileOf(bytes)
    const slices: { start: number, end: number }[] = []
    const file = new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (start = 0, end = target.size) => {
                    slices.push({ start, end })
                    return target.slice(start, end)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
    return { file, slices }
}

function sameBytes(actual: Uint8Array, expected: Uint8Array): boolean {
    return actual.length === expected.length && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

/** A small deterministic generator, so a failing case can be named by its seed. */
function generator(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

//#endregion

//#region the previous reader, kept as the oracle

function readUint32LE(buffer: Uint8Array, byteOffset: number): number {
    return new DataView(buffer.buffer, buffer.byteOffset + byteOffset, 4).getUint32(0, true)
}

/** The walk as it was before the windowed reader: one window slice at each entry header, names decoded up to the marker bound only. */
async function previousWalk(file: Blob, windowBytes: number): Promise<{ hasMarker: boolean, entries: BackupIndexEntry[] }> {
    const totalBytes = file.size
    const initialWindowBytes = Math.max(4, windowBytes)
    const entries: BackupIndexEntry[] = []
    let pos = 0
    while (pos < totalBytes) {
        let size = initialWindowBytes
        for (;;) {
            const remaining = totalBytes - pos
            const windowLength = Math.min(size, remaining)
            const buffer = new Uint8Array(await file.slice(pos, pos + windowLength).arrayBuffer())
            const result = parseBackupEntryHeader(buffer, MAX_MARKER_NAME_BYTES)
            if (result.status === 'ok') {
                if (result.header.name === BACKUP_ENCRYPTION_MARKER_NAME) {
                    return { hasMarker: true, entries: [] }
                }
                const bodyEnd = pos + result.header.headerLength + result.header.dataLength
                if (bodyEnd > totalBytes) {
                    return { hasMarker: false, entries }
                }
                entries.push({ headerOffset: pos, nameLength: result.header.nameLength, dataLength: result.header.dataLength, headerLength: result.header.headerLength })
                pos = bodyEnd
                break
            }
            if (result.stage === 'dataLength' && result.nameSkipped) {
                const fieldStart = pos + 4 + result.nameLength
                const fieldEnd = fieldStart + 4
                if (fieldEnd > totalBytes) {
                    return { hasMarker: false, entries }
                }
                const dataLength = readUint32LE(new Uint8Array(await file.slice(fieldStart, fieldEnd).arrayBuffer()), 0)
                const bodyEnd = fieldEnd + dataLength
                if (bodyEnd > totalBytes) {
                    return { hasMarker: false, entries }
                }
                entries.push({ headerOffset: pos, nameLength: result.nameLength, dataLength, headerLength: 4 + result.nameLength + 4 })
                pos = bodyEnd
                break
            }
            if (result.stage === 'dataLength' && !result.nameSkipped
                    && decodeEntryName(buffer, result.nameLength) === BACKUP_ENCRYPTION_MARKER_NAME) {
                return { hasMarker: true, entries: [] }
            }
            if (windowLength >= remaining) {
                return { hasMarker: false, entries }
            }
            size = Math.max(size * 2, result.need)
        }
    }
    return { hasMarker: false, entries }
}

/** The bytes the copy pass asked a per-entry slice for: the header (padded to 29 bytes, never past the entry) and the body. */
const MARKER_HEADER_BYTES = 4 + MAX_MARKER_NAME_BYTES + 4

function headerReadLengthOf(entry: BackupIndexEntry): number {
    return Math.min(entry.headerLength + entry.dataLength, Math.max(entry.headerLength, MARKER_HEADER_BYTES))
}

async function sliceBytes(file: Blob, start: number, end: number): Promise<Uint8Array> {
    return new Uint8Array(await file.slice(start, end).arrayBuffer())
}

//#endregion

const NAME_LENGTHS = [0, 1, 5, 18, 21, 22, 40, 64, 65, 100, 1024, 1025]
const DATA_LENGTHS = [0, 0, 1, 3, 15, 16, 17, 100, 5000]
const BOM = new Uint8Array([0xEF, 0xBB, 0xBF])

function randomName(random: () => number, length: number): Uint8Array {
    const name = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        name[i] = 97 + Math.floor(random() * 26)
    }
    if (length >= 4 && random() < 0.3) {
        name.set(BOM, 0)
    }
    return name
}

/** A container of random entries, none of them the marker. */
function randomContainer(seed: number): Uint8Array {
    const random = generator(seed)
    const count = 3 + Math.floor(random() * 8)
    const chunks: Uint8Array[] = []
    for (let i = 0; i < count; i++) {
        const nameLength = NAME_LENGTHS[Math.floor(random() * NAME_LENGTHS.length)]
        const dataLength = DATA_LENGTHS[Math.floor(random() * DATA_LENGTHS.length)]
        chunks.push(chunkOf(randomName(random, nameLength), filled(dataLength, i)))
    }
    return concat(chunks)
}

/** Containers built so that entries end exactly on a window edge, and so that the final entry has no body. */
function edgeContainers(): Uint8Array[] {
    const sixteen = (name: string) => chunk(name, filled(16 - 8 - name.length, 3))
    return [
        concat([sixteen('ab'), sixteen('cd'), sixteen('ef'), chunk('zz', new Uint8Array(0))]),
        concat([chunk('a', filled(4, 1)), chunk('b', filled(5000, 2)), chunk('c', new Uint8Array(0))]),
        concat([chunk('only-empty', new Uint8Array(0))]),
        concat([chunk('x', filled(8, 1)), chunk('y', new Uint8Array(0)), chunk('z', new Uint8Array(0))]),
    ]
}

const WINDOWS = [4, 16, 64, 1031, 1032, 1033, 4096]

describe('regression: the walk reads a file of many small entries in a number of slices that follows its size', () => {
    // Red on the walk that took one 4 KiB window per entry: about one slice per entry.
    test('1500 small entries are walked in slices bounded by the file size over the window, not by the entry count', async () => {
        const bytes = concat(Array.from({ length: 1500 }, (_, i) => chunk(`a${i}.png`, filled(20, i))))
        const { file, slices } = countingFile(bytes)

        const walk = await indexBackupEntries(file, { windowBytes: 4096 })

        expect(walk.entries).toHaveLength(1500)
        // A window serves every header that fits whole in it, and the walk refills when the next header might not.
        expect(slices.length).toBeLessThanOrEqual(Math.ceil(bytes.length / (4096 - 1032)) + 2)
    })

    // Falsification of the bound above: the previous walk, kept as the oracle, takes about one slice per entry and misses it.
    test('the previous per-entry walk is over that bound on the same file', async () => {
        const bytes = concat(Array.from({ length: 1500 }, (_, i) => chunk(`a${i}.png`, filled(20, i))))
        const { file, slices } = countingFile(bytes)

        await previousWalk(file, 4096)

        expect(slices.length).toBeGreaterThanOrEqual(1500)
        expect(slices.length).toBeGreaterThan(Math.ceil(bytes.length / (4096 - 1032)) + 2)
    })

    test('at the default window a file of that size is read in one slice', async () => {
        const bytes = concat(Array.from({ length: 1500 }, (_, i) => chunk(`a${i}.png`, filled(20, i))))
        const { file, slices } = countingFile(bytes)

        await indexBackupEntries(file)

        expect(slices.length).toBeLessThanOrEqual(2)
    })
})

describe('the reader contract', () => {
    test('a request past the end of the file is clamped, never an error, and a request at or past the end reads nothing', async () => {
        const bytes = filled(40)
        const { file, slices } = countingFile(bytes)
        const reader = createBlobWindowReader(file, 16)

        expect(sameBytes(await reader.view(37, 100), bytes.subarray(37))).toBe(true)
        const readsSoFar = slices.length
        expect((await reader.view(40, 5)).length).toBe(0)
        expect((await reader.view(55, 5)).length).toBe(0)
        expect((await reader.view(10, 0)).length).toBe(0)
        expect(slices.length).toBe(readsSoFar)
    })

    test('a file that delivers fewer bytes than its size promised gives a shorter view, which a caller reads as a changed file', async () => {
        const bytes = filled(40)
        const base = fileOf(bytes)
        const shrunk = new Proxy(base, {
            get(target, prop, receiver) {
                if (prop === 'slice') {
                    return (start = 0, end = target.size) => target.slice(start, Math.min(end, 25))
                }
                return Reflect.get(target, prop, receiver)
            },
        })
        const reader = createBlobWindowReader(shrunk, 16)

        expect((await reader.view(0, 10)).length).toBe(10)
        expect((await reader.view(20, 10)).length).toBe(5)
        expect((await reader.view(30, 10)).length).toBe(0)
    })

    test('an exception from a slice propagates out of the view', async () => {
        const base = fileOf(filled(40))
        const broken = new Proxy(base, {
            get(target, prop, receiver) {
                if (prop === 'slice') {
                    return () => ({ arrayBuffer: () => Promise.reject(new Error('scratch: unreadable region')) }) as unknown as Blob
                }
                return Reflect.get(target, prop, receiver)
            },
        })

        await expect(createBlobWindowReader(broken, 16).view(0, 4)).rejects.toThrow('scratch: unreadable region')
    })

    test('a range inside the held window costs no read, a range larger than a window is read exactly and leaves the window alone', async () => {
        const bytes = filled(200)
        const { file, slices } = countingFile(bytes)
        const reader = createBlobWindowReader(file, 16)

        expect(sameBytes(await reader.view(0, 4), bytes.subarray(0, 4))).toBe(true)
        expect(slices).toEqual([{ start: 0, end: 16 }])
        expect(sameBytes(await reader.view(8, 8), bytes.subarray(8, 16))).toBe(true)
        expect(slices).toHaveLength(1)
        expect(sameBytes(await reader.view(20, 60), bytes.subarray(20, 80))).toBe(true)
        expect(slices[1]).toEqual({ start: 20, end: 80 })
        expect(sameBytes(await reader.view(4, 4), bytes.subarray(4, 8))).toBe(true)
        expect(slices).toHaveLength(2)
    })

    test('a miss with fill turned off reads exactly the range and does not replace the held window', async () => {
        const bytes = filled(200)
        const { file, slices } = countingFile(bytes)
        const reader = createBlobWindowReader(file, 64)

        await reader.view(0, 4)
        expect(sameBytes(await reader.view(100, 8, false), bytes.subarray(100, 108))).toBe(true)
        expect(slices[1]).toEqual({ start: 100, end: 108 })
        await reader.view(8, 4)
        expect(slices).toHaveLength(2)
    })

    test('a window is never reused: a later window does not change bytes an earlier view handed out, and readers share no buffer', async () => {
        const bytes = filled(200)
        const file = fileOf(bytes)
        const reader = createBlobWindowReader(file, 16)

        const first = await reader.view(0, 8)
        const snapshot = first.slice()
        const second = await reader.view(100, 8)
        expect(sameBytes(first, snapshot)).toBe(true)
        expect(second.buffer).not.toBe(first.buffer)

        const other = createBlobWindowReader(file, 16)
        const again = await other.view(0, 8)
        expect(again.buffer).not.toBe(first.buffer)
        expect(sameBytes(again, first)).toBe(true)
    })
})

describe('compatibility guard: the windowed walk and views equal the previous walk and per-entry slices', () => {
    const containers: { label: string, bytes: Uint8Array }[] = [
        ...Array.from({ length: 60 }, (_, seed) => ({ label: `seed ${seed}`, bytes: randomContainer(seed) })),
        ...edgeContainers().map((bytes, index) => ({ label: `edge container ${index}`, bytes })),
    ]

    test.each(WINDOWS)('index, verdict and every header and body view are identical at %i-byte windows', async (windowBytes) => {
        for (const { label, bytes } of containers) {
            const file = fileOf(bytes)
            const expected = await previousWalk(file, windowBytes)
            const walk = await indexBackupEntries(file, { windowBytes })
            expect(walk.hasMarker, label).toBe(expected.hasMarker)
            expect(walk.entries, label).toEqual(expected.entries)

            for (const fill of [true, false]) {
                const reader = createBlobWindowReader(file, windowBytes)
                for (const entry of walk.entries) {
                    const headerLength = headerReadLengthOf(entry)
                    const header = await reader.view(entry.headerOffset, headerLength, fill)
                    expect(sameBytes(header, await sliceBytes(file, entry.headerOffset, entry.headerOffset + headerLength)), `${label} header at ${entry.headerOffset}`).toBe(true)
                    const dataStart = entry.headerOffset + entry.headerLength
                    const body = await reader.view(dataStart, entry.dataLength, fill)
                    expect(sameBytes(body, await sliceBytes(file, dataStart, dataStart + entry.dataLength)), `${label} body at ${dataStart}`).toBe(true)
                }
            }
        }
    })

    test.each(WINDOWS)('a container cut at every position walks to the same index and verdict at %i-byte windows', async (windowBytes) => {
        const whole = concat([
            chunk('a.png', filled(9, 1)), chunkOf(randomName(generator(5), 30), filled(3, 2)), chunk('zero', new Uint8Array(0)),
            chunkOf(randomName(generator(6), 70), filled(12, 3)), chunk(BACKUP_ENCRYPTION_MARKER_NAME + '.x', filled(2, 4)),
        ])
        for (let cut = 0; cut <= whole.length; cut++) {
            const file = fileOf(whole.slice(0, cut))
            const expected = await previousWalk(file, windowBytes)
            const walk = await indexBackupEntries(file, { windowBytes })
            expect(walk.hasMarker, `cut ${cut}`).toBe(expected.hasMarker)
            expect(walk.entries, `cut ${cut}`).toEqual(expected.entries)
        }
    })

    test.each(WINDOWS)('a marker anywhere, with or without a byte-order mark and with its data length cut off, is found at %i-byte windows', async (windowBytes) => {
        const name = new TextEncoder().encode(BACKUP_ENCRYPTION_MARKER_NAME)
        const variants = [
            chunkOf(name, filled(3)),
            chunkOf(concat([BOM, name]), filled(3)),
            chunkOf(name, new Uint8Array(0)),
            chunkOf(name, filled(3)).slice(0, 4 + name.length + 2),
            chunkOf(name, filled(3)).slice(0, 4 + name.length),
        ]
        for (const [index, marker] of variants.entries()) {
            for (const position of ['first', 'middle', 'last'] as const) {
                const parts = [chunk('a.png', filled(40)), chunk('b.png', filled(5000, 1))]
                const bytes = position === 'first' ? concat([marker, ...parts]) : position === 'middle' ? concat([parts[0], marker, parts[1]]) : concat([...parts, marker])
                const walk = await indexBackupEntries(fileOf(bytes), { windowBytes })
                expect(walk.hasMarker, `variant ${index} ${position}`).toBe(true)
                expect(walk.entries).toEqual([])
            }
        }
    })
})

describe('the names the walk keeps', () => {
    test.each(WINDOWS)('a name is kept for every entry of at most 64 bytes, and for an oversized body whatever its name, at %i-byte windows', async (windowBytes) => {
        for (let seed = 0; seed < 60; seed++) {
            const bytes = randomContainer(seed)
            const file = fileOf(bytes)
            const walk = await indexBackupEntries(file, { windowBytes, oversizeBodyBytes: 100 })
            for (const entry of walk.entries) {
                const kept = walk.names.get(entry.headerOffset)
                const mustKeep = entry.nameLength <= 64 || entry.dataLength > 100
                const prefix = bytes.subarray(entry.headerOffset + 4, entry.headerOffset + 4 + Math.min(entry.nameLength, 1024))
                expect(kept, `seed ${seed} at ${entry.headerOffset}`).toBe(mustKeep ? new TextDecoder().decode(prefix) : undefined)
            }
        }
    })

    test.each(WINDOWS)('without an oversize bound only the names of at most 64 bytes are kept, at %i-byte windows', async (windowBytes) => {
        for (let seed = 0; seed < 60; seed++) {
            const walk = await indexBackupEntries(fileOf(randomContainer(seed)), { windowBytes })
            for (const entry of walk.entries) {
                expect(walk.names.has(entry.headerOffset), `seed ${seed} at ${entry.headerOffset}`).toBe(entry.nameLength <= 64)
            }
        }
    })
})

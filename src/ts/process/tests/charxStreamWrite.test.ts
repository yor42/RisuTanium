/**
 * `CharXWriter.writeStream` and the serialised `CharXWriter` calls (CHORE-375 stage C2): a large asset is written as a
 * STORE entry in two passes, in hand-ons of exactly 4 MiB, without ever holding it.
 *
 * The real writer runs on the real `fflate`/`crc`; the file writer is a recorder that keeps every array it is handed
 * together with its SHA-256 at that moment (the reference-keeping writer). The independent parser
 * (`charxFramingParser.ts`) recomputes every CRC and checks every central offset; `CharXImporter` reads the archive back.
 * The three piece sources run through the real `openExportAssetPieces`, over fake stores. A mocked writer is not
 * evidence of native file behaviour.
 *
 * Labels:
 * - (G) guard: the property it names holds on the writer, and a scratch mutant named in the case breaks it.
 * - (N) new behaviour: `writeStream` and the call queue do not exist before stage C2, so there is nothing to be red
 *   against. The reproducers that go red on the C1 base (a write above the 4 MiB hand-on size, a large key passed to
 *   `readImage`, the two-phase text, the refused import cap) are in `characterCards.exportLarge.test.ts`.
 */
import { createHash } from 'node:crypto'
import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { referenceCrc32, parseCharx } from './charxFramingParser'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    Semaphore: class { async acquire() { } release() { } },
    asBuffer: (a: unknown) => a,
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

const saved = vi.hoisted(() => ({ assets: new Map<string, Uint8Array>() }))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        pieceStoreOrNull: vi.fn(async () => null),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            const id = `saved-${saved.assets.size}`
            saved.assets.set(id, data.slice())
            return id
        }),
        saveAssetFromPieces: vi.fn(),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStoreKind: vi.fn(async () => 'tauri'),
}))

import { TAURI_WRITE_CHUNK_BYTES } from 'src/ts/exportWriters'
import { ExportAssetMissingError, openExportAssetPieces, webBlobPieceSource, type ExportAssetSource } from 'src/ts/drive/assetPieces'
import { nodePieceOpener, type ReadPiece } from 'src/ts/drive/inlayBackupExport'
import { getImageType } from 'src/ts/media/imageType'
import type { ByteStore } from 'src/ts/storage/store/contract'
import {
    CHARX_STREAM_HAND_ON_BYTES,
    CHARX_STREAM_PROGRESS_INTERVAL_MS,
    CharXImporter,
    CharXWriter,
    CharxTooLargeError,
    ExportAssetChangedError,
    charxCodec,
    charxEncode,
    type CharxStreamOpened,
    type CharxStreamPhase,
    type CharxStreamPiece,
} from '../processzip'

const MIB = 1024 * 1024
const HAND_ON = 4 * MIB

//#region fixtures

/** Deterministic bytes (xorshift32), so a failure reproduces. */
function bytesOf(length: number, seed: number): Uint8Array<ArrayBuffer> {
    let state = (seed * 2654435761) >>> 0 || 1
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        state ^= state << 13
        state >>>= 0
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        out[i] = state & 255
    }
    return out
}

function seeded(seed: number): () => number {
    let state = seed >>> 0 || 1
    return () => {
        state ^= state << 13
        state >>>= 0
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        return state / 4294967296
    }
}

/** `data` cut into pieces whose sizes follow `sizes` in turn (each piece is a copy, as a source's own array would be). */
function split(data: Uint8Array, sizes: number[]): Uint8Array[] {
    const pieces: Uint8Array[] = []
    let at = 0
    let i = 0
    while (at < data.length) {
        const length = Math.min(sizes[i++ % sizes.length], data.length - at)
        pieces.push(data.slice(at, at + length))
        at += length
    }
    return pieces.length > 0 ? pieces : [new Uint8Array(0)]
}

function sha256(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex')
}

/** The reference-keeping writer: every array handed on is kept, with its SHA-256 at that moment. */
function keeper() {
    const arrays: Uint8Array[] = []
    const hashes: string[] = []
    let closed = false
    return {
        writer: {
            write: vi.fn(async (data: Uint8Array) => {
                arrays.push(data)
                hashes.push(sha256(data))
            }),
            close: vi.fn(async () => { closed = true }),
        },
        arrays,
        isClosed: () => closed,
        bytes: () => new Uint8Array(Buffer.concat(arrays)),
        /** No array was written into after it was handed on. */
        untouched: () => arrays.every((array, i) => sha256(array) === hashes[i]),
        bodyBytes: () => arrays.reduce((n, a) => n + a.length, 0),
    }
}

type Target = ConstructorParameters<typeof CharXWriter>[0]
type Keeper = ReturnType<typeof keeper>

function newWriter(out: Keeper, limit?: number): CharXWriter {
    return new CharXWriter(out.writer as unknown as Target, limit)
}

interface PassSpec {
    pieces: Uint8Array[]
    /** The size the source reports; the sum of the pieces when absent. */
    total?: number
    identity?: string
    /** `next()` rejects with `failWith` once this many pieces after the first have been yielded. */
    failAfter?: number
    failWith?: Error
    /** `open()` itself rejects. */
    openError?: Error
}

interface Track {
    /** Opens attempted. */
    opens: number
    /** Generators handed to the writer. */
    created: number
    /** Generators the writer closed with `return()`. */
    closed: number
}

function newTrack(): Track {
    return { opens: 0, created: 0, closed: 0 }
}

/** An `open()` whose n-th call serves `pass(n)`. */
function opener(pass: (index: number) => PassSpec, track: Track): () => Promise<CharxStreamOpened> {
    return async () => {
        const index = track.opens++
        const spec = pass(index)
        if (spec.openError) {
            throw spec.openError
        }
        const total = spec.total ?? spec.pieces.reduce((n, p) => n + p.length, 0)
        const [first, ...others] = spec.pieces
        const inner = (async function* (): AsyncGenerator<CharxStreamPiece, void, undefined> {
            let yielded = 0
            for (const bytes of others) {
                if (spec.failAfter !== undefined && yielded === spec.failAfter) {
                    throw spec.failWith
                }
                yielded++
                yield { bytes, total }
            }
            if (spec.failAfter !== undefined && yielded === spec.failAfter) {
                throw spec.failWith
            }
        })()
        const originalReturn = inner.return.bind(inner)
        inner.return = async (value) => {
            track.closed++
            return originalReturn(value)
        }
        track.created++
        return { first: { bytes: first, total }, rest: inner, identity: spec.identity }
    }
}

/** The same asset on both passes. */
function sameBoth(data: Uint8Array, sizes: number[], identity?: string): (index: number) => PassSpec {
    return () => ({ pieces: split(data, sizes), identity })
}

const NAME = 'Display Name'
const KEY = 'assets/secret-store-key.bin'
const ENTRY = 'assets/other/image/blob.bin'
const META = 'x_meta/blob.json'

async function streamArchive(data: Uint8Array, sizes: number[], options: { limit?: number, prefix?: Uint8Array, meta?: boolean, around?: boolean } = {}) {
    const out = keeper()
    const writer = newWriter(out, options.limit)
    if (options.prefix) {
        const prefix = options.prefix
        vi.spyOn(charxEncode, 'jpeg').mockImplementation(async () => prefix)
        await writer.writeJpeg(new Uint8Array(1))
    }
    if (options.around) {
        await writer.write('card.json', '{"spec":"chara_card_v3"}', 6)
    }
    const track = newTrack()
    await writer.writeStream(ENTRY, opener(sameBoth(data, sizes), track), data.length, undefined, { name: NAME, metaPath: options.meta === false ? undefined : META })
    if (options.around) {
        await writer.write('module.risum', Uint8Array.from([1, 2, 3]))
    }
    await writer.end()
    return { out, track, bytes: out.bytes() }
}

async function importBytes(bytes: Uint8Array): Promise<CharXImporter> {
    saved.assets.clear()
    const importer = new CharXImporter()
    await importer.parse(bytes)
    await importer.done()
    return importer
}

function savedEntry(importer: CharXImporter, path: string): Uint8Array | undefined {
    const id = importer.assets[path]
    return id === undefined ? undefined : saved.assets.get(id)
}

function equal(a: Uint8Array | undefined, b: Uint8Array): boolean {
    return a !== undefined && Buffer.from(a).equals(Buffer.from(b))
}

beforeEach(() => {
    saved.assets.clear()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

//#endregion

describe('the hand-on size', () => {
    test('(G) the writer\'s hand-on size is the Tauri writer\'s chunk size', () => {
        expect(CHARX_STREAM_HAND_ON_BYTES).toBe(TAURI_WRITE_CHUNK_BYTES)
        expect(CHARX_STREAM_HAND_ON_BYTES).toBe(HAND_ON)
    })

    for (const [label, sizes] of [
        ['pieces of 2 MiB (Android)', [2 * MIB]],
        ['pieces of 4 MiB (web Blob slices)', [4 * MIB]],
        ['pieces of 1.5 MiB', [Math.floor(1.5 * MIB)]],
        ['one 9.5 MiB piece', [10 * MIB]],
        ['uneven pieces', [3 * MIB + 17, 1, 5 * MIB - 3, 777]],
    ] as Array<[string, number[]]>) {
        test(`(G) ${label}: every body write is exactly 4 MiB except the last, and the count is ceil(size / 4 MiB)`, async () => {
            const data = bytesOf(9 * MIB + 12345, 1)
            const { out } = await streamArchive(data, sizes, { meta: false })
            // the local header, the body writes, then the central directory
            const body = out.arrays.slice(1, -1)
            expect(body.length).toBe(Math.ceil(data.length / HAND_ON))
            expect(body.slice(0, -1).every(array => array.length === HAND_ON)).toBe(true)
            expect(body[body.length - 1].length).toBe(data.length - HAND_ON * (body.length - 1))
            expect(out.arrays.every(array => array.length <= HAND_ON)).toBe(true)
            expect(equal(Buffer.concat(body), data)).toBe(true)
        })
    }

    test('(G) a piece above 4 MiB is handed on as views of it (no copy), a joined hand-on as a new array', async () => {
        const data = bytesOf(10 * MIB, 2)
        const piece = data.slice()
        const out = keeper()
        const writer = newWriter(out)
        await writer.writeStream(ENTRY, opener(() => ({ pieces: [piece] }), newTrack()), piece.length)
        const body = out.arrays.slice(1)
        expect(body[0].buffer).toBe(piece.buffer)
        expect(body[1].buffer).toBe(piece.buffer)
        // the 2 MiB left over is held until end() and handed on as it is
        expect(body[2].buffer).toBe(piece.buffer)

        const joined = keeper()
        const writer2 = newWriter(joined)
        const parts = split(data, [3 * MIB])
        await writer2.writeStream(ENTRY, opener(() => ({ pieces: parts }), newTrack()), data.length)
        const second = joined.arrays[2]
        expect(parts.some(part => part.buffer === second.buffer)).toBe(false)
    })
})

describe('reference-keeping writer', () => {
    // R3-3: nothing writes into an array after handing it on. Mutant: one reused 4 MiB remainder buffer.
    for (const [label, sizes] of [
        ['3 MiB pieces (every hand-on joins a held tail)', [3 * MIB]],
        ['5 MiB pieces', [5 * MIB]],
        ['uneven pieces', [3 * MIB + 17, 1, 5 * MIB - 3, 777]],
    ] as Array<[string, number[]]>) {
        test(`(G) ${label}: every array handed on still hashes as it did, and the bytes are the asset`, async () => {
            const data = bytesOf(13 * MIB + 99, 3)
            const { out } = await streamArchive(data, sizes)
            expect(out.untouched()).toBe(true)
            const archive = parseCharx(out.bytes())
            expect(equal(archive.entries.find(entry => entry.name === ENTRY)?.data, data)).toBe(true)
        })
    }
})

describe('import equality through CharXImporter, on all three sources', () => {
    const data = bytesOf(9 * MIB + 321, 4)

    function tauriSource(): ExportAssetSource {
        return {
            kind: 'tauri',
            pieces: {
                node: false,
                open: async function* (): AsyncGenerator<ReadPiece, void, undefined> {
                    for (let offset = 0; offset < data.length; offset += 2 * MIB) {
                        yield { bytes: data.slice(offset, offset + 2 * MIB), offset, total: data.length, identity: 'file-1' } as ReadPiece
                    }
                },
            },
            store: {} as ByteStore,
        }
    }

    function nodeSource(): ExportAssetSource {
        const store = {
            readPieces: async () => ({
                total: data.length,
                version: null,
                pieces: (async function* () {
                    for (let offset = 0; offset < data.length; offset += 3 * MIB) {
                        yield data.slice(offset, offset + 3 * MIB)
                    }
                })(),
            }),
        } as unknown as ByteStore
        return { kind: 'node', pieces: { node: true, open: nodePieceOpener(store) }, store }
    }

    function webSource(): ExportAssetSource {
        const store = { read: async () => ({ bytes: null }), readValue: async () => new Blob([data]) } as unknown as ByteStore
        const pieces = webBlobPieceSource(store)
        if (pieces === null) {
            throw new Error('the test store has readValue')
        }
        return { kind: 'web', pieces, store }
    }

    const sources: Array<[string, () => ExportAssetSource]> = [['tauri', tauriSource], ['node', nodeSource], ['web', webSource]]
    for (const [kind, make] of sources) {
        test(`(G) ${kind}: the exported asset imports with equal bytes (mutant: drop the first piece of pass 2)`, async () => {
            const source = make()
            const out = keeper()
            const writer = newWriter(out)
            await writer.write('card.json', '{"spec":"chara_card_v3"}', 6)
            await writer.writeStream(ENTRY, () => openExportAssetPieces(KEY, source), data.length, undefined, { name: NAME, metaPath: META })
            await writer.end()
            const importer = await importBytes(out.bytes())
            expect(equal(savedEntry(importer, ENTRY), data)).toBe(true)
        })
    }
})

describe('a large asset that holds zip signatures', () => {
    // Mutant: a descriptor large entry (flag bit 3, zeros in the local header, a descriptor after the body).
    const signatures = [
        Uint8Array.from([0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
        Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 8, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        Uint8Array.from([0x50, 0x4b, 0x01, 0x02, 99, 98, 97]),
    ]
    function planted(): Uint8Array {
        const data = bytesOf(9 * MIB + 5, 5)
        // inside a piece, straddling the 4 MiB and 8 MiB hand-on boundaries, and at the very end
        data.set(signatures[0], 100)
        data.set(signatures[1], HAND_ON - 7)
        data.set(signatures[2], 2 * HAND_ON - 3)
        data.set(signatures[0], data.length - 16)
        return data
    }

    for (const [label, sizes] of [['3 MiB pieces', [3 * MIB]], ['4 MiB pieces', [HAND_ON]], ['odd pieces', [1000003]]] as Array<[string, number[]]>) {
        test(`(G) ${label}: PK\\x07\\x08, PK\\x03\\x04 and PK\\x01\\x02 inside the bytes import with equal bytes`, async () => {
            const data = planted()
            const { bytes } = await streamArchive(data, sizes, { around: true })
            expect(Buffer.from(bytes).includes(Buffer.from([0x50, 0x4b, 0x07, 0x08]))).toBe(true)
            const importer = await importBytes(bytes)
            expect(equal(savedEntry(importer, ENTRY), data)).toBe(true)
        })
    }
})

describe('the independent parser on a streamed archive', () => {
    // Mutant: the CRC fold started from 0 (`crc` treats 0 as a zero state, not as a fresh start).
    test('(G) every CRC, size and central offset checks; the entry is STORE with flag bit 3 clear and one stamp', async () => {
        const data = bytesOf(9 * MIB + 777, 6)
        const { bytes } = await streamArchive(data, [3 * MIB + 5], { around: true })
        const archive = parseCharx(bytes)
        expect(archive.entries.map(entry => entry.name)).toEqual(['card.json', META, ENTRY, 'module.risum'])
        const asset = archive.entries[2]
        expect(asset.central.method).toBe(0)
        expect(asset.local.method).toBe(0)
        expect(asset.central.flagLow).toBe(0)
        expect(asset.local.flagLow).toBe(0)
        expect(asset.descriptor).toBeUndefined()
        expect(asset.central.size).toBe(data.length)
        expect(asset.central.compressedSize).toBe(data.length)
        expect(asset.local.crc).toBe(asset.central.crc)
        expect(asset.local.stamp).toBe(asset.central.stamp)
        expect(asset.central.crc).toBe(referenceCrc32(data))
        expect(equal(asset.data, data)).toBe(true)
    })

    test('(G) behind a JPEG prefix the offsets stay zip-relative', async () => {
        const prefix = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 4, 5, 6, 7, 0xff, 0xd9])
        const data = bytesOf(5 * MIB + 3, 7)
        const { bytes, out } = await streamArchive(data, [2 * MIB], { prefix, around: true })
        const archive = parseCharx(bytes)
        expect(archive.prefixLength).toBe(prefix.length)
        expect(equal(bytes.subarray(0, prefix.length), prefix)).toBe(true)
        expect(equal(archive.entries[2].data, data)).toBe(true)
        expect(out.untouched()).toBe(true)
    })

    test('(G) charxCodec.crc32 continues from a checksum of 0 as from a fresh start', () => {
        const rest = bytesOf(1000, 8)
        expect(charxCodec.crc32(rest, 0)).toBe(crc32(Buffer.from(rest)))
        expect(charxCodec.crc32(rest, undefined)).toBe(crc32(Buffer.from(rest)))
    })

    test('(G) a fold over pieces is the CRC of the whole', () => {
        const data = bytesOf(10000, 9)
        let fold: number | undefined
        for (const piece of split(data, [1, 4999, 17, 300])) {
            fold = charxCodec.crc32(piece, fold)
        }
        expect(fold).toBe(crc32(Buffer.from(data)))
    })
})

describe('CRC vector', () => {
    const vector = new TextEncoder().encode('123456789')

    async function crcOf(sizes: number[]): Promise<number | undefined> {
        const out = keeper()
        const writer = newWriter(out)
        await writer.writeStream(ENTRY, opener(sameBoth(vector, sizes), newTrack()), vector.length)
        await writer.end()
        return parseCharx(out.bytes()).entries[0].central.crc
    }

    test('(G) 123456789 is cbf43926 whatever the pieces (seeded splits)', async () => {
        const random = seeded(11)
        const splits: number[][] = [[9], [1], [4, 5], [8, 1], [1, 8]]
        for (let i = 0; i < 40; i++) {
            splits.push(Array.from({ length: 1 + Math.floor(random() * 5) }, () => 1 + Math.floor(random() * 9)))
        }
        for (const sizes of splits) {
            expect(await crcOf(sizes), sizes.join(',')).toBe(0xcbf43926)
        }
    })
})

describe('x_meta type from the head and the tail of the asset', () => {
    // Mutant: the tail taken from the last piece alone.
    const fixtures: Array<[string, number[]]> = [
        ['jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x50, 0xff, 0xd9]],
        ['jpeg without an end marker', [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x50]],
        ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]],
        ['gif89a', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0x3b]],
        ['bmp', [0x42, 0x4d, 0, 0, 0, 0]],
        ['avif', [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]],
        ['webp', [0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4]],
        ['unknown', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
        ['two bytes', [0xff, 0xd9]],
        ['one byte', [0xff]],
    ]

    async function typeOf(bytes: Uint8Array, sizes: number[]): Promise<string | undefined> {
        const out = keeper()
        const writer = newWriter(out)
        await writer.writeStream(ENTRY, opener(sameBoth(bytes, sizes), newTrack()), bytes.length, undefined, { name: NAME, metaPath: META })
        await writer.end()
        const meta = parseCharx(out.bytes()).entries.find(entry => entry.name === META)
        return meta === undefined ? undefined : (JSON.parse(new TextDecoder().decode(meta.data)) as { type: string }).type
    }

    test('(G) the type is the whole-array type under fixed and seeded splits', async () => {
        const random = seeded(12)
        for (const [label, list] of fixtures) {
            const bytes = Uint8Array.from(list)
            const splits: number[][] = [[bytes.length], [1], [bytes.length - 1, 1], [1, bytes.length - 1], [7, 1], [11, 1], [2, 1]]
            for (let i = 0; i < 20; i++) {
                splits.push(Array.from({ length: 1 + Math.floor(random() * 4) }, () => 1 + Math.floor(random() * 6)))
            }
            for (const sizes of splits) {
                expect(await typeOf(bytes, sizes), `${label} ${sizes.join(',')}`).toBe(getImageType(bytes))
            }
        }
    })

    test('(G) x_meta is written after pass 1 and before the asset entry, as JSON of the type alone', async () => {
        const track = newTrack()
        const out = keeper()
        const writer = newWriter(out)
        const data = Uint8Array.from([0x42, 0x4d, 0, 0, 0, 0])
        await writer.writeStream(ENTRY, opener(sameBoth(data, [2]), track), data.length, undefined, { metaPath: META })
        await writer.end()
        const archive = parseCharx(out.bytes())
        expect(archive.entries.map(entry => entry.name)).toEqual([META, ENTRY])
        expect(new TextDecoder().decode(archive.entries[0].data)).toBe('{"type":"BMP"}')
        expect(track.opens).toBe(2)
    })
})

describe('calls run one at a time', () => {
    // C1 review: `write` records an entry's offset before the awaited hand-on that advances the offset.
    // Mutant: `#run` without the queue.
    function slowKeeper(): Keeper {
        const out = keeper()
        const original = out.writer.write.getMockImplementation()
        out.writer.write.mockImplementation(async (data: Uint8Array) => {
            await new Promise<void>(resolve => setTimeout(resolve, 2))
            await original?.(data)
        })
        return out
    }

    test('(G) overlapping calls produce correct central offsets, in call order', async () => {
        const out = slowKeeper()
        const writer = newWriter(out)
        const data = bytesOf(5 * MIB, 13)
        const calls = [
            writer.write('a.bin', bytesOf(100, 1)),
            writer.write('b.bin', bytesOf(200, 2), 6),
            writer.writeStream(ENTRY, opener(sameBoth(data, [3 * MIB]), newTrack()), data.length, undefined, { metaPath: META }),
            writer.write('c.bin', bytesOf(300, 3)),
            writer.end(),
        ]
        await Promise.all(calls)
        const archive = parseCharx(out.bytes())
        expect(archive.entries.map(entry => entry.name)).toEqual(['a.bin', 'b.bin', META, ENTRY, 'c.bin'])
        expect(out.untouched()).toBe(true)
    })

    test('(G) a call queued behind a failed one rethrows its error and writes nothing', async () => {
        const out = keeper()
        const writer = newWriter(out, 700)
        const first = writer.write('big.bin', new Uint8Array(900))
        const second = writer.write('small.bin', new Uint8Array(3))
        const third = writer.writeStream(ENTRY, opener(sameBoth(bytesOf(10, 1), [10]), newTrack()), 10)
        const results = await Promise.allSettled([first, second, third])
        expect(results.map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected'])
        const reasons = results.map(result => (result as PromiseRejectedResult).reason as Error)
        expect(reasons[0]).toBeInstanceOf(CharxTooLargeError)
        expect(reasons[1]).toBe(reasons[0])
        expect(reasons[2]).toBe(reasons[0])
        expect(out.writer.write).not.toHaveBeenCalled()
    })
})

describe('the export stops, naming the asset, and closes what it opened', () => {
    const data = bytesOf(6 * MIB + 1000, 21)
    const flipped = (() => {
        const copy = data.slice()
        copy[copy.length - 5] ^= 0xff
        return copy
    })()

    interface Case {
        label: string
        pass: (index: number) => PassSpec
        /** The writes allowed: a bound on the body bytes handed on. */
        bodyBound?: number
    }

    const cases: Case[] = [
        { label: 'a size change between the passes', pass: (i) => i === 0 ? { pieces: split(data, [3 * MIB]) } : { pieces: split(data, [3 * MIB]), total: data.length + 1 } },
        { label: 'a CRC change with equal size', pass: (i) => ({ pieces: split(i === 0 ? data : flipped, [3 * MIB]) }) },
        { label: 'a Tauri identity change', pass: (i) => ({ pieces: split(data, [3 * MIB]), identity: i === 0 ? 'file-1' : 'file-2' }) },
        { label: 'a short count in pass 1', pass: (i) => i === 0 ? { pieces: split(data.subarray(0, data.length - 10), [3 * MIB]), total: data.length } : { pieces: split(data, [3 * MIB]) } },
        { label: 'a short count in pass 2', pass: (i) => i === 0 ? { pieces: split(data, [3 * MIB]) } : { pieces: split(data.subarray(0, data.length - 10), [3 * MIB]), total: data.length } },
        { label: 'an overrun in pass 2', pass: (i) => i === 0 ? { pieces: split(data, [3 * MIB]) } : { pieces: [...split(data, [3 * MIB]), new Uint8Array(3 * MIB)], total: data.length }, bodyBound: data.length },
        { label: 'an overrun in pass 1', pass: (i) => i === 0 ? { pieces: [...split(data, [3 * MIB]), new Uint8Array(10)], total: data.length } : { pieces: split(data, [3 * MIB]) } },
        { label: 'a rejected read after the first piece in pass 1', pass: (i) => i === 0 ? { pieces: split(data, [3 * MIB]), failAfter: 1, failWith: new Error(`os error reading ${KEY}`) } : { pieces: split(data, [3 * MIB]) } },
        { label: 'a rejected read after the first piece in pass 2', pass: (i) => i === 0 ? { pieces: split(data, [3 * MIB]) } : { pieces: split(data, [3 * MIB]), failAfter: 1, failWith: new Error(`os error reading ${KEY}`) } },
    ]

    for (const { label, pass, bodyBound } of cases) {
        test(`(N) ${label}`, async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { })
            const out = keeper()
            const writer = newWriter(out)
            const track = newTrack()
            const error = await writer.writeStream(ENTRY, opener(pass, track), data.length, undefined, { name: NAME }).then(() => null, (e: unknown) => e)
            expect(error).toBeInstanceOf(ExportAssetChangedError)
            expect((error as ExportAssetChangedError).assetName).toBe(NAME)
            expect((error as Error).message).toContain(NAME)
            expect((error as Error).message).not.toContain(KEY)
            expect((error as Error).stack ?? '').not.toContain(KEY)
            expect(track.closed).toBe(track.created)
            if (bodyBound !== undefined) {
                // header plus at most the asset's own bytes: not one byte past the expected size
                expect(out.bodyBytes()).toBeLessThanOrEqual(30 + ENTRY.length + bodyBound)
            }
            // the writer is latched: later calls fail with the same error
            await expect(writer.write('later.bin', new Uint8Array(1))).rejects.toBe(error)
        })
    }

    test('(N) a failed pass 2 hands on no last, partial block after the mismatch is known', async () => {
        const out = keeper()
        const writer = newWriter(out)
        const bytes = out.bodyBytes
        await writer.writeStream(ENTRY, opener((i) => ({ pieces: split(i === 0 ? data : flipped, [3 * MIB]) }), newTrack()), data.length).catch(() => { })
        // 6 MiB + 1000 bytes: one block of 4 MiB went out, the last 2 MiB + 1000 bytes were held back
        expect(bytes()).toBe(30 + ENTRY.length + HAND_ON)
    })

    test('(N) a missing first piece in pass 1 is ExportAssetMissingError, and nothing was opened or written', async () => {
        const out = keeper()
        const writer = newWriter(out)
        const track = newTrack()
        const error = await writer.writeStream(ENTRY, opener(() => ({ pieces: [], openError: new ExportAssetMissingError(NAME) }), track), data.length, undefined, { name: NAME }).then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(ExportAssetMissingError)
        expect(track.created).toBe(0)
        expect(out.writer.write).not.toHaveBeenCalled()
    })

    test('(N) a missing first piece in pass 2 is ExportAssetMissingError and the pass 1 generator is closed', async () => {
        const out = keeper()
        const writer = newWriter(out)
        const track = newTrack()
        const error = await writer.writeStream(ENTRY, opener((i) => i === 0 ? { pieces: split(data, [3 * MIB]) } : { pieces: [], openError: new ExportAssetMissingError(NAME) }, track), data.length, undefined, { name: NAME }).then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(ExportAssetMissingError)
        expect(track.created).toBe(1)
        expect(track.closed).toBe(1)
        // the header was never handed on
        expect(out.writer.write).not.toHaveBeenCalled()
    })

    test('(N) the key and the cause go to the console, not to the error', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })
        const cause = new Error(`os error reading ${KEY}`)
        const writer = newWriter(keeper())
        const error = await writer.writeStream(ENTRY, opener(() => ({ pieces: split(data, [3 * MIB]), failAfter: 0, failWith: cause }), newTrack()), data.length, undefined, { name: NAME }).then(() => null, (e: unknown) => e)
        expect((error as ExportAssetChangedError).cause).toBe(cause)
        expect(consoleError.mock.calls.some(call => call[0] === cause)).toBe(true)
    })

    test('(N) a cancel thrown by the progress callback passes on unchanged and closes the generator', async () => {
        class Cancelled extends Error { }
        const track = newTrack()
        const writer = newWriter(keeper())
        const cancel = new Cancelled('cancelled')
        const error = await writer.writeStream(ENTRY, opener(sameBoth(data, [3 * MIB]), track), data.length, () => { throw cancel }).then(() => null, (e: unknown) => e)
        expect(error).toBe(cancel)
        expect(track.closed).toBe(track.created)
    })
})

describe('the backstop during a stream', () => {
    test('(N) an entry that cannot fit is refused before any pass opens', async () => {
        const data = bytesOf(5000, 31)
        const out = keeper()
        const track = newTrack()
        const writer = newWriter(out, 5000 + 30 + ENTRY.length)
        const error = await writer.writeStream(ENTRY, opener(sameBoth(data, [1000]), track), data.length).then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(CharxTooLargeError)
        expect(track.opens).toBe(0)
        expect(out.writer.write).not.toHaveBeenCalled()
    })

    test('(N) an entry that fits to the byte is written, and the directory that no longer fits refuses end()', async () => {
        const data = bytesOf(5000, 32)
        const out = keeper()
        const writer = newWriter(out, 5000 + 30 + ENTRY.length + 1)
        await writer.writeStream(ENTRY, opener(sameBoth(data, [1000]), newTrack()), data.length)
        expect(out.bodyBytes()).toBe(5000 + 30 + ENTRY.length)
        await expect(writer.end()).rejects.toBeInstanceOf(CharxTooLargeError)
    })

    test('(N) entries before the stream count toward the limit', async () => {
        const data = bytesOf(5000, 33)
        const out = keeper()
        const writer = newWriter(out, 5000 + 30 + ENTRY.length + 200)
        await writer.write('before.bin', bytesOf(300, 1))
        const written = out.bodyBytes()
        const error = await writer.writeStream(ENTRY, opener(sameBoth(data, [1000]), newTrack()), data.length).then(() => null, (e: unknown) => e)
        expect(error).toBeInstanceOf(CharxTooLargeError)
        expect(out.bodyBytes()).toBe(written)
    })
})

describe('progress', () => {
    /** A source whose n-th piece is read `stepMs` after the previous one on the (fake) clock. */
    function ticking(pieces: number, pieceBytes: number, stepMs: number): () => Promise<CharxStreamOpened> {
        return async () => {
            const total = pieces * pieceBytes
            const inner = (async function* (): AsyncGenerator<CharxStreamPiece, void, undefined> {
                for (let i = 1; i < pieces; i++) {
                    vi.advanceTimersByTime(stepMs)
                    yield { bytes: new Uint8Array(pieceBytes).fill(i), total }
                }
            })()
            return { first: { bytes: new Uint8Array(pieceBytes), total }, rest: inner }
        }
    }

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['performance', 'Date'] })
    })

    async function reports(pieces: number, stepMs: number) {
        const seen: Array<[CharxStreamPhase, number, number]> = []
        const writer = newWriter(keeper())
        await writer.writeStream(ENTRY, ticking(pieces, 10, stepMs), pieces * 10, (phase, done, total) => seen.push([phase, done, total]))
        return seen
    }

    test('(N) the first and the last report of each phase always go out; the others are 250 ms apart', async () => {
        // ten pieces 100 ms apart: reports at pieces 1 (first), 4, 7 and 10 (last) in each phase
        const seen = await reports(10, 100)
        expect(CHARX_STREAM_PROGRESS_INTERVAL_MS).toBe(250)
        expect(seen.filter(report => report[0] === 'check').map(report => report[1])).toEqual([10, 40, 70, 100])
        expect(seen.filter(report => report[0] === 'stream').map(report => report[1])).toEqual([10, 40, 70, 100])
        expect(seen.every(report => report[2] === 100)).toBe(true)
        expect(seen.slice(0, 4).every(report => report[0] === 'check')).toBe(true)
    })

    test('(N) pieces that arrive faster than 250 ms report only the first and the last', async () => {
        const seen = await reports(20, 1)
        expect(seen.filter(report => report[0] === 'check').map(report => report[1])).toEqual([10, 200])
        expect(seen.filter(report => report[0] === 'stream').map(report => report[1])).toEqual([10, 200])
    })

    test('(N) a source with one piece reports each phase once, at the full size', async () => {
        const seen = await reports(1, 1)
        expect(seen).toEqual([['check', 10, 10], ['stream', 10, 10]])
    })

    test('(N) no callback means no reporting and no failure', async () => {
        const writer = newWriter(keeper())
        await expect(writer.writeStream(ENTRY, ticking(5, 10, 100), 50)).resolves.toBeUndefined()
    })
})

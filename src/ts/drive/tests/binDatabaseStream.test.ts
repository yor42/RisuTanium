import { describe, test, expect, vi, type Mock } from 'vitest'
import { gzipSync, zlibSync, deflateSync } from 'fflate'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

// `streamBinDatabase` reads the database entry of a `.bin` once, in bounded chunks, and hands out the characters one by
// one, then the rest of the tree and what the decode left out. For every entry it streams, the value must equal the
// whole decode's (`decodeRisuSave` for the msgpack formats, `salvageRisuSave` for the block format); every other entry
// declines with a named reason. Fixtures come from the real producers (`encodeRisuSaveLegacy`,
// `encodeRisuSaveCompressionStream`, `RisuSaveEncoder`) and from hand-built framing, with byte edits on top.
//
// Platform boundaries mocked here: the IndexedDB block cache (localforage), the shared storage, and the platform flags.

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => { }),
                removeItem: vi.fn(async () => { }),
            },
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => ({})),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import {
    decodeRisuSave, encodeRisuSaveCompressionStream, encodeRisuSaveLegacy, salvageRisuSave,
    type SalvageOmittedBlock, type toSaveType,
} from 'src/ts/storage/risuSave'
import { RisuSaveEncoder } from 'src/ts/storage/tests/risuSaveEncoder'
import type { Database } from 'src/ts/storage/database.svelte'
import { crc32 } from 'src/ts/storage/blockFrame'
import { BinFileChangedError } from 'src/ts/storage/store2/legacy/binReader'
import type { BackupIndexEntry, BinFile, BinSlice } from 'src/ts/drive/backupContainer'
import {
    streamBinDatabase, type BinStreamDecline, type BinStreamDeclineReason, type BinStreamDone, type BinStreamSink,
} from 'src/ts/drive/binDatabaseStream'
import {
    assemble, breakDataChecksum, parseBlocks, retypeBlock, type RawBlock,
} from 'src/ts/storage/tests/risuSaveBlockFile'
import { buildLibrary } from '../../../../Agents/Tools/save-gen/c806-library.mjs'

// msgpackr 1.10.1 calls `Buffer.prototype.utf8Write(string, position, 0xffffffff)` for a longer string, and the Node
// running this test rejects a length past the buffer's end. Clamping the length to the room left changes no byte
// written; it only lets the real encoder run here.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write
utf8WriterProto.utf8Write = function (text, position, length) {
    return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
}

//#region byte helpers

const encoder = new TextEncoder()

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function u32le(n: number): Uint8Array {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, n, true)
    return out
}

const MAGIC = [0, 82, 73, 83, 85, 83, 65, 86, 69, 0]
const HEADER = {
    raw: Uint8Array.from([...MAGIC, 7]),
    compressed: Uint8Array.from([...MAGIC, 8]),
    stream: Uint8Array.from([...MAGIC, 9]),
}

type MsgpackKind = keyof typeof HEADER

/** An entry of the given msgpack format over already encoded msgpack bytes. */
function msgpackEntry(kind: MsgpackKind, body: Uint8Array): Uint8Array {
    return concat(HEADER[kind], kind === 'raw' ? body : gzipSync(body, { mtime: 0 }))
}

// Hand-built msgpack: every value written with the smallest header, as upstream's encoder writes none of these forms.
function mpStr(text: string): Uint8Array {
    const bytes = encoder.encode(text)
    if (bytes.length < 32) return concat(Uint8Array.of(0xa0 | bytes.length), bytes)
    if (bytes.length < 256) return concat(Uint8Array.of(0xd9, bytes.length), bytes)
    if (bytes.length < 65536) return concat(Uint8Array.of(0xda, bytes.length >> 8, bytes.length & 255), bytes)
    return concat(Uint8Array.of(0xdb), u32be(bytes.length), bytes)
}

function u32be(n: number): Uint8Array {
    return Uint8Array.of(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255)
}

function mpUint(n: number): Uint8Array {
    return n < 128 ? Uint8Array.of(n) : Uint8Array.of(0xcd, n >> 8, n & 255)
}

function mpFixArray(items: Uint8Array[]): Uint8Array {
    return concat(Uint8Array.of(0x90 | items.length), ...items)
}

function mpFixMap(pairs: Array<[string, Uint8Array]>): Uint8Array {
    return concat(Uint8Array.of(0x80 | pairs.length), ...pairs.flatMap(([key, value]) => [mpStr(key), value]))
}

const MP_NIL = Uint8Array.of(0xc0)

/** An extension value: fixext1 with the given type byte. */
function mpExt(type: number): Uint8Array {
    return Uint8Array.of(0xd4, type, 0)
}

//#endregion

//#region container and sink

const ENTRY_NAME = 'database.risudat'

interface StubOptions {
    /** Reads starting at or after this offset resolve with one byte less than asked. */
    shortFrom?: number
    /** Reads starting at or after this offset reject. */
    rejectFrom?: number
}

interface Stub {
    file: BinFile
    entry: BackupIndexEntry
    slices: Array<[number, number]>
}

/** A `.bin` that holds the database entry between other bytes, behind a `BinFile` that records every read. */
function stubOf(data: Uint8Array, options: StubOptions = {}): Stub {
    const name = encoder.encode(ENTRY_NAME)
    const header = concat(u32le(name.length), name, u32le(data.length))
    const before = Uint8Array.of(9, 9, 9, 9, 9)
    const bytes = concat(before, header, data, Uint8Array.of(7, 7, 7))
    const slices: Array<[number, number]> = []
    const sliceOf = (start: number, end: number): BinSlice => ({
        size: end - start,
        slice: (from: number, to?: number) => sliceOf(start + from, to === undefined ? end : start + to),
        arrayBuffer: async () => {
            slices.push([start, end])
            if (options.rejectFrom !== undefined && start >= options.rejectFrom) {
                throw new Error('read refused')
            }
            const stop = options.shortFrom !== undefined && start >= options.shortFrom && end - start > 1 ? end - 1 : end
            return bytes.slice(start, stop).buffer
        },
    })
    const file: BinFile = {
        size: bytes.length,
        slice: (start: number, end?: number) => sliceOf(start, end ?? bytes.length),
    }
    return {
        file,
        entry: { headerOffset: before.length, nameLength: name.length, dataLength: data.length, headerLength: header.length },
        slices,
    }
}

interface Run {
    result: BinStreamDone | BinStreamDecline
    characters: unknown[]
    positions: number[]
    root: Database | null
    omitted: ReadonlyMap<string, SalvageOmittedBlock> | null
    yields: Mock<() => Promise<void>>
    stub: Stub
}

async function run(data: Uint8Array, chunkBytes?: number, options: StubOptions = {}, sink: Partial<BinStreamSink> = {}): Promise<Run> {
    const stub = stubOf(data, options)
    const characters: unknown[] = []
    const positions: number[] = []
    const out: Run = { result: { status: 'decline', reason: 'format' }, characters, positions, root: null, omitted: null, yields: vi.fn<() => Promise<void>>(async () => { }), stub }
    out.result = await streamBinDatabase(stub.file, stub.entry, {
        character: async (position, slot) => {
            await sink.character?.(position, slot)
            positions.push(position)
            characters.push(slot)
        },
        root: async (root) => {
            await sink.root?.(root)
            out.root = root
        },
        omitted: async (omitted) => {
            await sink.omitted?.(omitted)
            out.omitted = omitted
        },
    }, { yieldToMain: out.yields, chunkBytes })
    return out
}

function expectDone(outcome: Run): BinStreamDone {
    expect(outcome.result).not.toHaveProperty('status')
    return outcome.result as BinStreamDone
}

function expectDecline(outcome: Run, reason: BinStreamDeclineReason): void {
    expect(outcome.result).toEqual({ status: 'decline', reason })
}

/** The tree a finished run describes: the root with the characters it was handed. */
function treeOf(outcome: Run): Database {
    const root = outcome.root as unknown as Record<string, unknown>
    expect(root).not.toBeNull()
    if ('characters' in root) {
        root.characters = outcome.characters
    } else {
        expect(outcome.characters).toEqual([])
    }
    return root as unknown as Database
}

const CHUNK_SIZES = [undefined, 4096, 61]

/** The streamed value of a msgpack entry, in every chunking, equals the whole decode, key order included. */
async function expectMsgpackEquivalent(entry: Uint8Array, chunkSizes: Array<number | undefined> = CHUNK_SIZES): Promise<void> {
    const whole = await decodeRisuSave(entry) as Database
    for (const chunkBytes of chunkSizes) {
        const outcome = await run(entry, chunkBytes)
        const done = expectDone(outcome)
        expect(done).toEqual({ crc: crc32(entry), length: entry.length })
        const tree = treeOf(outcome)
        expect(tree).toEqual(whole)
        expect(Object.keys(tree)).toEqual(Object.keys(whole))
        expect(outcome.positions).toEqual(outcome.characters.map((_, index) => index))
        expect(outcome.omitted?.size).toBe(0)
    }
}

/** The streamed value of a block-format entry, in every chunking, equals `salvageRisuSave`: tree, key order and omitted map. */
async function expectBlocksEquivalent(entry: Uint8Array, chunkSizes: Array<number | undefined> = CHUNK_SIZES): Promise<Run> {
    const whole = await salvageRisuSave(entry)
    let last: Run | null = null
    for (const chunkBytes of chunkSizes) {
        const outcome = await run(entry, chunkBytes)
        const done = expectDone(outcome)
        expect(done).toEqual({ crc: crc32(entry), length: entry.length })
        const tree = treeOf(outcome)
        expect(tree).toEqual(whole.db)
        expect(Object.keys(tree)).toEqual(Object.keys(whole.db))
        expect(Array.from(outcome.omitted ?? [])).toEqual(Array.from(whole.omitted))
        last = outcome
    }
    return last as Run
}

//#endregion

//#region msgpack fixtures

const LIBRARY = buildLibrary({ seed: 806, characters: 5, chatsPerCharacter: 2, messagesPerChat: 2, modules: 3, archiveCharacters: true }) as unknown as Database

async function libraryEntry(kind: MsgpackKind): Promise<Uint8Array> {
    if (kind === 'stream') return await encodeRisuSaveCompressionStream(LIBRARY)
    return encodeRisuSaveLegacy(LIBRARY, kind === 'compressed' ? 'compression' : 'noCompression')
}

/** Values of every msgpack width in one character, and a root that holds more of them before and after `characters`. */
function widthsDatabase(): Record<string, unknown> {
    const wide = (length: number) => 'x'.repeat(length)
    const bin = (length: number) => Uint8Array.from({ length }, (_, i) => i & 255)
    const element = (tag: number) => ({
        tag,
        str8: wide(40), str16: wide(300), str32: wide(70000),
        bin8: bin(10), bin16: bin(300), bin32: bin(70000),
        array16: Array.from({ length: 300 }, (_, i) => i),
        map16: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i])),
        fixmap: new Map([['a', 1], ['b', 2]]),
        undef: undefined,
        date: new Date(1700000000000),
        negative: -5, big: 70000, float: 1.5, uint64: 2n ** 62n, int64: -(2n ** 60n),
        nested: { deep: [[[[{ list: [1, 2, 3] }]]]] },
        nil: null, yes: true, no: false,
    })
    return {
        formatversion: 5,
        before: { wide: wide(70000), list: Array.from({ length: 65537 }, (_, i) => i % 7) },
        characters: [element(0), element(1), 'plain', null, 3],
        after: { tail: [1, 2, 3], date: new Date(1700000000001) },
        last: 'end',
    }
}

//#endregion

describe('msgpack entries (T-A1)', () => {
    for (const kind of ['compressed', 'raw', 'stream'] as const) {
        test(`${kind}: a library streams to the value decodeRisuSave reads, in every chunking`, async () => {
            const entry = await libraryEntry(kind)
            const outcome = await run(entry, 4096)
            expectDone(outcome)
            expect(outcome.characters.length).toBe(5)
            await expectMsgpackEquivalent(entry)
        })

        test(`${kind}: every msgpack width, undefined, Date and 64-bit values stream to the whole decode`, async () => {
            const database = widthsDatabase()
            const entry = kind === 'stream'
                ? await encodeRisuSaveCompressionStream(database)
                : encodeRisuSaveLegacy(database, kind === 'compressed' ? 'compression' : 'noCompression')
            await expectMsgpackEquivalent(entry, [undefined, 5000])
        })
    }

    test('an array of 65536 elements or more is read as characters, one slot each', async () => {
        const entry = encodeRisuSaveLegacy({ head: 1, characters: Array.from({ length: 65540 }, (_, i) => i), tail: 2 }, 'noCompression')
        const outcome = await run(entry)
        expectDone(outcome)
        expect(outcome.characters.length).toBe(65540)
        expect(treeOf(outcome)).toEqual(await decodeRisuSave(entry))
    })

    test('an empty characters array and a root key order with characters first, between and last all match the whole decode', async () => {
        for (const database of [
            { characters: [], a: 1 },
            { a: 1, characters: [], b: 2 },
            { a: 1, b: 2, characters: [{ chaId: 'x' }] },
            { characters: [{ chaId: 'x' }], a: 1 },
            { 10: 'ten', 2: 'two', characters: [], b: 'b' },
        ]) {
            await expectMsgpackEquivalent(encodeRisuSaveLegacy(database, 'noCompression'), [undefined, 3])
        }
    })

    test('the rest of the root is decoded once and holds characters as an empty array', async () => {
        const outcome = await run(encodeRisuSaveLegacy({ a: 1, characters: [{ chaId: 'x' }], b: 2 }, 'noCompression'))
        expectDone(outcome)
        expect(outcome.root).toEqual({ a: 1, characters: [], b: 2 })
        expect(outcome.omitted?.size).toBe(0)
    })
})

describe('extension types (T-A3)', () => {
    const body = (ext: Uint8Array) => mpFixMap([['characters', mpFixArray([mpFixMap([['v', ext]])])]])

    for (const type of [0x72, 0x62, 0x69, 0x70, 0x73, 0x65, 0x78]) {
        test(`ext 0x${type.toString(16)} declines`, async () => {
            for (const kind of ['raw', 'compressed', 'stream'] as const) {
                expectDecline(await run(msgpackEntry(kind, body(mpExt(type)))), 'ext')
            }
        })
    }

    test('ext 0x72 outside the characters declines too', async () => {
        const entry = msgpackEntry('raw', mpFixMap([['x', mpExt(0x72)], ['characters', mpFixArray([])]]))
        expectDecline(await run(entry), 'ext')
    })

    test('ext 0 (undefined) and ext 0xff (timestamp) stream to the whole decode', async () => {
        const timestamp = Uint8Array.of(0xd6, 0xff, 0, 0, 0, 5)
        for (const kind of ['raw', 'compressed', 'stream'] as const) {
            await expectMsgpackEquivalent(msgpackEntry(kind, mpFixMap([
                ['u', mpExt(0)],
                ['characters', mpFixArray([mpFixMap([['v', mpExt(0)], ['t', timestamp]])])],
                ['t', timestamp],
            ])), [undefined, 2])
        }
    })
})

describe('shapes the stream declines (T-A4)', () => {
    const characters = mpFixArray([mpFixMap([['chaId', mpStr('a')]])])

    test('a root that is not a map, a non-string key, a repeated key and __proto__ decline as root-shape', async () => {
        expectDecline(await run(msgpackEntry('raw', mpFixArray([mpUint(1)]))), 'root-shape')
        expectDecline(await run(msgpackEntry('raw', concat(Uint8Array.of(0x81), mpUint(1), mpUint(2)))), 'root-shape')
        expectDecline(await run(msgpackEntry('raw', mpFixMap([['a', mpUint(1)], ['a', mpUint(2)], ['characters', characters]]))), 'root-shape')
        expectDecline(await run(msgpackEntry('raw', mpFixMap([['__proto__', mpUint(1)], ['characters', characters]]))), 'root-shape')
    })

    test('bytes after the root value decline as trailing, in every format', async () => {
        for (const kind of ['raw', 'compressed', 'stream'] as const) {
            expectDecline(await run(msgpackEntry(kind, concat(mpFixMap([['characters', characters]]), MP_NIL))), 'trailing')
        }
    })

    test('a root that stops short declines as trailing', async () => {
        const full = mpFixMap([['a', mpStr('hello')], ['characters', characters]])
        expectDecline(await run(msgpackEntry('raw', full.subarray(0, full.length - 2))), 'trailing')
    })

    test('no characters key and a characters value that is not an array decline', async () => {
        expectDecline(await run(msgpackEntry('raw', mpFixMap([['a', mpUint(1)]]))), 'characters')
        expectDecline(await run(msgpackEntry('raw', mpFixMap([['characters', mpStr('no')]]))), 'characters')
        expectDecline(await run(msgpackEntry('raw', mpFixMap([]))), 'characters')
    })

    test('a byte no msgpack value starts with declines as decode', async () => {
        expectDecline(await run(msgpackEntry('raw', mpFixMap([['characters', mpFixArray([Uint8Array.of(0xc1)])]]))), 'decode')
    })

    test('a second gzip member declines', async () => {
        const first = gzipSync(mpFixMap([['characters', characters]]), { mtime: 0 })
        const second = gzipSync(MP_NIL, { mtime: 0 })
        expectDecline(await run(concat(HEADER.compressed, first, second)), 'second-member')
    })

    test('gzip data after the member declines', async () => {
        const member = gzipSync(mpFixMap([['characters', characters]]), { mtime: 0 })
        expectDecline(await run(concat(HEADER.compressed, member, Uint8Array.of(1, 2, 3, 4, 5, 6))), 'inflate')
    })

    for (const kind of ['compressed', 'stream'] as const) {
        test(`${kind}: an ISIZE smaller or larger than the inflated length declines`, async () => {
            const entry = await libraryEntry(kind)
            const isize = new DataView(entry.buffer, entry.byteOffset + entry.length - 4, 4).getUint32(0, true)
            for (const wrong of [isize - 1, isize + 1, 0]) {
                const edited = entry.slice()
                new DataView(edited.buffer).setUint32(edited.length - 4, wrong, true)
                // DecompressionStream checks the trailer itself and errors the stream; fflate does not.
                expectDecline(await run(edited), kind === 'stream' ? 'inflate' : 'isize')
            }
            expectDone(await run(entry))
        })
    }

    test('a zlib-wrapped and a raw-deflate compressed entry decline as not-gzip, and the whole decode reads them', async () => {
        const body = encodeRisuSaveLegacy(LIBRARY, 'noCompression').subarray(HEADER.raw.length)
        for (const wrapped of [zlibSync(body), deflateSync(body)]) {
            const entry = concat(HEADER.compressed, wrapped)
            expectDecline(await run(entry), 'not-gzip')
            expect(await decodeRisuSave(entry)).toEqual(await decodeRisuSave(encodeRisuSaveLegacy(LIBRARY, 'noCompression')))
        }
    })

    test('an entry with no format header, and one too short to carry one, decline as format', async () => {
        expectDecline(await run(encoder.encode('{"characters":[]}')), 'format')
        expectDecline(await run(Uint8Array.of(1, 2, 3)), 'format')
        expectDecline(await run(new Uint8Array(0)), 'format')
        expectDecline(await run(HEADER.compressed.subarray(0, 8)), 'format')
    })

    test('a compressed entry with nothing after its header declines as not-gzip', async () => {
        expectDecline(await run(HEADER.compressed), 'not-gzip')
    })
})

//#region block fixtures

const BLOCK_TYPE = { config: 0, root: 1, characterWithChat: 2, preset: 4, modules: 5, remote: 6, characterWithoutChat: 7, rootComponent: 8, plugins: 9, loadouts: 10, pluginStorage: 11, kv: 12 } as const

/** One block as upstream's `encodeRawBlock` frames it (header version 0): no checksums. */
function v0Block(type: number, name: string, payload: Uint8Array, compressed: boolean): Uint8Array {
    const nameBuf = encoder.encode(name)
    return concat(Uint8Array.of(type, compressed ? 1 : 0, nameBuf.length), nameBuf, u32le(payload.length), payload)
}

function json(value: unknown): Uint8Array {
    return encoder.encode(JSON.stringify(value))
}

interface V0Block {
    type: number
    name: string
    /** The JSON value, or raw payload bytes written as given. */
    value: unknown | Uint8Array
    /** Gzip the JSON of `value` (default), write `value` as the given gzip bytes, or leave it plain. */
    compression?: 'gzip' | 'given' | 'none'
}

function v0Of(blocks: V0Block[]): Uint8Array {
    return concat(encoder.encode('RISUSAVE\0'), ...blocks.map((block) => {
        const mode = block.compression ?? 'gzip'
        if (mode === 'given') return v0Block(block.type, block.name, block.value as Uint8Array, true)
        const raw = block.value instanceof Uint8Array ? block.value : json(block.value)
        return mode === 'gzip' ? v0Block(block.type, block.name, gzipSync(raw, { mtime: 0 }), true) : v0Block(block.type, block.name, raw, false)
    }))
}

function character(id: string): V0Block {
    return { type: BLOCK_TYPE.characterWithoutChat, name: id, value: { type: 'character', chaId: id, name: `Char ${id}`, chats: [] } }
}

/** A v0 database: the blocks given, then the root last, its directory naming every block and `extraDirectory`. */
function v0Database(blocks: V0Block[], root: Record<string, unknown> = {}, extraDirectory: string[] = []): Uint8Array {
    return v0Of([...blocks, {
        type: BLOCK_TYPE.root, name: 'root', compression: 'none',
        value: { formatversion: 5, ...root, __directory: [...blocks.map((block) => block.name), ...extraDirectory] },
    }])
}

function makeToSave(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

/** A v1 database from the real encoder. */
async function v1Database(characters: number, compression: boolean): Promise<Uint8Array> {
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [{ name: 'Preset' }],
        modules: [{ id: 'module-1', name: 'Module' }],
        loadouts: [{ id: 'loadout-1' }],
        plugins: [{ name: 'Plugin' }],
        pluginCustomStorage: { stored: 1 },
        someSetting: 'setting',
        characters: Array.from({ length: characters }, (_, index) => ({ chaId: `v1-${index}`, type: 'character', name: `Character ${index}`, chats: [] })),
    } as unknown as Database
    const encoded = new RisuSaveEncoder()
    await encoded.init(db, { compression })
    await encoded.set(db, makeToSave())
    return new Uint8Array(encoded.encode()!)
}

//#endregion

describe('block entries (T-A2)', () => {
    test('a v1 file the encoder wrote streams to the tree and omitted map salvageRisuSave reads, compressed or not', async () => {
        for (const compression of [false, true]) {
            const entry = await v1Database(4, compression)
            const outcome = await expectBlocksEquivalent(entry)
            expect(outcome.characters.length).toBe(4)
            expect(outcome.omitted?.size).toBe(0)
        }
    })

    test('a v1 file with no character at all', async () => {
        const outcome = await expectBlocksEquivalent(await v1Database(0, true))
        expect(outcome.characters).toEqual([])
    })

    test('a v0 file with every block kind streams to the salvage value', async () => {
        await expectBlocksEquivalent(v0Database([
            { type: BLOCK_TYPE.preset, name: 'preset', value: [{ name: 'p' }] },
            character('a'),
            { type: BLOCK_TYPE.modules, name: 'modules', value: [{ id: 'm' }] },
            character('b'),
            { type: BLOCK_TYPE.plugins, name: 'plugins', value: [{ name: 'pl' }] },
            { type: BLOCK_TYPE.loadouts, name: 'loadouts', value: [] },
            { type: BLOCK_TYPE.pluginStorage, name: 'pluginStorage', value: { a: 1 } },
            { type: BLOCK_TYPE.config, name: 'config', value: { ignored: true } },
            { type: BLOCK_TYPE.characterWithChat, name: 'c', compression: 'none', value: { chaId: 'c', chats: [] } },
        ]))
    })

    test('kv blocks: the namespaces of the blocks are the whole field, and root keeps its own value only without blocks', async () => {
        await expectBlocksEquivalent(v0Database([
            character('a'),
            { type: BLOCK_TYPE.kv, name: 'kv:one', value: { entries: [1] } },
            { type: BLOCK_TYPE.kv, name: 'kv:two', value: 2 },
            { type: BLOCK_TYPE.kv, name: 'kv:broken', value: encoder.encode('{not json'), compression: 'none' },
        ], { upstreamKvBlocks: { stale: true } }))
        await expectBlocksEquivalent(v0Database([character('a')], { upstreamKvBlocks: { kept: true } }))
        await expectBlocksEquivalent(v0Database([character('a'), { type: BLOCK_TYPE.kv, name: 'kv:gone', value: 1 }], { upstreamKvBlocks: { stale: true } }, ['kv:missing']))
    })

    test('a directory entry with no block is listed as omitted, in its kind', async () => {
        const outcome = await expectBlocksEquivalent(v0Database([character('a')], {}, ['ghost', 'preset', 'modules', 'kv:none']))
        expect(Array.from(outcome.omitted!.keys())).toEqual(expect.arrayContaining(['ghost', 'preset', 'modules', 'kv:none']))
    })

    test('an empty botPresets root gets the template preset, as the whole decode gives it', async () => {
        const outcome = await expectBlocksEquivalent(v0Database([character('a')], { botPresets: [] }))
        expect(outcome.root?.botPresets).toEqual([{ name: 'test-preset' }])
    })

    test('a character whose data checksum is broken is omitted and left out of the characters', async () => {
        const entry = breakDataChecksum(await v1Database(3, false), 'v1-1')
        const outcome = await expectBlocksEquivalent(entry)
        expect(outcome.characters.length).toBe(2)
        expect(outcome.omitted?.get('v1-1')?.kind).toBe('character')
        expect(outcome.omitted?.get('v1-1')?.reason).toMatch(/Data checksum mismatch/)
    })

    test('a character that is not valid gzip or not valid JSON is omitted with the whole decode\'s reason', async () => {
        const outcome = await expectBlocksEquivalent(v0Database([
            character('a'),
            { type: BLOCK_TYPE.characterWithoutChat, name: 'bad-gzip', value: encoder.encode('not gzip at all'), compression: 'given' },
            { type: BLOCK_TYPE.characterWithoutChat, name: 'bad-json', value: encoder.encode('{"chaId":'), compression: 'none' },
            character('b'),
        ]))
        expect(outcome.characters.length).toBe(2)
        expect(Array.from(outcome.omitted!.keys())).toEqual(expect.arrayContaining(['bad-gzip', 'bad-json']))
        expect(outcome.positions).toEqual([0, 1])
    })

    test('a block with gzip data after its member, and a block of two members, are read as DecompressionStream reads them', async () => {
        const first = gzipSync(json([{ id: 'first' }]), { mtime: 0 })
        const second = gzipSync(json([{ id: 'second' }]), { mtime: 0 })
        await expectBlocksEquivalent(v0Database([
            character('a'),
            { type: BLOCK_TYPE.modules, name: 'modules', value: concat(first, second), compression: 'given' },
            { type: BLOCK_TYPE.plugins, name: 'plugins', value: concat(first, Uint8Array.of(1, 2, 3, 4, 5)), compression: 'given' },
            { type: BLOCK_TYPE.loadouts, name: 'loadouts', value: concat(first, first), compression: 'given' },
        ]))
    })

    test('a block of a type this reader does not know is left out as other', async () => {
        const outcome = await expectBlocksEquivalent(v0Database([character('a'), { type: 99, name: 'weird', value: { a: 1 } }]))
        expect(outcome.omitted?.get('weird')?.kind).toBe('other')
    })

    test('a checksum cut short by the end of the entry is read as the whole decode reads it', async () => {
        const entry = await v1Database(2, false)
        // Cut two bytes off the last block's data checksum: the whole decode reads the missing bytes as zero.
        const cut = entry.subarray(0, entry.length - 2)
        const whole = await salvageRisuSave(cut).then((value) => ({ ok: true as const, value }), () => ({ ok: false as const }))
        const outcome = await run(cut, 50)
        if (whole.ok) {
            expectDone(outcome)
            expect(Array.from(outcome.omitted ?? [])).toEqual(Array.from(whole.value.omitted))
        } else {
            expect('status' in outcome.result).toBe(true)
        }
    })
})

describe('block layouts the stream declines (T-A5)', () => {
    async function file(): Promise<Uint8Array> {
        return await v1Database(3, false)
    }

    test('the root may sit anywhere: first as the encoder writes it, in the middle or last, a damaged block after it included', async () => {
        const entry = await file()
        const blocks = parseBlocks(entry)
        const root = blocks.find((block) => block.name === 'root') as RawBlock
        const others = blocks.filter((block) => block !== root)
        for (let at = 0; at <= others.length; at++) {
            const moved = assemble(entry, [...others.slice(0, at), root, ...others.slice(at)])
            await expectBlocksEquivalent(moved, [undefined, 97])
            await expectBlocksEquivalent(breakDataChecksum(moved, 'v1-1'), [undefined])
        }
    })

    test('a REMOTE block and a ROOT_COMPONENT block', async () => {
        const entry = await file()
        expectDecline(await run(retypeBlock(entry, 'v1-0', BLOCK_TYPE.remote)), 'blocks')
        expectDecline(await run(retypeBlock(entry, 'v1-0', BLOCK_TYPE.rootComponent)), 'blocks')
    })

    test('two ROOT blocks, and a file with no usable root', async () => {
        const entry = await file()
        expectDecline(await run(retypeBlock(entry, 'v1-0', BLOCK_TYPE.root)), 'blocks')
        expectDecline(await run(breakDataChecksum(entry, 'root')), 'blocks')
        expectDecline(await run(assemble(entry, parseBlocks(entry).filter((block) => block.name !== 'root'))), 'blocks')
    })

    test('a root that holds characters', async () => {
        const entry = await file()
        const blocks = parseBlocks(entry)
        const root = blocks.find((block) => block.name === 'root') as RawBlock
        const value = JSON.parse(new TextDecoder().decode(root.payload)) as Record<string, unknown>
        root.payload = json({ ...value, characters: [{ chaId: 'in-root' }] })
        root.compression = 0
        root.storedDataChecksum = undefined
        expectDecline(await run(assemble(entry, blocks)), 'blocks')
    })

    test('a header checksum that does not match, a block that claims more than the entry holds and an unknown version', async () => {
        const entry = await file()
        const badHeader = entry.slice()
        badHeader[9 + 3] ^= 0xff
        expectDecline(await run(badHeader), 'blocks')
        const long = entry.slice(0, entry.length - 40)
        expectDecline(await run(long), 'blocks')
        const version = entry.slice()
        version[8] = 7
        expectDecline(await run(version), 'blocks')
    })
})

describe('reads (T-A6, the seam half)', () => {
    test('every read of the entry is at most the chunk size, and in file order', async () => {
        const entry = await libraryEntry('compressed')
        const outcome = await run(entry, 1000)
        expectDone(outcome)
        const { entry: indexed, slices } = outcome.stub
        const start = indexed.headerOffset + indexed.headerLength
        const dataReads = slices.filter(([from]) => from >= start)
        expect(dataReads.length).toBe(Math.ceil(entry.length / 1000))
        for (const [from, to] of dataReads) {
            expect(to - from).toBeLessThanOrEqual(1000)
        }
        expect(dataReads.map(([from]) => from)).toEqual([...dataReads.map(([from]) => from)].sort((a, b) => a - b))
        expect(dataReads[dataReads.length - 1][1]).toBe(start + entry.length)
    })

    test('the yield is awaited after every chunk and every character', async () => {
        const entry = await libraryEntry('raw')
        const outcome = await run(entry, 2000)
        expectDone(outcome)
        expect(outcome.yields.mock.calls.length).toBeGreaterThanOrEqual(Math.ceil(entry.length / 2000) + outcome.characters.length)
    })

    test('a short chunk is a changed file (length), and a rejected read is unreadable', async () => {
        const entry = await libraryEntry('compressed')
        const first = stubOf(entry).entry.headerOffset + stubOf(entry).entry.headerLength
        for (const kind of ['compressed', 'raw', 'stream'] as const) {
            const data = await libraryEntry(kind)
            const at = first + 1500
            await expect(run(data, 1000, { shortFrom: at })).rejects.toMatchObject({ name: 'BinFileChangedError', reason: 'length' })
            await expect(run(data, 1000, { rejectFrom: at })).rejects.toMatchObject({ name: 'BinFileChangedError', reason: 'unreadable' })
        }
        await expect(run(v0Database([character('a')]), 10, { shortFrom: first + 30 })).rejects.toBeInstanceOf(BinFileChangedError)
    })

    test('a header that is not what the walk indexed is a changed file, before any data is read', async () => {
        const entry = await libraryEntry('raw')
        const stub = stubOf(entry)
        const sink: BinStreamSink = { character: vi.fn(), root: vi.fn(), omitted: vi.fn() }
        await expect(streamBinDatabase(stub.file, { ...stub.entry, dataLength: entry.length + 1 }, sink, { yieldToMain: async () => { } }))
            .rejects.toMatchObject({ reason: 'header' })
        expect(sink.character).not.toHaveBeenCalled()
        expect(stub.slices.every(([from, to]) => to - from <= stub.entry.headerLength)).toBe(true)
    })

    test('an error the sink throws propagates, whichever format is read, and does not hang', async () => {
        const failure = new Error('sink refused')
        for (const entry of [await libraryEntry('raw'), await libraryEntry('compressed'), await libraryEntry('stream'), await v1Database(3, true)]) {
            await expect(run(entry, 3000, {}, { character: async () => { throw failure } })).rejects.toBe(failure)
            await expect(run(entry, 3000, {}, { root: async () => { throw failure } })).rejects.toBe(failure)
        }
    })

    test('a declined stream has not called root or omitted', async () => {
        const outcome = await run(msgpackEntry('raw', concat(mpFixMap([['characters', mpFixArray([])]]), MP_NIL)))
        expectDecline(outcome, 'trailing')
        expect(outcome.root).toBeNull()
        expect(outcome.omitted).toBeNull()
    })
})

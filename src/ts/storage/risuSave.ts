import { Packr, Unpackr, decode } from "msgpackr/index-no-eval";
import * as fflate from "fflate";
import { presetTemplate, type Database } from "./database.svelte";
import localforage from "localforage";
import { getAppStore } from "./store/appStore"
import { assertNoModuleStubs } from "./moduleStub"

const packr = new Packr({
    useRecords:false
});

const unpackr = new Unpackr({
    int64AsType: 'number',
    useRecords:false
})

/**
 * Content-addressing hash of a remote character block, as the name of the
 * `remotes/` file a v2 pointer names. The application writes no remote block;
 * the hash is what a reader checks a pointer's file against.
 * Truncated to 16 hex chars (64 bits) — ample collision resistance for a
 * per-character, per-user keyspace, keeps filenames short. Deliberately a
 * small local helper rather than reusing `hasher()` from
 * `src/ts/parser/parser.svelte.ts` (also SHA-256-based, same convention
 * `saveAsset()` already established for asset addressing) — importing that
 * module here would pull in its large, UI-adjacent dependency graph for no
 * benefit, since the hashing itself is a three-line primitive already used
 * inline in several other files in this codebase (e.g. mcplib.ts,
 * filesystemclient.ts).
 */
export async function hashRemoteBlockContent(data: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16)
}

const magicHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7]);
const magicCompressedHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8]);
const magicStreamCompressedHeader = new Uint8Array([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 9]);
// The 9th byte doubles as a format-version marker within the "RISUSAVE"
// block format: 0 = original (no per-block checksum trailer), 1 = adds a
// 4-byte CRC32 trailer to every block (see RisuSaveDecoder
// below) so a bit-flip inside a block parses as corrupted instead of
// silently becoming wrong-but-valid-looking data. `magicRisuSavePrefix` (the
// first 8 bytes only, version-independent) is what identifies a buffer as
// this block format at all; checkHeader() uses it so old (v1) saves keep
// decoding exactly as before, while new writes always use v2.
const magicRisuSavePrefix = new TextEncoder().encode("RISUSAVE");
const magicRisuSaveHeaderV2 = new TextEncoder().encode("RISUSAVE\x01");

const crc32Table = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
        }
        table[n] = c
    }
    return table
})()

/** Standard CRC-32 (IEEE 802.3) — cheap, sync, and enough to catch a bit-flip. */
function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < data.length; i++) {
        crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
}

/** Reads a little-endian uint32 out of `data` at `offset`, copying first to avoid TypedArray alignment issues on an arbitrary offset. */
function readUint32LE(data: Uint8Array, offset: number): number {
    const buf = new ArrayBuffer(4)
    new Uint8Array(buf).set(data.slice(offset, offset + 4))
    return new Uint32Array(buf)[0]
}

/**
 * Thrown for a block-parsing failure that must abort decoding entirely
 * rather than being silently skipped (RisuSaveDecoder's raw byte-parsing
 * loop otherwise treats every per-block error as "drop this one block and
 * keep going" — appropriate for a corrupted character or module, but not for
 * the root block, whose __directory field is what makes every other
 * directory-cached block loadable at all).
 */
export class CriticalBlockError extends Error {}


export async function checkCompressionStreams(){
    if(typeof CompressionStream === 'undefined'){
        const {makeCompressionStream} = await import('compression-streams-polyfill/ponyfill');
        //@ts-expect-error polyfill CompressionStream type is incompatible with globalThis.CompressionStream
        globalThis.CompressionStream = makeCompressionStream(TransformStream);
    }
    if(typeof DecompressionStream === 'undefined'){
        const {makeDecompressionStream} = await import('compression-streams-polyfill/ponyfill');
        //@ts-expect-error polyfill DecompressionStream type is incompatible with globalThis.DecompressionStream
        globalThis.DecompressionStream = makeDecompressionStream(TransformStream);
    }
}

/**
 * The packr keeps the buffer its last encode grew to until another encode replaces it. Called once the encoded
 * bytes have been copied or compressed away, this hands it a small one, so a finished export's whole encoding
 * does not stay reachable from the encoder. It changes no byte of any encoding.
 */
function releasePackrBuffer(){
    // Installs the same kind of buffer msgpackr allocates for itself, because its encoder picks the long-string path by
    // the target's type (`utf8Write` on Node's Buffer, `encodeInto` otherwise). This relies on the Buffer polyfill, where
    // there is one, being installed before msgpackr loads, so that both see the same `Buffer`.
    packr.useBuffer(typeof Buffer !== 'undefined' ? Buffer.allocUnsafeSlow(8192) : new Uint8Array(8192))
}

export function encodeRisuSaveLegacy(data:any, compression:'noCompression'|'compression' = 'noCompression'){
    assertNoModuleStubs(data?.modules, 'encodeRisuSaveLegacy')
    try{
        let encoded:Uint8Array = packr.encode(data)
        if(compression === 'compression'){
            // mtime 0 keeps the gzip header free of the wall clock, so the same save always encodes to the same bytes.
            encoded = fflate.compressSync(encoded, { mtime: 0 })
            const result = new Uint8Array(encoded.length + magicCompressedHeader.length);
            result.set(magicCompressedHeader, 0)
            result.set(encoded, magicCompressedHeader.length)
            return result
        }
        else{
            const result = new Uint8Array(encoded.length + magicHeader.length);
            result.set(magicHeader, 0)
            result.set(encoded, magicHeader.length)
            return result
        }
    }
    finally{
        releasePackrBuffer()
    }
}

export async function encodeRisuSaveCompressionStream(data:any) {
    assertNoModuleStubs(data?.modules, 'encodeRisuSaveCompressionStream')
    await checkCompressionStreams()
    try{
        let encoded:Uint8Array = packr.encode(data)
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        writer.write(encoded as any);
        writer.close();
        const buf = await new Response(cs.readable).arrayBuffer()
        const result = new Uint8Array(new Uint8Array(buf).length + magicStreamCompressedHeader.length);
        result.set(magicStreamCompressedHeader, 0)
        result.set(new Uint8Array(buf), magicStreamCompressedHeader.length)
        return result
    }
    finally{
        releasePackrBuffer()
    }
}

/** msgpackr writes every plain object as a map 16 (`0xde` + u16 key count), so a root of this many keys or more is not split. */
const PARTS_MAP16_KEY_LIMIT = 0x10000

/** The map header msgpackr writes for a plain object of `count` keys (`count` below `PARTS_MAP16_KEY_LIMIT`). */
function msgpackMapHeader(count:number):Uint8Array{
    return Uint8Array.of(0xde, count >> 8, count & 0xff)
}

/** The array header msgpackr writes for `length` elements: fixarray below 16, array 16 below 65536, array 32 at 65536 or more. */
function msgpackArrayHeader(length:number):Uint8Array{
    if(length < 0x10){
        return Uint8Array.of(0x90 | length)
    }
    if(length < 0x10000){
        return Uint8Array.of(0xdc, length >> 8, length & 0xff)
    }
    return Uint8Array.of(0xdd, length >>> 24, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff)
}

/**
 * Whether msgpackr writes `data` as a map of its `for...in` keys: it takes that path only when `data.constructor` is
 * `Object` (so an object inheriting `Object` through a prototype counts, and an own or inherited `constructor` key
 * that is not `Object`, a class instance, a Map, an Array or a null-prototype object does not).
 */
function isMsgpackPlainObjectRoot(data:object):boolean{
    return !!data && (data as { constructor?: unknown }).constructor === Object
}

function* generateRisuSaveParts(data:object):Generator<Uint8Array, void, undefined>{
    try{
        const keys:string[] = []
        const splittable = isMsgpackPlainObjectRoot(data)
        if(splittable){
            for(const key in data){
                keys.push(key)
            }
        }
        if(!splittable || keys.length >= PARTS_MAP16_KEY_LIMIT){
            yield packr.encode(data)
            return
        }
        yield msgpackMapHeader(keys.length)
        // The keys were listed above and every value is read once, here, so the caller must not change the tree between
        // pieces.
        const root = data as Record<string, unknown>
        for(const key of keys){
            yield packr.encode(key)
            const value = root[key]
            if(Array.isArray(value)){
                const length = value.length
                yield msgpackArrayHeader(length)
                for(let i = 0; i < length; i++){
                    yield packr.encode(value[i])
                }
            }
            else{
                yield packr.encode(value)
            }
        }
    }
    finally{
        releasePackrBuffer()
    }
}

/**
 * The msgpack of `data` as pieces whose concatenation equals `packr.encode(data)` byte for byte, so a consumer can
 * compress an export without holding the whole encoding. A piece may be a view of the packr's buffer, valid until the
 * next piece is requested; the buffer is released when the generator ends or is abandoned with `return()`.
 *
 * `data` is typed `object` because the root is any value `packr.encode` accepts as a tree (a plain object normally; a
 * Map, an Array or a class instance falls back to one whole encode) while a primitive root is not a save.
 *
 * Plain function, not a generator, so checks added here (the module stub refusal) run at the call and not at the first
 * `next()`.
 */
export function encodeRisuSaveParts(data:object):Generator<Uint8Array, void, undefined>{
    // Reads `modules` as a property, like the other encoders: what a Map root or a `toJSON` root encodes is not checked.
    assertNoModuleStubs((data as { modules?: unknown }).modules, 'encodeRisuSaveParts')
    return generateRisuSaveParts(data)
}

/** The uncompressed msgpack size at which the gzip trailer's 32-bit ISIZE field wraps; an export this large fails, as `packr.encode` does at 4 GiB. */
const GZIP_SINK_UNCOMPRESSED_LIMIT = 2 ** 32

/** Largest slice handed to fflate in one push. fflate grows its internal input buffer only when the pushed chunk plus the bytes already buffered exceeds 163840, and keeps that size until the final push; slices of at most 65536 bytes keep it from ever growing. */
const GZIP_SINK_SLICE_BYTES = 65536

/** Compressed output is gathered into blocks of this many bytes (the last may be smaller), so a writer receives few large pieces. */
const GZIP_SINK_BLOCK_BYTES = 1024 * 1024

/**
 * The compressed `database.risudat` data as pieces to write in order, `pieces[0]` being the 11-byte header. `length` is
 * the sum of the piece lengths, the value the entry's length field holds.
 */
export type StreamedRisuSave = {
    length: number
    pieces: Uint8Array[]
}

export interface RisuSaveGzipSink {
    push(piece: Uint8Array): void
    finish(): StreamedRisuSave
}

/**
 * A sink that compresses msgpack pieces into one gzip member and holds only the compressed output. `push` reads a piece
 * before returning, so a piece that is a view of the packr's buffer may be overwritten right after. `finish` makes the
 * final push and returns the header piece followed by the compressed blocks, none of which the sink writes to again.
 * Compressed bytes come out of fflate as a fresh array per call, so they are copied once, into the block being gathered.
 *
 * Contract of the producer: it owns the consistency of the tree it is reading between pushes (a producer that awaits
 * must re-establish what `encodeDatabaseWithLateColdStorage` relies on), and it owns the refusal to encode a tree that
 * holds a module stub (`encodeRisuSaveStreamed` gets it from the parts encoder's wrapper; any other producer must do the
 * same before its first push). The sink checks only the size.
 *
 * `limit` is a parameter so a test can reach the oversize error with a small input; callers use the default.
 */
export function createRisuSaveGzipSink(limit: number = GZIP_SINK_UNCOMPRESSED_LIMIT): RisuSaveGzipSink {
    const blocks: Uint8Array[] = []
    let staging = new Uint8Array(GZIP_SINK_BLOCK_BYTES)
    let used = 0
    let total = 0
    let finished = false
    const gzip = new fflate.Gzip({ mtime: 0 }, (chunk) => {
        let offset = 0
        while(offset < chunk.length){
            const take = Math.min(chunk.length - offset, staging.length - used)
            staging.set(chunk.subarray(offset, offset + take), used)
            used += take
            offset += take
            if(used === staging.length){
                // A full block leaves the sink here; the next bytes go to a new buffer.
                blocks.push(staging)
                staging = new Uint8Array(GZIP_SINK_BLOCK_BYTES)
                used = 0
            }
        }
    })
    return {
        push(piece){
            if(finished){
                throw new Error('database.risudat sink already finished')
            }
            total += piece.length
            if(total >= limit){
                throw new Error(`The database (database.risudat) is too large to export: its uncompressed size reaches the limit of ${limit} bytes.`)
            }
            for(let offset = 0; offset < piece.length; offset += GZIP_SINK_SLICE_BYTES){
                gzip.push(piece.subarray(offset, offset + GZIP_SINK_SLICE_BYTES))
            }
        },
        finish(){
            if(finished){
                throw new Error('database.risudat sink already finished')
            }
            finished = true
            gzip.push(new Uint8Array(0), true)
            if(used > 0){
                blocks.push(staging.slice(0, used))
            }
            // A fresh copy, so no piece handed out aliases the module constant.
            const pieces = [Uint8Array.from(magicCompressedHeader), ...blocks]
            let length = 0
            for(const piece of pieces){
                length += piece.length
            }
            return { length, pieces }
        },
    }
}

/**
 * `encodeRisuSaveLegacy(data, 'compression')` as pieces: the parts encoder's msgpack goes through one gzip member
 * without being held whole, and only the compressed output is kept. Synchronous, so the tree cannot change between
 * pieces. The inflated bytes equal the legacy encoding's; the compressed bytes may differ.
 */
export function encodeRisuSaveStreamed(data: object): StreamedRisuSave {
    const parts = encodeRisuSaveParts(data)
    const sink = createRisuSaveGzipSink()
    for(const piece of parts){
        sink.push(piece)
    }
    return sink.finish()
}

export type toSaveType = {
    character: string[];
    chat: [string, string][];
    botPreset: boolean;
    modules: boolean;
    loadouts: boolean;
    plugins: boolean;
    pluginCustomStorage: boolean;
}

export enum RisuSaveType {
    CONFIG = 0,
    ROOT = 1,
    CHARACTER_WITH_CHAT = 2,
    CHAT = 3,
    BOTPRESET = 4,
    MODULES = 5,
    REMOTE = 6,
    CHARACTER_WITHOUT_CHAT = 7,
    ROOT_COMPONENT = 8,
    PLUGINS = 9,
    LOADOUTS = 10,
    PLUGIN_STORAGE = 11,
    KV = 12,
}

/** Upstream names each SaveKV namespace block `kv:<namespace>`. */
export const KV_BLOCK_PREFIX = 'kv:'
const KV_FIELD = 'upstreamKvBlocks'

const risuSaveCacheForage = localforage.createInstance({
    name: 'risuSaveCache'
});

/** One block's framing fields, as `parseBlockHeader` reads them. */
export interface BlockHeader {
    type: RisuSaveType;
    compression: boolean;
    name: string;
    /** The payload's byte length. Not yet checked against the buffer. */
    length: number;
    /** The offset of the first payload byte. */
    dataStart: number;
}

/**
 * Reads the framing of the block that starts at `blockStart` (type,
 * compression flag, name, payload length) and, for a checksummed file, verifies
 * the header checksum before the length is trusted: if type, compression, name
 * or length were corrupted, no later block can be located either, so a mismatch
 * aborts decoding with a `CriticalBlockError` rather than being skipped. Does
 * not check that the payload fits in `data`, and does not look at the payload.
 */
export function parseBlockHeader(data: Uint8Array,blockStart: number, hasChecksums: boolean): BlockHeader {
    let offset = blockStart;
    const type = data[offset];
    const compression = data[offset + 1] === 1;
    offset += 2;

    const nameLength = data[offset];
    offset += 1;
    const name = new TextDecoder().decode(data.subarray(offset, offset + nameLength));
    offset += nameLength;

    const newArrayBuf = new ArrayBuffer(4);
    const lengthSubUint8Buf = data.slice(offset, offset + 4);
    new Uint8Array(newArrayBuf).set(lengthSubUint8Buf);
    const length = new Uint32Array(newArrayBuf)[0];
    offset += 4;

    if (hasChecksums) {
        // Verified BEFORE `length` is trusted enough to slice out
        // `data` — if type/compression/name/length were
        // corrupted, we cannot know where this block (or
        // any later one) actually ends, so this must abort
        // decoding entirely rather than continue at a
        // now-unreliable offset.
        const headerSpan = data.subarray(blockStart, offset);
        const storedHeaderChecksum = readUint32LE(data, offset);
        offset += 4;
        const actualHeaderChecksum = crc32(headerSpan);
        if (actualHeaderChecksum !== storedHeaderChecksum) {
            throw new CriticalBlockError(`Header checksum mismatch for block at offset ${blockStart} (claimed name "${name}", type ${type}) — this block's framing is corrupted; cannot safely continue decoding.`);
        }
    }
    return { type, compression, name, length, dataStart: offset };
}

/** One block of an encoded save: its framing fields and a view (not a copy) of its payload. */
export interface EncodedBlockView {
    type: RisuSaveType;
    compression: boolean;
    name: string;
    data: Uint8Array;
}

/**
 * The blocks of a block-format save (header version 1, every block
 * checksummed), in file order, as views into `data`. Read-only: no payload is
 * decompressed, parsed or copied, and no remote file or block cache is read.
 * Verifies each block's header checksum and that each block fits in the buffer;
 * payload checksums are not recomputed. Throws on any other file.
 */
export function listEncodedBlocks(data: Uint8Array): EncodedBlockView[] {
    if (
        data.length < magicRisuSaveHeaderV2.length ||
        magicRisuSaveHeaderV2.some((byte, i) => data[i] !== byte)
    ) {
        throw new Error('Not a checksummed RisuSave block file.');
    }
    const blocks: EncodedBlockView[] = [];
    let offset = magicRisuSaveHeaderV2.length;
    while (offset < data.length) {
        const header = parseBlockHeader(data, offset, true);
        const dataEnd = header.dataStart + header.length;
        // The payload plus its own 4-byte checksum must fit.
        if (dataEnd + 4 > data.length) {
            throw new Error(`Block "${header.name}" (type ${header.type}) claims a length of ${header.length} bytes, which exceeds the remaining buffer.`);
        }
        blocks.push({
            type: header.type,
            compression: header.compression,
            name: header.name,
            data: data.subarray(header.dataStart, dataEnd),
        });
        offset = dataEnd + 4;
    }
    return blocks;
}

/**
 * What a block that `salvageRisuSave` could not use held:
 * - `character`: one character (an inline block, a remote pointer, or a block
 *   named by the directory that is not one of the fixed block names);
 * - `presets`, `modules`, `loadouts`, `plugins`, `pluginStorage`: the whole
 *   kind, each of which is one block;
 * - `ignored`: the config block, whose content the decoder discards in every
 *   mode;
 * - `other`: a block of a type this reader does not know, or any block no
 *   other kind names.
 */
export type SalvageOmittedKind = 'character' | 'presets' | 'modules' | 'loadouts' | 'plugins' | 'pluginStorage' | 'chats' | 'ignored' | 'other'

export interface SalvageOmittedBlock {
    kind: SalvageOmittedKind
    /** The failure's message, for diagnostics only. */
    reason: string
}

export function salvageKindOfType(type: RisuSaveType): SalvageOmittedKind {
    switch (type) {
        case RisuSaveType.CHARACTER_WITH_CHAT:
        case RisuSaveType.CHARACTER_WITHOUT_CHAT:
        case RisuSaveType.REMOTE:
            return 'character'
        case RisuSaveType.BOTPRESET:
            return 'presets'
        case RisuSaveType.MODULES:
            return 'modules'
        case RisuSaveType.LOADOUTS:
            return 'loadouts'
        case RisuSaveType.PLUGINS:
            return 'plugins'
        case RisuSaveType.PLUGIN_STORAGE:
            return 'pluginStorage'
        case RisuSaveType.CONFIG:
            return 'ignored'
        default:
            return 'other'
    }
}

/** The kind of a block known only by its directory name. */
function salvageKindOfName(name: string): SalvageOmittedKind {
    switch (name) {
        case 'preset':
            return 'presets'
        case 'modules':
        case 'loadouts':
        case 'plugins':
        case 'pluginStorage':
            return name
        case 'config':
            return 'ignored'
        default:
            // An upstream SaveKV namespace is not a character.
            return name.startsWith(KV_BLOCK_PREFIX) ? 'other' : 'character'
    }
}

/**
 * A strict decode could not read a remote file the save points at. The store failing says nothing about whether the file
 * decodes, so a caller that falls back to another copy on a decode failure must not do so for this. The message is the
 * original error's; the original is `cause`.
 */
export class RisuSaveReadError extends Error {
    constructor(public readonly fileName: string, cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause), { cause })
        this.name = 'RisuSaveReadError'
    }
}

/**
 * One block as the first half of a decode leaves it: framed, checked and decompressed, its payload as text.
 * `delivered` marks a character block a streaming reader already parsed and handed to its consumer; `failure` is the
 * parse error such a block must raise when the assembly reaches it, and the block's `content` is no longer used.
 */
export interface DecodedBlock {
    name: string;
    type: RisuSaveType;
    compression: boolean;
    content: string;
    delivered?: { failure?: unknown };
}

export class RisuSaveDecoder {
    private blocks: DecodedBlock[] = []
    // Whether every block in `data` carries a trailing 4-byte CRC32 (format
    // version 2 — see the magicRisuSaveHeaderV2 comment above). Set by
    // decodeRisuSave() from the file's own header byte before construction,
    // so old (v1) saves are decoded exactly as before — no checksum bytes to
    // read, nothing new to verify — while new (v2) saves get verified.
    // `strict` makes the decode all-or-nothing for callers that must not act on
    // a partial reading of the file: any block that is dropped, unparseable,
    // of an unknown type, or that names a remote file or a directory entry
    // which cannot be read from the file itself, rejects the whole decode. No
    // block is ever answered from the block cache in this mode.
    // Every non-strict mode records each block it cannot use in `omitted`,
    // keyed by block name; recording never changes what is installed.
    // `salvage` differs from the default mode only by never consulting the
    // block cache. In the default mode a block the cache stands in for is not
    // recorded: it is in the tree. Framing, root and version failures still
    // throw. `salvage` is set only by `salvageRisuSave`; it is exclusive with
    // `strict`.
    readonly omitted = new Map<string, SalvageOmittedBlock>();
    constructor(private hasChecksums: boolean = false, private strict: boolean = false, private salvage: boolean = false) {}

    /** Records the first reason a block of this name could not be used; later reasons for the same name are dropped. */
    recordOmitted(name: string, kind: SalvageOmittedKind, error: unknown) {
        if (!this.omitted.has(name)) {
            this.omitted.set(name, { kind, reason: error instanceof Error ? error.message : String(error) });
        }
    }

    // A block of a type this reader cannot use: strict rejects the decode, every other mode records it as `other` and
    // drops it.
    private refuseUnknownBlock(block: { name: string, type: RisuSaveType }) {
        if(this.strict){
            throw new Error(`Not Implemented RisuSaveType: ${block.type} for ${block.name}`);
        }
        this.recordOmitted(block.name, 'other', new Error(`Not Implemented RisuSaveType: ${block.type} for ${block.name}`));
        console.warn(`Not Implemented RisuSaveType: ${block.type} for ${block.name}`);
    }

    async decode(data: Uint8Array): Promise<Database> {
        console.log('Decoding RisuSave data');
        let offset = magicRisuSaveHeaderV2.length;
        const loadedBlocks = new Set<string>();
        // The `upstreamKvBlocks` rule, independent of block order: when the file has any `kv:` block (decoded,
        // damaged or unreadable, or merely named by the directory), the namespaces decoded from those blocks are the
        // whole field, and the value root holds is discarded, so a block that failed never leaves a stale copy
        // behind. Only a file with no `kv:` block keeps root's value. A namespace in two blocks takes the last.
        let kvBlockSeen = false;
        while (offset < data.length) {
            const blockStart = offset;
            let framed: { name: string, type: RisuSaveType } | null = null;
            try {
                const header = parseBlockHeader(data, blockStart, this.hasChecksums);
                const { type, compression, name, length } = header;
                framed = { name, type };
                if(type === RisuSaveType.KV && name.startsWith(KV_BLOCK_PREFIX)){
                    kvBlockSeen = true;
                }
                offset = header.dataStart;

                if (offset + length > data.length) {
                    throw new CriticalBlockError(`Block "${name}" (type ${type}) claims a length of ${length} bytes, which exceeds the remaining buffer — framing is corrupted; cannot safely continue decoding.`);
                }
                let blockData = data.subarray(offset, offset + length);
                offset += length;

                if (this.hasChecksums) {
                    // Covers only the payload, now that the header checksum
                    // above has confirmed block boundaries are intact — a
                    // mismatch here means just THIS block's own content is
                    // corrupted, and it's safe to drop only this block and
                    // keep decoding the rest of the file.
                    const storedDataChecksum = readUint32LE(data, offset);
                    offset += 4;
                    const actualDataChecksum = crc32(blockData);
                    if (actualDataChecksum !== storedDataChecksum) {
                        throw new Error(`Data checksum mismatch for block "${name}" (type ${type}): expected ${storedDataChecksum}, got ${actualDataChecksum} — this block's content is corrupted.`);
                    }
                }

                if (compression) {
                    //decode using DecompressionStream
                    await checkCompressionStreams();
                    const cs = new DecompressionStream('gzip');
                    const writer = cs.writable.getWriter();
                    // A payload that is not valid gzip errors the stream; that
                    // failure reaches this block's catch through the read below,
                    // so the write and close results are not left to reject on
                    // their own.
                    writer.write(blockData as any).catch(() => {});
                    writer.close().catch(() => {});
                    const buf = await new Response(cs.readable).arrayBuffer();
                    blockData = new Uint8Array(buf);
                }

                loadedBlocks.add(name);
                this.blocks.push({
                    name,
                    type,
                    compression,
                    content: new TextDecoder().decode(blockData)
                })   
            } catch (error) {
                if (error instanceof CriticalBlockError || this.strict) {
                    throw error
                }
                if (framed) {
                    // Removed again by `assembleBlocks` when the block cache stands in for this block.
                    this.recordOmitted(framed.name, salvageKindOfType(framed.type), error);
                }
                continue
            }
        }
        return await this.assembleBlocks(this.blocks, loadedBlocks, kvBlockSeen);
    }

    /**
     * The second half of a decode: assembles the database from the blocks the first half framed, checked and
     * decompressed, in block order. `loadedBlocks` names every block that was read, and `kvBlockSeen` says whether any
     * `kv:` block was framed, readable or not. A block with `delivered` set is a character that was already parsed and
     * handed out; it adds its `characters` slot but no character, and rethrows its parse failure at its place.
     */
    async assembleBlocks(blocks: DecodedBlock[], loadedBlocks: Set<string>, kvBlockSeenInBlocks: boolean): Promise<Database> {
        this.blocks = blocks;
        let kvBlockSeen = kvBlockSeenInBlocks;
        //@ts-expect-error Database has required fields, but we initialize empty and populate incrementally during decode
        let db:Database = {}
        let rootKv: unknown = undefined;
        let directory: string[] = []
        // Tracked instead of trusting "some block claimed type ROOT and
        // reached this switch case" alone — a bit-flip in a block's type
        // byte can redirect a completely different (still checksum-valid,
        // since the checksum only proves internal self-consistency, not that
        // `type` is what it was originally written as) block into looking
        // like ROOT, or vice versa. Requiring this to actually flip true —
        // i.e. a block that both claims ROOT and successfully JSON.parses —
        // before returning is what actually closes that gap, not the
        // per-block checksum alone.
        let rootProcessed = false;
        for(let i = 0; i < this.blocks.length; i++){
            const key = i;
            try {
                switch(this.blocks[key].type){
                    case RisuSaveType.ROOT:{
                        const rootData = JSON.parse(this.blocks[key].content);
                        rootProcessed = true;
                        for(const rootKey in rootData){
                            if(rootKey === KV_FIELD){
                                rootKv = rootData[rootKey];
                            }
                            else if(!db[rootKey] && !rootKey.startsWith('__')){
                                db[rootKey] = rootData[rootKey];
                            }
                            if(rootKey === '__directory'){
                                directory = rootData[rootKey];
                                for(const dirKey of directory){
                                    if(dirKey.startsWith(KV_BLOCK_PREFIX)){
                                        kvBlockSeen = true;
                                    }
                                    if(!loadedBlocks.has(dirKey)){
                                        if(this.strict){
                                            throw new Error(`Directory block "${dirKey}" is not present in the file.`);
                                        }
                                        if(this.salvage){
                                            this.recordOmitted(dirKey, salvageKindOfName(dirKey), new Error(`Directory block "${dirKey}" is not present in the file.`));
                                            continue;
                                        }
                                        try {
                                            console.log(`Loading directory block ${dirKey} from cache`);
                                            const dirData:{
                                                type:RisuSaveType
                                                data:string
                                                name:string
                                            } = await risuSaveCacheForage.getItem(`risuSaveBlock_${dirKey}`) as any;

                                            if(dirData){
                                                this.blocks.push({
                                                    name: dirData.name,
                                                    type: dirData.type,
                                                    compression: false,
                                                    content: dirData.data
                                                });
                                                loadedBlocks.add(dirKey);
                                                // A block the cache stands in for is in the tree, so it is not missing; this also
                                                // clears the record the framing failure of the same block made.
                                                this.omitted.delete(dirKey);
                                            }
                                            else{
                                                this.recordOmitted(dirKey, salvageKindOfName(dirKey), new Error(`Directory block "${dirKey}" is not present in the file or the block cache.`));
                                            }
                                        } catch (error) {
                                            console.error(`Error loading directory block ${dirKey}:`, error);
                                            this.recordOmitted(dirKey, salvageKindOfName(dirKey), error);
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                    case RisuSaveType.CHARACTER_WITH_CHAT:
                    case RisuSaveType.CHARACTER_WITHOUT_CHAT:{
                        db.characters ??= [];
                        const delivered = this.blocks[key].delivered;
                        if(delivered === undefined){
                            const character = JSON.parse(this.blocks[key].content);
                            db.characters.push(character);
                        }
                        else if(delivered.failure !== undefined){
                            throw delivered.failure;
                        }
                        break
                    }
                    case RisuSaveType.BOTPRESET:{
                        db.botPresets = JSON.parse(this.blocks[key].content);
                        break;
                    }
                    case RisuSaveType.MODULES:{
                        db.modules = JSON.parse(this.blocks[key].content);
                        break;
                    }
                    case RisuSaveType.CONFIG:{
                        //ignore for now
                        break;
                    }
                    case RisuSaveType.PLUGINS:{
                        db.plugins = JSON.parse(this.blocks[key].content);
                        break;
                    }
                    case RisuSaveType.LOADOUTS:{
                        db.loadouts = JSON.parse(this.blocks[key].content);
                        break;
                    }
                    case RisuSaveType.PLUGIN_STORAGE:{
                        // An empty block is how an absent field is written: JSON.stringify(undefined) returns undefined, which TextEncoder writes as zero bytes.
                        if(this.blocks[key].content !== ''){
                            db.pluginCustomStorage = JSON.parse(this.blocks[key].content);
                        }
                        break;
                    }
                    case RisuSaveType.REMOTE:{
                        const remoteInfo:{
                            v:number
                            type:RisuSaveType
                            name:string
                            hash?:string
                        } = JSON.parse(this.blocks[key].content);
                        // v1 pointers (pre-Stage-3a saves) name a stable,
                        // mutable file; v2 pointers name a content-addressed,
                        // immutable one. An unrecognized version, or a v2
                        // pointer missing its hash, is treated the same way
                        // this format already treats other corruption —
                        // don't guess, skip this block cleanly (the per-block
                        // checksum already protects the JSON payload itself,
                        // so this can only happen from a genuine encoder bug,
                        // not byte-level corruption — still fail closed).
                        let fileName: string
                        if(remoteInfo.v === 2 && remoteInfo.hash){
                            fileName = `remotes/${remoteInfo.name}.${remoteInfo.hash}.bin`
                        }
                        else if(remoteInfo.v === 1){
                            fileName = `remotes/${remoteInfo.name}.local.bin`
                        }
                        else{
                            if(this.strict){
                                throw new Error(`Remote pointer for "${remoteInfo.name}" has an unrecognized version (${remoteInfo.v}) or a v2 pointer missing its hash.`);
                            }
                            this.recordOmitted(this.blocks[key].name, 'character', new Error(`Remote pointer for "${remoteInfo.name}" has an unrecognized version (${remoteInfo.v}) or a v2 pointer missing its hash.`));
                            if(this.salvage){
                                break;
                            }
                            console.warn(`Remote pointer for "${remoteInfo.name}" has an unrecognized version (${remoteInfo.v}) or a v2 pointer missing its hash; skipping.`);
                            break;
                        }
                        // A key the store does not hold is a missing block,
                        // handled below; a read that fails for any other
                        // reason throws in strict mode and is skipped,
                        // with the failure logged, otherwise.
                        let remoteData:Uint8Array|null = null
                        try {
                            remoteData = (await (await getAppStore()).read(fileName)).bytes;
                        } catch (error) {
                            if(this.strict){
                                throw new RisuSaveReadError(fileName, error);
                            }
                            this.recordOmitted(this.blocks[key].name, 'character', error);
                            if(this.salvage){
                                break;
                            }
                            console.error(`Error reading remote file ${fileName}:`, error);
                        }

                        if(!remoteData){
                            if(this.strict){
                                throw new Error(`Remote file ${fileName} not found.`);
                            }
                            this.recordOmitted(this.blocks[key].name, 'character', new Error(`Remote file ${fileName} not found.`));
                            if(this.salvage){
                                break;
                            }
                            console.warn(`Remote file ${fileName} not found.`);
                            break;
                        }
                        const decoded = new TextDecoder().decode(remoteData)

                        //add to blocks for further processing
                        this.blocks.push({
                            name: remoteInfo.name,
                            type: remoteInfo.type,
                            compression: false,
                            content: decoded
                        });
                        break;
                    }
                    case RisuSaveType.ROOT_COMPONENT:{
                        const componentData:{
                            data:any
                            key:string
                        } = JSON.parse(this.blocks[key].content);
                        db[componentData.key] = componentData.data;
                        break;
                    }
                    case RisuSaveType.KV:{
                        const kvName = this.blocks[key].name;
                        if(!kvName.startsWith(KV_BLOCK_PREFIX)){
                            this.refuseUnknownBlock(this.blocks[key]);
                            break;
                        }
                        // A remote pointer whose inner type is KV reaches here without a framed header of its own.
                        kvBlockSeen = true;
                        // Upstream's SaveKV data is carried verbatim; the fork neither reads nor interprets it.
                        // The container exists only when a namespace decoded, and a namespace such as `__proto__`
                        // must become an own key rather than reach the prototype.
                        const kvValue: unknown = JSON.parse(this.blocks[key].content);
                        db.upstreamKvBlocks ??= {};
                        Object.defineProperty(db.upstreamKvBlocks, kvName.slice(KV_BLOCK_PREFIX.length), {
                            value: kvValue,
                            enumerable: true,
                            writable: true,
                            configurable: true,
                        });
                        break;
                    }
                    default:{
                        this.refuseUnknownBlock(this.blocks[key]);
                    }
                }
            } catch (error) {
                console.error(`Error processing block ${this.blocks[key].name}:`, error);

                if(this.strict){
                    throw error;
                }
                if(this.blocks[key].type === RisuSaveType.ROOT){
                    throw new Error('Failed to decode root block, cannot proceed with decoding RisuSave data');
                }
                this.recordOmitted(this.blocks[key].name, salvageKindOfType(this.blocks[key].type), error);
            }
        }
        if(!rootProcessed){
            // No block both claimed type ROOT and successfully parsed as one
            // — whether because it was dropped for a checksum mismatch, its
            // type byte was itself corrupted into or out of ROOT, or it was
            // simply missing. Every block-format file writes exactly one root
            // block, so its absence here always means something went wrong, not a
            // legitimately-rootless save. Throwing here — instead of quietly
            // returning whatever fragments of `db` were assembled — is what
            // lets bootstrap.ts's backup-fallback recovery path actually
            // trigger instead of silently booting into a near-empty database.
            throw new Error('RisuSave data has no valid root block, cannot proceed with decoding RisuSave data');
        }
        if(!kvBlockSeen && rootKv !== undefined){
            db.upstreamKvBlocks = rootKv as Database['upstreamKvBlocks'];
        }
        //to fix botpreset bugs
        if(!Array.isArray(db.botPresets) || db.botPresets.length === 0){
            db.botPresets = [structuredClone(presetTemplate)]
            db.botPresetsId = 0
        }
        return db;
    }
}

/**
 * Whether `data` is a block-format save (the `RISUSAVE` header), the only
 * format `salvageRisuSave` reads. The older msgpack formats have no blocks to
 * leave out and no block cache to fall back on.
 */
export function isBlockFormatSave(data: Uint8Array): boolean {
    return checkHeader(data) === 'risusave';
}

/**
 * Reads the intact part of a block-format save. Only the block format is
 * salvaged: any other header (the legacy compressed, raw and stream formats
 * included) throws, and no legacy decoder is tried. Framing damage, an unknown
 * version byte and a root block that cannot be read also throw. Every other block that cannot
 * be used (damaged, unparseable, of an unknown type, a remote pointer whose
 * file is gone, a directory entry with no block) is left out of `db` and listed
 * in `omitted` under its block name, once. The block cache is never read, so
 * the result holds only what the file and the remote files its pointers name
 * hold. A missing or empty preset list is replaced by the template preset, as
 * in every mode.
 */
export async function salvageRisuSave(data: Uint8Array): Promise<{ db: Database, omitted: Map<string, SalvageOmittedBlock> }> {
    if (checkHeader(data) !== 'risusave') {
        throw new Error('Unrecognized save data format');
    }
    const versionByte = data[magicRisuSavePrefix.length];
    if (versionByte !== 0 && versionByte !== 1) {
        throw new Error(`Unrecognized RisuSave format version byte: ${versionByte}`);
    }
    const decoder = new RisuSaveDecoder(versionByte === 1, false, true);
    const db = await decoder.decode(data);
    return { db, omitted: decoder.omitted };
}

/**
 * msgpackr keeps a view over the source of its last read until the next read, so a decoded save's whole
 * decompressed buffer stays reachable from the decoder after the tree is dropped. A one-byte nil read
 * through the default `decode` replaces that view; it holds no state a later read depends on.
 */
const msgpackNil = Uint8Array.of(0xc0)

/** The byte length of the header every legacy msgpack format starts with: raw, compressed and stream share it. */
export const MSGPACK_SAVE_HEADER_BYTES = magicHeader.length

/**
 * One msgpack value read the way `decodeRisuSave` reads the body of a 'compressed' save (the default decoder). The
 * caller's bytes are the value's own copy: binary values of the result may be views of them. The decoder's source is
 * released before returning, as `decodeRisuSave` releases it.
 */
export function decodeMsgpackDefault(bytes: Uint8Array): unknown {
    try {
        return decode(bytes)
    }
    finally {
        decode(msgpackNil)
    }
}

/**
 * One msgpack value read the way `decodeRisuSave` reads the body of a 'raw' or 'stream' save (`int64AsType: 'number'`,
 * no records). Same ownership and release rules as `decodeMsgpackDefault`.
 */
export function decodeMsgpackInt64Number(bytes: Uint8Array): unknown {
    try {
        return unpackr.decode(bytes)
    }
    finally {
        unpackr.decode(msgpackNil)
    }
}

/** Every legacy msgpack read of a save, whichever branch or fallback produced it, ends by releasing msgpackr's source. */
export async function decodeRisuSave(data:Uint8Array, options?: { strict?: boolean }){
    try {
        return await decodeRisuSaveBranches(data, options)
    }
    finally {
        decode(msgpackNil)
    }
}

/**
 * The lenient decode of `decodeRisuSave`, with the blocks of the file it could not use. The tree is exactly the one
 * `decodeRisuSave(data)` returns; only a RISUSAVE file the block decoder read to the end reports anything, so the msgpack
 * formats, and a file whose block decoder threw and an older reader then read, give an empty map. A block the block cache
 * stood in for is in the tree and is not listed.
 */
export async function decodeRisuSaveReporting(data: Uint8Array): Promise<{ db: Database, omitted: Map<string, SalvageOmittedBlock> }> {
    let omitted = new Map<string, SalvageOmittedBlock>()
    try {
        const db: Database = await decodeRisuSaveBranches(data, undefined, (found) => { omitted = found })
        return { db, omitted }
    }
    finally {
        decode(msgpackNil)
    }
}

/** `onBlocksDecoded` is told the omitted blocks of a block decoder that returned, before its tree is handed back. */
async function decodeRisuSaveBranches(data:Uint8Array, options?: { strict?: boolean }, onBlocksDecoded?: (omitted: Map<string, SalvageOmittedBlock>) => void){
    try {
        const header = checkHeader(data)
        // The body is a view of `data`: no branch writes it, but in the raw
        // branch msgpackr returns binary values as views of it, so a caller
        // must not modify bytes it handed to `decodeRisuSave` while the
        // returned tree is alive.
        switch(header){
            case "compressed":
                data = data.subarray(magicCompressedHeader.length)
                return decode(fflate.decompressSync(data))
            case "raw":
                data = data.subarray(magicHeader.length)
                return unpackr.decode(data)
            case "stream":{
                await checkCompressionStreams()
                data = data.subarray(magicStreamCompressedHeader.length)
                const cs = new DecompressionStream('gzip');
                const writer = cs.writable.getWriter();
                writer.write(data as any);
                writer.close();
                const buf = await new Response(cs.readable).arrayBuffer()
                return unpackr.decode(new Uint8Array(buf))
            }
            case "risusave":{
                // Byte 8 (right after the 8-byte "RISUSAVE" prefix checkHeader()
                // matched) is the format version — 0 means the original format
                // (files written before this existed), 1 means every block
                // carries a trailing CRC32 checksum. Any OTHER value is treated
                // as corruption and rejected outright (falling through to the
                // legacy-format fallback attempts below, then ultimately to the
                // caller as a decode failure) rather than silently guessed at as
                // "must be legacy" — a version byte is exactly as capable of
                // being the one bit that got flipped as anything else in the
                // file, and guessing wrong here would mean skipping checksum
                // verification entirely for a file that actually has it.
                const versionByte = data[magicRisuSavePrefix.length];
                if (versionByte !== 0 && versionByte !== 1) {
                    throw new Error(`Unrecognized RisuSave format version byte: ${versionByte}`);
                }
                const decoder = new RisuSaveDecoder(versionByte === 1, options?.strict === true);
                const tree = await decoder.decode(data);
                onBlocksDecoded?.(decoder.omitted);
                return tree;
            }
        }
        if (options?.strict) {
            throw new Error('Unrecognized save data format');
        }
        return unpackr.decode(data)
    }
    catch (error) {
        console.error('Error decoding RisuSave data:', error);
        if (options?.strict) {
            // A strict caller must never act on whatever an older format's
            // decoder happens to make of bytes the current decoder rejected.
            throw error;
        }
        try {
            console.log('risudecode')
            const risuSaveHeader = new Uint8Array(Buffer.from("\u0000\u0000RISU",'utf-8'))
            const realData = data.subarray(risuSaveHeader.length)
            const dec = unpackr.decode(realData)
            return dec   
        } catch (error) {
            const buf = Buffer.from(fflate.decompressSync(Buffer.from(data)))
            try {
                return JSON.parse(buf.toString('utf-8'))
            } catch (error) {
                return unpackr.decode(buf)
            }
        }
    }
}

export function checkHeader(data: Uint8Array) {

    let header:'none'|'compressed'|'raw'|'stream'|'risusave' = 'raw'

    if (data.length < magicHeader.length) {
      return false;
    }
  
    for (let i = 0; i < magicHeader.length; i++) {
      if (data[i] !== magicHeader[i]) {
        header = 'none'
        break
      }
    }

    if(header === 'none'){
        header = 'compressed'
        for (let i = 0; i < magicCompressedHeader.length; i++) {
            if (data[i] !== magicCompressedHeader[i]) {
                header = 'none'
                break
            }
        }
    }

    if(header === 'none'){
        header = 'stream'
        for (let i = 0; i < magicStreamCompressedHeader.length; i++) {
            if (data[i] !== magicStreamCompressedHeader[i]) {
                header = 'none'
                break
            }
        }
    }

    if(header === 'none'){
        header = 'risusave'
        // Only the version-independent "RISUSAVE" prefix is checked here — the
        // 9th byte (format version: v1 has no per-block checksums, v2 does) is
        // read separately in decodeRisuSave() to decide how RisuSaveDecoder
        // should parse the blocks that follow, not to decide IF this is a
        // RisuSave buffer at all.
        for (let i = 0; i < magicRisuSavePrefix.length; i++) {
            if (data[i] !== magicRisuSavePrefix[i]) {
                header = 'none'
                break
            }
        }
    }

    // All bytes matched
    return header;
  }
import { Packr, Unpackr, decode } from "msgpackr/index-no-eval";
import * as fflate from "fflate";
import { presetTemplate, type Database } from "./database.svelte";
import localforage from "localforage";
import { createYieldBudget } from "./saveYield"
import { getAppStore } from "./store/appStore"
import { characterIdProblem, isCharacterEntry, isUsableCharacterId } from "./characterIds"
import { SaveParkError } from "./saveHold"

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
// 4-byte CRC32 trailer to every block (see encodeRawBlock/RisuSaveDecoder
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
 * Compares two block buffers for `layoutEqualsCommitted`, its only caller.
 * Blocks the encoder produces are fresh `ArrayBuffer`s allocated at
 * `byteOffset` 0 (see encodeRawBlock's `arrayBuf`/`buf`), so the common case
 * can compare 4 bytes at a time via `Uint32Array` instead of one byte at a
 * time. The `byteOffset` check is a defensive guard, not something either
 * operand hits. If it ever fails anyway, falling back to a plain byte loop
 * keeps this correct instead of misreading unaligned words.
 */
function rawBlockBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    const length = a.length
    if (a.byteOffset === 0 && b.byteOffset === 0) {
        const wordCount = length >>> 2
        const aWords = new Uint32Array(a.buffer, 0, wordCount)
        const bWords = new Uint32Array(b.buffer, 0, wordCount)
        for (let i = 0; i < wordCount; i++) {
            if (aWords[i] !== bWords[i]) return false
        }
        for (let i = wordCount * 4; i < length; i++) {
            if (a[i] !== b[i]) return false
        }
        return true
    }
    for (let i = 0; i < length; i++) {
        if (a[i] !== b[i]) return false
    }
    return true
}

/**
 * Removes every occurrence of `value` from `list`, not only the first.
 * `list` is `toSave.character`, declared `string[]`, but the selected-
 * character effect (`frontUnshiftSelected`, `dbChangeEffects.svelte.ts`) and
 * the identity tracker's own append (`appendIfAbsent`,
 * `characterSaveMarks.ts`) push a character's raw chaId into it at runtime,
 * whatever that declared type says -- so each element is compared by
 * `String(list[i])`, not by identity, to still catch a raw, non-string
 * chaId.
 */
function removeAllOccurrences(list: string[], value: string): void {
    for (let i = list.length - 1; i >= 0; i--) {
        if (String(list[i]) === value) {
            list.splice(i, 1);
        }
    }
}

/**
 * Thrown for a block-parsing failure that must abort decoding entirely
 * rather than being silently skipped (RisuSaveDecoder's raw byte-parsing
 * loop otherwise treats every per-block error as "drop this one block and
 * keep going" — appropriate for a corrupted character or module, but not for
 * the root block, whose __directory field is what makes every other
 * directory-cached block loadable at all).
 */
class CriticalBlockError extends Error {}


async function checkCompressionStreams(){
    if(!CompressionStream){
        const {makeCompressionStream} = await import('compression-streams-polyfill/ponyfill');
        //@ts-expect-error polyfill CompressionStream type is incompatible with globalThis.CompressionStream
        globalThis.CompressionStream = makeCompressionStream(TransformStream);
    }
    if(!DecompressionStream){
        const {makeDecompressionStream} = await import('compression-streams-polyfill/ponyfill');
        //@ts-expect-error polyfill DecompressionStream type is incompatible with globalThis.DecompressionStream
        globalThis.DecompressionStream = makeDecompressionStream(TransformStream);
    }
}

export function encodeRisuSaveLegacy(data:any, compression:'noCompression'|'compression' = 'noCompression'){
    let encoded:Uint8Array = packr.encode(data)
    if(compression === 'compression'){
        encoded = fflate.compressSync(encoded)
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

export async function encodeRisuSaveCompressionStream(data:any) {
    await checkCompressionStreams()
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
}

type EncodeBlockArg = {
    compression:boolean
    data:string
    type:RisuSaveType
    name:string
}

const risuSaveCacheForage = localforage.createInstance({
    name: 'risuSaveCache'
});

/**
 * The blocks an encoder holds, in the order `encode()` writes them. Two layouts
 * with the same keys in the same order and equal bytes per block encode to the
 * same file, and two that differ in either encode to different files, because
 * each block is framed with its own type, name and length. Holds references to
 * blocks, never copies.
 */
export interface SaveLayout {
    readonly keys: readonly string[];
    readonly blocks: readonly Uint8Array[];
}

/** Why a pass left an entry of `characters` out. */
export type ExclusionReason =
    /** The entry is not a character: not an object, or a list. */
    | 'not-character'
    /** The entry has no id (every falsy value). */
    | 'missing-id'
    /** The entry has an id that cannot key a block. */
    | 'unusable-id'
    /** The entry's id changed while it was being serialized. */
    | 'id-changed'

export interface ExcludedEntry {
    /** The live entry, by identity. */
    entry: unknown
    reason: ExclusionReason
    /** The id that decided it, when the entry has one. */
    id: unknown
}

/**
 * What the latest `init()` or `set()` left out or repaired. The encoder only
 * reports: whether to fill, drop, pause or refuse is the caller's decision.
 */
export interface EncoderReport {
    excluded: ExcludedEntry[]
    /** Containers that were missing and were written as empty lists. */
    repairedContainers: string[]
}

type CharacterEntry = Database['characters'][number]

interface HolderSnapshot {
    holders: CharacterEntry[]
    /** `String(chaId)` per holder, the key its block is held under and counted by. */
    keys: string[]
    counts: Map<string, number>
}

/**
 * The characters of one pass, taken in a single synchronous step: only
 * character entries with an id that can key a block are holders; each other
 * entry is recorded in `excluded`.
 */
function snapshotHolders(characters: unknown, excluded: ExcludedEntry[]): HolderSnapshot {
    if(!Array.isArray(characters)){
        throw new SaveParkError('container-not-list', 'characters');
    }
    const holders: CharacterEntry[] = [];
    const keys: string[] = [];
    const counts = new Map<string, number>();
    for(const entry of characters.slice()){
        if(!isCharacterEntry(entry)){
            excluded.push({ entry, reason: 'not-character', id: undefined });
            continue;
        }
        const id = entry.chaId;
        const problem = characterIdProblem(id);
        if(problem !== null){
            excluded.push({ entry, reason: problem === 'missing' ? 'missing-id' : 'unusable-id', id });
            continue;
        }
        const key = String(id);
        holders.push(entry as unknown as CharacterEntry);
        keys.push(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { holders, keys, counts };
}

/**
 * The JSON text of a list container. `modules`, `loadouts` and `plugins` that
 * are absent are written as empty lists and named in `repaired`; anything else
 * that is not a list, and an absent preset list, cannot become a loadable
 * block and is refused.
 */
function listContainerText(value: unknown, name: string, repaired: string[], absentIsEmpty: boolean): string {
    if(Array.isArray(value)){
        return JSON.stringify(value);
    }
    if(absentIsEmpty && (value === undefined || value === null)){
        repaired.push(name);
        return '[]';
    }
    throw new SaveParkError('container-not-list', name);
}

export class RisuSaveEncoder {

    // Prototype-free: a character id such as `constructor` is an ordinary key,
    // and "no block yet" is `undefined` for every id.
    private blocks: { [key: string]: Uint8Array } = Object.create(null);
    private report: EncoderReport = { excluded: [], repairedContainers: [] };
    private compression: boolean = false;
    // Fork-specific internal API: the set of character objects THIS init()
    // call actually encoded (by identity, not a copy). Consumed by saveDb()
    // to seed the identity tracker's WeakSet (dbChangeEffects.svelte.ts) so a
    // replacement that happens WHILE init() is still running isn't treated as
    // "already seen" once that effect starts, and by prepareSaveIteration()'s
    // post-reload filter, so a full reload doesn't double-encode an
    // already-marked character the same save iteration. Purely additional
    // bookkeeping; does not change what init() encodes or how. Released via
    // `takeEncodedCharacterProxies()` once each consumer above has read it --
    // and each consumer in turn drops its own copy afterward (saveDb()
    // releases its `seed` argument, and registerDbChangeEffects releases
    // `opts.seed`) -- so together, nothing here keeps a boot-time character
    // object reachable for this encoder's whole lifetime.
    private encodedCharacterProxies = new Set<Database['characters'][number]>();
    // One yield budget per encoder instance, each with its own clock.
    // `encodeRawBlock` awaits `maybeYield()` after every block. Encoding a
    // block crosses no macrotask boundary by itself, so this is what keeps a
    // long run of blocks yielding periodically instead of running as one
    // long task.
    private yieldBudget = createYieldBudget();
    // chaId keys currently held by two or more characters in the last pass
    // (`init` or `set`) this encoder ran. While a key is here, its block is
    // held unchanged rather than rewritten from either holder (MC-078,
    // MC-079, MC-082) -- see the duplicate handling in `init` and `set`
    // below. Recomputed from scratch every pass; a key leaves this set the
    // moment a pass sees it with fewer than two holders.
    private frozenKeys = new Set<string>();

    /** A snapshot of the chaId keys currently frozen against a rewrite. */
    getFrozenKeys(): Set<string> {
        return new Set(this.frozenKeys);
    }

    // The layout the owner of this encoder has confirmed storage holds. Only
    // `markLayoutCommitted` moves it; `set`, `encode` and the block comparison
    // in `encodeRawBlock` never do, so it names bytes a write actually put in
    // storage and nothing this encoder merely produced.
    private committedLayout: SaveLayout | null = null;

    /**
     * The blocks as `encode()` would write them right now, or null when
     * `encode()` would return nothing. A cheap walk over references: no block
     * is copied or compared.
     */
    snapshotLayout(): SaveLayout | null {
        if(!this.blocks['config']){
            return null;
        }
        const keys: string[] = [];
        const blocks: Uint8Array[] = [];
        for(const key in this.blocks){
            keys.push(key);
            blocks.push(this.blocks[key]);
        }
        return { keys, blocks };
    }

    /** Whether a layout was committed on this encoder, so the next layout can be compared with it. */
    hasCommittedLayout(): boolean {
        return this.committedLayout !== null;
    }

    /**
     * Whether `layout` encodes to exactly the bytes of the committed layout:
     * the same keys in the same order, and per key the same block or a block
     * with equal bytes. False when nothing was committed.
     */
    layoutEqualsCommitted(layout: SaveLayout): boolean {
        const committed = this.committedLayout;
        if(!committed || committed.keys.length !== layout.keys.length){
            return false;
        }
        for(let i = 0; i < layout.keys.length; i++){
            if(committed.keys[i] !== layout.keys[i]){
                return false;
            }
            const a = committed.blocks[i];
            const b = layout.blocks[i];
            if(a !== b && !rawBlockBytesEqual(a, b)){
                return false;
            }
        }
        return true;
    }

    /**
     * Declares that storage holds the bytes `layout` encodes to. The caller
     * calls it only once a write of exactly those bytes has returned, or once
     * an iteration found them equal to bytes it has already confirmed.
     */
    markLayoutCommitted(layout: SaveLayout): void {
        this.committedLayout = layout;
    }

    async init(data:Database,arg:{
        compression?: boolean,
        /**
         * The encoder this fresh one is replacing on a full reload. Consulted
         * only for a key that this pass's own snapshot finds duplicated and
         * for which this encoder has no block of its own: `previous.blocks`
         * is read, never copied in bulk ahead of time, so a key duplicated in
         * `previous` that this pass finds with zero or one holder is never
         * carried, and a key `previous` never held a block for still falls
         * through to a first-holder write. `previous` itself is never
         * written to.
         */
        previous?: RisuSaveEncoder
    } = {}){
        const {
            compression = false,
            previous
        } = arg;
        this.compression = compression;
        this.encodedCharacterProxies = new Set();
        const report: EncoderReport = { excluded: [], repairedContainers: [] };
        this.report = report;
        // Every container is checked before the first block is built, so a
        // refusal leaves no half-built layout behind.
        if(!Array.isArray(data.characters)){
            throw new SaveParkError('container-not-list', 'characters');
        }
        const presetText = listContainerText(data.botPresets, 'botPresets', report.repairedContainers, false);
        const modulesText = listContainerText(data.modules, 'modules', report.repairedContainers, true);
        const loadoutsText = listContainerText(data.loadouts, 'loadouts', report.repairedContainers, true);
        const pluginsText = listContainerText(data.plugins, 'plugins', report.repairedContainers, true);
        let obj:Record<any,any> = {}
        let keys = Object.keys(data)
        for(const key of keys){
            if(key !== 'characters' && key !== 'botPresets' && key !== 'modules'){
                obj[key] = data[key]
            }
        }
        this.blocks['root'] = await this.encodeBlock({
            compression,
            data: JSON.stringify(obj),
            type: RisuSaveType.ROOT,
            name: 'root'
        });
        this.blocks['preset'] = await this.encodeBlock({
            compression,
            data: presetText,
            type: RisuSaveType.BOTPRESET,
            name: 'preset'
        });
        this.blocks['modules'] = await this.encodeBlock({
            compression,
            data: modulesText,
            type: RisuSaveType.MODULES,
            name: 'modules'
        });
        this.blocks['loadouts'] = await this.encodeBlock({
            compression,
            data: loadoutsText,
            type: RisuSaveType.LOADOUTS,
            name: 'loadouts'
        });
        this.blocks['plugins'] = await this.encodeBlock({
            compression,
            data: pluginsText,
            type: RisuSaveType.PLUGINS,
            name: 'plugins'
        });
        this.blocks['pluginStorage'] = await this.encodeBlock({
            compression,
            data: JSON.stringify(data.pluginCustomStorage),
            type: RisuSaveType.PLUGIN_STORAGE,
            name: 'pluginStorage'
        });
        // One snapshot for this whole pass: a holder appended to the live
        // array while this loop is still awaiting an earlier holder's block
        // write is not seen until the next pass. Each holder's chaId is read
        // once, here -- never re-read from the character later -- so a chaId
        // edited mid-pass still encodes and freezes under the value it held
        // when this pass started. `holderKeys` holds `String(chaId)`, the
        // same coercion a plain object's own property access already applies
        // to `this.blocks[chaId]`, so a numeric chaId dedupes and freezes
        // exactly as it keys a block, and is also the block's name (the text
        // form of the id, so the written bytes are unchanged). An entry that
        // is not a character, or whose id cannot key a block, is left out
        // here and named in the report; it builds no block and removes none.
        const { holders: snapshot, keys: holderKeys, counts: holderCounts } = snapshotHolders(data.characters, report.excluded);

        const encodedThisPass = new Set<string>();
        const newFrozenKeys = new Set<string>();
        for (let i = 0; i < snapshot.length; i++) {
            const character = snapshot[i];
            const key = holderKeys[i];
            if (encodedThisPass.has(key)) {
                // At most one encode per key per pass -- a later holder of an
                // already-handled key is neither written nor counted again.
                continue;
            }
            encodedThisPass.add(key);
            const holders = holderCounts.get(key) ?? 0;
            if (holders > 1) {
                const existingBlock = this.blocks[key] !== undefined ? this.blocks[key] : previous?.blocks[key];
                if (existingBlock !== undefined) {
                    // A block already exists for a key two or more characters
                    // now hold -- either committed by this encoder already,
                    // or carried from the encoder being replaced -- kept
                    // unchanged, from neither holder.
                    this.blocks[key] = existingBlock;
                    newFrozenKeys.add(key);
                    continue;
                }
                // MC-082: no block for this duplicated key in either encoder
                // -- the first holder in snapshot order is written once,
                // then frozen like any other duplicate.
                const written = await this.encodeCharacterBlock(character, key, compression);
                if ('changedTo' in written) {
                    report.excluded.push({ entry: character, reason: 'id-changed', id: written.changedTo });
                } else {
                    this.blocks[key] = written.block;
                    this.encodedCharacterProxies.add(character);
                }
                newFrozenKeys.add(key);
                continue;
            }
            const written = await this.encodeCharacterBlock(character, key, compression);
            if ('changedTo' in written) {
                report.excluded.push({ entry: character, reason: 'id-changed', id: written.changedTo });
                continue;
            }
            this.blocks[key] = written.block;
            this.encodedCharacterProxies.add(character);
        }
        this.frozenKeys = newFrozenKeys;

        this.blocks['config'] = await this.encodeBlock({
            compression,
            data: JSON.stringify({
                version: 1
            }),
            type: RisuSaveType.CONFIG,
            name: "config"
        })
    }

    /**
     * Fork-specific internal API -- see the field comment above `init()`.
     * Takes (returns, then replaces with a fresh empty Set) rather than just
     * reading, so each consumer's call releases this encoder's references to
     * the character objects it just encoded once it's done with them --
     * otherwise the encoder would keep every boot-time character object
     * reachable for as long as it lives.
     * This only releases the encoder's own copy -- each consumer (saveDb()'s
     * `seed` argument, registerDbChangeEffects' `opts.seed`) must separately
     * drop its own reference once it has built whatever it needed from the
     * returned Set, or that consumer becomes the new thing pinning every
     * boot-time character reachable instead. Callers that need
     * the set more than once within the same logical use must save the
     * returned reference themselves; a second take comes back empty.
     */
    takeEncodedCharacterProxies(): Set<object> {
        const proxies = this.encodedCharacterProxies;
        this.encodedCharacterProxies = new Set();
        return proxies;
    }

    /**
     * What the latest `init()` or `set()` left out or repaired. A new report
     * replaces the previous one at the start of each of those calls.
     */
    getReport(): EncoderReport {
        return this.report;
    }

    /**
     * One character's block. The id is read again after the serialization:
     * when it does not name `key` any more, nothing is returned for the character and
     * the caller keeps whatever block it held, because a form that carries a
     * different id than its block's name does not load. A serialized form that
     * is not an object cannot become a character block at all.
     */
    private async encodeCharacterBlock(character: CharacterEntry, key: string, compression: boolean): Promise<{ block: Uint8Array } | { changedTo: unknown }> {
        const data: string | undefined = JSON.stringify(character);
        if(typeof data !== 'string' || !data.startsWith('{')){
            throw new SaveParkError('character-not-object', key);
        }
        const after: unknown = (character as { chaId?: unknown }).chaId;
        if(!isUsableCharacterId(after) || String(after) !== key){
            return { changedTo: after };
        }
        const block = await this.encodeBlock({
            compression,
            data,
            type: RisuSaveType.CHARACTER_WITH_CHAT,
            name: key
        });
        return { block };
    }

    async set(data:Database, toSave:toSaveType){
        let obj:Record<any,any> = {}
        let keys = Object.keys(data)
        for(const key of keys){
            if(
                key !== 'characters' && key !== 'botPresets' && key !== 'modules' &&
                key !== 'loadouts' && key !== 'plugins' && key !== 'pluginCustomStorage'
            ){
                obj[key] = data[key]
            }
        }

        // One snapshot for this whole pass, same reasoning as init() above:
        // an insert onto the live array partway through this loop is not
        // seen until the next set() call, and each holder's chaId is read
        // once, up front. `holderKeys` holds `String(chaId)`, matching the
        // coercion a plain object's own property access already applies to
        // `this.blocks[chaId]`, and is also the block's name. Entries that
        // cannot key a block are left out and named in the report, as in
        // init().
        const report: EncoderReport = { excluded: [], repairedContainers: [] };
        this.report = report;
        const { holders: snapshot, keys: holderKeys, counts: holderCounts } = snapshotHolders(data.characters, report.excluded);

        // A mark that is not a usable id names no block: it never reaches the
        // deletion below, and is dropped so no later step prints or compares it.
        for (let i = toSave.character.length - 1; i >= 0; i--) {
            if (!isUsableCharacterId(toSave.character[i])) {
                toSave.character.splice(i, 1);
            }
        }

        const frozenBeforePass = this.frozenKeys;
        const savedId = new Set<string>();
        const encodedThisPass = new Set<string>();
        const newFrozenKeys = new Set<string>();
        for (let i = 0; i < snapshot.length; i++) {
            const character = snapshot[i];
            const key = holderKeys[i];
            if (encodedThisPass.has(key)) {
                // At most one encode per key per pass.
                continue;
            }
            encodedThisPass.add(key);
            const holders = holderCounts.get(key) ?? 0;
            // Compares by `String(m)`, not identity: the selected-character
            // effect (`frontUnshiftSelected`) and the identity tracker
            // (`appendIfAbsent`) push a character's raw chaId into
            // `toSave.character` at runtime, and that mark must still match
            // this holder's own `String(chaId)` key. `toSave.character`
            // itself is never rewritten to hold `String(chaId)` in place: a
            // failed write folds it back into the live tracker via
            // `mergeUnsavedChanges`, and `prepareSaveIteration`'s no-reload
            // filter compares it against raw chaIds -- either one would drop
            // a numeric chaId's mark turned into `"5"` here.
            const markIndex = toSave.character.findIndex((m) => String(m) === key);

            if (holders > 1) {
                if (this.blocks[key] !== undefined) {
                    // Kept unchanged, whichever holder is marked -- every
                    // occurrence of the key is taken out of toSave.character
                    // (a dirty-marking effect can add the same id twice), so
                    // the deletion branch below never sees it.
                    newFrozenKeys.add(key);
                    savedId.add(key);
                    removeAllOccurrences(toSave.character, key);
                    continue;
                }
                // MC-082: never saved before -- the first holder in snapshot
                // order is written once, then frozen the same way.
                const written = await this.encodeCharacterBlock(character, key, this.compression);
                if ('changedTo' in written) {
                    report.excluded.push({ entry: character, reason: 'id-changed', id: written.changedTo });
                } else {
                    this.blocks[key] = written.block;
                }
                savedId.add(key);
                newFrozenKeys.add(key);
                removeAllOccurrences(toSave.character, key);
                continue;
            }

            // Exactly one holder this pass. A mark writes it; a key
            // that was frozen going into this pass writes it too, even
            // unmarked, so saving resumes with its current content as soon
            // as the duplicate is gone -- not only once a new mark happens to
            // arrive. A key with no block yet and no mark still gets its
            // first write.
            if (markIndex !== -1 || frozenBeforePass.has(key) || this.blocks[key] === undefined) {
                const written = await this.encodeCharacterBlock(character, key, this.compression);
                savedId.add(key);
                if ('changedTo' in written) {
                    // The id changed while the character was serialized: the
                    // old block stays, its mark stays, and the form that
                    // carries the new id is not stored.
                    report.excluded.push({ entry: character, reason: 'id-changed', id: written.changedTo });
                    continue;
                }
                this.blocks[key] = written.block;
                if (markIndex !== -1) {
                    toSave.character.splice(markIndex, 1);
                }
            }
        }
        this.frozenKeys = newFrozenKeys;
        // `savedId` holds `String(chaId)`, so a raw, numeric mark left over
        // here (see `markIndex` above) is compared the same way, not by
        // identity. A key whose holder kept its old block (an id that changed
        // during serialization) is in `savedId` and is not deleted.
        const probablyDeleted = toSave.character.filter((chaId) => !savedId.has(String(chaId)));
        if(probablyDeleted.length > 0){
            console.log(`Deleting character data: ${probablyDeleted.join(', ')}`);
            //probably deleted characters
            for(const chaId of probablyDeleted){
                delete this.blocks[chaId];
            }
        }

        if(toSave.botPreset){
            this.blocks['preset'] = await this.encodeBlock({
                compression: this.compression,
                data: listContainerText(data.botPresets, 'botPresets', report.repairedContainers, false),
                type: RisuSaveType.BOTPRESET,
                name: 'preset'
            });
        }
        if(toSave.modules){
            this.blocks['modules'] = await this.encodeBlock({
                compression: this.compression,
                data: listContainerText(data.modules, 'modules', report.repairedContainers, true),
                type: RisuSaveType.MODULES,
                name: 'modules'
            });
        }

        if(toSave.loadouts){
            this.blocks['loadouts'] = await this.encodeBlock({
                compression: this.compression,
                data: listContainerText(data.loadouts, 'loadouts', report.repairedContainers, true),
                type: RisuSaveType.LOADOUTS,
                name: 'loadouts'
            });
        }

        if(toSave.pluginCustomStorage){
            this.blocks['pluginStorage'] = await this.encodeBlock({
                compression: this.compression,
                data: JSON.stringify(data.pluginCustomStorage),
                type: RisuSaveType.PLUGIN_STORAGE,
                name: 'pluginStorage'
            });
        }

        if(toSave.plugins){
            this.blocks['plugins'] = await this.encodeBlock({
                compression: this.compression,
                data: listContainerText(data.plugins, 'plugins', report.repairedContainers, true),
                type: RisuSaveType.PLUGINS,
                name: 'plugins'
            });
        }

        obj["__directory"] = Object.keys(this.blocks).filter(key => key !== 'root');
        this.blocks['root'] = await this.encodeBlock({
            compression: this.compression,
            data: JSON.stringify(obj),
            type: RisuSaveType.ROOT,
            name: 'root'
        });
    }

    encode(arg:{
        compression?: boolean
    } = {}){
        if(!this.blocks['config']){
            return null
        }
        let totalLength = 0
        for(const key in this.blocks){
            totalLength += this.blocks[key].length;
        }
        totalLength += magicRisuSaveHeaderV2.length;
        const arrayBuf = new ArrayBuffer(totalLength);
        const view = new Uint8Array(arrayBuf);
        let offset = 0;
        view.set(magicRisuSaveHeaderV2, offset);
        offset += magicRisuSaveHeaderV2.length;
        for(const key in this.blocks){
            view.set(this.blocks[key], offset);
            offset += this.blocks[key].length;
        }
        console.log(Object.keys(this.blocks).length, 'blocks encoded');
        return arrayBuf;
    }

    async encodeBlock(arg:EncodeBlockArg){
        return await this.encodeRawBlock(arg);
    }

    async encodeRawBlock(arg:EncodeBlockArg){
        let databuf: Uint8Array;
        if(arg.compression){
            await checkCompressionStreams();
            const cs = new CompressionStream('gzip');
            const writer = cs.writable.getWriter();
            writer.write(new TextEncoder().encode(arg.data));
            writer.close();
            const compressedData = await new Response(cs.readable).arrayBuffer();
            databuf = (new Uint8Array(compressedData));
        }
        else{
            databuf = (new TextEncoder().encode(arg.data));
        }
        const nameBuf = new TextEncoder().encode(arg.name);
        const lengthBuf = new ArrayBuffer(4);
        new Uint32Array(lengthBuf)[0] = databuf.length;

        // Two separate checksums, not one, because they protect against
        // different failure modes and the decoder needs to react differently
        // to each:
        //  - headerChecksum covers type+compression+nameLen+name+length —
        //    everything the decoder needs to know WHERE this block's data
        //    ends (and so where the next block starts). The decoder verifies
        //    this BEFORE trusting `length` enough to read `data` at all. If
        //    it fails, the decoder can no longer safely locate any
        //    subsequent block either, so it must abort decoding entirely
        //    rather than merely skip this one block.
        //  - dataChecksum covers only the payload. Once headerChecksum has
        //    confirmed `length` is intact, a dataChecksum-only mismatch means
        //    just this block's own content is corrupted — block boundaries
        //    are still known, so it's safe to drop only this block and keep
        //    decoding the rest of the file, same as any other per-block
        //    parse failure.
        // A single checksum covering everything couldn't distinguish these
        // two cases from the mismatch alone: framing-field corruption
        // (type/name/length) would go undetected because only the payload
        // was checksummed.
        const headerBytes = new Uint8Array(2 + 1 + nameBuf.length + 4);
        headerBytes.set([arg.type, arg.compression ? 1 : 0], 0);
        headerBytes.set([nameBuf.length], 2);
        headerBytes.set(nameBuf, 3);
        headerBytes.set(new Uint8Array(lengthBuf), 3 + nameBuf.length);
        const headerChecksumBuf = new ArrayBuffer(4);
        new Uint32Array(headerChecksumBuf)[0] = crc32(headerBytes);

        const dataChecksumBuf = new ArrayBuffer(4);
        new Uint32Array(dataChecksumBuf)[0] = crc32(databuf);

        const arrayBuf = new ArrayBuffer(headerBytes.length + 4 + databuf.length + 4);
        const buf = new Uint8Array(arrayBuf);
        buf.set(headerBytes, 0);
        buf.set(new Uint8Array(headerChecksumBuf), headerBytes.length);
        buf.set(databuf, headerBytes.length + 4);
        buf.set(new Uint8Array(dataChecksumBuf), headerBytes.length + 4 + databuf.length);

        // This path writes nothing to storage, and awaits none, so it crosses no
        // macrotask boundary of its own: the yield budget supplies one, or a
        // run of blocks becomes one long task.
        await this.yieldBudget.maybeYield();
        return buf;
    }
}

/** One block's framing fields, as `parseBlockHeader` reads them. */
interface BlockHeader {
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
function parseBlockHeader(data: Uint8Array, blockStart: number, hasChecksums: boolean): BlockHeader {
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
 * The blocks of a save this encoder wrote (header version 1, every block
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
export type SalvageOmittedKind = 'character' | 'presets' | 'modules' | 'loadouts' | 'plugins' | 'pluginStorage' | 'ignored' | 'other'

export interface SalvageOmittedBlock {
    kind: SalvageOmittedKind
    /** The failure's message, for diagnostics only. */
    reason: string
}

function salvageKindOfType(type: RisuSaveType): SalvageOmittedKind {
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
            return 'character'
    }
}

export class RisuSaveDecoder {
    private blocks: {
        name: string;
        type: RisuSaveType;
        compression: boolean;
        content: string;
    }[] = []
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
    // `salvage` reads like the default mode except that it never consults the
    // block cache and records every block it cannot use in `omitted`, keyed by
    // block name. Framing, root and version failures still throw. Set only by
    // `salvageRisuSave`; it is exclusive with `strict`.
    readonly omitted = new Map<string, SalvageOmittedBlock>();
    constructor(private hasChecksums: boolean = false, private strict: boolean = false, private salvage: boolean = false) {}

    private recordOmitted(name: string, kind: SalvageOmittedKind, error: unknown) {
        if (!this.omitted.has(name)) {
            this.omitted.set(name, { kind, reason: error instanceof Error ? error.message : String(error) });
        }
    }

    async decode(data: Uint8Array): Promise<Database> {
        console.log('Decoding RisuSave data');
        let offset = magicRisuSaveHeaderV2.length;
        //@ts-expect-error Database has required fields, but we initialize empty and populate incrementally during decode
        let db:Database = {}
        const loadedBlocks = new Set<string>();
        while (offset < data.length) {
            const blockStart = offset;
            let framed: { name: string, type: RisuSaveType } | null = null;
            try {
                const header = parseBlockHeader(data, blockStart, this.hasChecksums);
                const { type, compression, name, length } = header;
                framed = { name, type };
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
                if (this.salvage && framed) {
                    this.recordOmitted(framed.name, salvageKindOfType(framed.type), error);
                }
                continue
            }
        }
        console.log('blocks',this.blocks)
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
                            if(!db[rootKey] && !rootKey.startsWith('__')){
                                db[rootKey] = rootData[rootKey];
                            }
                            if(rootKey === '__directory'){
                                directory = rootData[rootKey];
                                console.log('RisuSave directory:', directory);
                                for(const dirKey of directory){
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
                                            }
                                        } catch (error) {
                                            console.error(`Error loading directory block ${dirKey}:`, error);
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
                        const character = JSON.parse(this.blocks[key].content);
                        db.characters.push(character);
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
                            if(this.salvage){
                                this.recordOmitted(this.blocks[key].name, 'character', new Error(`Remote pointer for "${remoteInfo.name}" has an unrecognized version (${remoteInfo.v}) or a v2 pointer missing its hash.`));
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
                                throw error;
                            }
                            if(this.salvage){
                                this.recordOmitted(this.blocks[key].name, 'character', error);
                                break;
                            }
                            console.error(`Error reading remote file ${fileName}:`, error);
                        }

                        if(!remoteData){
                            if(this.strict){
                                throw new Error(`Remote file ${fileName} not found.`);
                            }
                            if(this.salvage){
                                this.recordOmitted(this.blocks[key].name, 'character', new Error(`Remote file ${fileName} not found.`));
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
                    default:{
                        if(this.strict){
                            throw new Error(`Not Implemented RisuSaveType: ${this.blocks[key].type} for ${this.blocks[key].name}`);
                        }
                        if(this.salvage){
                            this.recordOmitted(this.blocks[key].name, 'other', new Error(`Not Implemented RisuSaveType: ${this.blocks[key].type} for ${this.blocks[key].name}`));
                        }
                        console.warn(`Not Implemented RisuSaveType: ${this.blocks[key].type} for ${this.blocks[key].name}`);
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
                if(this.salvage){
                    this.recordOmitted(this.blocks[key].name, salvageKindOfType(this.blocks[key].type), error);
                }
            }
        }
        if(!rootProcessed){
            // No block both claimed type ROOT and successfully parsed as one
            // — whether because it was dropped for a checksum mismatch, its
            // type byte was itself corrupted into or out of ROOT, or it was
            // simply missing. Every file this encoder produces always writes
            // exactly one root block (see encode()'s `!this.blocks['config']`
            // guard, and init()'s unconditional `this.blocks['root'] = ...`),
            // so its absence here always means something went wrong, not a
            // legitimately-rootless save. Throwing here — instead of quietly
            // returning whatever fragments of `db` were assembled — is what
            // lets bootstrap.ts's backup-fallback recovery path actually
            // trigger instead of silently booting into a near-empty database.
            throw new Error('RisuSave data has no valid root block, cannot proceed with decoding RisuSave data');
        }
        //to fix botpreset bugs
        if(!Array.isArray(db.botPresets) || db.botPresets.length === 0){
            db.botPresets = [presetTemplate]
            db.botPresetsId = 0
        }
        console.log('Decoded RisuSave data', db);
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

export async function decodeRisuSave(data:Uint8Array, options?: { strict?: boolean }){
    try {
        const header = checkHeader(data)
        switch(header){
            case "compressed":
                data = data.slice(magicCompressedHeader.length)
                return decode(fflate.decompressSync(data))
            case "raw":
                data = data.slice(magicHeader.length)
                return unpackr.decode(data)
            case "stream":{
                await checkCompressionStreams()
                data = data.slice(magicStreamCompressedHeader.length)
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
                return await decoder.decode(data);
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

function checkHeader(data: Uint8Array) {

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
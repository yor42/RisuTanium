/**
 * Test fixture: the RisuSave block-format encoder. The application never
 * writes this format (`.bin` is written by `encodeRisuSaveLegacy` and
 * `encodeRisuSaveStreamed`); tests use this class to build block-format
 * files that the production decoder in `../risuSave` reads. The bytes it
 * writes are the ones the block-format goldens pin.
 */
import type { Database } from "../database.svelte";
import { checkCompressionStreams, RisuSaveType, type toSaveType } from "../risuSave"
import { createYieldBudget } from "../saveYield"
import { isCharacterEntry, isUsableCharacterId } from "../characterIds"
import { SaveParkError } from "../saveHold"
import { assertNoModuleStubs } from "../moduleStub"
import { crc32 } from "./risuSaveBlockFile"

const magicRisuSaveHeaderV2 = new TextEncoder().encode("RISUSAVE\x01");

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

type EncodeBlockArg = {
    compression:boolean
    data:string
    type:RisuSaveType
    name:string
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
 * character entries with an id that can key a block are holders; every other
 * entry is left out and builds no block.
 */
function snapshotHolders(characters: unknown): HolderSnapshot {
    if(!Array.isArray(characters)){
        throw new SaveParkError('container-not-list', 'characters');
    }
    const holders: CharacterEntry[] = [];
    const keys: string[] = [];
    const counts = new Map<string, number>();
    for(const entry of characters.slice()){
        if(!isCharacterEntry(entry)){
            continue;
        }
        const id = entry.chaId;
        if(!isUsableCharacterId(id)){
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
 * are absent are written as empty lists; anything else that is not a list,
 * and an absent preset list, cannot become a loadable block and is refused.
 */
function listContainerText(value: unknown, name: string, absentIsEmpty: boolean): string {
    if(Array.isArray(value)){
        return JSON.stringify(value);
    }
    if(absentIsEmpty && (value === undefined || value === null)){
        return '[]';
    }
    throw new SaveParkError('container-not-list', name);
}

export class RisuSaveEncoder {

    // Prototype-free: a character id such as `constructor` is an ordinary key,
    // and "no block yet" is `undefined` for every id.
    private blocks: { [key: string]: Uint8Array } = Object.create(null);
    private compression: boolean = false;
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
        // Every container is checked before the first block is built, so a
        // refusal leaves no half-built layout behind.
        if(!Array.isArray(data.characters)){
            throw new SaveParkError('container-not-list', 'characters');
        }
        assertNoModuleStubs(data.modules, 'RisuSaveEncoder.init');
        const presetText = listContainerText(data.botPresets, 'botPresets', false);
        const modulesText = listContainerText(data.modules, 'modules', true);
        const loadoutsText = listContainerText(data.loadouts, 'loadouts', true);
        const pluginsText = listContainerText(data.plugins, 'plugins', true);
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
        // here; it builds no block and removes none.
        const { holders: snapshot, keys: holderKeys, counts: holderCounts } = snapshotHolders(data.characters);

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
                if (!('changedTo' in written)) {
                    this.blocks[key] = written.block;
                }
                newFrozenKeys.add(key);
                continue;
            }
            const written = await this.encodeCharacterBlock(character, key, compression);
            if ('changedTo' in written) {
                continue;
            }
            this.blocks[key] = written.block;
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
        // Before any holder snapshot or block change, and whether or not the modules block is marked: a refusal
        // leaves the layout and the marks untouched, and an unmarked pass cannot skip past a stub another pass would write.
        assertNoModuleStubs(data.modules, 'RisuSaveEncoder.set');
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
        // cannot key a block are left out, as in init().
        const { holders: snapshot, keys: holderKeys, counts: holderCounts } = snapshotHolders(data.characters);

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
            // `mergeUnsavedChanges`, and a save pass's no-reload
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
                if (!('changedTo' in written)) {
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
                data: listContainerText(data.botPresets, 'botPresets', false),
                type: RisuSaveType.BOTPRESET,
                name: 'preset'
            });
        }
        if(toSave.modules){
            this.blocks['modules'] = await this.encodeBlock({
                compression: this.compression,
                data: listContainerText(data.modules, 'modules', true),
                type: RisuSaveType.MODULES,
                name: 'modules'
            });
        }

        if(toSave.loadouts){
            this.blocks['loadouts'] = await this.encodeBlock({
                compression: this.compression,
                data: listContainerText(data.loadouts, 'loadouts', true),
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
                data: listContainerText(data.plugins, 'plugins', true),
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

/** The blocks of an encoded file in file order: each key with its whole framed block (header, payload and checksums). */
export interface SaveLayout {
    readonly keys: readonly string[];
    readonly blocks: readonly Uint8Array[];
}

/**
 * Splits what `encoder.encode()` writes right now into its framed blocks, or
 * returns null when `encode()` writes nothing. Reads the encoded bytes, so it
 * observes the file a reader would get.
 */
export function encodedLayout(encoder: RisuSaveEncoder): SaveLayout | null {
    const encoded = encoder.encode();
    if(encoded === null){
        return null;
    }
    const file = new Uint8Array(encoded);
    const keys: string[] = [];
    const blocks: Uint8Array[] = [];
    let offset = magicRisuSaveHeaderV2.length;
    while(offset < file.length){
        const nameLength = file[offset + 2];
        const nameEnd = offset + 3 + nameLength;
        const dataLength = new DataView(file.buffer, nameEnd, 4).getUint32(0, true);
        // Header fields, the 4-byte length, the header checksum, the payload and the data checksum.
        const end = nameEnd + 4 + 4 + dataLength + 4;
        keys.push(new TextDecoder().decode(file.subarray(offset + 3, nameEnd)));
        blocks.push(file.slice(offset, end));
        offset = end;
    }
    return { keys, blocks };
}

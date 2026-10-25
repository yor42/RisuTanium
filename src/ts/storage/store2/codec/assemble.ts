import type { JsonObject, JsonValue } from '../../blockFrame'
import type { Database } from '../../database.svelte'
import {
    FRAME_OVERHEAD, keyOfRef, readUnit, refOfFrame, UNIT_TYPE,
    type ChatChunk, type ChatCore, type ContentBody, type Manifest, type ModuleIndex, type PluginBucket, type Ref, type Shard,
    type ShardEntry, type UnitBody, type UnitType,
} from '../format'
import {
    ENTRY_MOVED_FIELDS, PLUGIN_LISTS, readAbsentList, readListField, readObjectField, readStringListField,
    type PluginList,
} from './bodies'
import { assembleChat } from './chat'
import { assembleModules } from './modules'
import { defineOwn } from './normalize'
import { bucketOfKey } from './pluginStorage'
import { shardOfU } from './shard'
import { CodecAssembleError, type EncodedUnit, type UnitSource } from './types'

/**
 * Assemble: units to `Database`. Every unit is read through its Ref: a missing
 * unit, a length or CRC that differs from the Ref, a frame or body the format
 * parser rejects, and a body of the wrong shape all throw `CodecAssembleError`.
 */

/**
 * A source over the units an encode wrote. A reused unit holds no bytes (they are in the store from the encode that
 * wrote them), so offering one is a caller error and throws, naming the unit.
 */
export function unitMapSource(units: readonly EncodedUnit[]): UnitSource {
    const bytes = new Map<string, Uint8Array>()
    for (const unit of units) {
        if (unit.reused === true) {
            throw new CodecAssembleError(`The unit "${unit.identity}" is reused and holds no bytes; offer the units that wrote it.`)
        }
        bytes.set(unit.key, unit.bytes)
    }
    return { get: key => bytes.get(key) }
}

/**
 * What the full check of one unit came to. `newer-list` is a derived list (asset, inlay or legacy list) whose version is
 * above this build's, with a frame, length and checksum that match its Ref: readable tree data, never damage and never a
 * newer tree format. `damaged` with `byRef` is a frame that is not the unit its Ref names (short, or a length or checksum
 * that differs); without it, the frame or body failed the format parser.
 */
export type UnitCheck =
    | { status: 'ok', body: UnitBody }
    | { status: 'newer-list', reason: string }
    | { status: 'missing' }
    | { status: 'damaged', reason: string, byRef: boolean }
    | { status: 'too-new', reason: string }

/**
 * The one check every read of a unit passes, assembly and detection alike, so the two cannot disagree on what damaged
 * means. It never throws: a missing unit, a frame shorter than a frame header, a length or checksum that differs from the
 * Ref, and a frame or body the format parser rejects each have an answer.
 */
export function checkUnit(source: UnitSource, ref: Ref, type: UnitType): UnitCheck {
    const key = keyOfRef(ref)
    const bytes = source.get(key)
    if (bytes === undefined) {
        return { status: 'missing' }
    }
    if (bytes.length < FRAME_OVERHEAD) {
        return { status: 'damaged', reason: 'The frame is shorter than a frame header.', byRef: true }
    }
    const actual = refOfFrame(key, bytes)
    if (actual[1] !== ref[1] || actual[2] !== ref[2]) {
        return { status: 'damaged', reason: 'The unit does not match its Ref.', byRef: true }
    }
    const parsed = readUnit(bytes, type)
    switch (parsed.status) {
        case 'ok':
        case 'stale':
            return { status: 'ok', body: parsed.value.body }
        case 'unreadable':
            return { status: 'newer-list', reason: parsed.reason }
        case 'damaged':
            return { status: 'damaged', reason: parsed.reason, byRef: false }
        case 'too-new':
            return { status: 'too-new', reason: parsed.reason }
    }
}

/** Whether a chat chunk holds a different number of messages than the Ref that names it says. */
export function chunkCountMismatch(chunk: ChatChunk, ref: Ref): boolean {
    return chunk.msgs.length !== ref[3]
}

function readChecked(source: UnitSource, ref: Ref, type: UnitType, where: string): UnitBody {
    const key = keyOfRef(ref)
    const checked = checkUnit(source, ref, type)
    switch (checked.status) {
        case 'ok':
            return checked.body
        case 'missing':
            throw new CodecAssembleError(`${where}: unit ${key} is missing.`)
        case 'damaged':
            throw new CodecAssembleError(checked.byRef
                ? `${where}: unit ${key} does not match its Ref.`
                : `${where}: unit ${key} is damaged: ${checked.reason}`)
        case 'too-new':
            throw new CodecAssembleError(`${where}: unit ${key} is too-new: ${checked.reason}`)
        case 'newer-list':
            throw new CodecAssembleError(`${where}: unit ${key} is unreadable: ${checked.reason}`)
    }
}

/** `readChecked` for a caller that assembles part of an entity itself: the same Ref check and the same thrown messages. */
export { readChecked as readCheckedUnit }

/** A content unit's body; `readChecked` has already proved its type, and the content types parse to this shape. */
function readContent(source: UnitSource, ref: Ref, type: UnitType, where: string): ContentBody {
    return readChecked(source, ref, type, where) as ContentBody
}

function copyInto(target: JsonObject, bag: JsonObject): void {
    for (const key of Object.keys(bag)) {
        defineOwn(target, key, bag[key])
    }
}

/** The value a shard entry holds for one of the fields it takes out of the core, or undefined when it holds none. */
export function movedValueOf(entry: ShardEntry, name: typeof ENTRY_MOVED_FIELDS[number]): JsonValue | undefined {
    switch (name) {
        case 'lastInteraction': return entry.lastInteraction
        case 'trashTime': return entry.trashTime
        case 'chatPage': return entry.chatPage
        case 'firstMsgIndex': return entry.firstMsgIndex
    }
}

/** The character (or group) a shard entry and its units describe, with no stub fields. */
export function assembleCharacter(entry: ShardEntry, source: UnitSource): JsonObject {
    const where = `character ${entry.u}`
    const coreBody = readContent(source, entry.core, UNIT_TYPE.characterCore, `${where} core`)
    const character: JsonObject = {}
    copyInto(character, readObjectField(coreBody, 'f', `${where} core`))
    const absent = readAbsentList(coreBody, `${where} core`)
    if (entry.lore !== null) {
        copyInto(character, readObjectField(readContent(source, entry.lore, UNIT_TYPE.lore, `${where} lore`), 'f', `${where} lore`))
    }
    if (entry.scripts !== null) {
        copyInto(character, readObjectField(readContent(source, entry.scripts, UNIT_TYPE.scripts, `${where} scripts`), 'f', `${where} scripts`))
    }
    for (const name of ENTRY_MOVED_FIELDS) {
        if (Object.hasOwn(character, name) || absent.includes(name)) {
            continue
        }
        const value = movedValueOf(entry, name)
        if (value !== undefined) {
            defineOwn(character, name, value)
        }
    }
    const chats = entry.chats.map((chatEntry, index) => {
        const chatWhere = `${where} chat ${index}`
        const core = readChecked(source, chatEntry.core, UNIT_TYPE.chatCore, `${chatWhere} core`) as ChatCore
        const chunks = chatEntry.chunks.map((ref, chunkIndex) => {
            const chunk = readChecked(source, ref, UNIT_TYPE.chatChunk, `${chatWhere} chunk ${chunkIndex}`) as ChatChunk
            if (chunkCountMismatch(chunk, ref)) {
                throw new CodecAssembleError(`${chatWhere} chunk ${chunkIndex} holds ${chunk.msgs.length} messages, its Ref says ${ref[3]}.`)
            }
            return chunk
        })
        return assembleChat(core, chunks, chatWhere)
    })
    defineOwn(character, 'chats', chats)
    return character
}

function assemblePlugins(manifest: Manifest, source: UnitSource): Record<PluginList, JsonObject[]> {
    const lists: Record<PluginList, JsonObject[]> = { plugins: [], pluginV2: [] }
    manifest.fixed.plugins.forEach((ref, index) => {
        const where = `plugin ${index}`
        const body = readContent(source, ref, UNIT_TYPE.plugin, where)
        const list = body.list
        if (!(PLUGIN_LISTS as readonly JsonValue[]).includes(list)) {
            throw new CodecAssembleError(`${where} names no known plugin list.`)
        }
        lists[list as PluginList].push(readObjectField(body, 'plugin', where))
    })
    return lists
}

function assemblePluginStorage(manifest: Manifest, source: UnitSource): JsonObject {
    const storage: JsonObject = {}
    manifest.fixed.pluginStorage.refs.forEach((ref, bucket) => {
        const body = readChecked(source, ref, UNIT_TYPE.pluginStorageBucket, `plugin-storage bucket ${bucket}`) as PluginBucket
        for (const entry of body.entries) {
            if (bucketOfKey(entry.k, manifest.fixed.pluginStorage.buckets) !== bucket) {
                throw new CodecAssembleError(`Plugin-storage key "${entry.k}" is in bucket ${bucket}, not the one its hash names.`)
            }
            const value = readContent(source, entry.ref, UNIT_TYPE.pluginStorageValue, `plugin-storage value "${entry.k}"`)
            const stored = value.value
            if (stored === undefined) {
                throw new CodecAssembleError(`Plugin-storage value "${entry.k}" has no value.`)
            }
            defineOwn(storage, entry.k, stored)
        }
    })
    return storage
}

export interface AssembleOptions {
    /** Builds one entity in place of `assembleCharacter`; called once per entity, in `order` order. Absent: `assembleCharacter`. */
    character?: (entry: ShardEntry, source: UnitSource) => JsonObject
}

/** The database the manifest and its units describe. Characters come back in `characters` order, fully loaded. */
export function assembleDatabase(manifest: Manifest, source: UnitSource, options: AssembleOptions = {}): Database {
    const assembleEntity = options.character ?? assembleCharacter
    const fixed = manifest.fixed
    const database: JsonObject = {}
    copyInto(database, readObjectField(readContent(source, fixed.config, UNIT_TYPE.configRoot, 'config'), 'f', 'config'))

    defineOwn(database, 'botPresets', fixed.presets.map((ref, index) =>
        readObjectField(readContent(source, ref, UNIT_TYPE.preset, `preset ${index}`), 'preset', `preset ${index}`)))
    const plugins = assemblePlugins(manifest, source)
    defineOwn(database, 'plugins', plugins.plugins)
    defineOwn(database, 'pluginV2', plugins.pluginV2)
    defineOwn(database, 'pluginCustomStorage', assemblePluginStorage(manifest, source))
    defineOwn(database, 'loadouts', readListField(readContent(source, fixed.loadouts, UNIT_TYPE.loadouts, 'loadouts'), 'items', 'loadouts'))
    const statics = readContent(source, fixed.statics, UNIT_TYPE.statics, 'statics')
    if (statics.value !== undefined) {
        defineOwn(database, 'statics', statics.value)
    }

    const index = readChecked(source, fixed.moduleIndex, UNIT_TYPE.moduleIndex, 'module index') as ModuleIndex
    defineOwn(database, 'modules', assembleModules(index, (entry) =>
        readObjectField(readContent(source, entry.unit, UNIT_TYPE.module, `module ${entry.id}`), 'module', `module ${entry.id}`)))

    const entries = new Map<string, ShardEntry>()
    manifest.shards.forEach((ref, shardIndex) => {
        const shard = readChecked(source, ref, UNIT_TYPE.shard, `shard ${shardIndex}`) as Shard
        for (const entry of shard.entries) {
            if (shardOfU(entry.u, manifest.shardCount) !== shardIndex) {
                throw new CodecAssembleError(`Entity ${entry.u} is in shard ${shardIndex}, not the one its id names.`)
            }
            if (entries.has(entry.u)) {
                throw new CodecAssembleError(`Entity ${entry.u} is listed twice.`)
            }
            entries.set(entry.u, entry)
        }
    })
    const order = readContent(source, fixed.order, UNIT_TYPE.order, 'order')
    const characters = readStringListField(order, 'chars', 'order').map((u) => {
        const entry = entries.get(u)
        if (entry === undefined) {
            throw new CodecAssembleError(`The order names entity ${u}, which no shard lists.`)
        }
        entries.delete(u)
        return assembleEntity(entry, source)
    })
    if (entries.size > 0) {
        throw new CodecAssembleError(`${entries.size} shard entries are not in the order unit.`)
    }
    defineOwn(database, 'characters', characters)
    if (order.characterOrder !== undefined) {
        defineOwn(database, 'characterOrder', order.characterOrder)
    }
    return database as unknown as Database
}

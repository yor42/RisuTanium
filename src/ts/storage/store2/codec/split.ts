import type { JsonObject, JsonValue } from '../../blockFrame'
import type { Database, character, groupChat } from '../../database.svelte'
import { characterCreator, stubDescription, stubTags } from '../../../process/coldCharacter'
import {
    carryUnknownFields, KNOWN_FIELDS, randomId26, UNIT_TYPE,
    type ChatEntry, type ListRef, type ModuleEntry, type ModuleIndex, type PluginBucket, type Ref, type Shard, type ShardEntry, type UnitType,
} from '../format'
import {
    CONFIG_PARTITIONED_FIELDS, DERIVED_COLD_FIELDS, ENTRY_MOVED_FIELDS, ENTRY_REQUIRED_MOVED_FIELDS, LORE_FIELDS, PLUGIN_LISTS,
    SCRIPT_FIELDS, VOLATILE_CHARACTER_FIELDS,
    type CharacterCoreBody, type ConfigBody, type FieldBagBody, type LoadoutsBody, type OrderBody, type PluginBody,
    type PluginList, type PluginValueBody, type PresetBody, type StaticsBody,
} from './bodies'
import { assembleChat, chunkMessageJson, splitChat } from './chat'
import { overflowInlayList } from '../lists/inlayList'
import { buildManifest, carryManifest } from './manifest'
import { carryModuleIndex, hasCurrentEntryFields, moduleBodyOf, moduleEntryFields, moduleHandles, taggedUnitRef, uniqueIdHandles } from './modules'
import { MODULE_INDEX_PARAMS } from './moduleIndexParams'
import { defineOwn, listOrEmpty, omitFields, pickFields, plainObject, toPlainJson } from './normalize'
import { bucketOfKey, groupKeysIntoBuckets, PLUGIN_STORAGE_BUCKETS } from './pluginStorage'
import { UnitSink, type UnitKeyKind } from './reuse'
import { carryShards, chunkRefTuple, groupIntoShards, listRefTuple, noteShardDigest, refTuple, shardCountFor, shardDigestOf } from './shard'
import { assertChatNotPointer, assertNotStub } from './stub'
import {
    CodecAssembleError, CodecInputError, ModuleSetUnsavableError, StubRefusedError, type ConfigOwner, type EncodedTree, type EncodedUnit,
    type EncodeOptions, type ListDerivation, type ModuleStubReason, type PreviousEncoding, type ReusableUnit, type SkippedItem, type SplitRecorder,
} from './types'
import { isModuleStub } from '../../moduleStub'
import { isRecordedStub } from '../moduleStubMatch'
import { MEASURE } from '../../../process/memory/measureFlag'

/**
 * Split: `Database` to units. Pure: no storage, and the only inputs are the
 * database, the injected list derivation, the key environment and the previous
 * encoding. Encoding is deterministic: the same input and the same random
 * sequence give the same bytes, and a unit whose bytes did not change keeps its
 * key.
 */

type Slot = character | groupChat

/**
 * The leading part of the identities that belong to one character or to the
 * module set. A carry decides by these prefixes which previous units an encode
 * that did not touch their owner keeps, so every identity built below starts
 * with one of them.
 */
export const IDENTITY = {
    char: 'char:',
    chat: 'chat:',
    alChar: 'al:char:',
    ilChar: 'il:char:',
    module: 'module:',
    alModule: 'al:module:',
    ilModule: 'il:module:',
    moduleIndex: 'moduleIndex',
} as const

/** The config fields of a database: every field outside `CONFIG_PARTITIONED_FIELDS`, unknown fields included. */
export function configFields(source: object): JsonObject {
    const rest: Record<string, unknown> = {}
    for (const key of Object.keys(source)) {
        if (!(CONFIG_PARTITIONED_FIELDS as readonly string[]).includes(key)) {
            Object.defineProperty(rest, key, {
                value: (source as Record<string, unknown>)[key], enumerable: true, writable: true, configurable: true,
            })
        }
    }
    return plainObject(rest, 'database')
}

/**
 * Whether a failure of a read of live data is a fault of that data, which a pass may go on without. A stub refusal is a
 * request to load the stub, and an assemble error is an invariant: both must reach the caller.
 */
export function isSkippableFault(error: unknown): boolean {
    return !(error instanceof StubRefusedError || error instanceof CodecAssembleError)
}

/** A name for a notice: the raw text, quoted. */
function quoted(name: string): string {
    return `"${name}"`
}

/** The non-empty string `name` of a live value, or null when it has none or the read throws. */
function guardedName(value: unknown): string | null {
    try {
        const name = typeof value === 'object' && value !== null ? (value as { name?: unknown }).name : undefined
        return typeof name === 'string' && name !== '' ? name : null
    } catch {
        return null
    }
}

/**
 * `configFields` that reads each field on its own: a field whose read is a fault of the data keeps the value the
 * previous encoding holds (`saved`), or is left out when it holds none. Valid data gives the same object as
 * `configFields`, key for key. A database with a `toJSON` field is read whole, as `configFields` reads it.
 */
export function configFieldsSkipping(source: object, previousConfig: JsonObject): { fields: JsonObject, skipped: SkippedItem[] } {
    const record = source as Record<string, unknown>
    const keys = Object.keys(source).filter(key => !(CONFIG_PARTITIONED_FIELDS as readonly string[]).includes(key))
    if (keys.includes('toJSON') && typeof record.toJSON === 'function') {
        return { fields: configFields(source), skipped: [] }
    }
    const fields: JsonObject = {}
    const skipped: SkippedItem[] = []
    for (const key of keys) {
        try {
            const value = toPlainJson(record[key])
            if (value !== undefined) {
                defineOwn(fields, key, value)
            }
        } catch (error) {
            if (!isSkippableFault(error)) {
                throw error
            }
            const saved = Object.hasOwn(previousConfig, key)
            if (saved) {
                defineOwn(fields, key, previousConfig[key])
            }
            skipped.push({ scope: 'settings', key, label: quoted(key), saved, cause: error })
        }
    }
    return { fields, skipped }
}

/** The character fields the core keeps before the moved fields are taken out: everything but chats, lore, scripts. Unknown fields stay. */
export function characterCoreFields(owner: JsonObject): JsonObject {
    return omitFields(owner, ['chats', ...LORE_FIELDS, ...SCRIPT_FIELDS])
}

export function movable(name: string, value: JsonValue): boolean {
    if (name === 'lastInteraction' || name === 'trashTime') {
        return typeof value === 'number'
    }
    // firstMsgIndex is -1 for a character that has not chosen a first message.
    const min = name === 'firstMsgIndex' ? -1 : 0
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
}

export interface MovedFields {
    /** The core fields without the moved ones. */
    rest: JsonObject
    /** The moved values. */
    moved: JsonObject
    /** Required moved fields the source did not have. */
    absent: string[]
}

/**
 * Takes `ENTRY_MOVED_FIELDS` out of the core fields when their value fits the
 * entry; a value that does not fit stays in the core, and an absent required
 * one is recorded in `absent` so assemble does not invent it.
 */
export function splitMovedFields(fields: JsonObject): MovedFields {
    const rest = omitFields(fields, [])
    const moved: JsonObject = {}
    const absent: string[] = []
    for (const name of ENTRY_MOVED_FIELDS) {
        if (!Object.hasOwn(fields, name)) {
            if ((ENTRY_REQUIRED_MOVED_FIELDS as readonly string[]).includes(name)) {
                absent.push(name)
            }
            continue
        }
        if (movable(name, fields[name])) {
            defineOwn(moved, name, fields[name])
            delete rest[name]
        }
    }
    return { rest, moved, absent }
}

function stringOr(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback
}

/** Character handle for the entity-id lookup: the same `chaId` held twice is told apart by occurrence. */
function handleOf(chaId: string, occurrence: number): string {
    return `${chaId}#${occurrence}`
}

export class Encoder {
    readonly sink: UnitSink
    readonly entities = new Map<string, string>()
    /** The bodies of the units that name other units by Ref (shards, plugin-storage buckets, the module index, the manifest), by identity. A rekey rewrites these. */
    readonly parents = new Map<string, { type: UnitType, body: object }>()
    /** Entity id to the chat handles of that character that come from a unique real chat id. */
    readonly stableChats = new Map<string, Set<string>>()
    /** Previous module list units this encode kept without encoding them (see `encodeModules`); `finishTree` adds them to the index units. */
    readonly carried = new Map<string, ReusableUnit>()
    /** The names (else ids) of the module stubs carried by `carry`, taken when each was carried. */
    readonly carriedModuleNames: string[] = []
    /** Whether a character this encode wrote has a chat with alternatives; `finishTree` turns it into the manifest's `chat-alt` token. */
    chatAlt = false
    /** The items of the database this encode could not read and went on without; the scoped encode reports them. */
    readonly skippedItems: SkippedItem[] = []
    /**
     * A preset list or a plugin-data value was carried from the previous encoding instead of being read, so the config
     * inlay list cannot be derived exactly: `finishTree` writes the overflow body, which keeps the sweep from deleting
     * an inlay the carried part may still use.
     */
    inlayOwnerCarried = false
    private readonly occurrences = new Map<string, number>()
    private readonly usedU = new Set<string>()

    /** Measurement builds only: the recorder the sink and the hooks below write into; never read back. */
    declare readonly split: SplitRecorder | undefined

    /**
     * `skipItems`: a module, preset list, setting or plugin-data key whose data cannot be read as plain JSON is gone
     * without, as the front and module encodes describe; off, such a fault fails the pass as it always did.
     */
    constructor(readonly options: EncodeOptions, readonly previous: PreviousEncoding | null, split?: SplitRecorder, readonly skipItems = false) {
        if (MEASURE && split !== undefined) {
            this.split = split
        }
        this.sink = new UnitSink(options.env, previous, options.keys, {
            ...(MEASURE && split !== undefined ? { split } : {}),
            ...(options.chunkMemo !== undefined ? { chunkMemo: options.chunkMemo } : {}),
        })
    }

    put(identity: string, type: UnitType, body: object, kind: UnitKeyKind = 'unit'): EncodedUnit {
        return this.sink.put(identity, type, body, kind)
    }

    putReusing(identity: string, type: UnitType, body: object, family: string, prewritten?: ReadonlyMap<object, string>): EncodedUnit {
        return this.sink.putReusing(identity, type, body, family, prewritten)
    }

    /** `put` for a unit whose body holds Refs of other units. */
    putParent(identity: string, type: UnitType, body: object, kind: UnitKeyKind = 'unit'): EncodedUnit {
        this.parents.set(identity, { type, body })
        return this.sink.put(identity, type, body, kind)
    }

    putAssetList(identity: string, list: { v: number }): ListRef {
        const unit = this.put(identity, UNIT_TYPE.assetList, list)
        return listRefTuple(unit.ref, list.v)
    }

    putInlayList(identity: string, list: { v: number }): ListRef {
        const unit = this.put(identity, UNIT_TYPE.inlayList, list)
        return listRefTuple(unit.ref, list.v)
    }

    mintU(chaId: string): string {
        return this.claimU(chaId, true)
    }

    /** Whether the previous encoding holds the first holder of this id: a read only, nothing is claimed. */
    holdsCharacter(chaId: string): boolean {
        return this.previous?.entities.has(handleOf(chaId, 0)) === true
    }

    /** The entity id the previous encoding holds for this character; a character it does not hold cannot be carried. */
    carriedU(chaId: string): string {
        return this.claimU(chaId, false)
    }

    private claimU(chaId: string, mayMint: boolean): string {
        const occurrence = this.occurrences.get(chaId) ?? 0
        this.occurrences.set(chaId, occurrence + 1)
        const handle = handleOf(chaId, occurrence)
        const known = this.previous?.entities.get(handle)
        if (known === undefined && !mayMint) {
            throw new CodecInputError(`The character ${chaId} is carried from the previous encoding, which does not hold it.`)
        }
        const u = known ?? randomId26(this.options.env)
        if (this.usedU.has(u)) {
            throw new CodecInputError(`The entity id ${u} is used by two characters.`)
        }
        this.usedU.add(u)
        this.entities.set(handle, u)
        return u
    }
}

/**
 * Chat handle (`cid`): the chat's real id when it is non-empty and held by no
 * other chat of the character, else the positional `~<index>`. Only the first
 * kind is stable across edits, so only it carries unknown entry fields; a
 * repeated id is positional for every holder, so a real-id handle in a previous
 * entry always came from a unique id.
 */
function chatHandle(chat: JsonObject, index: number, used: Set<string>, idCounts: ReadonlyMap<string, number>): { cid: string, stable: boolean } {
    // An id starting with `~` is never stable: it could equal a positional handle of a previous entry.
    const stable = typeof chat.id === 'string' && chat.id.length > 0 && !chat.id.startsWith('~') && idCounts.get(chat.id) === 1 && !used.has(chat.id)
    let cid = stable ? chat.id as string : `~${index}`
    while (used.has(cid)) {
        cid += '~'
    }
    used.add(cid)
    return { cid, stable: stable && cid === chat.id }
}

/**
 * A character read out of the live object: plain JSON, with its chats split. Every read of live user data that can
 * throw happens in `normalizeCharacter`, and nothing in this step touches an `Encoder`.
 */
export interface NormalizedCharacter {
    readonly slot: Slot
    readonly chaId: string
    readonly owner: JsonObject
    readonly chatObjects: readonly JsonObject[]
    readonly split: readonly SplitChat[]
    readonly listOwner: JsonObject
}

type SplitChat = ReturnType<typeof splitChat>

/**
 * The part of `encodeCharacter` that reads the live character: a value that is not plain JSON (a cycle, a BigInt, a
 * `toJSON` or getter that throws, nesting too deep) or a malformed chat fails here, before the encoder has claimed
 * an entity id or stored a unit. A `StubRefusedError` for a stub or a chat pointer also comes from here.
 */
export function normalizeCharacter(slot: Slot, position: number): NormalizedCharacter {
    const where = `characters[${position}]`
    if (typeof slot !== 'object' || slot === null) {
        throw new CodecInputError(`${where} is not an object.`)
    }
    const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
    assertNotStub(slot, chaId)
    return normalizeCharacterFromPlain(slot, chaId, plainObject(slot, where), position)
}

/**
 * The part of `normalizeCharacter` after the live read: the character's plain JSON object, already read from `slot`,
 * is split into its chats. It reads nothing from `slot` and never writes into `plain` (or any container of it), so a
 * caller may hand in a tree it keeps and compares later.
 */
export function normalizeCharacterFromPlain(slot: Slot, chaId: string, plain: JsonObject, position: number): NormalizedCharacter {
    const where = `characters[${position}]`
    const owner = omitFields(plain, [...DERIVED_COLD_FIELDS, ...VOLATILE_CHARACTER_FIELDS])
    const rawChats = listOrEmpty(owner.chats, `${where}.chats`) as JsonValue[]
    const chatObjects = rawChats.map((chat, index) => {
        if (typeof chat !== 'object' || chat === null || Array.isArray(chat)) {
            throw new CodecInputError(`${where}.chats[${index}] is not an object.`)
        }
        assertChatNotPointer(chat, chaId, index)
        return chat
    })
    const split = chatObjects.map((chat, index) => splitChat(chat, `${where}.chats[${index}]`))
    const listOwner: JsonObject = { ...owner, chats: split.map((one, index) => assembleChat(one.core, one.chunks, `${where}.chats[${index}]`, one.alt)) }
    return { slot, chaId, owner, chatObjects, split, listOwner }
}

export function encodeCharacter(slot: Slot, position: number, encoder: Encoder): ShardEntry {
    return emitCharacter(normalizeCharacter(slot, position), encoder)
}

/**
 * The part of `encodeCharacter` that writes: it claims the entity id and stores the units. A fault here is an
 * internal inconsistency, never a property of the user's data, so it is not skippable.
 */
export function emitCharacter(normalized: NormalizedCharacter, encoder: Encoder): ShardEntry {
    const { slot, chaId, owner, chatObjects, split, listOwner } = normalized
    const u = encoder.mintU(chaId)
    const { rest, moved, absent } = splitMovedFields(characterCoreFields(owner))
    const coreBody: CharacterCoreBody = { v: 1, f: rest }
    if (absent.length > 0) {
        coreBody.a = absent
    }
    const core = encoder.put(`${IDENTITY.char}${u}:core`, UNIT_TYPE.characterCore, coreBody)
    const loreFields = pickFields(owner, LORE_FIELDS)
    const lore = Object.keys(loreFields).length === 0 ? null
        : encoder.put(`${IDENTITY.char}${u}:lore`, UNIT_TYPE.lore, { v: 1, f: loreFields } satisfies FieldBagBody)
    const scriptFields = pickFields(owner, SCRIPT_FIELDS)
    const scripts = Object.keys(scriptFields).length === 0 ? null
        : encoder.put(`${IDENTITY.char}${u}:scripts`, UNIT_TYPE.scripts, { v: 1, f: scriptFields } satisfies FieldBagBody)

    const lists: ListDerivation = encoder.options.lists
    const al = encoder.putAssetList(`${IDENTITY.alChar}${u}`, lists.characterAssets(listOwner))
    const inlays = lists.characterInlays(listOwner)
    const il = inlays === null ? null : encoder.putInlayList(`${IDENTITY.ilChar}${u}`, inlays)

    const used = new Set<string>()
    const idCounts = new Map<string, number>()
    for (const chat of chatObjects) {
        if (typeof chat.id === 'string') {
            idCounts.set(chat.id, (idCounts.get(chat.id) ?? 0) + 1)
        }
    }
    const stableCids = new Set<string>()
    encoder.stableChats.set(u, stableCids)
    const chats: ChatEntry[] = split.map((one, index) => {
        const { cid, stable } = chatHandle(chatObjects[index], index, used, idCounts)
        if (stable) {
            stableCids.add(cid)
        }
        const coreUnit = encoder.put(`${IDENTITY.chat}${u}:${cid}:core`, UNIT_TYPE.chatCore, one.core)
        const chunks = one.chunks.map((chunk, k) => {
            const family = `${IDENTITY.chat}${u}:${cid}:chunk:`
            const strings = chunkMessageJson(chunk)
            // The messages' strings were written by the split that built this chunk; the array is `[` + strings + `]`.
            const prewritten = strings === undefined ? undefined : new Map<object, string>([[chunk.msgs, '[' + strings.join(',') + ']']])
            const unit = encoder.putReusing(`${family}${k}`, UNIT_TYPE.chatChunk, chunk, family, prewritten)
            return chunkRefTuple(unit.ref, chunk.msgs.length)
        })
        const entry: ChatEntry = { cid, core: refTuple(coreUnit.ref), chunks }
        if (one.alt.length > 0) {
            encoder.chatAlt = true
            entry.alt = one.alt.map((unitBody, k) => {
                const unit = encoder.put(`${IDENTITY.chat}${u}:${cid}:alt:${k}`, UNIT_TYPE.chatAlt, unitBody)
                return chunkRefTuple(unit.ref, unitBody.recs.length)
            })
        }
        return entry
    })

    const entry: ShardEntry = {
        u,
        type: slot.type === 'group' ? 'group' : 'character',
        name: stringOr(owner.name, ''),
        chaId,
        creatorNotes: stubDescription(owner.creatorNotes),
        // A value the entry cannot hold (a first-message index below -1, a fraction) stays in the core; the entry shows 0.
        chatPage: typeof moved.chatPage === 'number' ? moved.chatPage : 0,
        firstMsgIndex: typeof moved.firstMsgIndex === 'number' ? moved.firstMsgIndex : 0,
        core: refTuple(core.ref),
        lore: lore === null ? null : refTuple(lore.ref),
        scripts: scripts === null ? null : refTuple(scripts.ref),
        al,
        il,
        // Whether the character needs display scripts is not traced yet; unsure means true.
        dsp: true,
        chats,
    }
    if (typeof owner.image === 'string') {
        entry.image = owner.image
    }
    if (typeof moved.lastInteraction === 'number') {
        entry.lastInteraction = moved.lastInteraction
    }
    if (typeof moved.trashTime === 'number') {
        entry.trashTime = moved.trashTime
    }
    if (slot.type === 'group') {
        entry.characters = Array.isArray(slot.characters) ? slot.characters.filter((member): member is string => typeof member === 'string') : []
    } else {
        entry.tags = stubTags(slot)
        entry.creator = characterCreator(slot)
    }
    return entry
}

/** The plugins of both lists as plain JSON, in list order, each with its position in its own list. */
export interface NormalizedPlugins {
    readonly items: readonly { list: PluginList, index: number, object: JsonObject }[]
}

/** Reads the plugins out of the live database; nothing here touches an `Encoder`. A fault is never skipped. */
export function normalizePlugins(db: Database): NormalizedPlugins {
    const items: { list: PluginList, index: number, object: JsonObject }[] = []
    for (const list of PLUGIN_LISTS) {
        listOrEmpty((db as unknown as Record<PluginList, unknown>)[list], list).forEach((plugin, index) => {
            items.push({ list, index, object: plainObject(plugin, `${list}[${index}]`) })
        })
    }
    return { items }
}

export function emitPlugins(normalized: NormalizedPlugins, encoder: Encoder): { refs: Ref[], plain: JsonObject[] } {
    const refs: Ref[] = []
    const plain: JsonObject[] = []
    for (const { list, index, object } of normalized.items) {
        plain.push(object)
        const body: PluginBody = { v: 1, list, plugin: object }
        refs.push(refTuple(encoder.put(`plugin:${list}:${index}`, UNIT_TYPE.plugin, body).ref))
    }
    return { refs, plain }
}

export function encodePlugins(db: Database, encoder: Encoder): { refs: Ref[], plain: JsonObject[] } {
    return emitPlugins(normalizePlugins(db), encoder)
}

/** The plugin storage as plain JSON; a key whose value could not be read is in `faults` and in no other part. */
export interface NormalizedPluginStorage {
    readonly plain: JsonObject
    readonly faults: readonly { key: string, cause: unknown }[]
}

/**
 * Whether the plugin storage root can be read one key at a time with the same result as the whole-object read: a plain
 * object with no `toJSON` and no boxed primitive. Any read of the root that throws answers false, and the whole read
 * then fails with its own error.
 */
function readsPerKey(root: unknown): root is Record<string, unknown> {
    try {
        return typeof root === 'object' && root !== null && !Array.isArray(root)
            && !(root instanceof Number || root instanceof String || root instanceof Boolean)
            && typeof (root as { toJSON?: unknown }).toJSON !== 'function'
    } catch {
        return false
    }
}

/**
 * Reads the plugin storage out of the live database. With `skip`, a key whose own value is a fault of the data is
 * recorded in `faults` and the other keys are read; otherwise (or when the root cannot be read per key) the whole
 * object is read and a fault fails here.
 */
export function normalizePluginStorage(db: Database, skip: boolean): NormalizedPluginStorage {
    const root: unknown = db.pluginCustomStorage ?? {}
    if (!skip || !readsPerKey(root)) {
        return { plain: plainObject(root, 'pluginCustomStorage'), faults: [] }
    }
    const plain: JsonObject = {}
    const faults: { key: string, cause: unknown }[] = []
    for (const key of Object.keys(root)) {
        try {
            const value = toPlainJson(root[key])
            if (value !== undefined) {
                defineOwn(plain, key, value)
            }
        } catch (error) {
            if (!isSkippableFault(error)) {
                throw error
            }
            faults.push({ key, cause: error })
        }
    }
    return { plain, faults }
}

/**
 * Plugin storage values are stored as they are. The values that the
 * `_coldplugin` mapping names stay in cold storage; the converter must bring
 * them into units so a restore rolls plugin storage back with the backup.
 *
 * A key that could not be read keeps the unit the previous encoding holds for it, named from its bucket as before; one
 * with no such unit is left out. The puts run bucket by bucket (the units of a bucket's keys, then the bucket), which
 * fixes the order the real keys are minted in.
 */
export function emitPluginStorage(normalized: NormalizedPluginStorage, encoder: Encoder): { refs: Ref[], plain: JsonObject } {
    const storage = normalized.plain
    const held = new Map<string, ReusableUnit>()
    for (const { key, cause } of normalized.faults) {
        const unit = encoder.previous?.units.get(`psv:${key}`)
        const saved = unit !== undefined && unit.type === UNIT_TYPE.pluginStorageValue
        if (saved) {
            held.set(key, unit)
            encoder.inlayOwnerCarried = true
        }
        encoder.skippedItems.push({ scope: 'pluginData', key, label: quoted(key), saved, cause })
    }
    const groups = groupKeysIntoBuckets([...Object.keys(storage), ...held.keys()], PLUGIN_STORAGE_BUCKETS)
    const refs = groups.map((keys, bucket) => {
        const entries = keys.map((key) => {
            const unit = held.get(key)
            if (unit !== undefined) {
                encoder.carried.set(`psv:${key}`, unit)
                return { k: key, ref: refTuple(unit.ref) }
            }
            const body: PluginValueBody = { v: 1, value: storage[key] }
            return { k: key, ref: refTuple(encoder.put(`psv:${key}`, UNIT_TYPE.pluginStorageValue, body).ref) }
        })
        const bucketBody: PluginBucket = { v: 1, entries }
        return refTuple(encoder.putParent(`bucket:${bucket}`, UNIT_TYPE.pluginStorageBucket, bucketBody).ref)
    })
    return { refs, plain: storage }
}

export function encodePluginStorage(db: Database, encoder: Encoder): { refs: Ref[], plain: JsonObject } {
    return emitPluginStorage(normalizePluginStorage(db, false), encoder)
}

/** The first three elements of a Ref and of a ListRef (tail, bytes, crc) agree. */
function sameRefHead(a: Ref | ListRef, b: Ref | ListRef): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/** The previous unit under `identity` when it is a stored, digested unit of `type` that the index ref `ref` names; else undefined. */
function previousUnitOf(previous: PreviousEncoding, identity: string, type: UnitType, ref: Ref | ListRef): ReusableUnit | undefined {
    const unit = previous.units.get(identity)
    return unit !== undefined && unit.type === type && unit.digest !== undefined && sameRefHead(unit.ref, ref) ? unit : undefined
}

/**
 * The previous list units of a module whose unit this encode reused, when carrying them is allowed; null means
 * derive. Carrying needs every one of: the derivation opts in (`moduleListVersions`); the previous module index holds
 * an entry for the handle and its module ref agrees with the units map; the entry names a digested asset list unit
 * and a digested inlay list unit (an entry without an inlay list is derived), each agreeing with the units map and
 * at the opted-in version. A list that is not carried is derived as before.
 *
 * A carried list equals a fresh derivation only under the writer invariant that every module list unit an index entry
 * names was derived from the module unit that same entry names, which `encodeModules` guarantees for every tree this
 * build writes. The module unit is reused only when its bytes (and so its plain module) are the previous ones.
 */
function carriedModuleLists(
    encoder: Encoder, previousEntries: ReadonlyMap<string, ModuleEntry> | null, handle: string,
): { al: ListRef, il: ListRef, units: [string, ReusableUnit][] } | null {
    const versions = encoder.options.lists.moduleListVersions
    const previous = encoder.previous
    const entry = previousEntries?.get(handle)
    if (versions === undefined || previous === null || entry === undefined || entry.il === null) {
        return null
    }
    if (previousUnitOf(previous, `${IDENTITY.module}${handle}`, UNIT_TYPE.module, entry.unit) === undefined) {
        return null
    }
    const alId = `${IDENTITY.alModule}${handle}`
    const alUnit = entry.al[3] === versions.asset ? previousUnitOf(previous, alId, UNIT_TYPE.assetList, entry.al) : undefined
    if (alUnit === undefined) {
        return null
    }
    const ilId = `${IDENTITY.ilModule}${handle}`
    const ilUnit = entry.il[3] === versions.inlay ? previousUnitOf(previous, ilId, UNIT_TYPE.inlayList, entry.il) : undefined
    if (ilUnit === undefined) {
        return null
    }
    // Copies, not the previous arrays; `listRefTuple` also drops an unknown trailing element exactly as a fresh list ref does.
    return { al: listRefTuple(entry.al, entry.al[3]), il: listRefTuple(entry.il, entry.il[3]), units: [[alId, alUnit], [ilId, ilUnit]] }
}

/**
 * Whether a module stub may stand for `entry` without its body. `handles` is the unique-handle set of the whole module
 * list (`uniqueIdHandles`), so a stub's handle `${id}#0` is in it only for a non-empty, non-positional id that exactly
 * one module holds. All five must hold: that handle; a derivation that opts into list versions; an asset list at the
 * current version; an inlay list that exists and is at the current version; and an entry-fields version this build
 * knows. `carryStubAt` carries a stub only when this holds; a stub met with no previous module index at all is refused
 * by `moduleBodyOf`.
 */
export function stubEligible(
    entry: ModuleEntry, handles: ReadonlySet<string>, versions: ListDerivation['moduleListVersions'],
): boolean {
    return handles.has(`${entry.id}#0`)
        && versions !== undefined
        && entry.al[3] === versions.asset
        && entry.il !== null && entry.il[3] === versions.inlay
        && hasCurrentEntryFields(entry)
}

/** The previous unit under `identity` when it is a unit of `type` that the index ref `ref` names by head; a digest is not required. */
function previousUnitByHead(previous: PreviousEncoding, identity: string, type: UnitType, ref: Ref | ListRef): ReusableUnit | undefined {
    const unit = previous.units.get(identity)
    return unit !== undefined && unit.type === type && sameRefHead(unit.ref, ref) ? unit : undefined
}

/**
 * The unique-handle set of a module list snapshot when it holds a module stub, else null (no stub needs it). Ids are read
 * the way `moduleEntryFields` reads them, so the handles are the ones the encode names.
 */
function moduleStubHandles(slots: readonly unknown[]): ReadonlySet<string> | null {
    if (!slots.some(slot => isModuleStub(slot))) {
        return null
    }
    return uniqueIdHandles(slots.map((slot) => {
        const id = typeof slot === 'object' && slot !== null ? (slot as { id?: unknown }).id : undefined
        return { id: typeof id === 'string' ? id : '' }
    }))
}

function moduleStubRefusal(fields: Pick<ModuleEntry, 'id' | 'name'>, reason: ModuleStubReason): StubRefusedError {
    return new StubRefusedError('module', fields.id, null, { name: fields.name, reason })
}

/**
 * The previous units (module, asset list and, when the entry has one, inlay list) that the index entry for `handle`
 * names, matched by ref head and unit type with no digest needed, under the identities `encodeModules` gives them. Null
 * when a unit is missing or the entry's refs are not lists of numbers.
 */
function namedModuleUnits(entry: ModuleEntry, handle: string, previous: PreviousEncoding): [string, ReusableUnit][] | null {
    const wanted: [string, UnitType, Ref | ListRef][] = [
        [`${IDENTITY.module}${handle}`, UNIT_TYPE.module, entry.unit],
        [`${IDENTITY.alModule}${handle}`, UNIT_TYPE.assetList, entry.al],
    ]
    if (entry.il !== null) {
        wanted.push([`${IDENTITY.ilModule}${handle}`, UNIT_TYPE.inlayList, entry.il])
    }
    const found: [string, ReusableUnit][] = []
    for (const [identity, type, ref] of wanted) {
        const unit = previousUnitByHead(previous, identity, type, ref)
        if (unit === undefined) {
            return null
        }
        found.push([identity, unit])
    }
    return found
}

/**
 * The index entry a module stub is carried as, with the three previous units it names (module, asset list, inlay list)
 * set into `encoder.carried` so the next acknowledged encoding still holds them. Refusals, in this order, so a stub that
 * differs from its recorded entry is always `edited` and never reaches a loader that would drop that edit:
 *
 * 1. no well-formed recorded entry for the handle: `uncarriable`;
 * 2. the slot is not exactly the stub minted from that entry: `edited`;
 * 3. a named unit the previous encoding lacks (matched by ref head and unit type, no digest needed), or the entry not
 *    eligible for a stub:
 *    `uncarriable`.
 *
 * The returned entry is a fresh copy and copies `unit`, `al` and `il` element for element, as `moduleStubOf` does: a
 * divergence makes an untouched stub compare as edited, or a carried entry differ from the stub minted from it. The
 * previous entry object is never returned, because the index merge mutates entries.
 */
function carryStubAt(
    module: JsonObject, fields: ReturnType<typeof moduleEntryFields>, handle: string, encoder: Encoder,
    previousEntries: ReadonlyMap<string, ModuleEntry>, handles: ReadonlySet<string> | null,
): ModuleEntry {
    const previous = encoder.previous
    const entry = previousEntries.get(handle)
    if (previous === null || entry === undefined || entry.id !== fields.id || !Array.isArray(entry.unit) || !Array.isArray(entry.al)
        || (entry.il !== null && !Array.isArray(entry.il))) {
        throw moduleStubRefusal(fields, 'uncarriable')
    }
    if (!isRecordedStub(module, entry)) {
        throw moduleStubRefusal(fields, 'edited')
    }
    const found = namedModuleUnits(entry, handle, previous)
    if (found === null) {
        throw moduleStubRefusal(fields, 'uncarriable')
    }
    if (handles === null || !stubEligible(entry, handles, encoder.options.lists.moduleListVersions)) {
        throw moduleStubRefusal(fields, 'uncarriable')
    }
    for (const [identity, unit] of found) {
        encoder.carried.set(identity, unit)
    }
    encoder.carriedModuleNames.push(entry.name !== '' ? entry.name : entry.id)
    return { ...entry, unit: [...entry.unit], al: [...entry.al], il: entry.il === null ? null : [...entry.il] }
}

/** The previous module index entries by handle; null when there is no previous index, which carries nothing. */
function previousModuleEntries(encoder: Encoder): ReadonlyMap<string, ModuleEntry> | null {
    const previousIndex = encoder.previous?.objects?.moduleIndex
    return previousIndex === undefined ? null : new Map(moduleHandles(previousIndex.entries).map((handle, position) => [handle, previousIndex.entries[position]]))
}

/** What an unreadable module needs from the whole pass: whether its id is unique, and how often the previous index holds it. Each is taken once, when first asked. */
interface ModuleFaults {
    liveUnique(): ReadonlySet<string>
    previousCount(id: string): number
}

/** The id of a live module slot, '' when it has none; null when the read throws. */
function rawModuleId(slot: unknown): string | null {
    try {
        const id = typeof slot === 'object' && slot !== null ? (slot as { id?: unknown }).id : undefined
        return typeof id === 'string' ? id : ''
    } catch {
        return null
    }
}

/**
 * The module list snapshot of one pass. A module whose id cannot be read is counted as having none: it fails its own
 * turn and takes the whole set with it, so it never makes another module's id look unique.
 */
function moduleFaultsOf(slots: readonly unknown[], previousEntries: ReadonlyMap<string, ModuleEntry> | null): ModuleFaults {
    let unique: ReadonlySet<string> | null = null
    let counts: Map<string, number> | null = null
    return {
        liveUnique() {
            unique ??= uniqueIdHandles(slots.map(slot => ({ id: rawModuleId(slot) ?? '' })))
            return unique
        },
        previousCount(id) {
            if (counts === null) {
                counts = new Map<string, number>()
                for (const entry of previousEntries?.values() ?? []) {
                    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
                }
            }
            return counts.get(id) ?? 0
        },
    }
}

/**
 * What a pass does with a module it cannot read as plain JSON, when the pass may go on without it. The module is
 * carried singly only when it can be told from every other module on both sides: its id is non-empty, not positional,
 * and held once by the live list and once by the previous index, and every unit its previous entry names is held. A
 * module the previous index does not hold at all is left out. Anything else throws `ModuleSetUnsavableError`, and the
 * caller carries the whole acknowledged module set. `seen` counts the ids met so far, as `encodeModuleAt` does.
 */
function skipModule(
    raw: unknown, fault: unknown, seen: Map<string, number>, encoder: Encoder, previousEntries: ReadonlyMap<string, ModuleEntry> | null,
    faults: ModuleFaults,
): ModuleEntry | null {
    const id = rawModuleId(raw)
    if (id === null) {
        throw new ModuleSetUnsavableError('', '', fault)
    }
    seen.set(id, (seen.get(id) ?? 0) + 1)
    const previous = encoder.previous
    if (previousEntries === null || previous === null) {
        throw fault
    }
    const handle = `${id}#0`
    const name = guardedName(raw)
    if (faults.liveUnique().has(handle)) {
        const count = faults.previousCount(id)
        if (count === 0) {
            encoder.skippedItems.push({ scope: 'module', key: id, label: quoted(name ?? id), saved: false, cause: fault })
            return null
        }
        const entry = previousEntries.get(handle)
        const found = count === 1 && entry !== undefined && entry.id === id && Array.isArray(entry.unit) && Array.isArray(entry.al)
            && (entry.il === null || Array.isArray(entry.il)) ? namedModuleUnits(entry, handle, previous) : null
        if (entry !== undefined && found !== null) {
            for (const [identity, unit] of found) {
                encoder.carried.set(identity, unit)
            }
            encoder.skippedItems.push({ scope: 'module', key: id, label: quoted(entry.name !== '' ? entry.name : entry.id), saved: true, cause: fault })
            return { ...entry, unit: [...entry.unit], al: [...entry.al], il: entry.il === null ? null : [...entry.il] }
        }
    }
    throw new ModuleSetUnsavableError(id, name ?? '', fault)
}

/**
 * One module's turn: its plain copy, unit, both lists and index entry, all produced in this one synchronous call so a
 * module is never torn. `seen` counts the ids met so far and so must run in module order. The sync and the yielding
 * module set both loop this step. With `faults` set, a module whose data cannot be read is skipped (see `skipModule`)
 * and the turn gives no entry.
 */
function encodeModuleAt(
    raw: unknown, index: number, seen: Map<string, number>, encoder: Encoder, previousEntries: ReadonlyMap<string, ModuleEntry> | null,
    handles: ReadonlySet<string> | null, faults: ModuleFaults | null,
): ModuleEntry | null {
    const split = MEASURE ? encoder.split : undefined
    const turnStarted = MEASURE && split !== undefined ? split.now() : 0
    let module: JsonObject
    try {
        module = plainObject(raw, `modules[${index}]`)
    } catch (error) {
        if (faults === null || !isSkippableFault(error)) {
            throw error
        }
        return skipModule(raw, error, seen, encoder, previousEntries, faults)
    }
    if (MEASURE && split !== undefined) {
        split.addMs('splitModuleReadMs', split.now() - turnStarted)
    }
    const fields = moduleEntryFields(module)
    const occurrence = seen.get(fields.id) ?? 0
    seen.set(fields.id, occurrence + 1)
    const handle = `${fields.id}#${occurrence}`
    if (isModuleStub(module) && previousEntries !== null) {
        return carryStubAt(module, fields, handle, encoder, previousEntries, handles)
    }
    const unit = encoder.put(`${IDENTITY.module}${handle}`, UNIT_TYPE.module, moduleBodyOf(module))
    const kept = unit.reused ? carriedModuleLists(encoder, previousEntries, handle) : null
    let entry: ModuleEntry
    if (kept !== null) {
        for (const [identity, listUnit] of kept.units) {
            encoder.carried.set(identity, listUnit)
        }
        entry = { ...fields, unit: taggedUnitRef(unit.ref), al: kept.al, il: kept.il }
    } else {
        const assetsStarted = MEASURE && split !== undefined ? split.now() : 0
        const assets = encoder.options.lists.moduleAssets(module)
        if (MEASURE && split !== undefined) {
            split.addMs('splitModuleListsMs', split.now() - assetsStarted)
        }
        const al = encoder.putAssetList(`${IDENTITY.alModule}${handle}`, assets)
        const inlaysStarted = MEASURE && split !== undefined ? split.now() : 0
        const inlays = encoder.options.lists.moduleInlays(module)
        if (MEASURE && split !== undefined) {
            split.addMs('splitModuleListsMs', split.now() - inlaysStarted)
        }
        const il = inlays === null ? null : encoder.putInlayList(`${IDENTITY.ilModule}${handle}`, inlays)
        entry = { ...fields, unit: taggedUnitRef(unit.ref), al, il }
    }
    if (MEASURE && split !== undefined) {
        split.addMs('splitModulesMs', split.now() - turnStarted)
        split.splitModuleCount()
    }
    return entry
}

export function encodeModules(db: Database, encoder: Encoder): ModuleEntry[] {
    const seen = new Map<string, number>()
    const previousEntries = previousModuleEntries(encoder)
    const slots = listOrEmpty(db.modules, 'modules')
    const handles = moduleStubHandles(slots)
    const faults = encoder.skipItems ? moduleFaultsOf(slots, previousEntries) : null
    const entries: ModuleEntry[] = []
    slots.forEach((raw, index) => {
        const entry = encodeModuleAt(raw, index, seen, encoder, previousEntries, handles, faults)
        if (entry !== null) {
            entries.push(entry)
        }
    })
    return entries
}

/**
 * Splits `db` into units and the manifest naming them. Throws `StubRefusedError`
 * for a cold-stub character or pointer chat, and `CodecInputError` for a shape
 * the codec cannot store faithfully. The result holds every unit; those flagged
 * `reused` are already stored under the same key.
 */
export function encodeDatabase(db: Database, options: EncodeOptions): EncodedTree {
    checkDatabase(db, options)
    const encoder = new Encoder(options, options.previous ?? null)
    const front = encodeFront(db, encoder)
    const moduleSet = encodeModuleSet(db, encoder)
    const entries = db.characters.map((slot, position) => encodeCharacter(slot, position, encoder))
    return finishTree(db, encoder, front, moduleSet, entries, new Map())
}

/** Refuses the inputs no encode can work with. */
export function checkDatabase(db: Database, options: EncodeOptions): void {
    if (typeof options.lists !== 'object' || options.lists === null) {
        throw new TypeError('encodeDatabase needs the asset and inlay list derivation; there is no default.')
    }
    if (!Array.isArray(db.characters)) {
        throw new CodecInputError('characters is not a list.')
    }
    if (!Array.isArray(db.botPresets)) {
        throw new CodecInputError('botPresets is not a list.')
    }
    if (db.taskPresets !== undefined && !Array.isArray(db.taskPresets)) {
        throw new CodecInputError('taskPresets is not a list.')
    }
}

/** The units of the first part of the tree: presets, plugins and plugin storage. */
export interface FrontParts {
    presets: Ref[]
    presetPlain: JsonObject[]
    /** One type 26 unit per task preset; empty when the database has none. */
    taskPresets: Ref[]
    plugins: { refs: Ref[], plain: JsonObject[] }
    pluginStorage: { refs: Ref[], plain: JsonObject }
    /** The bot preset list is the previous encoding's, so `config.botPresetsId` must not name any stored preset (see `finishTree`). */
    botPresetsCarried: boolean
}

/** One preset list read out of the live database: every preset as plain JSON, or the faults of the list. */
interface NormalizedPresets {
    readonly plain: readonly JsonObject[]
    /** The first fault of the list and the quoted names of every preset that faulted; null when the list is whole. */
    readonly fault: { cause: unknown, labels: readonly string[] } | null
}

/** Reads the front of the live database; nothing here touches an `Encoder`, so a skip never has to undo a put. */
interface NormalizedFront {
    readonly presets: NormalizedPresets
    readonly taskPresets: NormalizedPresets
    readonly plugins: NormalizedPlugins
    readonly pluginStorage: NormalizedPluginStorage
}

/**
 * The presets of one list as plain JSON. With `skip`, a preset that is a fault of the data is recorded under its name
 * (else its position) and the rest of the list is still read; otherwise the first fault fails here.
 */
function normalizePresets(list: readonly unknown[], where: 'botPresets' | 'taskPresets', skip: boolean): NormalizedPresets {
    const plain: JsonObject[] = []
    const labels: string[] = []
    const causes: unknown[] = []
    // The preset object is written whole, as a bot preset is: a key this build does not know travels with it.
    list.forEach((preset, index) => {
        try {
            plain.push(plainObject(preset, `${where}[${index}]`))
        } catch (error) {
            if (!skip || !isSkippableFault(error)) {
                throw error
            }
            causes.push(error)
            labels.push(quoted(guardedName(preset) ?? `${where}[${index}]`))
        }
    })
    return { plain, fault: causes.length === 0 ? null : { cause: causes[0], labels } }
}

function normalizeFront(db: Database, encoder: Encoder): NormalizedFront {
    // Without an earlier encoding there is no saved copy to fall back on: the fault fails the pass.
    const skip = encoder.skipItems && encoder.previous !== null
    const presets = normalizePresets(db.botPresets, 'botPresets', skip)
    const taskPresets = normalizePresets(db.taskPresets ?? [], 'taskPresets', skip)
    const plugins = normalizePlugins(db)
    const pluginStorage = normalizePluginStorage(db, skip)
    return { presets, taskPresets, plugins, pluginStorage }
}

/**
 * The previous encoding's list of presets, taken as it stands: the refs the previous manifest names, each checked
 * against the previous unit under the same identity by ref head and type, and the units set into `encoder.carried` so
 * the next acknowledged encoding still holds them. Null when there is no previous manifest or a unit does not match: a
 * partial or invented list is never written. An acknowledged empty list is carried as the empty list.
 */
function carriedPresetRefs(encoder: Encoder, kind: 'presets' | 'taskPresets'): Ref[] | null {
    const previous = encoder.previous
    const manifest = previous?.objects?.manifest
    if (previous === null || manifest === undefined) {
        return null
    }
    const held = kind === 'presets' ? manifest.fixed.presets : manifest.fixed.taskPresets ?? []
    const prefix = kind === 'presets' ? 'preset:' : 'taskPreset:'
    const type = kind === 'presets' ? UNIT_TYPE.preset : UNIT_TYPE.taskPreset
    const refs = held.map(ref => refTuple(ref))
    const found: [string, ReusableUnit][] = []
    for (let index = 0; index < refs.length; index++) {
        const unit = previousUnitByHead(previous, `${prefix}${index}`, type, refs[index])
        if (unit === undefined) {
            return null
        }
        found.push([`${prefix}${index}`, unit])
    }
    for (const [identity, unit] of found) {
        encoder.carried.set(identity, unit)
    }
    return refs
}

/**
 * Puts one preset list, or carries the previous one when a preset of it could not be read: the whole list is held
 * (a preset's position is its identity, so a shifted list cannot be saved in part), and the live list's other presets
 * are not written. Without a carry the first fault is thrown.
 */
function emitPresets(
    normalized: NormalizedPresets, kind: 'presets' | 'taskPresets', encoder: Encoder,
): { refs: Ref[], plain: JsonObject[], carried: boolean } {
    if (normalized.fault !== null) {
        const refs = carriedPresetRefs(encoder, kind)
        if (refs === null) {
            throw normalized.fault.cause
        }
        encoder.skippedItems.push({
            scope: kind, key: kind, label: normalized.fault.labels.join(', '), saved: true, cause: normalized.fault.cause,
        })
        encoder.inlayOwnerCarried = true
        return { refs, plain: [], carried: true }
    }
    const refs = normalized.plain.map((object, index) => {
        const body: PresetBody = { v: 1, preset: object }
        return kind === 'presets'
            ? refTuple(encoder.put(`preset:${index}`, UNIT_TYPE.preset, body).ref)
            : refTuple(encoder.put(`taskPreset:${index}`, UNIT_TYPE.taskPreset, body).ref)
    })
    return { refs, plain: [...normalized.plain], carried: false }
}

/** Every read of the live database that can throw happens in `normalizeFront`; `emitFront` then puts in the order the real keys are minted in. */
export function encodeFront(db: Database, encoder: Encoder): FrontParts {
    const normalized = normalizeFront(db, encoder)
    const bot = emitPresets(normalized.presets, 'presets', encoder)
    const task = emitPresets(normalized.taskPresets, 'taskPresets', encoder)
    const plugins = emitPlugins(normalized.plugins, encoder)
    const pluginStorage = emitPluginStorage(normalized.pluginStorage, encoder)
    return { presets: bot.refs, presetPlain: bot.plain, taskPresets: task.refs, plugins, pluginStorage, botPresetsCarried: bot.carried }
}

/** The module index as the manifest names it and as the next encode carries unknown fields from it. */
export interface ModuleSet {
    body: ModuleIndex
    ref: Ref
    buckets: Ref[] | null
}

/** Encodes the modules and the module index. */
export function encodeModuleSet(db: Database, encoder: Encoder): ModuleSet {
    return finishModuleSet(encodeModules(db, encoder), encoder)
}

/** The module index over the encoded entries. */
function finishModuleSet(moduleEntries: ModuleEntry[], encoder: Encoder): ModuleSet {
    const split = MEASURE ? encoder.split : undefined
    const started = MEASURE && split !== undefined ? split.now() : 0
    const body = carryModuleIndex(encoder.previous?.objects?.moduleIndex, { v: 1, entries: moduleEntries })
    if (MODULE_INDEX_PARAMS.MODULE_INDEX_LAYOUT === 2) {
        const count = Math.min(16, 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(body.entries.length / 16)))))
        const grouped = Array.from({ length: count }, (): ModuleEntry[] => [])
        for (const entry of body.entries) {
            grouped[bucketOfKey(entry.id, count)].push(entry)
        }
        const buckets = grouped.map((entries, index) => {
            entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            return refTuple(encoder.putParent(`moduleIndex:bucket:${index}`, UNIT_TYPE.moduleBucket, { v: 1, entries }).ref)
        })
        const handles = moduleHandles(body.entries)
        const root = carryUnknownFields(body, { v: 2 as const, handles }, KNOWN_FIELDS.moduleIndex)
        const unit = encoder.put(IDENTITY.moduleIndex, UNIT_TYPE.moduleIndex, root)
        if (MEASURE && split !== undefined) {
            split.addMs('splitModulesMs', split.now() - started)
        }
        return { body, ref: refTuple(unit.ref), buckets }
    }
    const unit = encoder.putParent(IDENTITY.moduleIndex, UNIT_TYPE.moduleIndex, body)
    if (MEASURE && split !== undefined) {
        split.addMs('splitModulesMs', split.now() - started)
    }
    return { body, ref: refTuple(unit.ref), buckets: null }
}

/**
 * `encodeModuleSet` that awaits `yieldFn` after each module, so no single task holds the page for the whole set. The
 * module list is copied before the first await and only that copy is read: a module added, removed or reordered
 * during a yield reaches the next pass, and the committed index names exactly this list. A module edited inside its
 * own turn is whole; one edited after its turn is the next pass's.
 */
export async function encodeModuleSetYielding(db: Database, encoder: Encoder, yieldFn: (() => Promise<void>) | undefined): Promise<ModuleSet> {
    const modules = [...listOrEmpty(db.modules, 'modules')]
    const seen = new Map<string, number>()
    const previousEntries = previousModuleEntries(encoder)
    const handles = moduleStubHandles(modules)
    const faults = encoder.skipItems ? moduleFaultsOf(modules, previousEntries) : null
    const moduleEntries: ModuleEntry[] = []
    for (let index = 0; index < modules.length; index++) {
        const entry = encodeModuleAt(modules[index], index, seen, encoder, previousEntries, handles, faults)
        if (entry !== null) {
            moduleEntries.push(entry)
        }
        await yieldFn?.()
    }
    return finishModuleSet(moduleEntries, encoder)
}

/** Whether both lists hold the same entry objects in the same order. */
function sameEntryObjects(a: readonly ShardEntry[], b: readonly ShardEntry[]): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) {
            return false
        }
    }
    return true
}

/**
 * The unit of shard `index`. A shard whose entries are the previous shard's entry objects, in the same order, is the
 * previous unit: it is taken without being framed or digested. That holds only when the previous body is one this
 * encoder framed (`shardDigestOf`) and the previous unit carries that same digest; a body parsed at boot is not
 * trusted, and the pass encodes it. The new body equals the previous one canonically, because `carryShards` copies the
 * previous body's unknown fields when the shard count is equal, so `put` would have reused the same unit.
 */
function putShard(encoder: Encoder, index: number, shard: Shard, previousShard: Shard | undefined): EncodedUnit {
    const identity = `shard:${index}`
    if (previousShard !== undefined) {
        const trusted = shardDigestOf(previousShard)
        if (trusted !== undefined && encoder.previous?.units.get(identity)?.digest === trusted
            && sameEntryObjects(shard.entries, previousShard.entries)) {
            encoder.parents.set(identity, { type: UNIT_TYPE.shard, body: shard })
            const unit = encoder.sink.reuseAt(identity, UNIT_TYPE.shard)
            if (unit !== null) {
                return unit
            }
        }
    }
    return encoder.putParent(identity, UNIT_TYPE.shard, shard, 'shard')
}

/**
 * The config fields of `db`. With `skipItems` and a previous config to fall back on, a field that cannot be read keeps
 * its saved value (see `configFieldsSkipping`); without one the field fails the pass. While the bot preset list is
 * carried, `botPresetsId` is the first index past the end of the carried list: it names no stored preset, so a later
 * preset switch cannot write the working settings into one, and boot repair appends them as a new preset instead.
 */
function configOf(db: Database, encoder: Encoder, botPresetsCarried: boolean): JsonObject {
    const held = encoder.previous?.objects?.config
    let config: JsonObject
    if (encoder.skipItems && held !== undefined) {
        const { fields, skipped } = configFieldsSkipping(db, held)
        encoder.skippedItems.push(...skipped)
        config = fields
    } else {
        config = configFields(db)
    }
    if (botPresetsCarried) {
        const length = encoder.previous?.objects?.manifest?.fixed.presets.length
        if (length === undefined) {
            throw new CodecInputError('The carried bot presets have no previous manifest to name them.')
        }
        defineOwn(config, 'botPresetsId', length)
    }
    return config
}

/**
 * Completes the tree from the parts the caller produced: the shards of `entries`,
 * the fixed units and the manifest. `carried` are the previous units this
 * encode kept without encoding them; they are part of the next `previous`.
 */
export function finishTree(
    db: Database, encoder: Encoder, front: FrontParts, moduleSet: ModuleSet, entries: ShardEntry[],
    carried: ReadonlyMap<string, ReusableUnit>,
): EncodedTree {
    const options = encoder.options
    const split = MEASURE ? encoder.split : undefined
    if (MEASURE && split !== undefined) {
        split.section = 'finish'
    }
    const shardsStarted = MEASURE && split !== undefined ? split.now() : 0
    const { presets, presetPlain, taskPresets, plugins, pluginStorage } = front
    const shardCount = shardCountFor(entries.length, encoder.previous?.objects?.manifest?.shardCount)
    const shardBodies = carryShards(encoder.previous?.objects?.shards, groupIntoShards(entries, shardCount), encoder.stableChats)
    const previousShards = encoder.previous?.objects?.shards
    const shards = shardBodies.map((shard, index) => {
        const unit = putShard(encoder, index, shard, previousShards?.length === shardCount ? previousShards[index] : undefined)
        // The unit's digest is the digest of this body's canonical frame, whether it was just framed or taken from the previous unit.
        noteShardDigest(shard, unit.digest)
        return refTuple(unit.ref)
    })
    const fixedStarted = MEASURE && split !== undefined ? split.now() : 0
    if (MEASURE && split !== undefined) {
        split.addMs('splitFinishShardsMs', fixedStarted - shardsStarted)
    }

    const loadoutItems = listOrEmpty(db.loadouts, 'loadouts').map((item) => toPlainJson(item) ?? null)
    const loadouts = encoder.put('loadouts', UNIT_TYPE.loadouts, { v: 1, items: loadoutItems } satisfies LoadoutsBody)
    const statics = toPlainJson(db.statics)
    const staticsBody: StaticsBody = statics === undefined ? { v: 1 } : { v: 1, value: statics }
    const staticsUnit = encoder.put('statics', UNIT_TYPE.statics, staticsBody)
    const characterOrder = toPlainJson(db.characterOrder)
    const orderBody: OrderBody = { v: 1, chars: entries.map(entry => entry.u) }
    if (characterOrder !== undefined) {
        orderBody.characterOrder = characterOrder
    }
    const order = encoder.put('order', UNIT_TYPE.order, orderBody)

    if (MEASURE && split !== undefined) {
        split.addMs('splitFinishFixedMs', split.now() - fixedStarted)
    }
    const configStarted = MEASURE && split !== undefined ? split.now() : 0
    const config = configOf(db, encoder, front.botPresetsCarried)
    const configOwner: ConfigOwner = {
        config,
        presets: presetPlain,
        plugins: plugins.plain,
        pluginStorage: pluginStorage.plain,
        loadouts: loadoutItems,
        statics,
        characterOrder,
    }
    const configUnit = encoder.put('config', UNIT_TYPE.configRoot, { v: 1, f: config } satisfies ConfigBody)
    const configAl = encoder.putAssetList('al:config', options.lists.configAssets(configOwner))
    // A carried preset list or plugin-data value is not in `configOwner`, so the list cannot be exact: it is the overflow body.
    const fixedIl = encoder.putInlayList('il:config', encoder.inlayOwnerCarried ? overflowInlayList() : options.lists.configInlays(configOwner))

    if (MEASURE && split !== undefined) {
        split.addMs('splitFinishConfigMs', split.now() - configStarted)
    }
    const manifestStarted = MEASURE && split !== undefined ? split.now() : 0
    const manifest = carryManifest(encoder.previous?.objects?.manifest, buildManifest({
        chatAlt: encoder.chatAlt,
        seq: options.seq,
        createdAt: options.createdAt,
        shardCount,
        shards,
        config: refTuple(configUnit.ref),
        configAl,
        il: fixedIl,
        statics: refTuple(staticsUnit.ref),
        order: refTuple(order.ref),
        loadouts: refTuple(loadouts.ref),
        moduleIndex: refTuple(moduleSet.ref),
        moduleBuckets: moduleSet.buckets ?? undefined,
        presets,
        taskPresets,
        plugins: plugins.refs,
        pluginStorageRefs: pluginStorage.refs,
    }))
    encoder.parents.set('manifest', { type: UNIT_TYPE.manifest, body: manifest })
    const manifestUnit = encoder.sink.putFresh('manifest', UNIT_TYPE.manifest, manifest, 'manifest')

    const units = encoder.sink.units
    const indexUnits = new Map<string, ReusableUnit>([...carried, ...encoder.carried])
    for (const unit of units) {
        indexUnits.set(unit.identity, { key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest })
    }
    if (MEASURE && split !== undefined) {
        split.addMs('splitFinishManifestMs', split.now() - manifestStarted)
    }
    return {
        manifestKey: manifestUnit.key,
        manifest,
        units,
        index: {
            units: indexUnits,
            entities: encoder.entities,
            objects: { manifest, shards: shardBodies, moduleIndex: moduleSet.body, config },
        },
    }
}

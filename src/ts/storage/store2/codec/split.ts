import type { JsonObject, JsonValue } from '../../blockFrame'
import type { Database, character, groupChat } from '../../database.svelte'
import { characterCreator, stubDescription, stubTags } from '../../../process/coldCharacter'
import {
    randomId26, UNIT_TYPE,
    type ChatEntry, type ListRef, type ModuleEntry, type ModuleIndex, type PluginBucket, type Ref, type ShardEntry, type UnitType,
} from '../format'
import {
    CONFIG_PARTITIONED_FIELDS, DERIVED_COLD_FIELDS, ENTRY_MOVED_FIELDS, ENTRY_REQUIRED_MOVED_FIELDS, LORE_FIELDS, PLUGIN_LISTS,
    SCRIPT_FIELDS, VOLATILE_CHARACTER_FIELDS,
    type CharacterCoreBody, type ConfigBody, type FieldBagBody, type LoadoutsBody, type OrderBody, type PluginBody,
    type PluginList, type PluginValueBody, type PresetBody, type StaticsBody,
} from './bodies'
import { assembleChat, splitChat } from './chat'
import { buildManifest, carryManifest } from './manifest'
import { carryModuleIndex, moduleBodyOf, moduleEntryFields } from './modules'
import { defineOwn, listOrEmpty, omitFields, pickFields, plainObject, toPlainJson } from './normalize'
import { groupKeysIntoBuckets, PLUGIN_STORAGE_BUCKETS } from './pluginStorage'
import { UnitSink, type UnitKeyKind } from './reuse'
import { carryShards, chunkRefTuple, groupIntoShards, listRefTuple, refTuple, SHARD_COUNT } from './shard'
import { assertChatNotPointer, assertNotStub } from './stub'
import {
    CodecInputError, type ConfigOwner, type EncodedTree, type EncodedUnit, type EncodeOptions, type ListDerivation,
    type PreviousEncoding, type ReusableUnit,
} from './types'

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

/** The character fields the core keeps before the moved fields are taken out: everything but chats, lore, scripts. Unknown fields stay. */
export function characterCoreFields(owner: JsonObject): JsonObject {
    return omitFields(owner, ['chats', ...LORE_FIELDS, ...SCRIPT_FIELDS])
}

function movable(name: string, value: JsonValue): boolean {
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
    private readonly occurrences = new Map<string, number>()
    private readonly usedU = new Set<string>()

    constructor(readonly options: EncodeOptions, readonly previous: PreviousEncoding | null) {
        this.sink = new UnitSink(options.env, previous, options.keys)
    }

    put(identity: string, type: UnitType, body: object, kind: UnitKeyKind = 'unit'): EncodedUnit {
        return this.sink.put(identity, type, body, kind)
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

export function encodeCharacter(slot: Slot, position: number, encoder: Encoder): ShardEntry {
    const where = `characters[${position}]`
    if (typeof slot !== 'object' || slot === null) {
        throw new CodecInputError(`${where} is not an object.`)
    }
    const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
    assertNotStub(slot, chaId)
    const owner = omitFields(plainObject(slot, where), [...DERIVED_COLD_FIELDS, ...VOLATILE_CHARACTER_FIELDS])
    const rawChats = listOrEmpty(owner.chats, `${where}.chats`) as JsonValue[]
    const chatObjects = rawChats.map((chat, index) => {
        if (typeof chat !== 'object' || chat === null || Array.isArray(chat)) {
            throw new CodecInputError(`${where}.chats[${index}] is not an object.`)
        }
        assertChatNotPointer(chat, chaId, index)
        return chat
    })
    const split = chatObjects.map((chat, index) => splitChat(chat, `${where}.chats[${index}]`))
    const listOwner: JsonObject = { ...owner, chats: split.map((one, index) => assembleChat(one.core, one.chunks, `${where}.chats[${index}]`)) }

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
            const unit = encoder.put(`${IDENTITY.chat}${u}:${cid}:chunk:${k}`, UNIT_TYPE.chatChunk, chunk)
            return chunkRefTuple(unit.ref, chunk.msgs.length)
        })
        return { cid, core: refTuple(coreUnit.ref), chunks }
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

export function encodePlugins(db: Database, encoder: Encoder): { refs: Ref[], plain: JsonObject[] } {
    const refs: Ref[] = []
    const plain: JsonObject[] = []
    for (const list of PLUGIN_LISTS) {
        listOrEmpty((db as unknown as Record<PluginList, unknown>)[list], list).forEach((plugin, index) => {
            const object = plainObject(plugin, `${list}[${index}]`)
            plain.push(object)
            const body: PluginBody = { v: 1, list, plugin: object }
            refs.push(refTuple(encoder.put(`plugin:${list}:${index}`, UNIT_TYPE.plugin, body).ref))
        })
    }
    return { refs, plain }
}

/**
 * Plugin storage values are stored as they are. The values that the
 * `_coldplugin` mapping names stay in cold storage; the converter must bring
 * them into units so a restore rolls plugin storage back with the backup.
 */
export function encodePluginStorage(db: Database, encoder: Encoder): { refs: Ref[], plain: JsonObject } {
    const storage = plainObject(db.pluginCustomStorage ?? {}, 'pluginCustomStorage')
    const groups = groupKeysIntoBuckets(Object.keys(storage), PLUGIN_STORAGE_BUCKETS)
    const refs = groups.map((keys, bucket) => {
        const entries = keys.map((key) => {
            const body: PluginValueBody = { v: 1, value: storage[key] }
            return { k: key, ref: refTuple(encoder.put(`psv:${key}`, UNIT_TYPE.pluginStorageValue, body).ref) }
        })
        const bucketBody: PluginBucket = { v: 1, entries }
        return refTuple(encoder.putParent(`bucket:${bucket}`, UNIT_TYPE.pluginStorageBucket, bucketBody).ref)
    })
    return { refs, plain: storage }
}

export function encodeModules(db: Database, encoder: Encoder): ModuleEntry[] {
    const seen = new Map<string, number>()
    return listOrEmpty(db.modules, 'modules').map((raw, index) => {
        const module = plainObject(raw, `modules[${index}]`)
        const fields = moduleEntryFields(module)
        const occurrence = seen.get(fields.id) ?? 0
        seen.set(fields.id, occurrence + 1)
        const handle = `${fields.id}#${occurrence}`
        const unit = encoder.put(`${IDENTITY.module}${handle}`, UNIT_TYPE.module, moduleBodyOf(module))
        const al = encoder.putAssetList(`${IDENTITY.alModule}${handle}`, encoder.options.lists.moduleAssets(module))
        const inlays = encoder.options.lists.moduleInlays(module)
        const il = inlays === null ? null : encoder.putInlayList(`${IDENTITY.ilModule}${handle}`, inlays)
        return { ...fields, unit: refTuple(unit.ref), al, il }
    })
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
}

/** The units of the first part of the tree: presets, plugins and plugin storage. */
export interface FrontParts {
    presets: Ref[]
    presetPlain: JsonObject[]
    plugins: { refs: Ref[], plain: JsonObject[] }
    pluginStorage: { refs: Ref[], plain: JsonObject }
}

export function encodeFront(db: Database, encoder: Encoder): FrontParts {
    const presets: Ref[] = []
    const presetPlain: JsonObject[] = []
    db.botPresets.forEach((preset, index) => {
        const object = plainObject(preset, `botPresets[${index}]`)
        presetPlain.push(object)
        const body: PresetBody = { v: 1, preset: object }
        presets.push(refTuple(encoder.put(`preset:${index}`, UNIT_TYPE.preset, body).ref))
    })
    const plugins = encodePlugins(db, encoder)
    const pluginStorage = encodePluginStorage(db, encoder)
    return { presets, presetPlain, plugins, pluginStorage }
}

/** The module index as the manifest names it and as the next encode carries unknown fields from it. */
export interface ModuleSet {
    body: ModuleIndex
    ref: Ref
}

/** Encodes the modules and the module index. */
export function encodeModuleSet(db: Database, encoder: Encoder): ModuleSet {
    const moduleEntries = encodeModules(db, encoder)
    const body = carryModuleIndex(encoder.previous?.objects?.moduleIndex, { v: 1, entries: moduleEntries })
    const unit = encoder.putParent(IDENTITY.moduleIndex, UNIT_TYPE.moduleIndex, body)
    return { body, ref: refTuple(unit.ref) }
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
    const { presets, presetPlain, plugins, pluginStorage } = front
    const shardBodies = carryShards(encoder.previous?.objects?.shards, groupIntoShards(entries, SHARD_COUNT), encoder.stableChats)
    const shards = shardBodies.map((shard, index) => refTuple(encoder.putParent(`shard:${index}`, UNIT_TYPE.shard, shard, 'shard').ref))

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

    const config = configFields(db)
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
    const fixedIl = encoder.putInlayList('il:config', options.lists.configInlays(configOwner))

    const manifest = carryManifest(encoder.previous?.objects?.manifest, buildManifest({
        seq: options.seq,
        createdAt: options.createdAt,
        shards,
        config: refTuple(configUnit.ref),
        configAl,
        il: fixedIl,
        statics: refTuple(staticsUnit.ref),
        order: refTuple(order.ref),
        loadouts: refTuple(loadouts.ref),
        moduleIndex: refTuple(moduleSet.ref),
        presets,
        plugins: plugins.refs,
        pluginStorageRefs: pluginStorage.refs,
    }))
    encoder.parents.set('manifest', { type: UNIT_TYPE.manifest, body: manifest })
    const manifestUnit = encoder.sink.putFresh('manifest', UNIT_TYPE.manifest, manifest, 'manifest')

    const units = encoder.sink.units
    const indexUnits = new Map<string, ReusableUnit>(carried)
    for (const unit of units) {
        indexUnits.set(unit.identity, { key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest })
    }
    return {
        manifestKey: manifestUnit.key,
        manifest,
        units,
        index: {
            units: indexUnits,
            entities: encoder.entities,
            objects: { manifest, shards: shardBodies, moduleIndex: moduleSet.body },
        },
    }
}

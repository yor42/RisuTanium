import {
    FRAME_OVERHEAD, keyOfRef, readUnit, refOfFrame, UNIT_TYPE,
    type ContentBody, type Manifest, type ModuleBucket, type ModuleEntry, type ModuleIndex, type ModuleIndexRoot, type PluginBucket, type Ref, type Shard, type ShardEntry, type UnitType, type WorkspaceRecord,
} from './format'
import type { JsonObject } from '../blockFrame'
import {
    CodecAssembleError, IDENTITY, isJsonObject, PLUGIN_LISTS, readStringListField, unitDigest,
    type PluginList, type PreviousEncoding, type PreviousObjects, type ReusableUnit, type UnitSource,
} from './codec'
import { moduleIndexOfParts } from './codec/modules'

/**
 * The `previous` of a first pass after a boot: the encoding of a stored tree, built from the units the boot read.
 * Identities, digests and entity ids come out the way `previousFrom` of the tree's own encode holds them, so a pass
 * that changes nothing reuses every unit instead of rewriting it.
 *
 * Shards, the module index, the plugin-storage buckets and the order unit are required: a carry and the entity ids
 * read their bodies. Every other unit is optional. A unit the boot did not read (an unloaded character's, a stub's)
 * is kept by key and Ref without a digest: it is carried and never compared, and a unit without a digest is never
 * reused, so it can only be rewritten, never wrongly kept.
 */

export interface StoredTree {
    manifestKey: string
    manifest: Manifest
    /** The framed bytes of every unit the boot read; a unit it did not read answers undefined. */
    source: UnitSource
}

export interface PreviousOfTreeOptions {
    /** Keep the unit bytes for a byte-for-byte comparison, at the memory cost of holding every unit read. */
    keepBytes?: boolean
}

/** The unit's bytes when the source holds them and they are the unit the Ref names (length and checksum). */
export function checkedBytes(source: UnitSource, ref: Ref): Uint8Array | undefined {
    const key = keyOfRef(ref)
    const bytes = source.get(key)
    if (bytes === undefined || bytes.length < FRAME_OVERHEAD) {
        return undefined
    }
    const actual = refOfFrame(key, bytes)
    return actual[1] === ref[1] && actual[2] === ref[2] ? bytes : undefined
}

/** Module handle: the id, told apart from a repeated id by occurrence; the handle `encodeModules` names its units by. */
export function moduleHandles(index: ModuleIndex): string[] {
    const seen = new Map<string, number>()
    return index.entries.map((entry) => {
        const occurrence = seen.get(entry.id) ?? 0
        seen.set(entry.id, occurrence + 1)
        return `${entry.id}#${occurrence}`
    })
}

/**
 * Every unit one shard entry names, as `register` takes it: the identity the encoder gives the unit, its type and its
 * Ref. The boot registration and a later hydration of one loaded entity walk the entry through this one function, so
 * they cannot disagree on which identity a unit has.
 */
export function registerEntityUnits(entry: ShardEntry, register: (identity: string, type: UnitType, ref: Ref) => unknown): void {
    register(`${IDENTITY.char}${entry.u}:core`, UNIT_TYPE.characterCore, entry.core)
    if (entry.lore !== null) {
        register(`${IDENTITY.char}${entry.u}:lore`, UNIT_TYPE.lore, entry.lore)
    }
    if (entry.scripts !== null) {
        register(`${IDENTITY.char}${entry.u}:scripts`, UNIT_TYPE.scripts, entry.scripts)
    }
    register(`${IDENTITY.alChar}${entry.u}`, UNIT_TYPE.assetList, entry.al)
    if (entry.il !== null) {
        register(`${IDENTITY.ilChar}${entry.u}`, UNIT_TYPE.inlayList, entry.il)
    }
    for (const chat of entry.chats) {
        register(`${IDENTITY.chat}${entry.u}:${chat.cid}:core`, UNIT_TYPE.chatCore, chat.core)
        chat.chunks.forEach((chunk, k) => register(`${IDENTITY.chat}${entry.u}:${chat.cid}:chunk:${k}`, UNIT_TYPE.chatChunk, chunk))
        chat.alt?.forEach((unit, k) => register(`${IDENTITY.chat}${entry.u}:${chat.cid}:alt:${k}`, UNIT_TYPE.chatAlt, unit))
    }
}

/**
 * Gives the units of a loaded entity the digests the boot did not compute, in place: the objects of `previous` are the
 * ones the save encoder holds and carries across commits, and replacing them would throw its acknowledgement. A unit
 * is hydrated only when `previous` holds it under this identity with the same key, length and checksum as the entry's
 * Ref, and `source` holds bytes that are that unit; a unit that moved, or that is absent or damaged, stays as it was.
 * The digest is a pure function of the bytes behind a key that is never written twice, so a second call changes
 * nothing.
 */
export function hydrateEntityDigests(previous: PreviousEncoding, entry: ShardEntry, source: UnitSource): void {
    registerEntityUnits(entry, digestHydrator(previous, source))
}

/** The `register` of a hydration: gives the unit `previous` holds under the identity its digest, under the conditions of `hydrateEntityDigests`. */
function digestHydrator(previous: PreviousEncoding, source: UnitSource): (identity: string, type: UnitType, ref: Ref) => void {
    return (identity, type, ref) => {
        const unit = previous.units.get(identity)
        if (unit === undefined || unit.digest !== undefined || unit.type !== type || unit.key !== keyOfRef(ref)
            || unit.ref[1] !== ref[1] || unit.ref[2] !== ref[2]) {
            return
        }
        const bytes = checkedBytes(source, ref)
        if (bytes !== undefined) {
            unit.digest = unitDigest(bytes)
        }
    }
}

/**
 * Every unit one module index entry names, as `register` takes it, under the identities `encodeModules` gives them
 * for the module `handle`. The boot registration and a later hydration of one loaded module walk the entry through
 * this one function, so they cannot disagree on which identity a unit has.
 */
export function registerModuleUnits(entry: ModuleEntry, handle: string, register: (identity: string, type: UnitType, ref: Ref) => unknown): void {
    register(`${IDENTITY.module}${handle}`, UNIT_TYPE.module, entry.unit)
    register(`${IDENTITY.alModule}${handle}`, UNIT_TYPE.assetList, entry.al)
    if (entry.il !== null) {
        register(`${IDENTITY.ilModule}${handle}`, UNIT_TYPE.inlayList, entry.il)
    }
}

/**
 * `hydrateEntityDigests` for one loaded module: its module unit and its two lists get the digests the boot did not
 * compute, in place and only where `previous` holds the unit under this identity with the entry's key, length and
 * checksum and `source` holds bytes that are that unit. A list the read withheld (absent, damaged, or of a version above this build's) stays without a
 * digest and is derived and written again by the next pass. A second call changes nothing.
 */
export function hydrateModuleDigests(previous: PreviousEncoding, entry: ModuleEntry, handle: string, source: UnitSource): void {
    registerModuleUnits(entry, handle, digestHydrator(previous, source))
}

/** The identity prefixes of a workspace record and of a workspace file unit. */
export const IDENTITY_WORKSPACE = 'ws:'
export const IDENTITY_WORKSPACE_FILE = 'wsf:'

/** An id that names a workspace unit identity: a non-empty string without `:`, so `ws:<id>` and `wsf:<id>:<id>` split one way. */
function workspaceIdentityPart(value: unknown, where: string): string {
    if (typeof value !== 'string' || value === '' || value.includes(':')) {
        throw new CodecAssembleError(`${where} has no id that can name a unit.`)
    }
    return value
}

/**
 * Every unit one workspace record names, as `register` takes it: the record under `ws:<id>` and each file under
 * `wsf:<id>:<fileId>`, the identities the encoder gives them. `record` is the record's parsed body, which names the
 * ids; a record that is missing or has no usable id is refused. A file's Ref is registered as it is, with no digest when
 * its bytes did not read (a flagged file's bytes leave the source), so a later carry finds the key and Ref and never
 * compares a digest.
 */
export function registerWorkspaceUnits(
    ref: Ref, record: WorkspaceRecord | undefined, register: (identity: string, type: UnitType, ref: Ref) => unknown,
): void {
    if (record === undefined) {
        throw new CodecAssembleError(`The workspace record ${keyOfRef(ref)} was not read.`)
    }
    const id = workspaceIdentityPart(record.ws.id, `The workspace record ${keyOfRef(ref)}`)
    register(`${IDENTITY_WORKSPACE}${id}`, UNIT_TYPE.workspace, ref)
    const seen = new Set<string>()
    for (const file of record.files) {
        const fileId = workspaceIdentityPart(file.id, `A file of workspace ${id}`)
        if (seen.has(fileId)) {
            throw new CodecAssembleError(`Workspace ${id} repeats the file id ${fileId}.`)
        }
        seen.add(fileId)
        register(`${IDENTITY_WORKSPACE_FILE}${id}:${fileId}`, UNIT_TYPE.workspaceFile, file.ref)
    }
}

/** The handle of a character is its id and its occurrence among the holders of that id, in `characters` order; its value is the entity id `u`. */
export function entityIdsOf(order: ContentBody, entries: ReadonlyMap<string, ShardEntry>): Map<string, string> {
    const entities = new Map<string, string>()
    const occurrences = new Map<string, number>()
    for (const u of readStringListField(order, 'chars', 'order')) {
        const entry = entries.get(u)
        if (entry === undefined) {
            throw new CodecAssembleError(`The order names entity ${u}, which no shard lists.`)
        }
        const occurrence = occurrences.get(entry.chaId) ?? 0
        occurrences.set(entry.chaId, occurrence + 1)
        entities.set(`${entry.chaId}#${occurrence}`, u)
    }
    return entities
}

export function previousOfTree(tree: StoredTree, options: PreviousOfTreeOptions = {}): PreviousEncoding {
    const { manifestKey, manifest, source } = tree
    const keepBytes = options.keepBytes === true
    const units = new Map<string, ReusableUnit>()

    const register = (identity: string, type: UnitType, ref: Ref): Uint8Array | undefined => {
        const key = keyOfRef(ref)
        const bytes = checkedBytes(source, ref)
        if (bytes === undefined) {
            units.set(identity, { key, type, ref: [ref[0], ref[1], ref[2]] })
        } else if (keepBytes) {
            units.set(identity, { key, type, ref: refOfFrame(key, bytes), digest: unitDigest(bytes), bytes })
        } else {
            units.set(identity, { key, type, ref: refOfFrame(key, bytes), digest: unitDigest(bytes) })
        }
        return bytes
    }

    /** A unit whose body the carry or the entity ids read: registered, parsed, and a missing or invalid one is refused. */
    const registerBody = (identity: string, type: UnitType, ref: Ref): object => {
        const bytes = register(identity, type, ref)
        if (bytes === undefined) {
            throw new CodecAssembleError(`${identity}: unit ${keyOfRef(ref)} was not read or does not match its Ref.`)
        }
        const parsed = readUnit(bytes, type)
        if (parsed.status !== 'ok' && parsed.status !== 'stale') {
            throw new CodecAssembleError(`${identity}: unit ${keyOfRef(ref)} is ${parsed.status}: ${parsed.reason}`)
        }
        return parsed.value.body
    }

    const manifestBytes = source.get(manifestKey)
    if (manifestBytes === undefined || manifestBytes.length < FRAME_OVERHEAD) {
        throw new CodecAssembleError(`The manifest ${manifestKey} was not read.`)
    }
    units.set('manifest', {
        key: manifestKey, type: UNIT_TYPE.manifest, ref: refOfFrame(manifestKey, manifestBytes), digest: unitDigest(manifestBytes),
        ...(keepBytes ? { bytes: manifestBytes } : {}),
    })

    const fixed = manifest.fixed
    const order = registerBody('order', UNIT_TYPE.order, fixed.order) as ContentBody
    const root = registerBody(IDENTITY.moduleIndex, UNIT_TYPE.moduleIndex, fixed.moduleIndex) as ModuleIndexRoot
    const moduleBuckets = fixed.moduleBuckets?.map((ref, bucket) =>
        registerBody(`moduleIndex:bucket:${bucket}`, UNIT_TYPE.moduleBucket, ref) as ModuleBucket)
    const moduleIndex = moduleIndexOfParts(root, moduleBuckets)
    const configBody = registerBody('config', UNIT_TYPE.configRoot, fixed.config) as ContentBody
    register('al:config', UNIT_TYPE.assetList, fixed.configAl)
    register('il:config', UNIT_TYPE.inlayList, fixed.il)
    const staticsBytes = register('statics', UNIT_TYPE.statics, fixed.statics)
    const loadoutsBytes = register('loadouts', UNIT_TYPE.loadouts, fixed.loadouts)
    const chatDraftsBytes = fixed.chatDrafts === undefined ? undefined : register('chatDrafts', UNIT_TYPE.chatDrafts, fixed.chatDrafts)
    const presetBytes = fixed.presets.map((ref, index) => register(`preset:${index}`, UNIT_TYPE.preset, ref))
    fixed.taskPresets?.forEach((ref, index) => register(`taskPreset:${index}`, UNIT_TYPE.taskPreset, ref))

    // A plugin's identity names its list, which only its body says: without every body the boundary between the lists is unknown.
    const lists: (PluginList | null)[] = fixed.plugins.map((ref) => {
        const bytes = checkedBytes(source, ref)
        const parsed = bytes === undefined ? null : readUnit(bytes, UNIT_TYPE.plugin)
        if (parsed === null || (parsed.status !== 'ok' && parsed.status !== 'stale')) {
            return null
        }
        const list = (parsed.value.body as ContentBody).list
        return (PLUGIN_LISTS as readonly unknown[]).includes(list) ? list as PluginList : null
    })
    if (lists.every(list => list !== null)) {
        const counts = new Map<PluginList, number>()
        fixed.plugins.forEach((ref, position) => {
            const list = lists[position] as PluginList
            const index = counts.get(list) ?? 0
            counts.set(list, index + 1)
            register(`plugin:${list}:${index}`, UNIT_TYPE.plugin, ref)
        })
    }

    fixed.pluginStorage.refs.forEach((ref, bucket) => {
        const body = registerBody(`bucket:${bucket}`, UNIT_TYPE.pluginStorageBucket, ref) as PluginBucket
        for (const entry of body.entries) {
            register(`psv:${entry.k}`, UNIT_TYPE.pluginStorageValue, entry.ref)
        }
    })

    // A workspace record is a parent like a plugin-storage bucket: one that was not read or does not parse is refused, and its
    // files are registered under the ids it names, each with a digest only when its bytes read and match its Ref.
    const workspaceExtras = new Map<string, JsonObject>()
    for (const ref of fixed.workspaces ?? []) {
        const bytes = checkedBytes(source, ref)
        const parsed = bytes === undefined ? null : readUnit(bytes, UNIT_TYPE.workspace)
        const record = parsed !== null && (parsed.status === 'ok' || parsed.status === 'stale') ? parsed.value.body as WorkspaceRecord : undefined
        registerWorkspaceUnits(ref, record, register)
        if (record !== undefined) {
            const { v: _v, ws: _ws, files: _files, ...extras } = record
            if (Object.keys(extras).length > 0) {
                workspaceExtras.set(String(record.ws.id), extras as JsonObject)
            }
        }
    }

    const handles = moduleHandles(moduleIndex)
    moduleIndex.entries.forEach((entry, position) => registerModuleUnits(entry, handles[position], register))

    const shards: Shard[] = []
    const entries = new Map<string, ShardEntry>()
    manifest.shards.forEach((ref, index) => {
        const shard = registerBody(`shard:${index}`, UNIT_TYPE.shard, ref) as Shard
        shards.push(shard)
        for (const entry of shard.entries) {
            entries.set(entry.u, entry)
            registerEntityUnits(entry, register)
        }
    })

    const entities = entityIdsOf(order, entries)

    const objects: PreviousObjects = { manifest, shards, moduleIndex, order }
    if (workspaceExtras.size > 0) {
        objects.workspaces = workspaceExtras
    }
    // The statics body and the preset bodies are kept only when every unit was read and parses: a partial list is no base.
    const statics = staticsBytes === undefined ? null : readUnit(staticsBytes, UNIT_TYPE.statics)
    if (statics !== null && (statics.status === 'ok' || statics.status === 'stale')) {
        objects.statics = statics.value.body as ContentBody
    }
    // The loadouts stay an optional unit for the boot: a body that is missing or does not parse leaves them unknown, and a later loadouts fault then fails the pass.
    const loadouts = loadoutsBytes === undefined ? null : readUnit(loadoutsBytes, UNIT_TYPE.loadouts)
    if (loadouts !== null && (loadouts.status === 'ok' || loadouts.status === 'stale')) {
        const items = (loadouts.value.body as ContentBody).items
        if (Array.isArray(items)) {
            objects.loadouts = items
        }
    }
    // The draft unit is fail-open: a body that is missing or does not parse leaves it unknown, and a later draft fault then
    // falls back to the previous unit itself.
    const chatDrafts = chatDraftsBytes === undefined ? null : readUnit(chatDraftsBytes, UNIT_TYPE.chatDrafts)
    if (chatDrafts !== null && (chatDrafts.status === 'ok' || chatDrafts.status === 'stale')) {
        const chats = (chatDrafts.value.body as ContentBody).chats
        if (Array.isArray(chats)) {
            objects.chatDrafts = chats
        }
    }
    const presets: JsonObject[] = []
    for (const bytes of presetBytes) {
        const parsed = bytes === undefined ? null : readUnit(bytes, UNIT_TYPE.preset)
        const preset = parsed !== null && (parsed.status === 'ok' || parsed.status === 'stale') ? (parsed.value.body as ContentBody).preset : undefined
        if (!isJsonObject(preset)) {
            break
        }
        presets.push(preset)
    }
    if (presets.length === presetBytes.length) {
        objects.presets = presets
    }
    // A config body that is not an object of fields holds nothing to put back: a later fault of a setting then fails the pass.
    if (isJsonObject(configBody.f)) {
        objects.config = configBody.f
    }
    return { units, entities, objects }
}

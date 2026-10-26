import {
    FRAME_OVERHEAD, keyOfRef, readUnit, refOfFrame, UNIT_TYPE,
    type ContentBody, type Manifest, type ModuleEntry, type ModuleIndex, type PluginBucket, type Ref, type Shard, type ShardEntry, type UnitType,
} from './format'
import {
    CodecAssembleError, IDENTITY, PLUGIN_LISTS, readStringListField, unitDigest,
    type PluginList, type PreviousEncoding, type PreviousObjects, type ReusableUnit, type UnitSource,
} from './codec'

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
function checkedBytes(source: UnitSource, ref: Ref): Uint8Array | undefined {
    const key = keyOfRef(ref)
    const bytes = source.get(key)
    if (bytes === undefined || bytes.length < FRAME_OVERHEAD) {
        return undefined
    }
    const actual = refOfFrame(key, bytes)
    return actual[1] === ref[1] && actual[2] === ref[2] ? bytes : undefined
}

/** Module handle: the id, told apart from a repeated id by occurrence; the handle `encodeModules` names its units by. */
function moduleHandles(index: ModuleIndex): string[] {
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
    const moduleIndex = registerBody(IDENTITY.moduleIndex, UNIT_TYPE.moduleIndex, fixed.moduleIndex) as ModuleIndex
    register('config', UNIT_TYPE.configRoot, fixed.config)
    register('al:config', UNIT_TYPE.assetList, fixed.configAl)
    register('il:config', UNIT_TYPE.inlayList, fixed.il)
    register('statics', UNIT_TYPE.statics, fixed.statics)
    register('loadouts', UNIT_TYPE.loadouts, fixed.loadouts)
    fixed.presets.forEach((ref, index) => register(`preset:${index}`, UNIT_TYPE.preset, ref))

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

    // The handle of a character is its id and its occurrence among the holders of that id, in `characters` order.
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

    const objects: PreviousObjects = { manifest, shards, moduleIndex }
    return { units, entities, objects }
}

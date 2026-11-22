import {
    keyOfRef, readUnit, refOfFrame, UNIT_TYPE,
    type ContentBody, type Ref, type Shard, type UnitType,
} from '../format'
import {
    CodecAssembleError, IDENTITY, isJsonObject, unitDigest,
    type PreviousEncoding, type PreviousObjects, type ReusableUnit,
} from '../codec'
import {
    checkedBytes, entityIdsOf, moduleHandles, registerEntityUnits, registerModuleUnits,
    type PreviousOfTreeOptions, type StoredTree,
} from '../previousOfTree'
import type { JsonObject, JsonValue } from '../../blockFrame'

/**
 * The acknowledged encoding of a peer's tree, built from the encoding the page holds and the units that changed: the
 * `previousOfTree` of the peer's tree without reading the units that did not change. `target.source` holds the framed
 * bytes of the units the read fetched (every changed fixed unit, shard and entity unit it needs); a unit whose key is
 * the one the old encoding holds under the same identity keeps that record, digest included, and is never read.
 *
 * A unit whose key changed gets the digest of its bytes when the source holds them, and none when it does not, so it
 * is carried and never compared, as `previousOfTree` does for a unit the boot did not read. A body that the old
 * encoding's objects hold is taken from them when its key is unchanged, and read from the source when it changed.
 *
 * The modules, the plugins, the plugin storage and the utility workspaces are not handled: the fast-forward parks a peer
 * change to them, so an `advancePrevious` over a changed one throws a `CodecAssembleError` and the caller parks with nothing written.
 * Everything that is missing (a body to read, the old objects) throws the same way.
 */
export function advancePrevious(old: PreviousEncoding, target: StoredTree, options: PreviousOfTreeOptions = {}): PreviousEncoding {
    const keepBytes = options.keepBytes === true
    const { manifestKey, manifest, source } = target
    const objectsBefore = old.objects
    const manifestBefore = objectsBefore?.manifest
    if (objectsBefore === undefined || manifestBefore === undefined || objectsBefore.shards === undefined
        || objectsBefore.moduleIndex === undefined || objectsBefore.order === undefined) {
        throw new CodecAssembleError('The acknowledged encoding holds no objects to advance from.')
    }
    const units = new Map<string, ReusableUnit>()

    const unchanged = (identity: string, type: UnitType, ref: Ref): ReusableUnit | undefined => {
        const held = old.units.get(identity)
        return held !== undefined && held.key === keyOfRef(ref) && held.type === type ? held : undefined
    }

    /** The unit as the new encoding holds it, and its bytes when it changed and the source has them (an unchanged unit is not read). */
    const register = (identity: string, type: UnitType, ref: Ref): Uint8Array | undefined => {
        const key = keyOfRef(ref)
        const held = unchanged(identity, type, ref)
        if (held !== undefined) {
            units.set(identity, { ...held })
            return undefined
        }
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

    /** The body of a unit that changed: read from the source, and refused when it is missing or not valid. */
    const bodyOf = (identity: string, type: UnitType, ref: Ref, bytes: Uint8Array | undefined): object => {
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
    if (manifestBytes === undefined) {
        throw new CodecAssembleError(`The manifest ${manifestKey} was not read.`)
    }
    units.set('manifest', {
        key: manifestKey, type: UNIT_TYPE.manifest, ref: refOfFrame(manifestKey, manifestBytes), digest: unitDigest(manifestBytes),
        ...(keepBytes ? { bytes: manifestBytes } : {}),
    })

    const fixed = manifest.fixed
    const fixedBefore = manifestBefore.fixed
    const sameKeys = (a: readonly Ref[] | undefined, b: readonly Ref[] | undefined): boolean =>
        (a ?? []).length === (b ?? []).length && (a ?? []).every((ref, index) => keyOfRef(ref) === keyOfRef((b ?? [])[index]))
    if (keyOfRef(fixed.moduleIndex) !== keyOfRef(fixedBefore.moduleIndex) || !sameKeys(fixed.moduleBuckets, fixedBefore.moduleBuckets)) {
        throw new CodecAssembleError('The module index changed; the fast-forward does not take it.')
    }
    if (!sameKeys(fixed.plugins, fixedBefore.plugins) || fixed.pluginStorage.buckets !== fixedBefore.pluginStorage.buckets
        || !sameKeys(fixed.pluginStorage.refs, fixedBefore.pluginStorage.refs)) {
        throw new CodecAssembleError('The plugins or their storage changed; the fast-forward does not take them.')
    }
    if (!sameKeys(fixed.workspaces, fixedBefore.workspaces)) {
        throw new CodecAssembleError('The utility workspaces changed; the fast-forward does not take them.')
    }

    const orderBytes = register('order', UNIT_TYPE.order, fixed.order)
    const order = unchanged('order', UNIT_TYPE.order, fixed.order) !== undefined
        ? objectsBefore.order
        : bodyOf('order', UNIT_TYPE.order, fixed.order, orderBytes) as ContentBody

    const moduleIndex = objectsBefore.moduleIndex
    register(IDENTITY.moduleIndex, UNIT_TYPE.moduleIndex, fixed.moduleIndex)
    fixed.moduleBuckets?.forEach((ref, bucket) => register(`moduleIndex:bucket:${bucket}`, UNIT_TYPE.moduleBucket, ref))
    const handles = moduleHandles(moduleIndex)
    moduleIndex.entries.forEach((entry, position) => registerModuleUnits(entry, handles[position], register))

    const configBytes = register('config', UNIT_TYPE.configRoot, fixed.config)
    const configBody = unchanged('config', UNIT_TYPE.configRoot, fixed.config) !== undefined
        ? undefined
        : bodyOf('config', UNIT_TYPE.configRoot, fixed.config, configBytes) as ContentBody
    register('al:config', UNIT_TYPE.assetList, fixed.configAl)
    register('il:config', UNIT_TYPE.inlayList, fixed.il)
    const staticsBytes = register('statics', UNIT_TYPE.statics, fixed.statics)
    const staticsBody = unchanged('statics', UNIT_TYPE.statics, fixed.statics) !== undefined
        ? objectsBefore.statics
        : bodyOf('statics', UNIT_TYPE.statics, fixed.statics, staticsBytes) as ContentBody
    const loadoutsBytes = register('loadouts', UNIT_TYPE.loadouts, fixed.loadouts)
    // A body that is missing or invalid is left unknown, never refused: a later loadouts fault then fails the pass, and a
    // peer change to the loadouts is still parked by the fast-forward's own check.
    let loadoutsBody: readonly JsonValue[] | undefined
    if (unchanged('loadouts', UNIT_TYPE.loadouts, fixed.loadouts) !== undefined) {
        loadoutsBody = objectsBefore.loadouts
    } else if (loadoutsBytes !== undefined) {
        const parsed = readUnit(loadoutsBytes, UNIT_TYPE.loadouts)
        const items = parsed.status === 'ok' || parsed.status === 'stale' ? (parsed.value.body as ContentBody).items : undefined
        loadoutsBody = Array.isArray(items) ? items : undefined
    }
    // The draft unit is optional: a manifest that does not name it registers no identity, so a unit the peer removed is not
    // copied from the old encoding. A body that is missing or invalid is left unknown, like the loadouts.
    let chatDraftsBody: readonly JsonValue[] | undefined
    if (fixed.chatDrafts !== undefined) {
        const chatDraftsBytes = register('chatDrafts', UNIT_TYPE.chatDrafts, fixed.chatDrafts)
        if (unchanged('chatDrafts', UNIT_TYPE.chatDrafts, fixed.chatDrafts) !== undefined) {
            chatDraftsBody = objectsBefore.chatDrafts
        } else if (chatDraftsBytes !== undefined) {
            const parsed = readUnit(chatDraftsBytes, UNIT_TYPE.chatDrafts)
            const chats = parsed.status === 'ok' || parsed.status === 'stale' ? (parsed.value.body as ContentBody).chats : undefined
            chatDraftsBody = Array.isArray(chats) ? chats : undefined
        }
    }

    const presets: JsonObject[] = []
    let presetsKnown = true
    fixed.presets.forEach((ref, index) => {
        const identity = `preset:${index}`
        const held = unchanged(identity, UNIT_TYPE.preset, ref) !== undefined ? objectsBefore.presets?.[index] : undefined
        const bytes = register(identity, UNIT_TYPE.preset, ref)
        let preset = held
        if (preset === undefined && bytes !== undefined) {
            const parsed = readUnit(bytes, UNIT_TYPE.preset)
            const candidate = parsed.status === 'ok' || parsed.status === 'stale' ? (parsed.value.body as ContentBody).preset : undefined
            preset = isJsonObject(candidate) ? candidate : undefined
        }
        if (preset === undefined) {
            presetsKnown = false
        } else {
            presets.push(preset)
        }
    })
    fixed.taskPresets?.forEach((ref, index) => register(`taskPreset:${index}`, UNIT_TYPE.taskPreset, ref))

    // The plugin, plugin-storage and workspace units are those of the old encoding, which the checks above proved unchanged.
    for (const [identity, unit] of old.units) {
        if (unit.type === UNIT_TYPE.plugin || unit.type === UNIT_TYPE.pluginStorageBucket || unit.type === UNIT_TYPE.pluginStorageValue
            || unit.type === UNIT_TYPE.workspace || unit.type === UNIT_TYPE.workspaceFile) {
            units.set(identity, { ...unit })
        }
    }

    const shards: Shard[] = []
    const entries = new Map<string, Shard['entries'][number]>()
    manifest.shards.forEach((ref, index) => {
        const identity = `shard:${index}`
        const held = unchanged(identity, UNIT_TYPE.shard, ref) !== undefined ? objectsBefore.shards?.[index] : undefined
        const bytes = register(identity, UNIT_TYPE.shard, ref)
        const shard = held ?? bodyOf(identity, UNIT_TYPE.shard, ref, bytes) as Shard
        shards.push(shard)
        for (const entry of shard.entries) {
            entries.set(entry.u, entry)
            registerEntityUnits(entry, register)
        }
    })

    const entities = entityIdsOf(order, entries)
    const objects: PreviousObjects = { manifest, shards, moduleIndex, order }
    const config = configBody === undefined ? objectsBefore.config : configBody.f
    if (config !== undefined && isJsonObject(config)) {
        objects.config = config
    }
    if (staticsBody !== undefined) {
        objects.statics = staticsBody
    }
    if (loadoutsBody !== undefined) {
        objects.loadouts = loadoutsBody
    }
    if (chatDraftsBody !== undefined) {
        objects.chatDrafts = chatDraftsBody
    }
    if (presetsKnown) {
        objects.presets = presets
    }
    return { units, entities, objects }
}

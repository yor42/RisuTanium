import type { JsonObject } from '../blockFrame'
import { isStore2Key } from '../store/keyRules'
import { Store2BackendError } from './backend/errors'
import type { Store2Backend } from './backend/types'
import { checkUnit, chunkCountMismatch, type UnitCheck } from './codec/assemble'
import type { ConfigBody, PluginBody } from './codec/bodies'
import type { UnitSource } from './codec/types'
import { classifyCommitRead } from './commitKey'
import {
    keyOfRef, readUnit, UNIT_TYPE,
    type ChatChunk, type Manifest, type ModuleEntry, type ModuleIndex, type PluginBucket, type Ref, type Shard, type ShardEntry, type UnitType,
} from './format'
import type { StoredTree } from './previousOfTree'
import { checkManifestKey, readBatch } from './tree'

/**
 * The byte-keeping tree read of a boot: every unit of a stored tree that a load needs, read once, checked by the
 * codec's own unit check, and kept as framed bytes so `previousOfTree` can register digests and the first save finds
 * every untouched unit unchanged. A unit is judged by what its role allows:
 *   fixed units (manifest, shards, config, lists of the config, statics, order, loadouts, module index and its units,
 *   presets, plugins, plugin-storage buckets and values) cannot be replaced by an empty value, so one that is missing
 *   or damaged makes the read `structure`;
 *   leaves (an entity's core, lore, scripts, lists, chat cores and chat chunks) are `flagged`, and the tree still
 *   reads `ok`;
 *   any unit a newer build wrote makes the read `too-new`, which wins over every other finding of the same read;
 *   a backend failure makes the read `unreadable` and is never read as damage or absence.
 * A flagged unit's bytes are withheld from the source, so the unit is registered without a digest and is rewritten by
 * the first pass. A read that is about to report `structure`, `too-new` or a flagged leaf first reads the commit key
 * again: a `current` that is no longer this tree's manifest is `moved`, because a peer commit or a collection pass
 * between the reads is not damage.
 */

export type CharacterPart = 'core' | 'lore' | 'scripts' | 'al' | 'il'

export type FlaggedLeaf =
    | { kind: 'chat', chaId: string, chatId: string, part: 'core' | 'chunk', key: string, why: 'missing' | 'damaged' }
    | { kind: 'character-part', chaId: string, part: CharacterPart, key: string, why: 'missing' | 'damaged' }

export type TreeBytesRead =
    /** `newerLists` holds the readable lists above this build's version: never flagged, and the profile opens. */
    | { status: 'ok', tree: StoredTree, flagged: readonly FlaggedLeaf[], newerLists: readonly string[] }
    /** A manifest, shard or fixed unit is missing or damaged: the recovery screen's route. `tree` is `missing` only when every such unit is absent. */
    | { status: 'structure', manifestKey: string, keys: string[], reason: string, tree: 'missing' | 'damaged' }
    | { status: 'too-new', manifestKey: string, keys: string[], reason: string }
    /** The backend failed: nothing is known about the tree. */
    | { status: 'unreadable', manifestKey: string, cause: Store2BackendError }
    /** The commit key's `current` changed since the tree was named: classify again. */
    | { status: 'moved' }

/**
 * What the residency planner sees: every entry of every shard that checked and the checked fixed bodies it may need,
 * so a decision that depends on the whole tree (a `chaId` held by two entries, a setting in the config) is made once
 * over all of it and never entry by entry.
 */
export interface ResidentPlanInput {
    /** The entries of the shards that checked, in shard order. */
    entries: readonly ShardEntry[]
    /** The config unit's fields; null when that unit did not check. */
    config: JsonObject | null
    /** The plugin units that checked. */
    plugins: readonly PluginBody[]
}

export interface TreeBytesOptions {
    /**
     * Which entries are read, by `u`; absent reads every entry. An entry left out has no unit read and no flag. The
     * planner runs once, after the fixed units have been read and checked.
     */
    resident?: (input: ResidentPlanInput) => ReadonlySet<string>
    /** Awaited between batches of reads, so a long read hands the thread back. */
    yield?: () => Promise<void>
}

/** The commit key could not be read again before a finding was acted on: never `moved`, never damage. */
export class CommitKeyRecheckError extends Error {
    constructor(readonly cause: Store2BackendError) {
        super(`The commit key could not be read again: ${cause.message}`)
        this.name = 'CommitKeyRecheckError'
    }
}

/** How many keys one backend call reads. */
const READ_BATCH = 256

type Why = 'missing' | 'damaged'

/** What the role of a unit allows when it is not usable. */
type Role =
    | { kind: 'fixed' }
    | { kind: 'leaf', flag: (key: string, why: Why) => FlaggedLeaf }

interface Wanted {
    ref: Ref
    type: UnitType
    role: Role
    /** Chat chunks only: the message count the Ref holds is checked against the body. */
    chunk: boolean
}

interface Findings {
    flagged: FlaggedLeaf[]
    structure: string[]
    structureReason: string
    /** Every structure finding so far is an absent unit. */
    structureAllMissing: boolean
    tooNew: string[]
    tooNewReason: string
    newerLists: string[]
}

type BytesBatch = { status: 'read' } | { status: 'unreadable', cause: Store2BackendError }

/** Frame bytes of an entry that exists but is not binary: shorter than any frame, so the unit check calls it damaged. */
const NOT_BINARY = new Uint8Array(0)

interface ByteReader {
    bytes: Map<string, Uint8Array>
    source: UnitSource
    /** Reads the keys not read yet into `bytes`; an absent key stays out of the map. */
    load(keys: readonly string[]): Promise<BytesBatch>
}

function createByteReader(backend: Store2Backend, yieldBetween: (() => Promise<void>) | undefined): ByteReader {
    const bytes = new Map<string, Uint8Array>()
    const source: UnitSource = { get: key => bytes.get(key) }
    const attempted = new Set<string>()

    async function load(keys: readonly string[]): Promise<BytesBatch> {
        const pending = [...new Set(keys)].filter(key => !attempted.has(key) && isStore2Key(key))
        for (let offset = 0; offset < pending.length; offset += READ_BATCH) {
            if (offset > 0) {
                await yieldBetween?.()
            }
            let batch = pending.slice(offset, offset + READ_BATCH)
            while (batch.length > 0) {
                const read = await readBatch(backend, batch)
                if (read.status === 'unreadable') {
                    return read
                }
                if (read.status === 'not-binary') {
                    // The rest of the batch is read again without the entry that could not be read as bytes.
                    bytes.set(read.key, NOT_BINARY)
                    batch = batch.filter(key => key !== read.key)
                    continue
                }
                for (const [key, value] of read.units) {
                    if (value !== null) {
                        bytes.set(key, value)
                    }
                }
                break
            }
        }
        pending.forEach(key => attempted.add(key))
        return { status: 'read' }
    }

    return { bytes, source, load }
}

function newFindings(): Findings {
    return { flagged: [], structure: [], structureReason: '', structureAllMissing: true, tooNew: [], tooNewReason: '', newerLists: [] }
}

/**
 * The one check of `wanted` that a boot read and an entity load share, so the two cannot disagree on what damaged
 * means: each unit goes through the codec's unit check and is filed under the finding its role gives it (a flagged
 * unit's bytes leave the map), and a chat chunk whose body holds a different message count than its Ref says is as
 * damaged as one that fails its checksum. Answers the bodies of the units that checked.
 */
function checkWanted(wanted: readonly Wanted[], reader: ByteReader, findings: Findings): Map<string, unknown> {
    const bodies = new Map<string, unknown>()
    for (const item of wanted) {
        const key = keyOfRef(item.ref)
        const checked = isStore2Key(key)
            ? checkUnit(reader.source, item.ref, item.type)
            : { status: 'damaged', reason: `${key} is not a store2 unit key.`, byRef: true } satisfies UnitCheck
        record(findings, item, key, checked, reader.bytes)
        if (checked.status === 'ok') {
            bodies.set(key, checked.body)
        }
    }
    return bodies
}

/** The second half of `checkWanted`, run once the chunk bodies are known: a chunk of the wrong message count is damaged. */
function checkChunkCounts(wanted: readonly Wanted[], bodies: Map<string, unknown>, reader: ByteReader, findings: Findings): void {
    for (const item of wanted) {
        const key = keyOfRef(item.ref)
        const body = bodies.get(key)
        if (item.chunk && body !== undefined && chunkCountMismatch(body as ChatChunk, item.ref)) {
            record(findings, item, key, { status: 'damaged', reason: 'The chunk holds a different number of messages than its Ref says.', byRef: false }, reader.bytes)
            bodies.delete(key)
        }
    }
}

export async function readTreeBytes(backend: Store2Backend, manifestKey: string, options: TreeBytesOptions = {}): Promise<TreeBytesRead> {
    const refused = checkManifestKey(manifestKey)
    if (refused !== null) {
        return { status: 'structure', manifestKey, keys: [manifestKey], reason: refused.status === 'damaged' ? refused.reason : `${manifestKey} is not a manifest key.`, tree: 'damaged' }
    }
    const reader = createByteReader(backend, options.yield)
    const { bytes, source, load } = reader

    const manifestLoad = await load([manifestKey])
    if (manifestLoad.status === 'unreadable') {
        return { status: 'unreadable', manifestKey, cause: manifestLoad.cause }
    }
    const manifestBytes = bytes.get(manifestKey)
    if (manifestBytes === undefined) {
        return recheck(backend, manifestKey, { status: 'structure', manifestKey, keys: [manifestKey], reason: `${manifestKey} is missing.`, tree: 'missing' })
    }
    const manifestUnit = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifestUnit.status === 'too-new' || manifestUnit.status === 'unreadable') {
        return recheck(backend, manifestKey, { status: 'too-new', manifestKey, keys: [manifestKey], reason: manifestUnit.reason })
    }
    if (manifestUnit.status === 'damaged') {
        return recheck(backend, manifestKey, { status: 'structure', manifestKey, keys: [manifestKey], reason: manifestUnit.reason, tree: 'damaged' })
    }
    const manifest = manifestUnit.value.body as Manifest

    const findings = newFindings()
    const fixed: Role = { kind: 'fixed' }

    /** Reads and checks `wanted`; answers the bodies of the units whose body a later step needs. */
    async function readAndCheck(wanted: readonly Wanted[]): Promise<{ status: 'checked', bodies: Map<string, unknown> } | { status: 'unreadable', cause: Store2BackendError }> {
        const loaded = await load(wanted.map(item => keyOfRef(item.ref)))
        if (loaded.status === 'unreadable') {
            return loaded
        }
        return { status: 'checked', bodies: checkWanted(wanted, reader, findings) }
    }

    const fixedUnits: Wanted[] = [
        { ref: manifest.fixed.config, type: UNIT_TYPE.configRoot, role: fixed, chunk: false },
        { ref: manifest.fixed.configAl, type: UNIT_TYPE.assetList, role: fixed, chunk: false },
        { ref: manifest.fixed.il, type: UNIT_TYPE.inlayList, role: fixed, chunk: false },
        { ref: manifest.fixed.statics, type: UNIT_TYPE.statics, role: fixed, chunk: false },
        { ref: manifest.fixed.order, type: UNIT_TYPE.order, role: fixed, chunk: false },
        { ref: manifest.fixed.loadouts, type: UNIT_TYPE.loadouts, role: fixed, chunk: false },
        { ref: manifest.fixed.moduleIndex, type: UNIT_TYPE.moduleIndex, role: fixed, chunk: false },
        ...manifest.fixed.presets.map((ref): Wanted => ({ ref, type: UNIT_TYPE.preset, role: fixed, chunk: false })),
        ...manifest.fixed.plugins.map((ref): Wanted => ({ ref, type: UNIT_TYPE.plugin, role: fixed, chunk: false })),
        ...manifest.fixed.pluginStorage.refs.map((ref): Wanted => ({ ref, type: UNIT_TYPE.pluginStorageBucket, role: fixed, chunk: false })),
        ...manifest.shards.map((ref): Wanted => ({ ref, type: UNIT_TYPE.shard, role: fixed, chunk: false })),
    ]
    const first = await readAndCheck(fixedUnits)
    if (first.status === 'unreadable') {
        return { status: 'unreadable', manifestKey, cause: first.cause }
    }

    // The units the bodies of the first group name. A parent that did not check names nothing here: its own finding stands.
    const second: Wanted[] = []
    const moduleIndex = first.bodies.get(keyOfRef(manifest.fixed.moduleIndex)) as ModuleIndex | undefined
    for (const entry of moduleIndex?.entries ?? []) {
        second.push({ ref: entry.unit, type: UNIT_TYPE.module, role: fixed, chunk: false })
        second.push({ ref: entry.al, type: UNIT_TYPE.assetList, role: fixed, chunk: false })
        if (entry.il !== null) {
            second.push({ ref: entry.il, type: UNIT_TYPE.inlayList, role: fixed, chunk: false })
        }
    }
    for (const ref of manifest.fixed.pluginStorage.refs) {
        const bucket = first.bodies.get(keyOfRef(ref)) as PluginBucket | undefined
        for (const entry of bucket?.entries ?? []) {
            second.push({ ref: entry.ref, type: UNIT_TYPE.pluginStorageValue, role: fixed, chunk: false })
        }
    }
    const shards = manifest.shards.map(ref => first.bodies.get(keyOfRef(ref)) as Shard | undefined)
    let resident: ReadonlySet<string> | null = null
    if (options.resident !== undefined) {
        const config = first.bodies.get(keyOfRef(manifest.fixed.config)) as ConfigBody | undefined
        resident = options.resident({
            entries: shards.flatMap(shard => shard?.entries ?? []),
            config: config === undefined ? null : config.f,
            plugins: manifest.fixed.plugins.flatMap((ref) => {
                const body = first.bodies.get(keyOfRef(ref)) as PluginBody | undefined
                return body === undefined ? [] : [body]
            }),
        })
    }
    for (const shard of shards) {
        for (const entry of shard?.entries ?? []) {
            if (resident === null || resident.has(entry.u)) {
                second.push(...leavesOf(entry))
            }
        }
    }
    const rest = await readAndCheck(second)
    if (rest.status === 'unreadable') {
        return { status: 'unreadable', manifestKey, cause: rest.cause }
    }
    checkChunkCounts(second, rest.bodies, reader, findings)

    if (findings.tooNew.length > 0) {
        return recheck(backend, manifestKey, { status: 'too-new', manifestKey, keys: findings.tooNew, reason: findings.tooNewReason })
    }
    if (findings.structure.length > 0) {
        return recheck(backend, manifestKey, {
            status: 'structure', manifestKey, keys: findings.structure, reason: findings.structureReason,
            tree: findings.structureAllMissing ? 'missing' : 'damaged',
        })
    }
    const ok: TreeBytesRead = {
        status: 'ok',
        tree: { manifestKey, manifest, source },
        flagged: findings.flagged,
        newerLists: findings.newerLists,
    }
    return findings.flagged.length > 0 ? recheck(backend, manifestKey, ok) : ok
}

export type EntityBytesRead =
    /** Every unit of the entity checked; `source` holds their bytes and `bytes` is their total length. */
    | { status: 'ok', source: UnitSource, bytes: number }
    /** A unit is absent or damaged (a flag of the boot read, whatever its role). */
    | { status: 'damaged', flagged: readonly FlaggedLeaf[], reason: string }
    | { status: 'too-new', keys: string[], reason: string }
    /** The backend failed: nothing is known about the entity. */
    | { status: 'unreadable', cause: Store2BackendError }

/**
 * Reads the units of one entity for a load. It judges them as the boot read judges the leaves of a resident entity
 * (the same check and the same flags), but an entity that is opened as a whole cannot go on without a part: any
 * absent or damaged unit makes the read `damaged`, with no fallback and no partial result.
 */
export async function readEntityBytes(backend: Store2Backend, entry: ShardEntry, options: { yield?: () => Promise<void> } = {}): Promise<EntityBytesRead> {
    const reader = createByteReader(backend, options.yield)
    const wanted = leavesOf(entry)
    const loaded = await reader.load(wanted.map(item => keyOfRef(item.ref)))
    if (loaded.status === 'unreadable') {
        return { status: 'unreadable', cause: loaded.cause }
    }
    const findings = newFindings()
    checkChunkCounts(wanted, checkWanted(wanted, reader, findings), reader, findings)
    if (findings.tooNew.length > 0) {
        return { status: 'too-new', keys: findings.tooNew, reason: findings.tooNewReason }
    }
    if (findings.flagged.length > 0) {
        const first = findings.flagged[0]
        return { status: 'damaged', flagged: findings.flagged, reason: first.why === 'missing' ? `${first.key} is missing.` : `${first.key} is damaged.` }
    }
    let total = 0
    for (const unit of reader.bytes.values()) {
        total += unit.length
    }
    return { status: 'ok', source: reader.source, bytes: total }
}

export type ModuleBytesRead =
    /** The module unit checked; `source` holds its bytes and those of the lists that checked (not an absent, damaged or newer-version list), and `bytes` is their total length. */
    | { status: 'ok', source: UnitSource, bytes: number }
    /** The module unit is absent or damaged. */
    | { status: 'damaged', reason: string }
    /** A unit the module names is in a newer frame format (or the module unit is of a newer version): nothing of the module is read. */
    | { status: 'too-new', reason: string }
    /** The backend failed: nothing is known about the module. */
    | { status: 'unreadable', cause: Store2BackendError }

/**
 * Reads the units of one module for a load. The module unit cannot be replaced by an empty value, so one that is absent
 * or damaged makes the read `damaged`, and a module unit in a newer frame format makes it `too-new`. The asset and
 * inlay lists are derived from the module: one that is absent, damaged, or whose version is above this build's (a
 * newer list, as the boot read reports it) does not fail the read; its bytes are withheld from the source, and the
 * load leaves that list without a digest so the next pass derives it again from the body. A list in a newer frame
 * format is `too-new` like the module unit and is never read around.
 */
export async function readModuleBytes(backend: Store2Backend, entry: ModuleEntry, options: { yield?: () => Promise<void> } = {}): Promise<ModuleBytesRead> {
    const reader = createByteReader(backend, options.yield)
    const lists: { ref: Ref, type: UnitType }[] = [{ ref: entry.al, type: UNIT_TYPE.assetList }]
    if (entry.il !== null) {
        lists.push({ ref: entry.il, type: UNIT_TYPE.inlayList })
    }
    const loaded = await reader.load([keyOfRef(entry.unit), ...lists.map(list => keyOfRef(list.ref))])
    if (loaded.status === 'unreadable') {
        return { status: 'unreadable', cause: loaded.cause }
    }
    const unitKey = keyOfRef(entry.unit)
    const unit: UnitCheck = isStore2Key(unitKey)
        ? checkUnit(reader.source, entry.unit, UNIT_TYPE.module)
        : { status: 'damaged', reason: `${unitKey} is not a store2 unit key.`, byRef: true }
    switch (unit.status) {
        case 'ok':
            break
        case 'missing':
            return { status: 'damaged', reason: `${unitKey} is missing.` }
        case 'damaged':
            return { status: 'damaged', reason: `${unitKey}: ${unit.reason}` }
        case 'too-new':
        case 'newer-list':
            return { status: 'too-new', reason: unit.reason }
    }
    for (const list of lists) {
        const key = keyOfRef(list.ref)
        const checked = isStore2Key(key) ? checkUnit(reader.source, list.ref, list.type) : { status: 'missing' } satisfies UnitCheck
        if (checked.status === 'too-new') {
            // A list in a newer frame format is kept as it is: deriving it again would overwrite data this build cannot read.
            return { status: 'too-new', reason: checked.reason }
        }
        if (checked.status !== 'ok') {
            reader.bytes.delete(key)
        }
    }
    let total = 0
    for (const bytes of reader.bytes.values()) {
        total += bytes.length
    }
    return { status: 'ok', source: reader.source, bytes: total }
}

/** The leaf units one entry names, each with the flag its damage raises. */
function leavesOf(entry: ShardEntry): Wanted[] {
    const part = (name: CharacterPart) => (key: string, why: Why): FlaggedLeaf => ({ kind: 'character-part', chaId: entry.chaId, part: name, key, why })
    const wanted: Wanted[] = [
        { ref: entry.core, type: UNIT_TYPE.characterCore, role: { kind: 'leaf', flag: part('core') }, chunk: false },
    ]
    if (entry.lore !== null) {
        wanted.push({ ref: entry.lore, type: UNIT_TYPE.lore, role: { kind: 'leaf', flag: part('lore') }, chunk: false })
    }
    if (entry.scripts !== null) {
        wanted.push({ ref: entry.scripts, type: UNIT_TYPE.scripts, role: { kind: 'leaf', flag: part('scripts') }, chunk: false })
    }
    wanted.push({ ref: entry.al, type: UNIT_TYPE.assetList, role: { kind: 'leaf', flag: part('al') }, chunk: false })
    if (entry.il !== null) {
        wanted.push({ ref: entry.il, type: UNIT_TYPE.inlayList, role: { kind: 'leaf', flag: part('il') }, chunk: false })
    }
    for (const chat of entry.chats) {
        const flag = (chatPart: 'core' | 'chunk') => (key: string, why: Why): FlaggedLeaf => ({ kind: 'chat', chaId: entry.chaId, chatId: chat.cid, part: chatPart, key, why })
        wanted.push({ ref: chat.core, type: UNIT_TYPE.chatCore, role: { kind: 'leaf', flag: flag('core') }, chunk: false })
        for (const ref of chat.chunks) {
            wanted.push({ ref, type: UNIT_TYPE.chatChunk, role: { kind: 'leaf', flag: flag('chunk') }, chunk: true })
        }
    }
    return wanted
}

/** Files one unit's check under the finding its role gives it; a flagged unit's bytes leave the source. */
function record(findings: Findings, item: Wanted, key: string, checked: UnitCheck, bytes: Map<string, Uint8Array>): void {
    switch (checked.status) {
        case 'ok':
            return
        case 'newer-list':
            if (!findings.newerLists.includes(key)) {
                findings.newerLists.push(key)
            }
            return
        case 'too-new':
            findings.tooNew.push(key)
            findings.tooNewReason ||= checked.reason
            return
        case 'missing':
        case 'damaged': {
            const why: Why = checked.status
            const reason = checked.status === 'missing' ? `${key} is missing.` : `${key}: ${checked.reason}`
            if (item.role.kind === 'leaf') {
                findings.flagged.push(item.role.flag(key, why))
                bytes.delete(key)
            } else {
                findings.structure.push(key)
                findings.structureReason ||= reason
                findings.structureAllMissing &&= why === 'missing'
            }
        }
    }
}

/**
 * Acts on a finding only while the commit key still names this tree: a different `current` is `moved`. A failed read
 * throws `CommitKeyRecheckError`, which is neither `moved` nor damage.
 */
async function recheck(backend: Store2Backend, manifestKey: string, finding: TreeBytesRead): Promise<TreeBytesRead> {
    let bytes: Uint8Array | null
    try {
        bytes = (await backend.readCommit()).bytes
    } catch (error) {
        if (error instanceof Store2BackendError) {
            throw new CommitKeyRecheckError(error)
        }
        throw error
    }
    const parsed = classifyCommitRead({ bytes })
    if (parsed.status === 'parsed' && parsed.value.current?.key === manifestKey) {
        return finding
    }
    return { status: 'moved' }
}

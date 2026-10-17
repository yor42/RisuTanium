import {
    Store2BackendError, Store2BackendFailureError, Store2CommitConflictError, Store2NotBinaryError, Store2OverwriteRefusedError, Store2UnknownOutcomeError,
} from './backend/errors'
import { sameBytes, type Store2Backend, type Store2Read, type Store2WriteResult } from './backend/types'
import { classifyCommitRead, nextCommitKey } from './commitKey'
import {
    assetRefKey, decodeFrame, defaultKeyEnv, encodeUnit, keyOfTail, newStagedKey, newStagedManifestKey, parseStore2Key,
    readUnit, refOfFrame, refsOf, REFS_TABLE, splitHashStems, UNIT_TYPE,
    type AssetList, type CommitKey, type InlayList, type KeyEnv, type Manifest, type Ref, type RefTarget, type UnitBody, type UnitType,
} from './format'
import { INLAY_META_PREFIX, encodeInlayId } from '../../process/files/inlayKeys'
import { STORE2_PREFIX } from '../store/keyRules'
import { runExit, type ExitOptions, type ExitResult } from './recovery'

/**
 * Picking a recovery candidate (plan 4.6 Recovery, 3.4b, MC-291). Two calls:
 *
 *  `pickCandidate` reads the candidate's manifest `seq`, runs the fence exit and
 *  marker (`runExit`), and only on `marked` reads the whole tree read-only: every
 *  unit reachable through `refsOf`, leaves included, each checked by its own frame
 *  and against the size and checksum its referrer holds. A missing or damaged unit
 *  fails loudly with its key (`invalid`); nothing is written beyond the marker.
 *  After that it counts the images and inlays the tree's lists name but the store
 *  no longer holds (MC-291) and returns `ready`, which the screen shows before the
 *  user confirms.
 *
 *  `installPick` re-writes every store2 unit under fresh staged keys inside the
 *  marker's prefix, bottom-up so each parent names the new keys, and then
 *  compare-and-writes the commit key at the marker's read-back token. It never
 *  deletes a unit, never reuses an old unit key and never touches the fence. Asset
 *  and inlay files keep their keys; only store2 units are copied.
 */

/** Units read per backend call; `readUnits` bounds its own parallelism below this. */
const LEAF_BATCH = 16
/** Keys put to the presence probes per call. */
const PROBE_BATCH = 500
/** Fresh-key attempts for one staged unit whose put was refused or lost its answer. */
const PUT_ATTEMPTS = 3
/** Final compare-and-write attempts that follow an unknown outcome which left the marker standing. */
const FINAL_ATTEMPTS = 3

// ---- Tree shape ----

/**
 * The unit type each reference position names, keyed by the path `refsOf`
 * reports. Paths are unique across parents: `entries[].al` is an asset list under
 * a shard and under the module index alike.
 */
const PATH_TYPES: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.config': UNIT_TYPE.configRoot,
    'fixed.configAl': UNIT_TYPE.assetList,
    'fixed.il': UNIT_TYPE.inlayList,
    'fixed.statics': UNIT_TYPE.statics,
    'fixed.order': UNIT_TYPE.order,
    'fixed.loadouts': UNIT_TYPE.loadouts,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.presets[]': UNIT_TYPE.preset,
    'fixed.plugins[]': UNIT_TYPE.plugin,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
    'fixed.legacyKeep.unit': UNIT_TYPE.legacyList,
    'entries[].core': UNIT_TYPE.characterCore,
    'entries[].lore': UNIT_TYPE.lore,
    'entries[].scripts': UNIT_TYPE.scripts,
    'entries[].al': UNIT_TYPE.assetList,
    'entries[].il': UNIT_TYPE.inlayList,
    'entries[].chats[].core': UNIT_TYPE.chatCore,
    'entries[].chats[].chunks[]': UNIT_TYPE.chatChunk,
    'entries[].unit': UNIT_TYPE.module,
    'entries[].ref': UNIT_TYPE.pluginStorageValue,
}

/** The unit types whose bodies name further units: the walk descends into these and copies everything else as bytes. */
const PARENT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([UNIT_TYPE.shard, UNIT_TYPE.moduleIndex, UNIT_TYPE.pluginStorageBucket])

/** The `ref`-mode positions the walk must know a type for; a position `REFS_TABLE` gains without a row in `PATH_TYPES` fails here, not silently. */
export function unmappedRefPaths(): string[] {
    return REFS_TABLE
        .filter(row => row.mode === 'ref' && row.type !== UNIT_TYPE.commit && PATH_TYPES[row.path] === undefined)
        .map(row => row.path)
}

function typeOfPath(path: string): UnitType {
    const type = PATH_TYPES[path]
    if (type === undefined) {
        throw new TypeError(`No unit type is known for the reference position ${path}.`)
    }
    return type
}

// ---- Problems ----

/** Why a candidate's tree cannot be used. Every kind names the key it is about. */
export type PickProblem =
    | { kind: 'missing', keys: string[] }
    | { kind: 'damaged', key: string, reason: string }
    | { kind: 'too-new', key: string, reason: string }
    | { kind: 'unreadable', cause: Store2BackendError }

/** Unwinds the walk out of its nested loops; never escapes this module. */
class WalkStop extends Error {
    constructor(readonly problem: PickProblem) {
        super('The tree walk stopped.')
        this.name = 'WalkStop'
    }
}

async function readChecked(backend: Store2Backend, keys: readonly string[]): Promise<Map<string, Uint8Array>> {
    let read: Map<string, Uint8Array | null>
    try {
        read = await backend.readUnits(keys)
    } catch (error) {
        if (error instanceof Store2NotBinaryError) {
            throw new WalkStop({ kind: 'damaged', key: error.key, reason: `${error.key} is not binary data.` })
        }
        if (error instanceof Store2BackendError) {
            throw new WalkStop({ kind: 'unreadable', cause: error })
        }
        throw error
    }
    const found = new Map<string, Uint8Array>()
    const missing: string[] = []
    for (const key of keys) {
        const bytes = read.get(key) ?? null
        if (bytes === null) {
            missing.push(key)
        } else {
            found.set(key, bytes)
        }
    }
    if (missing.length > 0) {
        throw new WalkStop({ kind: 'missing', keys: missing })
    }
    return found
}

/** The frame of `bytes` must be intact, of `type`, and, when a referrer holds them, of the size and checksum it names. */
function validateFrame(key: string, bytes: Uint8Array, type: UnitType, referrer: { bytes: number | null, crc: number | null }): void {
    const frame = decodeFrame(bytes)
    if (frame.status === 'too-new') {
        throw new WalkStop({ kind: 'too-new', key, reason: frame.reason })
    }
    if (frame.status === 'damaged') {
        throw new WalkStop({ kind: 'damaged', key, reason: frame.reason })
    }
    if (frame.type !== type) {
        throw new WalkStop({ kind: 'damaged', key, reason: `The unit has type ${frame.type}, not ${type}.` })
    }
    if ((referrer.bytes !== null && bytes.length !== referrer.bytes) || (referrer.crc !== null && refOfFrame(key, bytes)[2] !== referrer.crc)) {
        throw new WalkStop({ kind: 'damaged', key, reason: `${key} does not match the size or checksum its referrer holds.` })
    }
}

/** The body of a parent unit; a list or leaf is never parsed here. */
function parseBody(key: string, bytes: Uint8Array, type: UnitType): UnitBody {
    const unit = readUnit(bytes, type)
    switch (unit.status) {
        case 'ok':
        case 'stale':
            return unit.value.body
        case 'too-new':
        case 'unreadable':
            throw new WalkStop({ kind: 'too-new', key, reason: unit.reason })
        case 'damaged':
            throw new WalkStop({ kind: 'damaged', key, reason: unit.reason })
    }
}

interface ManifestRead {
    bytes: Uint8Array
    body: Manifest
}

async function readManifest(backend: Store2Backend, manifestKey: string): Promise<ManifestRead> {
    const shape = parseStore2Key(manifestKey)
    if (shape === null || (shape.shape !== 'manifest' && shape.shape !== 'staged-manifest')) {
        throw new WalkStop({ kind: 'damaged', key: manifestKey, reason: `${manifestKey} is not a manifest key.` })
    }
    const bytes = (await readChecked(backend, [manifestKey])).get(manifestKey) as Uint8Array
    validateFrame(manifestKey, bytes, UNIT_TYPE.manifest, { bytes: null, crc: null })
    return { bytes, body: parseBody(manifestKey, bytes, UNIT_TYPE.manifest) as Manifest }
}

// ---- The walk ----

interface Hooks {
    /** One validated non-parent unit; the Ref that replaces its reference, or null when the walk only reads. */
    leaf(target: RefTarget, type: UnitType, key: string, bytes: Uint8Array): Promise<Ref | null>
    /** One validated parent after its children were walked; the Ref that replaces its reference, or null when the walk only reads. */
    parent(type: UnitType, key: string, body: UnitBody, replaced: ReadonlyMap<string, Ref>): Promise<Ref | null>
}

interface Child {
    target: RefTarget
    type: UnitType
    key: string
}

/**
 * Walks the units `parentBody` names: leaves in batches of `LEAF_BATCH`, then each
 * parent on its own (its read, its own children, then `hooks.parent`). Memory
 * holds one parent chain (a manifest body, one shard or index or bucket body) and
 * one batch of leaf bytes at a time. A unit named twice by one parent is walked
 * once. Returns the replacement Refs by old tail.
 */
async function walkChildren(backend: Store2Backend, hooks: Hooks, parentType: UnitType, parentBody: UnitBody): Promise<Map<string, Ref>> {
    const children = new Map<string, Child>()
    for (const target of refsOf(parentType, parentBody)) {
        const type = typeOfPath(target.path)
        const key = keyOfTail(target.tail)
        const known = children.get(key)
        if (known !== undefined) {
            if (known.type !== type) {
                throw new WalkStop({ kind: 'damaged', key, reason: `${key} is named as two different unit types.` })
            }
            if (known.target.bytes !== target.bytes || known.target.crc !== target.crc) {
                throw new WalkStop({ kind: 'damaged', key, reason: `${key} is named twice by one parent with a different size or checksum.` })
            }
            continue
        }
        children.set(key, { target, type, key })
    }
    const all = [...children.values()]
    const leaves = all.filter(child => !PARENT_TYPES.has(child.type))
    const parents = all.filter(child => PARENT_TYPES.has(child.type))

    const replaced = new Map<string, Ref>()
    // The batch is bounded by count, not bytes: it holds up to LEAF_BATCH leaves of up to the unit size cap each.
    for (let start = 0; start < leaves.length; start += LEAF_BATCH) {
        const batch = leaves.slice(start, start + LEAF_BATCH)
        const units = await readChecked(backend, batch.map(child => child.key))
        for (const child of batch) {
            const bytes = units.get(child.key) as Uint8Array
            validateFrame(child.key, bytes, child.type, child.target)
            const ref = await hooks.leaf(child.target, child.type, child.key, bytes)
            if (ref !== null) {
                replaced.set(child.target.tail, ref)
            }
        }
    }
    for (const child of parents) {
        const bytes = (await readChecked(backend, [child.key])).get(child.key) as Uint8Array
        validateFrame(child.key, bytes, child.type, child.target)
        const body = parseBody(child.key, bytes, child.type)
        const below = await walkChildren(backend, hooks, child.type, body)
        const ref = await hooks.parent(child.type, child.key, body, below)
        if (ref !== null) {
            replaced.set(child.target.tail, ref)
        }
    }
    return replaced
}

// ---- MC-291: what the lists name and the store lacks ----

/** Presence of asset files by `assetRefKey`: the caller lists `assets/` and reduces each name with `assetRefKey`; the result holds the asked keys that some entry has. */
export type AssetsPresent = (refKeys: readonly string[]) => Promise<Set<string>>
/**
 * Presence of inlay metadata records by full key (`inlays/m-<encoded id>`); the result holds the asked keys that exist.
 * Every asked key is built from the LOWER-CASED id, so the caller must compare case-insensitively: a key is present
 * when some record's id, lower-cased and re-encoded, equals it. A list lower-cases the ids it keeps, a record may not.
 */
export type InlaysPresent = (metaKeys: readonly string[]) => Promise<Set<string>>
/**
 * Presence of inlay metadata records by key prefix: the result holds the asked prefixes that at least one existing
 * `inlays/m-` key starts with. The inlay lists' hash stems are probed this way, because the extension of the
 * `assets/<hex>.<ext>` inlay id they stand for is not in the list.
 */
export type InlayPrefixesPresent = (prefixes: readonly string[]) => Promise<Set<string>>

export interface MissingCounts {
    /** Distinct asset names the tree's asset lists name that no `assets/` entry matches. */
    missingImages: number
    /** Distinct inlay ids (compared lower-cased) and distinct inlay hash stems the tree's inlay lists name that have no metadata record. */
    missingInlays: number
    /**
     * Lists whose content cannot be trusted and so are neither assumed present nor counted missing: a list of a
     * newer version, a list below this build's version, and an inlay list marked overflow (its owner's ids are
     * incomplete; the ids it does list are still counted).
     */
    unknownLists: number
}

/** Hex of a 43-character base64url hash stem, the form `assetRefKey` reduces `<hex>.<ext>` to. */
function stemToHex(stem: string): string {
    const binary = atob(stem.replace(/-/g, '+').replace(/_/g, '/') + '=')
    let hex = ''
    for (let i = 0; i < binary.length; i++) {
        hex += binary.charCodeAt(i).toString(16).padStart(2, '0')
    }
    return hex
}

/**
 * What the lists named, kept as distinct keys only (no list body is retained).
 * An inlay list's hash stems stand for inlay ids of the shape `assets/<hex>.<ext>`
 * (a character or persona image is stored as an inlay under its asset path). The
 * extension is not in the list, so each stem is probed by the prefix of its
 * metadata key; a stem no record matches counts missing. A raw asset path in a
 * text that never was an inlay therefore counts missing too, so the count errs high, with two exceptions: a stem matches a record of the same hash under another extension, and a literal id matches a record differing only in letter case; either can show a missing inlay as present,
 * and both need two stored records of the same content or name. The legacy list (type 20) is copied by the install but its names are
 * not counted here.
 */
class ListCollector {
    readonly assetKeys = new Set<string>()
    readonly inlayKeys = new Set<string>()
    readonly inlayPrefixes = new Set<string>()
    unknownLists = 0
    units = 0

    note(type: UnitType, key: string, bytes: Uint8Array): void {
        const unit = readUnit(bytes, type)
        if (unit.status === 'unreadable' || unit.status === 'stale') {
            this.unknownLists++
            return
        }
        if (unit.status === 'too-new') {
            throw new WalkStop({ kind: 'too-new', key, reason: unit.reason })
        }
        if (unit.status === 'damaged') {
            throw new WalkStop({ kind: 'damaged', key, reason: unit.reason })
        }
        const body = unit.value.body
        if (type === UNIT_TYPE.assetList) {
            const list = body as AssetList
            for (const stem of splitHashStems(list.h)) {
                this.assetKeys.add(stemToHex(stem))
            }
            for (const name of list.l) {
                this.assetKeys.add(assetRefKey(name))
            }
            return
        }
        const list = body as InlayList
        for (const id of [...list.u, ...list.o]) {
            const encoded = encodeInlayId(id.toLowerCase())
            if (encoded !== null) {
                this.inlayKeys.add(INLAY_META_PREFIX + encoded)
            }
        }
        for (const stem of splitHashStems(list.h)) {
            const encoded = encodeInlayId(`assets/${stemToHex(stem)}.`)
            if (encoded !== null) {
                this.inlayPrefixes.add(INLAY_META_PREFIX + encoded)
            }
        }
        if (list.x === true) {
            this.unknownLists++
        }
    }
}

async function countMissing(keys: ReadonlySet<string>, present: (batch: readonly string[]) => Promise<Set<string>>): Promise<number> {
    const all = [...keys]
    let missing = 0
    for (let start = 0; start < all.length; start += PROBE_BATCH) {
        const batch = all.slice(start, start + PROBE_BATCH)
        const found = await present(batch)
        for (const key of batch) {
            if (!found.has(key)) {
                missing++
            }
        }
    }
    return missing
}

// ---- Pick ----

export type MarkedExit = Extract<ExitResult, { status: 'marked' }>

export interface PickOptions extends ExitOptions {
    assetsPresent: AssetsPresent
    inlaysPresent: InlaysPresent
    inlayPrefixesPresent: InlayPrefixesPresent
}

export interface PickReady {
    status: 'ready'
    manifestKey: string
    manifestSeq: number
    /** Every unit the closure read validated, the manifest included. */
    units: number
    counts: MissingCounts
    marked: MarkedExit
    /** Held for `installPick`. */
    backend: Store2Backend
    env: KeyEnv
}

export type PickResult =
    | PickReady
    /** The tree cannot be used. `marked` is null when the manifest itself failed before the exit ran: nothing was written. */
    | { status: 'invalid', problem: PickProblem, marked: MarkedExit | null }
    /** The exit did not end `marked`; the result is passed through unchanged and nothing of the pick was read. */
    | { status: 'exit', exit: Exclude<ExitResult, { status: 'marked' }> }

/**
 * The pick up to the confirmation. `commitRead` is the screen's read of the
 * commit key (the compare basis of the marker). The manifest is read first, only
 * for its `seq`; a manifest that is already unusable returns before any write.
 * The closure read starts after the marker stands and writes nothing; the count
 * of missing images and inlays follows it.
 */
export async function pickCandidate(backend: Store2Backend, commitRead: Store2Read, manifestKey: string, options: PickOptions): Promise<PickResult> {
    const env: KeyEnv = { ...defaultKeyEnv, ...options.env }
    let manifest: ManifestRead
    try {
        manifest = await readManifest(backend, manifestKey)
    } catch (error) {
        if (error instanceof WalkStop) {
            return { status: 'invalid', problem: error.problem, marked: null }
        }
        throw error
    }

    const exit = await runExit(backend, commitRead, { kind: 'pick', manifestSeq: manifest.body.seq }, { owner: options.owner, env, foreignClear: options.foreignClear })
    if (exit.status !== 'marked') {
        return { status: 'exit', exit }
    }

    const collector = new ListCollector()
    const hooks: Hooks = {
        async leaf(_target, type, key, bytes) {
            collector.units++
            if (type === UNIT_TYPE.assetList || type === UNIT_TYPE.inlayList) {
                collector.note(type, key, bytes)
            }
            return null
        },
        async parent() {
            collector.units++
            return null
        },
    }
    try {
        collector.units++
        await walkChildren(backend, hooks, UNIT_TYPE.manifest, manifest.body)
    } catch (error) {
        if (error instanceof WalkStop) {
            return { status: 'invalid', problem: error.problem, marked: exit }
        }
        throw error
    }

    const counts: MissingCounts = {
        missingImages: await countMissing(collector.assetKeys, options.assetsPresent),
        missingInlays: await countMissing(collector.inlayKeys, options.inlaysPresent) + await countMissing(collector.inlayPrefixes, options.inlayPrefixesPresent),
        unknownLists: collector.unknownLists,
    }
    return { status: 'ready', manifestKey, manifestSeq: manifest.body.seq, units: collector.units, counts, marked: exit, backend, env }
}

// ---- Install ----

export type InstallResult =
    /** `current` is the new manifest and the marker is cleared. `flushed` is the final write's report. */
    | { status: 'installed', manifestKey: string, value: CommitKey, bytes: Uint8Array, flushed: boolean | undefined }
    /** The commit key changed under the final write and does not name this install's manifest: the old candidates and the staged copies remain, the recovery screen returns. */
    | { status: 'abandoned', current: Store2Read }
    /** A unit of the tree went missing or unusable between the validation and the re-write; nothing was installed. */
    | { status: 'invalid', problem: PickProblem }
    /** A staged unit could not be put; nothing was installed. */
    | { status: 'upload-failed', cause: Store2BackendError }
    /** The final write failed definitely. */
    | { status: 'failed', cause: Store2BackendError }
    /** The final write's outcome is unknown even after reading back. */
    | { status: 'unknown', cause: Store2BackendError }

export class InstallStop extends Error {
    constructor(readonly result: InstallResult) {
        super('The install stopped.')
        this.name = 'InstallStop'
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Replaces, in place, the tuple at `segments` (`refsOf` path syntax) and every tuple a `[]` visits, and returns `node`. */
function substitute(node: unknown, segments: readonly string[], index: number, swap: (tuple: unknown[]) => unknown[]): unknown {
    if (node === null || node === undefined) {
        return node
    }
    if (index === segments.length) {
        if (!Array.isArray(node)) {
            throw new TypeError('A reference position holds no tuple.')
        }
        return swap(node)
    }
    if (!isRecord(node)) {
        throw new TypeError('A reference path crosses a value that is not an object.')
    }
    const segment = segments[index]
    const each = segment.endsWith('[]')
    const field = each ? segment.slice(0, -2) : segment
    const child = node[field]
    if (child === null || child === undefined) {
        return node
    }
    if (!each) {
        node[field] = substitute(child, segments, index + 1, swap)
        return node
    }
    if (!Array.isArray(child)) {
        throw new TypeError(`"${field}" is not a list.`)
    }
    node[field] = child.map(item => substitute(item, segments, index + 1, swap))
    return node
}

/**
 * A copy of `body` whose every `ref` tuple names its replacement: the tail, size
 * and checksum change and every element after the checksum (a list version, a
 * chunk's message count, a field a newer writer added) is carried over. Every
 * other field, unknown ones included, is copied unchanged.
 */
function withReplacedRefs<T extends UnitBody>(type: UnitType, body: T, replaced: ReadonlyMap<string, Ref>): T {
    const copy = structuredClone(body)
    for (const row of REFS_TABLE) {
        if (row.type !== type || row.mode !== 'ref') {
            continue
        }
        substitute(copy, row.path.split('.'), 0, (tuple) => {
            const ref = replaced.get(String(tuple[0]))
            if (ref === undefined) {
                throw new TypeError(`No replacement exists for ${String(tuple[0])}.`)
            }
            return [ref[0], ref[1], ref[2], ...tuple.slice(3)]
        })
    }
    return copy
}

/** `staging.prefix` of the marker is `store2/g-<stg16>-`; the id between is what keys are minted under. */
export function stagingIdOf(prefix: string): string {
    return prefix.slice(STORE2_PREFIX.length + 'g-'.length, -1)
}

/**
 * Puts `bytes` under a fresh key from `mint`. A refused put or a lost answer is
 * retried under a new key (the first may or may not exist, an orphan inside the
 * marker's prefix that the collector reaps); any other failure, and a put whose
 * flush failed, stops the install.
 */
async function putFresh(backend: Store2Backend, bytes: Uint8Array, mint: () => string): Promise<string> {
    let last: Store2BackendError | null = null
    for (let attempt = 0; attempt < PUT_ATTEMPTS; attempt++) {
        const key = mint()
        let written: Store2WriteResult
        try {
            written = await backend.putUnit(key, bytes)
        } catch (error) {
            if (error instanceof Store2OverwriteRefusedError || error instanceof Store2UnknownOutcomeError) {
                last = error
                continue
            }
            if (error instanceof Store2BackendError) {
                throw new InstallStop({ status: 'upload-failed', cause: error })
            }
            throw error
        }
        if (written.flushed === false) {
            // Not a key collision, so no retry: the final write must not name a unit that may not survive power loss.
            throw new InstallStop({ status: 'upload-failed', cause: new Store2BackendFailureError(`The unit ${key} was written but its flush failed or was not reported as done, so the install stopped.`) })
        }
        return key
    }
    throw new InstallStop({ status: 'upload-failed', cause: last as Store2BackendError })
}

/**
 * Installs the picked tree. `confirm: true` is the user's confirmation after the
 * missing counts were shown; anything else is refused before a unit is read.
 *
 * Every unit is copied under a fresh staged key: leaves byte for byte (their
 * frame and checksum are unchanged, only the key is new), parents re-encoded with
 * the Refs of their new children, the manifest last under a staged manifest key
 * with `seq` one above the marker's and a fresh `createdAt`. Memory holds one
 * parent chain (the manifest, one shard, index or bucket) and one leaf batch; the
 * Refs of a parent's own children are the only thing kept per parent. A unit named
 * by two different parents is copied once per parent.
 *
 * The final write is one compare-and-write of the commit key at the token the
 * marker was read back with, so any other writer in between turns it into a
 * conflict. It installs `current`, clears `staging`, `retained` and `pins`, and
 * advances `seq` and `epoch`. On a conflict the key is read: this install's
 * manifest as `current` means done, anything else is `abandoned`.
 */
export async function installPick(ready: PickReady, options: { confirm: true }): Promise<InstallResult> {
    if (options.confirm !== true) {
        throw new TypeError('A pick is installed only after the user confirmed it.')
    }
    const { backend, env, marked } = ready
    const stagingId = stagingIdOf(marked.stagedPrefix)
    const markerKey = marked.marker
    try {
        const manifest = await readManifest(backend, ready.manifestKey)
        const hooks: Hooks = {
            async leaf(_target, _type, _key, bytes) {
                const key = await putFresh(backend, bytes, () => newStagedKey(stagingId, 'u', env))
                return refOfFrame(key, bytes)
            },
            async parent(type, _key, body, replaced) {
                const bytes = encodeUnit(type, withReplacedRefs(type, body, replaced))
                const key = await putFresh(backend, bytes, () => newStagedKey(stagingId, type === UNIT_TYPE.shard ? 's' : 'u', env))
                return refOfFrame(key, bytes)
            },
        }
        const replaced = await walkChildren(backend, hooks, UNIT_TYPE.manifest, manifest.body)
        const body: Manifest = {
            ...withReplacedRefs(UNIT_TYPE.manifest, manifest.body, replaced),
            seq: markerKey.seq + 1,
            createdAt: env.now(),
        }
        const manifestKey = await putFresh(backend, encodeUnit(UNIT_TYPE.manifest, body), () => newStagedManifestKey(stagingId, env))
        return await finalWrite(ready, manifestKey, body)
    } catch (error) {
        if (error instanceof InstallStop) {
            return error.result
        }
        if (error instanceof WalkStop) {
            return { status: 'invalid', problem: error.problem }
        }
        throw error
    }
}

async function readCommitOrStop(backend: Store2Backend, cause: Store2BackendError | null): Promise<Store2Read> {
    try {
        return await backend.readCommit()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            throw new InstallStop({ status: 'unknown', cause: cause ?? error })
        }
        throw error
    }
}

function namesManifest(read: Store2Read, manifestKey: string): boolean {
    const classified = classifyCommitRead(read)
    return classified.status === 'parsed' && classified.value.current?.key === manifestKey
}

/** What the final write needs of a standing marker: the marker's key and the read it was confirmed with (its compare token). A fenced `runExit` result and an unfenced first-life marker both fit. */
export interface InstallBasis {
    backend: Store2Backend
    env: KeyEnv
    marked: { marker: CommitKey, markerRead: Store2Read }
}

/** The conversion stamp an encoder-built install puts on the commit key. */
export interface Converted {
    from: string
    at: number
}

/**
 * The one final write of every install: a single compare-and-write at the marker's read-back token, never a fresh read,
 * that names `manifestKey` as `current` and clears the marker. `converted`, when given, sets `convertedFrom` and
 * `convertedAt`; otherwise the marker's values are carried.
 */
export async function finalWrite(basis: InstallBasis, manifestKey: string, manifest: Manifest, converted?: Converted): Promise<InstallResult> {
    const { backend, env, marked } = basis
    const next = nextCommitKey(marked.marker, {
        current: { key: manifestKey, at: env.now() },
        retained: [],
        pins: [],
        staging: null,
        manifests: [manifest],
        ...(converted === undefined ? {} : { convertedFrom: converted.from, convertedAt: converted.at }),
    }, env)
    const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
    // Every attempt compares at the marker's own read-back token, never at a fresh read.
    for (let attempt = 0; attempt < FINAL_ATTEMPTS; attempt++) {
        let unknown: Store2UnknownOutcomeError | null = null
        try {
            const written = await backend.casCommit(marked.markerRead.token, nextBytes)
            return { status: 'installed', manifestKey, value: next, bytes: nextBytes, flushed: written.flushed }
        } catch (error) {
            if (error instanceof Store2CommitConflictError) {
                const read = await readCommitOrStop(backend, null)
                return namesManifest(read, manifestKey)
                    ? { status: 'installed', manifestKey, value: next, bytes: read.bytes as Uint8Array, flushed: undefined }
                    : { status: 'abandoned', current: read }
            }
            if (error instanceof Store2UnknownOutcomeError) {
                unknown = error
            } else if (error instanceof Store2BackendError) {
                return { status: 'failed', cause: error }
            } else {
                throw error
            }
        }
        // An uncertain write is judged by reading first: this install's key means it landed; the marker still standing means it did not.
        const read = await readCommitOrStop(backend, unknown)
        if (read.bytes !== null && sameBytes(read.bytes, nextBytes)) {
            return { status: 'installed', manifestKey, value: next, bytes: read.bytes, flushed: undefined }
        }
        if (namesManifest(read, manifestKey)) {
            return { status: 'installed', manifestKey, value: next, bytes: read.bytes as Uint8Array, flushed: undefined }
        }
        if (read.bytes === null || !sameBytes(read.bytes, marked.markerRead.bytes as Uint8Array)) {
            return { status: 'abandoned', current: read }
        }
    }
    return { status: 'unknown', cause: new Store2UnknownOutcomeError('The final commit-key write kept an unknown outcome.') }
}

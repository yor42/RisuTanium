import {
    Store2BackendError, Store2BackendFailureError, Store2CommitConflictError, Store2UnknownOutcomeError,
} from './backend/errors'
import {
    BULK_UNIT_THRESHOLD, sameBytes, type Store2Backend, type Store2Read, type Store2WriteResult, type UnitWrite,
} from './backend/types'
import { classifyCommitRead, nextCommitKey, RETAINED_MAX, withLine, withReplaced, type CommitKeyChange } from './commitKey'
import {
    defaultKeyEnv, encodeUnit, newManifestKey, newShardKey, newStagedKey, newStagedManifestKey, newStagingId,
    newUnitKey, parseStore2Key, readUnit, refOfFrame, refsOf, stagingPrefix, UNIT_TYPE, type CommitKey, type KeyEnv,
    type Manifest, type SnapshotPointer, type StagingLabel, type UnitType,
} from './format'
import { decideClear, type ClearDecision, type ForeignClearHook, type Staging } from './owner'

/**
 * The commit-key operations of the store2 protocol over one backend: ordinary
 * and bulk commit, restore, save-mine, pins and the abandon-clear. Every write
 * is one logical commit-key write (`nextCommitKey`: `seq` plus one, a fresh
 * `epoch`) made as one compare-and-write against the version of the read the
 * caller passed in; a conflict is never retried at the version the conflict
 * reported, only after a fresh read that is judged again. This module never
 * writes or deletes the fence and never deletes a unit.
 *
 * Every operation takes the caller's read of the commit key (`Store2Read`) as
 * its base and refuses unless that read is a parsed key naming a `current`
 * (the abandon-clear alone accepts a null `current`, because it only clears a
 * marker).
 */

/** The previous `current` enters `retained` only when the newest retained entry is at least this old. */
export const ADMISSION_INTERVAL_MS = 5 * 60 * 1000

/** How many times the final compare-and-write of a bulk commit and an abandon-clear are re-judged after a conflict. */
const REJUDGE_ATTEMPTS = 3

export type Refusal =
    | 'absent' | 'damaged' | 'too-new' | 'no-current'
    | 'marker-present' | 'bad-unit-set' | 'bad-manifest-key' | 'already-current' | 'tree-incomplete'
    | 'node-save-mine' | 'not-named' | 'already-pinned' | 'not-pinned' | 'not-mine' | 'no-snapshot' | 'snapshot-mismatch' | 'staging'
    | 'base-unnamed'

export interface Refused {
    status: 'refused'
    reason: Refusal
    detail: string
    /** Keys a restore found missing or damaged. */
    missing?: string[]
    /** A bulk commit refused after its marker was set: what the own-marker clear came to. Anything but `cleared` or `nothing` means the marker may still stand. */
    cleared?: AbandonResult | null
}

/** A parsed commit key and the read (bytes and compare token) it came from. */
export interface Base {
    read: Store2Read
    key: CommitKey
}

/**
 * What one logical write came to.
 *   committed: the commit key now holds `value` (framed as `bytes`). Re-read for the next base.
 *   conflict:  this write is not known to have landed, and `current` is what the key held when last read. After an uncertain
 *              write, a read-back that shows a peer's write on top also reports conflict, and this write may have landed
 *              underneath it. Re-read, judge again, rebuild.
 *   failed:    a definite backend failure; the commit key was not changed by this step.
 *   unknown:   the outcome could not be decided, even by reading back.
 */
export type WriteResult =
    | { status: 'committed', value: CommitKey, bytes: Uint8Array, flushed: boolean | undefined }
    | { status: 'conflict', current: Store2Read }
    | { status: 'failed', cause: Store2BackendError }
    | { status: 'unknown', cause: Store2BackendError }
    | Refused

/** A commit result adds the manifest it installed, or an abandoned bulk. */
export type CommitResult =
    | Exclude<WriteResult, { status: 'committed' }>
    | (Extract<WriteResult, { status: 'committed' }> & { manifestKey: string, mode: 'ordinary' | 'bulk' })
    /** A bulk commit that did not land after its marker was set: the staged units are garbage. `cleared` is what the own-marker clear came to. */
    | { status: 'abandoned', reason: 'marker-lost' | 'rejudge-exhausted' | 'upload-failed', cleared: AbandonResult | null, cause?: Store2BackendError }

export type AbandonResult =
    | { status: 'cleared', value: CommitKey, bytes: Uint8Array }
    /** No marker stands (never set, or already gone). Nothing was written. */
    | { status: 'nothing' }
    | { status: 'conflict', current: Store2Read }
    | { status: 'failed', cause: Store2BackendError }
    | { status: 'unknown', cause: Store2BackendError }
    | Refused

/**
 * What a bulk commit throws when the caller's `build` (or a non-backend error during the upload) fails after the
 * marker was set. `cleared` is what the own-marker clear came to: anything but `cleared` or `nothing` means the
 * marker may still stand, and the caller owns its recovery.
 */
export class Store2BulkAbortError extends Error {
    constructor(readonly original: unknown, readonly cleared: AbandonResult | null) {
        super(original instanceof Error ? original.message : String(original))
        this.name = 'Store2BulkAbortError'
    }
}

declare const heldBulkBrand: unique symbol

/**
 * A bulk marker this committer wrote and still holds, opaque to callers: only `openHeldBulk` mints one, and
 * `commitHeld` and `clearHeld` read it back. It carries the marker key, the read-back that confirmed the marker, its
 * prefix and its staging id.
 */
export interface HeldBulk {
    readonly [heldBulkBrand]: true
}

/**
 * What `openHeldBulk` came to. `opened` carries the read-back of the commit key with the marker on it. A refusal
 * (`marker-present`, for one) wrote nothing. After a `conflict`, `unknown` or `failed` the marker may have landed, so the
 * call has already cleared its own marker: `cleared` is what that clear came to, and anything but `cleared` or `nothing`
 * means the marker may still stand.
 */
export type HeldOpen =
    | { status: 'opened', held: HeldBulk, read: Store2Read }
    | Refused
    | { status: 'conflict', current: Store2Read, cleared: AbandonResult | null }
    | { status: 'failed' | 'unknown', cause: Store2BackendError, cleared: AbandonResult | null }

/**
 * Mints the keys of one build. A unit key is accepted by a commit only if the
 * mint of that very attempt issued it, and a commit calls `build` again on every
 * attempt, so a retry after a failed or unknown commit can only carry units
 * under keys never offered to a backend before (a Node upload that lost its
 * response leaves its key taken, and an uploaded orphan must not be named).
 */
export interface KeyMint {
    shard(): string
    unit(): string
    manifest(): string
}

export interface BuildContext {
    mint: KeyMint
    /** The `seq` the commit key will carry. */
    seq: number
    /** The clock reading the commit key's `current.at` will carry. */
    now: number
    /** The legacy keep the new manifest names instead of the one the build planned with (a save-mine over a base that does not name the planned manifest). */
    legacyKeep?: Manifest['fixed']['legacyKeep']
}

export interface ManifestWrite {
    key: string
    body: Manifest
}

export interface BuiltCommit {
    /** The new units other than the manifest, each under a key the mint issued. */
    units: UnitWrite[]
    manifest: ManifestWrite
    /**
     * The pointer to the old-data deletion snapshot among `units`. Only an installer (`installBuilt`) puts it on the
     * commit key; the ordinary and bulk commits ignore it, because no other write sets a pointer.
     */
    snapshot?: SnapshotPointer
}

export type Carry = { from: string, units: number }

/**
 * The claim of a request that replaces its base: an import that names no unit of the base. An import that reuses base
 * units by content carries `{ from, units }` instead, `from` being the manifest its content index was read from. When
 * `from` is also the current of the commit read the import is made over, the carry judge protects the carried keep as
 * well; otherwise the keep stays under the limitation below.
 *
 * Accepted limitation (bulk import window): an import carries the base's
 * legacy keep by value and the bulk path does not judge this claim, so the final write can land a manifest that names a
 * keep unit the garbage collector deleted while the marker stood. That needs a garbage collection pass, a peer commit
 * landing over the base during the marker, and a writer that releases the keep: a null-setting commit, `Committer.restore`
 * (it installs a manifest whole) or a recovery exit, each when the installed manifest does not name the keep. No current
 * host combines them: Tauri runs one page; the web collector runs only on a sole tab, whose own-base rule makes it refuse
 * while the commit key's current is not the manifest this page acknowledged (and after this page fast-forwarded), and
 * the Node collector refuses under any standing marker, directly after its commit read and before its mark. That refusal
 * is sound while three things hold: every commit-key write under a marker keeps the marker unless it is the owner's final
 * write or clear; a Node commit revision never returns to an earlier value; and each import derives its carried keep from
 * the same commit read that its marker write compares; a held restore derives it from an install read whose `seq`
 * equals its marker's read-back (`checkAuthoritativeBase`), so its `current` is the one the marker write compared, and
 * its final write compares that install read. If it happens, live data still loads and tree reads and export are
 * unaffected, but restore of a manifest that names the keep is refused `tree-incomplete`, so are recovery picks of such
 * manifests, and asset sweeps stop on an incomplete keep-set, until something releases the keep.
 */
export const IMPORT_REPLACES_BASE: unique symbol = Symbol.for('risu.store2.IMPORT_REPLACES_BASE')

/** Fail-closed read of a request's carry: a Carry, or null for the sentinel; anything else is a programming error. */
function plannedCarry(request: Pick<CommitRequest, 'carry'>): Carry | null {
    const carry = request.carry as unknown
    if (carry === IMPORT_REPLACES_BASE) {
        return null
    }
    if (typeof carry === 'object' && carry !== null) {
        const held = carry as { from?: unknown, units?: unknown }
        if (typeof held.from === 'string' && typeof held.units === 'number' && Number.isInteger(held.units) && held.units >= 0) {
            return carry as Carry
        }
    }
    throw new TypeError('CommitRequest.carry must be IMPORT_REPLACES_BASE or { from: string, units: integer >= 0 }.')
}

export interface CommitRequest {
    /**
     * How many new units the commit writes, the manifest included; it decides ordinary or bulk before any key exists.
     * An existing unit the build names by key (reused or carried) is not a new unit.
     */
    newUnits: number
    /**
     * Builds the commit's units. An ordinary commit trusts this build: every pre-existing unit the new manifest
     * names must be named by a manifest the base commit key names (current, retained or pinned), or garbage
     * collection, whose keep-set is exactly those manifests, may delete it before the compare-and-write lands.
     */
    build(context: BuildContext): BuiltCommit | Promise<BuiltCommit>
    /** The marker label of a bulk commit; `bulk` when absent. */
    label?: StagingLabel
    /** A replacement of the whole profile always keeps the state it replaces: the previous `current` enters `retained` whatever the admission interval says. */
    force?: boolean
    /**
     * The previous `current` enters `retained` whatever the admission interval says, without the other effects of `force`:
     * the descent line is judged as for an ordinary delta. A resolution that keeps both versions of a record asks for it.
     */
    keepPrevious?: boolean
    /**
     * Required; any other value throws a TypeError. Either a `Carry`, when the build was planned over an acknowledged
     * manifest, or, for an import, the manifest whose units the build names by content: `from` is that manifest's key and `units` counts the pre-existing units the new manifest names without
     * writing them, the legacy keep excluded because it travels by value. A commit that carries from `from` is refused
     * unless the commit key it compares against still names `from`, because garbage collection may have deleted what it
     * would carry; the ordinary path skips the check at `units` 0, the bulk path judges any carry. Or
     * `IMPORT_REPLACES_BASE`: the request replaces its base and claims nothing about a manifest it was planned over, so
     * this rule never refuses it. That is not "carries nothing": the legacy import still carries the base's legacy keep
     * by value, unjudged on the bulk path.
     */
    carry: Carry | typeof IMPORT_REPLACES_BASE
}

/**
 * The context of a streamed build: the attempt's `BuildContext` plus `put`, which uploads one unit at once. A streamed
 * build returns a `BuiltCommit` whose `units` are only the units it did not put; every put unit stays out of that list.
 * `put` rejects with a `TypeError` for a key the attempt's mint did not issue, a key put twice, or more puts than the
 * request leaves room for (`newUnits - 1`, the manifest being the last unit). A failed or unflushed upload stops the
 * whole commit with a signal that must reach the committer: a build must await `put` outside every `catch` that could
 * swallow or rewrap it.
 */
export type StreamContext = BuildContext & { put(unit: UnitWrite): Promise<void> }

/** A `CommitRequest` whose `build` may upload units early through `context.put`. */
export type StreamedCommitRequest = Omit<CommitRequest, 'build'> & {
    build(context: StreamContext): BuiltCommit | Promise<BuiltCommit>
}

/** How many of its newest commit-key epochs a committer remembers as its own. */
const OWN_EPOCHS_MAX = 64

export interface CommitterOptions {
    /** The owner id of this page load (`owner.ts`). */
    owner: string
    /** Randomness and the clock; the clock serves retention admission and the stamps only, never safety. */
    env?: KeyEnv
    /** The Q3 question for a foreign marker; absent means a foreign marker is never cleared. */
    foreignClear?: ForeignClearHook
}

/** Whether the commit key keeps `manifestKey` alive: as current, retained or pinned (the garbage collector's keep set). */
export function namesManifest(key: CommitKey, manifestKey: string): boolean {
    return key.current?.key === manifestKey || key.retained.some(entry => entry.key === manifestKey) || key.pins.some(pin => pin.key === manifestKey)
}

/** Parses a read into a base, or the refusal that says why it cannot be one. */
export function baseOf(read: Store2Read, options: { needCurrent: boolean } = { needCurrent: true }): { status: 'ok', base: Base } | Refused {
    const classified = classifyCommitRead(read)
    switch (classified.status) {
        case 'absent':
            return { status: 'refused', reason: 'absent', detail: 'The commit key is absent.' }
        case 'damaged':
            return { status: 'refused', reason: 'damaged', detail: classified.reason }
        case 'too-new':
            return { status: 'refused', reason: 'too-new', detail: classified.reason }
        case 'parsed':
            if (options.needCurrent && classified.value.current === null) {
                return { status: 'refused', reason: 'no-current', detail: 'The commit key names no current manifest.' }
            }
            return { status: 'ok', base: { read, key: classified.value } }
    }
}

/**
 * The `retained` list after a write over `base`: the previous `current` pushed
 * to the front when the write is `force`d or admission allows it, any entry for
 * `drop` removed, and the list capped. Overflow drops the oldest entry that is
 * not pinned; the newest entry (the one just pushed) is never the one dropped,
 * and only when every other entry is pinned does the oldest go (a pin names its
 * manifest on its own, so it stays live).
 */
export function nextRetained(base: CommitKey, now: number, force: boolean, drop: string | null = null): CommitKey['retained'] {
    let list = base.retained.filter(entry => entry.key !== drop).map(entry => ({ ...entry }))
    const previous = base.current
    if (previous !== null && previous.key !== drop) {
        const admitted = list.length === 0 || now - list[0].at >= ADMISSION_INTERVAL_MS
        if (force || admitted) {
            list = [{ key: previous.key, at: previous.at }, ...list.filter(entry => entry.key !== previous.key)]
        }
    }
    const pinned = new Set(base.pins.map(pin => pin.key))
    while (list.length > RETAINED_MAX) {
        let victim = list.length - 1
        while (victim > 1 && pinned.has(list[victim].key)) {
            victim--
        }
        if (pinned.has(list[victim].key)) {
            victim = list.length - 1
        }
        list.splice(victim, 1)
    }
    return list
}

/** The manifest units a tree read descends into, by the path that names them in the manifest. */
export const DESCENT: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.moduleBuckets[]': UNIT_TYPE.moduleBucket,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
}

export type TreeCheck =
    | { status: 'complete', manifest: Manifest }
    | { status: 'incomplete', missing: string[] }

/**
 * Whether every unit the manifest names exists. The manifest, its shards, the
 * module index and the plugin-storage buckets are read and checked against the
 * size and checksum their referrer holds; every other named unit (chat chunks,
 * cores, lists, modules, presets, plugins) must be present in one listing.
 */
export async function checkTree(backend: Store2Backend, manifestKey: string): Promise<TreeCheck> {
    const listed = new Set(await backend.listStore2())
    const missing: string[] = []
    const manifestBytes = (await backend.readUnits([manifestKey])).get(manifestKey) ?? null
    if (manifestBytes === null) {
        return { status: 'incomplete', missing: [manifestKey] }
    }
    const manifestUnit = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifestUnit.status !== 'ok' && manifestUnit.status !== 'stale') {
        return { status: 'incomplete', missing: [manifestKey] }
    }
    const manifest = manifestUnit.value.body as Manifest
    const descents: { key: string, type: UnitType, bytes: number | null, crc: number | null }[] = []
    for (const target of refsOf(UNIT_TYPE.manifest, manifest)) {
        const key = `store2/${target.tail}`
        if (!listed.has(key)) {
            missing.push(key)
            continue
        }
        const type = DESCENT[target.path]
        if (type !== undefined) {
            descents.push({ key, type, bytes: target.bytes, crc: target.crc })
        }
    }
    const read = await backend.readUnits(descents.map(entry => entry.key))
    const seen = new Set<string>()
    for (const entry of descents) {
        const bytes = read.get(entry.key) ?? null
        if (bytes === null) {
            missing.push(entry.key)
            continue
        }
        if ((entry.bytes !== null && bytes.length !== entry.bytes) || (entry.crc !== null && bytes.length >= 20 && refOfFrame(entry.key, bytes)[2] !== entry.crc)) {
            missing.push(entry.key)
            continue
        }
        const unit = readUnit(bytes, entry.type)
        if (unit.status !== 'ok' && unit.status !== 'stale') {
            missing.push(entry.key)
            continue
        }
        for (const child of refsOf(entry.type, unit.value.body)) {
            const key = `store2/${child.tail}`
            if (!listed.has(key) && !seen.has(key)) {
                seen.add(key)
                missing.push(key)
            }
        }
    }
    return missing.length === 0 ? { status: 'complete', manifest } : { status: 'incomplete', missing }
}

type Cas =
    | { kind: 'written', flushed: boolean | undefined }
    | { kind: 'conflict', current: Store2Read }
    | { kind: 'failed', cause: Store2BackendError }
    | { kind: 'unknown', cause: Store2BackendError }

/** Runs one backend write and sorts what it threw; an argument error is not a backend outcome and propagates. */
async function attempt(run: () => Promise<Store2WriteResult>): Promise<Cas> {
    try {
        const result = await run()
        return { kind: 'written', flushed: result.flushed }
    } catch (error) {
        if (error instanceof Store2CommitConflictError) {
            return { kind: 'conflict', current: error.current }
        }
        if (error instanceof Store2UnknownOutcomeError) {
            return { kind: 'unknown', cause: error }
        }
        if (error instanceof Store2BackendError) {
            return { kind: 'failed', cause: error }
        }
        throw error
    }
}

export interface Committer {
    readonly owner: string
    /**
     * Whether a commit key with this epoch was built by this committer (a commit, a bulk marker, a pin, a drop, a restore or a
     * marker clear), among its most recent keys. A key it answers true for is this page's own write, never a peer's.
     */
    ownsEpoch?(epoch: string): boolean
    /** Reads the commit key as a base. */
    readCommit(): Promise<Store2Read>
    commit(read: Store2Read, request: CommitRequest): Promise<CommitResult>
    /**
     * A bulk commit whose build uploads units as it goes (`StreamContext.put`): the entry checks of `commit`, then the
     * bulk route always (no threshold choice). Optional so a wrapper that spreads or lists a committer need not name it.
     */
    commitStreamed?(read: Store2Read, request: StreamedCommitRequest): Promise<CommitResult>
    restore(read: Store2Read, manifestKey: string): Promise<WriteResult>
    saveMine(freshRead: Store2Read, request: CommitRequest): Promise<CommitResult>
    pin(read: Store2Read, key: string, reason: string): Promise<WriteResult>
    unpin(read: Store2Read, key: string): Promise<WriteResult>
    /**
     * The old-data deletion's completion write: one compare-and-write that drops the snapshot pointer and changes nothing
     * else. Refuses a key with no pointer (`no-snapshot`), a pointer that differs from `expected` by key, digest or count
     * (`snapshot-mismatch`, so a retry on a fresh read never drops a newer conversion's pointer) and a key with a marker
     * standing (`staging`, so the drop never moves the token a peer's bulk final write compares against).
     */
    dropSnapshot(read: Store2Read, expected: SnapshotPointer): Promise<WriteResult>
    abandonClear(read: Store2Read, owner: string, prefix: string): Promise<AbandonResult>
    /**
     * Writes a bulk marker over `read` and keeps it standing, for a writer that decides by the target's contents and
     * must hold off the Node deleters while it does (a `.rtb` restore). Only `IMPORT_REPLACES_BASE` is claimed.
     */
    openHeldBulk?(read: Store2Read, request: { label: StagingLabel }): Promise<HeldOpen>
    /**
     * The commit under a marker `openHeldBulk` wrote: always the staged path, whatever `newUnits` is, and its final write
     * installs `current` and clears the marker in one compare-and-write over `read`. `read` must carry this committer's
     * own marker with the held prefix, or nothing is written (`abandoned marker-lost`).
     *
     * Invariant: only `IMPORT_REPLACES_BASE` is accepted, and a `Carry` throws a TypeError. A `Carry` is judged against
     * the read its marker write compared, while a held commit is built over a later install read; accepting one would
     * let a keep named by a manifest the marker never saw reach the final write unjudged.
     */
    commitHeld?(held: HeldBulk, read: Store2Read, request: CommitRequest): Promise<CommitResult>
    /** Clears the held marker through the own-marker clear; `nothing` when none stands. */
    clearHeld?(held: HeldBulk): Promise<AbandonResult | null>
    /** Decides whether the marker on `read` may be cleared (own: yes; foreign: only through the hook) and clears it. */
    clearMarker(read: Store2Read): Promise<{ decision: ClearDecision, cleared: AbandonResult | null }>
}

/**
 * The mint of one build attempt and the set of keys it issued. A null `stagingId` mints ordinary keys; a staging id mints
 * keys inside that marker's prefix, which is the only place a staged build may write.
 */
export function createKeyMint(env: KeyEnv, stagingId: string | null): { mint: KeyMint, issued: Set<string> } {
    const issued = new Set<string>()
    const issue = (key: string): string => {
        issued.add(key)
        return key
    }
    const mint: KeyMint = stagingId === null
        ? {
            shard: () => issue(newShardKey(env)),
            unit: () => issue(newUnitKey(env)),
            manifest: () => issue(newManifestKey(env)),
        }
        : {
            shard: () => issue(newStagedKey(stagingId, 's', env)),
            unit: () => issue(newStagedKey(stagingId, 'u', env)),
            manifest: () => issue(newStagedManifestKey(stagingId, env)),
        }
    return { mint, issued }
}

/** Whether a built commit is exactly the declared set of units under keys this attempt issued. */
export function checkBuiltUnits(built: BuiltCommit, issued: ReadonlySet<string>, declared: number, staged: boolean): Refused | null {
    const refused = (reason: Refusal, detail: string): Refused => ({ status: 'refused', reason, detail })
    if (built.units.length + 1 !== declared) {
        return refused('bad-unit-set', `The request declared ${declared} new units but built ${built.units.length + 1}.`)
    }
    const manifestShape = parseStore2Key(built.manifest.key)
    if (manifestShape === null || manifestShape.shape !== (staged ? 'staged-manifest' : 'manifest')) {
        return refused('bad-manifest-key', 'The manifest key is not a manifest key of this commit.')
    }
    const keys = new Set<string>()
    for (const key of [built.manifest.key, ...built.units.map(unit => unit.key)]) {
        if (!issued.has(key)) {
            return refused('bad-unit-set', `${key} was not issued by this attempt's key mint.`)
        }
        if (keys.has(key)) {
            return refused('bad-unit-set', `${key} appears twice.`)
        }
        keys.add(key)
    }
    return null
}

/**
 * The signal of a failed or unflushed streamed upload. `put` throws it and the committer or installer that owns the
 * attempt turns it into its upload-failed result; it is never a build failure.
 */
export class StreamedPutStop extends Error {
    constructor(readonly cause: Store2BackendError) {
        super('A streamed unit upload failed.')
        this.name = 'StreamedPutStop'
    }
}

/** What `put` refuses before any write: a programming error of the build, never a device outcome. */
export function guardStreamedPut(key: string, issued: ReadonlySet<string>, putKeys: ReadonlySet<string>, declared: number): void {
    if (!issued.has(key)) {
        throw new TypeError(`${key} was not issued by this attempt's key mint.`)
    }
    if (putKeys.has(key)) {
        throw new TypeError(`${key} was put twice.`)
    }
    if (putKeys.size >= declared - 1) {
        throw new TypeError(`The request declared ${declared} new units, so at most ${declared - 1} can be put before the manifest.`)
    }
}

/** The failure of one streamed unit write, or null when it landed flushed. */
async function putStreamedUnit(backend: Store2Backend, unit: UnitWrite): Promise<StreamedPutStop | null> {
    let flushed: boolean | undefined
    try {
        flushed = (await backend.putUnit(unit.key, unit.bytes)).flushed
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return new StreamedPutStop(error)
        }
        throw error
    }
    if (flushed === false) {
        // The final write must not name a unit that may not survive power loss.
        return new StreamedPutStop(new Store2BackendFailureError(`The unit ${unit.key} was written but its flush failed or was not reported as done, so the commit was abandoned.`))
    }
    return null
}

/** Whether a streamed build is exactly the declared set of units: the put ones plus the tail, all under keys this attempt issued. */
export function checkStreamedUnits(built: BuiltCommit, issued: ReadonlySet<string>, putKeys: ReadonlySet<string>, declared: number): Refused | null {
    const refused = (reason: Refusal, detail: string): Refused => ({ status: 'refused', reason, detail })
    if (putKeys.size + built.units.length + 1 !== declared) {
        return refused('bad-unit-set', `The request declared ${declared} new units but built ${putKeys.size + built.units.length + 1}.`)
    }
    const manifestShape = parseStore2Key(built.manifest.key)
    if (manifestShape === null || manifestShape.shape !== 'staged-manifest') {
        return refused('bad-manifest-key', 'The manifest key is not a manifest key of this commit.')
    }
    const keys = new Set<string>()
    for (const key of [built.manifest.key, ...built.units.map(unit => unit.key)]) {
        if (!issued.has(key)) {
            return refused('bad-unit-set', `${key} was not issued by this attempt's key mint.`)
        }
        if (putKeys.has(key)) {
            return refused('bad-unit-set', `${key} was already put and is named again.`)
        }
        if (keys.has(key)) {
            return refused('bad-unit-set', `${key} appears twice.`)
        }
        keys.add(key)
    }
    return null
}

/** What `openMarker` hands the rest of a bulk commit: the marker this attempt wrote and the read that confirmed it. */
interface OpenedMarker {
    status: 'opened'
    markerKey: CommitKey
    held: Store2Read
    prefix: string
    stagingId: string
}

/** The state behind an opaque `HeldBulk`. */
type HeldState = Omit<OpenedMarker, 'status'>

const heldStates = new WeakMap<HeldBulk, HeldState>()

function heldStateOf(held: HeldBulk): HeldState {
    const state = heldStates.get(held)
    if (state === undefined) {
        throw new TypeError('The held bulk marker was not opened by openHeldBulk.')
    }
    return state
}

export function createCommitter(backend: Store2Backend, options: CommitterOptions): Committer {
    const env: KeyEnv = { ...defaultKeyEnv, ...options.env }
    const owner = options.owner
    /** The epochs of the most recent commit keys this committer built, newest last; a key with one of them was written by this page. */
    const ownEpochs: string[] = []

    function nextOwnKey(base: CommitKey, change: CommitKeyChange, keyEnv: KeyEnv): CommitKey {
        const next = nextCommitKey(base, change, keyEnv)
        ownEpochs.push(next.epoch)
        if (ownEpochs.length > OWN_EPOCHS_MAX) {
            ownEpochs.shift()
        }
        return next
    }

    function refuse(reason: Refusal, detail: string, missing?: string[]): Refused {
        return missing === undefined ? { status: 'refused', reason, detail } : { status: 'refused', reason, detail, missing }
    }

    /** One compare-and-write of an already built next key; an unknown outcome is decided by reading the key back. */
    async function settle(next: CommitKey, nextBytes: Uint8Array, run: () => Promise<Store2WriteResult>): Promise<WriteResult> {
        const outcome = await attempt(run)
        switch (outcome.kind) {
            case 'written':
                return { status: 'committed', value: next, bytes: nextBytes, flushed: outcome.flushed }
            case 'conflict':
                return { status: 'conflict', current: outcome.current }
            case 'failed':
                return { status: 'failed', cause: outcome.cause }
            case 'unknown': {
                let read: Store2Read
                try {
                    read = await backend.readCommit()
                } catch (error) {
                    if (error instanceof Store2BackendError) {
                        return { status: 'unknown', cause: outcome.cause }
                    }
                    throw error
                }
                if (read.bytes !== null && sameBytes(read.bytes, nextBytes)) {
                    return { status: 'committed', value: next, bytes: nextBytes, flushed: undefined }
                }
                return { status: 'conflict', current: read }
            }
        }
    }

    function createMint(stagingId: string | null): { mint: KeyMint, issued: Set<string> } {
        return createKeyMint(env, stagingId)
    }

    function checkBuilt(built: BuiltCommit, issued: ReadonlySet<string>, declared: number, staged: boolean): Refused | null {
        return checkBuiltUnits(built, issued, declared, staged)
    }

    function refuseUnnamed(request: Pick<CommitRequest, 'carry'>): Refused {
        return refuse('base-unnamed', `The commit key no longer names the manifest ${plannedCarry(request)?.from ?? ''} this build was planned over.`)
    }

    async function ordinary(base: Base, request: CommitRequest, force: boolean, legacyKeep?: Manifest['fixed']['legacyKeep']): Promise<CommitResult> {
        // Only a save-mine reaches here over a base that does not name `from`; a build with nothing carried lands
        // because the legacy keep is substituted and no pre-existing unit is named.
        const carry = plannedCarry(request)
        if (carry !== null && carry.units > 0 && !namesManifest(base.key, carry.from)) {
            return refuseUnnamed(request)
        }
        const { mint, issued } = createMint(null)
        const now = env.now()
        const context: BuildContext = { mint, seq: base.key.seq + 1, now }
        if (legacyKeep !== undefined) {
            context.legacyKeep = legacyKeep
        }
        const built = await request.build(context)
        const refused = checkBuilt(built, issued, request.newUnits, false)
        if (refused !== null) {
            return refused
        }
        const manifestUnit: UnitWrite = { key: built.manifest.key, bytes: encodeUnit(UNIT_TYPE.manifest, built.manifest.body) }
        const next = nextOwnKey(base.key, {
            current: { key: built.manifest.key, at: now },
            retained: nextRetained(base.key, now, force || request.keepPrevious === true),
            manifests: [built.manifest.body],
        }, env)
        // Only a delta planned over the tree this base names descends; a force (save-mine, import) never does.
        withLine(next, base.key, !force && carry !== null && carry.from === base.key.current?.key)
        if (request.label === 'import') {
            withReplaced(next, 'import')
        }
        const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
        const result = await settle(next, nextBytes, () => backend.commitOrdinary(base.read.token, [...built.units, manifestUnit], nextBytes))
        return result.status === 'committed' ? { ...result, manifestKey: built.manifest.key, mode: 'ordinary' } : result
    }

    async function clearOwnMarker(prefix: string): Promise<AbandonResult | null> {
        try {
            return await abandonClear(await backend.readCommit(), owner, prefix)
        } catch (error) {
            if (error instanceof Store2BackendError) {
                return { status: 'failed', cause: error }
            }
            throw error
        }
    }

    /**
     * The marker half of a bulk commit: the carry and standing-marker refusals, the marker compare-and-write and its
     * read-back. Nothing is built before this returns `opened`.
     */
    async function openMarker(base: Base, request: Pick<CommitRequest, 'carry' | 'label'>, givenStagingId?: string): Promise<OpenedMarker | CommitResult> {
        // A bulk build may reference anything `from` names (units by key or digest, the legacy keep, opaque fields), so
        // any carry over a base that does not name `from` is refused whatever the unit count says.
        const carry = plannedCarry(request)
        if (carry !== null && !namesManifest(base.key, carry.from)) {
            return refuseUnnamed(request)
        }
        if (base.key.staging !== null) {
            return refuse('marker-present', 'A bulk marker already stands on the commit key.')
        }
        const stagingId = givenStagingId ?? newStagingId(env)
        const prefix = stagingPrefix(stagingId)
        const marker: Staging = { owner, prefix, startedAt: env.now(), label: request.label ?? 'bulk' }
        const markerKey = nextOwnKey(base.key, { staging: marker }, env)
        const markerBytes = encodeUnit(UNIT_TYPE.commit, markerKey)

        // The marker is on the commit key before any unit exists under its prefix.
        const marked = await settle(markerKey, markerBytes, () => backend.casCommit(base.read.token, markerBytes))
        if (marked.status !== 'committed') {
            return marked
        }
        let held: Store2Read
        try {
            held = await backend.readCommit()
        } catch (error) {
            if (error instanceof Store2BackendError) {
                return { status: 'unknown', cause: error }
            }
            throw error
        }
        if (held.bytes === null || !sameBytes(held.bytes, markerBytes)) {
            return { status: 'conflict', current: held }
        }
        return { status: 'opened', markerKey, held, prefix, stagingId }
    }

    /** A build that threw after the marker was set: the own marker is cleared and the original travels in the abort error. */
    async function abortBuild(prefix: string, error: unknown): Promise<never> {
        throw new Store2BulkAbortError(error, await clearOwnMarker(prefix))
    }

    async function bulk(base: Base, request: CommitRequest): Promise<CommitResult> {
        const opened = await openMarker(base, request)
        if (opened.status === 'opened') {
            const { mint, issued } = createMint(opened.stagingId)
            let built: BuiltCommit
            try {
                built = await request.build({ mint, seq: opened.markerKey.seq + 1, now: env.now() })
            } catch (error) {
                return abortBuild(opened.prefix, error)
            }
            const refused = checkBuilt(built, issued, request.newUnits, true)
            if (refused !== null) {
                return { ...refused, cleared: await clearOwnMarker(opened.prefix) }
            }
            return finishBulk(opened, built, request)
        }
        return opened
    }

    /**
     * A bulk commit whose build puts units as it goes. The entry checks run in `commitStreamed`; this opens the marker,
     * builds with a `put` that uploads at once, checks the declared set and hands the tail and the manifest to the same
     * `finishBulk` the whole path uses.
     */
    async function streamed(base: Base, request: StreamedCommitRequest): Promise<CommitResult> {
        const opened = await openMarker(base, request)
        if (opened.status !== 'opened') {
            return opened
        }
        const { mint, issued } = createMint(opened.stagingId)
        const putKeys = new Set<string>()
        const upload: { stop: StreamedPutStop | null } = { stop: null }
        const put = async (unit: UnitWrite): Promise<void> => {
            if (upload.stop !== null) {
                throw upload.stop
            }
            guardStreamedPut(unit.key, issued, putKeys, request.newUnits)
            putKeys.add(unit.key)
            const failure = await putStreamedUnit(backend, unit)
            if (failure !== null) {
                upload.stop = failure
                throw failure
            }
        }
        let built: BuiltCommit
        try {
            built = await request.build({ mint, seq: opened.markerKey.seq + 1, now: env.now(), put })
        } catch (error) {
            if (error instanceof StreamedPutStop) {
                return { status: 'abandoned', reason: 'upload-failed', cleared: await clearOwnMarker(opened.prefix), cause: error.cause }
            }
            return abortBuild(opened.prefix, error)
        }
        if (upload.stop !== null) {
            // A build that swallowed the stop still never lands: the upload it needs failed.
            return { status: 'abandoned', reason: 'upload-failed', cleared: await clearOwnMarker(opened.prefix), cause: upload.stop.cause }
        }
        const refused = checkStreamedUnits(built, issued, putKeys, request.newUnits)
        if (refused !== null) {
            return { ...refused, cleared: await clearOwnMarker(opened.prefix) }
        }
        return finishBulk(opened, built, request)
    }

    /**
     * The upload and final-write half of a bulk commit: the built units and the manifest (the manifest last), then the
     * re-judge loop whose compare-and-write is the last write.
     */
    async function finishBulk(opened: OpenedMarker, built: BuiltCommit, request: Pick<CommitRequest, 'carry' | 'label' | 'force' | 'keepPrevious'>): Promise<CommitResult> {
        const { markerKey, held, prefix } = opened
        const carry = plannedCarry(request)
        const manifestUnit: UnitWrite = { key: built.manifest.key, bytes: encodeUnit(UNIT_TYPE.manifest, built.manifest.body) }
        try {
            for (const unit of [...built.units, manifestUnit]) {
                // A unit whose flush failed must not be named by the final write: it may not survive power loss.
                const written = await backend.putUnit(unit.key, unit.bytes)
                if (written.flushed === false) {
                    const cause = new Store2BackendFailureError(`The unit ${unit.key} was written but its flush failed or was not reported as done, so the bulk commit was abandoned.`)
                    return { status: 'abandoned', reason: 'upload-failed', cleared: await clearOwnMarker(prefix), cause }
                }
            }
        } catch (error) {
            if (error instanceof Store2BackendError) {
                return { status: 'abandoned', reason: 'upload-failed', cleared: await clearOwnMarker(prefix), cause: error }
            }
            throw new Store2BulkAbortError(error, await clearOwnMarker(prefix))
        }

        // The final write installs `current` and clears the marker in one step; every conflict is judged on a fresh read.
        // A `current` that changed while the marker stood belongs to a peer's ordinary commit; it is force-pushed into
        // `retained` so admission cannot drop a manifest that was installed and never judged by this bulk.
        let heldRead = held
        let heldKey = markerKey
        for (let round = 0; round < REJUDGE_ATTEMPTS; round++) {
            // A peer's commit while the marker stood may have dropped `from`; the garbage collector can then delete what
            // this build carries, so the final write must not land over it.
            if (carry !== null && !namesManifest(heldKey, carry.from)) {
                return { ...refuseUnnamed(request), cleared: await clearOwnMarker(prefix) }
            }
            const now = env.now()
            const next = nextOwnKey(heldKey, {
                current: { key: built.manifest.key, at: now },
                retained: nextRetained(heldKey, now, request.force === true || request.keepPrevious === true || heldKey.current?.key !== markerKey.current?.key),
                staging: null,
                manifests: [built.manifest.body],
            }, env)
            // The descent predicate is judged against this round's held key, so a peer commit under the marker mints.
            withLine(next, heldKey, request.force !== true && carry !== null
                && carry.from === markerKey.current?.key && heldKey.current?.key === markerKey.current?.key)
            if (request.label === 'import') {
                withReplaced(next, 'import')
            }
            const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
            const outcome = await attempt(() => backend.casCommit(heldRead.token, nextBytes))
            let reread: Store2Read
            if (outcome.kind === 'written') {
                return { status: 'committed', value: next, bytes: nextBytes, flushed: outcome.flushed, manifestKey: built.manifest.key, mode: 'bulk' }
            }
            if (outcome.kind === 'failed') {
                return { status: 'abandoned', reason: 'upload-failed', cleared: await clearOwnMarker(prefix), cause: outcome.cause }
            }
            try {
                reread = await backend.readCommit()
            } catch (error) {
                if (error instanceof Store2BackendError) {
                    return outcome.kind === 'unknown' ? { status: 'unknown', cause: outcome.cause } : { status: 'failed', cause: error }
                }
                throw error
            }
            if (outcome.kind === 'unknown') {
                // This owner's manifest as `current` means the lost response was a success: done, and nothing is cleared.
                const classified = classifyCommitRead(reread)
                if (classified.status === 'parsed' && classified.value.current?.key === built.manifest.key) {
                    return { status: 'committed', value: classified.value, bytes: reread.bytes as Uint8Array, flushed: undefined, manifestKey: built.manifest.key, mode: 'bulk' }
                }
            }
            const classified = classifyCommitRead(reread)
            if (classified.status !== 'parsed' || classified.value.staging === null
                || classified.value.staging.owner !== owner || classified.value.staging.prefix !== prefix) {
                return { status: 'abandoned', reason: 'marker-lost', cleared: null }
            }
            heldRead = reread
            heldKey = classified.value
        }
        return { status: 'abandoned', reason: 'rejudge-exhausted', cleared: await clearOwnMarker(prefix) }
    }

    async function abandonClear(read: Store2Read, clearOwner: string, prefix: string): Promise<AbandonResult> {
        let current = read
        for (let round = 0; round < REJUDGE_ATTEMPTS; round++) {
            const parsed = baseOf(current, { needCurrent: false })
            if (parsed.status === 'refused') {
                return parsed
            }
            const staging = parsed.base.key.staging
            if (staging === null) {
                return { status: 'nothing' }
            }
            if (staging.owner !== clearOwner || staging.prefix !== prefix) {
                return refuse('not-mine', 'The marker on the commit key is not this owner\'s with this prefix.')
            }
            const next = nextOwnKey(parsed.base.key, { staging: null }, env)
            const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
            const outcome = await attempt(() => backend.casCommit(current.token, nextBytes))
            if (outcome.kind === 'written') {
                return { status: 'cleared', value: next, bytes: nextBytes }
            }
            if (outcome.kind === 'failed') {
                return { status: 'failed', cause: outcome.cause }
            }
            let reread: Store2Read
            try {
                reread = await backend.readCommit()
            } catch (error) {
                if (error instanceof Store2BackendError) {
                    return outcome.kind === 'unknown' ? { status: 'unknown', cause: outcome.cause } : { status: 'failed', cause: error }
                }
                throw error
            }
            if (outcome.kind === 'unknown' && reread.bytes !== null && sameBytes(reread.bytes, nextBytes)) {
                return { status: 'cleared', value: next, bytes: nextBytes }
            }
            current = reread
        }
        return { status: 'conflict', current }
    }

    return {
        owner,

        ownsEpoch: epoch => ownEpochs.includes(epoch),

        readCommit: () => backend.readCommit(),

        async commit(read, request) {
            plannedCarry(request)
            const parsed = baseOf(read)
            if (parsed.status === 'refused') {
                return parsed
            }
            return request.newUnits > BULK_UNIT_THRESHOLD ? bulk(parsed.base, request) : ordinary(parsed.base, request, request.force === true)
        },

        async commitStreamed(read, request) {
            plannedCarry(request)
            const parsed = baseOf(read)
            if (parsed.status === 'refused') {
                return parsed
            }
            return streamed(parsed.base, request)
        },

        async restore(read, manifestKey) {
            const parsed = baseOf(read)
            if (parsed.status === 'refused') {
                return parsed
            }
            const base = parsed.base
            const shape = parseStore2Key(manifestKey)
            if (shape === null || (shape.shape !== 'manifest' && shape.shape !== 'staged-manifest')) {
                return refuse('bad-manifest-key', `${manifestKey} is not a manifest key.`)
            }
            if (base.key.current?.key === manifestKey) {
                return refuse('already-current', 'The manifest is already current.')
            }
            // Garbage collection keeps exactly current, retained and pinned manifests, and its batches are conditional on
            // the commit key this CAS also compares. A dropped manifest is outside that keep-set, so the tree read below
            // could be followed by its deletion before the CAS; dropped manifests are reachable only through the
            // recovery exits, which write the fence first.
            if (!base.key.retained.some(entry => entry.key === manifestKey) && !base.key.pins.some(pin => pin.key === manifestKey)) {
                return refuse('not-named', `${manifestKey} is neither retained nor pinned.`)
            }
            const tree = await checkTree(backend, manifestKey)
            if (tree.status === 'incomplete') {
                return refuse('tree-incomplete', 'The manifest names a unit that is missing or damaged.', tree.missing)
            }
            const now = env.now()
            const next = nextOwnKey(base.key, {
                current: { key: manifestKey, at: now },
                retained: nextRetained(base.key, now, true, manifestKey),
                manifests: [tree.manifest],
            }, env)
            withLine(next, base.key, false)
            withReplaced(next, 'restore')
            const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
            return settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))
        },

        async saveMine(freshRead, request) {
            plannedCarry(request)
            const parsed = baseOf(freshRead)
            if (parsed.status === 'refused') {
                return parsed
            }
            if (freshRead.token.kind === 'revision') {
                return refuse('node-save-mine', 'Save-mine is not offered on Node; its commit key is compared by revision.')
            }
            const carry = plannedCarry(request)
            if (carry === null || namesManifest(parsed.base.key, carry.from)) {
                return ordinary(parsed.base, request, true)
            }
            // The base dropped the manifest this build was planned over: carrying units from it is refused before any
            // read, so a damaged base manifest cannot turn that refusal into a different one.
            if (carry.units > 0) {
                return refuseUnnamed(request)
            }
            // Nothing is carried, but the planned manifest's legacy keep may no longer be live. The new manifest names the
            // keep of the base it replaces, read under the token the compare-and-write sends.
            const currentKey = parsed.base.key.current?.key
            if (currentKey === undefined) {
                return refuse('no-current', 'The commit key names no current manifest.')
            }
            let baseBytes: Uint8Array | null
            try {
                baseBytes = (await backend.readUnits([currentKey])).get(currentKey) ?? null
            } catch (error) {
                if (error instanceof Store2BackendError) {
                    return { status: 'failed', cause: error }
                }
                throw error
            }
            if (baseBytes === null) {
                return refuse('absent', `The base manifest ${currentKey} is absent.`)
            }
            const baseUnit = readUnit(baseBytes, UNIT_TYPE.manifest)
            switch (baseUnit.status) {
                case 'ok':
                case 'stale':
                    return ordinary(parsed.base, request, true, structuredClone((baseUnit.value.body as Manifest).fixed.legacyKeep))
                case 'too-new':
                    return refuse('too-new', baseUnit.reason)
                case 'damaged':
                case 'unreadable':
                    return refuse('damaged', baseUnit.reason)
            }
        },

        async pin(read, key, reason) {
            const parsed = baseOf(read)
            if (parsed.status === 'refused') {
                return parsed
            }
            const base = parsed.base
            if (base.key.pins.some(pin => pin.key === key)) {
                return refuse('already-pinned', `${key} is already pinned.`)
            }
            if (base.key.current?.key !== key && !base.key.retained.some(entry => entry.key === key)) {
                return refuse('not-named', `${key} is neither current nor retained.`)
            }
            const next = nextOwnKey(base.key, { pins: [...base.key.pins, { key, reason }] }, env)
            const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
            return settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))
        },

        async unpin(read, key) {
            const parsed = baseOf(read)
            if (parsed.status === 'refused') {
                return parsed
            }
            const base = parsed.base
            if (!base.key.pins.some(pin => pin.key === key)) {
                return refuse('not-pinned', `${key} is not pinned.`)
            }
            const next = nextOwnKey(base.key, { pins: base.key.pins.filter(pin => pin.key !== key) }, env)
            const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
            return settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))
        },

        async dropSnapshot(read, expected) {
            const parsed = baseOf(read)
            if (parsed.status === 'refused') {
                return parsed
            }
            const base = parsed.base
            if (base.key.staging !== null) {
                return refuse('staging', 'A marker stands on the commit key.')
            }
            const held = base.key.snapshot
            if (held === undefined) {
                return refuse('no-snapshot', 'The commit key holds no snapshot pointer.')
            }
            if (held.key !== expected.key || held.digest !== expected.digest || held.count !== expected.count) {
                return refuse('snapshot-mismatch', 'The commit key holds another snapshot pointer than the one expected.')
            }
            const next = nextOwnKey(base.key, { dropSnapshot: true }, env)
            const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
            return settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))
        },

        abandonClear,

        async openHeldBulk(read, request) {
            const parsed = baseOf(read)
            if (parsed.status === 'refused') {
                return parsed
            }
            const stagingId = newStagingId(env)
            const prefix = stagingPrefix(stagingId)
            const opened = await openMarker(parsed.base, { carry: IMPORT_REPLACES_BASE, label: request.label }, stagingId)
            switch (opened.status) {
                case 'opened': {
                    const held = {} as HeldBulk
                    heldStates.set(held, { markerKey: opened.markerKey, held: opened.held, prefix, stagingId })
                    return { status: 'opened', held, read: opened.held }
                }
                case 'refused':
                    return opened
                // The marker write may have landed (a read-back that mismatched or failed, an unknown outcome a peer then
                // carried), so the own clear runs here, on a fresh read, and answers `nothing` when none stands.
                case 'conflict':
                    return { status: 'conflict', current: opened.current, cleared: await clearOwnMarker(prefix) }
                case 'failed':
                case 'unknown':
                    return { status: opened.status, cause: opened.cause, cleared: await clearOwnMarker(prefix) }
                default:
                    throw new Error(`The marker write answered ${opened.status}, which it cannot.`)
            }
        },

        async commitHeld(held, read, request) {
            const state = heldStateOf(held)
            if (request.carry !== IMPORT_REPLACES_BASE) {
                plannedCarry(request)
                throw new TypeError('commitHeld accepts only IMPORT_REPLACES_BASE.')
            }
            const classified = classifyCommitRead(read)
            const staging = classified.status === 'parsed' ? classified.value.staging : null
            if (classified.status !== 'parsed' || staging === null || staging.owner !== owner || staging.prefix !== state.prefix) {
                return { status: 'abandoned', reason: 'marker-lost', cleared: null }
            }
            const { mint, issued } = createMint(state.stagingId)
            let built: BuiltCommit
            try {
                built = await request.build({ mint, seq: classified.value.seq + 1, now: env.now() })
            } catch (error) {
                return abortBuild(state.prefix, error)
            }
            const refused = checkBuilt(built, issued, request.newUnits, true)
            if (refused !== null) {
                return { ...refused, cleared: await clearOwnMarker(state.prefix) }
            }
            return finishBulk({ status: 'opened', markerKey: classified.value, held: read, prefix: state.prefix, stagingId: state.stagingId }, built, request)
        },

        clearHeld: (held) => clearOwnMarker(heldStateOf(held).prefix),

        async clearMarker(read) {
            const parsed = baseOf(read, { needCurrent: false })
            if (parsed.status === 'refused') {
                return { decision: { decision: 'none' }, cleared: parsed }
            }
            const decision = await decideClear(owner, parsed.base.key.staging, options.foreignClear ?? null)
            if (decision.decision !== 'clear') {
                return { decision, cleared: null }
            }
            return { decision, cleared: await abandonClear(read, decision.marker.owner, decision.marker.prefix) }
        },
    }
}

import {
    Store2BackendError, Store2BackendFailureError, Store2CommitConflictError, Store2UnknownOutcomeError,
} from './backend/errors'
import {
    BULK_UNIT_THRESHOLD, sameBytes, type Store2Backend, type Store2Read, type Store2WriteResult, type UnitWrite,
} from './backend/types'
import { classifyCommitRead, nextCommitKey, RETAINED_MAX } from './commitKey'
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

export interface Refused {
    status: 'refused'
    reason: Refusal
    detail: string
    /** Keys a restore found missing or damaged. */
    missing?: string[]
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

export interface CommitRequest {
    /** How many new units the commit writes, the manifest included; it decides ordinary or bulk before any key exists. */
    newUnits: number
    /**
     * Builds the commit's units. An ordinary commit trusts this build: every pre-existing unit the new manifest
     * names must be named by a manifest the base commit key names (current, retained or pinned), or garbage
     * collection, whose keep-set is exactly those manifests, may delete it before the compare-and-write lands.
     */
    build(context: BuildContext): BuiltCommit | Promise<BuiltCommit>
    /** The marker label of a bulk commit; `bulk` when absent. */
    label?: StagingLabel
}

export interface CommitterOptions {
    /** The owner id of this page load (`owner.ts`). */
    owner: string
    /** Randomness and the clock; the clock serves retention admission and the stamps only, never safety. */
    env?: KeyEnv
    /** The Q3 question for a foreign marker; absent means a foreign marker is never cleared. */
    foreignClear?: ForeignClearHook
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
const DESCENT: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
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
    /** Reads the commit key as a base. */
    readCommit(): Promise<Store2Read>
    commit(read: Store2Read, request: CommitRequest): Promise<CommitResult>
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

export function createCommitter(backend: Store2Backend, options: CommitterOptions): Committer {
    const env: KeyEnv = { ...defaultKeyEnv, ...options.env }
    const owner = options.owner

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

    async function ordinary(base: Base, request: CommitRequest, force: boolean): Promise<CommitResult> {
        const { mint, issued } = createMint(null)
        const now = env.now()
        const built = await request.build({ mint, seq: base.key.seq + 1, now })
        const refused = checkBuilt(built, issued, request.newUnits, false)
        if (refused !== null) {
            return refused
        }
        const manifestUnit: UnitWrite = { key: built.manifest.key, bytes: encodeUnit(UNIT_TYPE.manifest, built.manifest.body) }
        const next = nextCommitKey(base.key, {
            current: { key: built.manifest.key, at: now },
            retained: nextRetained(base.key, now, force),
            manifests: [built.manifest.body],
        }, env)
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

    async function bulk(base: Base, request: CommitRequest): Promise<CommitResult> {
        if (base.key.staging !== null) {
            return refuse('marker-present', 'A bulk marker already stands on the commit key.')
        }
        const stagingId = newStagingId(env)
        const prefix = stagingPrefix(stagingId)
        const marker: Staging = { owner, prefix, startedAt: env.now(), label: request.label ?? 'bulk' }
        const markerKey = nextCommitKey(base.key, { staging: marker }, env)
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

        const { mint, issued } = createMint(stagingId)
        let built: BuiltCommit
        try {
            built = await request.build({ mint, seq: markerKey.seq + 1, now: env.now() })
        } catch (error) {
            throw new Store2BulkAbortError(error, await clearOwnMarker(prefix))
        }
        const refused = checkBuilt(built, issued, request.newUnits, true)
        if (refused !== null) {
            await clearOwnMarker(prefix)
            return refused
        }
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
            const now = env.now()
            const next = nextCommitKey(heldKey, {
                current: { key: built.manifest.key, at: now },
                retained: nextRetained(heldKey, now, heldKey.current?.key !== markerKey.current?.key),
                staging: null,
                manifests: [built.manifest.body],
            }, env)
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
            const next = nextCommitKey(parsed.base.key, { staging: null }, env)
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

        readCommit: () => backend.readCommit(),

        async commit(read, request) {
            const parsed = baseOf(read)
            if (parsed.status === 'refused') {
                return parsed
            }
            return request.newUnits > BULK_UNIT_THRESHOLD ? bulk(parsed.base, request) : ordinary(parsed.base, request, false)
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
            const next = nextCommitKey(base.key, {
                current: { key: manifestKey, at: now },
                retained: nextRetained(base.key, now, true, manifestKey),
                manifests: [tree.manifest],
            }, env)
            const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
            return settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))
        },

        async saveMine(freshRead, request) {
            const parsed = baseOf(freshRead)
            if (parsed.status === 'refused') {
                return parsed
            }
            if (freshRead.token.kind === 'revision') {
                return refuse('node-save-mine', 'Save-mine is not offered on Node; its commit key is compared by revision.')
            }
            return ordinary(parsed.base, request, true)
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
            const next = nextCommitKey(base.key, { pins: [...base.key.pins, { key, reason }] }, env)
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
            const next = nextCommitKey(base.key, { pins: base.key.pins.filter(pin => pin.key !== key) }, env)
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
            const next = nextCommitKey(base.key, { dropSnapshot: true }, env)
            const nextBytes = encodeUnit(UNIT_TYPE.commit, next)
            return settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))
        },

        abandonClear,

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

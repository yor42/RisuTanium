import { BLOCKS_PREFIX, HEAD_KEY, PRE_BLOCKS_PREFIX } from '../../blockKeys'
import type { AppStoreKind } from '../../store/appStore'
import type { ByteStore } from '../../store/contract'
import { StoreInvalidKeyError } from '../../store/errors'
import { yieldToEventLoop } from '../../saveYield'
import type { Store2Backend } from '../backend'
import type { GateRefusal } from '../boot'
import { unitDigest } from '../codec/reuse'
import type { Committer, Refusal } from '../commit'
import { classifyCommitRead } from '../commitKey'
import { readFenceVerdict } from '../fence'
import { isOldDataKey, readUnit, snapshotCountMatches, UNIT_TYPE, type DeletionSnapshot, type SnapshotPointer } from '../format'
import type { Store2Session } from '../session'
import { observeUpstream, upstreamMatches } from './plan'

/**
 * The old-data deletion: after a conversion or a seed, removes the old fork-format keys the deletion snapshot names, then
 * drops the pointer to it. It is the one place the cutover deletes anything, and every rule says the same thing: a key
 * that is not proven deletable is kept, and every failure ends in "nothing more deleted, pointer kept".
 *
 * - The list is the snapshot unit the commit key points at, never a fresh listing. The unit is used only when it is
 *   present, matches the pointer's digest, reads as a type 24 body, holds as many keys as the pointer counts, and every
 *   key is inside the allowlist (`isOldDataKey`). The Node and IndexedDB stores refuse no such delete themselves, so the
 *   allowlist here is the defence, and it is checked again by this pass whatever the parser accepted.
 * - The phases are separate sequences of `deleteMany` calls, never mixed in one call, in this order: `coldstorage/`,
 *   `database/database.pre-blocks*`, `blocks/` without the head, the head alone. A store that goes on after a failed key
 *   (IndexedDB, Tauri) therefore cannot remove a later phase's key after an earlier phase's key failed, and any failure
 *   ends the run before the next phase.
 * - A plan that lists `coldstorage/` keys was made against the upstream files the store held then. Before the first such
 *   batch the pass observes them again; any difference abandons those keys for good (space only) while the later
 *   phases still run.
 * - Between batches the pass re-reads the commit key and the fence and goes on only while the commit key parses, no marker
 *   stands, no fence exists and the pointer is the one in hand. A peer's ordinary commit changes none of that. One
 *   batch that is already in flight can finish after a fence lands.
 * - The trigger is the pointer, never the head: a pass interrupted after the head went resumes, finds every key absent,
 *   and drops the pointer.
 */

/** The pass's view of the page: its kind, its protocol handles and the deleter gate. */
export type OldDataSession = Pick<Store2Session, 'kind' | 'backend' | 'committer' | 'openGate'>

export interface OldDataDeletionDeps {
    /** The page's byte store: the persisted legacy keys live in it, and the protocol backend refuses them. */
    store: ByteStore
    /** The numbered backups, newest first, without pruning anything. */
    listBackupTimes: () => Promise<number[]>
    /** One turn to the event loop between batches. */
    yieldTurn?: () => Promise<void>
    /** Awaited before every `deleteMany` after the first of the run, so a server with a request budget is not driven at full speed; none by default. */
    pace?: () => Promise<void>
    /** Where the one warning of an unusable snapshot or a failed store goes. */
    warn?: (message: string) => void
    /** Production callers never pass this; it replaces only the type 24 parse (digest, count, allowlist and duplicate checks still run). */
    decodeForTests?: (bytes: Uint8Array) => DeletionSnapshot | null
}

/** Why the pass kept the snapshot and deleted nothing. */
export type SnapshotUnusable = 'absent' | 'digest-mismatch' | 'not-a-snapshot' | 'count-mismatch' | 'duplicate-key' | 'outside-allowlist'

/** Why the pass stopped with the pointer kept. */
export type StopReason = 'unit-read-failed' | 'commit-unreadable' | 'marker' | 'fence' | 'pointer-changed' | 'store-failed' | 'drop-failed'

export type OldDataDeletionResult =
    | { status: 'gate-refused', reason: GateRefusal }
    | { status: 'no-pointer' }
    | { status: 'kept', reason: SnapshotUnusable }
    | { status: 'stopped', reason: StopReason, deleted: number }
    /** Every key is gone or abandoned and the pointer was dropped. `abandoned` counts keys the pass left in place for good. */
    | { status: 'completed', deleted: number, abandoned: number, flushed: boolean | undefined }
    /** Every key is gone or abandoned, but the drop was refused (a peer already dropped or replaced the pointer): nothing more to do. */
    | { status: 'ended', reason: Refusal, deleted: number, abandoned: number }

const COLD_PREFIX = 'coldstorage/'
const DROP_ATTEMPTS = 3

/**
 * The least wait between two removal batches on a Node server: at most 10 batch requests a second, about 3% of the
 * server's storage request budget of 20,000 a minute, so a long deletion leaves the page's own saves their share.
 */
export const NODE_BATCH_PACE_MS = 100

/**
 * The pause a collector or deleter takes between removal batches on a store of `kind`: the Node floor on a server
 * with a request budget, one event-loop turn elsewhere (no network there). `sleep` replaces the timer, for tests.
 */
export function batchPaceOf(kind: AppStoreKind, sleep: (ms: number) => Promise<void> = defaultSleep): () => Promise<void> {
    return kind === 'node' ? () => sleep(NODE_BATCH_PACE_MS) : yieldToEventLoop
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
}

type Phase = 'coldstorage' | 'pre-blocks' | 'blocks' | 'head'

const PHASE_ORDER: readonly Phase[] = ['coldstorage', 'pre-blocks', 'blocks', 'head']

/** The phase an allowlisted key belongs to. */
function phaseOf(key: string): Phase {
    if (key === HEAD_KEY) {
        return 'head'
    }
    if (key.startsWith(COLD_PREFIX)) {
        return 'coldstorage'
    }
    if (key.startsWith(PRE_BLOCKS_PREFIX)) {
        return 'pre-blocks'
    }
    if (key.startsWith(BLOCKS_PREFIX)) {
        return 'blocks'
    }
    throw new RangeError(`${key} is in no phase of the old-data deletion.`)
}

/** Keys per `deleteMany` call: the Node server's per-request limit, an IndexedDB batch, and a Tauri batch of per-key calls. */
function batchSizeOf(kind: AppStoreKind): number {
    return kind === 'indexeddb' ? 100 : 20
}

function decodeSnapshot(bytes: Uint8Array): DeletionSnapshot | null {
    const unit = readUnit(bytes, UNIT_TYPE.deletionSnapshot)
    return unit.status === 'ok' ? unit.value.body as DeletionSnapshot : null
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** The first reason the snapshot cannot be used, or `null`. */
function unusableReason(snapshot: DeletionSnapshot): SnapshotUnusable | null {
    const seen = new Set<string>()
    for (const key of snapshot.keys) {
        if (!isOldDataKey(key)) {
            return 'outside-allowlist'
        }
        if (seen.has(key)) {
            return 'duplicate-key'
        }
        seen.add(key)
    }
    return null
}

/**
 * Runs one old-data deletion pass. Resolves with what came of it; a store failure is a `stopped` result, never a throw.
 * The pointer is dropped only when every listed key is removed, already absent or abandoned, in one compare-and-write
 * that names the pointer the pass worked from.
 */
export async function runOldDataDeletion(session: OldDataSession, deps: OldDataDeletionDeps): Promise<OldDataDeletionResult> {
    if (session.backend === null || session.committer === null) {
        return { status: 'gate-refused', reason: 'idle' }
    }
    const backend: Store2Backend = session.backend
    const committer: Committer = session.committer
    const gate = await session.openGate('cutover')
    if (gate.status === 'refused') {
        return { status: 'gate-refused', reason: gate.reason }
    }
    if (gate.commit.snapshot === undefined) {
        return { status: 'no-pointer' }
    }
    const pointer: SnapshotPointer = gate.commit.snapshot
    const warn = deps.warn ?? ((message: string) => console.warn(message))
    const yieldTurn = deps.yieldTurn ?? yieldToEventLoop
    const decode = deps.decodeForTests ?? decodeSnapshot

    function kept(reason: SnapshotUnusable): OldDataDeletionResult {
        warn(`The old-data deletion kept its snapshot and deleted nothing: ${reason}.`)
        return { status: 'kept', reason }
    }

    let bytes: Uint8Array | null
    try {
        bytes = (await backend.readUnits([pointer.key])).get(pointer.key) ?? null
    } catch (error) {
        warn(`The old-data deletion could not read its snapshot: ${messageOf(error)}`)
        return { status: 'stopped', reason: 'unit-read-failed', deleted: 0 }
    }
    if (bytes === null) {
        return kept('absent')
    }
    if (unitDigest(bytes) !== pointer.digest) {
        return kept('digest-mismatch')
    }
    const snapshot = decode(bytes)
    if (snapshot === null) {
        return kept('not-a-snapshot')
    }
    if (!snapshotCountMatches(pointer, snapshot)) {
        return kept('count-mismatch')
    }
    const refusal = unusableReason(snapshot)
    if (refusal !== null) {
        return kept(refusal)
    }

    const byPhase = new Map<Phase, string[]>(PHASE_ORDER.map(phase => [phase, []]))
    for (const key of snapshot.keys) {
        byPhase.get(phaseOf(key))?.push(key)
    }

    let deleted = 0
    let abandoned = 0
    let refusedKeyWarned = false
    /** `deleteMany` calls started in this run, across the phases. */
    let requestsSent = 0

    function stopped(reason: StopReason): OldDataDeletionResult {
        return { status: 'stopped', reason, deleted }
    }

    /** `null` while the commit key and the fence still allow the pass, otherwise why it must stop. */
    async function allowed(): Promise<StopReason | null> {
        let parsed
        try {
            parsed = classifyCommitRead(await backend.readCommit())
        } catch {
            return 'commit-unreadable'
        }
        if (parsed.status !== 'parsed' || parsed.value.current === null) {
            return 'commit-unreadable'
        }
        if (parsed.value.staging !== null) {
            return 'marker'
        }
        const held = parsed.value.snapshot
        if (held === undefined || held.key !== pointer.key || held.digest !== pointer.digest || held.count !== pointer.count) {
            return 'pointer-changed'
        }
        const fence = await readFenceVerdict(backend)
        return fence.state === 'absent' ? null : 'fence'
    }

    /** Deletes `keys` in batches; `null` when all went, otherwise the result that ends the run. */
    async function deleteAll(keys: readonly string[]): Promise<OldDataDeletionResult | null> {
        let rest = keys
        const size = batchSizeOf(session.kind)
        while (rest.length > 0) {
            const batch = rest.slice(0, size)
            await yieldTurn()
            if (requestsSent > 0 && deps.pace !== undefined) {
                await deps.pace()
            }
            let verdict: StopReason | null
            try {
                verdict = await allowed()
            } catch (error) {
                warn(`The old-data deletion could not re-check the commit key: ${messageOf(error)}`)
                return stopped('commit-unreadable')
            }
            if (verdict !== null) {
                return stopped(verdict)
            }
            requestsSent++
            try {
                await deps.store.deleteMany(batch.map(key => ({ key, condition: 'unconditional' as const })))
            } catch (error) {
                if (error instanceof StoreInvalidKeyError && rest.includes(error.key)) {
                    // The store refused the key before any I/O: nothing was applied, and the key can never be deleted here.
                    if (!refusedKeyWarned) {
                        refusedKeyWarned = true
                        warn(`The old-data deletion skips a key the store cannot address: ${error.key}`)
                    }
                    abandoned++
                    rest = rest.filter(key => key !== error.key)
                    continue
                }
                warn(`The old-data deletion stopped on a store failure: ${messageOf(error)}`)
                return stopped('store-failed')
            }
            deleted += batch.length
            rest = rest.slice(batch.length)
        }
        return null
    }

    for (const phase of PHASE_ORDER) {
        const keys = byPhase.get(phase) ?? []
        if (keys.length === 0) {
            continue
        }
        if (phase === 'coldstorage') {
            const seen = await observeUpstream(deps)
            if (snapshot.kind === 'fork-format-only' || !upstreamMatches(snapshot.upstream, seen)) {
                // Plans of this kind list no cold unit, and a changed store may hold an upstream file that references one.
                abandoned += keys.length
                continue
            }
        }
        const ended = await deleteAll(keys)
        if (ended !== null) {
            return ended
        }
    }

    for (let attempt = 0; attempt < DROP_ATTEMPTS; attempt++) {
        let result
        try {
            result = await committer.dropSnapshot(await committer.readCommit(), pointer)
        } catch (error) {
            warn(`The old-data deletion could not drop its pointer: ${messageOf(error)}`)
            return stopped('drop-failed')
        }
        switch (result.status) {
            case 'committed':
                return { status: 'completed', deleted, abandoned, flushed: result.flushed }
            case 'refused':
                return { status: 'ended', reason: result.reason, deleted, abandoned }
            case 'failed':
                return stopped('drop-failed')
            case 'conflict':
            case 'unknown':
                // A lost response may have landed: the next read shows no pointer, which ends the pass, or the same pointer, which is dropped again.
                break
        }
    }
    return stopped('drop-failed')
}

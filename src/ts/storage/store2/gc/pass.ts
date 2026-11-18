import type { AppStoreKind } from '../../store/appStore'
import type { GuardedCapabilities } from '../../store/contract'
import {
    REMOVE_BATCH_MAX, Store2BackendError, Store2CommitConflictError, Store2FenceConflictError, Store2UnitConflictError,
    Store2UnknownOutcomeError, type CompareToken, type Store2Backend, type Store2Read,
} from '../backend'
import { evaluateDeleterGate, type GateRefusal } from '../boot'
import { classifyCommitRead } from '../commitKey'
import { readFenceVerdict } from '../fence'
import { markLiveKeys } from './mark'

/**
 * One garbage-collection pass: deletes the store2 units that no manifest the
 * commit key names (and no fence) keeps alive. A pure library function; it has no
 * notice, trigger or setting.
 *
 * One read of the commit key (R) decides everything: the mark walks R's trees, the
 * gate is evaluated on R, and every batch carries R's token. A commit that lands
 * after R therefore conflicts the next batch instead of being judged by a mark
 * that never saw it. The fence is read after the mark and before the listing, so
 * a fence that appears later is caught by the batch's fence token and one already
 * standing protects its keys.
 */

export type GcRefusal =
    | GateRefusal | 'capability-missing' | 'mark-refused' | 'list-failed'
    /** Another tab may be alive (or this tab's own presence is not proven), so nothing is deleted. */
    | 'other-tab'
    /** The host cannot prove that this tab is alone. */
    | 'no-web-locks'
    /** The commit key's current is not the manifest this page last acknowledged, so its base may predate the mark. */
    | 'stale-base'

/** The answer of the sole-tab proof: this page alone, another tab or an unproven own presence, or no way to ask. */
export type GcPeerAnswer = 'alone' | 'others' | 'unsupported'

/** The sole-tab proof, asked fresh each time and never cached. */
export type GcPeers = () => Promise<GcPeerAnswer>

export type GcStopReason =
    | 'commit-conflict'
    | 'fence-conflict'
    | 'unit-conflict'
    | 'backend-failure'
    /** A batch's outcome is unknown: the pass ends and nothing further is attempted. */
    | 'unknown-outcome'
    /** The caller's `shouldStop` turned true; every batch applied so far is whole. */
    | 'yielded'
    /** The sole-tab proof failed after earlier deletions (a rebuild round or between batches); every applied batch is whole. */
    | 'other-tab'
    /** The rebuild round after earlier deletions was refused; the done result's refusal says why. */
    | 'refused'

export type GcResult =
    | { status: 'refused', reason: GcRefusal, detail: string }
    | {
        status: 'done'
        /** Keys in batches that were applied (an unknown batch is not counted). */
        deleted: number
        batches: number
        stopped?: GcStopReason
        /** After an unknown outcome: whether the commit key read back differs from R. */
        commitMoved?: boolean
        /** With stopped: 'refused': the refusal of the rebuild round. */
        refusal?: { reason: GcRefusal, detail: string }
    }

export interface GcDeps {
    backend: Store2Backend
    kind: AppStoreKind
    /** Read live before each pass attempt: why every deleter is idle, or `null`. */
    idleReason: () => string | null
    /** The guarded store's capability probe; required on Node. */
    probe?: () => Promise<GuardedCapabilities>
    /** Awaited between batches; none by default. */
    pace?: () => Promise<void>
    /**
     * Asked at the start of each round and before every batch, the first included; `true` ends the pass with
     * `stopped: 'yielded'` and the counts so far. Nothing is retried: every applied batch is whole.
     */
    shouldStop?: () => boolean
    /**
     * The web sole-tab proof; absent where the host needs none (the app runs one page). Asked at the start of each round
     * before any store2 read, and before every batch, after the pace and immediately before `shouldStop`: `removeBatch`
     * runs only on an `'alone'` answer given after the previous batch (or the mark). `'unsupported'` refuses in the first
     * round, `'others'` refuses there too, and either one ends a later round or a batch loop as `stopped: 'other-tab'`.
     */
    peers?: GcPeers
    /**
     * The manifest key this page last acknowledged, or `null` when none is settled; present only where `peers` is. In
     * every round the commit key's current must equal it, so a page whose base predates a peer's commit (or whose encoder
     * took a peer's tree) deletes nothing: the mark would not contain what the page can still read.
     */
    ownBase?: () => string | null
}

type Attempt =
    | { status: 'refused', reason: GcRefusal, detail: string }
    | { status: 'rebuild', deleted: number, batches: number }
    | { status: 'done', deleted: number, batches: number, stopped?: GcStopReason, commitMoved?: boolean }

async function probeNode(deps: GcDeps): Promise<{ reason: string } | null> {
    if (deps.probe === undefined) {
        return { reason: 'The Node server\'s capabilities cannot be probed.' }
    }
    try {
        const caps = await deps.probe()
        if (!caps.checkOnly || !caps.retire) {
            return { reason: 'The Node server lacks check-only or retire.' }
        }
    } catch (error) {
        return { reason: error instanceof Error ? error.message : 'The capability probe failed.' }
    }
    return null
}

/** What a failed sole-tab proof ends the round with: a refusal in the first round, a stop once something was deleted. */
function peerEnd(answer: GcPeerAnswer, round: number): Attempt | null {
    if (answer === 'alone') {
        return null
    }
    if (round > 0) {
        return { status: 'done', deleted: 0, batches: 0, stopped: 'other-tab' }
    }
    return answer === 'unsupported'
        ? { status: 'refused', reason: 'no-web-locks', detail: 'This host cannot prove that no other tab is open.' }
        : { status: 'refused', reason: 'other-tab', detail: 'Another tab may be open, or this tab\'s own presence is not held.' }
}

async function attemptPass(deps: GcDeps, round: number): Promise<Attempt> {
    const { backend } = deps
    if (deps.peers !== undefined) {
        const ended = peerEnd(await deps.peers(), round)
        if (ended !== null) {
            return ended
        }
    }
    let commitRead: Store2Read
    try {
        commitRead = await backend.readCommit()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'refused', reason: 'commit-unreadable', detail: error.message }
        }
        throw error
    }

    if (deps.ownBase !== undefined) {
        const classified = classifyCommitRead(commitRead)
        // An unparsed key or a key with no current falls through to the gate, which refuses it.
        if (classified.status === 'parsed' && classified.value.current !== null && classified.value.current.key !== deps.ownBase()) {
            return { status: 'refused', reason: 'stale-base', detail: 'The commit key names a manifest this page has not acknowledged.' }
        }
    }

    const mark = await markLiveKeys(backend, commitRead)
    if (mark.status === 'refused') {
        // A refused mark can carry an all-ok or empty closure, so the gate never sees it.
        return { status: 'refused', reason: 'mark-refused', detail: `${mark.reason}: ${mark.detail}` }
    }

    const fence = await readFenceVerdict(backend)
    const gate = evaluateDeleterGate({ deleter: 'gc', commit: commitRead, fence, idleReason: deps.idleReason(), closure: mark.closure })
    if (gate.status === 'refused') {
        return gate
    }

    let listed: string[]
    try {
        listed = await backend.listStore2()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'refused', reason: 'list-failed', detail: error.message }
        }
        throw error
    }
    const standing = gate.commit.staging === null ? null : gate.commit.staging.prefix
    const candidates = listed.filter(key =>
        !mark.live.has(key) && !gate.liveKeys.has(key) && (standing === null || !key.startsWith(standing)))

    let deleted = 0
    let batches = 0
    for (let at = 0; at < candidates.length; at += REMOVE_BATCH_MAX) {
        if (batches > 0 && deps.pace !== undefined) {
            await deps.pace()
        }
        if (deps.peers !== undefined && await deps.peers() !== 'alone') {
            return { status: 'done', deleted, batches, stopped: 'other-tab' }
        }
        // No await sits between this check and `removeBatch`, so the proof and the stop rule both hold at the delete.
        if (deps.shouldStop?.() === true) {
            return { status: 'done', deleted, batches, stopped: 'yielded' }
        }
        const batch = candidates.slice(at, at + REMOVE_BATCH_MAX)
        try {
            await backend.removeBatch(batch, gate.commitToken, gate.fenceToken)
        } catch (error) {
            if (error instanceof Store2CommitConflictError) {
                return { status: 'rebuild', deleted, batches }
            }
            if (error instanceof Store2FenceConflictError) {
                return { status: 'done', deleted, batches, stopped: 'fence-conflict' }
            }
            if (error instanceof Store2UnitConflictError) {
                return { status: 'done', deleted, batches, stopped: 'unit-conflict' }
            }
            if (error instanceof Store2UnknownOutcomeError) {
                // Read the commit key back before reporting; the pass never retries the batch.
                let commitMoved: boolean | undefined
                try {
                    const again = await backend.readCommit()
                    commitMoved = !sameToken(again.token, commitRead.token)
                } catch (readError) {
                    if (!(readError instanceof Store2BackendError)) {
                        throw readError
                    }
                }
                return { status: 'done', deleted, batches, stopped: 'unknown-outcome', commitMoved }
            }
            if (error instanceof Store2BackendError) {
                return { status: 'done', deleted, batches, stopped: 'backend-failure' }
            }
            throw error
        }
        deleted += batch.length
        batches++
    }
    return { status: 'done', deleted, batches }
}

function sameToken(a: CompareToken, b: CompareToken): boolean {
    if (a.kind === 'revision') {
        return b.kind === 'revision' && a.revision === b.revision
    }
    if (b.kind !== 'bytes') {
        return false
    }
    const x = a.bytes
    const y = b.bytes
    if (x === null || y === null) {
        return x === y
    }
    return x.length === y.length && x.every((byte, index) => byte === y[index])
}

export async function gcPass(deps: GcDeps): Promise<GcResult> {
    if (deps.kind === 'node') {
        const missing = await probeNode(deps)
        if (missing !== null) {
            return { status: 'refused', reason: 'capability-missing', detail: missing.reason }
        }
    }
    let deleted = 0
    let batches = 0
    for (let round = 0; round < 2; round++) {
        if (deps.shouldStop?.() === true) {
            return { status: 'done', deleted, batches, stopped: 'yielded' }
        }
        const result = await attemptPass(deps, round)
        if (result.status === 'refused') {
            return deleted === 0 && batches === 0
                ? result
                : { status: 'done', deleted, batches, stopped: 'refused', refusal: { reason: result.reason, detail: result.detail } }
        }
        if (result.status === 'done') {
            return { ...result, deleted: deleted + result.deleted, batches: batches + result.batches }
        }
        // A commit landed under the pass: rebuild once from a fresh read.
        deleted += result.deleted
        batches += result.batches
    }
    return { status: 'done', deleted, batches, stopped: 'commit-conflict' }
}

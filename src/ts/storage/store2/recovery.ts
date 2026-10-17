import { Store2BackendError, Store2CommitConflictError, Store2UnknownOutcomeError } from './backend/errors'
import { sameBytes, type Store2Backend, type Store2Read } from './backend/types'
import { classifyCommitRead, firstCommitKey, nextCommitKey, type CommitRead } from './commitKey'
import { fenceExit, type FenceExitResult } from './fence'
import {
    defaultKeyEnv, encodeUnit, newStagingId, orderRecoveryCandidates, stagingPrefix, UNIT_TYPE,
    type CommitKey, type KeyEnv, type StagingLabel,
} from './format'
import { decideClear, type ForeignClearHook, type Staging } from './owner'

/**
 * The recovery screen's decisions and its exit protocol (plan 3.4b, 3.4c, 4.6).
 * Candidates and offers are pure values over a listing and a read. `runExit` is
 * the only way to write a recovery marker: it writes or extends the fence first
 * (`fenceExit`, steps 1 to 3) and compare-and-writes the marker (step 4) only
 * after the fence reports `written`, so a marker before the fence cannot be
 * expressed through this API. It never deletes a unit and never writes the
 * fence after step 3. What follows the marker (validation of a pick, staged
 * re-write, the final commit-key write) belongs to the caller.
 */

// ---- Candidates ----

/** How many candidates the screen shows before "show older". */
export const CANDIDATE_PAGE_SIZE = 50

/**
 * The manifests the screen may offer, newest first by the key's time digits and
 * decided by form alone, without reading any body: ordinary manifests and staged
 * manifests, minus every key under the standing `staging.prefix` of a parsed
 * commit key (an unfinished stage is not a candidate). With an absent, damaged
 * or too-new commit key no prefix is known and nothing is excluded; the tree
 * read validates a pick.
 */
export function recoveryCandidates(listing: readonly string[], commit: CommitRead): string[] {
    const standing = commit.status === 'parsed' && commit.value.staging !== null ? commit.value.staging.prefix : null
    return orderRecoveryCandidates(listing, standing)
}

export interface CandidatePage {
    keys: string[]
    /** The offset to ask for next, or null when nothing older remains. */
    nextOffset: number | null
}

/** One page of `ordered`: the newest `size` from `offset`, with the continuation that shows older ones. */
export function candidatePage(ordered: readonly string[], offset = 0, size = CANDIDATE_PAGE_SIZE): CandidatePage {
    const end = offset + size
    return { keys: ordered.slice(offset, end), nextOffset: end < ordered.length ? end : null }
}

export type CandidateListing =
    | { status: 'listed', candidates: string[] }
    | { status: 'failed', cause: Store2BackendError }

/** Lists `store2/` once and orders the candidates. The listing is the only backend call. */
export async function listRecoveryCandidates(backend: Store2Backend, commit: CommitRead): Promise<CandidateListing> {
    try {
        return { status: 'listed', candidates: recoveryCandidates(await backend.listStore2(), commit) }
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'failed', cause: error }
        }
        throw error
    }
}

// ---- Offers ----

export interface OfferInput {
    /** The state is too new for this build: the screen is read-only and offers nothing. */
    tooNew: boolean
    /** How many candidates the listing holds. */
    candidateCount: number
    /** Whether the upstream main file exists; `null` when that could not be checked. */
    upstreamMainFile: boolean | null
    /** Whether any candidate passed its validation in this session. */
    candidatePassed: boolean
}

export interface ScreenOffers {
    readOnly: boolean
    /** Picking a listed candidate. */
    pick: boolean
    /** (a) re-run the conversion. */
    convert: boolean
    /** (b) import a `.bin`. */
    import: boolean
    /** (c) start a new empty profile, behind its own confirmation. */
    freshStart: boolean
}

/**
 * What the screen offers (G4). A `.bin` import is offered whatever the
 * candidates are, so an upstream backup stays reachable when every candidate
 * fails; the conversion only while an upstream main file exists; a fresh start
 * only until a candidate has passed validation. A too-new state offers nothing.
 */
export function screenOffers(input: OfferInput): ScreenOffers {
    if (input.tooNew) {
        return { readOnly: true, pick: false, convert: false, import: false, freshStart: false }
    }
    return {
        readOnly: false,
        pick: input.candidateCount > 0,
        convert: input.upstreamMainFile === true,
        import: true,
        freshStart: !input.candidatePassed,
    }
}

// ---- Exit ----

/**
 * What the exit is for. Every kind carries the highest `seq` of a manifest this
 * recovery session read (`highestSeqRead`, 0 when it read none); a pick adds the
 * seq of the manifest it picked.
 */
export type ExitRequest =
    | { kind: 'pick', manifestSeq: number, highestSeqRead?: number }
    | { kind: 'convert' | 'import' | 'seed', highestSeqRead?: number }

export type ExitKind = ExitRequest['kind']

const LABELS: Readonly<Record<ExitKind, StagingLabel>> = {
    pick: 'recovery',
    convert: 'convert',
    import: 'import',
    seed: 'seed',
}

export interface ExitOptions {
    /** This page load's owner id (`staging.owner` of the marker). */
    owner: string
    /** Randomness and the clock for the staged prefix, the marker and the fence stamp. */
    env?: KeyEnv
    /** The Q3 question for another owner's standing marker; absent means such a marker is never replaced. */
    foreignClear?: ForeignClearHook | null
}

export type ExitFence = Extract<FenceExitResult, { status: 'written' }>

export type ExitResult =
    /**
     * The fence holds a superset of the listing and the marker stands. `markerRead`
     * is the commit key read back after the write (bytes and token): the compare
     * basis of the caller's final write. `stagedPrefix` is the prefix every unit
     * of the caller's staged re-write goes under.
     */
    | {
        status: 'marked'
        label: StagingLabel
        owner: string
        stagedPrefix: string
        marker: CommitKey
        markerRead: Store2Read
        fence: ExitFence
        flushed: boolean | undefined
    }
    /** The commit key is too new for this build: nothing was written. */
    | { status: 'refused', reason: 'too-new', detail: string }
    /** Another owner's standing marker was left in place: nothing was written. */
    | { status: 'foreign-marker', marker: Staging }
    /** The fence step did not end `written`: no marker was written. The fence result is passed through unchanged. */
    | { status: 'fence', fence: Exclude<FenceExitResult, { status: 'written' }> }
    /** The commit key changed since it was read and holds no `current`: the screen re-runs the exit from step (1). */
    | { status: 'conflict', current: Store2Read }
    /** Another tab recovered meanwhile (the key now parses with a `current`): nothing more is written. */
    | { status: 'abandoned', current: Store2Read, value: CommitKey }
    /** The marker write failed definitely; the commit key was not changed. */
    | { status: 'failed', cause: Store2BackendError }
    /** The marker write's outcome is unknown even after reading back. */
    | { status: 'unknown', cause: Store2BackendError }

/**
 * The marker over `commit`, the read the exit holds.
 *  - parsed: `nextCommitKey` over it (`seq` plus one), the `current`, `retained` and
 *    `pins` emptied and the marker set;
 *  - absent: the first-life key (`seq` 1);
 *  - damaged: no base to increment, so `seq` is one above the highest manifest
 *    `seq` this session read. Across a damaged key `seq` is advisory: conflict
 *    safety comes from the compare-and-write token and the fresh `epoch`, so a
 *    peer must treat any `epoch` change as a peer write.
 */
export function markerKey(commit: CommitRead, staging: Staging, seqFloor: number, env: KeyEnv): CommitKey {
    const change = { current: null, retained: [], pins: [], staging }
    switch (commit.status) {
        case 'parsed':
            return nextCommitKey(commit.value, change, env)
        case 'absent':
            return firstCommitKey(change, env)
        case 'damaged':
            return { ...firstCommitKey(change, env), seq: seqFloor + 1 }
        case 'too-new':
            throw new TypeError('No marker is built over a too-new commit key.')
    }
}

/**
 * One recovery-screen exit over `commitRead`, the screen's read of the commit
 * key (the compare basis of the marker: the parsed key's token, the damaged
 * read's token, or the absence read's token).
 *  1. a too-new key refuses, and another owner's standing marker proceeds only
 *     when `decideClear` with `foreignClear` says yes (own markers proceed);
 *     both are decided before anything is written;
 *  2. `fenceExit` writes or extends the fence, passing the commit key's bytes
 *     verbatim for `priorCommits`;
 *  3. only on `written` the marker is compare-and-written at `commitRead.token`
 *     (`current: null`, empty `retained` and `pins`, a fresh staged prefix);
 *  4. a conflict re-reads: a key that now parses with a `current` abandons the
 *     exit, anything else returns `conflict` for the screen to re-run from the
 *     start (a second exit only extends the fence).
 */
export async function runExit(backend: Store2Backend, commitRead: Store2Read, request: ExitRequest, options: ExitOptions): Promise<ExitResult> {
    const env: KeyEnv = { ...defaultKeyEnv, ...options.env }
    const commit = classifyCommitRead(commitRead)
    if (commit.status === 'too-new') {
        return { status: 'refused', reason: 'too-new', detail: commit.reason }
    }
    if (commit.status === 'parsed') {
        const decision = await decideClear(options.owner, commit.value.staging, options.foreignClear ?? null)
        if (decision.decision === 'leave') {
            return { status: 'foreign-marker', marker: decision.marker }
        }
    }

    const fence = await fenceExit(backend, { damagedCommitBytes: commitRead.bytes, now: env.now })
    if (fence.status !== 'written') {
        return { status: 'fence', fence }
    }

    const label = LABELS[request.kind]
    const stagedPrefix = stagingPrefix(newStagingId(env))
    const staging: Staging = { owner: options.owner, prefix: stagedPrefix, startedAt: env.now(), label }
    const seqFloor = Math.max(request.highestSeqRead ?? 0, request.kind === 'pick' ? request.manifestSeq : 0)
    const marker = markerKey(commit, staging, seqFloor, env)
    const markerBytes = encodeUnit(UNIT_TYPE.commit, marker)

    let flushed: boolean | undefined
    try {
        flushed = (await backend.casCommit(commitRead.token, markerBytes)).flushed
    } catch (error) {
        if (error instanceof Store2CommitConflictError) {
            return judgeConflict(backend)
        }
        if (error instanceof Store2UnknownOutcomeError) {
            return settleUnknown(backend, marker, markerBytes, { label, owner: options.owner, stagedPrefix, fence }, error)
        }
        if (error instanceof Store2BackendError) {
            return { status: 'failed', cause: error }
        }
        throw error
    }
    return confirmMarker(backend, marker, markerBytes, { label, owner: options.owner, stagedPrefix, fence }, flushed)
}

/** What a landed marker carries besides the key reads; `fence` is `ExitFence` after an exit and `undefined` for a first-life marker, which never writes a fence. */
export interface Landed<F = ExitFence> {
    label: StagingLabel
    owner: string
    stagedPrefix: string
    fence: F
}

/** What `confirmMarker` and `settleUnknown` answer: the marker landed with `landed`'s fields, or one of the exit's other outcomes. */
export type MarkerOutcome<F = ExitFence> =
    | (Omit<Extract<ExitResult, { status: 'marked' }>, 'fence'> & { fence: F })
    | Extract<ExitResult, { status: 'conflict' | 'abandoned' | 'unknown' }>

/** After a conflict: another tab's `current` ends this exit; anything else is for the screen to re-run. */
export async function judgeConflict(backend: Store2Backend): Promise<Extract<ExitResult, { status: 'conflict' | 'abandoned' | 'unknown' }>> {
    let current: Store2Read
    try {
        current = await backend.readCommit()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'unknown', cause: error }
        }
        throw error
    }
    const now = classifyCommitRead(current)
    if (now.status === 'parsed' && now.value.current !== null) {
        return { status: 'abandoned', current, value: now.value }
    }
    return { status: 'conflict', current }
}

/** A write whose outcome is unknown is decided by reading the key back: this marker's bytes mean it landed. */
export async function settleUnknown<F>(
    backend: Store2Backend, marker: CommitKey, markerBytes: Uint8Array, landed: Landed<F>, cause: Store2UnknownOutcomeError,
): Promise<MarkerOutcome<F>> {
    let read: Store2Read
    try {
        read = await backend.readCommit()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'unknown', cause }
        }
        throw error
    }
    if (read.bytes !== null && sameBytes(read.bytes, markerBytes)) {
        return { status: 'marked', ...landed, marker, markerRead: read, flushed: undefined }
    }
    return judgeConflict(backend)
}

/** After a successful write: the commit key read back is the marker (a peer's later write is a conflict). */
export async function confirmMarker<F>(
    backend: Store2Backend, marker: CommitKey, markerBytes: Uint8Array, landed: Landed<F>, flushed: boolean | undefined,
): Promise<MarkerOutcome<F>> {
    let read: Store2Read
    try {
        read = await backend.readCommit()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'unknown', cause: error }
        }
        throw error
    }
    if (read.bytes === null || !sameBytes(read.bytes, markerBytes)) {
        return judgeConflict(backend)
    }
    return { status: 'marked', ...landed, marker, markerRead: read, flushed }
}

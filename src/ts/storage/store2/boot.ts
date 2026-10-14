import { Store2BackendError } from './backend/errors'
import type { CompareToken, Store2Backend, Store2Read } from './backend/types'
import type { AbandonResult, Committer } from './commit'
import { classifyCommitRead, type CommitRead } from './commitKey'
import { readFenceVerdict, type FenceVerdict } from './fence'
import type { CommitKey, StagingLabel } from './format'
import { isOwnMarker, type Staging } from './owner'
import type { TreeRead } from './tree'

/**
 * Boot classification (plan 3.4b) and the gate every deleter passes. Both are
 * decisions over values already read: nothing here writes, except `runBootClear`,
 * which is the one start-up clear of a device's own marker and goes through the
 * committer's abandon-clear.
 */

// ---- Is there any store2 key? ----

/**
 * Whether `store2/` holds any unit. `unknown` is a failed listing: the answer is
 * never read as zero, so conversion and seeding stay blocked.
 */
export type Store2Presence =
    | { status: 'none' }
    | { status: 'some', via: 'count' | 'list' }
    | { status: 'unknown', reason: string }

const STORE2_PREFIX = 'store2/'

/**
 * A ranged count above zero is trusted as presence. A zero count is confirmed by
 * the re-filtered `listStore2()`: a count of a server that lists a different set
 * must not authorise a conversion over existing units. A count that is
 * unsupported or fails leaves the listing to decide, and a failed listing is
 * `unknown`.
 */
export async function probeStore2Presence(backend: Store2Backend): Promise<Store2Presence> {
    let counted: number | null = null
    try {
        counted = await backend.countPrefix(STORE2_PREFIX)
    } catch (error) {
        if (!(error instanceof Store2BackendError)) {
            throw error
        }
    }
    if (counted !== null && counted > 0) {
        return { status: 'some', via: 'count' }
    }
    try {
        const listed = await backend.listStore2()
        return listed.length > 0 ? { status: 'some', via: 'list' } : { status: 'none' }
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'unknown', reason: error.message }
        }
        throw error
    }
}

// ---- Boot table ----

export type BootRow = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11

/** Where a too-new finding came from. */
export type TooNewSource = 'commit-key' | 'fence' | 'tree'

/**
 * What boot does.
 *   first-life: no commit key and no unit (row 1): `convert` when an upstream main file exists, otherwise `seed`.
 *   blocked:    boot cannot decide (a failed read or listing); no conversion, seeding or deletion happens.
 *   recovery:   the recovery screen.
 *   read-only:  the page is read-only with a notice (row 3).
 *   normal:     normal boot; the fence limits the deleters, never the boot.
 *   rerun:      row 9. `clear` says what runs first: `own` is the device's own marker (cleared at start-up, then the
 *               operation re-runs in the same boot), `foreign-path` is a marker the foreign-clear path alone may clear.
 */
export type BootDecision =
    | { row: 1, mode: 'first-life', action: 'convert' | 'seed' }
    | { row: 1, mode: 'blocked', reason: 'presence-unknown' | 'main-file-unknown', detail: string }
    | { row: 2, mode: 'recovery' }
    | { row: 3, mode: 'read-only', source: TooNewSource, detail: string }
    | { row: 4, mode: 'recovery', detail: string }
    | { row: 5, mode: 'normal', fence: 'absent' | 'fenced' | 'blocked' }
    | { row: 6, mode: 'recovery', tree: 'missing' | 'damaged', keys: string[] }
    | { row: 7, mode: 'recovery' }
    | { row: 8, mode: 'recovery' }
    | { row: 9, mode: 'rerun', operation: 'seed' | 'convert', clear: 'own' | 'foreign-path' }
    | { row: 10, mode: 'recovery' }
    | { row: 11, mode: 'recovery', label: Extract<StagingLabel, 'import' | 'restore' | 'bulk'> }
    /** The commit key or the tree could not be read at all: not a table row, and never read as absent or damaged. */
    | { row: null, mode: 'blocked', reason: 'commit-unreadable' | 'tree-unreadable' | 'main-file-unknown', detail: string }

export interface BootInput {
    /** `unreadable` is a backend failure while reading the commit key. */
    commit: CommitRead | { status: 'unreadable', reason: string }
    fence: FenceVerdict
    /** Needed when the commit key is absent. */
    presence: Store2Presence | null
    /** The read of `current`'s tree; needed when the commit key parses with a `current`. */
    tree: TreeRead | null
    /** Whether the upstream main file exists; `null` when that could not be checked. */
    upstreamMainFile: boolean | null
    /** This page load's owner id. */
    ownerId: string
    /** Whether the owner id is persisted on this device (Tauri); a web page's id never survives a reload. */
    deviceOwner: boolean
}

function markerRow(staging: Staging, upstreamMainFile: boolean | null, input: BootInput): BootDecision {
    switch (staging.label) {
        case 'seed':
        case 'convert': {
            if (staging.label === 'convert') {
                if (upstreamMainFile === null) {
                    return { row: null, mode: 'blocked', reason: 'main-file-unknown', detail: 'The upstream main file could not be checked.' }
                }
                if (!upstreamMainFile) {
                    return { row: 10, mode: 'recovery' }
                }
            }
            const own = input.deviceOwner && isOwnMarker(input.ownerId, staging)
            return { row: 9, mode: 'rerun', operation: staging.label, clear: own ? 'own' : 'foreign-path' }
        }
        case 'recovery':
            return { row: 8, mode: 'recovery' }
        case 'import':
        case 'restore':
        case 'bulk':
            return { row: 11, mode: 'recovery', label: staging.label }
    }
}

/**
 * The 3.4b row and its action. A too-new commit key or fence is row 3 whatever
 * else is stored; a failed read of the commit key is `blocked`, never a row.
 */
export function classifyBoot(input: BootInput): BootDecision {
    const { commit, fence } = input
    if (commit.status === 'unreadable') {
        return { row: null, mode: 'blocked', reason: 'commit-unreadable', detail: commit.reason }
    }
    if (commit.status === 'too-new') {
        return { row: 3, mode: 'read-only', source: 'commit-key', detail: commit.reason }
    }
    if (fence.state === 'blocked' && fence.reason === 'too-new') {
        return { row: 3, mode: 'read-only', source: 'fence', detail: fence.detail }
    }
    switch (commit.status) {
        case 'absent': {
            if (input.presence === null) {
                throw new TypeError('An absent commit key is classified only with the store2 presence.')
            }
            if (input.presence.status === 'unknown') {
                return { row: 1, mode: 'blocked', reason: 'presence-unknown', detail: input.presence.reason }
            }
            if (input.presence.status === 'some') {
                return { row: 2, mode: 'recovery' }
            }
            if (input.upstreamMainFile === null) {
                return { row: 1, mode: 'blocked', reason: 'main-file-unknown', detail: 'The upstream main file could not be checked.' }
            }
            return { row: 1, mode: 'first-life', action: input.upstreamMainFile ? 'convert' : 'seed' }
        }
        case 'damaged':
            return { row: 4, mode: 'recovery', detail: commit.reason }
        case 'parsed': {
            const key: CommitKey = commit.value
            if (key.current === null) {
                if (key.staging === null) {
                    return { row: 7, mode: 'recovery' }
                }
                return markerRow(key.staging, input.upstreamMainFile, input)
            }
            const tree = input.tree
            if (tree === null) {
                throw new TypeError('A commit key with a current manifest is classified only with its tree read.')
            }
            switch (tree.status) {
                case 'too-new':
                    return { row: 3, mode: 'read-only', source: 'tree', detail: tree.reason }
                case 'unreadable':
                    return { row: null, mode: 'blocked', reason: 'tree-unreadable', detail: tree.cause.message }
                case 'missing':
                case 'damaged':
                    return { row: 6, mode: 'recovery', tree: tree.status, keys: tree.keys }
                case 'ok':
                    return { row: 5, mode: 'normal', fence: fence.state }
            }
        }
    }
}

/** What the start-up clear of a row 9 decision came to; `null` when the decision asks for none. */
export async function runBootClear(
    committer: Pick<Committer, 'abandonClear'>,
    read: Store2Read,
    decision: BootDecision,
    ownerId: string,
): Promise<AbandonResult | null> {
    if (decision.row !== 9 || decision.clear !== 'own') {
        return null
    }
    const parsed = classifyCommitRead(read)
    // Only this page's own marker is cleared here, whatever read the caller holds.
    if (parsed.status !== 'parsed' || parsed.value.staging === null || parsed.value.staging.owner !== ownerId) {
        return null
    }
    // The clear writes back exactly what it read minus `staging`; it never synthesises a `current`.
    return committer.abandonClear(read, parsed.value.staging.owner, parsed.value.staging.prefix)
}

// ---- Deleter gate ----

export type DeleterKind = 'gc' | 'sweep' | 'inlay-cleanup' | 'manual-cleanup'

export type GateRefusal =
    | 'idle'
    | 'commit-unreadable' | 'commit-absent' | 'commit-unparsable' | 'commit-too-new' | 'no-current'
    | 'fence-unreadable' | 'fence-unparsable' | 'fence-too-new'
    | 'fenced'
    | 'staging'
    | 'closure-unreadable'

export interface GateRefused {
    status: 'refused'
    reason: GateRefusal
    detail: string
}

/**
 * A gate that let the pass start. `commit` is what the pass marks from. A batch
 * carries `commitToken` and `fenceToken` into `removeBatch`, which re-checks both
 * atomically. `liveKeys` holds the full keys a parsable fence lists: only a GC
 * pass is ever open under a fence, and it treats those keys as live.
 */
export interface GateOpen {
    status: 'open'
    deleter: DeleterKind
    commit: CommitKey
    commitToken: CompareToken
    fenceToken: CompareToken
    fence: 'absent' | 'fenced'
    liveKeys: ReadonlySet<string>
}

export type GateResult = GateOpen | GateRefused

export interface GateInput {
    deleter: DeleterKind
    /** The commit key read, or `null` when it could not be read. */
    commit: Store2Read | null
    fence: FenceVerdict
    /** A session flag that keeps every deleter idle (a persistent Tauri re-flush failure); the reason, or `null`. */
    idleReason: string | null
    /** The tree reads of every manifest the mark needs; any that is not `ok` aborts the pass. Absent before the mark has run. */
    closure?: readonly TreeRead[]
}

function refuse(reason: GateRefusal, detail: string): GateRefused {
    return { status: 'refused', reason, detail }
}

/**
 * Whether a deleter may start. Every deleter refuses an idle session, an absent,
 * unparsable, too-new or unreadable commit key, a commit key with no `current`,
 * an unparsable, too-new or unreadable fence, and an unreadable closure node. A
 * parsable fence stops the asset sweep, the inlay cleanup and manual cleanup, and
 * leaves a GC pass open with the fence's keys live. A standing `staging` marker of
 * any owner also stops those three, because a bulk writes assets before any list
 * names them; a GC pass stays open and carries the marker's prefix in `commit.staging`.
 */
export function evaluateDeleterGate(input: GateInput): GateResult {
    if (input.idleReason !== null) {
        return refuse('idle', input.idleReason)
    }
    if (input.commit === null) {
        return refuse('commit-unreadable', 'The commit key could not be read.')
    }
    const parsed = classifyCommitRead(input.commit)
    switch (parsed.status) {
        case 'absent':
            return refuse('commit-absent', 'The commit key is absent.')
        case 'damaged':
            return refuse('commit-unparsable', parsed.reason)
        case 'too-new':
            return refuse('commit-too-new', parsed.reason)
        case 'parsed':
            break
    }
    if (parsed.value.current === null) {
        return refuse('no-current', 'The commit key names no current manifest.')
    }
    const fence = input.fence
    if (fence.state === 'blocked') {
        return refuse(fence.reason === 'unreadable' ? 'fence-unreadable' : fence.reason === 'too-new' ? 'fence-too-new' : 'fence-unparsable', fence.detail)
    }
    if (fence.state === 'fenced' && input.deleter !== 'gc') {
        return refuse('fenced', `A fence stands, so ${input.deleter} is suspended.`)
    }
    if (parsed.value.staging !== null && input.deleter !== 'gc') {
        return refuse('staging', `A ${parsed.value.staging.label} marker stands, so ${input.deleter} is suspended.`)
    }
    for (const tree of input.closure ?? []) {
        if (tree.status !== 'ok') {
            return refuse('closure-unreadable', `The tree of ${tree.manifestKey} is ${tree.status}.`)
        }
    }
    return {
        status: 'open',
        deleter: input.deleter,
        commit: parsed.value,
        commitToken: input.commit.token,
        fenceToken: fence.token,
        fence: fence.state,
        liveKeys: fence.state === 'fenced' ? new Set(fence.keys) : new Set(),
    }
}

/** Reads the commit key and the fence and evaluates the gate. A backend failure on either read is a refusal, never an error. */
export async function openDeleterGate(
    backend: Store2Backend,
    deleter: DeleterKind,
    options: { idleReason?: string | null, closure?: readonly TreeRead[] } = {},
): Promise<GateResult> {
    let commit: Store2Read | null = null
    try {
        commit = await backend.readCommit()
    } catch (error) {
        if (!(error instanceof Store2BackendError)) {
            throw error
        }
    }
    return evaluateDeleterGate({
        deleter,
        commit,
        fence: await readFenceVerdict(backend),
        idleReason: options.idleReason ?? null,
        closure: options.closure,
    })
}


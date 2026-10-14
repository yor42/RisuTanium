import { FRAME_FMT, KNOWN_REQ, type CommitKey, type Parsed } from '../format'

/**
 * The preconditions of any asset or inlay deletion, as a pure check over values
 * the caller has read, and the per-batch decision between two reads of the
 * commit-key and fence versions. Any failure refuses: a deleter that cannot
 * establish a fence does not run.
 */

/** The commit key as read: parsed (any status the parser reports) or absent. An I/O failure is `unreadable`. */
export type CommitKeyRead = Parsed<CommitKey> | { status: 'absent' }

/** The fence as read. Anything but `absent` suspends the sweep and the inlay cleanup: a parsable, unparsable, too-new or unreadable fence all refuse. */
export type FenceRead = 'absent' | 'present' | 'unreadable'

export type FenceReason =
    | 'commit-absent'
    | 'commit-damaged'
    | 'commit-too-new'
    | 'commit-unreadable'
    | 'no-current'
    | 'staging'
    | 'fence-present'
    | 'fence-unreadable'
    | 'legacy-file-unreadable'
    | 'tauri-flush-pending'
    | 'bulk-marker-missing'

export interface FenceInput {
    commitKey: CommitKeyRead
    fence: FenceRead
    /** Every legacy file of every manifest the keep-set reads (`legacyFilesOf`). */
    legacyFiles: readonly { key: string, status: 'ok' | 'unreadable' | 'gone' }[]
    /** Tauri: the commit key's last write has not been reported flushed. False on other backends. */
    tauriFlushPending: boolean
    /** Every bulk operation (restore, import) has set its marker before writing its first asset. */
    bulkMarkersSet: boolean
}

export type FenceResult =
    | { status: 'clear' }
    | { status: 'refused', reasons: FenceReason[] }

function commitReasons(read: CommitKeyRead): FenceReason[] {
    switch (read.status) {
        case 'absent':
            return ['commit-absent']
        case 'damaged':
            return ['commit-damaged']
        case 'too-new':
            return ['commit-too-new']
        case 'unreadable':
            return ['commit-unreadable']
        case 'stale':
            return ['commit-unreadable']
        case 'ok': {
            const key = read.value
            const reasons: FenceReason[] = []
            if (key.fmt !== FRAME_FMT || key.req.some(token => !KNOWN_REQ.has(token))) {
                reasons.push('commit-too-new')
            }
            if (key.current === null) {
                reasons.push('no-current')
            }
            if (key.staging !== null) {
                reasons.push('staging')
            }
            return reasons
        }
    }
}

/** Collects every failing precondition so the caller can report all of them; `clear` only when none fails. */
export function checkFences(input: FenceInput): FenceResult {
    const reasons: FenceReason[] = commitReasons(input.commitKey)
    if (input.fence === 'present') {
        reasons.push('fence-present')
    } else if (input.fence === 'unreadable') {
        reasons.push('fence-unreadable')
    }
    if (input.legacyFiles.some(file => file.status === 'unreadable')) {
        reasons.push('legacy-file-unreadable')
    }
    if (input.tauriFlushPending) {
        reasons.push('tauri-flush-pending')
    }
    if (!input.bulkMarkersSet) {
        reasons.push('bulk-marker-missing')
    }
    return reasons.length === 0 ? { status: 'clear' } : { status: 'refused', reasons }
}

/**
 * An opaque version of a key: the Node revision (an absent key that once existed
 * has a revision too), an IndexedDB or Tauri stamp, or null for a key that has
 * never existed. Equal tokens mean the key is unchanged.
 */
export type VersionToken = string | number | null

export interface BatchTokens {
    commitAtStart: VersionToken
    commitNow: VersionToken
    fenceAtStart: VersionToken
    fenceNow: VersionToken
}

export type BatchDecision =
    /** Both keys are unchanged since the pass began: delete this batch. */
    | 'proceed'
    /** The commit key moved: this batch deletes nothing, the keep-set is stale; rebuild it and restart the pass. */
    | 'rebuild'
    /** The fence appeared or changed: this batch deletes nothing and the pass ends; the next pass re-reads the fence. */
    | 'refuse'

/**
 * The per-batch re-check, taken in the same atomic step as the batch. A fence
 * change refuses first: a fence that appeared mid-pass suspends the deleter
 * however the commit key moved.
 */
export function decideBatch(tokens: BatchTokens): BatchDecision {
    if (tokens.fenceNow !== tokens.fenceAtStart) {
        return 'refuse'
    }
    if (tokens.commitNow !== tokens.commitAtStart) {
        return 'rebuild'
    }
    return 'proceed'
}

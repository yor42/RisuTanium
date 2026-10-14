import { Store2BackendError, Store2FenceConflictError } from './backend/errors'
import type { CompareToken, Store2Backend, Store2Read, Store2WriteResult } from './backend/types'
import {
    carryUnknownFields, encodeUnit, KNOWN_FIELDS, keyOfTail, readUnit, tailOfKey, UNIT_TYPE, type FenceRecord,
} from './format'

/**
 * The fence `store2-fence`: what a recovery-screen exit records before it
 * writes its marker, and what every deleter reads before it deletes. This
 * module owns the exit's steps (1) to (3), the readers' verdicts and the
 * discard. It never writes the commit key and never deletes a unit: the exit's
 * marker compare-and-write belongs to the caller, after a `written` result.
 */

export type FenceBlockReason = 'unparsable' | 'too-new' | 'unreadable'

/**
 * A deleter's view of the fence. `absent` is unfenced. `fenced` lists the full
 * store2 keys that count as live; the sweeps refuse while any fence exists.
 * `blocked` means the fence cannot be understood, so every deleter deletes
 * nothing. `token` is what a deleter's per-batch atomic check carries; it is
 * null only when the fence could not be read at all.
 */
export type FenceVerdict =
    | { state: 'absent', token: CompareToken }
    | { state: 'fenced', keys: Set<string>, token: CompareToken }
    | { state: 'blocked', reason: FenceBlockReason, detail: string, token: CompareToken | null }

type FenceBytesClass =
    | { kind: 'absent' }
    | { kind: 'parsed', record: FenceRecord }
    | { kind: 'unparsable', detail: string }
    | { kind: 'too-new', detail: string }

function classifyFenceBytes(bytes: Uint8Array | null): FenceBytesClass {
    if (bytes === null) {
        return { kind: 'absent' }
    }
    const unit = readUnit(bytes, UNIT_TYPE.fenceRecord)
    switch (unit.status) {
        case 'ok':
        case 'stale':
            return { kind: 'parsed', record: unit.value.body as FenceRecord }
        case 'too-new':
        case 'unreadable':
            return { kind: 'too-new', detail: unit.reason }
        case 'damaged':
            return { kind: 'unparsable', detail: unit.reason }
    }
}

/**
 * Reads the fence for a deleter. An unparsable, too-new or unreadable fence is
 * `blocked`: it cannot name its keys, so nothing may be deleted. Only a backend
 * failure is absorbed into `unreadable`; an argument error still throws.
 */
export async function readFenceVerdict(backend: Store2Backend): Promise<FenceVerdict> {
    let read: Store2Read
    try {
        read = await backend.readFence()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { state: 'blocked', reason: 'unreadable', detail: error.message, token: null }
        }
        throw error
    }
    const classified = classifyFenceBytes(read.bytes)
    switch (classified.kind) {
        case 'absent':
            return { state: 'absent', token: read.token }
        case 'parsed':
            return { state: 'fenced', keys: new Set(classified.record.keys.map(keyOfTail)), token: read.token }
        case 'too-new':
            return { state: 'blocked', reason: 'too-new', detail: classified.detail, token: read.token }
        case 'unparsable':
            return { state: 'blocked', reason: 'unparsable', detail: classified.detail, token: read.token }
    }
}

export interface FenceExitOptions {
    /** The damaged commit key's bytes read verbatim, or null when the key was absent or unreadable. */
    damagedCommitBytes: Uint8Array | null
    /** Milliseconds since the epoch; injected for tests. */
    now?: () => number
    /** How many times a fence conflict re-runs the exit from step (1) before it reports `contended`. */
    maxAttempts?: number
}

export type FenceExitResult =
    /** The fence now holds a superset of every key listed. The fence write is as durable as the backend can tell; the caller may write its marker. */
    | {
        status: 'written'
        record: FenceRecord
        bytes: Uint8Array
        /** Tails of every key the fence holds. */
        keys: string[]
        /** True when the replaced fence was unparsable and its bytes are kept in `priorFences`. */
        replacedUnparsable: boolean
        flushed: boolean | undefined
        attempts: number
    }
    /** The fence is written but the backend reports it did not reach stable storage. The caller must not write its marker; running the exit again extends the fence and asks for the flush once more. */
    | { status: 'not-durable', record: FenceRecord, bytes: Uint8Array, attempts: number }
    /** The exit is not offered: nothing was written. */
    | { status: 'not-offered', reason: 'listing-failed' | 'fence-unreadable' | 'fence-too-new', detail: string }
    /** Every attempt met a fence changed by another writer; nothing of this exit was written and the caller must not write its marker. */
    | { status: 'contended', attempts: number }
    /** The fence write failed or its outcome is unknown; the caller must not write its marker; it reports and may run the exit again, which reads the fence first. */
    | { status: 'failed', cause: Store2BackendError, attempts: number }

const DEFAULT_ATTEMPTS = 5

function toBase64Url(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sortedUnion(...lists: readonly (readonly string[])[]): string[] {
    return Array.from(new Set(lists.flat())).sort()
}

/**
 * Steps (1) to (3) of a recovery-screen exit, in this order:
 *  (1) read the fence and keep that read's token as the compare basis;
 *  (2) list `store2/` after that read, so every key the read fence names still
 *      existed at the listing, and a fence change after the read conflicts (3);
 *  (3) create or extend the fence by compare-and-write at the basis: `keys` is
 *      the old keys plus the listing (never fewer), `priorCommits` the old
 *      entries plus the damaged commit key verbatim. Over an unparsable fence
 *      `keys` is the listing alone and the old bytes go into `priorFences`; the
 *      old keys are never read.
 * A fence conflict re-runs from (1). A too-new fence is never replaced: that
 * state is read-only and offers no exit.
 */
export async function fenceExit(backend: Store2Backend, options: FenceExitOptions): Promise<FenceExitResult> {
    const now = options.now ?? Date.now
    const maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let read: Store2Read
        try {
            read = await backend.readFence()
        } catch (error) {
            if (error instanceof Store2BackendError) {
                return { status: 'not-offered', reason: 'fence-unreadable', detail: error.message }
            }
            throw error
        }
        const old = classifyFenceBytes(read.bytes)
        if (old.kind === 'too-new') {
            return { status: 'not-offered', reason: 'fence-too-new', detail: old.detail }
        }

        let listing: string[]
        try {
            listing = await backend.listStore2()
        } catch (error) {
            if (error instanceof Store2BackendError) {
                return { status: 'not-offered', reason: 'listing-failed', detail: error.message }
            }
            throw error
        }
        const listed = listing.map(tailOfKey)

        const at = now()
        const priorCommit = {
            at,
            bytes: options.damagedCommitBytes === null ? null : toBase64Url(options.damagedCommitBytes),
        }
        let record: FenceRecord
        if (old.kind === 'parsed') {
            record = carryUnknownFields(old.record, {
                v: 1,
                at: old.record.at,
                priorCommits: [...old.record.priorCommits.map(entry => ({ ...entry })), priorCommit],
                keys: sortedUnion(old.record.keys, listed),
                ...(old.record.priorFences === undefined ? {} : { priorFences: old.record.priorFences.map(entry => ({ ...entry })) }),
            }, KNOWN_FIELDS.fenceRecord)
        } else {
            record = {
                v: 1,
                at,
                priorCommits: [priorCommit],
                keys: sortedUnion(listed),
                ...(old.kind === 'unparsable' && read.bytes !== null ? { priorFences: [{ at, bytes: toBase64Url(read.bytes) }] } : {}),
            }
        }
        const bytes = encodeUnit(UNIT_TYPE.fenceRecord, record)

        let result: Store2WriteResult
        try {
            result = await backend.casFence(read.token, bytes)
        } catch (error) {
            if (error instanceof Store2FenceConflictError) {
                continue
            }
            if (error instanceof Store2BackendError) {
                return { status: 'failed', cause: error, attempts: attempt }
            }
            throw error
        }
        if (result.flushed === false) {
            return { status: 'not-durable', record, bytes, attempts: attempt }
        }
        return {
            status: 'written',
            record,
            bytes,
            keys: record.keys,
            replacedUnparsable: old.kind === 'unparsable',
            flushed: result.flushed,
            attempts: attempt,
        }
    }
    return { status: 'contended', attempts: maxAttempts }
}

export type FenceDiscardResult =
    | { status: 'discarded', flushed: boolean | undefined }
    /** Another writer changed the fence after the token was read; the caller re-reads and asks again. */
    | { status: 'conflict' }
    | { status: 'failed', cause: Store2BackendError }

/**
 * Deletes the fence by compare-and-delete at `readToken`, the token of the read
 * the user's confirmation was about, whether that fence is parsable or not.
 */
export async function discardFence(backend: Store2Backend, readToken: CompareToken): Promise<FenceDiscardResult> {
    try {
        const result = await backend.casFence(readToken, null)
        return { status: 'discarded', flushed: result.flushed }
    } catch (error) {
        if (error instanceof Store2FenceConflictError) {
            return { status: 'conflict' }
        }
        if (error instanceof Store2BackendError) {
            return { status: 'failed', cause: error }
        }
        throw error
    }
}

import { Store2BackendError, Store2StalePageError } from './backend/errors'
import type { Store2Backend, Store2Read } from './backend/types'
import { baseOf, type Committer, type Refusal, type WriteResult } from './commit'
import { readUnit, UNIT_TYPE, type CommitKey, type Manifest } from './format'

/**
 * The restore points of a store2 profile and the core of restoring one. A pure
 * library over a backend and a committer; nothing here reads a page, a lock or a
 * setting, and nothing but `Committer.restore` ever writes.
 *
 * A restore point is a manifest the commit key names in `retained` or `pins`.
 * `current` is not one: restoring it is refused, so it is returned beside the
 * rows and never among them.
 *
 * Rows are ordered by admission, newest admitted first: the stored `retained`
 * order (a commit pushes the previous `current` to the front), then pinned
 * manifests that are no longer retained, in pin order. The date a row shows is the
 * manifest's own `createdAt`, so a restored manifest that is admitted again can
 * sit next to a neighbour with a newer date; a caller must not re-sort by date.
 */

/** Where a row's `label` time comes from. */
export type LabelSource =
    /** The manifest's `createdAt`. */
    | 'manifest'
    /** The commit key's entry time: the manifest could not be read, or carries no usable `createdAt`. */
    | 'entry'
    /** No time is known: a pinned-only manifest that could not be read. */
    | 'none'

export interface RestorePointRow {
    /** The manifest key; what `restorePoint` takes. */
    key: string
    /** The time to show, in milliseconds, or null when none is known. */
    label: number | null
    labelSource: LabelSource
    /** The pin's reason when the manifest is pinned, else null. A pinned manifest that is also retained is still one row. */
    pinReason: string | null
    /** The manifest is missing or cannot be decoded. The row is still listed; a restore of it is refused by the tree check. */
    damaged: boolean
}

export type RestorePointList =
    | {
        status: 'ok'
        current: { key: string, at: number }
        rows: RestorePointRow[]
    }
    /** The commit key read cannot be a base: absent, damaged, from a newer writer, or naming no `current`. */
    | { status: 'unusable', reason: Refusal, detail: string }
    /** The manifest batch read failed; no partial list is offered. */
    | { status: 'failed', cause: Store2BackendError }

interface Candidate {
    key: string
    entryAt: number | null
    pinReason: string | null
}

function candidatesOf(key: CommitKey): Candidate[] {
    const currentKey = key.current === null ? null : key.current.key
    const pinReasons = new Map(key.pins.map(pin => [pin.key, pin.reason] as const))
    const seen = new Set<string>()
    const list: Candidate[] = []
    for (const entry of key.retained) {
        if (entry.key === currentKey || seen.has(entry.key)) {
            continue
        }
        seen.add(entry.key)
        list.push({ key: entry.key, entryAt: entry.at, pinReason: pinReasons.get(entry.key) ?? null })
    }
    for (const pin of key.pins) {
        if (pin.key === currentKey || seen.has(pin.key)) {
            continue
        }
        seen.add(pin.key)
        list.push({ key: pin.key, entryAt: null, pinReason: pin.reason })
    }
    return list
}

function createdAtOf(bytes: Uint8Array | null): number | null | 'damaged' {
    if (bytes === null) {
        return 'damaged'
    }
    const unit = readUnit(bytes, UNIT_TYPE.manifest)
    if (unit.status !== 'ok' && unit.status !== 'stale') {
        return 'damaged'
    }
    const created = (unit.value.body as Manifest).createdAt
    return typeof created === 'number' && Number.isFinite(created) ? created : null
}

/**
 * The restore points `commitRead` names. The manifests of every row are read in
 * one `readUnits` batch for their dates; a backend failure of that batch is a
 * `failed` result, not a throw, and any other error propagates.
 */
export async function listRestorePoints(backend: Store2Backend, commitRead: Store2Read): Promise<RestorePointList> {
    const parsed = baseOf(commitRead)
    if (parsed.status === 'refused') {
        return { status: 'unusable', reason: parsed.reason, detail: parsed.detail }
    }
    const key = parsed.base.key
    const current = key.current
    if (current === null) {
        return { status: 'unusable', reason: 'no-current', detail: 'The commit key names no current manifest.' }
    }
    const candidates = candidatesOf(key)
    if (candidates.length === 0) {
        return { status: 'ok', current: { ...current }, rows: [] }
    }
    let read: Map<string, Uint8Array | null>
    try {
        read = await backend.readUnits(candidates.map(candidate => candidate.key))
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'failed', cause: error }
        }
        throw error
    }
    const rows = candidates.map((candidate): RestorePointRow => {
        const created = createdAtOf(read.get(candidate.key) ?? null)
        const damaged = created === 'damaged'
        if (typeof created === 'number') {
            return { key: candidate.key, label: created, labelSource: 'manifest', pinReason: candidate.pinReason, damaged }
        }
        return {
            key: candidate.key,
            label: candidate.entryAt,
            labelSource: candidate.entryAt === null ? 'none' : 'entry',
            pinReason: candidate.pinReason,
            damaged,
        }
    })
    return { status: 'ok', current: { ...current }, rows }
}

export type RestoreOutcome =
    /** The commit key now names the point as `current`; the previous `current` is in `retained`. Reload to see it. */
    | { status: 'restored', value: CommitKey, flushed: boolean | undefined }
    /**
     * The point is not retained or pinned (any more). This attempt wrote nothing, but after a `conflict` retry an
     * earlier unconfirmed write of this restore may have landed beneath a peer's; the previous `current` is always kept
     * in `retained`, so no point is lost either way.
     */
    | { status: 'not-named' }
    | { status: 'already-current' }
    /** A bulk marker stands on the commit key; a restore would carry it onto the restored state. Nothing was written. */
    | { status: 'bulk-marker' }
    /** The point names a unit that is missing or damaged. Nothing was written. */
    | { status: 'tree-incomplete', missing: string[] }
    /**
     * A peer wrote the commit key first, twice in a row. The restore may or may not have taken effect (an unconfirmed
     * write whose read-back shows a peer's bytes is reported as a conflict and may have landed beneath it); the previous
     * `current` is always kept in `retained`, so nothing is lost. The caller re-reads to learn what is current.
     */
    | { status: 'conflict' }
    /** The write could not be confirmed either way; the caller must not assume which state is current. */
    | { status: 'unknown', cause: Store2BackendError }
    | { status: 'failed', cause: Store2BackendError }
    /** A newer page owns the store; this page can no longer write. */
    | { status: 'stale-page', cause: Store2BackendError }
    /** Any other refusal: an unusable commit key or a key that is not a manifest key. Nothing was written. */
    | { status: 'refused', reason: Refusal, detail: string }

/** One judged attempt; `retry` is a conflict that left the point still named. */
type Attempt = { outcome: RestoreOutcome } | { retry: true }

function backendOutcome(error: Store2BackendError): RestoreOutcome {
    return error instanceof Store2StalePageError ? { status: 'stale-page', cause: error } : { status: 'failed', cause: error }
}

async function attemptRestore(committer: Committer, backend: Store2Backend, manifestKey: string): Promise<Attempt> {
    let read: Store2Read
    try {
        read = await backend.readCommit()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { outcome: backendOutcome(error) }
        }
        throw error
    }
    const parsed = baseOf(read)
    if (parsed.status === 'refused') {
        return { outcome: { status: 'refused', reason: parsed.reason, detail: parsed.detail } }
    }
    const key = parsed.base.key
    if (key.current?.key === manifestKey) {
        return { outcome: { status: 'already-current' } }
    }
    const named = key.retained.some(entry => entry.key === manifestKey) || key.pins.some(pin => pin.key === manifestKey)
    if (!named) {
        return { outcome: { status: 'not-named' } }
    }
    if (key.staging !== null) {
        return { outcome: { status: 'bulk-marker' } }
    }
    let result: WriteResult
    try {
        result = await committer.restore(read, manifestKey)
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { outcome: backendOutcome(error) }
        }
        throw error
    }
    switch (result.status) {
        case 'committed':
            return { outcome: { status: 'restored', value: result.value, flushed: result.flushed } }
        case 'conflict':
            return { retry: true }
        case 'unknown':
            return { outcome: { status: 'unknown', cause: result.cause } }
        case 'failed':
            return { outcome: backendOutcome(result.cause) }
        case 'refused':
            switch (result.reason) {
                case 'not-named':
                    return { outcome: { status: 'not-named' } }
                case 'already-current':
                    return { outcome: { status: 'already-current' } }
                case 'tree-incomplete':
                    return { outcome: { status: 'tree-incomplete', missing: result.missing ?? [] } }
                default:
                    return { outcome: { status: 'refused', reason: result.reason, detail: result.detail } }
            }
    }
}

/**
 * Restores the named point: one compare-and-write of the commit key through
 * `Committer.restore`, which writes no unit. The decision is made on a fresh read
 * of the commit key, never on the list the caller showed.
 *
 * A point that is not named, a standing bulk marker and a tree that is not whole
 * are refused with nothing written. A conflict (a peer wrote first) is judged once
 * more on a fresh read, and the write is attempted once more only if the point is
 * still named; a second conflict is reported, never looped.
 */
export async function restorePoint(committer: Committer, backend: Store2Backend, manifestKey: string): Promise<RestoreOutcome> {
    const first = await attemptRestore(committer, backend, manifestKey)
    if ('outcome' in first) {
        return first.outcome
    }
    const second = await attemptRestore(committer, backend, manifestKey)
    return 'outcome' in second ? second.outcome : { status: 'conflict' }
}

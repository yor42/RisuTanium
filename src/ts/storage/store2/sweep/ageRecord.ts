import type { SweepRecord } from '../format'
import { NODE_RECORD_CAP, SWEEP_FUTURE_SKEW_MS, SWEEP_MIN_AGE_MS } from './params'
import type { AssetKeepSet } from './types'

/**
 * The age rule of the sweep record (type 22). A candidate is deleted only when
 * a record at least `SWEEP_MIN_AGE_MS` old already named it and a fresh scan
 * names it again; a candidate first seen now is recorded with the current time
 * and never inherits an older one. Pure: the record, the candidates, the clock
 * and the keep-set check are inputs, and the result says what to delete and what
 * record to write next.
 */

/** The record as read. `unreadable` covers a damaged record and an I/O failure; `too-new` a body version above this build's. */
export type RecordRead =
    | { status: 'ok', value: SweepRecord }
    | { status: 'absent' | 'unreadable' | 'too-new' }

export type BackendKind = 'node' | 'indexeddb' | 'tauri'

/** An asset the fresh scan found unreferenced. `rev` is the Node revision observed now, null where none was read or the backend has none. */
export interface AgeCandidate {
    name: string
    rev: number | null
}

export interface AgeInput {
    record: RecordRead
    candidates: readonly AgeCandidate[]
    /** The Node server's `Date` on Node, the device clock elsewhere. */
    now: number
    backend: BackendKind
    /** The complete fresh asset keep-set: a candidate it holds is never deleted. */
    keep: AssetKeepSet
    minAgeMs?: number
    futureSkewMs?: number
    nodeRecordCap?: number
}

/** `ifVersion` is the recorded revision a Node removal must carry; null off Node, where deletion rests on age alone. */
export interface Deletion {
    name: string
    ifVersion: number | null
}

export type AgePhase =
    /** The record is younger than the minimum age: nothing is written or deleted. */
    | 'young'
    /** No usable record: the fresh candidates are recorded and nothing is deleted. */
    | 'recorded'
    /** The record is old enough: the intersection is deleted and the record replaced. */
    | 'swept'

export interface AgeDecision {
    phase: AgePhase
    delete: Deletion[]
    /** The record to write, or null when nothing is written. */
    nextRecord: SweepRecord | null
}

/** The items that may enter the record: on Node only those with a revision, at most the cap; elsewhere all, without revisions. */
function recordItems(
    candidates: readonly AgeCandidate[], backend: BackendKind, cap: number,
): SweepRecord['items'] {
    if (backend === 'node') {
        return candidates
            .filter(candidate => candidate.rev !== null)
            .slice(0, cap)
            .map((candidate): SweepRecord['items'][number] => [candidate.name, candidate.rev])
    }
    return candidates.map((candidate): SweepRecord['items'][number] => [candidate.name, null])
}

export function decideAge(input: AgeInput): AgeDecision {
    const minAge = input.minAgeMs ?? SWEEP_MIN_AGE_MS
    const skew = input.futureSkewMs ?? SWEEP_FUTURE_SKEW_MS
    const cap = input.nodeRecordCap ?? NODE_RECORD_CAP
    const fresh = new Map<string, AgeCandidate>()
    for (const candidate of input.candidates) {
        if (!fresh.has(candidate.name)) {
            fresh.set(candidate.name, candidate)
        }
    }
    const candidates = [...fresh.values()]
    const record = input.record.status === 'ok' ? input.record.value : null

    if (record === null || record.at - input.now > skew) {
        return {
            phase: 'recorded',
            delete: [],
            nextRecord: { v: 1, at: input.now, items: recordItems(candidates, input.backend, cap) },
        }
    }
    if (input.now - record.at < minAge) {
        return { phase: 'young', delete: [], nextRecord: null }
    }

    const deletions: Deletion[] = []
    const deleted = new Set<string>()
    for (const item of record.items) {
        const [name, recordedRev] = item
        const current = fresh.get(name)
        if (current === undefined || deleted.has(name) || input.keep.holds(name)) {
            continue
        }
        if (input.backend === 'node') {
            // A Node item is acted on only through its revision: the one recorded, and still the one on the store.
            if (recordedRev === null || current.rev !== recordedRev) {
                continue
            }
            deletions.push({ name, ifVersion: recordedRev })
        } else {
            deletions.push({ name, ifVersion: null })
        }
        deleted.add(name)
    }
    const remaining = candidates.filter(candidate => !deleted.has(candidate.name))
    return {
        phase: 'swept',
        delete: deletions,
        nextRecord: { v: 1, at: input.now, items: recordItems(remaining, input.backend, cap) },
    }
}

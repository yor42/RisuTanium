import type { SweepRecord } from '../format'
import type { UnitKeepSet } from '../gc/unitAge'
import { NODE_RECORD_CAP, SWEEP_FUTURE_SKEW_MS, SWEEP_MIN_AGE_MS } from './params'
import type { AssetKeepSet } from './types'

/**
 * The age rule of the sweep record (type 22). A candidate is deleted only when
 * a record at least `SWEEP_MIN_AGE_MS` old already named it and a fresh scan
 * names it again; a candidate first seen now is recorded with the current time
 * and never inherits an older one. Pure: the record, the candidates, the clock
 * and the keep-set check are inputs, and the result says what to delete and what
 * record to write next.
 *
 * The aged rule on Node (units, and assets of a Node page) deletes on a third
 * sighting: an item is deleted only when the stored record names it with
 * `SEEN_BEFORE` and it is a candidate again, each sighting at least the minimum
 * age after the previous record in the earlier clock. An asset must also be
 * listed at the revision the record holds: an asset whose revision moved was
 * written or touched since, so it starts again as a first sighting. A record is
 * dated with the later clock.
 */

/** The only third tuple element that marks an item as seen before; every other value reads as a first sighting. */
export const SEEN_BEFORE = 1

/** One sample of the two clocks: the age is judged by `early` and a record is dated `late`. */
export interface AgeClock {
    early: number
    late: number
}

export type AgeVerdict = 'restart' | 'young' | 'old'

/**
 * How old the record is. No usable record, or one dated further ahead of the later clock than `skewMs`, restarts the
 * clock; a record younger than `minAgeMs` by the earlier clock is young.
 */
export function ageOf(record: SweepRecord | null, clock: AgeClock, minAgeMs: number, skewMs: number): AgeVerdict {
    if (record === null || record.at - clock.late > skewMs) {
        return 'restart'
    }
    if (clock.early - record.at < minAgeMs) {
        return 'young'
    }
    return 'old'
}

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

interface AgeInputBase {
    record: RecordRead
    candidates: readonly AgeCandidate[]
    /** The earlier clock: the Node server's `Date` or the page clock, whichever is lower; the device clock elsewhere. It judges the age. */
    now: number
    /** The later clock, which dates the next record; `now` when absent. */
    late?: number
    minAgeMs?: number
    futureSkewMs?: number
}

export interface AssetAgeInput extends AgeInputBase {
    subject?: 'asset'
    backend: BackendKind
    /** The complete fresh asset keep-set: a candidate it holds is never deleted. */
    keep: AssetKeepSet
    nodeRecordCap?: number
}

export interface UnitAgeInput extends AgeInputBase {
    subject: 'unit'
    backend: 'node'
    /** Every key the mark and the gate keep: a candidate it holds is never deleted. Built only from an accepted mark. */
    keep: UnitKeepSet
    /** The cap of each class of the next record, marked and unmarked separately, and of the retires of one pass. */
    nodeRecordCap: number
}

export type AgeInput = AssetAgeInput | UnitAgeInput

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

/** The items that may enter the record off Node: every one, without a revision. */
function recordItems(candidates: readonly AgeCandidate[]): SweepRecord['items'] {
    return candidates.map((candidate): SweepRecord['items'][number] => [candidate.name, null])
}

/** What the sighting rule reads of an input of either subject. */
interface SightingInput extends AgeInputBase {
    keep: { holds(name: string): boolean }
}

/**
 * The rule of a Node page, for units and for assets. The next record holds, marked `SEEN_BEFORE`, the candidates the
 * stored record already named unmarked and, unmarked, every other candidate: a fresh candidate is always recorded
 * unmarked. A candidate is a name that is listed and that the keep-set does not hold, in every class. Each class is capped
 * separately, and so are the deletions; a marked item the deletion cap leaves over restarts unmarked.
 *
 * With `byRevision` (assets) an item is acted on only at the revision it was recorded at and still has on the store: a
 * moved revision, or a candidate or item without one, is recorded unmarked at the listed revision (never, when there is
 * none), and the deletion carries the recorded revision.
 */
function decideSightings(input: SightingInput, cap: number, byRevision: boolean): AgeDecision {
    const minAge = input.minAgeMs ?? SWEEP_MIN_AGE_MS
    const skew = input.futureSkewMs ?? SWEEP_FUTURE_SKEW_MS
    const clock: AgeClock = { early: input.now, late: input.late ?? input.now }
    const record = input.record.status === 'ok' ? input.record.value : null
    const verdict = ageOf(record, clock, minAge, skew)
    if (verdict === 'young') {
        return { phase: 'young', delete: [], nextRecord: null }
    }

    // The first sighting of each name in this scan, with the revision observed now.
    const listed = new Map<string, number | null>()
    for (const candidate of input.candidates) {
        if (!listed.has(candidate.name) && !input.keep.holds(candidate.name)) {
            listed.set(candidate.name, byRevision ? candidate.rev : null)
        }
    }
    const unmarkedOf = (excluded: ReadonlySet<string>): SweepRecord['items'] => [...listed]
        .filter(([name, rev]) => !excluded.has(name) && (!byRevision || rev !== null))
        .slice(0, cap)
        .map(([name, rev]): SweepRecord['items'][number] => [name, rev])
    if (record === null || verdict === 'restart') {
        return { phase: 'recorded', delete: [], nextRecord: { v: 1, at: clock.late, items: unmarkedOf(new Set()) } }
    }

    const stored = new Map<string, { seenBefore: boolean, rev: number | null }>()
    for (const item of record.items) {
        if (!stored.has(item[0])) {
            stored.set(item[0], { seenBefore: item[2] === SEEN_BEFORE, rev: item[1] })
        }
    }
    const deletions: Deletion[] = []
    const marked: SweepRecord['items'] = []
    for (const [name, was] of stored) {
        const rev = listed.get(name)
        if (rev === undefined) {
            continue
        }
        if (byRevision && (was.rev === null || rev !== was.rev)) {
            continue
        }
        if (was.seenBefore) {
            if (deletions.length < cap) {
                deletions.push({ name, ifVersion: byRevision ? was.rev : null })
            }
        } else if (marked.length < cap) {
            marked.push([name, rev, SEEN_BEFORE])
        }
    }
    const taken = new Set([...deletions.map(deletion => deletion.name), ...marked.map(item => item[0])])
    return {
        phase: 'swept',
        delete: deletions,
        nextRecord: { v: 1, at: clock.late, items: [...marked, ...unmarkedOf(taken)] },
    }
}

export function decideAge(input: AgeInput): AgeDecision {
    if (input.subject === 'unit') {
        return decideSightings(input, input.nodeRecordCap, false)
    }
    if (input.backend === 'node') {
        return decideSightings(input, input.nodeRecordCap ?? NODE_RECORD_CAP, true)
    }
    const minAge = input.minAgeMs ?? SWEEP_MIN_AGE_MS
    const skew = input.futureSkewMs ?? SWEEP_FUTURE_SKEW_MS
    const clock: AgeClock = { early: input.now, late: input.late ?? input.now }
    const fresh = new Map<string, AgeCandidate>()
    for (const candidate of input.candidates) {
        if (!fresh.has(candidate.name)) {
            fresh.set(candidate.name, candidate)
        }
    }
    const candidates = [...fresh.values()]
    const record = input.record.status === 'ok' ? input.record.value : null

    const verdict = ageOf(record, clock, minAge, skew)
    if (record === null || verdict === 'restart') {
        return {
            phase: 'recorded',
            delete: [],
            nextRecord: { v: 1, at: clock.late, items: recordItems(candidates) },
        }
    }
    if (verdict === 'young') {
        return { phase: 'young', delete: [], nextRecord: null }
    }

    const deletions: Deletion[] = []
    const deleted = new Set<string>()
    for (const [name] of record.items) {
        if (!fresh.has(name) || deleted.has(name) || input.keep.holds(name)) {
            continue
        }
        deletions.push({ name, ifVersion: null })
        deleted.add(name)
    }
    const remaining = candidates.filter(candidate => !deleted.has(candidate.name))
    return {
        phase: 'swept',
        delete: deletions,
        nextRecord: { v: 1, at: clock.late, items: recordItems(remaining) },
    }
}

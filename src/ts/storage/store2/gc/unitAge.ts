import type { ByteStore, GuardedOperations } from '../../store/contract'
import { ServerLacksCapabilityError, StoreOutcomeUnknownError, StoreVersionConflictError } from '../../store/errors'
import { NodeHttpError } from '../../store/nodeHttpStore'
import type { GateOpen } from '../boot'
import { COMMIT_KEY, FENCE_KEY, encodeUnit, readUnit, UNIT_TYPE, type SweepRecord } from '../format'
import type { AgeClock } from '../sweep/ageRecord'
import type { MarkResult } from './mark'

/**
 * The aged unit collection on a Node server: the persisted unit age record, the keep-set an age decision may take, and
 * the page's dependencies for it.
 *
 * The record lives under a top-level key outside `store2/`, so neither the collector nor the old-data deletion can reach
 * it, and it is never exported. It is derived data: one that cannot be parsed counts as absent, one a newer build wrote is
 * kept and never overwritten, and a failed read never restarts a clock. Every write carries the record's own version and
 * the commit key and the fence at the gate's revisions, so the record names only keys that no commit-key state from the
 * commit read to the write named.
 */

export const GC_AGE_KEY = 'store2-gc-age'

/** Items of each class (marked and unmarked) a record holds, and retires of one pass. */
export const UNIT_RECORD_CAP = 2_000

/** The record as read, with the revision the write must carry. */
export type UnitRecordRead =
    | { status: 'ok', value: SweepRecord, version: number }
    | { status: 'absent' | 'unreadable', version: number }
    | { status: 'too-new' }
    | { status: 'io-failed' }

/** The outcome of a record write: written, refused by a version check (on which key), or not known. */
export type UnitRecordWrite = 'written' | { conflict: 'record' | 'commit' | 'fence' } | 'unknown'

/** `key` names the record: the unit pass's (the default) or another sweep record of the same type, such as the asset sweep's. */
export async function readUnitAgeRecord(store: ByteStore, key: string = GC_AGE_KEY): Promise<UnitRecordRead> {
    let read: Awaited<ReturnType<ByteStore['read']>>
    try {
        read = await store.read(key)
    } catch {
        return { status: 'io-failed' }
    }
    if (read.version === null) {
        // A store with no revisions cannot bind the write.
        return { status: 'io-failed' }
    }
    if (read.bytes === null) {
        return { status: 'absent', version: read.version }
    }
    const unit = readUnit(read.bytes, UNIT_TYPE.sweepRecord)
    switch (unit.status) {
        case 'ok':
        case 'stale':
            return { status: 'ok', value: unit.value.body as SweepRecord, version: read.version }
        case 'too-new':
            return { status: 'too-new' }
        default:
            return { status: 'unreadable', version: read.version }
    }
}

/**
 * One guarded write of the record, never retried. A refused check changes nothing; an outcome that is not known (the
 * connection failed after the request left, or the server answered in a way that may have applied it) is reported as
 * such, which is sound either way: a write the server applied passed its checks inside the same step.
 */
export async function writeUnitAgeRecord(
    guarded: GuardedOperations, record: SweepRecord, readVersion: number, commitRevision: number, fenceRevision: number,
    key: string = GC_AGE_KEY,
): Promise<UnitRecordWrite> {
    try {
        await guarded.writeChecked(
            key,
            encodeUnit(UNIT_TYPE.sweepRecord, record),
            { ifVersion: readVersion },
            [{ key: COMMIT_KEY, version: commitRevision }, { key: FENCE_KEY, version: fenceRevision }],
        )
        return 'written'
    } catch (error) {
        if (error instanceof StoreVersionConflictError) {
            return { conflict: error.key === COMMIT_KEY ? 'commit' : error.key === FENCE_KEY ? 'fence' : 'record' }
        }
        if (error instanceof StoreOutcomeUnknownError || error instanceof NodeHttpError || error instanceof ServerLacksCapabilityError) {
            return 'unknown'
        }
        throw error
    }
}

declare const UNIT_KEEP_BRAND: unique symbol

/** The keys an age decision on units must not retire. Only `unitKeepOf` builds one, from an accepted mark. */
export interface UnitKeepSet {
    readonly [UNIT_KEEP_BRAND]: true
    holds(key: string): boolean
}

/** The keep-set of an accepted mark and the gate that opened on it: the marked keys and the fence's keys. */
export function unitKeepOf(mark: Extract<MarkResult, { status: 'marked' }>, gate: GateOpen): UnitKeepSet {
    const keep = {
        holds: (key: string) => mark.live.has(key) || gate.liveKeys.has(key),
    }
    return keep as UnitKeepSet
}

/** What an aged pass needs from the page: the two clocks and the record. */
export interface GcAgeDeps {
    /** One sample of the server's clock and the page's, read together; rejects when the server's time cannot be had. */
    sampleClock(): Promise<AgeClock>
    readRecord(): Promise<UnitRecordRead>
    writeRecord(record: SweepRecord, readVersion: number, commitRevision: number, fenceRevision: number): Promise<UnitRecordWrite>
    /** The minimum age between sightings; the sweep's own when absent. Not reachable from the page. */
    minAgeMs?: number
    futureSkewMs?: number
    recordCap?: number
}

/**
 * The aged dependencies over the page's byte store, or `null` when the store has no guarded routes or no server clock:
 * nothing may be collected there. The page clock is read right after the server's answer and never decides alone.
 */
export function buildNodeGcAge(store: ByteStore, pageNow: () => number = () => Date.now()): GcAgeDeps | null {
    const { guarded } = store
    if (guarded === undefined || guarded.serverNow === undefined) {
        return null
    }
    const serverNow = guarded.serverNow.bind(guarded)
    return {
        async sampleClock() {
            const server = await serverNow()
            const page = pageNow()
            return { early: Math.min(server, page), late: Math.max(server, page) }
        },
        readRecord: () => readUnitAgeRecord(store),
        writeRecord: (record, readVersion, commitRevision, fenceRevision) =>
            writeUnitAgeRecord(guarded, record, readVersion, commitRevision, fenceRevision),
    }
}

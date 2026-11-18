import type { ByteStore } from '../../store/contract'
import { encodeUnit, readUnit, SWEEP_KEY, UNIT_TYPE, type SweepRecord } from '../format'

/**
 * The age record (`store2-sweep`, type 22) through the page's byte store. It is derived data: a record that cannot be
 * parsed is treated as absent, so the next pass only starts a new clock. A record this build cannot read because it is
 * newer, and a store that failed the read, are not absent: the caller refuses and writes nothing, so a newer build's
 * record is never overwritten and a failed read never restarts a clock.
 */

export type SweepRecordRead =
    | { status: 'ok', value: SweepRecord }
    | { status: 'absent' }
    | { status: 'unreadable' }
    | { status: 'too-new' }
    | { status: 'io-failed' }

export async function readSweepRecord(store: ByteStore): Promise<SweepRecordRead> {
    let bytes: Uint8Array | null
    try {
        bytes = (await store.read(SWEEP_KEY)).bytes
    } catch {
        return { status: 'io-failed' }
    }
    if (bytes === null) {
        return { status: 'absent' }
    }
    const unit = readUnit(bytes, UNIT_TYPE.sweepRecord)
    switch (unit.status) {
        case 'ok':
        case 'stale':
            return { status: 'ok', value: unit.value.body as SweepRecord }
        case 'too-new':
            return { status: 'too-new' }
        default:
            return { status: 'unreadable' }
    }
}

/** Replaces the record. The key is outside the gated top-level keys and is written through the byte store, not durably. */
export async function writeSweepRecord(store: ByteStore, record: SweepRecord): Promise<void> {
    await store.write(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, record), 'unconditional')
}

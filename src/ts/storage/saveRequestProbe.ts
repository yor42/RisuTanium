/**
 * The console-free ring that times a reply's arrival, its reply-end flush and each save-now request in a measurement
 * build. Every `note*` function returns at once unless `MEASURE` is true, and each caller wraps its call in
 * `if (MEASURE)` as well, so a normal build folds the calls away and drops this module and the `__risuSaveRequestProbe`
 * global name with it. A record holds timestamps, booleans and the response discriminant only, never user data.
 *
 * Use: in the console of the page, `__risuSaveRequestProbe.all()`, `.last()` and `.reset()`.
 *
 * Times are `performance.now()` values. The ring holds the newest `SAVE_REQUEST_PROBE_LIMIT` entries. A note never
 * throws into the caller: a failure inside the ring is swallowed.
 */
import { MEASURE } from '../process/memory/measureFlag'

/** The discriminants of a chat request's response. */
export type ReplyResponseKind = 'success' | 'fail' | 'streaming' | 'multiline'

export type SaveRequestProbeRecord =
    | {
        kind: 'replyArrived'
        seq: number
        /** `performance.now()` at the page's first turn after the response resolved the request. */
        t: number
        hidden: boolean
        response: ReplyResponseKind | null
    }
    | {
        kind: 'replyEnd'
        seq: number
        /** `performance.now()` when the reply-end flush was reached. */
        t: number
        hidden: boolean
    }
    | {
        kind: 'requestNow'
        seq: number
        /** `performance.now()` when the save-now request was made. */
        t: number
        /** A yield listener from `onRequest` was live. */
        armed: boolean
        /** A scheduler wait's wake was set. A wait the loop left through a raced deferral keeps it set, so this can be true during a pass. */
        waiting: boolean
    }

export interface SaveRequestProbeHandle {
    last(): SaveRequestProbeRecord | null
    all(): SaveRequestProbeRecord[]
    /** Empties the ring; `seq` keeps running. */
    reset(): void
}

export const SAVE_REQUEST_PROBE_LIMIT = 1000

const records: SaveRequestProbeRecord[] = []
let seq = 0

export const saveRequestProbeHandle: SaveRequestProbeHandle = {
    last: () => {
        const record = records[records.length - 1]
        return record ? { ...record } : null
    },
    all: () => records.map(record => ({ ...record })),
    reset: () => { records.length = 0 },
}

function push(target: object, build: (t: number, seq: number) => SaveRequestProbeRecord): void {
    const t = performance.now()
    ;(target as { __risuSaveRequestProbe?: SaveRequestProbeHandle }).__risuSaveRequestProbe = saveRequestProbeHandle
    records.push(build(t, ++seq))
    if (records.length > SAVE_REQUEST_PROBE_LIMIT) {
        records.splice(0, records.length - SAVE_REQUEST_PROBE_LIMIT)
    }
}

/** Notes the page's first turn after a chat request's response resolved it. */
export function noteReplyArrived(response: ReplyResponseKind | undefined, target: object = globalThis): void {
    if (!MEASURE) {
        return
    }
    try {
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
        push(target, (t, n) => ({ kind: 'replyArrived', seq: n, t, hidden, response: response ?? null }))
    } catch {
        // A measurement failure never reaches the send.
    }
}

/** Notes the entry of the reply-end flush, before its visibility check. */
export function noteReplyEnd(hidden: boolean, target: object = globalThis): void {
    if (!MEASURE) {
        return
    }
    try {
        push(target, (t, n) => ({ kind: 'replyEnd', seq: n, t, hidden }))
    } catch {
        // A measurement failure never reaches the flush.
    }
}

/** Notes a save-now request, read before the request changes any scheduler state. */
export function noteRequestNow(armed: boolean, waiting: boolean, target: object = globalThis): void {
    if (!MEASURE) {
        return
    }
    try {
        push(target, (t, n) => ({ kind: 'requestNow', seq: n, t, armed, waiting }))
    } catch {
        // A measurement failure never reaches the save request.
    }
}

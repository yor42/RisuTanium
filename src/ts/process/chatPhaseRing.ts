/**
 * The console-free timing ring of chat select, script passes and edit confirm in a measurement build. Every `note*`
 * function returns at once unless `MEASURE` is true, and each caller wraps its call in `if (MEASURE)` as well, so a
 * normal build folds the calls away and drops this module and the `__risuChatPhases` global name with it. The build
 * strips `console.*` from application source in every vite build, measurement builds included, so on a device this
 * ring is the only in-page output.
 *
 * Use: in the console of the page, `__risuChatPhases.snapshot()` and `.reset()`.
 *
 * Times are `performance.now()` values and deltas; no `performance.mark` is used. The ring holds the newest
 * `CHAT_PHASE_RING_LIMIT` entries. A note never throws into the caller: a failure inside the ring is swallowed.
 */
import { MEASURE } from './memory/measureFlag'

/** How a `processScriptFull` call met the script cache. `aborted`: the call threw before it decided. */
export type ScriptCacheOutcome = 'hit' | 'miss' | 'uncached' | 'empty' | 'aborted'

export type ChatSelectPoint = 'start' | 'flushed' | 'bumped'

export type ChatPhaseRecord =
    | {
        kind: 'select'
        point: ChatSelectPoint
        /** `performance.now()` at the point. */
        t: number
        /** Milliseconds since the `start` point of the same select. */
        sinceStartMs: number
    }
    | {
        kind: 'script'
        mode: string
        /** `performance.now()` when the call finished. */
        t: number
        ms: number
        cache: ScriptCacheOutcome
        /** Linear message scans the call's script loop made. */
        scans: number
        /** Regex runs the early rejection skipped in the call's script loop. */
        earlyRejects: number
    }
    | {
        kind: 'edit'
        /** `performance.now()` when the confirm finished. */
        t: number
        /**
         * Milliseconds from edit mode turning off to the edited text being written: only the synchronous write. The
         * reparse and render that follow run after the note; they show in the `script` records and timestamps after `t`.
         */
        ms: number
    }

export interface ChatPhaseRingHandle {
    snapshot(): ChatPhaseRecord[]
    reset(): void
}

export const CHAT_PHASE_RING_LIMIT = 2000

const records: ChatPhaseRecord[] = []
let selectStartT = 0

const handle: ChatPhaseRingHandle = {
    snapshot: () => records.map(record => ({ ...record })),
    reset: () => { records.length = 0 },
}

function push(record: ChatPhaseRecord, target: object): void {
    ;(target as { __risuChatPhases?: ChatPhaseRingHandle }).__risuChatPhases = handle
    records.push(record)
    if (records.length > CHAT_PHASE_RING_LIMIT) {
        records.splice(0, records.length - CHAT_PHASE_RING_LIMIT)
    }
}

/** Notes a point of `changeChatTo`. `start` begins the delta the later points report. */
export function noteChatSelect(point: ChatSelectPoint, target: object = globalThis): void {
    if (!MEASURE) {
        return
    }
    try {
        const t = performance.now()
        if (point === 'start') {
            selectStartT = t
        }
        push({ kind: 'select', point, t, sinceStartMs: t - selectStartT }, target)
    } catch {
        // A measurement failure never reaches the select.
    }
}

/** Notes one finished `processScriptFull` call that began at `startT`. */
export function noteScriptPass(mode: string, startT: number, cache: ScriptCacheOutcome, scans: number, earlyRejects: number, target: object = globalThis): void {
    if (!MEASURE) {
        return
    }
    try {
        const t = performance.now()
        push({ kind: 'script', mode, t, ms: t - startT, cache, scans, earlyRejects }, target)
    } catch {
        // A measurement failure never reaches the script pass.
    }
}

/** Notes an edit confirm that began at `startT`. */
export function noteEditConfirm(startT: number, target: object = globalThis): void {
    if (!MEASURE) {
        return
    }
    try {
        const t = performance.now()
        push({ kind: 'edit', t, ms: t - startT }, target)
    } catch {
        // A measurement failure never reaches the edit.
    }
}

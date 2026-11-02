import { BULK_UNIT_THRESHOLD } from './backend/types'
import type { CommitRequest } from './commit'
import type { SavePassRequest } from './saveEncoder'
import { savePassKindOf, type SavePassKind } from './savePassMeter'
import { yieldByMessage, yieldToEventLoop } from '../saveYield'

/**
 * The yield-gap meter of a measurement build: per save pass, the longest stretch of synchronous work between two
 * points where the main thread was free. `saveLoop.ts` calls it only under `if (MEASURE)`, so a normal build folds the
 * calls away and drops this module and the global name with it.
 *
 * A pass is cut into segments, each of which holds synchronous work only:
 * - `a`: from the start of the budget to the first real yield;
 * - `b`: from the resume after a real yield to the next one;
 * - `c`: from the last resume (or the start) to the end of the commit request's `build`;
 * - `d`: from the resolution of the commit to the end of the attempt (the pass's own `settleUnsavable` and `saved`
 *   notice run after the attempt and are not in `d`).
 * The waits for the commit key, the backend commit, a bulk commit's marker write and key re-read, and a stub load sit
 * between segments and are never counted. An ordinary commit has no wait before its `build`, so `c` also holds the
 * synchronous work from the commit call to the end of `build`. When `bulk` is true (the new-unit count is above the bulk
 * threshold; a save-mine commit takes the ordinary path even then), a bulk commit awaits its marker and key before
 * `build`: `c` is closed when the commit is handed over and
 * reopened at `build`, so the synchronous work of the commit between its waits and `build` is not counted. A real
 * yield's own wait is recorded apart, as a sum and a maximum, because a yield that returns at once while a task of
 * another source stays queued is what the longest segment cannot show by itself.
 *
 * Use: set localStorage `risu-measure-yield-mode` to `message` and reload to make the real yields use a
 * `MessageChannel` message instead of `scheduler.yield()`; any other value leaves the default primitive. The switch is
 * read once per pass and governs only the unraced yields: a yield the caller passes its own primitive for (the raced
 * yield of a hidden Android tick) uses that one whatever the switch says. Read the records from the console of a store2 page with `__risuYieldGapMeter.last()`, `.all()`
 * and `.reset()`.
 *
 * The meter never throws into the save path: every entry point swallows its own failures.
 */

export type YieldGapLabel = 'a' | 'b' | 'c' | 'd'

/**
 * Which primitive the pass's real yields used: the platform's `scheduler.yield()`, a `MessageChannel` message (the
 * switch, or a caller-supplied message yield; it reads `message` as soon as one yield of the pass used it), or the
 * fallback chain. The localStorage switch governs only the unraced yields.
 */
export type YieldGapMode = 'scheduler' | 'message' | 'fallback'

export interface YieldGapRecord {
    kind: SavePassKind
    /** Whether the pass encoded the modules. */
    modules: boolean
    /** Whether the commit's new-unit count is above the bulk threshold. Its `c` then excludes the commit's own prelude; a save-mine commit with this many units still takes the ordinary path, so its record shows less than it ran. */
    bulk: boolean
    /** How many real yields the pass made. */
    yields: number
    budgetMs: number
    mode: YieldGapMode
    maxSegmentMs: number
    maxSegmentLabel: YieldGapLabel | null
    segmentMaxMs: Record<YieldGapLabel, number>
    /** From the start of the budget to the return of the planning pass. */
    planMs: number | null
    /** The time inside the commit request's `build`, summed over its calls. */
    buildMs: number
    /** The sum and the maximum of the time each real yield itself waited. */
    yieldWaitSumMs: number
    yieldWaitMaxMs: number
    /** `performance.now()` at the recorder's start, the same clock as `SavePassRecord.at`, so a record pairs with its pass and with probe timestamps. */
    at: number
    /** The page was hidden when the pass's request was made. */
    hidden: boolean
    /** The page rule asked to skip yields at request time; `yields` says whether the pass really yielded. */
    pageSkip: boolean
    /** A save request ended one of the pass's yields before the yield itself resolved. */
    preempted: boolean
    /** The pass was a tick that ended at a yield because a pass became due; it planned and committed nothing, so `planMs` stays null. */
    cut: boolean
}

export interface YieldGapRecorder {
    /**
     * The budget's yield function: records the segment that ends here and the wait of the yield itself. With `preempt`,
     * the yield ends when that promise settles first, which is recorded as `preempted`. With `base`, that primitive
     * replaces the one the switch would choose, and the pass's `mode` reads `message`.
     */
    yield(preempt?: Promise<void>, base?: () => Promise<void>): Promise<void>
    /** Names the pass the recorder measures. */
    describe(request: SavePassRequest): void
    /** The tick ended at a yield because a pass became due. */
    cut(): void
    /** The planning pass returned. */
    planned(): void
    /** Closes the open segment before an I/O wait of the pass. */
    pause(): void
    /** Opens a segment after an I/O wait. */
    resume(): void
    /** The commit request with a `build` that closes segment `c` at its end. */
    wrapBuild(request: CommitRequest): CommitRequest
    /** The commit resolved: segment `d` starts. */
    committed(): void
    /** Closes the recorder on any exit of the attempt and stores the record. */
    finish(): void
}

export interface YieldGapMeterHandle {
    last(): YieldGapRecord | null
    all(): YieldGapRecord[]
    reset(): void
}

const RECORD_LIMIT = 1000
const MODE_KEY = 'risu-measure-yield-mode'
const BUDGET_MS = 8

const records: YieldGapRecord[] = []

export const yieldGapMeterHandle: YieldGapMeterHandle = {
    last: () => records.length === 0 ? null : records[records.length - 1],
    all: () => [...records],
    reset: () => {
        records.length = 0
    },
}

function messageModeOn(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(MODE_KEY) === 'message'
    } catch {
        return false
    }
}

function schedulerAvailable(): boolean {
    const scheduler = (globalThis as { scheduler?: { yield?: unknown } }).scheduler
    return typeof scheduler?.yield === 'function'
}

function pushLimited(record: YieldGapRecord): void {
    records.push(record)
    if (records.length > RECORD_LIMIT) {
        records.shift()
    }
}

/** Starts the recorder of one pass: installs the global, reads the mode switch once and starts the clock. */
export function startYieldGaps(target: object = globalThis): YieldGapRecorder | null {
    try {
        ;(target as { __risuYieldGapMeter?: YieldGapMeterHandle }).__risuYieldGapMeter = yieldGapMeterHandle
        const message = messageModeOn()
        let mode: YieldGapMode = message ? 'message' : (schedulerAvailable() ? 'scheduler' : 'fallback')
        const startedAt = performance.now()
        const segmentMaxMs: Record<YieldGapLabel, number> = { a: 0, b: 0, c: 0, d: 0 }
        let kind: SavePassKind = 'edit'
        let modules = false
        let hidden = false
        let pageSkip = false
        let preempted = false
        let cut = false
        let bulk = false
        let yields = 0
        let phase: 'planning' | 'planned' | 'committed' = 'planning'
        let open = true
        let segmentStart = startedAt
        let planMs: number | null = null
        let buildMs = 0
        let yieldWaitSumMs = 0
        let yieldWaitMaxMs = 0
        let finished = false
        let committing = false
        let buildRan = false

        const labelNow = (): YieldGapLabel => {
            if (phase === 'committed') {
                return 'd'
            }
            if (phase === 'planned') {
                return 'c'
            }
            return yields === 0 ? 'a' : 'b'
        }
        const pause = (): void => {
            try {
                if (!open) {
                    return
                }
                open = false
                if (committing && !buildRan) {
                    // A commit refused before its build leaves no build-only stretch to count: nothing is recorded for it.
                    return
                }
                const label = labelNow()
                const length = performance.now() - segmentStart
                if (length > segmentMaxMs[label]) {
                    segmentMaxMs[label] = length
                }
            } catch {
                // A measurement failure never reaches the save.
            }
        }
        const resume = (): void => {
            try {
                if (!open) {
                    open = true
                    segmentStart = performance.now()
                }
            } catch {
                // A measurement failure never reaches the save.
            }
        }
        const wrapped = (request: CommitRequest): CommitRequest => {
            try {
                bulk = request.newUnits > BULK_UNIT_THRESHOLD
                if (bulk) {
                    // A bulk commit awaits its marker write and key re-read before `build`: close the stretch here so those waits stay out of `c`.
                    pause()
                }
                committing = true
                return {
                    ...request,
                    build: (context) => {
                        let builtAt = 0
                        try {
                            buildRan = true
                            resume()
                            builtAt = performance.now()
                        } catch {
                            // A measurement failure never reaches the save.
                        }
                        const ended = (): void => {
                            try {
                                buildMs += performance.now() - builtAt
                                pause()
                            } catch {
                                // A measurement failure never reaches the save.
                            }
                        }
                        let built: ReturnType<CommitRequest['build']>
                        try {
                            built = request.build(context)
                        } catch (error) {
                            ended()
                            throw error
                        }
                        if (built instanceof Promise) {
                            return built.then((value) => {
                                ended()
                                return value
                            }, (error: unknown) => {
                                ended()
                                throw error
                            })
                        }
                        ended()
                        return built
                    },
                }
            } catch {
                return request
            }
        }

        return {
            async yield(preempt, supplied) {
                let waitStart = 0
                try {
                    pause()
                    yields += 1
                    waitStart = performance.now()
                } catch {
                    // A measurement failure never reaches the save.
                }
                try {
                    if (supplied !== undefined) {
                        mode = 'message'
                    }
                    const base = supplied !== undefined ? supplied() : (message ? yieldByMessage() : yieldToEventLoop())
                    if (preempt === undefined) {
                        await base
                    } else if (await Promise.race([base.then(() => false), preempt.then(() => true)])) {
                        // The request won: the wait ends here and the segment resumes at once. The lost yield is not
                        // awaited, so its later settle reaches neither the wait sums nor the segment.
                        preempted = true
                    }
                } finally {
                    try {
                        const waited = performance.now() - waitStart
                        yieldWaitSumMs += waited
                        if (waited > yieldWaitMaxMs) {
                            yieldWaitMaxMs = waited
                        }
                        resume()
                    } catch {
                        // A measurement failure never reaches the save.
                    }
                }
            },
            describe(request) {
                try {
                    kind = savePassKindOf(request)
                    modules = request.whole || request.rewriteAll === true || request.modules || request.net?.modules === true
                    hidden = request.pageHidden === true
                    pageSkip = request.pageSkip === true
                } catch {
                    // A measurement failure never reaches the save.
                }
            },
            cut() {
                cut = true
            },
            planned() {
                try {
                    planMs = performance.now() - startedAt
                    phase = 'planned'
                } catch {
                    // A measurement failure never reaches the save.
                }
            },
            pause,
            resume,
            wrapBuild: wrapped,
            committed() {
                try {
                    // A commit that returned without building leaves its stretch uncounted (see `pause`).
                    pause()
                    committing = false
                    phase = 'committed'
                    resume()
                } catch {
                    // A measurement failure never reaches the save.
                }
            },
            finish() {
                try {
                    if (finished) {
                        return
                    }
                    finished = true
                    pause()
                    let maxSegmentMs = 0
                    let maxSegmentLabel: YieldGapLabel | null = null
                    for (const label of ['a', 'b', 'c', 'd'] as const) {
                        if (segmentMaxMs[label] > maxSegmentMs) {
                            maxSegmentMs = segmentMaxMs[label]
                            maxSegmentLabel = label
                        }
                    }
                    pushLimited({
                        kind, modules, bulk, yields, budgetMs: BUDGET_MS, mode, maxSegmentMs, maxSegmentLabel,
                        segmentMaxMs: { ...segmentMaxMs }, planMs, buildMs, yieldWaitSumMs, yieldWaitMaxMs,
                        at: startedAt, hidden, pageSkip, preempted, cut,
                    })
                } catch {
                    // A measurement failure never reaches the save.
                }
            },
        }
    } catch {
        return null
    }
}

// Runs a Studio search in short slices so a long profile never blocks the page. The runner knows nothing about
// what is searched: it walks a `SearchWork` unit by unit and item by item, keeps the first `limit` hits and
// counts the rest. Pure scheduling: nothing here reads or writes the database.

/** What a run walks. A unit is a kind of an owner; the item count is read when the unit is entered. */
export interface SearchWork<R> {
    readonly unitCount: number
    itemCount(unit: number): number
    /** The hit for one item, or null for no match. An index the unit no longer holds is a miss, never an error. */
    scan(unit: number, index: number): R | null
}

export interface RunnerState<R> {
    results: R[]
    /** Hits beyond the limit, counted but not kept. */
    more: number
    running: boolean
}

/** A run is valid only for the visit and the model it started on, and for the query it was started with. */
export interface RunToken {
    visitId: number
    query: string
    modelVersion: number
}

export interface SearchRunnerOptions<R> {
    /** The visit and model that are current now; a slice that finds its token behind them does not continue. */
    current: () => { visitId: number, modelVersion: number }
    onUpdate: (state: RunnerState<R>) => void
    limit?: number
    sliceMs?: number
    now?: () => number
    /** Schedules one slice and returns its canceller. */
    schedule?: (task: () => void) => () => void
}

export interface SearchRunner<R> {
    /**
     * Starts a run for `query`, replacing any run in progress. `buildWork` is called again when the model changes
     * under the run, so the restart searches the new model. A null work is an idle search.
     */
    start(query: string, buildWork: () => SearchWork<R> | null): void
    /** Stops the run in progress and discards it: no further update arrives. */
    cancel(): void
}

export const SEARCH_RESULT_LIMIT = 200
export const SEARCH_SLICE_MS = 8

/** An idle callback when the host has one, else the next macrotask. */
export function scheduleIdleSlice(task: () => void): () => void {
    if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
        const handle = requestIdleCallback(() => task(), { timeout: 200 })
        return () => cancelIdleCallback(handle)
    }
    const handle = setTimeout(task, 0)
    return () => clearTimeout(handle)
}

interface Run<R> {
    token: RunToken
    buildWork: () => SearchWork<R> | null
    work: SearchWork<R>
    unit: number
    index: number
    itemTotal: number
    entered: boolean
    results: R[]
    more: number
    cancelSlice: (() => void) | null
}

export function createSearchRunner<R>(options: SearchRunnerOptions<R>): SearchRunner<R> {
    const limit = options.limit ?? SEARCH_RESULT_LIMIT
    const sliceMs = options.sliceMs ?? SEARCH_SLICE_MS
    const now = options.now ?? (() => performance.now())
    const schedule = options.schedule ?? scheduleIdleSlice
    let active: Run<R> | null = null

    function emit(run: Run<R>, running: boolean): void {
        options.onUpdate({ results: [...run.results], more: run.more, running })
    }

    function stop(): void {
        active?.cancelSlice?.()
        active = null
    }

    function queue(run: Run<R>): void {
        run.cancelSlice = schedule(() => {
            run.cancelSlice = null
            slice(run)
        })
    }

    function begin(query: string, buildWork: () => SearchWork<R> | null): void {
        stop()
        const { visitId, modelVersion } = options.current()
        const work = buildWork()
        if (work === null) {
            options.onUpdate({ results: [], more: 0, running: false })
            return
        }
        const run: Run<R> = {
            token: { visitId, query, modelVersion },
            buildWork,
            work,
            unit: 0,
            index: 0,
            itemTotal: 0,
            entered: false,
            results: [],
            more: 0,
            cancelSlice: null,
        }
        active = run
        emit(run, true)
        queue(run)
    }

    function slice(run: Run<R>): void {
        if (active !== run) return
        const current = options.current()
        if (current.visitId !== run.token.visitId) {
            active = null
            return
        }
        // The model moved under the run: its lists are not the ones searched so far, so the query starts over.
        if (current.modelVersion !== run.token.modelVersion) {
            begin(run.token.query, run.buildWork)
            return
        }
        const began = now()
        while (run.unit < run.work.unitCount) {
            if (!run.entered) {
                run.itemTotal = run.work.itemCount(run.unit)
                run.index = 0
                run.entered = true
            }
            while (run.index < run.itemTotal) {
                const hit = run.work.scan(run.unit, run.index)
                run.index += 1
                if (hit !== null) {
                    if (run.results.length < limit) run.results.push(hit)
                    else run.more += 1
                }
                if (now() - began >= sliceMs) {
                    emit(run, true)
                    queue(run)
                    return
                }
            }
            run.unit += 1
            run.entered = false
        }
        emit(run, false)
        active = null
    }

    return {
        start: begin,
        cancel: stop,
    }
}

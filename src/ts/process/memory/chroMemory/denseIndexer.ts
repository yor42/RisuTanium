import { beginInFlight, inFlightChatCount, subscribeInFlight } from '../../inFlightWork'
import {
    DENSE_BATCH,
    DENSE_BATCH_TIMEOUT_MS,
    DENSE_IDLE_MS,
    DENSE_READY_WAIT_MS,
    DenseTimeoutError,
    PERSIST_EVERY_BATCHES,
    currentDensePause,
    pauseDenseAfter,
    settleWithin,
    type DenseJob,
} from './dense'
import type { IndexedUnit } from './chatIndex'
import { requestPersist } from './vectorPersist'

/** Requests whose result the indexer gave up on and that have not settled yet; a run starts only below this. */
const UNSETTLED_CAP = 2

let job: DenseJob | null = null
let running = false
let unsettled = 0
let quietSince: number | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null
/** Bumped by a test reset so a run that was mid-batch stops touching the module state. */
let generation = 0

function visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/**
 * Quiet is the time since no chat was live while the page was visible. Other
 * kinds, including this indexer's own embed token, never move it.
 */
function refreshQuiet(): void {
    const quiet = inFlightChatCount() === 0 && visible()
    if (quiet) {
        if (quietSince === null) quietSince = Date.now()
    } else {
        quietSince = null
    }
}

function clearTimer(): void {
    if (timer !== null) {
        clearTimeout(timer)
        timer = null
    }
}

function attach(): void {
    if (unsubscribe) return
    const stop = subscribeInFlight(onChange)
    const watch = typeof document !== 'undefined'
    if (watch) document.addEventListener('visibilitychange', onChange)
    unsubscribe = () => {
        stop()
        if (watch) document.removeEventListener('visibilitychange', onChange)
    }
}

function drop(): void {
    job = null
    clearTimer()
    if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
    }
}

/** A registry or visibility change, or a settled request: re-plan on a fresh tick. */
function onChange(): void {
    if (!job || running) return
    refreshQuiet()
    clearTimer()
    timer = setTimeout(tick, 0)
}

/** The ms to wait before a run may start; 0 means now, null means wait for an event. */
function plan(): number | null {
    if (unsettled >= UNSETTLED_CAP) return null
    const pause = currentDensePause()
    if (pause) return Math.max(1, pause.until - Date.now())
    if (quietSince === null) return null
    const idle = Date.now() - quietSince
    return idle >= DENSE_IDLE_MS ? 0 : DENSE_IDLE_MS - idle
}

function tick(): void {
    timer = null
    if (!job) return
    if (!job.isLive()) {
        drop()
        return
    }
    if (running) return
    refreshQuiet()
    const wait = plan()
    if (wait === null) return
    if (wait === 0) {
        void run()
        return
    }
    timer = setTimeout(tick, wait)
}

type BatchOutcome =
    | { kind: 'ok', vectors: Float32Array[] }
    | { kind: 'error', error: unknown }
    | { kind: 'timeout' }

/** Races one batch against the batch timeout; a result after the timeout is discarded. */
function embedBatch(j: DenseJob, texts: string[]): Promise<BatchOutcome> {
    const request = (async () => j.embedder.embedDocuments(texts))()
    unsettled++
    return new Promise<BatchOutcome>((resolve) => {
        let decided = false
        const limit = setTimeout(() => {
            if (decided) return
            decided = true
            resolve({ kind: 'timeout' })
        }, DENSE_BATCH_TIMEOUT_MS)
        const settle = (outcome: BatchOutcome): void => {
            unsettled--
            if (decided) {
                onChange()
                return
            }
            decided = true
            clearTimeout(limit)
            resolve(outcome)
        }
        request.then(
            (vectors) => settle({ kind: 'ok', vectors }),
            (error: unknown) => settle({ kind: 'error', error }),
        )
    })
}

function missingNewestFirst(j: DenseJob, units: readonly IndexedUnit[]): IndexedUnit[] {
    const out: IndexedUnit[] = []
    for (let i = units.length - 1; i >= 0 && out.length < DENSE_BATCH; i--) {
        if (!j.store.get(units[i])) out.push(units[i])
    }
    return out
}

/** One run: one embed token for all its batches, begun only when a batch is about to embed, with the state re-checked before each. */
async function run(): Promise<void> {
    const mine = generation
    running = true
    let endToken: (() => void) | null = null
    let batches = 0
    const started = job
    try {
        // The persisted vectors come first so loaded units are not embedded again; a read that never settles is given up on.
        if (started && !started.store.loaded) await settleWithin(started.store.ready, DENSE_READY_WAIT_MS)
        for (;;) {
            if (mine !== generation) return
            const j = job
            if (!j) return
            if (!j.isLive()) {
                drop()
                return
            }
            refreshQuiet()
            if (currentDensePause() || quietSince === null || Date.now() - quietSince < DENSE_IDLE_MS) return
            const { store, embedder } = j
            store.useModel(embedder.modelKey)
            const units = j.units()
            store.prune(units)
            const batch = missingNewestFirst(j, units)
            if (batch.length === 0) {
                drop()
                return
            }
            endToken ??= beginInFlight('embed')
            const outcome = await embedBatch(j, batch.map((u) => u.text))
            if (mine !== generation) return
            if (outcome.kind === 'timeout') {
                pauseDenseAfter(new DenseTimeoutError())
                return
            }
            if (outcome.kind === 'error') {
                pauseDenseAfter(outcome.error)
                return
            }
            if (outcome.vectors.length !== batch.length) {
                pauseDenseAfter(new Error('embedding count mismatch'))
                return
            }
            if (!store.disposed && store.modelKey === embedder.modelKey) {
                batch.forEach((u, i) => store.set(u, outcome.vectors[i]))
                if (++batches % PERSIST_EVERY_BATCHES === 0) requestPersist(store)
            }
            // A macrotask between batches lets a chat or a visibility change land before the next check.
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
    } catch (e) {
        if (mine === generation) pauseDenseAfter(e)
    } finally {
        endToken?.()
        // Every exit (end, pause, timeout, a chat leaving) persists what was embedded; a hidden page runs it on visible.
        if (mine === generation && started && !started.store.disposed && started.store.hasUnpersisted()) requestPersist(started.store)
        if (mine === generation) {
            running = false
            if (job) {
                clearTimer()
                timer = setTimeout(tick, 0)
            }
        }
    }
}

/**
 * Hands the indexer a chat's store; it replaces any earlier job. The work runs
 * on its own timers, never awaited by the caller, and every error is caught.
 */
export function scheduleDenseIndexing(next: DenseJob): void {
    job = next
    attach()
    refreshQuiet()
    if (!running) {
        clearTimer()
        timer = setTimeout(tick, 0)
    }
}

export function resetDenseIndexerForTests(): void {
    generation++
    drop()
    running = false
    unsettled = 0
    quietSince = null
}

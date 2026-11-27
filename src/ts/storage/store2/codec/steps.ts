/**
 * Step generators: a unit of encode work written once as a generator that yields between its stages, driven either
 * straight through (the synchronous callers) or with an await between the stages (the passes that share the main
 * thread). Both drivers resume the generator with `next()` only: they never call `throw()` or `return()`, so an error
 * of a pause (a cut tick, a rejected yield) leaves the generator unresumed and outside every `catch` it holds, and an
 * abandoned generator is simply dropped. A generator driven this way must hold no `finally` and no resource.
 */

/** A stage-by-stage computation: it yields at each stage boundary and returns its result. */
export type Steps<T> = Generator<void, T, void>

/** Measurement builds only: the time the async driver spent waiting in the pause, so the caller can leave it out of CPU time. */
export interface StepWaits {
    ms: number
}

/** Runs every stage in this task and returns the result: the yields are boundaries only. */
export function runSteps<T>(steps: Steps<T>): T {
    for (;;) {
        const step = steps.next()
        if (step.done === true) {
            return step.value
        }
    }
}

/**
 * Runs the stages with `await pause()` between consecutive stages (never after the last: the caller's own yield
 * follows it). A pause that throws or rejects propagates out of the driver, and the generator is not resumed.
 * `waits`, when given, accumulates the time spent in the pause.
 */
export async function runStepsYielding<T>(steps: Steps<T>, pause: () => Promise<void>, waits?: StepWaits): Promise<T> {
    for (;;) {
        const step = steps.next()
        if (step.done === true) {
            return step.value
        }
        if (waits === undefined) {
            await pause()
        } else {
            const waitStartedAt = performance.now()
            try {
                await pause()
            } finally {
                waits.ms += performance.now() - waitStartedAt
            }
        }
    }
}

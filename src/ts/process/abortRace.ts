// Races a hook against a unit's stop signal, so a hook that never settles cannot hold the unit.
// This module imports nothing from the app.
//
// Invariant for everything that uses it: no promise or callback is left unobserved except through
// `detach`. A failure in unobserved work would reach the page's `unhandledrejection` or window
// `error` handler, and both end in an error dialog. `detach` turns every such failure into one
// console warning.

export type RaceOutcome<T> = { settled: true, value: T } | { settled: false }

export interface RaceOptions<T> {
    /** Names the hook in the abandonment log. */
    label: string
    /** Abandons the work after this long whatever the signal does. */
    timeoutMs?: number
    /** Receives a value the work produces after it was abandoned. A returned promise is handled. */
    onLateValue?: (value: T) => void | PromiseLike<unknown>
}

/** The work: a function that starts the hook inside it, or a hook promise that already exists before the race. */
export type RaceWork<T> = ((abandoned: AbortSignal) => T | PromiseLike<T>) | PromiseLike<T>

export interface StopDeadline {
    readonly expired: boolean
    dispose(): void
}

/** The grace a stopped unit's output passes share, counted from the Stop. */
export const STOPPED_PASS_GRACE_MS = 10_000
/** A stopped unit still running this long after the Stop is logged once. It is longer than the grace. */
export const STOPPED_UNIT_WATCHDOG_MS = 20_000

function logDetached(label: string, error: unknown): void {
    try {
        console.warn(label, error)
    } catch {
        // A throwing console must not turn a handled failure into an unhandled one.
    }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        return false
    }
    return typeof (value as { then?: unknown }).then === 'function'
}

/**
 * The only way to leave a promise, or a callback's failure, unobserved. Runs `task` now. A synchronous
 * throw, and the rejection of a promise it returns, are logged once with `console.warn(label, error)`.
 * It never throws and never leaves a rejected promise behind.
 */
export function detach(label: string, task: () => unknown): void {
    try {
        const result = task()
        if (isThenable(result)) {
            Promise.resolve(result).then(undefined, (error: unknown) => logDetached(label, error))
        }
    } catch (error) {
        logDetached(label, error)
    }
}

type Subscribe = (fire: () => void) => () => void

const deadlineSubscribers = new WeakMap<StopDeadline, Subscribe>()

function race<T>(
    fired: () => boolean,
    subscribeTrigger: Subscribe | null,
    work: RaceWork<T>,
    options: RaceOptions<T>,
): Promise<RaceOutcome<T>> {
    const { label, timeoutMs, onLateValue } = options
    return new Promise<RaceOutcome<T>>((resolve, reject) => {
        const abandoned = new AbortController()
        let state: 'pending' | 'settled' | 'abandoned' = 'pending'
        let release: Array<() => void> = []

        const cleanup = () => {
            const toRun = release
            release = []
            for (const fn of toRun) {
                fn()
            }
        }

        const abandon = () => {
            if (state !== 'pending') {
                return
            }
            state = 'abandoned'
            cleanup()
            try {
                console.warn(label)
            } catch {
                // see logDetached
            }
            abandoned.abort()
            resolve({ settled: false })
        }

        const subscribe = (promise: PromiseLike<T>) => {
            detach(label, () => Promise.resolve(promise).then(
                (value) => {
                    if (state === 'pending') {
                        state = 'settled'
                        cleanup()
                        resolve({ settled: true, value })
                        return undefined
                    }
                    return onLateValue?.(value)
                },
                (error: unknown) => {
                    if (state === 'pending') {
                        state = 'settled'
                        cleanup()
                        reject(error)
                        return undefined
                    }
                    throw error
                },
            ))
        }

        if (fired()) {
            // The work is never started. A promise that already exists still gets its handler.
            if (typeof work !== 'function') {
                subscribe(work)
            }
            abandon()
            return
        }

        if (subscribeTrigger) {
            release.push(subscribeTrigger(() => detach(label, abandon)))
        }
        if (timeoutMs !== undefined) {
            const timer = setTimeout(() => detach(label, abandon), timeoutMs)
            release.push(() => clearTimeout(timer))
        }

        let promise: PromiseLike<T>
        if (typeof work === 'function') {
            try {
                promise = Promise.resolve(work(abandoned.signal))
            } catch (error) {
                state = 'settled'
                cleanup()
                reject(error)
                return
            }
        } else {
            promise = work
        }
        subscribe(promise)
    })
}

function signalSubscriber(signal: AbortSignal): Subscribe {
    return (fire) => {
        signal.addEventListener('abort', fire, { once: true })
        return () => signal.removeEventListener('abort', fire)
    }
}

/** Abandons the work when `signal` aborts. With no signal and no `timeoutMs` it is a plain await. */
export async function raceAbort<T>(
    signal: AbortSignal | null | undefined,
    work: RaceWork<T>,
    options: RaceOptions<T>,
): Promise<RaceOutcome<T>> {
    if (!signal && options.timeoutMs === undefined) {
        const value = await (typeof work === 'function' ? work(new AbortController().signal) : work)
        return { settled: true, value }
    }
    return race(
        () => !!signal?.aborted,
        signal ? signalSubscriber(signal) : null,
        work,
        options,
    )
}

/** Abandons the work when `deadline` expires. The abort that arms the deadline does not abandon it. */
export function raceUntil<T>(
    deadline: StopDeadline,
    work: RaceWork<T>,
    options: RaceOptions<T>,
): Promise<RaceOutcome<T>> {
    return race(() => deadline.expired, deadlineSubscribers.get(deadline) ?? null, work, options)
}

/**
 * Expires `graceMs` after `signal` aborts, or after creation when it is already aborted. `onExpire`
 * runs once at expiry and never after `dispose()`.
 */
export function createStopDeadline(signal: AbortSignal, graceMs: number, onExpire?: () => void): StopDeadline {
    const subscribers = new Set<() => void>()
    let expired = false
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const expire = () => {
        if (disposed || expired) {
            return
        }
        expired = true
        timer = undefined
        for (const fire of [...subscribers]) {
            fire()
        }
        if (onExpire) {
            detach('The stop deadline', onExpire)
        }
    }
    const arm = () => {
        if (disposed || timer !== undefined || expired) {
            return
        }
        timer = setTimeout(() => detach('The stop deadline', expire), graceMs)
    }
    const onAbort = () => detach('The stop deadline', arm)

    if (signal.aborted) {
        arm()
    } else {
        signal.addEventListener('abort', onAbort, { once: true })
    }

    const deadline: StopDeadline = {
        get expired() {
            return expired
        },
        dispose() {
            disposed = true
            subscribers.clear()
            if (timer !== undefined) {
                clearTimeout(timer)
                timer = undefined
            }
            signal.removeEventListener('abort', onAbort)
        },
    }
    deadlineSubscribers.set(deadline, (fire) => {
        subscribers.add(fire)
        return () => {
            subscribers.delete(fire)
        }
    })
    return deadline
}

/** A signal that aborts once when any source aborts, or at creation when one already has. Never aborts a source. */
export function linkedAbort(...sources: (AbortSignal | null | undefined)[]): { signal: AbortSignal, dispose(): void } {
    const controller = new AbortController()
    const live = sources.filter((source): source is AbortSignal => !!source)
    const dispose = () => {
        for (const source of live) {
            source.removeEventListener('abort', onAbort)
        }
    }
    const onAbort = () => detach('A linked abort', () => {
        dispose()
        controller.abort()
    })
    if (live.some((source) => source.aborted)) {
        controller.abort()
    } else {
        for (const source of live) {
            source.addEventListener('abort', onAbort, { once: true })
        }
    }
    return { signal: controller.signal, dispose }
}

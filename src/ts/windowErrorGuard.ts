/**
 * What the window `error` handler does with an event.
 *
 * - `ignore`: the event carries no error object. Browsers raise such an event for a
 *   ResizeObserver "loop completed with undelivered notifications" notification, which
 *   is not a failure of the application: only its message is warned, nothing is shown.
 * - `log`: an error raised by a worker; it is logged and not shown.
 * - `report`: any other error, which is logged and shown.
 */
export type WindowErrorDisposition = 'ignore' | 'log' | 'report'

export function classifyWindowError(event: { readonly error: unknown }): WindowErrorDisposition {
    const error = event.error
    if (error === null || error === undefined) {
        return 'ignore'
    }
    const target = typeof error === 'object' ? (error as { target?: unknown }).target : undefined
    if (typeof Worker !== 'undefined' && target instanceof Worker) {
        return 'log'
    }
    return 'report'
}

export interface WindowErrorSinks {
    warn(message: string): void
    error(error: unknown): void
    report(error: string | Error): void
}

/**
 * Applies `classifyWindowError`: an event without an error object is only noted with its message
 * (a warning, never an alert), a worker error is logged, any other error is logged and reported.
 */
export function handleWindowError(event: { readonly error: unknown; readonly message: string }, sinks: WindowErrorSinks): void {
    const disposition = classifyWindowError(event)
    if (disposition === 'ignore') {
        sinks.warn(event.message)
        return
    }
    sinks.error(event.error)
    if (disposition === 'report') {
        // alertError accepts anything a page can throw and renders non-Error values itself.
        sinks.report(event.error as string | Error)
    }
}
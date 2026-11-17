/**
 * The fast-forward defers, never parks, while a send runs (D1) or a busy action is in flight (D2): the page then commits
 * nothing and keeps its marks, and the loop makes another attempt once `settled` resolves. A condition that is not
 * observable as an event (a stream removed, a busy token released) is re-checked on a timer.
 */

/** How often a deferral re-checks its condition. */
export const DEFER_RECHECK_MS = 1000

/** How long a send-class deferral lasts before the status line says why this page is not saving. */
export const D1_STATUS_AFTER_MS = 30_000

/** A busy action older than this is treated as stuck: the fast-forward parks instead of waiting for it. */
export const D2_BUSY_MAX_MS = 2 * 60 * 60_000

export type DeferClass = 'd1' | 'd2'

/** Resolves once `ready()` is true, checked now and then every `DEFER_RECHECK_MS`; `onSlow` is called once after `slowAfterMs`. */
export function settledWhen(ready: () => boolean, options: { slowAfterMs?: number, onSlow?: () => void, now: () => number }): Promise<void> {
    const startedAt = options.now()
    let slowTold = false
    return new Promise<void>((resolve) => {
        const check = (): void => {
            if (ready()) {
                resolve()
                return
            }
            if (!slowTold && options.slowAfterMs !== undefined && options.now() - startedAt >= options.slowAfterMs) {
                slowTold = true
                options.onSlow?.()
            }
            setTimeout(check, DEFER_RECHECK_MS)
        }
        setTimeout(check, DEFER_RECHECK_MS)
    })
}

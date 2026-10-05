/**
 * `RisuSaveEncoder.encodeRawBlock` awaits `maybeYield()` after every block it
 * encodes. Encoding a block crosses no macrotask boundary by itself, so
 * without a yield a `set()` or `init()` over many blocks would run as a single
 * long task. `createYieldBudget` gives each `RisuSaveEncoder` instance a
 * small, independently-testable budget: `maybeYield` yields to the event loop
 * only after roughly `budgetMs` has elapsed since the last yield, so a run of
 * blocks yields periodically without paying a yield's cost on every block.
 * `noteYielded` resets the clock for a caller that has just crossed a
 * macrotask boundary itself.
 */

export type YieldBudgetOptions = {
    budgetMs?: number
    now?: () => number
    yieldFn?: () => Promise<void>
}

export type YieldBudget = {
    /** Call after a real (non-skipped) write resolves, resetting the clock. */
    noteYielded(): void
    /** Yields (and resets the clock) only once `budgetMs` has elapsed since the last reset. */
    maybeYield(): Promise<void>
}

export function createYieldBudget(opts: YieldBudgetOptions = {}): YieldBudget {
    const budgetMs = opts.budgetMs ?? 8
    const now = opts.now ?? (() => performance.now())
    const yieldFn = opts.yieldFn ?? yieldToEventLoop
    let last = now()
    return {
        noteYielded() {
            last = now()
        },
        async maybeYield() {
            if (now() - last >= budgetMs) {
                await yieldFn()
                last = now()
            }
        },
    }
}

/**
 * Yields one turn to the event loop. Prefers `scheduler.yield()` (a real,
 * high-priority continuation point) where available, falling back to a
 * `MessageChannel` message, which is not subject to the timer clamping that
 * makes `setTimeout(0)` cost about 6 ms per call in Chromium (browsers clamp
 * nested timeouts). `setTimeout(0)` is used only as
 * a last resort, when `MessageChannel` itself is unavailable.
 */
export async function yieldToEventLoop(): Promise<void> {
    const scheduler = (globalThis as any).scheduler
    if (scheduler?.yield) {
        await scheduler.yield()
        return
    }
    if (typeof MessageChannel !== 'undefined') {
        await new Promise<void>((resolve) => {
            const channel = new MessageChannel()
            channel.port1.onmessage = () => {
                channel.port1.close()
                channel.port2.close()
                resolve()
            }
            channel.port2.postMessage(undefined)
        })
        return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

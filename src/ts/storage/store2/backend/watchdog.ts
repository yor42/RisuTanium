/**
 * Bound on how long a backend transaction may run without completing or
 * failing. Past it the step is reported as an unknown outcome, never as success:
 * a transaction that hangs may still commit later.
 */
export const DEFAULT_TRANSACTION_WATCHDOG_MS = 30_000

/**
 * Arms a one-shot timer that calls `onExpire` after `ms`. Returns the function
 * that disarms it; the caller disarms on completion, abort or error so an
 * expiry never follows a decided step.
 */
export function armWatchdog(ms: number, onExpire: () => void): () => void {
    const timer = setTimeout(onExpire, ms)
    return () => clearTimeout(timer)
}

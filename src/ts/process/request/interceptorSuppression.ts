/**
 * Marks the abort signals of runs whose requests plugin body interceptors must not see. A run that offers workspace
 * tools registers its own signal; every request and tool follow-up of that run carries the same signal object, so the
 * transport checks the signal it was handed. Membership is by identity: a request with another signal (a derived
 * signal, none at all) is never suppressed, so a missed registration keeps the interceptors running instead of
 * silently skipping them for an unrelated request.
 */
const suppressed = new WeakSet<AbortSignal>()

/** Registers `signal`; the interceptors skip every request that carries it. */
export function suppressInterceptorsFor(signal: AbortSignal): void {
    suppressed.add(signal)
}

/** Whether the request carrying `signal` skips the plugin body interceptors. */
export function interceptorsSuppressed(signal: AbortSignal | null | undefined): boolean {
    return signal !== null && signal !== undefined && suppressed.has(signal)
}

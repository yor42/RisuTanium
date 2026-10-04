const wrapped = new WeakMap<object, Promise<unknown>>()

/**
 * Wraps a promise used in a Svelte `{#await}` expression so that a rejection is
 * logged once with `console.warn` before it reaches the block's `{:catch}`.
 *
 * - The returned promise rejects with the original reason, so the block's own
 *   rejection branch still runs and no unhandled rejection is raised.
 * - The same input promise always yields the same wrapper, so re-evaluating the
 *   expression neither warns twice nor makes Svelte restart the block.
 * - A value that is not a promise is returned unchanged.
 *
 * This runs as an ordinary call in the expression, so it behaves the same in
 * development and production builds.
 */
export function warnOnReject<T>(label: string, value: T | Promise<T>): T | Promise<T> {
    if (!(value instanceof Promise)) return value
    const cached = wrapped.get(value)
    if (cached) return cached as Promise<T>
    const result = value.catch((reason: unknown) => {
        console.warn(label, reason)
        throw reason
    })
    wrapped.set(value, result)
    return result
}

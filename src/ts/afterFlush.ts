import { flushSync } from 'svelte'

/**
 * Resolves once the pending Svelte updates are committed, before the next animation frame.
 *
 * Use it to move focus or to read or write scroll and layout after a state change: the DOM it acts on is
 * already updated, and the browser has not painted a frame in between. Svelte's own `tick()` is not a
 * substitute under `experimental.async`: there it resolves on the next animation frame or timer, so a focus
 * or scroll write behind it lands one frame late. `tick()` is still right where a frame of delay is wanted or
 * harmless, and in a test that waits for the app to settle.
 *
 * The body is one microtask hop followed by `flushSync()`, so the flush always runs after the caller's own
 * stack has unwound. That makes it legal wherever an `await` is legal: an event handler, an `$effect`, an
 * effect teardown, `onDestroy`. It must not be called while a `$derived` or a template expression is being
 * evaluated, and it must not wait in front of a save or other write path: it only commits pending UI work.
 */
export async function afterFlush(): Promise<void> {
    await Promise.resolve()
    flushSync()
}

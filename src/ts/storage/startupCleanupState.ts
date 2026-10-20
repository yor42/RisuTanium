/**
 * State of the startup clean-up (`cleanChunks` in bootstrap.ts on a legacy or
 * block page, the old-data deletion step of `store2/maintenance.ts` on a store2
 * page), kept in a module with no imports so any loader can wait on it without a
 * cycle. The store2 step records its promise when the step starts, never while it
 * waits for the page to be quiet, and the promise settles when the step ends.
 *
 * Invariant: a database load waits on the recorded promise so that the
 * startup clean-up cannot delete a remote block that a snapshot references
 * between that snapshot's validation and its write. There is something to
 * wait for only while the clean-up is pending: `getStartupCleanup()` is
 * `null` before anything is recorded and once the clean-up has settled.
 *
 * The promise it returns always fulfils, whether the clean-up resolved or
 * rejected, so waiting on it never throws. Recording attaches handlers to the
 * caller's promise, which marks a rejection of that promise as handled: the
 * page's `unhandledrejection` handler never sees it, so the caller must
 * report a failure of its own clean-up itself.
 */

let startupCleanup: Promise<void> | null = null

/**
 * Records the startup clean-up's promise. The recorded copy settles when the
 * clean-up does, on resolve and on reject alike.
 */
export function recordStartupCleanup(promise: Promise<unknown>): void {
    const recorded: Promise<void> = promise
        .then(
            () => undefined,
            () => undefined,
        )
        .then(() => {
            // A later recording replaces this one and stays pending on its own.
            if (startupCleanup === recorded) {
                startupCleanup = null
            }
        })
    startupCleanup = recorded
}

/**
 * The recorded startup clean-up as a promise that never rejects, or `null`
 * when nothing was recorded or the recorded clean-up has settled.
 */
export function getStartupCleanup(): Promise<void> | null {
    return startupCleanup
}

/** Test-only: returns the state to "not started". Production code never calls this. */
export function resetStartupCleanupForTests(): void {
    startupCleanup = null
}

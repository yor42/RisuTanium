/**
 * The page's database under Svelte's client state proxy with the real database write hook, so every element of
 * `db.characters` reads back as a state proxy, as `DBState.db` does in the running page. The fast-forward fixtures hand this
 * object to the page in place of the raw boot database.
 *
 * This is plain `.ts` on purpose: `proxy` is what the client compile emits for `$state({ db })`, so the host is the page's own
 * state object in every test environment, including `node`, where a `.svelte.ts` module would compile for the server and
 * hand the object back unproxied. In a `node` file the write hook's install-time self-check records
 * `dbWriteHook.selfCheck`; that is a known artifact of the host, and no row may depend on it.
 */
import { proxy } from 'svelte/internal/client'
import type { Database } from 'src/ts/storage/database.svelte'
import type { DbWriteMark } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook } from 'src/ts/storage/dbWriteHook'

export interface ProxiedDbOptions {
    /** Where the hook reports its marks; a test that wants the page's marks passes `markDbWrite`. */
    sink: (mark: DbWriteMark) => void
}

/** Errors the write hook reported through its error callback since the last `takeHookErrors`; nothing is dropped. */
const hookErrors: unknown[] = []

/** The hook-callback errors recorded so far, oldest first; the record is emptied. */
export function takeHookErrors(): unknown[] {
    return hookErrors.splice(0, hookErrors.length)
}

/**
 * `db` under a state proxy root with the real write hook installed; returns the root's live `db`. The host refuses to pass
 * off an unproxied object as a state host.
 */
export function proxiedDb(db: Database, options: ProxiedDbOptions): Database {
    const root: { db: Database } = proxy({ db })
    if (root.db === db) {
        throw new Error('The state host did not proxy the database.')
    }
    return installDbWriteHook(root, { sink: options.sink, onError: (error) => { hookErrors.push(error) }, selectedChaId: () => undefined }).db
}

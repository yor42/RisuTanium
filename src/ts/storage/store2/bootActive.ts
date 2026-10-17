import type { Database } from '../database.svelte'
import type { ByteStore } from '../store/contract'
import type { TooNewSource } from './boot'
import type { Store2Session } from './session'
import type { FlaggedLeaf } from './treeBytes'

/**
 * The seam that keeps the store2 boot unreachable until the page registers it. `bootstrap.ts` asks `getStore2Boot()`
 * right after the page store is ready and before it opens the legacy boot archive session: `null` runs the legacy boot
 * exactly as before, a function runs the store2 boot and its answer decides whether the legacy boot runs at all. `main.ts`
 * registers the real dispatch. This module holds two variables and imports types only, so the dispatch's module graph is
 * loaded only by a page that registers it.
 *
 * Ghost-write rule for the deleters that still reach the store from a store2 page (their rewrite belongs to the
 * collection stage; this module only records the rule they follow). The Tauri gate refuses only `store2-commit`,
 * `store2-fence` and `store2/` operations of a page that is no longer current; reads, plain writes such as the sweep age
 * record, and `assets/` removals are ungated. So (1) a sweep pass and every removal batch begin with
 * `session.openGate('sweep')` on fresh reads; (2) on Tauri, a gated freshness probe (the same-bytes `casCommit` rewrite
 * `reflushTopLevel` performs, which a stale page answers with `Store2StalePageError`) precedes every batch and the age
 * record write, and a stale answer stops the pass; (3) the age record's intersection rule bounds a ghost write: it can
 * only delay a removal, never make a young asset look old, and the window between the probe and a removal is accepted
 * because batches are small; (4) Node and IndexedDB have no stale-page notion, their compare tokens decide, so (1) alone
 * applies.
 */

/** What the page hands the dispatch: its byte store and the two questions the dispatch cannot answer itself. */
export interface Store2BootEnv {
    store: ByteStore
    /** Whether the upstream main file exists, including one the store holds but cannot hand out as bytes. A rejection means unknown. */
    upstreamMainFile: () => Promise<boolean>
    /** The numbered backups, newest first, without pruning anything. */
    listBackupTimes: () => Promise<number[]>
}

/** Why a legacy profile is opened without any write. */
export type Store2LegacyReadOnlyReason = 'opfs-transitional' | 'server-capability' | 'backend-unavailable'

/** A notice the dispatch raises through its UI port. Informational ones are fire-and-forget. */
export type Store2BootNotice =
    | { name: 'seeded' }
    | { name: 'cleanup-blocked' }
    | { name: 'reflush-failed', detail: string }
    | { name: 'flush-unconfirmed' }
    | { name: 'too-new', source: TooNewSource, detail: string }
    | { name: 'server-capability' | 'backend-unavailable', detail: string }
    | { name: 'convert-unavailable' }
    /** A tree has leaves that failed the unit check; the build cannot open it yet and writes nothing. */
    | { name: 'incomplete-unavailable', items: readonly FlaggedLeaf[] }

/**
 * What the dispatch decided.
 *   store2:          a store2 profile is open. `database` is installed by the shared boot tail; the legacy boot is skipped.
 *   legacy-readonly: the legacy profile is opened by the legacy read path, with no archive pass, no block owner and no
 *                    write other than the Tauri owner id that opening the session stores. `reason` says which store condition caused it.
 *   stopped:         nothing is installed and `loadedStore` stays unset; the dispatch has shown why through its UI port.
 */
export type Store2BootResult =
    | { kind: 'store2', database: Database, session: Store2Session, notices: readonly Store2BootNotice[] }
    | { kind: 'legacy-readonly', reason: Store2LegacyReadOnlyReason }
    | { kind: 'stopped' }

export type Store2Boot = (env: Store2BootEnv) => Promise<Store2BootResult>

let registered: Store2Boot | null = null
let current: Store2Session | null = null

export function registerStore2Boot(boot: Store2Boot | null): void {
    registered = boot
}

export function getStore2Boot(): Store2Boot | null {
    return registered
}

/** The dispatch's single current session: every earlier one is dropped when the dispatch opens the next. */
export function setStore2BootSession(session: Store2Session | null): void {
    current = session
}

export function getStore2BootSession(): Store2Session | null {
    return current
}

export function resetStore2BootForTest(): void {
    registered = null
    current = null
}

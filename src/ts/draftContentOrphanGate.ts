// Report 20 §6: the multi-tab-gate half of durable drafts. `draftContents.ts`
// documents itself as deliberately blind to `localDrafts.ts` -- this module
// is what its own header comment describes as layered on top of that store
// from the outside. It gives content-store activity a voice in
// the multi-tab gate (`hasLocalDrafts()`) without ever letting it touch the
// chat-window-reset gate (`hasMessageEditorDrafts()`), by registering under
// a kind that is explicitly never `'message'`.
//
// Two bounds stay separate (§6.1), and this module only ever owns one of
// them: it removes *registrations* (`localDrafts` entries). It never
// deletes a *record* from the wrapped store -- that store's own LRU bound
// (`DRAFT_CONTENT_RECORD_LIMIT` in `draftContents.ts`) is the only thing
// that ever evicts a record, so recoverable text outlives the gate hold, as
// §1 promises.
//
// Chat.svelte's §5 input-event capture functions call through THIS module's
// store, not `draftContents.ts` directly -- `draftContents.ts` exports only the
// `createDraftContentStore` factory and its types, never a ready-made
// instance, precisely so calling straight into the raw store (which would
// silently skip orphan registration and the cap, since `draftContents.ts`
// itself never touches `localDrafts`) type-checks as an error rather than a
// silent behavioural skip.

import { registerDraft, unregisterDraft, type DraftKind } from './localDrafts'
import {
    createDraftContentStore,
    draftIdentityKey,
    DRAFT_CONTENT_RECORD_LIMIT,
    type DraftContentStore,
    type DraftIdentity,
    type DraftRecord,
} from './draftContents'

// An alias for the existing 'other' kind -- NOT a new `DraftKind` union
// member (§3 commits to leaving `localDrafts`'s shape unchanged). Reusing
// `HYPA_DRAFT_KIND` directly would be misleading about what is actually
// holding the gate, so this stage exports its own named constant.
export const DRAFT_CONTENT_ORPHAN_KIND: DraftKind = 'other'

// "Briefly" (the maintainer's word, §6): long enough that a peer tab's own
// save has a real window to land and clear `dirty` before the gate would
// have released anyway, short enough that a closed editor's leftover text
// does not park the multi-tab gate for the rest of the session. The plan
// does not specify an exact figure -- this is an implementation choice,
// flagged as such, and kept injectable below so no test depends on real
// wall-clock time.
export const DRAFT_CONTENT_ORPHAN_CAP_MS = 60_000

export interface OrphanRegisteringDraftStore extends DraftContentStore {
    /**
     * Files or updates a record (as `DraftContentStore.set` does) and also
     * (re-)registers/(re-)stamps the orphan. `now` defaults to `Date.now()`
     * and exists only so tests never depend on real wall-clock time.
     */
    set(identity: DraftIdentity, text: string, baseData: string, now?: number): void
    /**
     * Releases every registration whose stamp is at least `capMs` old, as of
     * `now`. Meant to be called from the caller's own ~500ms save loop
     * (§6) rather than driven by a per-record timer, so there is no timer to
     * leak. Never touches a record in the wrapped store -- only the
     * registration (§6.1).
     */
    sweepExpiredRegistrations(now: number): void
}

/**
 * Wraps a `DraftContentStore` so that creating, updating, explicitly
 * deleting, or read-triggered pruning of a record also drives the
 * corresponding `localDrafts` registration, entirely from the outside --
 * `store` itself is never mutated to know about `localDrafts`.
 */
export function createOrphanRegisteringDraftStore(
    store: DraftContentStore,
    deps: { capMs: number }
): OrphanRegisteringDraftStore {
    // key -> the time it was last (re-)armed. Only ever holds keys this
    // wrapper itself registered, so `sweepExpiredRegistrations` never
    // touches a registration made by anything else (e.g. an open editor's
    // own `'message'`-kind key from Chat.svelte).
    const stamps = new Map<string, number>()

    function register(identity: DraftIdentity, now: number): void {
        const key = draftIdentityKey(identity)
        // The kind MUST be passed explicitly here (§6). Omitting it takes
        // `registerDraft`'s `'message'` default, which would pin
        // `hasMessageEditorDrafts()` true forever -- precisely the failure
        // §3.1 warns about. `draftContentOrphanGate.test.ts` pins this
        // (`set() registers an orphan under a non-"message" kind`).
        registerDraft(key, DRAFT_CONTENT_ORPHAN_KIND)
        stamps.set(key, now)
    }

    function release(identity: DraftIdentity): void {
        const key = draftIdentityKey(identity)
        stamps.delete(key)
        // Safe even if this wrapper never registered `key` (e.g. a plain
        // miss on `get`) -- `unregisterDraft` is a documented no-op then.
        unregisterDraft(key)
    }

    function set(identity: DraftIdentity, text: string, baseData: string, now: number = Date.now()): void {
        store.set(identity, text, baseData)
        // A create AND an update both re-arm the stamp (§6: "an update
        // re-arms the stamp") -- there is only one code path here, so a
        // second `set` on an existing identity always resets the clock.
        register(identity, now)
    }

    function get(identity: DraftIdentity, currentBaseData: string): DraftRecord | undefined {
        const result = store.get(identity, currentBaseData)
        if (result === undefined) {
            // Either a plain miss (nothing was ever registered under this
            // identity; `release` is a safe no-op) or the base-text mismatch
            // above just deleted the record (§4.2) -- either way, no
            // registration may survive a record that is no longer there.
            release(identity)
        }
        return result
    }

    function del(identity: DraftIdentity): void {
        store.delete(identity)
        release(identity)
    }

    function clear(): void {
        for (const key of stamps.keys()) {
            unregisterDraft(key)
        }
        stamps.clear()
        store.clear()
    }

    function size(): number {
        return store.size()
    }

    function sweepExpiredRegistrations(now: number): void {
        for (const [key, stampedAt] of stamps) {
            if (now - stampedAt >= deps.capMs) {
                stamps.delete(key)
                // Releases the *registration* only (§6.1) -- the record
                // stays in `store`, governed solely by its own LRU bound.
                unregisterDraft(key)
            }
        }
    }

    return { set, get, delete: del, clear, size, sweepExpiredRegistrations }
}

// Production singleton: every input-event capture function depends on this.
// `draftContents.ts` deliberately exports no ready-made instance of its own
// (only the factory), so this is the only place the production content store
// is constructed -- making it impossible to reach the raw, unwrapped store
// by accident.
export const draftContentOrphanGate = createOrphanRegisteringDraftStore(
    createDraftContentStore({ maxRecords: DRAFT_CONTENT_RECORD_LIMIT }),
    { capMs: DRAFT_CONTENT_ORPHAN_CAP_MS }
)

// A plain module-scope registry of in-progress, uncommitted, component-local
// drafts (text the user has started editing but not yet committed into
// `DBState.db`). Deliberately NOT a rune and NOT derived from `DBState`: this
// value is read from `saveDb()`'s plain `while (true)` loop body in
// globalApi.svelte.ts, which sits outside the `$effect.root(...)` block that
// drives the save loop's dirty tracking. Making this reactive would re-enter
// that effect graph for no benefit -- a plain `Set`/`Map` read has no such
// effect.
//
// Each registration also carries a `DraftKind`, so a message editor's draft
// (which must block the chat-window reset, Stage A of the chat-list-window
// plan) can be told apart from the composer's and HypaV3's, which must not.
// `'message'` is the default kind: any registration a future change forgets
// to classify still blocks the reset, erring towards today's behaviour and
// never towards edit loss. `hasLocalDrafts()` keeps its original meaning --
// true while any kind is registered -- because the multi-tab reload gate in
// globalApi.svelte.ts still needs "any draft at all", not just message
// drafts.
//
// Keys are expected to be generated per component instance (e.g. `v4()` from
// the `uuid` package -- NOT `crypto.randomUUID()`, which is spec'd
// `[SecureContext]` and is `undefined` on a non-secure origin, including
// plain-HTTP LAN self-hosting, a supported deployment for this project),
// never derived from an index or id. A derived key
// like `chat-edit-${idx}` would collide across a remount at the same index:
// instance A registers, B mounts and registers the same key, A's teardown
// deletes it, and B's still-live draft is silently left unprotected.

export type DraftKind = 'message' | 'composer' | 'other'

const MESSAGE_DRAFT_KIND: DraftKind = 'message'
export const COMPOSER_DRAFT_KIND: DraftKind = 'composer'
export const HYPA_DRAFT_KIND: DraftKind = 'other'

const localDrafts = new Map<string, DraftKind>()
const draftsChangedListeners = new Set<() => void>()

function notifyDraftsChanged(): void {
    for (const listener of draftsChangedListeners) {
        listener()
    }
}

export function registerDraft(key: string, kind: DraftKind = MESSAGE_DRAFT_KIND): void {
    // Re-registering the same key with the same kind is a no-op: nothing
    // actually changed, so listeners must not be notified again.
    if (localDrafts.get(key) === kind) {
        return
    }

    localDrafts.set(key, kind)
    notifyDraftsChanged()
}

export function unregisterDraft(key: string): void {
    // Deleting a key that was never registered (or already removed) is a
    // no-op -- safe by construction, no guard needed. `Map.delete` reports
    // whether it actually removed something, so listeners fire only on a
    // real change.
    if (localDrafts.delete(key)) {
        notifyDraftsChanged()
    }
}

export function hasLocalDrafts(): boolean {
    return localDrafts.size > 0
}

export function hasMessageEditorDrafts(): boolean {
    for (const kind of localDrafts.values()) {
        if (kind === MESSAGE_DRAFT_KIND) {
            return true
        }
    }
    return false
}

// Subscribes to changes in the draft set (a registration or unregistration
// that actually changed something). Returns an unsubscribe function.
export function onDraftsChanged(listener: () => void): () => void {
    draftsChangedListeners.add(listener)
    return () => {
        draftsChangedListeners.delete(listener)
    }
}

// Test-only reset hook, mirroring the pattern other module-scope stores use
// (see localDrafts.test.ts). Clears both the draft map and the listener set
// so tests start from a pristine module every time.
export function resetLocalDraftsForTest(): void {
    localDrafts.clear()
    draftsChangedListeners.clear()
}

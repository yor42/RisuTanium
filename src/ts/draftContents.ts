// Report 20's content store: the second of the two maps in the durable-drafts
// plan's §3. `localDrafts.ts` keys on a per-component-instance id and only
// ever answers "is anything being edited right now" -- it is deliberately
// blind to content. This module is the opposite: it is keyed by the
// *message's* (or translation's) identity, so a record outlives the editor
// instance that wrote it and can be offered back the next time the same
// identity is opened, even after an involuntary unmount.
//
// This module has no Svelte dependency and no import of `localDrafts.ts`.
// Registering the multi-tab-gate orphan key for a record (§6 of the plan) is
// layered on top of this store from the outside, by `draftContentOrphanGate.ts`.

// A frozen identity for the main message editor (chat window and
// `BookmarkList` both use it). `chatId` is `undefined` for a message that has
// not yet been backfilled with one (the "+" button, `/send`, `/sendas`, a
// group's first-message add, and trigger pushes all reach the DB this way).
export interface MessageIdentity {
    kind: 'msg'
    /** Identifies the chat the message lives in. Opaque to this module. */
    chatKey: string
    chatId: string | undefined
    /**
     * The message's index at freeze time. Never part of the key when
     * `chatId` is present (§4.1) -- deleting or inserting a message above
     * the edited one shifts the index while `chatId` is preserved, and a
     * keyed-on-index record would go unreachable across that shift. It *is*
     * the key when `chatId` is absent, because nothing else identifies the
     * message yet.
     */
    index: number
}

// A frozen identity for the translation editor. `key` is the existing
// content-derived translation cache key (`getLLMCache`/`setLLMCache`'s key,
// pre-existing and ambiguous the same way today, §4.3) -- not a `chatId`.
export interface TranslationIdentity {
    kind: 'tr'
    key: string
}

export type DraftIdentity = MessageIdentity | TranslationIdentity

export interface DraftRecord {
    text: string
    /**
     * The base text this draft was made against: `message`'s data for a
     * `msg:` record, and the source text the translation was made from (not
     * the cached translation itself) for a `tr:` record. Compared against
     * the current base text on every read; a mismatch deletes the record
     * (§4.2), so a draft is never restored onto text it was not written
     * against.
     */
    baseData: string
    /**
     * The `now()` value at the moment this record was last `set` (created or
     * updated) -- never re-stamped by a mere `get`. §5.4 / MC-068's restore
     * marker formats this into "how long ago" text via `formatDraftAge`.
     */
    updatedAt: number
}

interface StoredRecord extends DraftRecord {
    /** Kept for introspection/debugging only -- never part of any key. */
    index?: number
}

// Namespacing is mandatory (§4): a content-derived `tr:` key must not be
// able to collide with a `msg:` key string, and the two message-identity
// shapes (chatId-keyed vs. index-keyed) must not collide with each other
// either -- see the three-way split below.
export function draftIdentityKey(identity: DraftIdentity): string {
    if (identity.kind === 'tr') {
        return `tr:${identity.key}`
    }
    if (identity.chatId !== undefined) {
        return `msg:id:${identity.chatKey}:${identity.chatId}`
    }
    return `msg:idx:${identity.chatKey}:${identity.index}`
}

// The key a chatId-bearing message identity *would* have had before its
// chatId was backfilled. Used only to find and delete a stale, orphaned
// index-keyed record on a miss (§4.1) -- never to restore from it.
function orphanIndexKey(identity: MessageIdentity): string {
    return `msg:idx:${identity.chatKey}:${identity.index}`
}

export interface DraftContentStore {
    /**
     * Looks up the record filed under `identity`. Returns the record only
     * when one exists and its stored `baseData` equals `currentBaseData`
     * (§5.3's seeding precedence rests on this). A mismatch deletes the
     * record and returns `undefined`.
     *
     * For a chatId-bearing message identity whose chatId-keyed lookup
     * misses, also deletes (without ever returning) any record still filed
     * under the pre-backfill index key for the same (chatKey, index) --
     * §4.1's "deleted, not bridged to". This is not an index fallback: the
     * record found this way is never used to satisfy the read.
     */
    get(identity: DraftIdentity, currentBaseData: string): DraftRecord | undefined
    /** Files or updates a record, marking it most-recently-used. */
    set(identity: DraftIdentity, text: string, baseData: string): void
    /** Deletes a record explicitly (e.g. a §5.4 revert), regardless of baseData. */
    delete(identity: DraftIdentity): void
    /** Deletes every record. Test/reset use only. */
    clear(): void
    /** The number of records currently held. */
    size(): number
}

// Strips `index` (internal-only, kept on `StoredRecord` for introspection --
// see its own comment) before a record leaves this module, so callers only
// ever see the public `DraftRecord` shape.
function toPublicRecord(record: StoredRecord): DraftRecord {
    return { text: record.text, baseData: record.baseData, updatedAt: record.updatedAt }
}

export function createDraftContentStore(deps: { maxRecords: number; now?: () => number }): DraftContentStore {
    // Late-bound: `Date.now` itself (not wrapped) would capture whatever
    // function object `Date.now` currently is AT CONSTRUCTION TIME (module
    // load, for the production singleton in `draftContentOrphanGate.ts`) --
    // long before a test's `vi.useFakeTimers()` replaces the global `Date`.
    // Wrapping the lookup in a closure defers reading `Date.now` to each
    // call, so it always sees whatever `Date` (real or faked) is current.
    const now = deps.now ?? (() => Date.now())
    // Insertion-ordered by construction: re-inserting an existing key (via
    // delete-then-set, in `touch`) moves it to the end, so the map's
    // iteration order is oldest-first -- exactly what LRU eviction needs.
    const records = new Map<string, StoredRecord>()

    function touch(key: string, value: StoredRecord): void {
        records.delete(key)
        records.set(key, value)
    }

    function evictIfOverBound(): void {
        while (records.size > deps.maxRecords) {
            const oldestKey = records.keys().next().value
            if (oldestKey === undefined) {
                break
            }
            records.delete(oldestKey)
        }
    }

    function get(identity: DraftIdentity, currentBaseData: string): DraftRecord | undefined {
        const key = draftIdentityKey(identity)
        const record = records.get(key)

        if (record !== undefined) {
            if (record.baseData !== currentBaseData) {
                records.delete(key)
                return undefined
            }
            // A hit renews recency but must never itself clear the record --
            // an involuntary unmount-then-remount with no deliberate exit in
            // between must still find it on the next open.
            touch(key, record)
            return toPublicRecord(record)
        }

        if (identity.kind === 'msg' && identity.chatId !== undefined) {
            const staleKey = orphanIndexKey(identity)
            records.delete(staleKey)
        }
        return undefined
    }

    function set(identity: DraftIdentity, text: string, baseData: string): void {
        const key = draftIdentityKey(identity)
        const stored: StoredRecord = {
            text,
            baseData,
            updatedAt: now(),
            index: identity.kind === 'msg' ? identity.index : undefined,
        }
        touch(key, stored)
        evictIfOverBound()
    }

    function del(identity: DraftIdentity): void {
        records.delete(draftIdentityKey(identity))
    }

    function clear(): void {
        records.clear()
    }

    function size(): number {
        return records.size
    }

    return { get, set, delete: del, clear, size }
}

// Drafts are short strings, so a generous bound costs little and makes
// unbounded growth impossible regardless of what the user reopens (§6.1).
// Registrations (the multi-tab-gate half of §6) are time-capped separately,
// by `draftContentOrphanGate.ts`'s own wrapper (`DRAFT_CONTENT_ORPHAN_CAP_MS`).
export const DRAFT_CONTENT_RECORD_LIMIT = 200

// §5.4 / MC-068's surfaced rule: a base-data match alone is not enough to
// call a record a "restore" -- Chat.svelte's capture functions delete the
// record (rather than writing it) whenever a user edit's value equals the
// seed the editor would have used anyway, so an editor nobody typed into
// never leaves a record behind, and a record only counts as a restore when
// its text also differs from that seed.
//
// Deliberately pure and identity-agnostic: what "the editor would have
// seeded anyway" means differs per caller (the message text for the main
// editor, the cached translation -- not `baseData` -- for the translation
// editor, per §4.2/MC-068's refinement) and this module has no opinion on
// either. Callers own the corresponding `delete` when this returns false, so
// the no-op record is pruned rather than left to be offered again.
export function isDraftRestore(record: DraftRecord, seedText: string): boolean {
    return record.text !== seedText
}

// Deliberately no ready-made singleton here (§6's implementation notes): a
// `draftContents` instance exported from this module would satisfy
// `DraftContentStore` just as well as `draftContentOrphanGate` does, so
// importing it directly would type-check cleanly while silently skipping
// orphan registration and the cap. `draftContentOrphanGate.ts` builds the
// one production instance from `createDraftContentStore` itself; every
// caller must go through that module's `draftContentOrphanGate` export
// instead.

import { SvelteMap } from 'svelte/reactivity'

/**
 * The composer's per-chat records: the module-level store the composer reads
 * and writes directly, with no per-instance mirror. A chat's key is its
 * owner's `chaId` plus its own `chat.id` -- never an index or an object
 * identity, and never `chatWindowKey`'s id-less `WeakMap` fallback, so two
 * chats (or two owners) that happen to share both ids share one record
 * (`MC-102` 2). Showing a chat never creates, modifies or re-timestamps its
 * record; only a write to one of its three fields does.
 */
export interface ComposerDraftKey {
    chaId: string
    chatId: string
}

/** A record's own three fields, each `$state` so a bound textarea or the
 * template re-renders on every field write, whoever makes it. */
export interface ComposerDraftRecord {
    messageInput: string
    messageInputTranslate: string
    fileInput: string[]
}

/** A copy of a record's three fields, detached from the record's own
 * reactive state -- what `take` hands to a caller that must hold the values
 * across an `await` without the record's own fields changing under it. */
export interface ComposerDraftSnapshot {
    messageInput: string
    messageInputTranslate: string
    fileInput: string[]
}

function keyString(key: ComposerDraftKey): string {
    return `${key.chaId}::${key.chatId}`
}

function createRecord(): ComposerDraftRecord {
    const record = $state({
        messageInput: '',
        messageInputTranslate: '',
        fileInput: [] as string[],
    })
    return record
}

function isEmptyRecord(record: ComposerDraftRecord): boolean {
    return record.messageInput === '' && record.messageInputTranslate === '' && record.fileInput.length === 0
}

// The view shown for a key with no stored record. Frozen so an accidental
// direct mutation (rather than going through `write`) throws immediately
// instead of silently editing a value nothing will ever persist or show
// again under any other key.
export const EMPTY_DRAFT_VIEW: ComposerDraftRecord = Object.freeze({
    messageInput: '',
    messageInputTranslate: '',
    fileInput: Object.freeze([]) as string[],
})

// A reactive Map, not a plain one: a reactive reader of `peek(key)` -- a
// `$derived` or an `$effect` over it -- must re-run once `write` first
// creates that key's record, even though nothing about the key itself
// changed. A plain Map's `.get` carries no dependency of its own, so such a
// reader would stay on the empty view forever; only the record's own
// fields (not the Map's key set) would be reactive otherwise.
const records = new SvelteMap<string, ComposerDraftRecord>()

// The composer's own bound on stored records. Independent of
// `DRAFT_CONTENT_RECORD_LIMIT` (the message/translation editors' own cap in
// draftContents.ts): the two populations have different lifetimes and no
// shared owner.
const COMPOSER_DRAFT_RECORD_LIMIT = 200

// Counts every change to the stored records (each write, which covers take,
// putBack and eviction, and each restore). A caller that must know whether the
// records changed between two moments compares two readings.
let version = 0

export function composerDraftsVersion(): number {
    return version
}

// The key currently shown by the one live composer instance, so eviction
// never drops the record on screen. Sourced from `setOnScreenKey`, which the
// component calls from a plain bookkeeping effect -- it touches no record,
// so showing a chat is never mistaken for a write to it.
let onScreenKeyString: string | null = null

export function setOnScreenKey(key: ComposerDraftKey | null): void {
    onScreenKeyString = key ? keyString(key) : null
}

function evictIfOverCap(): void {
    while (records.size > COMPOSER_DRAFT_RECORD_LIMIT) {
        let victim: string | undefined
        for (const k of records.keys()) {
            if (k !== onScreenKeyString) {
                victim = k
                break
            }
        }
        if (victim === undefined) {
            // Every remaining record is the one on screen (impossible while
            // the cap is above 1, but never loop forever on it).
            break
        }
        records.delete(victim)
    }
}

/**
 * The record stored for `key`, or the shared, never-stored empty view when
 * there is none -- including when `key` itself is null (no chat object on
 * screen). Never creates or reorders a record.
 */
export function peek(key: ComposerDraftKey | null): ComposerDraftRecord {
    if (!key) {
        return EMPTY_DRAFT_VIEW
    }
    return records.get(keyString(key)) ?? EMPTY_DRAFT_VIEW
}

/**
 * The one path every write to a record goes through, including an in-place
 * edit of `fileInput` (`push`/`splice`): creates the record on first write,
 * marks it most-recently-written (protecting it from eviction and moving an
 * older record closer to it), and drops it at once if `updater` leaves all
 * three fields empty, so an emptied record never counts toward the cap or
 * outlives the write that emptied it.
 */
export function write(key: ComposerDraftKey, updater: (record: ComposerDraftRecord) => void): ComposerDraftRecord {
    version += 1
    const k = keyString(key)
    const record = records.get(k) ?? createRecord()
    updater(record)
    records.delete(k)
    if (isEmptyRecord(record)) {
        return record
    }
    records.set(k, record)
    evictIfOverCap()
    return record
}

/**
 * The take half of a send's ownership transfer: reads `key`'s record as a
 * detached snapshot and clears it in the same call, so the record is empty
 * (and, being all-empty, gone) the instant this returns.
 */
export function take(key: ComposerDraftKey): ComposerDraftSnapshot {
    const current = peek(key)
    const snapshot: ComposerDraftSnapshot = {
        messageInput: current.messageInput,
        messageInputTranslate: current.messageInputTranslate,
        fileInput: [...current.fileInput],
    }
    write(key, (record) => {
        record.messageInput = ''
        record.messageInputTranslate = ''
        record.fileInput = []
    })
    return snapshot
}

/**
 * The put-back half: each of `taken`'s fields is prefixed onto whatever
 * `key`'s record already holds -- a late result that landed there first is
 * never displaced -- and the taken files go in front of the record's own.
 * Writes to `key`'s own record, whether or not it is on screen and
 * whichever composer instance, if any, is mounted.
 */
export function putBack(key: ComposerDraftKey, taken: ComposerDraftSnapshot): void {
    write(key, (record) => {
        record.messageInput = taken.messageInput + record.messageInput
        record.messageInputTranslate = taken.messageInputTranslate + record.messageInputTranslate
        record.fileInput = [...taken.fileInput, ...record.fileInput]
    })
}

/** A stored record with the key string it is stored under, as it is carried across a page reload. */
export interface ComposerDraftCarry extends ComposerDraftSnapshot {
    key: string
}

/** Every non-empty record, oldest write first, as detached copies. */
export function exportRecords(): ComposerDraftCarry[] {
    const carried: ComposerDraftCarry[] = []
    for (const [key, record] of records) {
        if (!isEmptyRecord(record)) {
            carried.push({
                key,
                messageInput: record.messageInput,
                messageInputTranslate: record.messageInputTranslate,
                fileInput: [...record.fileInput],
            })
        }
    }
    return carried
}

/**
 * Puts a carried record back under its own key, only when that key holds no
 * text: whatever is there is newer than the carried copy and stays. Returns
 * whether the record was stored. Callers restore oldest first; the store's own
 * cap evicts from the oldest end.
 */
export function restoreRecord(carried: ComposerDraftCarry): boolean {
    const existing = records.get(carried.key)
    if (existing && !isEmptyRecord(existing)) {
        return false
    }
    const record = createRecord()
    record.messageInput = carried.messageInput
    record.messageInputTranslate = carried.messageInputTranslate
    record.fileInput = [...carried.fileInput]
    if (isEmptyRecord(record)) {
        return false
    }
    version += 1
    records.delete(carried.key)
    records.set(carried.key, record)
    evictIfOverCap()
    return true
}

/**
 * Test-only reset: drops every stored record and the on-screen key. Never
 * called from production code.
 */
export function resetComposerDraftsForTests(): void {
    records.clear()
    onScreenKeyString = null
    version = 0
}

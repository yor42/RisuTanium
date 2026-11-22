/**
 * Chat Draft Store
 *
 * The writer and reader of `DBState.db.chatDrafts` (store2 kind 30): the unsent edits of existing messages and the per-chat
 * long-chat hint flags. Typing only fills a pending overlay and restarts a trailing idle timer; the profile value is
 * written when the timer fires, when an editor closes, when the page is hidden, and at once for a delete or a flag. A write
 * assigns one top-level key, so a draft change marks a save pass and no character.
 *
 * Fail-open: a stored value this build cannot key is ignored or dropped at the next write, never thrown on, and no write
 * runs a reconcile. Only a character or chat removal, and the boot step, remove entries of chats that are gone.
 *
 * Import graph: this module reads `DBState`, the gate (to install its sink), the pure model and the hash, and nothing
 * else at module top level but the sink install, so an import cycle cannot reach an uninitialised binding.
 */

import { untrack } from 'svelte'
import { DBState } from './stores.svelte'
import { setDraftPersistSink } from './draftContentOrphanGate'
import type { DraftRecord, MessageIdentity } from './draftContents'
import { Sha256 } from './assetHash'
import { capChatDrafts, chatDraftKey, narrowChatDrafts, reconcileChatDrafts } from './chatDraftsModel'
import type { ChatDraftEntry, PersistedEditDraft } from './storage/database.svelte'

/** Quiet time after the last keystroke before a typed draft is written to the profile (a design default, not a product rule). */
export const CHAT_DRAFT_IDLE_MS = 3000

/** The 32 lowercase hex characters a draft stores for its base: the first 128 bits of SHA-256 over the text's UTF-8 bytes. */
export function chatDraftBaseDigest(text: string): string {
    return new Sha256().update(new TextEncoder().encode(text)).digestHex().slice(0, 32)
}

interface PendingDraft {
    text: string
    base: string
    at: number
}

/** `null` marks a draft deleted since the last write. */
interface PendingChat {
    cha: string
    chat: string
    drafts: Map<string, PendingDraft | null>
    shown: boolean
}

const pending = new Map<string, PendingChat>()
let idleTimer: ReturnType<typeof setTimeout> | null = null

function pendingChatOf(cha: string, chat: string): PendingChat {
    const key = chatDraftKey(cha, chat)
    let held = pending.get(key)
    if (held === undefined) {
        held = { cha, chat, drafts: new Map(), shown: false }
        pending.set(key, held)
    }
    return held
}

/** The message's key inside its chat's entry: its chat id when it has one, else its index. */
function messageKey(identity: MessageIdentity): string {
    return identity.chatId !== undefined ? `id:${identity.chatId}` : `idx:${identity.index}`
}

function cancelIdle(): void {
    if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
    }
}

function restartIdle(): void {
    cancelIdle()
    idleTimer = setTimeout(() => {
        idleTimer = null
        try {
            flushChatDrafts()
        } catch (error) {
            console.error(error)
        }
    }, CHAT_DRAFT_IDLE_MS)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The stored entries of one chat, read leniently; a repeated key keeps its newest draft per message. */
function storedEntriesOf(cha: string, chat: string): ChatDraftEntry[] {
    const value: unknown = DBState.db.chatDrafts
    if (!Array.isArray(value)) {
        return []
    }
    return narrowChatDrafts((value as unknown[]).filter((item) => isRecord(item) && item.cha === cha && item.chat === chat))
}

function storedDraftsOf(cha: string, chat: string): PersistedEditDraft[] {
    return storedEntriesOf(cha, chat).flatMap((entry) => entry.drafts ?? [])
}

function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Writes the pending overlay (and `transform`, when given) into `DBState.db.chatDrafts` at once: reads the stored value
 * leniently, applies the overlay, applies the cap, drops entries with neither draft nor flag, sorts, and assigns the key only
 * when the value changed (deleting it when empty). Runs untracked, because it is called from effect cleanups and effects.
 * Returns whether it assigned.
 */
function commit(transform?: (entries: ChatDraftEntry[]) => ChatDraftEntry[]): boolean {
    return untrack(() => {
        cancelIdle()
        if (transform === undefined && pending.size === 0) {
            return false
        }
        const db = DBState.db
        const before: unknown = db.chatDrafts
        const byKey = new Map<string, ChatDraftEntry>()
        for (const entry of narrowChatDrafts(before)) {
            byKey.set(chatDraftKey(entry.cha, entry.chat), entry)
        }
        for (const [key, chat] of pending) {
            const next: ChatDraftEntry = { ...(byKey.get(key) ?? { cha: chat.cha, chat: chat.chat }) }
            const drafts = new Map<string, PersistedEditDraft>((next.drafts ?? []).map((draft) => [draft.m, draft]))
            for (const [m, record] of chat.drafts) {
                if (record === null) {
                    drafts.delete(m)
                } else {
                    drafts.set(m, { ...drafts.get(m), m, text: record.text, bh: chatDraftBaseDigest(record.base), at: record.at })
                }
            }
            if (drafts.size > 0) {
                next.drafts = [...drafts.values()]
            } else {
                delete next.drafts
            }
            if (chat.shown) {
                next.shown = true
            }
            byKey.set(key, next)
        }
        pending.clear()
        let list = [...byKey.values()]
        if (transform !== undefined) {
            list = transform(list)
        }
        list = capChatDrafts(list)
        list.sort((a, b) => compareText(a.cha, b.cha) || compareText(a.chat, b.chat))
        for (const entry of list) {
            if (entry.drafts !== undefined) {
                entry.drafts = [...entry.drafts].sort((a, b) => compareText(a.m, b.m))
            }
        }
        if (JSON.stringify(list) === JSON.stringify(before ?? [])) {
            return false
        }
        if (list.length === 0) {
            delete db.chatDrafts
        } else {
            db.chatDrafts = list
        }
        return true
    })
}

/**
 * Writes every pending draft and flag into the profile now and cancels the idle timer. Returns whether the profile value
 * changed, which is what the hide path needs to know to save. Runs no reconcile.
 */
export function flushChatDrafts(): boolean {
    return commit()
}

/** Removes one draft at once. Does nothing, and writes nothing, when neither the overlay nor the profile holds it. */
function removeDraft(cha: string, chat: string, m: string): void {
    const inOverlay = pending.get(chatDraftKey(cha, chat))?.drafts.get(m) != null
    if (!inOverlay && !storedDraftsOf(cha, chat).some((draft) => draft.m === m)) {
        return
    }
    pendingChatOf(cha, chat).drafts.set(m, null)
    commit()
}

/**
 * The persisted draft of an original-message edit, when its base still equals the message text now. A draft whose base
 * differs is removed at once, and a chat-id-keyed miss removes the same chat's index-keyed entry for that position without
 * ever restoring from it. The result is never filed into the in-memory store, so its age stays the capture time.
 */
export function lookupPersistedEditDraft(identity: MessageIdentity, messageText: string): DraftRecord | undefined {
    const persist = identity.persist
    if (persist === undefined) {
        return undefined
    }
    return untrack(() => {
        const m = messageKey(identity)
        const waiting = pending.get(chatDraftKey(persist.chaId, persist.chatId))?.drafts.get(m)
        if (waiting) {
            if (waiting.base === messageText) {
                return { text: waiting.text, baseData: messageText, updatedAt: waiting.at }
            }
            removeDraft(persist.chaId, persist.chatId, m)
            return undefined
        }
        const held = storedDraftsOf(persist.chaId, persist.chatId).find((draft) => draft.m === m)
        if (held !== undefined) {
            if (held.bh === chatDraftBaseDigest(messageText)) {
                return { text: held.text, baseData: messageText, updatedAt: held.at }
            }
            removeDraft(persist.chaId, persist.chatId, m)
            return undefined
        }
        if (identity.chatId !== undefined) {
            removeDraft(persist.chaId, persist.chatId, `idx:${identity.index}`)
        }
        return undefined
    })
}

/** Whether the hint was already shown in this chat. Reads untracked, so an effect that asks does not depend on the value. */
export function isLongChatHintShown(cha: string, chat: string): boolean {
    return untrack(() => {
        if (pending.get(chatDraftKey(cha, chat))?.shown === true) {
            return true
        }
        return storedEntriesOf(cha, chat).some((entry) => entry.shown === true)
    })
}

/** Records that the hint was shown in this chat, written at once. */
export function markLongChatHintShown(cha: string, chat: string): void {
    pendingChatOf(cha, chat).shown = true
    commit()
}

/** Removes a deleted chat's entry and pending overlay at once. */
export function forgetChatDrafts(cha: string, chat: string): void {
    pending.delete(chatDraftKey(cha, chat))
    try {
        commit((entries) => entries.filter((entry) => !(entry.cha === cha && entry.chat === chat)))
    } catch (error) {
        console.error(error)
    }
}

/**
 * Removes the entries of chats the profile no longer has (a character or chat deleted for good, or an imported profile that
 * lacks them), applied over the pending overlay too. A trashed character and a cold stub keep theirs.
 */
export function reconcileChatDraftsNow(): boolean {
    try {
        return commit((entries) => [...reconcileChatDrafts(entries, DBState.db.characters)])
    } catch (error) {
        console.error(error)
        return false
    }
}

/** The start-of-page reconcile, for a writable page after the boot purge. */
export function reconcileChatDraftsAtBoot(): boolean {
    return reconcileChatDraftsNow()
}

setDraftPersistSink({
    set(identity, text, baseData, at) {
        const persist = identity.persist
        if (persist === undefined) {
            return
        }
        pendingChatOf(persist.chaId, persist.chatId).drafts.set(messageKey(identity), { text, base: baseData, at })
        restartIdle()
    },
    delete(identity) {
        const persist = identity.persist
        if (persist === undefined) {
            return
        }
        removeDraft(persist.chaId, persist.chatId, messageKey(identity))
    },
    flush: flushChatDrafts,
})

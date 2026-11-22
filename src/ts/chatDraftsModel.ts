/**
 * Chat Drafts Model
 *
 * The pure rules over the persisted unsent message edits and long-chat hint flags (`Database.chatDrafts`, store2 kind 30):
 * how an entry is keyed, how a stored value is read leniently, how counts for the `.bin` leave-out warning are taken, how
 * the 200-draft cap and a duplicate key are resolved, and which entries still belong to a chat of the profile.
 *
 * Fail-open by design: a value the profile holds in a shape this build cannot key is ignored here, never thrown on, so a
 * draft fault cannot stop an export, an import or a save. Imports only types, so any module may use it without a cycle.
 */

import type { ChatDraftEntry, PersistedEditDraft } from './storage/database.svelte'

/** The most drafts kept across all chats; the oldest by capture time go first (MC-3585). Hint flags do not count. */
export const CHAT_DRAFT_CAP = 200

/** The identity of one chat's entry: the character's `chaId` and the chat's id. */
export function chatDraftKey(cha: string, chat: string): string {
    return JSON.stringify([cha, chat])
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A draft a v1 reader can key: string `m`, `text` and `bh`, and a finite number `at`. Anything else is ignored. */
function narrowDraft(value: unknown): PersistedEditDraft | null {
    if (!isRecord(value) || typeof value.m !== 'string' || typeof value.text !== 'string' || typeof value.bh !== 'string' || typeof value.at !== 'number' || !Number.isFinite(value.at)) {
        return null
    }
    return value as PersistedEditDraft
}

/**
 * The entries of a stored value that this build can key, merged by chat: a repeated chat keeps the newest copy of each
 * message's draft (a tie keeps the first), its flag is the OR of the copies', and the other keys come from the later copy.
 * Entries without string `cha` and `chat`, and drafts without the v1 fields, are dropped. The input is never changed;
 * every object returned is a new object over the input's values.
 */
export function narrowChatDrafts(value: unknown): ChatDraftEntry[] {
    if (!Array.isArray(value)) {
        return []
    }
    const merged = new Map<string, { entry: ChatDraftEntry, shown: boolean, drafts: Map<string, PersistedEditDraft> }>()
    for (const item of value as unknown[]) {
        if (!isRecord(item) || typeof item.cha !== 'string' || typeof item.chat !== 'string') {
            continue
        }
        const key = chatDraftKey(item.cha, item.chat)
        let held = merged.get(key)
        if (held === undefined) {
            held = { entry: { ...item, cha: item.cha, chat: item.chat }, shown: false, drafts: new Map() }
            merged.set(key, held)
        } else {
            held.entry = { ...held.entry, ...item, cha: item.cha, chat: item.chat }
        }
        held.shown ||= item.shown === true
        for (const raw of Array.isArray(item.drafts) ? item.drafts as unknown[] : []) {
            const draft = narrowDraft(raw)
            if (draft === null) {
                continue
            }
            const before = held.drafts.get(draft.m)
            if (before === undefined || draft.at > before.at) {
                held.drafts.set(draft.m, draft)
            }
        }
    }
    const out: ChatDraftEntry[] = []
    for (const { entry, shown, drafts } of merged.values()) {
        if (shown) {
            entry.shown = true
        } else {
            delete entry.shown
        }
        const list = [...drafts.values()]
        if (list.length > 0) {
            entry.drafts = list
        } else {
            delete entry.drafts
        }
        out.push(entry)
    }
    return out
}

/**
 * What a `.bin` export leaves out of a stored value: the drafts and the chats whose hint flag is set. Counted over what
 * `narrowChatDrafts` reads, so an entry the build cannot key is not named as left out.
 */
export function countChatDrafts(value: unknown): { drafts: number, hintChats: number } {
    let drafts = 0
    let hintChats = 0
    for (const entry of narrowChatDrafts(value)) {
        drafts += entry.drafts?.length ?? 0
        if (entry.shown === true) {
            hintChats++
        }
    }
    return { drafts, hintChats }
}

/**
 * The entries with at most `CHAT_DRAFT_CAP` drafts: the newest by `at` stay, a tie goes to the later chat key then the
 * later `m`, and an entry left with neither a draft nor a flag is dropped. Order of the remaining entries is kept.
 */
export function capChatDrafts(entries: readonly ChatDraftEntry[], cap: number = CHAT_DRAFT_CAP): ChatDraftEntry[] {
    const all: { key: string, m: string, at: number }[] = []
    for (const entry of entries) {
        const key = chatDraftKey(entry.cha, entry.chat)
        for (const draft of entry.drafts ?? []) {
            all.push({ key, m: draft.m, at: draft.at })
        }
    }
    const dropped = new Set<string>()
    if (all.length > cap) {
        all.sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0) || (a.m < b.m ? 1 : a.m > b.m ? -1 : 0))
        for (const draft of all.slice(cap)) {
            dropped.add(`${draft.key}\n${draft.m}`)
        }
    }
    const out: ChatDraftEntry[] = []
    for (const entry of entries) {
        const key = chatDraftKey(entry.cha, entry.chat)
        const drafts = (entry.drafts ?? []).filter((draft) => !dropped.has(`${key}\n${draft.m}`))
        if (drafts.length === 0 && entry.shown !== true) {
            continue
        }
        const next: ChatDraftEntry = { ...entry }
        if (drafts.length > 0) {
            next.drafts = drafts
        } else {
            delete next.drafts
        }
        out.push(next)
    }
    return out
}

/** The part of a character slot the reconcile reads. A group is a slot too, and its chats are its own. */
export interface ChatDraftSlot {
    chaId?: string
    /** Set while the slot is a cold-storage stub: its chat list is a placeholder, so its entries cannot be judged. */
    coldstorage?: unknown
    chats?: readonly { id?: string }[]
}

/**
 * The entries that still belong to a chat of the profile. An entry stays when its `cha` names a cold stub (the real chat
 * ids are not loaded), or when its chat id is among the chat ids of every slot sharing that `chaId` taken together, so
 * two slots with one id never judge each other's chats missing. A trashed slot is still a slot, so its entries stay until
 * it is deleted for good (MC-3591). Returns the input array itself when nothing is dropped.
 */
export function reconcileChatDrafts(entries: readonly ChatDraftEntry[], slots: readonly ChatDraftSlot[]): readonly ChatDraftEntry[] {
    const known = new Map<string, { stub: boolean, chats: Set<string> }>()
    for (const slot of slots) {
        if (typeof slot?.chaId !== 'string') {
            continue
        }
        let held = known.get(slot.chaId)
        if (held === undefined) {
            held = { stub: false, chats: new Set() }
            known.set(slot.chaId, held)
        }
        if (Boolean(slot.coldstorage)) {
            held.stub = true
        }
        for (const chat of Array.isArray(slot.chats) ? slot.chats : []) {
            if (typeof chat?.id === 'string') {
                held.chats.add(chat.id)
            }
        }
    }
    const kept = entries.filter((entry) => {
        const held = known.get(entry.cha)
        return held !== undefined && (held.stub || held.chats.has(entry.chat))
    })
    return kept.length === entries.length ? entries : kept
}

/**
 * Where an original-message edit is kept across a restart: the owner's chaId and the chat's id, both non-empty strings.
 * Anything else (an idless chat, a missing owner id) gives none, and the edit stays memory-only.
 */
export function persistTargetOf(chaId: unknown, chatId: unknown): { chaId: string, chatId: string } | undefined {
    return typeof chaId === 'string' && chaId !== '' && typeof chatId === 'string' && chatId !== '' ? { chaId, chatId } : undefined
}

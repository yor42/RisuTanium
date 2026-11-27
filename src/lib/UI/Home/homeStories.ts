import type { Chat, Database } from '../../../ts/storage/database.svelte'
import { isHiddenSystemCharacter } from '../../../ts/hiddenCharacters'
import { stubDescription } from '../../../ts/process/coldCharacter'
import { storySnippet } from './storySnippet'

/**
 * The story shelf's data, as pure functions over the character list. Nothing
 * here loads a character or a chat: an archived entry's `chats` is never read.
 */

type Entry = Database['characters'][number]

/** The lead card plus five rows. */
export const STORY_CAP = 6

/** What the shelf keeps from the moment Home opened: strings only, no reference to the entry or chat. */
export interface FrozenStory {
    chaId: string
    chatLabel: string | null
    snippet: string
}

export interface ShelfStory {
    entry: Entry
    archived: boolean
    chatLabel: string | null
    snippet: string
}

/**
 * A character that has been opened: a numeric `lastInteraction` above 0.
 * Infinity and times past the Date range still count; they read as a future
 * time, and `storyTime`/`storyDateTime` keep them from throwing.
 */
export function isStory(entry: Entry | null | undefined): boolean {
    return !!entry && typeof entry.lastInteraction === 'number' && entry.lastInteraction > 0
}

/**
 * The chat a card names, which is the chat that opens: `chats[chatPage]`, else
 * the first chat. Null for an archived entry (its chats are a placeholder) and
 * for an entry without chats.
 */
export function currentChat(entry: Entry): Chat | null {
    if (entry.coldstorage) {
        return null
    }
    const chats = entry.chats
    if (!Array.isArray(chats) || chats.length === 0) {
        return null
    }
    return chats[entry.chatPage] ?? chats[0] ?? null
}

/** The stub's description, which a group (no creator notes of its own) does not have. */
function archivedSnippet(entry: Entry): string {
    return entry.type === 'group' ? '' : stubDescription(entry.creatorNotes)
}

/** The story entries, most recent first, one per chaId, at most `STORY_CAP`. */
function storyEntries(characters: ReadonlyArray<Entry>): Entry[] {
    // One pass, no full sort. Same filters as `recentCharacters` over the story
    // entries (`isStory` drops a NaN time before it reaches the comparator) and
    // the same order: later `lastInteraction` first, ties by list position.
    // Only the best entry per chaId can take a slot, so dedupe comes before the cap.
    const best = new Map<string, Ranked>()
    let order = 0
    for (const c of characters) {
        if (!isStory(c) || typeof c.chaId !== 'string' || isHiddenSystemCharacter(c) || c.trashTime) {
            continue
        }
        const candidate: Ranked = { c, order: order++ }
        const held = best.get(c.chaId)
        if (!held || storyBefore(candidate, held) < 0) {
            best.set(c.chaId, candidate)
        }
    }
    const top: Ranked[] = []
    for (const candidate of best.values()) {
        let at = top.length
        while (at > 0 && storyBefore(candidate, top[at - 1]) < 0) {
            at--
        }
        if (at >= STORY_CAP) {
            continue
        }
        top.splice(at, 0, candidate)
        if (top.length > STORY_CAP) {
            top.pop()
        }
    }
    return top.map((x) => x.c)
}

interface Ranked {
    c: Entry
    order: number
}

function storyBefore(a: Ranked, b: Ranked): number {
    return ((b.c.lastInteraction ?? 0) - (a.c.lastInteraction ?? 0)) || (a.order - b.order)
}

export function storyOrder(characters: ReadonlyArray<Entry>): string[] {
    return storyEntries(characters).map((entry) => entry.chaId)
}

/** The snapshot taken when Home opens: order, chat label and last line. */
export function freezeStories(characters: ReadonlyArray<Entry>, unnamedLabel: string): FrozenStory[] {
    return storyEntries(characters).map((entry) => {
        const chat = currentChat(entry)
        return {
            chaId: entry.chaId,
            chatLabel: chat ? (chat.name || unnamedLabel) : null,
            snippet: storySnippet(chat),
        }
    })
}

/**
 * The frozen stories against the live list: the frozen order, entries that left
 * the list (removed, trashed, hidden) dropped, nothing added or re-sorted. The
 * entry, its name, picture, time and archived state are live. The frozen chat
 * label and last line show only while the live entry is not archived. An
 * archived entry shows the stub's description in the snippet slot: a string
 * the stub already holds, so no chat is read.
 */
export function resolveFrozen(frozen: readonly FrozenStory[], characters: ReadonlyArray<Entry>): ShelfStory[] {
    const wanted = new Set(frozen.map((story) => story.chaId))
    const live = new Map<string, Entry>()
    for (const entry of characters) {
        if (!entry || typeof entry.chaId !== 'string' || !wanted.has(entry.chaId) || live.has(entry.chaId)) {
            continue
        }
        if (entry.trashTime || isHiddenSystemCharacter(entry)) {
            continue
        }
        live.set(entry.chaId, entry)
    }
    const resolved: ShelfStory[] = []
    for (const story of frozen) {
        const entry = live.get(story.chaId)
        if (!entry) {
            continue
        }
        const archived = Boolean(entry.coldstorage)
        resolved.push({
            entry,
            archived,
            chatLabel: archived ? null : story.chatLabel,
            snippet: archived ? archivedSnippet(entry) : story.snippet,
        })
    }
    return resolved
}

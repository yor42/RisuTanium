import type { Chat, Database } from '../../../ts/storage/database.svelte'
import { recentCharacters } from '../../../ts/chatShell/recentCharacters'
import { isHiddenSystemCharacter } from '../../../ts/hiddenCharacters'
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

/** The story entries, most recent first, one per chaId, at most `STORY_CAP`. */
function storyEntries(characters: ReadonlyArray<Entry>): Entry[] {
    // Filter before the sort: a NaN time would make the comparator inconsistent.
    const seen = new Set<string>()
    const picked: Entry[] = []
    for (const entry of recentCharacters(characters.filter(isStory))) {
        if (seen.has(entry.chaId)) {
            continue
        }
        seen.add(entry.chaId)
        picked.push(entry)
        if (picked.length === STORY_CAP) {
            break
        }
    }
    return picked
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
 * label and last line show only while the live entry is not archived.
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
            snippet: archived ? '' : story.snippet,
        })
    }
    return resolved
}

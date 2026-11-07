import { isHiddenSystemCharacter } from '../hiddenCharacters'
import type { Chat, Database } from '../storage/database.svelte'
import { chatListItems, isArchivedChat, previewLine } from './chatListModel'
import type { ChatSort } from './deviceSettings'
import { textMatches } from './toggleSearch'

/**
 * The sidebar's search (Ctrl+K): which characters and which chats of the selected character a query finds. Pure: the
 * characters, the owner, the sort and the query go in, the capped result comes out. Nothing here opens, loads or writes.
 *
 * Characters match by name. A chat matches by name, or by its last-message preview unless it is archived (an archived
 * chat's body is not loaded, so only its name counts). Message bodies are never searched.
 */

type Entry = Database['characters'][number]

/** The most results listed per group. */
export const SEARCH_CAP = 50

export interface SearchResult {
    /** The matching characters in list order, at most `cap`. */
    characters: Entry[]
    /** The matching chats of the owner in the current sort's display order, at most `cap`. */
    chats: Chat[]
    /** How many results are listed (characters plus chats). */
    shown: number
    /** How many results the query found before the cap. */
    total: number
}

const NO_RESULT: SearchResult = { characters: [], chats: [], shown: 0, total: 0 }

// The preview is derived from the last message only; it is kept per chat and recomputed when that message changes.
const previewCache = new WeakMap<Chat, { last: string | undefined; preview: string }>()

function cachedPreview(chat: Chat): string {
    const messages = chat.message
    const last = messages && messages.length > 0 ? messages[messages.length - 1].data : undefined
    const key = typeof last === 'string' ? last : undefined
    const cached = previewCache.get(chat)
    if (cached && cached.last === key) {
        return cached.preview
    }
    const preview = previewLine(chat)
    previewCache.set(chat, { last: key, preview })
    return preview
}

// The owner's chats in display order with every folder opened: a folded folder's members are searchable too.
function listedChats(owner: Entry, sort: ChatSort): Chat[] {
    const unfolded = {
        chats: owner.chats,
        chatFolders: (owner.chatFolders ?? []).map((folder) => (folder.folded ? { ...folder, folded: false } : folder)),
    } as Entry
    const chats: Chat[] = []
    for (const item of chatListItems(unfolded, sort)) {
        if (item.kind === 'chat') {
            chats.push(item.chat)
        }
    }
    return chats
}

/**
 * The results for `query` (white space trimmed; empty gives nothing). Hidden system characters and trashed ones are never
 * offered; archived stubs and groups are.
 */
export function searchSidebar(characters: ReadonlyArray<Entry>, owner: Entry | undefined, sort: ChatSort, query: string, cap: number = SEARCH_CAP): SearchResult {
    const text = query.trim()
    if (text === '') {
        return NO_RESULT
    }
    const foundCharacters = characters.filter((entry) => !!entry
        && typeof entry.chaId === 'string'
        && !isHiddenSystemCharacter(entry)
        && !entry.trashTime
        && textMatches(entry.name ?? '', text))
    const foundChats = owner
        ? listedChats(owner, sort).filter((chat) => textMatches(chat.name ?? '', text)
            || (!isArchivedChat(chat) && textMatches(cachedPreview(chat), text)))
        : []
    const shownCharacters = foundCharacters.slice(0, cap)
    const shownChats = foundChats.slice(0, cap)
    return {
        characters: shownCharacters,
        chats: shownChats,
        shown: shownCharacters.length + shownChats.length,
        total: foundCharacters.length + foundChats.length,
    }
}

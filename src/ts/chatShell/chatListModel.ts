import type { Chat, ChatFolder, Database } from '../storage/database.svelte'
import { coldStorageHeader } from '../process/coldstorageData'
import type { ChatSort } from './deviceSettings'

/**
 * The pure model behind the new shell's chat list: what is listed, in which
 * order, what a row says and which rows are mounted. Nothing here loads a
 * chat or touches a store.
 */

type Owner = Database['characters'][number]

/** Every row, folder header or chat, has this fixed height, so a window of rows can be placed by arithmetic. */
export const ROW_HEIGHT = 56
/** The most rows ever mounted at once, however many chats exist. */
export const MAX_MOUNTED_ROWS = 40

const PREVIEW_LIMIT = 200
const OVERSCAN_ROWS = 4

export type ChatListItem =
    | { kind: 'folder'; folder: ChatFolder; count: number; folded: boolean; level: 1; posinset: number; setsize: number }
    | { kind: 'chat'; chat: Chat; level: 1 | 2; posinset: number; setsize: number }

/** The time of the chat's last message, else its `lastDate`, else nothing. */
function lastActivity(chat: Chat): number | undefined {
    const messages = chat.message
    const last = messages && messages.length > 0 ? messages[messages.length - 1] : undefined
    if (typeof last?.time === 'number') {
        return last.time
    }
    return typeof chat.lastDate === 'number' ? chat.lastDate : undefined
}

/**
 * How recent a chat is, for the Recent order. A chat with no messages is
 * newest (the user just made it); a chat with no usable time is oldest.
 */
export function chatRecency(chat: Chat): number {
    if (!chat.message || chat.message.length === 0) {
        return Infinity
    }
    return lastActivity(chat) ?? 0
}

function newestFirst(chats: Chat[]): Chat[] {
    // Decorate once so a comparison never re-reads the messages; the sort is stable.
    const decorated = chats.map((chat) => ({ chat, recency: chatRecency(chat) }))
    decorated.sort((a, b) => (a.recency > b.recency ? -1 : a.recency < b.recency ? 1 : 0))
    return decorated.map((entry) => entry.chat)
}

/**
 * The rows of the list in display order: folders first, each followed by its
 * chats unless it is folded, then the unfiled chats. A chat whose folder id
 * matches no folder is unfiled. Recent sorts each group newest first; My order
 * keeps the owner's array order.
 */
export function chatListItems(owner: Owner, sort: ChatSort): ChatListItem[] {
    const folders = owner.chatFolders ?? []
    const chats = owner.chats ?? []
    const known = new Set(folders.map((folder) => folder.id))
    const inFolder = new Map<string, Chat[]>()
    const unfiled: Chat[] = []
    for (const chat of chats) {
        if (chat.folderId != null && known.has(chat.folderId)) {
            const list = inFolder.get(chat.folderId)
            if (list) {
                list.push(chat)
            } else {
                inFolder.set(chat.folderId, [chat])
            }
        } else {
            unfiled.push(chat)
        }
    }
    const ordered = (list: Chat[]) => (sort === 'recent' ? newestFirst(list) : list)

    const items: ChatListItem[] = []
    const topSize = folders.length + unfiled.length
    folders.forEach((folder, folderIndex) => {
        const members = inFolder.get(folder.id) ?? []
        const folded = folder.folded === true
        items.push({ kind: 'folder', folder, count: members.length, folded, level: 1, posinset: folderIndex + 1, setsize: topSize })
        if (!folded) {
            ordered(members).forEach((chat, i) => {
                items.push({ kind: 'chat', chat, level: 2, posinset: i + 1, setsize: members.length })
            })
        }
    })
    ordered(unfiled).forEach((chat, i) => {
        items.push({ kind: 'chat', chat, level: 1, posinset: folders.length + i + 1, setsize: topSize })
    })
    return items
}

/** Whether the chat is an archived placeholder: its first message is the cold-storage header. */
export function isArchivedChat(chat: Chat): boolean {
    const first = chat.message?.[0]?.data
    return typeof first === 'string' && first.startsWith(coldStorageHeader)
}

/**
 * The second line of a row: the last message as plain text with markup tags
 * dropped and white space collapsed, at most 200 characters. Expression
 * syntax in the text is left as written.
 */
export function previewLine(chat: Chat): string {
    const messages = chat.message
    const data = messages && messages.length > 0 ? messages[messages.length - 1].data : ''
    if (typeof data !== 'string' || data === '') {
        return ''
    }
    // Only the head can reach the preview, so a huge message is never scanned whole.
    const head = data.slice(0, PREVIEW_LIMIT * 8)
    return head
        .replace(/<[^>]*>/g, '')
        .replace(/<[^>]*$/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PREVIEW_LIMIT)
}

/**
 * The time on a row: a clock time for today, else a short date (with the year
 * when it is not this year). Empty for a chat with no messages or no time.
 */
export function rowTime(chat: Chat, now: number = Date.now(), locale?: string): string {
    if (!chat.message || chat.message.length === 0) {
        return ''
    }
    const at = lastActivity(chat)
    if (at === undefined || at <= 0) {
        return ''
    }
    const when = new Date(at)
    const today = new Date(now)
    if (when.toDateString() === today.toDateString()) {
        return when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    }
    return when.getFullYear() === today.getFullYear()
        ? when.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
        : when.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * The rows to mount for a scroll position: the visible rows plus a few more
 * each side, never more than `MAX_MOUNTED_ROWS`. `start` is inclusive, `end`
 * exclusive.
 */
export function windowRange(
    count: number,
    scrollTop: number,
    viewportHeight: number,
    itemHeight: number = ROW_HEIGHT,
    max: number = MAX_MOUNTED_ROWS,
): { start: number; end: number } {
    if (count <= 0) {
        return { start: 0, end: 0 }
    }
    const firstVisible = Math.floor(Math.max(0, scrollTop) / itemHeight)
    const lastVisible = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / itemHeight)
    const start = Math.min(Math.max(0, firstVisible - OVERSCAN_ROWS), count - 1)
    const end = Math.min(count, start + max, Math.max(lastVisible + OVERSCAN_ROWS, start + 1))
    return { start, end }
}

/**
 * The chat next to `current` in the listed order, skipping folder headers and
 * folded-away chats; no wrap. A `current` that is not listed goes to the first
 * listed chat for `1` and the last for `-1`. Undefined when there is none.
 */
export function adjacentChat(items: ChatListItem[], current: Chat | undefined, direction: 1 | -1): Chat | undefined {
    const listed: Chat[] = []
    for (const item of items) {
        if (item.kind === 'chat') {
            listed.push(item.chat)
        }
    }
    if (listed.length === 0) {
        return undefined
    }
    const at = current ? listed.indexOf(current) : -1
    if (at === -1) {
        return direction === 1 ? listed[0] : listed[listed.length - 1]
    }
    return listed[at + direction]
}

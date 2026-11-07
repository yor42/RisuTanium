import { language } from '../../lang'
import { alertError } from '../alert'
import { writeLiveCharacter } from '../liveCharacterWrite'
import type { Chat, ChatFolder, Database } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { ROW_HEIGHT, type ChatListItem } from './chatListModel'
import { keepChatPageOf } from './chatOpen'

/**
 * Reordering the new shell's chat list: where a chat or folder lands among its siblings, and the one write that stores it.
 *
 * Only the order of `chats` and of `chatFolders` ever changes. A chat's group is its `folderId` when that id names a known
 * folder, else unfiled; a reorder never reads another group's chats as siblings and never writes a `folderId`. A move
 * between groups stays with `moveChat`.
 */

type Owner = Database['characters'][number]
type Reorderable = Chat | ChatFolder

/** The most a held edge scrolls the list in one frame. */
export const AUTOSCROLL_MAX_PX = 12

/** What the sidebar offers the list while Edit order is on. Each call reports whether the order is now as asked. */
export type ChatOrdering = {
    placeChat(chat: Chat, before: Chat | null): boolean
    placeFolder(folder: ChatFolder, before: ChatFolder | null): boolean
}

/** The folder id a chat is filed under, or null for the unfiled group (a dangling id is unfiled). */
function groupOf(chat: Chat, folders: ChatFolder[]): string | null {
    const id = chat.folderId
    return id != null && folders.some((folder) => folder.id === id) ? id : null
}

/**
 * `list` with `item` moved to directly before `before` (the end for null). Null when that changes nothing: `before` is the
 * item itself, the item's successor, or null with the item already last. Null as well when `item` is not in `list` or
 * `before` is neither null nor in it.
 */
export function reorderedSiblings<T>(list: readonly T[], item: T, before: T | null): T[] | null {
    const at = list.indexOf(item)
    if (at === -1 || before === item) {
        return null
    }
    if (before === null ? at === list.length - 1 : list[at + 1] === before) {
        return null
    }
    const rest = list.filter((entry) => entry !== item)
    const to = before === null ? rest.length : rest.indexOf(before)
    if (to === -1) {
        return null
    }
    rest.splice(to, 0, item)
    return rest
}

/**
 * `chats` with `chat` moved before `before` inside its own group. Every other chat keeps its slot and its object; the slots
 * of the group's members are refilled in the new order. Null when nothing changes.
 */
export function reorderedChats(chats: readonly Chat[], folders: ChatFolder[], chat: Chat, before: Chat | null): Chat[] | null {
    const group = groupOf(chat, folders)
    const members = chats.filter((candidate) => groupOf(candidate, folders) === group)
    const next = reorderedSiblings(members, chat, before)
    if (!next) {
        return null
    }
    let taken = 0
    return chats.map((candidate) => (groupOf(candidate, folders) === group ? next[taken++] : candidate))
}

export function reorderedFolders(folders: readonly ChatFolder[], folder: ChatFolder, before: ChatFolder | null): ChatFolder[] | null {
    return reorderedSiblings(folders, folder, before)
}

/** A folder, as against a chat (only a chat carries messages). */
export function isFolderItem(item: Reorderable): item is ChatFolder {
    return !('message' in item)
}

function indexOfItem(items: ChatListItem[], item: Reorderable): number {
    return items.findIndex((entry) => (entry.kind === 'folder' ? entry.folder === item : entry.chat === item))
}

function entryItem(entry: ChatListItem): Reorderable {
    return entry.kind === 'folder' ? entry.folder : entry.chat
}

/**
 * The listed siblings of `item` with their indices in `items`: the folder headers for a folder, the unfiled chats for an
 * unfiled chat, the visible members of its folder for a member. Empty when `item` is not listed.
 */
function siblingEntries(items: ChatListItem[], item: Reorderable): Array<{ index: number, item: Reorderable }> {
    const at = indexOfItem(items, item)
    if (at === -1) {
        return []
    }
    const found: Array<{ index: number, item: Reorderable }> = []
    const entry = items[at]
    if (entry.kind === 'folder') {
        items.forEach((candidate, index) => {
            if (candidate.kind === 'folder') {
                found.push({ index, item: candidate.folder })
            }
        })
    } else if (entry.level === 1) {
        items.forEach((candidate, index) => {
            if (candidate.kind === 'chat' && candidate.level === 1) {
                found.push({ index, item: candidate.chat })
            }
        })
    } else {
        let from = at
        while (from > 0 && items[from - 1].kind === 'chat') {
            from--
        }
        for (let index = from; index < items.length; index++) {
            const candidate = items[index]
            if (candidate.kind !== 'chat' || candidate.level !== 2) {
                break
            }
            found.push({ index, item: candidate.chat })
        }
    }
    return found
}

/** Which listed items are the first and the last of their group; the Up and Down buttons are inert there. */
export function siblingEdges(items: ChatListItem[]): Map<Reorderable, { first: boolean, last: boolean }> {
    const edges = new Map<Reorderable, { first: boolean, last: boolean }>()
    const lastOf = new Map<string | ChatFolder, Reorderable>()
    let header: ChatFolder | null = null
    for (const entry of items) {
        let key: string | ChatFolder
        if (entry.kind === 'folder') {
            header = entry.folder
            key = 'folders'
        } else {
            key = entry.level === 2 && header ? header : 'unfiled'
        }
        const item = entryItem(entry)
        const previous = lastOf.get(key)
        edges.set(item, { first: previous === undefined, last: true })
        if (previous !== undefined) {
            edges.get(previous)!.last = false
        }
        lastOf.set(key, item)
    }
    return edges
}

/**
 * The `before` that moves `item` one place within its group; null at the edge. Up goes before the predecessor, Down before the
 * successor's successor (the end when there is none).
 */
export function stepTarget<T extends Reorderable>(items: ChatListItem[], item: T, dir: 'up' | 'down'): { before: T | null } | null {
    const siblings = siblingEntries(items, item).map((entry) => entry.item as T)
    const at = siblings.indexOf(item)
    if (at === -1) {
        return null
    }
    if (dir === 'up') {
        return at === 0 ? null : { before: siblings[at - 1] }
    }
    return at === siblings.length - 1 ? null : { before: siblings[at + 2] ?? null }
}

/**
 * The drop for a pointer at `y` (list-content pixels): `before` is the first sibling of `dragged` at or below the gap the pointer
 * is nearest to, else null for the end of the group. The gaps beside the dragged row give the row itself and its successor,
 * both of which change nothing. Null when `dragged` is no longer listed.
 */
export function siblingDropTarget<T extends Reorderable>(items: ChatListItem[], dragged: T, y: number): { before: T | null } | null {
    const siblings = siblingEntries(items, dragged)
    if (siblings.length === 0) {
        return null
    }
    const gap = Math.min(Math.max(Math.round(y / ROW_HEIGHT), 0), items.length)
    const below = siblings.find((entry) => entry.index >= gap)
    return { before: below ? (below.item as T) : null }
}

/** The index in `items` of the gap the indicator is drawn at for `target`. */
export function indicatorGap(items: ChatListItem[], dragged: Reorderable, target: { before: Reorderable | null }): number {
    if (target.before !== null) {
        return indexOfItem(items, target.before)
    }
    const siblings = siblingEntries(items, dragged)
    if (siblings.length === 0) {
        return 0
    }
    const last = siblings[siblings.length - 1]
    const entry = items[last.index]
    if (entry.kind === 'folder') {
        return last.index + 1 + (entry.folded ? 0 : entry.count)
    }
    return last.index + 1
}

/** How far to scroll this frame for a pointer at `clientY` over a scroller spanning `top` to `bottom`: zero outside the edge bands. */
export function autoscrollDelta(clientY: number, top: number, bottom: number): number {
    const toTop = top + ROW_HEIGHT - clientY
    if (toTop > 0) {
        return -Math.min(AUTOSCROLL_MAX_PX, Math.ceil((AUTOSCROLL_MAX_PX * toTop) / ROW_HEIGHT))
    }
    const toBottom = clientY - (bottom - ROW_HEIGHT)
    if (toBottom > 0) {
        return Math.min(AUTOSCROLL_MAX_PX, Math.ceil((AUTOSCROLL_MAX_PX * toBottom) / ROW_HEIGHT))
    }
    return 0
}

function refused(): false {
    alertError(language.chatShellEditNotSaved)
    return false
}

/** `owner` is the one slot a live write for its id reaches, and that slot is not archived. */
function ownsLiveSlot(owner: Owner): boolean {
    if (!owner.chaId || owner.coldstorage) {
        return false
    }
    return DBState.db.characters.find((candidate) => candidate?.chaId === owner.chaId) === owner
}

/**
 * Moves `chat` of `owner` before `before` (the end of its group for null). Refused with the notice and nothing written when
 * `owner` is not the live holder of its id, the chat is not in its list, or `before` is not a chat of the same group. A move that
 * changes nothing reports success without a write or a mark. The open chat stays open by identity: `chatPage` follows it
 * without a reload.
 */
export function placeChat(owner: Owner, chat: Chat, before: Chat | null): boolean {
    const chats = owner.chats
    const folders = owner.chatFolders ?? []
    if (!ownsLiveSlot(owner) || chats.indexOf(chat) === -1) {
        return refused()
    }
    if (before !== null && (chats.indexOf(before) === -1 || groupOf(before, folders) !== groupOf(chat, folders))) {
        return refused()
    }
    const next = reorderedChats(chats, folders, chat, before)
    if (!next) {
        return true
    }
    const landed = writeLiveCharacter(owner.chaId, (live) => {
        const open = live.chats[live.chatPage]
        live.chats = next
        if (open) {
            keepChatPageOf(live, open)
        }
    })
    return landed || refused()
}

/** `placeChat` for the owner's folders, which are siblings of each other. */
export function placeFolder(owner: Owner, folder: ChatFolder, before: ChatFolder | null): boolean {
    const folders = owner.chatFolders
    if (!ownsLiveSlot(owner) || !folders || folders.indexOf(folder) === -1) {
        return refused()
    }
    if (before !== null && folders.indexOf(before) === -1) {
        return refused()
    }
    const next = reorderedFolders(folders, folder, before)
    if (!next) {
        return true
    }
    const landed = writeLiveCharacter(owner.chaId, (live) => {
        live.chatFolders = next
    })
    return landed || refused()
}
import { v4 } from 'uuid'
import { language } from '../../lang'
import { alertError } from '../alert'
import { createChatCopyName } from '../globalApi.svelte'
import { writeLiveChat, writeLiveCharacter } from '../liveCharacterWrite'
import { safeStructuredClone } from '../polyfill'
import type { Chat, ChatFolder } from '../storage/database.svelte'
import { isArchivedChat } from './chatListModel'
import { openChatOf, selectedLiveOwner } from './chatOpen'
import { normalizeChatName, writeChatName } from './thisChatEdits'

/**
 * What the new shell's row menu and folder menu write.
 *
 * Every edit is addressed by the owner's `chaId` (and a chat or folder by identity or id), never by an index or the
 * selection: the menu is used after user time has passed and the selected character may have moved. It goes through the live
 * write, so it lands on the character the user acted on with a save mark, or is refused with nothing written and nothing
 * marked; a refusal shows the "not saved" notice. Each function returns whether the edit landed.
 */

export type Point = { x: number, y: number }

/** What a menu was opened for. `opener` is where focus returns when it closes. */
export type MenuTarget =
    | { kind: 'chat', chat: Chat, opener: HTMLElement | null, anchor?: Point }
    | { kind: 'folder', folder: ChatFolder, opener: HTMLElement | null, anchor?: Point }

/**
 * What the chat list needs from the sidebar to edit in place. The sidebar owns the state, so a selection change can close
 * everything at once; rows only read it and report events.
 */
export interface ListEditing {
    /** The chat whose name is being edited, if any. */
    readonly renamingChat: Chat | null
    /** The folder whose name is being edited, if any. */
    readonly renamingFolder: ChatFolder | null
    /** The chat or folder whose menu is open, if any. */
    readonly menu: MenuTarget | null
    openChatMenu(chat: Chat, opener: HTMLElement, anchor?: Point): void
    openFolderMenu(folder: ChatFolder, opener: HTMLElement, anchor?: Point): void
    /** Ends the inline field of `chat`; writes only when the selection is the one the field was opened under. */
    commitChatName(chat: Chat, value: string): void
    commitFolderName(folder: ChatFolder, value: string): void
    /** Ends the inline field without a write. */
    cancelRename(): void
}

/** A touch held this long opens a row's menu; the ring shows from `RING_MS` so the user sees the hold being counted. */
export const HOLD_MS = 500
export const RING_MS = 200
/** A finger that moves farther than this has started a scroll, not a hold. */
export const MOVE_LIMIT_PX = 10

export interface Hold {
    down(event: PointerEvent): void
    move(event: PointerEvent): void
    /** Ends a hold in progress (lift, cancel, a context menu, unmount). */
    stop(): void
    /** True once for the click the browser sends when a held touch lifts: it belongs to the hold, not to the row. */
    takeClick(): boolean
}

/** The long-press recogniser of a row or folder header; touch and pen only, so a mouse press never starts a hold. */
export function createHold(options: { onring: (on: boolean) => void, onhold: (at: Point) => void }): Hold {
    let holdTimer: ReturnType<typeof setTimeout> | undefined
    let ringTimer: ReturnType<typeof setTimeout> | undefined
    let start: Point = { x: 0, y: 0 }
    let held = false

    function stop(): void {
        clearTimeout(holdTimer)
        clearTimeout(ringTimer)
        holdTimer = undefined
        ringTimer = undefined
        options.onring(false)
    }

    return {
        down(event) {
            if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
                return
            }
            stop()
            held = false
            start = { x: event.clientX, y: event.clientY }
            ringTimer = setTimeout(() => options.onring(true), RING_MS)
            holdTimer = setTimeout(() => {
                stop()
                held = true
                options.onhold(start)
            }, HOLD_MS)
        },
        move(event) {
            if (holdTimer !== undefined && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_LIMIT_PX) {
                stop()
            }
        },
        stop,
        takeClick() {
            const was = held
            held = false
            return was
        },
    }
}

function refused(): false {
    alertError(language.chatShellEditNotSaved)
    return false
}

/** Renames the chat; an empty name leaves the old one and shows nothing. */
export function renameChat(chaId: string, chat: Chat, value: string): boolean {
    const name = normalizeChatName(value)
    if (name === null) {
        return false
    }
    return writeChatName({ chaId, chat }, name) || refused()
}

/** Files the chat in the folder, or unfiles it for `null` (the field is removed, as a chat that was never filed has none). */
export function moveChat(chaId: string, chat: Chat, folderId: string | null): boolean {
    const landed = writeLiveChat(chaId, chat, (live) => {
        if (folderId === null) {
            delete live.folderId
        } else {
            live.folderId = folderId
        }
    })
    return landed || refused()
}

/** Puts a new numbered folder on top of the character's folders and returns its id; null when the write was refused. */
export function createFolder(chaId: string): string | null {
    const id = v4()
    const landed = writeLiveCharacter(chaId, (live) => {
        const folders = live.chatFolders ?? []
        folders.unshift({ id, name: `${language.chatShellNewFolder} ${folders.length + 1}`, folded: false })
        live.chatFolders = folders
    })
    if (!landed) {
        refused()
        return null
    }
    return id
}

function writeFolder(chaId: string, folderId: string, write: (folder: ChatFolder) => void): boolean {
    const landed = writeLiveCharacter(chaId, (live) => {
        const folder = live.chatFolders?.find((candidate) => candidate.id === folderId)
        if (folder) {
            write(folder)
        }
    })
    return landed || refused()
}

/** Renames the folder; an empty name leaves the old one and shows nothing. */
export function renameFolder(chaId: string, folderId: string, value: string): boolean {
    const name = normalizeChatName(value)
    if (name === null) {
        return false
    }
    return writeFolder(chaId, folderId, (folder) => { folder.name = name })
}

export function setFolderColor(chaId: string, folderId: string, color: string): boolean {
    return writeFolder(chaId, folderId, (folder) => { folder.color = color })
}

export function setFolderFolded(chaId: string, folderId: string, folded: boolean): boolean {
    return writeFolder(chaId, folderId, (folder) => { folder.folded = folded })
}

/** Removes the folder and unfiles the chats that were in it; no other chat is touched. */
export function deleteFolder(chaId: string, folderId: string): boolean {
    const landed = writeLiveCharacter(chaId, (live) => {
        const folders = live.chatFolders
        const at = folders ? folders.findIndex((candidate) => candidate.id === folderId) : -1
        if (!folders || at === -1) {
            return
        }
        folders.splice(at, 1)
        for (const chat of live.chats) {
            if (chat.folderId === folderId) {
                delete chat.folderId
            }
        }
        live.chatFolders = folders
    })
    return landed || refused()
}

/**
 * Puts a copy of the chat on top of the selected character's chats and opens it. Refused (with the notice) unless
 * `chaId` is the selected, unarchived character and the first holder of that id, the chat is in its list and the chat is
 * not an archived placeholder. The check, the copy and the write happen in one synchronous stretch, so the selection cannot
 * move between them. The copy is a snapshot with a new id, a copy name and no streaming flag.
 */
export function duplicateChat(chaId: string, chat: Chat): boolean {
    const owner = selectedLiveOwner(chaId)
    if (!owner || owner.chats.indexOf(chat) === -1 || isArchivedChat(chat)) {
        return refused()
    }
    const copy = safeStructuredClone(chat)
    copy.id = v4()
    copy.name = createChatCopyName(chat.name, 'Copy')
    delete copy.isStreaming
    const landed = writeLiveCharacter(chaId, (live) => {
        const chats = live.chats
        chats.unshift(copy)
        live.chats = chats
    })
    if (!landed) {
        return refused()
    }
    // The list holds a proxy of the copy, so the chat to open is read back from it.
    openChatOf(owner, owner.chats[0])
    return true
}

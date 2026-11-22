import { untrack } from 'svelte'
import type { RunSubject } from '../chatOrigin'
import { DBState, selIdState } from 'src/ts/stores.svelte'

/**
 * "Allow this server for the rest of this chat" (MC-3413): which third-party MCP servers the user allowed for the chat
 * on screen. Module memory only, never the byte store, so a restart clears it; it is also cleared the moment the visible
 * chat changes, including leaving every chat. A grant is held per (visible chat, server url) and `chatKeyOf` builds the
 * key from the same ids a run's origin carries, so only a run of the visible chat can use or create one.
 */

let visibleKey: string | null = null
let urls = new Set<string>()

/** The key of the chat a run belongs to, `${chaId}:${chatId}` of its origin; null for a run with no subject. */
export function chatKeyOf(subject: RunSubject | undefined): string | null {
    const origin = subject?.origin
    return origin ? `${origin.chaId}:${origin.chatId}` : null
}

/** Records which chat is on screen (null for none). Any change drops every server grant. */
export function noteVisibleChat(key: string | null): void {
    if (key !== visibleKey) {
        visibleKey = key
        urls = new Set<string>()
    }
}

/** Whether a server grant may be offered or honoured for `key`: it must be the chat on screen now. */
export function isVisibleChat(key: string | null): key is string {
    return key !== null && key === visibleKey
}

export function hasServerChatGrant(key: string | null, url: string): boolean {
    return isVisibleChat(key) && urls.has(url)
}

/** Grants `url` for the visible chat; false, with nothing recorded, when `key` is not the chat on screen. */
export function addServerChatGrant(key: string | null, url: string): boolean {
    if (!isVisibleChat(key)) {
        return false
    }
    urls.add(url)
    return true
}

export function resetServerChatGrantsForTests(): void {
    visibleKey = null
    urls = new Set<string>()
}

/**
 * Follows the selected character and its `chatPage` and tells `noteVisibleChat` which chat that is. Started once from the
 * app shell; the returned function stops it. A selection with no character or no chat id is no visible chat.
 */
export function startVisibleChatWatcher(): () => void {
    return $effect.root(() => {
        $effect(() => {
            const owner = DBState.db?.characters?.[selIdState.selId]
            const chat = owner?.chats?.[owner.chatPage]
            const key = owner?.chaId && chat?.id ? `${owner.chaId}:${chat.id}` : null
            untrack(() => noteVisibleChat(key))
        })
    })
}

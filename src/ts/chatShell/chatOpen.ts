import type { Chat, Database } from '../storage/database.svelte'
import { DBState, selIdState } from '../stores.svelte'
import { changeChatTo } from '../globalApi.svelte'

/**
 * The only place the new shell's lists open a chat or move a chat page.
 *
 * Pass chats read from `owner.chats`: a raw object put into the list is
 * wrapped in a new proxy there, so the raw object is never found again. A
 * caller that inserts a chat reads it back from `owner.chats` first. Callers
 * are event handlers or the awaited tail of a user action; nothing here
 * flushes, so none may run inside an effect.
 */

type Owner = Database['characters'][number]

/**
 * The selected character, read from the reactive selection mirror. A
 * derivation over it re-runs on a switch; at event time it equals the
 * selected slot.
 */
export function selectedOwner(): Owner | undefined {
    return DBState.db.characters?.[selIdState.selId]
}

/**
 * The character a live write for `chaId` would land on, when that is also the
 * selected, unarchived slot; else null. A live write lands on the first
 * holder of the id, so any other slot is refused here.
 */
export function selectedLiveOwner(chaId: string): Owner | null {
    const characters = DBState.db.characters
    const index = characters.findIndex((c) => c?.chaId === chaId)
    if(index === -1 || index !== selIdState.selId){
        return null
    }
    const owner = characters[index]
    return owner.coldstorage ? null : owner
}

export type OpenChatOutcome = 'opened' | 'not-selected' | 'missing'

/**
 * Opens `chat` of the selected `owner`, found by identity (`Chat.id` is
 * optional and not unique). Calls nothing for another owner or a chat that is
 * not in the owner's list.
 */
export function openChatOf(owner: Owner, chat: Chat): OpenChatOutcome {
    if(owner !== selectedOwner()){
        return 'not-selected'
    }
    const index = owner.chats.indexOf(chat)
    if(index === -1){
        return 'missing'
    }
    changeChatTo(index)
    return 'opened'
}

/**
 * Points `owner.chatPage` at `chat` by identity without opening it: no reload
 * and no flush. Works for any owner; the caller marks the owner for save.
 * False when the chat is not in the list.
 */
export function keepChatPageOf(owner: Owner, chat: Chat): boolean {
    const index = owner.chats.indexOf(chat)
    if(index === -1){
        return false
    }
    owner.chatPage = index
    return true
}

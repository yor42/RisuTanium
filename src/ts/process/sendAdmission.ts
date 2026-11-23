import { get } from "svelte/store"
import { activeUnits, type ActiveUnitKey } from "./activeUnits"
import { nativeReplyRunsInNow } from "../nativeReply/runningReplies.svelte"
import { composerWindowFor } from "./generationOwnership.svelte"
import { DBState, selectedCharID } from "../stores.svelte"

/**
 * Who may start reply work in a chat. The key is the owner's chat (`chaId`, `chatId`), never a group's member.
 *
 * - The reads are untracked on purpose: `activeUnits.has` and `nativeReplyRunsInNow` read no reactive source, so a
 *   gate called inside an effect or a derived never becomes a dependency of it. Templates read `isBusyIn` instead.
 * - The composer window is a starter rule only. `sendChat` runs inside the composer's own window, so its gate never
 *   reads it; a starter that pushes or takes before it calls `sendChat` refuses with `starterRefusalIn`.
 * - A null key holds nothing and refuses nothing: a chat without ids cannot hold a unit, because ids are filled only
 *   when work begins and are never cleared.
 */

export type SendRefusal = 'writing' | 'nativeReply'
export type StarterRefusal = SendRefusal | 'composer'

/** Both ids present give the key; otherwise null. */
export function chatKeyOf(owner: { chaId?: string } | null | undefined, chat: { id?: string } | null | undefined): ActiveUnitKey | null {
    if(!owner?.chaId || !chat?.id){
        return null
    }
    return { chaId: owner.chaId, chatId: chat.id }
}

/** The selected owner's shown chat, or null when nothing is selected or either has no id yet. */
export function selectedChatKey(): ActiveUnitKey | null {
    const selected = DBState.db?.characters?.[get(selectedCharID)]
    return chatKeyOf(selected, selected?.chats?.[selected.chatPage])
}

/** Why a send into this chat is refused: a unit holds it, or a native reply the page no longer holds targets it. */
export function sendRefusalIn(key: ActiveUnitKey | null): SendRefusal | null {
    if(!key){
        return null
    }
    if(activeUnits.has(key)){
        return 'writing'
    }
    if(nativeReplyRunsInNow(key)){
        return 'nativeReply'
    }
    return null
}

/** `sendRefusalIn` plus the composer window, for a starter that pushes or takes before it calls `sendChat`. */
export function starterRefusalIn(key: ActiveUnitKey | null): StarterRefusal | null {
    if(!key){
        return null
    }
    const refusal = sendRefusalIn(key)
    if(refusal){
        return refusal
    }
    return composerWindowFor(key) ? 'composer' : null
}

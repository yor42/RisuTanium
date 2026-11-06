import { DBState } from './stores.svelte'
import { markCharacterForSave } from './storage/characterSaveMarks'
import type { Chat, character, groupChat } from './storage/database.svelte'

/**
 * Applies a write that completes after an await to the character with `chaId`, looked up again at write time.
 * A writer that awaits holds the id, never an index or an object: the selection may have moved and the array
 * element may have been replaced, and the write belongs to the character the user acted on. The character is
 * marked for save after a landed write, because the next save must re-encode it even when it is no longer
 * selected. A character that is gone, or has become an archived stub, drops the write with a console warning
 * and marks nothing.
 */
export function writeLiveCharacter(chaId: string, write: (target: character | groupChat) => void): boolean {
    const characters = DBState.db.characters
    const index = chaId ? characters.findIndex((c) => c?.chaId === chaId) : -1
    const live = index === -1 ? undefined : characters[index]
    if(!live || live.coldstorage){
        console.warn('Character change dropped: the character was removed or archived while it was being saved')
        return false
    }
    write(live)
    markCharacterForSave(chaId)
    return true
}

/**
 * Applies a write that completes after user time has passed to the chat the user acted on, looked up again at write
 * time. `chat` is the object the writer captured; it may no longer be the database's: a cold restore or a plugin can
 * replace the owner element or its chat with a copy that keeps the same ids, and writing the captured object then
 * changes nothing the database holds while looking like success.
 *
 * The owner is found by `chaId` and refused when it is gone or archived, as `writeLiveCharacter` does. The chat is
 * found in the owner by identity first, else by `chat.id` when exactly one chat has that id; a chat without an id
 * that is not the live object, and an id two chats share, are refused because no unique target exists. A landed
 * write marks the character once; a refusal writes nothing and marks nothing. `write` may return `false` to veto
 * after it has looked at the live chat; the veto also writes nothing and marks nothing. The caller shows a refusal.
 */
export function writeLiveChat(chaId: string, chat: Chat, write: (live: Chat) => boolean | void): boolean {
    const characters = DBState.db.characters
    const index = chaId ? characters.findIndex((c) => c?.chaId === chaId) : -1
    const owner = index === -1 ? undefined : characters[index]
    if(!owner || owner.coldstorage){
        console.warn('Chat change dropped: the character was removed or archived before the change was saved')
        return false
    }
    const live = findLiveChat(owner.chats, chat)
    if(!live){
        console.warn('Chat change dropped: the chat was removed or replaced before the change was saved')
        return false
    }
    if(write(live) === false){
        return false
    }
    markCharacterForSave(chaId)
    return true
}

function findLiveChat(chats: Chat[] | undefined, chat: Chat): Chat | undefined {
    if(!Array.isArray(chats)){
        return undefined
    }
    const same = chats.find((c) => c === chat)
    if(same){
        return same
    }
    if(!chat.id){
        return undefined
    }
    const sharing = chats.filter((c) => c?.id === chat.id)
    return sharing.length === 1 ? sharing[0] : undefined
}

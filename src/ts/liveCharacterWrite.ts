import { DBState } from './stores.svelte'
import { markCharacterForSave } from './storage/characterSaveMarks'
import type { character, groupChat } from './storage/database.svelte'

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

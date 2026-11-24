// Finds a lorebook entry by its own id in the live list of an owner. Pure: it reads plain fields and never writes.
import type { RisuModule } from '../process/modules'
import { moduleRowOf } from './itemText'
import { isStubRow } from './studioModules'
import type { StudioOwnerType } from './studioTarget'

/**
 * The index of the one entry whose `id` is `entryId`, or null: the list is not an array, the id is empty, or no entry
 * or several (folder rows included) hold it. A shared id names no one entry, so the caller opens the list.
 */
export function loreIndexOfEntryId(list: unknown, entryId: string): number | null {
    if (!Array.isArray(list) || entryId === '') return null
    let found: number | null = null
    for (let index = 0; index < list.length; index++) {
        const element: unknown = list[index]
        if (typeof element !== 'object' || element === null) continue
        if ((element as { id?: unknown }).id !== entryId) continue
        if (found !== null) return null
        found = index
    }
    return found
}

/** The live lorebook list of an owner, as the owner model reads it; undefined for an owner without one. */
export function liveLoreListOf(
    owner: { type: StudioOwnerType, id: string },
    character: { globalLore?: unknown, chats?: readonly { localLore?: unknown }[], chatPage: number },
    modules: readonly RisuModule[],
): unknown {
    switch (owner.type) {
        case 'character': return character.globalLore
        case 'chat': return character.chats?.[character.chatPage]?.localLore
        case 'module': {
            const row = moduleRowOf(owner.id, modules)
            return row && !isStubRow(row) ? row.lorebook : undefined
        }
        default: return undefined
    }
}
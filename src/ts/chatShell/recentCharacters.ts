import { isHiddenSystemCharacter } from '../hiddenCharacters'
import type { Database } from '../storage/database.svelte'

type Entry = Database['characters'][number]

/**
 * The characters the sidebar strip offers, most recently used first. Hidden
 * system characters, trashed ones and entries without a string `chaId` are
 * dropped; groups stay. Only the stub's own fields are read, so an archived
 * character qualifies without being loaded. Ties keep list order.
 */
export function recentCharacters(characters: ReadonlyArray<Entry>): Entry[] {
    return characters
        .filter((c) => !!c && typeof c.chaId === 'string' && !isHiddenSystemCharacter(c) && !c.trashTime)
        .map((c, order) => ({ c, order }))
        .sort((a, b) => ((b.c.lastInteraction ?? 0) - (a.c.lastInteraction ?? 0)) || (a.order - b.order))
        .map((x) => x.c)
}

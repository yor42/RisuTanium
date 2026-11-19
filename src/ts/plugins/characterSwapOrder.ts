import { replaceOrderedId } from 'src/lib/SideBars/sidebarOrder'
import { checkCharOrder } from '../globalApi.svelte'
import { isHiddenSystemCharacter } from '../hiddenCharacters'
import type { Database } from '../storage/database.svelte'
import { isCharacterEntry } from '../storage/characterIds'

const isIdValue = (id: unknown): id is string | number => typeof id === 'string' || typeof id === 'number'

interface SwapSide {
    chaId?: unknown
    trashTime?: unknown
}

/**
 * Repairs the character order after a plugin wrote a character into an existing slot. When the slot's id changed,
 * the new character takes the replaced one's place in the order, inside its folder if it had one, and the order is
 * then checked as usual, so an id that cannot take that place is appended and an id left without a character is
 * dropped. An unchanged id (also one given back as number for text, or the reverse) leaves the order untouched, so a plugin that repairs the order itself sees no change.
 *
 * The place is taken only when both ids are non-empty text, the incoming character would be listed at all (not
 * trashed, not a hidden system character) and no other live character still holds the replaced id, whose entry
 * then stays its own.
 */
export function keepOrderPlaceOnSwap(db: Database, replaced: SwapSide | undefined, char: SwapSide): void {
    const oldId = replaced?.chaId
    const newId = char.chaId
    // The same id as number and as text names the same character (the setters accept that pair as one id).
    if (oldId === newId || (isIdValue(oldId) && isIdValue(newId) && String(oldId) === String(newId))) {
        return
    }
    if (
        typeof oldId === 'string' && oldId !== ''
        && typeof newId === 'string' && newId !== ''
        && !char.trashTime
        && !isHiddenSystemCharacter({ chaId: newId })
        && Array.isArray(db.characterOrder)
        && !db.characters.some((other) => isCharacterEntry(other) && other.chaId === oldId && !other.trashTime)
    ) {
        const next = replaceOrderedId(db.characterOrder, oldId, newId)
        if (next !== db.characterOrder) {
            db.characterOrder = next
        }
    }
    checkCharOrder(db)
}

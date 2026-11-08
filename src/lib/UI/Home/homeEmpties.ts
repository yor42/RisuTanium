import { isHiddenSystemCharacter } from 'src/ts/hiddenCharacters'

/** The two fields the empty-state rules read from a character or group slot. */
export type CharacterSlot = { chaId?: string, trashTime?: number }

/** The username a profile carries until the user names it (the database default). */
const DEFAULT_USERNAME = 'User'

/**
 * True when at least one slot is something the library would list: present, not in the Trash and
 * not a hidden system character. Runs over the unfiltered list, so a search can never produce the
 * empty state; an undefined list counts as empty.
 */
export function hasLiveCharacter(characters: readonly (CharacterSlot | null | undefined)[] | undefined): boolean {
    if (!characters) {
        return false
    }
    return characters.some((c) => !!c && !c.trashTime && !isHiddenSystemCharacter(c))
}

/**
 * The name the persona chip shows, or null when the persona counts as unnamed: an empty name or the
 * default 'User' after trimming (a persona deliberately named "User" is indistinguishable and shows
 * the set-up label too). The name is the stored username, which the Personas page edits directly.
 */
export function personaChipName(username: string | undefined): string | null {
    const name = (username ?? '').trim()
    if (name === '' || name === DEFAULT_USERNAME) {
        return null
    }
    return name
}

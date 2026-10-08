import { writable } from 'svelte/store'

/**
 * A character the save loop is waiting on. `unusable-id`: its id cannot key a
 * block, so nothing is saved until the cause is gone. `waiting`: its id keeps
 * changing between the loop's check and its snapshot, so each pass is thrown
 * away and tried again.
 */
export interface HeldSaveInfo {
    name: string
    kind: 'unusable-id' | 'waiting'
    /** An archived character: its id cannot be changed on the page, only restored from a backup. */
    archived: boolean
}

/** What the save indicator shows while the loop waits; empty when it does not. */
export const heldSaveStore = writable<HeldSaveInfo[]>([])

/**
 * Why the save loop stops for good on data it cannot write as a loadable save.
 * These are raised before anything is written; the loop maps each to a named
 * park instead of its generic retry, because writing the same data again
 * cannot succeed.
 */
export type SaveParkKind =
    /** A character's serialized form is not a JSON object. */
    | 'character-not-object'
    /** `characters`, `botPresets`, `modules`, `loadouts` or `plugins` holds something that is not a list. */
    | 'container-not-list'

export class SaveParkError extends Error {
    constructor(public readonly kind: SaveParkKind, public readonly what: string) {
        super(kind === 'character-not-object'
            ? `The character "${what}" does not serialize to an object.`
            : `The ${what} container is not a list.`)
        this.name = 'SaveParkError'
    }
}

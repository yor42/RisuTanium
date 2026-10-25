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

// Defined in a module with no imports so the module-stub leaf can extend the error without loading the store; the
// re-export keeps one class identity for every `instanceof SaveParkError`.
export { SaveParkError, type SaveParkKind } from './savePark'

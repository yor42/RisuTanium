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
    /** A module slot holds the module stub marker: a stand-in for a module, never the module itself. */
    | 'module-stub'

/**
 * No imports on purpose: the module-stub leaf extends this class and must load without the save-hold store.
 * `saveHold.ts` re-exports it, so every `instanceof SaveParkError` sees one class.
 * A subclass that names its data more closely than the kind's default passes its own `message`.
 */
export class SaveParkError extends Error {
    constructor(public readonly kind: SaveParkKind, public readonly what: string, message?: string) {
        super(message ?? (kind === 'character-not-object'
            ? `The character "${what}" does not serialize to an object.`
            : kind === 'module-stub'
                ? `The ${what} hold a module stub.`
                : `The ${what} container is not a list.`))
        this.name = 'SaveParkError'
    }
}

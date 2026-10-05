import type { botPreset, Database } from './database.svelte'

/**
 * The preset the working settings belong to, or `undefined` when none does: `-1`
 * (no current preset, which an upstream or plugin-written database may hold) and
 * an id that names no preset both read as none, so a caller that shows or edits
 * the current preset never indexes the list with a value that is not in it.
 *
 * This module imports only types, so a component that shows or edits the
 * current preset does not load the database module for it.
 */
export function currentPresetOf(db: Database): botPreset | undefined {
    return db.botPresets?.[db.botPresetsId]
}

/** Sets the image of the current preset. With no current preset there is nothing to set and nothing is written; returns whether an image was set. */
export function setCurrentPresetImage(db: Database, image: string): boolean {
    const preset = currentPresetOf(db)
    if (preset === undefined) {
        return false
    }
    preset.image = image
    return true
}

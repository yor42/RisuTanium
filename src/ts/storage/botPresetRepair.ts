import { presetFromWorkingSettings, type Database } from './database.svelte'


/** What the appended preset is called: the name the "new preset" action gives one. */
const APPENDED_PRESET_NAME = 'New Preset'

/**
 * Repairs a `botPresetsId` that names no preset, on a database that was just
 * loaded (boot, a restore). It is not run on every `setDatabase`, so a plugin's
 * own call is left as it wrote it.
 *
 * An id that is not an integer, is below -1, or is at or past the end of the
 * list gets the out-of-bounds rule of `saveCurrentPreset` applied once: the
 * working settings are appended as a new preset and the id points at it, so no
 * stored preset is overwritten and the working settings survive the next preset
 * switch. `-1`, the "no current preset" value `saveCurrentPreset` already
 * exempts, is left as it is, and so is an id that is not set at all
 * (`setDatabase` fills it in). Returns whether a preset was appended.
 */
export function repairBotPresetsId(db: Database): boolean {
    const id = db.botPresetsId
    if (id === undefined || id === null || id === -1) {
        return false
    }
    const presets = Array.isArray(db.botPresets) ? db.botPresets : []
    if (Number.isInteger(id) && id >= 0 && id < presets.length) {
        return false
    }
    presets.push(presetFromWorkingSettings(db, APPENDED_PRESET_NAME, ''))
    db.botPresets = presets
    db.botPresetsId = presets.length - 1
    return true
}

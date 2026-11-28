import type { botPreset, Database } from './database.svelte'
import { freshPresetMeta } from './presetMeta'

/**
 * Pure list operations on the persisted preset list and its active pointer. Nothing here imports a value from
 * `database.svelte` or the stores, so every harness that replaces those modules loads it unchanged.
 */
export type PresetListDb = Pick<Database, 'botPresets' | 'botPresetsId'>

/**
 * The index of the one preset that holds `id`, or -1 when none holds it or several do (no way to tell which is
 * meant). Resolved at the moment an action runs, never cached across an await.
 */
export function presetIndexById(presets: readonly (Pick<botPreset, 'id'> | undefined)[], id: string): number {
    if (typeof id !== 'string' || id === '') {
        return -1
    }
    let found = -1
    for (let index = 0; index < presets.length; index++) {
        if (presets[index]?.id === id) {
            if (found !== -1) {
                return -1
            }
            found = index
        }
    }
    return found
}

/**
 * Moves the entry at `fromIndex` to the insertion position `toIndex` (a position before the removal, so a forward
 * move lands one earlier) and keeps `botPresetsId` on the same preset. Returns whether the list changed.
 */
export function movePresetIndex(db: PresetListDb, fromIndex: number, toIndex: number): boolean {
    if (fromIndex === toIndex) return false
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= db.botPresets.length || toIndex > db.botPresets.length) return false

    const botPresets = [...db.botPresets]
    const movedItem = botPresets.splice(fromIndex, 1)[0]
    if (!movedItem) return false

    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    botPresets.splice(adjustedToIndex, 0, movedItem)

    const currentId = db.botPresetsId
    if (currentId === fromIndex) {
        db.botPresetsId = adjustedToIndex
    } else if (fromIndex < currentId && adjustedToIndex >= currentId) {
        db.botPresetsId = currentId - 1
    } else if (fromIndex > currentId && adjustedToIndex <= currentId) {
        db.botPresetsId = currentId + 1
    }

    db.botPresets = botPresets
    return true
}

/** `movePresetIndex` for the preset that holds `id`; false, writing nothing, when no single preset holds it. */
export function movePresetById(db: PresetListDb, id: string, toIndex: number): boolean {
    const from = presetIndexById(db.botPresets, id)
    return from !== -1 && movePresetIndex(db, from, toIndex)
}

/**
 * Removes the preset that holds `id` without changing which preset is active: `botPresetsId` shifts down by one when
 * the removed entry lies before the active one. Refuses (false, nothing written) when no single preset holds the id,
 * when it is the only preset, and when it is the active preset: removing the active one needs the switch-and-reload
 * sequence of the caller. A `botPresetsId` of -1 or out of range is left alone and names no preset here.
 */
export function removePresetKeepingActive(db: PresetListDb, id: string): boolean {
    const at = presetIndexById(db.botPresets, id)
    if (at === -1 || db.botPresets.length <= 1 || at === db.botPresetsId) {
        return false
    }
    const next = [...db.botPresets]
    next.splice(at, 1)
    if (Number.isInteger(db.botPresetsId) && db.botPresetsId < db.botPresets.length && at < db.botPresetsId) {
        db.botPresetsId = db.botPresetsId - 1
    }
    db.botPresets = next
    return true
}

/** A new preset from `template`: a clone with a fresh id, no slot and no folder, called `name`. */
export function newPresetFromTemplate(template: botPreset, name: string, clone: (value: botPreset) => botPreset): botPreset {
    const created = clone(template)
    created.name = name
    return freshPresetMeta(created, { keepFolder: false })
}

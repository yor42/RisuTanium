import type { botPreset, Database, PresetFolder } from './database.svelte'
import { freshPresetMeta, presetFolderOf } from './presetMeta'

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

/** One block of the grouped list: a folder (null for the unfoldered block) and the list indices of its presets. */
export interface PresetSection {
    folder: PresetFolder | null
    indices: number[]
}

/**
 * The list grouped for display: one section per folder in `presetFolders` order (empty folders included), then the
 * presets that sit in no folder. A folder id that names no folder reads as no folder (`presetFolderOf`). Indices keep
 * the global order, so a folder is a filter of the one list. The unfoldered section is left out only when it is empty
 * and at least one folder exists.
 */
export function groupPresetsByFolder(db: Pick<Database, 'botPresets' | 'presetFolders'>): PresetSection[] {
    const folders = db.presetFolders ?? []
    const sections: PresetSection[] = folders.map((folder) => ({ folder, indices: [] }))
    const loose: PresetSection = { folder: null, indices: [] }
    db.botPresets.forEach((preset, index) => {
        if (!preset) return
        const folder = presetFolderOf(db, preset)
        const section = folder ? sections.find((candidate) => candidate.folder?.id === folder.id) : undefined
        ;(section ?? loose).indices.push(index)
    })
    if (loose.indices.length > 0 || sections.length === 0) sections.push(loose)
    return sections
}

/** The ids of the list in order, an empty string for an entry without a usable id. */
export function presetOrderIds(presets: readonly (Pick<botPreset, 'id'> | undefined)[]): string[] {
    return presets.map((preset) => (typeof preset?.id === 'string' ? preset.id : ''))
}

/**
 * The insertion position for `movePresetById` that moves the preset one place up (-1) or down (1) among the presets of
 * its own folder section, passing the neighbouring row of that section; null at the end of the section or when no
 * single preset holds the id. Rows of other sections between the two shift by one and keep their order among
 * themselves.
 */
export function stepTargetIndex(db: Pick<Database, 'botPresets' | 'presetFolders'>, id: string, step: -1 | 1): number | null {
    const at = presetIndexById(db.botPresets, id)
    if (at === -1) return null
    const section = groupPresetsByFolder(db).find((candidate) => candidate.indices.includes(at))
    if (!section) return null
    const neighbour = section.indices[section.indices.indexOf(at) + step]
    if (neighbour === undefined) return null
    return step === -1 ? neighbour : neighbour + 1
}

/**
 * Puts the list back in the order `beforeIds` while it is still exactly in the order `afterIds`; false, writing nothing,
 * when a later edit changed the order, added or removed a preset, or an id repeats. `botPresetsId` follows the
 * preset that is active now, by id, so an undo never switches the active preset.
 */
export function restorePresetOrder(db: PresetListDb, beforeIds: readonly string[], afterIds: readonly string[]): boolean {
    const current = presetOrderIds(db.botPresets)
    if (current.length !== afterIds.length || current.some((id, at) => id === '' || id !== afterIds[at])) return false
    if (new Set(current).size !== current.length || beforeIds.length !== current.length) return false
    const byId = new Map(db.botPresets.map((preset) => [preset.id as string, preset]))
    const restored = beforeIds.map((id) => byId.get(id))
    if (restored.some((preset) => preset === undefined)) return false
    const activeId = db.botPresets[db.botPresetsId]?.id
    const next = restored as botPreset[]
    const pointer = activeId === undefined ? -1 : next.findIndex((preset) => preset.id === activeId)
    db.botPresets = next
    if (pointer !== -1) db.botPresetsId = pointer
    return true
}

/** One preset's folder before and after a move; `undefined` is no folder. */
export interface FolderMoveStep {
    id: string
    before: string | undefined
    after: string | undefined
}

/** Undoes a folder move while the preset still holds `after` and `before` still names a folder (or is none). */
export function undoFolderMove(db: Pick<Database, 'botPresets' | 'presetFolders'>, move: FolderMoveStep): boolean {
    const at = presetIndexById(db.botPresets, move.id)
    if (at === -1 || db.botPresets[at].folderId !== move.after) return false
    if (move.before !== undefined && !(db.presetFolders ?? []).some((folder) => folder.id === move.before)) return false
    if (move.before === undefined) delete db.botPresets[at].folderId
    else db.botPresets[at].folderId = move.before
    return true
}
import { language } from '../../lang'
import { alertConfirm, alertError } from '../alert'
import { prebuiltPresets } from '../process/templates/templates'
import { safeStructuredClone } from '../polyfill'
import { changeToPreset, copyPreset } from '../storage/database.svelte'
import { cutFolderName } from '../storage/presetBundle'
import { newPresetFromTemplate, presetIndexById, removePresetKeepingActive } from '../storage/presetListOps'
import { createPresetFolder, deletePresetFolder, movePresetFolder, movePresetToFolder, renamePresetFolder } from '../storage/presetMeta'
import { DBState } from '../stores.svelte'
import { presetOwnerKey } from './edit/presetTarget'
import type { StudioResult } from './history/ownerHistory.svelte'
import { beginOwnerVisit, loadStudioHistoryService } from './history/studioHistoryService.svelte'

// The "Manage presets" sheet's actions. Every one takes a preset id and resolves it at the moment it runs, so a list
// rendered from an older snapshot, a reorder or an import in between cannot send an action to another preset. List
// operations are not steps of any preset's history; only the name goes through the history service.

export type PresetListResult =
    | { ok: true; id?: string }
    | { ok: false; reason: 'gone' | 'only' | 'cancelled' | 'required' | 'folder-gone' }

const GONE: PresetListResult = { ok: false, reason: 'gone' }
const FOLDER_GONE: PresetListResult = { ok: false, reason: 'folder-gone' }

/** What `copyPreset` appends to the copied name before the sheet replaces it with the translated suffix. */
const CLASSIC_COPY_SUFFIX = ' Copy'

/** Appends a new preset from the default template to the end of the list. The active preset does not change. */
export function newPreset(): PresetListResult {
    const created = newPresetFromTemplate(prebuiltPresets.OAI2, language.studioPresetNewName, safeStructuredClone)
    const db = DBState.db
    const presets = db.botPresets
    presets.push(created)
    db.botPresets = presets
    return { ok: true, id: created.id }
}

/** Copies the preset: the current working copy is saved first, so a copy of the active preset carries its latest edits. */
export function copyPresetById(id: string): PresetListResult {
    const index = presetIndexById(DBState.db.botPresets, id)
    if (index === -1) return GONE
    copyPreset(index)
    const presets = DBState.db.botPresets
    const copied = presets[presets.length - 1]
    if (copied && typeof copied.name === 'string' && copied.name.endsWith(CLASSIC_COPY_SUFFIX)) {
        copied.name = copied.name.slice(0, -CLASSIC_COPY_SUFFIX.length) + language.studioPresetCopySuffix
    }
    return { ok: true, id: copied?.id }
}

/** Makes the preset the active one (the current working copy is saved first). Already active is a no-op. */
export function useInChats(id: string): PresetListResult {
    const index = presetIndexById(DBState.db.botPresets, id)
    if (index === -1) return GONE
    if (index !== DBState.db.botPresetsId) changeToPreset(index)
    return { ok: true, id }
}

/**
 * Deletes the preset after classic's confirm. The id is resolved again after the confirm, because the list may have
 * changed while it was open. A preset that is not the active one is removed with the active preset kept; the active
 * one goes through classic's sequence (switch to the first preset, remove, reload it).
 */
export async function deletePresetById(id: string): Promise<PresetListResult> {
    const before = DBState.db.botPresets.find((preset) => preset?.id === id)
    if (presetIndexById(DBState.db.botPresets, id) === -1 || !before) return GONE
    if (DBState.db.botPresets.length === 1) {
        alertError(language.errors.onlyOneChat)
        return { ok: false, reason: 'only' }
    }
    if (!(await alertConfirm(`${language.removeConfirm}${before.name}`))) {
        return { ok: false, reason: 'cancelled' }
    }
    const db = DBState.db
    const index = presetIndexById(db.botPresets, id)
    if (index === -1) return GONE
    if (db.botPresets.length <= 1) {
        alertError(language.errors.onlyOneChat)
        return { ok: false, reason: 'only' }
    }
    if (index === db.botPresetsId) {
        changeToPreset(0)
        const presets = db.botPresets
        presets.splice(index, 1)
        db.botPresets = presets
        changeToPreset(0, false)
        return { ok: true }
    }
    return removePresetKeepingActive(db, id) ? { ok: true } : GONE
}

/** Writes the preset's name through the Studio name step (one undoable step of the preset's own history). */
export async function renamePresetById(id: string, name: string): Promise<StudioResult> {
    if (presetIndexById(DBState.db.botPresets, id) === -1) return { ok: false, reason: 'gone' }
    const service = await loadStudioHistoryService()
    const owner = presetOwnerKey(id)
    beginOwnerVisit(owner)
    const result = service.editText(owner, 'presetName', name, 'single')
    service.closeOpenStep(owner)
    return result
}

/** A folder name as stored: trimmed and cut to the bundle's folder-name cap; null when nothing is left. */
export function cleanFolderName(name: string): string | null {
    const cut = cutFolderName(name.trim())
    return cut === '' ? null : cut
}

/** Adds a folder at the end of the folder list. An empty (after trimming) name is refused. */
export function createFolder(name: string): PresetListResult {
    const clean = cleanFolderName(name)
    if (clean === null) return { ok: false, reason: 'required' }
    return { ok: true, id: createPresetFolder(DBState.db, clean) }
}

export function renameFolder(id: string, name: string): PresetListResult {
    const clean = cleanFolderName(name)
    if (clean === null) return { ok: false, reason: 'required' }
    return renamePresetFolder(DBState.db, id, clean) ? { ok: true, id } : FOLDER_GONE
}

/**
 * Deletes the folder after a confirm that names how many presets become unfoldered. The folder is resolved again after
 * the confirm; no preset is removed.
 */
export async function deleteFolderById(id: string): Promise<PresetListResult> {
    const folders = DBState.db.presetFolders ?? []
    if (!folders.some((folder) => folder.id === id)) return FOLDER_GONE
    const members = DBState.db.botPresets.filter((preset) => preset?.folderId === id).length
    if (!(await alertConfirm(language.studioPresetFolderDeleteConfirm(members)))) {
        return { ok: false, reason: 'cancelled' }
    }
    return deletePresetFolder(DBState.db, id) ? { ok: true } : FOLDER_GONE
}

/** Puts the preset in the folder, or takes it out of every folder when `folderId` is undefined. Both ids resolve now. */
export function movePresetToFolderById(presetId: string, folderId: string | undefined): PresetListResult {
    const index = presetIndexById(DBState.db.botPresets, presetId)
    if (index === -1) return GONE
    return movePresetToFolder(DBState.db, index, folderId) ? { ok: true, id: presetId } : FOLDER_GONE
}

/** Moves the folder one place up or down in the folder order; at either end it does nothing. */
export function moveFolderBy(id: string, step: -1 | 1): PresetListResult {
    const folders = DBState.db.presetFolders ?? []
    const at = folders.findIndex((folder) => folder.id === id)
    if (at === -1) return FOLDER_GONE
    const to = at + step
    if (to < 0 || to >= folders.length) return { ok: true, id }
    return movePresetFolder(DBState.db, id, to) ? { ok: true, id } : FOLDER_GONE
}
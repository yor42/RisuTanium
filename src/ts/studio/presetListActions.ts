import { language } from '../../lang'
import { alertConfirm, alertError } from '../alert'
import { prebuiltPresets } from '../process/templates/templates'
import { safeStructuredClone } from '../polyfill'
import { changeToPreset, copyPreset, downloadPreset, importPreset } from '../storage/database.svelte'
import { cutFolderName } from '../storage/presetBundle'
import { movePresetById, newPresetFromTemplate, presetIndexById, presetOrderIds, removePresetKeepingActive, restorePresetOrder, stepTargetIndex, undoFolderMove } from '../storage/presetListOps'
import { applySlotPlan, createPresetFolder, deletePresetFolder, movePresetFolder, movePresetToFolder, planSlotAssign, renamePresetFolder } from '../storage/presetMeta'
import { slotUndoAction } from '../setting/hotkeyPage'
import { postUndoToast, type UndoAction } from '../toast/toastHost.svelte'
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

const undoTexts = () => ({ undone: language.studioPresetUndone, refused: language.studioPresetUndoRefused, failed: language.studioPresetUndoFailed })

let undoCounter = 0

/** A toast Undo that runs `revert` while the list is as the change left it (`revert` returns false when it is not). */
function listUndoAction(revert: () => boolean): UndoAction {
    const texts = undoTexts()
    return {
        id: 'preset-list:' + (++undoCounter),
        failedText: texts.failed,
        run: () => revert() ? { ok: true, text: texts.undone } : { ok: false, text: texts.refused, after: 'close' },
    }
}

function postListUndo(text: string, revert: () => boolean): void {
    postUndoToast({ text, actionLabel: language.uiCommon.undo, action: listUndoAction(revert) })
}

/** Moves the preset in the list to the insertion position `toIndex` and offers Undo; a move that changes nothing posts none. */
function moveWithUndo(id: string, toIndex: number): PresetListResult {
    const db = DBState.db
    const before = presetOrderIds(db.botPresets)
    if (!movePresetById(db, id, toIndex)) return presetIndexById(db.botPresets, id) === -1 ? GONE : { ok: true, id }
    const after = presetOrderIds(db.botPresets)
    postListUndo(language.studioPresetReordered, () => restorePresetOrder(DBState.db, before, after))
    return { ok: true, id }
}

/** Move up or down past the neighbouring preset of the same folder section; at the end of the section nothing happens. */
export function movePresetStepById(id: string, step: -1 | 1): PresetListResult {
    if (presetIndexById(DBState.db.botPresets, id) === -1) return GONE
    const to = stepTargetIndex(DBState.db, id, step)
    return to === null ? { ok: true, id } : moveWithUndo(id, to)
}

/** Drag and drop: the dragged preset takes the place of the preset it was dropped on. Both ids resolve now. */
export function dropPresetOnById(id: string, targetId: string): PresetListResult {
    const from = presetIndexById(DBState.db.botPresets, id)
    const target = presetIndexById(DBState.db.botPresets, targetId)
    if (from === -1 || target === -1) return GONE
    return moveWithUndo(id, from < target ? target + 1 : target)
}

/** `movePresetToFolderById` with a toast Undo that refuses once the preset's folder was changed again. */
export function moveToFolderWithUndo(presetId: string, folderId: string | undefined): PresetListResult {
    const presets = DBState.db.botPresets
    const at = presetIndexById(presets, presetId)
    const before = at === -1 ? undefined : presets[at].folderId
    const result = movePresetToFolderById(presetId, folderId)
    if (result.ok && before !== folderId) {
        const step = { id: presetId, before, after: folderId }
        postListUndo(language.studioPresetMovedToFolder, () => undoFolderMove(DBState.db, step))
    }
    return result
}

/** What assigning slot `n` to the preset would do: the plan, and the preset that holds the slot now when it is another. */
export type SlotAssignment =
    | { ok: true; plan: ReturnType<typeof planSlotAssign>; holder: { id: string; name: string } | null; moverSlot: number | undefined }
    | { ok: false; reason: 'gone' }

/** Plans slot `n` (or clearing it when `n` is null for the slot `clearSlot`) for the preset that holds `id`. */
export function planSlotForPreset(id: string, n: number | null, clearSlot?: number): SlotAssignment {
    const presets = DBState.db.botPresets
    const at = presetIndexById(presets, id)
    if (at === -1) return { ok: false, reason: 'gone' }
    if (n === null) {
        return { ok: true, plan: clearSlot === undefined ? [] : planSlotAssign(presets, clearSlot, null), holder: null, moverSlot: presets[at].slot }
    }
    const holderIndex = presets.findIndex((preset, index) => index !== at && preset?.slot === n)
    const holder = holderIndex === -1 ? null : { id: presets[holderIndex].id ?? '', name: presets[holderIndex].name }
    return { ok: true, plan: planSlotAssign(presets, n, at), holder, moverSlot: presets[at].slot }
}

/** Writes a slot plan and offers the Hotkeys page's Undo (reused unchanged). False, writing nothing, when it is empty or a preset is gone. */
export function commitSlotPlan(plan: ReturnType<typeof planSlotAssign>): boolean {
    if (plan.length === 0 || !applySlotPlan(DBState.db.botPresets, plan)) return false
    postUndoToast({
        text: language.settingsShellHkSlotSet,
        actionLabel: language.uiCommon.undo,
        action: slotUndoAction(() => DBState.db.botPresets ?? [], plan, { undone: language.settingsShellHkUndone, refused: language.settingsShellHkUndoRefused, failed: language.settingsShellHkUndoFailed }),
    })
    return true
}

/**
 * Exports the preset as a `.risup` file through `downloadPreset`, which is what classic's file choice runs. The Realm
 * choice of classic's export dialog is not offered. The id is resolved now; `downloadPreset` saves the working copy
 * first and strips meta and keys itself.
 */
export async function exportPresetById(id: string): Promise<PresetListResult> {
    const index = presetIndexById(DBState.db.botPresets, id)
    if (index === -1) return GONE
    await downloadPreset(index, 'risupreset')
    return { ok: true, id }
}

/** Exports the presets with these ids, in list order, as one bundle (an empty selection does nothing). */
export async function exportBundleByIds(ids: readonly string[]): Promise<PresetListResult> {
    if (ids.length === 0) return { ok: true }
    // Loaded on use so the sheet does not pull the bundle codec in when no bundle is exported.
    const { downloadPresetBundle } = await import('../storage/presetBundleFlow')
    await downloadPresetBundle(ids)
    return { ok: true }
}

/** Classic's import, unchanged: the file picker, the bundle preview, the converters and the trust rule are its own. */
export async function importPresetsFromPicker(): Promise<PresetListResult> {
    const outcome = await importPreset()
    return outcome && 'cancelled' in outcome ? { ok: false, reason: 'cancelled' } : { ok: true }
}
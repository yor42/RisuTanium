import { tick } from 'svelte'
import { alertConfirm, alertError, alertNormalWait } from '../alert'
import { language } from 'src/lang'
import { markAppInitiatedReload } from '../reloadGuard'
import { changeToPreset, saveCurrentPreset, type Database } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { defaultColorScheme, PACK_SCHEME_NAME } from '../gui/colorschemeCore'
import { isSaveClean } from '../globalApi.svelte'
import { SETTINGS_FIELDS } from './rtb/settingsFields'
import { DEVICE_LIST_KEYS, planSettingsMerge, readSettingsPayload, type DeviceLists, type SettingsPayloadInput, type SettingsRead } from './rtb/settingsPayload'
import type { OperationOutcome } from './operationEnd'
import { reloadAfterRestore } from './restoreReload'
import type { RtbRunOptions } from './rtbRestoreEntry'
import { settingsSource } from './rtbSettingsSource.svelte'
import { saveFirst, SAVE_FIRST_BOUND_MS } from './storeRestore'

/**
 * The apply of a settings-only `.rtb` (#161): the decoded file is merged into the device's settings and presets, saved,
 * and the page reloads. It never installs a store, takes no restore hold and copies no entry.
 *
 * Invariants:
 * - A refusal (the Welcome restore, a file the reader refuses, a cancelled confirm) happens before the first write.
 * - The device's working edits are saved into the selected preset's slot, the merge is planned again on fresh values and
 *   the writes follow, as one synchronous block: nothing can change the device's presets between the plan and the writes.
 * - The preset list and the working fields move together: the selected preset is applied through `changeToPreset`
 *   without saving, so the working fields are the merged preset's over the file's own fields and `botPresetsId` names it.
 * - Every write goes through the live database, where the change effects mark it for the save.
 * - The interface preferences are written only after the save is clean, and only the keys the file holds.
 * - The page reloads only after a clean save.
 */

/** The calls the apply makes; tests replace them to observe order and to keep the page out of it. */
export interface SettingsRestoreDeps {
    /** The device's seven list and index values, read fresh on every call. */
    lists(): DeviceLists
    /** The live database the writes land on. */
    db(): Database
    confirm(text: string): Promise<boolean>
    error(text: string): void | Promise<void>
    /** An OK-only notice, resolved when the person dismisses it. */
    notice(text: string): Promise<void>
    saveCurrentPreset(): void
    changeToPreset(id: number, saveCurrent: boolean): void
    tick(): Promise<void>
    saveFirst(quiet: boolean): Promise<void>
    isSaveClean(): boolean
    writeUiPref(key: string, value: string): void
    markReload(): void
    reload(): Promise<void>
}

function realDeps(): SettingsRestoreDeps {
    return {
        lists: () => {
            const source = settingsSource(DEVICE_LIST_KEYS)
            return {
                botPresets: source.get('botPresets'),
                botPresetsId: source.get('botPresetsId'),
                presetFolders: source.get('presetFolders'),
                hypaV3Presets: source.get('hypaV3Presets'),
                hypaV3PresetId: source.get('hypaV3PresetId'),
                translatorPresets: source.get('translatorPresets'),
                translatorPresetId: source.get('translatorPresetId'),
            }
        },
        db: () => DBState.db,
        confirm: alertConfirm,
        error: alertError,
        notice: alertNormalWait,
        saveCurrentPreset,
        changeToPreset,
        tick,
        saveFirst: (quiet) => quiet ? saveFirst(SAVE_FIRST_BOUND_MS, { quiet: true }) : saveFirst(SAVE_FIRST_BOUND_MS),
        isSaveClean,
        writeUiPref: (key, value) => localStorage.setItem(key, value),
        markReload: markAppInitiatedReload,
        reload: reloadAfterRestore,
    }
}

const CARRIED_FIELDS: ReadonlySet<string> = new Set(SETTINGS_FIELDS)

/** The scheme fields a file made under the pack scheme must not write: a settings file never brings pack colours onto a device. */
const PACK_COLOUR_FIELDS: ReadonlySet<string> = new Set(['colorSchemeName', 'colorScheme'])

/** Writes the merged values onto the live database: the non-list fields, then the lists and indices, then the selection. */
function writeMerged(db: Database, read: SettingsRead, plan: ReturnType<typeof planSettingsMerge>, deps: SettingsRestoreDeps): void {
    const packScheme = read.fields.colorSchemeName === PACK_SCHEME_NAME
    for (const [key, value] of Object.entries(read.fields)) {
        if (CARRIED_FIELDS.has(key) && !(packScheme && PACK_COLOUR_FIELDS.has(key))) {
            Reflect.set(db, key, value)
        }
    }
    if (packScheme && db.colorSchemeName === 'custom') {
        // The painted colours follow the restored Custom slot, as picking Custom does.
        db.colorScheme = safeStructuredClone(db.customColorScheme ?? defaultColorScheme)
    }
    if (plan.botPresets !== undefined) {
        db.botPresets = plan.botPresets
    }
    if (plan.presetFolders !== undefined) {
        db.presetFolders = plan.presetFolders
    }
    if (plan.hypaV3Presets !== undefined) {
        db.hypaV3Presets = plan.hypaV3Presets
    }
    if (plan.hypaIndex !== undefined) {
        db.hypaV3PresetId = plan.hypaIndex
    }
    if (plan.translatorPresets !== undefined) {
        db.translatorPresets = plan.translatorPresets
    }
    if (plan.translatorIndex !== undefined) {
        db.translatorPresetId = plan.translatorIndex
    }
    if (plan.selectedIndex !== undefined) {
        deps.changeToPreset(plan.selectedIndex, false)
    }
}

export async function applySettingsRestore(
    settings: SettingsPayloadInput,
    run: Pick<RtbRunOptions, 'firstRun' | 'card'> = {},
    options: Partial<SettingsRestoreDeps> = {},
): Promise<{ outcome: OperationOutcome }> {
    const deps: SettingsRestoreDeps = { ...realDeps(), ...options }

    if (run.firstRun === true) {
        await deps.error(language.rtbRestoreSettingsAtStart)
        return { outcome: 'nothing-replaced' }
    }

    const read = readSettingsPayload(settings)
    if ('refused' in read) {
        await deps.error(language.rtbRestoreDamaged)
        return { outcome: 'nothing-replaced' }
    }
    const preview = planSettingsMerge(deps.lists(), read)
    const { fields, presets, memoryPresets, translatorPresets, dropped } = preview.counts
    if (!await deps.confirm(language.rtbRestoreSettingsConfirm(fields, presets, memoryPresets, translatorPresets, dropped))) {
        return { outcome: 'canceled' }
    }

    // No await from here to the end of the writes.
    deps.saveCurrentPreset()
    const plan = planSettingsMerge(deps.lists(), read)
    writeMerged(deps.db(), read, plan, deps)

    await deps.tick()
    await deps.saveFirst(run.card === true)
    if (!deps.isSaveClean()) {
        await deps.notice(language.rtbRestoreSettingsNotSaved)
        return { outcome: 'committed' }
    }
    for (const { key, value } of read.uiPrefs) {
        try {
            deps.writeUiPref(key, value)
        } catch (error) {
            console.error(error)
        }
    }
    await deps.notice(language.rtbRestoreSettingsDone)
    deps.markReload()
    await deps.reload()
    return { outcome: 'committed' }
}

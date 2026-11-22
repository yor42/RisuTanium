/**
 * The Settings entry of the `.rtb` export (CHORE-128 S9): the refusal check, one confirm, the run with its progress
 * texts, and the notice that follows it. Every text comes from `language`; the core (`rtbExport.ts`) holds none.
 *
 * Contracts:
 *  - A refusal shows its text before anything is asked, registered or opened.
 *  - A second start while one run is in flight is ignored, so two quick taps never stack two confirms.
 *  - The saved ending follows `saved` only, and is built from the report (`report.omitted` is the only place a
 *    side-section omission appears), never from the outcome's `ExportOmitted`. The run posts it on its task card.
 *  - A failed or cancelled run adds no notice here: the S7 shell has already said what became of the file.
 */
import { language } from 'src/lang'
import { isTauri } from 'src/ts/platform'
import { alertClear, alertConfirm, alertError, alertNormal } from '../alert'
import { shownPromptNames } from './backupUpstreamSizes'
import { exportKeysLateText } from './exportKeys'
import type { ExportTaskStepDef } from '../exportTask'
import { exportSettingsRtb, type SettingsRtbResult } from './rtbSettingsExport'
import {
    exportRtb, rtbExportRefusal,
    type RtbExportCard, type RtbExportOptions, type RtbExportProgress, type RtbExportRefusal, type RtbExportReport, type RtbExportResult, type RtbStep,
} from './rtbExport'

export interface RtbEntryDeps {
    refusal(): Promise<RtbExportRefusal | null>
    confirm(msg: string): Promise<boolean>
    run(options: RtbExportOptions): Promise<RtbExportResult>
    error(msg: string): void
    normal(msg: string): void
    clear(): void
    isTauri: boolean
}

export function rtbProgressText(event: RtbExportProgress): string {
    switch (event.phase) {
        case 'opening':
            return language.rtbExportProgressOpening
        case 'saving':
            return language.store2RestoreSaving
        case 'units':
            return language.rtbExportProgressUnits(event.units)
        case 'side':
            return language.rtbExportProgressSide
        case 'inlays':
            return language.rtbExportProgressInlays(event.done, event.total)
        case 'assets':
            return language.rtbExportProgressAssets(event.done, event.total)
        case 'finishing':
            return language.rtbExportProgressFinishing
    }
}

export function rtbRefusalText(reason: RtbExportRefusal): string {
    return reason === 'read-only'
        ? language.rtbExportRefusedReadOnly(language.saveBackupLocal)
        : language.rtbExportUnavailable(language.saveBackupLocal)
}

function namesOf(report: RtbExportReport, kind: string): string[] {
    return report.omitted.filter((entry) => entry.kind === kind).map((entry) => entry.name)
}

/** The success text, then the unsaved-changes paragraph, then one paragraph per kind of data left out. */
export function rtbSavedNotice(report: RtbExportReport, isTauriPage: boolean): string {
    const parts = [isTauriPage ? language.rtbExportSaved : language.exportDownloadStarted]
    if (report.unsavedExcluded) {
        parts.push(language.rtbExportUnsavedExcluded(new Date(report.committedAt).toLocaleString()))
    }
    const units = namesOf(report, 'unit')
    const assets = namesOf(report, 'asset')
    const inlays = namesOf(report, 'inlay')
    const sides = namesOf(report, 'side')
    const paragraphs: string[] = []
    if (units.length > 0) {
        paragraphs.push(language.rtbExportUnitsLeftOut(units.length))
    }
    if (assets.length > 0) {
        paragraphs.push(language.rtbExportAssetsLeftOut(assets.length, shownPromptNames(assets)))
    }
    if (inlays.length > 0) {
        paragraphs.push(language.backupInlaysLeftOut(inlays.length, shownPromptNames(inlays)))
    }
    if (report.oldInlayStoreUnlisted) {
        paragraphs.push(language.backupInlaysOldStoreUnlisted)
    }
    if (sides.length > 0) {
        paragraphs.push(language.rtbExportSideLeftOut(sides.length))
    }
    if (report.keysLeftOutLate.length > 0) {
        paragraphs.push(exportKeysLateText(report.keysLeftOutLate))
    }
    if (paragraphs.length > 0) {
        parts.push(language.backupDataLeftOut, ...paragraphs)
    }
    return parts.join('\n\n')
}

/** The task card of a run: its steps by the ids the core reports, with their labels. */
function rtbExportCard(isTauriPage: boolean): RtbExportCard {
    const steps: readonly ExportTaskStepDef<RtbStep>[] = [
        { id: 'prepare', label: language.exportStepPrepare },
        { id: 'save', label: language.rtbStepSaveFirst },
        { id: 'units', label: language.rtbStepUnits },
        { id: 'side', label: language.rtbStepSide },
        { id: 'inlays', label: language.backupStepInlays, noun: language.backupNounInlays, mark: 'transfer_out' },
        { id: 'assets', label: language.exportStepAssets, noun: language.importNounAssets, mark: 'transfer_out' },
        { id: 'finish', label: language.exportStepWrite },
    ]
    return {
        def: {
            title: language.rtbExportTaskTitle,
            steps,
            doneHeadline: language.backupTaskDone,
            failedHeadline: language.backupTaskFailed,
        },
        // A report ends on the notice that names what the file lacks; a clean save ends on the done card.
        savedEnding: (report) => report.unsavedExcluded || report.omitted.length > 0 || report.oldInlayStoreUnlisted || report.keysLeftOutLate.length > 0
            ? { notice: rtbSavedNotice(report, isTauriPage) }
            : { summary: [isTauriPage ? language.rtbExportSaved : language.exportDownloadStarted] },
    }
}

export function liveRtbEntryDeps(): RtbEntryDeps {
    return {
        refusal: () => rtbExportRefusal(),
        confirm: alertConfirm,
        run: exportRtb,
        error: alertError,
        normal: alertNormal,
        clear: alertClear,
        isTauri,
    }
}

let inFlight = false

/** Resolves to the run's result, or `null` when nothing ran (a refusal, a declined confirm or a start already in flight). */
export async function startRtbExport(deps: RtbEntryDeps = liveRtbEntryDeps(), options: { password?: string } = {}): Promise<RtbExportResult | null> {
    if (inFlight) {
        return null
    }
    inFlight = true
    try {
        const reason = await deps.refusal()
        if (reason !== null) {
            deps.error(rtbRefusalText(reason))
            return null
        }
        if (!await deps.confirm(language.rtbExportConfirm(language.saveBackupLocal))) {
            return null
        }
        // The run's task card carries every ending: the saved text, a report notice and the failures. The entry posts
        // only a refusal, and clears nothing after a dismissed save dialog, so no unrelated notice is erased.
        const result = await deps.run({ progressText: rtbProgressText, card: rtbExportCard(deps.isTauri), password: options.password })
        if (result.status === 'refused') {
            deps.error(rtbRefusalText(result.reason))
        }
        return result
    } finally {
        inFlight = false
    }
}

let settingsInFlight = false

export interface SettingsRtbEntryDeps {
    run(options: Parameters<typeof exportSettingsRtb>[0]): Promise<SettingsRtbResult>
    isTauri: boolean
}

/**
 * The settings-only entry: the run's task card carries every ending, as for the full export. Nothing is asked first,
 * because the file holds no data of any other kind, and a failure or a cancel is reported by the shell. Resolves to
 * `null` when a start is already in flight.
 */
export async function startSettingsRtbExport(deps: SettingsRtbEntryDeps = { run: exportSettingsRtb, isTauri }, options: { password?: string } = {}): Promise<SettingsRtbResult | null> {
    if (settingsInFlight) {
        return null
    }
    settingsInFlight = true
    try {
        return await deps.run({
            progressText: rtbProgressText,
            card: {
                def: {
                    title: language.rtbSettingsExportTaskTitle,
                    steps: [
                        { id: 'prepare', label: language.exportStepPrepare },
                        { id: 'side', label: language.rtbStepSide },
                        { id: 'finish', label: language.exportStepWrite },
                    ],
                    doneHeadline: language.backupTaskDone,
                    failedHeadline: language.backupTaskFailed,
                },
                summary: [deps.isTauri ? language.rtbExportSaved : language.exportDownloadStarted],
            },
            password: options.password,
        })
    } finally {
        settingsInFlight = false
    }
}

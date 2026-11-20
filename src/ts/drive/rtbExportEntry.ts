/**
 * The Settings entry of the `.rtb` export (CHORE-128 S9): the refusal check, one confirm, the run with its progress
 * texts, and the notice that follows it. Every text comes from `language`; the core (`rtbExport.ts`) holds none.
 *
 * Contracts:
 *  - A refusal shows its text before anything is asked, registered or opened.
 *  - A second start while one run is in flight is ignored, so two quick taps never stack two confirms.
 *  - The saved notice follows `saved` only, and is built from the report (`report.omitted` is the only place a
 *    side-section omission appears), never from the outcome's `ExportOmitted`.
 *  - A failed or cancelled run adds no notice here: the S7 shell has already said what became of the file.
 */
import { language } from 'src/lang'
import { isTauri } from 'src/ts/platform'
import { alertClear, alertConfirm, alertError, alertNormal } from '../alert'
import { shownPromptNames } from './backupUpstreamSizes'
import {
    exportRtb, rtbExportRefusal,
    type RtbExportOptions, type RtbExportProgress, type RtbExportRefusal, type RtbExportReport, type RtbExportResult,
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
    if (paragraphs.length > 0) {
        parts.push(language.backupDataLeftOut, ...paragraphs)
    }
    return parts.join('\n\n')
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
        const result = await deps.run({ progressText: rtbProgressText, password: options.password })
        if (result.status === 'refused') {
            deps.error(rtbRefusalText(result.reason))
        } else if (result.outcome.status === 'saved') {
            if (result.report !== null) {
                deps.normal(rtbSavedNotice(result.report, deps.isTauri))
            } else {
                deps.normal(deps.isTauri ? language.rtbExportSaved : language.exportDownloadStarted)
            }
        } else if (result.outcome.status === 'declined' && result.outcome.cause === 'save-dialog-cancelled') {
            deps.clear()
        }
        return result
    } finally {
        inFlight = false
    }
}

import { alertNormalWait, alertWait } from '../alert'
import { language } from 'src/lang'
import { markAppInitiatedReload } from '../reloadGuard'
import { sideDataName, SIDE_SECTION_IDS, type SideSectionId } from './rtb/entryNames'
import { RtbCouldNotReadError } from './rtb/rangeSource'
import { applySideAction, defaultSideBackends, sideResultIsNamed, type SideBackends, type SideBodyReader, type SideRestoreResult } from './rtb/sideStores'
import { readEntry } from './rtb/zip64Reader'
import { shownSkippedNames, skippedNoticesOf } from './backuplocal'
import { reloadAfterRestore } from './restoreReload'
import type { RtbInstallFacts } from './rtbRestoreCopy'
import type { RestoreHold } from './rtbRestoreHold'
import type { RestorePlan } from './rtbRestorePlan'

/**
 * The finish stage of a `.rtb` restore (CHORE-128 S12b), run after the commit landed: the side data (S.1), the notices
 * (S.2) and the reload (S.3).
 *
 * `finishRtbRestore` never rejects. Any throw after the commit landed releases the hold with the write lock kept closed
 * and then shows `restoreSavedReloadOrRestart`, each in a `try` of its own and the release first, so neither can keep the
 * other from running; the restore itself stays committed.
 *
 * Invariants:
 * - The write lock stays closed from the commit to the reload: the hold is only ever released with `keepWriteLock`.
 * - The notices are shown, each awaited, before the hold is released, so the reload cannot take the page away before the
 *   person has read what was left out.
 * - The hold is released, then the reload is marked app-initiated, then the page reloads: the mark outlives only a short
 *   time, and the release can queue behind another tab.
 * - Every section of the side data is attempted; a throw in one is named in the notice and does not stop the others.
 * - The plugin grants are cleared whatever the file holds for them (MC-2047, MC-2252).
 * - No restore-time re-check of the page runs here: the commit has landed (MC-2254).
 *
 * File-supplied text (row ids, omitted entry names) only goes to alert text, cut by `shownSkippedNames`.
 */

/** The part of the plan this stage reads. */
export type RtbFinishPlan = Pick<RestorePlan, 'source' | 'index' | 'side' | 'notice' | 'assets'>
export type RtbFinishHold = Pick<RestoreHold, 'release'>
export type RtbFinishLanded = { flushed: boolean | undefined, facts: RtbInstallFacts }

/** The calls the finish makes outside the file; tests replace them to observe order and to keep the page out of it. */
export interface RtbFinishDeps {
    applySide: typeof applySideAction
    sideBackends: SideBackends
    /** An OK-only notice, resolved when the person dismisses it. */
    notice(text: string): Promise<void>
    wait(text: string): void
    markReload(): void
    reload(): Promise<void>
}

function realFinishDeps(): RtbFinishDeps {
    return {
        applySide: applySideAction,
        sideBackends: defaultSideBackends,
        notice: alertNormalWait,
        wait: alertWait,
        markReload: markAppInitiatedReload,
        reload: reloadAfterRestore,
    }
}

/** The side-data calls of the real page, for a caller that restores the sides without the rest of the finish. */
export function realSideDeps(): Pick<RtbFinishDeps, 'applySide' | 'sideBackends'> {
    return { applySide: applySideAction, sideBackends: defaultSideBackends }
}

const SIDE_NAME_KEYS: Readonly<Record<SideSectionId, keyof typeof language.rtbRestoreSideNames>> = {
    'side.iris': 'iris',
    'side.google-search': 'googleSearch',
    'side.hypa-vector': 'hypaVector',
    'side.plugin-safe': 'pluginSafe',
    'side.plugin-safe-ls': 'pluginSafeLs',
    'side.plugin-permissions': 'pluginPermissions',
    'side.mcp-tool-calls': 'mcpToolCalls',
    'side.ui-prefs': 'uiPrefs',
}

const SIDE_ORDER: readonly string[] = SIDE_SECTION_IDS

function isSideId(id: string): id is SideSectionId {
    return SIDE_ORDER.includes(id)
}

function sideNameOf(id: SideSectionId): string {
    return language.rtbRestoreSideNames[SIDE_NAME_KEYS[id]]
}

/**
 * The reader of a side section's data entry. Every section is read and validated before its store is cleared, an empty
 * entry included: its size and checksum are checked like any other, so a damaged empty entry leaves the store alone. A
 * section whose data entry is missing or doubled reads as a failure, so its store is left alone and the section is named.
 */
export function bodyReaderOf(plan: Pick<RestorePlan, 'source' | 'index'>, id: SideSectionId): SideBodyReader {
    const name = sideDataName(id)
    const found = name === null ? [] : plan.index.find(name)
    return async (sink) => {
        if (found.length !== 1) {
            return { ok: false, reason: `${id} has no single data entry` }
        }
        try {
            const read = await readEntry(plan.source, plan.index, found[0], sink)
            return read.ok === false ? { ok: false, reason: `${read.finding.code}: ${read.finding.detail}` } : { ok: true }
        } catch (error) {
            if (error instanceof RtbCouldNotReadError) {
                return { ok: false, reason: 'could not read' }
            }
            throw error
        }
    }
}

/** S.1: every side section in order; a throw becomes that section's `write-failed` result and the next section runs. */
export async function restoreSides(plan: RtbFinishPlan, deps: Pick<RtbFinishDeps, 'applySide' | 'sideBackends'>): Promise<SideRestoreResult[]> {
    const results: SideRestoreResult[] = []
    for (const item of plan.side) {
        try {
            const body = item.action.kind === 'restore' ? bodyReaderOf(plan, item.action.id) : null
            results.push(await deps.applySide(item.action, body, deps.sideBackends))
        } catch (error) {
            console.error(error)
            results.push({ id: item.action.id, status: 'write-failed', phase: 'write', written: 0, key: null, message: error instanceof Error ? error.message : String(error) })
        }
    }
    return results
}

/** The lines of the `.rtb` completion notice; empty when nothing was left out. */
export function leftOutLines(plan: Pick<RestorePlan, 'notice'>, results: readonly SideRestoreResult[]): string[] {
    const lines: string[] = []
    const notRestored: string[] = []
    const failed: string[] = []
    for (const result of results) {
        if (!sideResultIsNamed(result)) {
            continue
        }
        const name = sideNameOf(result.id)
        switch (result.status) {
            case 'omitted':
            case 'malformed':
            case 'newer':
                notRestored.push(name)
                break
            default:
                failed.push(name)
        }
    }
    const namedAsSide = new Set<string>(results.filter(sideResultIsNamed).map((result) => result.id))
    // A side section that is also a newer row or an omitted entry is named once, under its side name.
    const newerParts = plan.notice.unknownOptionalRows.filter((row) => !namedAsSide.has(row.id)).map((row) => `${row.id} (v${row.v})`)
    if (newerParts.length > 0) {
        lines.push(language.rtbRestoreLineNewerParts(shownSkippedNames(newerParts)))
    }
    if (plan.notice.omittedUnits.length > 0) {
        lines.push(language.rtbRestoreLineOmittedUnits(plan.notice.omittedUnits.length))
    }
    const entries = plan.notice.omittedEntries.filter((entry) => !(entry.kind === 'side' && namedAsSide.has(entry.name))).map((entry) => entry.name)
    if (entries.length > 0) {
        lines.push(language.rtbRestoreLineOmittedEntries(shownSkippedNames(entries)))
    }
    if (notRestored.length > 0) {
        lines.push(language.rtbRestoreLineSideNotRestored(notRestored))
    }
    if (failed.length > 0) {
        lines.push(language.rtbRestoreLineSideFailed(failed))
    }
    return lines
}

export async function finishRtbRestore(plan: RtbFinishPlan, hold: RtbFinishHold, landed: RtbFinishLanded, options: Partial<RtbFinishDeps> = {}): Promise<void> {
    const deps: RtbFinishDeps = { ...realFinishDeps(), ...options }
    try {
        const results = await restoreSides(plan, deps)
        if (plan.notice.outsideEntryCount > 0 || plan.notice.unreadableLists > 0) {
            console.warn(`rtb restore: ${plan.notice.outsideEntryCount} entries outside the known sections, ${plan.notice.unreadableLists} unreadable lists`)
        }
        for (const notice of skippedNoticesOf(landed.facts.skippedAssets, landed.facts.inlays.skipped, plan.assets.limit)) {
            await deps.notice(notice)
        }
        const lines = leftOutLines(plan, results)
        if (lines.length > 0) {
            await deps.notice(language.rtbRestoreLeftOut(lines))
        }
        if (landed.flushed === false) {
            await deps.notice(language.store2ImportNotFlushed)
        } else {
            deps.wait(language.store2ImportDone)
        }
        await hold.release(true)
        deps.markReload()
        await deps.reload()
    } catch (error) {
        console.error(error)
        try {
            await hold.release(true)
        } catch (releaseError) {
            console.error(releaseError)
        }
        try {
            deps.wait(language.restoreSavedReloadOrRestart)
        } catch (alertError) {
            console.error(alertError)
        }
    }
}

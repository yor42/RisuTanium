// Backup & Files maintenance panel (MC-088, I15): the Asset Cache Integrity
// scan. Kept here as a plain function, independent of any settings component,
// so the same logic backs whichever component hosts it.
import { alertConfirm, alertError, alertMd, alertNormal, alertStore } from "../alert"
import { getUncleanablesSync } from "../globalApi.svelte"
import { scanAssetCacheIntegrity, evictAssetCacheEntries } from "./assetIntegrity"
import { DBState } from "../stores.svelte"
import { language } from "src/lang"
import { withBusy } from "../process/memory/busyActions"

/**
 * The assets the current database references, plus those of every archived
 * character (a placeholder in `DBState.db.characters`), taken from a copy of
 * its cold-storage unit read one at a time. Each copy is dropped after its
 * assets are collected; the placeholders stay in their slots and nothing is
 * marked for save. `unchecked` names the archived characters whose unit could
 * not be read.
 */
async function collectIntegrityTargets(): Promise<{ targets: string[], unchecked: string[] }> {
    const targets = new Set(getUncleanablesSync(DBState.db))
    const unchecked: string[] = []
    const archived = Array.from(DBState.db.characters ?? []).filter((c) => c.coldstorage)
    if (archived.length === 0) {
        return { targets: Array.from(targets), unchecked }
    }
    // Loaded only when an archived character exists, so the check does not
    // load the cold-storage restore modules otherwise.
    const { readColdCharacterCopy } = await import("../process/coldCharacterRestore")
    try {
        for (let i = 0; i < archived.length; i++) {
            alertStore.set({ type: 'wait', msg: language.assetIntegrityReadingArchivedProgress(i, archived.length) })
            const copy = await readColdCharacterCopy(archived[i])
            if (copy.status !== 'ok') {
                unchecked.push(archived[i].name || language.errors.coldStorageUnknownCharacterName)
                continue
            }
            for (const target of getUncleanablesSync(DBState.db, { chars: [copy.character] })) {
                targets.add(target)
            }
        }
    } finally {
        // The blocking 'wait' state is never left up, whatever happened above.
        alertStore.set({ type: 'none', msg: '' })
    }
    return { targets: Array.from(targets), unchecked }
}

/**
 * Scans every asset the current database references against its own
 * content hash, and offers to evict any cached copy whose content does not match.
 * Read-only unless the user accepts the eviction confirm. Archived characters
 * are read as copies (see `collectIntegrityTargets`); the report names those
 * that could not be.
 */
export function verifyAssetIntegrity(): Promise<void> {
    return withBusy('integrityCheck', scanAndReportIntegrity)
}

async function scanAndReportIntegrity(): Promise<void> {
    const { targets, unchecked } = await collectIntegrityTargets()
    const uncheckedLine = unchecked.length > 0
        ? language.assetIntegrityReportArchivedNotChecked(unchecked.join(', '))
        : ''
    if (targets.length === 0) {
        if (uncheckedLine) {
            alertMd(language.assetIntegrityReportTitle + language.assetIntegrityNoAssets + '\n\n' + uncheckedLine)
        }
        else {
            alertNormal(language.assetIntegrityNoAssets)
        }
        return
    }
    let summary
    let scanError: unknown = null
    try {
        alertStore.set({ type: 'wait', msg: language.assetIntegrityVerifyingProgress(0, targets.length) })
        summary = await scanAssetCacheIntegrity(targets, (done, total) => {
            alertStore.set({ type: 'wait', msg: language.assetIntegrityVerifyingProgress(done, total) })
        })
    } catch (error) {
        scanError = error
    } finally {
        // Always clear the blocking 'wait' state, even if the scan threw —
        // otherwise a Cache API failure (storage/security errors, not just
        // the API being entirely absent) leaves the app stuck behind it
        // with no way to dismiss it. Deliberately not calling alertError()
        // in the catch block above: alertStore is a single shared slot, and
        // this finally block runs before that return completes, so setting
        // it to 'error' there would just get immediately overwritten with
        // 'none' by this line — report the failure only after this whole
        // try/finally has settled.
        alertStore.set({ type: 'none', msg: '' })
    }
    if (scanError) {
        alertError(scanError instanceof Error ? scanError : String(scanError))
        return
    }
    if (summary.unsupported) {
        alertError(language.assetIntegrityUnsupported)
        return
    }

    let evicted = 0
    if (summary.mismatches.length > 0) {
        if (await alertConfirm(language.assetIntegrityEvictConfirm(summary.mismatches.length))) {
            try {
                evicted = await evictAssetCacheEntries(summary.mismatches.map((m) => m.basename))
            } catch (error) {
                alertError(error)
                return
            }
        }
    }

    let report = language.assetIntegrityReportTitle
    report += language.assetIntegrityReportChecked(summary.checked, targets.length)
    report += language.assetIntegrityReportNotCached(summary.notCached)
    report += language.assetIntegrityReportNotContentAddressed(summary.notContentAddressed)
    report += uncheckedLine
    report += language.assetIntegrityReportMismatchCount(summary.mismatches.length)
    if (summary.mismatches.length > 0) {
        report += `\n`
        for (const m of summary.mismatches) {
            report += `- \`${m.basename}\`\n`
        }
        report += evicted > 0
            ? language.assetIntegrityReportEvicted(evicted)
            : language.assetIntegrityReportLeftInCache
    }
    else {
        report += language.assetIntegrityReportNoCorruption
    }
    alertMd(report)
}

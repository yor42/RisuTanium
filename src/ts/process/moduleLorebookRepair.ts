import { alertConfirm, alertError, alertMd, waitAlert } from "../alert"
import { updateLorebooks } from "../characters"
import { Mutex } from "../mutex"
import { language } from "src/lang"
import type { loreBook } from "../storage/database.svelte"
import type { RisuModule } from "./modules"

/**
 * Asks about a corrupted lorebook one module at a time. Prompts queue, but notices replace whatever is showing and
 * `waitAlert` resolves on any close, and the reset question names no module, so two concurrent asks would
 * interleave their notices and answers.
 */
const askLock = new Mutex()

/**
 * Brings one module body's lorebook to the current format. Takes a plain body, never the live database.
 *
 * - No lorebook: nothing happens, `changed: false`.
 * - A list: migrated by `updateLorebooks` only when some entry is below book version 2 (decided before migrating);
 *   an already migrated list is neither passed to it nor reassigned. `changed: true` when migrated.
 * - Not a list: the user is told, may send diagnostics, and is asked whether to reset it to an empty list.
 *   `changed: true` when reset, `changed: false` when the user keeps the value.
 *
 * `context.formatVersion` is only shown in the diagnostics (`'Unknown'` when absent or falsy); a load-time caller may
 * omit `context`.
 *
 * The caller must await this before it installs the body anywhere, and must save the body when `changed` is true.
 */
export async function repairModuleLorebook(
    body: RisuModule | null | undefined,
    context?: { formatVersion?: number },
): Promise<{ changed: boolean }> {
    if (!body?.lorebook) {
        return { changed: false }
    }
    const lorebook: unknown = body.lorebook
    if (Array.isArray(lorebook)) {
        const entries = lorebook as loreBook[]
        if (!entries.some((entry) => !(entry?.bookVersion >= 2))) {
            return { changed: false }
        }
        body.lorebook = updateLorebooks(entries)
        return { changed: true }
    }
    return askLock.runExclusive(() => askAboutCorruptedLorebook(body, context?.formatVersion))
}

async function askAboutCorruptedLorebook(body: RisuModule, formatVersion: number | undefined): Promise<{ changed: boolean }> {
    console.error('Critical: Invalid lorebook format detected in module')
    console.error('Module data:', JSON.stringify(body, null, 2))

    alertError(language.bootstrap.dataCorruptionDetected(body.name || 'Unknown', typeof body.lorebook))
    await waitAlert()

    const shouldReport = await alertConfirm(language.bootstrap.reportErrorQuestion)

    if (shouldReport) {
        try {
            // Diagnostic information without personal data.
            const diagnosticInfo = {
                timestamp: new Date().toISOString(),
                moduleName: body.name || 'Unknown',
                lorebookType: typeof body.lorebook,
                lorebookValue: JSON.stringify(body.lorebook).substring(0, 500),
                isArray: Array.isArray(body.lorebook),
                keys: body.lorebook ? Object.keys(body.lorebook).join(', ') : 'N/A',
                formatVersion: formatVersion || 'Unknown',
            }
            const reportData = JSON.stringify(diagnosticInfo, null, 2)
            await alertMd(language.bootstrap.diagnosticInformation(reportData))
            await waitAlert()

            console.log('Diagnostic information for developers:', diagnosticInfo)
        } catch (reportError) {
            console.error('Failed to generate diagnostic report:', reportError)
        }
    }

    const shouldReset = await alertConfirm(language.bootstrap.resetLorebookQuestion)

    if (shouldReset) {
        body.lorebook = []
        console.log('Lorebook reset to empty array by user choice')
        return { changed: true }
    }
    console.warn('User chose to keep corrupted lorebook data')
    return { changed: false }
}

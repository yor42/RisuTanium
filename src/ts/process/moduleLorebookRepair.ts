import { alertConfirm, alertError, alertMd, waitAlert } from "../alert"
import { updateLorebooks } from "../characters"
import { Mutex } from "../mutex"
import { language } from "src/lang"
import type { Database, loreBook } from "../storage/database.svelte"
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
    const need = lorebookRepairNeed(body)
    if (body == null || need === 'none') {
        return { changed: false }
    }
    if (need === 'migrate') {
        body.lorebook = updateLorebooks(body.lorebook as loreBook[])
        return { changed: true }
    }
    return askLock.runExclusive(() => askAboutCorruptedLorebook(body, context?.formatVersion))
}

/**
 * What `repairModuleLorebook` would do with `body`, decided from the body alone and before anything is shown or locked:
 * `none` (no lorebook, or a current list), `migrate` (a list with an entry below book version 2, rewritten without a
 * question) or `ask` (not a list: the person is told and asked). `repairModuleLorebook` branches on this one decision, so
 * a caller that must not wait for the person can judge first and cannot disagree with the repair.
 */
export function lorebookRepairNeed(body: RisuModule | null | undefined): 'none' | 'migrate' | 'ask' {
    if (!body?.lorebook) {
        return 'none'
    }
    const lorebook: unknown = body.lorebook
    if (!Array.isArray(lorebook)) {
        return 'ask'
    }
    return (lorebook as loreBook[]).some((entry) => !(entry?.bookVersion >= 2)) ? 'migrate' : 'none'
}

/**
 * Repairs the lorebook of every module in `db.modules`, one module at a time, and tidies the list afterwards.
 *
 * Sequential on purpose: a repair may ask the person. Prompts queue, but notices replace whatever is showing and
 * `waitAlert` resolves on any close, and the reset question names no module, so concurrent repairs would interleave
 * their notices and answers and the person could not tell which module a reset question is about. Do not turn the
 * loop into `Promise.all`.
 *
 * A repair can wait on the person while the rest of the application runs, so the list may change under the loop.
 * The loop therefore walks a copy of the slots, and the list is read again only after the last await:
 * - `null` or `undefined`: becomes an empty list;
 * - a list holding a `null` or `undefined` element: replaced by the list without them;
 * - a list without such elements: not assigned at all, so a loader's install or a plugin's write made during a wait stays;
 * - any other value: left exactly as it was written.
 * Repairs mutate the module bodies in place, so a repaired body is the one still in the live list. The elements of a
 * list that replaced the original during a wait get no repair in this pass.
 *
 * The first save pass starts only after this function returns. Bodies still in the live list were migrated in place
 * before that pass, so it saves them as migrated; nothing is saved while a question is open.
 */
export async function repairModuleListLorebooks(db: Pick<Database, 'modules' | 'formatversion'>): Promise<void> {
    const slots: unknown = db.modules
    if (Array.isArray(slots)) {
        for (const body of [...(slots as RisuModule[])]) {
            await repairModuleLorebook(body, { formatVersion: db.formatversion })
        }
    }
    const live: unknown = db.modules
    if (live === null || live === undefined) {
        db.modules = []
    } else if (Array.isArray(live) && live.some((body) => body === null || body === undefined)) {
        db.modules = (live as RisuModule[]).filter((body) => body !== null && body !== undefined)
    }
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

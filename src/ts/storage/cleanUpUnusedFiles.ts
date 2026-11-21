import { language } from "src/lang"
import { alertClear, alertConfirm, alertNormal, alertWait } from "../alert"
import type { PageStorageMode } from "./pageStorageMode"
import { getStore2BootSession } from "./store2/bootActive"
import type { ManualCleanUpOutcome, ManualCleanUpPlan, ManualCleanUpUi } from "./store2/maintenance"

/**
 * The Settings button's flow for the manual "Clean Up Unused Files". The engine and its exclusion live in
 * `store2/maintenance.ts` (`runManualCleanUp`), which is imported only when the button is pressed. This module keeps the
 * button's offer rule, the mapping from every outcome to the one message the person sees (release builds strip
 * `console.*`, so each outcome needs a visible result), and the single-flight press.
 */

/** Whether the button is shown: a store2 page whose boot session is a kind the clean-up can run on. */
export function cleanUpOfferedFor(mode: PageStorageMode): boolean {
    if (mode.kind !== 'store2') {
        return false
    }
    const kind = getStore2BootSession()?.kind
    return kind === 'tauri' || kind === 'node'
}

/** The message for an outcome, or null when the person already answered it (a No needs no further notice). */
export function cleanUpMessage(outcome: ManualCleanUpOutcome): string | null {
    switch (outcome.status) {
        case 'declined':
            return null
        case 'busy':
            return language.cleanUnusedFilesBusy
        case 'unavailable':
            return language.cleanUnusedFilesRefused
        case 'nothing':
            return language.cleanUnusedFilesNone
        case 'wait':
            return language.cleanUnusedFilesNodeWait
        case 'cancelled':
            return language.cleanUnusedFilesCancelled(outcome.deleted)
        case 'ended':
            break
    }
    const result = outcome.result
    if (result.status === 'refused') {
        const deleted = result.deleted ?? 0
        if (deleted > 0) {
            return language.cleanUnusedFilesStopped(deleted)
        }
        if (result.reason === 'other-tab') {
            return language.cleanUnusedFilesOtherTab
        }
        return result.reason === 'no-web-locks' ? language.cleanUnusedFilesNoTabCheck : language.cleanUnusedFilesRefused
    }
    if (result.status === 'done') {
        if (result.stopped === 'yielded' && result.deleted === 0) {
            return language.cleanUnusedFilesBusy
        }
        if (result.stopped !== undefined) {
            return language.cleanUnusedFilesStopped(result.deleted)
        }
        // Nothing approved means the Node note-only confirm: the files were only noted, so the notice must not report a deletion.
        if (outcome.approved === 0 && result.deleted === 0) {
            return language.cleanUnusedFilesNodeWait
        }
        return language.cleanUnusedFilesDone(result.deleted, outcome.approved - result.deleted)
    }
    // `skipped` and `planned` are not results of a delete step; show the generic refusal rather than claim a clean-up.
    return language.cleanUnusedFilesRefused
}

function confirmText(plan: ManualCleanUpPlan): string {
    if (plan.kind !== 'node') {
        return language.cleanUnusedFilesConfirm(plan.deletable, plan.bytes)
    }
    return plan.deletable > 0
        ? language.cleanUnusedFilesConfirmNode(plan.deletable, plan.bytes, plan.later)
        : language.cleanUnusedFilesNoteNode(plan.later)
}

let running = false

/** The button's click handler. A second press while a clean-up is in progress does nothing. */
export async function startCleanUpUnusedFiles(): Promise<void> {
    if (running) {
        return
    }
    running = true
    try {
        const { runManualCleanUp } = await import("./store2/maintenance")
        const ui: ManualCleanUpUi = {
            progress: (step, cancel) => {
                alertWait(step === 'measuring' ? language.cleanUnusedFilesMeasuring : language.cleanUnusedFilesDeleting, cancel)
            },
            confirm: (plan) => alertConfirm(confirmText(plan)),
        }
        const message = cleanUpMessage(await runManualCleanUp(ui))
        if (message === null) {
            alertClear()
        } else {
            alertNormal(message)
        }
    } catch (error) {
        console.error('store2 manual clean-up failed', error)
        alertNormal(language.cleanUnusedFilesRefused)
    } finally {
        running = false
    }
}

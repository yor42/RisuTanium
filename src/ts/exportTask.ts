import { language } from 'src/lang'
import type { BrandStatus } from 'src/lib/Nexus/brand/brandStatus'
import { alertError, alertNormal, waitUnreadNotice } from './alert'
import { alertTask, taskShown, type TaskHandle } from './alertTask.svelte'
import { ExportCancelledError, type ExportCancelToken } from './exportCancel'
import { exportErrorText, exportFileState, withFileIncompleteSentence, type ExportByteWriter } from './exportWriters'
import type { ProgressSink } from './progressSink'

export type ExportStep = 'prepare' | 'assets' | 'write'
export const EXPORT_STEPS: readonly ExportStep[] = ['prepare', 'assets', 'write']

/** What `endOnError` needs of a writer; a `LocalWriter` is one. */
export interface ExportTarget {
    readonly writer: ExportByteWriter | undefined
    abort(reason: unknown): void
}

/** One step of a run's own card. `id` is what the run reports through `step`; the other fields are the card's. */
export interface ExportTaskStepDef<S extends string> {
    readonly id: S
    /** Already translated. */
    readonly label: string
    /** Item noun for the count line, already translated. */
    readonly noun?: string
    readonly mark?: BrandStatus
}

export interface ExportTaskDef<S extends string = ExportStep> {
    readonly title: string
    readonly subtitle?: string
    /** Defaults to the export steps (prepare, assets, write). */
    readonly steps?: readonly ExportTaskStepDef<S>[]
    /** Defaults to the export done headline. */
    readonly doneHeadline?: string
    /** Defaults to the export failed headline. */
    readonly failedHeadline?: string
    /** The text of the legacy error notice when the run has no card to settle (never shown, or stepped aside) and kept no incomplete file; the error itself goes to the console. Defaults to the error. */
    readonly legacyErrorText?: string
    /** The legacy notice of a cancel that kept a file, when no card of the run is shown. Defaults to the export cancelled-file-incomplete notice. */
    readonly cancelledFileKeptNotice?: string
}

export interface ExportTask<S extends string = ExportStep> {
    /** The run's cancel switch once `useToken` set it; null before, and when the run offers no Cancel. */
    readonly token: ExportCancelToken | null
    /** True once any ending ran (done, cancelled, failed, close); later endings and `open` do nothing. */
    readonly ended: boolean
    /** Sets the run's token, once, at the run's cancel decision point and before `open`. */
    useToken(token: ExportCancelToken | null): void
    /** Shows the card. Does nothing for a legacy run (no def), when a card was already opened, or after an ending. */
    open(): void
    /** Forward only; nothing unless the card is shown. */
    step(step: S): void
    /**
     * Takes a shown card down before a native dialog opens, without ending the run: every later ending posts the legacy
     * notice, as for a run that never showed a card. Does nothing when no card is shown (never opened, replaced by a newer
     * task, or ended), so only a card this call took down makes the run a stepped-aside one.
     */
    stepAside(): void
    /**
     * Takes a shown card out of the slot while `ask` runs, for a surface the TaskHost yield cannot cover: a sheet drawn
     * inside the page, which the card would make inert, or a native dialog. The card comes back, at its step, at the
     * run's next report or ending, never by itself: a run that ends with `close` never shows it again. Does nothing to
     * a card that is not shown (never opened, replaced, or ended); then it only runs `ask`.
     */
    holdAside<T>(ask: () => Promise<T>): Promise<T>
    /** Assets written / assets total. */
    readonly count: ProgressSink
    /** One large streamed asset: bytes / its size. */
    readonly bytes: ProgressSink
    /** Throws ExportCancelledError after a Cancel; a no-op without a token. */
    throwIfCancelled(): void
    /**
     * The point of no return: false when a Cancel came first (or the run ended), true otherwise. From a true return on the
     * card offers no Cancel, also when `holdAside` brings it back. An export never calls it.
     */
    lockCancel(reason?: string): boolean
    done(summary: string | readonly string[]): void
    cancelled(fileKept: boolean): void
    failed(error: unknown, fileKept: boolean): void
    /** An ending whose text is final and names the file's state itself; the caller already logged the error. */
    failedWith(detail: string, fileKept: boolean): void
    /** The one catch body of every export run: classifies, aborts on failure, reads the file state, ends. */
    endOnError(error: unknown, target: ExportTarget | undefined): void
    close(): void
}

/**
 * One adapter per export run, created before anything that can throw. It stays invisible until `open`, and every ending
 * works in every state: a card that is shown settles, a card that a newer task replaced stays silent unless a kept
 * incomplete file needs a warning, and a run that never showed a card, or stepped its card aside, posts the legacy notice.
 * The first ending wins. A run with its own `steps` must be typed with them, so `step` can only name its own ids.
 */
export function createExportTask(def: ExportTaskDef<ExportStep> | null): ExportTask<ExportStep>
export function createExportTask<S extends string>(def: ExportTaskDef<S> & { readonly steps: readonly ExportTaskStepDef<S>[] }): ExportTask<S>
export function createExportTask(def: ExportTaskDef<string> | null): ExportTask<string> {
    let token: ExportCancelToken | null = null
    let handle: TaskHandle | null = null
    let ended = false
    let aside = false
    // A card `holdAside` took down that has not come back yet, and whether a newer task held the slot when it was due back.
    let held = false
    let displaced = false
    // Set by `lockCancel`: a card that `comeBack` opens after the lock must offer no Cancel.
    let cancelLocked = false
    let stepIndex = 0
    const stepIds: readonly string[] = def?.steps?.map((step) => step.id) ?? EXPORT_STEPS

    const shown = (): TaskHandle | null => (handle !== null && !handle.detached ? handle : null)
    const replaced = (): boolean => displaced || (handle !== null && handle.detached)

    /** The card of this run, as `open` and the return of a held card both build it. */
    const openCard = (card: ExportTaskDef<string>): TaskHandle => {
        const active = token
        return alertTask({
            title: card.title,
            subtitle: card.subtitle,
            steps: card.steps?.map((step) => ({
                label: step.label,
                ...(step.noun === undefined ? {} : { noun: step.noun }),
                ...(step.mark === undefined ? {} : { mark: step.mark }),
            })) ?? [
                { label: language.exportStepPrepare },
                { label: language.exportStepAssets, noun: language.importNounAssets, mark: 'transfer_out' },
                { label: language.exportStepWrite },
            ],
            onCancel: active === null || cancelLocked ? undefined : () => active.cancel(),
        })
    }

    /** Brings a held card back at its step, unless a newer task holds the slot: that task is never replaced, and the run is then a replaced one. */
    const comeBack = (): void => {
        if (!held || ended || def === null) return
        held = false
        if (taskShown()) {
            displaced = true
            return
        }
        handle = openCard(def)
        if (stepIndex > 0) handle.setStep(stepIndex)
    }

    const task: ExportTask<string> = {
        get token() {
            return token
        },
        get ended() {
            return ended
        },
        useToken(next) {
            token ??= next
        },
        open() {
            if (def === null || ended || aside || held || handle !== null) return
            handle = openCard(def)
        },
        step(next) {
            comeBack()
            const index = stepIds.indexOf(next)
            const active = shown()
            if (active === null || ended || index < 0 || index <= stepIndex) return
            stepIndex = index
            active.setStep(index)
        },
        stepAside() {
            const active = shown()
            if (active === null || ended) return
            // Closing detaches the entry, so the handle goes too: a kept handle would read as replaced and silence every ending.
            handle = null
            aside = true
            active.close()
        },
        holdAside(ask) {
            const active = shown()
            if (active !== null && !ended) {
                // Closing detaches the entry, so the handle goes too, as in `stepAside`.
                handle = null
                held = true
                active.close()
            }
            return ask()
        },
        count(done, total) {
            comeBack()
            if (!ended) shown()?.setCount(done, total)
        },
        bytes(done, total) {
            comeBack()
            if (!ended) shown()?.setBytes(done, total)
        },
        throwIfCancelled() {
            token?.throwIfCancelled()
        },
        lockCancel(reason) {
            if (ended || token?.cancelled) return false
            cancelLocked = true
            shown()?.lockCancel(reason)
            return token?.cancelled !== true
        },
        done(summary) {
            comeBack()
            if (ended) return
            ended = true
            const list = typeof summary === 'string' ? [summary] : [...summary]
            const active = shown()
            if (active !== null) void active.finish({ headline: def?.doneHeadline ?? language.exportTaskDone, summary: list })
            else if (!replaced()) alertNormal(typeof summary === 'string' ? summary : list.join('\n\n'))
        },
        cancelled(fileKept) {
            comeBack()
            if (ended) return
            ended = true
            const active = shown()
            if (active !== null) {
                void (fileKept ? active.settleCancel([language.exportFailedFileIncomplete]) : active.settleCancel())
            }
            else if (fileKept) alertNormal(def?.cancelledFileKeptNotice ?? language.exportCancelledFileIncomplete)
        },
        failed(error, fileKept) {
            comeBack()
            if (ended) return
            ended = true
            const active = shown()
            if (active !== null) {
                console.error(error)
                const detail = fileKept ? withFileIncompleteSentence(error).message : exportErrorText(error)
                void active.fail({
                    headline: def?.failedHeadline ?? language.exportTaskFailed,
                    dataState: 'same',
                    ...(detail === '' || detail === '{}' ? {} : { detail }),
                })
            }
            else if (replaced()) {
                if (fileKept) alertError(withFileIncompleteSentence(error))
                else console.error(error)
            }
            else if (fileKept) alertError(withFileIncompleteSentence(error))
            else if (def?.legacyErrorText !== undefined) {
                console.error(error)
                alertError(def.legacyErrorText)
            }
            else alertError(error instanceof Error ? error : exportErrorText(error))
        },
        failedWith(detail, fileKept) {
            comeBack()
            if (ended) return
            ended = true
            const active = shown()
            if (active !== null) {
                void active.fail({
                    headline: def?.failedHeadline ?? language.exportTaskFailed,
                    dataState: 'same',
                    ...(detail === '' ? {} : { detail }),
                })
            }
            else if (replaced()) {
                if (fileKept) alertError(detail)
            }
            else alertError(detail)
        },
        endOnError(error, target) {
            if (ended) return
            if (token !== null && (token.cancelled || error instanceof ExportCancelledError)) {
                task.cancelled(exportFileState(target?.writer) === 'kept')
                return
            }
            target?.abort(error)
            task.failed(error, exportFileState(target?.writer) === 'kept')
        },
        close() {
            if (ended) return
            ended = true
            shown()?.close()
        },
    }
    return task
}

/** The `aroundPicker` of a run whose card must not cover a native save picker: the card steps aside, a notice the person has not read yet is read first, then the picker opens. */
export function pickerAside(task: ExportTask<string>): <T>(open: () => Promise<T>) => Promise<T> {
    return async (open) => {
        task.stepAside()
        await waitUnreadNotice()
        return open()
    }
}

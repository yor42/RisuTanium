import { language } from 'src/lang'
import type { BrandStatus } from 'src/lib/Nexus/brand/brandStatus'
import { alertError, alertNormal, waitUnreadNotice } from './alert'
import { alertTask, type TaskHandle } from './alertTask.svelte'
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
    /** Assets written / assets total. */
    readonly count: ProgressSink
    /** One large streamed asset: bytes / its size. */
    readonly bytes: ProgressSink
    /** Throws ExportCancelledError after a Cancel; a no-op without a token. */
    throwIfCancelled(): void
    done(summary: string): void
    cancelled(fileKept: boolean): void
    failed(error: unknown, fileKept: boolean): void
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
    let stepIndex = 0
    const stepIds: readonly string[] = def?.steps?.map((step) => step.id) ?? EXPORT_STEPS

    const shown = (): TaskHandle | null => (handle !== null && !handle.detached ? handle : null)
    const replaced = (): boolean => handle !== null && handle.detached

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
            if (def === null || ended || aside || handle !== null) return
            const active = token
            handle = alertTask({
                title: def.title,
                subtitle: def.subtitle,
                steps: def.steps?.map((step) => ({
                    label: step.label,
                    ...(step.noun === undefined ? {} : { noun: step.noun }),
                    ...(step.mark === undefined ? {} : { mark: step.mark }),
                })) ?? [
                    { label: language.exportStepPrepare },
                    { label: language.exportStepAssets, noun: language.importNounAssets, mark: 'transfer_out' },
                    { label: language.exportStepWrite },
                ],
                onCancel: active === null ? undefined : () => active.cancel(),
            })
        },
        step(next) {
            const index = stepIds.indexOf(next)
            const active = shown()
            if (active === null || ended || index <= stepIndex) return
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
        count(done, total) {
            if (!ended) shown()?.setCount(done, total)
        },
        bytes(done, total) {
            if (!ended) shown()?.setBytes(done, total)
        },
        throwIfCancelled() {
            token?.throwIfCancelled()
        },
        done(summary) {
            if (ended) return
            ended = true
            const active = shown()
            if (active !== null) void active.finish({ headline: def?.doneHeadline ?? language.exportTaskDone, summary: [summary] })
            else if (!replaced()) alertNormal(summary)
        },
        cancelled(fileKept) {
            if (ended) return
            ended = true
            const active = shown()
            if (active !== null) {
                void (fileKept ? active.settleCancel([language.exportFailedFileIncomplete]) : active.settleCancel())
            }
            else if (fileKept) alertNormal(language.exportCancelledFileIncomplete)
        },
        failed(error, fileKept) {
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

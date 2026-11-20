import { language } from 'src/lang'
import { alertError, alertNormal } from './alert'
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

export interface ExportTask {
    /** The run's cancel switch once `useToken` set it; null before, and when the run offers no Cancel. */
    readonly token: ExportCancelToken | null
    /** True once any ending ran (done, cancelled, failed, close); later endings and `open` do nothing. */
    readonly ended: boolean
    /** Sets the run's token, once, at the run's cancel decision point and before `open`. */
    useToken(token: ExportCancelToken | null): void
    /** Shows the card. Does nothing for a legacy run (no def), when a card was already opened, or after an ending. */
    open(): void
    /** Forward only; nothing unless the card is shown. */
    step(step: ExportStep): void
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
 * incomplete file needs a warning, and a run that never showed a card posts the legacy notice. The first ending wins.
 */
export function createExportTask(def: { title: string, subtitle?: string } | null): ExportTask {
    let token: ExportCancelToken | null = null
    let handle: TaskHandle | null = null
    let ended = false
    let stepIndex = 0

    const shown = (): TaskHandle | null => (handle !== null && !handle.detached ? handle : null)
    const replaced = (): boolean => handle !== null && handle.detached

    const task: ExportTask = {
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
            if (def === null || ended || handle !== null) return
            const active = token
            handle = alertTask({
                title: def.title,
                subtitle: def.subtitle,
                steps: [
                    { label: language.exportStepPrepare },
                    { label: language.exportStepAssets, noun: language.importNounAssets, mark: 'transfer_out' },
                    { label: language.exportStepWrite },
                ],
                onCancel: active === null ? undefined : () => active.cancel(),
            })
        },
        step(next) {
            const index = EXPORT_STEPS.indexOf(next)
            const active = shown()
            if (active === null || ended || index <= stepIndex) return
            stepIndex = index
            active.setStep(index)
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
            if (active !== null) void active.finish({ headline: language.exportTaskDone, summary: [summary] })
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
                    headline: language.exportTaskFailed,
                    dataState: 'same',
                    ...(detail === '' || detail === '{}' ? {} : { detail }),
                })
            }
            else if (replaced()) {
                if (fileKept) alertError(withFileIncompleteSentence(error))
                else console.error(error)
            }
            else if (fileKept) alertError(withFileIncompleteSentence(error))
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

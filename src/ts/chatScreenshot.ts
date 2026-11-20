import { language } from 'src/lang'
import { downloadNotice } from './exportNotice'
import { createExportTask, pickerAside } from './exportTask'

/**
 * One chat screenshot, split into the three phases the card shows. Each caller keeps its own capture and merge drawing
 * code, so the PNG is whatever the caller draws; the seam only owns the card and its endings.
 */
export interface ChatScreenshotRun<C> {
    /** The rendered rows, in document order. */
    readonly rows: ArrayLike<Element>
    capture(row: Element): Promise<C>
    /** Draws the captured rows into one PNG; may throw. */
    merge(captured: readonly C[]): Uint8Array
    /** Hands the PNG to `downloadFile` with `aroundPicker`; false when the Android save picker returned no location. */
    save(png: Uint8Array, aroundPicker: <T>(open: () => Promise<T>) => Promise<T>): Promise<boolean>
}

/**
 * Runs one chat screenshot on the task card, with no Cancel. Never rejects: every outcome ends the card or posts today's
 * notice, and every ending is the adapter's, so the seam keeps no state of its own. The card steps aside before the
 * Android save picker through `pickerAside`.
 */
export async function runChatScreenshot<C>(run: ChatScreenshotRun<C>): Promise<void> {
    const task = createExportTask<'capture' | 'merge' | 'save'>({
        title: language.screenshotTaskTitle,
        steps: [
            { id: 'capture', label: language.screenshotStepCapture, noun: language.chatShellMessages },
            { id: 'merge', label: language.screenshotStepMerge },
            { id: 'save', label: language.screenshotStepSave },
        ],
        failedHeadline: language.errors.screenshotFailed,
        legacyErrorText: language.errors.screenshotFailed,
    })
    task.useToken(null)
    task.open()
    try {
        const total = run.rows.length
        if (total > 0) task.count(0, total)
        const captured: C[] = []
        for (let index = 0; index < total; index++) {
            captured.push(await run.capture(run.rows[index]))
            task.count(index + 1, total)
        }
        task.step('merge')
        const png = run.merge(captured)
        task.step('save')
        if (!(await run.save(png, pickerAside(task)))) {
            task.close()
            return
        }
        task.done(downloadNotice(language.screenshotSaved))
    } catch (error) {
        task.endOnError(error, undefined)
    } finally {
        task.close()
    }
}

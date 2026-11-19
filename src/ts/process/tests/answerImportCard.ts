/**
 * Test helper: runs an `importModule` call to its result card, records the card, answers OK and lets the import
 * resolve (`importModule` resolves only after the card is answered).
 */

import { answerTask, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import type { TaskView } from 'src/lib/Nexus/pattern/taskProgress'

export type ImportCard = TaskView | null

/**
 * Awaits `run()` while answering its result card. Returns the card the import ended on, or null when it closed
 * without one.
 */
export async function answerImportCard(run: () => Promise<unknown>): Promise<ImportCard> {
    const done = run()
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    for (let i = 0; i < 400 && !ended && !taskResultShowing(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const card = taskResultShowing() ? taskHostView() : null
    if (card) answerTask({ kind: 'ok' })
    await done
    return card
}

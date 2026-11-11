import { returnFocus } from 'src/lib/Nexus/pattern/patternFocus'
import { createFocusSettle } from 'src/ts/focusSettle'

/** How long a returned focus is defended: longer than a late pointer click lands after a close. */
export const RETURNED_FOCUS_SETTLE_MS = 750

/**
 * Keeps focus on `target` for a bounded window after it was returned there. A blur to nothing in
 * that window (a late tap on empty space after a close) puts focus back; a move to a real control,
 * an open cover (`isCovered`) or the end of the window ends the hold and is respected. The window
 * ends with `stop`, which also drops every listener and the timer, so nothing outlives it.
 *
 * Returns `stop`, safe to call more than once.
 */
export function holdReturnedFocus(
    target: HTMLElement,
    isCovered: () => boolean,
    settleMs: number = RETURNED_FOCUS_SETTLE_MS,
): () => void {
    const doc = target.ownerDocument
    // The blur is observed on a focus listener's stack; the settle reads focus after it unwinds.
    const settle = createFocusSettle(() => {
        if (isCovered()) return
        const active = doc.activeElement
        if (active && active !== doc.body) return
        returnFocus(target)
    })
    let stopped = false
    const timer = setTimeout(() => stop(), settleMs)
    const onFocusOut = () => settle.schedule()
    const onFocusIn = (event: FocusEvent) => {
        if (event.target !== target) stop()
    }

    function stop(): void {
        if (stopped) return
        stopped = true
        clearTimeout(timer)
        doc.removeEventListener('focusout', onFocusOut, true)
        doc.removeEventListener('focusin', onFocusIn, true)
        settle.dispose()
    }

    doc.addEventListener('focusout', onFocusOut, true)
    doc.addEventListener('focusin', onFocusIn, true)
    return stop
}

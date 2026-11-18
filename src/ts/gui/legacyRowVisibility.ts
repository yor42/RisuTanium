import rowSheet from './legacyRowVisibility.css?raw'
import { adoptSheet } from './adoptSheet'
import { waitForRows } from './rowBodySettle'

// The rules reach the document with the first module that uses them, before any row paints.
adoptSheet('legacy-row-visibility', rowSheet)

const HOLD_ATTR = 'data-risu-cv-hold'

/** Long enough for a slow chat-body parse after a list opens; the same bound the warm-image hold uses. */
export const ROW_SETTLE_CAP_MS = 1500

/** Holds per list node. The attribute is present exactly while a count is open. */
const counts = new WeakMap<Element, number>()

/**
 * Keeps every row of `list` laid out until the returned release is called, so rows can be measured and their
 * sizes remembered. Several holds stack: the attribute stays until the last one is released, and each release is
 * idempotent. The hold covers the paths that call it (list open, Settings return, bookmark jump, screenshot, width
 * change); a scroll the page makes by other means, such as a plugin's scrollIntoView or the browser's find, is not held.
 */
export function holdRowLayout(list: Element): () => void {
    counts.set(list, (counts.get(list) ?? 0) + 1)
    list.setAttribute(HOLD_ATTR, '')
    let released = false
    return () => {
        if (released) {
            return
        }
        released = true
        const next = (counts.get(list) ?? 1) - 1
        if (next <= 0) {
            counts.delete(list)
            list.removeAttribute(HOLD_ATTR)
        } else {
            counts.set(list, next)
        }
    }
}

/** Calls `release` after `frames` animation frames and returns a canceller for the pending frame. */
export function releaseRowHoldAfterFrames(release: () => void, frames = 2): () => void {
    let remaining = frames
    let id: number | null = null
    const hasFrames = typeof requestAnimationFrame === 'function'
    const step = (): void => {
        id = null
        remaining--
        if (remaining <= 0) {
            release()
        } else {
            id = hasFrames ? requestAnimationFrame(step) : window.setTimeout(step, 16)
        }
    }
    id = hasFrames ? requestAnimationFrame(step) : window.setTimeout(step, 16)
    return () => {
        if (id === null) {
            return
        }
        if (hasFrames) {
            cancelAnimationFrame(id)
        } else {
            window.clearTimeout(id)
        }
        id = null
    }
}

/**
 * Holds `list` from now until every row in `bodyRows` has put its first rendered markup into the document, then 2
 * more frames, or until ROW_SETTLE_CAP_MS has passed. `bodyRows` lists only rows that render a ChatBody: a row
 * without one never reports, so counting it would always run to the cap. An empty list holds for the 2 frames only.
 * `cancel` releases at once. `onEnd` runs once when the hold has ended either way.
 */
export function holdUntilRowsRendered(list: Element, bodyRows: readonly Element[], onEnd?: () => void): { cancel(): void } {
    const release = holdRowLayout(list)
    let ended = false
    let cancelFrames: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let wait: { cancel(): void } | null = null

    const end = (): void => {
        if (ended) {
            return
        }
        ended = true
        onEnd?.()
    }
    const settle = (): void => {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
        if (cancelFrames !== null) {
            return
        }
        cancelFrames = releaseRowHoldAfterFrames(() => {
            release()
            end()
        }, 2)
    }

    wait = waitForRows(bodyRows, settle)
    if (cancelFrames === null) {
        timer = setTimeout(() => {
            timer = null
            wait?.cancel()
            settle()
        }, ROW_SETTLE_CAP_MS)
    }
    return {
        cancel() {
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
            wait?.cancel()
            cancelFrames?.()
            release()
            end()
        },
    }
}

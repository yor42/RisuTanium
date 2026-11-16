/**
 * The Studio long-text fields that are mounted, so a leave, a close or a page hide can put held text into its
 * owner before the next step runs. Leaf module: it imports nothing at run time and touches `window` only while a
 * field is registered, so `studioOpen` can import it and stay a leaf.
 *
 * Every Studio state function that changes the detail shown calls `flushStudioFields('leave')` before its first
 * state write; a new one that does not reintroduces a switch that drops held text. A close needs no such call:
 * it passes through the `studioOpen` flag, which flushes.
 */

export type FieldFlushReason = 'hide' | 'leave'

interface FieldEntry {
    flush: (reason: FieldFlushReason) => void
}

const fields: FieldEntry[] = []
let listening = false

function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') flushStudioFields('hide')
}

function onPageHide(): void {
    flushStudioFields('hide')
}

// Capture listeners on `window` run before the page-leave rule's bubbling listeners on `document` and
// `window`, so held text is written before that rule decides whether a save is owed.
function startListening(): void {
    if (listening) return
    listening = true
    window.addEventListener('visibilitychange', onVisibilityChange, true)
    window.addEventListener('pagehide', onPageHide, true)
}

function stopListening(): void {
    if (!listening) return
    listening = false
    window.removeEventListener('visibilitychange', onVisibilityChange, true)
    window.removeEventListener('pagehide', onPageHide, true)
}

export function registerStudioField(flush: (reason: FieldFlushReason) => void): () => void {
    const entry: FieldEntry = { flush }
    fields.push(entry)
    startListening()
    return () => {
        const at = fields.indexOf(entry)
        if (at < 0) return
        fields.splice(at, 1)
        if (fields.length === 0) stopListening()
    }
}

/** Flushes every registered field in registration order; one field throwing does not stop the next. */
export function flushStudioFields(reason: FieldFlushReason): void {
    for (const entry of [...fields]) {
        try {
            entry.flush(reason)
        } catch (error) {
            console.error('Studio field flush failed', error)
        }
    }
}

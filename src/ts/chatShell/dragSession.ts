import { autoscrollDelta } from './autoscroll'

/**
 * One pointer drag over a scrolling list, DOM only.
 *
 * The session owns the pointer: capture sits on the scroller (a row can be recycled out from under the finger), and only the
 * recorded `pointerup` commits. Every other ending (cancel, lost capture, window blur, a hidden page, Escape, `abort`) is an
 * abort. `onend` runs exactly once.
 *
 * Escape belongs to the drag while it is live: it is taken in the capture phase and default-prevented so a handler further out
 * (the overlay) sees it as handled, and it is never stopped, so a document listener still receives it.
 */

export type DragEnd = 'commit' | 'abort'

export interface DragSession {
    abort(): void
    readonly live: boolean
}

export interface DragHandlers {
    /** The pointer's latest `clientY`, on every move and after every autoscroll frame. */
    onpoint(clientY: number): void
    onend(kind: DragEnd): void
}

export function startDragSession(scroller: HTMLElement, down: PointerEvent, handlers: DragHandlers): DragSession {
    const pointerId = down.pointerId
    let lastClientY = down.clientY
    let live = true
    let frame: number | null = null

    try {
        scroller.setPointerCapture(pointerId)
    } catch {
        // A pointer that is already gone cannot be captured; the window listeners below still end the drag.
    }

    function loop(): void {
        frame = null
        if (!live) {
            return
        }
        const rect = scroller.getBoundingClientRect()
        const delta = autoscrollDelta(lastClientY, rect.top, rect.bottom)
        if (delta === 0) {
            return
        }
        scroller.scrollTop += delta
        handlers.onpoint(lastClientY)
        frame = requestAnimationFrame(loop)
    }

    function onMove(event: PointerEvent): void {
        if (event.pointerId !== pointerId) {
            return
        }
        lastClientY = event.clientY
        handlers.onpoint(lastClientY)
        const rect = scroller.getBoundingClientRect()
        if (frame === null && autoscrollDelta(lastClientY, rect.top, rect.bottom) !== 0) {
            frame = requestAnimationFrame(loop)
        }
    }

    function onUp(event: PointerEvent): void {
        if (event.pointerId === pointerId) {
            end('commit')
        }
    }

    function onCancel(event: PointerEvent): void {
        if (event.pointerId === pointerId) {
            end('abort')
        }
    }

    function onKey(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            end('abort')
        }
    }

    function onHidden(): void {
        if (document.visibilityState === 'hidden') {
            end('abort')
        }
    }

    function onBlur(): void {
        end('abort')
    }

    function end(kind: DragEnd): void {
        if (!live) {
            return
        }
        live = false
        if (frame !== null) {
            cancelAnimationFrame(frame)
            frame = null
        }
        // Listeners go first, so nothing the release dispatches synchronously reaches a handler of this session.
        scroller.removeEventListener('pointermove', onMove)
        scroller.removeEventListener('pointerup', onUp)
        scroller.removeEventListener('pointercancel', onCancel)
        scroller.removeEventListener('lostpointercapture', onCancel)
        window.removeEventListener('keydown', onKey, { capture: true })
        window.removeEventListener('blur', onBlur)
        document.removeEventListener('visibilitychange', onHidden)
        try {
            if (scroller.hasPointerCapture(pointerId)) {
                scroller.releasePointerCapture(pointerId)
            }
        } catch {
            // The pointer is already gone; nothing is left to release.
        }
        handlers.onend(kind)
    }

    scroller.addEventListener('pointermove', onMove)
    scroller.addEventListener('pointerup', onUp)
    scroller.addEventListener('pointercancel', onCancel)
    scroller.addEventListener('lostpointercapture', onCancel)
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onHidden)

    return {
        abort: () => end('abort'),
        get live() { return live },
    }
}

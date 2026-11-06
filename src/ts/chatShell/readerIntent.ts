import { isScrolledToBottom } from './bottomAnchor'

// Reader intent is what the reader's hands asked the transcript to do: touch movement, the wheel, scroll keys and a
// scrollbar drag. It is never inferred from scrollTop changes, because the browser also moves scrollTop (anchoring,
// content-visibility settling, clamps, reflow) and none of that is the reader's doing.
export type IntentDirection = 'older' | 'newer'
export type IntentInput = 'touch' | 'wheel' | 'key' | 'scrollbar'

export interface ReaderIntentEvent {
    direction: IntentDirection
    // CSS px of reader travel behind this event; always positive.
    distance: number
    source: IntentInput
}

export type ReaderIntentListener = (event: ReaderIntentEvent) => void

export interface ReaderIntentSource {
    subscribe: (listener: ReaderIntentListener) => () => void
}

// Android's touch slop in dp; dp equals CSS px here.
export const TOUCH_SLOP = 8
const LINE_PX = 16
const KEY_STEP_PX = 40
const EDGE_EPSILON = 0.5

// A descendant scroller that can still move in the direction takes the gesture instead of the transcript.
type Blocked = (direction: IntentDirection) => boolean

export interface TouchSample {
    x: number
    y: number
    // Fingers currently on the screen after this event.
    fingers: number
    blocked?: Blocked
}

export interface WheelSample {
    deltaX: number
    deltaY: number
    deltaMode: number
    ctrlKey: boolean
    shiftKey: boolean
    pageHeight: number
    blocked?: Blocked
}

export interface KeySample {
    key: string
    shiftKey: boolean
    // True with ctrl, alt or meta held.
    modified: boolean
    // A text field or contenteditable owns the key.
    editable: boolean
    // A button or link owns Space (it activates the control).
    interactive: boolean
    pageHeight: number
}

export interface ReaderIntent extends ReaderIntentSource {
    touchStart: (sample: TouchSample) => void
    touchMove: (sample: TouchSample) => void
    touchEnd: (fingers: number) => void
    wheel: (sample: WheelSample) => void
    key: (sample: KeySample) => void
    scrollbarStart: (y: number) => void
    scrollbarMove: (y: number) => void
    scrollbarEnd: () => void
}

export interface ReaderIntentOptions {
    // An intent counts only when the host can move that way at that moment; a pull at an end does nothing.
    canMove: (direction: IntentDirection) => boolean
}

export function canHostMove(host: Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>, direction: IntentDirection): boolean {
    return direction === 'older' ? host.scrollTop > EDGE_EPSILON : !isScrolledToBottom(host)
}

type TouchPhase = 'idle' | 'pending' | 'vertical' | 'horizontal' | 'cancelled'

export function createReaderIntent(options: ReaderIntentOptions): ReaderIntent {
    const listeners = new Set<ReaderIntentListener>()
    function emit(direction: IntentDirection, distance: number, source: IntentInput, blocked?: Blocked): void {
        if (!(distance > 0) || !Number.isFinite(distance)) return
        if (blocked?.(direction)) return
        if (!options.canMove(direction)) return
        for (const listener of [...listeners]) listener({ direction, distance, source })
    }

    let phase: TouchPhase = 'idle'
    let startX = 0
    let startY = 0
    let lastY = 0
    let touchBlocked: Blocked | undefined

    function emitTouch(y: number, from: number): void {
        const travel = y - from
        // A finger moving down drags older content into view.
        emit(travel > 0 ? 'older' : 'newer', Math.abs(travel), 'touch', touchBlocked)
    }

    let scrollbarY: number | null = null

    return {
        subscribe: (listener) => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        touchStart: (sample) => {
            if (sample.fingers !== 1) { phase = 'cancelled'; return }
            phase = 'pending'
            startX = sample.x
            startY = sample.y
            lastY = sample.y
            touchBlocked = sample.blocked
        },
        touchMove: (sample) => {
            if (phase === 'idle' || phase === 'cancelled' || phase === 'horizontal') return
            if (sample.fingers > 1) { phase = 'cancelled'; return }
            if (phase === 'pending') {
                const dx = sample.x - startX
                const dy = sample.y - startY
                if (Math.hypot(dx, dy) < TOUCH_SLOP) return
                if (Math.abs(dy) <= Math.abs(dx)) { phase = 'horizontal'; return }
                phase = 'vertical'
                // The travel up to the lock is the reader's own and counts.
                emitTouch(sample.y, startY)
                lastY = sample.y
                return
            }
            emitTouch(sample.y, lastY)
            lastY = sample.y
        },
        touchEnd: (fingers) => {
            if (fingers <= 0) { phase = 'idle'; touchBlocked = undefined; return }
            phase = 'cancelled'
        },
        wheel: (sample) => {
            if (sample.ctrlKey || sample.shiftKey) return
            if (Math.abs(sample.deltaX) >= Math.abs(sample.deltaY)) return
            const unit = sample.deltaMode === 1 ? LINE_PX : sample.deltaMode === 2 ? sample.pageHeight : 1
            // Wheel up (negative deltaY) brings older content into view.
            emit(sample.deltaY < 0 ? 'older' : 'newer', Math.abs(sample.deltaY) * unit, 'wheel', sample.blocked)
        },
        key: (sample) => {
            if (sample.editable || sample.modified) return
            const page = sample.pageHeight
            switch (sample.key) {
                case 'PageUp': if (!sample.shiftKey) emit('older', page, 'key'); break
                case 'PageDown': if (!sample.shiftKey) emit('newer', page, 'key'); break
                case 'ArrowUp': if (!sample.shiftKey) emit('older', KEY_STEP_PX, 'key'); break
                case 'ArrowDown': if (!sample.shiftKey) emit('newer', KEY_STEP_PX, 'key'); break
                case 'Home': if (!sample.shiftKey) emit('older', page, 'key'); break
                case 'End': if (!sample.shiftKey) emit('newer', page, 'key'); break
                case ' ': if (!sample.interactive) emit(sample.shiftKey ? 'older' : 'newer', page, 'key'); break
                default: break
            }
        },
        scrollbarStart: (y) => { scrollbarY = y },
        scrollbarMove: (y) => {
            if (scrollbarY === null) return
            const travel = y - scrollbarY
            scrollbarY = y
            // Dragging the thumb down moves toward newer content.
            emit(travel > 0 ? 'newer' : 'older', Math.abs(travel), 'scrollbar')
        },
        scrollbarEnd: () => { scrollbarY = null },
    }
}

function canScrollInside(element: Element, direction: IntentDirection): boolean {
    const overflowY = getComputedStyle(element).overflowY
    if (overflowY !== 'auto' && overflowY !== 'scroll') return false
    if (element.scrollHeight <= element.clientHeight) return false
    return canHostMove(element, direction)
}

function innerScrollerBlocks(target: EventTarget | null, host: HTMLElement): Blocked {
    return (direction) => {
        let node = target instanceof Element ? target : null
        while (node && node !== host) {
            if (canScrollInside(node, direction)) return true
            node = node.parentElement
        }
        return false
    }
}

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
const INTERACTIVE_SELECTOR = 'button, a[href], summary, [role="button"]'

// Feeds the reducer from passive listeners on the transcript host. Momentum after release, scroll events, focus scrolls,
// find-in-page and selection autoscroll raise no input event here, so they are never counted.
export function bindReaderIntent(host: HTMLElement, intent: ReaderIntent): () => void {
    const onTouchStart = (event: TouchEvent) => {
        const touch = event.touches[0]
        intent.touchStart({ x: touch?.clientX ?? 0, y: touch?.clientY ?? 0, fingers: event.touches.length, blocked: innerScrollerBlocks(event.target, host) })
    }
    const onTouchMove = (event: TouchEvent) => {
        const touch = event.touches[0]
        if (!touch) return
        intent.touchMove({ x: touch.clientX, y: touch.clientY, fingers: event.touches.length })
    }
    const onTouchEnd = (event: TouchEvent) => { intent.touchEnd(event.touches.length) }
    const onWheel = (event: WheelEvent) => {
        intent.wheel({ deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, pageHeight: host.clientHeight, blocked: innerScrollerBlocks(event.target, host) })
    }
    const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target instanceof Element ? event.target : null
        const editable = !!target && (target.closest(EDITABLE_SELECTOR) !== null || (target as HTMLElement).isContentEditable === true)
        const interactive = editable || (!!target && target.closest(INTERACTIVE_SELECTOR) !== null)
        intent.key({ key: event.key, shiftKey: event.shiftKey, modified: event.ctrlKey || event.altKey || event.metaKey, editable, interactive, pageHeight: host.clientHeight })
    }
    const onPointerMove = (event: PointerEvent) => { intent.scrollbarMove(event.clientY) }
    const stopScrollbar = () => {
        intent.scrollbarEnd()
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', stopScrollbar)
        window.removeEventListener('pointercancel', stopScrollbar)
    }
    const onPointerDown = (event: PointerEvent) => {
        // Only a mouse press on the host's own scrollbar gutter is a scrollbar drag; a touch or pen press is not.
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.target !== host || event.offsetX < host.clientWidth) return
        intent.scrollbarStart(event.clientY)
        window.addEventListener('pointermove', onPointerMove, { passive: true })
        window.addEventListener('pointerup', stopScrollbar)
        window.addEventListener('pointercancel', stopScrollbar)
    }
    host.addEventListener('touchstart', onTouchStart, { passive: true })
    host.addEventListener('touchmove', onTouchMove, { passive: true })
    host.addEventListener('touchend', onTouchEnd, { passive: true })
    host.addEventListener('touchcancel', onTouchEnd, { passive: true })
    host.addEventListener('wheel', onWheel, { passive: true })
    host.addEventListener('keydown', onKeyDown, { passive: true })
    host.addEventListener('pointerdown', onPointerDown, { passive: true })
    return () => {
        host.removeEventListener('touchstart', onTouchStart)
        host.removeEventListener('touchmove', onTouchMove)
        host.removeEventListener('touchend', onTouchEnd)
        host.removeEventListener('touchcancel', onTouchEnd)
        host.removeEventListener('wheel', onWheel)
        host.removeEventListener('keydown', onKeyDown)
        host.removeEventListener('pointerdown', onPointerDown)
        stopScrollbar()
    }
}

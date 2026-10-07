import type { RailDrag } from './railDrag'

/**
 * Connects the rail's scroll container and the window to a `RailDrag` machine.
 *
 * Container listeners live as long as the container. Window and document listeners that
 * only matter during a gesture (moves, keys, blur, page visibility, geometry changes) exist
 * only between `setSession(true)` and `setSession(false)`, so an idle rail adds none.
 * Pointer ends are listened for on the window for the container's whole life, so touch
 * pointers that never start a drag are still forgotten.
 */
export interface RailBinding {
    setSession(active: boolean): void
    destroy(): void
}

export function bindRail(el: HTMLElement, machine: RailDrag): RailBinding {
    const onPointerDown = (e: PointerEvent) => machine.pointerDown(e)
    const onPointerMove = (e: PointerEvent) => machine.pointerMove(e)
    const onPointerUp = (e: PointerEvent) => machine.pointerUp(e)
    const onPointerCancel = (e: PointerEvent) => machine.pointerCancel(e)
    // Capture handed from a pressed child to the container fires lostpointercapture at the child and bubbles; only the container's own loss ends a drag.
    const onLostCapture = (e: PointerEvent) => {
        if (e.target === el) {
            machine.lostCapture(e)
        }
    }
    const onScroll = () => machine.scrolled()
    const onGeometry = () => machine.rectChanged()
    // Only a scroll of an ancestor (or the page) can move the container's rect; the container's own scrolling and unrelated scrollers must not cost a layout read.
    const onAncestorScroll = (e: Event) => {
        const target = e.target
        if (target === el) {
            return
        }
        if (!(target instanceof Node) || (target !== el && target.contains(el))) {
            machine.rectChanged()
        }
    }
    const onInterrupt = () => machine.interrupt()
    const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
            machine.interrupt()
        }
    }

    const onContextMenu = (e: MouseEvent) => {
        if (machine.isTouchContextMenu()) {
            e.preventDefault()
            e.stopPropagation()
        }
    }
    const onClick = (e: MouseEvent) => {
        if (machine.consumeClick()) {
            e.preventDefault()
            e.stopImmediatePropagation()
        }
    }
    const onTouchMove = (e: TouchEvent) => {
        if (machine.shouldPreventTouchMove() && e.cancelable) {
            e.preventDefault()
        }
    }
    // A native drag of an image or link would end the pointer stream with a pointercancel.
    const onDragStart = (e: DragEvent) => e.preventDefault()
    const onKeyDown = (e: KeyboardEvent) => {
        if (machine.keyDown(e.key)) {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
        }
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('lostpointercapture', onLostCapture)
    el.addEventListener('scroll', onScroll)
    el.addEventListener('contextmenu', onContextMenu, true)
    el.addEventListener('click', onClick, true)
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('dragstart', onDragStart)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)

    let session = false
    const setSession = (active: boolean) => {
        if (active === session) {
            return
        }
        session = active
        if (active) {
            window.addEventListener('pointermove', onPointerMove)
            window.addEventListener('keydown', onKeyDown, true)
            window.addEventListener('blur', onInterrupt)
            window.addEventListener('resize', onGeometry)
            window.addEventListener('scroll', onAncestorScroll, true)
            document.addEventListener('visibilitychange', onVisibility)
        }
        else {
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('blur', onInterrupt)
            window.removeEventListener('resize', onGeometry)
            window.removeEventListener('scroll', onAncestorScroll, true)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }

    return {
        setSession,
        destroy() {
            setSession(false)
            el.removeEventListener('pointerdown', onPointerDown)
            el.removeEventListener('lostpointercapture', onLostCapture)
            el.removeEventListener('scroll', onScroll)
            el.removeEventListener('contextmenu', onContextMenu, true)
            el.removeEventListener('click', onClick, true)
            el.removeEventListener('touchmove', onTouchMove)
            el.removeEventListener('dragstart', onDragStart)
            window.removeEventListener('pointerup', onPointerUp)
            window.removeEventListener('pointercancel', onPointerCancel)
        },
    }
}

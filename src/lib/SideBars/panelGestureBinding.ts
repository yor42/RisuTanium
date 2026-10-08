import { get, type Readable } from 'svelte/store'
import { alertStore, sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
import { inEdgeZone, INSET_MAX_CSS, INSET_PROBE_MAX_CSS, PanelGesture, type PanelIntent } from './panelGesture'

declare global {
    interface Window {
        /**
         * Android host: width in CSS px of the OS back-gesture strip on the left edge. Absent
         * elsewhere; absence, a throw or a non-finite answer all mean no strip.
         */
        __risuTaniumGestureInset?: { left?: () => unknown }
        /**
         * Android Back hook: true when the page consumed Back by closing the overlay.
         * Legacy in-window plugin code can reach it; sandboxed V3 plugins cannot.
         */
        __risuTaniumBack?: () => boolean
    }
}

/**
 * A stroke with no touch event for this long is dropped, so a lost touchend can never
 * leave listeners behind.
 */
const STROKE_IDLE_MS = 1000

/**
 * Margin added to the close animation before a missed `animationend` is forced to finish,
 * so a hidden or throttled panel can never leave the overlay stuck closing.
 */
const CLOSE_GRACE_MS = 300
const DEFAULT_ANIMATION_MS = 200

const YIELD_SELECTOR =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [data-panel-gesture="off"], .sortable-chosen'

interface Stroke {
    id: number
    intent: PanelIntent
    target: Element
    claimed: boolean
    fired: boolean
    lastEvent: Event | null
    watchdog: ReturnType<typeof setTimeout>
    stop: () => void
}

export interface PanelGestureOptions {
    now?: () => number
}

function isTouchEvent(e: Event): e is TouchEvent {
    return 'changedTouches' in e
}

function findTouch(list: TouchList, id: number): Touch | null {
    for (let i = 0; i < list.length; i++) {
        const touch = list[i]
        if (touch && touch.identifier === id) {
            return touch
        }
    }
    return null
}

/**
 * The host's left gesture inset, sanitised to `[0, INSET_MAX_CSS]`. Read per call because no
 * change event exists (navigation mode and rotation change it); callers gate the call so
 * touches far from the edge never cross the host bridge.
 */
function readGestureInsetLeft(): number {
    try {
        const bridge = window.__risuTaniumGestureInset
        if (!bridge || typeof bridge.left !== 'function') {
            return 0
        }
        // Called as a method: the host bridge object needs its receiver.
        const value: unknown = bridge.left()
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return 0
        }
        return Math.min(Math.max(value, 0), INSET_MAX_CSS)
    } catch {
        return 0
    }
}

function animationBudgetMs(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--risu-animation-speed').trim()
    const value = parseFloat(raw)
    if (!Number.isFinite(value)) {
        return DEFAULT_ANIMATION_MS + CLOSE_GRACE_MS
    }
    return (raw.endsWith('ms') ? value : value * 1000) + CLOSE_GRACE_MS
}

/**
 * Controls that own horizontal movement keep it: text fields, sliders, sortable rows,
 * anything scrolling sideways, and (for opening) any full-screen modal layer above the page.
 * Only reached after the cheap checks, because it reads computed style per ancestor.
 */
function shouldYield(target: Element, intent: PanelIntent): boolean {
    for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
        if (el.matches(YIELD_SELECTOR)) {
            return true
        }
        const style = getComputedStyle(el)
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth) {
            return true
        }
        if (intent === 'open' && style.position === 'fixed') {
            return true
        }
    }
    return false
}

function openOverlay() {
    sideBarClosing.set(false)
    sideBarStore.set(true)
}

function closeOverlay() {
    if (get(sideBarClosing)) {
        return
    }
    sideBarClosing.set(true)
}

/**
 * Installs the overlay's swipe triggers and the Android Back hook, and returns the cleanup.
 * Meant to live exactly as long as the phone overlay's backdrop: nothing is installed in the
 * wide layout, in MobileGUI, or while a full-page screen replaces the sidebar.
 *
 * Only a passive `touchstart` is permanent. Move, end and cancel listeners exist for one
 * stroke, on both the touch target (a removed node keeps receiving its own events) and the
 * window (covers retargeting). A stroke only ever calls today's open or close path, once.
 */
export function installPanelGesture(options: PanelGestureOptions = {}): () => void {
    const now = options.now ?? (() => performance.now())
    const machine = new PanelGesture()
    let stroke: Stroke | null = null
    let closingTimer: ReturnType<typeof setTimeout> | null = null
    let closingSince: number | null = null

    const endStroke = () => {
        const s = stroke
        if (!s) {
            return
        }
        stroke = null
        clearTimeout(s.watchdog)
        s.stop()
        machine.cancel()
    }

    const forceFinishClose = () => {
        sideBarClosing.set(false)
        sideBarStore.set(false)
    }

    const beginStroke = (touch: Touch, target: Element, intent: PanelIntent) => {
        const onMove = (e: Event) => {
            if (!isTouchEvent(e) || e === s.lastEvent) {
                return
            }
            s.lastEvent = e
            if (!s.target.isConnected || e.touches.length > 1) {
                endStroke()
                return
            }
            const t = findTouch(e.changedTouches, s.id)
            if (!t) {
                return
            }
            armWatchdog()
            if (s.fired) {
                if (e.cancelable) {
                    e.preventDefault()
                }
                return
            }
            const result = machine.move(t.clientX, t.clientY, now(), e.cancelable)
            if (result === 'abandon') {
                endStroke()
                return
            }
            if (result === 'none' && !s.claimed) {
                return
            }
            s.claimed = true
            if (e.cancelable) {
                e.preventDefault()
            }
            if (result === 'trigger') {
                // Marked before acting: the store changes the action causes must not cancel
                // this stroke, which keeps swallowing its remaining events.
                s.fired = true
                if (s.intent === 'open') {
                    openOverlay()
                } else {
                    closeOverlay()
                }
            }
        }
        const onEnd = (e: Event) => {
            if (!isTouchEvent(e) || e === s.lastEvent) {
                return
            }
            s.lastEvent = e
            if (!findTouch(e.changedTouches, s.id)) {
                return
            }
            // A claimed stroke ends without a synthesized click, so a swipe that began on the
            // handle does not also tap it. A tap that never moved past the slop is left alone.
            if ((s.claimed || s.fired) && e.cancelable) {
                e.preventDefault()
            }
            machine.end()
            endStroke()
        }
        const onCancel = (e: Event) => {
            if (isTouchEvent(e) && findTouch(e.changedTouches, s.id)) {
                endStroke()
            }
        }
        const onInterrupt = () => endStroke()
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                endStroke()
            }
        }
        const armWatchdog = () => {
            clearTimeout(s.watchdog)
            s.watchdog = setTimeout(endStroke, STROKE_IDLE_MS)
        }

        const targets: EventTarget[] = [target, window]
        const s: Stroke = {
            id: touch.identifier,
            intent,
            target,
            claimed: false,
            fired: false,
            lastEvent: null,
            watchdog: setTimeout(endStroke, STROKE_IDLE_MS),
            stop: () => {
                for (const t of targets) {
                    t.removeEventListener('touchmove', onMove)
                    t.removeEventListener('touchend', onEnd)
                    t.removeEventListener('touchcancel', onCancel)
                }
                document.removeEventListener('visibilitychange', onVisibility)
                window.removeEventListener('blur', onInterrupt)
                window.removeEventListener('pagehide', onInterrupt)
            },
        }
        for (const t of targets) {
            t.addEventListener('touchmove', onMove, { passive: false })
            t.addEventListener('touchend', onEnd, { passive: false })
            t.addEventListener('touchcancel', onCancel)
        }
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('blur', onInterrupt)
        window.addEventListener('pagehide', onInterrupt)
        stroke = s
        machine.start(touch.clientX, touch.clientY, now(), intent)
    }

    const onTouchStart = (e: TouchEvent) => {
        if (stroke) {
            // A second finger cancels: pinch and two-finger gestures are never a swipe.
            endStroke()
            return
        }
        if (e.touches.length !== 1) {
            return
        }
        if (get(alertStore).type !== 'none' || get(sideBarClosing)) {
            return
        }
        const touch = e.changedTouches[0]
        const target = touch?.target
        if (!touch || !(target instanceof Element)) {
            return
        }
        let intent: PanelIntent
        if (!get(sideBarStore)) {
            // The host bridge is consulted only near the edge; the handle opens from anywhere.
            const inZone = touch.clientX < INSET_PROBE_MAX_CSS && inEdgeZone(touch.clientX, readGestureInsetLeft())
            if (!inZone && !target.closest('[data-panel-handle]')) {
                return
            }
            intent = 'open'
        } else {
            if (!target.closest('[data-panel-surface]') || target.closest('[data-rail-root]')) {
                return
            }
            intent = 'close'
        }
        if (shouldYield(target, intent)) {
            return
        }
        beginStroke(touch, target, intent)
    }

    // Subscribe callbacks run once on subscribe; only later changes are state changes.
    let storeReady = false
    const stores: Array<Readable<boolean>> = [sideBarStore, sideBarClosing]
    const unsubscribers = stores.map((store) =>
        store.subscribe(() => {
            if (storeReady && stroke && !stroke.fired) {
                endStroke()
            }
        }),
    )
    unsubscribers.push(
        sideBarClosing.subscribe((closing) => {
            if (closingTimer !== null) {
                clearTimeout(closingTimer)
                closingTimer = null
            }
            if (closing) {
                closingSince = now()
                closingTimer = setTimeout(forceFinishClose, animationBudgetMs())
            } else {
                closingSince = null
            }
        }),
    )
    storeReady = true

    const backHook = (): boolean => {
        if (get(alertStore).type !== 'none' || !get(sideBarStore)) {
            return false
        }
        if (get(sideBarClosing)) {
            if (closingSince !== null && now() - closingSince > animationBudgetMs()) {
                forceFinishClose()
            }
            return true
        }
        endStroke()
        sideBarClosing.set(true)
        return true
    }
    Object.defineProperty(window, '__risuTaniumBack', {
        configurable: true,
        writable: false,
        value: backHook,
    })

    document.addEventListener('touchstart', onTouchStart, { passive: true })

    return () => {
        document.removeEventListener('touchstart', onTouchStart)
        endStroke()
        for (const unsubscribe of unsubscribers) {
            unsubscribe()
        }
        if (closingTimer !== null) {
            clearTimeout(closingTimer)
            closingTimer = null
        }
        // A newer instance may already own the hook; only remove our own.
        if (window.__risuTaniumBack === backHook) {
            delete window.__risuTaniumBack
        }
    }
}

/** `{@attach}` entry for the overlay backdrop: lives and dies with the backdrop element. */
export const panelGestureAttachment = (): (() => void) => installPanelGesture()

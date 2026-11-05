import { get, writable, type Readable } from 'svelte/store'
import { pageCovered } from '../../ts/alertPrompts'
import { registerBackHandler } from '../../ts/backHandlers'
import { connectHostBridge, gestureInsetLeft } from '../../ts/android/hostBridge'
import { shellEligible } from '../../ts/chatShell/shellSwitch.svelte'
import { sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
import {
    followPanelWidth,
    inEdgeZone,
    inFollowOpenZone,
    INSET_MAX_CSS,
    INSET_PROBE_MAX_CSS,
    PanelFollow,
    PanelGesture,
    WIDE_LAYOUT_MIN_PX,
    type FollowRelease,
    type PanelIntent,
} from './panelGesture'

declare global {
    interface Window {
        /**
         * Android host: width in CSS px of the OS back-gesture strip on the left edge. Absent
         * elsewhere; absence, a throw or a non-finite answer all mean no strip.
         */
        __risuTaniumGestureInset?: { left?: () => unknown }
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
    /** Follow mode: runs when the stroke is cut short after the panel started moving. */
    abort?: () => void
}

export interface PanelGestureOptions {
    now?: () => number
    /**
     * Whether strokes use the follow-the-finger mode. Read at every touch start. The default is
     * the new chat shell being the active surface in the narrow layout; everywhere else the
     * trigger-only recognizer keeps its own thresholds.
     */
    followEnabled?: () => boolean
}

/**
 * What the follow-mode controller shows. `dragging`: the panel tracks the finger at `progress`
 * with no transition. `settling`: it moves to `progress` (0 or 1) over `durationMs`. `idle`:
 * nothing is driven; `entered` says a drag already left the panel fully open, so the
 * button-open entrance must not replay.
 */
export interface PanelFollowView {
    phase: 'idle' | 'dragging' | 'settling'
    progress: number
    durationMs: number
    entered: boolean
}

const IDLE_VIEW: PanelFollowView = { phase: 'idle', progress: 0, durationMs: 0, entered: false }

export const panelFollowView = writable<PanelFollowView>(IDLE_VIEW)

/** The chat motion duration token's nominal value; the animation speed multiplies it. */
const SETTLE_NOMINAL_MS = 200
const SETTLE_REDUCED_MS = 120
/** The settle timer fires just after the transition has ended. */
const SETTLE_SLACK_MS = 20

function defaultFollowEnabled(): boolean {
    return window.innerWidth < WIDE_LAYOUT_MIN_PX && shellEligible()
}

function isRtl(): boolean {
    const root = document.documentElement
    return root.dir === 'rtl' || getComputedStyle(root).direction === 'rtl'
}

/**
 * Settle time after a release: the chat base duration scaled by a unitless animation speed,
 * 120 ms under reduced motion. A speed with a unit (seconds) is not a multiplier and gives the
 * nominal value.
 */
function settleDurationMs(): number {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        return SETTLE_REDUCED_MS
    }
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--risu-animation-speed').trim()
    const value = Number(raw)
    return raw !== '' && Number.isFinite(value) && value >= 0 ? Math.round(SETTLE_NOMINAL_MS * value) : SETTLE_NOMINAL_MS
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
 * The host's left gesture inset, sanitised to `[0, INSET_MAX_CSS]`. Read per call: with the
 * host channel it is the last pushed value, with the separate host object a fresh answer
 * (navigation mode and rotation change it). Callers gate the call so touches far from the
 * edge never reach the host.
 */
function readGestureInsetLeft(): number {
    try {
        const value: unknown = gestureInsetLeft()
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
    // Binds the host channel before any touch can reach the inset read, so the host's first push is already on its way.
    connectHostBridge()
    const now = options.now ?? (() => performance.now())
    const followEnabled = options.followEnabled ?? defaultFollowEnabled
    const machine = new PanelGesture()
    let stroke: Stroke | null = null
    let closingTimer: ReturnType<typeof setTimeout> | null = null
    let closingSince: number | null = null
    let settleTimer: ReturnType<typeof setTimeout> | null = null

    const endStroke = () => {
        const s = stroke
        if (!s) {
            return
        }
        stroke = null
        clearTimeout(s.watchdog)
        s.stop()
        machine.cancel()
        s.abort?.()
    }

    // Moves the panel to its resting state over the settle time. Open leaves the stores as the
    // drag set them; close finishes through the same path as a forced close.
    const settle = (decision: FollowRelease) => {
        if (settleTimer !== null) {
            clearTimeout(settleTimer)
        }
        const durationMs = settleDurationMs()
        panelFollowView.set({ phase: 'settling', progress: decision === 'open' ? 1 : 0, durationMs, entered: decision === 'open' })
        settleTimer = setTimeout(() => {
            settleTimer = null
            if (decision === 'open') {
                panelFollowView.set({ phase: 'idle', progress: 1, durationMs: 0, entered: true })
            } else {
                forceFinishClose()
                panelFollowView.set(IDLE_VIEW)
            }
        }, durationMs + SETTLE_SLACK_MS)
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

    // Follow mode: the panel tracks the finger, and the release decides open or close. A stroke
    // that never claimed changes nothing; one cut short after claiming settles back to where it
    // started.
    const beginFollowStroke = (touch: Touch, target: Element, intent: PanelIntent) => {
        const follow = new PanelFollow()
        const rtl = isRtl()
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
            if (!s.claimed) {
                armWatchdog()
            }
            const result = follow.move(t.clientX, t.clientY, now(), e.cancelable)
            if (result === 'abandon') {
                endStroke()
                return
            }
            if (result === 'none' && !s.claimed) {
                return
            }
            if (result === 'claim') {
                // Marked before the store changes so they do not cancel this stroke. A drag holds
                // still without touch events, so the idle watchdog no longer applies.
                s.claimed = true
                s.fired = true
                clearTimeout(s.watchdog)
                s.abort = () => settle(s.intent === 'open' ? 'close' : 'open')
                if (s.intent === 'open') {
                    sideBarClosing.set(false)
                    sideBarStore.set(true)
                }
                panelFollowView.update((view) => ({ ...view, phase: 'dragging', progress: follow.progress, durationMs: 0 }))
            } else if (result === 'drag') {
                panelFollowView.update((view) => ({ ...view, progress: follow.progress }))
            }
            if (e.cancelable) {
                e.preventDefault()
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
            if (s.claimed && e.cancelable) {
                e.preventDefault()
            }
            const decision = follow.end(now())
            // The release decides; the cut-short path must not settle a second time.
            s.abort = undefined
            endStroke()
            if (decision !== 'none') {
                settle(decision)
            }
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
        follow.start(touch.clientX, touch.clientY, now(), intent, followPanelWidth(window.innerWidth), rtl)
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
        if (pageCovered() || get(sideBarClosing) || settleTimer !== null) {
            return
        }
        const touch = e.changedTouches[0]
        const target = touch?.target
        if (!touch || !(target instanceof Element)) {
            return
        }
        const follow = followEnabled()
        let intent: PanelIntent
        if (!get(sideBarStore)) {
            // The host bridge is consulted only near the edge; the handle opens from anywhere.
            let inZone: boolean
            if (follow) {
                const rtl = isRtl()
                const nearEdge = rtl ? touch.clientX > window.innerWidth - INSET_PROBE_MAX_CSS : touch.clientX < INSET_PROBE_MAX_CSS
                inZone =
                    nearEdge &&
                    inFollowOpenZone({
                        xPx: touch.clientX,
                        viewportWidthPx: window.innerWidth,
                        dpPerPx: 1,
                        hostInsetDp: readGestureInsetLeft(),
                        rtl,
                    })
            } else {
                inZone = touch.clientX < INSET_PROBE_MAX_CSS && inEdgeZone(touch.clientX, readGestureInsetLeft())
            }
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
        if (follow) {
            beginFollowStroke(touch, target, intent)
        } else {
            beginStroke(touch, target, intent)
        }
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
    unsubscribers.push(
        sideBarStore.subscribe((open) => {
            // A closed panel plays its entrance again the next time a button opens it.
            if (!open) {
                panelFollowView.update((view) => (view.entered ? { ...view, entered: false } : view))
            }
        }),
    )
    storeReady = true

    const backHook = (): boolean => {
        if (pageCovered() || !get(sideBarStore)) {
            return false
        }
        if (get(sideBarClosing)) {
            if (closingSince !== null && now() - closingSince > animationBudgetMs()) {
                forceFinishClose()
            }
            return true
        }
        if (settleTimer !== null) {
            // The panel is already settling to its resting place; this press is consumed.
            return true
        }
        if (stroke?.abort) {
            // Back during a drag closes from where the panel is, instead of settling back first.
            stroke.abort = undefined
            endStroke()
            settle('close')
            return true
        }
        endStroke()
        sideBarClosing.set(true)
        return true
    }
    const unregisterBack = registerBackHandler(backHook)

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
        if (settleTimer !== null) {
            clearTimeout(settleTimer)
            settleTimer = null
            // A settle cut off by teardown must not leave the panel half-driven.
            panelFollowView.set(IDLE_VIEW)
        }
        // Removes only this instance's registration; a newer instance keeps its own.
        unregisterBack()
    }
}

/** `{@attach}` entry for the overlay backdrop: lives and dies with the backdrop element. */
export const panelGestureAttachment = (): (() => void) => installPanelGesture()

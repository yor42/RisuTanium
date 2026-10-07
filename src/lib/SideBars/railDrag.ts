import type { FolderRef, ItemRef } from './sidebarOrder'
import {
    AUTO_SCROLL_MAX_DT_MS,
    AUTO_SCROLL_MAX_PX_PER_S,
    CLICK_SUPPRESS_MS,
    LONG_PRESS_MS,
    MERGE_DWELL_MS,
    MOUSE_DRAG_THRESHOLD_PX,
    OUTSIDE_MARGIN_PX,
    PAGE_SCROLL_FRACTION,
    SPRING_OPEN_MS,
    TOUCH_CONTEXTMENU_WINDOW_MS,
    TOUCH_SLOP_PX,
    edgeBandPx,
} from './railConstants'
import { locate, type Layout } from './railLayout'
import { NO_TARGET, resolveTarget, zoneCandidateAt, type Target, type ZoneCandidate } from './railTarget'

/**
 * The interaction machine of the sidebar rail: one pointer gesture from press to drop or
 * cancel, for mouse, touch and pen. It holds no DOM. The host feeds it pointer, key and
 * scroll notifications and supplies geometry and timers; the machine reports what the host
 * must draw and, on a drop, the one write to perform.
 *
 * Invariants:
 * - Only `onDrop` can lead to a change of the order; every other path ends with no write.
 * - Targets come from the layout model and the cached container rect, never from the DOM
 *   under the pointer.
 * - A merge dwell, a spring-open timer or an append highlight starts only when the pointer
 *   moves into a row's centre zone. When the row under a stationary pointer changes, or the
 *   pointer enters an active edge band or leaves the zone, they stop and wait for the next move
 *   into a zone.
 */

export interface RailRect {
    left: number
    top: number
    width: number
    height: number
}

export interface PointerInfo {
    pointerId: number
    pointerType: string
    button: number
    isPrimary: boolean
    clientX: number
    clientY: number
}

export interface RailEnv {
    now(): number
    setTimer(fn: () => void, ms: number): number
    clearTimer(id: number): void
    requestFrame(fn: (t: number) => void): number
    cancelFrame(id: number): void
}

export const browserEnv: RailEnv = {
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
    requestFrame: (fn) => window.requestAnimationFrame(fn),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
}

export interface RailHost {
    getLayout(): Layout
    /** The scroll container's client rect. Read at press and when `rectChanged` is called. */
    readRect(): RailRect
    getScrollTop(): number
    /** The largest scroll position; 0 when the content fits the container. */
    getScrollMax(): number
    /** Sets the scroll position; the host clamps it to the scrollable range. */
    setScrollTop(top: number): void
    captureTake(pointerId: number): void
    captureRelease(pointerId: number): void
    /** A press is pending or a drag is running (`true`), or neither remains (`false`). */
    onSession(active: boolean): void
    onLift(): void
    onDragStart(source: ItemRef, x: number, y: number): void
    onGhost(x: number, y: number): void
    /** Called only when the target changes. */
    onTarget(target: Target): void
    /** Always called once when a drag ends, whether it dropped or was cancelled. */
    onDragEnd(): void
    /** The one write. Only called for a gap that is not a no-op, a merge or an append. */
    onDrop(source: ItemRef, target: Target): void
    onSpringOpen(folder: FolderRef): void
    /** A touch long-press on a folder was released without moving. */
    onTouchMenu(folder: FolderRef): void
}

type Phase = 'idle' | 'pressed' | 'dragging'
type Cause = 'move' | 'scroll' | 'frame' | 'layout' | 'timer'

interface ActiveZone {
    candidate: ZoneCandidate
    armed: boolean
    mergeTimer: number | null
    springTimer: number | null
}

/**
 * Every pointer that gets long press, slop and menu-on-release is also tracked by the touch
 * context-menu guard. Only a mouse is exempt, so its right-click still opens the menu.
 */
function isTouchLikePointer(pointerType: string): boolean {
    return pointerType !== 'mouse'
}

function targetSignature(target: Target): string {
    switch (target.kind) {
        case 'none':
            return 'none'
        case 'gap':
            return `gap:${target.noop ? 'noop:' : ''}${target.key}`
        default:
            return `${target.kind}:${target.key}`
    }
}

export class RailDrag {
    private phase: Phase = 'idle'
    private pointerId = -1
    private touchLike = false
    private source: ItemRef | null = null
    private sourceKey = ''
    private startX = 0
    private startY = 0
    private x = 0
    private y = 0
    private moved = false
    private captured = false
    private rect: RailRect = { left: 0, top: 0, width: 0, height: 0 }
    private longPressTimer: number | null = null
    private zone: ActiveZone | null = null
    private lastCandidateKey: string | null = null
    private target: Target = NO_TARGET
    private frameId: number | null = null
    private lastFrameTime: number | null = null
    private scrollRemainder = 0
    private suppressClick = false
    private suppressTimer: number | null = null
    private readonly touchPointers = new Set<number>()
    private touchEndedAt = -Infinity

    constructor(private readonly host: RailHost, private readonly env: RailEnv = browserEnv) {}

    get isDragging(): boolean {
        return this.phase === 'dragging'
    }

    get isPressed(): boolean {
        return this.phase !== 'idle'
    }

    /** True while a lifted touch or pen gesture must keep the browser from scrolling. */
    shouldPreventTouchMove(): boolean {
        return this.phase === 'dragging' && this.touchLike
    }

    /**
     * Whether a `contextmenu` event belongs to a touch gesture: a touch pointer is down, or
     * one ended recently enough that the event can still be that gesture's long-press.
     */
    isTouchContextMenu(): boolean {
        return this.touchPointers.size > 0 || this.env.now() - this.touchEndedAt < TOUCH_CONTEXTMENU_WINDOW_MS
    }

    /** Swallows the click that follows a drag or long-press, once. */
    consumeClick(): boolean {
        if (!this.suppressClick) {
            return false
        }
        this.disarmClick()
        return true
    }

    pointerDown(e: PointerInfo): void {
        this.disarmClick()
        if (isTouchLikePointer(e.pointerType)) {
            this.touchPointers.add(e.pointerId)
        }
        if (this.phase !== 'idle' || !e.isPrimary || e.button !== 0) {
            return
        }
        this.rect = this.host.readRect()
        const layout = this.host.getLayout()
        const index = locate(layout, e.clientY - this.rect.top + this.host.getScrollTop())
        const item = index >= 0 ? layout.items[index] : undefined
        if (!item || !item.ref || (item.kind !== 'char' && item.kind !== 'folder' && item.kind !== 'member')) {
            return
        }
        this.source = item.ref
        this.sourceKey = item.key
        this.pointerId = e.pointerId
        this.touchLike = isTouchLikePointer(e.pointerType)
        this.startX = this.x = e.clientX
        this.startY = this.y = e.clientY
        this.moved = false
        this.phase = 'pressed'
        this.host.onSession(true)
        if (this.touchLike) {
            this.longPressTimer = this.env.setTimer(() => {
                this.longPressTimer = null
                if (this.phase === 'pressed') {
                    this.beginDrag(true)
                }
            }, LONG_PRESS_MS)
        }
    }

    pointerMove(e: PointerInfo): void {
        if (this.phase === 'idle' || e.pointerId !== this.pointerId) {
            return
        }
        this.x = e.clientX
        this.y = e.clientY
        const travelled = Math.hypot(this.x - this.startX, this.y - this.startY)
        if (this.phase === 'pressed') {
            if (this.touchLike) {
                if (travelled >= TOUCH_SLOP_PX) {
                    this.teardown(false)
                }
            }
            else if (travelled >= MOUSE_DRAG_THRESHOLD_PX) {
                this.beginDrag(false)
            }
            return
        }
        if (this.touchLike && travelled >= TOUCH_SLOP_PX) {
            this.moved = true
        }
        this.host.onGhost(this.x, this.y)
        this.evaluate('move')
    }

    pointerUp(e: PointerInfo): void {
        this.forgetTouchPointer(e)
        if (this.phase === 'idle' || e.pointerId !== this.pointerId) {
            return
        }
        if (this.phase === 'pressed') {
            this.teardown(false)
            return
        }
        if (e.clientX !== this.x || e.clientY !== this.y) {
            this.x = e.clientX
            this.y = e.clientY
            this.evaluate('scroll')
        }
        const source = this.source!
        const target = this.target
        const menuRelease = this.touchLike && !this.moved && source.kind === 'folder'
        this.teardown(true)
        if (target.kind === 'merge' || target.kind === 'append' || (target.kind === 'gap' && !target.noop)) {
            try {
                this.host.onDrop(source, target)
            }
            catch (error) {
                console.error('sidebar rail drop failed:', error)
            }
        }
        else if (menuRelease && source.kind === 'folder') {
            this.host.onTouchMenu(source)
        }
    }

    pointerCancel(e: PointerInfo): void {
        this.forgetTouchPointer(e)
        if (this.phase === 'idle' || e.pointerId !== this.pointerId) {
            return
        }
        this.teardown(this.phase === 'dragging')
    }

    lostCapture(e: { pointerId: number }): void {
        if (this.phase === 'dragging' && e.pointerId === this.pointerId) {
            this.teardown(true)
        }
    }

    /**
     * Handles a key during a press or drag. Returns true when the key was consumed and the
     * caller must stop it from reaching anything else.
     */
    keyDown(key: string): boolean {
        if (this.phase !== 'dragging') {
            return false
        }
        const page = this.rect.height * PAGE_SCROLL_FRACTION
        const scrollTop = this.host.getScrollTop()
        switch (key) {
            case 'Escape':
                this.teardown(true)
                return true
            case 'PageDown':
                this.host.setScrollTop(scrollTop + page)
                break
            case 'PageUp':
                this.host.setScrollTop(scrollTop - page)
                break
            case 'Home':
                this.host.setScrollTop(0)
                break
            case 'End':
                this.host.setScrollTop(Number.MAX_SAFE_INTEGER)
                break
            default:
                return false
        }
        this.evaluate('scroll')
        return true
    }

    /** Window blur or the page going hidden: ends the gesture and forgets touch pointers. */
    interrupt(): void {
        this.touchPointers.clear()
        this.touchEndedAt = this.env.now()
        this.cancel()
    }

    /** Ends a pending press or a drag without a write. */
    cancel(): void {
        if (this.phase !== 'idle') {
            this.teardown(this.phase === 'dragging')
        }
    }

    /** The items or their heights changed. A drag whose source is gone ends without a write. */
    layoutChanged(): void {
        if (this.phase === 'idle') {
            return
        }
        if (!this.host.getLayout().indexByKey.has(this.sourceKey)) {
            this.cancel()
            return
        }
        if (this.phase === 'dragging') {
            this.evaluate('layout')
        }
    }

    scrolled(): void {
        if (this.phase === 'dragging') {
            this.evaluate('scroll')
        }
    }

    rectChanged(): void {
        if (this.phase !== 'idle') {
            this.rect = this.host.readRect()
            if (this.phase === 'dragging') {
                this.evaluate('scroll')
            }
        }
    }

    destroy(): void {
        this.cancel()
        this.disarmClick()
    }

    private forgetTouchPointer(e: PointerInfo): void {
        if (isTouchLikePointer(e.pointerType) && this.touchPointers.delete(e.pointerId) && this.touchPointers.size === 0) {
            this.touchEndedAt = this.env.now()
        }
    }

    private disarmClick(): void {
        this.suppressClick = false
        if (this.suppressTimer !== null) {
            this.env.clearTimer(this.suppressTimer)
            this.suppressTimer = null
        }
    }

    private armClick(): void {
        this.disarmClick()
        this.suppressClick = true
        this.suppressTimer = this.env.setTimer(() => {
            this.suppressTimer = null
            this.suppressClick = false
        }, CLICK_SUPPRESS_MS)
    }

    private beginDrag(lifted: boolean): void {
        if (this.longPressTimer !== null) {
            this.env.clearTimer(this.longPressTimer)
            this.longPressTimer = null
        }
        this.phase = 'dragging'
        this.host.captureTake(this.pointerId)
        this.captured = true
        if (lifted) {
            this.host.onLift()
        }
        this.host.onDragStart(this.source!, this.x, this.y)
        this.host.onGhost(this.x, this.y)
        this.evaluate('move')
    }

    /** Ends the press or drag in every way: no write, listeners and timers released. */
    private teardown(armClick: boolean): void {
        const wasDragging = this.phase === 'dragging'
        const pointerId = this.pointerId
        const captured = this.captured
        this.phase = 'idle'
        this.captured = false
        this.source = null
        this.sourceKey = ''
        this.pointerId = -1
        this.target = NO_TARGET
        this.lastCandidateKey = null
        this.clearZone()
        if (this.longPressTimer !== null) {
            this.env.clearTimer(this.longPressTimer)
            this.longPressTimer = null
        }
        this.stopFrames()
        if (captured) {
            this.host.captureRelease(pointerId)
        }
        if (armClick) {
            this.armClick()
        }
        this.host.onSession(false)
        if (wasDragging) {
            this.host.onDragEnd()
        }
    }

    private clearZone(): void {
        const zone = this.zone
        if (!zone) {
            return
        }
        this.zone = null
        if (zone.mergeTimer !== null) {
            this.env.clearTimer(zone.mergeTimer)
        }
        if (zone.springTimer !== null) {
            this.env.clearTimer(zone.springTimer)
        }
    }

    private enterZone(candidate: ZoneCandidate): void {
        this.clearZone()
        const zone: ActiveZone = { candidate, armed: false, mergeTimer: null, springTimer: null }
        this.zone = zone
        if (candidate.ref.kind === 'char') {
            zone.mergeTimer = this.env.setTimer(() => {
                zone.mergeTimer = null
                if (this.zone === zone && this.phase === 'dragging') {
                    zone.armed = true
                    this.evaluate('timer')
                }
            }, MERGE_DWELL_MS)
        }
        else if (candidate.closedFolder) {
            const folder = candidate.ref
            zone.springTimer = this.env.setTimer(() => {
                zone.springTimer = null
                if (this.zone === zone && this.phase === 'dragging') {
                    this.host.onSpringOpen(folder)
                }
            }, SPRING_OPEN_MS)
        }
    }

    private stopFrames(): void {
        if (this.frameId !== null) {
            this.env.cancelFrame(this.frameId)
            this.frameId = null
        }
        this.lastFrameTime = null
        this.scrollRemainder = 0
    }

    private frame(t: number): void {
        this.frameId = null
        if (this.phase !== 'dragging') {
            return
        }
        const dt = this.lastFrameTime === null ? 0 : Math.min(Math.max(t - this.lastFrameTime, 0), AUTO_SCROLL_MAX_DT_MS)
        this.lastFrameTime = t
        this.scrollRemainder += (this.velocity() * dt) / 1000
        const whole = Math.trunc(this.scrollRemainder)
        if (whole !== 0) {
            this.scrollRemainder -= whole
            this.host.setScrollTop(this.host.getScrollTop() + whole)
        }
        this.evaluate('frame')
    }

    private isOutside(): boolean {
        return this.x < this.rect.left - OUTSIDE_MARGIN_PX || this.x > this.rect.left + this.rect.width + OUTSIDE_MARGIN_PX
    }

    /**
     * Signed scroll speed in px/s from the pointer's depth in an edge band. A band is inert
     * (speed 0, and it neither scrolls nor suppresses zones) while the container cannot scroll
     * in that band's direction.
     */
    private velocity(): number {
        if (this.isOutside() || this.rect.height <= 0) {
            return 0
        }
        const band = edgeBandPx(this.rect.height)
        if (band <= 0) {
            return 0
        }
        const yRel = this.y - this.rect.top
        const scrollTop = this.host.getScrollTop()
        if (yRel < band) {
            return scrollTop <= 0 ? 0 : -AUTO_SCROLL_MAX_PX_PER_S * Math.min(1, (band - yRel) / band)
        }
        if (yRel > this.rect.height - band) {
            return scrollTop >= this.host.getScrollMax() ? 0 : AUTO_SCROLL_MAX_PX_PER_S * Math.min(1, (yRel - (this.rect.height - band)) / band)
        }
        return 0
    }

    private evaluate(cause: Cause): void {
        const source = this.source
        if (this.phase !== 'dragging' || !source) {
            return
        }
        const layout = this.host.getLayout()
        const outside = this.isOutside()
        const velocity = this.velocity()
        const inBand = velocity !== 0
        const contentY = this.y - this.rect.top + this.host.getScrollTop()

        const candidate = outside || inBand ? null : zoneCandidateAt(layout, contentY, source)
        const candidateKey = candidate ? candidate.key : null
        if (cause === 'move' && candidate && candidateKey !== this.lastCandidateKey) {
            this.enterZone(candidate)
        }
        else if (this.zone && this.zone.candidate.key !== candidateKey) {
            this.clearZone()
        }
        this.lastCandidateKey = candidateKey

        const target = resolveTarget({
            layout,
            y: contentY,
            source,
            outside,
            zoneKey: this.zone ? this.zone.candidate.key : null,
            mergeArmed: this.zone ? this.zone.armed : false,
        })
        if (targetSignature(target) !== targetSignature(this.target)) {
            this.target = target
            this.host.onTarget(target)
        }
        else {
            this.target = target
        }

        if (velocity !== 0) {
            if (this.frameId === null) {
                this.frameId = this.env.requestFrame((t) => this.frame(t))
            }
        }
        else {
            this.stopFrames()
        }
    }
}

import { flushSync } from 'svelte'
import { edgeBandPx, LONG_PRESS_MS, MOUSE_DRAG_THRESHOLD_PX } from './railConstants'

/**
 * Drag helpers for tests that mount the real sidebar.
 *
 * `dragOnto` has two backends, chosen by what the mounted DOM offers: the pointer backend
 * (pointerdown, pointermove, pointerup against the rail's fake geometry) for a DOM that has
 * the pointer rail, and the native backend (dragstart, drop) for a DOM of HTML5 drag and
 * drop rows. The lookups work on both DOMs, so one test body can run against either.
 *
 * Fake geometry: happy-dom has no layout. `installGeometry` gives the rail's scroll
 * container a fixed rect at the top left of the page and a scroll position the test owns;
 * item positions come from the `data-rail-y` and `data-rail-h` attributes the rail renders
 * from its layout model.
 */

const NATIVE_SIDEBAR_DRAG_TYPE = 'application/x-risu-sidebar-drag'
const COLUMN_X = 40
const COLUMN_WIDTH = 80

export type Backend = 'native' | 'pointer'

export const backendOf = (root: HTMLElement): Backend => (root.querySelector('[data-rail-scroll]') ? 'pointer' : 'native')

//#region lookups

const RAIL_ROW = '[data-rail-kind="char"], [data-rail-kind="folder"], [data-rail-kind="member"]'
const NATIVE_ROW = 'div[draggable="true"]'
const NATIVE_FOLDER_BODY = 'div.mt-1.rounded-lg'

export function railRowOf(el: Element | null | undefined): HTMLElement | null {
    return el ? el.closest<HTMLElement>(`${RAIL_ROW}, ${NATIVE_ROW}`) : null
}

export function allRows(root: HTMLElement): HTMLElement[] {
    return backendOf(root) === 'pointer'
        ? Array.from(root.querySelectorAll<HTMLElement>(RAIL_ROW))
        : Array.from(root.querySelectorAll<HTMLElement>(NATIVE_ROW))
}

export function topRows(root: HTMLElement): HTMLElement[] {
    return backendOf(root) === 'pointer'
        ? Array.from(root.querySelectorAll<HTMLElement>('[data-rail-kind="char"], [data-rail-kind="folder"]'))
        : allRows(root).filter((el) => !el.closest(NATIVE_FOLDER_BODY))
}

export function topGaps(root: HTMLElement): HTMLElement[] {
    return backendOf(root) === 'pointer'
        ? Array.from(root.querySelectorAll<HTMLElement>('[data-rail-kind="gap"][data-rail-scope="top"]'))
        : Array.from(root.querySelectorAll<HTMLElement>('div.h-4.min-h-4.w-14')).filter((g) => !g.classList.contains('relative'))
}

export const folderAvatars = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>('span.avatar')).filter((a) => !a.hasAttribute('data-char-id'))

/** The `n`-th rendered row for character `id` (a top-level or folder member row). */
export function charRow(root: HTMLElement, id: string, n = 0): HTMLElement {
    const row = railRowOf(Array.from(root.querySelectorAll(`[data-char-id="${id}"]`))[n])
    if (!row) {
        throw new Error(`no row ${n} for ${id}`)
    }
    return row
}

/** The `n`-th folder row in the top-level list. */
export function folderRow(root: HTMLElement, n = 0): HTMLElement {
    const row = railRowOf(folderAvatars(root)[n])
    if (!row) {
        throw new Error(`no folder row ${n}`)
    }
    return row
}

/** The gaps of an open folder, in order: the start, then one after each member. */
export function folderGaps(root: HTMLElement, folderRowEl: HTMLElement): HTMLElement[] {
    if (backendOf(root) === 'pointer') {
        const key = folderRowEl.getAttribute('data-rail-key')
        const gaps = Array.from(root.querySelectorAll<HTMLElement>('[data-rail-kind="gap"][data-rail-scope="folder"]')).filter(
            (g) => g.getAttribute('data-rail-owner') === key,
        )
        if (gaps.length === 0) {
            throw new Error('folder is not open')
        }
        return gaps
    }
    const body = folderRowEl.nextElementSibling
    if (!body || !body.matches(NATIVE_FOLDER_BODY)) {
        throw new Error('folder is not open')
    }
    return Array.from(body.querySelectorAll<HTMLElement>('div.h-4'))
}

export function scrollerOf(root: HTMLElement): HTMLElement {
    const el = root.querySelector<HTMLElement>('[data-rail-scroll]')
    if (!el) {
        throw new Error('no pointer rail in this DOM')
    }
    return el
}

//#endregion

//#region geometry

export interface Geometry {
    readonly el: HTMLElement
    readonly height: number
    readonly scrollTop: number
    /** Sets the scroll position and fires the container's `scroll` event. */
    scrollTo(top: number): void
    /**
     * `scrollTo`, then waits for the animation frame in which the rail reads the new position
     * and for the render that follows. Needs real animation frames.
     */
    scrollAndSettle(top: number): Promise<void>
    /** Like `display: none`: the container reports no height and a scroll position of 0. */
    hide(): void
    /**
     * Undoes `hide`. The container is back at the scroll position it had, or at `scrollTop`
     * when given, set without a scroll event (a browser may restore a position silently).
     */
    show(scrollTop?: number): void
}

/** Resolves after the next animation frame and the render that follows it. */
export async function settleFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await defaultSettle()
}

const geometries = new WeakMap<HTMLElement, Geometry>()

/** The model's total height, which the rail renders on its scroll container: the rows that are mounted are only a window of it. */
function railTotal(el: HTMLElement): number {
    return Number(el.getAttribute('data-rail-total') ?? 0)
}

/** Gives the rail's scroll container a rect and scroll geometry. Returns null on a DOM without the pointer rail. */
export function installGeometry(root: HTMLElement, height = 2000): Geometry | null {
    const el = root.querySelector<HTMLElement>('[data-rail-scroll]')
    if (!el) {
        return null
    }
    let scrollTop = 0
    let hidden = false
    const geometry: Geometry = {
        el,
        height,
        get scrollTop() {
            return scrollTop
        },
        scrollTo(top: number) {
            scrollTop = top
            el.dispatchEvent(new Event('scroll'))
        },
        async scrollAndSettle(top: number) {
            geometry.scrollTo(top)
            await settleFrame()
        },
        hide() {
            hidden = true
        },
        show(restoredTop?: number) {
            hidden = false
            if (restoredTop !== undefined) {
                scrollTop = restoredTop
            }
        },
    }
    Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, width: COLUMN_WIDTH, height, right: COLUMN_WIDTH, bottom: height, x: 0, y: 0, toJSON: () => ({}) }),
    })
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => (hidden ? 0 : height) })
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => (hidden ? 0 : Math.max(railTotal(el), height)) })
    Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => (hidden ? 0 : scrollTop),
        set: (value: number) => {
            scrollTop = value
        },
    })
    geometries.set(root, geometry)
    // The rail reads its viewport on a scroll event; the container is now laid out.
    el.dispatchEvent(new Event('scroll'))
    return geometry
}

export function geometryOf(root: HTMLElement): Geometry {
    const geometry = geometries.get(root)
    if (!geometry) {
        throw new Error('installGeometry was not called for this root')
    }
    return geometry
}

export interface Box {
    y: number
    h: number
}

/** The model offset and height the rail rendered for an element, in content coordinates. */
export function boxOf(el: HTMLElement): Box {
    const y = el.getAttribute('data-rail-y')
    const h = el.getAttribute('data-rail-h')
    if (y === null || h === null) {
        throw new Error('element has no rail geometry')
    }
    return { y: Number(y), h: Number(h) }
}

/** Client y at `fraction` of an element's height. */
export function clientY(root: HTMLElement, el: HTMLElement, fraction = 0.5): number {
    const box = boxOf(el)
    return box.y + box.h * fraction - geometryOf(root).scrollTop
}

/** Client y inside a row's centre zone that is clear of both edge bands. */
export function zoneClientY(root: HTMLElement, el: HTMLElement): number {
    const { height, scrollTop } = geometryOf(root)
    const box = boxOf(el)
    const band = edgeBandPx(height)
    const lo = Math.max(box.y + box.h / 4 - scrollTop, band)
    const hi = Math.min(box.y + (box.h * 3) / 4 - scrollTop, height - band)
    if (lo >= hi) {
        throw new Error('the row centre zone is inside an edge band')
    }
    return Math.floor((lo + hi) / 2)
}

//#endregion

//#region events

export interface PointerOptions {
    pointerType?: 'mouse' | 'touch' | 'pen'
    pointerId?: number
    button?: number
    isPrimary?: boolean
    x?: number
}

export function pointer(type: string, y: number, o: PointerOptions = {}): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: o.pointerId ?? 1,
        pointerType: o.pointerType ?? 'mouse',
        button: o.button ?? 0,
        isPrimary: o.isPrimary ?? true,
        clientX: o.x ?? COLUMN_X,
        clientY: y,
    })
}

export const defaultSettle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
}

export const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface FakeDataTransfer {
    types: string[]
    setData(type: string, value: string): void
    setDragImage(): void
    dropEffect: string
}

function nativeDataTransfer(): FakeDataTransfer {
    return {
        types: [],
        setData(type: string) {
            if (!this.types.includes(type)) {
                this.types.push(type)
            }
        },
        setDragImage() {},
        dropEffect: 'none',
    }
}

export function fireNative(el: Element, type: string, dataTransfer: { types: string[] }): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
    el.dispatchEvent(ev)
    return ev
}

//#endregion

//#region dragOnto

export interface DragOptions {
    /**
     * Where on a row the pointer rests. `centre` is the middle of the centre zone, `upper` and
     * `lower` lie outside it. Ignored for a gap target, and by the native backend.
     */
    zone?: 'centre' | 'upper' | 'lower'
    /** Time the pointer rests on the target before release (the merge dwell). Ignored by the native backend. */
    holdMs?: number
    pointerType?: 'mouse' | 'touch' | 'pen'
    /** Called after every event batch to let the component settle. */
    settle?: () => Promise<void>
    /** Waits `ms` while the pointer rests. Defaults to a real timer. */
    wait?: (ms: number) => Promise<void>
}

function targetY(root: HTMLElement, target: HTMLElement, zone: 'centre' | 'upper' | 'lower'): number {
    const kind = target.getAttribute('data-rail-kind')
    if (kind === 'gap' || zone !== 'centre') {
        return clientY(root, target, kind === 'gap' ? 0.5 : zone === 'upper' ? 0.125 : 0.875)
    }
    return zoneClientY(root, target)
}

/**
 * Drags `source` onto `target` and releases. On the pointer backend the pointer presses the
 * source row, moves to the target position, rests for `holdMs`, and releases. A touch drag
 * first holds the press for the long-press time.
 */
export async function dragOnto(root: HTMLElement, source: HTMLElement, target: HTMLElement, opts: DragOptions = {}): Promise<void> {
    const settle = opts.settle ?? defaultSettle
    const wait = opts.wait ?? realWait
    if (backendOf(root) === 'native') {
        const dt = nativeDataTransfer()
        fireNative(source, 'dragstart', dt)
        await settle()
        fireNative(target, 'drop', dt)
        await settle()
        return
    }
    const pointerType = opts.pointerType ?? 'mouse'
    const o: PointerOptions = { pointerType }
    const downY = clientY(root, source)
    source.dispatchEvent(pointer('pointerdown', downY, o))
    if (pointerType === 'mouse') {
        window.dispatchEvent(pointer('pointermove', downY + MOUSE_DRAG_THRESHOLD_PX + 1, o))
    }
    else {
        await wait(LONG_PRESS_MS)
    }
    await settle()
    const y = targetY(root, target, opts.zone ?? 'centre')
    window.dispatchEvent(pointer('pointermove', y, o))
    await settle()
    if (opts.holdMs) {
        await wait(opts.holdMs)
        await settle()
    }
    window.dispatchEvent(pointer('pointerup', y, o))
    await settle()
}

//#endregion

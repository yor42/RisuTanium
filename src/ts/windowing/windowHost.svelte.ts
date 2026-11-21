import { tick, untrack } from 'svelte'
import { REVEAL_PIN_TIMEOUT_MS, UNMEASURED_VIEWPORT_PX } from '../../lib/SideBars/railConstants'
import { createFocusSettle } from '../focusSettle'
import { sameKeys, WIDEN_DELAY_MS, type WindowPhase } from './listWindow'

/**
 * Windowing host: the one object that reads the scroll geometry for every windowed segment of
 * a list, so a list of several sections (headers, banners and rows) shares one band. Used with
 * `WindowedSegment.svelte`; the pure maths lives in `listWindow.ts`.
 *
 * Usage. Create the host in the consumer's component init and give it the element that
 * contains every segment (`root`; a getter is fine for a `bind:this` element). Render one or
 * more `WindowedSegment` with `host={host}` inside `root`. Call `host.dispose()` when the
 * consumer is destroyed.
 *
 * Re-binding. The root is resolved again at every band read and every `WindowedSegment` bind.
 * When it is a different element from the bound one (the consumer's markup re-created it), the
 * host detaches its listeners and observations from the old root and scroller, then binds the
 * new ones as at the first bind (scroller, `scroll`, `focusin`/`focusout`, size observation) and
 * re-reads the focused row. A root that resolves to null keeps the old binding until a new root
 * appears. A reveal is kept across the re-binding.
 *
 *     const host = createWindowHost({ root: () => container })
 *     onDestroy(host.dispose)
 *
 *     <section bind:this={container}>
 *         <WindowedSegment {host} keys={rows} height={{ fallback: 86, heights }}>
 *             {#snippet item(key, index)}<Row {key} />{/snippet}
 *         </WindowedSegment>
 *     </section>
 *
 * Inputs of a segment (see the component for the full prop list):
 * - `keys`: unique, in data order. `index` handed to the snippet is always the position in
 *   `keys`, never the DOM order, so reorder and drag handlers address data.
 * - `height`: `{ fixed }` when every row has the same height (no measuring, no
 *   ResizeObserver), else `{ fallback, heights? }` where each mounted row is measured and the
 *   border-box height is stored under its key. A `heights` map may be shared by several
 *   segments and pruned by its owner with `pruneHeights`; heights outlive the element.
 * - pinned keys: a caller's `pinned`, the focused row (found through `focusin`/`focusout` on
 *   `root`) and the key of an active `reveal` stay mounted wherever the band is.
 *
 * Scroll-container contract.
 * - The scroller is the nearest ancestor of `root` whose `overflow-y` is `auto` or `scroll`,
 *   else the window. Pass `scroller: () => element` for another one (null is the window).
 * - The band is the scroller's rect clipped to the viewport; its height falls back to the
 *   viewport height when the rect has none. It is re-read on scroll (one read per frame), on
 *   ResizeObserver reports for the scroller and `root` (only once a measured segment exists),
 *   and once per flush in which any segment's keys or heights changed. Each read also re-reads
 *   the top and `row-gap` of every segment. A host with fixed segments only does not observe
 *   sizes, so a scroller that resizes without a window resize or a scroll leaves its band stale
 *   until the next one; such a consumer calls `refresh()` when it resizes the scroller.
 * - The host writes no style to `root`, the scroller or any ancestor. Spacers carry
 *   `overflow-anchor: none`, so the browser's scroll anchoring never selects a spacer and keeps
 *   the first real row in place when content above the band changes height. A scroller that
 *   itself sets `overflow-anchor: none` gets no such correction.
 * - A segment's element must have no padding or border above its first child: its top is the
 *   origin of the layout.
 *
 * Overscan. Any segment reporting a key change narrows the overscan; a trailing
 * `WIDEN_DELAY_MS` timer (restarted by every change) or a scroll frame widens it again.
 *
 * Reveal hook. `reveal(key)` pins the key, waits for the flush, scrolls the row into the band
 * (unless `scroll: false`) and resolves to its element, or to null for a key no segment holds.
 * Only one reveal is active; a second replaces the first. The pin is released when focus
 * arrives in that row, after `REVEAL_PIN_TIMEOUT_MS`, or when the key leaves every segment.
 */

export interface WindowHostOptions {
    /** The element holding every segment. */
    root: HTMLElement | (() => HTMLElement | null)
    /** `'nearest'` (default) or a function returning the scroller element, null for the window. */
    scroller?: 'nearest' | (() => HTMLElement | null)
    /** Keep the focused row mounted. Default true. */
    focusPin?: boolean
}

export interface RevealOptions {
    /** Scroll the row into the band. Default true. */
    scroll?: boolean
}

/** The per-segment state a `WindowedSegment` reads and writes through the host. */
export interface SegmentSlot {
    /** Top of the segment's element in client coordinates, as of the last read. */
    readonly top: number
    /** The flex `row-gap` of the segment's element in px, as of the last read. */
    readonly gap: number
    /**
     * Whether `top` was read from an element that has layout since the element was bound.
     * An unmeasured top is a placeholder, so the segment mounts only its pinned keys.
     */
    readonly measured: boolean
    /** Counts height changes; reading it makes a layout depend on the stored heights. */
    readonly measuredTick: number
    /** The keys the segment mounts. */
    readonly mounted: ReadonlySet<string>
    /** Attaches the segment's element; null detaches it. */
    bind(element: HTMLElement | null): void
    /** The segment's keys: compared with the previous ones, a change narrows the overscan and re-reads. */
    keysChanged(keys: readonly string[]): void
    setMounted(keys: ReadonlySet<string>): void
    /** Action for an item wrapper: stores its border-box height under `param.key` in `param.heights`. */
    measure(node: HTMLElement, param: MeasureParam): { update(param: MeasureParam): void; destroy(): void }
    dispose(): void
}

export interface MeasureParam {
    key: string
    heights: Map<string, number>
}

export interface WindowHost {
    readonly phase: WindowPhase
    /** Top of the band in client coordinates. */
    readonly bandTop: number
    readonly bandHeight: number
    /** The key of the focused row, null when focus is outside every row. */
    readonly focusedKey: string | null
    /** The key pinned by `reveal`. */
    readonly revealKey: string | null
    /** The resolved scroller; null for the window or before the first segment attached. */
    readonly scroller: HTMLElement | null
    /** Every mounted key of every segment. */
    readonly mountedKeys: ReadonlySet<string>
    createSegment(): SegmentSlot
    isMounted(key: string): boolean
    elementOf(key: string): HTMLElement | null
    reveal(key: string, options?: RevealOptions): Promise<HTMLElement | null>
    /** Re-reads the band and every segment now. */
    refresh(): void
    dispose(): void
}

//#region geometry seam

export interface WindowGeometry {
    /** Client-coordinate top and height of an element. */
    rectOf(element: Element): { top: number; height: number }
    /** Whether the element has layout (false for `display: none` or a detached element). Defaults to true. */
    hasLayout?: (element: Element) => boolean
    /** Height of the viewport. */
    viewport(): number
    /** Scrolls the scroller (null: the window) by `dy` px. */
    scrollBy(scroller: HTMLElement | null, dy: number): void
    /** Runs `callback` in the next frame; returns a cancel function. Defaults to `requestAnimationFrame`. */
    schedule?: (callback: () => void) => () => void
}

let geometryOverride: WindowGeometry | undefined

/** Replaces the browser's geometry reads in tests; undefined restores them. */
export function setWindowGeometryForTests(geometry: WindowGeometry | undefined): void {
    geometryOverride = geometry
}

/** Every row falls in the band: zero rects, a viewport of 1e6 px and a synchronous scheduler. */
export function allRowsGeometry(): WindowGeometry {
    return {
        rectOf: () => ({ top: 0, height: 0 }),
        viewport: () => 1e6,
        scrollBy: () => {},
        schedule: (callback) => {
            callback()
            return () => {}
        },
    }
}

function rectOf(element: Element): { top: number; height: number } {
    if (geometryOverride) {
        return geometryOverride.rectOf(element)
    }
    const rect = element.getBoundingClientRect()
    return { top: rect.top, height: rect.height }
}

/**
 * Whether the engine can say that an element has no layout. An engine that cannot (no
 * `checkVisibility`, as a test DOM without layout) treats every segment as measured, which is the
 * plain geometry path; the geometry seam always can.
 */
function canTellLayout(): boolean {
    return geometryOverride !== undefined || (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.checkVisibility === 'function')
}

function hasLayout(element: Element): boolean {
    if (geometryOverride) {
        return geometryOverride.hasLayout ? geometryOverride.hasLayout(element) : true
    }
    return !(element instanceof HTMLElement) || typeof element.checkVisibility !== 'function' || element.checkVisibility()
}

function viewportHeight(): number {
    if (geometryOverride) {
        return geometryOverride.viewport()
    }
    return typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : UNMEASURED_VIEWPORT_PX
}

function scrollBy(scroller: HTMLElement | null, dy: number): void {
    if (geometryOverride) {
        geometryOverride.scrollBy(scroller, dy)
    }
    else if (scroller) {
        scroller.scrollTop += dy
    }
    else {
        window.scrollBy(0, dy)
    }
}

function schedule(callback: () => void): () => void {
    if (geometryOverride?.schedule) {
        return geometryOverride.schedule(callback)
    }
    const frame = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(frame)
}

//#endregion

function nearestScroller(root: HTMLElement): HTMLElement | null {
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowY
        if (overflow === 'auto' || overflow === 'scroll') {
            return parent
        }
    }
    return null
}

const EMPTY_KEYS: ReadonlySet<string> = new Set()

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) {
        return false
    }
    for (const key of a) {
        if (!b.has(key)) {
            return false
        }
    }
    return true
}

interface MeasuredEntry {
    param: MeasureParam
    slot: InternalSlot
}

interface InternalSlot extends SegmentSlot {
    /** Re-reads top and gap; true when something changed. */
    readGeometry(): void
    hasKey(key: string): boolean
    /** A stored height changed: the layout is stale and the band is re-read in this flush. */
    markRemeasured(): void
}

export function createWindowHost(options: WindowHostOptions): WindowHost {
    let phase = $state<WindowPhase>('wide')
    let bandTop = $state(0)
    let bandHeight = $state(viewportHeight())
    let focusedKey = $state<string | null>(null)
    let revealKey = $state<string | null>(null)
    let slots = $state.raw<readonly InternalSlot[]>([])

    let disposed = false
    let started = false
    let rootElement: HTMLElement | null = null
    let scrollerElement: HTMLElement | null = null
    let widenTimer: ReturnType<typeof setTimeout> | null = null
    let revealTimer: ReturnType<typeof setTimeout> | null = null
    let readQueued = false
    let framePending = false
    let cancelFrame: (() => void) | null = null
    let resizeObserver: ResizeObserver | null = null
    let bandObserved = false
    let delivering = false
    const measured = new WeakMap<Element, MeasuredEntry>()
    const focusSettle = createFocusSettle(settleFocus)
    const useFocusPin = options.focusPin !== false

    // Untracked: `start` runs inside a segment's bind effect, which must not re-run when the root changes.
    function resolveRoot(): HTMLElement | null {
        return typeof options.root === 'function' ? untrack(options.root) : options.root
    }

    //#region band

    function readBand(): void {
        const viewport = viewportHeight()
        let top = 0
        let height = viewport
        if (scrollerElement) {
            const rect = rectOf(scrollerElement)
            top = Math.max(rect.top, 0)
            height = Math.min(rect.top + rect.height, viewport) - top
        }
        if (!(height > 0)) {
            height = viewport
        }
        if (bandTop !== top) {
            bandTop = top
        }
        if (bandHeight !== height) {
            bandHeight = height
        }
    }

    function readNow(): void {
        if (disposed) {
            return
        }
        start()
        readBand()
        for (const slot of slots) {
            slot.readGeometry()
        }
    }

    /** One read per flush, however many segments report. */
    function requestRead(): void {
        if (readQueued || disposed) {
            return
        }
        readQueued = true
        queueMicrotask(() => {
            readQueued = false
            readNow()
        })
    }

    function setPhase(next: WindowPhase): void {
        if (phase !== next) {
            phase = next
        }
    }

    function narrow(): void {
        setPhase('narrow')
        if (widenTimer !== null) {
            clearTimeout(widenTimer)
        }
        widenTimer = setTimeout(() => {
            widenTimer = null
            setPhase('wide')
        }, WIDEN_DELAY_MS)
    }

    function onScroll(): void {
        if (framePending || disposed) {
            return
        }
        framePending = true
        cancelFrame = schedule(() => {
            framePending = false
            if (widenTimer !== null) {
                clearTimeout(widenTimer)
                widenTimer = null
            }
            setPhase('wide')
            readNow()
        })
    }

    function onWindowResize(): void {
        requestRead()
    }

    //#endregion

    //#region start

    /** Binds the resolved root; a root that differs from the bound one is re-bound from scratch. */
    function start(): void {
        if (disposed) {
            return
        }
        const root = resolveRoot()
        if (!root || (started && root === rootElement)) {
            return
        }
        if (started) {
            detachRoot()
        }
        started = true
        rootElement = root
        scrollerElement = options.scroller === undefined || options.scroller === 'nearest' ? nearestScroller(root) : options.scroller()
        ;(scrollerElement ?? window).addEventListener('scroll', onScroll, { passive: true })
        window.addEventListener('resize', onWindowResize)
        if (useFocusPin) {
            root.addEventListener('focusin', focusSettle.schedule)
            root.addEventListener('focusout', focusSettle.schedule)
        }
        syncBandObservation()
        // The focus held in the old root is no longer known; the new root's focus is read again.
        focusSettle.schedule()
    }

    /** Removes everything `start` attached to the bound root and its scroller. */
    function detachRoot(): void {
        ;(scrollerElement ?? window).removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onWindowResize)
        rootElement?.removeEventListener('focusin', focusSettle.schedule)
        rootElement?.removeEventListener('focusout', focusSettle.schedule)
        if (resizeObserver) {
            if (scrollerElement) {
                resizeObserver.unobserve(scrollerElement)
            }
            if (rootElement) {
                resizeObserver.unobserve(rootElement)
            }
        }
        bandObserved = false
        started = false
        rootElement = null
        scrollerElement = null
    }

    function syncBandObservation(): void {
        if (!resizeObserver || !started || bandObserved) {
            return
        }
        bandObserved = true
        if (scrollerElement) {
            resizeObserver.observe(scrollerElement)
        }
        if (rootElement) {
            resizeObserver.observe(rootElement)
        }
    }

    //#endregion

    //#region item measuring

    function ensureObserver(): ResizeObserver | null {
        if (typeof ResizeObserver === 'undefined' || disposed) {
            return null
        }
        resizeObserver ??= new ResizeObserver((records) => {
            delivering = true
            schedule(() => {
                delivering = false
            })
            let bandMoved = false
            for (const record of records) {
                if (record.target === scrollerElement || record.target === rootElement) {
                    bandMoved = true
                    continue
                }
                const entry = measured.get(record.target)
                if (!entry) {
                    continue
                }
                // Only the border box is the box that is measured; a content-box-only report or an empty one writes nothing.
                const height = record.borderBoxSize?.[0]?.blockSize
                if (height === undefined || !Number.isFinite(height) || height <= 0) {
                    continue
                }
                const { key, heights } = entry.param
                if (heights.get(key) !== height) {
                    heights.set(key, height)
                    entry.slot.markRemeasured()
                }
            }
            if (bandMoved) {
                readNow()
            }
        })
        start()
        syncBandObservation()
        return resizeObserver
    }

    // An item mounted during an observer delivery joins the next frame, or the browser raises
    // a "loop completed with undelivered notifications" error.
    function observeItem(node: HTMLElement, entry: MeasuredEntry): () => void {
        measured.set(node, entry)
        const observer = ensureObserver()
        let cancel: (() => void) | null = null
        if (observer) {
            if (delivering) {
                cancel = schedule(() => {
                    cancel = null
                    if (node.isConnected && measured.get(node) === entry) {
                        observer.observe(node)
                    }
                })
            }
            else {
                observer.observe(node)
            }
        }
        return () => {
            cancel?.()
            resizeObserver?.unobserve(node)
            measured.delete(node)
        }
    }

    //#endregion

    //#region focus and reveal

    function settleFocus(): void {
        if (disposed || !rootElement?.isConnected) {
            return
        }
        const active = document.activeElement
        const holder = active instanceof Element && rootElement.contains(active) ? active.closest('[data-window-key]') : null
        const next = holder && rootElement.contains(holder) ? holder.getAttribute('data-window-key') : null
        if (focusedKey !== next) {
            focusedKey = next
        }
        if (next !== null && next === revealKey) {
            clearReveal()
        }
    }

    function clearReveal(): void {
        if (revealTimer !== null) {
            clearTimeout(revealTimer)
            revealTimer = null
        }
        if (revealKey !== null) {
            revealKey = null
        }
    }

    function hasKey(key: string): boolean {
        return slots.some((slot) => slot.hasKey(key))
    }

    function elementOf(key: string): HTMLElement | null {
        if (!rootElement) {
            return null
        }
        for (const candidate of rootElement.querySelectorAll<HTMLElement>('[data-window-key]')) {
            if (candidate.getAttribute('data-window-key') === key) {
                return candidate
            }
        }
        return null
    }

    function scrollIntoBand(element: HTMLElement): void {
        const rect = rectOf(element)
        if (rect.top >= bandTop && rect.top + rect.height <= bandTop + bandHeight) {
            return
        }
        scrollBy(scrollerElement, rect.top - bandTop - Math.max(0, (bandHeight - rect.height) / 2))
        requestRead()
    }

    async function reveal(key: string, revealOptions?: RevealOptions): Promise<HTMLElement | null> {
        if (disposed || !hasKey(key)) {
            clearReveal()
            return null
        }
        clearReveal()
        revealKey = key
        revealTimer = setTimeout(() => {
            revealTimer = null
            if (revealKey === key) {
                revealKey = null
            }
        }, REVEAL_PIN_TIMEOUT_MS)
        await tick()
        if (revealKey !== key) {
            return null
        }
        const element = elementOf(key)
        if (!element) {
            clearReveal()
            return null
        }
        if (revealOptions?.scroll !== false) {
            scrollIntoBand(element)
        }
        return element
    }

    //#endregion

    function createSegment(): SegmentSlot {
        let top = $state(0)
        let gap = $state(0)
        let measured = $state(!canTellLayout())
        let measuredTick = $state(0)
        let mounted = $state.raw<ReadonlySet<string>>(EMPTY_KEYS)
        let element: HTMLElement | null = null
        let keys: readonly string[] | null = null
        let keySet: ReadonlySet<string> = EMPTY_KEYS

        const slot: InternalSlot = {
            get top() {
                return top
            },
            get gap() {
                return gap
            },
            get measured() {
                return measured
            },
            get measuredTick() {
                return measuredTick
            },
            get mounted() {
                return mounted
            },
            bind(next) {
                if (next !== element) {
                    measured = !canTellLayout()
                }
                element = next
                if (next) {
                    start()
                    requestRead()
                }
            },
            keysChanged(next) {
                if (keys !== null && sameKeys(keys, next)) {
                    return
                }
                keys = next
                keySet = new Set(next)
                narrow()
                if (revealKey !== null && !hasKey(revealKey)) {
                    clearReveal()
                }
                requestRead()
            },
            setMounted(next) {
                if (!sameSet(mounted, next)) {
                    mounted = next
                }
            },
            measure(node, param) {
                const entry: MeasuredEntry = { param, slot }
                let release = observeItem(node, entry)
                return {
                    update(nextParam) {
                        if (nextParam.key !== entry.param.key || nextParam.heights !== entry.param.heights) {
                            entry.param = nextParam
                        }
                    },
                    destroy() {
                        release()
                        release = () => {}
                    },
                }
            },
            dispose() {
                slots = slots.filter((candidate) => candidate !== slot)
                element = null
                keys = null
                keySet = EMPTY_KEYS
                if (revealKey !== null && !hasKey(revealKey)) {
                    clearReveal()
                }
            },
            readGeometry() {
                if (!element) {
                    return
                }
                const nextTop = rectOf(element).top
                if (top !== nextTop) {
                    top = nextTop
                }
                // A hidden or detached element reports a zero rect: its top says nothing about where it will sit.
                const laidOut = hasLayout(element)
                if (measured !== laidOut) {
                    measured = laidOut
                }
                const parsed = parseFloat(getComputedStyle(element).rowGap)
                const nextGap = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
                if (gap !== nextGap) {
                    gap = nextGap
                }
            },
            hasKey(key) {
                return keySet.has(key)
            },
            markRemeasured() {
                measuredTick++
                requestRead()
            },
        }
        slots = [...slots, slot]
        return slot
    }

    return {
        get phase() {
            return phase
        },
        get bandTop() {
            return bandTop
        },
        get bandHeight() {
            return bandHeight
        },
        get focusedKey() {
            return focusedKey
        },
        get revealKey() {
            return revealKey
        },
        get scroller() {
            return scrollerElement
        },
        get mountedKeys() {
            const all = new Set<string>()
            for (const slot of slots) {
                for (const key of slot.mounted) {
                    all.add(key)
                }
            }
            return all
        },
        createSegment,
        isMounted(key) {
            return slots.some((slot) => slot.mounted.has(key))
        },
        elementOf,
        reveal,
        refresh: readNow,
        dispose() {
            if (disposed) {
                return
            }
            disposed = true
            if (widenTimer !== null) {
                clearTimeout(widenTimer)
            }
            if (revealTimer !== null) {
                clearTimeout(revealTimer)
            }
            cancelFrame?.()
            focusSettle.dispose()
            resizeObserver?.disconnect()
            resizeObserver = null
            if (started) {
                ;(scrollerElement ?? window).removeEventListener('scroll', onScroll)
                window.removeEventListener('resize', onWindowResize)
                rootElement?.removeEventListener('focusin', focusSettle.schedule)
                rootElement?.removeEventListener('focusout', focusSettle.schedule)
            }
        },
    }
}

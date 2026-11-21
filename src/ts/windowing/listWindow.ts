import { buildRowLayout, type CharRow } from '../../lib/Others/charListRows'
import { locate, type Layout } from '../../lib/SideBars/railLayout'
import { buildSlices, type RailSlice, type RailWindow } from '../../lib/SideBars/railWindow'
import { WINDOW_MIN_OVERSCAN_ROWS, WINDOW_OVERSCAN_VIEWPORTS } from '../../lib/SideBars/railConstants'

/**
 * Pure geometry of one windowed segment of a list (see `windowHost.svelte.ts` for the host and
 * `WindowedSegment.svelte` for the component; this file never reads the DOM).
 *
 * Model. A segment is an ordered list of unique string keys. Every key has a height: the
 * measured border-box height when one is stored, else the segment's fallback (or its fixed
 * height). A flex `row-gap` of `gap` px separates the rendered children, so a key's slot in the
 * layout is `height + gap`. The rendered height of a segment is therefore the layout total
 * minus one trailing gap, whichever keys are mounted:
 *
 * - a mounted key contributes its own `height + gap`;
 * - a run of unmounted keys is replaced by one spacer element of `spacerElementPx(span, gap)`,
 *   which also contributes `span` once the flex gap after it is added.
 *
 * Heights are keyed by the key itself and outlive the element. They are dropped only with the
 * key (`pruneHeights`), so a row scrolled out and back keeps the offsets above it.
 *
 * Pins. A pinned key that lies outside the window stays mounted with a spacer on each side.
 * A pin whose key is not in the segment is ignored.
 */

/** Trailing delay after the last key change before the overscan widens again, in ms. */
export const WIDEN_DELAY_MS = 150

/** `narrow` right after the keys changed, `wide` once the list has been quiet or scrolled. */
export type WindowPhase = 'narrow' | 'wide'

/** One row per key; the row key is the key itself. */
export function segmentRows(keys: readonly string[]): CharRow[] {
    return keys.map((key) => ({ key, cards: [key] }))
}

/**
 * The layout of `keys` with each key at its measured height, else at `fallbackPx`, every slot
 * widened by `gap`. A measured height counts only when it is a positive finite number.
 */
export function segmentLayout(
    keys: readonly string[],
    measured: ReadonlyMap<string, number>,
    fallbackPx: number,
    gap: number,
): Layout {
    const withGap = new Map<string, number>()
    for (const key of keys) {
        const height = measured.get(key)
        if (height !== undefined && Number.isFinite(height) && height > 0) {
            withGap.set(key, height + gap)
        }
    }
    return buildRowLayout(segmentRows(keys), withGap, fallbackPx + gap)
}

/**
 * The window of one segment for a band whose top lies `localTop` px below the segment's top
 * (negative when the band starts above the segment). The range is `[localTop - overscanPx,
 * localTop + bandH + overscanPx]` clamped to the segment, plus the pinned keys outside it.
 * When that range misses `[0, layout.total]` entirely only the pinned keys are mounted:
 * `locate` clamps, so it would otherwise mount the segment's first or last row for a band that
 * is nowhere near it. `computeWindow` cannot serve a segment: it clamps the top to 0 before
 * adding the band height, which mounts up to a band too many rows when the band starts above
 * the segment.
 */
export function segmentWindow(
    layout: Layout,
    localTop: number,
    bandH: number,
    overscanPx: number,
    pins: readonly string[],
): RailWindow {
    if (layout.items.length === 0) {
        return { start: 0, end: 0, pins: [] }
    }
    const from = localTop - overscanPx
    const to = localTop + Math.max(0, bandH) + overscanPx
    const hit = to >= 0 && from <= layout.total
    const start = hit ? locate(layout, from) : 0
    const end = hit ? locate(layout, to) + 1 : 0
    const outside = new Set<number>()
    for (const key of pins) {
        const index = layout.indexByKey.get(key)
        if (index !== undefined && (index < start || index >= end)) {
            outside.add(index)
        }
    }
    return { start, end, pins: Array.from(outside).sort((a, b) => a - b) }
}

/**
 * The window of a segment whose top is not known yet: nothing from the band, only the pinned
 * keys of the segment. Every unmeasured segment would otherwise believe it sits at the band.
 */
export function pinsOnlyWindow(layout: Layout, pins: readonly string[]): RailWindow {
    const outside = new Set<number>()
    for (const key of pins) {
        const index = layout.indexByKey.get(key)
        if (index !== undefined) {
            outside.add(index)
        }
    }
    return { start: 0, end: 0, pins: Array.from(outside).sort((a, b) => a - b) }
}

/**
 * The rendered sequence of a window: `buildSlices`, except that a non-empty segment with
 * nothing mounted (the band is far away and nothing is pinned) is one spacer of the whole
 * height, where `buildSlices` yields nothing and the segment would collapse to zero.
 */
export function segmentSlices(layout: Layout, win: RailWindow): RailSlice[] {
    if (win.end <= win.start && win.pins.length === 0 && layout.items.length > 0) {
        return [{ kind: 'spacer', key: 'all', height: layout.total }]
    }
    return buildSlices(layout, win)
}

/** The height of a spacer element that stands for `spanPx` of layout; the flex gap is added per child. */
export function spacerElementPx(spanPx: number, gap: number): number {
    return Math.max(0, spanPx - gap)
}

/**
 * The overscan on each side of the band. Narrow (right after the keys changed): a floor of
 * `WINDOW_MIN_OVERSCAN_ROWS` fallback rows, so a filter keystroke mounts few rows. Wide: one
 * band height, never below the narrow overscan, so a fling finds rows ready.
 */
export function overscanFor(phase: WindowPhase, bandH: number, fallbackPx: number): number {
    const narrow = WINDOW_MIN_OVERSCAN_ROWS * fallbackPx
    return phase === 'narrow' ? narrow : Math.max(WINDOW_OVERSCAN_VIEWPORTS * bandH, narrow)
}

/** Drops every stored height whose key is not in `liveKeys`. */
export function pruneHeights(heights: Map<string, number>, liveKeys: Iterable<string>): void {
    const live = liveKeys instanceof Set ? liveKeys : new Set(liveKeys)
    for (const key of Array.from(heights.keys())) {
        if (!live.has(key)) {
            heights.delete(key)
        }
    }
}

/** Whether two key lists hold the same keys in the same order. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
    if (a === b) {
        return true
    }
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

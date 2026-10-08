import { locate, type Layout, type LayoutItem } from './railLayout'

/**
 * Which items of the rail's layout are mounted. Pure: it reads the layout model and numbers
 * only, never the DOM, so the choice does not depend on what is currently rendered.
 *
 * The window is one contiguous index range around the scroll viewport, plus the indexes of
 * pinned keys that lie outside it. Spacers of the exact model height stand in for every
 * stretch that is not mounted, so the content height and the offset of each mounted item
 * stay equal to the model's.
 */

export interface RailWindow {
    /** First mounted index of the contiguous range. */
    start: number
    /** One past the last mounted index of the contiguous range. */
    end: number
    /** Indexes of pinned items outside `[start, end)`, ascending and without duplicates. */
    pins: number[]
}

/**
 * The range holding `[scrollTop - overscanPx, scrollTop + viewportH + overscanPx]`, clamped to
 * the list, plus the indexes of the pinned keys outside it. Keys the layout does not hold are
 * ignored. An empty layout has an empty window.
 */
export function computeWindow(
    layout: Layout,
    scrollTop: number,
    viewportH: number,
    overscanPx: number,
    pinnedKeys: readonly string[],
): RailWindow {
    if (layout.items.length === 0) {
        return { start: 0, end: 0, pins: [] }
    }
    const top = Math.max(0, scrollTop)
    const start = locate(layout, top - overscanPx)
    const end = locate(layout, top + Math.max(0, viewportH) + overscanPx) + 1
    const outside = new Set<number>()
    for (const key of pinnedKeys) {
        const index = layout.indexByKey.get(key)
        if (index !== undefined && (index < start || index >= end)) {
            outside.add(index)
        }
    }
    return { start, end, pins: Array.from(outside).sort((a, b) => a - b) }
}

export type RailSlice =
    | { kind: 'spacer'; key: string; height: number }
    | { kind: 'item'; key: string; item: LayoutItem }

/**
 * The rendered sequence for a window: a spacer for the stretch above the first mounted item,
 * the mounted items, a spacer for every stretch skipped between runs (pinned items far from
 * the range) and a spacer for the stretch below the last one. Adjacent pins merge into the
 * run they touch. Spacer keys cannot collide with item keys, which are JSON arrays.
 */
export function buildSlices(layout: Layout, win: RailWindow): RailSlice[] {
    if (win.end <= win.start && win.pins.length === 0) {
        return []
    }
    const runs: Array<[number, number]> = []
    if (win.end > win.start) {
        runs.push([win.start, win.end])
    }
    for (const pin of win.pins) {
        runs.push([pin, pin + 1])
    }
    runs.sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = []
    for (const run of runs) {
        const last = merged.at(-1)
        if (last && run[0] <= last[1]) {
            last[1] = Math.max(last[1], run[1])
        }
        else {
            merged.push([run[0], run[1]])
        }
    }

    const slices: RailSlice[] = []
    const first = merged[0][0]
    if (first > 0) {
        slices.push({ kind: 'spacer', key: 'top', height: layout.offsets[first] })
    }
    merged.forEach(([from, to], i) => {
        for (let index = from; index < to; index++) {
            const item = layout.items[index]
            slices.push({ kind: 'item', key: item.key, item })
        }
        const next = merged[i + 1]
        if (next) {
            slices.push({ kind: 'spacer', key: `gap-after:${layout.items[to - 1].key}`, height: layout.offsets[next[0]] - layout.offsets[to] })
        }
    })
    const lastEnd = merged[merged.length - 1][1]
    if (lastEnd < layout.items.length) {
        slices.push({ kind: 'spacer', key: 'bottom', height: layout.total - layout.offsets[lastEnd] })
    }
    return slices
}

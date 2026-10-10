import { locate, type Layout, type LayoutItem } from './railLayout'
import { resolveTarget, zoneCandidateAt, type Target, type TargetInput, type ZoneCandidate } from './railTarget'
import type { ItemRef } from './sidebarOrder'

/**
 * The geometry a `RailDrag` machine asks of its layout: which item a point presses, whether
 * an item still exists, which row's centre zone holds a point, and what a point targets.
 * `x` and `y` are content coordinates (x relative to the container's left edge, y including
 * the scroll offset). The default is the one-dimensional list; a host with another layout
 * supplies its own resolver and leaves the gesture logic untouched.
 */
export interface RailGeometry {
    sourceAt(layout: Layout, x: number, y: number): LayoutItem | undefined
    hasKey(layout: Layout, key: string): boolean
    zoneCandidateAt(layout: Layout, x: number, y: number, source: ItemRef): ZoneCandidate | null
    resolveTarget(input: TargetInput & { x: number }): Target
}

export const defaultGeometry: RailGeometry = {
    sourceAt(layout, _x, y) {
        const index = locate(layout, y)
        return index >= 0 ? layout.items[index] : undefined
    },
    hasKey(layout, key) {
        return layout.indexByKey.has(key)
    },
    zoneCandidateAt(layout, _x, y, source) {
        return zoneCandidateAt(layout, y, source)
    },
    resolveTarget(input) {
        return resolveTarget(input)
    },
}

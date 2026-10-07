import { edgeBandPx } from './railConstants'
import { buildItems, centreZone, type Layout, type RailEntry } from './railLayout'
import { listRows, refKey, type OrderEntry } from './sidebarOrder'

/**
 * Helpers shared by the rail's tests: entries and layouts built from an order the way the
 * rail builds them, and client positions inside a row's zones.
 */

export interface RailFixtureOptions {
    /** Ids of the folders that are open. */
    open?: readonly string[]
}

export function railEntries(order: readonly OrderEntry[], options: RailFixtureOptions = {}): RailEntry[] {
    const open = new Set(options.open ?? [])
    return listRows(order, () => true).map((row) =>
        row.kind === 'char'
            ? { ref: row.ref, key: row.key, open: false, members: [] }
            : {
                  ref: row.ref,
                  key: row.key,
                  open: open.has(row.id),
                  members: row.members.map((m) => ({ ref: m.ref, key: m.key })),
              },
    )
}

export function railItems(order: readonly OrderEntry[], options: RailFixtureOptions = {}) {
    return buildItems(railEntries(order, options))
}

export const charKey = (id: string, occurrence = 0): string => refKey({ kind: 'char', id, occurrence })
export const folderKey = (id: string, occurrence = 0): string => refKey({ kind: 'folder', id, occurrence })
export const memberKey = (folderId: string, id: string, occurrence = 0, folderOccurrence = 0): string =>
    refKey({ kind: 'member', folder: { kind: 'folder', id: folderId, occurrence: folderOccurrence }, id, occurrence })

function indexOf(layout: Layout, key: string): number {
    const index = layout.indexByKey.get(key)
    if (index === undefined) {
        throw new Error(`no layout item for ${key}`)
    }
    return index
}

/** Content coordinate at `fraction` of the item's height (0 = top edge, 0.5 = middle). */
export function contentY(layout: Layout, key: string, fraction = 0.5): number {
    const index = indexOf(layout, key)
    return layout.offsets[index] + layout.heights[index] * fraction
}

/**
 * A client y inside the item's centre zone and outside both edge bands of a viewport of
 * `viewportHeight` scrolled to `scrollTop` (the container's top is client y 0).
 */
export function zonePoint(layout: Layout, key: string, viewportHeight: number, scrollTop = 0): number {
    const zone = centreZone(layout, indexOf(layout, key))
    const band = edgeBandPx(viewportHeight)
    const lo = Math.max(zone.top - scrollTop, band)
    const hi = Math.min(zone.bottom - scrollTop, viewportHeight - band)
    if (lo >= hi) {
        throw new Error(`the centre zone of ${key} lies in an edge band`)
    }
    return Math.floor((lo + hi) / 2)
}

/** A client y over the item's upper or lower part that is not in its centre zone. */
export function outsideZonePoint(layout: Layout, key: string, part: 'upper' | 'lower', scrollTop = 0): number {
    const index = indexOf(layout, key)
    const zone = centreZone(layout, index)
    const edge = part === 'upper' ? (layout.offsets[index] + zone.top) / 2 : (zone.bottom + layout.offsets[index] + layout.heights[index]) / 2
    return Math.round(edge - scrollTop)
}

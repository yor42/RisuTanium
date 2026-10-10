import type { SortMode } from './charListOrder'

/**
 * What the Grid tab remembers on this device: the chosen sort. It lives in `localStorage`,
 * outside the database, the save and the dirty tracker, so it never travels in a backup.
 * Nothing here throws: storage that is blocked, full or holding something unexpected reads as
 * "My order" and a failed write is ignored.
 */

export const GRID_SORT_KEY = 'risutanium.grid.sort'

/** A known sort from a stored or selected value; anything else is 'order'. */
export function parseGridSort(value: unknown): SortMode {
    return value === 'recent' || value === 'name' ? value : 'order'
}

/** The remembered sort, or 'order' when there is none or it is not a known value. */
export function loadGridSort(): SortMode {
    try {
        return parseGridSort(localStorage.getItem(GRID_SORT_KEY))
    } catch {
        return 'order'
    }
}

export function saveGridSort(sort: SortMode): void {
    try {
        localStorage.setItem(GRID_SORT_KEY, sort)
    } catch {
        // Nothing is remembered; the Grid works without it.
    }
}

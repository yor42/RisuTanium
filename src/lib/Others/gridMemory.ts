import type { SortMode } from './charListOrder'

/**
 * What the library remembers on this device: the Grid tab's chosen sort and the tab the library
 * was last left on. Both live in `localStorage`, outside the database, the save and the dirty
 * tracker, so they never travel in a backup. Nothing here throws: storage that is blocked, full
 * or holding something unexpected reads as "My order" and the Simple tab, and a failed write is
 * ignored.
 */

export const GRID_SORT_KEY = 'risutanium.grid.sort'
export const LIBRARY_TAB_KEY = 'risutanium.library.tab'

/** The library's tab numbers, as `GridCatalog` holds them, by the name stored for each. */
const LIBRARY_TABS = { simple: 3, grid: 0, list: 1, trash: 2 } as const
type LibraryTabName = keyof typeof LIBRARY_TABS

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

/** The tab number for a stored name; anything else is Simple (3). */
export function parseLibraryTab(value: unknown): number {
    for (const name of Object.keys(LIBRARY_TABS) as LibraryTabName[]) {
        if (value === name) {
            return LIBRARY_TABS[name]
        }
    }
    return LIBRARY_TABS.simple
}

/** The remembered tab, or Simple (3) when there is none, it is not a known name or storage throws. */
export function loadLibraryTab(): number {
    try {
        return parseLibraryTab(localStorage.getItem(LIBRARY_TAB_KEY))
    } catch {
        return LIBRARY_TABS.simple
    }
}

/** Remembers the tab by name. A number that is not a tab writes nothing. */
export function saveLibraryTab(tab: number): void {
    const name = (Object.keys(LIBRARY_TABS) as LibraryTabName[]).find((candidate) => LIBRARY_TABS[candidate] === tab)
    if (name === undefined) {
        return
    }
    try {
        localStorage.setItem(LIBRARY_TAB_KEY, name)
    } catch {
        // Nothing is remembered; the library opens on Simple.
    }
}

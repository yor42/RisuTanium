/**
 * What the character rail remembers on this device: the folders that are open and one scroll
 * position. Both live in `localStorage`, outside the database, the save and the dirty
 * tracker, so they never travel in a backup and a different save on the same device keeps
 * only the ids it shares. Nothing here throws: storage that is blocked, full or holding
 * something unexpected reads as "nothing remembered" and a failed write is ignored.
 */

export interface RailScroll {
    /** Layout key of the item that held the top edge. */
    key: string
    /** Distance from the top of that item to the top edge. */
    offset: number
    /** The pixel position at the time, used when the key is no longer in the layout. */
    px: number
}

export const OPEN_FOLDERS_KEY = 'risutanium.rail.openFolders'
export const RAIL_SCROLL_KEY = 'risutanium.rail.scroll'
export const MAX_REMEMBERED_FOLDERS = 1000

function prune(ids: readonly unknown[], validIds: ReadonlySet<string>): string[] {
    const kept = new Set<string>()
    for (const id of ids) {
        if (typeof id === 'string' && validIds.has(id)) {
            kept.add(id)
            if (kept.size >= MAX_REMEMBERED_FOLDERS) {
                break
            }
        }
    }
    return [...kept]
}

/** The remembered open folder ids that are in `validIds`, without duplicates. */
export function loadOpenFolders(validIds: ReadonlySet<string>): string[] {
    try {
        const raw = localStorage.getItem(OPEN_FOLDERS_KEY)
        if (!raw) {
            return []
        }
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? prune(parsed, validIds) : []
    } catch {
        return []
    }
}

/** Remembers the ids in `ids` that are in `validIds`. */
export function saveOpenFolders(ids: readonly string[], validIds: ReadonlySet<string>): void {
    try {
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(prune(ids, validIds)))
    } catch {
        // Nothing is remembered; the rail works without it.
    }
}

function isScroll(value: unknown): value is RailScroll {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const v = value as Record<string, unknown>
    return typeof v.key === 'string'
        && typeof v.offset === 'number' && Number.isFinite(v.offset) && v.offset >= 0
        && typeof v.px === 'number' && Number.isFinite(v.px) && v.px >= 0
}

/** The remembered scroll position, or `null` when there is none or it is not valid. */
export function loadScroll(): RailScroll | null {
    try {
        const raw = localStorage.getItem(RAIL_SCROLL_KEY)
        if (!raw) {
            return null
        }
        const parsed: unknown = JSON.parse(raw)
        return isScroll(parsed) ? { key: parsed.key, offset: parsed.offset, px: parsed.px } : null
    } catch {
        return null
    }
}

export function saveScroll(value: RailScroll): void {
    try {
        localStorage.setItem(RAIL_SCROLL_KEY, JSON.stringify(value))
    } catch {
        // Nothing is remembered; the rail works without it.
    }
}

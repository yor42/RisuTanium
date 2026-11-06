import type { PanelSource, PanelValueRow } from './togglePanel'

/**
 * Favourite toggles (TOGGLES_SPEC §5, CHORE-566): a device-local list of stars, each naming a source and a toggle key.
 * Nothing about it is stored in the profile, on a preset, or in a backup. The source of the prompt is the fixed slot
 * `prompt`, so a star on key K follows whichever preset is active. A source that is not in use right now keeps its
 * stars where they are; they are only hidden.
 *
 * Stored value: `{"v":1,"items":[{"s":<source>,"k":<key>}]}` under `FAVOURITES_KEY`. Absent means no stars. A value this
 * build cannot read (malformed, or a later format) is never overwritten: it is copied once to `UNREADABLE_KEY` before
 * the first write, and when that key is taken the stars stay in memory only and the stored bytes stay untouched.
 */

export const FAVOURITES_KEY = 'risuChatShell.toggleFavourites'
export const UNREADABLE_KEY = 'risuChatShell.toggleFavourites.unreadable'
const FORMAT_VERSION = 1

export type FavouriteRef = { s: string, k: string }

export type FavouriteChange =
    | { type: 'add', ref: FavouriteRef }
    | { type: 'remove', ref: FavouriteRef }
    // Swaps with the nearest neighbour in the direction that `visible` accepts; hidden stars between keep their place.
    | { type: 'move', ref: FavouriteRef, by: -1 | 1, visible: (ref: FavouriteRef) => boolean }

export type ParsedFavourites = { status: 'ok', items: FavouriteRef[] } | { status: 'unreadable' }

/** What the panel shows: the list, and whether the stored bytes could not be read (they are kept as they are). */
export type FavouritesView = { items: FavouriteRef[], unreadable: boolean }

export const sameRef = (a: FavouriteRef, b: FavouriteRef): boolean => a.s === b.s && a.k === b.k

function asRef(value: unknown): FavouriteRef | null {
    if (typeof value !== 'object' || value === null || !('s' in value) || !('k' in value)) return null
    const { s, k } = value
    return typeof s === 'string' && s !== '' && typeof k === 'string' && k !== '' ? { s, k } : null
}

/** Absent is an empty list; anything this build cannot fully read is `unreadable`, never silently trimmed. */
export function parseFavourites(raw: string | null): ParsedFavourites {
    if (raw === null) return { status: 'ok', items: [] }
    let value: unknown
    try {
        value = JSON.parse(raw)
    } catch {
        return { status: 'unreadable' }
    }
    if (typeof value !== 'object' || value === null || !('v' in value) || value.v !== FORMAT_VERSION || !('items' in value) || !Array.isArray(value.items)) {
        return { status: 'unreadable' }
    }
    const items: FavouriteRef[] = []
    for (const entry of value.items) {
        const ref = asRef(entry)
        if (!ref) return { status: 'unreadable' }
        if (!items.some((known) => sameRef(known, ref))) items.push(ref)
    }
    return { status: 'ok', items }
}

export function serializeFavourites(items: readonly FavouriteRef[]): string {
    return JSON.stringify({ v: FORMAT_VERSION, items: items.map((ref) => ({ s: ref.s, k: ref.k })) })
}

/** Pure: the list after one change. An absent star cannot be removed or moved; a present one cannot be added twice. */
export function applyFavouriteChange(items: readonly FavouriteRef[], change: FavouriteChange): FavouriteRef[] {
    const list = items.map((ref) => ({ ...ref }))
    const at = list.findIndex((ref) => sameRef(ref, change.ref))
    if (change.type === 'add') {
        if (at === -1) list.push({ s: change.ref.s, k: change.ref.k })
        return list
    }
    if (at === -1) return list
    if (change.type === 'remove') {
        list.splice(at, 1)
        return list
    }
    let other = at + change.by
    while (other >= 0 && other < list.length && !change.visible(list[other])) other += change.by
    if (other < 0 || other >= list.length) return list
    const held = list[at]
    list[at] = list[other]
    list[other] = held
    return list
}

type StoredRead = { parsed: ParsedFavourites, raw: string | null, readable: boolean }

function readStored(): StoredRead {
    try {
        const raw = localStorage.getItem(FAVOURITES_KEY)
        return { parsed: parseFavourites(raw), raw, readable: true }
    } catch {
        // Device storage is unavailable: the session list is all there is, and a write will fail the same way.
        return { parsed: { status: 'ok', items: [] }, raw: null, readable: false }
    }
}

/** The stored list, read now. */
export function readFavourites(): FavouritesView {
    const stored = readStored()
    return stored.parsed.status === 'ok' ? { items: stored.parsed.items, unreadable: false } : { items: [], unreadable: true }
}

/**
 * One change, applied to what device storage holds at this moment (not to a copy read earlier, so a change made by
 * another tab is kept). `session` is the list the caller already shows; it is the base only while the stored value is
 * unreadable. Returns the list now in force and whether the stored bytes remain unreadable.
 */
export function changeFavourites(change: FavouriteChange, session: readonly FavouriteRef[]): FavouritesView {
    const stored = readStored()
    if (stored.parsed.status === 'ok') {
        const next = applyFavouriteChange(stored.parsed.items, change)
        if (stored.readable) {
            try {
                localStorage.setItem(FAVOURITES_KEY, serializeFavourites(next))
                return { items: next, unreadable: false }
            } catch {
                // Falls through to the session-only result.
            }
        }
        // Storage cannot be read or written, so the stored list is stale: the session list is the base, which keeps
        // every earlier session-only star.
        return { items: applyFavouriteChange(session, change), unreadable: false }
    }
    const next = applyFavouriteChange(session, change)
    try {
        // The unreadable bytes are set aside once; when the side key is taken they stay exactly where they are.
        if (stored.raw !== null && localStorage.getItem(UNREADABLE_KEY) === null) {
            localStorage.setItem(UNREADABLE_KEY, stored.raw)
            localStorage.setItem(FAVOURITES_KEY, serializeFavourites(next))
            return { items: next, unreadable: false }
        }
    } catch {
        // The copy or the write failed; the stored bytes are still the old ones, so they stay unreadable.
    }
    return { items: next, unreadable: true }
}

/** A favourite that is showing now: the row (given a distinct uid), where it sits, and the group it is in. */
export type FavouriteRow = { ref: FavouriteRef, row: PanelValueRow, sourceUid: string, source: PanelSource, group: string | null }

/** The uid a row gets in the favourites section, so the section's copy and the source's own row never share an id. */
export const favouriteUid = (uid: string): string => `fav:${uid}`

function findRow(source: PanelSource, key: string): { row: PanelValueRow, group: string | null } | null {
    for (const item of source.items) {
        if (item.type === 'row' && item.key === key) return { row: item, group: null }
        if (item.type === 'group') {
            for (const child of item.children) {
                if (child.type === 'row' && child.key === key) return { row: child, group: item.label }
            }
        }
    }
    return null
}

/** The stars whose source is in use and still has the key, in star order. The others are left out of the view only. */
export function favouriteRows(sources: readonly PanelSource[], items: readonly FavouriteRef[]): FavouriteRow[] {
    const rows: FavouriteRow[] = []
    for (const ref of items) {
        const source = sources.find((candidate) => candidate.id === ref.s)
        const found = source ? findRow(source, ref.k) : null
        if (source && found) rows.push({ ref, row: { ...found.row, uid: favouriteUid(found.row.uid) }, sourceUid: found.row.uid, source, group: found.group })
    }
    return rows
}

/** Whether a star on `ref` is showing, for the move rule. */
export const isShowing = (sources: readonly PanelSource[], ref: FavouriteRef): boolean => {
    const source = sources.find((candidate) => candidate.id === ref.s)
    return source !== undefined && findRow(source, ref.k) !== null
}

import type { character, folder, groupChat } from '../../ts/storage/database.svelte'
import { folderEntryAt, type ItemRef, type OrderEntry } from '../SideBars/sidebarOrder'
import type { GridEntry, SortMode } from './charListOrder'

/**
 * The pure parts of the Grid's edit mode. Edit mode and its selection are view state that is never
 * saved; nothing here writes anything. A selected tile is remembered as the object it stood for when
 * it was picked (the character object, or the folder entry of the saved order), not as its key: a key
 * names a slot or an occurrence, and the thing at that slot can change under it (an earlier holder of
 * the same id is deleted, a same-id folder is removed). An action acts only on picks whose key still
 * resolves to the same object.
 */

export type Picked =
    | { kind: 'char', char: character | groupChat }
    | { kind: 'folder', folder: folder }

/** Edit mode works on the saved order, which only "My order" shows. */
export function canEdit(sort: SortMode): boolean {
    return sort === 'order'
}

/** The object `entry` stands for now, or null when its slot or folder is gone. */
export function resolvePicked(entry: GridEntry, characters: readonly (character | groupChat)[], order: readonly OrderEntry[] | undefined): Picked | null {
    if (entry.kind === 'folder') {
        const found = folderEntryAt(order ?? [], entry.ref)
        return found ? { kind: 'folder', folder: found } : null
    }
    const char = characters[entry.index]
    return char ? { kind: 'char', char } : null
}

function samePick(a: Picked, b: Picked): boolean {
    if (a.kind === 'char' && b.kind === 'char') {
        return a.char === b.char
    }
    if (a.kind === 'folder' && b.kind === 'folder') {
        return a.folder === b.folder
    }
    return false
}

/** The keys of `selection` whose tile is gone or now stands for another object. */
export function stalePickedKeys(
    selection: ReadonlyMap<string, Picked>,
    entryByKey: ReadonlyMap<string, GridEntry>,
    characters: readonly (character | groupChat)[],
    order: readonly OrderEntry[] | undefined,
): string[] {
    const stale: string[] = []
    for (const [key, picked] of selection) {
        const entry = entryByKey.get(key)
        const now = entry ? resolvePicked(entry, characters, order) : null
        if (!now || !samePick(now, picked)) {
            stale.push(key)
        }
    }
    return stale
}

/** The characters and folders an action may act on: the picks that still resolve, each once. */
export function actingPicks(
    selection: ReadonlyMap<string, Picked>,
    entryByKey: ReadonlyMap<string, GridEntry>,
    characters: readonly (character | groupChat)[],
    order: readonly OrderEntry[] | undefined,
): { characters: (character | groupChat)[], folders: folder[] } {
    const stale = new Set(stalePickedKeys(selection, entryByKey, characters, order))
    const picked = { characters: [] as (character | groupChat)[], folders: [] as folder[] }
    for (const [key, pick] of selection) {
        if (stale.has(key)) {
            continue
        }
        if (pick.kind === 'char') {
            if (!picked.characters.includes(pick.char)) {
                picked.characters.push(pick.char)
            }
        } else if (!picked.folders.includes(pick.folder)) {
            picked.folders.push(pick.folder)
        }
    }
    return picked
}

/**
 * The reference a press on `entry` is handed to the gesture machine with. A tile without an order
 * entry (any sort but "My order", an unlisted character, a second holder of one id) gets a
 * placeholder named after its tile key, which matches no real id; it only lets the press be
 * recognised and is never an order reference.
 */
export function gestureRef(entry: GridEntry): ItemRef {
    if (entry.ref) {
        return entry.ref
    }
    return { kind: 'char', id: entry.key, occurrence: 0 }
}

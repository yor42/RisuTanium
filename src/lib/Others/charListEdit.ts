import type { character, folder, groupChat } from '../../ts/storage/database.svelte'
import { folderEntryAt, type FolderRef, type ItemRef, type OrderEntry } from '../SideBars/sidebarOrder'
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

/** Whether two picks stand for the same object (identity, never equal content). */
export function samePick(a: Picked, b: Picked): boolean {
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
 * Widths, in pixels, the edit row's forms are chosen from. All of them are stable measures that do not
 * depend on the forms shown: the natural width of the count's full text and of its number (invisible
 * copies), the row's own width, the Group button (`groupWidth`; the icon-only trash button has the same
 * width, `iconWidth`), the labelled trash button (an invisible copy) and the gap between row items.
 */
export interface RowMeasure {
    fullWidth: number
    numberWidth: number
    rowWidth: number
    groupWidth: number
    labelWidth: number
    iconWidth: number
    gap: number
}

export interface RowForms {
    /** The count as its full localized text or as its number alone. */
    count: 'full' | 'number'
    /** Move to trash as an icon-only button instead of its labelled button. */
    iconTrash: boolean
}

/**
 * The forms of the edit row, most informative first: the full text beside the labelled trash button;
 * else the number beside the label; else the trash button as an icon, with the count as its full text
 * if that fits beside the icon and as its number otherwise. A row that has not been measured
 * (`rowWidth` 0) shows the full text and the label. The row holds the count, Group and trash, so two gaps.
 */
export function chooseRowForms(m: RowMeasure): RowForms {
    if (m.rowWidth <= 0) {
        return { count: 'full', iconTrash: false }
    }
    const beside = (trashWidth: number) => m.rowWidth - m.groupWidth - trashWidth - 2 * m.gap
    const roomWithLabel = beside(m.labelWidth)
    if (m.fullWidth <= roomWithLabel) {
        return { count: 'full', iconTrash: false }
    }
    if (m.numberWidth <= roomWithLabel) {
        return { count: 'number', iconTrash: false }
    }
    return { count: m.fullWidth <= beside(m.iconWidth) ? 'full' : 'number', iconTrash: true }
}

export type GroupPlan =
    | { ok: true, sources: ItemRef[] }
    | { ok: false, reason: 'empty' | 'unlisted' | 'loneFolder' }

/**
 * What "Group into new folder" would act on, from the live picks. A stale pick is skipped. The
 * reference of each pick is read from the current entries, never from the pick. Group is unavailable
 * when no pick is left, when a pick has no order entry (an unlisted character or a second holder of
 * an id), and when the only thing left is one folder (regrouping it would only rename it and lose its
 * name, colour and picture). A member pick whose own folder tile is also picked adds nothing, since the
 * folder brings all its members, so it does not turn a lone folder into "a folder and a character".
 * Sources keep pick order; the operation sorts them into document order. Nothing is written.
 */
export function groupPlan(
    selection: ReadonlyMap<string, Picked>,
    entryByKey: ReadonlyMap<string, GridEntry>,
    characters: readonly (character | groupChat)[],
    order: readonly OrderEntry[] | undefined,
): GroupPlan {
    const stale = new Set(stalePickedKeys(selection, entryByKey, characters, order))
    const refs: ItemRef[] = []
    for (const key of selection.keys()) {
        if (stale.has(key)) {
            continue
        }
        const ref = entryByKey.get(key)?.ref
        if (!ref) {
            return { ok: false, reason: 'unlisted' }
        }
        refs.push(ref)
    }
    const pickedFolders = refs.filter((ref): ref is FolderRef => ref.kind === 'folder')
    const kept = refs.filter((ref) => ref.kind !== 'member'
        || !pickedFolders.some((folderRef) => folderRef.id === ref.folder.id && folderRef.occurrence === ref.folder.occurrence))
    if (kept.length === 0) {
        return { ok: false, reason: 'empty' }
    }
    if (kept.length === 1 && kept[0].kind === 'folder') {
        return { ok: false, reason: 'loneFolder' }
    }
    return { ok: true, sources: kept }
}

export type MenuPlan =
    | { kind: 'folder', ref: FolderRef, id: string, name: string }
    | { kind: 'bulk' }

/**
 * Which menu a hold, a right-click or the context-menu key on a tile opens, from the live picks. A
 * stale pick is skipped. The folder menu opens only when exactly one live pick is left and it is a
 * folder tile; everything else (a character, several tiles, a folder with any other tile, a folder with
 * one of its own members) is the bulk menu. The folder is named and referenced by its current tile,
 * never by the pick. Nothing is written.
 */
export function menuPlan(
    selection: ReadonlyMap<string, Picked>,
    entryByKey: ReadonlyMap<string, GridEntry>,
    characters: readonly (character | groupChat)[],
    order: readonly OrderEntry[] | undefined,
): MenuPlan {
    const stale = new Set(stalePickedKeys(selection, entryByKey, characters, order))
    const live = [...selection.keys()].filter((key) => !stale.has(key))
    if (live.length === 1) {
        const entry = entryByKey.get(live[0])
        if (entry?.kind === 'folder') {
            return { kind: 'folder', ref: entry.ref, id: entry.id, name: entry.name }
        }
    }
    return { kind: 'bulk' }
}

export type DragPlan =
    | { ok: true, sources: ItemRef[], keys: ReadonlySet<string>, count: number }
    | { ok: false, reason: 'stale' | 'unlisted' }

/**
 * What a drag that began on `pressed` would move, from the live picks. The pressed tile must still
 * stand for the object it stood for at the lift (`samePick` against the live entry): a tile key names
 * a slot or an occurrence, and the stale-pick rule protects only selected tiles. A pressed tile that is
 * selected drags the whole live selection; an unselected one drags only itself and is not added to the
 * selection. A stale pick is skipped, and a member pick whose own folder tile is also moving adds
 * nothing (matched by folder id and occurrence, that is by resolved position, never by id alone), so a
 * folder moves once with its members. Any moved tile without an order entry refuses the whole drag,
 * never a partial move. Sources and keys are in document order; `count` is the number of tiles moving,
 * a folder counting once. Unlike `groupPlan`, a lone folder is a valid drag. Nothing is written.
 */
export function dragPlan(
    selection: ReadonlyMap<string, Picked>,
    entries: readonly GridEntry[],
    entryByKey: ReadonlyMap<string, GridEntry>,
    characters: readonly (character | groupChat)[],
    order: readonly OrderEntry[] | undefined,
    pressed: { key: string, picked: Picked },
): DragPlan {
    const pressedEntry = entryByKey.get(pressed.key)
    const pressedNow = pressedEntry ? resolvePicked(pressedEntry, characters, order) : null
    if (!pressedNow || !samePick(pressedNow, pressed.picked)) {
        return { ok: false, reason: 'stale' }
    }
    const stale = new Set(stalePickedKeys(selection, entryByKey, characters, order))
    const moving = new Set<string>()
    if (selection.has(pressed.key) && !stale.has(pressed.key)) {
        for (const key of selection.keys()) {
            if (!stale.has(key)) {
                moving.add(key)
            }
        }
    } else {
        moving.add(pressed.key)
    }
    const chosen = entries.filter((entry) => moving.has(entry.key))
    if (chosen.some((entry) => !entry.ref)) {
        return { ok: false, reason: 'unlisted' }
    }
    const folders = chosen.flatMap((entry) => entry.ref?.kind === 'folder' ? [entry.ref] : [])
    const kept = chosen.filter((entry) => {
        const owner = entry.ref?.kind === 'member' ? entry.ref.folder : null
        return !owner || !folders.some((folderRef) => folderRef.id === owner.id && folderRef.occurrence === owner.occurrence)
    })
    return {
        ok: true,
        sources: kept.flatMap((entry) => entry.ref ? [entry.ref] : []),
        keys: new Set(kept.map((entry) => entry.key)),
        count: kept.length,
    }
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

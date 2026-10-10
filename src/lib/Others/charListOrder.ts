import { listRows, refKey, type FolderRef, type ItemRef, type OrderEntry } from '../SideBars/sidebarOrder'
import type { CharacterMatch } from '../../ts/gui/characterSearch'

/**
 * The Grid tab's tile list: the live characters in the rail's saved order, with folders. Pure
 * and read only: it never writes the order, never reorders its inputs and never repairs the
 * order (that is `checkCharOrder`'s job, not a list's). The top-level structure comes from
 * `sidebarOrder.listRows`, so null entries, folders without a `data` array, unknown ids and
 * per-id occurrence counting follow the rail.
 *
 * Membership is exactly `live`: a hidden system character, a trashed one, one the query does
 * not match and an id without a character have no tile, even where the rail would still show
 * the entry. Every live character has exactly one tile and every tile key is unique.
 *
 * An order entry is not a character: a chaId can be listed twice, or be held by two slots.
 * Slots are therefore assigned to order occurrences by a queue per chaId (the live holders in
 * `live` order). Each occurrence, in document order with a folder's members after the folder,
 * takes the next holder not yet taken; an occurrence with no holder left has no tile; holders
 * never taken follow the ordered tiles in `live` order. A tile is identified by the slot it
 * took, never by the occurrence. This is deliberately not the rail's resolution, which maps a
 * chaId to one slot.
 */

export type SortMode = 'order' | 'recent' | 'name'

export interface CharTile {
    kind: 'char'
    /** The slot key of the character (`slotKeys`). */
    key: string
    /** The character's position in `db.characters`. */
    index: number
    /** Set on a member of a folder. */
    folderId?: string
    folderName?: string
    /** The order entry this tile took; null for a character the order does not list. */
    ref: ItemRef | null
}

export interface FolderTile {
    kind: 'folder'
    /** The rail's `refKey` of the folder ref. */
    key: string
    id: string
    name: string
    color: string
    imgFile: string
    /** How many live characters the folder holds. */
    count: number
    open: boolean
    ref: FolderRef
}

export type GridEntry = CharTile | FolderTile

export interface GridEntryInput {
    /** The matching live characters, in `db.characters` order. */
    live: readonly CharacterMatch[]
    /** The saved order; `characterOrder` may be missing in data from other tools. */
    order: readonly OrderEntry[] | undefined
    /** Folder ids whose members are shown after their tile. */
    openFolderIds: ReadonlySet<string>
    /** Only 'order' arranges by the saved order with folders; the other modes list the live characters flat. */
    sort: SortMode
    /** A query is active: the result is flat, with each member carrying its folder's name. */
    searching: boolean
}

class HolderQueues {
    private readonly queues = new Map<string, CharacterMatch[]>()
    private readonly next = new Map<string, number>()
    readonly taken = new Set<CharacterMatch>()

    constructor(live: readonly CharacterMatch[]) {
        for (const match of live) {
            const queue = this.queues.get(match.chaId)
            if (queue) {
                queue.push(match)
            } else {
                this.queues.set(match.chaId, [match])
            }
        }
    }

    has(chaId: string): boolean {
        return this.queues.has(chaId)
    }

    take(chaId: string): CharacterMatch | null {
        const queue = this.queues.get(chaId)
        const at = this.next.get(chaId) ?? 0
        if (!queue || at >= queue.length) {
            return null
        }
        this.next.set(chaId, at + 1)
        this.taken.add(queue[at])
        return queue[at]
    }
}

function charTile(match: CharacterMatch, ref: ItemRef | null, folder?: { id: string, name: string }): CharTile {
    const tile: CharTile = { kind: 'char', key: match.key, index: match.index, ref }
    if (folder) {
        tile.folderId = folder.id
        tile.folderName = folder.name
    }
    return tile
}

export function buildGridEntries(input: GridEntryInput): GridEntry[] {
    const { live, openFolderIds, sort, searching } = input
    if (sort !== 'order') {
        return live.map((match) => charTile(match, null))
    }
    const holders = new HolderQueues(live)
    const rows = listRows(input.order ?? [], (id) => holders.has(id))
    const entries: GridEntry[] = []
    for (const row of rows) {
        if (row.kind === 'char') {
            const match = holders.take(row.id)
            if (match) {
                entries.push(charTile(match, row.ref))
            }
            continue
        }
        const name = typeof row.entry.name === 'string' ? row.entry.name : ''
        const members: CharTile[] = []
        for (const member of row.members) {
            const match = holders.take(member.id)
            if (match) {
                members.push(charTile(match, member.ref, { id: row.id, name }))
            }
        }
        if (members.length === 0) {
            continue
        }
        if (searching) {
            entries.push(...members)
            continue
        }
        const open = openFolderIds.has(row.id)
        entries.push({
            kind: 'folder',
            key: refKey(row.ref),
            id: row.id,
            name,
            color: typeof row.entry.color === 'string' ? row.entry.color : '',
            imgFile: typeof row.entry.imgFile === 'string' ? row.entry.imgFile : '',
            count: members.length,
            open,
            ref: row.ref,
        })
        if (open) {
            entries.push(...members)
        }
    }
    for (const match of live) {
        if (!holders.taken.has(match)) {
            entries.push(charTile(match, null))
        }
    }
    return entries
}

/**
 * The colour classes of a folder tile, as the rail's folder avatar draws them. The strings are
 * literal so the stylesheet generator sees every class.
 */
export function folderTileClass(color: string): string {
    switch (color) {
        case 'red':
            return 'bg-red-700/50'
        case 'yellow':
            return 'bg-yellow-700/50'
        case 'green':
            return 'bg-green-700/50'
        case 'blue':
            return 'bg-blue-700/50'
        case 'indigo':
            return 'bg-indigo-700/50'
        case 'purple':
            return 'bg-purple-700/50'
        case 'pink':
            return 'bg-pink-700/50'
        default:
            return 'bg-darkbg/50'
    }
}

// The pure vocabulary of the Studio lorebook list: what a row is, how rows nest, which key a row carries, how the pane
// tells that the open entry moved, and when a menu, sheet or confirm that was opened earlier may still act. No DOM, no
// service, no store: the pane applies what these functions plan.
import { loreIndexOfItemId, loreItemIdOf } from '../ownerModel'

/** The key prefix classic folders use (U+F000 then `folder:`); upstream reads a folder by it. */
export const LORE_FOLDER_PREFIX = '\uf000folder:'

export type LoreHost = 'character' | 'chat' | 'module'
type Row = Record<string, unknown>

export function isLoreRow(v: unknown): v is Row {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isFolderRow(v: unknown): v is Row & { key: string } {
    return isLoreRow(v) && v.mode === 'folder' && typeof v.key === 'string' && v.key !== ''
}

export function isLinkRow(v: unknown): boolean {
    return isLoreRow(v) && v.mode === 'child'
}

/** The non-empty string id of a row; an empty string counts as none. */
export function idOf(v: unknown): string | null {
    return isLoreRow(v) && typeof v.id === 'string' && v.id !== '' ? v.id : null
}

/** The folder key a row names as its container, or null (absent, empty or not a string). */
export function containerOf(rows: readonly unknown[], index: number): string | null {
    const row = rows[index]
    return isLoreRow(row) && typeof row.folder === 'string' && row.folder !== '' ? row.folder : null
}

// ---------------------------------------------------------------- identity of one entry

/** What the UI holds for "this entry": a unique id, else the live element object. */
export interface LoreTracked {
    id: string | null
    object: object | null
}

function holdersOfId(rows: readonly unknown[], id: string): number[] {
    const found: number[] = []
    for (let i = 0; i < rows.length; i++) {
        if (idOf(rows[i]) === id) found.push(i)
    }
    return found
}

/**
 * The id when exactly one row holds the row's id, and the element when it is an object. Null when no row sits at
 * `index`.
 */
export function trackedOf(rows: readonly unknown[], index: number): LoreTracked | null {
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null
    const element = rows[index]
    const id = idOf(element)
    return {
        id: id !== null && holdersOfId(rows, id).length === 1 ? id : null,
        object: typeof element === 'object' && element !== null ? element : null,
    }
}

/**
 * The index now: the one row holding the id, else the element at `hint`, else the element wherever it is. Null when
 * none. The id is trusted only while exactly one row holds it, so two holders fall back to the object.
 */
export function resolveTracked(rows: readonly unknown[], tracked: LoreTracked, hint: number): number | null {
    if (tracked.id !== null) {
        const holders = holdersOfId(rows, tracked.id)
        if (holders.length === 1) return holders[0]
    }
    if (tracked.object === null) return null
    if (rows[hint] === tracked.object) return hint
    const at = rows.indexOf(tracked.object)
    return at >= 0 ? at : null
}

// ---------------------------------------------------------------- structure: containers, keys, subtrees

interface Structure {
    count: number
    // First folder row of each folder key.
    folderAt: Map<string, number>
    // The folder row a row hangs under, or null for a top-level row (including an orphan).
    parent: (number | null)[]
    // The row names a folder that does not exist, or sits on a folder cycle.
    missing: boolean[]
    children: number[][]
    idHolders: Map<string, number>
    folderKeyHolders: Map<string, number>
}

function structureOf(rows: readonly unknown[]): Structure {
    const count = rows.length
    const folderAt = new Map<string, number>()
    const idHolders = new Map<string, number>()
    const folderKeyHolders = new Map<string, number>()
    for (let i = 0; i < count; i++) {
        const row = rows[i]
        const id = idOf(row)
        if (id !== null) idHolders.set(id, (idHolders.get(id) ?? 0) + 1)
        if (isFolderRow(row)) {
            if (!folderAt.has(row.key)) folderAt.set(row.key, i)
            folderKeyHolders.set(row.key, (folderKeyHolders.get(row.key) ?? 0) + 1)
        }
    }
    const parent: (number | null)[] = new Array(count).fill(null)
    const missing: boolean[] = new Array(count).fill(false)
    for (let i = 0; i < count; i++) {
        const key = containerOf(rows, i)
        if (key === null) continue
        const at = folderAt.get(key)
        if (at === undefined) missing[i] = true
        else parent[i] = at
    }
    // Rows on a folder cycle (a folder inside itself included) are cut loose and shown at top level.
    const state: number[] = new Array(count).fill(0)
    for (let start = 0; start < count; start++) {
        if (state[start] !== 0) continue
        const path: number[] = []
        let cur: number | null = start
        while (cur !== null && state[cur] === 0) {
            state[cur] = 1
            path.push(cur)
            cur = parent[cur]
        }
        if (cur !== null && state[cur] === 1) {
            for (let k = path.indexOf(cur); k < path.length; k++) {
                missing[path[k]] = true
                parent[path[k]] = null
            }
        }
        for (const node of path) state[node] = 2
    }
    const children: number[][] = Array.from({ length: count }, () => [])
    for (let i = 0; i < count; i++) {
        const p = parent[i]
        if (p !== null) children[p].push(i)
    }
    return { count, folderAt, parent, missing, children, idHolders, folderKeyHolders }
}

function keyFor(row: unknown, index: number, s: Structure): string {
    if (!isLoreRow(row)) return `@${index}`
    const id = idOf(row)
    if (id !== null && s.idHolders.get(id) === 1) return `id:${id}`
    if (isFolderRow(row) && s.folderKeyHolders.get(row.key) === 1) return `f:${row.key}`
    return `@${index}`
}

/** The key `loreListRows` gives that row. Called at render, reveal and focus time on the live rows; never stored. */
export function rowKeyAt(rows: readonly unknown[], index: number): string {
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return `@${index}`
    return keyFor(rows[index], index, structureOf(rows))
}

/** The folder keys above a row, outermost first. A cycle or a missing folder ends the chain. */
export function ancestorFolderKeys(rows: readonly unknown[], index: number): string[] {
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return []
    const s = structureOf(rows)
    const keys: string[] = []
    let cur = s.parent[index]
    let steps = 0
    while (cur !== null && steps <= s.count) {
        const row = rows[cur]
        if (isFolderRow(row)) keys.push(row.key)
        cur = s.parent[cur]
        steps++
    }
    return keys.reverse()
}

/** Ids held by at least two rows that are not child links. */
export function duplicateIds(rows: readonly unknown[]): Set<string> {
    const seen = new Set<string>()
    const dup = new Set<string>()
    for (const row of rows) {
        if (isLinkRow(row)) continue
        const id = idOf(row)
        if (id === null) continue
        if (seen.has(id)) dup.add(id)
        else seen.add(id)
    }
    return dup
}

/**
 * The row and, for a folder, everything inside it at any depth, ascending (not necessarily contiguous). It follows the
 * classic delete: each folder key is expanded once and every row naming it is taken.
 */
export function subtreeIndexes(rows: readonly unknown[], index: number): number[] {
    if (!Number.isInteger(index) || index < 0 || index >= rows.length || !isLoreRow(rows[index])) return []
    if (!isFolderRow(rows[index])) return [index]
    const taken = new Set<number>([index])
    const expanded = new Set<string>()
    const pending: string[] = []
    const expand = (row: unknown): void => {
        if (!isFolderRow(row) || expanded.has(row.key)) return
        expanded.add(row.key)
        pending.push(row.key)
    }
    expand(rows[index])
    while (pending.length > 0) {
        const key = pending.pop()
        for (let i = 0; i < rows.length; i++) {
            if (taken.has(i) || containerOf(rows, i) !== key) continue
            taken.add(i)
            expand(rows[i])
        }
    }
    return [...taken].sort((a, b) => a - b)
}

/** What a folder delete removes besides the folder itself. */
export function folderDeleteCounts(rows: readonly unknown[], index: number): { entries: number; folders: number } {
    let entries = 0
    let folders = 0
    for (const i of subtreeIndexes(rows, index)) {
        if (i === index) continue
        const row = rows[i]
        if (isLoreRow(row) && row.mode === 'folder') folders++
        else entries++
    }
    return { entries, folders }
}

/** The folders a row may move into: `null` is top level; the row and its descendants are never offered. */
export function moveTargets(rows: readonly unknown[], index: number): (string | null)[] {
    if (!isLoreRow(rows[index])) return []
    const own = new Set<string>()
    for (const i of subtreeIndexes(rows, index)) {
        const row = rows[i]
        if (isFolderRow(row)) own.add(row.key)
    }
    const targets: (string | null)[] = [null]
    const seen = new Set<string>()
    for (const row of rows) {
        if (!isFolderRow(row) || own.has(row.key) || seen.has(row.key)) continue
        seen.add(row.key)
        targets.push(row.key)
    }
    return targets
}

/**
 * The name a row is listed under: a folder's `comment`, an entry's `comment` else its `key`, capped at `cap` code
 * units. Null when the row has no name to show.
 */
export function displayNameOf(v: unknown, cap = 120): string | null {
    if (!isLoreRow(v)) return null
    const comment = typeof v.comment === 'string' ? v.comment : ''
    const key = typeof v.key === 'string' ? v.key : ''
    const name = v.mode === 'folder' ? comment : comment !== '' ? comment : key
    if (name === '') return null
    if (name.length <= cap) return name
    let cut = name.slice(0, cap)
    const last = cut.charCodeAt(cut.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
    return cut
}

// ---------------------------------------------------------------- rows of the list

export interface LoreListRow {
    index: number
    // `id:<id>` (an id one row holds), `f:<folderKey>` (a folder key one folder row holds), else `@<index>`.
    key: string
    kind: 'entry' | 'folder' | 'link' | 'nonEntry'
    depth: number
    name: string | null
    folderMissing: boolean
    duplicateId: boolean
    entryCount: number
    expanded: boolean
}

/**
 * The rows the list shows, in display order: folders nested, the children of a collapsed folder left out.
 * A row that is not an object, and a folder-mode row without a key, is `nonEntry`. A row whose folder does not exist,
 * or that sits on a folder cycle, is shown at top level with `folderMissing`. `expanded` holds raw folder keys.
 */
export function loreListRows(rows: readonly unknown[], expanded: ReadonlySet<string>): LoreListRow[] {
    const s = structureOf(rows)
    const dups = duplicateIds(rows)
    const kindOf = (row: unknown): LoreListRow['kind'] => {
        if (!isLoreRow(row)) return 'nonEntry'
        if (row.mode === 'folder') return isFolderRow(row) ? 'folder' : 'nonEntry'
        return row.mode === 'child' ? 'link' : 'entry'
    }
    // Entries below each row (links count, folders do not), summed over the whole tree in reverse pre-order.
    const counts: number[] = new Array(s.count).fill(0)
    const order: number[] = []
    const stack: number[] = []
    for (let i = s.count - 1; i >= 0; i--) {
        if (s.parent[i] === null) stack.push(i)
    }
    while (stack.length > 0) {
        const i = stack.pop() as number
        order.push(i)
        const kids = s.children[i]
        for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k])
    }
    for (let k = order.length - 1; k >= 0; k--) {
        const i = order[k]
        const kind = kindOf(rows[i])
        counts[i] += kind === 'entry' || kind === 'link' ? 1 : 0
        const p = s.parent[i]
        if (p !== null) counts[p] += counts[i]
    }
    const out: LoreListRow[] = []
    const visit: { index: number; depth: number }[] = []
    for (let i = s.count - 1; i >= 0; i--) {
        if (s.parent[i] === null) visit.push({ index: i, depth: 0 })
    }
    while (visit.length > 0) {
        const { index, depth } = visit.pop() as { index: number; depth: number }
        const row = rows[index]
        const kind = kindOf(row)
        const isOpen = kind === 'folder' && expanded.has((row as Row & { key: string }).key)
        const id = idOf(row)
        out.push({
            index,
            key: keyFor(row, index, s),
            kind,
            depth,
            name: displayNameOf(row),
            folderMissing: s.missing[index],
            duplicateId: kind !== 'link' && id !== null && dups.has(id),
            entryCount: kind === 'folder' ? counts[index] : 0,
            expanded: isOpen,
        })
        if (isOpen) {
            const kids = s.children[index]
            for (let k = kids.length - 1; k >= 0; k--) visit.push({ index: kids[k], depth: depth + 1 })
        }
    }
    return out
}

/**
 * The visible row that takes focus after a removal: the first visible row after the first removed visible row that is
 * not removed itself, else the last visible row before it. Null when nothing is left.
 */
export function focusAfterRemoval(visible: readonly LoreListRow[], removed: ReadonlySet<number>): LoreListRow | null {
    const first = visible.findIndex((row) => removed.has(row.index))
    if (first === -1) return null
    for (let i = first + 1; i < visible.length; i++) {
        if (!removed.has(visible[i].index)) return visible[i]
    }
    for (let i = first - 1; i >= 0; i--) {
        if (!removed.has(visible[i].index)) return visible[i]
    }
    return null
}

// ---------------------------------------------------------------- selection planner

/**
 * The open entry. `tracked` is its only identity; `itemId` mirrors `studioScreen.selectedItemId` for the pane's own
 * follow detection. No row key is held.
 */
export interface LoreOpen {
    itemId: string
    tracked: LoreTracked
    formToken: number
}

export type LoreLandingPlan =
    | { kind: 'none' }
    | { kind: 'retrack'; tracked: LoreTracked }
    | { kind: 'focusRow'; target: LoreTracked; hint: number; expand: readonly string[] }

/**
 * What the pane does with the landing of an own op that stayed on the same entry. `opToken` is the form token of the
 * form that ran the op, or null for a list op. A form op refreshes the tracked identity only while its form is still
 * the open one; a list op writes no selection and asks the list to focus the landed row.
 */
export function planOwnLanding(open: LoreOpen | null, opToken: number | null, landingIndex: number | null, rows: readonly unknown[]): LoreLandingPlan {
    if (landingIndex === null || landingIndex < 0 || landingIndex >= rows.length) return { kind: 'none' }
    const tracked = trackedOf(rows, landingIndex)
    if (tracked === null) return { kind: 'none' }
    if (opToken !== null) {
        return open !== null && open.formToken === opToken ? { kind: 'retrack', tracked } : { kind: 'none' }
    }
    if (open !== null) return { kind: 'none' }
    return { kind: 'focusRow', target: tracked, hint: landingIndex, expand: ancestorFolderKeys(rows, landingIndex) }
}

export type LoreReconcile =
    | { kind: 'none' }
    | { kind: 'follow'; itemId: string }
    | { kind: 'gone' }

/**
 * Where the open entry is now. Nothing while the selection names another item (only opening may act then); gone when
 * it resolves nowhere; a follow when its index changed. The row key is not an input, so a re-key at the same index is
 * `none`.
 */
export function planReconcile(open: LoreOpen, rows: readonly unknown[], ownerId: string, selected: string | null): LoreReconcile {
    if (selected !== open.itemId) return { kind: 'none' }
    const i = loreIndexOfItemId(ownerId, open.itemId)
    const j = resolveTracked(rows, open.tracked, i ?? -1)
    if (j === null) return { kind: 'gone' }
    if (j === i) return { kind: 'none' }
    return { kind: 'follow', itemId: loreItemIdOf(ownerId, j) }
}

// ---------------------------------------------------------------- deferred surfaces

/**
 * The view a write or a deferred surface belongs to: the form of one open item, or one list-mode period. Form and list
 * tokens come from one counter, so no two views share a token.
 */
export type SurfaceToken = { from: 'form'; n: number } | { from: 'list'; n: number }

export function surfaceTokenOpen(open: LoreOpen | null, listToken: number, token: SurfaceToken): boolean {
    return token.from === 'form' ? open !== null && open.formToken === token.n : open === null && listToken === token.n
}

/** What a deferred surface captured when it opened. `target` is null only for the bulk menu. */
export interface LoreSurface {
    token: SurfaceToken
    target: LoreTracked | null
    hint: number
}

/** A surface may still act while its view is open and its target still resolves. */
export function surfaceLive(open: LoreOpen | null, listToken: number, rows: readonly unknown[], s: LoreSurface): boolean {
    return surfaceTokenOpen(open, listToken, s.token) && (s.target === null || resolveTracked(rows, s.target, s.hint) !== null)
}

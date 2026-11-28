// The lorebook list's builders: each user action becomes one `build` handed to `service.objEdit(owner, op.build)`, which
// completes its drafts against the live list. A builder reads the live rows through the reader the service passes and
// finds its target through a `LoreTracked`, so an index that moved since the action began still names the same entry.
// Every inserted row is a plain JSON copy, so keys this app does not know (and `loreCache`) ride along.
import { v4 as uuidv4 } from 'uuid'
import type { loreBook } from '../../storage/database.svelte'
import { isJsonObject, toPlainJson } from '../../storage/store2/codec/normalize'
import { migrateLoreEntryToV2 } from '../../process/loreEntryMigration'
import type { LiveReader } from '../history/historyModel'
import type { ObjBuildResult, OwnerHistoryService, StudioResult } from '../history/ownerHistory.svelte'
import { canonicalJson, type ObjAction, type ObjDraft, type ObjEntry, type ObjFieldValue, type ObjLabel } from '../history/objectListOps'
import type { OwnerKey } from '../history/ownerPhase'
import { readProbabilityLine, writeProbabilityLine } from '../longText/loreDecorators'
import {
    LORE_FOLDER_PREFIX,
    containerOf,
    displayNameOf,
    idOf,
    isFolderRow,
    isLinkRow,
    isLoreRow,
    resolveTracked,
    subtreeIndexes,
    type LoreHost,
    type LoreTracked,
} from './loreListModel'

export interface LoreLanding {
    index: number | null
    deletedId?: string
    newId?: string
}

export interface LoreOp {
    /** Handed to `service.objEdit(owner, op.build)`. */
    build: (id: string, live: LiveReader) => ObjBuildResult
    /** Set by the last build that returned ok; read only after a landed result. */
    landed: () => LoreLanding | null
}

export interface LoreIds {
    newId(): string
    newFolderKey(): string
}

export const defaultLoreIds: LoreIds = { newId: () => uuidv4(), newFolderKey: () => uuidv4() }

export type LoreMove = 'up' | 'down' | 'top' | 'bottom' | 'out' | { to: string | null }

export type LoreSetField = 'comment' | 'key' | 'secondkey' | 'content' | 'insertorder' | 'selective' | 'useRegex' | 'folder'

/** The key that joins typing into one step: bound to the entry's identity and the field. */
export function loreTypingKey(identity: string, labelField: string): string {
    return `lore:${identity}:${labelField}`
}

// ---------------------------------------------------------------- shared helpers

type Row = Record<string, unknown>
interface Plan {
    result: ObjBuildResult
    landing: LoreLanding | null
}

const REFUSED: Plan = { result: { ok: false, reason: 'precondition' }, landing: null }
const UNCHANGED: Plan = { result: { ok: false, reason: 'unchanged' }, landing: null }
const ID_TRIES = 8

export function makeOp(run: (id: string, live: LiveReader) => Plan): LoreOp {
    let landing: LoreLanding | null = null
    return {
        build: (id, live) => {
            const plan = run(id, live)
            landing = plan.result.ok ? plan.landing : null
            return plan.result
        },
        landed: () => landing,
    }
}

export function labelOf(action: ObjAction, name: string | null, extra: { count?: number; field?: string } = {}): ObjLabel {
    return { kind: 'obj', list: 'lore', action, name, ...(extra.count === undefined ? {} : { count: extra.count }), ...(extra.field === undefined ? {} : { field: extra.field }) }
}

export function ready(label: ObjLabel, drafts: ObjDraft[], coalesceKey: string | null, landing: LoreLanding): Plan {
    return { result: { ok: true, label, drafts, coalesceKey }, landing }
}

interface Found {
    rows: readonly unknown[]
    i: number
    row: Row
}

function find(live: LiveReader, t: LoreTracked, hint: number): Found | null {
    const rows = live.objList?.('lore') ?? null
    if (rows === null) return null
    const i = resolveTracked(rows, t, hint)
    if (i === null) return null
    const row = rows[i]
    return isLoreRow(row) ? { rows, i, row } : null
}

export function plainRow(value: unknown): ObjEntry | null {
    const plain = toPlainJson(value)
    return plain !== undefined && isJsonObject(plain) ? plain : null
}

function freshId(rows: readonly unknown[], ids: LoreIds): string | null {
    for (let n = 0; n < ID_TRIES; n++) {
        const id = ids.newId()
        if (id !== '' && !rows.some((row) => idOf(row) === id)) return id
    }
    return null
}

function setField(index: number, field: string, after: ObjFieldValue): ObjDraft {
    return { op: 'objSet', list: 'lore', index, field, after }
}

// ---------------------------------------------------------------- field edits

export function loreFieldEdit(t: LoreTracked, hint: number, field: LoreSetField, after: ObjFieldValue, coalesceKey: string | null): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null) return REFUSED
        if (after.had && typeof after.value === 'number' && !Number.isFinite(after.value)) return UNCHANGED
        const renamesFolder = field === 'comment' && at.row.mode === 'folder'
        const label = renamesFolder
            ? labelOf('folderRename', after.had && typeof after.value === 'string' ? displayNameOf({ mode: 'folder', comment: after.value }) : null)
            : labelOf('edit', displayNameOf(at.row), { field })
        return ready(label, [setField(at.i, field, after)], coalesceKey, { index: at.i })
    })
}

export function loreCaseSensitive(t: LoreTracked, hint: number, on: boolean): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null) return REFUSED
        const container = at.row.extentions
        let base: ObjEntry = {}
        if (container !== undefined) {
            const plain = isLoreRow(container) ? plainRow(container) : null
            if (plain === null) return REFUSED
            base = plain
        }
        const value: ObjEntry = { ...base, risu_case_sensitive: on }
        return ready(labelOf('edit', displayNameOf(at.row), { field: 'extentions' }), [setField(at.i, 'extentions', { had: true, value })], null, { index: at.i })
    })
}

export function loreProbabilitySet(t: LoreTracked, hint: number, value: number | null, coalesceKey: string | null): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null || typeof at.row.content !== 'string') return REFUSED
        const next = writeProbabilityLine(at.row.content, value)
        if (next === at.row.content) return UNCHANGED
        return ready(labelOf('edit', displayNameOf(at.row), { field: 'probability' }), [setField(at.i, 'content', { had: true, value: next })], coalesceKey, { index: at.i })
    })
}

/** The older probability field, clamped like the classic editor: empty, NaN and values below 0 give 0, above 100 give 100. */
export function loreLegacyProbability(t: LoreTracked, hint: number, raw: number | null, coalesceKey: string | null): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null || typeof at.row.activationPercent !== 'number') return REFUSED
        const value = raw === null || Number.isNaN(raw) || raw <= 0 ? 0 : raw > 100 ? 100 : raw
        if (value === at.row.activationPercent) return UNCHANGED
        return ready(labelOf('edit', displayNameOf(at.row), { field: 'activationPercent' }), [setField(at.i, 'activationPercent', { had: true, value })], coalesceKey, { index: at.i })
    })
}

/** D6: moves a truthy older probability value into an `@@probability` line, in one step. */
export function loreMoveLegacyIntoLine(t: LoreTracked, hint: number): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null) return REFUSED
        const percent = at.row.activationPercent
        const content = at.row.content
        if (typeof percent !== 'number' || !percent || typeof content !== 'string' || readProbabilityLine(content).kind !== 'none') return REFUSED
        return ready(
            labelOf('edit', displayNameOf(at.row), { field: 'probability' }),
            [setField(at.i, 'content', { had: true, value: writeProbabilityLine(content, percent) }), setField(at.i, 'activationPercent', { had: true, value: null })],
            null,
            { index: at.i },
        )
    })
}

// ---------------------------------------------------------------- add, duplicate, delete

export function loreAddEntry(container: string | null, ids: LoreIds = defaultLoreIds): LoreOp {
    return makeOp((_id, live) => {
        const rows = live.objList?.('lore') ?? null
        if (rows === null) return REFUSED
        const id = freshId(rows, ids)
        if (id === null) return REFUSED
        let index = rows.length
        if (container !== null) {
            const folderAt = rows.findIndex((row) => isFolderRow(row) && row.key === container)
            if (folderAt === -1) return REFUSED
            index = Math.max(...subtreeIndexes(rows, folderAt)) + 1
        }
        const entry: ObjEntry = {
            key: '',
            comment: '',
            content: '',
            mode: 'normal',
            insertorder: 100,
            alwaysActive: false,
            secondkey: '',
            selective: false,
            bookVersion: 2,
            id,
            ...(container === null ? {} : { folder: container }),
        }
        return ready(labelOf('add', null), [{ op: 'objInsert', list: 'lore', index, entry }], null, { index, newId: id })
    })
}

/** A new folder: its name starts empty (MC-4190) and it carries no id; its key is its identity. */
export function loreAddFolder(ids: LoreIds = defaultLoreIds): LoreOp {
    return makeOp((_id, live) => {
        const rows = live.objList?.('lore') ?? null
        if (rows === null) return REFUSED
        let key = ''
        for (let n = 0; n < ID_TRIES; n++) {
            const candidate = LORE_FOLDER_PREFIX + ids.newFolderKey()
            if (!rows.some((row) => isLoreRow(row) && row.key === candidate)) {
                key = candidate
                break
            }
        }
        if (key === '') return REFUSED
        const entry: ObjEntry = { key, comment: '', content: '', mode: 'folder', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, bookVersion: 2 }
        const index = rows.length
        return ready(labelOf('folderCreate', null), [{ op: 'objInsert', list: 'lore', index, entry }], null, { index })
    })
}

export function loreDuplicate(host: LoreHost, t: LoreTracked, hint: number, ids: LoreIds = defaultLoreIds): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null || at.row.mode === 'folder' || isLinkRow(at.row)) return REFUSED
        const copy = plainRow(at.row)
        const id = freshId(at.rows, ids)
        if (copy === null || id === null) return REFUSED
        copy.id = id
        if (host !== 'chat') {
            // Character and module lists are migrated to version 2 on load, so the copy is written already migrated.
            try {
                migrateLoreEntryToV2(copy as unknown as loreBook)
            } catch {
                return REFUSED
            }
        }
        const index = at.i + 1
        return ready(labelOf('duplicate', displayNameOf(copy)), [{ op: 'objInsert', list: 'lore', index, entry: copy }], null, { index, newId: id })
    })
}

export function loreDelete(t: LoreTracked, hint: number): LoreOp {
    return makeOp((deletedId, live) => {
        const at = find(live, t, hint)
        if (at === null || at.row.mode === 'folder') return REFUSED
        return ready(labelOf('delete', displayNameOf(at.row), { count: 1 }), [{ op: 'objRemove', list: 'lore', index: at.i, deletedId }], null, { index: null, deletedId })
    })
}

/**
 * The undoable removal of a list element that is not an entry (MC-4860): `null`, a scalar or an array. A scalar has no
 * identity, so the element is found by the exact JSON captured when the action began: at `hint`, else the only equal
 * element. An entry, a folder or a keyless folder row is never removed here. Untagged, so nothing joins the deleted list;
 * History undoes it.
 */
export function loreRemoveNonEntry(expected: unknown, hint: number): LoreOp {
    const text = canonicalJson(expected)
    return makeOp((_id, live) => {
        const rows = live.objList?.('lore') ?? null
        if (rows === null || text === null) return REFUSED
        const same = (i: number): boolean => {
            const row = rows[i]
            return !(typeof row === 'object' && row !== null && !Array.isArray(row)) && canonicalJson(row) === text
        }
        let at = same(hint) ? hint : -1
        if (at < 0) {
            const found: number[] = []
            for (let i = 0; i < rows.length; i++) if (same(i)) found.push(i)
            if (found.length !== 1) return REFUSED
            at = found[0]
        }
        return ready(labelOf('delete', null, { count: 1 }), [{ op: 'objRemove', list: 'lore', index: at, nonEntry: true }], null, { index: null })
    })
}

export function loreDeleteFolder(t: LoreTracked, hint: number): LoreOp {
    return makeOp((deletedId, live) => {
        const at = find(live, t, hint)
        if (at === null || !isFolderRow(at.row)) return REFUSED
        const indexes = subtreeIndexes(at.rows, at.i).sort((a, b) => b - a)
        const drafts: ObjDraft[] = indexes.map((index) => ({ op: 'objRemove', list: 'lore', index, deletedId }))
        return ready(labelOf('folderDelete', displayNameOf(at.row), { count: indexes.length - 1 }), drafts, null, { index: null, deletedId })
    })
}

// ---------------------------------------------------------------- move

/**
 * Moves a row, or a folder with its subtree, per spec 2.6. The moved block is removed and inserted again contiguously;
 * when the container changes, `objSet folder` on the row comes first and each inserted copy is taken after it.
 */
export function loreMove(t: LoreTracked, hint: number, move: LoreMove): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null) return REFUSED
        const { rows, i, row } = at
        const block = isFolderRow(row) ? subtreeIndexes(rows, i) : [i]
        const inBlock = new Set(block)
        const container = containerOf(rows, i)
        // The position of an original index in the list without the moved block.
        const rest = (original: number): number => original - block.filter((b) => b < original).length
        const folderRowOf = (key: string): number => rows.findIndex((r) => isFolderRow(r) && r.key === key)
        // The elements of a sibling block that are not part of the moved block, ascending.
        const blockOf = (j: number): number[] => (isFolderRow(rows[j]) ? subtreeIndexes(rows, j) : [j]).filter((b) => !inBlock.has(b))
        const lastOfFolder = (folderAt: number): number => Math.max(...blockOf(folderAt))

        let newFolder: string | null | undefined
        let insertAt: number
        if (move === 'up' || move === 'down' || move === 'top' || move === 'bottom') {
            const members: number[] = []
            for (let j = 0; j < rows.length; j++) {
                if (j !== i && !inBlock.has(j) && containerOf(rows, j) === container) members.push(j)
            }
            const before = members.filter((j) => j < i)
            const after = members.filter((j) => j > i)
            if (move === 'up') {
                if (before.length === 0) return UNCHANGED
                insertAt = rest(Math.min(...blockOf(before[before.length - 1])))
            } else if (move === 'top') {
                if (before.length === 0) return UNCHANGED
                insertAt = rest(Math.min(...blockOf(before[0])))
            } else if (move === 'down') {
                if (after.length === 0) return UNCHANGED
                insertAt = rest(Math.max(...blockOf(after[0]))) + 1
            } else {
                if (after.length === 0) return UNCHANGED
                insertAt = rest(Math.max(...blockOf(after[after.length - 1]))) + 1
            }
        } else if (move === 'out') {
            if (container === null) return UNCHANGED
            const folderAt = folderRowOf(container)
            if (folderAt === -1) {
                // The folder is gone: the row only leaves it, and stays where it is.
                return ready(labelOf('move', displayNameOf(row)), [setField(i, 'folder', { had: false })], null, { index: i })
            }
            if (inBlock.has(folderAt)) return REFUSED
            newFolder = containerOf(rows, folderAt)
            insertAt = rest(lastOfFolder(folderAt)) + 1
        } else if (move.to === null) {
            newFolder = null
            insertAt = rows.length - block.length
        } else {
            const folderAt = folderRowOf(move.to)
            const ownKeys = new Set(block.filter((b) => isFolderRow(rows[b])).map((b) => (rows[b] as Row).key))
            if (folderAt === -1 || inBlock.has(folderAt) || ownKeys.has(move.to)) return REFUSED
            newFolder = move.to
            insertAt = rest(lastOfFolder(folderAt)) + 1
        }

        const changes = newFolder !== undefined && newFolder !== container
        if (!changes) {
            const others: number[] = []
            for (let j = 0; j < rows.length; j++) {
                if (!inBlock.has(j)) others.push(j)
            }
            const after = [...others.slice(0, insertAt), ...block, ...others.slice(insertAt)]
            if (after.every((original, position) => original === position)) return UNCHANGED
        }

        const drafts: ObjDraft[] = []
        if (changes) drafts.push(setField(i, 'folder', newFolder === null || newFolder === undefined ? { had: false } : { had: true, value: newFolder }))
        for (const index of [...block].sort((a, b) => b - a)) drafts.push({ op: 'objRemove', list: 'lore', index })
        for (let k = 0; k < block.length; k++) {
            const entry = plainRow(rows[block[k]])
            if (entry === null) return REFUSED
            if (changes && block[k] === i) {
                if (newFolder === null || newFolder === undefined) delete entry.folder
                else entry.folder = newFolder
            }
            drafts.push({ op: 'objInsert', list: 'lore', index: insertAt + k, entry })
        }
        return ready(labelOf('move', displayNameOf(row)), drafts, null, { index: insertAt + block.indexOf(i) })
    })
}

// ---------------------------------------------------------------- always active

function activeIsWellFormed(row: Row): boolean {
    return row.alwaysActive === undefined || typeof row.alwaysActive === 'boolean'
}

/**
 * Always active on one row. On a folder it also sets the direct children (MC-4191: a child whose stored value is
 * neither a boolean nor absent is skipped). A malformed value on the row itself is drafted, and the service refuses it.
 */
export function loreAlwaysActive(t: LoreTracked, hint: number, on: boolean): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null || isLinkRow(at.row)) return REFUSED
        const drafts: ObjDraft[] = [setField(at.i, 'alwaysActive', { had: true, value: on })]
        const folder = isFolderRow(at.row)
        if (folder) {
            for (let j = 0; j < at.rows.length; j++) {
                const child = at.rows[j]
                if (j === at.i || !isLoreRow(child) || isLinkRow(child) || child.folder !== at.row.key || !activeIsWellFormed(child)) continue
                drafts.push(setField(j, 'alwaysActive', { had: true, value: on }))
            }
        }
        const label = folder ? labelOf('folderActive', displayNameOf(at.row)) : labelOf('edit', displayNameOf(at.row), { field: 'alwaysActive' })
        return ready(label, drafts, null, { index: at.i })
    })
}

/** Every row that is not a child link and has a well-formed stored value that differs from `on`; folders included. */
export function loreBulkActive(on: boolean): LoreOp {
    return makeOp((_id, live) => {
        const rows = live.objList?.('lore') ?? null
        if (rows === null) return REFUSED
        const drafts: ObjDraft[] = []
        rows.forEach((row, index) => {
            if (!isLoreRow(row) || isLinkRow(row) || !activeIsWellFormed(row) || (row.alwaysActive === true) === on) return
            drafts.push(setField(index, 'alwaysActive', { had: true, value: on }))
        })
        if (drafts.length === 0) return UNCHANGED
        return ready(labelOf('bulkActive', null, { count: drafts.length }), drafts, null, { index: null })
    })
}

// ---------------------------------------------------------------- identity

function replaceWithId(at: Found, id: string): Plan | null {
    const entry = plainRow(at.row)
    if (entry === null) return null
    entry.id = id
    return ready(
        labelOf('newId', displayNameOf(at.row)),
        [
            { op: 'objRemove', list: 'lore', index: at.i },
            { op: 'objInsert', list: 'lore', index: at.i, entry },
        ],
        null,
        { index: at.i, newId: id },
    )
}

/** Give this entry a new ID: only for an id that at least two rows that are not child links hold. */
export function loreNewId(t: LoreTracked, hint: number, ids: LoreIds = defaultLoreIds): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null || isLinkRow(at.row)) return REFUSED
        const own = idOf(at.row)
        if (own === null || at.rows.filter((row) => !isLinkRow(row) && idOf(row) === own).length < 2) return REFUSED
        const id = freshId(at.rows, ids)
        return (id === null ? null : replaceWithId(at, id)) ?? REFUSED
    })
}

/** The character step of turning on local activation for an id-less entry. A row that has an id is unchanged. */
export function loreAssignIdForLink(t: LoreTracked, hint: number, ids: LoreIds = defaultLoreIds): LoreOp {
    return makeOp((_id, live) => {
        const at = find(live, t, hint)
        if (at === null || isLinkRow(at.row)) return REFUSED
        if (idOf(at.row) !== null) return UNCHANGED
        const id = freshId(at.rows, ids)
        return (id === null ? null : replaceWithId(at, id)) ?? REFUSED
    })
}

// ---------------------------------------------------------------- local activation (chat links)

/** The chat step of turning local activation on: a classic child link to the character entry with this id. */
export function loreLinkInsert(id: string, name: string | null): LoreOp {
    return makeOp((_id, live) => {
        const rows = live.objList?.('lore') ?? null
        if (rows === null) return REFUSED
        if (rows.some((row) => isLinkRow(row) && idOf(row) === id)) return UNCHANGED
        const entry: ObjEntry = { key: '', comment: '', content: '', mode: 'child', insertorder: 100, alwaysActive: true, secondkey: '', selective: false, id }
        const index = rows.length
        return ready(labelOf('link', name), [{ op: 'objInsert', list: 'lore', index, entry }], null, { index })
    })
}

/** Turns local activation off: removes every link with this id. */
export function loreUnlink(id: string, name: string | null): LoreOp {
    return makeOp((_id, live) => {
        const rows = live.objList?.('lore') ?? null
        if (rows === null) return REFUSED
        const drafts: ObjDraft[] = []
        for (let index = rows.length - 1; index >= 0; index--) {
            if (isLinkRow(rows[index]) && idOf(rows[index]) === id) drafts.push({ op: 'objRemove', list: 'lore', index })
        }
        if (drafts.length === 0) return UNCHANGED
        return ready(labelOf('unlink', name), drafts, null, { index: null })
    })
}

/**
 * `assigned` is the character step's landing when that step landed, else null; the pane rebuilds its tracked identity
 * from it whatever `result` is.
 */
export interface LoreActivateResult {
    result: StudioResult
    assigned: LoreLanding | null
}

/**
 * "Always active in this chat" on: the character step that gives an id-less entry an id, then the chat link. Writes
 * nothing unless the chat owner is editable now. Both steps run in this one synchronous call, so the editable check
 * still holds at the chat step.
 */
export function loreActivateInChat(
    service: Pick<OwnerHistoryService, 'view' | 'objEdit'>,
    characterOwner: OwnerKey,
    chatOwner: OwnerKey,
    readCharacterRows: () => readonly unknown[],
    t: LoreTracked,
    hint: number,
    ids: LoreIds = defaultLoreIds,
): LoreActivateResult {
    if (!service.view(chatOwner).editable) return { result: { ok: false, reason: 'loading' }, assigned: null }
    const rows = readCharacterRows()
    const i = resolveTracked(rows, t, hint)
    if (i === null) return { result: { ok: false, reason: 'precondition' }, assigned: null }
    const name = displayNameOf(rows[i])
    let id = idOf(rows[i])
    let assigned: LoreLanding | null = null
    if (id === null) {
        const step = loreAssignIdForLink(t, hint, ids)
        const result = service.objEdit(characterOwner, step.build)
        if (!result.ok) return { result, assigned: null }
        if (result.unchanged === true) {
            const again = resolveTracked(readCharacterRows(), t, hint)
            id = again === null ? null : idOf(readCharacterRows()[again])
            if (id === null) return { result: { ok: false, reason: 'precondition' }, assigned: null }
        } else {
            assigned = step.landed()
            id = assigned?.newId ?? null
            if (id === null) return { result: { ok: false, reason: 'precondition' }, assigned }
        }
    }
    return { result: service.objEdit(chatOwner, loreLinkInsert(id, name).build), assigned }
}

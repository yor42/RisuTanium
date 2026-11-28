// The regex script list's field builders: each user action becomes one `build` handed to `service.objEdit(owner, op.build)`,
// which completes its drafts against the live list. A builder reads the live list through the reader the service passes
// and addresses the row by index (regex rows have no identity). It refuses unless the list is an array that survives a
// JSON-shaped store and the edited row is a readable one, so a malformed row or list is never written through. Only the
// stage builder changes `type`, so a stage value this app does not know survives every other edit. A builder looks at the
// edited row alone; the one walk over the whole list is the JSON-safe check.
//
// The list operations (add, delete, move, duplicate) address a row by its index and by the exact JSON it had when the action
// began, because a regex row has no identity: the row at the index is used when it still equals that JSON; else the only
// equal row, but only when the list the user saw held no twin of it (with twins the other twin would be acted on silently);
// else the build is refused. The caller takes that snapshot (expected JSON, index, twin count) when the row menu opens, never
// at the click. Every row put into an op is a fresh plain copy.
import { isJsonObject, toPlainJson } from '../../storage/store2/codec/normalize'
import type { LiveReader } from '../history/historyModel'
import type { ObjBuildResult } from '../history/ownerHistory.svelte'
import { canonicalJson, type ObjAction, type ObjDraft, type ObjEntry, type ObjFieldValue, type ObjLabel } from '../history/objectListOps'
import { classifyRegexRow, isJsonSafe } from './regexEntry'

export interface RegexOp {
    /** Handed to `service.objEdit(owner, op.build)`. */
    build: (id: string, live: LiveReader) => ObjBuildResult
    /** The index of the row the last build that returned ok edited; read only after a landed result. */
    landed: () => number | null
    /** The deleted-item id the last ok build was given when it removed a row to the deleted list; else null. */
    landedDeletedId: () => string | null
}

export type RegexMove = 'up' | 'down' | 'top' | 'bottom' | { to: number }

export type RegexTextField = 'comment' | 'in' | 'out'

/** The key that joins typing into one step: bound to the form instance, the row index and the field. */
export function regexTypingKey(formToken: string, index: number, field: string): string {
    return `regex:${formToken}:${index}:${field}`
}

type Row = Record<string, unknown>

const REFUSED: ObjBuildResult = { ok: false, reason: 'precondition' }
const UNCHANGED: ObjBuildResult = { ok: false, reason: 'unchanged' }

interface Found {
    row: Row
}

function find(live: LiveReader, index: number): Found | null {
    const rows = live.objList?.('regex') ?? null
    if (rows === null || !Array.isArray(rows) || !isJsonSafe(rows)) return null
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null
    const row: unknown = rows[index]
    if (classifyRegexRow(row).kind !== 'ok') return null
    return { row: row as Row }
}

function nameOf(row: Row): string | null {
    return typeof row.comment === 'string' && row.comment !== '' ? row.comment : null
}

function labelOf(row: Row, field: string): ObjLabel {
    return { kind: 'obj', list: 'regex', action: 'edit', name: nameOf(row), field }
}

function setField(index: number, field: string, after: ObjFieldValue): ObjDraft {
    return { op: 'objSet', list: 'regex', index, field, after }
}

function makeOp(index: number, run: (live: LiveReader) => ObjBuildResult): RegexOp {
    let landing: number | null = null
    return {
        build: (_id, live) => {
            const result = run(live)
            landing = result.ok ? index : null
            return result
        },
        landed: () => landing,
        landedDeletedId: () => null,
    }
}

// ---------------------------------------------------------------- add, duplicate, delete, move

interface ListPlan {
    result: ObjBuildResult
    index: number | null
    deletedId: string | null
}

function makeListOp(run: (id: string, live: LiveReader) => ListPlan): RegexOp {
    let landing: number | null = null
    let deleted: string | null = null
    return {
        build: (id, live) => {
            const plan = run(id, live)
            landing = plan.result.ok ? plan.index : null
            deleted = plan.result.ok ? plan.deletedId : null
            return plan.result
        },
        landed: () => landing,
        landedDeletedId: () => deleted,
    }
}

const NO_PLAN: ListPlan = { result: REFUSED, index: null, deletedId: null }
const NO_CHANGE: ListPlan = { result: UNCHANGED, index: null, deletedId: null }

function listLabel(action: ObjAction, name: string | null, count?: number): ObjLabel {
    return { kind: 'obj', list: 'regex', action, name, ...(count === undefined ? {} : { count }) }
}

/** The live list, or null unless it is an array that survives a JSON-shaped store (a list that does not is never written through). */
function liveRows(live: LiveReader): readonly unknown[] | null {
    const rows = live.objList?.('regex') ?? null
    return rows !== null && Array.isArray(rows) && isJsonSafe(rows) ? rows : null
}

/** How many rows of the list equal `expected` (taken when the row menu opens and passed as `twins` to the builders). */
export function regexTwinCount(rows: readonly unknown[], expected: unknown): number {
    const text = canonicalJson(expected)
    if (text === null) return 0
    let count = 0
    for (let i = 0; i < rows.length; i++) if (canonicalJson(rows[i]) === text) count++
    return count
}

/**
 * The index the action names: the row at `hint` while it still equals `expectedText`, else the only equal row when the
 * snapshot held no twin (`twins` is 1), else null.
 */
function targetOf(rows: readonly unknown[], expectedText: string, hint: number, twins: number): number | null {
    const same = (i: number): boolean => canonicalJson(rows[i]) === expectedText
    if (Number.isInteger(hint) && hint >= 0 && hint < rows.length && same(hint)) return hint
    if (twins !== 1) return null
    let found = -1
    for (let i = 0; i < rows.length; i++) {
        if (!same(i)) continue
        if (found !== -1) return null
        found = i
    }
    return found === -1 ? null : found
}

function plainEntry(row: unknown): ObjEntry | null {
    const plain = toPlainJson(row)
    return plain !== undefined && isJsonObject(plain) ? plain : null
}

/** What a new script starts as: the classic shape, no `flag` and no `ableFlag` (E4). */
export function newRegexEntry(): ObjEntry {
    return { comment: '', in: '', out: '', type: 'editinput' }
}

/** Appends a new script. An absent list reads as empty. */
export function regexAdd(): RegexOp {
    return makeListOp((_id, live) => {
        const rows = liveRows(live)
        if (rows === null) return NO_PLAN
        const index = rows.length
        return {
            result: { ok: true, label: listLabel('add', null), drafts: [{ op: 'objInsert', list: 'regex', index, entry: newRegexEntry() }], coalesceKey: null },
            index,
            deletedId: null,
        }
    })
}

/** Inserts a deep copy after the row. Only a readable row is copied (D7: Studio does not multiply data it cannot edit). */
export function regexDuplicate(expected: unknown, hint: number, twins = 1): RegexOp {
    const text = canonicalJson(expected)
    return makeListOp((_id, live) => {
        const rows = liveRows(live)
        if (rows === null || text === null) return NO_PLAN
        const at = targetOf(rows, text, hint, twins)
        if (at === null || classifyRegexRow(rows[at]).kind !== 'ok') return NO_PLAN
        const copy = plainEntry(rows[at])
        if (copy === null) return NO_PLAN
        const index = at + 1
        return {
            result: { ok: true, label: listLabel('duplicate', nameOf(copy)), drafts: [{ op: 'objInsert', list: 'regex', index, entry: copy }], coalesceKey: null },
            index,
            deletedId: null,
        }
    })
}

/** Removes the row to the deleted list. A readable row and an unreadable object are removed; any other element is not (it is not an object). */
export function regexDelete(expected: unknown, hint: number, twins = 1): RegexOp {
    const text = canonicalJson(expected)
    return makeListOp((deletedId, live) => {
        const rows = liveRows(live)
        if (rows === null || text === null) return NO_PLAN
        const at = targetOf(rows, text, hint, twins)
        if (at === null) return NO_PLAN
        const row = rows[at]
        if (classifyRegexRow(row).kind === 'inert') return NO_PLAN
        return {
            result: { ok: true, label: listLabel('delete', nameOf(row as Row), 1), drafts: [{ op: 'objRemove', list: 'regex', index: at, deletedId }], coalesceKey: null },
            index: null,
            deletedId,
        }
    })
}

/**
 * Moves the row: one remove (no deleted item, a move consumes and makes none) and one insert, `to` in the coordinates of the
 * list without the row. A move that leaves the order as it is writes nothing.
 */
export function regexMove(expected: unknown, hint: number, move: RegexMove, twins = 1): RegexOp {
    const text = canonicalJson(expected)
    return makeListOp((_id, live) => {
        const rows = liveRows(live)
        if (rows === null || text === null) return NO_PLAN
        const at = targetOf(rows, text, hint, twins)
        if (at === null || classifyRegexRow(rows[at]).kind === 'inert') return NO_PLAN
        const last = rows.length - 1
        let to: number
        if (move === 'up') to = Math.max(at - 1, 0)
        else if (move === 'down') to = Math.min(at + 1, last)
        else if (move === 'top') to = 0
        else if (move === 'bottom') to = last
        else to = move.to
        if (!Number.isInteger(to) || to < 0 || to > last) return NO_PLAN
        if (to === at) return NO_CHANGE
        // A row moved only across rows identical to it leaves the list as it was.
        let across = true
        for (let i = Math.min(at, to); i <= Math.max(at, to) && across; i++) across = canonicalJson(rows[i]) === text
        if (across) return NO_CHANGE
        const entry = plainEntry(rows[at])
        if (entry === null) return NO_PLAN
        return {
            result: {
                ok: true,
                label: listLabel('move', nameOf(entry)),
                drafts: [{ op: 'objRemove', list: 'regex', index: at }, { op: 'objInsert', list: 'regex', index: to, entry }],
                coalesceKey: null,
            },
            index: to,
            deletedId: null,
        }
    })
}

/**
 * Sets `comment`, `in` or `out` to the text. `expectedBefore` refuses the build when the row's live value differs: the
 * name builder is given it so a write built in the same tick as an outside change to that row is refused; a row that
 * shifted earlier is followed by index and renamed in place (K14).
 */
export function regexFieldEdit(index: number, field: RegexTextField, text: string, coalesceKey: string | null, expectedBefore?: string): RegexOp {
    return makeOp(index, (live) => {
        const at = find(live, index)
        if (at === null) return REFUSED
        if (expectedBefore !== undefined && at.row[field] !== expectedBefore) return REFUSED
        return { ok: true, label: labelOf(at.row, field), drafts: [setField(index, field, { had: true, value: text })], coalesceKey }
    })
}

/** Sets `type` to the stage the user picked. */
export function regexStageEdit(index: number, value: string): RegexOp {
    return makeOp(index, (live) => {
        const at = find(live, index)
        if (at === null) return REFUSED
        return { ok: true, label: labelOf(at.row, 'type'), drafts: [setField(index, 'type', { had: true, value })], coalesceKey: null }
    })
}

/**
 * The custom-flags switch. On sets `ableFlag` and, only when `flag` is absent or empty, gives it the default `g`; off sets
 * `ableFlag` false and keeps `flag`. One step either way.
 */
export function regexCustomFlag(index: number, on: boolean): RegexOp {
    return makeOp(index, (live) => {
        const at = find(live, index)
        if (at === null) return REFUSED
        const drafts: ObjDraft[] = [setField(index, 'ableFlag', { had: true, value: on })]
        if (on && (at.row.flag === undefined || at.row.flag === '')) drafts.push(setField(index, 'flag', { had: true, value: 'g' }))
        return { ok: true, label: labelOf(at.row, 'ableFlag'), drafts, coalesceKey: null }
    })
}

/**
 * Rewrites `flag` as a whole text. An absent `flag` reads as `''`; a result equal to what is stored is `unchanged`, so an
 * absent `flag` is never turned into an empty one, and a `flag` cleared to `''` is written as a present empty text.
 */
export function regexFlagEdit(index: number, transform: (flag: string) => string, coalesceKey: string | null): RegexOp {
    return makeOp(index, (live) => {
        const at = find(live, index)
        if (at === null) return REFUSED
        const before = typeof at.row.flag === 'string' ? at.row.flag : ''
        const after = transform(before)
        if (after === before) return UNCHANGED
        return { ok: true, label: labelOf(at.row, 'flag'), drafts: [setField(index, 'flag', { had: true, value: after })], coalesceKey }
    })
}

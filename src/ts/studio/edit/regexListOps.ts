// The regex script list's field builders: each user action becomes one `build` handed to `service.objEdit(owner, op.build)`,
// which completes its drafts against the live list. A builder reads the live list through the reader the service passes
// and addresses the row by index (regex rows have no identity). It refuses unless the list is an array that survives a
// JSON-shaped store and the edited row is a readable one, so a malformed row or list is never written through. Only the
// stage builder changes `type`, so a stage value this app does not know survives every other edit. A builder looks at the
// edited row alone; the one walk over the whole list is the JSON-safe check.
import type { LiveReader } from '../history/historyModel'
import type { ObjBuildResult } from '../history/ownerHistory.svelte'
import type { ObjDraft, ObjFieldValue, ObjLabel } from '../history/objectListOps'
import { classifyRegexRow, isJsonSafe } from './regexEntry'

export interface RegexOp {
    /** Handed to `service.objEdit(owner, op.build)`. */
    build: (id: string, live: LiveReader) => ObjBuildResult
    /** The index of the row the last build that returned ok edited; read only after a landed result. */
    landed: () => number | null
}

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
    }
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

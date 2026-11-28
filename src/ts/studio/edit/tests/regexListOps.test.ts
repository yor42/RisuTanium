// The list builders alone, over a fake live reader: what they decide before the service sees it (M10 copy rule, M44 refusals,
// the twin-aware pick rule). The service tests cover what completion and the writers add on top.
import { describe, expect, test } from 'vitest'
import type { LiveReader } from '../../history/historyModel'
import type { ObjBuildResult } from '../../history/ownerHistory.svelte'
import { newRegexEntry, regexAdd, regexDelete, regexDuplicate, regexImport, regexMove, regexTwinCount, type RegexOp } from '../regexListOps'

type Row = Record<string, unknown>

const named = (n: number): Row => ({ comment: `S${n}`, in: `in ${n}`, out: `out ${n}`, type: 'editinput' })
const reader = (rows: unknown): LiveReader => ({
    field: () => ({ had: false }),
    greetings: () => null,
    fmIndex: () => null,
    objList: (list) => (list === 'regex' ? (rows as unknown[]) : null),
    prop: () => ({ had: false }),
})
const build = (op: RegexOp, rows: unknown): ObjBuildResult => op.build('d1', reader(rows))
const REFUSED = { ok: false, reason: 'precondition' }

describe('the copy rule (M10)', () => {
    test('a duplicate records a fresh plain deep copy, never the live row', () => {
        const live = named(1)
        const result = build(regexDuplicate(live, 0), [live])
        expect(result.ok).toBe(true)
        if (result.ok !== true) return
        const draft = result.drafts[0]
        expect(draft).toMatchObject({ op: 'objInsert', index: 1 })
        if (draft.op !== 'objInsert') return
        expect(draft.entry).not.toBe(live)
        expect(draft.entry).toEqual(live)
    })

    test('a move records a copy of the row it moves', () => {
        const rows = [named(0), named(1)]
        const result = build(regexMove(rows[0], 0, 'down'), rows)
        expect(result.ok).toBe(true)
        if (result.ok !== true) return
        const insert = result.drafts[1]
        if (insert.op !== 'objInsert') throw new Error('no insert')
        expect(insert.entry).not.toBe(rows[0])
        expect(insert.entry).toEqual(rows[0])
    })

    test('an add is exactly the classic entry', () => {
        const result = build(regexAdd(), [])
        expect(result).toMatchObject({ ok: true, coalesceKey: null })
        if (result.ok !== true) return
        expect(result.drafts).toEqual([{ op: 'objInsert', list: 'regex', index: 0, entry: newRegexEntry() }])
    })
})

describe('the import builder', () => {
    test('one insert per entry, appended after the live rows in file order, under one import label with the count', () => {
        const live = [named(0), named(1)]
        const file = [named(7), named(8), named(9)]
        const result = build(regexImport(file), live)
        expect(result).toMatchObject({ ok: true, coalesceKey: null, label: { kind: 'obj', list: 'regex', action: 'import', name: null, count: 3 } })
        if (result.ok !== true) return
        expect(result.drafts).toEqual([
            { op: 'objInsert', list: 'regex', index: 2, entry: file[0] },
            { op: 'objInsert', list: 'regex', index: 3, entry: file[1] },
            { op: 'objInsert', list: 'regex', index: 4, entry: file[2] },
        ])
    })

    test('an absent list reads as empty and the first entry lands at 0', () => {
        const result = build(regexImport([named(1)]), [])
        expect(result).toMatchObject({ ok: true, drafts: [{ op: 'objInsert', index: 0 }] })
    })

    test('the entries are fresh plain copies that keep unknown keys and an own __proto__', () => {
        const entry = JSON.parse('{"comment":"a","in":"","out":"","type":"edit_future","x_future":[1],"__proto__":{"k":1}}') as Row
        const result = build(regexImport([entry]), [])
        if (result.ok !== true) throw new Error('refused')
        const draft = result.drafts[0]
        if (draft.op !== 'objInsert') throw new Error('no insert')
        expect(draft.entry).not.toBe(entry)
        expect(Object.hasOwn(draft.entry, '__proto__')).toBe(true)
        expect(draft.entry).toEqual(entry)
    })

    test('twins inside one file are two inserts at consecutive indices', () => {
        const result = build(regexImport([named(5), named(5)]), [named(5)])
        if (result.ok !== true) throw new Error('refused')
        expect(result.drafts.map((d) => (d.op === 'objInsert' ? d.index : -1))).toEqual([1, 2])
    })

    test('a list that is not an array or not JSON-safe is refused, and so is an empty file', () => {
        expect(build(regexImport([named(1)]), 'text')).toEqual(REFUSED)
        expect(build(regexImport([named(1)]), [{ ...named(0), x: Number.NaN }])).toEqual(REFUSED)
        expect(build(regexImport([]), [])).toEqual(REFUSED)
    })
})

describe('refusals (M44)', () => {
    const inert = [named(0), null, 'text', 5, ['x']]

    test.each([1, 2, 3, 4])('an inert element %i is refused by move and duplicate', (index) => {
        const row = inert[index]
        expect(build(regexMove(row, index, 'top'), inert)).toEqual(REFUSED)
        expect(build(regexDuplicate(row, index), inert)).toEqual(REFUSED)
    })

    test.each([1, 2, 3, 4])('an inert element %i is removed by delete as one nonEntry step with no deleted item', (index) => {
        const op = regexDelete(inert[index], index)
        expect(build(op, inert)).toEqual({
            ok: true,
            label: { kind: 'obj', list: 'regex', action: 'delete', name: null, count: 1 },
            drafts: [{ op: 'objRemove', list: 'regex', index, nonEntry: true }],
            coalesceKey: null,
        })
        expect(op.landedDeletedId()).toBeNull()
    })

    test('identical inert rows follow the twin rule: the hint row, the only equal row, else refused', () => {
        const rows = ['text', named(0), 'text']
        expect(build(regexDelete('text', 2, 2), rows)).toMatchObject({ ok: true, drafts: [{ op: 'objRemove', index: 2, nonEntry: true }] })
        expect(build(regexDelete('text', 1, 2), rows)).toEqual(REFUSED)
        expect(build(regexDelete('text', 0, 1), [named(0), 'text'])).toMatchObject({ ok: true, drafts: [{ op: 'objRemove', index: 1, nonEntry: true }] })
    })

    test('an unreadable object may be deleted and moved but not duplicated', () => {
        const rows = [named(0), { comment: 'x', in: 7, out: '', type: 'editinput' }]
        expect(build(regexDelete(rows[1], 1), rows).ok).toBe(true)
        expect(build(regexMove(rows[1], 1, 'top'), rows).ok).toBe(true)
        expect(build(regexDuplicate(rows[1], 1), rows)).toEqual(REFUSED)
    })

    test('a list that is not an array or not JSON-safe is refused by every builder, add included', () => {
        const nan = [{ ...named(0), x: Number.NaN }]
        for (const rows of [nan, 'text', { a: 1 }]) {
            expect(build(regexAdd(), rows)).toEqual(REFUSED)
            expect(build(regexDelete(named(0), 0), rows)).toEqual(REFUSED)
            expect(build(regexMove(named(0), 0, 'down'), rows)).toEqual(REFUSED)
            expect(build(regexDuplicate(named(0), 0), rows)).toEqual(REFUSED)
        }
    })
})

describe('the twin-aware pick rule', () => {
    test('with twins a changed hint row is refused instead of acting on the other twin', () => {
        const rows = [named(0), { ...named(0), in: 'changed' }]
        expect(regexTwinCount([named(0), named(0)], named(0))).toBe(2)
        expect(build(regexDelete(named(0), 1, 2), rows)).toEqual(REFUSED)
        expect(build(regexDuplicate(named(0), 1, 2), rows)).toEqual(REFUSED)
        for (const move of ['up', 'down', 'top', 'bottom', { to: 0 }] as const) {
            expect(build(regexMove(named(0), 1, move, 2), rows)).toEqual(REFUSED)
        }
    })

    test('without twins the only equal row is followed', () => {
        const rows = [named(9), named(0)]
        expect(build(regexDelete(named(0), 0, 1), rows).ok).toBe(true)
    })

    test('with twins and the hint still equal the hint row is used', () => {
        const rows = [named(0), named(1), named(0)]
        const result = build(regexDelete(named(0), 2, 2), rows)
        expect(result).toMatchObject({ ok: true, drafts: [{ op: 'objRemove', index: 2 }] })
    })

    test('moving a row across a run of identical rows is unchanged', () => {
        expect(build(regexMove(named(0), 0, 'bottom', 3), [named(0), named(0), named(0)])).toEqual({ ok: false, reason: 'unchanged' })
        expect(build(regexMove(named(0), 0, { to: 2 }, 3), [named(0), named(0), named(0), named(1)])).toEqual({ ok: false, reason: 'unchanged' })
        expect(build(regexMove(named(0), 0, 'bottom', 2), [named(0), named(0), named(1)]).ok).toBe(true)
    })

    test('moving a row past its identical neighbour is unchanged', () => {
        expect(build(regexMove(named(0), 0, 'down', 2), [named(0), named(0), named(1)])).toEqual({ ok: false, reason: 'unchanged' })
        expect(build(regexMove(named(0), 1, 'up', 2), [named(0), named(0), named(1)])).toEqual({ ok: false, reason: 'unchanged' })
    })
})

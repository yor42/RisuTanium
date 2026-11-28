// The list builders alone, over a fake live reader: what they decide before the service sees it (M10 copy rule, M44 refusals,
// the twin-aware pick rule). The service tests cover what completion and the writers add on top.
import { describe, expect, test } from 'vitest'
import type { LiveReader } from '../../history/historyModel'
import type { ObjBuildResult } from '../../history/ownerHistory.svelte'
import { newRegexEntry, regexAdd, regexDelete, regexDuplicate, regexMove, regexTwinCount, type RegexOp } from '../regexListOps'

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

describe('refusals (M44)', () => {
    const inert = [named(0), null, 'text', 5, ['x']]

    test.each([1, 2, 3, 4])('an inert element %i is refused by delete, move and duplicate', (index) => {
        const row = inert[index]
        expect(build(regexDelete(row, index), inert)).toEqual(REFUSED)
        expect(build(regexMove(row, index, 'top'), inert)).toEqual(REFUSED)
        expect(build(regexDuplicate(row, index), inert)).toEqual(REFUSED)
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

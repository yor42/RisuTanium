// The widened op entry of the object-list family (#720, MC-4860..4862): `objInsert` and `objRemove` name an element that
// is not an object (`null`, a string, a number, a boolean, an array) by the same op shape, with empty counts and no
// tag. Every list shares the shape. The rules of an object entry are pinned elsewhere and stay as they were.
import { describe, expect, test } from 'vitest'
import type { LiveReader } from '../historyModel'
import { loreRemoveNonEntry } from '../../edit/loreListOps'
import { completeObjOps, invertObjOp, listingEffectOf, parseObjOp, planObjStep, type ObjFamilyOp } from '../objectListOps'

const ELEMENTS: unknown[] = [null, 'x', 5, true, [1, { b: 2, a: 1 }]]
const ENTRY = { comment: 'A', content: 'a', key: '', secondkey: '', insertorder: 1, alwaysActive: false, selective: false, mode: 'normal' }

function reader(lists: Partial<Record<'lore' | 'regex' | 'members', unknown[]>>): LiveReader {
    return { objList: (name: 'lore' | 'regex' | 'members') => lists[name] ?? null } as unknown as LiveReader
}

function remove(list: 'lore' | 'regex', index: number, entry: unknown): ObjFamilyOp {
    return { op: 'objRemove', list, index, entry, counts: {} } as ObjFamilyOp
}

describe('the stored form', () => {
    test.each(ELEMENTS)('a remove and an insert of %j parse with empty counts and read back equal', (element) => {
        for (const op of ['objRemove', 'objInsert']) {
            const stored = JSON.parse(JSON.stringify({ op, list: 'lore', index: 1, entry: element, counts: {} }))
            const parsed = parseObjOp(stored)
            expect(parsed).toEqual({ op, list: 'lore', index: 1, entry: element, counts: {} })
            expect(invertObjOp(parsed as ObjFamilyOp)).toMatchObject({ op: op === 'objRemove' ? 'objInsert' : 'objRemove', entry: element })
        }
    })

    test('null stays null: it is neither refused nor read as absent', () => {
        const parsed = parseObjOp({ op: 'objRemove', list: 'regex', index: 0, entry: null, counts: {} })
        expect(parsed).not.toBeNull()
        expect(parsed && 'entry' in parsed && parsed.entry).toBeNull()
        expect(parseObjOp({ op: 'objRemove', list: 'regex', index: 0, counts: {} })).toBeNull()
    })

    test.each(ELEMENTS)('%j is refused with counts, with a deletedId, with an unknown key and as a deleted-item run', (element) => {
        const base = { op: 'objRemove', list: 'lore', index: 0, entry: element, counts: {} }
        expect(parseObjOp(base)).not.toBeNull()
        expect(parseObjOp({ ...base, counts: { content: 1 } })).toBeNull()
        expect(parseObjOp({ ...base, deletedId: 'D' })).toBeNull()
        expect(parseObjOp({ ...base, extra: 1 })).toBeNull()
        expect(listingEffectOf([{ ...(base as object), deletedId: 'D', counts: {} } as unknown as ObjFamilyOp], new Set())).toBeNull()
    })

    test('an object entry keeps its rules: counts must match its identities and a tag is allowed', () => {
        const base = { op: 'objRemove', list: 'lore', index: 0, entry: ENTRY, deletedId: 'D' }
        expect(parseObjOp({ ...base, counts: { content: 1 } })).not.toBeNull()
        expect(parseObjOp({ ...base, counts: {} })).toBeNull()
    })

    test('a value with no JSON form is refused', () => {
        expect(parseObjOp({ op: 'objRemove', list: 'lore', index: 0, entry: undefined, counts: {} })).toBeNull()
        expect(parseObjOp({ op: 'objRemove', list: 'lore', index: 0, entry: 10n, counts: {} })).toBeNull()
    })
})

describe('the planner', () => {
    test.each(ELEMENTS)('remove and insert of %j act in place, and the inverse restores the list', (element) => {
        const rows: unknown[] = [ENTRY, structuredClone(element), { ...ENTRY, comment: 'B' }]
        const op = remove('lore', 1, element)
        const plan = planObjStep([op], reader({ lore: rows }), new Set())
        expect(plan).toMatchObject({ ok: true, writes: [{ op: 'objRemove', list: 'lore', index: 1 }] })
        const after = [rows[0], rows[2]]
        const back = planObjStep([invertObjOp(op)], reader({ lore: after }), new Set())
        expect(back).toMatchObject({ ok: true, writes: [{ op: 'objInsert', list: 'lore', index: 1, entry: element }] })
    })

    test('a remove needs the same element at the index: another value, an object or a missing row fail as changed', () => {
        const op = remove('lore', 1, 'x')
        for (const rows of [[ENTRY, 'y'], [ENTRY, null], [ENTRY, ENTRY], [ENTRY, ['x']], [ENTRY], [ENTRY, { 0: 'x' }]]) {
            expect(planObjStep([op], reader({ lore: rows }), new Set())).toMatchObject({ ok: false, failure: { kind: 'changed' } })
        }
        expect(planObjStep([remove('lore', 1, ['x', { b: 1, a: 2 }])], reader({ lore: [ENTRY, ['x', { a: 2, b: 1 }]] }), new Set())).toMatchObject({ ok: true })
    })

    test('an object entry never removes a non-object row, and a non-object entry never removes an object row', () => {
        const objectOp = { op: 'objRemove', list: 'lore', index: 1, entry: ENTRY, counts: { content: 1 } } as ObjFamilyOp
        expect(planObjStep([objectOp], reader({ lore: [ENTRY, null] }), new Set())).toMatchObject({ ok: false, failure: { kind: 'changed' } })
        expect(planObjStep([remove('lore', 1, null)], reader({ lore: [ENTRY, ENTRY] }), new Set())).toMatchObject({ ok: false, failure: { kind: 'changed' } })
    })

    test('the same shape serves the regex list', () => {
        const rows: unknown[] = ['stray', { comment: 'c', in: '', out: '', type: 'editinput' }]
        expect(planObjStep([remove('regex', 0, 'stray')], reader({ regex: rows }), new Set())).toMatchObject({ ok: true, writes: [{ op: 'objRemove', list: 'regex', index: 0 }] })
        expect(planObjStep([invertObjOp(remove('regex', 0, 'stray'))], reader({ regex: [rows[1]] }), new Set())).toMatchObject({ ok: true })
    })

    test('the already witness (tags off) never accepts a non-object insert; an object insert still can', () => {
        const insert = invertObjOp(remove('lore', 1, null))
        // The null moved to 0 elsewhere: an insert at 1 would fit any list long enough and prove nothing.
        expect(planObjStep([insert], reader({ lore: [null, ENTRY, ENTRY] }), new Set(), false)).toMatchObject({ ok: false, failure: { kind: 'changed' } })
        expect(planObjStep([insert], reader({ lore: [null, ENTRY, ENTRY] }), new Set(), true)).toMatchObject({ ok: true })
        const objectInsert = { op: 'objInsert', list: 'lore', index: 0, entry: ENTRY, counts: { content: 1 } } as ObjFamilyOp
        expect(planObjStep([objectInsert], reader({ lore: [] }), new Set(), false)).toMatchObject({ ok: true })
    })

    test('a tagged member that is not an object fails as changed instead of entering a deleted item', () => {
        const tagged = { ...(remove('lore', 0, 'x') as object), deletedId: 'D' } as unknown as ObjFamilyOp
        expect(planObjStep([tagged], reader({ lore: ['x'] }), new Set())).toMatchObject({ ok: false, failure: { kind: 'changed' } })
    })
})

describe('completion', () => {
    test.each(ELEMENTS)('a nonEntry draft removes %j with empty counts and no tag', (element) => {
        const done = completeObjOps([{ op: 'objRemove', list: 'lore', index: 1, nonEntry: true }], reader({ lore: [ENTRY, element] }))
        expect(done).toEqual({ ok: true, ops: [{ op: 'objRemove', list: 'lore', index: 1, entry: element, counts: {} }] })
    })

    test('a nonEntry draft refuses an object row, a tag and a missing row; a plain draft refuses a non-object row', () => {
        const live = reader({ lore: [ENTRY, null] })
        expect(completeObjOps([{ op: 'objRemove', list: 'lore', index: 0, nonEntry: true }], live)).toEqual({ ok: false, reason: 'precondition' })
        expect(completeObjOps([{ op: 'objRemove', list: 'lore', index: 1, nonEntry: true, deletedId: 'D' }], live)).toEqual({ ok: false, reason: 'precondition' })
        expect(completeObjOps([{ op: 'objRemove', list: 'lore', index: 5, nonEntry: true }], live)).toEqual({ ok: false, reason: 'precondition' })
        expect(completeObjOps([{ op: 'objRemove', list: 'lore', index: 1 }], live)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a plain draft on an object row is unchanged: counts and anchor as before', () => {
        const done = completeObjOps([{ op: 'objRemove', list: 'lore', index: 0, deletedId: 'D' }], reader({ lore: [ENTRY] }))
        expect(done).toMatchObject({ ok: true, ops: [{ op: 'objRemove', entry: ENTRY, counts: { content: 1 }, deletedId: 'D' }] })
    })
})

describe('the lore remove builder', () => {
    const build = (expected: unknown, hint: number, rows: unknown[]) => loreRemoveNonEntry(expected, hint).build('D', reader({ lore: rows }))

    test('it takes the element at the hint, else the only equal element, else refuses', () => {
        const rows = [ENTRY, null, 'x', null]
        expect(build(null, 3, rows)).toMatchObject({ ok: true, drafts: [{ op: 'objRemove', list: 'lore', index: 3, nonEntry: true }] })
        expect(build(null, 2, rows)).toEqual({ ok: false, reason: 'precondition' })
        expect(build('x', 0, rows)).toMatchObject({ ok: true, drafts: [{ index: 2 }] })
        expect(build('gone', 1, rows)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('it never takes an object row, tags nothing, and labels the step as a delete without a name', () => {
        expect(build(ENTRY, 0, [ENTRY])).toEqual({ ok: false, reason: 'precondition' })
        const result = build('x', 0, ['x'])
        expect(result).toMatchObject({ ok: true, label: { kind: 'obj', list: 'lore', action: 'delete', name: null, count: 1 } })
        expect(JSON.stringify(result)).not.toContain('deletedId')
    })
})

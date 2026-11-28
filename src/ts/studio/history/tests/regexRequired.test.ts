// The `required` rule of the object-list tables: a required field never takes `{ had: false }`, whether the value is
// checked on its own (`fieldValueFits`) or arrives in a stored `objSet` (the strict parse), while an optional field and
// a list without a `required` row keep accepting it.
import { describe, expect, test } from 'vitest'
import { fieldValueFits, parseObjOp, type ObjFieldValue } from '../objectListOps'
import { OBJ_LIST_FIELDS } from '../objectLists'

const ABSENT: ObjFieldValue = { had: false }

function storedSet(list: string, field: string, after: unknown): unknown {
    const value = field === 'ableFlag' ? true : 'x'
    return { op: 'objSet', list, index: 0, field, before: { had: true, value }, after, anchorBefore: 1, anchorAfter: 2 }
}

describe('fieldValueFits and the required rule', () => {
    test('regex: every required field refuses an absent value and the optional fields accept it', () => {
        for (const field of ['comment', 'in', 'out', 'type']) {
            expect(fieldValueFits('regex', field, ABSENT)).toBe(false)
        }
        expect(fieldValueFits('regex', 'flag', ABSENT)).toBe(true)
        expect(fieldValueFits('regex', 'ableFlag', ABSENT)).toBe(true)
    })

    test('regex: a present value still has to fit the kind, and an unknown field never fits', () => {
        expect(fieldValueFits('regex', 'out', { had: true, value: 'text' })).toBe(true)
        expect(fieldValueFits('regex', 'out', { had: true, value: 5 })).toBe(false)
        expect(fieldValueFits('regex', 'ableFlag', { had: true, value: 'yes' })).toBe(false)
        expect(fieldValueFits('regex', 'x_future', ABSENT)).toBe(false)
        expect(fieldValueFits('regex', 'x_future', { had: true, value: 'v' })).toBe(false)
    })

    test('lore and members accept an absent value on every table field, as before', () => {
        for (const field of Object.keys(OBJ_LIST_FIELDS.lore.fields)) {
            expect(fieldValueFits('lore', field, ABSENT)).toBe(true)
        }
        for (const field of Object.keys(OBJ_LIST_FIELDS.members.fields)) {
            expect(fieldValueFits('members', field, ABSENT)).toBe(true)
        }
    })
})

describe('the strict parse of a stored objSet', () => {
    test('an absent after or before on a required regex field is refused', () => {
        expect(parseObjOp(storedSet('regex', 'out', ABSENT))).toBeNull()
        expect(parseObjOp({ ...(storedSet('regex', 'in', { had: true, value: 'y' }) as object), before: ABSENT })).toBeNull()
    })

    test('a present value on a required field, and an absent value on an optional one, are accepted', () => {
        expect(parseObjOp(storedSet('regex', 'out', { had: true, value: 'y' }))).not.toBeNull()
        expect(parseObjOp(storedSet('regex', 'flag', ABSENT))).not.toBeNull()
        expect(parseObjOp(storedSet('regex', 'ableFlag', ABSENT))).not.toBeNull()
    })

    test('a lore objSet with an absent after is still accepted', () => {
        expect(parseObjOp(storedSet('lore', 'comment', ABSENT))).not.toBeNull()
    })
})

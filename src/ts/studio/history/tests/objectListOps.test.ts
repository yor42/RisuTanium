// The pure object-list helpers: canonical JSON, anchors, identities, field values, tag runs and inversion. Rows come
// from the classic producers' golden (`loreClassic.golden.json`, written by `loreClassic.fixtures.test.ts`).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
    canonicalJson,
    entryAnchor,
    fieldValueFits,
    holdersOf,
    identitiesOf,
    identityKindsOf,
    invertObjOp,
    isFieldSettable,
    isObjFamilyOp,
    journalListOf,
    objValueEquals,
    readObjField,
    removeRunDescends,
    tagRunEnd,
    type ObjEntry,
    type ObjFamilyOp,
    type RowFacts,
} from '../objectListOps'

interface Golden {
    blank: { globalLore: ObjEntry[] }
    mixedRows: { globalLore: unknown[] }
    twins: { globalLore: ObjEntry[] }
    folderWithId: { globalLore: ObjEntry[] }
    wrongKinds: { globalLore: ObjEntry[] }
}
const golden: Golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'loreClassic.golden.json'), 'utf8'))
const [ADDED, FOLDER] = golden.blank.globalLore
const [TWIN] = golden.twins.globalLore
const [FOLDER_WITH_ID, ENTRY_WITH_ID] = golden.folderWithId.globalLore
const [WRONG_KINDS] = golden.wrongKinds.globalLore

function reordered(entry: ObjEntry): ObjEntry {
    return Object.fromEntries(Object.entries(entry).reverse())
}

describe('canonicalJson and entryAnchor (T9)', () => {
    test('key order is ignored, at every depth', () => {
        const nested = { ...ADDED, extentions: { b: 1, a: { y: 2, x: 3 } } }
        const swapped = { ...reordered(ADDED), extentions: { a: { x: 3, y: 2 }, b: 1 } }
        expect(canonicalJson(swapped)).toBe(canonicalJson(nested))
        expect(entryAnchor('lore', swapped)).toBe(entryAnchor('lore', nested))
    })

    test('every value change is seen, unknown keys and nested values included', () => {
        const base = entryAnchor('lore', ADDED)
        for (const changed of [
            { ...ADDED, content: 'x' },
            { ...ADDED, insertorder: 101 },
            { ...ADDED, unknownKey: 1 },
            { ...ADDED, extentions: { deep: { deeper: [1, 2] } } },
        ]) {
            expect(entryAnchor('lore', changed)).not.toBe(base)
        }
        const deepA = { ...ADDED, extentions: { deep: { deeper: [1, 2] } } }
        const deepB = { ...ADDED, extentions: { deep: { deeper: [1, 3] } } }
        expect(entryAnchor('lore', deepA)).not.toBe(entryAnchor('lore', deepB))
    })

    test('bookVersion is ignored for lore, as the anchor of a stamp-only change', () => {
        expect(entryAnchor('lore', { ...ADDED, bookVersion: 2 })).toBe(entryAnchor('lore', ADDED))
        expect(canonicalJson({ ...ADDED, bookVersion: 2 })).not.toBe(canonicalJson(ADDED))
    })

    test('a live element with undefined and NaN values anchors as its JSON copy', () => {
        const live = { ...ADDED, gone: undefined, nan: Number.NaN, inf: Infinity }
        const copy: unknown = JSON.parse(JSON.stringify(live))
        expect(entryAnchor('lore', live)).toBe(entryAnchor('lore', copy))
    })

    test('an own __proto__ key is a key: rows differing only there differ, and a row with one differs from a row without', () => {
        const one: ObjEntry = JSON.parse('{"a":1,"__proto__":{"x":1}}')
        const two: ObjEntry = JSON.parse('{"a":1,"__proto__":{"x":2}}')
        const none: ObjEntry = JSON.parse('{"a":1}')
        expect(canonicalJson(one)).not.toBe(canonicalJson(two))
        expect(canonicalJson(one)).not.toBe(canonicalJson(none))
        expect(entryAnchor('lore', one)).not.toBe(entryAnchor('lore', two))
        expect(entryAnchor('lore', one)).not.toBe(entryAnchor('lore', none))
        expect(canonicalJson(one)).toBe('{"__proto__":{"x":1},"a":1}')
    })

    test('a value with no JSON form has no canonical text and no anchor, and nothing throws', () => {
        const cyclic: Record<string, unknown> = { a: 1 }
        cyclic.self = cyclic
        for (const value of [cyclic, { big: 10n }, undefined, () => 1]) {
            expect(() => canonicalJson(value)).not.toThrow()
            expect(canonicalJson(value)).toBeNull()
            expect(entryAnchor('lore', value)).toBeNull()
        }
        expect(() => identitiesOf('lore', cyclic)).not.toThrow()
        expect(identitiesOf('lore', cyclic)).toEqual({})
    })

    test('a non-object row has an anchor of its own and holds no identity', () => {
        for (const row of [null, 'x', 5, [], [1]]) {
            expect(entryAnchor('lore', row)).toBe(entryAnchor('lore', JSON.parse(JSON.stringify(row))))
            expect(identitiesOf('lore', row)).toBeNull()
        }
        expect(entryAnchor('lore', 5)).not.toBe(entryAnchor('lore', 6))
    })
})

describe('identities and holders', () => {
    test('a row with an id holds the id; an id-less row holds its content; an empty id counts as none', () => {
        expect(identitiesOf('lore', ENTRY_WITH_ID)).toEqual({ id: 'id-a' })
        expect(identityKindsOf('lore', ADDED)).toEqual(['content'])
        expect(identitiesOf('lore', ADDED)?.content).toBe(canonicalJson(ADDED))
        expect(identityKindsOf('lore', { ...ADDED, id: '' })).toEqual(['content'])
        expect(identityKindsOf('lore', { ...ADDED, id: 5 })).toEqual(['content'])
    })

    test('a folder row holds its key; one with an id holds both and no content', () => {
        expect(identityKindsOf('lore', FOLDER)).toEqual(['folderKey'])
        expect(identitiesOf('lore', FOLDER)?.folderKey).toBe(FOLDER.key)
        expect(identityKindsOf('lore', FOLDER_WITH_ID)).toEqual(['id', 'folderKey'])
        expect(identityKindsOf('lore', { ...FOLDER, key: '' })).toEqual(['content'])
    })

    test('content ignores bookVersion, so a stamp does not make a different identity', () => {
        expect(identitiesOf('lore', { ...ADDED, bookVersion: 3 })?.content).toBe(identitiesOf('lore', ADDED)?.content)
    })

    test('holdersOf counts plain-object rows only, per identity kind', () => {
        const rows: unknown[] = [TWIN, null, 'x', 5, [], TWIN, ENTRY_WITH_ID, { ...ENTRY_WITH_ID, content: 'other' }]
        const facts: RowFacts = new WeakMap()
        const content = identitiesOf('lore', TWIN)?.content
        expect(content).toBeDefined()
        expect(holdersOf(rows, 'lore', 'content', content as string, facts)).toBe(2)
        expect(holdersOf(rows, 'lore', 'id', 'id-a', facts)).toBe(2)
        expect(holdersOf(rows, 'lore', 'folderKey', 'nope', facts)).toBe(0)
    })

    test('the row cache holds each plain row it counted', () => {
        const rows: unknown[] = [TWIN, { ...TWIN }]
        const facts: RowFacts = new WeakMap()
        holdersOf(rows, 'lore', 'content', 'x', facts)
        expect(facts.has(rows[0] as object)).toBe(true)
        expect(facts.has(rows[1] as object)).toBe(true)
    })
})

describe('field values', () => {
    test('readObjField: a missing key and undefined read absent; a present value reads as plain JSON', () => {
        expect(readObjField(ADDED, 'folder')).toEqual({ had: false })
        expect(readObjField({ folder: undefined }, 'folder')).toEqual({ had: false })
        expect(readObjField(ADDED, 'insertorder')).toEqual({ had: true, value: 100 })
        expect(readObjField({ activationPercent: null }, 'activationPercent')).toEqual({ had: true, value: null })
        expect(readObjField({ extentions: { a: 1 } }, 'extentions')).toEqual({ had: true, value: { a: 1 } })
    })

    test('readObjField: a bigint, a cycle and an array are unreadable, never a throw', () => {
        const cyclic: Record<string, unknown> = {}
        cyclic.self = cyclic
        expect(readObjField({ extentions: cyclic }, 'extentions')).toBeNull()
        expect(readObjField({ insertorder: 5n }, 'insertorder')).toBeNull()
        expect(readObjField({ key: ['a'] }, 'key')).toBeNull()
    })

    test('fieldValueFits: absent fits every field; a present value must be the field kind', () => {
        expect(fieldValueFits('lore', 'content', { had: false })).toBe(true)
        expect(fieldValueFits('lore', 'content', { had: true, value: 'x' })).toBe(true)
        expect(fieldValueFits('lore', 'content', { had: true, value: null })).toBe(false)
        expect(fieldValueFits('lore', 'insertorder', { had: true, value: '100' })).toBe(false)
        expect(fieldValueFits('lore', 'insertorder', { had: true, value: 100 })).toBe(true)
        expect(fieldValueFits('lore', 'alwaysActive', { had: true, value: 'true' })).toBe(false)
        expect(fieldValueFits('lore', 'alwaysActive', { had: true, value: true })).toBe(true)
        expect(fieldValueFits('lore', 'activationPercent', { had: true, value: null })).toBe(true)
        expect(fieldValueFits('lore', 'activationPercent', { had: true, value: 50 })).toBe(true)
        expect(fieldValueFits('lore', 'activationPercent', { had: true, value: '50' })).toBe(false)
        expect(fieldValueFits('lore', 'extentions', { had: true, value: { a: 1 } })).toBe(true)
        expect(fieldValueFits('lore', 'extentions', { had: true, value: 1 })).toBe(false)
        // Fields outside the settable table fit nothing.
        for (const field of ['id', 'mode', 'bookVersion', 'probability', 'flag']) {
            expect(fieldValueFits('lore', field, { had: false }), field).toBe(false)
        }
    })

    test('the wrong-kind row of a classic import does not fit its fields', () => {
        for (const field of ['insertorder', 'content', 'alwaysActive']) {
            expect(fieldValueFits('lore', field, readObjField(WRONG_KINDS, field) ?? { had: false }), field).toBe(false)
        }
    })

    test('isFieldSettable: key is refused on a folder row, empty key included; id, mode and probability never', () => {
        expect(isFieldSettable('lore', 'key', ADDED)).toBe(true)
        expect(isFieldSettable('lore', 'key', FOLDER)).toBe(false)
        expect(isFieldSettable('lore', 'key', { ...FOLDER, key: '' })).toBe(false)
        expect(isFieldSettable('lore', 'comment', FOLDER)).toBe(true)
        for (const field of ['id', 'mode', 'bookVersion', 'probability']) {
            expect(isFieldSettable('lore', field, ADDED), field).toBe(false)
        }
    })

    test('objValueEquals compares plain values, never object identity', () => {
        expect(objValueEquals({ had: false }, { had: false })).toBe(true)
        expect(objValueEquals({ had: false }, { had: true, value: null })).toBe(false)
        expect(objValueEquals({ had: true, value: { a: [1] } }, { had: true, value: { a: [1] } })).toBe(true)
        expect(objValueEquals({ had: true, value: { a: [1] } }, { had: true, value: { a: [2] } })).toBe(false)
    })
})

const insert = (index: number, deletedId?: string): ObjFamilyOp => ({ op: 'objInsert', list: 'lore', index, entry: ADDED, counts: { content: 1 }, ...(deletedId === undefined ? {} : { deletedId }) })
const remove = (index: number, deletedId?: string): ObjFamilyOp => ({ op: 'objRemove', list: 'lore', index, entry: ADDED, counts: { content: 1 }, ...(deletedId === undefined ? {} : { deletedId }) })
const SET: ObjFamilyOp = { op: 'objSet', list: 'lore', index: 0, field: 'content', before: { had: true, value: 'a' }, after: { had: true, value: 'b' }, anchorBefore: 1, anchorAfter: 2 }
const PROP: ObjFamilyOp = { op: 'propSet', prop: 'loreSettings', before: { had: false }, after: { had: true, value: { a: 1 } } }

describe('tag runs', () => {
    test('a run is the consecutive ops of one kind and one tag; it never reaches a later match', () => {
        const ops = [remove(5, 'D'), remove(4, 'D'), remove(3), remove(2, 'D'), insert(0, 'D'), SET, remove(1, 'D')]
        expect(tagRunEnd(ops, 0)).toBe(1)
        expect(tagRunEnd(ops, 2)).toBe(2)
        expect(tagRunEnd(ops, 3)).toBe(3)
        expect(tagRunEnd(ops, 4)).toBe(4)
        expect(tagRunEnd(ops, 5)).toBe(5)
        expect(tagRunEnd(ops, 6)).toBe(6)
        expect(tagRunEnd([remove(2, 'D'), remove(1, 'E')], 0)).toBe(0)
    })

    test('a tagged remove run must strictly descend', () => {
        expect(removeRunDescends([remove(4, 'D'), remove(3, 'D')], 0, 1)).toBe(true)
        expect(removeRunDescends([remove(9, 'D'), remove(3, 'D'), remove(0, 'D')], 0, 2)).toBe(true)
        expect(removeRunDescends([remove(3, 'D'), remove(3, 'D')], 0, 1)).toBe(false)
        expect(removeRunDescends([remove(3, 'D'), remove(4, 'D')], 0, 1)).toBe(false)
        expect(removeRunDescends([remove(3, 'D')], 0, 0)).toBe(true)
    })
})

describe('inversion', () => {
    test('insert and remove swap and keep index, entry, counts and tag; the result is a new object', () => {
        const ins = insert(2, 'D')
        const inverted = invertObjOp(ins)
        expect(inverted).toEqual({ ...ins, op: 'objRemove' })
        expect(inverted).not.toBe(ins)
        expect(invertObjOp(remove(1))).toEqual({ ...remove(1), op: 'objInsert' })
        expect('deletedId' in invertObjOp(remove(1))).toBe(false)
    })

    test('objSet and propSet swap their sides, and inverting twice is the identity', () => {
        expect(invertObjOp(SET)).toEqual({
            op: 'objSet',
            list: 'lore',
            index: 0,
            field: 'content',
            before: { had: true, value: 'b' },
            after: { had: true, value: 'a' },
            anchorBefore: 2,
            anchorAfter: 1,
        })
        for (const op of [insert(1, 'D'), remove(2), SET, PROP]) {
            expect(invertObjOp(invertObjOp(op))).toEqual(op)
        }
        expect(invertObjOp(PROP)).toEqual({ op: 'propSet', prop: 'loreSettings', before: { had: true, value: { a: 1 } }, after: { had: false } })
    })

    test('isObjFamilyOp and journalListOf', () => {
        for (const op of [insert(0), remove(0), SET, PROP]) {
            expect(isObjFamilyOp(op)).toBe(true)
            expect(journalListOf(op)).toBe('lore')
        }
        expect(isObjFamilyOp({ op: 'set' })).toBe(false)
        expect(isObjFamilyOp({ op: 'listInsert' })).toBe(false)
    })
})

describe('the mixed rows of a classic import', () => {
    test('a non-object row never throws an anchor and holds no identity', () => {
        for (const row of golden.mixedRows.globalLore) {
            expect(() => entryAnchor('lore', row)).not.toThrow()
        }
        expect(golden.mixedRows.globalLore.filter((row) => identitiesOf('lore', row) === null)).toEqual([null, 'x', 5, []])
    })
})

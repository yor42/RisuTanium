// The regex list rules: JSON safety of a list, and the classification of its rows and of the list itself. Expected
// values are written out literally.
import { describe, expect, test } from 'vitest'
import { Packr, Unpackr } from 'msgpackr/index-no-eval'
import { classifyRegexList, classifyRegexRow, isJsonSafe, REGEX_STAGES } from '../regexEntry'

const classicEntry = { comment: 'a', in: 'x', out: 'y', type: 'editinput', ableFlag: false, flag: 'g' }

describe('REGEX_STAGES', () => {
    test('the six values classic offers, in its order', () => {
        expect([...REGEX_STAGES]).toEqual(['editinput', 'editoutput', 'editprocess', 'editdisplay', 'edittrans', 'disabled'])
    })
})

describe('isJsonSafe', () => {
    test('accepts JSON values', () => {
        expect(isJsonSafe(null)).toBe(true)
        expect(isJsonSafe(true)).toBe(true)
        expect(isJsonSafe(0)).toBe(true)
        expect(isJsonSafe('')).toBe(true)
        expect(isJsonSafe([])).toBe(true)
        expect(isJsonSafe([classicEntry, { ...classicEntry, x_future: { a: [1, 2, { b: null }] } }])).toBe(true)
        expect(isJsonSafe(Object.assign(Object.create(null), { a: 1 }))).toBe(true)
    })

    test('refuses values JSON cannot hold', () => {
        expect(isJsonSafe(undefined)).toBe(false)
        expect(isJsonSafe(NaN)).toBe(false)
        expect(isJsonSafe(Infinity)).toBe(false)
        expect(isJsonSafe(() => 1)).toBe(false)
        expect(isJsonSafe(Symbol('s'))).toBe(false)
        expect(isJsonSafe(BigInt(1))).toBe(false)
        expect(isJsonSafe(new Date(0))).toBe(false)
        expect(isJsonSafe(new Map())).toBe(false)
    })

    test('refuses a bad value at any depth', () => {
        expect(isJsonSafe([{ ...classicEntry, x: NaN }])).toBe(false)
        expect(isJsonSafe([classicEntry, undefined])).toBe(false)
        expect(isJsonSafe([{ ...classicEntry, flag: undefined }])).toBe(false)
        expect(isJsonSafe([{ ...classicEntry, x: { y: undefined } }])).toBe(false)
        expect(isJsonSafe([{ ...classicEntry, x: [{ y: [new Date(0)] }] }])).toBe(false)
    })

    test('refuses a hole in an array', () => {
        // eslint-disable-next-line no-sparse-arrays
        expect(isJsonSafe([1, , 3])).toBe(false)
        const holey: unknown[] = [{}]
        holey.length = 3
        expect(isJsonSafe(holey)).toBe(false)
    })

    test('refuses a cycle but accepts a value shared twice', () => {
        const a: Record<string, unknown> = { n: 1 }
        a.self = a
        expect(isJsonSafe([a])).toBe(false)
        const list: unknown[] = []
        list.push(list)
        expect(isJsonSafe(list)).toBe(false)
        const shared = { k: 1 }
        expect(isJsonSafe([shared, shared, { x: shared }])).toBe(true)
    })

    test('deep nesting does not overflow the stack and past the depth bound is refused', () => {
        let ok: unknown = 1
        for (let i = 0; i < 500; i++) {
            ok = [ok]
        }
        expect(isJsonSafe(ok)).toBe(true)
        let deep: unknown = 1
        for (let i = 0; i < 100000; i++) {
            deep = [deep]
        }
        expect(isJsonSafe(deep)).toBe(false)
        let bad: unknown = NaN
        for (let i = 0; i < 100000; i++) {
            bad = { k: bad }
        }
        expect(isJsonSafe(bad)).toBe(false)
    })

    test('a msgpack-decoded list is safe', () => {
        const packr = new Packr({ useRecords: false })
        const unpackr = new Unpackr({ int64AsType: 'number', useRecords: false })
        const decoded: unknown = unpackr.unpack(packr.pack([classicEntry, { ...classicEntry, x_future: { a: 1 } }]))
        expect(isJsonSafe(decoded)).toBe(true)
        expect(classifyRegexList(decoded)).toEqual({ kind: 'rows', rows: [{ kind: 'ok' }, { kind: 'ok' }] })
    })
})

describe('classifyRegexRow', () => {
    test('a well-formed entry is ok, with or without flag and ableFlag and with unknown keys', () => {
        expect(classifyRegexRow(classicEntry)).toEqual({ kind: 'ok' })
        expect(classifyRegexRow({ comment: '', in: '', out: '', type: 'edit_future' })).toEqual({ kind: 'ok' })
        expect(classifyRegexRow({ ...classicEntry, x_future: { a: 1 } })).toEqual({ kind: 'ok' })
    })

    test('an object that is not a well-formed entry is unreadable, with the reasons and the name', () => {
        expect(classifyRegexRow({ comment: 'x', in: 123, out: '', type: 'editinput' })).toEqual({
            kind: 'unreadable',
            reasons: [{ key: 'studioRegexWhyField', field: 'in' }],
            name: 'x',
        })
        expect(classifyRegexRow({ in: 'a', out: '', type: 'editinput' })).toEqual({
            kind: 'unreadable',
            reasons: [{ key: 'studioRegexWhyField', field: 'comment' }],
            name: null,
        })
        expect(classifyRegexRow({ ...classicEntry, flag: 5, ableFlag: 'yes' })).toEqual({
            kind: 'unreadable',
            reasons: [{ key: 'studioRegexWhyFlag' }, { key: 'studioRegexWhyAbleFlag' }],
            name: 'a',
        })
        expect(classifyRegexRow({})).toEqual({
            kind: 'unreadable',
            reasons: [
                { key: 'studioRegexWhyField', field: 'comment' },
                { key: 'studioRegexWhyField', field: 'in' },
                { key: 'studioRegexWhyField', field: 'out' },
                { key: 'studioRegexWhyField', field: 'type' },
            ],
            name: null,
        })
    })

    test.each([[null], ['text'], [3], [[]], [undefined], [new Date(0)]])('%j is inert', (row) => {
        expect(classifyRegexRow(row)).toEqual({ kind: 'inert', reason: { key: 'studioRegexWhyNotObject' } })
    })
})

describe('classifyRegexList', () => {
    test('a list that is not an array', () => {
        expect(classifyRegexList(undefined)).toEqual({ kind: 'notArray' })
        expect(classifyRegexList({ 0: classicEntry })).toEqual({ kind: 'notArray' })
    })

    test('a list holding a value JSON cannot hold, at any depth, is not json safe', () => {
        expect(classifyRegexList([{ ...classicEntry, x: NaN }])).toEqual({ kind: 'notJsonSafe' })
        expect(classifyRegexList([classicEntry, undefined])).toEqual({ kind: 'notJsonSafe' })
        expect(classifyRegexList([{ ...classicEntry, x: { y: undefined } }])).toEqual({ kind: 'notJsonSafe' })
    })

    test('rows keep their position and each row its own class', () => {
        expect(classifyRegexList([classicEntry, null, { comment: 'x', in: 123, out: '', type: 'editinput' }, 'text'])).toEqual({
            kind: 'rows',
            rows: [
                { kind: 'ok' },
                { kind: 'inert', reason: { key: 'studioRegexWhyNotObject' } },
                { kind: 'unreadable', reasons: [{ key: 'studioRegexWhyField', field: 'in' }], name: 'x' },
                { kind: 'inert', reason: { key: 'studioRegexWhyNotObject' } },
            ],
        })
        expect(classifyRegexList([])).toEqual({ kind: 'rows', rows: [] })
    })
})

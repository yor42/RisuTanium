// The strict file reading of the Studio regex import (T27, T28 at parse level): which bytes are not a regex export, which are
// an empty one, which hold entries that are not regex entries, and that accepted entries come back exactly as read.
// The fixtures are built the way `exportRegex` builds a file: Buffer.from(JSON.stringify({ type: 'regex', data }), 'utf-8').
import { describe, expect, test } from 'vitest'
import { parseRegexImport } from '../regexImport'

const exported = (data: unknown): Uint8Array => Buffer.from(JSON.stringify({ type: 'regex', data }), 'utf-8')
const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const good = (n: number): Record<string, unknown> => ({ comment: `S${n}`, in: `in ${n}`, out: `out ${n}`, type: 'editinput' })

describe('a file that is not a regex export', () => {
    test('invalid UTF-8 (a 0xFF byte inside a string value) is refused, not repaired', () => {
        const head = text('{"type":"regex","data":[{"comment":"a","in":"')
        const tail = text('","out":"","type":"editinput"}]}')
        const bytes = new Uint8Array(head.length + 1 + tail.length)
        bytes.set(head, 0)
        bytes[head.length] = 0xff
        bytes.set(tail, head.length + 1)
        expect(parseRegexImport(bytes)).toEqual({ kind: 'notRegex' })
    })

    test('text that is not JSON', () => {
        expect(parseRegexImport(text('not json at all'))).toEqual({ kind: 'notRegex' })
        expect(parseRegexImport(text(''))).toEqual({ kind: 'notRegex' })
    })

    test('a top-level array, a null, a number and a string', () => {
        expect(parseRegexImport(text(JSON.stringify([good(1)])))).toEqual({ kind: 'notRegex' })
        expect(parseRegexImport(text('null'))).toEqual({ kind: 'notRegex' })
        expect(parseRegexImport(text('5'))).toEqual({ kind: 'notRegex' })
        expect(parseRegexImport(text('"regex"'))).toEqual({ kind: 'notRegex' })
    })

    test('another export type, and a missing type', () => {
        expect(parseRegexImport(text(JSON.stringify({ type: 'lore', data: [good(1)] })))).toEqual({ kind: 'notRegex' })
        expect(parseRegexImport(text(JSON.stringify({ data: [good(1)] })))).toEqual({ kind: 'notRegex' })
    })

    test('data missing, data an object, data text', () => {
        expect(parseRegexImport(text(JSON.stringify({ type: 'regex' })))).toEqual({ kind: 'notRegex' })
        expect(parseRegexImport(text(JSON.stringify({ type: 'regex', data: { 0: good(1) } })))).toEqual({ kind: 'notRegex' })
        expect(parseRegexImport(text(JSON.stringify({ type: 'regex', data: 'x' })))).toEqual({ kind: 'notRegex' })
    })

    test('a number JSON.parse turns into Infinity is refused (it would make the live list not JSON-safe)', () => {
        const file = '{"type":"regex","data":[{"comment":"a","in":"","out":"","type":"editinput","x":1e400}]}'
        expect(parseRegexImport(text(file))).toEqual({ kind: 'notRegex' })
    })
})

describe('an empty export', () => {
    test('data [] is empty, not an error of the file', () => {
        expect(parseRegexImport(exported([]))).toEqual({ kind: 'empty' })
    })
})

describe('a UTF-8 byte order mark', () => {
    test('EF BB BF in front of a valid export is accepted and the entries are as read', () => {
        const body = exported([good(1), good(2)])
        const bytes = new Uint8Array(body.length + 3)
        bytes.set([0xef, 0xbb, 0xbf], 0)
        bytes.set(body, 3)
        expect(parseRegexImport(bytes)).toEqual({ kind: 'ok', entries: [good(1), good(2)] })
    })
})

describe('entries that are not regex entries refuse the whole file', () => {
    test('the count, the 1-based position of the first one and why it failed', () => {
        const result = parseRegexImport(exported([good(1), null, good(2), { in: 123, out: '', type: 'editinput' }]))
        expect(result).toEqual({ kind: 'bad', count: 2, position: 2, reasons: [{ key: 'studioRegexWhyNotObject' }] })
    })

    test('an unreadable object gives all of its reasons, in the order the rules list them', () => {
        const result = parseRegexImport(exported([good(1), { comment: 'x', in: 7, out: '', type: 5, flag: 1, ableFlag: 'yes' }]))
        expect(result).toEqual({
            kind: 'bad',
            count: 1,
            position: 2,
            reasons: [
                { key: 'studioRegexWhyField', field: 'in' },
                { key: 'studioRegexWhyField', field: 'type' },
                { key: 'studioRegexWhyFlag' },
                { key: 'studioRegexWhyAbleFlag' },
            ],
        })
    })

    test('a single bad entry among good ones is refused', () => {
        const result = parseRegexImport(exported([good(1), good(2), good(3), 'text']))
        expect(result).toMatchObject({ kind: 'bad', count: 1, position: 4 })
    })

    test('a bad first entry is position 1', () => {
        expect(parseRegexImport(exported([['x'], good(1)]))).toMatchObject({ kind: 'bad', count: 1, position: 1 })
    })
})

describe('accepted entries are returned as read', () => {
    test('an upstream-shaped file with an unknown key, an unknown stage and an own __proto__ key', () => {
        const file = '{"type":"regex","data":['
            + '{"comment":"a","in":"x","out":"y","type":"editinput"},'
            + '{"comment":"b","in":"x","out":"y","type":"edit_future","flag":"gi","ableFlag":true,"x_future":{"n":[1,2]},"__proto__":{"polluted":true}}'
            + ']}'
        const result = parseRegexImport(text(file))
        expect(result.kind).toBe('ok')
        if (result.kind !== 'ok') return
        expect(result.entries).toHaveLength(2)
        const second = result.entries[1] as Record<string, unknown>
        expect(second.type).toBe('edit_future')
        expect(second.x_future).toEqual({ n: [1, 2] })
        expect(Object.hasOwn(second, '__proto__')).toBe(true)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    test('twin entries in one file are both kept', () => {
        const result = parseRegexImport(exported([good(1), good(1)]))
        expect(result).toEqual({ kind: 'ok', entries: [good(1), good(1)] })
    })
})

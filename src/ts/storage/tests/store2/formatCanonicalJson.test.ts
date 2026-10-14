import { describe, expect, test } from 'vitest'
import { canonicalJson, CanonicalJsonError, encodeCanonicalJson } from '../../store2/format'

describe('canonical JSON', () => {
    test('keys are sorted at every level and nothing is spaced', () => {
        expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}')
    })

    test('insertion order does not change the bytes', () => {
        const first = encodeCanonicalJson({ x: 1, y: { p: 1, q: 2 } })
        const second = encodeCanonicalJson({ y: { q: 2, p: 1 }, x: 1 })
        expect(first).toEqual(second)
    })

    test('array order is kept', () => {
        expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
    })

    test('sorting is by UTF-16 code unit, not by code point', () => {
        // U+1F600 is the surrogate pair D83D DE00, below U+FF5E in code units but above it in code points.
        expect(canonicalJson({ '\uFF5E': 1, '\u{1F600}': 2 })).toBe('{"\u{1F600}":2,"\uFF5E":1}')
    })

    test('upper case sorts before lower case and digit strings sort as text', () => {
        expect(canonicalJson({ b: 1, B: 2, 10: 3, 9: 4 })).toBe('{"10":3,"9":4,"B":2,"b":1}')
    })

    test('strings and numbers use JSON.stringify formatting', () => {
        expect(canonicalJson({ s: 'a"\n\u2028', n: [1e21, 0.5, -0] })).toBe('{"n":[1e+21,0.5,0],"s":"a\\"\\n\u2028"}')
    })

    test('a lone surrogate is escaped so the output is well-formed UTF-8', () => {
        const text = canonicalJson({ s: '\uD800' })
        expect(text).toBe('{"s":"\\ud800"}')
        expect(new TextDecoder('utf-8', { fatal: true }).decode(encodeCanonicalJson({ s: '\uD800' }))).toBe(text)
    })

    test('a null-prototype object is plain, and an own __proto__ key is written', () => {
        const bare = Object.create(null) as Record<string, unknown>
        bare.b = 1
        Object.defineProperty(bare, '__proto__', { value: { future: 1 }, enumerable: true, writable: true, configurable: true })
        expect(canonicalJson(bare)).toBe('{"__proto__":{"future":1},"b":1}')
    })

    test('the output is UTF-8 bytes', () => {
        expect(Array.from(encodeCanonicalJson('é'))).toEqual([0x22, 0xc3, 0xa9, 0x22])
    })

    test('an own __proto__ key is a plain key', () => {
        const value = JSON.parse('{"__proto__":1,"a":2}') as object
        expect(canonicalJson(value)).toBe('{"__proto__":1,"a":2}')
    })

    test.each([
        ['undefined', undefined],
        ['an undefined field', { a: undefined }],
        ['an undefined element', [undefined]],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
        ['a function', () => 1],
        ['a symbol', Symbol('s')],
        ['a bigint', 1n],
        ['a Date', new Date(0)],
        ['a Map', new Map()],
        ['a class instance', new (class Box { a = 1 })()],
        ['a typed array', new Uint8Array(1)],
        ['a sparse array', new Array(2)],
        ['a symbol key', { [Symbol('k')]: 1 }],
    ])('refuses %s', (_name, value) => {
        expect(() => canonicalJson(value)).toThrow(CanonicalJsonError)
    })

    test('refuses a cycle but accepts a shared reference', () => {
        const cyclic: { self?: object } = {}
        cyclic.self = cyclic
        expect(() => canonicalJson(cyclic)).toThrow(CanonicalJsonError)
        const shared = { a: 1 }
        expect(canonicalJson([shared, shared])).toBe('[{"a":1},{"a":1}]')
    })
})

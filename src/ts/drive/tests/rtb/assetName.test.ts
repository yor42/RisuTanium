import { describe, test, expect } from 'vitest'
import { assetEntryName, decodeAssetEntryNames, escAssetKey, unescAssetName } from 'src/ts/drive/rtb/assetName'

/** Deterministic pseudo-random source so a failure reproduces. */
function lcg(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 0x100000000
    }
}

function randomKey(next: () => number): string {
    const length = 1 + Math.floor(next() * 24)
    const pools = [
        'abcdefghijklmnopqrstuvwxyz0123456789_-.',
        'ABCXYZ %/\\:*?"<>|#&+',
        'éü中文\u{1F600}Ā',
    ]
    let key = ''
    for (let i = 0; i < length; i++) {
        const pool = Array.from(pools[Math.floor(next() * pools.length)])
        key += pool[Math.floor(next() * pool.length)]
    }
    return key
}

describe('T3 asset name escaping', () => {
    test.each([
        ['abc', 'abc'],
        ['a_b-c9', 'a_b-c9'],
        ['a.b', 'a.b'],
        ['a..b', 'a..b'],
        ['.a', '%2Ea'],
        ['a.', 'a%2E'],
        ['.', '%2E'],
        ['..', '%2E%2E'],
        ['A', '%41'],
        ['a%b', 'a%25b'],
        ['a b', 'a%20b'],
        ['a/b', 'a%2Fb'],
        ['é', '%C3%A9'],
        ['\u{1F600}', '%F0%9F%98%80'],
    ])('esc(%j) is %j', (key, expected) => {
        expect(escAssetKey(key)).toBe(expected)
        expect(unescAssetName(expected)).toBe(key)
    })

    test('every random key round-trips, and the escaped form only holds the allowed bytes', () => {
        const next = lcg(20261107)
        for (let i = 0; i < 2000; i++) {
            const key = randomKey(next)
            const escaped = escAssetKey(key)
            expect(escaped).toMatch(/^[a-z0-9_.%A-F-]*$/)
            expect(unescAssetName(escaped)).toBe(key)
        }
    })

    test('the entry name is a/ plus the escaped key', () => {
        expect(assetEntryName('Foo.png')).toBe('a/%46oo.png')
    })

    test('a key that is not well-formed UTF-16 has no name', () => {
        expect(() => escAssetKey('a\uD800b')).toThrow(RangeError)
    })

    test.each([
        ['a bad escape', '%4'],
        ['a non-hex escape', '%zz'],
        ['lower-case hex digits', '%c3%a9'],
        ['an escape of a byte that is kept literally', '%61'],
        ['an escaped dot inside the name', 'a%2Eb'],
        ['a literal leading dot', '.a'],
        ['a literal trailing dot', 'a.'],
        ['an upper-case letter', 'A'],
        ['a literal slash', 'a/b'],
        ['a literal space', 'a b'],
        ['a lone high byte', '%FF'],
        ['a truncated UTF-8 sequence', '%C3'],
        ['an overlong UTF-8 sequence', '%C0%AF'],
        ['a non-ASCII character', 'é'],
    ])('unesc is null for %s', (_label, name) => {
        expect(unescAssetName(name)).toBeNull()
    })

    test('a leading byte-order mark is part of the key, not stripped', () => {
        expect(escAssetKey('﻿abc')).toBe('%EF%BB%BFabc')
        expect(unescAssetName('%EF%BB%BFabc')).toBe('﻿abc')
        expect(unescAssetName('abc')).toBe('abc')
        expect(decodeAssetEntryNames(['a/%EF%BB%BFx'])).toEqual({ ok: true, keys: ['﻿x'] })
        expect(decodeAssetEntryNames(['a/x', 'a/%EF%BB%BFx'])).toEqual({ ok: true, keys: ['x', '﻿x'] })
        expect(unescAssetName(escAssetKey('﻿'))).toBe('﻿')
    })

    test('decoding a list of entry names: keys in order, null results and repeats damaged', () => {
        expect(decodeAssetEntryNames(['a/abc', 'a/%46oo.png'])).toEqual({ ok: true, keys: ['abc', 'Foo.png'] })
        expect(decodeAssetEntryNames([])).toEqual({ ok: true, keys: [] })
        const bad = decodeAssetEntryNames(['a/abc', 'a/%61'])
        expect(bad.ok).toBe(false)
        expect(bad.ok === false && bad.name).toBe('a/%61')
        const outside = decodeAssetEntryNames(['i/abc'])
        expect(outside.ok).toBe(false)
        const repeated = decodeAssetEntryNames(['a/abc', 'a/abc'])
        expect(repeated.ok).toBe(false)
        expect(repeated.ok === false && repeated.name).toBe('a/abc')
    })
})

/**
 * The id-to-key mapping of inlays: injective, canonical, one folder, and usable
 * on every backend, or no key at all.
 */
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
    decodeInlayId,
    encodeInlayId,
    inlayBodyKey,
    inlayIdFromMetaKey,
    inlayMetaKey,
    newBodyToken,
} from '../inlayKeys'
import {
    indexedDbCreatableViolation,
    isWellFormedUtf16,
    nodeCreatableViolation,
    tauriCreatableViolation,
    utf8ByteLength,
} from 'src/ts/storage/store/keyRules'

const HEX64 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9'
const TOKEN = '0123456789abcdef'

function keysOf(id: string): string[] {
    return [inlayMetaKey(id)!, inlayBodyKey(id, TOKEN)!]
}

function expectUsableEverywhere(id: string) {
    for (const key of keysOf(id)) {
        expect(key.startsWith('inlays/')).toBe(true)
        expect(key.indexOf('/', 'inlays/'.length)).toBe(-1)
        expect(nodeCreatableViolation(key)).toBeNull()
        expect(tauriCreatableViolation(key)).toBeNull()
        expect(indexedDbCreatableViolation(key)).toBeNull()
        expect(key.startsWith('assets/')).toBe(false)
    }
}

describe('the key of an inlay id', () => {
    test.each([
        ['a uuid', '3f2b8c1e-5a4d-4e7b-9c6f-0a1b2c3d4e5f'],
        ['a hashed asset name', `assets/${HEX64}.png`],
        ['an upper-case extension', `assets/${HEX64}.PNG`],
        ['a mixed-case id', 'Abc-Def'],
        ['a slash', 'a/b'],
        ['a colon', 'a:b'],
        ['dot segments', '../../x'],
        ['a non-ASCII id', 'ünï-画像'],
        ['an astral character', 'a\u{1F600}b'],
    ])('%s maps to keys that every backend accepts', (_name, id) => {
        expect(inlayMetaKey(id)).not.toBeNull()
        expectUsableEverywhere(id)
        expect(inlayIdFromMetaKey(inlayMetaKey(id)!)).toBe(id)
    })

    test('an id without a key is unmappable', () => {
        const unmappable = ['', 'a\uD800b', '\uDC00', 'x'.repeat(300), `assets/${HEX64}.${'ABCDEFGHIJKLMNOP'}`]
        for (const id of unmappable) {
            expect(inlayMetaKey(id)).toBeNull()
            expect(inlayBodyKey(id, TOKEN)).toBeNull()
        }
    })

    test('the longest key derived from an id is at the Node limit for the longest mappable id and an id one longer is unmappable', () => {
        const atLimit = 'a'.repeat(91)
        const over = 'a'.repeat(92)
        expect(utf8ByteLength(inlayBodyKey(atLimit, TOKEN)!)).toBe(117)
        expectUsableEverywhere(atLimit)
        expect(inlayMetaKey(over)).toBeNull()
        expect(inlayBodyKey(over, TOKEN)).toBeNull()
    })

    test('ids that differ only by case have keys that differ even when case is ignored', () => {
        const a = inlayMetaKey('Abc')!
        const b = inlayMetaKey('abc')!
        const c = inlayMetaKey('aBc')!
        expect(new Set([a.toLowerCase(), b.toLowerCase(), c.toLowerCase()]).size).toBe(3)
    })

    test('an encoded id uses one hex case and never a bare slash or dot', () => {
        for (const id of ['a/b.c', 'Zz', 'é']) {
            const encoded = encodeInlayId(id)!
            expect(encoded).toMatch(/^([a-z0-9-]|%[0-9A-F]{2})*$/)
        }
    })

    test('a key is canonical: a lower-case escape or a bare character that needs escaping decodes to nothing', () => {
        expect(decodeInlayId('%2f')).toBeNull()
        expect(decodeInlayId('A')).toBeNull()
        expect(decodeInlayId('a.b')).toBeNull()
        expect(decodeInlayId('%2F')).toBe('/')
        expect(decodeInlayId('%ZZ')).toBeNull()
        expect(decodeInlayId('%C3')).toBeNull()
    })

    test('a key outside the metadata prefix names no id', () => {
        expect(inlayIdFromMetaKey('assets/x.png')).toBeNull()
        expect(inlayIdFromMetaKey('inlays/b-abc.0123456789abcdef')).toBeNull()
    })

    test('distinct well-formed ids always have distinct keys and decode back', () => {
        fc.assert(
            fc.property(fc.string({ unit: 'binary', maxLength: 30 }), fc.string({ unit: 'binary', maxLength: 30 }), (a, b) => {
                fc.pre(isWellFormedUtf16(a) && isWellFormedUtf16(b) && a !== '' && b !== '')
                const keyA = inlayMetaKey(a)
                const keyB = inlayMetaKey(b)
                fc.pre(keyA !== null && keyB !== null)
                expect(inlayIdFromMetaKey(keyA!)).toBe(a)
                expect(keyA === keyB).toBe(a === b)
            }),
        )
    })

    test('a body token is 16 lower-case hex digits and differs between calls', () => {
        const first = newBodyToken()
        expect(first).toMatch(/^[0-9a-f]{16}$/)
        expect(newBodyToken()).not.toBe(first)
    })
})

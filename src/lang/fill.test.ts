/**
 * `fillLang` fills `{name}` placeholders in one pass: values are inserted literally and are
 * never re-scanned, and a placeholder with no supplied value is left as written.
 */
import { describe, test, expect } from 'vitest'
import { fillLang } from './fill'

describe('fillLang', () => {
    test('fills every distinct placeholder', () => {
        expect(fillLang('{a} and {b}', { a: 'x', b: 'y' })).toBe('x and y')
    })

    test('fills a repeated placeholder at every position', () => {
        expect(fillLang('{n}-{n}-{n}', { n: 7 })).toBe('7-7-7')
    })

    test('numbers are rendered as text, including zero', () => {
        expect(fillLang('{n} items', { n: 0 })).toBe('0 items')
    })

    test('a value containing another placeholder is inserted literally', () => {
        expect(fillLang('{a} {b}', { a: '{b}', b: 'B' })).toBe('{b} B')
    })

    test('a value containing replacement patterns is inserted literally', () => {
        expect(fillLang('x {v} y', { v: "$& $1 $$ $' $`" })).toBe("x $& $1 $$ $' $` y")
    })

    test('an unknown placeholder is left as written', () => {
        expect(fillLang('{known} {unknown}', { known: 'k' })).toBe('k {unknown}')
    })

    test('a name inherited from Object.prototype is not treated as supplied', () => {
        expect(fillLang('{toString} {constructor}', {})).toBe('{toString} {constructor}')
    })

    test('braces that are not a word placeholder are untouched', () => {
        expect(fillLang('{} { a } {{a}}', { a: 'x' })).toBe('{} { a } {x}')
    })

    test('a template without placeholders is returned unchanged', () => {
        expect(fillLang('plain', { a: 'x' })).toBe('plain')
    })
})

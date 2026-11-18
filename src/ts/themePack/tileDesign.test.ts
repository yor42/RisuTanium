/**
 * The tile design. Unit specs for a new module: the seed, the contrast rule and the grapheme rule each have a
 * scratch mutant that one of these tests must kill.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { cr, parseHexColour } from './colour'
import { TILE_FAMILIES, tileGrapheme, tileSpec } from './tileDesign'

function ratio(a: string | null, b: string | null): number {
    return cr(parseHexColour(a as string) as number[], parseHexColour(b as string) as number[])
}

describe('seed and family', () => {
    test('the seed alone decides the pattern: another name or colours keep it, another seed changes it somewhere', () => {
        const one = tileSpec({ seedKey: 'pack-a', name: 'Alpha' })
        const same = tileSpec({ seedKey: 'pack-a', name: 'Alpha', main: '#3366ff', secondary: '#101820' })
        expect(same.family).toBe(one.family)
        expect(same.params).toEqual(one.params)
        const other = tileSpec({ seedKey: 'pack-a', name: 'Zed' })
        expect(other.family).toBe(one.family)
    })

    test('different seeds reach every family and are not all equal', () => {
        const families = new Set<string>()
        const params = new Set<string>()
        for (let i = 0; i < 200; i++) {
            const spec = tileSpec({ seedKey: `seed-${i}`, name: 'x' })
            families.add(spec.family)
            params.add(JSON.stringify(spec.params))
        }
        expect([...families].sort()).toEqual([...TILE_FAMILIES].sort())
        expect(params.size).toBeGreaterThan(8)
    })

    test('no colours gives a neutral spec with no hex values', () => {
        const spec = tileSpec({ seedKey: 'k', name: 'Name' })
        expect(spec).toMatchObject({ neutral: true, ground: null, ink: null, glyphInk: null })
        expect(tileSpec({ seedKey: 'k', name: 'Name', main: 'red', secondary: 'nope' }).neutral).toBe(true)
    })
})

describe('contrast', () => {
    test('a clashing pair is adjusted: ink reaches 3:1, the glyph 4.5:1', () => {
        const spec = tileSpec({ seedKey: 'k', name: 'Name', main: '#777777', secondary: '#808080' })
        expect(spec.ground).toBe('#808080')
        expect(spec.ink).not.toBe('#777777')
        expect(ratio(spec.ink, spec.ground)).toBeGreaterThanOrEqual(3)
        expect(ratio(spec.glyphInk, spec.ground)).toBeGreaterThanOrEqual(4.5)
        expect(spec.glyphInk).not.toBe('#777777')
    })

    test('a pair already readable keeps the main colour for the ink', () => {
        const spec = tileSpec({ seedKey: 'k', name: 'Name', main: '#ffffff', secondary: '#101820' })
        expect(spec.ink).toBe('#ffffff')
        expect(spec.glyphInk).toBe('#ffffff')
    })

    test('a pair that reaches 3:1 but not 4.5:1 keeps the ink and moves only the glyph', () => {
        const spec = tileSpec({ seedKey: 'k', name: 'Name', main: '#3366ff', secondary: '#101820' })
        expect(spec.ink).toBe('#3366ff')
        expect(ratio('#3366ff', spec.ground)).toBeLessThan(4.5)
        expect(spec.glyphInk).not.toBe('#3366ff')
        expect(ratio(spec.glyphInk, spec.ground)).toBeGreaterThanOrEqual(4.5)
    })

    test('one known colour gets a derived partner that is readable against it', () => {
        const onlyMain = tileSpec({ seedKey: 'k', name: 'Name', main: '#3366ff' })
        expect(onlyMain.neutral).toBe(false)
        expect(onlyMain.ground).not.toBe('#3366ff')
        expect(ratio(onlyMain.ink, onlyMain.ground)).toBeGreaterThanOrEqual(3)
        const onlySecondary = tileSpec({ seedKey: 'k', name: 'Name', secondary: '#202020' })
        expect(onlySecondary.ground).toBe('#202020')
        expect(ratio(onlySecondary.ink, onlySecondary.ground)).toBeGreaterThanOrEqual(3)
        expect(ratio(onlySecondary.glyphInk, onlySecondary.ground)).toBeGreaterThanOrEqual(4.5)
    })
})

describe('grapheme', () => {
    test('the first letter, digit, emoji or flag cluster', () => {
        const cases: Array<[string, string]> = [
            ['🇰🇷 Flag', '🇰🇷'],
            ['1️⃣ One', '1️⃣'],
            ['🏳️‍🌈 Pride', '🏳️‍🌈'],
            ['👩‍💻 Coder', '👩‍💻'],
            ['바나나', '바'],
            ['  ß', 'ß'],
            ['"Quote', 'Q'],
            ['ǆemal', 'Ǆ'],
            ['#!', '#'],
            ['é x', 'É'],
        ]
        for (const [name, expected] of cases) {
            expect(tileGrapheme(name), name).toBe(expected)
        }
    })

    test('an empty name has no grapheme', () => {
        expect(tileGrapheme('')).toBe('')
        expect(tileGrapheme('   ')).toBe('')
        expect(tileSpec({ seedKey: 'k', name: ' ' }).grapheme).toBe('')
    })

    describe('without Intl.Segmenter', () => {
        const original = Intl.Segmenter
        afterEach(() => {
            Object.defineProperty(Intl, 'Segmenter', { value: original, configurable: true, writable: true })
        })

        test('a code point stands in for a cluster, so a flag shows one indicator', () => {
            Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true, writable: true })
            expect(tileGrapheme('바나나')).toBe('바')
            expect(tileGrapheme('🇰🇷 Flag')).toBe('🇰')
            expect(tileGrapheme('abc')).toBe('A')
        })
    })
})

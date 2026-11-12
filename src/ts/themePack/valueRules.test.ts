// @vitest-environment node
// Unit tests of the structure pass (structure.ts), the value pass (valueRules.ts) and comment placement (canonical.ts).
import { describe, expect, test } from 'vitest'
import { canonicalStylesheet } from './canonical'
import { lintAreaPack, THEME_AREAS } from './index'
import { caseSafe, structurePass } from './structure'
import { readAppValues, tokenValues, valueRulesPass, type ValueEnv } from './valueRules'

const ENV: ValueEnv = { ownFamilies: new Set<string>(), app: new Map<string, string[]>() }
const SAFE = '[data-part="chat-message-avatar"]'
const TEXT = '[data-part="chat-message-text"]'

const structureReasons = (css: string): string[] => structurePass(css).map((e) => e.why)

describe('VU1: the token resolver and the structure pass', () => {
    test('a plain-root token resolves to its last plain-root value only', () => {
        expect(tokenValues(':root{--nexus-pad:10px}', '--nexus-pad', ENV)).toEqual(['10px'])
        expect(tokenValues(':root{--nexus-pad:1000px}:root{--nexus-pad:10px}', '--nexus-pad', ENV)).toEqual(['10px'])
    })

    test('an app-only token resolves to every app value', () => {
        const env: ValueEnv = { ownFamilies: new Set<string>(), app: new Map([['--x', ['12px', '14px']]]) }
        expect(tokenValues('', '--x', env)).toEqual(['12px', '14px'])
        expect(tokenValues(':root{--x:20px}', '--x', env)).toEqual(['20px'])
        expect(tokenValues(':root{--x:20px}', '--x', env, true)).toEqual(['20px', '12px', '14px'])
    })

    test('a --pack-* helper resolves to every declared site', () => {
        const css = ':root{--pack-a:1px}html[data-input="touch"]{--pack-a:2px}html[data-input="hover"]{--pack-a:3px}'
        expect(tokenValues(css, '--pack-a', ENV)).toEqual(['1px', '2px', '3px'])
    })

    test('a two-token cycle terminates with the cycle reason', () => {
        const errors = valueRulesPass(':root{--pack-a:var(--pack-b);--pack-b:var(--pack-a)}', ENV)
        expect(errors.some((e) => /refers to itself through var\(\)/.test(e.why))).toBe(true)
    })

    test('readAppValues keeps every block of a token file, not only the last or the :root one', () => {
        const studio = readAppValues(['studio/studio-tokens.css'])
        expect((studio.get('--studio-dur-base') ?? []).length).toBeGreaterThan(1)
    })

    test.each([
        ['N0a', ':root{--a:1px}x;:root{--a:2px}', /text outside a rule/],
        ['N0b', ':ro@font-face{font-family:x;src:url(a.woff2)}ot{--a:2px}', /@ may only start a statement/],
        ['N0c', ':root{--a:[;]}', /square brackets are not allowed in a rule block/],
        ['N0d', `${SAFE}{opacity:1;nonsense}`, /one name:value declaration/],
        ['N0e', `${SAFE}{opacity:1}>{opacity:1}`, /a rule needs a selector/],
        ['N0f', 'x[(]){}', /brackets must close in order/],
    ])('structurePass names the %s rule', (_name, css, why) => { expect(structureReasons(css).some((r) => why.test(r)), JSON.stringify(structureReasons(css))).toBe(true) })

    test('structurePass accepts ordinary stylesheets, nested @media included', () => {
        expect(structurePass(`${SAFE}{opacity:1}@media (min-width:1px){${TEXT}{opacity:1}}@font-face{font-family:p;src:url(f.woff2)}`)).toEqual([])
    })

    test('structurePass reads at-keywords and property names case-insensitively', () => {
        expect(structurePass(`${SAFE}{OPACITY:0}`)).toEqual([])
        expect(structurePass(`@MEDIA (MIN-WIDTH:1px){${SAFE}{opacity:0}}`)).toEqual([])
        expect(structurePass('@FONT-FACE{font-family:p;src:url(f.woff2)}')).toEqual([])
    })
})

describe('VU3: caseSafe, I2 spans and comment placement', () => {
    test('caseSafe is true for lower-case ASCII only', () => {
        expect(caseSafe('k')).toBe(true)
        expect(caseSafe('--a')).toBe(true)
        for (const span of ['\u212a', '\u0130', '\u017f', '--A', 'Ab']) expect(caseSafe(span), JSON.stringify(span)).toBe(false)
    })

    test.each([
        ['a class', '.Foo{opacity:1}'],
        ['an id', '#Bar{opacity:1}'],
        ['an unquoted attribute value', '[data-x=Ab]{opacity:1}'],
    ])('structurePass refuses upper case in %s', (_name, css) => { expect(structureReasons(css).some((r) => /must be written in lower case/.test(r))).toBe(true) })

    test.each([
        ['html/**/[x]{}', true], [']/**/[', true], ['x/**/:hover', true], ['"a"/**/x', true], ['rgb(/**/1 2 3)', true], ['calc/**/(1px)', true],
        ['a /**/b', false], ['a{}\t/**/b{}', false],['{/**/', false], [';/**/', false], [',/**/', false], ['/**/a{}', false], ['a{}/**/', false], ['a{} /**//**/ b{}', false], ['a{}/**//**/b{}', false], ['a/**//**/b', true],
    ])('comment placement %s is refused: %s', (css, refused) => {
        const errors = canonicalStylesheet(css).errors.map((e) => e.why)
        expect(errors.some((why) => /a comment needs a space|a comment between two parts of a word/.test(why)), JSON.stringify(errors)).toBe(refused)
    })

    test('a run of comments is judged as one placement', () => {
        // Each comment of the run has a comment as a neighbour, but the run has braces and a space beside it.
        expect(canonicalStylesheet(`${SAFE}{opacity:1} /**//**/${SAFE}{opacity:1}`).errors).toEqual([])
        expect(canonicalStylesheet(`${SAFE}{opacity:1}/**//**/${SAFE}{opacity:1}`).errors).toEqual([])
    })

    test('a comment keeps the existing word-join reason between two words', () => {
        expect(canonicalStylesheet(`${SAFE}{background:red/**/url(a.png)}`).errors.map((e) => e.why)).toContainEqual(expect.stringMatching(/a comment between two parts of a word or value is not allowed/))
    })
})

describe('VU2: the pass is bounded on a pack at the inliner limit', () => {
    test('eight helpers each with a root default and a state value, all used, are judged in bounded time in every area', () => {
        let css = ''
        for (let k = 0; k < 8; k++) css += `:root{--pack-c${k}:#112233}html[data-input="touch"]{--pack-c${k}:#223344}`
        css += `${SAFE}{`
        for (let k = 0; k < 8; k++) css += `border-color:var(--pack-c${k});`
        css += '}'
        // Each area is timed on its own, so one slow area cannot hide behind the others. Generous bound on i9 best-case hardware:
        // the point is no blow-up, not a frame-budget claim.
        for (const area of THEME_AREAS) {
            const started = performance.now()
            lintAreaPack(area, css)
            expect(performance.now() - started, area).toBeLessThan(2000)
        }
    }, 60000)
})

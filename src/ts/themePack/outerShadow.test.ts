// @vitest-environment node
// Rule E-2 (CHORE-738 stage 2, MC-2309) at its two seams: shadowReach, the per-layer reach reader of paintOver.ts, and outerShadowPass, the
// pass that judges every shadow declaration of a chat or Studio sheet. Every stage-2 row is a SEAM GUARD on a new seam: the file fails at import on a
// base without outerShadow.ts, so it is not a reproducer; the reproducers are the pipeline rows in cascadeRules.test.ts.
// Inset layers (CHORE-738 stage 4, MC-2317, MC-2318): rows marked SEAM REPRO fail by assertion on a base whose E-2 skips inset layers; the
// rest are SEAM GUARDs. RULE is written out below as a literal and not imported, so a change of wording fails here.
import { describe, expect, it } from 'vitest'
import { outerShadowPass } from './outerShadow'
import { shadowReach } from './paintOver'

const E2_WHY = /may reach at most 64 px past its element/
const NOTICE = '[data-part="chat-ai-law-notice"]'
// The rule sentence every E-2 reason ends with, written out so a change of wording fails here.
const RULE = 'in chat and Studio an outer box-shadow or a text-shadow may reach at most 64 px past its element and an inset box-shadow at most 64 px into it, offset, blur and spread together, whatever its colour (MC-3427, MC-3431)'
const INHERIT_WHY = `box-shadow: inherit copies the parent's shadow, which the check cannot measure; ${RULE}`
const RT1 = `:root{--focus-ring-w:64px}${NOTICE}{box-shadow:1px 0 0 var(--focus-ring-w) #000000}`
const whysOf = (area: 'chat' | 'studio' | 'settings' | 'home', css: string): string[] => outerShadowPass(area, css).map((e) => e.why)

describe('U1: shadowReach reads the per-layer bound and refuses any token that is not a measurable shape (SEAM GUARD)', () => {
    it.each([
        ['0 0 0 2px', 'box', 2],
        ['3px 3px 0', 'box', 3],
        ['-4px 0 6px -2px', 'box', 10],
        ['0 2px 4px -4px', 'box', 6],
        ['0 0 64px -62px', 'box', 64],
        ['-4px 0 0 -2px', 'box', 2],
        ['0 0 0 -9px', 'box', 0],
        ['0 0 0 calc(64px * -1)', 'box', 64],
        ['0 0 1em', 'box', null],
        ['0 0 calc(-6px * -1)', 'text', 6],
        ['0 0 0 0 0', 'box', null],
        ['0 0 0 0', 'text', null],
        ['0 0 0.125rem', 'text', 2],
        ['1px', 'box', null],
        ['inset 0 0 0 9px', 'box', 9],
        ['0 0 4px var(--x)', 'box', null],
        ['rgb(0 0 0)64px 0 0 0', 'box', null],
        ['rgb(0 0 0)12px 0 0', 'text', null],
        ['rgb(0 0 0)calc(64px * -1) 0 0 0', 'box', null],
        ['calc(64px * -1)rgb(0 0 0) 0 0 0', 'box', null],
        ['rgb(0 0 0) 64px 0 0 0', 'box', 64],
        ['0 0 0 64px#000000', 'box', null],
        ['#000000+64px 0 0 0', 'box', null],
        ['red+64px 0 0 0', 'box', null],
        ['#000000.99rem 0 0 0', 'box', null],
        ['currentcolor+12px 0 0', 'text', null],
        ['0 0 #ffffff+64px', 'box', null],
        ['red +64px 0 0 0', 'box', 64],
        ['#fff64px 0 0 0', 'box', null],
        ['red-64px 0 0', 'box', null],
        ['"" 64px 0 0 0', 'box', null],
        ['0 0 0 rgb(0 0 0 64px', 'box', null],
        ['0 1px 1px rgb(0 0 0 / 0.2)', 'box', 2],
        ['#ffffff99 0 0 0 2px', 'box', 2],
        ['0 0 2px rebeccapurple', 'box', 2],
        ['0 0 0 2px oklch(0.5 0.1 200)', 'box', 2],
    ] as const)('%s (%s) reads %s', (layer, kind, reach) => {
        expect(shadowReach(layer, kind)).toBe(reach)
    })
})

describe('S1-S8: an unmeasurable layer is refused with the unmeasured reason (SEAM GUARD)', () => {
    it.each([
        ['S1 em', `${NOTICE}{box-shadow:0 0 0 4em #000000}`],
        ['S2 text em', `${NOTICE}{text-shadow:0 0 3em #000000}`],
        ['S3 leftover var', `${NOTICE}{box-shadow:0 0 0 1px var(--nope)}`],
        ['S4 min()', `${NOTICE}{box-shadow:0 0 0 min(64px, 1px) #000000}`],
        ['S5 five lengths', `${NOTICE}{box-shadow:0 0 0 1px 1px #000000}`],
        ['S6 percent', `${NOTICE}{box-shadow:0 0 0 10% #000000}`],
        ['S7 unitless', `${NOTICE}{box-shadow:0 0 0 64 #000000}`],
        ['S8 exponent', `${NOTICE}{box-shadow:0 0 0 1e2px #000000}`],
    ] as const)('%s', (_id, css) => {
        const found = whysOf('chat', css)
        expect(found, css).toHaveLength(1)
        expect(found[0]).toMatch(/cannot be measured/)
    })
})

describe('S9: only chat and Studio are judged (SEAM GUARD)', () => {
    it.each(['settings', 'home'] as const)('%s gives no error for a 64 px shadow', (area) => {
        expect(outerShadowPass(area, `${NOTICE}{box-shadow:1px 0 0 64px #000000}`)).toEqual([])
    })
})

describe('S10: the reason texts are exactly the decided ones (SEAM GUARD)', () => {
    it('over: names the property, the layer and the reach', () => {
        expect(whysOf('chat', `${NOTICE}{box-shadow:1px 0 0 64px #000000}`)).toEqual([`box-shadow layer "1px 0 0 64px #000000" reaches 65 px past its element; ${RULE}`])
    })
    it('unmeasured: asks for px or rem lengths with a space between values', () => {
        expect(whysOf('chat', `${NOTICE}{box-shadow:#ffffff+64px 0 0 0}`)).toEqual([`box-shadow layer "#ffffff+64px 0 0 0" cannot be measured, so its reach cannot be judged; write px or rem lengths with a space between values; ${RULE}`])
    })
    it('inherit', () => {
        expect(whysOf('chat', `${NOTICE}{box-shadow:inherit}`)).toEqual([INHERIT_WHY])
    })
    it('no reason cites another rule', () => {
        const all = [
            ...whysOf('chat', `${NOTICE}{box-shadow:1px 0 0 64px #000000}`),
            ...whysOf('chat', `${NOTICE}{box-shadow:#ffffff+64px 0 0 0}`),
            ...whysOf('chat', `${NOTICE}{box-shadow:inherit}`),
        ]
        for (const why of all) expect(why).not.toMatch(/MC-2072|MC-1569|MC-1586/)
    })
    it('a 300-character layer is clipped to 60 characters and a 100 KB selector to 201', () => {
        const layer = `1px 0 0 64px ${'a'.repeat(290)}`
        const clipped = outerShadowPass('chat', `${NOTICE}{box-shadow:${layer}}`)
        expect(clipped).toHaveLength(1)
        expect(clipped[0].why).toContain(`"${layer.slice(0, 60)}" reaches 65 px`)
        expect(clipped[0].why).not.toContain(layer.slice(0, 61))
        const selector = `${NOTICE}${':hover'.repeat(20000)}`
        const long = outerShadowPass('chat', `${selector}{box-shadow:1px 0 0 64px #000000}`)
        expect(long).toHaveLength(1)
        expect(long[0].selector).toHaveLength(201)
    })
})

describe('S11: Studio inherit (SEAM GUARD)', () => {
    it('gives exactly the inherit reason', () => {
        expect(whysOf('studio', '[data-part="studio-item-apply"]{box-shadow:inherit}')).toEqual([INHERIT_WHY])
    })
})

describe('S12: keywords with !important at the seam (SEAM GUARD)', () => {
    it.each([
        `${NOTICE}{box-shadow:none !important}`,
        `${NOTICE}{box-shadow:revert-layer !important}`,
        `${NOTICE}{text-shadow:inherit !important}`,
    ])('%s gives no error', (css) => {
        expect(outerShadowPass('chat', css)).toEqual([])
    })
    it('box-shadow: inherit !important gives exactly the inherit reason', () => {
        expect(whysOf('chat', `${NOTICE}{box-shadow:inherit !important}`)).toEqual([INHERIT_WHY])
    })
})

describe('S13: a pack :root override of an app token is resolved at the seam (SEAM GUARD)', () => {
    it('gives one error naming the overridden reach', () => {
        const found = whysOf('chat', RT1)
        expect(found).toHaveLength(1)
        expect(found[0]).toMatch(/reaches 65 px/)
        expect(found[0]).toMatch(E2_WHY)
    })
})

describe('SI: inset layers are judged by the same 64 px limit, measured into the element (CHORE-738 stage 4, MC-2317, MC-2318)', () => {
    describe('SEAM REPRO: an over-limit or unmeasurable inset layer gives a reason; no reason on a base that skips inset layers', () => {
        it('SI1 an inset over 64 px gives the full "into" reason', () => {
            expect(whysOf('chat', `${NOTICE}{box-shadow:inset 1px 0 0 64px #000000}`)).toEqual([`box-shadow layer "inset 1px 0 0 64px #000000" reaches 65 px into its element; ${RULE}`])
        })
        it('SI2 inset written last', () => {
            expect(whysOf('chat', `${NOTICE}{box-shadow:1px 0 0 64px #000000 inset}`)).toEqual([`box-shadow layer "1px 0 0 64px #000000 inset" reaches 65 px into its element; ${RULE}`])
        })
        it('SI3 an unmeasurable inset layer gives the unmeasured reason', () => {
            expect(whysOf('chat', `${NOTICE}{box-shadow:inset 0 0 0 4em #000000}`)).toEqual([`box-shadow layer "inset 0 0 0 4em #000000" cannot be measured, so its reach cannot be judged; write px or rem lengths with a space between values; ${RULE}`])
        })
        it('SI4 a Studio inset blur', () => {
            expect(whysOf('studio', '[data-part="studio"]{box-shadow:inset 1px 0 64px #000000}')).toEqual([`box-shadow layer "inset 1px 0 64px #000000" reaches 65 px into its element; ${RULE}`])
        })
        it('SI9 an inset after an outer layer gives exactly one error', () => {
            const found = whysOf('chat', `${NOTICE}{box-shadow:0 0 0 1px #000000,inset 1px 0 0 64px #000000}`)
            expect(found).toHaveLength(1)
            expect(found[0]).toMatch(/"inset 1px 0 0 64px #000000" reaches 65 px into its element/)
        })
    })

    describe('SEAM GUARD: accepted before and after', () => {
        it.each(['settings', 'home'] as const)('SI7 %s gives no error for a 64 px inset', (area) => {
            expect(outerShadowPass(area, `${NOTICE}{box-shadow:inset 0 0 0 64px #000000}`)).toEqual([])
        })
        it('SI8 insets at 2 px give nothing', () => {
            expect(whysOf('chat', `${NOTICE}{box-shadow:inset 0 0 0 2px #000000,inset 1px 1px 0 1px #000000}`)).toEqual([])
        })
    })

    describe('U1+: shadowReach reads an inset layer as the per-axis bound from the padding edge (SEAM GUARD, unchanged reader)', () => {
        it.each([
            ['inset 0 0 0 2px', 2],
            ['0 0 0 3px inset', 3],
            ['inset 3px 0 0', 3],
            ['inset 0 -3px 0', 3],
            ['inset 0 0 64px -62px', 64],
            ['inset -4px 0 0 -2px', 2],
            ['inset 0 0 0 -9px', 0],
            ['inset 1px 1px 0 1px', 2],
            ['#ffffff inset 0 0 0 64px', 64],
        ] as const)('%s reads %s', (layer, reach) => {
            expect(shadowReach(layer, 'box')).toBe(reach)
        })
    })
})

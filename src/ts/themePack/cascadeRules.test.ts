// @vitest-environment node
// Rule S and Rule R-c (UI-S6 I0a, MC-1569): the engine judges each rule block alone, so the colour pairs and the ancestor padding
// that several blocks can combine were unjudged. Classes: REPRO = refused here, accepted (ok:true) by the engine before this stage;
// GUARD = accepted before and after, or a new rule whose pre-fix verdict does not change.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cascadePass } from './cascade'
import { normalise, type Rgba } from './engine'
import { geometryPass } from './geometry'
import { lintAreaPack, type ThemeArea } from './index'
import { layerStacks, stackCount } from './paintOver'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DESIGN = path.resolve(ROOT, 'docs/design')
const read = (rel: string): string => fs.readFileSync(path.join(DESIGN, rel), 'utf8')

const SEND = '[data-part="chat-send"]'
const SAFE = '[data-part="chat-message-avatar"]'
const DARK = 'background:#111111;color:#111111'
const YELLOW_ON_DARK = 'background:#ffff00;color:#111111'
const RULE_S = /MC-1569/

const reasons = (area: ThemeArea, css: string): string[] => lintAreaPack(area, css, 'probe').errors.map((e) => e.why)
// Rule E-2 (MC-2309): the reason text every E-2 refusal carries. The helpers use only the public lint, so they fail by assertion on a base without the rule.
const E2_WHY = /may reach at most 2 px past its element/
const refusedOnlyByE2 = (area: ThemeArea, css: string): boolean => {
    const result = lintAreaPack(area, css, 'probe')
    return !result.ok && result.errors.length > 0 && result.errors.every((e) => E2_WHY.test(e.why))
}
const e2Count = (area: ThemeArea, css: string): number => lintAreaPack(area, css, 'probe').errors.filter((e) => E2_WHY.test(e.why)).length
const refusedBySuperset = (area: ThemeArea, css: string): boolean => {
    const result = lintAreaPack(area, css, 'probe')
    return !result.ok && result.errors.some((e) => RULE_S.test(e.why))
}

describe('Rule S: a split pair that no single block shows (REPRO)', () => {
    // T0a-1: base observed ok:true for each (the default-state split and the context lead).
    it.each([
        ['split-default-html', `${SEND}{${YELLOW_ON_DARK}}html ${SEND}{background:#111111}`],
        ['split-ws', `${SEND}{${YELLOW_ON_DARK}}html  ${SEND}{background:#111111}`],
        ['split-list', `${SAFE},${SEND}{${YELLOW_ON_DARK}}html ${SEND}{background:#111111}`],
        ['split-list (the second block lists the part second)', `${SEND}{${YELLOW_ON_DARK}}html ${SAFE},html ${SEND}{background:#111111}`],
        ['split-dup-attr', `${SEND}{${YELLOW_ON_DARK}}${SEND}[data-part]{background:#111111}`],
        ['split-dup-attr (same value)', `${SEND}{${YELLOW_ON_DARK}}${SEND}[data-part="chat-send"]{background:#111111}`],
        ['cm-attr-attr-ctl', `[data-role="user"] ${SEND}{${DARK}}`],
    ])('%s', (_name, css) => {
        expect(refusedBySuperset('chat', css), JSON.stringify(reasons('chat', css))).toBe(true)
    })

    // T0a-2: the state, media and hover members of the family, and one pair below the pack/pack threshold.
    it.each([
        ['pair-hover', `${SEND}{${YELLOW_ON_DARK}}${SEND}:hover{background:#111111}`],
        ['pair-media', `${SEND}{${YELLOW_ON_DARK}}@media (min-width:1px){html ${SEND}{background:#111111}}`],
        ['hover-bg', `${SEND}{${YELLOW_ON_DARK}}html ${SEND}:hover{background:#111111}`],
        ['hover-colour', `${SEND}{${YELLOW_ON_DARK}}${SEND}:hover{color:#ffffff}`],
        ['one pair at 3.9:1', `${SEND}{background:#222222;color:#7d7d7d}`],
    ])('%s', (_name, css) => {
        expect(refusedBySuperset('chat', css), JSON.stringify(reasons('chat', css))).toBe(true)
    })

    it('names the part, both colours, the ratio and both blocks', () => {
        const why = reasons('chat', `${SEND}{${YELLOW_ON_DARK}}${SEND}:hover{background:#111111}`).find((w) => RULE_S.test(w)) ?? ''
        expect(why).toMatch(/^chat-send: text #111111 can be drawn on #111111 at 1\.00:1 when /)
        expect(why).toContain(`${SEND}{color:#111111}`)
        expect(why).toContain(`${SEND}:hover{background:#111111}`)
        expect(why).toContain('(needs 4.5:1)')
    })

    // T0a-3: the gradient gap (a low block paints a gradient and a light text, a higher block a flat fill and a dark text). Base observed ok:true for A to F.
    // The low block's text (#767676) reads on both the gradient (4.6:1) and the high block's fill (4.5:1), so the gradient is the only hazard: the high block's black text on the black gradient.
    const LOW = (part: string): string => `[data-part="${part}"]{background-image:linear-gradient(#000000,#000000);color:#767676}`
    const HIGH = (selector: string): string => `${selector}{background-color:#ffffff;color:#000000}`
    it.each([
        ['A', 'chat', LOW('chat-send') + HIGH('html [data-part="chat-send"]')],
        ['B', 'chat', LOW('chat-send') + HIGH('[data-part="chat-send"][data-state="x"]')],
        ['C', 'chat', LOW('chat-header') + HIGH('html [data-part="chat-header"]')],
        ['D', 'studio', LOW('studio-side-tab') + HIGH('html [data-part="studio-side-tab"]')],
        ['E', 'studio', LOW('studio-side-tab') + HIGH('[data-part="studio-side-tab"][data-selected]')],
        ['F', 'studio', LOW('studio-lt-focus-undo') + HIGH('html [data-part="studio-lt-focus-undo"]')],
    ] as const)('gradient gap %s (%s)', (_name, area, css) => {
        expect(refusedBySuperset(area, css), JSON.stringify(reasons(area, css))).toBe(true)
    })

    // T0a-5: a background that yields no colour leaves the app's surface under the text (base verdict not observed; reclassify to GUARD if the engine refuses it).
    it.each([
        ['background: none', `${SEND}{background:#ffffff;color:#111111}html ${SEND}{background:none}`],
        ['background-color: transparent', `${SEND}{background:#ffffff;color:#111111}html ${SEND}{background-color:transparent}`],
    ])('%s', (_name, css) => {
        expect(refusedBySuperset('chat', css), JSON.stringify(reasons('chat', css))).toBe(true)
    })

    // T0a-26: a private variable that takes another value under a root attribute is judged in every variant: the plain :root value
    // (#6a6a6a) reads on the yellow fill, the hover-device value (#f0f0f0) does not.
    it('judges every value of a private variable', () => {
        const css = `:root{--pack-t:#6a6a6a}html[data-input="hover"]{--pack-t:#f0f0f0}${SEND}{background:#ffff00;color:#111111}${SEND}:hover{color:var(--pack-t)}`
        expect(refusedBySuperset('chat', css), JSON.stringify(reasons('chat', css))).toBe(true)
        expect(refusedBySuperset('chat', css.replace('#f0f0f0', '#6b6b6b'))).toBe(false)
        expect(lintAreaPack('chat', css.replace('#f0f0f0', '#6b6b6b'), 'probe').ok).toBe(true)
    })
})

describe('Rule S: what stays accepted (GUARD)', () => {
    // T0a-12 and the block-aware fallback: a block that colours both channels is not paired with the app's defaults.
    it('a block that paints its own fill is not judged against the app surfaces', () => {
        expect(lintAreaPack('chat', `${SEND}{${YELLOW_ON_DARK}}`, 'probe').ok).toBe(true)
        expect(lintAreaPack('chat', `${SEND}:focus-visible{background:#fee500;color:#191919}`, 'probe').ok).toBe(true)
        expect(lintAreaPack('chat', `${SEND}{background:#fee500;color:#191919;border-radius:999px}`, 'probe').ok).toBe(true)
        expect(lintAreaPack('studio', '[data-part="studio-item-apply"]{background:#fee500;color:#191919;border-radius:10px}', 'probe').ok).toBe(true)
    })

    it('background-image: none or an image states no fill: it neither clears another declaration\'s colour nor leaves the app surface behind the text', () => {
        expect(lintAreaPack('chat', `${SEND}{background-color:#ffff00;color:#111111;background-image:none}`, 'probe').ok).toBe(true)
        expect(lintAreaPack('chat', `${SEND}{${YELLOW_ON_DARK}}html ${SEND}{background-image:none}`, 'probe').ok).toBe(true)
        // the shorthand and background-color do clear the fill (the T0a-5 rows)
        expect(refusedBySuperset('chat', `${SEND}{${YELLOW_ON_DARK}}html ${SEND}{background:none}`)).toBe(true)
    })

    it('a text colour without a background of its own is judged against the app surfaces', () => {
        expect(cascadePass('chat', `${SEND}{color:#111111}`).length).toBeGreaterThan(0)
        expect(cascadePass('chat', `${SEND}{background:#ffff00}`).length).toBeGreaterThan(0)
    })

    // T0a-13: the same selector and part inside and outside @media with two readable pairs.
    it('two readable pairs of one part, inside and outside @media', () => {
        const css = `${SEND}{${YELLOW_ON_DARK}}@media (min-width:1px){${SEND}{background:#ffffff;color:#191919}}`
        expect(lintAreaPack('chat', css, 'probe').ok).toBe(true)
    })

    it('the fallback colours are not paired with a block that states both channels, in either direction', () => {
        expect(cascadePass('chat', `${SEND}{background:#ffffff;color:#111111}`)).toEqual([])
        expect(cascadePass('chat', `${SEND}{background:#111111;color:#f0f0f0}`)).toEqual([])
    })

    it('judges only the chat and Studio areas', () => {
        expect(cascadePass('settings', `${SEND}{${DARK}}html ${SEND}{background:#ffff00}`)).toEqual([])
        expect(cascadePass('home', `${SEND}{${DARK}}`)).toEqual([])
    })

    it('a stylesheet that colours no reach part has nothing to pair', () => {
        expect(cascadePass('chat', `${SAFE}{${DARK}}`)).toEqual([])
        expect(cascadePass('chat', ':root{--nexus-text:#f0f0f0}')).toEqual([])
    })
})

describe('T0a-7: the acceptance sheets are not refused', () => {
    const SHEETS: [ThemeArea, string][] = [['chat', 'origin-navy'], ['chat', 'banana-cocoa'], ['studio', 'origin-navy'], ['studio', 'banana-cocoa']]
    it.each(SHEETS)('%s %s is accepted and Rule S finds nothing', (area, name) => {
        const css = read(`${area}/themes/${name}.css`)
        expect(cascadePass(area, css)).toEqual([])
        expect(lintAreaPack(area, css, name).errors).toEqual([])
    })

    it('Banana Cocoa hides the user message name with width, height, overflow and opacity and stays accepted (MC-1583)', () => {
        const hidden = '[data-role="user"] [data-part="chat-message-name"] { width: 1px; height: 1px; overflow: hidden; opacity: 0; white-space: nowrap; }'
        expect(read('chat/themes/banana-cocoa.css')).toContain(hidden)
        expect(lintAreaPack('chat', hidden, 'hidden name').ok).toBe(true)
    })

    it('the Settings and Home sheets keep their verdicts', () => {
        for (const area of ['settings', 'home'] as const) {
            for (const name of ['origin-navy', 'banana-cocoa']) expect(lintAreaPack(area, read(`${area}/themes/${name}.css`), name).ok, `${area} ${name}`).toBe(true)
        }
    })
})

describe('Rule R-c: the ancestor padding is judged at the largest value any declaration gives (REPRO)', () => {
    const CHAIN = ['chat-transcript', 'chat-message', 'chat-message-body']
    const blocks = (padding: string): string => CHAIN.map((part) => `[data-part="${part}"]{${padding}}`).join('')
    // T0a-4: the engine read the last value per selector, so a later 1px (inside a media query that never matches, or invalid) hid the 60px the browser keeps. Base observed ok:true for geom-media.
    it.each([
        ['geom-media', `${blocks('padding:0 60px')}@media (min-width:100000px){${blocks('padding:0 1px')}}`],
        ['geom-later-invalid', blocks('padding:0 60px;padding:0 zzz')],
        ['geom-earlier-value (a later rule hides it from the browser, the superset keeps it)', `${blocks('padding:0 60px')}${blocks('padding:0 1px')}`],
        ['geom-important',`${blocks('padding:0 60px !important')}${blocks('padding:0 1px')}`],
        ['geom-border', `${blocks('border:30px solid #ffffff')}@media (min-width:100000px){${blocks('border:0 solid #ffffff')}}`],
    ])('%s', (_name, css) => {
        const result = lintAreaPack('chat', css, 'probe')
        expect(result.ok, JSON.stringify(result.errors.map((e) => e.why))).toBe(false)
        expect(result.errors.some((e) => /ancestor padding along/.test(e.why))).toBe(true)
    })

    it('a small value everywhere stays accepted', () => {
        expect(lintAreaPack('chat', `${blocks('padding:0 4px')}@media (min-width:1px){${blocks('padding:0 2px')}}`, 'probe').ok).toBe(true)
    })
})

describe('Rule S: a background of currentcolor and a text of initial (REPRO)', () => {
    // K1 (Gate 2 F1): currentcolor paints the control's own text colour, and the initial value of color is CanvasText, which an element colour scheme makes black or white. Base observed ok:true for the currentcolor rows and, of the initial rows, for I5, I4, I4b, the header and the @media row; the other initial rows were refused by an earlier pass and fail on the base only for want of Rule S's own reason.
    const OWN_COLOUR = /a background of currentcolor paints the control's own text colour/
    const CANVAS_TEXT_WHY = /color: initial or revert resolves to the system text colour, which depends on the colour scheme; write the colour out/
    const INHERITED_BACKGROUND_WHY = /a background of inherit takes the parent's value, which may be currentcolor/
    it.each([
        ['D3', `${SEND}{color:#ffffff;background-color:currentcolor}`],
        ['D3b', `${SEND}{color:#ffffff;background:currentcolor}`],
        ['D3c', `${SEND}{color:#ffffff;background-image:linear-gradient(currentcolor,currentcolor)}`],
        ['D3d', `${SEND}{color:#ffffff;background-color:#000000}${SEND}:hover{background-color:currentcolor}`],
        ['D3f (the header)', '[data-part="chat-header"]{color:#ffffff;background-color:currentcolor}'],
        ['D3g (no text colour of its own)', `${SEND}{background-color:currentcolor}`],
        ['D3j (a selector list)', `${SEND},[data-part="chat-header"]{color:#ffffff;background-color:currentcolor}`],
        ['D3l (important)', `${SEND}{color:#ffffff !important;background-color:currentcolor !important}`],
        ['K8 (through a private variable)', `:root{--pack-c:currentcolor}${SEND}{color:#ffffff;background-color:var(--pack-c)}`],
        ['K10', `${SEND}{background:currentcolor}`],
    ])('%s: currentcolor as a background is refused', (_name, css) => {
        expect(refusedBySuperset('chat', css), JSON.stringify(reasons('chat', css))).toBe(true)
        expect(reasons('chat', css).some((why) => OWN_COLOUR.test(why)), JSON.stringify(reasons('chat', css))).toBe(true)
    })

    it.each([
        ['K7', `${SEND}{color-scheme:light;color:initial;background-color:#000000}`],
        ['K1', `:root{color-scheme:light}${SEND}{color:initial;background-color:#000000}`],
        ['revert', `${SEND}{color:revert;background-color:#000000}`],
        ['revert-layer', `${SEND}{color:revert-layer;background-color:#000000}`],
        ['INITIAL', `${SEND}{color:INITIAL;background-color:#000000}`],
        ['I5 (no background of its own)', `${SEND}{color-scheme:light;color:initial}`],
        ['I4', `:root{color-scheme:light}${SEND}{color:initial}`],
        ['I4b', `:root{--color-scheme:light}${SEND}{color:initial}`],
        ['important', `${SEND}{color:initial !important}`],
        ['through a private variable', `:root{--pack-c:initial}${SEND}{color:var(--pack-c)}`],
        ['in @media', `@media (min-width:1px){${SEND}{color:initial}}`],
        ['in a state block', `${SEND}:hover{color:revert}`],
        ['the header', '[data-part="chat-header"]{color:initial}'],
    ])('%s: color initial or revert is refused for the system text colour', (_name, css) => {
        // the engine refuses some spellings first (a private variable of initial, revert-layer), so the reason is read from Rule S itself
        expect(lintAreaPack('chat', css, 'probe').ok, JSON.stringify(reasons('chat', css))).toBe(false)
        expect(cascadePass('chat', css).some((e) => CANVAS_TEXT_WHY.test(e.why)), JSON.stringify(cascadePass('chat', css))).toBe(true)
    })
    it('K7 and K1 are refused by Rule S itself, not only by the engine', () => {
        expect(cascadePass('chat', `${SEND}{color-scheme:light;color:initial;background-color:#000000}`).length).toBeGreaterThan(0)
        expect(cascadePass('chat', `:root{color-scheme:light}${SEND}{color:initial;background-color:#000000}`).length).toBeGreaterThan(0)
    })
    it('GUARD: color inherit or unset on a reach part with no background stays accepted', () => {
        for (const keyword of ['inherit', 'unset']) expect(lintAreaPack('chat', `${SEND}{color:${keyword}}`, 'probe').ok, keyword).toBe(true)
    })

    // E-r2-3: inherit takes the parent's computed value, which may be the keyword currentcolor.
    it.each([
        ['H1 background-color', '[data-part="chat-composer-row"]{background-color:currentcolor}[data-part="chat-send"]{color:#ffffff;background-color:inherit}'],
        ['background', `${SEND}{color:#ffffff;background:inherit}`],
        ['background-image', `${SEND}{color:#ffffff;background-image:inherit}`],
        ['INHERIT in a state block', `${SEND}{color:#ffffff;background:#000000}${SEND}:hover{background-color:INHERIT}`],
    ])('%s: a background of inherit is refused', (_name, css) => {
        expect(refusedBySuperset('chat', css), JSON.stringify(reasons('chat', css))).toBe(true)
        expect(reasons('chat', css).some((why) => INHERITED_BACKGROUND_WHY.test(why)), JSON.stringify(reasons('chat', css))).toBe(true)
    })
    it.each(['transparent', 'none'])('GUARD: background %s next to a readable text stays accepted', (value) => {
        expect(lintAreaPack('chat', `${SEND}{color:#ffffff;background:${value}}`, 'probe').ok, value).toBe(true)
    })
})

describe('Rule S: what stays as it was for backgrounds and texts that state no colour (GUARD)', () => {
    // none, initial and transparent leave the app's surfaces behind the text, and inherit, unset and currentcolor on color leave the app's text colour
    it.each([
        ['background: none', `${SEND}{background:#ffffff;color:#111111}html ${SEND}{background:none}`],
        ['background-color: initial', `${SEND}{background:#ffffff;color:#111111}html ${SEND}{background-color:initial}`],
        ['background-color: transparent', `${SEND}{background:#ffffff;color:#111111}html ${SEND}{background-color:transparent}`],
    ])('%s still gives the fallback surfaces and never the own-colour reason', (_name, css) => {
        expect(refusedBySuperset('chat', css), JSON.stringify(reasons('chat', css))).toBe(true)
        expect(reasons('chat', css).some((why) => /currentcolor/.test(why))).toBe(false)
    })

    it.each(['inherit', 'unset', 'currentcolor'])('color: %s keeps the app text colour and is accepted next to a dark fill', (keyword) => {
        const css = `${SEND}{color:${keyword};background:#000000}`
        expect(cascadePass('chat', css), css).toEqual([])
    })

    it('an explicit hex background keeps its verdict', () => {
        expect(lintAreaPack('chat', `${SEND}{color:#ffffff;background-color:#000000}`, 'probe').ok).toBe(true)
        expect(cascadePass('chat', `${SEND}{color:#ffffff;background-color:#000000}`)).toEqual([])
        expect(cascadePass('chat', `${SEND}{color:#ffffff;background-color:#ffffff}`).length).toBeGreaterThan(0)
    })
})

describe('Rule S: a translucent pack fill is judged at the text bar (MC-1626)', () => {
    // rgba(0,0,0,0.5) flattened over the app's four surfaces is #00010e, #070815 and #040411: the text #646464 reads on them at 3.37:1 to 3.52:1, over 3:1 and under 4.5:1.
    it('REPRO: a text at 3.37:1 to 3.52:1 on the flattened fill is refused (base ok:true at the 3:1 bar)', () => {
        const css = `${SEND}{background:rgba(0,0,0,0.5);color:#646464}`
        expect(lintAreaPack('chat', css, 'probe').errors.some((e) => RULE_S.test(e.why)), JSON.stringify(reasons('chat', css))).toBe(true)
        expect(reasons('chat', css).some((why) => /at 3\.[345]\d:1/.test(why))).toBe(true)
    })

    it('GUARD: the same fill with a text at 4.5:1 or above stays accepted', () => {
        const css = `${SEND}{background:rgba(0,0,0,0.5);color:#787878}`
        expect(cascadePass('chat', css)).toEqual([])
        expect(lintAreaPack('chat', css, 'probe').ok).toBe(true)
    })

    // The app text colour (rgb(255 255 255 / 0.92) over the canvas) on rgba(255,255,255,0.45) flattened over the canvas, sheet and glass surfaces reads at 3.90:1, 3.49:1 and 3.67:1.
    it('REPRO: the app text colour at 3.49:1 to 3.90:1 on a flattened fill is refused (base ok:true at the 3:1 bar)', () => {
        const css = `${SEND}{background:rgba(255,255,255,0.45)}`
        expect(lintAreaPack('chat', css, 'probe').errors.some((e) => RULE_S.test(e.why)), JSON.stringify(reasons('chat', css))).toBe(true)
        expect(reasons('chat', css).some((why) => /at 3\.\d\d:1 when the app's own text colour/.test(why))).toBe(true)
    })

    // a text that falls back to the app's own colour in the same block as the translucent fill is judged at the same bar
    it.each(['inherit', 'unset'])('GUARD (kills the 3:1 bar): color %s next to a translucent fill is refused at 3.xx:1', (keyword) => {
        const css = `${SEND}{color:${keyword};background:rgba(255,255,255,0.45)}`
        expect(refusedBySuperset('chat', css), JSON.stringify(reasons('chat', css))).toBe(true)
        if (keyword === 'inherit') expect(reasons('chat', css).some((why) => /at 3\.\d\d:1 when the app's own text colour \(/.test(why))).toBe(true)
    })

    it('GUARD: the app text colour at 4.5:1 or above on a flattened fill stays accepted', () => {
        const css = `${SEND}{background:rgba(0,0,0,0.5)}`
        expect(cascadePass('chat', css)).toEqual([])
        expect(lintAreaPack('chat', css, 'probe').ok).toBe(true)
    })
})

describe('Rule R-c: padding-inline and the side border shorthands count per side (REPRO)', () => {
    const SHEET = '[data-part="chat-sheet"]', SHEET_BODY = '[data-part="chat-sheet-body"]'
    const MESSAGE = '[data-part="chat-message"]', STAGE = '[data-part="chat-message-stage"]'
    const both = (a: string, b: string, declaration: string): string => `${a}{${declaration}}${b}{${declaration}}`
    const sumsOver = (css: string): boolean => {
        const result = lintAreaPack('chat', css, 'probe')
        return !result.ok && result.errors.some((e) => /ancestor padding along/.test(e.why))
    }
    // base observed ok:true for G20, G22, G24, G26, G41, G43 and G44
    it.each([
        ['G20 padding-inline: 0 64px', both(SHEET, SHEET_BODY, 'padding-inline:0 64px')],
        ['G41 padding-inline: 0px 64px', both(SHEET, SHEET_BODY, 'padding-inline:0px 64px')],
        ['G43 padding-inline through a private variable', `:root{--pack-p:0 64px}${both(SHEET, SHEET_BODY, 'padding-inline:var(--pack-p)')}`],
        ['G22 the transcript chain', both(MESSAGE, STAGE, 'padding-inline:0 64px')],
        ['G24 border-right shorthand', both(SHEET, SHEET_BODY, 'border-right:60px solid #000000')],
        ['G26 border-left shorthand', both(MESSAGE, STAGE, 'border-left:60px solid #000000')],
        ['G44 border-left plus padding-inline', both(SHEET, SHEET_BODY, 'border-left:16px solid #000000;padding-inline:0 64px')],
        ['border-inline shorthand', both(SHEET, SHEET_BODY, 'border-inline:40px solid #000000')],
    ])('%s', (_name, css) => {
        expect(sumsOver(css), JSON.stringify(reasons('chat', css))).toBe(true)
    })

    // the engine refuses these spellings on a chain part before the geometry pass runs, so the pass is called with a chain of its own
    const chain = { chains: [{ name: 'test chain', parts: ['test-a', 'test-b'], budget: 100 }] }
    const geometryRefuses = (declaration: string): boolean => geometryPass(normalise(`[data-part="test-a"]{${declaration}}[data-part="test-b"]{${declaration}}`), chain).length > 0
    it.each([
        'border-inline-end:60px solid #000000', 'border-inline-start:60px solid #000000', 'border-inline-width:0 60px', 'border-inline-width:60px 0', 'border-inline-start-width:60px', 'border-inline-end-width:60px',
        'border-width:0 60px 0 0', 'border-width:0 0 0 60px', 'border-width:0 60px', 'border-left-width:60px', 'border-right-width:60px', 'border-inline:60px solid #000000', 'padding-inline:60px 0', 'padding-inline-start:60px',
    ])('the geometry pass counts %s on the side it widens', (declaration) => {
        expect(geometryRefuses(declaration), declaration).toBe(true)
    })

    it('the geometry pass adds the two sides and keeps symmetric spellings within the budget', () => {
        expect(geometryRefuses('border-width:40px 10px')).toBe(false)
        expect(geometryRefuses('padding-inline:20px 20px')).toBe(false)
        expect(geometryRefuses('border-inline-width:10px 20px')).toBe(false)
        // the sides are summed (30 + 10 per part, 80 px over two parts), not doubled from the larger side (120 px)
        expect(geometryRefuses('border-left:30px solid #000000;border-right:10px solid #000000')).toBe(false)
        expect(geometryRefuses('border-left:60px solid #000000;border-right:10px solid #000000')).toBe(true)
    })
    it('G21 and G42 (the same layouts written as padding-right and padding-inline-end) stay refused', () => {
        expect(sumsOver(both(SHEET, SHEET_BODY, 'padding-right:64px'))).toBe(true)
        expect(sumsOver(both(SHEET, SHEET_BODY, 'padding-inline-end:64px'))).toBe(true)
    })

    // the inset belongs to the part: sides, borders and conditional blocks written in separate rules that all apply add together
    const split = (a: string, b: string, first: string, second: string, secondSelector: (part: string) => string = (part) => `html ${part}`): string => `${a}{${first}}${secondSelector(a)}{${second}}${b}{${first}}${secondSelector(b)}{${second}}`
    it.each([
        ['P12 two sides in two blocks', split(SHEET, SHEET_BODY, 'padding-left:40px', 'padding-right:40px')],
        ['P12b the second block under :hover', split(SHEET, SHEET_BODY, 'padding-left:40px', 'padding-right:40px', (part) => `${part}:hover`)],
        ['P12c padding and border in two blocks', split(SHEET, SHEET_BODY, 'padding-right:50px', 'border-right:50px solid #000000')],
        ['T9 a conditional block that states less than the default', `${SHEET}{padding-inline:60px}${SHEET_BODY}:hover{padding:0}`],
    ])('%s is summed over the part', (_name, css) => {
        expect(sumsOver(css), JSON.stringify(reasons('chat', css))).toBe(true)
    })
    it('P12d (one block per part) stays refused and a within-budget split stays accepted', () => {
        expect(sumsOver(both(SHEET, SHEET_BODY, 'padding-left:40px;padding-right:40px'))).toBe(true)
        expect(lintAreaPack('chat', split(SHEET, SHEET_BODY, 'padding-left:20px', 'padding-right:20px'), 'probe').ok).toBe(true)
    })

    it('a padding-inline and a border within the budget stay accepted', () => {
        expect(lintAreaPack('chat', both(SHEET, SHEET_BODY, 'padding-inline:0 8px'), 'probe').ok).toBe(true)
        expect(lintAreaPack('chat', both(SHEET, SHEET_BODY, 'border-right:2px solid #000000;padding-inline:4px 4px'), 'probe').ok).toBe(true)
    })
})
// Round 4 of Rule R-c (UI-S6 I0a, DD-260, MC-1630): the reader measures every padding, margin and border declaration that names a part of a judged chain, per side, and refuses what it cannot measure.
// REPRO rows were accepted before round 4 and are refused now; GUARD rows give the same verdict before and after. The generated spelling matrix is in geometryMatrix.test.ts.
describe('Rule R-c, round 4', () => {
    const SHEET = '[data-part="chat-sheet"]', BODY = '[data-part="chat-sheet-body"]'
    const MESSAGE = '[data-part="chat-message"]', STAGE = '[data-part="chat-message-stage"]'
    const SHELL = '[data-part="chat-shell"]', HOST = '[data-part="chat-composer-host"]'
    const both = (declaration: string, a: string = SHEET, b: string = BODY): string => `${a}{${declaration}}${b}{${declaration}}`
    const CHAIN = {
        sheet: /ancestor padding along the sheet chain \([^)]*\) sums to (\d+) px/,
        transcript: /ancestor padding along the transcript chain \([^)]*\) sums to (\d+) px/,
        failed: /ancestor padding along the failed-card chain \([^)]*\) sums to (\d+) px/,
    } as const
    // the sum a chain reports in the verdict of lintAreaPack, null when the verdict does not name the chain
    const sumOf = (css: string, chain: keyof typeof CHAIN): number | null => {
        for (const why of reasons('chat', css)) {
            const match = CHAIN[chain].exec(why)
            if (match) return Number(match[1])
        }
        return null
    }
    const refusedAt = (css: string, chain: keyof typeof CHAIN, sum: number): void => {
        expect(lintAreaPack('chat', css, 'probe').ok, css).toBe(false)
        expect(sumOf(css, chain), JSON.stringify(reasons('chat', css))).toBe(sum)
    }
    // a chain of the test's own, for the rows the engine refuses on a plain chain-part selector before the geometry pass runs
    const direct = (declaration: string, budget: number): string[] => geometryPass(normalise(`[data-part="test-a"]{${declaration}}[data-part="test-b"]{${declaration}}`), { chains: [{ name: 'test chain', parts: ['test-a', 'test-b'], budget }] }).map((e) => e.why)

    describe('the per-side reader (REPRO)', () => {
        // T-3a to T-3m: the sheet and transcript chains, whose parts sum to 120 px at most (the body's own 20 px included)
        it.each([
            ['G1 padding-inline:60px !important (S1-r3: a space before !important read as 0)', both('padding-inline:60px !important'), 'sheet', 240],
            ['G2 padding:40px !important (S1-r3)', both('padding:40px !important'), 'sheet', 160],
            ['G20 a private variable with !important (S1-r3)', `:root{--pack-p:40px}${both('padding:var(--pack-p) !important')}`, 'sheet', 160],
            ['J7 a shorthand for the right side and a longhand for the left (S2-r3)', both('padding:0 60px 0 0;padding-left:60px'), 'sheet', 240],
            ['J7b the same in two blocks', `${SHEET}{padding:0 60px 0 0}html ${SHEET}{padding-left:60px}${BODY}{padding:0 60px 0 0}html ${BODY}{padding-left:60px}`, 'sheet', 240],
            ['J7c a shorthand and padding-inline-start', both('padding:0 60px 0 0;padding-inline-start:60px'), 'sheet', 240],
            ['J7f the same at 40 px', both('padding:0 40px 0 0;padding-left:40px'), 'sheet', 160],
            ['padding-inline:+60px', both('padding-inline:+60px'), 'sheet', 240],
            ['H2 one side of each part (the body floor fills the other)', `${SHEET}{padding-left:60px}${BODY}{padding-left:56px}`, 'sheet', 126],
            ['RTL1 a physical left and a logical start', both('padding-left:40px;padding-inline-start:40px'), 'sheet', 160],
            ['border:thick solid with 28 px padding', both('border:thick solid #000000;padding-inline:28px'), 'sheet', 132],
            ['border-style:solid with 28 px padding counts the medium width', both('border-style:solid;padding-inline:28px'), 'sheet', 124],
            ['border-style:solid and border-width:initial', both('border-style:solid;border-width:initial;padding-inline:28px'), 'sheet', 124],
            ['margin-inline:30px on the sheet chain (margins count)', both('margin-inline:30px'), 'sheet', 140],
            ['margin-inline:30px on the transcript chain', both('margin-inline:30px', MESSAGE, STAGE), 'transcript', 158],
        ] as const)('%s', (_name, css, chain, sum) => {
            refusedAt(css, chain, sum)
        })

        // T-3u: a visible border style counts the medium width whatever width any rule states, so a 1 px border written as a style and a width is read at 3 px a side. An intended over-refusal (R17).
        it.each([
            ['style and one width', 'border-style:solid;border-width:1px'],
            ['style and two widths', 'border-style:solid;border-width:0 1px'],
            ['style and three widths', 'border-style:solid;border-width:0 1px 0'],
            ['style and four widths', 'border-style:solid;border-width:0 1px 0 1px'],
            ['style and side widths', 'border-style:solid;border-left-width:1px;border-right-width:1px'],
            ['side styles and one width', 'border-left-style:solid;border-right-style:solid;border-width:1px'],
            ['the right width in a four-value width and the left width', 'border-style:solid;border-width:0 1px 0 0;border-left-width:1px'],
        ])('T-3u %s with 28 px padding is read at 124 px', (_name, border) => {
            refusedAt(both(`${border};padding-inline:28px`), 'sheet', 124)
        })

        // T-3t, T-3n, T-3o and H1: a value the reader cannot measure is refused, never read as 0
        it.each([
            ['H1 inherit on the body', `${SHEET}{padding-inline:50px}${BODY}{padding-inline:inherit}`, /^padding-inline: inherit cannot be measured on chat-sheet-body/],
            ['T-3t padding-inline:auto', `${SHEET}{padding-inline:auto}`, /^padding-inline: auto cannot be measured on chat-sheet/],
            ['T-3t padding-inline:large', `${SHEET}{padding-inline:large}`, /^padding-inline: large cannot be measured on chat-sheet/],
            ['T-3n padding-inline:revert', `${SHEET}{padding-inline:revert}`, /^padding-inline: revert cannot be measured on chat-sheet/],
            ['T-3o a five-value padding', both('padding:1px 2px 3px 4px 5px'), /^padding: 1px 2px 3px 4px 5px cannot be measured on chat-sheet/],
            ['T-3n padding-left-start is not a CSS property', both('padding-left-start:60px'), /^padding-left-start is not a CSS property, so it cannot be measured on chat-sheet/],
            ['a margin of revert', `${SHEET}{margin-left:revert}`, /^margin-left: revert cannot be measured on chat-sheet/],
        ] as const)('%s', (_name, css, reason) => {
            expect(lintAreaPack('chat', css, 'probe').ok, css).toBe(false)
            expect(reasons('chat', css).some((why) => reason.test(why)), JSON.stringify(reasons('chat', css))).toBe(true)
        })

        // T-3r: a percentage is a share of the 360 px page, not a flat 20%: 10% on the sheet alone is 72 px plus the body's 20 px (92 px)
        it('T-3r padding-inline:10% on the sheet alone is within the budget', () => {
            expect(lintAreaPack('chat', `${SHEET}{padding-inline:10%}`, 'probe').ok).toBe(true)
        })

        // T-3o: the engine refuses the logical border names for a plain chain-part selector, so the pass is called with a chain of its own. Each row has its exact sum: the pair counts both sides (12), a start or an end row one side (6).
        it.each([
            ['border-inline-style:solid', 12],
            ['border-inline-start-style:solid', 6],
            ['border-inline-end-style:solid', 6],
        ] as const)('T-3o %s counts the medium width on the side it sets', (declaration, sum) => {
            expect(direct(declaration, sum)).toEqual([])
            const whys = direct(declaration, sum - 1)
            expect(whys).toHaveLength(1)
            expect(whys[0]).toMatch(new RegExp(`^ancestor padding along test chain sums to ${sum} px of 360`))
        })
        it('T-3o a five-value padding is unreadable on a chain of its own', () => {
            expect(direct('padding:1px 2px 3px 4px 5px', 100).some((why) => /^padding: 1px 2px 3px 4px 5px cannot be measured on test-a/.test(why))).toBe(true)
        })
    })

    describe('the failed card\'s chain on the live shell (REPRO)', () => {
        // The failed card mounts in chat-composer-host, an ancestor of no CHAT_CHAINS entry: chat-shell > chat-composer-host is judged after every other pass accepts the sheet.
        it.each([
            ['F1 padding-inline:64px on the host', `${HOST}{padding-inline:64px}`, 128],
            ['T-3s (a) a border-style that wins by !important, then a width, then border:none', `${SHELL}{padding-inline:3px}${HOST}{padding-inline:56px;border-style:solid !important;border-width:1px;border:none}`, 124],
            ['T-3s (b) the left side only', `${SHELL}{padding-inline:3px}${HOST}{padding-inline:56px;border-left-style:solid !important;border-left-width:1px;border-left:#000000}`, 121],
            ['T-3s (c) a width inside an @media that never matches', `${SHELL}{padding-inline:2px}${HOST}{padding-inline:56px;border-style:solid}@media (min-width: 9999px){${HOST}{border-width:1px}}`, 122],
            ['an app token on the host: var(--space-16) is 24 px a side', `${SHELL}{padding-inline:40px}${HOST}{padding-inline:var(--space-16)}`, 128],
            ['margins count on the host', `${SHELL}{margin-inline:30px}${HOST}{margin-inline:31px}`, 122],
        ] as const)('%s', (_name, css, sum) => {
            refusedAt(css, 'failed', sum)
        })

        // E-r4-1: a private variable that takes 10 px unconditionally and 64 px inside an @media reaches the live pass in every variant, so the host is counted at the larger value
        it('REPRO: PV1 a private variable of 10 px and, inside @media, 64 px is counted at 64 px a side on the host', () => {
            refusedAt(`:root{--pack-p:10px}@media (min-width:1px){:root{--pack-p:64px}}${HOST}{padding-inline:var(--pack-p)}`, 'failed', 128)
        })
        // Every private-variable variant is judged on its own, so two variants that are both over budget are both reported (the token range caps a spacing value at 64 px, so 63 px and 64 px are the largest pair).
        it('REPRO: PV2 a private variable of 63 px and, inside @media, 64 px is reported at both sums', () => {
            const css = `:root{--pack-p:63px}@media (min-width:1px){:root{--pack-p:64px}}${HOST}{padding-inline:var(--pack-p)}`
            const sums = reasons('chat', css).flatMap((why) => { const match = CHAIN.failed.exec(why); return match ? [Number(match[1])] : [] })
            expect(sums.sort((a, b) => a - b)).toEqual([126, 128])
        })
    })

    describe('the live pass runs only on a sheet every other pass accepted (GUARD)', () => {
        // so a refusal of Rule S or Rule SCOPE never gains a geometry error, and the SCOPE entries of the parity corpus stay MC-1586 only
        it('REPRO: a sheet refused by Rule S alone carries no live-chain error, with a host that would be refused', () => {
            const css = `${SEND}{${YELLOW_ON_DARK}}html ${SEND}{background:#111111}${HOST}{padding-inline:64px}`
            const errors = lintAreaPack('chat', css, 'probe').errors
            expect(errors.length).toBeGreaterThan(0)
            expect(errors.every((e) => RULE_S.test(e.why)), JSON.stringify(errors.map((e) => e.why))).toBe(true)
            expect(lintAreaPack('chat', `${HOST}{padding-inline:64px}`, 'probe').ok).toBe(false)
        })
        it('a sheet refused by Rule SCOPE alone carries no live-chain error, with a host that would be refused', () => {
            const css = `[data-part="home-shell"]{color:#ffffff}${HOST}{padding-inline:64px}`
            const errors = lintAreaPack('chat', css, 'probe').errors
            expect(errors.length).toBeGreaterThan(0)
            expect(errors.every((e) => /MC-1586/.test(e.why)), JSON.stringify(errors.map((e) => e.why))).toBe(true)
        })
        it('the failed card\'s chain is judged for chat only', () => {
            for (const area of ['settings', 'studio', 'home'] as const) {
                const errors = lintAreaPack(area, `${HOST}{padding-inline:64px}`, 'probe').errors
                expect(errors.some((e) => CHAIN.failed.test(e.why)), area).toBe(false)
            }
        })
        it('an app token that fits (var(--space-8) is 10 px a side) is accepted', () => {
            expect(lintAreaPack('chat', `${SHELL}{padding-inline:40px}${HOST}{padding-inline:var(--space-8)}`, 'probe').ok).toBe(true)
        })
    })

    describe('a colour word in a border line shorthand', () => {
        // A word in a border line is the colour only when the engine accepts it as one; any other word, a second colour, a second width or a second style cannot be measured.
        it.each([
            ['an unknown word', 'wibble'],
            ['a five-digit hex', '#abcde'],
            ['a second colour word', 'red blue'],
            ['a second width', '2px red'],
            ['a second style', 'dashed red'],
        ])('REPRO: %s is refused as unmeasurable', (_name, tail) => {
            const css = `${SHEET}{border:1px solid ${tail}}`
            expect(lintAreaPack('chat', css, 'probe').ok, css).toBe(false)
            expect(reasons('chat', css).some((why) => /^border: .* cannot be measured on chat-sheet/.test(why)), JSON.stringify(reasons('chat', css))).toBe(true)
        })
        it.each(['red', 'canvastext', 'transparent', 'currentcolor', '#abc', '#aabbcc', '#aabbccdd'])('GUARD: the colour %s is accepted', (colour) => {
            const css = `${SHEET}{border:1px solid ${colour}}`
            expect(lintAreaPack('chat', css, 'probe').ok, `${css} ${JSON.stringify(reasons('chat', css))}`).toBe(true)
        })
    })

    describe('what stays accepted and refused as before (GUARD; the E-4b margin case is a REPRO)', () => {
        // The page's own 1 px sheet border and token padding are no part of the judged chains (CHORE-739), so 30 px a side on both sheet parts is the 120 px budget exactly.
        it.each([
            ['29 px a side on both sheet parts', both('padding-inline:29px')],
            ['30 px a side on both sheet parts (the engine chain is 120 px)', both('padding-inline:30px')],
            ['30 px on the sheet body alone', `${BODY}{padding-inline:30px}`],
            ['padding-inline:20px !important on both parts', both('padding-inline:20px !important')],
            ['padding-inline:20px!important with no space', both('padding-inline:20px!important')],
            ['margin:0 auto 8px on chat-message', `${MESSAGE}{margin:0 auto 8px}`],
            ['margin-inline:auto on the composer host', `${HOST}{margin-inline:auto}`],
            ['margin-inline:30px on the host and the shell (120 px, not over)', `${SHELL}{margin-inline:30px}${HOST}{margin-inline:30px}`],
        ])('%s is accepted', (_name, css) => {
            expect(lintAreaPack('chat', css, 'probe').ok, `${css} ${JSON.stringify(reasons('chat', css))}`).toBe(true)
        })

        // a 1 px border written as a line shorthand is read at its stated width: 28 px padding and 1 px a side is 116 px
        it.each([
            ['border shorthand', both('border:1px solid #000000;padding-inline:28px')],
            ['border shorthand reversed', both('border:solid 1px #000000;padding-inline:28px')],
            ['side shorthands', both('border-left:1px solid #000000;border-right:1px solid #000000;padding-inline:28px')],
            ['a zero line and side widths', both('border:0 solid #000000;border-left-width:1px;border-right-width:1px;padding-inline:28px')],
        ])('a 1 px border as %s with 28 px padding stays accepted', (_name, css) => {
            expect(lintAreaPack('chat', css, 'probe').ok, `${css} ${JSON.stringify(reasons('chat', css))}`).toBe(true)
        })

        // rows the earlier reader already refused, which the new reader keeps refusing at the same sum
        it.each([
            ['J7e a shorthand for both sides stays refused at 240 px', both('padding:0 60px'), 240],
            ['G1b padding-inline:60px!important with no space stays refused at 240 px', both('padding-inline:60px!important'), 240],
            ['padding-inline:10px 60px on both parts stays refused at 140 px', both('padding-inline:10px 60px'), 140],
            ['T-3q padding-inline:20% on the sheet alone (72 px a side) stays refused at 164 px', `${SHEET}{padding-inline:20%}`, 164],
            ['T-3p all in @media, 40 px a side on both parts, stays refused at 160 px', `@media (min-width:1px){${both('padding-left:40px;padding-right:40px')}}`, 160],
            ['T-3p the left sides inside @media and the right sides outside stay refused at 160 px', `@media (min-width:1px){${SHEET}{padding-left:40px}${BODY}{padding-left:40px}}${SHEET}{padding-right:40px}${BODY}{padding-right:40px}`, 160],
        ] as const)('%s', (_name, css, sum) => {
            refusedAt(css, 'sheet', sum)
        })

        // T-3o: the logical border rows were counted before round 4 and still are, on the side they set: the pair rows count both sides of both parts (240), a start or an end row one side of each (120)
        it.each([
            ['border-inline:60px solid #000000', 240], ['border-inline-start:60px solid #000000', 120], ['border-inline-end:60px solid #000000', 120],
            ['border-inline-width:60px', 240], ['border-inline-start-width:60px', 120], ['border-inline-end-width:60px', 120],
        ] as const)('T-3o %s is summed over the two parts and not refused as unreadable', (declaration, sum) => {
            expect(direct(declaration, sum)).toEqual([])
            const whys = direct(declaration, sum - 1)
            expect(whys).toHaveLength(1)
            expect(whys[0]).toMatch(new RegExp(`^ancestor padding along test chain sums to ${sum} px of 360`))
        })

        // a negative margin widens the box, so it counts 0 (no tier admits one on a chain part, so the pass is called with a chain of its own)
        it('a negative margin counts 0', () => {
            expect(direct('margin-inline:-60px', 100)).toEqual([])
            expect(direct('margin-inline:-60px 30px', 100)).toEqual([])
        })

        // padding-inline:initial reads 0 (the body floor of 20 px is the sheet chain's only padding), so a margin filler that brings the chain to exactly 120 px leaves it accepted, and one px more refuses it
        it('GUARD: padding-inline:initial on both sheet parts reads 0 at the edge of the sheet chain\'s budget', () => {
            expect(lintAreaPack('chat', `${SHEET}{margin-inline:50px}${both('padding-inline:initial')}`, 'probe').ok).toBe(true)
        })
        it('REPRO: one px more margin on the same sheet is refused at 121 px, so the initial padding added nothing (base: margins not counted)', () => {
            refusedAt(`${SHEET}{margin-inline:50px 51px}${both('padding-inline:initial')}`, 'sheet', 121)
        })

        // The reader keeps every alternative of a private variable and the largest per place, whichever order the declarations come in. The engine refuses a conditional token itself, so the pass is called on a chain of one part.
        it.each([
            ['the unconditional value first', ':root{--pack-p:10px}@media (min-width:1px){:root{--pack-p:64px}}'],
            ['the conditional value first', '@media (min-width:1px){:root{--pack-p:64px}}:root{--pack-p:10px}'],
        ])('GUARD: a private variable of 10 px and, inside @media, 64 px is counted at 64 px a side (%s)', (_name, tokens) => {
            const css = `${tokens}[data-part="test-a"]{padding-inline:var(--pack-p)}`
            const judged = (budget: number): string[] => geometryPass(normalise(css), { chains: [{ name: 'test chain', parts: ['test-a'], budget }] }).map((e) => e.why)
            expect(judged(127)).toHaveLength(1)
            expect(judged(127)[0]).toMatch(/^ancestor padding along test chain sums to 128 px of 360/)
            expect(judged(128)).toEqual([])
        })

        it('Banana Cocoa\'s chat sheet, with its max-width of 92% and fit-content, stays accepted', () => {
            const css = read('chat/themes/banana-cocoa.css')
            expect(css).toContain('max-width: 92%')
            expect(css).toContain('width: fit-content')
            expect(lintAreaPack('chat', css, 'banana-cocoa').errors).toEqual([])
        })
    })
})

// Rule P (CHORE-738, MC-2072, MC-2090): paint over a control. Classes: REPRO = pipeline-accepted (ok:true) before this stage, refused now;
// SEAM REPRO = cascadePass gives no Rule P reason before this stage and one now; GUARD = same verdict before and after.
describe('Rule P: painting over a control', () => {
    const RULE_P = /MC-2072/
    const APPLY = '[data-part="studio-item-apply"]'
    const SIDE_TAB = '[data-part="studio-side-tab"]'
    const WHITE_ON_BLACK_TEXT = 'background:#ffffff;color:#000000'
    // no text colour is set anywhere: the app's own text colour is what the overlay pairs with
    const APP_TEXT = ''
    const refusedByPaintOver = (area: ThemeArea, css: string): boolean => {
        const result = lintAreaPack(area, css, 'probe')
        return !result.ok && result.errors.some((e) => RULE_P.test(e.why))
    }
    const acceptedPack = (area: ThemeArea, css: string): boolean => lintAreaPack(area, css, 'probe').ok
    const seam = (area: ThemeArea, css: string): string[] => cascadePass(area, css).map((e) => e.why).filter((why) => RULE_P.test(why))
    const send = (declarations: string): string => `${SEND}{${YELLOW_ON_DARK};${declarations}}`
    const inset = (declarations: string): string => `${SEND}{${WHITE_ON_BLACK_TEXT};${declarations}}`
    const thick = (value: string): string => send(`text-decoration:line-through;text-decoration-color:#ffff00;text-decoration-thickness:${value}`)
    const hex2 = (n: number): string => n.toString(16).padStart(2, '0')
    // `fills` hover blocks, each with its own fill and one translucent inset: fills x fills translucent pairs
    const hoverBlocks = (count: number): string => Array.from({ length: count }, (_v, i) => `${SEND}:hover{background:#ffff${hex2(i + 1)};color:#111111;box-shadow:inset 0 0 0 1px rgb(255 255 ${i + 1} / 0.5)}`).join('')

    describe('P1 an inset box-shadow (REPRO)', () => {
        it.each([
            ['R1a plain', 'chat', inset('box-shadow:inset 0 0 0 64px #000000')],
            ['R1b second block', 'chat', `${SEND}{${WHITE_ON_BLACK_TEXT}}html ${SEND}{box-shadow:inset 0 0 0 64px #000000}`],
            ['R1c :hover', 'chat', `${SEND}{${WHITE_ON_BLACK_TEXT}}${SEND}:hover{box-shadow:inset 0 0 0 64px #111111}`],
            ['R1d @media', 'chat', `${SEND}{${WHITE_ON_BLACK_TEXT}}@media (min-width:1px){html ${SEND}{box-shadow:inset 0 0 0 64px #000000}}`],
            ['R1e --pack- variant', 'chat', `:root{--pack-s:0 1px 2px #000000}html[data-input="hover"]{--pack-s:inset 0 0 0 64px #000000}${inset('box-shadow:var(--pack-s)')}`],
            ['R1f second layer', 'chat', inset('box-shadow:0 1px 2px #000000,inset 0 0 0 64px #000000')],
            ['R1g inset written last', 'chat', inset('box-shadow:0 0 0 64px #000000 inset')],
            ['R1h currentcolor', 'chat', inset('box-shadow:inset 0 0 0 64px currentcolor')],
            ['R1h no colour', 'chat', inset('box-shadow:inset 0 0 0 64px')],
            ['R1i translucent 1.66:1', 'chat', inset('box-shadow:inset 0 0 0 64px rgb(0 0 0 / 0.8)')],
            ['R1j stacked layers', 'chat', inset(`box-shadow:${Array(3).fill('inset 0 0 0 64px rgb(0 0 0 / 0.4)').join(',')}`)],
            ['R1k app-text pairing, none set', 'chat', `${APP_TEXT}${SEND}{background:#111111}${SEND}:hover{box-shadow:inset 0 0 0 64px #e0e0e0}`],
            ['R1l Studio', 'studio', `${APPLY}{background:#fee500;color:#191919;box-shadow:inset 0 0 0 64px #191919}`],
            ['R1m !important', 'chat', inset('box-shadow:inset 0 0 0 64px #000000 !important')],
            ['R1n unreadable colour', 'chat', inset('box-shadow:inset 0 0 0 64px oklch(0.2 0 0)')],
            ['R1o between the bars, 3.49:1', 'chat', send('box-shadow:inset 0 0 0 64px #6a6a6a')],
            ['R1p cap, 70 x 70 = 4900', 'chat', hoverBlocks(70)],
            ['R1q selector list, part listed second', 'chat', `${SAFE},${SEND}{${WHITE_ON_BLACK_TEXT};box-shadow:inset 0 0 0 64px #000000}`],
            ['R1q selector list, part listed first', 'chat', `${SEND},${SAFE}{${WHITE_ON_BLACK_TEXT};box-shadow:inset 0 0 0 64px #000000}`],
            // 60 translucent insets over 61 fills are 3660 pairs; the translucent halo's backdrop includes the insets, which takes the bound over 4096
            ['R1r cap reached only through the halo\'s inset bound', 'chat', `${hoverBlocks(60)}${SEND}{background:#ffff00;color:#111111;text-shadow:0 0 6px rgb(255 255 0 / 0.5)}`],
            // a translucent inset in a block that gives no fill lies over the app's surfaces, not over the fills of other blocks
            ['K1 inset in a fill-less :hover block, over the app surface', 'chat', `${SEND}{background:#ffff00;color:#111111}${SEND}:hover{box-shadow:inset 0 0 0 64px rgb(255 255 255 / 0.3)}`],
            // the same translucent inset in a block with a fill and in a fill-less block are two members: the block is part of the member key
            ['K2 the same translucent inset in a block with a fill and in a fill-less block', 'chat', `${SEND}:focus-visible{background:#ffff00;color:#111111;box-shadow:inset 0 0 0 64px rgb(255 255 255 / 0.3)}${SEND}:hover{box-shadow:inset 0 0 0 64px rgb(255 255 255 / 0.3)}`],
            // layers of different colours paint together: first listed on top, each order-preserving subset ending at its first layer of alpha 0.9 or more
            ['R1s translucent black over opaque white paints #808080', 'chat', `${SEND}{background:#ffffff;color:#767676;box-shadow:inset 0 0 0 64px rgb(0 0 0 / 0.5),inset 0 0 0 64px #ffffff}`],
            ['R1t both layers translucent', 'chat', `${SEND}{background:#ffffff;color:#767676;box-shadow:inset 0 0 0 64px rgb(0 0 0 / 0.6),inset 0 0 0 64px rgb(255 255 255 / 0.9)}`],
            ['R1u Studio', 'studio', `${APPLY}{background:#ffffff;color:#767676;box-shadow:inset 0 0 0 64px rgb(0 0 0 / 0.5),inset 0 0 0 64px #ffffff}`],
            ['R1v only the two-layer stack fails', 'chat', `${SEND}{background:#000000;color:#767676;box-shadow:inset 0 0 0 64px rgb(0 0 0 / 0.5),inset 0 0 0 64px #ffffff}`],
            ['R1w an opaque ring on top, a translucent layer beneath', 'chat', `${SEND}{background:#ffffff;color:#767676;box-shadow:inset 0 0 0 2px #ffffff,inset 0 0 0 64px rgb(0 0 0 / 0.5)}`],
            ['R1x only a middle-and-bottom stack fails', 'chat', `${SEND}{background:#000000;color:#767676;box-shadow:inset 0 0 0 2px #ffffff,inset 0 0 0 64px rgb(0 0 0 / 0.5),inset 0 0 0 64px #ffffff}`],
            ['R1y transparent layers paint nothing around a translucent dark layer', 'chat', `${SEND}{background:#ffffff;color:#767676;box-shadow:inset 0 0 0 64px transparent,inset 0 0 0 64px rgb(0 0 0 / 0.5),inset 0 0 0 64px transparent}`],
        ] as const)('%s', (_name, area, css) => {
            expect(refusedByPaintOver(area, css), JSON.stringify(reasons(area, css))).toBe(true)
        })

        it('R1z a declaration that can paint more than 4096 stacks is refused by the cap without enumerating them', () => {
            const layers = Array.from({ length: 40 }, (_v, i) => `inset 0 0 0 1px rgb(255 255 ${i + 1} / 0.05)`).join(',')
            const css = send(`box-shadow:${layers}`)
            const start = performance.now()
            const found = reasons('chat', css)
            expect(performance.now() - start).toBeLessThan(2000)
            expect(found.some((why) => /^chat-send: too many colours to judge/.test(why)), JSON.stringify(found)).toBe(true)
        })

        it('names the part, both colours, the ratio and both blocks', () => {
            const why = reasons('chat', inset('box-shadow:inset 0 0 0 64px #000000')).find((w) => RULE_P.test(w)) ?? ''
            expect(why).toMatch(/^chat-send: an inset box-shadow #000000 can be drawn under text #000000 at 1\.00:1 when /)
            expect(why).toContain('(needs 4.5:1)')
        })
        it('the cap message names the cap', () => {
            expect(reasons('chat', hoverBlocks(70)).some((why) => /^chat-send: too many colours to judge/.test(why))).toBe(true)
        })
    })

    describe('P2 a thick decoration line (REPRO)', () => {
        it.each([
            ['R2a longhand', 'chat', thick('20px')],
            ['R2b shorthand, last', 'chat', send('text-decoration:line-through solid #ffff00 20px')],
            ['R2b shorthand, first', 'chat', send('text-decoration:20px line-through')],
            ['R2c :hover, 3.5px', 'chat', `${SEND}{${YELLOW_ON_DARK}}${SEND}:hover{text-decoration:underline 3.5px}`],
            ['R2d rem', 'chat', thick('0.25rem')],
            ['R2e app token', 'chat', thick('var(--stroke-xheavy)')],
            ['R2f --pack- variant', 'chat', `:root{--pack-d:1px}html[data-input="hover"]{--pack-d:8px}${thick('var(--pack-d)')}`],
            ['R2g calc negation', 'chat', thick('calc(-8px * -1)')],
            ['R2h from-font', 'chat', thick('from-font')],
            ['R2i Studio', 'studio', `${APPLY}{background:#fee500;color:#191919;text-decoration:underline 6px}`],
            ['R2j calc in the shorthand', 'chat', send('text-decoration:line-through calc(-20px * -1)')],
            ['R2k token in the shorthand', 'chat', send('text-decoration:line-through var(--stroke-xheavy)')],
            ['R2l unitless 5', 'chat', send('text-decoration:underline;text-decoration-thickness:5')],
        ] as const)('%s', (_name, area, css) => {
            expect(refusedByPaintOver(area, css), JSON.stringify(reasons(area, css))).toBe(true)
        })
    })

    describe('P3 a blurred halo (REPRO)', () => {
        const halo = (value: string): string => send(`text-shadow:${value}`)
        it.each([
            ['R3a 1.19:1', 'chat', halo('0 0 6px #222222')],
            ['R3b second layer', 'chat', halo('0 1px 0 #ffffff,0 0 8px #111111')],
            ['R3c :hover, blur 3', 'chat', `${SEND}{${YELLOW_ON_DARK}}${SEND}:hover{text-shadow:0 0 3px #111111}`],
            ['R3d no colour', 'chat', halo('0 0 4px')],
            ['R3d currentcolor', 'chat', halo('0 0 4px currentcolor')],
            ['R3e colour first', 'chat', halo('#111111 0 0 6px')],
            ['R3f stacked', 'chat', halo(Array(3).fill('0 0 6px rgb(17 17 17 / 0.5)').join(','))],
            ['R3g app-text pairing, none set', 'chat', `${APP_TEXT}${SEND}{background:#111111}${SEND}:hover{text-shadow:0 0 6px #e0e0e0}`],
            ['R3h --pack- variant', 'chat', `:root{--pack-h:0 0 1px #111111}html[data-input="hover"]{--pack-h:0 0 6px #111111}${halo('var(--pack-h)')}`],
            ['R3i calc negation blur', 'chat', halo('0 0 calc(-6px * -1) #111111')],
            ['R3j Studio', 'studio', `${SIDE_TAB}{${WHITE_ON_BLACK_TEXT};text-shadow:0 0 4px #333333}`],
            ['R3k unreadable colour', 'chat', halo('0 0 6px color-mix(in srgb, #111111 90%, #ffff00)')],
            ['R3l 2.53:1', 'chat', halo('0 0 6px #555555')],
            ['R3m translucent halo over a translucent inset', 'chat', `${SEND}{background:#ffff00;color:#111111;box-shadow:inset 0 0 0 64px rgb(17 17 17 / 0.5);text-shadow:0 0 6px rgb(17 17 17 / 0.6)}`],
            ['R3n translucent halo over an opaque inset', 'chat', `${SEND}{background:#ffff00;color:#111111;box-shadow:inset 0 0 0 64px #8a8a8a;text-shadow:0 0 6px rgb(17 17 17 / 0.5)}`],
            ['R3o inset in :hover, halo in the base block', 'chat', `${SEND}{background:#ffff00;color:#111111;text-shadow:0 0 6px rgb(17 17 17 / 0.5)}${SEND}:hover{background:#ffff00;color:#111111;box-shadow:inset 0 0 0 64px #8a8a8a}`],
            ['R3p translucent black over opaque white halo paints #808080', 'chat', `${SEND}{background:#ffffff;color:#767676;text-shadow:0 0 6px rgb(0 0 0 / 0.5),0 0 6px #ffffff}`],
            ['R3q only the two-layer halo stack fails', 'chat', `${SEND}{background:#000000;color:#767676;text-shadow:0 0 6px rgb(0 0 0 / 0.5),0 0 6px #ffffff}`],
        ] as const)('%s', (_name, area, css) => {
            expect(refusedByPaintOver(area, css), JSON.stringify(reasons(area, css))).toBe(true)
        })
    })

    describe('values the engine refuses first, judged by cascadePass alone (SEAM REPRO)', () => {
        it.each([
            ['S1 em over 0.2', thick('0.25em')],
            ['S2 % over 20', thick('25%')],
            ['S3 min()', thick('min(1px, 9px)')],
            ['S3 leftover var', thick('var(--nope)')],
            ['S4 leftover var in a box-shadow', send('box-shadow:var(--nope)')],
            ['S5 calc that is not a negation, thickness', thick('calc(1px * 2)')],
            ['S5 calc that is not a negation, blur', send('text-shadow:0 0 calc(1px * 1) #111111')],
            ['S6 leftover var in a text-shadow', send('text-shadow:var(--nope) 0 0 #111111')],
        ] as const)('%s', (_name, css) => {
            expect(seam('chat', css).length, css).toBeGreaterThan(0)
        })
    })

    describe('what stays accepted (GUARD, same verdict before and after)', () => {
        it.each([
            ['G1 readable ring in the same block', 'chat', send('box-shadow:inset 0 0 0 2px #ffffff')],
            ['G1 readable ring in a focus block that states both colours', 'chat', `${SEND}:focus-visible{${YELLOW_ON_DARK};box-shadow:inset 0 0 0 2px #ffffff}`],
            ['G1c focus-only ring, text set elsewhere', 'chat', `${SEND}{${YELLOW_ON_DARK}}${SEND}:focus-visible{box-shadow:inset 0 0 0 2px #ffffff}`],
            ['G3 box-shadow none', 'chat', send('box-shadow:none')],
            ['G3 text-shadow unset', 'chat', send('text-shadow:unset')],
            ['G3 thickness inherit', 'chat', send('text-decoration-thickness:inherit')],
            ['G4 underline', 'chat', send('text-decoration:underline')],
            ['G4 underline 1px', 'chat', send('text-decoration:underline 1px')],
            ['G4 underline solid colour 3px', 'chat', send('text-decoration:underline solid #111111 3px')],
            ['G4 3px longhand', 'chat', send('text-decoration-thickness:3px')],
            ['G4 0.1875rem', 'chat', send('text-decoration-thickness:0.1875rem')],
            ['G4 app token', 'chat', send('text-decoration-thickness:var(--stroke-heavy)')],
            ['G4 auto', 'chat', send('text-decoration-thickness:auto')],
            ['G5 thick', 'chat', send('text-decoration-thickness:thick')],
            ['G5 thin', 'chat', send('text-decoration-thickness:thin')],
            ['G5 medium', 'chat', send('text-decoration-thickness:medium')],
            ['G7 blur 2px', 'chat', send('text-shadow:0 0 2px #111111')],
            ['G7 blur 0.125rem', 'chat', send('text-shadow:0 0 0.125rem #111111')],
            ['G13 cap boundary, 64 x 64 = 4096', 'chat', hoverBlocks(64)],
            // R20: a text colour set only in a state, @media or context turns the app-text pairing off
            ['G16 conditional-only text colour, inset', 'chat', `${APP_TEXT}${SEND}{background:#808080;box-shadow:inset 0 0 0 64px #e0e0e0}${SEND}:hover{background:#808080;color:#000000}`],
            ['G16c dead-context form', 'chat', `@media (max-width:0px){${SEND}{background:#ffffff;color:#000000}}${SEND}{box-shadow:inset 0 0 0 64px #ffffff}`],
            ['G18 thin-blur halo with an unreadable colour', 'chat', send('text-shadow:0 1px 0 oklch(0.5 0.1 200)')],
            ['G19 colour function in the shorthand', 'chat', send('text-decoration:underline rgb(17 17 17)')],
            ['G19 unreadable colour function in the shorthand', 'chat', send('text-decoration:underline oklch(0.5 0.1 200)')],
            ['K3 control: the fill-less block of K2 removed', 'chat', `${SEND}:focus-visible{background:#ffff00;color:#111111;box-shadow:inset 0 0 0 64px rgb(255 255 255 / 0.3)}`],
            // an opaque top layer hides the layer beneath it
            ['G21 opaque top layer hides the translucent layer beneath', 'chat', `${SEND}{background:#000000;color:#767676;box-shadow:inset 0 0 0 64px #ffffff,inset 0 0 0 64px rgb(0 0 0 / 0.5)}`],
            // transparent layers paint nothing, on top or beneath
            ['G22a transparent layer', 'chat', send('box-shadow:inset 0 0 0 64px transparent')],
            ['G22b transparent layer on top of a ring', 'chat', send('box-shadow:inset 0 0 0 64px transparent,inset 0 0 0 2px #ffffff')],
            ['G23 readable two-colour stack', 'chat', send('box-shadow:inset 0 0 0 64px rgb(255 255 0 / 0.5),inset 0 0 0 64px #ffffff')],
        ] as const)('%s', (_name, area, css) => {
            expect(acceptedPack(area, css), JSON.stringify(reasons(area, css))).toBe(true)
        })

        it('G9 Rule S still judges a text with an inset beside it', () => {
            const css = `${SEND}{color:#111111;box-shadow:inset 0 0 0 2px #ffffff}`
            expect(cascadePass('chat', css).some((e) => RULE_S.test(e.why))).toBe(true)
        })
        it('G11 Settings and Home are not judged', () => {
            const css = inset('box-shadow:inset 0 0 0 64px #000000')
            expect(cascadePass('settings', css)).toEqual([])
            expect(cascadePass('home', css)).toEqual([])
        })
        it('G14 em and % at the boundary are not refused by Rule P', () => {
            expect(seam('chat', thick('0.2em'))).toEqual([])
            expect(seam('chat', thick('20%'))).toEqual([])
        })
    })

    // Rule E-2 (CHORE-738 stage 2, MC-2309) now refuses these stage-1 accepts, so the halo-fade residue (MC-2117) no longer decides any accepted
    // chat or Studio pack; only an inset layer, which E-2 does not judge, keeps it. Each row keeps its fixture and says two things:
    // the Rule P pass alone still finds nothing (SEAM GUARD, same before and after), and the whole pack is refused for the E-2 reason alone (REPRO,
    // ok:true on the base).
    describe('stage-1 accepts that the E-2 flat limit refuses (CHORE-738 stage 2, MC-2309)', () => {
        it.each([
            ['G2 outer shadow in the text colour', 'chat', send('box-shadow:0 0 0 64px #111111')],
            ['G2 outer shadow in currentcolor', 'chat', send('box-shadow:0 2px 8px currentcolor')],
            ['G3 box-shadow inherit', 'chat', send('box-shadow:inherit')],
            ['G6 readable glow', 'chat', send('text-shadow:0 0 6px #ffff00')],
            ['G6 three readable glows', 'chat', send(`text-shadow:${Array(3).fill('0 0 6px #ffff00').join(',')}`)],
            ['G6 white glow', 'chat', send('text-shadow:0 0 8px #ffffff')],
            ['G7 hard offset', 'chat', send('text-shadow:3px 3px 0 #111111')],
            ['G8 one translucent halo over its own fill, 5.01:1', 'chat', send('text-shadow:0 0 6px rgb(17 17 17 / 0.5)')],
            ['G10 safe part', 'chat', `${SAFE}{color:#111111;box-shadow:inset 0 0 0 4px #111111;text-shadow:0 0 6px #111111}`],
            ['G15 halo at 3.49:1', 'chat', send('text-shadow:0 0 6px #6a6a6a')],
            ['G16b conditional-only text colour, halo', 'chat', `${APP_TEXT}${SEND}{background:#808080;text-shadow:0 0 6px #e0e0e0}${SEND}:hover{background:#808080;color:#000000}`],
            ['G17 outer layer with an unreadable colour', 'chat', send('box-shadow:0 2px 8px oklch(0.5 0.1 200)')],
            ['G20 readable halo over a readable inset', 'chat', `${SEND}{background:#ffff00;color:#111111;box-shadow:inset 0 0 0 64px #ffffff;text-shadow:0 0 6px rgb(255 255 255 / 0.5)}`],
            ['H1 grey text on white with a black glow', 'chat', `${SEND}{background:#ffffff;color:#666666;text-shadow:0 0 6px #000000}`],
            ['H2 light-on-dark mirror', 'chat', `${SEND}{background:#000000;color:#808080;text-shadow:0 0 6px #ffffff}`],
            ['H1s Studio', 'studio', `${APPLY}{background:#ffffff;color:#666666;text-shadow:0 0 6px #000000}`],
        ] as const)('%s', (_name, area, css) => {
            // SEAM GUARD: Rule P and Rule S stay silent on this sheet, before and after.
            expect(cascadePass(area, css), css).toEqual([])
            // REPRO: the whole pack is refused for E-2 alone.
            expect(refusedOnlyByE2(area, css), JSON.stringify(reasons(area, css))).toBe(true)
        })
    })

    // The inset is judged at its own colour, so a fade through the text's lightness is accepted residue (R26 and R26b, 2026-11-17 halo-fade answer, MC-2117).
    describe('residue: a fade that crosses the text colour is accepted (GUARD)', () => {
        it.each([
            ['H3 blurred inset under P1', 'chat', `${SEND}{background:#ffffff;color:#767676;box-shadow:inset 0 0 8px 12px #000000}`],
        ] as const)('%s', (_name, area, css) => {
            expect(acceptedPack(area, css), JSON.stringify(reasons(area, css))).toBe(true)
        })
    })

    // The 4096 cap counts stacks per part across a variant's declarations, before any stack is built; errors and messages stay linear in the input.
    // Time bounds sit about 10x or more above the measured cost of the correct code and below the cost of each broken variant.
    describe('bounded cost (MC-2090)', () => {
        const ruleP = (css: string): { whys: string[], ms: number } => {
            const start = performance.now()
            const whys = cascadePass('chat', css).map((e) => e.why).filter((why) => RULE_P.test(why))
            return { whys, ms: performance.now() - start }
        }
        const CAP_WHY = /^chat-send: too many colours to judge/
        // 11 translucent layers then an opaque one: 2047 + 2048 = 4095 stacks
        const darkStack = (d: number): string => [...Array.from({ length: 11 }, (_v, k) => `inset 0 0 0 1px rgb(${(d * 11 + k) & 63} ${k * 3} ${d & 63} / 0.3)`), 'inset 0 0 0 64px #000000'].join(',')
        const lightStack = (d: number): string => [...Array.from({ length: 11 }, (_v, k) => `inset 0 0 0 1px rgb(255 ${255 - k} ${(240 + d) & 255} / 0.3)`), 'inset 0 0 0 2px #ffffff'].join(',')
        const sameEleven = [...Array.from({ length: 11 }, () => 'inset 0 0 0 1px rgb(255 255 255 / 0.3)'), 'inset 0 0 0 2px #ffffff'].join(',')
        const stackPack = (depth: number, texts: number): string => `${SEND}{background:#000000;color:#111111}`
            + Array.from({ length: texts }, (_v, i) => `${SEND}:hover{color:#${hex2(i >> 8)}${hex2(i & 255)}20}`).join('')
            + Array.from({ length: depth }, (_v, d) => `@media (min-width:${d + 1}px){${SEND}:hover{background:#000000;box-shadow:${darkStack(d)}}}`).join('')
        const darkTexts = (texts: number): string => `${SEND}:hover{background:#ffffff}` + Array.from({ length: texts }, (_v, i) => `${SEND}:hover{color:#${hex2(i & 63)}${hex2((i >> 6) & 63)}20}`).join('')
        const focusRing = (layers: string): string => `${SEND}{background:#ffffff;color:#000000;box-shadow:${sameEleven}}${SEND}:focus-visible{box-shadow:${layers}}`
        const bigSelectorBlocks = `${SEND}{background:#ffffff;color:#111111}` + Array.from({ length: 200 }, (_v, i) => `${SEND}:hover{color:#${hex2(i & 63)}${hex2((i >> 6) & 63)}20}`).join('')

        it('F1a one dark declaration beside 50 text colours: one error per text colour (REPRO)', () => {
            const { whys, ms } = ruleP(stackPack(1, 50))
            expect(whys.length).toBeGreaterThan(0)
            expect(whys.length).toBeLessThanOrEqual(51)
            expect(ms).toBeLessThan(2000)
        })
        it('F1b one dark declaration beside 1000 text colours (REPRO)', () => {
            const { whys, ms } = ruleP(stackPack(1, 1000))
            expect(whys.length).toBeLessThanOrEqual(1001)
            expect(ms).toBeLessThan(2000)
        })
        it('F1c two 4095-stack declarations on one part: the second is refused by the part budget (REPRO)', () => {
            const { whys } = ruleP(stackPack(2, 50))
            expect(whys.some((why) => CAP_WHY.test(why)), JSON.stringify(whys.slice(0, 3))).toBe(true)
            expect(whys.length).toBeLessThanOrEqual(52)
        })
        it('F1d a 12-layer declaration beside 4000 text colours stays accepted and is judged quickly (REPRO for time, GUARD for the verdict)', () => {
            const css = `${SEND}{background:#ffffff;color:#000000;box-shadow:${lightStack(0)}}${darkTexts(4000)}`
            expect(acceptedPack('chat', css), JSON.stringify(reasons('chat', css).slice(0, 2))).toBe(true)
            const start = performance.now()
            cascadePass('chat', css)
            expect(performance.now() - start).toBeLessThan(1500)
        })
        it('F1e 4095 + 1 = 4096 stacks on one part is accepted (GUARD)', () => {
            const css = focusRing('inset 0 0 0 2px #ffffff')
            expect(acceptedPack('chat', css), JSON.stringify(reasons('chat', css).slice(0, 2))).toBe(true)
        })
        it('F1f 4095 + 2 = 4097 stacks on one part is refused by the cap (REPRO)', () => {
            const css = focusRing('inset 0 0 0 2px #ffffff,inset 0 0 0 4px #ffffff')
            expect(refusedByPaintOver('chat', css)).toBe(true)
            expect(ruleP(css).whys.some((why) => CAP_WHY.test(why))).toBe(true)
        })
        it('F1g 400 over-budget declarations on one part are refused fast (REPRO)', () => {
            const css = `${SEND}{background:#ffffff;color:#000000}` + Array.from({ length: 400 }, (_v, d) => `@media (min-width:${d + 1}px){${SEND}{box-shadow:${lightStack(d)}}}`).join('')
            const { whys, ms } = ruleP(css)
            expect(whys.some((why) => CAP_WHY.test(why))).toBe(true)
            expect(ms).toBeLessThan(1000)
        })
        it('F1k one declaration over 2000 selector entries with 2000 currentcolor layers neither throws nor stalls (REPRO)', () => {
            const css = `${SEND}{background:#ffff00;color:#111111}` + Array.from({ length: 2000 }, () => `${SEND}:hover`).join(',')
                + `{box-shadow:${Array.from({ length: 2000 }, () => 'inset 0 0 0 1px currentcolor').join(',')}}`
            const { whys, ms } = ruleP(css)
            expect(whys.length).toBeLessThanOrEqual(2)
            expect(ms).toBeLessThan(1000)
        })
        it('F1m one declaration over 2000 selector entries with 1000 unreadable layers pushes its layer errors once per part (REPRO)', () => {
            const css = `${SEND}{background:#ffff00;color:#111111}` + Array.from({ length: 2000 }, () => `${SEND}:hover`).join(',')
                + `{box-shadow:${Array.from({ length: 1000 }, () => 'inset 0 0 0 1px oklch(0.5 0.1 200)').join(',')}}`
            const { whys, ms } = ruleP(css)
            expect(whys.length).toBeGreaterThan(0)
            expect(whys.length).toBeLessThanOrEqual(2)
            expect(ms).toBeLessThan(250)
        })
        it('L1 a 100 KB selector entry: messages stay short (REPRO)', () => {
            const css = bigSelectorBlocks + `${SEND}[data-x="${'a'.repeat(100_000)}"]{box-shadow:inset 0 0 0 64px #000000}`
            const { whys } = ruleP(css)
            expect(whys.length).toBeGreaterThan(0)
            expect(Math.max(...whys.map((why) => why.length))).toBeLessThanOrEqual(2000)
        })
        it('L2 a declaration with 4000 extra outer layers: messages stay short (REPRO)', () => {
            const css = bigSelectorBlocks + `${SEND}{box-shadow:inset 0 0 0 64px #000000,${Array.from({ length: 4000 }, () => '0 1px 2px #000000').join(',')}}`
            const { whys } = ruleP(css)
            expect(whys.length).toBeGreaterThan(0)
            expect(Math.max(...whys.map((why) => why.length))).toBeLessThanOrEqual(2000)
        })
        it('F2a 30 readable opaque inset rings are judged within 2 s (GUARD)', () => {
            const css = send(`box-shadow:${Array.from({ length: 30 }, () => 'inset 0 0 0 1px #ffffff').join(',')}`)
            const start = performance.now()
            const ok = acceptedPack('chat', css)
            expect(performance.now() - start).toBeLessThan(2000)
            expect(ok).toBe(true)
        })

        it('U1 a lone translucent layer is judged at its own colour, not at its alpha-scaled colour (GUARD)', () => {
            // white at 0.5 over black is #808080 (3.95:1 against white text); a colour scaled by its alpha would read #404040 and pass
            const css = `${SEND}{background:#000000;color:#ffffff;box-shadow:inset 0 0 0 64px rgb(255 255 255 / 0.5)}`
            expect(refusedByPaintOver('chat', css), JSON.stringify(reasons('chat', css).slice(0, 2))).toBe(true)
        })

        const ALPHAS = [0.3, 0.95, 1]
        const patterns: Rgba[][] = []
        for (let n = 1; n <= 6; n++) {
            for (let code = 0; code < ALPHAS.length ** n; code++) {
                const layer: Rgba[] = []
                for (let i = 0, c = code; i < n; i++, c = Math.floor(c / ALPHAS.length)) layer.push([i * 30, 0, 0, ALPHAS[c % ALPHAS.length]])
                patterns.push(layer)
            }
        }
        // masks of non-empty subsets with no picked layer after the first picked covering layer
        const bruteCount = (colours: readonly Rgba[]): number => {
            let count = 0
            for (let mask = 1; mask < 1 << colours.length; mask++) {
                let ended = false
                let valid = true
                for (let i = 0; i < colours.length && valid; i++) {
                    if (!(mask & (1 << i))) continue
                    if (ended) valid = false
                    else if (colours[i][3] >= 0.9) ended = true
                }
                if (valid) count++
            }
            return count
        }
        const asLayers = (colours: readonly Rgba[]): { colour: Rgba, index: number }[] => colours.map((colour, i) => ({ colour, index: i + 1 }))

        it('F2b-1 layerStacks emits exactly the order-preserving stacks that end at their first covering layer (GUARD)', () => {
            expect(patterns.length).toBe(1092)
            for (const colours of patterns) expect(layerStacks(asLayers(colours), 1 << 20)!.length, JSON.stringify(colours)).toBe(bruteCount(colours))
            const rings: Rgba[] = Array.from({ length: 16 }, () => [255, 255, 255, 1])
            expect(layerStacks(asLayers(rings), 1 << 20)!.length).toBe(16)
        })
        it('F2b-2 stackCount equals that count and saturates at the limit plus one (GUARD on a new seam)', () => {
            for (const colours of patterns) {
                const count = bruteCount(colours)
                expect(stackCount(asLayers(colours), 1 << 20), JSON.stringify(colours)).toBe(count)
                expect(stackCount(asLayers(colours), count - 1)).toBe(count)
                expect(layerStacks(asLayers(colours), count - 1)).toBeNull()
            }
        })
    })
})

// Rule E-2 (CHORE-738 stage 2, MC-2309): in a chat or Studio sheet every outer box-shadow layer and every text-shadow layer may reach at most
// 2 px past its element, whatever its colour and whatever part it sits on. Classes: REPRO = the pack is ok:true on the base and refused for the
// E-2 reason alone now; GUARD = accepted or refused identically before and after. Every fixture is a pack stylesheet as an author writes one.
describe('E-2: the flat 2 px limit on outer shadows (CHORE-738 stage 2, MC-2309)', () => {
    const NOTICE = '[data-part="chat-ai-law-notice"]'
    const STUDIO = '[data-part="studio"]'
    const rep = (n: number, layer: string): string => Array.from({ length: n }, () => layer).join(',')
    const E2_RULE = 'in chat and Studio an outer box-shadow or a text-shadow may reach at most 2 px past its element, whatever its colour, so that it cannot lie under or over a control (MC-2073, MC-2309)'
    const INHERIT_WHY = `box-shadow: inherit copies the parent's shadow, which the check cannot measure; ${E2_RULE}`
    const UNMEASURED = /cannot be measured/
    const accepted = (area: ThemeArea, css: string): boolean => lintAreaPack(area, css, 'probe').ok
    const whys = (area: ThemeArea, css: string): string[] => reasons(area, css)

    const REFUSED: readonly (readonly [string, ThemeArea, string, RegExp | null])[] = [
        ['E1 a control', 'chat', `${SEND}{box-shadow:0 0 0 64px #ffffff}`, null],
        ['E2 a non-control neighbour', 'chat', `${NOTICE}{box-shadow:0 0 0 64px #ffffff}`, null],
        ['E3 ancestor of every control', 'chat', '[data-part="chat-shell"]{box-shadow:0 0 0 64px #ffffff}', null],
        ['E4 expression part', 'chat', '[data-part="chat-message-tts"]{box-shadow:0 0 0 64px #000000}', null],
        ['E5 header fixture', 'chat', `[data-part="chat-header"]{background:transparent !important;color:#808080 !important}${NOTICE}{box-shadow:0 0 0 64px #303030}`, null],
        ['E6 sidebar', 'chat', '[data-part="chat-sidebar"]{box-shadow:0 0 0 64px #000000}', null],
        ['E7 Studio root', 'studio', `${STUDIO}{box-shadow:0 0 0 64px #000000}`, null],
        ['E8 Studio forwarded name', 'studio', '[data-part="studio-form-desc"]{box-shadow:0 0 0 64px #000000}', null],
        ['E9 a name that never renders', 'chat', '[data-part="chat-list-row"]{box-shadow:0 0 0 64px #ffffff}', null],
        ['E10 inherited halo', 'chat', '[data-part="chat-message-list"]{text-shadow:0 0 12px #808080}', null],
        ['E11 hard-offset text-shadow', 'chat', '[data-part="chat-message-text"]{text-shadow:3px 3px 0 #111111}', null],
        ['E12 second layer', 'chat', `${NOTICE}{box-shadow:0 0 0 1px #000000,0 4px 8px #000000}`, /"0 4px 8px[^"]*" reaches 12 px/],
        ['E13a --pack- value in a state', 'chat', `:root{--pack-s:0 0 0 1px #000000}html[data-input="hover"]{--pack-s:0 0 0 64px #000000}${NOTICE}{box-shadow:var(--pack-s)}`, null],
        ['E13b --pack- value in @media', 'chat', `:root{--pack-s:0 0 0 1px #000000}@media (min-width:1px){:root{--pack-s:0 0 0 64px #000000}}${NOTICE}{box-shadow:var(--pack-s)}`, null],
        ['E13c big value as the root default', 'chat', `:root{--pack-s:0 0 0 64px #000000}html[data-input="hover"]{--pack-s:0 0 0 1px #000000}${NOTICE}{box-shadow:var(--pack-s)}`, null],
        ['E14 @media', 'chat', `@media (min-width:1px){${NOTICE}{box-shadow:0 0 0 64px #000000}}`, null],
        ['E15 a state', 'chat', `${SEND}:hover{box-shadow:0 0 8px #000000}`, null],
        ['E16 !important', 'chat', `${NOTICE}{box-shadow:0 0 0 64px #000000 !important}`, null],
        ['E18 app token measured', 'chat', `${NOTICE}{box-shadow:var(--shadow-float)}`, /reaches 12 px/],
        ['E19 transparent', 'chat', `${NOTICE}{box-shadow:0 0 0 64px transparent}`, null],
        ['E20 currentcolor', 'chat', `${NOTICE}{box-shadow:0 0 0 64px currentcolor}`, null],
        ['E21a 3 px from spread alone', 'chat', `${NOTICE}{box-shadow:0 0 0 3px #000000}`, null],
        ['E21b 3 px from blur alone', 'chat', `${NOTICE}{box-shadow:0 0 3px #000000}`, null],
        ['E21c 3 px from offset alone', 'chat', `${NOTICE}{box-shadow:3px 0 0 #000000}`, null],
        ['E22a calc spread at its magnitude, inner negation', 'chat', `${NOTICE}{box-shadow:0 0 0 calc(-64px * -1) #000000}`, null],
        ['E22b calc spread at its magnitude, outer negation', 'chat', `${NOTICE}{box-shadow:0 0 0 calc(64px * -1) #000000}`, null],
        ['E23 outer focus ring over 2 px (decided cost)', 'chat', `${SEND}:focus-visible{box-shadow:0 0 0 3px #ffffff}`, null],
        ['E24 rem at 16', 'chat', `${NOTICE}{box-shadow:0 0 0 0.25rem #000000}`, /reaches 4 px/],
        ['E25 elevation idiom with a negative spread (decided cost)', 'chat', `${NOTICE}{box-shadow:0 2px 4px -4px #000000}`, /reaches 6 px/],
        ['J1 juxtaposed colour function, box', 'chat', `${NOTICE}{box-shadow:rgb(0 0 0)64px 0 0 0}`, UNMEASURED],
        ['J6 juxtaposed, Studio', 'studio', `${STUDIO}{box-shadow:rgb(0 0 0)48px 0 0 0}`, UNMEASURED],
        ['J8 juxtaposed, text', 'chat', `${NOTICE}{text-shadow:rgb(0 0 0)12px 0 0}`, UNMEASURED],
        ['J10 juxtaposed calc', 'chat', `${NOTICE}{box-shadow:rgb(0 0 0)calc(64px * -1) 0 0 0}`, UNMEASURED],
        ['J11 juxtaposed in a second layer', 'chat', `${NOTICE}{box-shadow:0 0 0 1px #000000,hsl(0 0% 0%)64px 0 0 0}`, UNMEASURED],
        ['J1s spaced control of J1', 'chat', `${NOTICE}{box-shadow:rgb(0 0 0) 64px 0 0 0}`, /reaches 64 px/],
        ['W1 + length after a hex hash', 'chat', `${NOTICE}{box-shadow:#ffffff+64px 0 0 0}`, UNMEASURED],
        ['W2 + length after an identifier', 'chat', `${NOTICE}{box-shadow:white+64px 0 0 0}`, UNMEASURED],
        ['W3 . length after a hex hash', 'chat', `${NOTICE}{box-shadow:#ffffff.99rem 0 0 0}`, UNMEASURED],
        ['W4 text, + length after currentcolor', 'chat', `${NOTICE}{text-shadow:currentcolor+12px 0 0}`, UNMEASURED],
        ['W5 W1 on the Studio root', 'studio', `${STUDIO}{box-shadow:#ffffff+64px 0 0 0}`, UNMEASURED],
        ['W6 W2 on the Studio root', 'studio', `${STUDIO}{box-shadow:white+64px 0 0 0}`, UNMEASURED],
        ['W7 W3 on the Studio root', 'studio', `${STUDIO}{box-shadow:#ffffff.99rem 0 0 0}`, UNMEASURED],
        ['W8 W4 on the Studio root', 'studio', `${STUDIO}{text-shadow:currentcolor+12px 0 0}`, UNMEASURED],
        ['W9 in a second layer', 'chat', `${NOTICE}{box-shadow:0 0 0 1px #000000,#ffffff+64px 0 0 0}`, UNMEASURED],
        ['W10 hidden blur', 'chat', `${NOTICE}{box-shadow:0 0 #ffffff+64px}`, UNMEASURED],
        ['W11 through a --pack- value', 'chat', `:root{--pack-s:#ffffff+64px 0 0 0}${NOTICE}{box-shadow:var(--pack-s)}`, UNMEASURED],
        ['W12 on chat-transcript', 'chat', '[data-part="chat-transcript"]{box-shadow:#ffffff+64px 0 0 0}', UNMEASURED],
        ['W13 transparent', 'chat', `${NOTICE}{box-shadow:transparent+64px 0 0 0}`, UNMEASURED],
        ['W14 spaced + control', 'chat', `${NOTICE}{box-shadow:red +64px 0 0 0}`, /reaches 64 px/],
        ['RT1 pack :root override of an app token, box', 'chat', `:root{--focus-ring-w:60px}${NOTICE}{box-shadow:0 0 0 var(--focus-ring-w) #000000}`, /reaches 60 px/],
        ['RT2 the same, text', 'chat', `:root{--focus-ring-w:3px}${NOTICE}{text-shadow:0 0 var(--focus-ring-w) #000000}`, /reaches 3 px/],
        ['RT3 the same, Studio', 'studio', `:root{--focus-ring-w:60px}${STUDIO}{box-shadow:0 0 0 var(--focus-ring-w) #000000}`, /reaches 60 px/],
        ['ST1 stacked blurred negative spread', 'chat', `${NOTICE}{box-shadow:${rep(300, '0 0 20px -18px #ffffff')}}`, /reaches 20 px/],
        ['ST4 the same on chat-transcript', 'chat', `[data-part="chat-transcript"]{box-shadow:${rep(300, '0 0 64px -62px #ffffff')}}`, /reaches 64 px/],
        ['ST5 one such layer', 'chat', `${NOTICE}{box-shadow:0 0 64px -62px #ffffff}`, null],
    ]
    describe('what is refused (REPRO: ok:true on the base, refused for the E-2 reason alone now)', () => {
        it.each(REFUSED)('%s', (_id, area, css, re) => {
            expect(refusedOnlyByE2(area, css), JSON.stringify(whys(area, css))).toBe(true)
            if (re) expect(whys(area, css).some((why) => re.test(why)), `${re} against ${JSON.stringify(whys(area, css))}`).toBe(true)
        })

        it('E12b two over layers of one declaration give one error', () => {
            expect(e2Count('chat', `${NOTICE}{box-shadow:0 0 0 3px #000000,0 0 0 4px #000000}`)).toBe(1)
        })
        it('E12c an unmeasurable layer followed by another bad layer gives one error', () => {
            expect(e2Count('chat', `${NOTICE}{box-shadow:#000000+64px 0 0 0,0 0 0 64px #000000}`)).toBe(1)
        })
        it('E17 a selector list gives one error', () => {
            expect(e2Count('chat', `${SAFE},${NOTICE}{box-shadow:0 0 0 64px #000000}`)).toBe(1)
        })
        it('I4 box-shadow: inherit !important is refused with exactly the inherit reason', () => {
            expect(whys('chat', `${NOTICE}{box-shadow:inherit !important}`)).toEqual([INHERIT_WHY])
        })
        it('V1 4000 layers: one error, judged quickly', () => {
            const css = `${NOTICE}{box-shadow:${rep(4000, '0 0 0 1px #000000')},0 0 0 3px #000000}`
            const start = performance.now()
            const count = e2Count('chat', css)
            const ms = performance.now() - start
            expect(count).toBe(1)
            expect(ms).toBeLessThan(1000)
        })
        it('V2 2000 selector entries: one error, short, judged quickly', () => {
            const css = `${Array.from({ length: 2000 }, () => `${NOTICE}:hover`).join(',')}{box-shadow:0 0 0 64px #000000}`
            const start = performance.now()
            const result = lintAreaPack('chat', css, 'probe')
            const ms = performance.now() - start
            const e2 = result.errors.filter((e) => E2_WHY.test(e.why))
            expect(e2).toHaveLength(1)
            expect(e2[0].selector.length + e2[0].why.length).toBeLessThanOrEqual(600)
            expect(ms).toBeLessThan(1000)
        })
        it('V3 2000 declarations are deduped to one error per distinct reach', () => {
            const css = Array.from({ length: 2000 }, (_v, i) => `@media (min-width:${i + 1}px){${NOTICE}{box-shadow:0 0 0 ${3 + (i % 60)}px #000000}}`).join('')
            const start = performance.now()
            const count = e2Count('chat', css)
            const ms = performance.now() - start
            expect(count).toBe(60)
            expect(ms).toBeLessThan(2000)
        })
    })

    const ACCEPTED: readonly (readonly [string, ThemeArea, string])[] = [
        ['K1 box exactly 2 px', 'chat', `${NOTICE}{box-shadow:0 0 0 2px #000000}`],
        ['K2 text blur exactly 2 px', 'chat', `${NOTICE}{text-shadow:0 0 2px #000000}`],
        ['K3 text offsets 1px 1px blur 1px', 'chat', `${NOTICE}{text-shadow:1px 1px 1px #000000}`],
        ['K4 negative offset -2px', 'chat', `${NOTICE}{box-shadow:-2px 0 0 #000000}`],
        ['K6 hard negative spread floored at 0', 'chat', `${NOTICE}{box-shadow:0 0 0 -9px #000000}`],
        ['K13 hard negative spread nets 2', 'chat', `${NOTICE}{box-shadow:-4px 0 0 -2px #000000}`],
        ['K7 inset on a non-control part', 'chat', `${NOTICE}{box-shadow:inset 0 0 0 64px #ffffff}`],
        ['K8 none', 'chat', `${NOTICE}{box-shadow:none;text-shadow:none}`],
        ['K9 0.125rem', 'chat', `${NOTICE}{box-shadow:0 0 0 0.125rem #000000}`],
        ['K10 hairline ring beside an inset', 'chat', `${NOTICE}{box-shadow:0 0 0 1px #000000,inset 0 0 0 64px #ffffff}`],
        ['K11a box-shadow revert', 'chat', `${NOTICE}{box-shadow:revert}`],
        ['K11b box-shadow revert-layer', 'chat', `${NOTICE}{box-shadow:revert-layer}`],
        ['K11c box-shadow initial', 'chat', `${NOTICE}{box-shadow:initial}`],
        ['K11d box-shadow unset', 'chat', `${NOTICE}{box-shadow:unset}`],
        ['K12 text-shadow inherit', 'chat', `${NOTICE}{text-shadow:inherit}`],
        ['K14 a whole colour function at the layer end', 'chat', `${NOTICE}{box-shadow:0 1px 1px rgb(0 0 0 / 0.2)}`],
        ['WG1 hex with alpha digits', 'chat', `${NOTICE}{box-shadow:0 0 1px #0008}`],
        ['WG2 named colour', 'chat', `${NOTICE}{box-shadow:0 0 2px rebeccapurple}`],
        ['WG3 text, colour first', 'chat', `${NOTICE}{text-shadow:currentcolor 1px 1px 0}`],
        ['WG4 oklch', 'chat', `${NOTICE}{box-shadow:0 0 0 2px oklch(0.5 0.1 200)}`],
        ['WG5 hex first', 'chat', `${NOTICE}{box-shadow:#ffffff99 0 0 0 2px}`],
        ['WG6 transparent', 'chat', `${NOTICE}{box-shadow:0 0 0 2px transparent}`],
        ['WG7 rgb with slash alpha', 'chat', `${NOTICE}{box-shadow:0 1px 1px rgb(0 0 0 / 0.2)}`],
        ['WG8 Studio hsl with alpha', 'studio', `${STUDIO}{box-shadow:0 0 2px hsl(0 0% 0% / 50%)}`],
        ['RT4 :root override at exactly 2 px', 'chat', `:root{--focus-ring-w:2px}${NOTICE}{box-shadow:0 0 0 var(--focus-ring-w) #000000}`],
        ['RT5 the app value of --focus-ring-w', 'chat', `${NOTICE}{box-shadow:0 0 0 var(--focus-ring-w) #000000}`],
        ['I1 box-shadow none !important', 'chat', `${NOTICE}{box-shadow:none !important}`],
        ['I2 box-shadow revert-layer !important', 'chat', `${NOTICE}{box-shadow:revert-layer !important}`],
        ['I3 text-shadow inherit !important', 'chat', `${NOTICE}{text-shadow:inherit !important}`],
        ['ST2 1000 stacked 0 0 2px (accepted residue: stacked blur tails)', 'chat', `${NOTICE}{box-shadow:${rep(1000, '0 0 2px #ffffff')}}`],
        ['ST3 300 stacked text 0 0 2px (accepted residue: stacked blur tails)', 'chat', `${NOTICE}{text-shadow:${rep(300, '0 0 2px #ffffff')}}`],
        ['O5a Home is not judged', 'home', '[data-part="home-card"]{box-shadow:0 0 0 64px #000000}'],
        ['O5b Settings is not judged', 'settings', '[data-part="settings-index"]{box-shadow:0 0 0 64px #000000}'],
        // accepted by the reader and by the engine; the browser drops the declaration, so nothing paints
        ['F1 an unreadable-in-the-browser length is accepted and dropped', 'chat', `${NOTICE}{box-shadow:0 0 0 1.px #ffffff}`],
    ]
    describe('what stays accepted (GUARD: ok:true before and after)', () => {
        it.each(ACCEPTED)('%s', (_id, area, css) => {
            expect(accepted(area, css), JSON.stringify(whys(area, css))).toBe(true)
        })
    })

    describe('a sheet another pass refuses reports exactly its own reasons and no E-2 reason (GUARD: same before and after)', () => {
        it('O1 Rule SCOPE first', () => {
            const found = whys('chat', `${STUDIO}{box-shadow:0 0 0 64px #000000}`)
            expect(found.length).toBeGreaterThan(0)
            expect(found.every((why) => /MC-1586/.test(why)), JSON.stringify(found)).toBe(true)
            expect(found.some((why) => E2_WHY.test(why))).toBe(false)
        })
        it('O2 the engine or Rule S first', () => {
            const found = whys('chat', `${SEND}{${DARK}}${NOTICE}{box-shadow:0 0 0 64px #000000}`)
            expect(found.length).toBeGreaterThan(0)
            expect(found.some((why) => E2_WHY.test(why))).toBe(false)
        })
        it('O3 the live chain first', () => {
            const found = whys('chat', `[data-part="chat-composer-host"]{padding-inline:64px}${NOTICE}{box-shadow:0 0 0 64px #000000}`)
            expect(found.some((why) => /ancestor padding along the failed-card chain/.test(why)), JSON.stringify(found)).toBe(true)
            expect(found.some((why) => E2_WHY.test(why))).toBe(false)
        })
        it('O4 Rule P first', () => {
            const found = whys('chat', `${SEND}{background:#ffffff;color:#000000;box-shadow:inset 0 0 0 64px #000000,0 0 0 64px #000000}`)
            expect(found.some((why) => /MC-2072/.test(why)), JSON.stringify(found)).toBe(true)
            expect(found.some((why) => E2_WHY.test(why))).toBe(false)
        })
        // Records a dependency: the engine's :root-only rule for settable tokens refuses this sheet before E-2 runs, so the E-2 pass
        // sees only :root overrides and needs no attribute-scoped token resolution.
        it('F2 GUARD: a settable app token written under an attribute selector is refused by the engine, not by E-2', () => {
            const found = whys('chat', `html[data-layout="phone"]{--focus-ring-w:60px}${NOTICE}{box-shadow:0 0 0 var(--focus-ring-w) #000000}`)
            expect(found.some((why) => /a pack may set tokens only on :root/.test(why)), JSON.stringify(found)).toBe(true)
            expect(found.some((why) => E2_WHY.test(why))).toBe(false)
        })
    })
})

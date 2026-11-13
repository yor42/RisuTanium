// @vitest-environment node
// Rule S and Rule R-c (UI-S6 I0a, MC-1569): the engine judges each rule block alone, so the colour pairs and the ancestor padding
// that several blocks can combine were unjudged. Classes: REPRO = refused here, accepted (ok:true) by the engine before this stage;
// GUARD = accepted before and after, or a new rule whose pre-fix verdict does not change.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cascadePass } from './cascade'
import { normalise } from './engine'
import { geometryPass } from './geometry'
import { lintAreaPack, type ThemeArea } from './index'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DESIGN = path.resolve(ROOT, 'docs/design')
const read = (rel: string): string => fs.readFileSync(path.join(DESIGN, rel), 'utf8')

const SEND = '[data-part="chat-send"]'
const SAFE = '[data-part="chat-message-avatar"]'
const DARK = 'background:#111111;color:#111111'
const YELLOW_ON_DARK = 'background:#ffff00;color:#111111'
const RULE_S = /MC-1569/

const reasons = (area: ThemeArea, css: string): string[] => lintAreaPack(area, css, 'probe').errors.map((e) => e.why)
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

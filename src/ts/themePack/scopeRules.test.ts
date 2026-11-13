// @vitest-environment node
// Rule SCOPE (UI-S6 I0a, MC-1586, MC-1608, MC-1609): a chat or Studio stylesheet is judged against one screen and applied to that
// screen only, so every channel through which it could reach beyond the elements it names is closed by a positive list. Classes:
// REPRO = refused here, accepted (ok:true) before this stage; GUARD = refused before and after, or accepted before and after.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalStylesheet } from './canonical'
import { lintPack as lintEngine } from './engine'
import { lintAreaPack, preprocessCss, type ThemeArea } from './index'
import { PROP_ALLOW, SHORTHAND_EFFECTS, isAllowedProperty, judgeShorthandValue, parseSelectorEntry, scopePass } from './scope'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.resolve(ROOT, 'docs/design', rel), 'utf8')

const SEND = '[data-part="chat-send"]'
const AVATAR = '[data-part="chat-message-avatar"]'
const NAME = '[data-part="chat-message-name"]'
const PART_OUTSIDE = /is not a part of the (chat|studio) screen/
const SCOPE = /MC-1586/

const verdict = (area: ThemeArea, css: string): { ok: boolean, why: string[] } => {
    const result = lintAreaPack(area, css, 'probe')
    return { ok: result.ok, why: result.errors.map((e) => e.why) }
}
const refused = (area: ThemeArea, css: string, reason: RegExp = SCOPE): void => {
    const { ok, why } = verdict(area, css)
    expect(ok, `${area}: ${css}`).toBe(false)
    expect(why.some((w) => reason.test(w)), `${area}: ${reason} against ${JSON.stringify(why)}`).toBe(true)
}
const accepted = (area: ThemeArea, css: string): void => {
    const { ok, why } = verdict(area, css)
    expect(ok, `${area}: ${css} -> ${JSON.stringify(why)}`).toBe(true)
}
/** Whether scope.ts alone refuses the stylesheet (the engine's own refusals are not consulted). */
const scopeRefuses = (area: ThemeArea, css: string): boolean => scopePass(area, css, []).length > 0

describe('axis B: a selector names only parts of the screen (REPRO)', () => {
    // T0a-15: base observed ok:true for each (gate1-r2 S8 to S13, C2 to C4, the census probes).
    it.each([
        ['S8', 'chat', '[data-part="settings-page"]{background-color:#000000;color:#ffffff}'],
        ['S9', 'chat', '[data-part="settings-shell"]{background-color:#000000}'],
        ['S10', 'chat', '[data-part="settings-page"]{font-size:40px;letter-spacing:2px;font-weight:100}'],
        ['S11', 'chat', '[data-part="setting-row-hint"]{color:#ffffff}'],
        ['S13', 'chat', '[data-part="settings-page"]{padding:64px;border:16px solid #ffffff}'],
        ['C2', 'chat', '[data-part="settings-notice"]{font-size:11px}'],
        ['C3', 'chat', '[data-part="settings-service-test-result"]{color:#ebebed}'],
        ['S12', 'studio', '[data-part="settings-shell"]{background-color:#000000;color:#ffffff}'],
        ['C4', 'studio', '[data-part="settings-notice"]{font-size:11px;letter-spacing:2px}'],
        ['a part of the Settings device row', 'chat', '[data-part="chat-shell-device-settings"]{color:#ffffff}'],
        ['a Home and sidebar dot', 'chat', '[data-part="reply-new-dot"]{background-color:#000000;color:#ffffff}'],
        ['a Home part', 'chat', '[data-part="home-shell"]{color:#ffffff}'],
        ['a pattern dialog part', 'chat', '[data-part="pattern-dialog"]{color:#ffffff}'],
        ['a chat part from a Studio sheet', 'studio', `${SEND}{color:#111111;background-color:#ffff00}`],
        ['a Studio part from a chat sheet', 'chat', '[data-part="studio-header"]{border-radius:12px}'],
        // the studio-entry button is rendered on the chat screen by the legacy sidebar: a chat sheet may not style it
        ['studio-entry in a chat sheet', 'chat', '[data-part="studio-entry"]{font-size:40px;letter-spacing:2px;padding:64px}'],
    ] as const)('%s (%s)', (_name, area, css) => {
        refused(area, css, PART_OUTSIDE)
    })

    it('C1: the same Settings rule in a Settings sheet is still refused for its own reason', () => {
        refused('settings', '[data-part="settings-notice"]{font-size:11px}', /names the protected part settings-notice/)
    })

    // T0a-16 (SC-4): a valueless [data-part] matches the parts of every screen.
    it.each([
        ['chat', '[data-part]{color:#ffffff}'],
        ['studio', '[data-part]{color:#ebebed}'],
        ['chat', `${SEND}[data-part]{color:#ffffff}`],
        ['chat', `[data-part] ${SEND}{border-radius:4px}`],
    ] as const)('a valueless data-part in %s: %s', (area, css) => {
        refused(area, css, /\[data-part\] without a value/)
    })

    // T0a-17 (SC-3): a subject that names no part reaches elements of every screen.
    it.each([
        ['chat', `[data-kind="icon-button"]{color:#ffffff}${SEND}{background-color:#ffff00;color:#111111}`],
        ['chat', '[data-kind="icon-button"]{font-weight:100;letter-spacing:2px}'],
        ['chat', '[data-kind="peer"]{border-color:#f8f8f2;border-radius:12px;color:#fff}'],
        ['chat', `${AVATAR} [data-kind="peer"]{color:#ebebed}`],
        ['studio', '[data-kind="peer"]{border-radius:12px}'],
        ['chat', '[data-fail]{color:#ebebed}'],
        ['chat', '[data-role="user"]{border-color:#f8f8f2}'],
    ] as const)('a subject that names no part in %s: %s', (area, css) => {
        refused(area, css, /names no part/)
    })

    // a root entry may carry only the root attributes data-input and data-layout; any other attribute makes it an ordinary subject
    it.each([
        ['html[data-theme="x"]{--pack-a:#ffffff}', /names no part/],
        ['html[data-role="user"]{--pack-a:1px}', /names no part/],
        ['html[data-part="settings-page"]{--pack-x:#000000}', PART_OUTSIDE],
    ] as const)('a root entry with another attribute: %s', (css, reason) => {
        for (const area of ['chat', 'studio'] as const) refused(area, css, reason)
    })

    it('GUARD: a root entry that names a part of the screen is judged as that part', () => {
        accepted('chat', `html${SEND}{color:#111111;background:#ffff00}`)
    })

    // T0a-18: an ancestor part of another screen, and the sibling combinators.
    it('refuses an ancestor part of another screen and the sibling combinators', () => {
        refused('chat', `[data-part="settings-shell"] ${SEND}{color:#111111;background-color:#ffff00}`, PART_OUTSIDE)
        refused('chat', `${AVATAR} ~ ${NAME}{color:#ebebed}`, /sibling combinators/)
        refused('chat', `${AVATAR} + ${NAME}{color:#ebebed}`, /sibling combinators/)
        refused('studio', '[data-part="studio-header"] ~ [data-part="studio-header-title-button"]{color:#ebebed}', /sibling combinators/)
    })

    it('accepts descendant and child combinators between parts of the screen, and extra data attributes', () => {
        accepted('chat', `[data-role="user"] ${NAME}{width:1px;opacity:0}`)
        accepted('chat', `[data-part="chat-message"] > ${NAME}{opacity:0}`)
        accepted('chat', `html[data-input="hover"] ${NAME}:hover{text-decoration:underline}`)
        accepted('studio', '[data-part="studio-header"] [data-part="studio-header-back"]{border-radius:4px}')
    })
})

describe('T0a-27: scope.ts parses with the engine grammar (GUARD: the engine refuses these too)', () => {
    it.each([
        'html:has([data-part="chat-send"]){--nexus-text:#000000}',
        `${SEND}:is([data-part="settings-shell"]){color:#000000}`,
        ':where([data-part="settings-shell"]){color:#000000}',
        '[data-part]:not([data-part="chat-send"]){color:#ebebed}',
        `${SEND}::before{content:"x"}`,
        '::selection{background:#000000}',
        '*{color:#000000}',
        '.text-textcolor{color:#000000}',
        '#app{color:#000000}',
        'body{color:#000000}',
        '[role="dialog"]{color:#000000}',
        `${SEND}[data-x^="a"]{color:#000000}`,
        '> [data-part="chat-send"]{color:#000000}',
        `${SEND} >> ${NAME}{color:#000000}`,
    ])('scope.ts refuses %s without the engine', (css) => {
        expect(scopeRefuses('chat', css), css).toBe(true)
    })

    it('parses compounds, combinators and attributes as the engine does', () => {
        const parsed = parseSelectorEntry(`html[data-input="hover"] [data-part="chat-message"][data-role="user"] > ${NAME}:hover`)
        expect(parsed.grammarWhy).toBe('')
        expect(parsed.siblings).toBe(false)
        expect(parsed.compounds.map((c) => c.root)).toEqual(['html', '', ''])
        expect(parsed.compounds[1].attrs).toEqual([['data-part', 'chat-message'], ['data-role', 'user']])
        expect(parsed.compounds[2].pseudo).toBe(':hover')
        expect(parseSelectorEntry('[data-part]').compounds[0].attrs).toEqual([['data-part', undefined]])
        expect(parseSelectorEntry('a b').grammarWhy).not.toBe('')
        expect(parseSelectorEntry('').grammarWhy).not.toBe('')
        expect(parseSelectorEntry(`${AVATAR} ~ ${NAME}`).siblings).toBe(true)
    })
})

describe('axis A: statements (GUARD: every one is refused before and after)', () => {
    // T0a-20: scopeRules pins each refusal, so a later relaxation of the engine or the tokenizer fails here.
    it.each([
        ['nested rule', `${SEND}{width:36px; & + *{color:#000000}}`],
        ['nested :root token block', `${SEND}{width:36px; :root &{color:#000000}}`],
        ['@keyframes', '@keyframes nexus-spin{from{opacity:0}to{opacity:0}}'],
        ['@-webkit-keyframes', '@-webkit-keyframes x{from{opacity:0}}'],
        ['@keyframes written with a hex escape', '@\\6b eyframes x{from{opacity:0}}'],
        ['@property', '@property --nexus-canvas-warm{syntax:"<color>";inherits:true;initial-value:#000000}'],
        ['@layer block', `@layer base{${SEND}{color:#111111}}`],
        ['@layer statement', '@layer theme, base, components;'],
        ['@counter-style', '@counter-style x{system:cyclic;symbols:"a"}'],
        ['@page', '@page{margin:0}'],
        ['@container', `@container (min-width:1px){${SEND}{color:#111111}}`],
        ['@scope', '@scope ([data-part="settings-shell"]){:scope{color:#000000}}'],
        ['@supports', '@supports (display:grid){[data-part="settings-shell"]{color:#000000}}'],
        ['@import', '@import url("x.css");'],
        ['@namespace', '@namespace svg url(http://www.w3.org/2000/svg);'],
        ['@starting-style', `@starting-style{${SEND}{color:#111111}}`],
        ['@view-transition', '@view-transition{navigation:auto}'],
        ['@position-try', '@position-try --x{top:0}'],
        ['@font-palette-values', '@font-palette-values --x{font-family:"a"}'],
        ['@font-face inside @media', '@media (min-width:1px){@font-face{font-family:"pack-a";src:url("fonts/a.woff2")}}'],
    ])('%s is refused in chat and studio', (_name, css) => {
        for (const area of ['chat', 'studio'] as const) {
            let ok: boolean
            try { ok = lintAreaPack(area, css, 'probe').ok } catch { ok = false }
            expect(ok, `${area}: ${css}`).toBe(false)
        }
    })

    // each layer refuses on its own, so a relaxation of one of them fails here even while another still refuses the statement
    it('the tokenizer refuses a block or an at-rule inside a rule, and the engine refuses every at-keyword but media', () => {
        for (const css of [`${SEND}{width:36px; & + *{color:#000000}}`, `${SEND}{width:36px; :root &{color:#000000}}`, `${SEND}{@media (min-width:1px){color:#111111}}`]) {
            expect(canonicalStylesheet(preprocessCss(css)).errors.length, css).toBeGreaterThan(0)
        }
        for (const keyword of ['layer', 'keyframes', 'property', 'supports', 'container', 'scope', 'starting-style', 'counter-style', 'position-try']) {
            const result = lintEngine(`@${keyword} x{${SEND}{color:#111111}}`, 'probe')
            expect(result.ok, keyword).toBe(false)
            expect(result.errors.some((e) => new RegExp(`@${keyword} is not allowed in a pack stylesheet`).test(e.why)), keyword).toBe(true)
        }
    })

    it('a top-level @font-face, a top-level @media of style rules and style rules are accepted', () => {
        accepted('chat', `@font-face{font-family:"pack-a";src:url("fonts/a.woff2")}@media (min-width:1px){${NAME}{opacity:0}}${NAME}{font-family:"pack-a"}`)
    })
})

describe('axis C: properties (REPRO)', () => {
    it('the allow list keeps the properties the acceptance sheets set', () => {
        for (const p of ['color', 'background', 'background-color', 'border-radius', 'padding', 'margin', 'font-size', 'font-weight', 'line-height', 'box-shadow', 'width', 'display', 'overflow', 'gap', 'grid-template-columns', 'flex-direction', 'opacity', 'text-decoration', 'white-space', '-webkit-line-clamp', 'color-scheme']) expect(isAllowedProperty(p), p).toBe(true)
        expect(PROP_ALLOW.length).toBeGreaterThan(5)
    })

    // T0a-23: base observed ok:true for each.
    it.each([
        'view-transition-name:root', 'view-transition-class:x', 'anchor-name:--x', 'anchor-scope:all', 'position-anchor:--x',
        'counter-increment:list-item', 'counter-set:list-item 5', 'timeline-scope:--x', 'scroll-timeline-name:--y', 'view-timeline-name:--z',
        'list-style-image:url("images/a.png")', 'content-visibility:hidden', 'touch-action:none',
    ])('%s on a part is refused', (declaration) => {
        refused('chat', `${NAME}{${declaration}}`, /is not on the list of properties/)
        // a Studio control part is a reach part of the engine, which refuses the declaration first; scope.ts refuses it on its own
        expect(scopePass('studio', `[data-part="studio-header-back"]{${declaration}}`, []).some((e) => /is not on the list of properties/.test(e.why)), declaration).toBe(true)
    })

    // T0a-23 (shorthands): a shorthand is judged by the longhands it sets. Base observed ok:true (gate1-r3 L1 and L3).
    it.each([
        `${NAME}{list-style:url("images/a.png")}`,
        `${NAME}{background:#101010 fixed}`,
        `${NAME}{background:url("images/a.png") local #101010}`,
        `${NAME}{background:#101010 no-repeat fixed center}`,
    ])('%s is refused', (css) => {
        refused('chat', css, /would set (list-style-image|background-attachment)/)
    })

    // the same shorthands through a private variable, judged on every value the variable can take (E-r4-2); base verdict not observed
    it.each([
        [':root{--pack-l:url("images/a.png")}', `${NAME}{list-style:var(--pack-l)}`, /list-style-image/],
        [':root{--pack-b:#101010 fixed}', `${NAME}{background:var(--pack-b)}`, /background-attachment/],
        [':root{--pack-b:#101010}html[data-input="hover"]{--pack-b:#101010 local}', `${NAME}{background:var(--pack-b)}`, /background-attachment/],
    ])('the private variable form %s %s is refused', (root, rule, reason) => {
        refused('chat', root + rule, reason)
    })

    it('accepts the shorthand values that set only allowed longhands, and a private variable that holds such a value', () => {
        accepted('chat', `${NAME}{list-style:none;background:#101010 no-repeat center}`)
        accepted('chat', `${NAME}{list-style:square inside}`)
        accepted('chat', `:root{--pack-b:#101010}${NAME}{background:var(--pack-b)}`)
        accepted('chat', `:root{--pack-l:none}${NAME}{list-style:var(--pack-l)}`)
    })

    it('judgeShorthandValue reads fixed and local as words, not as parts of other words', () => {
        expect(judgeShorthandValue('background', '#101010 fixed')).not.toBe('')
        expect(judgeShorthandValue('background', 'local, #101010')).not.toBe('')
        expect(judgeShorthandValue('background', 'url("fixed.png") #101010')).toBe('')
        expect(judgeShorthandValue('background', '#101010 !important')).toBe('')
        expect(judgeShorthandValue('list-style', 'none')).toBe('')
        expect(judgeShorthandValue('list-style', 'url(x.png)')).not.toBe('')
        expect(judgeShorthandValue('list-style', 'symbols(cyclic "a")')).not.toBe('')
        expect(judgeShorthandValue('list-style', 'var(--nexus-x)')).not.toBe('')
        expect(judgeShorthandValue('list-style', 'var(--pack-l)')).toBe('')
        expect(judgeShorthandValue('margin', 'fixed')).toBe('')
    })

    it('every shorthand on the allow list sets only allowed longhands, apart from the two judged by value', () => {
        const valueJudged = new Set(['background-attachment', 'list-style-image'])
        for (const [shorthand, effect] of Object.entries(SHORTHAND_EFFECTS)) {
            expect(isAllowedProperty(shorthand), shorthand).toBe(true)
            for (const longhand of effect.sets) expect(isAllowedProperty(longhand) || valueJudged.has(longhand), `${shorthand} sets ${longhand}`).toBe(true)
            for (const longhand of effect.resets) expect(effect.sets.includes(longhand), `${shorthand} resets ${longhand}, which it also sets`).toBe(false)
        }
        expect(Object.keys(SHORTHAND_EFFECTS)).toContain('background')
        expect(Object.keys(SHORTHAND_EFFECTS)).toContain('list-style')
    })

    // the CSS shorthand properties (and the legacy aliases) a stylesheet could write; the allow list admits some of them
    const CSS_SHORTHANDS = [
        'all', 'animation', 'background', 'background-position', 'border', 'border-block', 'border-block-start', 'border-block-end', 'border-inline-start', 'border-inline-end', 'scroll-margin-block', 'scroll-margin-inline', 'scroll-padding-block', 'scroll-padding-inline', 'border-block-color', 'border-block-style', 'border-block-width', 'border-bottom', 'border-color', 'border-image',
        'border-inline', 'border-inline-color', 'border-inline-style', 'border-inline-width', 'border-left', 'border-radius', 'border-right', 'border-style', 'border-top', 'border-width',
        'column-rule', 'columns', 'container', 'flex', 'flex-flow', 'font', 'font-synthesis', 'font-variant', 'gap', 'grid', 'grid-area', 'grid-column', 'grid-gap', 'grid-row', 'grid-template',
        'inset', 'inset-block', 'inset-inline', 'list-style', 'margin', 'margin-block', 'margin-inline', 'mask', 'offset', 'outline', 'overflow', 'overscroll-behavior', 'padding', 'padding-block',
        'padding-inline', 'place-content', 'place-items', 'place-self', 'scroll-margin', 'scroll-padding', 'text-decoration', 'text-emphasis', 'text-wrap', 'transition', 'white-space',
    ]
    it('every shorthand the allow list admits has a SHORTHAND_EFFECTS row', () => {
        const admitted = CSS_SHORTHANDS.filter(isAllowedProperty)
        expect(admitted.length).toBeGreaterThan(40)
        expect(admitted.filter((name) => !(name in SHORTHAND_EFFECTS))).toEqual([])
    })

    it('a property on the allow list is accepted on a part', () => {
        accepted('chat', `${NAME}{color:#f0f0f0;font-weight:600;border-radius:4px;opacity:0.9;text-decoration:underline;margin:0 4px}`)
    })
})

describe('axis C and D: the document root', () => {
    // T0a-19 (SH-1): base observed ok:true for these rows; scope.ts refuses each on its own.
    it.each([
        ':root{color-scheme:normal}',
        ':root{color-scheme:light dark}',
        ':root{color-scheme:only light}',
        'html[data-layout="wide"]{color-scheme:dark}',
        '@media (min-width:1px){:root{color-scheme:light}}',
        ':root{color-scheme:var(--pack-x)}',
    ])('%s is refused', (css) => {
        for (const area of ['chat', 'studio'] as const) {
            expect(scopeRefuses(area, css), `${area}: ${css}`).toBe(true)
            expect(verdict(area, css).ok, `${area}: ${css}`).toBe(false)
        }
    })

    it('a private variable cannot carry a colour scheme either', () => {
        expect(scopeRefuses('chat', ':root{--pack-x:light}:root{color-scheme:var(--pack-x)}')).toBe(true)
    })

    // E-r3-6: the custom property of the same name is refused on the unchanged base as well (a guard of that refusal).
    it('--color-scheme must be light or dark', () => {
        for (const area of ['chat', 'studio'] as const) expect(verdict(area, ':root{--color-scheme:light dark}').ok).toBe(false)
    })

    it('accepts color-scheme light or dark on a bare :root or html', () => {
        accepted('chat', ':root{color-scheme:light}')
        accepted('studio', 'html{color-scheme:dark}')
        accepted('chat', ':root{color-scheme:dark !important}')
    })

    it('refuses every other property on the root', () => {
        for (const css of ['html{color:#000000}', ':root{background-color:#000000}', 'html[data-layout="wide"]{padding:4px}']) refused('chat', css, /may not be set on the document root|only custom properties/)
    })

    // T0a-22 (SC-6): names of other screens' tokens; the shared and private names stay.
    it('refuses a token of another screen and accepts --pack-* and the screen tokens', () => {
        refused('chat', ':root{--settings-dialog-padding:4px}', /not a token this stylesheet may set/)
        for (const name of ['--settings-row-padding-y', '--dialog-width', '--page-max-width']) {
            expect(verdict('chat', `:root{${name}:4px}`).ok, name).toBe(false)
            expect(scopeRefuses('chat', `:root{${name}:4px}`), name).toBe(true)
        }
        accepted('chat', ':root{--pack-x:1px}')
        accepted('chat', ':root{--color-scheme:light}')
        accepted('chat', ':root{--nexus-text:#f0f0f0}')
    })

    it('a token on a part entry is judged by name too', () => {
        expect(scopePass('chat', `${NAME}{--settings-dialog-padding:4px}`, []).some((e) => /not a token this stylesheet may set/.test(e.why))).toBe(true)
        expect(verdict('chat', `${NAME}{--settings-dialog-padding:4px}`).ok).toBe(false)
    })
})

describe('axis D: font families (REPRO)', () => {
    // T0a-21: base observed ok:true for the refused rows.
    it.each([
        ['chat', '@font-face{font-family:"arial";src:url("fonts/a.woff2")}'],
        ['chat', '@font-face{font-family:"times new roman";src:url("fonts/a.woff2")}'],
        ['chat', '@font-face{font-family:"nanumsquare neo logo";src:url("fonts/a.woff2")}'],
        ['studio', '@font-face{font-family:arial;src:url("fonts/a.woff2")}'],
        ['studio', '@font-face{font-family:consolas;src:url("fonts/a.woff2")}'],
        ['chat', '@font-face{font-family:"pack serif";src:url("fonts/a.woff2")}'],
        ['chat', '@font-face{font-family:"pack-";src:url("fonts/a.woff2")}'],
        ['chat', `@font-face{font-family:"pack-${'a'.repeat(64)}";src:url("fonts/a.woff2")}`],
    ] as const)('%s %s is refused', (area, css) => {
        refused(area, css, /must start with pack-/)
    })

    it('accepts a pack- family with a matching use site, and the 63-character bound', () => {
        accepted('chat', `@font-face{font-family:"pack-pretendard";src:url("fonts/a.woff2")}${NAME}{font-family:"pack-pretendard"}`)
        accepted('studio', '@font-face{font-family:pack-mono_2;src:url("fonts/a.woff2")}')
        accepted('chat', `@font-face{font-family:"pack-${'a'.repeat(62)}";src:url("fonts/a.woff2")}`)
    })

    it('a family without the prefix is still refused by the earlier rule when the sheet uses it (MC-1568)', () => {
        refused('chat', `@font-face{font-family:"Pretendard";src:url("fonts/a.woff2")}${NAME}{font-family:"Pretendard"}`, /MC-1568|MC-1550/)
    })

    it('the settings and home areas keep their families', () => {
        accepted('settings', '@font-face{font-family:"pack serif";src:url("fonts/a.woff2")}')
        accepted('home', '@font-face{font-family:"pack serif";src:url("fonts/a.woff2")}')
    })
})

describe('the acceptance sheets stay accepted (T0a-7, GUARD)', () => {
    it.each([['chat', 'origin-navy'], ['chat', 'banana-cocoa'], ['studio', 'origin-navy'], ['studio', 'banana-cocoa']] as const)('%s %s', (area, name) => {
        const css = read(`${area}/themes/${name}.css`)
        expect(scopePass(area, css, [])).toEqual([])
        accepted(area, css)
    })

    it('scope.ts leaves the settings and home areas alone', () => {
        expect(scopePass('settings', '[data-part="chat-send"]{font-size:11px}', ['arial'])).toEqual([])
        expect(scopePass('home', ':root{--color-textcolor:#111111}', [])).toEqual([])
    })
})

// R20: Home and Settings run neither Rule S nor Rule SCOPE, so a selector whose subject names no part is not measured there (the reader attributes a declaration only to named parts). v1 neither applies nor judges those sheets; this is the tripwire
// that must flip, with these rows refused in Home and Settings, before a build applies either area.
describe('R20 residue, not a claim: an area may be applied only once these rows are refused there (GUARD)', () => {
    it.each([
        ['H1 a valueless data-part with padding-inline', 'home', '[data-part]{padding-inline:60px}'],
        ['H3 a valueless data-part with margin-inline', 'home', '[data-part]{margin-inline:60px}'],
        ['H6 a subject with no data-part with margin-inline', 'home', '[data-x="y"]{margin-inline:60px}'],
        ['S1 a valueless data-part with padding-inline', 'settings', '[data-part]{padding-inline:60px}'],
    ] as const)('%s is accepted in %s and refused in chat and Studio', (_name, area, css) => {
        accepted(area, css)
        refused('chat', css)
        refused('studio', css)
    })
})

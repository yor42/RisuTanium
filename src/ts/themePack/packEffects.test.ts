// @vitest-environment node
// The pack effects (MC-2942, MC-3010, MC-3638): transition, animation with same-sheet @keyframes, transform, filter and
// backdrop-filter, admitted only on an eligible subject and within strict grammars and bounds. Every row is judged through the public
// entry points (judgeAreaSheet, structurePass, canonicalStylesheet), so a pre-change run fails by assertion; the rows that
// need the new modules load them lazily and are guards. Classes: REPRO = refused before the change and accepted after; GUARD = the same
// verdict before and after (the verdict, not the message, for a row whose sheet holds a @keyframes block, whose canonical errors change).
//
// Install warnings (judgeAreaSheet().warnings, never part of `result`): a declaration that is refused and whose every selector entry is a
// candidate (clean selector, named parts of the area, a tier the property can use) gets one warning when its value fails the strict
// grammar or a bound. A subject that is not a candidate, or a value the tier refuses (a non-paint transition on a reach part), gets no new warning.
import { describe, expect, it } from 'vitest'
import { AREA_LINT, judgeAreaSheet, preprocessCss } from './index'
import type { JudgedArea } from './index'
import { canonicalStylesheet } from './canonical'
import { structurePass } from './structure'
import { CHAT_PARTS, HOME_PARTS, SETTINGS_PARTS } from './areaParts'
import { SAFE_LEAVES } from './engine'
import { shapeOnlySheet, shapeTokenNames } from './shapeMode'
import { HOME_CRITICAL, HOME_REACH, HOME_SAFE } from './registries/home'
import { POPUPS_CRITICAL, POPUPS_PARTS, POPUPS_REACH, POPUPS_SAFE } from './registries/popups'
import { CRITICAL5B, SAFE5B } from './registries/settings5b'
import { STUDIO_CRITICAL, STUDIO_REACH, STUDIO_SAFE } from './registries/studio'

const AREAS: readonly JudgedArea[] = ['chat', 'studio', 'settings', 'home', 'popups']
const A = '[data-part="chat-message-avatar"]'
const B = '[data-part="chat-header-title"]'
const SEND = '[data-part="chat-send"]'
const HEADER = '[data-part="chat-header"]'
const SHEET = '[data-part="chat-sheet"]'
const K = '@keyframes pack-chat-pulse{from{opacity:.6}to{opacity:1}}'
const ANIM = 'animation:pack-chat-pulse 1.2s infinite alternate'
const SAFE_PART: Record<JudgedArea, string> = { chat: 'chat-message-avatar', studio: 'studio-asset-row', settings: 'settings-section-heading', home: 'home-brand', popups: POPUPS_SAFE[0] }
const safe = (area: JudgedArea, suffix = ''): string => `[data-part="${SAFE_PART[area]}"]${suffix}`
const EFFECT_PROPS = new Set(['transition', 'animation', 'transform', 'translate', 'scale', 'rotate', 'transform-origin', 'filter', 'backdrop-filter'])

const judge = (area: JudgedArea, css: string) => judgeAreaSheet(area, css)
const whys = (area: JudgedArea, css: string): string[] => judge(area, css).result.errors.map((e) => e.why)
const expectOk = (area: JudgedArea, css: string): void => {
    expect(judge(area, css).result.ok, `${area}: ${css}\n${JSON.stringify(whys(area, css))}`).toBe(true)
}
const expectRefused = (area: JudgedArea, css: string): void => {
    expect(judge(area, css).result.ok, `${area}: ${css}`).toBe(false)
}
const effectWarnings = (area: JudgedArea, css: string) => judge(area, css).warnings.filter((w) => EFFECT_PROPS.has(w.prop))
/** The sheet without its @keyframes pack-* blocks: the base the single-defect rows compare against. */
const withoutPackKeyframes = (css: string): string => css.replace(/@keyframes\s+pack-[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/gi, '')
const legacyErrors = (area: JudgedArea, css: string) => AREA_LINT[area](canonicalStylesheet(preprocessCss(withoutPackKeyframes(css))).text, '').errors
const lazy = async <T>(file: string): Promise<T> => (await import(/* @vite-ignore */ file)) as T

describe('E: the effects are admitted on an eligible subject (REPRO)', () => {
    it('E1 a transition on a safe leaf', () => { expectOk('chat', `${A}{transition:opacity 200ms ease-out}`) })
    it('E2 a paint transition on a reach part', () => { expectOk('chat', `${SEND}{transition:background-color 150ms}`) })
    for (const area of AREAS) {
        it(`E3 ${area}: transform on a safe part`, () => { expectOk(area, `${safe(area)}{transform:translateX(4px) rotate(5deg)}`) })
    }
    it('E4 a same-sheet keyframes block and an animation that names it', () => { expectOk('chat', `${K}${A}{${ANIM}}`) })
    it('E5 filter on a safe leaf and backdrop-filter on a reach part', () => {
        expectOk('chat', `${A}{filter:blur(4px)}`)
        expectOk('chat', `${HEADER}{backdrop-filter:blur(12px)}`)
    })
    it('E6 the judged canonical text keeps the keyframes block and the sheet is accepted', () => {
        const judged = judge('chat', `${K}${A}{${ANIM}}`)
        expect(judged.result.ok).toBe(true)
        expect(judged.canonical).toContain('@keyframes pack-chat-pulse')
    })
    it('E8 a claim inside a pack @media block', () => { expectOk('chat', `@media (min-width:600px){${A}{transition:opacity 1s}}`) })
    it('E9 the claimed declaration leaves the sheet, the rest of the rule keeps its refusal', () => {
        const why = whys('chat', `${A}{transition:opacity 1s;position:fixed}`)
        expect(why.some((w) => /position/.test(w))).toBe(true)
        expect(why.some((w) => /transition/.test(w))).toBe(false)
    })
    it('E10 sums exactly at the limits', () => {
        expectOk('chat', `${A}{transform:translateX(32px) translateX(32px) scale(1.2) scale(1.25)}`)
        expectOk('chat', `${A}{filter:blur(4px) blur(4px)}`)
    })
    it('E11 empty frames are admitted and counted', () => {
        expectOk('chat', `@keyframes pack-chat-a{from{}to{}}${A}{animation:pack-chat-a 1s}`)
    })
    it('E12 the envelope is closed under the shape strip (compatibility guard: also holds where the strip removes the animation): the stripped text is judged ok, in every area, for an animation over a filter-only keyframes block', () => {
        for (const area of AREAS) {
            const part = `[data-part="${SAFE_PART[area]}"]`
            const sheet = `@keyframes pack-${area}-p{from{filter:blur(2px)}to{filter:blur(4px)}}@keyframes pack-${area}-g{to{filter:blur(1px)}}${part}{animation:pack-${area}-p 1s infinite,pack-${area}-g 1s infinite;filter:blur(4px);color:#ffffff}`
            const judged = judge(area, sheet)
            expect(judged.result.ok, `${area}: ${JSON.stringify(whys(area, sheet))}`).toBe(true)
            const stripped = shapeOnlySheet(judged.canonical, shapeTokenNames(area))
            expect(stripped, area).toContain(`@keyframes pack-${area}-p{from{}to{}}`)
            expectOk(area, stripped)
        }
    })
    it('E13 mixed case: function names read case-insensitively, a hex colour elsewhere in the sheet', () => {
        expectOk('chat', `${A}{transform:translateX(4px)}${B}{color:#FFF}`)
    })
    it('E14 upper-case keywords', () => {
        expectOk('chat', `${A}{transition:opacity 200ms EASE-OUT}`)
        expectOk('chat', `${K}${A}{animation:pack-chat-pulse 1.2s INFINITE ALTERNATE}`)
    })
    it('E15 an entry is judged normalised: an upper-case root', () => {
        expectOk('chat', `HTML[data-layout="phone"] ${A}{transition:opacity 200ms}`)
    })
    it('E4 frames: any-case offsets count, a stray frame is refused', () => {
        const mk = (frames: string, duration: string): string => `@keyframes pack-chat-a{${frames}}${A}{animation:pack-chat-a ${duration}}`
        expectOk('chat', mk('FROM{opacity:.6}to{opacity:1}', '340ms'))
        expectRefused('chat', mk('FROM{opacity:.6}to{opacity:1}', '339ms'))
        expectOk('chat', mk('0%,50%{opacity:.6}100%{opacity:1}', '510ms'))
        expectRefused('chat', mk('from{opacity:.6} x{opacity:0} to{opacity:1}', '1s'))
        expectRefused('chat', mk('from{opacity:.6};to{opacity:1}', '1s'))
        expectRefused('chat', mk('from{opacity:.6}[x] to{opacity:1}', '1s'))
        expectRefused('chat', mk('from{opacity:.6;[}to{opacity:1}', '1s'))
        expectRefused('chat', mk('from{opacity:.6}101%{opacity:1}', '1s'))
    })
})

describe('G2, G5: refusals outside the envelope keep their legacy messages (GUARD)', () => {
    const BASE_ERRORS: Record<string, string[]> = {
        "G2-R7": ["[data-part=\"home-brand\"]|animation|animation can cover, fade or disable a protected surface from anywhere"],
        "G2-R8": ["[data-part=\"home-mode-thumb\"]|transition|transition can cover, fade or disable a protected surface from anywhere"],
        "G2-H39": ["[data-part=\"home-send\"]|backdrop-filter|backdrop-filter can cover, fade or disable a protected surface from anywhere",
            "[data-part=\"home-send\"]|backdrop-filter|blur() is not allowed in a pack (allowed: var(), colour functions, gradients, url(), image-set(), calc(<x> * -1), minmax(), repeat(), fit-content(), cubic-bezier(), steps(), rect(), inset(), circle(), ellipse(), polygon(), path(), xywh()) (MC-1549, MC-1555)"],
        "G2-H45": ["[data-part=\"home-send\"]|transition|transition can cover, fade or disable a protected surface from anywhere"],
        "G2-P13": ["[data-part=\"studio-toast\"]|transform|transform can cover, fade or disable a protected surface from anywhere",
            "[data-part=\"studio-toast\"]|transform|scale() is not allowed in a pack (allowed: var(), colour functions, gradients, url(), image-set(), calc(<x> * -1), minmax(), repeat(), fit-content(), cubic-bezier(), steps(), rect(), inset(), circle(), ellipse(), polygon(), path(), xywh()) (MC-1549, MC-1555)"],
        "G2-P14": ["[data-part=\"studio-toast\"]|scale|scale can cover, fade or disable a protected surface from anywhere"],
        "G2-sheet": ["[data-part=\"chat-sheet\"]|transition|transition can cover, fade or disable a protected surface from anywhere"],
        "G2-header": ["[data-part=\"chat-header\"]|backdrop-filter|backdrop-filter can cover, fade or disable a protected surface from anywhere",
            "[data-part=\"chat-header\"]|backdrop-filter|blur() is not allowed in a pack (allowed: var(), colour functions, gradients, url(), image-set(), calc(<x> * -1), minmax(), repeat(), fit-content(), cubic-bezier(), steps(), rect(), inset(), circle(), ellipse(), polygon(), path(), xywh()) (MC-1549, MC-1555)"],
        "G5-nexus": ["@keyframes||@keyframes is not allowed in a pack stylesheet (only @media; a pack cannot define keyframes or import anything)",
            "(stylesheet)||a block inside a rule (CSS nesting, or a {} value) is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only"],
        "G5-webkit": ["@-webkit-keyframes||@-webkit-keyframes is not allowed in a pack stylesheet (only @media; a pack cannot define keyframes or import anything)",
            "(stylesheet)||a block inside a rule (CSS nesting, or a {} value) is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only"],
        "G5-upper": ["@keyframes||@keyframes is not allowed in a pack stylesheet (only @media; a pack cannot define keyframes or import anything)",
            "(stylesheet)||a block inside a rule (CSS nesting, or a {} value) is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only"],
        "G5-media": ["@keyframes||@keyframes is not allowed in a pack stylesheet (only @media; a pack cannot define keyframes or import anything)",
            "(stylesheet)||an at-rule inside a rule is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only",
            "(stylesheet)||a block inside a rule (CSS nesting, or a {} value) is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only",
            "(stylesheet)||text outside a rule (\"@keyframes pack-chat-a\"): the browser joins it to the next rule and drops that rule, the checks do not (MC-1549)"],
        "G5-inrule": ["@keyframes||@keyframes is not allowed in a pack stylesheet (only @media; a pack cannot define keyframes or import anything)",
            "(stylesheet)||an at-rule inside a rule is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only",
            "(stylesheet)||a block inside a rule (CSS nesting, or a {} value) is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only",
            "(stylesheet)||@ may only start a statement (\"@keyframes p\"): put @media and @font-face blocks on their own (MC-1549)"],
        "G5-nonpack-anim": ["@keyframes||@keyframes is not allowed in a pack stylesheet (only @media; a pack cannot define keyframes or import anything)",
            "[data-part=\"chat-message-avatar\"]|animation|animation can cover, fade or disable a protected surface from anywhere",
            "(stylesheet)||a block inside a rule (CSS nesting, or a {} value) is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only"],
    }
    const CASES: [string, JudgedArea, string][] = [
        ['G2-R7', 'home', '[data-part="home-brand"]{animation:blink .05s infinite alternate}'],
        ['G2-R8', 'home', '[data-part="home-mode-thumb"]{transition:all 4s}'],
        ['G2-H39', 'home', '[data-part="home-send"]{backdrop-filter:blur(100px)}'],
        ['G2-H45', 'home', '[data-part="home-send"]{transition:none}'],
        ['G2-P13', 'studio', '[data-part="studio-toast"]{transform:scale(40)}'],
        ['G2-P14', 'studio', '[data-part="studio-toast"]{scale:40}'],
        ['G2-sheet', 'chat', '[data-part="chat-sheet"]{transition:opacity 1s}'],
        ['G2-header', 'chat', '[data-part="chat-header"]{backdrop-filter:blur(99px)}'],
        ['G5-nexus', 'chat', '@keyframes nexus-spin{from{opacity:0}to{opacity:0}}'],
        ['G5-webkit', 'chat', '@-webkit-keyframes x{from{opacity:0}}'],
        ['G5-upper', 'chat', '@KEYFRAMES Nexus-Spin{from{opacity:0}to{opacity:0}}'],
        ['G5-media', 'chat', '@media (min-width:0){@keyframes pack-chat-a{from{opacity:0}to{opacity:1}}}'],
        ['G5-inrule', 'chat', `${A}{@keyframes pack-chat-a{from{opacity:0}to{opacity:1}}}`],
        ['G5-nonpack-anim', 'chat', `@keyframes pulse{from{opacity:.6}to{opacity:1}}${A}{animation:pulse 1s}`],
    ]
    it.each(CASES)('%s errors equal the errors recorded before the change', (id, area, css) => {
        const { result } = judgeAreaSheet(area, css)
        expect(result.ok).toBe(false)
        expect(result.errors.map((e) => `${e.selector}|${e.prop}|${e.why}`)).toEqual(BASE_ERRORS[id])
    })
    it('G2 a corpus-style refusal on an eligible subject names its bound in a warning, outside the verdict', () => {
        const judged = judge('home', '[data-part="home-send"]{backdrop-filter:blur(100px)}')
        expect(judged.result.errors.map((e) => `${e.selector}|${e.prop}|${e.why}`)).toEqual(BASE_ERRORS['G2-H39'])
        expect(judged.warnings.filter((w) => w.prop === 'backdrop-filter')).toHaveLength(1)
    })
    // V-1 of #654: both refusals share the generic errors; the cap names itself in a warning, and so must the ancestor rule. Regression reproducer for the ancestor rows (no warning before).
    it.each([['chat', 'chat-sidebar'], ['chat', 'chat-sheet'], ['settings', 'settings-section'], ['settings', 'settings-page']] as const)('V1 %s %s: a backdrop-filter on an escape-route ancestor names that rule in a warning, verdict unchanged', (area, part) => {
        const judged = judge(area, `[data-part="${part}"]{backdrop-filter:blur(8px)}`)
        expect(judged.result.ok).toBe(false)
        expect(judged.warnings.filter((w) => w.prop === 'backdrop-filter' && w.why.includes(`not allowed on ${part}`))).toHaveLength(1)
    })
    it('V1 a capped blur and an ancestor blur give different reasons (guard for the cap)', () => {
        const cap = judge('chat', '[data-part="chat-header"]{backdrop-filter:blur(40px)}').warnings.map((w) => w.why).join()
        expect(cap).toMatch(/at most 24px/)
        expect(cap).not.toMatch(/not allowed on/)
    })
    it('G4 no app stylesheet defines a @keyframes pack-* block', async () => {
        const { readdirSync, readFileSync, statSync } = await import('node:fs')
        const { join } = await import('node:path')
        const hits: string[] = []
        const walk = (dir: string): void => {
            for (const name of readdirSync(dir)) {
                const full = join(dir, name)
                if (statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full); continue }
                if (!/\.(css|svelte)$/.test(name)) continue
                if (/@keyframes\s+pack-/i.test(readFileSync(full, 'utf8'))) hits.push(full)
            }
        }
        walk(join(process.cwd(), 'src'))
        expect(hits).toEqual([])
    })
})

// Redundant layers: N09, N10, N11b, N37 and N50 are each refused by two overlapping checks, so removing one check alone leaves the row refused.
// N09 and N10 overlap the frame-property check with the frame value grammars, N11b the depth guard in extractKeyframes with the canonical nesting refusal,
// N37 and N50 the part-count and subject-part checks with the last-compound-names-a-part rule. They guard the verdict, not one check each.
describe('N: single-defect rows stay refused (GUARD: the verdict and the legacy errors hold; the warnings and the keyframes errors are new)', () => {
    const pad = (n: number, s: (i: number) => string): string => Array.from({ length: n }, (_, i) => s(i + 1)).join('')
    const two = (i: number): string => String(i).padStart(2, '0')
    const offsets = (n: number): string => Array.from({ length: n }, (_, i) => `${i * 5}%`).join(',')
    const MORE = pad(16, (i) => `@keyframes pack-chat-k${two(i)}{from{opacity:.6}to{opacity:1}}`)
    // [id, area, sheet, mode, warns, prop]: mode 'subset' = the errors outside the @keyframes selectors contain every error the area lint gives the
    // sheet without its keyframes blocks (the value rules add their own errors beside them); 'refused' = only the verdict (and the named prop) is checked.
    type Mode = 'subset' | 'refused'
    const rows: [string, JudgedArea, string, Mode, boolean, string?][] = [
        ['N01', 'chat', `${K}${SEND}{${ANIM}}`, 'subset', false],
        ['N02', 'chat', `${K}${A}{animation:pack-chat-zz 1.2s}`, 'subset', true],
        ['N03', 'chat', `${A}{animation:spin 1.2s}`, 'subset', true],
        ['N04', 'chat', `@keyframes pack-home-a{from{opacity:.6}to{opacity:1}}${A}{animation:pack-home-a 1s}`, 'subset', true],
        ['N05', 'chat', `@keyframes pack-chat-Glow{from{opacity:0}to{opacity:1}}${A}{animation:pack-chat-Glow 1s}`, 'refused', true],
        ['N06', 'chat', `${K}${MORE}${A}{animation:pack-chat-k16 1.2s}`, 'subset', true],
        ['N07', 'chat', `@keyframes pack-chat-w{${offsets(17)}{opacity:.6}}${A}{animation:pack-chat-w 3s}`, 'subset', true],
        ['N08', 'chat', `@keyframes pack-chat-p{from{${'opacity:.6;'.repeat(400)}}to{opacity:1}}${A}{animation:pack-chat-p 1.2s}`, 'subset', true],
        ['N09', 'chat', `@keyframes pack-chat-v{from{visibility:hidden}to{opacity:1}}${A}{animation:pack-chat-v 1.2s}`, 'subset', true],
        ['N10', 'chat', `@keyframes pack-chat-i{from{opacity:.6}to{opacity:1!important}}${A}{animation:pack-chat-i 1.2s}`, 'subset', true],
        ['N11', 'chat', `@media (min-width:0){${K}}${A}{animation:pack-chat-pulse 1.2s}`, 'refused', true],
        ['N12', 'chat', `${K}${A}{animation:pack-chat-pulse 1.2s 11}`, 'subset', true],
        ['N13', 'chat', `${K}${A}{animation:pack-chat-pulse 21s}`, 'subset', true],
        ['N14', 'chat', `${K}${A}{animation:pack-chat-pulse 1.2s 2.1s}`, 'subset', true],
        ['N15', 'chat', `${K}${A}{animation:pack-chat-pulse 300ms}`, 'subset', true],
        ['N16', 'chat', `@keyframes pack-chat-s{${offsets(16)}{opacity:.6}}${A}{animation:pack-chat-s 2s}`, 'subset', true],
        ['N17', 'chat', `${K}${A}{animation:pack-chat-pulse 1.2s steps(4)}`, 'subset', true],
        ['N18', 'chat', `@keyframes pack-chat-t{from{opacity:.6;animation-timing-function:steps(4)}to{opacity:1}}${A}{animation:pack-chat-t 1.2s}`, 'subset', true],
        ['N19', 'chat', `${K}${A}{${ANIM};animation-duration:1s}`, 'refused', false, 'animation-duration'],
        ['N20', 'chat', `${A}{transition:opacity 200ms;transition-duration:200ms}`, 'refused', false, 'transition-duration'],
        ['N21', 'chat', `${A}{transition:opacity var(--pack-d)}`, 'subset', true],
        ['N23', 'chat', `${A}{filter:blur(9px)}`, 'subset', true],
        ['N24', 'chat', `${A}{filter:blur(5px) blur(4px)}`, 'subset', true],
        ['N25', 'chat', `${HEADER}{backdrop-filter:blur(25px)}`, 'subset', true],
        ['N26', 'chat', `${A}{filter:drop-shadow(65px 0 0 #000000)}`, 'subset', true],
        ['N27', 'chat', `${A}{transform:scale(1.6)}`, 'subset', true],
        ['N28', 'chat', `${A}{transform:translateX(65px)}`, 'subset', true],
        ['N29', 'chat', `${A}{transform:translateX(40px) translateX(40px)}`, 'subset', true],
        ['N30', 'chat', `${A}{transform:translateZ(1px)}`, 'subset', true],
        ['N31', 'chat', `${A}{transform:rotate(361deg)}`, 'subset', true],
        ['N32', 'chat', `${A}{transform:translateX(1px) translateY(1px) translate(1px) scale(1) scaleX(1) scaleY(1) rotate(1deg)}`, 'subset', true],
        ['N33', 'chat', `${SEND}{transition:opacity 1s}`, 'subset', false],
        ['N34', 'chat', `${A}{transition:all 1s}`, 'subset', true],
        ['N35', 'chat', `${A}{transition:opacity 1001ms}`, 'subset', true],
        ['N36', 'chat', `${SHEET}{backdrop-filter:blur(12px)}`, 'subset', true],
        ['N37', 'chat', `${HEADER} [data-kind="x"]{backdrop-filter:blur(4px)}`, 'subset', false],
        ['N38', 'chat', `${SEND}{transform:translateX(4px) rotate(5deg)}`, 'subset', false],
        ['N39', 'chat', `${A}, ${SHEET}{transform:translateX(4px)}`, 'subset', false],
        ['N40', 'chat', `${HEADER}, ${SHEET}{backdrop-filter:blur(4px)}`, 'subset', true],
        ['N41', 'chat', `[data-own-scheme] ${A}{transform:translateX(4px)}`, 'subset', false],
        ['N42', 'chat', `[data-part-critical] ${A}{transform:translateX(4px)}`, 'subset', false],
        ['N43', 'home', '[data-kind="x"] [data-part="home-brand"]{transition:opacity 200ms}', 'subset', false],
        ['N44a', 'chat', '[data-part="home-brand"]{transition:color 200ms}', 'subset', false],
        ['N44b', 'chat', '[data-part="home-brand"]::before{transform:translateX(4px)}', 'subset', false],
        ['N45', 'chat', `${A}{animation:none}`, 'subset', true],
        ['N46', 'chat', `${A}{transition:initial}`, 'subset', true],
        ['N48', 'chat', `${A}{filter:none}`, 'subset', true],
        ['N49', 'chat', `${A}{transform:unset}`, 'subset', true],
        ['N50', 'chat', '[data-role="user"] [data-kind="x"]{transform:translateX(4px)}', 'subset', false],
        ['N51', 'chat', `${A}{transition:width 200ms}`, 'subset', true],
        ['N52', 'chat', `${SEND}{filter:blur(4px)}`, 'subset', false],
        ['N53', 'chat', `${A}{translate:65px 0}`, 'subset', true],
        ['N54', 'chat', `${A}{transform-origin:65px 0}`, 'subset', true],
        ['N55', 'chat', `${A}{transition:opacity 200ms 501ms}`, 'subset', true],
        ['N56', 'chat', `${A}{transition:opacity 1ms,color 1ms,transform 1ms,filter 1ms,box-shadow 1ms}`, 'subset', true],
        ['N57', 'chat', `${K}${A}{animation:${Array(4).fill('pack-chat-pulse 1.2s').join(',')}}`, 'subset', true],
        ['N58', 'chat', `${A}{transition:opacity 200ms cubic-bezier(0,0,1,2.1)}`, 'subset', true],
        ['N59', 'chat', `${A}{transition:opacity 200ms steps(31)}`, 'subset', true],
        ['N60', 'chat', `${A}{filter:${Array(5).fill('blur(1px)').join(' ')}}`, 'subset', true],
        ['N61', 'chat', `${A}{filter:brightness(1.6)}`, 'subset', true],
        ['N62', 'chat', `${HEADER}{backdrop-filter:${Array(4).fill('blur(1px)').join(' ')}}`, 'subset', true],
        ['N63', 'chat', `${K}${K}${A}{${ANIM}}`, 'refused', false],
        ['N64', 'chat', `@keyframes pack-chat-f{from{opacity:.6}to{opacity:1;transform:scale(1.6)}}${A}{animation:pack-chat-f 1.2s}`, 'subset', true],
    ]
    // The rows whose defect sits in a keyframes block: the extraction names it in an error on the block's own selector.
    const BLOCK_ROWS = new Set(['N04', 'N06', 'N07', 'N08', 'N09', 'N10', 'N18', 'N63', 'N64'])
    it.each(rows)('%s', (id, area, css, mode, warns, prop) => {
        const judged = judge(area, css)
        expect(judged.result.ok, css).toBe(false)
        if (BLOCK_ROWS.has(id)) expect(judged.result.errors.some((e) => e.selector.startsWith('@keyframes')), `${id}: ${JSON.stringify(judged.result.errors.map((e) => e.selector))}`).toBe(true)
        if (prop) expect(judged.result.errors.some((e) => e.prop === prop), `${prop}: ${JSON.stringify(judged.result.errors.map((e) => e.prop))}`).toBe(true)
        const own = judged.result.errors.filter((e) => !e.selector.startsWith('@keyframes'))
        const legacy = legacyErrors(area, css)
        if (mode === 'subset') for (const e of legacy) expect(own).toContainEqual(e)
        expect(effectWarnings(area, css).length > 0, `warning: ${css}`).toBe(warns)
    })
    it('an empty keyframes block counts no offsets, so its duration floor is 0 and a 1ms infinite animation of it is accepted (compatibility guard; the same app animationend handler class as D2)', () => {
        expectOk('chat', `@keyframes pack-chat-a{}${A}{animation:pack-chat-a 1ms infinite}`)
    })
    it('N47 compatibility guard: z-index and position fixed or sticky stay refused (OQ-1, MC-3422)', () => {
        for (const decl of ['z-index:1', 'position:fixed', 'position:sticky']) expectRefused('chat', `${A}{${decl}}`)
    })
    it('N05a the keyframes name is a case-significant span (I2)', () => {
        expect(structurePass('@keyframes pack-chat-Glow{from{opacity:0}to{opacity:1}}').length).toBeGreaterThan(0)
    })
    it('N05b an animation item name is a case-significant span (I2)', () => {
        expect(structurePass(`${A}{animation:pack-chat-Glow 1s}`).length).toBeGreaterThan(0)
        expect(structurePass(`${A}{animation:pack-chat-glow 1s INFINITE}`)).toEqual([])
    })
    it('N11a canonical refuses a keyframes block nested in @media', () => {
        const errors = canonicalStylesheet(preprocessCss('@media (min-width:0){@keyframes pack-chat-a{from{opacity:0}to{opacity:1}}}')).errors
        expect(errors.some((e) => /at-rule inside a rule/.test(e.why))).toBe(true)
    })
})

describe('scope axis B stays in force on a claimed rule (GUARD)', () => {
    // Compatibility guards: refused before and after. Each subject's last compound names no part, so only the effects pass's own shape rule keeps the rule from being claimed.
    it('a subject whose last compound names no part is refused for a reach-tier paint transition, and under a safe-context ancestor', () => {
        expectRefused('chat', `${A} [data-kind="x"]{transition:color 1s}`)
        expectRefused('chat', `[data-role="user"] ${A} [data-kind="x"]{transform:translateX(4px)}`)
        expectRefused('chat', '[data-role="user"] [data-part="chat-message-avatar"] [data-kind="x"]{filter:opacity(0)}')
    })
    // A rule whose every declaration is claimed is never read by Rule SCOPE, so the effects pass itself keeps scope's selector shape.
    it('a sibling combinator, a foreign ancestor part and a part-less subject are not claimed, and the plain colour rule is refused the same way', () => {
        for (const selector of [`${B} ~ ${A}`, `${B} + ${A}`, `[data-part="home-brand"] ${A}`, `${A} [data-kind="x"]`, `${A} [data-part]`]) {
            expectRefused('chat', `${selector}{transform:translateX(4px)}`)
            expectRefused('chat', `${selector}{color:#ffffff}`)
        }
    })
})

describe('new modules: unit rows (GUARD, new exports)', () => {
    it('N05c a keyframes name with an upper-case letter is refused by extraction', async () => {
        const { extractKeyframes } = await lazy<typeof import('./effects')>('./effects')
        const found = extractKeyframes('@keyframes pack-chat-Glow{from{opacity:0}to{opacity:1}}', 'chat')
        expect(found.errors.length).toBeGreaterThan(0)
        expect(found.names).toEqual({})
        expect(found.remainder).toBe('')
    })
    it('N05d an animation name compares as written', async () => {
        const { effectsPass } = await lazy<typeof import('./effects')>('./effects')
        const text = `${A}{animation:pack-chat-Glow 1s}`
        expect(effectsPass('chat', text, { 'pack-chat-glow': 2 }).remainder).toBe(text)
        expect(effectsPass('chat', `${A}{animation:pack-chat-glow 1s}`, { 'pack-chat-glow': 2 }).remainder).not.toContain('animation')
    })
    it('a name that is an Object property is not a defined keyframes name', async () => {
        const { effectsPass } = await lazy<typeof import('./effects')>('./effects')
        const text = `${A}{animation:constructor 1s}`
        expect(effectsPass('chat', text, {}).remainder).toBe(text)
    })
    it('N11b extraction does not descend into @media', async () => {
        const { extractKeyframes } = await lazy<typeof import('./effects')>('./effects')
        const canonical = canonicalStylesheet(preprocessCss('@media (min-width:0){@keyframes pack-chat-a{from{opacity:0}to{opacity:1}}}')).text
        const found = extractKeyframes(canonical, 'chat')
        expect(found.names).toEqual({})
        expect(found.remainder).toBe(canonical)
    })
    it('N22 the filter grammar has no url()', async () => {
        const { effectsPass } = await lazy<typeof import('./effects')>('./effects')
        const text = `${A}{filter:url(#f)}`
        expect(effectsPass('chat', text, {}).remainder).toBe(text)
    })
    it('a claimed declaration is blanked to spaces and the terminator stays', async () => {
        const { effectsPass } = await lazy<typeof import('./effects')>('./effects')
        const text = `${A}{transition:opacity 1s;color:#ffffff}`
        const out = effectsPass('chat', text, {}).remainder
        expect(out.length).toBe(text.length)
        expect(out).toBe(text.replace('transition:opacity 1s', ' '.repeat('transition:opacity 1s'.length)))
    })
    it('E7 the effects registry is the registry AREA_LINT judges the area with', async () => {
        const { effectsRegistry } = await lazy<typeof import('./effects')>('./effects')
        const { subjectJudge, lintSelector } = await import('./engine')
        const census: Record<JudgedArea, readonly string[]> = {
            chat: [...CHAT_PARTS, ...SAFE_LEAVES],
            studio: [...STUDIO_SAFE, ...STUDIO_REACH, ...STUDIO_CRITICAL],
            settings: [...SETTINGS_PARTS, ...SAFE5B, ...CRITICAL5B],
            home: [...HOME_PARTS, ...HOME_SAFE, ...HOME_REACH, ...HOME_CRITICAL],
            popups: [...POPUPS_PARTS, ...POPUPS_SAFE, ...POPUPS_REACH, ...POPUPS_CRITICAL],
        }
        for (const area of AREAS) {
            const subject = subjectJudge(effectsRegistry(area))
            const mismatches: string[] = []
            for (const part of new Set(census[area])) {
                const selector = `[data-part="${part}"]`
                const facts = subject(selector)
                expect(facts.why, selector).toEqual(lintSelector(selector, effectsRegistry(area)))
                const cleanSafe = facts.why.length === 0 && facts.tier === 'safe'
                const accepted = judgeAreaSheet(area, `${selector}{opacity:.5}`).result.ok
                if (cleanSafe !== accepted) mismatches.push(`${area}: ${part}`)
            }
            expect(mismatches, area).toEqual([])
        }
    })
})

// @vitest-environment node
// The notes channel (MC-3419, MC-3421, MC-3423, MC-3880): a contrast, readability, floor or ceiling finding no longer refuses a sheet. It is reported as a tagged note
// (`rule`) in `result.notes`, while every security, resource, structure, fail-closed and overlay finding stays a refusal.
// Kinds: the N rows are regression reproducers (refused on the base, accepted with a note after). The K rows are compatibility guards: each is refused before and after with the
// named reason, and each kills a mutant that tags a kept refusal as a note (K15 only pins that valueRules keeps refusing em and calc, it kills no engine mutant). K13 and K14 are
// designed for the studio and cascade fail-closed sites and were not measured on the base.
import { describe, expect, it } from 'vitest'
import { judgeAreaSheet, type ThemeArea } from './index'
import { normalise, type LintError } from './engine'
import { geometryPass } from './geometry'

interface Verdict {
    ok: boolean
    errors: LintError[]
    notes: LintError[]
}
const everyVerdict: Verdict[] = []
const judge = (area: ThemeArea, css: string): Verdict => {
    const r = judgeAreaSheet(area, css).result
    const v: Verdict = { ok: r.ok, errors: r.errors, notes: r.notes ?? [] }
    everyVerdict.push(v)
    return v
}
const reason = (re: RegExp, rule?: LintError['rule']): unknown => expect.objectContaining({ why: expect.stringMatching(re), ...(rule ? { rule } : {}) })
/** The sheet is accepted and one of its notes has this reason and kind. */
const accepted = (v: Verdict, re: RegExp, rule: NonNullable<LintError['rule']>): void => {
    expect(v.errors.map((e) => e.why)).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.notes).toEqual(expect.arrayContaining([reason(re, rule)]))
}
/** The sheet is refused with this reason, and no note carries it. */
const refused = (v: Verdict, re: RegExp): void => {
    expect(v.ok).toBe(false)
    expect(v.errors).toEqual(expect.arrayContaining([reason(re)]))
    expect(v.notes.filter((n) => re.test(n.why))).toEqual([])
}

const H = '[data-part="chat-header"]'
const M = '[data-part="chat-message-name"]'
const SEND = '[data-part="chat-send"]'

describe('contrast and readability findings are notes', () => {
    it('N-C1 token contrast', () => {
        const v = judge('chat', ':root{--nexus-text:#333333}')
        expect(v.ok).toBe(true)
        expect(v.notes.length).toBeGreaterThan(0)
        expect(v.notes.every((n) => n.rule === 'contrast')).toBe(true)
    })
    it('N-C2 reach text contrast, plain', () => {
        const v = judge('chat', `${H}{color:#111111}`)
        accepted(v, /1\.01:1/, 'contrast')
        expect(v.notes.filter((n) => /1\.01:1/.test(n.why))).toHaveLength(2)
        // the engine's own finding (a text colour on the sheet or the bubble) is a contrast note, not only the cascade's
        const engine = v.notes.filter((n) => /a text colour that is 1\.01:1/.test(n.why))
        expect(engine.length).toBeGreaterThan(0)
        expect(engine.every((n) => n.rule === 'contrast')).toBe(true)
    })
    it('N-R1 translucent text', () => accepted(judge('chat', `${H}{color:rgba(255,255,255,0.5) !important}`), /translucent/, 'readability'))
    it('N-R2 focus loss is a note and the 64 px ban still refuses', () => {
        const v = judge('chat', `${SEND}:focus-visible{box-shadow:0 0 0 100px transparent}`)
        expect(v.ok).toBe(false)
        expect(v.errors.map((e) => e.why)).toEqual([expect.stringMatching(/larger than 64 px/)])
        expect(v.notes).toEqual(expect.arrayContaining([reason(/indication of focus/, 'readability')]))
    })
    it('N-R3 a fully transparent token no longer hides the opaque-surface finding', () => {
        const v = judge('chat', ':root{--color-surface-sheet:transparent}')
        expect(v.errors).toEqual([])
        expect(v.ok).toBe(true)
        expect(v.notes.filter((n) => n.rule === 'readability')).toHaveLength(2)
    })
    it('N-R4 a translucent protected surface', () => accepted(judge('chat', ':root{--color-surface-sheet:rgba(20,20,20,0.5)}'), /opaque/, 'readability'))
    it('N-R5 no focus ring', () => accepted(judge('chat', ':root{--focus-ring-w:0px}'), /no focus ring/, 'readability'))
    it('N-R6 a symbol font', () => accepted(judge('chat', '[data-part="chat-message-text"]{font-family:"wingdings", serif}'), /symbol font/, 'readability'))
    it('N-R7 an opacity floor is readability', () => accepted(judge('chat', ':root{--opacity-dim:0.2}'), /below the critical minimum/, 'readability'))
    it('N-G1 a note never lets a sheet skip the later passes', () => {
        const v = judge('chat', `${H}{color:#111111 !important}[data-kind="icon-button"]{color:#ffffff !important}`)
        expect(v.ok).toBe(false)
        expect(v.errors).toEqual(expect.arrayContaining([reason(/MC-1586/)]))
        expect(v.errors.every((e) => e.rule === undefined)).toBe(true)
    })
    it('N-V1 notes merge across private-variable variants', () => {
        accepted(judge('chat', `:root{--pack-ink:#111111}${H}{color:var(--pack-ink) !important}`), /1\.01:1/, 'contrast')
        // a token finding has no cascade twin, so only the engine's variant merge can carry it
        accepted(judge('chat', ':root{--pack-t:#333333;--nexus-text:var(--pack-t)}'), /critical text would be/, 'contrast')
    })
    it('N-H1 home on-accent contrast', () => accepted(judge('home', ':root{--home-on-accent:#777777}'), /primary button label would be/, 'contrast'))
    it('N-S1 studio channel and danger findings', () => accepted(judge('studio', ':root{--nexus-text:#ee3333;--nexus-danger-rgb:238 51 51}'), /danger colour is the text colour/, 'contrast'))
    it('N-CB a currentcolor background', () => accepted(judge('chat', `${SEND}{background:currentcolor !important}`), /currentcolor/, 'contrast'))
})

describe('floors and ceilings are layout notes', () => {
    it('N-L1 small font', () => accepted(judge('chat', `${H}{font-size:9px}`), /9px/, 'layout'))
    it('N-L2 font token floor', () => accepted(judge('chat', ':root{--font-size-sm:9px}'), /smaller than 11 px/, 'layout'))
    it('N-L3 touch floor', () => accepted(judge('chat', ':root{--size-touch:16px}'), /smaller than 24 px/, 'layout'))
    it('N-L4 width collapse', () => accepted(judge('chat', `${H}{width:100px}`), /collapse/, 'layout'))
    it('N-L5 chain sum', () => accepted(judge('chat', '[data-part="chat-shell"]{padding:60px}[data-part="chat-transcript"]{padding:60px}[data-part="chat-message"]{padding:60px}'), /ancestor padding along the transcript chain/, 'layout'))
    it('N-L6 cursor none', () => accepted(judge('chat', `${H}{cursor:none}`), /cursor: none/, 'layout'))
    it('N-L7 a fixed width note does not hide the allowlist refusal', () => {
        const v = judge('chat', '[data-part="chat-sheet"]{min-width:200px}')
        expect(v.ok).toBe(false)
        expect(v.errors).toEqual(expect.arrayContaining([reason(/declaration allowlist/)]))
        expect(v.notes).toEqual(expect.arrayContaining([reason(/on the root of a protected sheet/, 'layout')]))
    })
    it('N-L8 the live failed-card chain carries its tag', () => accepted(judge('chat', '[data-part="chat-composer-host"]{padding:64px}'), /ancestor padding along the failed-card chain/, 'layout'))
    it('N-X1 letter spacing ceiling', () => accepted(judge('chat', `${H}{letter-spacing:4px}`), /letter spacing beyond 2 px/, 'layout'))
    it('N-X2 font ceiling', () => accepted(judge('chat', `${H}{font-size:48px}`), /48px/, 'layout'))
    it('N-X3 token ceiling', () => accepted(judge('chat', ':root{--header-height:120px}'), /above the critical maximum/, 'layout'))
    it('N-X4 safe padding ceiling', () => accepted(judge('chat', `${M}{padding:80px}`), /larger than 64 px/, 'layout'))
    it('N-X5 safe size ceiling', () => accepted(judge('chat', `${M}{width:600px}`), /is a size beyond 480 px/, 'layout'))
    it('N-X6 safe large size', () => accepted(judge('chat', `${M}{height:100%}`), /is a large size/, 'layout'))
    it('N-X7 safe margin ceiling', () => accepted(judge('chat', `${M}{margin-left:60px}`), /beyond 48 px/, 'layout'))
    it('N-X8 reach border ceiling', () => accepted(judge('chat', `${SEND}{border-width:20px}`), /a border wider than 16 px/, 'layout'))
    // No shipped registry gives a sheet without a cap, so the whole-height rule and the no-scroll room rule are driven through geometryPass with a small registry.
    it('N-X9 sheet height', () => {
        const found = geometryPass(normalise(':root{}'), { sheets: [{ name: 'test sheet', terms: [{ px: 700 }] }] })
        expect([...found]).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'layout', why: expect.stringMatching(/does not fit a/) })]))
    })
    it('N-X10 no-scroll room', () => {
        const found = geometryPass(normalise(':root{}'), { sheets: [{ name: 'test sheet', terms: [{ px: 10 }], fixed: [{ px: 300 }], cap: 384 }] })
        expect([...found]).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'layout', why: expect.stringMatching(/leaves no room for the scrolling actions/) })]))
    })
    it('N-X11 decoration thickness over', () => accepted(judge('chat', `${SEND}{background:#ffff00 !important;color:#111111 !important;text-decoration:line-through;text-decoration-color:#ffff00;text-decoration-thickness:20px}`), /thick/, 'layout'))
    it('N-X12 stack cap', () => accepted(judge('chat', `${SEND}{background:#ffff00 !important;color:#111111 !important;box-shadow:${Array.from({ length: 40 }, (_v, i) => `inset 0 0 0 1px rgb(255 255 ${i + 1} / 0.05)`).join(',')}}`), /too many colours to judge/, 'contrast'))
})

describe('MC-2370 is removed', () => {
    it('N-P1 a plain paint on a reach part is silent', () => {
        const v = judge('chat', `${SEND}{background:#fee500;color:#191919}`)
        expect(v.errors).toEqual([])
        expect(v.ok).toBe(true)
        expect(v.notes).toEqual([])
    })
    it('N-P2 a plain paint on a studio reach part is silent', () => {
        const v = judge('studio', '[data-part="studio-tree-row"]{background:#fee500;color:#191919}')
        expect(v.errors).toEqual([])
        expect(v.ok).toBe(true)
        expect(v.notes).toEqual([])
    })
})

describe('kept refusals stay refusals', () => {
    it('K1 an unresolvable colour token', () => refused(judge('chat', ':root{--nexus-text:oklch(50% 0.1 30)}'), /cannot be resolved to a concrete sRGB colour/))
    it('K2 a colour that cannot be checked', () => refused(judge('chat', `${H}{color:var(--nope) !important}`), /a colour that cannot be checked/))
    it('K3 a 64 px shadow', () => refused(judge('chat', `${SEND}{box-shadow:0 0 0 100px #ffffff}`), /larger than 64 px can cover a protected surface/))
    it('K4 negative spacing', () => refused(judge('chat', `${H}{margin-left:-8px}`), /negative margin-left/))
    it('K5 an image', () => refused(judge('chat', `${H}{background-image:url(images/a.png)}`), /an image/))
    it('K6 z-index', () => refused(judge('chat', `${H}{z-index:5}`), /z-index can cover/))
    it('K7 a locked home token', () => refused(judge('home', ':root{--home-dialog-bg:#000000}'), /is locked/))
    it('K8 place-over', () => refused(judge('chat', `${M}{position:absolute}`), /can place a safe part over a protected one/))
    it('K9 the outline ban', () => refused(judge('chat', `${H}{outline:none}`), /may not change outlines or focus rings/))
    it('K10 a settings token that cannot be bounded', () => refused(judge('settings', ':root{--settings-row-min-height:auto}'), /a value that cannot be bounded/))
    it('K11 a limit that cannot be ruled out', () => refused(judge('chat', ':root{--opacity-dim:var(--nope)}'), /cannot be ruled out/))
    it('K12 CanvasText', () => refused(judge('chat', `${SEND}{color:initial !important}`), /resolves to the system text colour/))
    it('K13 a studio colour that cannot be checked', () => refused(judge('studio', ':root{--nexus-danger:var(--nope)}'), /a colour that cannot be checked/))
    it('K14 an unreadable inset layer', () => refused(judge('chat', `${SEND}{box-shadow:inset 0 0 0 1px notacolour}`), /cannot be read, so it cannot be judged/))
    it('K15 em and calc stay refused by the value rules', () => refused(judge('chat', `${M}{width:calc(10px + 1em)}`), /calc\(\) is not allowed/))
    it('K16 a percentage safe size stays refused', () => refused(judge('chat', `${M}{height:50%}`), /size beyond 480 px \(or one that cannot be bounded\)/))
    it('K17 the settings index columns', () => refused(judge('settings', ':root{--index-column:1;--page-column:1}'), /must take columns 1 and 2/))
    it('K18 a settings column that cannot be bounded', () => refused(judge('settings', ':root{--body-columns:240px auto}'), /a column that cannot be bounded/))
    it('K19 a background of inherit', () => refused(judge('chat', `${SEND}{color:#ffffff !important;background:inherit !important}`), /a background of inherit/))
    it('K20 a decoration thickness from the font file', () => refused(judge('chat', `${SEND}{color:#ffffff !important;background:#000000 !important;text-decoration:underline;text-decoration-thickness:from-font}`), /from the font file/))
    it('K21 a unitless decoration thickness', () => refused(judge('chat', `${SEND}{color:#ffffff !important;background:#000000 !important;text-decoration:underline;text-decoration-thickness:5}`), /cannot be measured/))
})

describe('the shape of a verdict', () => {
    it('N-I1 ok follows the errors, errors carry no tag, notes are present only when tagged and non-empty', () => {
        expect(everyVerdict.length).toBeGreaterThan(40)
        for (const v of everyVerdict) {
            expect(v.ok).toBe(v.errors.length === 0)
            for (const e of v.errors) expect(e.rule).toBeUndefined()
            for (const n of v.notes) expect(['contrast', 'readability', 'layout']).toContain(n.rule)
        }
        const raw = judgeAreaSheet('chat', `${H}{font-size:16px}`).result
        expect('notes' in raw).toBe(false)
    })
})

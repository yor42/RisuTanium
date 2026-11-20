// @vitest-environment node
// Install-time warnings that never refuse a sheet: they ride AreaSheetJudgement.warnings, so every fixture here is
// accepted (or refused for an unrelated reason) and the warning is asserted next to the unchanged lint verdict.
import { describe, expect, test } from 'vitest'
import { judgeAreaSheet, judgePackSheets, lintAreaPack } from './index'
import { readJudgement } from './judgeClient'
import { valueRulesPass, type ValueEnv } from './valueRules'

const ENV: ValueEnv = { ownFamilies: new Set<string>(), app: new Map<string, string[]>() }

const AV = '[data-part="chat-message-avatar"]'

describe('W309: a --pack-* helper declared on bare html', () => {
    const W309 = 'a --pack-* helper set on bare html never applies, because its :root value outranks html; set the value on :root, or on html[data-input] or html[data-layout] for one input or layout (MC-2586)'
    const A1 = `:root{--pack-gap:4px}html{--pack-gap:8px}${AV}{margin:var(--pack-gap)}`
    const A2 = `:root{--pack-gap:4px}html[data-layout="phone"], html{--pack-gap:8px}${AV}{margin:var(--pack-gap)}`
    const A3 = `:root{--pack-gap:4px}html[data-layout="phone"]{--pack-gap:8px}${AV}{margin:var(--pack-gap)}`
    const A5 = `@media (min-width:600px){html{--pack-gap:8px}}:root{--pack-gap:4px}${AV}{margin:var(--pack-gap)}`
    const A6 = 'html{--pack-gap:8px}'
    const A7 = `:root{--pack-gap:4px}html{--pack-gap:8px}${AV}{margin:var(--pack-gap);font-family:wingdings}`
    const A8 = 'html{--nexus-text:#ffffff}'
    const A9 = ':root{--pack-gap:4px}html{--pack-gap:8px}[data-part="studio-main"]{padding:var(--pack-gap)}'
    const D1 = `:root{--pack-gap:4px}:root, html{--pack-gap:6px}${AV}{margin:var(--pack-gap)}`
    const only = (selector: string) => [{ selector, prop: '--pack-gap', why: W309 }]

    test('T309-1: value pass warns on html against a plain :root value, not on an attribute form', () => {
        expect(valueRulesPass(':root{--pack-gap:4px}html{--pack-gap:8px}', ENV).warnings).toEqual(only('html'))
        expect(valueRulesPass(':root{--pack-gap:4px}html[data-layout="phone"]{--pack-gap:8px}', ENV).warnings).toEqual([])
    })

    test('T309-2: every comma entry is read and an at-rule wrapper does not hide the loss', () => {
        expect(valueRulesPass(A2, ENV).warnings).toEqual(only('html[data-layout="phone"], html'))
        expect(valueRulesPass(A5, ENV).warnings).toEqual(only('html'))
    })

    test('T309-3: accepted sheet carries the warning; attribute, no plain :root, :root entry and app tokens do not', () => {
        const j = judgeAreaSheet('chat', A1)
        expect(j.result.ok).toBe(true)
        expect(j.result.errors).toEqual([])
        expect(j.warnings).toEqual(only('html'))
        expect(j.result).toEqual(lintAreaPack('chat', A1))
        expect(judgeAreaSheet('chat', A3).warnings).toEqual([])
        const alone = judgeAreaSheet('chat', A6)
        expect(alone.result.ok).toBe(true)
        expect(alone.warnings).toEqual([])
        const root = judgeAreaSheet('chat', D1)
        expect(root.result.ok).toBe(true)
        expect(root.warnings).toEqual([])
        const app = judgeAreaSheet('chat', A8)
        expect(app.result.ok).toBe(false)
        expect(app.warnings.map((w) => w.why)).not.toContain(W309)
    })

    test('T309-4: a refused sheet still carries the value warning, and Studio warns too', () => {
        const refused = judgeAreaSheet('chat', A7)
        expect(refused.result.ok).toBe(false)
        expect(refused.warnings).toContainEqual({ selector: 'html', prop: '--pack-gap', why: W309 })
        expect(judgeAreaSheet('studio', A9).warnings).toEqual(only('html'))
        expect(judgePackSheets({ chat: A1 }).areas.chat?.warnings).toEqual(only('html'))
    })
})

describe('W322: percentage widths that multiply along a chat chain', () => {
    const W322 = (px: number, list: string): string => `percentage widths on nested chat parts multiply to ${px} px of a 360 px phone (${list}), under the 240 px the message text needs; use fewer or larger percentages (MC-2587)`
    const BODY = '[data-part="chat-message-body"]'
    const TEXT = '[data-part="chat-message-text"]'
    const MSG = '[data-part="chat-message"]'
    const TRANSCRIPT = '[data-part="chat-transcript"]'
    const one = (selector: string, px: number, list: string) => [{ selector, prop: 'width', why: W322(px, list) }]
    const B1 = `${BODY}{max-width:50%}`
    const B2 = `${MSG}{max-width:80%}${BODY}{max-width:80%}`
    const B3 = `${BODY}{max-width:66.5%}`
    const B4 = `${BODY}{max-width:66.8%}`
    const B5 = `${BODY}{max-width:66.66666666666667%}`
    const B6 = `${AV}, ${BODY}{max-width:50%}`
    const B7 = `${MSG}[data-role="user"]{max-width:60%}${MSG}{max-width:90%}`
    const B8 = `@media (min-width:1px){${TEXT}{width:50%}}`
    const B9 = `:root{--pack-w:100%}html[data-layout="phone"]{--pack-w:50%}${TRANSCRIPT}{max-width:var(--pack-w)}`
    const B10 = `${BODY}{max-width:50%;font-family:wingdings}`
    const B11 = `${MSG}{max-width:90%}${BODY}{max-width:90%}`
    const B13 = `[data-role="user"] ${BODY}{max-inline-size:40%}`
    const B14 = `${TRANSCRIPT}{width:150%}${BODY}{max-width:60%}`
    const B15 = `${MSG}[data-role="user"]{max-width:10%}`
    const B16 = `${BODY}{max-width:50% !important}`

    test('T322-1: one percentage under the floor warns once, on an accepted sheet', () => {
        const j = judgeAreaSheet('chat', B1)
        expect(j.result.ok).toBe(true)
        expect(j.warnings).toEqual(one(BODY, 180, 'chat-message-body 50%'))
        expect(j.result).toEqual(lintAreaPack('chat', B1))
    })

    test('T322-2: percentages multiply along the chain, they are not compared one by one', () => {
        expect(judgeAreaSheet('chat', B2).warnings).toEqual(one(`${MSG} ${BODY}`, 230, 'chat-message 80%, chat-message-body 80%'))
        expect(judgeAreaSheet('chat', B11).warnings).toEqual([])
    })

    test('T322-3: the threshold is a strict 240 px', () => {
        expect(judgeAreaSheet('chat', B3).warnings).toEqual(one(BODY, 239, 'chat-message-body 66.5%'))
        expect(judgeAreaSheet('chat', B4).warnings).toEqual([])
        const exact = judgeAreaSheet('chat', B5)
        expect(exact.result.ok).toBe(true)
        expect(exact.warnings).toEqual([])
    })

    test('T322-4: the smallest percentage of a part counts whatever its selector, state, media or importance', () => {
        expect(judgeAreaSheet('chat', B7).warnings).toEqual(one(MSG, 216, 'chat-message 60%'))
        expect(judgeAreaSheet('chat', B8).warnings).toEqual(one(TEXT, 180, 'chat-message-text 50%'))
        expect(judgeAreaSheet('chat', B9).warnings).toEqual(one(TRANSCRIPT, 180, 'chat-transcript 50%'))
        expect(judgeAreaSheet('chat', B15).warnings).toEqual(one(MSG, 36, 'chat-message 10%'))
        expect(judgeAreaSheet('chat', B13).warnings).toEqual(one(BODY, 144, 'chat-message-body 40%'))
        expect(judgeAreaSheet('chat', B14).warnings).toEqual(one(BODY, 216, 'chat-message-body 60%'))
        expect(judgeAreaSheet('chat', B16).warnings).toEqual(one(BODY, 180, 'chat-message-body 50%'))
    })

    test('T322-5: every comma entry is read, and a refused sheet carries no engine warning', () => {
        expect(judgeAreaSheet('chat', B6).warnings).toEqual(one(BODY, 180, 'chat-message-body 50%'))
        const refused = judgeAreaSheet('chat', B10)
        expect(refused.result.ok).toBe(false)
        expect(refused.warnings.map((w) => w.prop)).not.toContain('width')
    })
})

describe('engine-side warnings: wiring into the judgement', () => {
    const W309 = 'a --pack-* helper set on bare html never applies, because its :root value outranks html; set the value on :root, or on html[data-input] or html[data-layout] for one input or layout (MC-2586)'
    const W322 = 'percentage widths on nested chat parts multiply to 180 px of a 360 px phone (chat-message-body 50%), under the 240 px the message text needs; use fewer or larger percentages (MC-2587)'
    const W319 = `this rule's text colour passes only against its own gradient, but its background shorthand, background-size, -position or -repeat can leave part of the element bare, where the text sits on the app's own background below 3:1; make the gradient cover the element or add an opaque background colour to this rule (MC-2546)`
    const TX = '[data-part="chat-message-text"]'
    const G = 'linear-gradient(#000000, #000000)'
    const D4 = `:root{--nexus-surface:#ffffff;--pack-gap:4px}html{--pack-gap:8px}${AV}{margin:var(--pack-gap)}${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat}[data-part="chat-message-body"]{max-width:50%}`

    test('TW-1: value warnings come first, then the coverage warning, then the chain-width warning, and the verdict is unchanged', () => {
        const j = judgeAreaSheet('chat', D4)
        expect(j.result.ok).toBe(true)
        expect(j.result.errors).toEqual([])
        expect(j.warnings).toEqual([
            { selector: 'html', prop: '--pack-gap', why: W309 },
            { selector: TX, prop: 'background', why: W319 },
            { selector: '[data-part="chat-message-body"]', prop: 'width', why: W322 },
        ])
        expect(j.result).toEqual(lintAreaPack('chat', D4))
    })

    test('TW-2: the warning crosses the judge boundary as plain data', () => {
        const j = judgePackSheets({ chat: '[data-part="chat-message-body"]{max-width:50%}' })
        expect(j.areas.chat?.warnings).toHaveLength(1)
        expect(readJudgement(structuredClone(j))).toEqual(j)
    })
})

describe('W319: a rule whose text colour passes only against a gradient that can leave the element bare', () => {
    const W319 = `this rule's text colour passes only against its own gradient, but its background shorthand, background-size, -position or -repeat can leave part of the element bare, where the text sits on the app's own background below 3:1; make the gradient cover the element or add an opaque background colour to this rule (MC-2546)`
    const TX = '[data-part="chat-message-text"]'
    const G = 'linear-gradient(#000000, #000000)'
    const GL = ':root{--nexus-surface:#ffffff}'
    const one = (selector: string, prop = 'background') => [{ selector, prop, why: W319 }]
    const warningsOf = (area: 'chat' | 'studio', css: string) => {
        const j = judgeAreaSheet(area, css)
        expect(j.result.ok).toBe(true)
        expect(j.result).toEqual(lintAreaPack(area, css))
        return j.warnings
    }
    const C0 = `${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat}`
    const C1 = `${GL}${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat}`
    const C2 = `${GL}${TX}{color:#ffffff;background:${G}}`
    const C4 = `${GL}${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat #000000}`
    const C5 = `${GL}${TX}{color:#ffffff;background:${G};background-size:100% 2px;background-repeat:no-repeat}`
    const C7 = `${GL}${TX}{color:#ffffff;background:#000000}`
    const C8 = `${GL}${TX}{color:#ffffff}`
    const C9 = `${GL}${TX}{color:#ffffff;background:${G};background-size:cover;background-repeat:no-repeat}`
    const C10 = `${GL}${TX}{color:#ffffff;background:${G};background-size:24px 24px}`
    const C11 = `${GL}${TX}{color:#ffffff;background:${G};background-repeat:no-repeat;background-position:10px 0}`
    const C12 = `${GL}[data-part="chat-composer"]{color:#ffffff !important;background:${G} 0 0 / 24px 24px no-repeat !important}`
    const C13 = `${GL}${TX}{color:#ffffff;background:${G}}@media (min-width:1px){${TX}{background-size:24px 24px;background-repeat:no-repeat}}`
    const C14 = `${GL}${AV}, ${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat}`
    const C15 = `${GL}${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat;font-family:wingdings}`
    const C16 = `${GL}[data-part="studio-main"]{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat}`
    const C17 = `${GL}${TX}{color:#ffffff;background:${G} !important;background-size:24px 24px;background-repeat:no-repeat}`
    const C18 = `${GL}${TX}{color:#ffffff;background-size:24px 24px;background-repeat:no-repeat;background:${G}}`
    const C19 = `:root{--nexus-surface:#ffffff;--pack-bg:${G} 0 0 / 24px 24px no-repeat}${TX}{color:#ffffff;background:var(--pack-bg)}`
    const D2 = `${GL}${TX}{color:#ffffff;background:${G};background-size:100% 100%;background-repeat:no-repeat}`
    const D3 = `:root{--nexus-surface:#ffffff;--pack-size:24px 24px}html[data-layout="phone"]{--pack-size:12px 12px}${TX}{color:#ffffff;background:${G};background-size:var(--pack-size);background-repeat:no-repeat}`
    const D5 = `${GL}${TX}{color:#ffffff;background:${G};background-size:24px 24px;background-repeat:no-repeat;background-position:center}`
    const D6 = `${GL}${TX}{color:#ffffff;background:${G};background-size:100% 24px;background-repeat:repeat-x}`
    const D7 = `${GL}${TX}{color:#ffffff;background:${G};background-size:100% 24px;background-repeat:repeat-y}`
    const D8 = `${GL}${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat, ${G}}`
    const D9 = `${GL}${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat transparent}`
    const D10 = `${GL}${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat;background-color:#000000}`
    const D11 = `${GL}${AV}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat}`
    const D12 = `${GL}[data-role="user"] ${TX}{color:#ffffff;background:${G} 0 0 / 24px 24px no-repeat}`

    test('T319-1: a text colour that passes only against a 24 px no-repeat gradient warns, and the credit is what decides the verdict', () => {
        const j = judgeAreaSheet('chat', C1)
        expect(j.result.ok).toBe(true)
        expect(j.warnings).toEqual(one(TX))
        expect(j.result).toEqual(lintAreaPack('chat', C1))
        const bare = judgeAreaSheet('chat', C8)
        expect(bare.result.ok).toBe(false)
        expect(bare.result.errors.map((e) => e.why).join('\n')).toMatch(/1\.00:1 on a Settings surface/)
    })

    test('T319-2: size, repeat, position, a transparent colour layer, @media and a helper variable each leave the element bare', () => {
        expect(warningsOf('chat', C1)).toEqual(one(TX))
        expect(warningsOf('chat', C5)).toEqual(one(TX))
        expect(warningsOf('chat', C11)).toEqual(one(TX))
        expect(warningsOf('chat', D5)).toEqual(one(TX))
        expect(warningsOf('chat', D6)).toEqual(one(TX))
        expect(warningsOf('chat', D9)).toEqual(one(TX))
        expect(warningsOf('chat', C13)).toEqual(one(TX))
        expect(warningsOf('chat', C19)).toEqual(one(TX))
        expect(warningsOf('chat', D3)).toEqual(one(TX))
        expect(warningsOf('chat', C12)).toEqual(one('[data-part="chat-composer"]'))
    })

    test('T319-3: a covering gradient, an opaque colour, importance, shorthand reset and text that reads on the app do not warn', () => {
        expect(warningsOf('chat', C1)).toEqual(one(TX))
        for (const css of [C2, C9, D2, C10, D7, D8, C4, D10, C17, C18, C0, C7]) expect(warningsOf('chat', css)).toEqual([])
    })

    test('T319-4: every comma entry is read, and a safe part or a user message is not a reach part', () => {
        expect(warningsOf('chat', C1)).toEqual(one(TX))
        expect(warningsOf('chat', C14)).toEqual(one(TX))
        expect(warningsOf('chat', D11)).toEqual([])
        expect(warningsOf('chat', D12)).toEqual([])
    })

    test('T319-5: Studio warns, and a refused sheet carries no coverage warning', () => {
        expect(warningsOf('studio', C16)).toEqual(one('[data-part="studio-main"]'))
        const refused = judgeAreaSheet('chat', C15)
        expect(refused.result.ok).toBe(false)
        expect(refused.warnings.map((w) => w.why)).not.toContain(W319)
    })
})

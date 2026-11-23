// The popups area's judge, Rule SCOPE membership and no-token clause, and its registry (#438 S3c-B stage 1). These are
// acceptance tests: each one fails on the base by absence of the popups area (an assertion on the verdict). The registry row (P-1)
// is a guard over new symbols and fails on the base with a TypeError instead.
import { describe, expect, it } from 'vitest'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS } from './engine'
import { AREA_LINT, THEME_AREAS, judgeAreaSheet, lintAreaPack, type JudgedArea } from './index'
import { POPUPS_CRITICAL, POPUPS_PARTS, POPUPS_REACH, POPUPS_REGISTRY, POPUPS_SAFE, isPopupsPart } from './registries/popups'
import { scopePass } from './scope'
import { shapeTokenNames } from './shapeMode'

const verdict = (css: string): { ok: boolean; why: string[] } => {
    const judged = judgeAreaSheet('popups', css, undefined, 'popups')
    return { ok: judged.result.ok, why: judged.result.errors.map((e) => e.why) }
}
const refused = (css: string, reason: RegExp): void => {
    const { ok, why } = verdict(css)
    expect(ok, css).toBe(false)
    expect(why.some((w) => reason.test(w)), `${reason} against ${JSON.stringify(why)}`).toBe(true)
}
const accepted = (css: string): void => {
    const { ok, why } = verdict(css)
    expect(ok, `${css} -> ${JSON.stringify(why)}`).toBe(true)
}

describe('SC-1 membership: popups.css names popups parts only', () => {
    it.each([
        ['a chat part', '[data-part="chat-header"]{border-radius:4px}'],
        ['a studio part', '[data-part="studio-asset-row"]{border-radius:4px}'],
        ['a settings part', '[data-part="settings-section-title"]{border-radius:4px}'],
    ])('%s as the subject is refused by membership', (_name, css) => {
        expect(scopePass('popups', css, []).length).toBeGreaterThan(0)
        refused(css, /is not a part of the popups screen/)
    })

    it('a chat part as an ancestor of a popups part is refused by membership', () => {
        refused('[data-part="chat-shell"] [data-part="toast"]{border-radius:4px}', /is not a part of the popups screen.*in a selector that styles one of them/)
    })

    it('a popups part is admitted as subject and as ancestor', () => {
        accepted('[data-part="toast-host"] [data-part="toast-text"]{letter-spacing:1px}')
    })
})

describe('SC-2 popups.css sets no tokens (MC-3007)', () => {
    it.each([
        ['a --pack helper in a root entry', ':root{--pack-x:2px}'],
        ['a --pack helper in an html root entry', 'html{--pack-y:1px}'],
    ])('%s is refused with the no-token reason', (_name, css) => {
        refused(css, /popups\.css sets no tokens/)
    })

    it('a token, a --pack helper or a --pattern token anywhere else is refused too', () => {
        for (const css of [':root{--radius-popup:2px}', '[data-part="toast"]{--radius-popup:2px}', '[data-part="toast"]{--pack-x:2px}', '[data-part="toast-text"]{--pattern-ease:linear}']) {
            expect(verdict(css).ok, css).toBe(false)
        }
    })
})

describe('SC-3 reads in values (the app tokens popups may read)', () => {
    it('var() of a --pack helper is refused: popups declares none to resolve to', () => {
        expect(verdict('[data-part="toast"]{border-radius:var(--pack-x)}').ok).toBe(false)
    })

    it('var() of an app shape token is accepted', () => {
        accepted('[data-part="toast"]{border-radius:var(--radius-popup)}')
    })

    it('var() of a --pattern token is accepted, because pattern-tokens.css is an app token file of popups', () => {
        accepted('[data-part="toast-text"]{border-radius:var(--pattern-pill-radius)}')
    })
})

describe('J-1 the popups judge accepts what a popups sheet may do', () => {
    it('AREA_LINT carries a popups lint and judgeAreaSheet judges with it', () => {
        expect(typeof AREA_LINT.popups).toBe('function')
        expect(judgeAreaSheet('popups', '[data-part="toast-text"]{letter-spacing:1px}', undefined, 'popups').result.ok).toBe(true)
    })

    it('a shape rule on a safe part and a background on a toast are accepted', () => {
        accepted('[data-part="toast-text"]{border-radius:4px;padding:4px 8px}')
        accepted('[data-part="toast"]{background:#7a1f5c}')
    })
})

describe('J-2 critical, escape and marker names stay refused in popups', () => {
    it.each([
        'pattern-dialog', 'pattern-layer', 'pattern-scrim', 'toast-undo', 'pattern-warn-primary', 'toast-live-assertive', 'task-toast',
    ])('the critical part %s is refused as a protected part', (name) => {
        refused(`[data-part="${name}"]{opacity:1}`, /protected part|names the protected part/)
    })

    it('every chat critical and escape-route name is refused', () => {
        for (const name of CRITICAL_PARTS) {
            expect(verdict(`[data-part="${name}"]{opacity:1}`).ok, name).toBe(false)
        }
    })

    it('an escape ancestor is refused as a subject', () => {
        for (const name of ESCAPE_ANCESTORS) {
            expect(verdict(`[data-part="${name}"]{opacity:0}`).ok, name).toBe(false)
        }
    })

    it('the own-scheme and critical-marker attributes are refused', () => {
        expect(verdict('[data-own-scheme] [data-part="toast"]{opacity:1}').ok).toBe(false)
        expect(verdict('[data-part-critical]{opacity:1}').ok).toBe(false)
    })

    it('a reach part cannot be hidden', () => {
        expect(verdict('[data-part="toast-host"]{display:none}').ok).toBe(false)
    })
})

describe('P-1 the popups registry is the census', () => {
    it('lists the census constants and no tokens', () => {
        expect([...(POPUPS_REGISTRY.critical ?? [])]).toEqual(POPUPS_CRITICAL)
        expect([...(POPUPS_REGISTRY.safe ?? [])]).toEqual(POPUPS_SAFE)
        expect([...(POPUPS_REGISTRY.reach ?? [])]).toEqual(POPUPS_REACH)
        expect(POPUPS_REGISTRY.tokens).toBeUndefined()
        expect(POPUPS_REGISTRY.minimums).toBeUndefined()
        expect(POPUPS_REGISTRY.maximums).toBeUndefined()
    })

    it('isPopupsPart is exactly membership in POPUPS_PARTS', () => {
        for (const name of POPUPS_PARTS) expect(isPopupsPart(name), name).toBe(true)
        for (const name of ['chat-header', 'studio-asset-row', 'settings-page', '']) expect(isPopupsPart(name), name).toBe(false)
    })

    it('shape mode keeps no custom property name for popups', () => {
        expect(shapeTokenNames('popups').size).toBe(0)
    })

    it('the reference area list is unchanged: popups is a judged area, not a reference area', () => {
        const area: JudgedArea = 'popups'
        expect(lintAreaPack('chat', '[data-part="chat-message-avatar"]{opacity:1}').ok).toBe(true)
        expect(area).toBe('popups')
        expect([...THEME_AREAS]).not.toContain('popups')
    })
})

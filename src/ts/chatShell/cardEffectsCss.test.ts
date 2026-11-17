// @vitest-environment jsdom
import css, { type CssDeclarationAST, type CssRuleAST } from '@adobe/css-tools'
import { describe, expect, test } from 'vitest'
import { CARD_BACKGROUND_ATTR } from '../gui/cardAnimationHold'
import './motionPrefs.svelte'

/** The rules of the sheet the app adopts into the document, not the file on disk: a dropped import leaves it empty. */
function adoptedRules(): CssRuleAST[] {
    const text = document.head.querySelector('style[data-risu-sheet="card-effects"]')?.textContent ?? ''
    return css.parse(text).stylesheet.rules.filter((rule) => rule.type === 'rule') as CssRuleAST[]
}

function declarations(rule: CssRuleAST): Map<string, string> {
    const found = new Map<string, string>()
    for (const entry of rule.declarations ?? []) {
        if (entry.type === 'declaration') {
            found.set((entry as CssDeclarationAST).property ?? '', (entry as CssDeclarationAST).value ?? '')
        }
    }
    return found
}

function ruleWith(property: string): CssRuleAST {
    const rules = adoptedRules().filter((rule) => declarations(rule).has(property))
    expect(rules, property).toHaveLength(1)
    return rules[0]
}

const MOTION = 'html[data-card-motion-off]'
const EFFECTS = 'html[data-card-effects-off]'
const reach = (mark: string) => [
    `${mark} .chattext *`, `${mark} .chattext *::before`, `${mark} .chattext *::after`,
    `${mark} [${CARD_BACKGROUND_ATTR}] *`, `${mark} [${CARD_BACKGROUND_ATTR}] *::before`, `${mark} [${CARD_BACKGROUND_ATTR}] *::after`,
]

describe('the adopted card effects sheet', () => {
    test('the motion rule finishes card animations by a zero duration and delay, never by removing them', () => {
        const rule = ruleWith('animation-duration')
        expect(rule.selectors).toEqual(reach(MOTION))
        expect(declarations(rule).get('animation-duration')).toBe('0s !important')
        expect(declarations(rule).get('animation-delay')).toBe('0s !important')
        for (const each of adoptedRules()) {
            expect([...declarations(each).keys()]).not.toContain('animation')
            expect([...declarations(each).keys()]).not.toContain('animation-name')
        }
    })

    test('the effects rule drops both backdrop filter spellings and every box shadow on the same descendants', () => {
        const rule = ruleWith('box-shadow')
        expect(rule.selectors).toEqual(reach(EFFECTS))
        expect(declarations(rule).get('backdrop-filter')).toBe('none !important')
        expect(declarations(rule).get('-webkit-backdrop-filter')).toBe('none !important')
        expect(declarations(rule).get('box-shadow')).toBe('none !important')
    })

    test('every reach selector is a strict descendant: neither a bare card wrapper nor the background wrapper itself', () => {
        for (const selector of [...ruleWith('animation-duration').selectors ?? [], ...ruleWith('box-shadow').selectors ?? []]) {
            expect(selector).toMatch(/ \*(::before|::after)?$/)
            expect(selector).not.toMatch(/\.chattext(::|$)/)
            expect(selector).not.toMatch(/\.chattext >/)
        }
    })

    test('the background selector is the attribute the background wrapper renders', () => {
        const selectors = ruleWith('animation-duration').selectors ?? []
        expect(selectors).toContain(`${MOTION} [${CARD_BACKGROUND_ATTR}] *`)
        expect(CARD_BACKGROUND_ATTR).toBe('data-risu-card-background')
    })

    test('the app card button keeps a focus indicator that is an outline, not a shadow, while shadows are off', () => {
        const rule = ruleWith('outline')
        expect(rule.selectors).toEqual([`${EFFECTS} .chattext .x-risu-button-default:focus`])
        const found = declarations(rule)
        expect(found.get('outline')).toBe('2px solid var(--risu-theme-borderc) !important')
        expect(found.has('box-shadow')).toBe(false)
    })
})

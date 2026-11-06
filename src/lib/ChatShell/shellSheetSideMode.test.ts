// @vitest-environment node
/**
 * The toggles panel and the This-chat sheet pass the constant mode "side" and leave the width threshold to the
 * stylesheet. That holds only while ShellSheet renders "side" exactly as "tall" below 900 px and gives the side-only
 * rules to the 900 px media query. This guard reads ShellSheet's style block and fails when either property is lost.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, test } from 'vitest'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const SIDE = '[data-mode="side"]'
const TALL = '[data-mode="tall"]'
const WIDE_MEDIA = '(min-width: 900px)'

type Findings = { sideRulesOutsideMedia: string[], heightRuleCoversSide: boolean, sideRuleInWideMedia: boolean }

function inspect(css: string): Findings {
    const findings: Findings = { sideRulesOutsideMedia: [], heightRuleCoversSide: false, sideRuleInWideMedia: false }
    postcss.parse(css).each((node) => {
        if (node.type === 'rule') {
            const rule = node as Rule
            if (!rule.selector.includes(SIDE)) return
            findings.sideRulesOutsideMedia.push(rule.selector)
            const sharesTall = rule.selector.split(',').some((part) => part.includes(TALL))
            const sizesHeight = rule.some((child) => child.type === 'decl' && child.prop === 'height')
            if (sharesTall && sizesHeight) findings.heightRuleCoversSide = true
        } else if (node.type === 'atrule') {
            const media = node as AtRule
            if (media.name !== 'media' || media.params.trim() !== WIDE_MEDIA) return
            media.walkRules((rule) => {
                if (rule.selector.includes(SIDE)) findings.sideRuleInWideMedia = true
            })
        }
    })
    return findings
}

function sheetStyle(): string {
    const source = readFileSync(path.join(root, 'src/lib/ChatShell/ShellSheet.svelte'), 'utf8')
    return [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
}

describe('ShellSheet side mode below and above 900 px', () => {
    test('below 900 px side shares the height rule of tall and has no rule of its own; from 900 px it has the side rule', () => {
        const found = inspect(sheetStyle())
        expect(found.heightRuleCoversSide).toBe(true)
        expect(found.sideRuleInWideMedia).toBe(true)
        // Every unconditioned rule that names side also names tall: nothing narrow styles side differently.
        for (const selector of found.sideRulesOutsideMedia) expect(selector.includes(TALL), selector).toBe(true)
    })

    test('a side rule that lost tall in the height rule, or sits outside the media query, is reported', () => {
        const lostTall = inspect(`[data-part="chat-sheet"][data-mode="tall"] { height: 92%; } [data-part="chat-sheet"][data-mode="side"] { height: 92%; }`)
        expect(lostTall.heightRuleCoversSide).toBe(false)
        const narrowRule = inspect(`[data-part="chat-sheet"][data-mode="tall"], [data-part="chat-sheet"][data-mode="side"] { height: 92%; } [data-part="chat-sheet-layer"][data-mode="side"] { justify-content: flex-end; }`)
        expect(narrowRule.sideRulesOutsideMedia.some((selector) => !selector.includes(TALL))).toBe(true)
        const noMedia = inspect(`[data-part="chat-sheet"][data-mode="tall"], [data-part="chat-sheet"][data-mode="side"] { height: 92%; }`)
        expect(noMedia.sideRuleInWideMedia).toBe(false)
    })
})

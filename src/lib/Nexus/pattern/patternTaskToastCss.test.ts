// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const cssPath = path.resolve(fileURLToPath(new URL('./pattern-task-toast.css', import.meta.url)))
// A missing sheet reads as empty, so every assertion below fails on the sheet's content rather than on an import.
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''

/** Host attributes of the task toast; a rule keyed on one must name a task toast part in the same compound. */
const HOST_ATTRIBUTES = ['data-task-phase', 'data-stays', 'data-low-power', 'aria-expanded']
const TOAST_PART = /\[data-part(?:\^?=)"task-toast/

function compounds(selector: string): string[] {
    const found: string[] = []
    let current = ''
    let depth = 0
    for (const char of selector) {
        if (char === '[' || char === '(') depth++
        if (char === ']' || char === ')') depth--
        if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
            if (current) found.push(current)
            current = ''
            continue
        }
        current += char
    }
    if (current) found.push(current)
    return found
}

function unanchoredCompounds(source: string): string[] {
    const found: string[] = []
    postcss.parse(source).walkRules((rule) => {
        for (const selector of rule.selectors) {
            for (const compound of compounds(selector)) {
                const keyed = HOST_ATTRIBUTES.some((attribute) => compound.includes(`[${attribute}`))
                if (keyed && !TOAST_PART.test(compound)) found.push(`${compound} in ${selector}`)
            }
        }
    })
    return found
}

type Where = 'root' | 'media-reduce' | 'forced-colors'

function whereOf(rule: postcss.Rule): Where | 'other' {
    const parent = rule.parent
    if (parent?.type !== 'atrule') return 'root'
    const atRule = parent as postcss.AtRule
    if (atRule.name !== 'media') return 'other'
    if (atRule.params.includes('prefers-reduced-motion')) return 'media-reduce'
    if (atRule.params.includes('forced-colors')) return 'forced-colors'
    return 'other'
}

/** The declaration value of `property` in the first rule in `where` whose selector contains `selectorPart`. */
function declared(source: string, selectorPart: string, property: string, where: Where): string | undefined {
    let value: string | undefined
    postcss.parse(source).walkRules((rule) => {
        if (value !== undefined || !rule.selector.includes(selectorPart) || whereOf(rule) !== where) return
        rule.walkDecls(property, (decl) => { value = decl.value })
    })
    return value
}

describe('pattern task toast sheet', () => {
    test('the sheet exists and styles the bar fill by transform only, over the fill duration token', () => {
        expect(css).not.toBe('')
        const fill = '[data-part="task-toast-bar-fill"]'
        expect(declared(css, fill, 'transform', 'root')).toContain('scaleX(var(--p-fill')
        const transition = declared(css, fill, 'transition', 'root')
        expect(transition).toContain('transform')
        expect(transition).toContain('var(--task-fill-dur)')
        expect(transition).not.toMatch(/\b(width|height|left|top|margin)\b/)
    })

    test('reduced motion, the rm class and low power all remove the bar transition', () => {
        const fill = '[data-part="task-toast-bar-fill"]'
        expect(declared(css, fill, 'transition', 'media-reduce')).toBe('none')
        expect(declared(css, ':root.rm', 'transition', 'root')).toBe('none')
        expect(declared(css, '[data-low-power]', 'transition', 'root')).toBe('none')
    })

    test('every rule keyed on a host attribute names a task toast part in the same compound', () => {
        expect(css).not.toBe('')
        expect(unanchoredCompounds(css)).toEqual([])
        expect(unanchoredCompounds('[data-task-phase="done"] { color: red }')).toHaveLength(1)
        expect(unanchoredCompounds('[data-part="task-toast"][data-task-phase="done"] { color: red }')).toEqual([])
    })

    test('only theme tokens: no colour literal outside forced colours, no backdrop-filter, no ring', () => {
        expect(css).not.toBe('')
        const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/
        let literals = 0
        let blurred = 0
        let ringed = 0
        postcss.parse(css).walkDecls((decl) => {
            const rule = decl.parent as postcss.Rule
            if (literal.test(decl.value) && whereOf(rule) !== 'forced-colors') literals++
            if (decl.prop === 'backdrop-filter') blurred++
            if (/conic-gradient|stroke-dash/.test(decl.value)) ringed++
        })
        expect(literals).toBe(0)
        expect(blurred).toBe(0)
        expect(ringed).toBe(0)
        const unknownTokens = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]).filter((name) => !/^--(pattern|task|p)-/.test(name))
        expect(unknownTokens).toEqual([])
    })

    test('motion is transform and opacity only, and the sheet has a forced-colours block', () => {
        expect(css).not.toBe('')
        const animated = new Set<string>()
        postcss.parse(css).walkDecls('transition-property', (decl) => { animated.add(decl.value) })
        postcss.parse(css).walkDecls('transition', (decl) => {
            for (const part of decl.value.split(',')) animated.add(part.trim().split(/\s+/)[0])
        })
        for (const property of animated) {
            expect(['transform', 'opacity', 'none']).toContain(property)
        }
        let forced = 0
        postcss.parse(css).walkAtRules('media', (atRule) => { if (atRule.params.includes('forced-colors')) forced++ })
        expect(forced).toBe(1)
    })
})

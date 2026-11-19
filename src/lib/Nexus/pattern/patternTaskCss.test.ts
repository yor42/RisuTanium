// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const cssPath = path.resolve(fileURLToPath(new URL('./pattern-task.css', import.meta.url)))
const css = readFileSync(cssPath, 'utf8')

/**
 * The task card is shown inside hosts that carry their own `data-layout` and state attributes. A rule keyed on one of
 * them must name a pattern part in the same compound, so it cannot restyle anything outside the card.
 */
const HOST_ATTRIBUTES = ['data-layout', 'data-step-state', 'data-task-state', 'data-task-mode', 'data-outcome', 'aria-expanded']
const PATTERN_PART = /\[data-part(?:\^?=)"pattern-/

/** The compound selectors of one selector: the pieces between combinators, brackets and parentheses kept whole. */
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
                if (keyed && !PATTERN_PART.test(compound)) found.push(`${compound} in ${selector}`)
            }
        }
    })
    return found
}

/** The declaration value of `property` in the first rule under `container` whose selector contains `selectorPart`. */
function declared(source: string, selectorPart: string, property: string, inside: 'root' | 'media'): string | undefined {
    let value: string | undefined
    postcss.parse(source).walkRules((rule) => {
        if (value !== undefined || !rule.selector.includes(selectorPart)) return
        const inMedia = rule.parent?.type === 'atrule' && (rule.parent as postcss.AtRule).name === 'media'
        if ((inside === 'media') !== inMedia) return
        rule.walkDecls(property, (decl) => { value = decl.value })
    })
    return value
}

describe('pattern task sheet', () => {
    // A host-attribute selector must name a pattern part, or it would restyle elements outside the pattern layer.
    test('T15 every rule keyed on a host attribute names a pattern part in the same compound', () => {
        expect(unanchoredCompounds(css)).toEqual([])
        expect(unanchoredCompounds('[data-layout="phone"] [data-part="pattern-task-step"] { display: none }')).toHaveLength(1)
        expect(unanchoredCompounds('[data-step-state="now"] { color: red }')).toHaveLength(1)
        expect(unanchoredCompounds('[data-part="pattern-layer"][data-layout="phone"] [data-part="pattern-task-step"] { display: none }')).toEqual([])
    })

    // Each motion mode stills the sweep animation and its tint.
    test('T15 low power, reduced motion and the rm class all stop the sweep and still its tint', () => {
        expect(declared(css, '[data-low-power]', '--pm-sweep-anim', 'root')).toBe('none')
        expect(declared(css, '[data-part="pattern-layer"]', '--pm-sweep-anim', 'media')).toBe('none')
        expect(declared(css, ':root.rm', '--pm-sweep-anim', 'root')).toBe('none')
        for (const [part, where] of [['[data-low-power]', 'root'], ['[data-part="pattern-layer"]', 'media'], [':root.rm', 'root']] as const) {
            expect(declared(css, part, '--pm-sweep-bg', where)).toBe('var(--pattern-task-bar-sweep)')
        }
        expect(declared(css, ':root.rm', '--pm-fill-on', 'root')).toBe('0')
    })

    test('T15 the fill transition reads --d-fill, which the motion cap bounds, and the fill moves by transform', () => {
        expect(declared(css, '[data-part="pattern-task-bar-fill"]', 'transition', 'root')).toContain('var(--d-fill)')
        expect(css).toMatch(/--d-fill:\s*calc\(min\(var\(--task-fill-dur\), var\(--pm-cap\)\)/)
        expect(declared(css, '[data-part="pattern-task-bar-fill"]', 'transform', 'root')).toContain('scaleX(')
        let blurred = 0
        postcss.parse(css).walkDecls('backdrop-filter', () => { blurred++ })
        expect(blurred).toBe(0)
    })
})

// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const cssPath = path.resolve(fileURLToPath(new URL('./pattern-dialog.css', import.meta.url)))

/**
 * The dialog sheet is shown inside hosts that carry their own `data-layout`, `data-pattern-severity`, `data-form` and
 * `aria-expanded` attributes (the chat shell sets `data-layout` on its root, a disclosure of any other widget sets
 * `aria-expanded`). A rule keyed on one of those attributes must therefore sit in a compound selector that also names a
 * pattern part, so it cannot restyle anything outside the dialog and a host cannot change the dialog's own layout.
 */
const HOST_ATTRIBUTES = ['data-layout', 'data-pattern-severity', 'data-form', 'aria-expanded']
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

/** Every compound in the sheet that keys on a host attribute without naming a pattern part. */
function unanchoredCompounds(css: string): string[] {
    const found: string[] = []
    postcss.parse(css).walkRules((rule) => {
        for (const selector of rule.selectors) {
            for (const compound of compounds(selector)) {
                const keyed = HOST_ATTRIBUTES.some((attribute) => compound.includes(`[${attribute}`))
                if (keyed && !PATTERN_PART.test(compound)) found.push(`${compound} in ${selector}`)
            }
        }
    })
    return found
}

describe('pattern dialog sheet anchoring', () => {
    // Regression reproducer: the sheet keyed severity, form, disclosure and phone layout on bare attributes.
    test('every rule keyed on a host attribute names a pattern part in the same compound', () => {
        expect(unanchoredCompounds(readFileSync(cssPath, 'utf8'))).toEqual([])
    })

    test('the checker rejects a bare attribute, a bare ancestor layout and a bare disclosure', () => {
        expect(unanchoredCompounds('[data-form="sheet"] > [data-part="pattern-warn-mark"] { opacity: 1 }')).toHaveLength(1)
        expect(unanchoredCompounds('[data-layout="phone"] [data-part="pattern-layer"] { padding: 0 }')).toHaveLength(1)
        expect(unanchoredCompounds('[aria-expanded="true"] > [data-part="pattern-warn-caret"] { transform: none }')).toHaveLength(1)
        expect(unanchoredCompounds('[data-pattern-severity="danger"] { --p-edge: red }')).toHaveLength(1)
    })

    test('the checker accepts the anchored forms', () => {
        expect(unanchoredCompounds('[data-part="pattern-warn-root"][data-form="sheet"] > [data-part="pattern-warn-mark"] { opacity: 1 }')).toEqual([])
        expect(unanchoredCompounds('[data-part="pattern-layer"][data-layout="phone"] [data-part="pattern-dialog"] { width: 100% }')).toEqual([])
        expect(unanchoredCompounds('[data-part="pattern-warn-detail-toggle"][aria-expanded="true"] > [data-part="pattern-warn-caret"] { transform: none }')).toEqual([])
    })

    test('the phone layout still has its own forms on the layer and the dialog', () => {
        const css = readFileSync(cssPath, 'utf8')
        expect(css).toContain('[data-part="pattern-layer"][data-layout="phone"]')
        expect(css).toContain('[data-part="pattern-layer"][data-layout="phone"] [data-part="pattern-dialog"]')
    })
})

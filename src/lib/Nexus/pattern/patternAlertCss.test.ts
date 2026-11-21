// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const alertCss = readFileSync(path.join(here, 'pattern-alert.css'), 'utf8')

/**
 * Diagnostic, source-reading: the alert shell sheet reads only pattern, task and motion tokens (--pm switches, --d durations and --l delays that pattern-dialog.css derives), so a theme pack that
 * states its colours once restyles the alerts with everything else, and every state rule names a pattern part so it
 * cannot restyle anything outside the shell. The rendered behaviour is pinned by `AlertComp.shell.svelte.test.ts`.
 */
const TOKEN_FAMILIES = /^--(?:pattern|task|pm|p|d|l)-/
const HOST_ATTRIBUTES = ['data-layout', 'data-pattern-severity', 'data-form', 'aria-expanded']
const PATTERN_PART = /\[data-part(?:\^?=)"pattern-/

function declarations(css: string): Array<{ selector: string, prop: string, value: string }> {
    const found: Array<{ selector: string, prop: string, value: string }> = []
    postcss.parse(css).walkDecls((decl) => {
        const rule = decl.parent
        found.push({ selector: rule && 'selector' in rule ? String(rule.selector) : '', prop: decl.prop, value: decl.value })
    })
    return found
}

describe('pattern alert shell sheet', () => {
    test('every var() read is a pattern, task or motion token', () => {
        const reads = declarations(alertCss).flatMap(({ value }) => Array.from(value.matchAll(/var\((--[\w-]+)/g), (m) => m[1]))
        expect(reads.length).toBeGreaterThan(0)
        expect(reads.filter((name) => !TOKEN_FAMILIES.test(name))).toEqual([])
    })

    test('no hex or functional colour literal is written', () => {
        const literals = declarations(alertCss).filter(({ value }) => /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(value))
        expect(literals).toEqual([])
    })

    test('the only literal length is the wide cap, besides the 1px hairline', () => {
        const lengths = declarations(alertCss).filter(({ value }) => /(?<![\w-])\d*\.?\d+(?:px|rem|em)\b/.test(value.replaceAll('1px', '')))
        expect(lengths.map(({ prop, value }) => `${prop}: ${value}`)).toEqual(['width: min(48rem, 100%)'])
    })

    test('every rule keyed on a host attribute names a pattern part in the same compound', () => {
        const unanchored: string[] = []
        postcss.parse(alertCss).walkRules((rule) => {
            for (const selector of rule.selectors) {
                for (const compound of selector.split(/\s+|\s*>\s*/)) {
                    const keyed = HOST_ATTRIBUTES.some((attribute) => compound.includes(`[${attribute}`))
                    if (keyed && !PATTERN_PART.test(compound)) unanchored.push(`${compound} in ${selector}`)
                }
            }
        })
        expect(unanchored).toEqual([])
    })

    test('the sweep is still under low power and reduced motion', () => {
        expect(alertCss).toContain('[data-part="pattern-layer"][data-low-power]')
        expect(alertCss).toContain('@media (prefers-reduced-motion: reduce)')
        expect(alertCss).toContain(':root.rm [data-part="pattern-layer"]')
        expect(alertCss.match(/--pm-alert-sweep-anim: none;/g)?.length).toBe(3)
    })
})

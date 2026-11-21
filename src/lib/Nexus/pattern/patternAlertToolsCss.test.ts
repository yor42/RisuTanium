// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const toolsCss = readFileSync(path.join(here, 'pattern-alert-tools.css'), 'utf8')

/**
 * Diagnostic, source-reading: the tool dialog sheet reads only pattern, task and motion tokens plus a short list of
 * theme roles, writes no colour or length literal, and keys every rule on a pattern part, so a theme pack that states
 * its colours once restyles the tool dialogs with everything else and no rule reaches outside them. The rendered
 * behaviour is pinned by `AlertComp.tools.svelte.test.ts` and `AlertComp.toolsContrast.svelte.test.ts`.
 */
const TOKEN_FAMILIES = /^--(?:pattern|task|pm|p|d|l)-/
const THEME_ROLES = new Set([
    '--nexus-text',
    '--nexus-text-secondary',
    '--nexus-edge',
    '--nexus-edge-strong',
    '--nexus-surface-raised',
    '--nexus-accent-rgb',
    '--nexus-danger-rgb',
    '--nexus-warning-rgb',
    '--nexus-ring',
])
const PATTERN_PART = /\[data-part(?:\^?=)"pattern-/

function declarations(css: string): Array<{ selector: string, prop: string, value: string }> {
    const found: Array<{ selector: string, prop: string, value: string }> = []
    postcss.parse(css).walkDecls((decl) => {
        const rule = decl.parent
        found.push({ selector: rule && 'selector' in rule ? String(rule.selector) : '', prop: decl.prop, value: decl.value })
    })
    return found
}

describe('pattern alert tools sheet', () => {
    test('every var() read is a pattern, task or motion token, or one of the listed theme roles', () => {
        const reads = declarations(toolsCss).flatMap(({ value }) => Array.from(value.matchAll(/var\((--[\w-]+)/g), (m) => m[1]))
        expect(reads.length).toBeGreaterThan(0)
        expect(reads.filter((name) => !TOKEN_FAMILIES.test(name) && !THEME_ROLES.has(name))).toEqual([])
    })

    test('no hex or functional colour literal is written', () => {
        const literals = declarations(toolsCss).filter(({ value }) => /#[0-9a-f]{3,8}\b|\brgba?\((?!\s*var\(--nexus-(accent|danger|warning)-rgb\))|\bhsla?\(/i.test(value))
        expect(literals).toEqual([])
    })

    test('no length literal is written, besides the 1px hairline', () => {
        const lengths = declarations(toolsCss).filter(({ value }) => /(?<![\w-])\d*\.?\d+(?:px|rem|em|vh|vw|ch)\b/.test(value.replaceAll('1px', '')))
        expect(lengths.map(({ prop, value }) => `${prop}: ${value}`)).toEqual([])
    })

    test('every rule selector names a pattern part', () => {
        const unanchored: string[] = []
        postcss.parse(toolsCss).walkRules((rule) => {
            if (rule.parent && rule.parent.type === 'atrule' && 'name' in rule.parent && rule.parent.name === 'keyframes') return
            for (const selector of rule.selectors) {
                if (!PATTERN_PART.test(selector)) unanchored.push(selector)
            }
        })
        expect(unanchored).toEqual([])
    })

    test('every duration comes from a --d- token and no time literal is written', () => {
        const timed = declarations(toolsCss).filter(({ prop }) => prop === 'transition' || prop.startsWith('transition-') || prop === 'animation' || prop.startsWith('animation-'))
        expect(timed.length).toBeGreaterThan(0)
        for (const { prop, value } of timed) {
            expect.soft(/(?<![\w-])\d*\.?\d+m?s\b/.test(value), `${prop}: ${value} has a time literal`).toBe(false)
            expect.soft(/var\(--d-/.test(value), `${prop}: ${value} reads no --d- token`).toBe(true)
        }
    })

    test('every highlight rule is scoped under the code part', () => {
        const unscoped: string[] = []
        postcss.parse(toolsCss).walkRules((rule) => {
            for (const selector of rule.selectors) {
                if (selector.includes('.hljs') && !selector.includes('[data-part="pattern-alert-code"]')) unscoped.push(selector)
            }
        })
        expect(unscoped).toEqual([])
    })

    test('every focus ring reads the shared ring width and offset and the ring colour', () => {
        const focusRules: string[] = []
        postcss.parse(toolsCss).walkRules((rule) => {
            if (!rule.selectors.some((selector) => selector.includes(':focus-visible'))) return
            if (rule.parent && rule.parent.type === 'atrule' && 'params' in rule.parent && rule.parent.params.includes('forced-colors')) return
            rule.walkDecls('outline', (decl) => {
                focusRules.push(`${rule.selector} { outline: ${decl.value} }`)
            })
        })
        expect(focusRules.length).toBeGreaterThan(0)
        for (const line of focusRules) {
            expect.soft(line, 'the ring width').toContain('var(--pattern-focus-width)')
            expect.soft(line, 'the ring colour').toContain('var(--nexus-ring)')
        }
    })

    test('a branch node has a focus ring rule that reads the shared ring', () => {
        let ring = ''
        postcss.parse(toolsCss).walkRules((rule) => {
            if (rule.selectors.includes('[data-part="pattern-alert-tree-node"]:focus-visible')) {
                rule.walkDecls('outline', (decl) => { ring = decl.value })
            }
        })
        expect(ring).toContain('var(--pattern-focus-width)')
        expect(ring).toContain('var(--nexus-ring)')
    })
})

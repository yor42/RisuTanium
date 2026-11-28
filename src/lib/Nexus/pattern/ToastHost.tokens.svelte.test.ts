// @vitest-environment node

/**
 * The plain and undo toasts, and the task toasts' borders and buttons, paint with the pack-aware role tokens. The
 * toast body uses the flat surface token (opaque in a pack base) because a toast floats over content. With no pack
 * the tokens resolve to the scheme variables they replaced. Declared-source test: Tailwind is not compiled under
 * Vitest, so the class source and the token declarations are what the paint is derived from.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8')
const source = read('src/lib/Nexus/pattern/ToastHost.svelte')
const tokens = read('src/styles/nexus-tokens.css')

const MIGRATED_SCHEME_UTILITY = /(?<![\w-])(?:hover:)?(?:bg|text|border|ring)-(?:textcolor|darkborderc|darkbutton|darkbg|bgcolor)(?![\w-])/

describe('ToastHost paint source', () => {
    test('no migrated scheme utility remains', () => {
        expect(source.match(MIGRATED_SCHEME_UTILITY)).toBeNull()
    })

    test('toast surfaces, edges and buttons read the role tokens', () => {
        expect(source.match(/bg-\(--nexus-surface-flat\)/g)?.length).toBe(3)
        expect(source.match(/bg-\(--nexus-surface-raised\)/g)?.length).toBe(2)
        expect(source).toContain("'border-(--nexus-edge)'")
        expect(source).toContain('border border-(--nexus-edge)')
    })

    test('warning and error edges, secondary text and hover fills keep the scheme colour', () => {
        expect(source).toContain("'border-draculared'")
        expect(source).toContain('text-textcolor2')
        expect(source).toContain('hover:bg-selected')
    })

    test('the critical toasts keep their critical marker', () => {
        expect(source.match(/data-part-critical/g)?.length).toBe(2)
    })

    test('no pack: each token used resolves to the scheme variable it replaced', () => {
        const root = tokens.slice(tokens.indexOf(':root, [data-own-scheme] {'))
        expect(root).toMatch(/--nexus-surface-flat:\s*var\(--risu-theme-darkbg\)/)
        expect(root).toMatch(/--nexus-surface-raised:\s*var\(--risu-theme-darkbutton\)/)
        expect(root).toMatch(/--nexus-edge:\s*var\(--risu-theme-darkborderc\)/)
        expect(root).toMatch(/--nexus-text:\s*var\(--risu-theme-textcolor\)/)
    })

    test('a pack base recolours the flat surface and keeps it near opaque', () => {
        const base = tokens.slice(tokens.indexOf(':root:where([data-theme-pack-base])'))
        expect(base).toMatch(/--nexus-surface-flat:\s*rgb\(14 15 42 \/ 0\.94\)/)
    })
})

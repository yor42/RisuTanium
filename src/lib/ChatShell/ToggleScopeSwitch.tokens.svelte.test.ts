// @vitest-environment node

/**
 * The scope switch paints with the pack-aware role tokens, not the scheme utilities, so a theme pack recolours it
 * while a user with no pack still sees exactly the scheme colours (the tokens resolve to the scheme variables
 * until a pack base is on). Declared-source test: Tailwind is not compiled under Vitest, so the class source and the
 * token declarations are what the paint is derived from.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8')
const source = read('src/lib/ChatShell/ToggleScopeSwitch.svelte')
const tokens = read('src/styles/nexus-tokens.css')

// Only the classes whose token is exactly the scheme colour with no pack are migrated.
const MIGRATED_SCHEME_UTILITY = /(?<![\w-])(?:hover:)?(?:bg|text|border|ring)-(?:textcolor|darkborderc|darkbutton|darkbg|bgcolor)(?![\w-])/

describe('ToggleScopeSwitch paint source', () => {
    test('no migrated scheme utility remains', () => {
        expect(source.match(MIGRATED_SCHEME_UTILITY)).toBeNull()
    })

    test('track, knob and text read the role tokens', () => {
        expect(source).toContain('border-(--nexus-edge)')
        expect(source).toContain('bg-(--nexus-edge)')
        expect(source).toContain('bg-(--nexus-surface-raised)')
        expect(source).toContain('bg-nexus-text')
        expect(source).toContain('text-nexus-text')
    })

    test('the secondary text keeps the scheme colour (its role token is contrast-derived, not equal)', () => {
        expect(source).toContain('text-textcolor2')
    })

    test('no pack: each token used resolves to the scheme variable it replaced', () => {
        const root = tokens.slice(tokens.indexOf(':root, [data-own-scheme] {'))
        expect(root).toMatch(/--nexus-edge:\s*var\(--risu-theme-darkborderc\)/)
        expect(root).toMatch(/--nexus-surface-raised:\s*var\(--risu-theme-darkbutton\)/)
        expect(root).toMatch(/--nexus-text:\s*var\(--risu-theme-textcolor\)/)
    })

    test('the pack base is the only place those tokens stop following the scheme', () => {
        const base = tokens.slice(tokens.indexOf(':root:where([data-theme-pack-base])'))
        expect(base).toMatch(/--nexus-edge:\s*rgb\(/)
        expect(base).toMatch(/--nexus-text:\s*rgb\(/)
    })
})

// @vitest-environment node

/**
 * The shell sidebar content files paint with the pack-aware role tokens. Only classes whose token equals the scheme
 * colour with no pack are migrated; secondary text, selected fills and the danger dot keep the scheme utilities
 * because their role tokens are contrast-derived and could differ for a user with no pack. Overlays (the More
 * panel, the strip glyph) use the flat surface so a pack base does not make them see-through. Declared-source test:
 * Tailwind is not compiled under Vitest.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8')
const FILES = ['ShellSidebar', 'ShellChatList', 'ShellChatRow', 'ShellSidebarSearch', 'RecentStrip', 'SidebarMoreMenu']
const sources = FILES.map((name) => ({ name, text: read(`src/lib/ChatShell/sidebar/${name}.svelte`) }))
const tokens = read('src/styles/nexus-tokens.css')

const MIGRATED_SCHEME_UTILITY = /(?<![\w-])(?:hover:)?(?:bg|text|border|ring)-(?:textcolor|darkborderc|darkbutton|darkbg|bgcolor)(?![\w-])/

describe('shell sidebar paint source', () => {
    for (const { name, text } of sources) {
        test(`${name} has no migrated scheme utility`, () => {
            expect(text.match(MIGRATED_SCHEME_UTILITY)).toBeNull()
        })
    }

    test('the roots and overlays read the intended tokens', () => {
        const get = (name: string) => sources.find((entry) => entry.name === name)!.text
        expect(get('ShellSidebar')).toContain('data-part="chat-sidebar" class="relative flex h-full min-h-0 w-full flex-col gap-3 text-nexus-text"')
        expect(get('ShellSidebar')).toContain('bg-nexus-canvas')
        expect(get('SidebarMoreMenu')).toContain('bg-(--nexus-surface-flat) text-nexus-text')
        expect(get('RecentStrip')).toContain('bg-(--nexus-surface-flat) text-nexus-text')
        expect(get('ShellSidebarSearch')).toContain('border-(--nexus-edge) bg-(--nexus-surface-raised)')
        expect(get('ShellChatRow')).toContain('ring-(--nexus-edge)')
    })

    test('classes without an equal token keep the scheme colour', () => {
        const all = sources.map((entry) => entry.text).join('\n')
        expect(all).toContain('text-textcolor2')
        expect(all).toContain('hover:bg-selected')
        expect(all).toContain('bg-draculared')
    })

    test('no pack: each token used resolves to the scheme variable it replaced', () => {
        const root = tokens.slice(tokens.indexOf(':root, [data-own-scheme] {'))
        expect(root).toMatch(/--nexus-canvas:\s*var\(--risu-theme-bgcolor\)/)
        expect(root).toMatch(/--nexus-surface:\s*var\(--risu-theme-darkbg\)/)
        expect(root).toMatch(/--nexus-surface-flat:\s*var\(--risu-theme-darkbg\)/)
        expect(root).toMatch(/--nexus-surface-raised:\s*var\(--risu-theme-darkbutton\)/)
        expect(root).toMatch(/--nexus-edge:\s*var\(--risu-theme-darkborderc\)/)
        expect(root).toMatch(/--nexus-text:\s*var\(--risu-theme-textcolor\)/)
    })

    test('a pack base is where those tokens stop following the scheme', () => {
        const base = tokens.slice(tokens.indexOf(':root:where([data-theme-pack-base])'))
        for (const name of ['canvas', 'surface', 'surface-raised', 'surface-flat', 'edge', 'text']) {
            expect(base).toMatch(new RegExp(`--nexus-${name}:\\s*(#|rgb\\()`))
        }
    })
})

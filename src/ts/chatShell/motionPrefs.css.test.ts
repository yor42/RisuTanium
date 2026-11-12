import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// GUARD (a source scan, not a cascade proof): every OS reduced-motion rule the app ships steps aside for the
// device setting's "off" (`rm-off`), and the chat shell's OS rules stay ahead of its low-power rules, so equal
// specificity still lets low power cap what reduced motion leaves.
const FILES = [
    'src/lib/ChatShell/ShellMessage.svelte',
    'src/lib/ChatShell/ShellSheet.svelte',
    'src/lib/ChatShell/ShellHeader.svelte',
    'src/lib/ChatShell/ShellComposer.svelte',
    'src/lib/ChatShell/ToggleRow.svelte',
    'src/styles/studio-tokens.css',
    'src/styles/nexus-tokens.css',
    'src/lib/Nexus/boot/nexus-boot.css',
    'src/lib/Nexus/brand/nexus-mark.css',
    'src/lib/Nexus/pattern/pattern-dialog.css',
]
const SCOPES = [':global(html:not(.rm-off)', ':root:not(.rm-off)']

/** The selectors of each rule inside every `@media (prefers-reduced-motion: ...)` block of the source. */
function reducedMotionSelectors(source: string): { query: string, selectors: string[] }[] {
    const out: { query: string, selectors: string[] }[] = []
    const pattern = /@media\s*\(prefers-reduced-motion:\s*([a-z-]+)\)\s*\{/g
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        let depth = 1
        let at = pattern.lastIndex
        let start = at
        const selectors: string[] = []
        for (; at < source.length && depth > 0; at++) {
            const ch = source[at]
            if (ch === '{') {
                if (depth === 1) selectors.push(...source.slice(start, at).split(',').map((part) => part.trim()).filter(Boolean))
                depth++
            } else if (ch === '}') {
                depth--
                if (depth === 1) start = at + 1
            }
        }
        out.push({ query: match[1], selectors })
    }
    return out
}

/** Every rule selector of the source at any depth, split at top-level commas. */
function allSelectors(source: string): string[] {
    const out: string[] = []
    let start = 0
    for (let at = 0; at < source.length; at++) {
        const ch = source[at]
        if (ch === '{') {
            out.push(...source.slice(start, at).split(',').map((part) => part.trim()).filter(Boolean))
            start = at + 1
        } else if (ch === '}' || ch === ';') {
            start = at + 1
        }
    }
    return out
}

describe('the reduce-motion "off" choice reaches every OS rule', () => {
    test.each(FILES)('%s scopes each reduce rule by rm-off and has no no-preference rule', (file) => {
        const blocks = reducedMotionSelectors(readFileSync(file, 'utf8'))
        expect(blocks.length).toBeGreaterThan(0)
        for (const block of blocks) {
            expect(block.query, file).toBe('reduce')
            for (const selector of block.selectors) {
                expect(SCOPES.some((scope) => selector.startsWith(scope)), `${file}: ${selector}`).toBe(true)
            }
        }
    })

    test.each(FILES.slice(0, 3))('%s keeps its OS rule before its low-power rule', (file) => {
        const source = readFileSync(file, 'utf8')
        const media = source.indexOf('@media (prefers-reduced-motion: reduce)')
        const lowPower = source.indexOf(':global(html[data-low-power])')
        expect(media).toBeGreaterThan(-1)
        expect(lowPower).toBeGreaterThan(media)
    })

    // Each OS rule has an `rm` twin with the same target, so the setting's "on" reduces exactly what the OS query does.
    test.each(FILES)('%s gives each reduce rule an rm counterpart', (file) => {
        const source = readFileSync(file, 'utf8')
        const all = new Set(allSelectors(source))
        for (const block of reducedMotionSelectors(source)) {
            for (const selector of block.selectors) {
                const twins = selector.startsWith(':root:not(.rm-off)')
                    ? [selector.replace(':root:not(.rm-off)', ':root.rm'), selector.replace(':root:not(.rm-off)', 'html.rm')]
                    : [selector.replace(':global(html:not(.rm-off)', ':global(html.rm')]
                expect(twins.some((twin) => all.has(twin)), `${file}: ${selector}`).toBe(true)
            }
        }
    })

    test('the scan sees a scoped rule and rejects an unscoped one', () => {
        expect(reducedMotionSelectors('@media (prefers-reduced-motion: reduce) { :root:not(.rm-off) a, b { x: 1; } }')).toEqual([{ query: 'reduce', selectors: [':root:not(.rm-off) a', 'b'] }])
    })
})

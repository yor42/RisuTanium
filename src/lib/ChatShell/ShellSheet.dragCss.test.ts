import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// GUARD (a source scan, not a cascade proof) for the drag-down rules of the chat sheet (CHORE-726). jsdom evaluates
// neither @media nor animations, so the rules the gesture depends on are pinned here by text.
const source = readFileSync('src/lib/ChatShell/ShellSheet.svelte', 'utf8')
const style = source.slice(source.indexOf('<style>'), source.indexOf('</style>'))
const SETTLE = '[data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"]'
const SETTLE_SCRIM = '[data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"]'

function rule(selectorPart: string): string[] {
    return style.split('\n').filter((line) => line.includes(selectorPart))
}

describe('sheet drag CSS', () => {
    test('the settle moves only transform and opacity, on the sheet and the scrim alike', () => {
        const base = style.split('\n').find((line) => line.trim().startsWith(SETTLE))!
        expect(base).toContain(SETTLE_SCRIM)
        expect(base).toMatch(/transition: transform var\(--chat-dur-base\) var\(--chat-ease-out\), opacity var\(--chat-dur-base\) var\(--chat-ease-out\);/)
        for (const line of rule('[data-settle]')) {
            for (const match of line.matchAll(/transition\s*:\s*([^;]+)/g)) {
                for (const part of match[1].split(',')) expect(['transform', 'opacity'], line).toContain(part.trim().split(/\s+/)[0])
            }
        }
    })

    test('reduced motion settles in the fast duration through the OS query and the rm class, low power at the cap, both together fast', () => {
        expect(style).toContain(`@media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)) ${SETTLE}`)
        expect(style).toContain(`:global(html.rm) ${SETTLE}, :global(html.rm) ${SETTLE_SCRIM} { transition-duration: var(--chat-dur-fast); }`)
        expect(style).toMatch(new RegExp(`:global\\(html\\[data-low-power\\]\\) ${escape(SETTLE)}[^{]*:global\\(html\\.nexus-low-power\\) ${escape(SETTLE_SCRIM)} \\{ transition-duration: var\\(--dur-lowpower-cap\\); \\}`))
        expect(style).toContain(`:global(html.rm.nexus-low-power) ${SETTLE_SCRIM} { transition-duration: var(--chat-dur-fast); }`)
        expect(style).toContain(`:global(html:not(.rm-off).nexus-low-power) ${SETTLE_SCRIM} { transition-duration: var(--chat-dur-fast); }`)
    })

    test('once moved the entry animation is off whatever else applies, and a drag has no transition', () => {
        expect(style).toContain('[data-part="chat-sheet"][data-moved] { animation: none !important; }')
        expect(style).toContain('[data-part="chat-sheet"][data-dragging] { transition: none; }')
        // The animation-off rule comes after every animation rule of the sheet.
        expect(style.lastIndexOf('animation: sheet-')).toBeLessThan(style.indexOf('[data-part="chat-sheet"][data-moved]'))
    })

    test('the scrim follows the drag through a variable and keeps the theme opacity at rest', () => {
        expect(style).toContain('opacity: calc(var(--opacity-scrim) * (1 - var(--sheet-drag, 0)));')
    })

    // Callers pin their own title bars with `position: sticky; top: 0` (This chat, Toggles), so the handle must not.
    test('the handle is a full-width touch strip at the top of the content that takes no scrolling, never sticky, hidden on the wide side panel', () => {
        const handle = rule('[data-part="chat-sheet-handle"] {')[0]
        expect(handle).not.toContain('sticky')
        expect(handle).toContain('height: var(--size-touch);')
        expect(handle).toContain('margin: calc(-1 * var(--sheet-padding-bottom)) calc(-1 * var(--sheet-padding-x)) 0;')
        expect(handle).toContain('background: var(--color-surface-sheet);')
        expect(handle).toContain('touch-action: none;')
        expect(style).toContain('@media (min-width: 900px) { [data-part="chat-sheet"][data-mode="side"] [data-part="chat-sheet-handle"] { display: none; } }')
    })
})

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// GUARD (a source scan, not a cascade proof) for the swipe feedback rules (SLICE1_SPEC §2 rule 1, §3.2, §5.2):
// only transform and opacity animate; the meter's arc is never transitioned; reduced motion and low power each
// reach the long-press ring through both of their markers.
const source = readFileSync('src/lib/ChatShell/ShellMessage.svelte', 'utf8')
const style = source.slice(source.indexOf('<style>'), source.indexOf('</style>'))
const FEEDBACK = /chat-swipe-|chat-long-press-ring|chat-message-stage|data-settle|meter-|lp-f/

/** Each rule (selector and body) of the style block, nested at-rule contents included. */
function rules(css: string): { selector: string, body: string }[] {
    const out: { selector: string, body: string }[] = []
    const pattern = /([^{}]+)\{([^{}]*)\}/g
    for (let match = pattern.exec(css); match; match = pattern.exec(css)) out.push({ selector: match[1].trim(), body: match[2] })
    return out
}

const feedback = rules(style).filter((rule) => FEEDBACK.test(rule.selector))

describe('swipe feedback CSS', () => {
    test('the rules exist', () => {
        expect(feedback.length).toBeGreaterThan(10)
    })

    test('every transition names only transform and opacity', () => {
        for (const rule of feedback) {
            for (const match of rule.body.matchAll(/transition(?:-property)?\s*:\s*([^;]+)/g)) {
                const properties = match[1].split(',').map((part) => part.trim().split(/\s+/)[0])
                for (const property of properties) expect(['transform', 'opacity'], `${rule.selector}: ${match[0]}`).toContain(property)
            }
        }
    })

    test('the ring keyframes move only transform and opacity, and no other animation is used by the feedback', () => {
        for (const name of ['lp-fill', 'lp-fade']) {
            const at = style.indexOf(`@keyframes ${name}`)
            expect(at).toBeGreaterThan(-1)
            const block = style.slice(at, style.indexOf('}\n', at) + 1)
            for (const match of block.matchAll(/([a-z-]+)\s*:/g)) expect(['transform', 'opacity'], `${name}: ${match[1]}`).toContain(match[1])
        }
        for (const rule of feedback) {
            for (const match of rule.body.matchAll(/animation(?:-name)?\s*:\s*([^;]+)/g)) {
                expect(match[1].trim() === 'none' || /^(lp-(fill|fade)|commit-mark)\b/.test(match[1].trim()), `${rule.selector}: ${match[0]}`).toBe(true)
            }
        }
    })

    test('the commit mark keyframes change opacity only', () => {
        const block = /@keyframes commit-mark\s*\{([\s\S]*?\})\s*\}/.exec(style)
        expect(block).not.toBeNull()
        const properties = [...block![1].matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1])
        expect(properties.length).toBeGreaterThan(0)
        for (const property of properties) expect(property).toBe('opacity')
    })

    // GUARD (G-CSS-MARK, a source scan): the commit mark is a cue only, uses tokens, animates opacity only, and is stepped under both low-power markers.
    test('the commit mark takes no input, uses tokens, fades by opacity over the highlight duration and is stepped under both low-power markers', () => {
        const mark = feedback.find((rule) => rule.selector === '[data-part="chat-swipe-commit-mark"]')!
        expect(mark.body).toContain('position: absolute')
        expect(mark.body).toContain('inset: 0')
        expect(mark.body).toContain('border: var(--stroke-bold) solid var(--nexus-accent)')
        expect(mark.body).toContain('border-radius: var(--radius-4)')
        expect(mark.body).toContain('pointer-events: none')
        expect(mark.body).toContain('opacity: 0')
        expect(mark.body).toMatch(/animation:\s*commit-mark var\(--dur-highlight\) var\(--ease-linear\) both/)
        expect(mark.body).not.toMatch(/transform|scale|translate/)
        const stepped = feedback.filter((rule) => rule.selector.includes('chat-swipe-commit-mark') && /steps\(1, end\)/.test(rule.body))
        const selectors = stepped.map((rule) => rule.selector).join('\n')
        expect(selectors).toContain(':global(html[data-low-power]) [data-part="chat-swipe-commit-mark"]')
        expect(selectors).toContain(':global(html.nexus-low-power) [data-part="chat-swipe-commit-mark"]')
        for (const rule of stepped) expect(rule.body).toMatch(/animation-timing-function:\s*steps\(1, end\)/)
    })

    test('the meter arc offset is never transitioned or animated', () => {
        expect(style).not.toMatch(/transition[^;]*stroke-dashoffset/)
        expect(style).not.toMatch(/@keyframes[^}]*stroke-dashoffset/)
    })

    test('reduced motion reaches the ring through the OS query and the rm class, low power through both markers', () => {
        const selectors = feedback.map((rule) => rule.selector).join('\n')
        expect(selectors).toContain(':global(html:not(.rm-off)) [data-part="chat-long-press-ring"]')
        expect(selectors).toContain(':global(html.rm) [data-part="chat-long-press-ring"]')
        expect(selectors).toContain(':global(html[data-low-power]) [data-part="chat-long-press-ring"]')
        expect(selectors).toContain(':global(html.nexus-low-power) [data-part="chat-long-press-ring"]')
        expect(style).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ :global\(html:not\(\.rm-off\)\) \[data-part="chat-long-press-ring"\]/)
    })

    test('an armed meter turns the accent colour', () => {
        const armed = feedback.find((rule) => rule.selector === '[data-part="chat-swipe-meter"][data-armed]')!
        expect(armed.body).toContain('color: var(--nexus-accent)')
    })

    test('the peek is a cue only: it never takes pointer input', () => {
        const peek = feedback.find((rule) => rule.selector === '[data-part="chat-swipe-peek"]')!
        expect(peek.body).toContain('pointer-events: none')
        expect(peek.body).toContain('opacity: var(--opacity-soft)')
    })
})

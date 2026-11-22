// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

/**
 * The hint's style rules, read from the component's style block: a jsdom run evaluates no media query and no
 * `html.rm` rule, so the motion switches and the layout-neutral box are asserted on the parsed rules.
 */

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const source = readFileSync(path.join(root, 'src/lib/ChatShell/LongChatHint.svelte'), 'utf8')
const css = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? ''

function declarations(selectorPart: string, inMedia: boolean): Record<string, string> {
    const found: Record<string, string> = {}
    postcss.parse(css).walkRules((rule) => {
        const media = rule.parent?.type === 'atrule' && (rule.parent as postcss.AtRule).name === 'media'
        if (media !== inMedia || rule.selector !== selectorPart) return
        rule.walkDecls((decl) => { found[decl.prop] = decl.value })
    })
    return found
}

describe('LongChatHint style', () => {
    test('T4.7 the box is absolute, takes no pointer events and sits at the bottom left', () => {
        const base = declarations('[data-part="chat-long-hint"]', false)
        expect(base.position).toBe('absolute')
        expect(base['pointer-events']).toBe('none')
        expect(base.left).toBeDefined()
        expect(base.bottom).toBeDefined()
    })

    test('T4.6 the fade is switched off under reduced motion, html.rm and low power', () => {
        expect(declarations('[data-part="chat-long-hint"]', false).animation).toContain('var(--chat-dur-fast)')
        const query = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\{[^}]*animation:\s*none/)
        expect(query).not.toBeNull()
        for (const selector of ['html.rm', 'html[data-low-power]', 'html.nexus-low-power']) {
            const rule = css.split('\n').find((line) => line.includes(selector))
            expect(rule, selector).toBeDefined()
            expect(rule).toContain('animation: none')
        }
    })
})

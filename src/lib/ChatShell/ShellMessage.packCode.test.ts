// @vitest-environment happy-dom
/**
 * A committed code block under a theme pack (#654): the highlighter's token colours are fixed for a dark ground, and the pack base
 * makes the prose ground transparent, so on a light bubble they read at 2:1. The block keeps the highlighter's own ground.
 * Kinds: the light-bubble rows are regression reproducers (fail on the base); the no-pack row is a compatibility guard.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { CascadeModel, compileRules, readRepoFile as read } from '../../styles/tests/cascadeModel'

const HLJS = read('node_modules/highlight.js/styles/atom-one-dark.min.css')
const SHELL = read('src/lib/ChatShell/ShellMessage.svelte')
// the two role tokens the rule reads, as the app declares them
const TOKENS = ':root{' + read('src/styles/chat-tokens.css').match(/--color-code-block-bg:[^;]*;\s*--color-code-block-text:[^;]*;/)![0] + '}'
const PROSE = '.prose pre{background-color:var(--tw-prose-pre-bg);color:var(--tw-prose-pre-code)}'
// the component's own pack-base rules, global selectors unwrapped
const packRules = [...SHELL.matchAll(/^\s*(:global\(:root\[data-theme-pack-base\]\)[^{\n]*\{[^}\n]*\})/gm)].map((m) => m[1].replace(/:global\(([^()]*)\)/g, '$1'))

const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

function pre(pack: boolean): { model: CascadeModel, el: Element } {
    document.documentElement.toggleAttribute('data-theme-pack-base', pack)
    document.body.innerHTML = '<div data-part="chat-message-body" class="prose"><pre class="hljs"><code>x</code></pre></div>'
    const css = `:root{--tw-prose-pre-bg:${pack ? 'transparent' : '#111111'};--tw-prose-pre-code:currentColor}` + packRules.join('\n')
    const model = new CascadeModel(compileRules([{ name: 'hljs', css: HLJS }, { name: 'tokens', css: TOKENS }, { name: 'prose', css: PROSE }, { name: 'shell', css }]))
    return { model, el: document.querySelector('pre')! }
}

describe('code block ground under a pack', () => {
    afterEach(() => { document.documentElement.removeAttribute('data-theme-pack-base'); document.body.innerHTML = '' })

    test('the component states a pack-base rule for pre.hljs', () => expect(packRules.some((r) => r.includes('pre.hljs'))).toBe(true))

    test('under a pack the block keeps the highlighter ground and text colour (REPRO)', () => {
        const { model, el } = pre(true)
        expect(model.prop(el, 'background-color')).toBe('#282c34')
        expect(model.prop(el, 'color')).toBe('#abb2bf')
    })

    test('every token colour of the highlighter reads on that ground at 3:1 or better, and the plain text at 4.5:1 (REPRO)', () => {
        const { model, el } = pre(true)
        const ground = model.prop(el, 'background-color')!
        expect(ratio(model.prop(el, 'color')!, ground)).toBeGreaterThanOrEqual(4.5)
        for (const [, c] of HLJS.matchAll(/\.hljs-(?:keyword|title|string|number|built_in|attr|params)[^{]*\{color:(#[0-9a-f]{6})/gi)) expect(ratio(c, ground), c).toBeGreaterThanOrEqual(3)
    })

    test('with no pack the prose ground still applies (guard)', () => {
        const { model, el } = pre(false)
        expect(model.prop(el, 'background-color')).toBe('#111111')
    })
})

// @vitest-environment node
import css, { type CssDeclarationAST, type CssRuleAST } from '@adobe/css-tools'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8')

/** Every rule block whose selector text mentions `.loadmove`, parsed on its own so Tailwind-only syntax elsewhere cannot break the parse. */
function loadmoveRules(source: string): CssRuleAST[] {
    const rules: CssRuleAST[] = []
    for (const match of source.matchAll(/[^{}]*\.loadmove[^{}]*\{[^{}]*\}/g)) {
        const parsed = css.parse(match[0])
        for (const rule of parsed.stylesheet.rules) {
            if (rule.type === 'rule') {
                rules.push(rule as CssRuleAST)
            }
        }
    }
    return rules
}

function declaration(rule: CssRuleAST, property: string): string | undefined {
    const found = (rule.declarations ?? []).find((entry) => entry.type === 'declaration' && (entry as CssDeclarationAST).property === property)
    return (found as CssDeclarationAST | undefined)?.value
}

describe('the global ring timing', () => {
    test('styles.css .loadmove ticks in steps(8), and no rule pairs it with reduced motion or low power', () => {
        const rules = loadmoveRules(read('src/styles.css'))
        expect(rules).toHaveLength(1)
        expect(rules[0].selectors).toEqual(['.loadmove'])
        expect(declaration(rules[0], 'animation')).toBe('spin 1s steps(8) infinite')
    })

    test('the Suggestion ring keeps its own linear timing', () => {
        const source = read('src/lib/ChatScreens/Suggestion.svelte')
        const style = /<style>([\s\S]*?)<\/style>/.exec(source)![1]
        const own = loadmoveRules(style).find((rule) => rule.selectors?.length === 1 && rule.selectors[0] === '.loadmove')
        expect(own).toBeDefined()
        expect(declaration(own!, 'animation')).toBe('spin 1s linear infinite')
    })

    test('the shell ring ticks in steps(8) on the shell duration token', () => {
        const source = read('src/lib/ChatShell/ShellComposer.svelte')
        expect(source).toMatch(/\[data-part="chat-composer-progress"\] \{ animation: progress var\(--dur-spin\) steps\(8\) infinite; \}/)
    })
})

describe('the hold sheet rule', () => {
    test('pauses a latched ring with an important declaration on both ring selectors', () => {
        const text = read('src/ts/chatShell/streamTextHold.css').replace(/\/\*[\s\S]*?\*\//g, '')
        const rules = css.parse(text).stylesheet.rules.filter((rule) => rule.type === 'rule') as CssRuleAST[]
        expect(rules).toHaveLength(1)
        expect(rules[0].selectors).toEqual(['.loadmove[data-still]', '[data-part="chat-composer-progress"][data-still]'])
        expect(declaration(rules[0], 'animation-play-state')).toBe('paused !important')
    })
})

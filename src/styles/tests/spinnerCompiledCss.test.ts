// @vitest-environment node
import css, { type CssDeclarationAST, type CssRuleAST } from '@adobe/css-tools'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'svelte/compiler'
import { describe, expect, test } from 'vitest'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

/** The stylesheet the compiler keeps for a component: a rule it judged unused is dropped from the output. */
function compiledRules(relative: string): CssRuleAST[] {
    const filename = path.join(root, relative)
    const result = compile(readFileSync(filename, 'utf8'), { filename, generate: 'client', css: 'external', experimental: { async: true } })
    const code = result.css?.code ?? ''
    return css.parse(code).stylesheet.rules.filter((rule) => rule.type === 'rule') as CssRuleAST[]
}

function declaration(rule: CssRuleAST, property: string): string | undefined {
    const found = (rule.declarations ?? []).find((entry) => entry.type === 'declaration' && (entry as CssDeclarationAST).property === property)
    return (found as CssDeclarationAST | undefined)?.value
}

const GATE_PREFIXES = ['html.rm ', 'html[data-low-power] ', 'html.nexus-low-power ']

/** The compiled gate: the three reduced-motion and low-power selectors on a `.loadmove` that carries the component's scope class. */
function loadmoveGate(rules: CssRuleAST[]): CssRuleAST | undefined {
    return rules.find((rule) => GATE_PREFIXES.every((prefix) => (rule.selectors ?? []).some((selector) => selector.startsWith(`${prefix}.loadmove.svelte-`))))
}

describe('the compiled spinner css', () => {
    test.each([
        'src/lib/ChatScreens/DefaultChatScreen.svelte',
        'src/lib/ChatScreens/Suggestion.svelte',
    ])('%s keeps the static gate for the Cancel and suggestion ring', (relative) => {
        const gate = loadmoveGate(compiledRules(relative))
        expect(gate).toBeDefined()
        expect(declaration(gate!, 'animation')).toBe('none')
    })

    test('ShellComposer keeps steps(8) on the ring and its static gates', () => {
        const rules = compiledRules('src/lib/ChatShell/ShellComposer.svelte')
        const ticking = rules.find((rule) => (rule.selectors ?? []).some((selector) => selector.startsWith('[data-part="chat-composer-progress"]')) && declaration(rule, 'animation')?.includes('steps(8)'))
        expect(ticking).toBeDefined()
        expect(declaration(ticking!, 'animation')).toMatch(/^svelte-[\w-]+-progress var\(--dur-spin\) steps\(8\) infinite$/)
        const gated = rules.find((rule) => (rule.selectors ?? []).some((selector) => selector.startsWith('html[data-low-power] [data-part="chat-composer-progress"]')))
        expect(gated).toBeDefined()
        expect(declaration(gated!, 'animation')).toBe('none')
    })
})

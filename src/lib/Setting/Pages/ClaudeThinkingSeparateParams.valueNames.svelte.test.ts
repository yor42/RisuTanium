// @vitest-environment jsdom

/**
 * `ClaudeThinkingSeparateParams.svelte` value controls: every select and the disableable thinking-token
 * slider are named by their visible label span through `aria-labelledby`, and the slider's checkbox
 * carries the label text. No naming element is shared between two controls in any branch.
 * Mounts the REAL component with the real shared inputs; only the model lookup is a stub.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { subModel: 'sub-m', seperateModels: {} } as Record<string, unknown>,
}))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ parameters: [], flags: [] })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    get DBState() { return { db: h.db } },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import type { SeparateParameters } from 'src/ts/storage/database.svelte'
import ClaudeThinkingSeparateParams from './ClaudeThinkingSeparateParams.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(value: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ClaudeThinkingSeparateParams, {
        target,
        props: { value: value as unknown as SeparateParameters, paramKey: 'memory' },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const THINKING_TYPE = language.thinkingType
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
}

describe('ClaudeThinkingSeparateParams value controls are named', () => {
    test('off: only the thinking mode select', () => {
        check(render({ thinking_type: 'off' }), [{ name: THINKING_TYPE }])
    })

    test('budget: the select and the disableable token slider with its toggle', () => {
        check(render({ thinking_type: 'budget', thinking_tokens: 1000 }), [
            { name: THINKING_TYPE },
            { name: language.thinkingTokens, toggle: true },
        ])
    })

    test('adaptive: the select and the effort select', () => {
        check(render({ thinking_type: 'adaptive', adaptive_thinking_effort: 'high' }), [
            { name: THINKING_TYPE },
            { name: language.adaptiveThinkingEffort },
        ])
    })

    test('DeepSeek enabled adds the thinking mode and the reasoning effort selects', () => {
        check(render({ thinking_type: 'off', deepseek_thinking_type: 'enabled', deepseek_reasoning_effort: 'high' }), [
            { name: THINKING_TYPE },
            { name: 'DeepSeek Thinking Mode' },
            { name: 'DeepSeek Reasoning Effort' },
        ])
    })

    test('DeepSeek off adds only the thinking mode select', () => {
        check(render({ thinking_type: 'off', deepseek_thinking_type: 'off' }), [
            { name: THINKING_TYPE },
            { name: 'DeepSeek Thinking Mode' },
        ])
    })

    test('adaptive with DeepSeek enabled shows all four selects in order', () => {
        check(render({ thinking_type: 'adaptive', adaptive_thinking_effort: 'low', deepseek_thinking_type: 'enabled', deepseek_reasoning_effort: 'max' }), [
            { name: THINKING_TYPE },
            { name: language.adaptiveThinkingEffort },
            { name: 'DeepSeek Thinking Mode' },
            { name: 'DeepSeek Reasoning Effort' },
        ])
    })
})

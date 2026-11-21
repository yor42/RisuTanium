// @vitest-environment jsdom

/**
 * `UtilityScreen.svelte` value control: the preset select is named by the visible preset label span
 * through `aria-labelledby`, alone and together with the open preset editor (whose own number inputs are
 * named by their own spans). Mounts the REAL screen and editor with the real form components; the
 * conversation engine's model request, `DBState`, confirm dialog and model picker are mocks of
 * `UtilityScreen.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock('src/ts/process/request/request', () => ({ requestChatDataMain: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => true) }))
vi.mock('src/ts/model/modellist', async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFormat: types.LLMFormat,
        getModelInfo: (id: string) => ({ id, format: types.LLMFormat.OpenAICompatible }),
    }
})
vi.mock('../UI/ModelList.svelte', () => ({
    default: (_anchor: unknown) => {},
}))

import { language } from 'src/lang'
import { controlName, fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import UtilityScreen from './UtilityScreen.svelte'

const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(presets: Array<Record<string, unknown>>): HTMLElement {
    DBState.db = { taskPresets: presets } as never
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(UtilityScreen, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return target
}

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    // The message textarea has no visible label, so its screen-reader-only span is the only one: a lost labelId on
    // another control would add a second span.
    const spans = Array.from(target.querySelectorAll('span.sr-only'))
    expect(spans.map((span) => span.textContent)).toEqual([language.utility.messagePlaceholder])
    const textarea = target.querySelector('[data-testid="utility-input"]')!
    expect(textarea.hasAttribute('aria-label')).toBe(false)
    expect(textarea.getAttribute('aria-labelledby')).toBe(spans[0].id)
    expect(textarea.getAttribute('aria-describedby')!.split(' ')[0]).toBe(spans[0].id)
    expect(controlName(textarea)).toBe(language.utility.messagePlaceholder)
}

const GOOD = { id: 'p1', name: 'Fixer', instructions: 'Fix it.', model: 'gpt4o' }

describe('UtilityScreen value control is named', () => {
    test('no presets: no value control', () => {
        check(open([]), [])
    })

    test('with presets: the preset select takes the preset label', () => {
        check(open([GOOD]), [{ name: language.utility.presetLabel }])
    })

    test('with the editor open: the select and the editor number inputs keep distinct names', () => {
        const target = open([{ ...GOOD, temperature: 0.5, maxTokens: 10 }])
        Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === language.utility.editPresets)!.click()
        flushSync()
        Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Fixer')!.click()
        flushSync()
        check(target, [
            { name: language.utility.presetLabel },
            { name: language.utility.editor.temperature },
            { name: language.utility.editor.maxTokens },
        ])
    })
})

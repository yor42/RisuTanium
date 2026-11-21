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
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
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

// The message textarea has no visible label: it is named by aria-label alone (the placeholder text), which the
// checker's labelledby rule does not count. It is a text field, not a value control, and stays out of scope.
const KNOWN_UNNAMED: string[] = [
    '<textarea class="min-h-24 w-full resize-y rounded-md border border-darkborderc bg-transparent px-4 py-2 text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc">',
]

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
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

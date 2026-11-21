// @vitest-environment jsdom

/**
 * `TaskPresetEditor.svelte` value controls: the temperature and max-tokens number inputs are named by
 * their visible label spans through `aria-labelledby`, and the "use global" checkbox before each input
 * is not mistaken for the input's own toggle. Mounts the REAL editor with the real form components; the
 * `DBState` stand-in, confirm dialog and model picker are mocks of `TaskPresetEditor.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => true) }))
vi.mock('../UI/ModelList.svelte', () => ({
    default: (_anchor: unknown) => {},
}))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import TaskPresetEditor from './TaskPresetEditor.svelte'

const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(preset: Record<string, unknown>): HTMLElement {
    DBState.db = { taskPresets: [{ id: 'a', name: 'one', instructions: 'x', model: 'gpt4o', ...preset }] } as never
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(TaskPresetEditor, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'one')!.click()
    flushSync()
    return target
}

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
}

describe('TaskPresetEditor value controls are named', () => {
    test('global temperature and max tokens render no number input', () => {
        check(open({}), [])
    })

    test('own temperature and max tokens: both number inputs, with no toggle pairing', () => {
        check(open({ temperature: 0.5, maxTokens: 100 }), [
            { name: language.utility.editor.temperature },
            { name: language.utility.editor.maxTokens },
        ])
    })

    test('own temperature alone', () => {
        check(open({ temperature: 0.5 }), [{ name: language.utility.editor.temperature }])
    })

    test('own max tokens alone', () => {
        check(open({ maxTokens: 100 }), [{ name: language.utility.editor.maxTokens }])
    })
})

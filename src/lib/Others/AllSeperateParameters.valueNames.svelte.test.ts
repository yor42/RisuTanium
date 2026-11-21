// @vitest-environment jsdom

/**
 * `AllSeperateParameters.svelte` value controls: every disableable parameter slider is named by its visible
 * label text through `aria-labelledby`, with that label first in `aria-describedby`, and its on/off
 * checkbox carries the same name. The temperature label also holds a Help button, so the slider is named by
 * an inner text span only. Mounts the REAL component with the real SliderInput, Help and SegmentedControl;
 * the Claude thinking panel is a stub because its controls belong to its own file. Mocks follow
 * `AllSeperateParameters.names.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const model = vi.hoisted(() => ({ parameters: [] as string[] }))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ parameters: model.parameters })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock('src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte', () => ({ default: () => { } }))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { subModel: 'test', seperateModelsForAxModels: false, seperateModels: {} } },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import type { SeparateParameters } from 'src/ts/storage/database.svelte'
import AllSeperateParameters from './AllSeperateParameters.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(parameters: string[], withImportExport = false): HTMLElement {
    model.parameters = parameters
    const target = document.createElement('div')
    document.body.appendChild(target)
    const value = { temperature: 77, top_k: 40, reasoning_effort: 1, verbosity: 1 } as unknown as SeparateParameters
    const app = mount(AllSeperateParameters, { target, props: { value, withImportExport } }) as unknown as Record<string, unknown>
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

/** Every slider is disableable, so each has its on/off checkbox named like the slider. */
const sliders = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name, toggle: true }))

const SAMPLERS = ['Top K', 'Repetition Penalty', 'Min P', 'Top A', 'Top P', language.frequencyPenalty, language.presensePenalty]

/** Out-of-scope unnamed controls on this page: none. */
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
}

describe('AllSeperateParameters value controls are named', () => {
    test('a model with temperature: eight disableable sliders, temperature first', () => {
        check(render(['temperature']), sliders(language.temperature, ...SAMPLERS))
    })

    test('a model without temperature drops the temperature slider', () => {
        check(render([]), sliders(...SAMPLERS))
    })

    test('reasoning effort and verbosity add segmented buttons only, with the import and export row', () => {
        check(render(['temperature', 'reasoning_effort', 'verbosity'], true), sliders(language.temperature, ...SAMPLERS))
    })
})

// @vitest-environment jsdom

/**
 * The off switch of a separate-parameters slider remembers its number under the bound `SeparateParameters` object, so switching to another
 * purpose or model override (a different object, even a structurally equal one) restores the range minimum, never the other subject's number.
 * Mounts the REAL component with the real SliderInput; mocks follow `AllSeperateParameters.valueNames.svelte.test.ts`.
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

import type { SeparateParameters } from 'src/ts/storage/database.svelte'
import AllSeperateParameters from './AllSeperateParameters.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(first: Partial<SeparateParameters>) {
    model.parameters = []
    const target = document.createElement('div')
    document.body.appendChild(target)
    const state = $state<{ v: SeparateParameters }>({ v: first as SeparateParameters })
    const props = {
        withImportExport: false,
        get value() { return state.v },
        set value(x: SeparateParameters) { state.v = x },
    }
    const app = mount(AllSeperateParameters, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const box = () => target.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="Top K"]')!
    return { state, box }
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('AllSeperateParameters off switch memory', () => {
    test('regression reproducer: off then on restores the number under the same bound object', () => {
        const { state, box } = render({ top_k: 40 })
        box().click()
        flushSync()
        expect(state.v.top_k).toBe(-1000)
        box().click()
        flushSync()
        expect(state.v.top_k).toBe(40)
    })

    test('compatibility guard (mutant: token not compared): a replaced bound object that is also off restores the minimum, never the old number', () => {
        const { state, box } = render({ top_k: 40 })
        box().click()
        flushSync()
        state.v = { top_k: -1000 } as SeparateParameters
        flushSync()
        box().click()
        flushSync()
        expect(state.v.top_k).toBe(0)
    })
})

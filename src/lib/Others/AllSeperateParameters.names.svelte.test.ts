// @vitest-environment jsdom

/**
 * `AllSeperateParameters.svelte`: the export and import buttons are named, their glyphs are hidden
 * and they use the scheme fill with a ring instead of blue and green. Mounts the REAL component with
 * its real Help and SegmentedControl; the slider (a number input, out of scope) and the Claude
 * thinking panel are stubs. Mocks follow `AllSeperateParameters.cancel.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ parameters: ['temperature', 'reasoning_effort', 'verbosity'] })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock('src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte', () => ({ default: () => { } }))
vi.mock('src/lib/UI/GUI/SliderInput.svelte', () => ({ default: () => { } }))

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
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import type { SeparateParameters } from 'src/ts/storage/database.svelte'
import AllSeperateParameters from './AllSeperateParameters.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountWith(withImportExport: boolean): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const value = { temperature: 77, reasoning_effort: 1, verbosity: 1 } as unknown as SeparateParameters
    const app = mount(AllSeperateParameters, { target, props: { value, withImportExport } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const exportRow = (target: HTMLElement) => Array.from(target.querySelectorAll(':scope > div.flex')).at(-1) as HTMLElement

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('AllSeperateParameters accessible names and colours', () => {
    test('regression reproducer: the export and import buttons are named and have no unnamed control beside them', () => {
        const target = mountWith(true)
        const row = exportRow(target)
        const buttons = Array.from(row.querySelectorAll(':scope > button'))
        expect(buttons.map(controlName)).toEqual([language.export, language.import])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the glyphs are hidden', () => {
        expect(exposedIcons(mountWith(true))).toEqual([])
    })

    test('regression reproducer: the buttons use the scheme fill with a ring, not blue and green', () => {
        const target = mountWith(true)
        expect(paletteClasses(target)).toEqual([])
        const row = exportRow(target)
        for (const button of Array.from(row.querySelectorAll(':scope > button'))) {
            for (const token of ['bg-selected', 'text-textcolor', 'ring-1', 'ring-borderc', 'hover:ring-2', 'hover:ring-textcolor2']) {
                expect(button.classList.contains(token), token).toBe(true)
            }
        }
    })
})

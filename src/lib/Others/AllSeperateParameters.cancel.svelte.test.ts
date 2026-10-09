// @vitest-environment happy-dom

/**
 * Closing the file chooser of the import button in `AllSeperateParameters.svelte`
 * without choosing a file does nothing: no error, no change of the parameters.
 *
 * Mounts the REAL component over the REAL `selectSingleFile`; the chooser is
 * played by `util.domPickerHarness.ts`. This is a caller-regression reproducer
 * for the fixed picker: it passes against the original picker (the promise
 * stays pending) and fails against a picker that answers `null` while the caller
 * still dereferences the result.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, settledWithin, type DomPicker } from 'src/ts/util.domPickerHarness'

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ parameters: [] })),
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

import AllSeperateParameters from './AllSeperateParameters.svelte'
import type { SeparateParameters } from 'src/ts/storage/database.svelte'

let picker: DomPicker
let target: HTMLElement
let app: Record<string, unknown>
let alertSpy: ReturnType<typeof vi.fn>
const unhandled: unknown[] = []

function onUnhandled(reason: unknown): void {
    unhandled.push(reason)
}

beforeEach(() => {
    picker = installDomPicker()
    alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
})

afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    await unmount(app as never)
    target.remove()
    picker.restore()
    vi.unstubAllGlobals()
})

function mountWith(value: SeparateParameters): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(AllSeperateParameters, { target, props: { value, withImportExport: true } }) as unknown as Record<string, unknown>
    flushSync()
}

describe('the parameter import button', () => {
    test('closing the chooser changes nothing and raises nothing', async () => {
        const value = { temperature: 77 } as unknown as SeparateParameters
        mountWith(value)
        const buttons = target.querySelectorAll('button')
        const importButton = buttons[1]

        importButton.click()
        picker.cancel()
        await settledWithin(Promise.resolve(), 60)
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(unhandled).toEqual([])
        expect(alertSpy).not.toHaveBeenCalled()
        expect(value.temperature).toBe(77)
        expect(picker.leftInDocument()).toBe(false)
    })

    test('guard: a chosen parameter file replaces the parameters', async () => {
        const holder = { value: { temperature: 1 } as unknown as SeparateParameters }
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(AllSeperateParameters, {
            target,
            props: {
                get value() { return holder.value },
                set value(next: SeparateParameters) { holder.value = next },
                withImportExport: true,
            },
        }) as unknown as Record<string, unknown>
        flushSync()

        target.querySelectorAll('button')[1].click()
        picker.pick([new File([JSON.stringify({ temperature: 5 })], 'p.json')])
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect((holder.value as unknown as { temperature: number }).temperature).toBe(5)
        expect(unhandled).toEqual([])
    })
})

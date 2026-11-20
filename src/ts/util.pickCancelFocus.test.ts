// @vitest-environment jsdom

/**
 * Focus after a file picker returns nothing: a closed chooser or an empty selection puts focus back on the control
 * that opened the picker, unless the user moved it or files came back. The chooser is played by
 * `util.domPickerHarness.ts`, and a blur stands in for the focus loss; a pass says nothing about the native chooser.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, type DomPicker } from './util.domPickerHarness'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(), appDataDir: vi.fn(), join: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 14 },
    readFile: vi.fn(async () => new Uint8Array()),
    open: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({})),
}))

vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { alertTask, resetTaskHostForTests, taskOpener } from 'src/ts/alertTask.svelte'
import { resetPickOpenerForTest, takePickOpener } from 'src/ts/pickOpener'
import { selectFileByDom } from 'src/ts/util'

let picker: DomPicker

beforeEach(() => {
    resetPickOpenerForTest()
    picker = installDomPicker()
})

afterEach(() => {
    resetTaskHostForTests()
    picker.restore()
    resetPickOpenerForTest()
    document.body.replaceChildren()
})

function button(): HTMLButtonElement {
    const el = document.createElement('button')
    document.body.appendChild(el)
    return el
}

describe('focus after a picker that returned nothing', () => {
    test('a cancelled pick gives focus back to the opener and spends the memory', async () => {
        const opener = button()
        opener.focus()
        const result = selectFileByDom(['png'], 'multiple')
        opener.blur()
        expect(document.activeElement).toBe(document.body)

        picker.cancel()

        expect(await result).toEqual([])
        expect(document.activeElement).toBe(opener)
        expect(takePickOpener()).toBeNull()
    })

    test('a confirmed empty selection gives focus back to the opener', async () => {
        const opener = button()
        opener.focus()
        const result = selectFileByDom(['png'], 'multiple')
        opener.blur()

        picker.emptyChange()

        expect(await result).toEqual([])
        expect(document.activeElement).toBe(opener)
    })

    test('a selection the extension filter empties gives focus back to the opener', async () => {
        const opener = button()
        opener.focus()
        const result = selectFileByDom(['png'], 'multiple')
        opener.blur()

        picker.pick([new File([Uint8Array.from([1])], 'x.txt')])

        expect(await result).toEqual([])
        expect(document.activeElement).toBe(opener)
    })

    test('compat guard (passes before and after): picked files leave focus alone and keep the opener for the card', async () => {
        const opener = button()
        opener.focus()
        const result = selectFileByDom(['png'], 'multiple')
        opener.blur()

        picker.pick([new File([Uint8Array.from([1])], 'a.png')])

        expect((await result)?.length).toBe(1)
        expect(document.activeElement).toBe(document.body)
        expect(takePickOpener()).toBe(opener)
    })

    test('compat guard (passes before and after): focus the user moved elsewhere is kept', async () => {
        const opener = button()
        const other = button()
        opener.focus()
        const result = selectFileByDom(['png'], 'multiple')
        other.focus()

        picker.cancel()

        expect(await result).toEqual([])
        expect(document.activeElement).toBe(other)
    })

    test('compat guard (passes before and after): an opener that left the page is not focused and nothing throws', async () => {
        const opener = button()
        opener.focus()
        const result = selectFileByDom(['png'], 'multiple')
        opener.blur()
        opener.remove()

        picker.cancel()

        expect(await result).toEqual([])
        expect(document.activeElement).toBe(document.body)
    })

    test('compat guard (passes before and after): the spent memory gives a later alert no opener', async () => {
        const opener = button()
        opener.focus()
        const result = selectFileByDom(['png'], 'multiple')
        opener.blur()
        picker.cancel()
        await result

        opener.blur()
        alertTask({ title: 'Importing', steps: [{ label: 'Read file' }] })

        expect(taskOpener()).toBeNull()
    })

    test('a late finish of an older picker returns focus to its own opener, not the newer picker\'s', async () => {
        const first = button()
        const second = button()
        first.focus()
        const firstResult = selectFileByDom(['png'], 'multiple')
        const firstInput = picker.inputs.at(-1) as HTMLInputElement
        first.blur()
        second.focus()
        const secondResult = selectFileByDom(['png'], 'multiple')
        second.blur()
        expect(document.activeElement).toBe(document.body)

        firstInput.dispatchEvent(new Event('cancel'))

        expect(await firstResult).toEqual([])
        expect(document.activeElement).toBe(first)

        picker.cancel()
        await secondResult
    })
})

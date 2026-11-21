// @vitest-environment jsdom

/**
 * A file chooser opened from inside an alert chooser (the add-character sheet) returns focus to the control that opened
 * the alert when it is cancelled: the sheet's own button is gone, so the picker would otherwise remember nothing. The
 * chooser is played by `util.domPickerHarness.ts`; a pass says nothing about the native chooser.
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

import { clearAlertOpener, noteAlertOpener, pageOpener } from 'src/ts/alertOpener'
import { resetPickOpenerForTest } from 'src/ts/pickOpener'
import { selectFileByDom } from 'src/ts/util'

let picker: DomPicker

beforeEach(() => {
    resetPickOpenerForTest()
    clearAlertOpener()
    picker = installDomPicker()
})

afterEach(() => {
    picker.restore()
    resetPickOpenerForTest()
    clearAlertOpener()
    document.body.replaceChildren()
})

function button(parent: HTMLElement = document.body): HTMLButtonElement {
    const el = document.createElement('button')
    parent.appendChild(el)
    return el
}

function alertRoot(): HTMLElement {
    const root = document.createElement('div')
    root.setAttribute('data-alert-root', '')
    document.body.appendChild(root)
    return root
}

describe('selectFileByDom after an alert chooser', () => {
    // FR-8
    test('a cancelled chooser opened from a closed alert chooser returns focus to the control that opened the alert', async () => {
        const plus = button()
        noteAlertOpener(plus)
        expect(document.activeElement).toBe(document.body)

        const pending = selectFileByDom(['png'], 'single')
        picker.cancel()
        await pending

        expect(document.activeElement).toBe(plus)
    })

    test('a cancelled chooser opened while focus is on a control inside the alert returns focus to the alert opener', async () => {
        const plus = button()
        const importButton = button(alertRoot())
        noteAlertOpener(plus)
        importButton.focus()

        const pending = selectFileByDom(['png'], 'single')
        importButton.remove()
        picker.cancel()
        await pending

        expect(document.activeElement).toBe(plus)
    })

    test('guard: a chooser opened from a focused page control returns focus to that control', async () => {
        const opener = button()
        opener.focus()

        const pending = selectFileByDom(['png'], 'single')
        opener.blur()
        picker.cancel()
        await pending

        expect(document.activeElement).toBe(opener)
    })
})

// FR-10
describe('pageOpener', () => {
    test('a focused element outside the alert is the opener', () => {
        const el = button()
        noteAlertOpener(button())
        expect(pageOpener(el)).toBe(el)
    })

    test('the body and an element inside the alert fall back to the remembered control', () => {
        const remembered = button()
        const inside = button(alertRoot())
        noteAlertOpener(remembered)
        expect(pageOpener(document.body)).toBe(remembered)
        expect(pageOpener(inside)).toBe(remembered)
        expect(pageOpener(null)).toBe(remembered)
    })

    test('a remembered control that left the page is not returned', () => {
        const remembered = button()
        noteAlertOpener(remembered)
        remembered.remove()
        expect(pageOpener(document.body)).toBeNull()
    })

    test('with nothing remembered the body and an alert control give null', () => {
        expect(pageOpener(document.body)).toBeNull()
        expect(pageOpener(button(alertRoot()))).toBeNull()
    })

    test('an element that is not an HTMLElement is not an opener', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        document.body.appendChild(svg)
        expect(pageOpener(svg)).toBeNull()
    })
})

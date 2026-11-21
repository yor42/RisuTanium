// @vitest-environment jsdom

/**
 * The card's opener when it opens from a confirm that covered the page: the confirm's own controls are gone with it, so a
 * card opened in the answer's continuation takes the control the alert remembered. Focus on a real page element still
 * wins, and an alert control or the body never counts as an opener.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
import { clearAlertOpener, noteAlertOpener } from 'src/ts/alertOpener'
import { resetPickOpenerForTest } from 'src/ts/pickOpener'

beforeEach(() => {
    resetPickOpenerForTest()
    clearAlertOpener()
})

afterEach(() => {
    resetTaskHostForTests()
    resetPickOpenerForTest()
    clearAlertOpener()
    document.body.replaceChildren()
})

function button(parent: HTMLElement = document.body): HTMLButtonElement {
    const el = document.createElement('button')
    parent.appendChild(el)
    return el
}

function open(): void {
    alertTask({ title: 'Importing', steps: [{ label: 'Read file' }] })
}

describe('the card opener after a confirm', () => {
    // FR-9
    test('a card opened once the confirm is gone takes the control the confirm remembered', () => {
        const opener = button()
        noteAlertOpener(opener)
        expect(document.activeElement).toBe(document.body)

        open()

        expect(taskOpener()).toBe(opener)
    })

    test('a card opened while focus is still on a control inside the alert takes the remembered control', () => {
        const opener = button()
        const root = document.createElement('div')
        root.setAttribute('data-alert-root', '')
        document.body.appendChild(root)
        const yes = button(root)
        noteAlertOpener(opener)
        yes.focus()
        expect(document.activeElement).toBe(yes)

        open()

        expect(taskOpener()).toBe(opener)
    })

    test('guard: a focused page element beats the remembered control', () => {
        const opener = button()
        const other = button()
        noteAlertOpener(opener)
        other.focus()

        open()

        expect(taskOpener()).toBe(other)
    })

    test('guard: a remembered control that left the page is not used', () => {
        const opener = button()
        noteAlertOpener(opener)
        opener.remove()

        open()

        expect(taskOpener()).toBeNull()
    })

    test('guard: with nothing remembered and focus on the body there is no opener', () => {
        open()

        expect(taskOpener()).toBeNull()
    })
})

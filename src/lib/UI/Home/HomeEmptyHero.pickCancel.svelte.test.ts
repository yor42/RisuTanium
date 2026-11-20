// @vitest-environment jsdom

/**
 * Focus around the hero's Import button when the chooser is closed without a pick: the real `selectFileByDom` runs
 * behind a mocked `importCharacter`, so the button that opened the picker gets focus back after the cancel.
 *
 * MOCKED: the chooser is played by `util.domPickerHarness.ts`, `importCharacter` only awaits the picker, and
 * `stores.svelte` is reduced to an empty library. The native chooser is not involved.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { resetPickOpenerForTest } from 'src/ts/pickOpener'
import { installDomPicker, type DomPicker } from 'src/ts/util.domPickerHarness'

const importCharacterSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: importCharacterSpy,
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('src/ts/characters', () => ({
    createNewCharacter: vi.fn(),
    changeChar: vi.fn(),
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [] } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        SettingsMenuIndex: { set: vi.fn() },
        settingsOpen: { set: vi.fn() },
        selectedCharID: { subscribe: vi.fn() },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

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
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({})),
}))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { selectFileByDom } from 'src/ts/util'
import HomeEmptyHero from './HomeEmptyHero.svelte'

let component: ReturnType<typeof mount> | null = null
let picker: DomPicker

beforeEach(() => {
    resetPickOpenerForTest()
    picker = installDomPicker()
    importCharacterSpy.mockImplementation(async () => {
        await selectFileByDom(['*'], 'multiple')
        return []
    })
})

afterEach(() => {
    if (component) {
        unmount(component)
        component = null
    }
    picker.restore()
    resetPickOpenerForTest()
    importCharacterSpy.mockReset()
    document.body.replaceChildren()
})

function importButton(): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === language.homeEmptyImport)
    if (!found) throw new Error('Import button not rendered')
    return found
}

describe('the hero Import button after a closed chooser', () => {
    test('regains focus and accepts another activation', async () => {
        component = mount(HomeEmptyHero, { target: document.body })
        flushSync()
        const button = importButton()
        button.focus()

        button.click()
        await tick()
        await vi.waitFor(() => expect(picker.inputs.length).toBe(1))

        button.blur()
        expect(document.activeElement).toBe(document.body)
        picker.cancel()
        await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).not.toBe('true'))
        await tick()

        expect(document.activeElement).toBe(button)
    })
})

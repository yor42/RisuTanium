// @vitest-environment jsdom

/**
 * The card's opener after a file picker: the picker's button loses focus to the body while the chooser is open, so the
 * card that opens right after the pick takes the remembered button as its opener, once, and only for a short while
 * after the files came back. The chooser is played by `util.domPickerHarness.ts`; a pass says nothing about the native
 * chooser.
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
import { PICK_OPENER_TTL_MS, resetPickOpenerForTest } from 'src/ts/pickOpener'
import { selectFileByDom } from 'src/ts/util'

let picker: DomPicker

beforeEach(() => {
    vi.useFakeTimers()
    resetPickOpenerForTest()
    picker = installDomPicker()
})

afterEach(() => {
    resetTaskHostForTests()
    picker.restore()
    resetPickOpenerForTest()
    vi.useRealTimers()
    document.body.replaceChildren()
})

function button(): HTMLButtonElement {
    const el = document.createElement('button')
    document.body.appendChild(el)
    return el
}

function pngs(): File[] {
    return [new File([Uint8Array.from([1])], 'a.png')]
}

/** Focuses `opener`, runs a picker that returns files, then drops focus to the body as the chooser does. */
async function pickFrom(opener: HTMLElement): Promise<void> {
    opener.focus()
    const pending = selectFileByDom(['png'], 'multiple')
    picker.pick(pngs())
    await pending
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
}

function open(): void {
    alertTask({ title: 'Importing', steps: [{ label: 'Read file' }] })
}

describe('the card opener after a picker', () => {
    // R307-11
    test('a card opened right after a pick takes the focused button as its opener', async () => {
        const opener = button()
        await pickFrom(opener)
        open()
        expect(taskOpener()).toBe(opener)
    })

    // R307-12
    test('a focused element beats the remembered button, and the memory is spent either way', async () => {
        const opener = button()
        const other = button()
        await pickFrom(opener)
        other.focus()
        open()
        expect(taskOpener()).toBe(other)
        resetTaskHostForTests()
        ;(document.activeElement as HTMLElement).blur()
        open()
        expect(taskOpener()).toBeNull()
    })

    test('a second card after the pick gets no opener', async () => {
        await pickFrom(button())
        open()
        resetTaskHostForTests()
        open()
        expect(taskOpener()).toBeNull()
    })

    test('a closed chooser forgets the button, so the next card has no opener', async () => {
        await pickFrom(button())
        const other = button()
        other.focus()
        const pending = selectFileByDom(['png'], 'single')
        picker.cancel()
        await pending
        other.blur()
        open()
        expect(taskOpener()).toBeNull()
    })

    // R307-12b
    test('the remembered button expires after the time limit', async () => {
        const opener = button()
        await pickFrom(opener)
        vi.advanceTimersByTime(PICK_OPENER_TTL_MS)
        open()
        expect(taskOpener()).toBe(opener)

        resetTaskHostForTests()
        await pickFrom(opener)
        vi.advanceTimersByTime(PICK_OPENER_TTL_MS + 1)
        open()
        expect(taskOpener()).toBeNull()
    })

    test.each(['pointerdown', 'keydown'])('a %s after the files came back forgets the button', async (type) => {
        const opener = button()
        await pickFrom(opener)
        document.body.dispatchEvent(new Event(type, { bubbles: true }))
        open()
        expect(taskOpener()).toBeNull()
    })

    test('a button removed from the page is not used', async () => {
        const opener = button()
        await pickFrom(opener)
        opener.remove()
        open()
        expect(taskOpener()).toBeNull()
    })
})

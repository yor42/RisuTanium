// @vitest-environment jsdom

/**
 * The Shortcuts page with the real component, the real toast host and the real `hotkeys` merge. The profile is built
 * through the real `setDatabase` (MC-329), so the rows are the ones a fresh install holds; a custom row goes through
 * the same merge as `overrides.hotkeys`.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), the platform, file and click-handler
 * modules that `setDatabase` imports, and `alert` (its confirm answers are set per test).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    changeFullscreen: vi.fn(),
    sleep: vi.fn(async () => {}),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        SafeModeStore: writable(false),
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        settingsOpen: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { language } from 'src/lang'
import { alertConfirm } from 'src/ts/alert'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { resetToastHostForTests, toastHost } from 'src/ts/toast/toastHost.svelte'
import HotkeySettings from './HotkeySettings.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const originalWidth = window.innerWidth

async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function freshProfile(overrides: Partial<Record<keyof Database, unknown>> = {}): Database {
    const profile = { pluginCustomStorage: {}, ...overrides } as Database
    setDatabase(profile)
    return profile
}

function show(props: { apple?: boolean } = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(HotkeySettings, { target, props }))
    flushSync()
    return target
}

function chordButton(target: HTMLElement, action: string): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>(`[data-hotkey-action="${action}"]`)
    if (!found) throw new Error(`no chord button ${action}`)
    return found
}

function rowOf(target: HTMLElement, action: string): HTMLElement | null {
    return target.querySelector<HTMLElement>(`[data-hotkey-row="${action}"]`)
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(ev)
    flushSync()
    return ev
}

function startRecording(target: HTMLElement, action: string): HTMLButtonElement {
    const button = chordButton(target, action)
    button.focus()
    button.click()
    flushSync()
    return button
}

function stored(action: string) {
    return DBState.db.hotkeys.find((row) => row.action === action)!
}

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

beforeEach(() => {
    resetBackHandlersForTests()
    freshProfile()
})

afterEach(async () => {
    for (const app of mounted.splice(0)) {
        await unmount(app)
    }
    document.body.replaceChildren()
    resetToastHostForTests()
    setWidth(originalWidth)
    delete (window as { matchMedia?: unknown }).matchMedia
    vi.mocked(alertConfirm).mockClear()
})

describe('recording a chord (A1, A10)', () => {
    test('a valid chord is saved, undoable, stays away from global shortcuts and focus returns to the chord', async () => {
        const target = show()
        const documentSpy = vi.fn()
        document.addEventListener('keydown', documentSpy)
        const button = startRecording(target, 'home')
        expect(button.getAttribute('aria-pressed')).toBe('true')
        expect(target.querySelector('[data-hotkey-status]')!.textContent).toBe(language.settingsShellHkRecPrompt)

        const ev = press(button, 'y', { ctrlKey: true, altKey: true })
        document.removeEventListener('keydown', documentSpy)
        expect(documentSpy).not.toHaveBeenCalled()
        expect(ev.defaultPrevented).toBe(true)
        expect(stored('home')).toMatchObject({ key: 'y', ctrl: true, alt: true, shift: false })
        expect(toastHost.visible).toHaveLength(1)
        expect(toastHost.visible[0].text).toBe(language.settingsShellHkSet)
        expect(toastHost.visible[0].kind).toBe('undo')
        await settle()
        expect(document.activeElement).toBe(chordButton(target, 'home'))

        await toastHost.activate(toastHost.visible[0].id)
        expect(stored('home')).toMatchObject({ key: 'h', ctrl: true })
    })

    test('recording the row\'s own chord ends recording with no write and no toast', async () => {
        const target = show()
        const button = startRecording(target, 'home')
        press(button, 'h', { ctrlKey: true })
        expect(toastHost.visible).toHaveLength(0)
        expect(button.getAttribute('aria-pressed')).toBe('false')
    })
})

describe('refusals and leaving (A2, A10)', () => {
    test('Tab leaves unprevented, Escape cancels without reaching the document, bare R is refused and recording goes on', async () => {
        const target = show()
        const documentSpy = vi.fn()
        let button = startRecording(target, 'home')
        press(button, 'r')
        expect(target.querySelector('[data-part="settings-hotkey-recording"]')!.textContent).toBe(language.settingsShellHkBare)
        expect(button.getAttribute('aria-pressed')).toBe('true')

        const tab = press(button, 'Tab')
        expect(tab.defaultPrevented).toBe(false)
        expect(button.getAttribute('aria-pressed')).toBe('false')

        button = startRecording(target, 'home')
        document.addEventListener('keydown', documentSpy)
        const esc = press(button, 'Escape')
        document.removeEventListener('keydown', documentSpy)
        expect(esc.defaultPrevented).toBe(true)
        expect(documentSpy).not.toHaveBeenCalled()
        expect(button.getAttribute('aria-pressed')).toBe('false')
        await settle()
        expect(document.activeElement).toBe(button)
    })

    test('blur ends recording and Back cancels it', async () => {
        const target = show()
        const button = startRecording(target, 'home')
        button.blur()
        flushSync()
        expect(button.getAttribute('aria-pressed')).toBe('false')

        startRecording(target, 'home')
        expect(chordButton(target, 'home').getAttribute('aria-pressed')).toBe('true')
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(chordButton(target, 'home').getAttribute('aria-pressed')).toBe('false')
    })

    test('on Apple the caps use the command symbol and the Control key is refused', () => {
        const target = show({ apple: true })
        expect(chordButton(target, 'home').textContent).toContain('⌘')
        const button = startRecording(target, 'home')
        press(button, 's', { ctrlKey: true })
        expect(target.querySelector('[data-part="settings-hotkey-recording"]')!.textContent).toBe(language.settingsShellHkMacCtrl)
    })
})

describe('conflicts (A3)', () => {
    test('Swap gives each action the other\'s chord and posts the swapped toast', () => {
        const target = show()
        const button = startRecording(target, 'home')
        press(button, 'p', { ctrlKey: true })
        const block = target.querySelector('[data-part="settings-hotkey-conflict"]')!
        expect(block.textContent).toContain(language.settingsShellHkConflict(language.settingsShellHkActions.presets))
        expect(block.textContent).toContain(language.settingsShellHkSwapOutcome(language.settingsShellHkActions.presets, 'Ctrl+H'))
        target.querySelector<HTMLElement>('[data-hotkey-swap]')!.click()
        flushSync()
        expect(stored('home')).toMatchObject({ key: 'p', ctrl: true })
        expect(stored('presets')).toMatchObject({ key: 'h', ctrl: true })
        expect(toastHost.visible[0].text).toBe(language.settingsShellHkSwapped)
    })

    test('Cancel leaves both rows unchanged', () => {
        const target = show()
        const button = startRecording(target, 'home')
        press(button, 'p', { ctrlKey: true })
        target.querySelector<HTMLElement>('[data-hotkey-cancel]')!.click()
        flushSync()
        expect(stored('home')).toMatchObject({ key: 'h', ctrl: true })
        expect(stored('presets')).toMatchObject({ key: 'p', ctrl: true })
        expect(target.querySelector('[data-part="settings-hotkey-conflict"]')).toBeNull()
    })

    test('a fixed key shows its warning with no swap button', () => {
        const target = show()
        const button = startRecording(target, 'home')
        press(button, '1', { ctrlKey: true })
        const block = target.querySelector('[data-part="settings-hotkey-conflict"]')!
        expect(block.textContent).toContain(language.settingsShellHkFixed('Ctrl+1'))
        expect(target.querySelector('[data-hotkey-swap]')).toBeNull()
        expect(stored('home')).toMatchObject({ key: 'h', ctrl: true })
    })
})

describe('unbound rows (A5)', () => {
    test('guard: an unbound row survives the real merge once and shows Not set', () => {
        freshProfile({ hotkeys: [{ key: '', action: 'home' }] })
        const target = show()
        expect(DBState.db.hotkeys.filter((row) => row.action === 'home')).toHaveLength(1)
        expect(stored('home').key).toBe('')
        expect(rowOf(target, 'home')!.textContent).toContain(language.settingsShellHkUnbound)
    })
})

describe('menu, resets, duplicates and notes (A6, A7, A9)', () => {
    test('Remove unbinds the row and posts the removed toast', () => {
        const target = show()
        target.querySelector<HTMLElement>('[data-hotkey-menu="home"]')!.click()
        flushSync()
        target.querySelector<HTMLElement>('[data-hotkey-menu-clear]')!.click()
        flushSync()
        expect(stored('home').key).toBe('')
        expect(toastHost.visible[0].text).toBe(language.settingsShellHkCleared)
    })

    test('Reset all confirms with the count, restores both rows and posts the done toast', async () => {
        const target = show()
        stored('home').key = 'j'
        stored('presets').key = 'k'
        flushSync()
        target.querySelector<HTMLElement>('[data-hotkey-reset-all]')!.click()
        await settle()
        expect(vi.mocked(alertConfirm).mock.calls[0][0]).toContain(language.settingsShellHkResetAllQ(2))
        expect(stored('home').key).toBe('h')
        expect(stored('presets').key).toBe('p')
        expect(toastHost.visible[0].text).toBe(language.settingsShellHkResetAllDone(2))
    })

    test('Reset all with nothing changed asks nothing and says so', async () => {
        const target = show()
        target.querySelector<HTMLElement>('[data-hotkey-reset-all]')!.click()
        await settle()
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(toastHost.visible[0].text).toBe(language.settingsShellHkResetNone)
    })

    test('duplicates on load show the banner and warn both rows, with nothing fixed', () => {
        freshProfile({ hotkeys: [{ key: 'h', ctrl: true, action: 'presets' }] })
        const target = show()
        expect(target.querySelector('[data-hotkey-dup-banner]')!.textContent).toBe(language.settingsShellHkDupBanner(1))
        expect(rowOf(target, 'home')!.textContent).toContain(language.settingsShellHkAlso(language.settingsShellHkActions.presets))
        expect(rowOf(target, 'presets')!.textContent).toContain(language.settingsShellHkAlso(language.settingsShellHkActions.home))
        expect(stored('home')).toMatchObject({ key: 'h', ctrl: true })
        expect(stored('presets')).toMatchObject({ key: 'h', ctrl: true })
    })

    test('dead actions are hidden and the log row carries the browser note', () => {
        const target = show()
        expect(rowOf(target, 'toggleVoice')).toBeNull()
        expect(rowOf(target, 'webcam')).toBeNull()
        expect(rowOf(target, 'modelSelect')).toBeNull()
        expect(rowOf(target, 'toggleLog')!.textContent).toContain(language.settingsShellHkNoteBrowser)
    })
})

describe('phones (A8)', () => {
    test('at 412 px with no fine pointer the list is read-only until a Ctrl keydown', () => {
        setWidth(412)
        const target = show()
        expect(target.querySelector('[data-part="settings-hotkey-banner"]')!.textContent).toBe(language.settingsShellHkPhone)
        expect(rowOf(target, 'home')!.textContent).toContain('H')
        expect(target.querySelector('[data-part="settings-hotkey-chord"]')).toBeNull()
        expect(target.querySelector('[data-hotkey-reset-all]')).toBeNull()
        expect(target.querySelector('[data-hotkey-menu]')).toBeNull()

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
        flushSync()
        expect(target.querySelector('[data-part="settings-hotkey-chord"]')).not.toBeNull()
    })

    test('a narrow window with a fine pointer is editable', () => {
        setWidth(412)
        ;(window as { matchMedia?: unknown }).matchMedia = () => ({ matches: true })
        const target = show()
        expect(target.querySelector('[data-part="settings-hotkey-chord"]')).not.toBeNull()
    })
})

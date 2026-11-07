/**
 * What Escape does to an open Settings screen when the new Settings shell is, or is not, mounted.
 *
 * Drives the REAL document keydown listener that `initHotkey()` (`hotkey.ts`) registers, with real
 * KeyboardEvents, the real `backCloseHandler` registered the way the shell registers it, and the real
 * `settingsShellBackStep`. The assertions read the Settings stores and what a focused field saw
 * when it was blurred.
 *
 * Invariants pinned here:
 *  - a mounted shell takes Escape through its registered handler: the focused control is blurred
 *    before the step runs, and a phone page goes up to the index instead of closing Settings;
 *  - a shell handler that changes nothing leaves Settings open (the press is not turned into a close);
 *  - with no shell mounted, Escape closes Settings outright as it always did.
 *
 * The last test passes with or without the shell: it pins behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'
import 'src/ts/polyfill'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('./platform'))

vi.mock(import('./stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    alertStore: writable({ type: 'none', msg: '' }),
    loadoutModalStore: { open: false },
    MobileGUI: writable(false),
    MobileGUIStack: writable(0),
    MobileSideBar: writable(0),
    openPersonaList: writable(false),
    openPresetList: writable(false),
    OpenRealmStore: writable(false),
    PlaygroundStore: writable(0),
    QuickSettings: { open: false, index: 0 },
    SafeModeStore: writable(false),
    selectedCharID: writable(-1),
    SettingsMenuIndex: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('./stores.svelte'))

vi.mock(import('./storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('./stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        changeToPreset: vi.fn(),
        getCurrentCharacter: vi.fn(() => ({ name: 'Bob' })),
    } as unknown as typeof import('./storage/database.svelte')
})

vi.mock(import('./gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('./gui/colorscheme'))

vi.mock(import('./characters'), () => ({
    changeChar: vi.fn(),
}) as unknown as typeof import('./characters'))

vi.mock(import('./process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('./process/index.svelte'))

//#endregion

import { backCloseHandler } from './backHandlers'
import { initHotkey } from './hotkey'
import { setShellBackHandler, settingsShellBackStep } from './settingsShell/settingsNavigation'
import { DBState, SettingsMenuIndex, settingsOpen } from './stores.svelte'

//#region helpers

function escapeKey(): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
}

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

/** The handler the shell registers on the Back stack, with an optional replacement for its close step. */
function shellHandler(close: () => void = settingsShellBackStep) {
    return backCloseHandler({
        isOpen: () => get(settingsOpen),
        snapshot: () => `${get(settingsOpen)}|${get(SettingsMenuIndex)}`,
        close,
    })
}

//#endregion

beforeAll(() => {
    initHotkey()
})

beforeEach(() => {
    DBState.db = { botPresets: [], characters: [] } as unknown as Database
    setWidth(412)
})

afterEach(() => {
    setShellBackHandler(null)
    document.body.replaceChildren()
    settingsOpen.set(false)
    SettingsMenuIndex.set(-1)
})

afterAll(() => {
    setShellBackHandler(null)
})

describe('Escape with the Settings shell mounted', () => {
    test('a phone page goes up to the index, still open, after the focused control is blurred', () => {
        setShellBackHandler(shellHandler())
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        // A text field never reaches the Settings branch of the listener; a focused control does.
        const field = document.createElement('button')
        document.body.append(field)
        field.focus()
        const seenAtBlur: string[] = []
        field.addEventListener('blur', () => seenAtBlur.push(`${get(settingsOpen)}|${get(SettingsMenuIndex)}`))

        const ev = escapeKey()
        document.body.dispatchEvent(ev)

        expect(seenAtBlur, 'the blur ran before the step changed anything').toEqual(['true|3'])
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(get(settingsOpen)).toBe(true)
        expect(ev.defaultPrevented).toBe(true)
    })

    test('a wide layout closes Settings through the same step', () => {
        setWidth(1280)
        setShellBackHandler(shellHandler())
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)

        document.body.dispatchEvent(escapeKey())

        expect(get(settingsOpen)).toBe(false)
    })

    test('a handler whose step changes nothing leaves Settings open', () => {
        setShellBackHandler(shellHandler(() => {}))
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)

        document.body.dispatchEvent(escapeKey())

        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(3)
    })
})

describe('Escape without the Settings shell', () => {
    test('guard: Escape closes an open Settings screen outright', () => {
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)

        const ev = escapeKey()
        document.body.dispatchEvent(ev)

        expect(get(settingsOpen)).toBe(false)
        expect(get(SettingsMenuIndex), 'the legacy screen keeps its index').toBe(3)
        expect(ev.defaultPrevented).toBe(true)
    })
})

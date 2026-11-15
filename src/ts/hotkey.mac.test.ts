/**
 * The real document keydown listener on an Apple platform: the command key is the ctrl slot, including while a
 * text field has focus, and the physical Control key is not.
 */
import { get, writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'
import 'src/ts/polyfill'

vi.hoisted(() => {
    Object.defineProperty(globalThis.navigator, 'platform', { value: 'MacIntel', configurable: true })
})

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
    MobileGUIStack: writable(0),
    MobileSideBar: writable(0),
    openPersonaList: writable(false),
    openPresetList: writable(false),
    OpenRealmStore: writable(false),
    PlaygroundStore: writable(0),
    QuickSettings: { open: false, index: 0 },
    SafeModeStore: writable(false),
    selectedCharID: writable(-1),
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

import { initHotkey } from './hotkey'
import { defaultHotkeys } from './defaulthotkeys'
import { DBState, settingsOpen } from './stores.svelte'

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
}

function press(ev: KeyboardEvent): KeyboardEvent {
    ;(document.activeElement ?? document.body).dispatchEvent(ev)
    return ev
}

beforeAll(() => {
    initHotkey()
})

beforeEach(() => {
    DBState.db = { botPresets: [], characters: [], hotkeys: structuredClone(defaultHotkeys) } as unknown as Database
})

afterEach(() => {
    document.body.replaceChildren()
    settingsOpen.set(false)
})

afterAll(() => {
    vi.restoreAllMocks()
})

describe('Apple platform', () => {
    test('Cmd+S in a focused textarea toggles Settings and is consumed', () => {
        const field = document.createElement('textarea')
        document.body.append(field)
        field.focus()
        const ev = press(keydown('s', { metaKey: true }))
        expect(get(settingsOpen)).toBe(true)
        expect(ev.defaultPrevented).toBe(true)
    })

    test('Control+S does not toggle Settings', () => {
        press(keydown('s', { ctrlKey: true }))
        expect(get(settingsOpen)).toBe(false)
    })
})

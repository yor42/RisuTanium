/**
 * `hotkeyMatches` as the document listener uses it. Tests titled `guard:` pass before and after the change; every
 * other test fails on the pre-change engine (Apple matching, empty-key rows, argument mutation).
 */
import { writable } from 'svelte/store'
import { afterAll, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'
import 'src/ts/polyfill'

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

import { hotkeyMatches } from './hotkey'

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
}

afterAll(() => {
    vi.restoreAllMocks()
})

describe('Apple matching', () => {
    const settings = () => ({ key: 's', ctrl: true, action: 'settings' })

    test('Cmd+S matches a ctrl-slot row', () => {
        expect(hotkeyMatches(settings(), keydown('s', { metaKey: true }), true)).toBe(true)
    })

    test('Control+S and Control+Cmd+S match nothing', () => {
        expect(hotkeyMatches(settings(), keydown('s', { ctrlKey: true }), true)).toBe(false)
        expect(hotkeyMatches(settings(), keydown('s', { ctrlKey: true, metaKey: true }), true)).toBe(false)
    })
})

describe('unbound rows', () => {
    test('a row with an empty key never matches an event with an empty key', () => {
        const row = { key: '', ctrl: true, action: 'home' }
        expect(hotkeyMatches(row, keydown('', { ctrlKey: true }), false)).toBe(false)
    })
})

describe('the engine does not write to a row', () => {
    test('a row without alt and shift stays without them', () => {
        const row: { key: string, ctrl: boolean, action: string, alt?: boolean, shift?: boolean } = { key: 's', ctrl: true, action: 'settings' }
        hotkeyMatches(row, keydown('s', { ctrlKey: true }), false)
        expect('alt' in row).toBe(false)
        expect('shift' in row).toBe(false)
    })
})

describe('non-Apple matching', () => {
    const settings = () => ({ key: 's', ctrl: true, action: 'settings' })

    test('guard: Ctrl+S matches, Win+Ctrl+S matches, Ctrl+Shift+S does not', () => {
        expect(hotkeyMatches(settings(), keydown('s', { ctrlKey: true }), false)).toBe(true)
        expect(hotkeyMatches(settings(), keydown('s', { ctrlKey: true, metaKey: true }), false)).toBe(true)
        expect(hotkeyMatches(settings(), keydown('s', { ctrlKey: true, shiftKey: true }), false)).toBe(false)
    })

    test('guard: a no-modifier row does not match while a textarea has focus', () => {
        const field = document.createElement('textarea')
        document.body.append(field)
        field.focus()
        expect(hotkeyMatches({ key: ' ', action: 'focusInput' }, keydown(' '), false)).toBe(false)
        field.remove()
    })
})

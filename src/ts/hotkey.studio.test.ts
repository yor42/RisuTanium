/**
 * What the chat shortcuts do while Studio is open over the kept-mounted chat.
 *
 * Drives the REAL document keydown listener that `initHotkey()` (`hotkey.ts`) registers, with
 * real KeyboardEvents dispatched at the page body and real buttons carrying the class names the
 * shortcuts click. The Studio flag is the real leaf store. The assertions read how often each
 * button or field was reached and `defaultPrevented`.
 *
 * Invariants pinned here:
 *  - while Studio is open, every chat shortcut is still recognised and consumed, but reaches
 *    nothing in the chat;
 *  - a shortcut that is not a chat shortcut (presets) keeps working while Studio is open;
 *  - with both Studio and Settings closed, the same chat keys act once.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
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

//#endregion

import { initHotkey } from './hotkey'
import { DBState, openPresetList, settingsOpen } from './stores.svelte'
import { studioOpen } from './studio/studioOpen'

//#region helpers

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
}

function press(ev: KeyboardEvent): KeyboardEvent {
    document.body.dispatchEvent(ev)
    return ev
}

/** A chat button a shortcut clicks, with a spy on its click. */
function chatButton(className: string): { reached: () => number } {
    const button = document.createElement('button')
    button.className = className
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    document.body.append(button)
    return { reached: () => onClick.mock.calls.length }
}

/** The composer field the focusInput shortcut focuses, with a spy on its focus. */
function composerField(): { reached: () => number } {
    const field = document.createElement('textarea')
    field.className = 'text-input-area'
    const onFocus = vi.spyOn(field, 'focus')
    document.body.append(field)
    return { reached: () => onFocus.mock.calls.length }
}

interface ChatShortcut {
    action: string
    make: () => KeyboardEvent
    target: () => { reached: () => number }
}

const CHAT_SHORTCUTS: ChatShortcut[] = [
    { action: 'send', make: () => keydown('Enter', { ctrlKey: true, altKey: true }), target: () => chatButton('button-icon-send') },
    { action: 'reroll', make: () => keydown('r', { ctrlKey: true, altKey: true }), target: () => chatButton('button-icon-reroll') },
    { action: 'unreroll', make: () => keydown('f', { ctrlKey: true, altKey: true }), target: () => chatButton('button-icon-unreroll') },
    { action: 'remove', make: () => keydown('d', { ctrlKey: true, altKey: true }), target: () => chatButton('button-icon-remove') },
    { action: 'edit', make: () => keydown('e', { ctrlKey: true, altKey: true }), target: () => chatButton('button-icon-edit') },
    { action: 'copy', make: () => keydown('c', { ctrlKey: true, altKey: true }), target: () => chatButton('button-icon-copy') },
    { action: 'translate', make: () => keydown('t', { ctrlKey: true, altKey: true }), target: () => chatButton('button-icon-translate') },
    { action: 'focusInput', make: () => keydown(' '), target: composerField },
]

beforeAll(() => {
    initHotkey()
})

beforeEach(() => {
    DBState.db = { botPresets: [], characters: [] } as unknown as Database
})

afterEach(() => {
    document.body.replaceChildren()
    settingsOpen.set(false)
    studioOpen.set(false)
    openPresetList.set(false)
})

afterAll(() => {
    vi.restoreAllMocks()
})

//#endregion

describe('chat shortcuts while Studio is open', () => {
    test.each(CHAT_SHORTCUTS)('$action is consumed and reaches nothing in the chat', ({ make, target }) => {
        const reached = target()
        studioOpen.set(true)
        const ev = press(make())
        expect(reached.reached()).toBe(0)
        expect(ev.defaultPrevented).toBe(true)
    })

    test('guard: a shortcut that is not a chat shortcut still works while Studio is open', () => {
        studioOpen.set(true)
        press(keydown('p', { ctrlKey: true }))
        expect(get(openPresetList)).toBe(true)
    })
})

describe('chat shortcuts with Studio and Settings closed', () => {
    test.each(CHAT_SHORTCUTS)('guard: $action acts once and is consumed', ({ make, target }) => {
        const reached = target()
        const ev = press(make())
        expect(reached.reached()).toBe(1)
        expect(ev.defaultPrevented).toBe(true)
    })
})

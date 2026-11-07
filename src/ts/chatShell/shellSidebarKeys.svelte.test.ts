// @vitest-environment happy-dom

/**
 * `shellSidebarKeys.ts`: Alt+Up / Alt+Down move to the neighbouring chat in the listed order.
 *
 * Invariants exercised here:
 * - The key opens the neighbour through `openChatOf` of the character selected at event time, and
 *   follows the sort this device chose.
 * - It does nothing while typing (text field or select), with a registered shell open, with an alert
 *   other than a toast, for a consumed or blocked key event, or with extra modifiers.
 * - Ctrl+K (Cmd+K) opens the sidebar and, once it has drawn, focuses the search field; it is inert from a text field or select,
 *   with a registered shell open, with an alert other than a toast, for a consumed or blocked key event and with Alt or Shift.
 * - Teardown removes the listener.
 *
 * MOCKED: the stores module (selection mirror, alert store, the sidebar's open flags) and `changeChatTo` (writes the selected
 * slot like the real one). Everything else is real.
 */
import { flushSync, tick } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database } from '../storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        sideBarStore: writable(false),
        sideBarClosing: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

const changeChatToMock = vi.hoisted(() => vi.fn())
// When set, openChatOf answers with it instead of opening: the outcomes the key handler cannot reach by itself.
const forcedOutcome = vi.hoisted(() => ({ value: null as null | 'not-selected' | 'missing' }))

vi.mock('./chatOpen', async (original) => {
    const actual = await original<typeof import('./chatOpen')>()
    return {
        ...actual,
        openChatOf: (...args: Parameters<typeof actual.openChatOf>) => forcedOutcome.value ?? actual.openChatOf(...args),
    }
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { DBState, selIdState } = await import('src/ts/stores.svelte')
    return {
        changeChatTo: (i: number) => {
            changeChatToMock(i)
            DBState.db.characters[selIdState.selId].chatPage = i
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

// The pending-switch state is real; what it imports for switching and alerting is not needed here.
const supersedeMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => 'selected'),
    supersedeChangeChar: supersedeMock,
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

import { DBState, alertStore, selectedCharID, selIdState, sideBarClosing, sideBarStore } from 'src/ts/stores.svelte'
import { recordKeyEventBlocked } from '../keyEventBlocked'
import { registerShell } from '../../lib/Nexus/pattern/patternFocus'
import { clearPending, switchTarget } from './switchTarget.svelte'
import { installShellSidebarKeys } from './shellSidebarKeys'

type Entry = Database['characters'][number]

function chat(name: string, time: number): Chat {
    return { id: `id-${name}`, name, message: [{ role: 'char', data: name, time }], note: '', localLore: [], fmIndex: -1 } as unknown as Chat
}

function owner(chaId: string, chats: Chat[], chatPage = 0): Entry {
    return { type: 'character', chaId, name: chaId, chats, chatPage, chatFolders: [] } as unknown as Entry
}

function install(characters: Entry[]): Entry[] {
    DBState.db = { characters } as unknown as Database
    return DBState.db.characters
}

function press(key: 'ArrowUp' | 'ArrowDown', init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
}

let teardown: (() => void) | undefined

beforeEach(() => {
    changeChatToMock.mockReset()
    supersedeMock.mockReset()
    forcedOutcome.value = null
    localStorage.clear()
    alertStore.set({ type: 'none', msg: '' })
    sideBarStore.set(false)
    sideBarClosing.set(false)
    selectedCharID.set(-1)
    clearPending()
    teardown = installShellSidebarKeys()
})

afterEach(() => {
    clearPending()
    teardown?.()
    teardown = undefined
    document.body.innerHTML = ''
})

describe('Alt+Up / Alt+Down', () => {
    test('diagnostic: the selection mirror follows the store', () => {
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })

    test('Alt+Down opens the next chat in My order, Alt+Up the previous one; the key is consumed', () => {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        const [a] = install([owner('a', [chat('one', 1), chat('two', 2), chat('three', 3)], 1)])
        selectedCharID.set(0)

        const down = press('ArrowDown')
        expect(a.chatPage).toBe(2)
        expect(changeChatToMock).toHaveBeenCalledTimes(1)
        expect(down.defaultPrevented).toBe(true)

        press('ArrowUp')
        press('ArrowUp')
        expect(a.chatPage).toBe(0)
    })

    test('in Recent order the neighbour is the next older chat', () => {
        const [a] = install([owner('a', [chat('old', 1), chat('new', 9), chat('mid', 5)], 1)])
        selectedCharID.set(0)
        press('ArrowDown')
        expect(a.chats[a.chatPage].name).toBe('mid')
    })

    test('at the end of the list nothing happens and the key is left alone', () => {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        install([owner('a', [chat('one', 1), chat('two', 2)], 1)])
        selectedCharID.set(0)
        const event = press('ArrowDown')
        expect(changeChatToMock).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
    })

    test('the character is resolved at event time, after a selection change with no flush', () => {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        const [a, b] = install([
            owner('a', [chat('a1', 1), chat('a2', 2), chat('a3', 3)], 0),
            owner('b', [chat('b1', 1), chat('b2', 2)], 0),
        ])
        selectedCharID.set(0)
        selectedCharID.set(1)
        press('ArrowDown')
        flushSync()
        expect(changeChatToMock).toHaveBeenCalledWith(1)
        expect(b.chatPage).toBe(1)
        expect(a.chatPage).toBe(0)
    })

    test('with no selected character nothing happens', () => {
        install([owner('a', [chat('one', 1), chat('two', 2)])])
        press('ArrowDown')
        expect(changeChatToMock).not.toHaveBeenCalled()
    })
})

describe.each(['failed', 'loading'] as const)('a pending switch in phase %s', (phase) => {
    function ready(chatPage: number): Entry {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        const [a, b] = install([
            owner('a', [chat('one', 1), chat('two', 2), chat('three', 3)], chatPage),
            owner('b', [chat('b1', 1)]),
        ])
        selectedCharID.set(0)
        // The state a running switch leaves; the restore still running is covered with the real changeChar in characters.quietSwitch.
        switchTarget.target = b
        switchTarget.phase = phase
        return a
    }

    test('Alt+Down opens the neighbouring chat of the selected character and abandons the pending switch', () => {
        const a = ready(0)
        press('ArrowDown')
        expect(a.chatPage).toBe(1)
        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
        expect(supersedeMock).toHaveBeenCalledTimes(1)
    })

    test('Alt+Up opens the neighbouring chat of the selected character and abandons the pending switch', () => {
        const a = ready(2)
        press('ArrowUp')
        expect(a.chatPage).toBe(1)
        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
        expect(supersedeMock).toHaveBeenCalledTimes(1)
    })

    // Compatibility guard: an open that did not happen leaves the switch to its own endings.
    test.each(['not-selected', 'missing'] as const)('an open refused as %s keeps the pending switch', (outcome) => {
        const a = ready(0)
        forcedOutcome.value = outcome
        press('ArrowDown')
        expect(a.chatPage).toBe(0)
        expect(switchTarget.phase).toBe(phase)
        expect(switchTarget.target).not.toBeNull()
        expect(supersedeMock).not.toHaveBeenCalled()
    })

    // Compatibility guard: a key that opens nothing leaves the switch to its own endings.
    test('at the end of the list nothing opens and the pending switch stays', () => {
        const a = ready(2)
        press('ArrowDown')
        expect(a.chatPage).toBe(2)
        expect(changeChatToMock).not.toHaveBeenCalled()
        expect(switchTarget.phase).toBe(phase)
        expect(switchTarget.target).not.toBeNull()
        expect(supersedeMock).not.toHaveBeenCalled()
    })
})

describe('TC6 guards', () => {
    function ready(): Entry {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        const [a] = install([owner('a', [chat('one', 1), chat('two', 2), chat('three', 3)], 0)])
        selectedCharID.set(0)
        return a
    }

    test('typing in a textarea is left alone', () => {
        ready()
        const area = document.createElement('textarea')
        document.body.append(area)
        area.focus()
        press('ArrowDown', {}, area)
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('a text input is left alone, a checkbox is not', () => {
        ready()
        const input = document.createElement('input')
        input.type = 'text'
        document.body.append(input)
        input.focus()
        press('ArrowDown', {}, input)
        expect(changeChatToMock).not.toHaveBeenCalled()

        const box = document.createElement('input')
        box.type = 'checkbox'
        document.body.append(box)
        box.focus()
        press('ArrowDown', {}, box)
        expect(changeChatToMock).toHaveBeenCalledTimes(1)
    })

    test('a select keeps the arrow keys', () => {
        ready()
        const select = document.createElement('select')
        select.innerHTML = '<option>a</option><option>b</option>'
        document.body.append(select)
        select.focus()
        press('ArrowDown', {}, select)
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('a content-editable area keeps the arrow keys', () => {
        ready()
        const div = document.createElement('div')
        div.contentEditable = 'true'
        Object.defineProperty(div, 'isContentEditable', { value: true })
        document.body.append(div)
        press('ArrowDown', {}, div)
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('an open registered shell takes the keys', () => {
        ready()
        const unregister = registerShell({})
        try {
            press('ArrowDown')
            expect(changeChatToMock).not.toHaveBeenCalled()
        } finally {
            unregister()
        }
        press('ArrowDown')
        expect(changeChatToMock).toHaveBeenCalledTimes(1)
    })

    test("an alert other than 'none' or a toast takes the keys", () => {
        ready()
        alertStore.set({ type: 'ask', msg: 'x' })
        press('ArrowDown')
        expect(changeChatToMock).not.toHaveBeenCalled()
        alertStore.set({ type: 'toast', msg: 'x' })
        press('ArrowDown')
        expect(changeChatToMock).toHaveBeenCalledTimes(1)
    })

    test('a key event another handler consumed is left alone', () => {
        ready()
        const early = (event: Event) => event.preventDefault()
        document.addEventListener('keydown', early)
        try {
            press('ArrowDown', {}, document.body)
        } finally {
            document.removeEventListener('keydown', early)
        }
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('a key event recorded as blocked is left alone', () => {
        ready()
        const guard = (event: Event) => recordKeyEventBlocked(event as KeyboardEvent, true)
        window.addEventListener('keydown', guard, true)
        try {
            press('ArrowDown')
        } finally {
            window.removeEventListener('keydown', guard, true)
        }
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('extra modifiers and other keys are ignored', () => {
        ready()
        press('ArrowDown', { shiftKey: true })
        press('ArrowDown', { ctrlKey: true })
        press('ArrowDown', { metaKey: true })
        press('ArrowDown', { altKey: false })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }))
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('after teardown the key does nothing', () => {
        ready()
        teardown?.()
        teardown = undefined
        press('ArrowDown')
        expect(changeChatToMock).not.toHaveBeenCalled()
    })
})

describe('Ctrl+K', () => {
    function search(): HTMLInputElement {
        const input = document.createElement('input')
        input.dataset.part = 'chat-sidebar-search-field'
        input.type = 'text'
        document.body.append(input)
        return input
    }

    function ctrlK(init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(event)
        return event
    }

    test('diagnostic: the sidebar flags are writable stores starting closed', () => {
        expect(get(sideBarStore)).toBe(false)
        sideBarStore.set(true)
        expect(get(sideBarStore)).toBe(true)
    })

    // The width never reaches the module, so these are the same case run at three window widths; the per-layout evidence is a PC-lane claim.
    test.each([360, 960, 1280])('TS4: Ctrl+K with the window %i px wide opens the closed sidebar and focuses the field after the next tick', async (width) => {
        vi.stubGlobal('innerWidth', width)
        const field = search()
        sideBarClosing.set(true)
        const event = ctrlK()
        expect(event.defaultPrevented).toBe(true)
        expect(get(sideBarStore)).toBe(true)
        expect(get(sideBarClosing)).toBe(false)
        // The field only exists once the panel has drawn, so the focus waits a tick.
        expect(document.activeElement).not.toBe(field)
        await tick()
        expect(document.activeElement).toBe(field)
        vi.unstubAllGlobals()
    })

    test('TS4: Cmd+K does the same, and a non-Latin layout is found by the physical key', async () => {
        const field = search()
        ctrlK({ ctrlKey: false, metaKey: true })
        await tick()
        expect(get(sideBarStore)).toBe(true)
        expect(document.activeElement).toBe(field)

        sideBarStore.set(false)
        field.blur()
        const hangul = ctrlK({ key: 'ㅏ', code: 'KeyK' })
        await tick()
        expect(hangul.defaultPrevented).toBe(true)
        expect(get(sideBarStore)).toBe(true)
        expect(document.activeElement).toBe(field)
    })

    test('TS4: a Latin key on the K position (another layout) is not Ctrl+K', () => {
        search()
        const event = ctrlK({ key: 'x', code: 'KeyK' })
        expect(event.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test.each([
        ['Alt', { altKey: true }],
        ['Shift', { shiftKey: true }],
        ['no Ctrl or Cmd', { ctrlKey: false }],
        ['another key', { key: 'j' }],
    ] as const)('TS4: %s makes it inert', (_name, init) => {
        search()
        const event = ctrlK(init)
        expect(event.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test.each(['textarea', 'select'] as const)('TS4: a %s keeps Ctrl+K', (tag) => {
        search()
        const control = document.createElement(tag)
        document.body.append(control)
        control.focus()
        const event = ctrlK({}, control)
        expect(event.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test('TS4: a text input keeps Ctrl+K, the search field included', () => {
        const field = search()
        field.focus()
        const event = ctrlK({}, field)
        expect(event.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test('TS4: an open registered shell takes the key', () => {
        search()
        const unregister = registerShell({})
        try {
            ctrlK()
            expect(get(sideBarStore)).toBe(false)
        } finally {
            unregister()
        }
        ctrlK()
        expect(get(sideBarStore)).toBe(true)
    })

    test("TS4: an alert other than 'none' or a toast takes the key", () => {
        search()
        alertStore.set({ type: 'ask', msg: 'x' })
        ctrlK()
        expect(get(sideBarStore)).toBe(false)
        alertStore.set({ type: 'toast', msg: 'x' })
        ctrlK()
        expect(get(sideBarStore)).toBe(true)
    })

    test('TS4: a key event another handler consumed, or recorded as blocked, is left alone', () => {
        search()
        const early = (event: Event) => event.preventDefault()
        document.addEventListener('keydown', early)
        try {
            ctrlK({}, document.body)
        } finally {
            document.removeEventListener('keydown', early)
        }
        expect(get(sideBarStore)).toBe(false)

        const guard = (event: Event) => recordKeyEventBlocked(event as KeyboardEvent, true)
        window.addEventListener('keydown', guard, true)
        try {
            ctrlK()
        } finally {
            window.removeEventListener('keydown', guard, true)
        }
        expect(get(sideBarStore)).toBe(false)
    })

    test('TS4: after teardown Ctrl+K does nothing', () => {
        search()
        teardown?.()
        teardown = undefined
        ctrlK()
        expect(get(sideBarStore)).toBe(false)
    })
})

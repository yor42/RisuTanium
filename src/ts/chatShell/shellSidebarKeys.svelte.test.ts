// @vitest-environment happy-dom

/**
 * `shellSidebarKeys.ts`: Alt+Up / Alt+Down move to the neighbouring chat in the listed order.
 *
 * Invariants exercised here:
 * - The key opens the neighbour through `openChatOf` of the character selected at event time, and
 *   follows the sort this device chose.
 * - It does nothing while typing (text field or select), with a registered shell open, with an alert
 *   other than a toast, for a consumed or blocked key event, or with extra modifiers.
 * - Teardown removes the listener.
 *
 * MOCKED: the stores module (selection mirror, alert store) and `changeChatTo` (writes the selected
 * slot like the real one). Everything else is real.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
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
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

const changeChatToMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { DBState, selIdState } = await import('src/ts/stores.svelte')
    return {
        changeChatTo: (i: number) => {
            changeChatToMock(i)
            DBState.db.characters[selIdState.selId].chatPage = i
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

import { DBState, alertStore, selectedCharID, selIdState } from 'src/ts/stores.svelte'
import { recordKeyEventBlocked } from '../keyEventBlocked'
import { registerShell } from '../../lib/Nexus/pattern/patternFocus'
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
    localStorage.clear()
    alertStore.set({ type: 'none', msg: '' })
    selectedCharID.set(-1)
    teardown = installShellSidebarKeys()
})

afterEach(() => {
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

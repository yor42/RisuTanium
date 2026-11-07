// @vitest-environment happy-dom

/**
 * The search of `ShellSidebar.svelte` (`ShellSidebarSearch.svelte`): typing, results, opening and leaving.
 *
 * Invariants exercised here:
 * - Typed text reaches the results after a 150 ms pause; Enter acts on the text typed now, opens the first result (a character
 *   before a chat) and ignores the Enter that confirms an IME composition.
 * - The results replace the chat list and Edit order: typing ends the mode, results keep it off, and it does not come back.
 * - Chats open only through the sidebar's row path (so a pending switch is abandoned) and characters through the strip's path.
 * - Escape clears the text; an empty field leaves Escape to the panel in the overlay and hands the focus to the transcript when
 *   docked; Back clears the text. A consumed Escape does nothing.
 * - Arrow keys rove the result rows, skipping the group labels; Enter on a row opens that row.
 * - A selection change empties the field and nothing typed before it lands later.
 *
 * MOCKED: the stores module, `characters` (spies), `changeChatTo`, the alert module and the reply flag. The timers are fake.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database } from '../../../ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const mocks = vi.hoisted(() => ({
    changeChat: vi.fn(),
    changeChar: vi.fn(),
    supersede: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable(true),
        settingsOpen: writable(false),
        PlaygroundStore: writable(0),
        OpenRealmStore: writable(false),
        bookmarkListOpen: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        additionalHamburgerMenu: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { DBState, selIdState } = await import('src/ts/stores.svelte')
    return {
        changeChatTo: (i: number) => {
            mocks.changeChat(i)
            DBState.db.characters[selIdState.selId].chatPage = i
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null),
    changeChar: mocks.changeChar,
    supersedeChangeChar: mocks.supersede,
    exportAllChats: vi.fn(),
    importChat: vi.fn(),
    createNewChat: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, DynamicGUI, selectedCharID, sideBarClosing, sideBarStore } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { dispatchBack, registerBackHandler, resetBackHandlersForTests } from '../../../ts/backHandlers'
import { MAX_MOUNTED_ROWS } from '../../../ts/chatShell/chatListModel'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import { clearPending, switchTarget } from '../../../ts/chatShell/switchTarget.svelte'
import ShellSidebar from './ShellSidebar.svelte'

type Entry = Database['characters'][number]

function chat(name: string, time = 5, extra: Partial<Chat> = {}): Chat {
    return { id: `id-${name}`, name, message: [{ role: 'char', data: name, time }], note: '', localLore: [], fmIndex: -1, ...extra } as unknown as Chat
}

function character(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats, chatPage: 0, chatFolders: [], lastInteraction: 0, ...extra } as unknown as Entry
}

let mounted: Array<Record<string, unknown>> = []
let target: HTMLElement
let closes: number
let standIn: (event: KeyboardEvent) => void

function install(...characters: Entry[]): Entry[] {
    DBState.db = { characters, enableDevTools: false } as unknown as Database
    return DBState.db.characters
}

function render(sort: 'manual' | 'recent' = 'manual') {
    localStorage.setItem('risuChatShell.chatSort', sort)
    target = document.createElement('div')
    document.body.append(target)
    mounted.push(mount(ShellSidebar, { target, props: { openGrid: vi.fn(), reseter: vi.fn() } }) as Record<string, unknown>)
    flushSync()
}

function field(): HTMLInputElement {
    const found = target.querySelector<HTMLInputElement>('[data-part="chat-sidebar-search-field"]')
    if (!found) {
        throw new Error('search field not found')
    }
    return found
}

function typeText(text: string) {
    const input = field()
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function land() {
    vi.advanceTimersByTime(150)
    flushSync()
}

function press(on: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    on.dispatchEvent(event)
    flushSync()
    return event
}

function resultRows(): HTMLElement[] {
    return Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-search-character"], [data-part="chat-search-chat"]'))
}

function resultNames(): string[] {
    return resultRows().map((r) => r.querySelector('span')?.textContent ?? '')
}

function resultRow(index: number): HTMLElement {
    const found = target.querySelector<HTMLElement>(`[data-part^="chat-search-"][data-index="${index}"]`)
    if (!found) {
        throw new Error(`result row not found at ${index}`)
    }
    return found
}

function status(): string {
    return target.querySelector('[data-part="chat-search-status"]')?.textContent?.trim() ?? ''
}

function maybeToggle(): HTMLButtonElement | null {
    return target.querySelector<HTMLButtonElement>('[data-part="sidebar-edit-order"]')
}

function listShown(): boolean {
    return target.querySelector('[data-part="chat-sidebar-list"]') !== null
}

beforeEach(() => {
    mocks.changeChat.mockReset()
    mocks.changeChar.mockReset()
    mocks.supersede.mockReset()
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    closes = 0
    standIn = (event) => {
        if (event.key !== 'Escape') {
            return
        }
        if (!event.defaultPrevented) {
            closes++
        }
        event.preventDefault()
    }
    window.addEventListener('keydown', standIn)
    DynamicGUI.set(true)
    sideBarClosing.set(false)
    sideBarStore.set(true)
    selectedCharID.set(-1)
    resetBackHandlersForTests()
    clearPending()
    takeOverlayReturnFocus()
})

afterEach(() => {
    window.removeEventListener('keydown', standIn)
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    target?.remove()
    document.body.innerHTML = ''
    vi.useRealTimers()
    localStorage.clear()
})

// A (selected, two chats whose names start with the jamo query), a Hangul-named character and a plain one.
function hangulFixture(): Entry[] {
    return install(
        character('a', [chat('Plain talk'), chat('하고 놀기')], { name: 'Alice' }),
        character('b', [chat('b chat')], { name: '한국' }),
        character('c', [chat('c chat')], { name: 'Zed' }),
    )
}

describe('results', () => {
    test('diagnostic: the selection mirror follows the store', async () => {
        const { selIdState } = await import('src/ts/stores.svelte')
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })

    test('TS2: the field lists the results of a jamo query once typing has paused for 150 ms, not before', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        expect(field()).not.toBeNull()
        typeText('ㅎㄱ')
        vi.advanceTimersByTime(100)
        flushSync()
        expect(resultRows()).toHaveLength(0)
        expect(listShown()).toBe(true)
        vi.advanceTimersByTime(50)
        flushSync()
        expect(resultNames()).toEqual(['한국', '하고 놀기'])
        // The results replace the chat list.
        expect(listShown()).toBe(false)
    })

    test('TS2b: the groups are labelled, the count is announced, an empty result says so', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('ㅎㄱ')
        land()
        const labels = Array.from(target.querySelectorAll('[data-part="chat-search-group"]')).map((l) => l.textContent)
        expect(labels).toEqual([language.chatShellSearchCharacters, language.chatShellSearchThisCharacterChats])
        const region = target.querySelector('[data-part="chat-search-status"]')
        expect(region?.getAttribute('role')).toBe('status')
        expect(region?.getAttribute('aria-live')).toBe('polite')
        expect(status()).toBe(language.chatShellResultsCount(2))
        // Labels are never focus targets or result rows.
        for (const label of Array.from(target.querySelectorAll('[data-part="chat-search-group"]'))) {
            expect(label.hasAttribute('tabindex')).toBe(false)
            expect(label.hasAttribute('data-index')).toBe(false)
        }
        const rows = resultRows()
        expect(rows.map((r) => r.getAttribute('aria-posinset'))).toEqual(['1', '2'])
        expect(rows.map((r) => r.getAttribute('aria-setsize'))).toEqual(['2', '2'])

        typeText('qqqq')
        land()
        expect(status()).toBe(language.chatShellNoResults)
        expect(resultRows()).toHaveLength(0)
    })

    test('TS2b: a capped result says how many are shown of how many, and at most 40 rows are mounted', () => {
        const many = Array.from({ length: 60 }, (_, i) => chat(`Match ${i}`))
        install(character('a', many))
        selectedCharID.set(0)
        render()
        typeText('match')
        land()
        expect(status()).toBe(language.chatShellResultsShown(50, 60))
        expect(resultRows().length).toBeGreaterThan(0)
        expect(resultRows().length).toBeLessThanOrEqual(MAX_MOUNTED_ROWS)
    })

    test('TS8: a chat created while results show appears in them without typing again', () => {
        const [a] = install(character('a', [chat('Match one'), chat('Other')]))
        selectedCharID.set(0)
        render()
        typeText('match')
        land()
        expect(resultNames()).toEqual(['Match one'])
        a.chats.unshift(chat('Match fresh'))
        flushSync()
        expect(resultNames()).toEqual(['Match fresh', 'Match one'])
    })
})

describe('opening', () => {
    test('TS2b: Enter opens the first result, the character before a chat, inside the typing pause', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('ㅎㄱ')
        press(field(), 'Enter')
        expect(mocks.changeChar).toHaveBeenCalledTimes(1)
        expect(mocks.changeChar).toHaveBeenCalledWith(1, { quiet: true })
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    test('TS2b: with no character found Enter opens the first chat once, and a pending switch is abandoned after it opened', () => {
        const [a, b] = hangulFixture()
        selectedCharID.set(0)
        render()
        switchTarget.target = b
        switchTarget.phase = 'failed'
        flushSync()
        typeText('talk')
        press(field(), 'Enter')
        expect(mocks.changeChat).toHaveBeenCalledTimes(1)
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
        expect(a.chatPage).toBe(0)
        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
        expect(mocks.supersede).toHaveBeenCalledTimes(1)
    })

    test('TS2b: Enter in the overlay names where the focus goes afterwards', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('talk')
        press(field(), 'Enter')
        expect(takeOverlayReturnFocus()).not.toBeNull()
    })

    test.each([
        ['isComposing', { isComposing: true }],
        ['keyCode 229', { keyCode: 229 }],
    ] as const)('TS3: the Enter that confirms an IME composition (%s) opens nothing', (_name, init) => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('ㅎㄱ')
        press(field(), 'Enter', init)
        expect(mocks.changeChar).not.toHaveBeenCalled()
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    test('TS3b: Enter acts on the text typed now, not on the results that landed before', () => {
        install(
            character('a', [], { name: 'Alice' }),
            character('b', [], { name: 'Bob' }),
        )
        selectedCharID.set(0)
        render()
        typeText('Al')
        land()
        expect(resultNames()).toEqual(['Alice'])
        typeText('Bo')
        vi.advanceTimersByTime(50)
        flushSync()
        press(field(), 'Enter')
        expect(mocks.changeChar).toHaveBeenCalledTimes(1)
        expect(mocks.changeChar).toHaveBeenCalledWith(1, { quiet: true })
    })
})

describe('leaving', () => {
    test('TS3: Escape with text clears it and consumes the key; the panel stays open', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('ㅎㄱ')
        land()
        const event = press(field(), 'Escape')
        expect(event.defaultPrevented).toBe(true)
        expect(field().value).toBe('')
        expect(resultRows()).toHaveLength(0)
        expect(listShown()).toBe(true)
        expect(closes).toBe(0)
    })

    test('TS3: Escape in an empty field is left to the panel in the overlay', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        press(field(), 'Escape')
        expect(closes).toBe(1)
    })

    test('TS3: Escape in an empty field, docked, hands the focus to the transcript and keeps the panel', () => {
        DynamicGUI.set(false)
        const main = document.createElement('main')
        main.dataset.part = 'chat-transcript'
        main.tabIndex = -1
        document.body.append(main)
        hangulFixture()
        selectedCharID.set(0)
        render()
        field().focus()
        const event = press(field(), 'Escape')
        expect(document.activeElement).toBe(main)
        expect(event.defaultPrevented).toBe(true)
        expect(closes).toBe(0)
    })

    test('TS3: an Escape another handler already consumed neither clears the text nor moves the focus', () => {
        DynamicGUI.set(false)
        const main = document.createElement('main')
        main.dataset.part = 'chat-transcript'
        main.tabIndex = -1
        document.body.append(main)
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('ㅎㄱ')
        land()
        field().focus()
        const early = (event: Event) => event.preventDefault()
        document.addEventListener('keydown', early, true)
        try {
            press(field(), 'Escape')
            expect(field().value).toBe('ㅎㄱ')
            expect(resultRows().length).toBeGreaterThan(0)
            typeText('')
            field().focus()
            press(field(), 'Escape')
            expect(document.activeElement).toBe(field())
        } finally {
            document.removeEventListener('keydown', early, true)
        }
    })

    test('TS3: Back clears a typed text and is not handled with an empty field', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        expect(dispatchBack()).toBe(false)
        typeText('ㅎㄱ')
        land()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(field().value).toBe('')
        expect(resultRows()).toHaveLength(0)
        expect(dispatchBack()).toBe(false)
    })

    test('TS3: in the overlay the first Back clears the text and only the second closes the panel', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        // The overlay panel registers its Back hook once at mount, after the sidebar's own mount effects.
        registerBackHandler(() => {
            if (!get(sideBarStore) || get(sideBarClosing)) {
                return false
            }
            sideBarClosing.set(true)
            return true
        })
        typeText('ㅎㄱ')
        land()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(field().value).toBe('')
        expect(get(sideBarClosing)).toBe(false)
        expect(dispatchBack()).toBe(true)
        expect(get(sideBarClosing)).toBe(true)
    })

    test('with the overlay closed a text left in the field does not take the Back press', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('ㅎㄱ')
        land()
        sideBarStore.set(false)
        flushSync()
        expect(dispatchBack()).toBe(false)
        expect(field().value).toBe('ㅎㄱ')
        // Reopening shows the text again and the first Back clears it.
        sideBarStore.set(true)
        flushSync()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(field().value).toBe('')
    })

    test('opening a chat of the selected character closes the overlay and leaves the Back press to the chat', () => {
        const characters = hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('ㅎㄱ')
        land()
        const row = resultRows().find((r) => r.getAttribute('data-part') === 'chat-search-chat')
        expect(row).toBeDefined()
        row!.click()
        flushSync()
        expect(characters[0].chatPage).toBe(1)
        // The panel closes after the pick; the text stays in the hidden field.
        sideBarClosing.set(false)
        sideBarStore.set(false)
        flushSync()
        expect(field().value).toBe('ㅎㄱ')
        expect(dispatchBack()).toBe(false)
        expect(field().value).toBe('ㅎㄱ')
    })

    test('the search field and the result list carry the placeholder as their name', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        expect(field().getAttribute('placeholder')).toBe(language.chatShellSearchPlaceholder)
        expect(field().getAttribute('aria-label')).toBe(language.chatShellSearchPlaceholder)
        typeText('ㅎㄱ')
        land()
        expect(target.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(language.chatShellSearchPlaceholder)
    })

    test('TS3: the results wait for the pause and an emptied field applies at once', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('ㅎㄱ')
        land()
        expect(resultRows()).toHaveLength(2)
        typeText('')
        expect(resultRows()).toHaveLength(0)
        expect(listShown()).toBe(true)
    })
})

describe('Edit order', () => {
    test('TS2b: typing leaves Edit order at once, and the mode does not come back with the empty field', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        maybeToggle()!.click()
        flushSync()
        expect(maybeToggle()!.getAttribute('aria-pressed')).toBe('true')
        typeText('t')
        expect(maybeToggle()!.getAttribute('aria-pressed')).toBe('false')
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
        land()
        expect(maybeToggle()).toBeNull()
        typeText('')
        expect(maybeToggle()!.getAttribute('aria-pressed')).toBe('false')
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
    })

    test('TS2b: Edit order entered inside the typing pause ends when the results land, and stays off after the field is emptied', () => {
        hangulFixture()
        selectedCharID.set(0)
        render()
        typeText('t')
        expect(resultRows()).toHaveLength(0)
        maybeToggle()!.click()
        flushSync()
        expect(maybeToggle()!.getAttribute('aria-pressed')).toBe('true')
        expect(target.querySelectorAll('[data-part="chat-drag-handle"]').length).toBeGreaterThan(0)
        land()
        expect(resultRows().length).toBeGreaterThan(0)
        expect(maybeToggle()).toBeNull()
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
        typeText('')
        expect(maybeToggle()!.getAttribute('aria-pressed')).toBe('false')
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
    })
})

describe('roving', () => {
    function rovingFixture() {
        return install(
            character('a', [chat('Match one'), chat('Match two'), chat('Match three')], { name: 'Match A' }),
            character('b', [], { name: 'Match B' }),
            character('c', [], { name: 'Match C' }),
        )
    }

    // Rows: 0 label, 1-3 characters, 4 label, 5-7 chats.
    test('TS5: arrows rove the result rows past the labels, Home and End jump, and Up from the first row returns to the field', () => {
        rovingFixture()
        selectedCharID.set(0)
        render()
        typeText('match')
        land()
        field().focus()
        press(field(), 'ArrowDown')
        expect(document.activeElement).toBe(resultRow(1))
        press(resultRow(1), 'ArrowDown')
        press(resultRow(2), 'ArrowDown')
        expect(document.activeElement).toBe(resultRow(3))
        press(resultRow(3), 'ArrowDown')
        expect(document.activeElement).toBe(resultRow(5))
        press(resultRow(5), 'End')
        expect(document.activeElement).toBe(resultRow(7))
        press(resultRow(7), 'Home')
        expect(document.activeElement).toBe(resultRow(1))
        press(resultRow(5), 'ArrowUp')
        expect(document.activeElement).toBe(resultRow(3))
        press(resultRow(1), 'ArrowUp')
        expect(document.activeElement).toBe(field())
    })

    test('TS5: exactly one result row is tabbable', () => {
        rovingFixture()
        selectedCharID.set(0)
        render()
        typeText('match')
        land()
        const tabbable = resultRows().filter((r) => r.getAttribute('tabindex') === '0')
        expect(tabbable).toHaveLength(1)
        expect(tabbable[0]).toBe(resultRow(1))
    })

    test('TS5: Enter on a row opens that row, not the first result', () => {
        rovingFixture()
        selectedCharID.set(0)
        render()
        typeText('match')
        land()
        press(resultRow(6), 'Enter')
        expect(mocks.changeChat).toHaveBeenCalledTimes(1)
        expect(mocks.changeChat).toHaveBeenCalledWith(1)
        expect(mocks.changeChar).not.toHaveBeenCalled()
        press(resultRow(2), 'Enter')
        expect(mocks.changeChar).toHaveBeenCalledWith(1, { quiet: true })
    })

    test('TS5: Escape on a row returns to the field and keeps the panel and the text', () => {
        rovingFixture()
        selectedCharID.set(0)
        render()
        typeText('match')
        land()
        resultRow(2).focus()
        const event = press(resultRow(2), 'Escape')
        expect(document.activeElement).toBe(field())
        expect(event.defaultPrevented).toBe(true)
        expect(field().value).toBe('match')
        expect(closes).toBe(0)
    })
})

describe('a selection change', () => {
    function twoCharacters() {
        return install(
            character('a', [chat('Match a1'), chat('Match a2'), chat('Match a3')]),
            character('b', [chat('Match b1'), chat('Match b2')]),
        )
    }

    test('TS6: a click on a result of the previous character before the redraw opens nothing; afterwards the field is empty and a new search opens the new character\'s match', () => {
        const [, b] = twoCharacters()
        selectedCharID.set(0)
        render()
        typeText('match')
        land()
        expect(resultNames()).toEqual(['Match a1', 'Match a2', 'Match a3'])
        const stale = resultRow(3)
        selectedCharID.set(1)
        stale.click()
        expect(mocks.changeChat).not.toHaveBeenCalled()
        expect(b.chatPage).toBe(0)

        flushSync()
        expect(field().value).toBe('')
        expect(resultRows()).toHaveLength(0)
        expect(listShown()).toBe(true)

        typeText('match')
        land()
        expect(resultNames()).toEqual(['Match b1', 'Match b2'])
        press(field(), 'Enter')
        expect(mocks.changeChat).toHaveBeenCalledTimes(1)
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
    })

    test('TS7: text typed before a switch, landed or not, is gone after it and lands nothing later', () => {
        twoCharacters()
        selectedCharID.set(0)
        render()
        typeText('match')
        selectedCharID.set(1)
        flushSync()
        expect(field().value).toBe('')
        vi.advanceTimersByTime(500)
        flushSync()
        expect(resultRows()).toHaveLength(0)
        expect(listShown()).toBe(true)

        typeText('match')
        land()
        expect(resultRows()).toHaveLength(2)
        selectedCharID.set(0)
        flushSync()
        expect(field().value).toBe('')
        expect(resultRows()).toHaveLength(0)
    })
})

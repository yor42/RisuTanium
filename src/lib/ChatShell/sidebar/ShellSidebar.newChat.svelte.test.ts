// @vitest-environment happy-dom

/**
 * `ShellSidebar.svelte`: the new shell's sidebar frame (strip, header, sort, footer, More).
 *
 * Invariants exercised here:
 * - New chat acts on the character selected at event time: a selection that moved since the last
 *   render but was not flushed still creates and opens the chat in the NEW character, and writes
 *   nothing into the old one (TB12).
 * - More lists the places the old rail and tab bar reached (TB5).
 * - The sort control carries the "On this device" description and writes the device key (TB4).
 * - A strip tap switches through `switchCharacter` (quiet for a warm character); during a reply it
 *   is refused with the notice and the overlay stays open; in an overlay a switch closes the
 *   overlay, docked it stays (TB7, TB9 sibling).
 *
 * MOCKED: the stores module, `characters` (spies; `createNewChat` copies the producer's shape),
 * `changeChatTo` (writes the selected slot like the real one), the alert module, the reply flag and
 * the heavy sidebar children. Everything under `chatShell/` is real.
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
    exportAllChats: vi.fn(),
    importChat: vi.fn(),
    alertNormal: vi.fn(),
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
    exportAllChats: mocks.exportAllChats,
    importChat: mocks.importChat,
    // The producer's shape: a new chat enters at the front of the list.
    createNewChat: (cha: { chats: Chat[] }) => {
        const chats = cha.chats
        chats.unshift({ id: `new-${chats.length}`, message: [], note: '', name: `New Chat ${chats.length + 1}`, localLore: [], fmIndex: -1 } as unknown as Chat)
        cha.chats = chats
        return 0
    },
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: mocks.alertNormal,
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, DynamicGUI, alertStore, bookmarkListOpen, selectedCharID, selIdState, sideBarClosing } from 'src/ts/stores.svelte'
import { doingChat } from 'src/ts/process/index.svelte'
import { language } from 'src/lang'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import { clearPending } from '../../../ts/chatShell/switchTarget.svelte'
import ShellSidebar from './ShellSidebar.svelte'

type Entry = Database['characters'][number]

function chat(name: string): Chat {
    return { id: `id-${name}`, name, message: [], note: '', localLore: [], fmIndex: -1 } as unknown as Chat
}

function character(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats, chatPage: 0, lastInteraction: 0, ...extra } as unknown as Entry
}

function install(characters: Entry[]): Entry[] {
    DBState.db = { characters, enableDevTools: false } as unknown as Database
    return DBState.db.characters
}

let mounted: Array<Record<string, unknown>> = []
let target: HTMLElement
const reseter = vi.fn()
const openGrid = vi.fn()

function render() {
    target = document.createElement('div')
    document.body.append(target)
    mounted.push(mount(ShellSidebar, { target, props: { openGrid, reseter } }) as Record<string, unknown>)
    flushSync()
}

function byLabel(label: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === label)
    if (!found) {
        throw new Error(`button not found: ${label}`)
    }
    return found
}

function stripButton(name: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-part="strip-avatar"]')).find((b) => b.getAttribute('aria-label') === name)
    if (!found) {
        throw new Error(`strip avatar not found: ${name}`)
    }
    return found
}

beforeEach(() => {
    mocks.changeChat.mockReset()
    mocks.changeChar.mockReset()
    mocks.changeChar.mockResolvedValue('selected')
    mocks.exportAllChats.mockReset()
    mocks.importChat.mockReset()
    mocks.alertNormal.mockReset()
    reseter.mockReset()
    openGrid.mockReset()
    localStorage.clear()
    doingChat.set(false)
    DynamicGUI.set(false)
    sideBarClosing.set(false)
    bookmarkListOpen.set(false)
    alertStore.set({ type: 'none', msg: '' })
    selectedCharID.set(-1)
    clearPending()
    takeOverlayReturnFocus()
})

afterEach(() => {
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    target?.remove()
})

describe('the selection mirror', () => {
    test('diagnostic: the mirror follows the store', () => {
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })
})

describe('New chat', () => {
    test('TB12: a selection that moved and was not flushed gets the new chat; the old character is untouched', () => {
        const [a, b] = install([
            character('a', [chat('a1'), chat('a2')], { chatPage: 1 }),
            character('b', [chat('b1'), chat('b2')], { chatPage: 1 }),
        ])
        selectedCharID.set(0)
        render()

        selectedCharID.set(1)
        byLabel(language.newChat).click()

        expect(b.chats.length).toBe(3)
        expect(b.chatPage).toBe(0)
        expect(mocks.changeChat).toHaveBeenCalledTimes(1)
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
        expect(a.chats.length).toBe(2)
        expect(a.chatPage).toBe(1)
    })

    test('New chat creates in the selected character and opens the new chat', () => {
        const [a] = install([character('a', [chat('a1')], { chatPage: 0 })])
        selectedCharID.set(0)
        render()
        byLabel(language.newChat).click()
        expect(a.chats.length).toBe(2)
        expect(a.chats[0].name).toBe('New Chat 2')
        expect(a.chatPage).toBe(0)
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
    })

    test('the New chat menu offers Import chat and Export all chats', () => {
        install([character('a', [chat('a1')])])
        selectedCharID.set(0)
        render()
        byLabel(language.chatShellNewChatMenu).click()
        flushSync()
        byLabel(language.chatShellImportChat).click()
        expect(mocks.importChat).toHaveBeenCalledTimes(1)
        byLabel(language.chatShellNewChatMenu).click()
        flushSync()
        byLabel(language.chatShellExportAllChats).click()
        expect(mocks.exportAllChats).toHaveBeenCalledTimes(1)
    })

    test('with no selected character the frame offers no header and no New chat', () => {
        install([character('a', [chat('a1')])])
        render()
        expect(Array.from(target.querySelectorAll('button')).some((b) => b.textContent?.trim() === language.newChat)).toBe(false)
        expect(target.querySelector('[data-part="sidebar-more"]')).not.toBeNull()
    })
})

describe('More', () => {
    test('TB5: it lists character settings, playground, bookmarks and branches; bookmarks and branches act', () => {
        install([character('a', [chat('a1')])])
        selectedCharID.set(0)
        render()
        byLabel(language.chatShellMore).click()
        flushSync()
        for (const label of [language.chatShellCharacterSettings, language.playground.playground, language.bookmarks, language.chatShellBranches]) {
            expect(byLabel(label)).toBeTruthy()
        }
        expect(Array.from(target.querySelectorAll('button')).some((b) => b.textContent?.trim() === language.chatShellDevTool)).toBe(false)
        byLabel(language.bookmarks).click()
        expect(get(bookmarkListOpen)).toBe(true)
        byLabel(language.chatShellMore).click()
        flushSync()
        byLabel(language.chatShellBranches).click()
        expect(get(alertStore).type).toBe('branches')
    })

    test('TB5: the dev tool item shows when dev tools are enabled', () => {
        install([character('a', [chat('a1')])])
        DBState.db.enableDevTools = true
        selectedCharID.set(0)
        render()
        byLabel(language.chatShellMore).click()
        flushSync()
        expect(byLabel(language.chatShellDevTool)).toBeTruthy()
    })

    test('TB5: character settings opens a sub-view with a way back', () => {
        install([character('a', [chat('a1')])])
        selectedCharID.set(0)
        render()
        byLabel(language.chatShellMore).click()
        flushSync()
        byLabel(language.chatShellCharacterSettings).click()
        flushSync()
        expect(target.querySelector('[data-part="more-subview"]')).not.toBeNull()
        byLabel(language.settingsPage.back).click()
        flushSync()
        expect(target.querySelector('[data-part="more-subview"]')).toBeNull()
    })
})

describe('the sort control', () => {
    test('TB4: it is described by "On this device" and writes the device key', () => {
        install([character('a', [chat('a1')])])
        selectedCharID.set(0)
        render()
        const select = target.querySelector<HTMLSelectElement>('[data-part="sidebar-sort"]')!
        expect(select.getAttribute('aria-label')).toBe(language.chatShellSortLabel)
        const description = target.querySelector(`#${select.getAttribute('aria-describedby')}`)
        expect(description?.textContent?.trim()).toBe(language.chatShellOnThisDevice)
        expect(select.value).toBe('recent')
        select.value = 'manual'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(localStorage.getItem('risuChatShell.chatSort')).toBe('manual')
    })

    test('TB4: a stored choice is shown on mount', () => {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        install([character('a', [chat('a1')])])
        selectedCharID.set(0)
        render()
        expect(target.querySelector<HTMLSelectElement>('[data-part="sidebar-sort"]')!.value).toBe('manual')
    })
})

describe('switching from the strip', () => {
    function twoCharacters(): Entry[] {
        return install([
            character('a', [chat('a1')], { lastInteraction: 20 }),
            character('b', [chat('b1')], { lastInteraction: 10 }),
        ])
    }

    test('TB7: a tap on a warm character switches quietly', () => {
        const [, b] = twoCharacters()
        selectedCharID.set(0)
        render()
        stripButton(b.name).click()
        expect(mocks.changeChar).toHaveBeenCalledTimes(1)
        expect(mocks.changeChar).toHaveBeenCalledWith(1, { quiet: true })
    })

    test('TB7: a tap on a group switches with the plain call', () => {
        install([
            character('a', [chat('a1')], { lastInteraction: 20 }),
            { type: 'group', chaId: 'grp', name: 'The group', image: '', chats: [], chatPage: 0, lastInteraction: 10 } as unknown as Entry,
        ])
        selectedCharID.set(0)
        render()
        stripButton(language.chatShellGroupName('The group')).click()
        expect(mocks.changeChar).toHaveBeenCalledTimes(1)
        expect(mocks.changeChar.mock.calls[0]).toEqual([1])
    })

    test('a tap during a reply shows the notice, switches nothing and keeps the overlay open', () => {
        const [, b] = twoCharacters()
        selectedCharID.set(0)
        DynamicGUI.set(true)
        doingChat.set(true)
        render()
        stripButton(b.name).click()
        expect(mocks.changeChar).not.toHaveBeenCalled()
        expect(mocks.alertNormal).toHaveBeenCalledWith(language.chatShellSwitchRefusedWriting)
        expect(get(sideBarClosing)).toBe(false)
    })

    test('in an overlay a switch closes the overlay; docked it stays open', () => {
        const [, b] = twoCharacters()
        selectedCharID.set(0)
        DynamicGUI.set(true)
        render()
        stripButton(b.name).click()
        expect(get(sideBarClosing)).toBe(true)

        sideBarClosing.set(false)
        DynamicGUI.set(false)
        flushSync()
        stripButton(b.name).click()
        expect(get(sideBarClosing)).toBe(false)
    })

    test('a keyboard activation in an overlay names where focus returns; a pointer tap names nothing', () => {
        const [, b] = twoCharacters()
        selectedCharID.set(0)
        DynamicGUI.set(true)
        render()
        const button = stripButton(b.name)
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        expect(takeOverlayReturnFocus()).toBeNull()

        sideBarClosing.set(false)
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
        expect(takeOverlayReturnFocus()).not.toBeNull()
    })

    test('All characters leaves the sidebar through the grid', () => {
        twoCharacters()
        selectedCharID.set(0)
        render()
        byLabel(language.chatShellAllCharacters).click()
        expect(openGrid).toHaveBeenCalledTimes(1)
    })
})

describe('the footer', () => {
    test('Home clears the selection and resets the panel', () => {
        install([character('a', [chat('a1')])])
        selectedCharID.set(0)
        render()
        byLabel(language.home).click()
        expect(reseter).toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
    })
})

// @vitest-environment happy-dom

/**
 * `ShellChatList.svelte` and `ShellChatRow.svelte`, mounted inside `ShellSidebar.svelte`: the new
 * shell's chat rows, their order, keyboard and opening rules.
 *
 * Invariants exercised here:
 * - Rows follow the device's sort; folders come first; 1,000 chats mount at most 40 rows.
 * - A row never loads an archived chat; it shows a placeholder.
 * - A row shows a draft mark for any composer content, including a file with no text.
 * - Opening goes through the character selected NOW: a row drawn for the old character that is
 *   activated after a switch (before the list redraws) opens nothing and writes nothing.
 * - Keyboard: roving focus with the arrow keys, Home and End, Left and Right on folders; a keyboard
 *   open in an overlay names where focus returns and closes the overlay, docked it keeps focus on the
 *   row.
 * - Folding goes through the live write and marks the character.
 *
 * MOCKED: the stores module, `characters` (spies), `changeChatTo` (writes the selected slot like the
 * real one), the alert module, the reply flag, the cold-storage loader (a spy that must stay unused),
 * the save mark and the heavy sidebar children. The chat-shell modules and composer drafts are real.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, ChatFolder, Database } from '../../../ts/storage/database.svelte'

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
    alertNormal: vi.fn(),
    alertError: vi.fn(),
    preLoadChat: vi.fn(),
    markCharacterForSave: vi.fn(),
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
    exportAllChats: vi.fn(),
    importChat: vi.fn(),
    createNewChat: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: mocks.alertNormal,
    alertError: mocks.alertError,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    preLoadChat: mocks.preLoadChat,
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock('src/ts/storage/characterSaveMarks', () => ({
    markCharacterForSave: mocks.markCharacterForSave,
}))

vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, DynamicGUI, alertStore, selectedCharID, sideBarClosing } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { coldStorageHeader } from '../../../ts/process/coldstorageData'
import * as composerDrafts from '../../../ts/process/composerDrafts.svelte'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import { clearPending } from '../../../ts/chatShell/switchTarget.svelte'
import ShellSidebar from './ShellSidebar.svelte'

type Entry = Database['characters'][number]

function chat(name: string, time?: number, extra: Partial<Chat> = {}): Chat {
    const message = time === undefined ? [] : [{ role: 'char', data: `${name} says hello`, time }]
    return { id: `id-${name}`, name, message, note: '', localLore: [], fmIndex: -1, ...extra } as unknown as Chat
}

function character(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats, chatPage: 0, chatFolders: [], lastInteraction: 0, ...extra } as unknown as Entry
}

function install(characters: Entry[]): Entry[] {
    DBState.db = { characters, enableDevTools: false } as unknown as Database
    return DBState.db.characters
}

let mounted: Array<Record<string, unknown>> = []
let target: HTMLElement

function render() {
    target = document.createElement('div')
    document.body.append(target)
    mounted.push(mount(ShellSidebar, { target, props: { openGrid: vi.fn(), reseter: vi.fn() } }) as Record<string, unknown>)
    flushSync()
}

function rows(): HTMLElement[] {
    return Array.from(target.querySelectorAll<HTMLElement>('[role="treeitem"]'))
}

function chatRows(): HTMLElement[] {
    return Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-row"]'))
}

function rowNamed(name: string): HTMLElement {
    const found = chatRows().find((r) => r.querySelector('[data-part="chat-row-name"]')?.textContent?.trim() === name)
    if (!found) {
        throw new Error(`row not found: ${name}`)
    }
    return found
}

function labels(): string[] {
    return rows().map((r) => r.querySelector('[data-part="chat-row-name"], [data-part="chat-folder-name"]')?.textContent?.trim() ?? '')
}

function key(el: HTMLElement, name: string) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
    flushSync()
}

function keyboardClick(el: HTMLElement) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
}

beforeEach(() => {
    mocks.changeChat.mockReset()
    mocks.changeChar.mockReset()
    mocks.alertNormal.mockReset()
    mocks.alertError.mockReset()
    mocks.preLoadChat.mockReset()
    mocks.markCharacterForSave.mockReset()
    localStorage.clear()
    composerDrafts.resetComposerDraftsForTests()
    DynamicGUI.set(false)
    sideBarClosing.set(false)
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
    test('diagnostic: the mirror follows the store', async () => {
        const { selIdState } = await import('src/ts/stores.svelte')
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })
})

describe('rows and order', () => {
    test('TC1: Recent lists folders first with their chats, then unfiled chats, newest first; each row has a name', () => {
        const folder: ChatFolder = { id: 'f1', name: 'Work', folded: false }
        install([character('a', [
            chat('old', 1),
            chat('inside', 5, { folderId: 'f1' }),
            chat('new', 90),
        ], { chatFolders: [folder] })])
        selectedCharID.set(0)
        render()
        expect(labels()).toEqual(['Work', 'inside', 'new', 'old'])
    })

    test('TC1: the sort control switches the list to My order', () => {
        install([character('a', [chat('old', 1), chat('new', 90)])])
        selectedCharID.set(0)
        render()
        expect(labels()).toEqual(['new', 'old'])
        const select = target.querySelector<HTMLSelectElement>('[data-part="sidebar-sort"]')!
        select.value = 'manual'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(labels()).toEqual(['old', 'new'])
    })

    test('TC1: the stored sort is used on mount', () => {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        install([character('a', [chat('old', 1), chat('new', 90)])])
        selectedCharID.set(0)
        render()
        expect(labels()).toEqual(['old', 'new'])
    })

    test('TC2: a row has two lines, a name and a preview without markup, and the open chat is aria-current', () => {
        const c = chat('talk', 10)
        c.message[0].data = '<i>Hello</i> there'
        install([character('a', [chat('other', 5), c], { chatPage: 1 })])
        selectedCharID.set(0)
        render()
        const row = rowNamed('talk')
        expect(row.querySelector('[data-part="chat-row-preview"]')?.textContent?.trim()).toBe('Hello there')
        expect(row.getAttribute('aria-current')).toBe('page')
        expect(rowNamed('other').getAttribute('aria-current')).toBeNull()
    })

    test('a folded folder hides its chats and reports it through aria-expanded; a folder shows its chat count', () => {
        install([character('a', [chat('inside', 5, { folderId: 'f2' })], {
            chatFolders: [{ id: 'f1', name: 'Empty', folded: false }, { id: 'f2', name: 'Closed', folded: true }],
        })])
        selectedCharID.set(0)
        render()
        expect(labels()).toEqual(['Empty', 'Closed'])
        const folders = Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-folder"]'))
        expect(folders.map((f) => f.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
        expect(folders.map((f) => f.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Empty 0', 'Closed 1'])
    })

    test('TC3: 1,000 chats mount at most 40 rows and describe their place in the set', () => {
        const chats = Array.from({ length: 1000 }, (_, i) => chat(`c${i}`, i + 1))
        install([character('a', chats)])
        selectedCharID.set(0)
        render()
        expect(chatRows().length).toBeGreaterThan(0)
        expect(chatRows().length).toBeLessThanOrEqual(40)
        const first = chatRows()[0]
        expect(first.getAttribute('aria-setsize')).toBe('1000')
        expect(first.getAttribute('aria-posinset')).toBe('1')
    })

    test('TC4: an archived chat shows a placeholder and is never loaded by rendering', () => {
        const archived = chat('archived', 3)
        archived.message[0].data = `${coldStorageHeader}payload`
        install([character('a', [archived, chat('plain', 4)])])
        selectedCharID.set(0)
        render()
        const row = rowNamed('archived')
        expect(row.querySelector('[data-part="chat-row-preview"]')?.textContent?.trim()).toBe(language.chatShellRowArchived)
        expect(row.textContent).not.toContain('payload')
        expect(mocks.preLoadChat).not.toHaveBeenCalled()
    })

    test('TC5: a draft mark shows for typed text and for a file alone, and not for a chat with no draft', () => {
        install([character('a', [chat('typed', 3), chat('filed', 2), chat('clean', 1)])])
        selectedCharID.set(0)
        composerDrafts.write({ chaId: 'a', chatId: 'id-typed' }, (r) => { r.messageInput = 'half a thought' })
        composerDrafts.write({ chaId: 'a', chatId: 'id-filed' }, (r) => { r.fileInput.push('asset-1') })
        render()
        const mark = (name: string) => rowNamed(name).querySelector('[data-part="chat-row-draft"]')
        expect(mark('typed')?.textContent?.trim()).toBe(language.chatShellStatusDraft)
        expect(mark('filed')).not.toBeNull()
        expect(mark('clean')).toBeNull()
    })

    test('TC5: a draft written later shows up without a remount', () => {
        install([character('a', [chat('one', 3)])])
        selectedCharID.set(0)
        render()
        expect(rowNamed('one').querySelector('[data-part="chat-row-draft"]')).toBeNull()
        composerDrafts.write({ chaId: 'a', chatId: 'id-one' }, (r) => { r.messageInputTranslate = 'x' })
        flushSync()
        expect(rowNamed('one').querySelector('[data-part="chat-row-draft"]')).not.toBeNull()
    })
})

describe('opening a chat', () => {
    test('a click opens the chat by identity in the selected character', () => {
        const [a] = install([character('a', [chat('one', 1), chat('two', 2), chat('three', 3)])])
        selectedCharID.set(0)
        render()
        rowNamed('one').click()
        expect(mocks.changeChat).toHaveBeenCalledTimes(1)
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
        expect(a.chatPage).toBe(0)
    })

    test('TC8: a row drawn for the old character does nothing after a switch; the new list is exactly the new chats', async () => {
        const [a, b] = install([
            character('a', [chat('a1', 1), chat('a2', 2), chat('a3', 3)], { chatPage: 1 }),
            character('b', [chat('b1', 1), chat('b2', 2)], { chatPage: 0 }),
        ])
        selectedCharID.set(0)
        render()
        const stale = rowNamed('a3')

        selectedCharID.set(1)
        stale.click()
        expect(mocks.changeChat).not.toHaveBeenCalled()
        expect(a.chatPage).toBe(1)
        expect(b.chatPage).toBe(0)

        await tick()
        flushSync()
        expect(labels()).toEqual(['b2', 'b1'])

        keyboardClick(chatRows()[0])
        expect(mocks.changeChat).toHaveBeenCalledTimes(1)
        expect(mocks.changeChat).toHaveBeenCalledWith(1)
        expect(b.chatPage).toBe(1)
        expect(a.chatPage).toBe(1)
    })

    test('TC7: in an overlay a keyboard open names where focus returns and closes the overlay; a pointer open names nothing', () => {
        install([character('a', [chat('one', 1), chat('two', 2)])])
        selectedCharID.set(0)
        DynamicGUI.set(true)
        render()
        rowNamed('one').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        expect(get(sideBarClosing)).toBe(true)
        expect(takeOverlayReturnFocus()).toBeNull()

        sideBarClosing.set(false)
        keyboardClick(rowNamed('two'))
        expect(get(sideBarClosing)).toBe(true)
        expect(takeOverlayReturnFocus()).not.toBeNull()
    })

    test('TC7: docked, a keyboard open keeps focus on the row and the sidebar open', async () => {
        install([character('a', [chat('one', 1), chat('two', 2)])])
        selectedCharID.set(0)
        render()
        const row = rowNamed('one')
        row.focus()
        keyboardClick(row)
        await tick()
        flushSync()
        expect(get(sideBarClosing)).toBe(false)
        expect(takeOverlayReturnFocus()).toBeNull()
        expect(document.activeElement).toBe(rowNamed('one'))
    })

    test('Alt+Down from outside a text field opens the next chat in the list', () => {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        const [a] = install([character('a', [chat('one', 1), chat('two', 2)])])
        selectedCharID.set(0)
        render()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
        expect(a.chatPage).toBe(1)
    })
})

describe('keyboard', () => {
    function setup() {
        const folder: ChatFolder = { id: 'f1', name: 'Work', folded: false }
        install([character('a', [
            chat('in1', 30, { folderId: 'f1' }),
            chat('top1', 20),
            chat('top2', 10),
        ], { chatFolders: [folder], chatPage: 1 })])
        selectedCharID.set(0)
        render()
    }

    test('TC7: exactly one row is tabbable, the open chat to begin with', () => {
        setup()
        const tabbable = rows().filter((r) => r.tabIndex === 0)
        expect(tabbable.length).toBe(1)
        expect(tabbable[0]).toBe(rowNamed('top1'))
    })

    test('TC7: the arrow keys move focus and the tab stop, Home and End jump', async () => {
        setup()
        const start = rowNamed('top1')
        start.focus()
        key(start, 'ArrowDown')
        await tick()
        expect(document.activeElement).toBe(rowNamed('top2'))
        expect(rowNamed('top2').tabIndex).toBe(0)
        expect(start.tabIndex).toBe(-1)

        key(rowNamed('top2'), 'ArrowDown')
        await tick()
        expect(document.activeElement).toBe(rowNamed('top2'))

        key(rowNamed('top2'), 'ArrowUp')
        await tick()
        expect(document.activeElement).toBe(start)

        key(start, 'Home')
        await tick()
        expect(document.activeElement).toBe(target.querySelector('[data-part="chat-folder"]'))

        key(document.activeElement as HTMLElement, 'End')
        await tick()
        expect(document.activeElement).toBe(rowNamed('top2'))
    })

    test('TC7: Left on a chat in a folder goes to the folder; Left and Right fold and unfold it through the live write', async () => {
        setup()
        const folderRow = target.querySelector<HTMLElement>('[data-part="chat-folder"]')!
        const inner = rowNamed('in1')
        inner.focus()
        key(inner, 'ArrowLeft')
        await tick()
        expect(document.activeElement).toBe(folderRow)

        key(folderRow, 'ArrowLeft')
        await tick()
        expect(folderRow.getAttribute('aria-expanded')).toBe('false')
        expect(DBState.db.characters[0].chatFolders[0].folded).toBe(true)
        expect(mocks.markCharacterForSave).toHaveBeenCalledWith('a')
        expect(labels()).toEqual(['Work', 'top1', 'top2'])

        key(folderRow, 'ArrowRight')
        await tick()
        expect(DBState.db.characters[0].chatFolders[0].folded).toBe(false)
        expect(labels()).toEqual(['Work', 'in1', 'top1', 'top2'])
    })

    test('TC7: a click on a folder header toggles it and marks the character once per toggle', () => {
        setup()
        const folderRow = target.querySelector<HTMLElement>('[data-part="chat-folder"]')!
        folderRow.click()
        flushSync()
        expect(DBState.db.characters[0].chatFolders[0].folded).toBe(true)
        expect(mocks.markCharacterForSave).toHaveBeenCalledTimes(1)
    })

    test('folding a folder of an archived character is refused with the not-saved notice and writes nothing', () => {
        const folder: ChatFolder = { id: 'f1', name: 'Work', folded: false }
        install([character('a', [chat('in1', 1, { folderId: 'f1' })], { chatFolders: [folder] })])
        selectedCharID.set(0)
        render()
        DBState.db.characters[0].coldstorage = 'archived'
        target.querySelector<HTMLElement>('[data-part="chat-folder"]')!.click()
        flushSync()
        expect(folder.folded).toBe(false)
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
        expect(mocks.alertError).toHaveBeenCalledWith(language.chatShellEditNotSaved)
    })
})

// @vitest-environment happy-dom

/**
 * `ShellSidebar.svelte` with its real chat list, row menu and delete confirm: the menus, the inline renames, the delete
 * flow, and what happens to all of them when the selected character changes.
 *
 * Invariants exercised here:
 * - A row opens its menu from the options button, a right click, Shift+F10 or the ContextMenu key, and from a touch held
 *   for 500 ms; the press ring shows from 200 ms; a finger that moves more than 10 px or lifts early opens nothing.
 * - Inline rename: Enter saves through the live write, Escape cancels (and consumes the key), an IME Enter does nothing.
 * - Delete asks removeChatConfirmed to keep the open chat open and passes the sidebar's own confirm; the confirm answers
 *   false when cancelled.
 * - A selection change closes every open menu and inline field without a write and answers a pending delete confirm false;
 *   a commit that runs between the selection change and the flush writes nothing; the pending record outlives a menu that
 *   closes under its own confirm; leaving the sidebar answers the confirm false.
 *
 * MOCKED: the stores module (selection mirror like the real one), `characters` (`removeChatConfirmed` answers by asking its
 * confirm and recording the answer; `exportChat` spy), `changeChatTo`, the alert module, the save mark, the reply flag and
 * the heavy sidebar children. The live writes, the list model, the menu, the confirm component and the pending rules are real.
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
    alertConfirm: vi.fn(),
    exportChat: vi.fn(),
    removeChat: vi.fn(),
    markCharacterForSave: vi.fn(),
    answers: [] as boolean[],
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
        createChatCopyName: (name: string, type: string) => `${name} (${type})`,
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null),
    changeChar: mocks.changeChar,
    exportAllChats: vi.fn(),
    importChat: vi.fn(),
    createNewChat: vi.fn(),
    exportChat: mocks.exportChat,
    removeChatConfirmed: mocks.removeChat,
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: mocks.alertNormal,
    alertError: mocks.alertError,
    alertConfirm: mocks.alertConfirm,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('src/ts/storage/characterSaveMarks', () => ({
    markCharacterForSave: mocks.markCharacterForSave,
}))

vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, DynamicGUI, alertStore, selectedCharID, selIdState, sideBarClosing } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { coldStorageHeader } from '../../../ts/process/coldstorageData'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import { clearPending } from '../../../ts/chatShell/switchTarget.svelte'
import ShellSidebar from './ShellSidebar.svelte'

type Entry = Database['characters'][number]

function chat(name: string, extra: Partial<Chat> = {}): Chat {
    return { id: `id-${name}`, name, message: [{ role: 'char', data: `${name} says hello`, time: 1000 }], note: '', localLore: [], fmIndex: -1, ...extra } as unknown as Chat
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
    const app = mount(ShellSidebar, { target, props: { openGrid: vi.fn(), reseter: vi.fn() } }) as Record<string, unknown>
    mounted.push(app)
    flushSync()
    return app
}

function chatRow(name: string): HTMLElement {
    const found = Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-row"]'))
        .find((r) => r.querySelector('[data-part="chat-row-name"]')?.textContent?.trim() === name)
    if (!found) {
        throw new Error(`row not found: ${name}`)
    }
    return found
}

function rowMenuButton(name: string): HTMLElement {
    const button = chatRow(name).closest('[data-part="chat-row-host"]')?.querySelector<HTMLElement>('[data-part="chat-row-menu"]')
    if (!button) {
        throw new Error(`no options button for ${name}`)
    }
    return button
}

function folderHeader(name: string): HTMLElement {
    const found = Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-folder"]'))
        .find((r) => r.querySelector('[data-part="chat-folder-name"]')?.textContent?.trim() === name)
    if (!found) {
        throw new Error(`folder not found: ${name}`)
    }
    return found
}

function folderMenuButton(name: string): HTMLElement {
    const button = folderHeader(name).closest('[data-part="chat-folder-host"]')?.querySelector<HTMLElement>('[data-part="chat-folder-menu"]')
    if (!button) {
        throw new Error(`no options button for folder ${name}`)
    }
    return button
}

function menuItem(action: string): HTMLButtonElement {
    const found = document.querySelector<HTMLButtonElement>(`[role^="menuitem"][data-action="${action}"]`)
    if (!found) {
        throw new Error(`no menu item ${action}`)
    }
    return found
}

function menuOpen(): boolean {
    return document.querySelector('[role="menu"]') !== null
}

function nameInput(): HTMLInputElement | null {
    return target.querySelector<HTMLInputElement>('[data-part="chat-row-name-input"]')
}

function folderInput(): HTMLInputElement | null {
    return target.querySelector<HTMLInputElement>('[data-part="chat-folder-name-input"]')
}

function confirmDialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-part="pattern-warn-root"]')
}

function click(el: HTMLElement) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    flushSync()
}

function type(input: HTMLInputElement, value: string) {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(event)
    return event
}

function pointer(el: HTMLElement, type: string, x = 10, y = 10) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerType', { value: 'touch' })
    el.dispatchEvent(event)
}

async function settle() {
    await tick()
    await Promise.resolve()
    await tick()
    flushSync()
}

function fixture() {
    const [A, B] = install([
        character('A', [chat('One'), chat('Two'), chat('Three')], { chatFolders: [{ id: 'f1', name: 'Alpha', folded: false } as ChatFolder] }),
        character('B', [chat('BOne'), chat('BTwo')]),
    ])
    selectedCharID.set(0)
    return { A, B }
}

beforeEach(() => {
    mocks.changeChat.mockReset()
    mocks.changeChar.mockReset()
    mocks.alertNormal.mockReset()
    mocks.alertError.mockReset()
    mocks.alertConfirm.mockReset()
    mocks.alertConfirm.mockImplementation(async () => true)
    mocks.exportChat.mockReset()
    mocks.markCharacterForSave.mockReset()
    mocks.answers.length = 0
    mocks.removeChat.mockReset()
    // The real function asks its confirm, then removes; this one records the answer, which is what the sidebar owns.
    mocks.removeChat.mockImplementation(async (_owner: Entry, victim: Chat, confirm?: (request: { chat: Chat, busy: boolean }) => Promise<boolean>) => {
        const answer = confirm ? await confirm({ chat: victim, busy: false }) : false
        mocks.answers.push(answer)
        return answer
    })
    localStorage.clear()
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
    document.body.innerHTML = ''
    vi.useRealTimers()
})

describe('the selection mirror', () => {
    test('diagnostic: the mirror follows the store', () => {
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })
})

describe('opening the row menu', () => {
    test('the options button opens the menu of that row', () => {
        fixture()
        render()
        click(rowMenuButton('Two'))
        expect(menuOpen()).toBe(true)
        expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(language.chatShellRowMenu('Two'))
        expect(rowMenuButton('Two').getAttribute('aria-expanded')).toBe('true')
    })

    test('a right click opens it and consumes the browser menu', () => {
        fixture()
        render()
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })
        chatRow('Two').dispatchEvent(event)
        flushSync()
        expect(event.defaultPrevented).toBe(true)
        expect(menuOpen()).toBe(true)
    })

    test.each([
        ['Shift+F10', 'F10', { shiftKey: true }],
        ['the ContextMenu key', 'ContextMenu', {}],
    ])('%s opens it from the keyboard', (_name, key, init) => {
        fixture()
        render()
        const event = press(chatRow('Two'), key, init)
        flushSync()
        expect(event.defaultPrevented).toBe(true)
        expect(menuOpen()).toBe(true)
    })

    // M57: the ring tells a touch user the hold is being counted; M31: the hold is 500 ms, not 300.
    test('a touch held for 500 ms opens it, with the press ring from 200 ms', () => {
        vi.useFakeTimers()
        fixture()
        render()
        const row = chatRow('Two')
        pointer(row, 'pointerdown')
        vi.advanceTimersByTime(199)
        flushSync()
        expect(row.closest('[data-part="chat-row-host"]')?.hasAttribute('data-ring')).toBe(false)
        vi.advanceTimersByTime(1)
        flushSync()
        expect(row.closest('[data-part="chat-row-host"]')?.hasAttribute('data-ring')).toBe(true)
        vi.advanceTimersByTime(299)
        flushSync()
        expect(menuOpen()).toBe(false)
        vi.advanceTimersByTime(1)
        flushSync()
        expect(menuOpen()).toBe(true)
        expect(row.closest('[data-part="chat-row-host"]')?.hasAttribute('data-ring')).toBe(false)
    })

    test('a finger that moves more than 10 px, or lifts early, opens nothing', () => {
        vi.useFakeTimers()
        fixture()
        render()
        const row = chatRow('Two')
        pointer(row, 'pointerdown', 10, 10)
        vi.advanceTimersByTime(250)
        pointer(row, 'pointermove', 10, 22)
        flushSync()
        expect(row.closest('[data-part="chat-row-host"]')?.hasAttribute('data-ring')).toBe(false)
        vi.advanceTimersByTime(600)
        flushSync()
        expect(menuOpen()).toBe(false)
        pointer(row, 'pointerdown', 10, 10)
        vi.advanceTimersByTime(300)
        pointer(row, 'pointerup')
        vi.advanceTimersByTime(600)
        flushSync()
        expect(menuOpen()).toBe(false)
    })

    test('a small wobble keeps the hold', () => {
        vi.useFakeTimers()
        fixture()
        render()
        const row = chatRow('Two')
        pointer(row, 'pointerdown', 10, 10)
        pointer(row, 'pointermove', 14, 14)
        vi.advanceTimersByTime(500)
        flushSync()
        expect(menuOpen()).toBe(true)
    })

    test('a mouse press never starts the hold', () => {
        vi.useFakeTimers()
        fixture()
        render()
        const row = chatRow('Two')
        const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
        Object.defineProperty(down, 'pointerType', { value: 'mouse' })
        row.dispatchEvent(down)
        vi.advanceTimersByTime(800)
        flushSync()
        expect(menuOpen()).toBe(false)
    })
})

describe('inline rename', () => {
    function startRename(name: string) {
        click(rowMenuButton(name))
        click(menuItem('rename'))
        const input = nameInput()
        if (!input) {
            throw new Error('no rename field')
        }
        return input
    }

    test('Rename in the menu closes the menu and shows a field with the current name', () => {
        fixture()
        render()
        const input = startRename('Two')
        expect(menuOpen()).toBe(false)
        expect(input.value).toBe('Two')
    })

    test('Enter saves the trimmed name through the live write and marks the character', () => {
        const { A } = fixture()
        render()
        const input = startRename('Two')
        type(input, '  Renamed  ')
        press(input, 'Enter')
        flushSync()
        expect(A.chats[1].name).toBe('Renamed')
        expect(mocks.markCharacterForSave).toHaveBeenCalledWith('A')
        expect(nameInput()).toBeNull()
    })

    test('leaving the field saves it, once', () => {
        const { A } = fixture()
        render()
        const input = startRename('Two')
        type(input, 'By blur')
        input.dispatchEvent(new FocusEvent('blur'))
        flushSync()
        expect(A.chats[1].name).toBe('By blur')
        input.dispatchEvent(new FocusEvent('blur'))
        expect(mocks.markCharacterForSave).toHaveBeenCalledTimes(1)
    })

    // M61: Escape belongs to the field; the overlay and the page must not see it.
    test('Escape cancels the rename and consumes the key', () => {
        const { A } = fixture()
        render()
        const input = startRename('Two')
        type(input, 'Typed')
        const event = press(input, 'Escape')
        flushSync()
        expect(event.defaultPrevented).toBe(true)
        expect(nameInput()).toBeNull()
        expect(A.chats[1].name).toBe('Two')
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
        // The field is gone, so a blur that follows writes nothing either.
        input.dispatchEvent(new FocusEvent('blur'))
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
    })

    test('an Enter that confirms an IME composition does nothing', () => {
        const { A } = fixture()
        render()
        const input = startRename('Two')
        type(input, 'Han')
        const composing = press(input, 'Enter', { isComposing: true })
        flushSync()
        expect(composing.defaultPrevented).toBe(false)
        expect(nameInput()).not.toBeNull()
        expect(A.chats[1].name).toBe('Two')
        const legacy = press(input, 'Enter', { keyCode: 229 })
        expect(legacy.defaultPrevented).toBe(false)
        expect(nameInput()).not.toBeNull()
    })

    test('an empty name reverts without a write', () => {
        const { A } = fixture()
        render()
        const input = startRename('Two')
        type(input, '   ')
        press(input, 'Enter')
        flushSync()
        expect(A.chats[1].name).toBe('Two')
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
        expect(nameInput()).toBeNull()
    })

    test('arrow keys inside the field do not move the list focus', () => {
        fixture()
        render()
        const input = startRename('Two')
        const event = press(input, 'ArrowDown')
        expect(event.defaultPrevented).toBe(false)
    })
})

describe('the menu actions', () => {
    test('Duplicate puts a copy on top and opens it; in an overlay the overlay closes', () => {
        const { A } = fixture()
        DynamicGUI.set(true)
        render()
        click(rowMenuButton('Two'))
        click(menuItem('duplicate'))
        expect(menuOpen()).toBe(false)
        expect(A.chats).toHaveLength(4)
        expect(A.chats[0].name).toBe('Two (Copy)')
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
        expect(get(sideBarClosing)).toBe(true)
    })

    test('Duplicate docked leaves the sidebar open', () => {
        fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('duplicate'))
        expect(get(sideBarClosing)).toBe(false)
    })

    test('Export hands the chat index to the exporter and closes the menu', () => {
        fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('export'))
        expect(mocks.exportChat).toHaveBeenCalledWith(1)
        expect(menuOpen()).toBe(false)
    })

    test('Move to folder files the chat; No folder unfiles it', () => {
        const { A } = fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('move'))
        click(menuItem('move-f1'))
        expect(A.chats[1].folderId).toBe('f1')
        expect(menuOpen()).toBe(false)
        click(rowMenuButton('Two'))
        click(menuItem('move'))
        click(menuItem('move-none'))
        expect(A.chats[1].folderId).toBeUndefined()
    })

    test('New folder in Move creates a folder and files the chat in it', () => {
        const { A } = fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('move'))
        click(menuItem('move-new'))
        expect(A.chatFolders).toHaveLength(2)
        expect(A.chatFolders?.[0].id).not.toBe('f1')
        expect(A.chats[1].folderId).toBe(A.chatFolders?.[0].id)
    })

    test('the only chat of a character has Delete disabled', () => {
        install([character('A', [chat('Only')])])
        selectedCharID.set(0)
        render()
        click(rowMenuButton('Only'))
        const del = menuItem('delete')
        expect(del.disabled || del.getAttribute('aria-disabled') === 'true').toBe(true)
        click(del)
        expect(mocks.removeChat).not.toHaveBeenCalled()
    })
})

describe('delete', () => {
    test('asks removeChatConfirmed to keep the open chat, with the sidebar\'s own confirm', async () => {
        const { A } = fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('delete'))
        expect(mocks.removeChat).toHaveBeenCalledTimes(1)
        const [owner, victim, confirm, options] = mocks.removeChat.mock.calls[0]
        expect(owner).toBe(A)
        expect(victim).toBe(A.chats[1])
        expect(typeof confirm).toBe('function')
        expect(options).toEqual({ keepCurrent: true })
        // The menu steps aside for the confirm, which names the chat and its messages.
        expect(menuOpen()).toBe(false)
        expect(confirmDialog()?.textContent).toContain(language.chatShellDeleteChatConfirm('Two', 1))
    })

    test('Cancel answers false and removes the confirm', async () => {
        fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('delete'))
        click(document.querySelector<HTMLElement>('[data-part="pattern-warn-cancel"]')!)
        await settle()
        expect(mocks.answers).toEqual([false])
        expect(confirmDialog()).toBeNull()
    })

    test('the primary answers true once the arm delay has passed', async () => {
        fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('delete'))
        await new Promise((resolve) => setTimeout(resolve, 400))
        click(document.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!)
        await settle()
        expect(mocks.answers).toEqual([true])
        expect(confirmDialog()).toBeNull()
    })

    test('an archived chat is confirmed with the archived text and no message count', async () => {
        install([character('A', [chat('One'), chat('Old', { message: [{ role: 'char', data: `${coldStorageHeader}abc`, time: 1 }] as unknown as Chat['message'] })])])
        selectedCharID.set(0)
        render()
        click(rowMenuButton('Old'))
        click(menuItem('delete'))
        await settle()
        expect(mocks.alertConfirm).toHaveBeenCalledWith(language.chatShellDeleteArchivedChatConfirm('Old'))
        expect(confirmDialog()).toBeNull()
        expect(mocks.answers).toEqual([true])
    })
})

describe('folders', () => {
    test('the folder menu renames a folder inline', () => {
        const { A } = fixture()
        render()
        click(folderMenuButton('Alpha'))
        expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(language.chatShellFolderMenu('Alpha'))
        click(menuItem('folder-rename'))
        const input = folderInput()!
        expect(input.value).toBe('Alpha')
        type(input, 'Beta')
        press(input, 'Enter')
        flushSync()
        expect(A.chatFolders?.[0].name).toBe('Beta')
        expect(mocks.markCharacterForSave).toHaveBeenCalledWith('A')
        expect(folderInput()).toBeNull()
    })

    test('Escape cancels a folder rename and consumes the key', () => {
        const { A } = fixture()
        render()
        click(folderMenuButton('Alpha'))
        click(menuItem('folder-rename'))
        const input = folderInput()!
        type(input, 'Typed')
        expect(press(input, 'Escape').defaultPrevented).toBe(true)
        flushSync()
        expect(folderInput()).toBeNull()
        expect(A.chatFolders?.[0].name).toBe('Alpha')
    })

    test('Colour writes the chosen colour', () => {
        const { A } = fixture()
        render()
        click(folderMenuButton('Alpha'))
        click(menuItem('folder-colour'))
        click(menuItem('colour-green'))
        expect(A.chatFolders?.[0].color).toBe('green')
        expect(menuOpen()).toBe(false)
    })

    test('Delete asks the alert confirm, then unfiles the chats', async () => {
        const { A } = fixture()
        A.chats[1].folderId = 'f1'
        render()
        click(folderMenuButton('Alpha'))
        click(menuItem('folder-delete'))
        await settle()
        expect(mocks.alertConfirm).toHaveBeenCalledWith(`${language.removeConfirm}Alpha`)
        expect(A.chatFolders).toHaveLength(0)
        expect(A.chats[1].folderId).toBeUndefined()
    })

    test('a declined folder delete changes nothing', async () => {
        const { A } = fixture()
        mocks.alertConfirm.mockImplementation(async () => false)
        render()
        click(folderMenuButton('Alpha'))
        click(menuItem('folder-delete'))
        await settle()
        expect(A.chatFolders).toHaveLength(1)
    })
})

describe('a selection change cancels what is pending', () => {
    // TD12 (a): the confirm for A's chat is open when the selection moves to a character that still shows this sidebar.
    test('an open delete confirm is answered false and closed', async () => {
        const { A } = fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('delete'))
        // The menu closed under its own confirm; the pending record must outlive it.
        expect(menuOpen()).toBe(false)
        expect(confirmDialog()).not.toBeNull()
        selectedCharID.set(1)
        await settle()
        expect(confirmDialog()).toBeNull()
        expect(mocks.answers).toEqual([false])
        expect(A.chats).toHaveLength(3)
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    // TD12 (b): a switch to a group or home removes the sidebar itself.
    test('leaving the sidebar answers the confirm false', async () => {
        const { A } = fixture()
        const app = render()
        click(rowMenuButton('Two'))
        click(menuItem('delete'))
        expect(confirmDialog()).not.toBeNull()
        unmount(app)
        mounted = []
        await settle()
        expect(mocks.answers).toEqual([false])
        expect(A.chats).toHaveLength(3)
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    test('an open menu closes without writing', async () => {
        fixture()
        render()
        click(rowMenuButton('Two'))
        expect(menuOpen()).toBe(true)
        selectedCharID.set(1)
        await settle()
        expect(menuOpen()).toBe(false)
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
    })

    // TD13: one record carries the selection of the first opener while a field and a menu are open together.
    test('a field and a menu open together are both gone after the switch, and nothing was written in between', async () => {
        const { A } = fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('rename'))
        const input = nameInput()!
        click(rowMenuButton('Three'))
        expect(menuOpen()).toBe(true)
        type(input, 'Changed')
        selectedCharID.set(1)
        // Before the flush: the field still exists, and both a blur and an Enter reach it.
        input.dispatchEvent(new FocusEvent('blur'))
        press(input, 'Enter')
        // M82: without the guard the commit would try the write on the newly selected character and show the not-saved notice.
        expect(mocks.alertError).not.toHaveBeenCalled()
        expect(A.chats[1].name).toBe('Two')
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
        await settle()
        expect(nameInput()).toBeNull()
        expect(menuOpen()).toBe(false)
        expect(A.chats[1].name).toBe('Two')
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    // M80: the cancel itself closes the field, so it does not come back when the user returns to the character.
    test('a field open at the switch is closed by the switch alone', async () => {
        const { A } = fixture()
        render()
        click(rowMenuButton('Two'))
        click(menuItem('rename'))
        type(nameInput()!, 'Changed')
        selectedCharID.set(1)
        await settle()
        expect(nameInput()).toBeNull()
        selectedCharID.set(0)
        await settle()
        expect(nameInput()).toBeNull()
        expect(chatRow('Two')).toBeTruthy()
        expect(A.chats[1].name).toBe('Two')
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('a folder field is cancelled the same way', async () => {
        const { A } = fixture()
        render()
        click(folderMenuButton('Alpha'))
        click(menuItem('folder-rename'))
        const input = folderInput()!
        type(input, 'Changed')
        selectedCharID.set(1)
        press(input, 'Enter')
        expect(mocks.alertError).not.toHaveBeenCalled()
        await settle()
        expect(folderInput()).toBeNull()
        expect(A.chatFolders?.[0].name).toBe('Alpha')
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
    })

    // M80 (folder field): the Enter above closes the field itself, so this one leaves it to the switch alone.
    test('a folder field open at the switch is closed by the switch alone', async () => {
        const { A } = fixture()
        render()
        click(folderMenuButton('Alpha'))
        click(menuItem('folder-rename'))
        type(folderInput()!, 'Changed')
        selectedCharID.set(1)
        await settle()
        expect(folderInput()).toBeNull()
        selectedCharID.set(0)
        await settle()
        expect(folderInput()).toBeNull()
        expect(A.chatFolders?.[0].name).toBe('Alpha')
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
    })

    // The alert confirms (archived chat, folder) are outside the sidebar's confirm; a selection change while one is open still
    // answers it as cancelled, e.g. when a switch that was already running finishes under the alert.
    test('an archived chat delete confirmed after the selection moved is answered false', async () => {
        install([
            character('A', [chat('One'), chat('Old', { message: [{ role: 'char', data: `${coldStorageHeader}abc`, time: 1 }] as unknown as Chat['message'] })]),
            character('B', [chat('BOne')]),
        ])
        selectedCharID.set(0)
        let answer: (confirmed: boolean) => void = () => {}
        mocks.alertConfirm.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve }))
        render()
        click(rowMenuButton('Old'))
        click(menuItem('delete'))
        await settle()
        expect(mocks.alertConfirm).toHaveBeenCalledTimes(1)
        selectedCharID.set(1)
        await settle()
        answer(true)
        await settle()
        expect(mocks.answers).toEqual([false])
    })

    test('a folder delete confirmed after the selection moved removes nothing', async () => {
        const { A } = fixture()
        A.chats[1].folderId = 'f1'
        let answer: (confirmed: boolean) => void = () => {}
        mocks.alertConfirm.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve }))
        render()
        click(folderMenuButton('Alpha'))
        click(menuItem('folder-delete'))
        await settle()
        expect(mocks.alertConfirm).toHaveBeenCalledTimes(1)
        selectedCharID.set(1)
        await settle()
        answer(true)
        await settle()
        expect(A.chatFolders).toHaveLength(1)
        expect(A.chats[1].folderId).toBe('f1')
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
    })

    test('an archived chat delete confirmed with the selection unchanged still goes ahead', async () => {
        install([
            character('A', [chat('One'), chat('Old', { message: [{ role: 'char', data: `${coldStorageHeader}abc`, time: 1 }] as unknown as Chat['message'] })]),
            character('B', [chat('BOne')]),
        ])
        selectedCharID.set(0)
        render()
        click(rowMenuButton('Old'))
        click(menuItem('delete'))
        await settle()
        expect(mocks.answers).toEqual([true])
    })

    // M83: a menu that closes while its confirm is open must not drop the record, or the switch would leave the confirm up.
    test('a switch after the menu closed under its confirm still answers the confirm', async () => {
        fixture()
        render()
        click(rowMenuButton('Three'))
        click(menuItem('delete'))
        expect(menuOpen()).toBe(false)
        selectedCharID.set(1)
        await settle()
        expect(mocks.answers).toEqual([false])
    })

    test('after a cancelled round the next menu works and records the new selection', async () => {
        fixture()
        render()
        click(rowMenuButton('Two'))
        selectedCharID.set(1)
        await settle()
        expect(menuOpen()).toBe(false)
        click(rowMenuButton('BTwo'))
        expect(menuOpen()).toBe(true)
        await settle()
        // Still open: the record belongs to the new selection, so the effect leaves it alone.
        expect(menuOpen()).toBe(true)
    })

    test('with nothing open a switch does nothing at all', async () => {
        fixture()
        render()
        selectedCharID.set(1)
        await settle()
        expect(mocks.answers).toEqual([])
        expect(mocks.markCharacterForSave).not.toHaveBeenCalled()
    })
})

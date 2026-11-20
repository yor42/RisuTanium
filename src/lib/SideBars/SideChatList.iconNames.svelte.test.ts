// @vitest-environment jsdom

/**
 * The REAL `SideChatList.svelte`: every icon-only control (the folder and chat row actions and the
 * bottom toolbar) has an accessible name, every Lucide glyph (including the writing badge) is hidden
 * from assistive technology, the edit toggles expose their state, the row actions answer Space as
 * well as Enter, and the list uses scheme tokens except for the user-chosen folder colours. The mount
 * and the module mocks are those of `SideChatList.replyMarks.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, test, expect, vi } from 'vitest'
import type { Database, character } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    exportChat: vi.fn(),
    importChat: vi.fn(),
    exportAllChats: vi.fn(),
    createNewChat: vi.fn(),
    removeChatConfirmed: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    changeChatTo: vi.fn(),
    createChatCopyName: vi.fn((name: string) => `${name} Copy`),
    reorderChatsKeepingCurrent: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    sortableOptions: { delay: 300, delayOnTouchOnly: true, filter: '.no-sort', onMove: () => true },
}) as unknown as typeof import('src/ts/util'))

vi.mock('sortablejs/modular/sortable.core.esm.js', () => {
    class Sortable {
        static create() { return new Sortable() }
        destroy() {}
    }
    return { default: Sortable }
})

vi.mock('./Toggles.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { registerWork, type WorkHandle } from 'src/ts/process/chatOrigin'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import SideChatList from './SideChatList.svelte'

const FOLDER_COLORS = [/^bg-(red|yellow|green|blue|indigo|purple|pink)-900$/]

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []
let handles: WorkHandle[] = []

/** One folder (red) holding `folder chat`, and one loose chat `loose chat` that is being written. */
function makeCharacter(): character {
    const chara = $state({
        type: 'character', chaId: 'c0', name: 'c0', chatPage: 0,
        chatFolders: [{ id: 'f1', name: 'Folder', folded: false, color: 'red' }],
        chats: [
            { id: 'chat-0', name: 'folder chat', message: [], note: '', localLore: [], folderId: 'f1' },
            { id: 'chat-1', name: 'loose chat', message: [], note: '', localLore: [], folderId: null },
        ],
    })
    return chara as unknown as character
}

function mountList(): HTMLElement {
    const chara = makeCharacter()
    DBState.db = { characters: [chara], personas: [], selectedPersona: 0 } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SideChatList, { target, props: { chara } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    handles.push(registerWork({ chaId: 'c0', chatId: 'chat-1' }, undefined, 'reply'))
    flushSync()
    return target
}

afterEach(async () => {
    for (const handle of handles) {
        handle.end()
    }
    handles = []
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const folderActions = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('[data-risu-chat-folder-idx="0"] > button > div > div[role="button"]'))
const folderChatActions = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('[data-risu-chat-folder-idx="0"] [data-risu-chat-idx="0"] div[role="button"]'))
const looseChatActions = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('[data-risu-chat-idx="1"] div[role="button"]'))
const bottomButtons = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('div.border-t.border-selected button'))

describe('SideChatList accessible names', () => {
    test('regression reproducer: every row action and toolbar button is named and every glyph is hidden', () => {
        const target = mountList()
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the controls carry the meaning-bearing names', () => {
        const target = mountList()
        expect(folderActions(target).map(controlName)).toEqual([
            language.chatShellFolderMenu('Folder'), language.othersUi.editMode, language.chatShellDeleteFolder,
        ])
        const chatNames = [language.chatOptions, language.othersUi.editMode, language.chatShellExportChat, language.chatShellDeleteChat]
        expect(folderChatActions(target).map(controlName)).toEqual(chatNames)
        expect(looseChatActions(target).map(controlName)).toEqual(chatNames)
        expect(bottomButtons(target).map(controlName)).toEqual([
            language.chatShellExportAllChats, language.chatShellImportChat, language.othersUi.editMode,
            language.chatShellBranches, language.bookmarks, language.chatShellNewFolder,
        ])
    })
})

describe('SideChatList keyboard and state', () => {
    test('regression reproducer: Space on a row pencil turns edit mode on, read through the toolbar pencil state', () => {
        const target = mountList()
        const toolbarPencil = () => bottomButtons(target)[2]
        expect(toolbarPencil().getAttribute('aria-pressed')).toBe('false')
        folderActions(target)[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
        flushSync()
        expect(toolbarPencil().getAttribute('aria-pressed')).toBe('true')
    })

    test('regression reproducer: Enter on a row pencil also turns edit mode on and the state follows the toggle', () => {
        const target = mountList()
        const toolbarPencil = () => bottomButtons(target)[2]
        looseChatActions(target)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        flushSync()
        expect(toolbarPencil().getAttribute('aria-pressed')).toBe('true')
        ;(toolbarPencil() as HTMLElement).click()
        flushSync()
        expect(toolbarPencil().getAttribute('aria-pressed')).toBe('false')
    })
})

describe('SideChatList colour', () => {
    test('regression reproducer: only the user-chosen folder colour remains of the default palette', () => {
        const target = mountList()
        expect(paletteClasses(target, { allow: FOLDER_COLORS })).toEqual([])
    })

    test('regression reproducer: the delete actions hover to the danger token', () => {
        const target = mountList()
        for (const trash of [folderActions(target)[2], folderChatActions(target)[3], looseChatActions(target)[3]]) {
            expect(trash.classList.contains('hover:text-draculared')).toBe(true)
        }
    })
})

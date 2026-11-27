// @vitest-environment happy-dom

/**
 * The chat sidebar parts of the W2 sweep, rendered. Mounts the REAL `ShellSidebar.svelte` with its real chat list, rows, search
 * and row menus, and asserts that each literal `data-part` sits on the intended element, found by something other than the part:
 * its tag, role, `data-action`, accessible name, text or a descendant. A part moved into a comment, onto a sibling or swapped
 * with another part fails here; the `?raw` inventory in `src/ts/themePack/sidebarParts.test.ts` cannot see that.
 *
 * MOCKED: the stores module, `characters`, `changeChatTo`, the alert module, the reply flag and localforage, as in the other
 * `ShellSidebar.*` tests. The language, the chat list model and the sheets are real.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
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

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state, selectedCharID, selIdState,
        DynamicGUI: writable(false), sideBarClosing: writable(false), sideBarStore: writable(true),
        settingsOpen: writable(false), PlaygroundStore: writable(0), OpenRealmStore: writable(false),
        bookmarkListOpen: writable(false), alertStore: writable({ type: 'none', msg: '' }), additionalHamburgerMenu: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), async () => ({ changeChatTo: vi.fn(), createChatCopyName: (n: string) => n }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null), changeChar: vi.fn(), supersedeChangeChar: vi.fn(), exportAllChats: vi.fn(), importChat: vi.fn(),
    createNewChat: vi.fn(), exportChat: vi.fn(), removeChatConfirmed: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/alert'), () => ({ alertNormal: vi.fn(), alertError: vi.fn(), alertConfirm: vi.fn() }) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { clearPending } from '../../../ts/chatShell/switchTarget.svelte'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import ShellSidebar from './ShellSidebar.svelte'

class FakeResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)

type Entry = Database['characters'][number]

const OPEN_HEIGHT = 363
const FOLDER: ChatFolder = { id: 'F1', name: 'Folder One', folded: false }

const chat = (name: string, preview: string, extra: Partial<Chat> = {}) => ({ id: `id-${name}`, name, message: [{ role: 'char', data: preview, time: 5 }], note: '', localLore: [], fmIndex: -1, ...extra } as unknown as Chat)

/** Every part name this file proved on a rendered element; compared with the names the file claims at the end. */
const proved = new Set<string>()

let app: Record<string, unknown> | null = null
let target: HTMLElement

function render(characters: Entry[]) {
    localStorage.setItem('risuChatShell.chatSort', 'manual')
    DBState.db = { characters, enableDevTools: false } as unknown as Database
    selectedCharID.set(0)
    target = document.createElement('div')
    document.body.append(target)
    app = mount(ShellSidebar, { target, props: { openGrid: vi.fn(), reseter: vi.fn() } }) as Record<string, unknown>
    flushSync()
    const scroller = target.querySelector<HTMLElement>('[data-part="chat-list-scroller"]')
    if (scroller) Object.defineProperty(scroller, 'clientHeight', { value: OPEN_HEIGHT, configurable: true })
}

function owner(chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId: 'A', name: 'Owner A', image: '', chats, chatPage: 0, chatFolders: [FOLDER], lastInteraction: 0, ...extra } as unknown as Entry
}

function click(el: Element) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    flushSync()
}

async function settle() {
    await tick()
    await Promise.resolve()
    await tick()
    flushSync()
}

/** The elements carrying `name` anywhere in the document (menus render outside the sidebar content). */
function all(name: string): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
}

/** The one element carrying `name`; records the name as proved. */
function one(name: string): HTMLElement {
    const found = all(name)
    expect(found, `exactly one element carries data-part="${name}"`).toHaveLength(1)
    proved.add(name)
    return found[0]
}

/** Every element carrying `name` has `parent` as the nearest part-carrying ancestor, so a part cannot swap with its container. */
function inside(name: string, parent: string) {
    const found = all(name)
    expect(found.length, `${name} is rendered`).toBeGreaterThan(0)
    for (const el of found) {
        expect(el.parentElement?.closest('[data-part]')?.getAttribute('data-part'), `${name} sits inside ${parent}`).toBe(parent)
    }
}

function rowHost(name: string): HTMLElement {
    return Array.from(target.querySelectorAll('[data-part="chat-row"]'))
        .find((row) => row.querySelector('[data-part="chat-row-name"]')?.textContent?.trim() === name)!
        .closest('[data-part="chat-row-host"]') as HTMLElement
}

function folderHost(): HTMLElement {
    return target.querySelector('[data-part="chat-folder"]')!.closest('[data-part="chat-folder-host"]') as HTMLElement
}

function menuItem(action: string): HTMLElement {
    return document.querySelector<HTMLElement>(`[role^="menuitem"][data-action="${action}"]`)!
}

beforeEach(() => {
    localStorage.clear()
    selectedCharID.set(-1)
    clearPending()
    takeOverlayReturnFocus()
})

afterEach(async () => {
    if (app) await unmount(app as never)
    app = null
    target?.remove()
    document.body.innerHTML = ''
    localStorage.clear()
    vi.useRealTimers()
})

describe('the sidebar header', () => {
    test('heading, new chat row, new chat button, chevron, sort label and help sit on their elements', () => {
        render([owner([chat('Zeta', 'zeta-preview')])])
        const heading = one('chat-sidebar-heading')
        expect(heading.tagName).toBe('H2')
        expect(heading.textContent).toBe('Owner A')

        const row = one('chat-sidebar-new-row')
        const newChat = one('chat-sidebar-new-chat')
        expect(newChat.tagName).toBe('BUTTON')
        expect(newChat.textContent?.trim()).toBe(language.newChat)
        expect(row.contains(newChat)).toBe(true)
        expect(newChat.hasAttribute('aria-haspopup')).toBe(false)

        const toggle = one('chat-sidebar-new-menu-toggle')
        expect(toggle.tagName).toBe('BUTTON')
        expect(toggle.getAttribute('aria-label')).toBe(language.chatShellNewChatMenu)
        expect(toggle.getAttribute('aria-haspopup')).toBe('menu')
        expect(row.contains(toggle)).toBe(true)
        expect(toggle).not.toBe(newChat)

        const label = one('sidebar-sort-label')
        expect(label.textContent).toBe(language.chatShellSortLabel)
        expect(target.querySelector('select')!.getAttribute('aria-labelledby')).toBe(label.id)
        const help = one('sidebar-sort-help')
        expect(help.textContent).toBe(language.chatShellOnThisDevice)
        expect(target.querySelector('select')!.getAttribute('aria-describedby')).toContain(help.id)

        inside('chat-sidebar-heading', 'chat-sidebar-header')
        inside('chat-sidebar-new-row', 'chat-sidebar-header')
        inside('chat-sidebar-new-chat', 'chat-sidebar-new-row')
        inside('chat-sidebar-new-menu-toggle', 'chat-sidebar-new-row')
        inside('sidebar-sort-label', 'chat-sidebar-header')
        inside('sidebar-sort-help', 'chat-sidebar-header')
        expect(row.parentElement?.getAttribute('data-part')).toBe('chat-sidebar-header')
    })

    test('the new chat menu and its two items', () => {
        render([owner([chat('Zeta', 'zeta-preview')])])
        click(one('chat-sidebar-new-menu-toggle'))
        const menu = one('chat-sidebar-new-menu')
        expect(menu.getAttribute('role')).toBe('menu')
        const importItem = one('chat-sidebar-import')
        const exportAll = one('chat-sidebar-export-all')
        expect(importItem.getAttribute('role')).toBe('menuitem')
        expect(importItem.textContent?.trim()).toBe(language.chatShellImportChat)
        expect(exportAll.getAttribute('role')).toBe('menuitem')
        expect(exportAll.textContent?.trim()).toBe(language.chatShellExportAllChats)
        expect(menu.contains(importItem) && menu.contains(exportAll)).toBe(true)
        inside('chat-sidebar-new-menu', 'chat-sidebar-new-row')
        inside('chat-sidebar-import', 'chat-sidebar-new-menu')
        inside('chat-sidebar-export-all', 'chat-sidebar-new-menu')
    })

    test('the search box wraps the text field', () => {
        render([owner([chat('Zeta', 'zeta-preview')])])
        const box = one('chat-sidebar-search-box')
        const field = box.querySelector('input')
        expect(field?.getAttribute('type')).toBe('text')
        expect(field?.getAttribute('placeholder')).toBe(language.chatShellSearchPlaceholder)
        inside('chat-sidebar-search-box', 'chat-sidebar-search')
        inside('chat-sidebar-search-field', 'chat-sidebar-search-box')
        expect(field?.parentElement).toBe(box)
    })
})

describe('chat rows and folder rows', () => {
    test('the name line and the meta line of a chat row hold the name and the preview', () => {
        render([owner([chat('Zeta', 'zeta-preview'), chat('Yota', 'yota-preview')])])
        const host = rowHost('Zeta')
        const nameLine = host.querySelector<HTMLElement>('[data-part="chat-row-name-line"]')!
        const meta = host.querySelector<HTMLElement>('[data-part="chat-row-meta"]')!
        expect(all('chat-row-name-line')).toHaveLength(2)
        expect(all('chat-row-meta')).toHaveLength(2)
        proved.add('chat-row-name-line')
        proved.add('chat-row-meta')
        expect(nameLine.parentElement?.getAttribute('role')).toBe('treeitem')
        expect(meta.parentElement?.getAttribute('role')).toBe('treeitem')
        expect(nameLine.textContent).toContain('Zeta')
        expect(nameLine.textContent).not.toContain('zeta-preview')
        expect(meta.textContent).toContain('zeta-preview')
        expect(meta.textContent).not.toContain('Zeta')
        inside('chat-row-name-line', 'chat-row')
        inside('chat-row-meta', 'chat-row')
        inside('chat-row-name', 'chat-row-name-line')
    })

    test('the folder count is the count of its chats, on the folder row', () => {
        render([owner([chat('Zeta', 'zeta-preview', { folderId: 'F1' }), chat('Yota', 'yota-preview', { folderId: 'F1' }), chat('Xi', 'xi-preview')])])
        const count = one('chat-folder-count')
        expect(count.textContent?.trim()).toBe('2')
        const folderRow = count.parentElement!
        expect(folderRow.getAttribute('role')).toBe('treeitem')
        expect(folderRow.getAttribute('data-part')).toBe('chat-folder')
        expect(folderRow.textContent).toContain('Folder One')
        inside('chat-folder-count', 'chat-folder')
    })

    test('Edit order shows the move cluster of a chat row and of a folder row, each named for its own row', () => {
        render([owner([chat('Zeta', 'zeta-preview', { folderId: 'F1' }), chat('Xi', 'xi-preview')])])
        click(target.querySelector('[data-part="sidebar-edit-order"]')!)
        const chatActions = rowHost('Xi').querySelector<HTMLElement>('[data-part="chat-row-actions"]')!
        expect(chatActions).not.toBeNull()
        proved.add('chat-row-actions')
        const folderActions = one('chat-folder-actions')
        expect(all('chat-row-actions')).toHaveLength(2)
        expect(folderActions.closest('[data-part="chat-folder-host"]')).toBe(folderHost())
        expect(chatActions.closest('[data-part="chat-row-host"]')).toBe(rowHost('Xi'))
        const upLabel = (el: HTMLElement) => el.querySelector('button[aria-label]')?.getAttribute('aria-label')
        expect(upLabel(folderActions)).toBe(`${language.chatShellMoveUp} Folder One`)
        expect(upLabel(chatActions)).toBe(`${language.chatShellMoveUp} Xi`)
        expect(folderActions.querySelectorAll('button')).toHaveLength(2)
        expect(chatActions.querySelectorAll('button')).toHaveLength(2)
        inside('chat-row-actions', 'chat-row-host')
        inside('chat-folder-actions', 'chat-folder-host')
    })

    test('the folder rename wrapper holds the folder name field', async () => {
        render([owner([chat('Zeta', 'zeta-preview', { folderId: 'F1' }), chat('Xi', 'xi-preview')])])
        click(folderHost().querySelector('[data-part="chat-folder-menu"]')!)
        click(menuItem('folder-rename'))
        await settle()
        const editing = one('chat-folder-editing')
        const input = editing.querySelector('input')!
        expect(input.getAttribute('aria-label')).toBe(language.chatShellRenameFolder)
        expect(input.getAttribute('data-part')).toBe('chat-folder-name-input')
        expect(editing.closest('[data-part="chat-folder-host"]')).not.toBeNull()
        expect(target.querySelector('[data-part="chat-folder"]')).toBeNull()
        inside('chat-folder-editing', 'chat-folder-host')
        inside('chat-folder-name-input', 'chat-folder-editing')
    })
})

describe('the search results', () => {
    test('a result row carries the character name, the chat name and the chat preview', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        render([
            owner([chat('Match one', 'one-preview'), chat('Other', 'other-preview')], { name: 'Match A' }),
            { type: 'character', chaId: 'B', name: 'Match B', image: '', chats: [], chatPage: 0, chatFolders: [], lastInteraction: 0 } as unknown as Entry,
        ])
        const field = target.querySelector<HTMLInputElement>('[data-part="chat-sidebar-search-field"]')!
        field.value = 'match'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        vi.advanceTimersByTime(150)
        flushSync()
        const characterNames = all('chat-search-character-name')
        proved.add('chat-search-character-name')
        expect(characterNames.map((el) => el.textContent)).toEqual(['Match A', 'Match B'])
        const characterName = characterNames[1]
        expect(characterName.parentElement?.getAttribute('role')).toBe('option')
        expect(characterName.parentElement?.getAttribute('data-part')).toBe('chat-search-character')
        const chatName = one('chat-search-chat-name')
        const chatPreview = one('chat-search-chat-preview')
        expect(chatName.textContent).toBe('Match one')
        expect(chatPreview.textContent).toBe('one-preview')
        expect(chatName.parentElement).toBe(chatPreview.parentElement)
        expect(chatName.parentElement?.getAttribute('data-part')).toBe('chat-search-chat')
        inside('chat-search-character-name', 'chat-search-character')
        inside('chat-search-chat-name', 'chat-search-chat')
        inside('chat-search-chat-preview', 'chat-search-chat')
    })
})

describe('the row menu', () => {
    // part -> the data-action, role and text the element must carry.
    const CHAT_MENU: ReadonlyArray<readonly [part: string, action: string, role: string, text: () => string]> = [
        ['row-menu-rename', 'rename', 'menuitem', () => language.chatShellRename],
        ['row-menu-move', 'move', 'menuitem', () => language.chatShellMoveToFolder],
        ['row-menu-duplicate', 'duplicate', 'menuitem', () => language.chatShellDuplicate],
        ['row-menu-export', 'export', 'menuitem', () => language.chatShellExportChat],
        ['row-menu-delete', 'delete', 'menuitem', () => language.chatShellDeleteChat],
    ]
    const MOVE_MENU: ReadonlyArray<readonly [part: string, action: string, role: string, text: () => string]> = [
        ['row-menu-no-folder', 'move-none', 'menuitemradio', () => language.chatShellNoFolder],
        ['row-menu-folder-option', 'move-F1', 'menuitemradio', () => 'Folder One'],
        ['row-menu-new-folder', 'move-new', 'menuitem', () => language.chatShellNewFolder],
    ]

    function expectItem(part: string, action: string, role: string, text: string) {
        const el = one(part)
        expect(el.tagName, part).toBe('BUTTON')
        expect(el.getAttribute('data-action'), part).toBe(action)
        expect(el.getAttribute('role'), part).toBe(role)
        expect(el.textContent?.trim(), part).toBe(text)
    }

    test('each chat menu item carries its own part, and the delete item is the destructive one', () => {
        render([owner([chat('Zeta', 'zeta-preview'), chat('Xi', 'xi-preview')])])
        click(rowHost('Xi').querySelector('[data-part="chat-row-menu"]')!)
        for (const [part, action, role, text] of CHAT_MENU) {
            expectItem(part, action, role, text())
            inside(part, 'row-menu')
        }
        expect(one('row-menu-delete').hasAttribute('data-destructive')).toBe(true)
        for (const part of ['row-menu-rename', 'row-menu-move', 'row-menu-duplicate', 'row-menu-export']) {
            expect(one(part).hasAttribute('data-destructive'), part).toBe(false)
        }
    })

    test('the move list carries the three move parts', () => {
        render([owner([chat('Zeta', 'zeta-preview'), chat('Xi', 'xi-preview')])])
        click(rowHost('Xi').querySelector('[data-part="chat-row-menu"]')!)
        click(menuItem('move'))
        for (const [part, action, role, text] of MOVE_MENU) {
            expectItem(part, action, role, text())
            inside(part, 'row-menu-group')
        }
        expect(one('row-menu-no-folder').getAttribute('aria-checked')).toBe('true')
    })

    test('each folder menu item carries its own part, and the delete item is the destructive one', () => {
        render([owner([chat('Zeta', 'zeta-preview', { folderId: 'F1' }), chat('Xi', 'xi-preview')])])
        click(folderHost().querySelector('[data-part="chat-folder-menu"]')!)
        expectItem('row-menu-folder-rename', 'folder-rename', 'menuitem', language.chatShellRenameFolder)
        expectItem('row-menu-folder-colour', 'folder-colour', 'menuitem', language.changeFolderColor)
        expectItem('row-menu-folder-delete', 'folder-delete', 'menuitem', language.chatShellDeleteFolder)
        expect(one('row-menu-folder-delete').hasAttribute('data-destructive')).toBe(true)
        expect(one('row-menu-folder-rename').hasAttribute('data-destructive')).toBe(false)
        expect(one('row-menu-folder-colour').hasAttribute('data-destructive')).toBe(false)
        for (const part of ['row-menu-folder-rename', 'row-menu-folder-colour', 'row-menu-folder-delete']) inside(part, 'row-menu')
    })

    test('the colour list carries one colour-option part per palette entry', () => {
        render([owner([chat('Zeta', 'zeta-preview', { folderId: 'F1' }), chat('Xi', 'xi-preview')])])
        click(folderHost().querySelector('[data-part="chat-folder-menu"]')!)
        click(menuItem('folder-colour'))
        const options = all('row-menu-colour-option')
        proved.add('row-menu-colour-option')
        expect(options).toHaveLength(8)
        for (const option of options) {
            expect(option.getAttribute('role')).toBe('menuitemradio')
            expect(option.getAttribute('data-action')).toMatch(/^colour-/)
        }
        expect(document.querySelectorAll('[role^="menuitem"][data-action^="colour-"]')).toHaveLength(8)
        inside('row-menu-colour-option', 'row-menu-group')
    })
})

describe('coverage of this file', () => {
    test('the names proved here are exactly the sidebar parts this file claims', () => {
        // The tests above ran first in file order; every claimed part was proved on a rendered element.
        expect(Array.from(proved).sort()).toEqual([...CLAIMED].sort())
    })
})

/** The parts of the W2 sweep proved by the real sidebar (the More menu has its own file). */
const CLAIMED: readonly string[] = [
    'chat-sidebar-heading', 'chat-sidebar-new-row', 'chat-sidebar-new-chat', 'chat-sidebar-new-menu-toggle', 'chat-sidebar-new-menu',
    'chat-sidebar-import', 'chat-sidebar-export-all', 'sidebar-sort-label', 'sidebar-sort-help', 'chat-sidebar-search-box',
    'chat-row-name-line', 'chat-row-meta', 'chat-row-actions', 'chat-folder-count', 'chat-folder-actions', 'chat-folder-editing',
    'chat-search-character-name', 'chat-search-chat-name', 'chat-search-chat-preview',
    'row-menu-rename', 'row-menu-move', 'row-menu-no-folder', 'row-menu-folder-option', 'row-menu-new-folder', 'row-menu-duplicate',
    'row-menu-export', 'row-menu-delete', 'row-menu-folder-rename', 'row-menu-folder-colour', 'row-menu-colour-option', 'row-menu-folder-delete',
]

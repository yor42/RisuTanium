// @vitest-environment happy-dom

/**
 * `ShellRowMenu.svelte`: the menu of a chat row or a folder header in the new shell's sidebar.
 *
 * Invariants exercised here:
 * - A chat menu offers Rename, Move to folder, Duplicate, Export and Delete; a folder menu offers Rename, Colour and Delete.
 * - The only chat of a character cannot be deleted and says why; an archived chat cannot be duplicated and says why. A
 *   disabled item does nothing when it is activated.
 * - Move to folder lists "No folder" (checked when the chat is unfiled), every folder (the current one checked) and New
 *   folder; each reports one choice.
 * - Escape closes the menu through `onclose`; a closed menu renders nothing.
 *
 * MOCKED: the stores module and the localforage storage the shell modules import; the sheet and the language are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Chat, ChatFolder, Database } from '../../../ts/storage/database.svelte'
import type { MenuTarget } from '../../../ts/chatShell/chatListEdits'
import { coldStorageHeader } from '../../../ts/process/coldstorageData'
import { language } from 'src/lang'
import ShellRowMenu from './ShellRowMenu.svelte'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selIdState = $state({ selId: -1 })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState,
    } as unknown as typeof import('src/ts/stores.svelte')
})

function chat(name: string, extra: Partial<Chat> = {}): Chat {
    return { id: `id-${name}`, name, message: [{ role: 'char', data: 'hello', time: 1 }], note: '', localLore: [], fmIndex: -1, ...extra } as unknown as Chat
}

const folders: ChatFolder[] = [{ id: 'f1', name: 'Alpha', folded: false }, { id: 'f2', name: 'Beta', folded: false }]

let apps: Array<Record<string, unknown>> = []
let host: HTMLElement

function handlers() {
    return {
        onclose: vi.fn(),
        onrename: vi.fn(),
        onmove: vi.fn(),
        onnewfolder: vi.fn(),
        onduplicate: vi.fn(),
        onexport: vi.fn(),
        ondelete: vi.fn(),
        onfoldercolor: vi.fn(),
        onfolderdelete: vi.fn(),
    }
}

function render(target: MenuTarget | null, props: { soleChat?: boolean } = {}) {
    host = document.createElement('div')
    document.body.append(host)
    const calls = handlers()
    apps.push(mount(ShellRowMenu, { target: host, props: { target, folders, soleChat: false, ...props, ...calls } }) as Record<string, unknown>)
    flushSync()
    return calls
}

function item(action: string): HTMLButtonElement {
    const found = document.querySelector<HTMLButtonElement>(`[role^="menuitem"][data-action="${action}"]`)
    if (!found) {
        throw new Error(`no menu item ${action}`)
    }
    return found
}

function actions(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role^="menuitem"][data-action]')).map((el) => el.dataset.action ?? '')
}

function click(el: HTMLElement) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    flushSync()
}

afterEach(() => {
    for (const app of apps) {
        unmount(app)
    }
    apps = []
    flushSync()
    host?.remove()
    document.body.innerHTML = ''
})

describe('chat menu', () => {
    test('offers the five chat actions and reports each one', () => {
        const row = chat('Row')
        const calls = render({ kind: 'chat', chat: row, opener: null })
        expect(actions()).toEqual(['rename', 'move', 'duplicate', 'export', 'delete'])
        click(item('rename'))
        expect(calls.onrename).toHaveBeenCalledTimes(1)
        click(item('duplicate'))
        expect(calls.onduplicate).toHaveBeenCalledTimes(1)
        click(item('export'))
        expect(calls.onexport).toHaveBeenCalledTimes(1)
        click(item('delete'))
        expect(calls.ondelete).toHaveBeenCalledTimes(1)
    })

    // TD9: the only chat cannot be deleted; the reason is shown, and activating the item does nothing.
    test('the only chat cannot be deleted and the menu says why', () => {
        const calls = render({ kind: 'chat', chat: chat('Only'), opener: null }, { soleChat: true })
        const del = item('delete')
        expect(del.disabled || del.getAttribute('aria-disabled') === 'true').toBe(true)
        expect(document.body.textContent).toContain(language.chatShellDeleteOnlyChat)
        click(del)
        expect(calls.ondelete).not.toHaveBeenCalled()
        // The other actions stay available.
        expect(item('rename').disabled).toBe(false)
    })

    // M60: an archived chat is a placeholder, so it cannot be duplicated.
    test('an archived chat cannot be duplicated and the menu says why', () => {
        const archived = chat('Old', { message: [{ role: 'char', data: `${coldStorageHeader}abc`, time: 1 }] as unknown as Chat['message'] })
        const calls = render({ kind: 'chat', chat: archived, opener: null })
        const duplicate = item('duplicate')
        expect(duplicate.disabled || duplicate.getAttribute('aria-disabled') === 'true').toBe(true)
        expect(document.body.textContent).toContain(language.chatShellDuplicateArchived)
        click(duplicate)
        expect(calls.onduplicate).not.toHaveBeenCalled()
        expect(item('delete').disabled).toBe(false)
    })

    test('a normal chat shows no reason lines', () => {
        render({ kind: 'chat', chat: chat('Fine'), opener: null })
        expect(document.body.textContent).not.toContain(language.chatShellDeleteOnlyChat)
        expect(document.body.textContent).not.toContain(language.chatShellDuplicateArchived)
    })

    test('Move to folder lists no folder, each folder and New folder, with the current one checked', () => {
        const calls = render({ kind: 'chat', chat: chat('Filed', { folderId: 'f2' }), opener: null })
        expect(document.querySelector('[data-action="move-none"]')).toBeNull()
        click(item('move'))
        expect(item('move').getAttribute('aria-expanded')).toBe('true')
        expect(actions()).toEqual(['rename', 'move', 'move-none', 'move-f1', 'move-f2', 'move-new', 'duplicate', 'export', 'delete'])
        expect(item('move-none').getAttribute('aria-checked')).toBe('false')
        expect(item('move-f1').getAttribute('aria-checked')).toBe('false')
        expect(item('move-f2').getAttribute('aria-checked')).toBe('true')
        click(item('move-f1'))
        expect(calls.onmove).toHaveBeenLastCalledWith('f1')
        click(item('move-none'))
        expect(calls.onmove).toHaveBeenLastCalledWith(null)
        click(item('move-new'))
        expect(calls.onnewfolder).toHaveBeenCalledTimes(1)
    })

    test('an unfiled chat has "No folder" checked', () => {
        render({ kind: 'chat', chat: chat('Loose'), opener: null })
        click(item('move'))
        expect(item('move-none').getAttribute('aria-checked')).toBe('true')
    })

    test('the menu is named after the chat', () => {
        render({ kind: 'chat', chat: chat('Row'), opener: null })
        expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(language.chatShellRowMenu('Row'))
    })

    test('Escape closes the menu through onclose', () => {
        const calls = render({ kind: 'chat', chat: chat('Row'), opener: null })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        expect(calls.onclose).toHaveBeenCalledTimes(1)
    })
})

describe('folder menu', () => {
    test('offers Rename, Colour and Delete', () => {
        const calls = render({ kind: 'folder', folder: folders[0], opener: null })
        expect(actions()).toEqual(['folder-rename', 'folder-colour', 'folder-delete'])
        expect(item('folder-rename').textContent?.trim()).toBe(language.chatShellRenameFolder)
        expect(item('folder-delete').textContent?.trim()).toBe(language.chatShellDeleteFolder)
        click(item('folder-rename'))
        expect(calls.onrename).toHaveBeenCalledTimes(1)
        click(item('folder-delete'))
        expect(calls.onfolderdelete).toHaveBeenCalledTimes(1)
    })

    test('Colour lists the palette and reports the stored value', () => {
        const calls = render({ kind: 'folder', folder: { ...folders[0], color: 'blue' }, opener: null })
        click(item('folder-colour'))
        const colours = Array.from(document.querySelectorAll<HTMLElement>('[data-action^="colour-"]')).map((el) => el.dataset.action)
        expect(colours).toEqual(['colour-red', 'colour-green', 'colour-blue', 'colour-yellow', 'colour-indigo', 'colour-purple', 'colour-pink', 'colour-default'])
        expect(item('colour-blue').getAttribute('aria-checked')).toBe('true')
        click(item('colour-green'))
        expect(calls.onfoldercolor).toHaveBeenCalledWith('green')
    })

    test('is named after the folder', () => {
        render({ kind: 'folder', folder: folders[1], opener: null })
        expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(language.chatShellFolderMenu('Beta'))
    })
})

test('a closed menu renders nothing', () => {
    render(null)
    expect(document.querySelector('[role="menu"]')).toBeNull()
})

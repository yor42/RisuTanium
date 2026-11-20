// @vitest-environment jsdom

/**
 * The REAL `Others/ChatList.svelte`: every icon-only control (close, the per-chat download and delete
 * divs, new chat, import, edit) is named, every glyph is hidden, the edit toggle exposes its state, the
 * row actions answer Enter and Space on themselves, and the list uses scheme tokens except for the
 * `bg-black/50` scrim.
 *
 * MOCKED: the stores, `src/ts/characters` and `src/ts/globalApi.svelte`, reduced to what the list reads.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const spies = vi.hoisted(() => ({ exportChat: vi.fn(), removeChatConfirmed: vi.fn(async () => false) }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    exportChat: spies.exportChat,
    importChat: vi.fn(),
    createNewChat: vi.fn(() => 0),
    removeChatConfirmed: spies.removeChatConfirmed,
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    changeChatTo: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import ChatList from './ChatList.svelte'

let target: HTMLElement | null = null
let instance: ReturnType<typeof mount> | null = null

function showList(): HTMLElement {
    DBState.db = {
        characters: [{ chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, chats: [
            { id: 'a', name: 'First', message: [], note: '', localLore: [] },
            { id: 'b', name: 'Second', message: [], note: '', localLore: [] },
        ] }],
        personas: [], selectedPersona: 0,
    } as unknown as Database
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(ChatList, { target, props: {} })
    flushSync()
    return target
}

afterEach(async () => {
    if (instance) await unmount(instance)
    target?.remove()
    instance = null
    target = null
    spies.exportChat.mockClear()
    spies.removeChatConfirmed.mockClear()
})

const rowDivs = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('div[role="button"]'))
const toolbar = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('div.mt-2 button'))

describe('ChatList accessible names', () => {
    test('regression reproducer: every control is named and every glyph hidden', () => {
        const root = showList()
        expect(unnamedControls(root)).toEqual([])
        expect(exposedIcons(root)).toEqual([])
    })

    test('regression reproducer: the controls carry the meaning-bearing names', () => {
        const root = showList()
        expect(controlName(root.querySelector('div.grow.flex.justify-end > button')!)).toBe(language.uiCommon.close)
        expect(rowDivs(root).map(controlName)).toEqual([
            language.chatShellExportChat, language.chatShellDeleteChat, language.chatShellExportChat, language.chatShellDeleteChat,
        ])
        expect(toolbar(root).map(controlName)).toEqual([language.newChat, language.chatShellImportChat, language.othersUi.editMode])
    })
})

describe('ChatList keyboard, state and colour', () => {
    test.each(['Enter', ' '])('regression reproducer: %j on a row download div exports the chat', (key) => {
        const root = showList()
        rowDivs(root)[0].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        expect(spies.exportChat).toHaveBeenCalledWith(0)
    })

    test('regression reproducer: the edit button exposes its state', () => {
        const root = showList()
        const edit = toolbar(root)[2]
        expect(edit.getAttribute('aria-pressed')).toBe('false')
        edit.click()
        flushSync()
        expect(edit.getAttribute('aria-pressed')).toBe('true')
    })

    test('regression reproducer: only the scrim remains of the default palette and the delete div hovers to the danger token', () => {
        const root = showList()
        expect(paletteClasses(root, { allow: [/^bg-black\/50$/] })).toEqual([])
        expect(rowDivs(root)[1].classList.contains('hover:text-draculared')).toBe(true)
    })
})

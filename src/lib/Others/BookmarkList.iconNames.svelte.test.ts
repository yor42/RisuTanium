// @vitest-environment jsdom

/**
 * The REAL `Others/BookmarkList.svelte`: every icon-only control is named, every glyph is hidden, the
 * expand-all button is named by the action it performs, each row exposes `aria-expanded`, and a row
 * toggles from the keyboard only when the key reaches the row itself, never from a control nested in
 * it. The list uses scheme tokens except for the `bg-black/50` scrim.
 *
 * MOCKED: `Chat.svelte` (a marker element stands for an expanded row), the image lookups, the process
 * modules and the parser; the stores and `src/ts/util` are the real ones.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../ChatScreens/Chat.svelte', () => ({
    default: (anchor: Comment) => {
        const marker = document.createElement('div')
        marker.setAttribute('data-part', 'chat-standin')
        anchor.parentNode?.insertBefore(marker, anchor)
        return { destroy: () => {} }
    },
}))
vi.mock('src/ts/media/charImageLookups', () => ({
    useCharImageLookups: () => ({ get: () => '' }),
}))
vi.mock('src/ts/process/composerActions.svelte', () => ({
    branchAt: vi.fn(),
    isComposerBusy: () => false,
}))
vi.mock('src/ts/process/index.svelte', () => ({
    doingChat: writable(false),
}))
vi.mock('src/ts/parser/parser.svelte', () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    ParseMarkdown: vi.fn(async (text: string) => text),
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('src/ts/alert', () => ({
    alertInput: vi.fn(async () => ''),
}))

import { DBState, bookmarkListOpen, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import BookmarkList from './BookmarkList.svelte'

let target: HTMLElement | null = null
let instance: ReturnType<typeof mount> | null = null

function showList(): HTMLElement {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'Char', type: 'character', chatPage: 0, image: '', largePortrait: false,
            chats: [{
                id: 'chat-0', name: 'chat', note: '', localLore: [], scriptstate: {},
                message: [
                    { role: 'user', data: 'first message text', chatId: 'm0' },
                    { role: 'char', data: 'second message text', chatId: 'm1' },
                ],
                bookmarks: ['m0', 'm1'],
                bookmarkNames: {},
            }],
        }],
        personas: [], selectedPersona: 0,
    } as never
    selectedCharID.set(0)
    bookmarkListOpen.set(true)
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(BookmarkList, { target, props: {} })
    flushSync()
    return target
}

afterEach(async () => {
    if (instance) await unmount(instance)
    target?.remove()
    instance = null
    target = null
    bookmarkListOpen.set(false)
})

const headerButtons = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('div.ml-auto > button'))
const rows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('div[role="button"]'))
const nested = (root: HTMLElement, row: number) => Array.from(rows(root)[row].querySelectorAll<HTMLElement>('button'))
const key = (name: string) => new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })

describe('BookmarkList accessible names', () => {
    test('regression reproducer: every control is named and every glyph hidden', () => {
        const root = showList()
        expect(unnamedControls(root)).toEqual([])
        expect(exposedIcons(root)).toEqual([])
    })

    test('regression reproducer: the controls carry the meaning-bearing names', () => {
        const root = showList()
        expect(headerButtons(root).map(controlName)).toEqual([language.expandAll, language.uiCommon.close])
        expect(nested(root, 0).map(controlName)).toEqual([language.goToChat, language.chatShellRename, language.remove])
    })

    test('regression reproducer: expand all renames its button to the next action and expands every row', () => {
        const root = showList()
        expect(rows(root).map((row) => row.getAttribute('aria-expanded'))).toEqual(['false', 'false'])
        headerButtons(root)[0].click()
        flushSync()
        expect(controlName(headerButtons(root)[0])).toBe(language.collapseAll)
        expect(rows(root).map((row) => row.getAttribute('aria-expanded'))).toEqual(['true', 'true'])
        expect(exposedIcons(root)).toEqual([])
    })
})

describe('BookmarkList keyboard', () => {
    test.each(['Enter', ' '])('regression reproducer: %j on the row itself expands it', (name) => {
        const root = showList()
        rows(root)[0].dispatchEvent(key(name))
        flushSync()
        expect(rows(root)[0].getAttribute('aria-expanded')).toBe('true')
        expect(root.querySelectorAll('[data-part="chat-standin"]')).toHaveLength(1)
    })

    test('regression reproducer: Enter on a control nested in the row does not toggle the row', () => {
        const root = showList()
        const remove = nested(root, 0)[2]
        remove.dispatchEvent(key('Enter'))
        flushSync()
        expect(root.querySelectorAll('[data-part="chat-standin"]')).toHaveLength(0)
        expect(rows(root)[0].getAttribute('aria-expanded')).toBe('false')
    })

    test('compatibility guard (passes before and after): Space on a nested control does not toggle the row', () => {
        const root = showList()
        nested(root, 0)[2].dispatchEvent(key(' '))
        flushSync()
        expect(root.querySelectorAll('[data-part="chat-standin"]')).toHaveLength(0)
    })
})

describe('BookmarkList colour', () => {
    test('regression reproducer: only the scrim remains of the default palette and the remove button hovers to the danger token', () => {
        const root = showList()
        expect(paletteClasses(root, { allow: [/^bg-black\/50$/] })).toEqual([])
        expect(nested(root, 0)[2].classList.contains('hover:text-draculared')).toBe(true)
    })
})

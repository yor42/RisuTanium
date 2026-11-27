// @vitest-environment jsdom

/**
 * `BookmarkList.svelte` carries the overlay vocabulary on its real elements (#438 W3-2). The REAL component is mounted; each element is
 * found by tag, role, aria-label, text or structure, never by its part, and the part is asserted on it, together with its parent. The outline
 * test pins the whole nesting, so a part that is dropped, renamed, swapped with a sibling or its parent, or moved into a comment fails.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `Chat.svelte` (a marker element stands for an expanded row), the image lookups, the process modules, the parser and `alertInput`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
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
    isComposerBusy: () => false, isComposerBusyIn: () => false,
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
import BookmarkList from './BookmarkList.svelte'

let target: HTMLElement | null = null
let instance: ReturnType<typeof mount> | null = null

function showList(bookmarks: string[] = ['m0', 'm1']): HTMLElement {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'Char', type: 'character', chatPage: 0, image: '', largePortrait: false,
            chats: [{
                id: 'chat-0', name: 'chat', note: '', localLore: [], scriptstate: {},
                message: [
                    { role: 'user', data: 'first message text', chatId: 'm0' },
                    { role: 'char', data: 'second message text', chatId: 'm1' },
                ],
                bookmarks,
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

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null
const rows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]'))
const key = (name: string) => new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

describe('BookmarkList overlay parts', () => {
    test('acceptance: the backdrop, frame, header, title, controls and list sit where the markup puts them', () => {
        const overlay = showList().firstElementChild as HTMLElement
        expect(partOf(overlay)).toBe('modal-bookmark-list')
        const frame = overlay.firstElementChild as HTMLElement
        expect(partOf(frame)).toBe('modal-frame')
        const header = frame.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        const title = header.querySelector('h2') as HTMLElement
        expect(title.textContent).toBe(language.bookmarks)
        expect(partOf(title)).toBe('modal-title')
        expect(title.parentElement).toBe(header)
        const controls = title.nextElementSibling as HTMLElement
        expect(controls.tagName).toBe('DIV')
        expect(partOf(controls)).toBe('modal-controls')
        expect(controls.parentElement).toBe(header)
        const list = header.nextElementSibling as HTMLElement
        expect(partOf(list)).toBe('modal-list')
        expect(list.parentElement).toBe(frame)
    })

    test('acceptance: the expand-all button and the X are found by their label', () => {
        const root = showList()
        const controls = root.querySelector('h2')!.nextElementSibling as HTMLElement
        const expand = root.querySelector(`button[aria-label="${language.expandAll}"]`) as HTMLElement
        expect(partOf(expand)).toBe('modal-action')
        expect(expand.parentElement).toBe(controls)
        const close = root.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(controls)
    })

    test('acceptance: each bookmark row, its label, its button group and its three buttons', () => {
        const root = showList()
        const list = root.querySelector('h2')!.parentElement!.nextElementSibling as HTMLElement
        const found = rows(root)
        expect(found).toHaveLength(2)
        const labels = ['first message text...', 'second message text...']
        found.forEach((row, index) => {
            expect(partOf(row)).toBe('modal-row')
            expect(partOf(row.parentElement)).toBeNull()
            expect(row.parentElement!.parentElement).toBe(list)
            const label = row.querySelector('span') as HTMLElement
            expect(label.textContent).toBe(labels[index])
            expect(partOf(label)).toBe('modal-text')
            expect(label.parentElement).toBe(row)
            const group = label.nextElementSibling as HTMLElement
            expect(group.tagName).toBe('DIV')
            expect(partOf(group)).toBe('modal-controls')
            expect(group.parentElement).toBe(row)
            for (const name of [language.goToChat, language.chatShellRename, language.remove]) {
                const button = group.querySelector(`button[aria-label="${name}"]`) as HTMLElement
                expect(partOf(button), name).toBe('modal-action')
                expect(button.parentElement, name).toBe(group)
            }
        })
    })

    test('acceptance: the empty state is a modal-text paragraph directly in the frame', () => {
        const root = showList([])
        const empty = Array.from(root.querySelectorAll('p')).find((p) => p.textContent === language.noBookmarks) as HTMLElement
        expect(partOf(empty)).toBe('modal-text')
        expect(partOf(empty.parentElement)).toBe('modal-frame')
        expect(root.querySelector('[data-part="modal-list"]')).toBeNull()
        expect(outline(root)).toBe('modal-bookmark-list(modal-frame(modal-header(modal-title modal-controls(modal-action modal-close)) modal-text))')
    })

    test('acceptance: the whole nesting of the populated list', () => {
        const row = 'modal-row(modal-text modal-controls(modal-action modal-action modal-action))'
        expect(outline(showList())).toBe(`modal-bookmark-list(modal-frame(modal-header(modal-title modal-controls(modal-action modal-close)) modal-list(${row} ${row})))`)
    })

    test('guard: the X closes the list and a row toggles from a click', () => {
        const root = showList()
        const first = rows(root)[0]
        expect(first.getAttribute('aria-expanded')).toBe('false')
        first.click()
        flushSync()
        expect(rows(root)[0].getAttribute('aria-expanded')).toBe('true')
        expect(get(bookmarkListOpen)).toBe(true)
        ;(root.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement).click()
        expect(get(bookmarkListOpen)).toBe(false)
    })

    test('guard: the row key handler and the expanded preview container carry no part of their own', () => {
        const root = showList()
        rows(root)[0].dispatchEvent(key('Enter'))
        flushSync()
        const standin = root.querySelector('[data-part="chat-standin"]') as HTMLElement
        expect(partOf(standin.parentElement)).toBeNull()
        expect(partOf(standin.parentElement!.parentElement)).toBeNull()
    })
})

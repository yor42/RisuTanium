// @vitest-environment jsdom
/**
 * The jump sheet. REAL: `JumpSheet.svelte`, `jumpTarget.ts`, the IME guard. MOCKED: the sheet frame (renders its content while open),
 * the toast post and the language table.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Chat } from '../../ts/storage/database.svelte'

const toast = vi.hoisted(() => ({ post: undefined as unknown as Mock<(init: { kind: string, text: string }) => number> }))

vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: (init: { kind: string, text: string }) => toast.post(init) }))
vi.mock('./ShellSheet.svelte', () => ({ default: (anchor: Comment, props: { open: boolean, children: (anchor: Comment) => void }) => {
    if (props.open) props.children(anchor)
    return {}
} }))
vi.mock('../../lang', () => ({
    language: {
        chatShellJumpSheet: 'Go to', chatShellJumpFirst: 'First message', chatShellJumpNewest: 'Newest message',
        chatShellJumpDate: 'Go to date', chatShellJumpNumber: 'Go to message number', chatShellJumpGo: 'Go',
        chatShellNoTimeSkipped: 'Untimed skipped', chatShellNumberError: (count: number) => `Enter 1 to ${count}`,
        chatShellBookmarksHeading: (count: number) => `Bookmarks ${count}`, chatShellBookmarksFirst: (count: number) => `First ${count}`,
        chatShellJumpDateAfterLast: 'After last', noBookmarks: 'No Bookmarks',
    },
}))

import JumpSheet from './JumpSheet.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
let onjump: Mock<(index: number) => void>
let onclose: Mock<() => void>

type Message = { role: 'user' | 'char', data: string, chatId?: string, time?: number }
const chatOf = (messages: Message[], extra: Partial<Chat> = {}): Chat => ({ message: messages, note: '', name: 'c', localLore: [], id: 'chat', ...extra }) as Chat
const plain = (count: number): Message[] => Array.from({ length: count }, (_, index) => ({ role: 'char', data: `m${index}`, chatId: `id${index}`, time: new Date(2026, 0, 1 + index, 12).getTime() }))

function show(chat: Chat): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    onjump = vi.fn<(index: number) => void>()
    onclose = vi.fn<() => void>()
    app = mount(JumpSheet, { target, props: { open: true, opener: null, background: [], chat, onjump, onclose } })
    flushSync()
}

const q = <T extends Element>(selector: string): T => target.querySelector<T>(selector)!
const numberField = () => q<HTMLInputElement>('[data-part="chat-jump-number"] input')
const numberGo = () => q<HTMLButtonElement>('[data-part="chat-jump-number"] button')
const dateField = () => q<HTMLInputElement>('[data-part="chat-jump-date"] input')
const dateGo = () => q<HTMLButtonElement>('[data-part="chat-jump-date"] button')

function type(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

beforeEach(() => { toast.post = vi.fn<(init: { kind: string, text: string }) => number>(() => 1) })
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
})

describe('JumpSheet rows', () => {
    test('A2-17: first and newest answer -1 and the last index; the first row carries the initial focus mark', () => {
        show(chatOf(plain(5)))
        const items = [...target.querySelectorAll<HTMLButtonElement>(':scope > div > [data-part="chat-sheet-item"]')]
        expect(items.map((item) => item.textContent)).toEqual(['First message', 'Newest message'])
        expect(items[0].hasAttribute('data-sheet-initial')).toBe(true)
        items[0].click()
        items[1].click()
        expect(onjump.mock.calls).toEqual([[-1], [4]])
    })
    test('A2-17: the number and date rows are absent for an empty chat', () => {
        show(chatOf([]))
        expect(target.querySelector('[data-part="chat-jump-number"]')).toBeNull()
        expect(target.querySelector('[data-part="chat-jump-date"]')).toBeNull()
    })
})

describe('the number row', () => {
    test('A2-17: a valid number jumps to its index, commas and spaces ignored', () => {
        show(chatOf(plain(1200)))
        type(numberField(), '1,000')
        numberGo().click()
        expect(onjump).toHaveBeenLastCalledWith(999)
        type(numberField(), ' 3 ')
        numberGo().click()
        expect(onjump).toHaveBeenLastCalledWith(2)
    })
    test('A2-17: a refused number is explained inline, marks the field invalid and keeps the sheet open', () => {
        show(chatOf(plain(10)))
        for (const text of ['0', '11', '1.5', '']) {
            type(numberField(), text)
            numberGo().click()
            flushSync()
            expect(numberField().getAttribute('aria-invalid')).toBe('true')
            expect(q('[role="alert"]').textContent).toBe('Enter 1 to 10')
        }
        expect(onjump).not.toHaveBeenCalled()
        expect(onclose).not.toHaveBeenCalled()
        type(numberField(), '4')
        expect(target.querySelector('[role="alert"]')).toBeNull()
    })
    test('A2-17: Enter means Go, and an IME confirmation (isComposing or keyCode 229) is ignored', () => {
        show(chatOf(plain(10)))
        type(numberField(), '4')
        numberField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
        numberField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }))
        expect(onjump).not.toHaveBeenCalled()
        numberField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        expect(onjump).toHaveBeenCalledExactlyOnceWith(3)
    })
})

describe('the date row', () => {
    test('A2-17: Go is disabled until a valid date is set, then jumps to the first message on or after the day', () => {
        const messages = plain(5)
        messages[0].time = undefined
        show(chatOf(messages))
        expect(dateGo().disabled).toBe(true)
        type(dateField(), '2026-01-03')
        expect(dateGo().disabled).toBe(false)
        dateGo().click()
        expect(onjump).toHaveBeenCalledExactlyOnceWith(2)
    })
    test('A2-17: a day after the last dated message posts a warning toast and leaves the sheet open', () => {
        show(chatOf(plain(3)))
        type(dateField(), '2030-01-01')
        dateGo().click()
        expect(toast.post).toHaveBeenCalledExactlyOnceWith({ kind: 'warning', text: 'After last' })
        expect(onjump).not.toHaveBeenCalled()
        expect(onclose).not.toHaveBeenCalled()
    })
    test('A2-17: the untimed note shows only when some message has no time', () => {
        show(chatOf(plain(3)))
        expect(target.textContent).not.toContain('Untimed skipped')
    })
    test('A2-17: the untimed note shows when a message has no time', () => {
        const messages = plain(3)
        messages[1].time = undefined
        show(chatOf(messages))
        expect(target.textContent).toContain('Untimed skipped')
    })
})

describe('the bookmarks section', () => {
    test('A2-17: 61 bookmarks show the total 61, 60 rows and the first-60 note', () => {
        const messages = plain(70)
        show(chatOf(messages, { bookmarks: messages.slice(0, 61).map((message) => message.chatId!) }))
        const section = q('[data-part="chat-jump-bookmarks"]')
        expect(section.querySelector('h3')!.textContent).toBe('Bookmarks 61')
        expect(section.querySelectorAll('[data-part="chat-sheet-item"]')).toHaveLength(60)
        expect(section.textContent).toContain('First 60')
        section.querySelectorAll<HTMLButtonElement>('[data-part="chat-sheet-item"]')[2].click()
        expect(onjump).toHaveBeenCalledExactlyOnceWith(2)
    })
    test('A2-17: no bookmarks shows the empty text and no rows', () => {
        show(chatOf(plain(3)))
        const section = q('[data-part="chat-jump-bookmarks"]')
        expect(section.textContent).toContain('No Bookmarks')
        expect(section.querySelectorAll('[data-part="chat-sheet-item"]')).toHaveLength(0)
    })
})

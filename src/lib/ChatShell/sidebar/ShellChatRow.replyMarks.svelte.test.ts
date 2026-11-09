// @vitest-environment happy-dom

/**
 * The reply indicators of `ShellChatRow.svelte` (CHORE-685 S1b): the writing badge from the work registry and the blue or red
 * dot from the chat's own field, for the row's own chat only. The row is mounted alone over a real `$state` chat; the registry
 * is the real one. `replyMarkOf` is wrapped only to count how often a row reads a chat's mark.
 *
 * Labels: "reproducer" fails on the code before S1b (no indicator exists), "guard" passes before and after.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database } from '../../../ts/storage/database.svelte'
import type { ListEditing } from '../../../ts/chatShell/chatListEdits'

const markReads = vi.hoisted(() => ({ count: 0 }))

vi.mock(import('src/ts/process/replyMarks'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        replyMarkOf: (...args: Parameters<typeof actual.replyMarkOf>) => {
            markReads.count += 1
            return actual.replyMarkOf(...args)
        },
    }
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { coldStorageHeader } from '../../../ts/process/coldstorageData'
import { registerWork, type WorkHandle } from '../../../ts/process/chatOrigin'
import ShellChatRow from './ShellChatRow.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []
let handles: WorkHandle[] = []

const editing = {
    renamingChat: null,
    menu: null,
    openChatMenu: () => {},
    commitChatName: () => {},
    cancelRename: () => {},
} as unknown as ListEditing

function makeChat(id: string, patch: Record<string, unknown> = {}): Chat {
    const chat = $state({ id, name: `chat ${id}`, message: [{ role: 'user', data: 'hi', time: 1 }], note: '', localLore: [], fmIndex: -1, ...patch })
    return chat as unknown as Chat
}

function mountRow(chat: Chat, chaId = 'c0'): HTMLElement {
    DBState.db = { characters: [], language: 'en' } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ShellChatRow, {
        target,
        props: { chat, chaId, index: 0, open: false, tabbable: true, level: 1, posinset: 1, setsize: 1, editing, onopen: () => {} },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
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

const parts = (target: HTMLElement): string[] => Array.from(target.querySelectorAll('[data-part^="reply-"]')).map((el) => el.getAttribute('data-part') ?? '')

function startWriting(chaId: string, chatId: string): WorkHandle {
    const handle = registerWork({ chaId, chatId }, undefined, 'reply')
    handles.push(handle)
    flushSync()
    return handle
}

describe('the chat row (T20)', () => {
    test('reproducer (T20, M21): a blue dot, a red dot and a badge, each from the row\'s own chat', () => {
        expect(parts(mountRow(makeChat('a', { unseenReply: 'reply' })))).toEqual(['reply-new-dot'])
        expect(parts(mountRow(makeChat('b', { unseenReply: 'error' })))).toEqual(['reply-error-dot'])
        const writing = mountRow(makeChat('c'))
        expect(parts(writing)).toEqual([])
        startWriting('c0', 'c')
        expect(parts(writing)).toEqual(['reply-writing-badge'])
    })

    test('reproducer (T20): a registration of another chat of the same character shows nothing here', () => {
        const target = mountRow(makeChat('a'))
        startWriting('c0', 'other')
        startWriting('other-character', 'a')
        expect(parts(target)).toEqual([])
    })

    test('reproducer (T20): the row follows its field and the registry after the mount', () => {
        const chat = makeChat('a')
        const target = mountRow(chat)
        chat.unseenReply = 'reply'
        flushSync()
        expect(parts(target)).toEqual(['reply-new-dot'])
        const handle = startWriting('c0', 'a')
        expect(parts(target)).toEqual(['reply-writing-badge', 'reply-new-dot'])
        handle.end()
        chat.unseenReply = 'error'
        flushSync()
        expect(parts(target)).toEqual(['reply-error-dot'])
        delete chat.unseenReply
        flushSync()
        expect(parts(target)).toEqual([])
    })

    test('reproducer (T20): the indicators carry their accessible names and the badge no aria-busy', () => {
        const target = mountRow(makeChat('a', { unseenReply: 'reply' }))
        startWriting('c0', 'a')
        expect(target.querySelector('[data-part="reply-new-dot"]')?.getAttribute('aria-label')).toBe(language.chatNewReplyDot)
        const badge = target.querySelector('[data-part="reply-writing-badge"]')
        expect(badge?.getAttribute('aria-label')).toBe(language.chatWritingBadge)
        expect(badge?.hasAttribute('aria-busy')).toBe(false)
        const red = mountRow(makeChat('b', { unseenReply: 'error' }))
        expect(red.querySelector('[data-part="reply-error-dot"]')?.getAttribute('aria-label')).toBe(language.chatReplyErrorDot)
    })

    test('guard (MF): an archived placeholder chat that kept a mark shows no dot', () => {
        const placeholder = makeChat('a', { unseenReply: 'reply', message: [{ role: 'char', data: `${coldStorageHeader}some-key`, time: 1 }] })
        expect(parts(mountRow(placeholder))).toEqual([])
        const failed = makeChat('b', { unseenReply: 'error', message: [{ role: 'char', data: `${coldStorageHeader}other-key`, time: 1 }] })
        expect(parts(mountRow(failed))).toEqual([])
    })

    test('guard: a value this build does not know draws no dot', () => {
        expect(parts(mountRow(makeChat('a', { unseenReply: 'something-else' })))).toEqual([])
    })

    test('guard (perf): a streamed token into the chat re-reads no mark', () => {
        const chat = makeChat('a')
        mountRow(chat)
        const settled = markReads.count
        expect(settled).toBeGreaterThan(0)
        for (let token = 0; token < 50; token++) {
            chat.message[0].data += 'x'
            flushSync()
        }
        expect(markReads.count).toBe(settled)
    })
})

// @vitest-environment happy-dom

/**
 * The reply indicators of the side chat list (CHORE-685 S1b): per chat row, the writing badge from the work registry and the
 * blue or red dot from the chat's own field, in the folder-less list and inside a folder. The mount and the module mocks are
 * those of `SideChatList.orderByOrder.svelte.test.ts` (same directory); the chats are a real `$state` character and the
 * registry is the real one.
 *
 * Labels: "reproducer" fails on the code before S1b (no indicator exists), "guard" passes before and after.
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
import SideChatList from './SideChatList.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []
let handles: WorkHandle[] = []

function makeCharacter(patch: Record<string, unknown> = {}): character {
    const chara = $state({
        type: 'character', chaId: 'c0', name: 'c0', chatPage: 0, chatFolders: [],
        chats: [
            { id: 'chat-0', name: 'one', message: [], note: '', localLore: [], folderId: null },
            { id: 'chat-1', name: 'two', message: [], note: '', localLore: [], folderId: null },
            { id: 'chat-2', name: 'three', message: [], note: '', localLore: [], folderId: null },
        ],
        ...patch,
    })
    return chara as unknown as character
}

function mountList(chara: character): HTMLElement {
    DBState.db = { characters: [chara], personas: [], selectedPersona: 0 } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SideChatList, { target, props: { chara } }) as unknown as Record<string, unknown>
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

/** The indicator parts of the row of the chat at `index`. */
function partsOfRow(target: HTMLElement, index: number): string[] {
    const row = target.querySelector(`[data-risu-chat-idx="${index}"]`)
    if (!row) {
        throw new Error(`no row ${index}`)
    }
    return Array.from(row.querySelectorAll('[data-part^="reply-"]')).map((el) => el.getAttribute('data-part') ?? '')
}

function startWriting(chatId: string): void {
    handles.push(registerWork({ chaId: 'c0', chatId }, undefined, 'reply'))
    flushSync()
}

describe('the rows of the side chat list (T20)', () => {
    test('reproducer (T20, M21): each row shows the dot of its own chat and the badge of its own registration', () => {
        const chara = makeCharacter()
        chara.chats[0].unseenReply = 'reply'
        chara.chats[1].unseenReply = 'error'
        const target = mountList(chara)
        startWriting('chat-2')

        expect(partsOfRow(target, 0)).toEqual(['reply-new-dot'])
        expect(partsOfRow(target, 1)).toEqual(['reply-error-dot'])
        expect(partsOfRow(target, 2)).toEqual(['reply-writing-badge'])
    })

    test('reproducer (T20): a row follows its field after the mount, and a clear removes the dot', () => {
        const chara = makeCharacter()
        const target = mountList(chara)
        expect(partsOfRow(target, 1)).toEqual([])

        chara.chats[1].unseenReply = 'reply'
        flushSync()
        expect(partsOfRow(target, 1)).toEqual(['reply-new-dot'])
        expect(partsOfRow(target, 0)).toEqual([])

        delete chara.chats[1].unseenReply
        flushSync()
        expect(partsOfRow(target, 1)).toEqual([])
    })

    test('reproducer (T20): a chat inside a folder shows its dot too', () => {
        const chara = makeCharacter({ chatFolders: [{ id: 'folder-1', name: 'Folder', color: '', folded: false }] })
        chara.chats[2].folderId = 'folder-1'
        chara.chats[2].unseenReply = 'error'
        const target = mountList(chara)

        expect(partsOfRow(target, 2)).toEqual(['reply-error-dot'])
        expect(partsOfRow(target, 0)).toEqual([])
    })

    test('reproducer (T20): the dots and the badge carry their accessible names', () => {
        const chara = makeCharacter()
        chara.chats[0].unseenReply = 'reply'
        chara.chats[1].unseenReply = 'error'
        const target = mountList(chara)
        startWriting('chat-2')

        expect(target.querySelector('[data-part="reply-new-dot"]')?.getAttribute('aria-label')).toBe(language.chatNewReplyDot)
        expect(target.querySelector('[data-part="reply-error-dot"]')?.getAttribute('aria-label')).toBe(language.chatReplyErrorDot)
        const badge = target.querySelector('[data-part="reply-writing-badge"]')
        expect(badge?.getAttribute('aria-label')).toBe(language.chatWritingBadge)
        expect(badge?.hasAttribute('aria-busy')).toBe(false)
    })

    test('guard: a value this build does not know draws no dot', () => {
        const chara = makeCharacter()
        ;(chara.chats[0] as unknown as Record<string, unknown>).unseenReply = 'something-else'
        const target = mountList(chara)
        expect(partsOfRow(target, 0)).toEqual([])
    })
})

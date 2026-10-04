// @vitest-environment happy-dom

/**
 * The "talk by order" checkbox of `SideChatList.svelte` for a group.
 *
 * Invariants pinned here:
 *  - showing the list for a group that lacks `orderByOrder` leaves the group without that
 *    key, so nothing marks it changed, and the box shows unchecked;
 *  - toggling the box writes true, then false;
 *  - a character (not a group) shows no such box.
 *
 * Mounts the REAL `SideChatList.svelte` over a real `$state` group. The chat functions of
 * `src/ts/characters.ts`, the toggles panel and the drag library are stubs. Dirtiness is
 * asserted through the object shape, since the change-tracking effects are not mounted.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database, character, groupChat } from 'src/ts/storage/database.svelte'

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
import SideChatList from './SideChatList.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function makeChat(type: 'group' | 'character', patch: Record<string, unknown> = {}): groupChat {
    const chara = $state({
        type, chaId: 'c0', name: 'c0', chatPage: 0, chatFolders: [],
        chats: [{ id: 'chat-0', name: 'one', message: [], note: '', localLore: [], folderId: null }],
        ...patch,
    })
    return chara as unknown as groupChat
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function mountList(chara: groupChat | character): Promise<HTMLElement> {
    DBState.db = { characters: [], personas: [], selectedPersona: 0 } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SideChatList, { target, props: { chara } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await settle()
    return target
}

function orderBox(target: HTMLElement): HTMLInputElement | null {
    return target.querySelector(`input[type="checkbox"][alt="${language.orderByOrder}"]`)
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the talk-by-order checkbox of the side chat list', () => {
    test('regression reproducer: showing the list for a group without orderByOrder does not add the key', async () => {
        const group = makeChat('group')

        const target = await mountList(group)

        expect(orderBox(target)!.checked).toBe(false)
        expect(Object.keys(group)).not.toContain('orderByOrder')
    })

    test('guard: toggling the box writes true and then false', async () => {
        const group = makeChat('group')

        const target = await mountList(group)
        const box = orderBox(target)!

        box.click()
        flushSync()
        expect(group.orderByOrder).toBe(true)
        expect(box.checked).toBe(true)

        box.click()
        flushSync()
        expect(group.orderByOrder).toBe(false)
        expect(box.checked).toBe(false)
    })

    test('guard: a stored true displays checked', async () => {
        const group = makeChat('group', { orderByOrder: true })

        const target = await mountList(group)

        expect(orderBox(target)!.checked).toBe(true)
        expect(group.orderByOrder).toBe(true)
    })

    test('guard: a character shows no talk-by-order box', async () => {
        const target = await mountList(makeChat('character'))

        expect(orderBox(target)).toBeNull()
    })
})

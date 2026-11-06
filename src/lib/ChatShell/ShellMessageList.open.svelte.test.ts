// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

let hiding: () => void = () => {}

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 2, chatLoadAdditionalPages: 2 } })
    const ReloadChatPointer = writable<Record<number, number>>({})
    const ReloadGUIPointer = writable(0)
    const ScrollToMessageStore = $state({ value: -1 })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer, ReloadGUIPointer, ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: (callback: () => void) => { hiding = callback; return () => {} } }
})
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted' } }))
vi.mock('./ShellMessage.svelte', () => ({ default: () => ({}) }))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState, ScrollToMessageStore } from '../../ts/stores.svelte'
import { chatSurface as surface } from '../ChatScreens/chatSurface.svelte'

const CLIENT = 100
let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let top = 0
let height = 0
const writes: number[] = []

function messages(count: number): Message[] {
    return Array.from({ length: count }, (_, i) => ({ chatId: `m${i}`, role: i % 2 ? 'char' : 'user', data: String(i) }) as Message)
}
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: messages(6) }, { id: 'other', message: messages(6) }] }) as Character

async function frame() {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await tick()
}
async function show(startTop = 0, settle = true) {
    top = startTop
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => height, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: CLIENT, configurable: true })
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = value }, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await tick()
    if (settle) await frame()
}
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    writes.length = 0
    height = 1000
    surface.hidden = false
    surface.rebuildEpoch = 0
    character.chatPage = 0
    DBState.db.chatLoadInitialPages = 2
    DBState.db.autoScrollToNewMessage = true
    ScrollToMessageStore.value = -1
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    vi.unstubAllGlobals()
})

describe('the transcript opens at the newest message', () => {
    test('opening a chat with more rows than fit rests at the bottom', async () => {
        await show(0)
        expect(top).toBe(height - CLIENT)
    })
    test('opening rests at the bottom although auto-scroll to new messages is off', async () => {
        DBState.db.autoScrollToNewMessage = false
        await show(0)
        expect(top).toBe(height - CLIENT)
    })
    test('the frame pass keeps up with late growth but yields to a reader who moved', async () => {
        await show(0, false)
        expect(top).toBe(height - CLIENT)
        height = 1300
        await frame()
        expect(top).toBe(height - CLIENT)
        await unmount(app!)
        app = undefined
        target.remove()
        await show(0, false)
        top = 250
        height = 1300
        await frame()
        expect(top).toBe(250)
    })
    test('a room change rests the new chat at the bottom', async () => {
        await show(0)
        top = 300
        character.chatPage = 1
        flushSync()
        await tick()
        await frame()
        expect(top).toBe(height - CLIENT)
    })
    test('a window reset ends at the bottom, not at the oldest row', async () => {
        await show(0)
        top = 400
        surface.hidden = true
        flushSync()
        DBState.db.chatLoadInitialPages = 1
        surface.hidden = false
        flushSync()
        await tick()
        await frame()
        expect(top).toBe(height - CLIENT)
        expect(top).not.toBe(0)
    })
})

describe('older pages load from the top and keep the reader in place', () => {
    test('scrolling near the top loads older rows and keeps the distance from the bottom', async () => {
        await show(0)
        top = 50
        app!.onScroll()
        height = 1400
        await tick()
        await frame()
        expect(top).toBe(1400 - (1000 - 50))
    })
    test('a second scroll event while the restore is pending does not load again', async () => {
        await show(0)
        top = 50
        app!.onScroll()
        height = 1400
        app!.onScroll()
        await tick()
        await frame()
        expect(top).toBe(1400 - (1000 - 50))
    })
    test('a later scroll to the top loads the next older page after the first restore finished', async () => {
        await show(0)
        top = 50
        app!.onScroll()
        height = 1400
        await tick()
        await frame()
        expect(top).toBe(1400 - (1000 - 50))
        top = 50
        app!.onScroll()
        height = 1800
        await tick()
        await frame()
        expect(top).toBe(1800 - (1400 - 50))
    })
    test('a reader away from the top is not moved by scrolling', async () => {
        await show(0)
        writes.length = 0
        top = 500
        app!.onScroll()
        height = 1400
        await tick()
        await frame()
        expect(writes).toEqual([])
        expect(top).toBe(500)
    })
    test('nothing loads when no older messages exist', async () => {
        const original = character.chats![0].message
        character.chats![0].message = messages(2)
        try {
            await show(0)
            writes.length = 0
            top = 50
            app!.onScroll()
            height = 1400
            await tick()
            await frame()
            expect(writes).toEqual([])
        } finally {
            await unmount(app!)
            app = undefined
            character.chats![0].message = original
        }
    })
})

describe('the other positioning paths keep their position', () => {
    test('the hide-restore path returns the reader to the saved position', async () => {
        await show(0)
        top = 400
        hiding()
        surface.hidden = true
        flushSync()
        top = 0
        surface.rebuildEpoch += 1
        surface.hidden = false
        flushSync()
        await tick()
        await frame()
        expect(top).toBe(400)
    })
    test('a ScrollToMessage jump is not overridden by resting at the bottom', async () => {
        const original = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = function () { top = 123 }
        try {
            await show(0)
            const list = host.querySelector('[data-part="chat-message-list"]')!
            const row = document.createElement('div')
            row.setAttribute('data-chat-index', '1')
            list.appendChild(row)
            ScrollToMessageStore.value = 4
            flushSync()
            await tick()
            await frame()
            expect(top).toBe(123)
            expect(ScrollToMessageStore.value).toBe(-1)
        } finally {
            Element.prototype.scrollIntoView = original
        }
    })
})

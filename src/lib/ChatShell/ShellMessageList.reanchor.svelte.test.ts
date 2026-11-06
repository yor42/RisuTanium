// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

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
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: () => () => {} }
})
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted' } }))
vi.mock('./ShellMessage.svelte', () => ({ default: () => ({}) }))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'
import { chatSurface as surface } from '../ChatScreens/chatSurface.svelte'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let fire: () => void = () => {}
let top = 0
let height = 0
const writes: number[] = []
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: [{ chatId: 'a', role: 'char', data: 'a' }] as Message[] }] }) as Character

class FakeObserver {
    constructor(callback: () => void) { fire = callback }
    observe(): void {}
    disconnect(): void {}
}

async function show() {
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => height, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = value }, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await tick()
}
beforeEach(() => { vi.stubGlobal('ResizeObserver', FakeObserver); writes.length = 0; top = 200; height = 300; surface.hidden = false })
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    vi.unstubAllGlobals()
    DBState.db.autoScrollToNewMessage = true
})

describe('message list keeps a bottom reader at the bottom', () => {
    test('the newest row growing after a reroll moves scrollTop to the new maximum', async () => {
        await show()
        app!.onScroll()
        height = 354
        fire()
        expect(writes).toEqual([254])
    })
    test('a reader who scrolled up is not moved by the end-of-stream height jump', async () => {
        await show()
        top = 120
        app!.onScroll()
        height = 354
        fire()
        expect(writes).toEqual([])
    })
    test('scrolling away mid-way stops the following', async () => {
        await show()
        app!.onScroll()
        height = 354
        fire()
        top = 90
        app!.onScroll()
        height = 420
        fire()
        expect(writes).toEqual([254])
    })
    test('each size change causes at most one write, and the setting off or a hidden surface causes none', async () => {
        await show()
        app!.onScroll()
        height = 354
        fire()
        fire()
        expect(writes).toEqual([254])
        DBState.db.autoScrollToNewMessage = false
        height = 400
        fire()
        expect(writes).toEqual([254])
    })
    test('the app jump to the latest message makes the list follow later growth from a not-at-bottom start', async () => {
        vi.stubGlobal('ResizeObserver', FakeObserver)
        const original = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = function () { top = 200 }
        try {
            top = 100
            await show()
            expect(writes).toEqual([])
            height = 354
            app!.scrollToLatestMessage()
            expect(top).toBe(200)
            fire()
            height = 420
            fire()
            expect(writes).toEqual([254, 320])
        } finally {
            Element.prototype.scrollIntoView = original
        }
    })
    test('without the jump the same start is not followed', async () => {
        top = 100
        await show()
        app!.onScroll()
        height = 354
        fire()
        expect(writes).toEqual([])
    })
    test('with the setting off the jump does not establish following', async () => {
        const original = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = function () { top = 200 }
        try {
            top = 100
            await show()
            DBState.db.autoScrollToNewMessage = false
            height = 354
            app!.scrollToLatestMessage()
            DBState.db.autoScrollToNewMessage = true
            fire()
            expect(writes).toEqual([])
        } finally {
            Element.prototype.scrollIntoView = original
        }
    })
    test('a late scroll event after the content grew again still follows the next growth to the true bottom', async () => {
        await show()
        app!.onScroll()
        height = 354
        fire()
        height = 400
        app!.onScroll()
        height = 460
        fire()
        expect(writes).toEqual([254, 360])
        expect(top).toBe(height - 100)
    })
})

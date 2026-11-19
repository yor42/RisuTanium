// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'
import { drainMicrotasks } from '../../ts/tests/firstFrame.test-helpers'

interface RowProps { idx: number, onOverlay: (open: boolean) => void }
const rowProps: RowProps[] = []

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 10, chatLoadAdditionalPages: 2 } })
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
// The row stand-in records the props each row receives, so a test can drive a row's overlay callback.
vi.mock('./ShellMessage.svelte', () => ({ default: (_anchor: unknown, props: RowProps) => { rowProps.push(props); return {} } }))

import ShellMessageList from './ShellMessageList.svelte'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement

// Every message whose index is in `shared` carries the chat's own id, as the synthetic save generator once stamped.
function chatOf(count: number, shared: number[]): Message[] {
    return Array.from({ length: count }, (_, i) => ({ chatId: shared.includes(i) ? 'room' : `m${i}`, role: i % 2 ? 'char' : 'user', data: `text ${i}` }) as Message)
}
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: chatOf(8, [0, 5]) }] }) as Character

function show(): HTMLElement {
    target = document.createElement('div')
    const host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 100, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    return host
}
function rows(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[data-part="chat-message-container"]')]
}
function propsFor(idx: number): RowProps {
    const found = rowProps.filter((props) => props.idx === idx).at(-1)
    if (!found) throw new Error(`no row rendered for message ${idx}`)
    return found
}
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    rowProps.length = 0
    character.chatPage = 0
    character.chats![0].message = chatOf(8, [0, 5])
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    vi.unstubAllGlobals()
})

describe('a chat whose messages share a chatId', () => {
    test('opens and renders a row for every message', async () => {
        const host = show()
        await drainMicrotasks()
        expect(rows(host)).toHaveLength(8)
        expect(new Set(rowProps.map((props) => props.idx).filter((idx) => idx >= 0))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]))
    })
    test('each sharing row keeps its own overlay state', async () => {
        character.chats![0].message = chatOf(8, [0, 1])
        const host = show()
        await drainMicrotasks()
        const byIndex = () => rows(host).slice().reverse()
        expect(byIndex()[0].classList.contains('older')).toBe(true)
        expect(byIndex()[1].classList.contains('older')).toBe(true)
        propsFor(0).onOverlay(true)
        flushSync()
        expect(byIndex()[0].classList.contains('older')).toBe(false)
        expect(byIndex()[1].classList.contains('older')).toBe(true)
        propsFor(1).onOverlay(true)
        propsFor(0).onOverlay(false)
        flushSync()
        expect(byIndex()[0].classList.contains('older')).toBe(true)
        expect(byIndex()[1].classList.contains('older')).toBe(false)
    })
    test('a row that gains a duplicate later keeps rendering every message', async () => {
        character.chats![0].message = chatOf(8, [])
        const host = show()
        await drainMicrotasks()
        expect(rows(host)).toHaveLength(8)
        character.chats![0].message.push({ chatId: 'm7', role: 'user', data: 'copy of 7' } as Message)
        flushSync()
        await drainMicrotasks()
        expect(rows(host)).toHaveLength(9)
    })
})

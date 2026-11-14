// @vitest-environment jsdom
// The in-chat search seams of the list: jumpTo without taking focus, the reader's place for the search run, and the hit decoration by message
// reference. The layout is a per-index model (row heights 90 and 117 px) over the rows that are actually mounted, as in the jumpTo tests; a
// ShellMessage stub renders one article per row inside the list's own row container.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { IntentDirection, ReaderIntentListener, ReaderIntentSource } from '../../ts/chatShell/readerIntent'
import type { SearchHit } from '../../ts/chatShell/inChatSearch'

const editors = vi.hoisted(() => ({ open: false }))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 30, chatLoadAdditionalPages: 15 } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0), ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => editors.open, onDraftsChanged: () => () => {} }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: () => () => {} }
})
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted' } }))
vi.mock('./ShellMessage.svelte', () => ({
    default: (anchor: Comment, props: { idx: number }) => {
        const article = document.createElement('article')
        article.dataset.part = 'chat-message'
        article.dataset.chatIndex = String(props.idx)
        article.tabIndex = -1
        anchor.before(article)
        return {}
    },
}))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'
import { chatFoldedStateMessageIndex } from '../../ts/globalApi.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'

type Bound = { character: Character, host: HTMLElement, readerIntent: ReaderIntentSource, unread: boolean, atBottom: boolean, newCount: number, farFromLatest: boolean,
    searchHit: SearchHit | null, searchHitNote: string }

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let props: Bound
let top = 0
let hostHeight = 600
const writes: number[] = []
const frames = new Map<number, () => void>()
let frameId = 0
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: ['Second'],
    chats: [{ id: 'room', message: [] as Message[], alt: [] as ChatAlt[] }] }) as unknown as Character

const intentListeners = new Set<ReaderIntentListener>()
const intentSource: ReaderIntentSource = { subscribe: (listener) => { intentListeners.add(listener); return () => { intentListeners.delete(listener) } } }
function emitIntent(direction: IntentDirection): void {
    for (const listener of [...intentListeners]) listener({ direction, distance: 40, source: 'wheel' })
}

class FakeObserver {
    constructor(_callback: () => void) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

function activeChat(): Chat { return character.chats[character.chatPage] }
function seedLong(chat: Chat, length: number): void {
    chat.message = Array.from({ length }, (_, i): Message => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `m${i}` }))
    chat.alt = []
}
function rowHeight(index: number): number { return index < 0 ? 100 : index % 2 === 0 ? 90 : 117 }
function mountedIndexes(): number[] {
    return [...host.querySelectorAll<HTMLElement>('article[data-part="chat-message"]')].map((row) => Number(row.dataset.chatIndex)).sort((a, b) => a - b)
}
function articleAt(index: number): HTMLElement | null { return host.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`) }
function containerAt(index: number): HTMLElement {
    const container = articleAt(index)?.closest<HTMLElement>('[data-part="chat-message-container"], [data-part="chat-first-message"]')
    if (!container) throw new Error(`no container at ${index}`)
    return container
}
function layoutTop(index: number): number {
    let sum = 0
    for (const mounted of mountedIndexes()) {
        if (mounted >= index) break
        sum += rowHeight(mounted)
    }
    return sum
}
function contentHeight(): number { return mountedIndexes().reduce((sum, index) => sum + rowHeight(index), 0) }
function rowTop(index: number): number { return layoutTop(index) - top }
function topRowIndex(): number {
    const found = mountedIndexes().find((index) => rowTop(index) >= -0.5)
    if (found === undefined) throw new Error('no row is inside the viewport')
    return found
}
function modelIndexOf(element: HTMLElement): number | null {
    const article = element.matches('article[data-chat-index]') ? element
        : element.matches('[data-part="chat-message-container"], [data-part="chat-first-message"]') ? element.querySelector<HTMLElement>('article[data-chat-index]') : null
    return article ? Number(article.dataset.chatIndex) : null
}
function rect(rectTop: number, height: number): DOMRect {
    return { x: 0, y: rectTop, top: rectTop, left: 0, right: 0, bottom: rectTop + height, width: 0, height, toJSON: () => ({}) }
}
function runFrames(): void {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
}
async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    runFrames()
    await tick()
    flushSync()
}
async function show(initial: number, additional: number): Promise<void> {
    DBState.db.chatLoadInitialPages = initial
    DBState.db.chatLoadAdditionalPages = additional
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => contentHeight(), configurable: true })
    Object.defineProperty(host, 'clientHeight', { get: () => hostHeight, configurable: true })
    Object.defineProperty(host, 'scrollTop', {
        get: () => top,
        set: (value: number) => {
            const clamped = Math.max(0, Math.min(value, Math.max(0, contentHeight() - hostHeight)))
            writes.push(clamped)
            top = clamped
        },
        configurable: true,
    })
    target.appendChild(host)
    document.body.appendChild(target)
    const bound = $state<Bound>({ character, host, readerIntent: intentSource, unread: false, atBottom: true, newCount: 0, farFromLatest: false, searchHit: null, searchHitNote: 'Match inside' })
    props = bound
    app = mount(ShellMessageList, { target: host, props: bound })
    await settle()
    emitIntent('older')
    writes.length = 0
    frames.clear()
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    writes.length = 0; frames.clear()
    intentListeners.clear()
    editors.open = false
    chatSurface.hidden = false
    chatFoldedStateMessageIndex.index = -1
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => {}, configurable: true, writable: true })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this === host) return rect(0, hostHeight)
        const index = modelIndexOf(this)
        return index === null ? rect(0, 0) : rect(rowTop(index), rowHeight(index))
    })
    top = 0
    character.chatPage = 0
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []; character.chats[0].alt = []
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

function hitOf(index: number): SearchHit { return { index, message: activeChat().message[index] } }
function decorated(): HTMLElement[] { return [...host.querySelectorAll<HTMLElement>('.search-hit')] }
function notes(): HTMLElement[] { return [...host.querySelectorAll<HTMLElement>('.search-hit-note')] }

describe('jumpTo focus option', () => {
    test('B2b-1: focus false aligns the target without moving focus', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const outside = document.createElement('input')
        document.body.appendChild(outside)
        outside.focus()
        const request = app!.jumpTo(500, { recordOrigin: false, focus: false })
        await settle()
        const result = await request
        expect(result.status).toBe('done')
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
        expect(document.activeElement).toBe(outside)
        outside.remove()
    })
    test('B2b-2: the default jump still focuses the target (guard: passes before and after)', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const request = app!.jumpTo(500)
        await settle()
        await request
        expect(document.activeElement).toBe(articleAt(500))
    })
})

describe('readOrigin', () => {
    test('B2b-4: it reports the message at the top of the screen and its offset; null while the surface is hidden', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const index = topRowIndex()
        expect(app!.readOrigin()).toEqual({ index, offset: rowTop(index), atBottom: true })
        chatSurface.hidden = true
        expect(app!.readOrigin()).toBeNull()
    })
})

describe('searchHit decoration', () => {
    test('B2b-3: the class and the note sit on the hit message container only, and none when searchHit is null', async () => {
        seedLong(activeChat(), 40)
        await show(30, 15)
        expect(decorated()).toEqual([])
        props.searchHit = hitOf(10)
        await settle()
        expect(decorated()).toEqual([containerAt(10)])
        expect(notes()).toHaveLength(1)
        expect(notes()[0].parentElement).toBe(containerAt(10))
        expect(notes()[0].textContent).toBe('Match inside')
        expect(notes()[0].getAttribute('role')).toBe('note')
        props.searchHit = hitOf(11)
        await settle()
        expect(decorated()).toEqual([containerAt(11)])
        props.searchHit = null
        await settle()
        expect(decorated()).toEqual([])
        expect(notes()).toEqual([])
    })
    test('B2b-3: the first message (index -1, message null) is decorated on its own container', async () => {
        seedLong(activeChat(), 4)
        await show(30, 15)
        props.searchHit = hitOf(1)
        await settle()
        expect(decorated()).toEqual([containerAt(1)])
        expect(containerAt(-1).classList.contains('search-hit')).toBe(false)
        props.searchHit = { index: -1, message: null }
        await settle()
        expect(decorated()).toEqual([containerAt(-1)])
        expect(containerAt(-1).matches('[data-part="chat-first-message"]')).toBe(true)
        expect(notes()).toHaveLength(1)
    })
    test('B2b-3: the decoration follows the message by reference when an earlier message is removed', async () => {
        seedLong(activeChat(), 40)
        await show(30, 15)
        const hit = hitOf(20)
        props.searchHit = hit
        await settle()
        const hitContainer = containerAt(20)
        const neighbour = containerAt(21)
        activeChat().message.splice(5, 1)
        await settle()
        // Rows are keyed by message, so the hit's container survives the removal at a lower index; an index match would decorate its newer neighbour.
        expect(hitContainer.isConnected).toBe(true)
        expect(decorated()).toEqual([hitContainer])
        expect(neighbour.classList.contains('search-hit')).toBe(false)
    })
    test('B2b-3b: moving or clearing searchHit writes no scrollTop and starts no jump', async () => {
        seedLong(activeChat(), 40)
        await show(30, 15)
        top = 200
        props.searchHit = hitOf(10)
        await settle()
        props.searchHit = hitOf(12)
        await settle()
        props.searchHit = null
        await settle()
        expect(writes).toEqual([])
        expect(top).toBe(200)
    })
})

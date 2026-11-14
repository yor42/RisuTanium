// @vitest-environment jsdom
// Jump to latest: the list's at-bottom rule (within 100 px of the end), the count of replies that arrived while the reader was up,
// and the travel to the newest message. The layout is a per-index model (row heights 90 and 117 px) over the rows that are actually
// mounted; a ShellMessage stub renders one article per row and hands out the step runner, and the reader-intent source is the test's own.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { StepRowRunner } from '../../ts/chatShell/stepHold'
import type { IntentDirection, ReaderIntentListener, ReaderIntentSource } from '../../ts/chatShell/readerIntent'

const editors = vi.hoisted(() => ({ open: false }))
const capturedStepRows = vi.hoisted(() => [] as (StepRowRunner | undefined)[])

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
    default: (anchor: Comment, props: { idx: number, stepRow?: StepRowRunner }) => {
        capturedStepRows.push(props.stepRow)
        const article = document.createElement('article')
        article.dataset.part = 'chat-message'
        article.dataset.chatIndex = String(props.idx)
        article.tabIndex = -1
        anchor.before(article)
        return {}
    },
}))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState, ScrollToMessageStore } from '../../ts/stores.svelte'
import { chatFoldedStateMessageIndex } from '../../ts/globalApi.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'

type Bound = { character: Character, host: HTMLElement, readerIntent: ReaderIntentSource, unread: boolean, atBottom: boolean, newCount: number, farFromLatest: boolean }

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let props: Bound
let top = 0
let hostHeight = 600
let appended = 0
let clock = 0
const writes: number[] = []
const frames = new Map<number, () => void>()
let frameId = 0
const scrolledTo: string[] = []
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: ['Second'],
    chats: [{ id: 'room', message: [] as Message[], alt: [] as ChatAlt[] }, { id: 'other', message: [] as Message[], alt: [] as ChatAlt[] }] }) as unknown as Character

// The intent source is owned by the test, so a host event does not count as reader intent unless the test says so.
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
function append(role: 'char' | 'user', count: number): void {
    for (let k = 0; k < count; k++) {
        appended += 1
        activeChat().message.push({ role, data: `reply${appended}`, chatId: `reply${appended}` })
    }
}

function rowHeight(index: number): number { return index < 0 ? 100 : index % 2 === 0 ? 90 : 117 }
function mountedIndexes(): number[] {
    return [...host.querySelectorAll<HTMLElement>('article[data-part="chat-message"]')].map((row) => Number(row.dataset.chatIndex)).sort((a, b) => a - b)
}
function articleAt(index: number): HTMLElement | null { return host.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`) }
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
function bottomTop(): number { return Math.max(0, contentHeight() - hostHeight) }
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
async function settle(withFrames = true): Promise<void> {
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    if (withFrames) runFrames()
    await tick()
    flushSync()
}
// Advances the clock and runs the pending frames until no frame is left, or the limit is reached.
async function playFrames(step = 20, limit = 40): Promise<void> {
    for (let i = 0; i < limit && frames.size > 0; i++) {
        clock += step
        runFrames()
        await tick()
    }
}
async function show(initial: number, additional: number, height = 600): Promise<void> {
    DBState.db.chatLoadInitialPages = initial
    DBState.db.chatLoadAdditionalPages = additional
    hostHeight = height
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => contentHeight(), configurable: true })
    Object.defineProperty(host, 'clientHeight', { get: () => hostHeight, configurable: true })
    Object.defineProperty(host, 'scrollTop', {
        get: () => top,
        set: (value: number) => { const clamped = Math.max(0, Math.min(value, Math.max(0, contentHeight() - hostHeight))); writes.push(clamped); top = clamped },
        configurable: true,
    })
    target.appendChild(host)
    document.body.appendChild(target)
    const bound = $state<Bound>({ character, host, readerIntent: intentSource, unread: false, atBottom: true, newCount: 0, farFromLatest: false })
    props = bound
    app = mount(ShellMessageList, { target: host, props: bound })
    await settle()
    // The mount rests the reader at the newest message; the tests start from a reader who pulled back to read.
    emitIntent('older')
    writes.length = 0
    frames.clear()
}
// The reader rests `distance` px from the end of the mounted rows.
async function readFromEnd(distance: number): Promise<void> {
    top = contentHeight() - hostHeight - distance
    app!.onScroll()
    await settle()
}
// The reader is at the top of the loaded rows and asks for older ones.
async function readBack(): Promise<void> {
    top = 50
    app!.onScroll()
    await settle()
}
async function slideBack(): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(30, 15)
    for (let load = 0; load < 5; load++) await readBack()
    expect(articleAt(999)).toBeNull()
}
function stepRow(): StepRowRunner {
    const runner = capturedStepRows[capturedStepRows.length - 1]
    if (!runner) throw new Error('no row captured stepRow')
    return runner
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    writes.length = 0; frames.clear(); scrolledTo.length = 0
    capturedStepRows.length = 0
    intentListeners.clear()
    clock = 0
    editors.open = false
    chatSurface.hidden = false
    chatFoldedStateMessageIndex.index = -1
    ScrollToMessageStore.value = -1
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        value: function (this: HTMLElement) { scrolledTo.push(this.dataset.chatIndex ?? '') }, configurable: true, writable: true,
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this === host) return rect(0, hostHeight)
        const index = modelIndexOf(this)
        return index === null ? rect(0, 0) : rect(rowTop(index), rowHeight(index))
    })
    top = 0
    character.chatPage = 0
    DBState.db.autoScrollToNewMessage = true
    DBState.db.alwaysScrollToNewMessage = false
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []; character.chats[0].alt = []
    character.chats[1].message = []; character.chats[1].alt = []
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('a reply that arrives while the reader is up', () => {
    test('A1-7: 150 px from the end is not the bottom: the reply is not followed, the button is armed and the reply is counted', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(150)
        const before = top
        const scrolls = scrolledTo.length
        append('char', 1)
        await settle()
        expect(scrolledTo.length).toBe(scrolls)
        expect(top).toBe(before)
        expect(props.unread).toBe(true)
        expect(props.atBottom).toBe(false)
        expect(props.newCount).toBe(1)
    })
    test('A1-8: 80 px from the end is the bottom: the reply is followed and nothing is counted', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(80)
        expect(props.atBottom).toBe(true)
        const scrolls = scrolledTo.length
        append('char', 1)
        await settle()
        expect(scrolledTo.length).toBeGreaterThan(scrolls)
        expect(props.unread).toBe(false)
        expect(props.newCount).toBe(0)
    })
    test('A1-9: three replies are counted, 101 px keeps the count and 100 px clears it', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(150)
        append('char', 3)
        await settle()
        expect(props.newCount).toBe(3)
        await readFromEnd(101)
        expect(props.newCount).toBe(3)
        expect(props.unread).toBe(true)
        await readFromEnd(100)
        expect(props.newCount).toBe(0)
        expect(props.unread).toBe(false)
        expect(props.atBottom).toBe(true)
    })
    test('A1-9b: a message of the reader arms the button without a count', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(150)
        append('user', 1)
        await settle()
        expect(props.unread).toBe(true)
        expect(props.newCount).toBe(0)
    })
    test('A1-9b: with auto-scroll off a reply is still counted while the reader is up', async () => {
        DBState.db.autoScrollToNewMessage = false
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(150)
        append('char', 1)
        await settle()
        expect(props.newCount).toBe(1)
        expect(props.unread).toBe(true)
    })
    test('A1-9b: with auto-scroll off a reply at the bottom is not counted and arms nothing', async () => {
        DBState.db.autoScrollToNewMessage = false
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(50)
        expect(props.atBottom).toBe(true)
        append('char', 1)
        await settle()
        expect(props.newCount).toBe(0)
        expect(props.unread).toBe(false)
    })
    test('A1-9b: always-scroll follows from anywhere and counts nothing', async () => {
        DBState.db.alwaysScrollToNewMessage = true
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(150)
        const scrolls = scrolledTo.length
        append('char', 1)
        await settle()
        expect(scrolledTo.length).toBeGreaterThan(scrolls)
        expect(props.newCount).toBe(0)
    })
    test('A1-10: a chat switch resets the count, the distance flag and the unread flag', async () => {
        seedLong(character.chats[0], 200)
        seedLong(character.chats[1], 200)
        await show(30, 15)
        await readFromEnd(1500)
        append('char', 2)
        await settle()
        expect(props.newCount).toBe(2)
        expect(props.farFromLatest).toBe(true)
        character.chatPage = 1
        // The count is reset by the switch itself, not only by the placement that follows the next flush.
        flushSync()
        expect(props.newCount).toBe(0)
        await settle()
        expect(props.newCount).toBe(0)
        expect(props.farFromLatest).toBe(false)
        expect(props.unread).toBe(false)
    })
})

describe('the distance flag', () => {
    test('A1-11: far means more than one screen from the end, and a tap on the latest message clears it', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(500)
        expect(props.farFromLatest).toBe(false)
        await readFromEnd(700)
        expect(props.farFromLatest).toBe(true)
        app!.scrollToLatestMessage()
        await settle()
        expect(props.farFromLatest).toBe(false)
    })
    test('A1-11: a window that does not mount the newest message is far', async () => {
        await slideBack()
        expect(props.farFromLatest).toBe(true)
    })
})

describe('jumpToLatest', () => {
    test('A1-12: an animated jump cuts to two screens from the end, travels and lands following with the count cleared', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        append('char', 2)
        await settle()
        expect(props.newCount).toBe(2)
        writes.length = 0
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        expect(writes).toEqual([bottomTop() - 2 * hostHeight])
        await playFrames()
        expect(writes.length).toBeGreaterThan(2)
        for (let i = 2; i < writes.length; i++) expect(writes[i]).toBeGreaterThanOrEqual(writes[i - 1])
        expect(top).toBe(bottomTop())
        expect(props.atBottom).toBe(true)
        expect(props.newCount).toBe(0)
        expect(props.unread).toBe(false)
        expect(props.farFromLatest).toBe(false)
    })
    test('A1-12: an instant jump is one write at the end', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        writes.length = 0
        void app!.jumpToLatest({ animate: false, focusNewest: false })
        await settle()
        expect(writes).toEqual([bottomTop()])
        expect(props.atBottom).toBe(true)
    })
    test('A1-13: older rows are not loaded while the travel runs, and are again once it has ended', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15, 2500)
        await readFromEnd(900)
        top = 50
        const mounted = mountedIndexes().length
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        top = 50
        app!.onScroll()
        await settle(false)
        expect(mountedIndexes().length).toBe(mounted)
        await playFrames()
        top = 50
        app!.onScroll()
        await settle(false)
        expect(mountedIndexes().length).toBeGreaterThan(mounted)
    })
    test('A1-13: reader input mid-travel stops it', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        await playFrames(20, 2)
        emitIntent('older')
        const written = writes.length
        await playFrames()
        expect(writes.length).toBe(written)
        expect(top).toBeLessThan(bottomTop())
    })
    test('A1-14: a slid window is rebuilt around the newest message before the cut', async () => {
        await slideBack()
        writes.length = 0
        void app!.jumpToLatest({ animate: false, focusNewest: false })
        await settle()
        expect(articleAt(999)).not.toBeNull()
        expect(mountedIndexes()).toHaveLength(31)
        expect(top).toBe(bottomTop())
        expect(props.atBottom).toBe(true)
        expect(props.unread).toBe(false)
    })
    test('A1-15: with an editor open a slid window stays as it is and nothing is written', async () => {
        await slideBack()
        const before = mountedIndexes()
        writes.length = 0
        editors.open = true
        void app!.jumpToLatest({ animate: true, focusNewest: true })
        await settle()
        await playFrames()
        expect(writes).toEqual([])
        expect(mountedIndexes()).toEqual(before)
        expect(props.unread).toBe(true)
    })
    test('A1-16b: reader intent before the first frame stops the travel; without it the travel completes', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        const cut = writes.length
        emitIntent('newer')
        await playFrames()
        expect(writes.length).toBe(cut)
        expect(top).toBeLessThan(bottomTop())
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        await playFrames()
        expect(top).toBe(bottomTop())
    })
    test('A1-17: focusing the newest message keeps the scroll position: the focus is made without a focus scroll', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        const focus = vi.spyOn(HTMLElement.prototype, 'focus')
        void app!.jumpToLatest({ animate: false, focusNewest: true })
        await settle()
        expect(document.activeElement).toBe(articleAt(199))
        expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    })
    test('A1-17: without focusNewest nothing is focused', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        void app!.jumpToLatest({ animate: false, focusNewest: false })
        await settle()
        expect(document.activeElement).toBe(document.body)
    })
})

describe('jumpToLatest and an alternative step in flight', () => {
    test('A1-20: a jump during a step waits for the hold to settle, then travels to the end', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        writes.length = 0
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        await playFrames(20, 3)
        expect(writes).toEqual([])
        release()
        await running
        await playFrames()
        expect(top).toBe(bottomTop())
        expect(props.atBottom).toBe(true)
    })
    test('A1-20: reader intent while the jump waits drops it', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        writes.length = 0
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        emitIntent('older')
        release()
        await running
        await playFrames()
        expect(writes).toEqual([])
        expect(top).toBeLessThan(bottomTop())
    })
    test('A1-22: a chat switch while the jump waits drops it', async () => {
        seedLong(character.chats[0], 200)
        seedLong(character.chats[1], 200)
        await show(30, 15)
        await readFromEnd(1500)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        character.chatPage = 1
        await settle(false)
        release()
        await running
        const written = writes.length
        await playFrames()
        expect(writes.length).toBe(written)
    })
    test('A1-22: a surface hidden while the jump waits drops it', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        chatSurface.hidden = true
        flushSync()
        release()
        await running
        const written = writes.length
        await playFrames()
        expect(writes.length).toBe(written)
        expect(top).toBeLessThan(bottomTop())
    })
    test('A1-22: a jump asked of a hidden surface does nothing and leaves a running travel alone', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        await playFrames(20, 2)
        chatSurface.hidden = true
        flushSync()
        const written = writes.length
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        await settle(false)
        expect(writes.length).toBe(written)
        chatSurface.hidden = false
        flushSync()
        await playFrames()
        expect(top).toBe(bottomTop())
    })
    test('A1-22: the wait for a step hold is bounded: a hold that outlasts it drops the jump', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        await playFrames(20, 40)
        release()
        await running
        const written = writes.length
        await playFrames()
        expect(writes.length).toBe(written)
        expect(top).toBeLessThan(bottomTop())
    })
    test('A1-21: a step that starts mid-travel stops the travel before its next write', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readFromEnd(1500)
        void app!.jumpToLatest({ animate: true, focusNewest: false })
        await playFrames(20, 2)
        const gate = new Promise<void>(() => {})
        void stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        writes.length = 0
        await playFrames()
        expect(writes).toEqual([])
    })
})

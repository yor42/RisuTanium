// @vitest-environment jsdom
// The list starts loading older rows while the reader is still a screen or more from the top of the window, earlier the faster the
// reader moves toward it and the longer the last load took. The layout model is the one of the load-realign tests: rows are laid out
// newest first, a row's top is the summed height of the rows older than it, every row is 200 px tall and the viewport is 800 px.
// A mounted row spends `mountCost` ms of the mocked clock, the way a real mount spends main-thread time, so a load measures its own cost.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'
import type { IntentDirection, ReaderIntentListener, ReaderIntentSource } from '../../ts/chatShell/readerIntent'

const sim = vi.hoisted(() => ({ clock: 0, mountCost: 0 }))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 30, chatLoadAdditionalPages: 10 } })
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
vi.mock('./ShellMessage.svelte', () => ({
    default: () => {
        sim.clock += sim.mountCost
        return {}
    },
}))

import ShellMessageList from './ShellMessageList.svelte'
import { chatSurface as surface } from '../ChatScreens/chatSurface.svelte'

const CLIENT = 800
const ROW = 200
const FRAME_MS = 16
const ROW_SELECTOR = '[data-part="chat-message-container"], [data-part="chat-first-message"]'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let top = 0
const writes: number[] = []

function messages(count: number): Message[] {
    return Array.from({ length: count }, (_, i) => ({ chatId: `m${i}`, role: i % 2 ? 'char' : 'user', data: String(i) }) as Message)
}
// 100 messages with 30 initial pages: 31 rows are mounted (6200 px) and older rows remain.
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: messages(100) }] }) as Character

const intentListeners = new Set<ReaderIntentListener>()
const intentSource: ReaderIntentSource = { subscribe: (listener) => { intentListeners.add(listener); return () => { intentListeners.delete(listener) } } }
function emitIntent(direction: IntentDirection): void {
    for (const listener of [...intentListeners]) listener({ direction, distance: 40, source: 'wheel' })
}

class QuietObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

const frames = new Map<number, () => void>()
let nextFrame = 1
function runFrame(): void {
    for (const id of [...frames.keys()]) {
        const callback = frames.get(id)
        if (!callback) continue
        frames.delete(id)
        callback()
    }
}

function rowElements(): Element[] {
    const list = host.querySelector('[data-part="chat-message-list"]')
    return list ? [...list.children].filter((child) => child.matches(ROW_SELECTOR)) : []
}
function rowCount(): number { return rowElements().length }
function rectAt(topEdge: number, height: number): DOMRect {
    return { x: 0, y: topEdge, top: topEdge, bottom: topEdge + height, left: 0, right: 100, width: 100, height, toJSON: () => ({}) }
}

async function show(): Promise<void> {
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => rowCount() * ROW, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: CLIENT, configurable: true })
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = value }, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host, readerIntent: intentSource } })
    flushSync()
    await tick()
    await tick()
    runFrame()
    await tick()
    frames.clear()
    writes.length = 0
    emitIntent('older')
}
// One scroll event per frame, the way the browser delivers them during a fling.
function scrollTo(position: number): void {
    top = position
    app!.onScroll()
    sim.clock += FRAME_MS
}
async function settle(): Promise<void> {
    await tick()
    await tick()
}
// A load at the very top (the rule that always applied), then the realign window that follows the restore ends on reader motion.
async function loadAtTopAndEndRealign(): Promise<void> {
    scrollTo(50)
    await settle()
    expect(rowCount()).toBe(41)
    runFrame()
    top = 5000
    runFrame()
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', QuietObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { const id = nextFrame++; frames.set(id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
        if (this === host) return rectAt(0, CLIENT)
        const rows = rowElements()
        const position = rows.indexOf(this)
        if (position < 0) return rectAt(0, 0)
        return rectAt((rows.length - 1 - position) * ROW - top, ROW)
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true, writable: true })
    sim.clock = 100000
    sim.mountCost = 0
    vi.spyOn(performance, 'now').mockImplementation(() => sim.clock)
    writes.length = 0
    intentListeners.clear()
    frames.clear()
    top = 0
    surface.hidden = false
    surface.rebuildEpoch = 0
    character.chatPage = 0
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

describe('older rows load before the reader reaches the top', () => {
    test('C1 a reader inside one screen of the top starts the load', async () => {
        await show()
        expect(rowCount()).toBe(31)
        scrollTo(700)
        await settle()
        expect(rowCount()).toBe(41)
        expect(writes).toEqual([2700])
    })

    test('C1b a reader exactly one screen from the top starts no load (compatibility guard)', async () => {
        await show()
        scrollTo(800)
        await settle()
        expect(rowCount()).toBe(31)
        expect(writes).toEqual([])
    })

    test('C2 a fast upward run loads from far away once three samples show the speed', async () => {
        await show()
        // 10 px/ms with the default load time of 600 ms reaches 800 + 6000 px.
        scrollTo(5000)
        await settle()
        expect(rowCount()).toBe(31)
        scrollTo(4840)
        await settle()
        expect(rowCount()).toBe(31)
        scrollTo(4680)
        await settle()
        expect(rowCount()).toBe(41)
    })

    test('C3a a load that took long widens the lead of the next fling', async () => {
        await show()
        sim.mountCost = 100
        await loadAtTopAndEndRealign()
        // The measured load is 1000 ms: at 5 px/ms the lead is 800 + 5000, where the default would give 3800.
        scrollTo(4760)
        scrollTo(4680)
        scrollTo(4600)
        await settle()
        expect(rowCount()).toBe(51)
    })

    test('C3b a load that was quick narrows the lead of the next fling', async () => {
        await show()
        sim.mountCost = 20
        await loadAtTopAndEndRealign()
        // The measured load is 216 ms (ten mounted rows and the frame before the flush): at 10 px/ms the lead is 800 + 2160. The default
        // would reach 6800 and a blend of the default with the measurement 4800, so both would already load at 3500.
        scrollTo(3820)
        scrollTo(3660)
        scrollTo(3500)
        await settle()
        expect(rowCount()).toBe(41)
        scrollTo(3340)
        scrollTo(3180)
        scrollTo(3020)
        await settle()
        expect(rowCount()).toBe(41)
        scrollTo(2860)
        await settle()
        expect(rowCount()).toBe(51)
    })

    test('C4 while a realign window holds the position only the near-top distance applies (compatibility guard)', async () => {
        await show()
        scrollTo(50)
        await settle()
        expect(rowCount()).toBe(41)
        runFrame()
        expect(top).toBe(2050)
        top = 700
        app!.onScroll()
        await settle()
        expect(rowCount()).toBe(41)
    })
})

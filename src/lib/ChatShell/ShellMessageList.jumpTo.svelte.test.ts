// @vitest-environment jsdom
// jumpTo and returnTo: a jump puts the target's top at the upper third of the visible area, focuses it without a focus scroll and holds it
// for one second against late layout; the answer says whether it ran. The layout is a per-index model (row heights 90 and 117 px, with
// overrides for late layout) over the rows that are actually mounted; a ShellMessage stub renders one article per row and hands out the
// step runner, and the reader-intent source is the test's own.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { StepRowRunner } from '../../ts/chatShell/stepHold'
import type { IntentDirection, ReaderIntentListener, ReaderIntentSource } from '../../ts/chatShell/readerIntent'
import type { JumpResult } from '../../ts/chatShell/jumpTarget'

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

const HOLD_MS = 1000

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let props: Bound
let top = 0
let hostHeight = 600
let appended = 0
let clock = 0
// Every scrollTop write, focus call and hold timer in the order they happened.
const events: string[] = []
const writes: number[] = []
const frames = new Map<number, () => void>()
let frameId = 0
const scrolledTo: string[] = []
const holdTimers: (() => void)[] = []
const heightOverride = new Map<number, number>()
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

function rowHeight(index: number): number { return heightOverride.get(index) ?? (index < 0 ? 100 : index % 2 === 0 ? 90 : 117) }
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
// The row the viewport-top rule picks: the first row whose top is inside the viewport.
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
        set: (value: number) => {
            const clamped = Math.max(0, Math.min(value, Math.max(0, contentHeight() - hostHeight)))
            writes.push(clamped)
            events.push('write')
            top = clamped
        },
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
    events.length = 0
    frames.clear()
}
// The reader rests `distance` px from the end of the mounted rows.
async function readFromEnd(distance: number): Promise<void> {
    top = contentHeight() - hostHeight - distance
    app!.onScroll()
    await settle()
}
async function slideBack(): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(30, 15)
    for (let load = 0; load < 5; load++) {
        top = 50
        app!.onScroll()
        await settle()
    }
    expect(articleAt(999)).toBeNull()
}
function stepRow(): StepRowRunner {
    const runner = capturedStepRows[capturedStepRows.length - 1]
    if (!runner) throw new Error('no row captured stepRow')
    return runner
}
// The hold's one-second timer is captured instead of scheduled, so a test ends it by calling it.
function captureHoldTimers(): void {
    const real = window.setTimeout.bind(window)
    vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
        if (ms === HOLD_MS && typeof handler === 'function') {
            events.push('hold')
            holdTimers.push(() => { handler() })
            return 0
        }
        return real(handler, ms, ...rest)
    }) as typeof window.setTimeout)
}
// A jump request that settles on its own; `status` stays undefined while the promise is pending.
function track(request: Promise<JumpResult>): { result: () => JumpResult | undefined } {
    let settled: JumpResult | undefined
    void request.then((value) => { settled = value })
    return { result: () => settled }
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    writes.length = 0; events.length = 0; frames.clear(); scrolledTo.length = 0; holdTimers.length = 0; heightOverride.clear()
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

describe('jumpTo', () => {
    test('A2-8: the target lands at the upper third, is focused, reports where the reader was, and later growth is not followed', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const before = topRowIndex()
        const beforeOffset = rowTop(before)
        const request = app!.jumpTo(500)
        await settle()
        const result = await request
        expect(result.status).toBe('done')
        expect(result.to).toBe(500)
        expect(result.from).toEqual({ index: before, offset: beforeOffset, atBottom: true })
        expect(articleAt(500)).not.toBeNull()
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
        expect(document.activeElement).toBe(articleAt(500))
        const placed = top
        append('char', 1)
        await settle()
        expect(top).toBe(placed)
        expect(props.atBottom).toBe(false)
    })
    test('A2-8: a scroll-padding-top inset moves the line down, and a value that is not a length counts as none', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const style = vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({ scrollPaddingTop: '60px' } as CSSStyleDeclaration)
        void app!.jumpTo(500)
        await settle()
        // The line is at 60 + (600 - 60) / 3.
        expect(Math.abs(rowTop(500) - 240)).toBeLessThanOrEqual(0.5)
        style.mockReturnValue({ scrollPaddingTop: 'auto' } as CSSStyleDeclaration)
        void app!.jumpTo(480)
        await settle()
        expect(Math.abs(rowTop(480) - 200)).toBeLessThanOrEqual(0.5)
    })
    test('A2-8b: the scroll position is written first, the focus is made without a focus scroll, and the hold starts last', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        captureHoldTimers()
        const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) { events.push('focus') })
        void app!.jumpTo(500)
        await settle()
        expect(focus).toHaveBeenCalledWith({ preventScroll: true })
        expect(events).toEqual(['write', 'focus', 'hold'])
    })
    test('A2-9: a target within the last screen cannot reach the third: the position stops at the end and the reader is at the bottom', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        await readFromEnd(1500)
        const request = app!.jumpTo(999)
        await settle()
        expect((await request).status).toBe('done')
        expect(top).toBe(bottomTop())
        expect(props.atBottom).toBe(true)
        expect(document.activeElement).toBe(articleAt(999))
    })
    test('A2-10: the first message is a target, and it stays at the top of the content', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const request = app!.jumpTo(-1)
        await settle()
        expect((await request).status).toBe('done')
        expect(articleAt(-1)).not.toBeNull()
        expect(top).toBe(0)
        expect(document.activeElement).toBe(articleAt(-1))
    })
    test('A2-11: a layout shift above the target inside the first second is corrected, a later one is not, and the reader ends the hold', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        captureHoldTimers()
        void app!.jumpTo(500)
        await settle()
        expect(holdTimers).toHaveLength(1)
        heightOverride.set(480, 150)
        runFrames()
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
        holdTimers[0]()
        const settled = top
        heightOverride.set(470, 150)
        runFrames()
        expect(top).toBe(settled)
    })
    test('A2-11: the row that is held is the target: a shift between the top of the screen and the target is corrected too', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        void app!.jumpTo(500)
        await settle()
        // Row 499 is the first row inside the viewport; its own top does not move when it grows.
        expect(topRowIndex()).toBe(499)
        heightOverride.set(499, 177)
        runFrames()
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
    })
    test('A2-11: reader input ends the hold before the second is up', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        captureHoldTimers()
        void app!.jumpTo(500)
        await settle()
        host.dispatchEvent(new Event('wheel'))
        const settled = top
        heightOverride.set(480, 150)
        runFrames()
        expect(top).toBe(settled)
    })
    test('A2-12: a hidden surface defers the jump, writes nothing, and the jump happens when the surface is shown', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        chatSurface.hidden = true
        flushSync()
        const request = app!.jumpTo(500)
        await settle()
        expect((await request).status).toBe('deferred')
        expect(writes).toEqual([])
        expect(articleAt(500)).toBeNull()
        chatSurface.hidden = false
        await settle()
        expect(articleAt(500)).not.toBeNull()
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
        expect(document.activeElement).toBe(articleAt(500))
    })
    test('A2-13: with an editor open a window the jump would slide stays as it is, nothing is written, and the answer is blocked', async () => {
        await slideBack()
        const before = mountedIndexes()
        writes.length = 0
        editors.open = true
        const request = app!.jumpTo(999)
        await settle()
        expect((await request).status).toBe('blocked')
        expect(writes).toEqual([])
        expect(mountedIndexes()).toEqual(before)
    })
    test('A2-14: an index outside the chat is out of range and moves nothing', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const first = app!.jumpTo(1000)
        const second = app!.jumpTo(-2)
        await settle()
        expect((await first).status).toBe('cancelled')
        expect((await second).status).toBe('outOfRange')
        const third = app!.jumpTo(1000)
        await settle()
        expect((await third).status).toBe('outOfRange')
        expect(writes).toEqual([])
    })
    test('A2-14: a request that does not ask for the origin answers without one', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const request = app!.jumpTo(500, { recordOrigin: false })
        await settle()
        const result = await request
        expect(result.status).toBe('done')
        expect(result.from).toBeNull()
    })
})

describe('returnTo', () => {
    test('A2-15: the message that was at the top of the screen returns to its distance from the top edge', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        await readFromEnd(1500)
        const request = app!.jumpTo(500)
        await settle()
        const { from } = await request
        expect(from).not.toBeNull()
        expect(from!.atBottom).toBe(false)
        const back = app!.returnTo(from!)
        await settle()
        const result = await back
        expect(result.status).toBe('done')
        expect(result.from).toBeNull()
        expect(articleAt(from!.index)).not.toBeNull()
        expect(Math.abs(rowTop(from!.index) - from!.offset)).toBeLessThanOrEqual(0.5)
    })
    test('A2-15: a reader who was at the bottom returns to the newest message, which is focused', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        await readFromEnd(0)
        const request = app!.jumpTo(500)
        await settle()
        const { from } = await request
        expect(from!.atBottom).toBe(true)
        const back = app!.returnTo(from!)
        await settle()
        expect((await back).status).toBe('done')
        expect(articleAt(999)).not.toBeNull()
        expect(top).toBe(bottomTop())
        expect(props.atBottom).toBe(true)
        expect(document.activeElement).toBe(articleAt(999))
    })
    test('A2-24: an origin past the end of the chat is clamped to the newest message', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        await readFromEnd(1500)
        const back = app!.returnTo({ index: 5000, offset: 30, atBottom: false })
        await settle()
        const result = await back
        expect(result.status).toBe('done')
        expect(result.to).toBe(999)
        expect(document.activeElement).toBe(articleAt(999))
    })
})

describe('the store path', () => {
    test('A2-16: a request through ScrollToMessageStore still shows the row three above, instantly, with no focus move and no hold', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        captureHoldTimers()
        const focus = vi.spyOn(HTMLElement.prototype, 'focus')
        ScrollToMessageStore.value = 500
        await settle()
        expect(scrolledTo).toEqual(['497'])
        expect(ScrollToMessageStore.value).toBe(-1)
        expect(focus).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(document.body)
        expect(holdTimers).toEqual([])
    })
})

describe('a request that another overtakes', () => {
    test('A2-22: of two requests made before the effect runs, the first is cancelled and the second runs', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const first = track(app!.jumpTo(100))
        const second = track(app!.jumpTo(500))
        await settle()
        expect(first.result()?.status).toBe('cancelled')
        expect(second.result()?.status).toBe('done')
        expect(articleAt(100)).toBeNull()
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
    })
    test('A2-22: a store request that arrives while one waits cancels it and is the one that runs', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const waiting = track(app!.jumpTo(500))
        ScrollToMessageStore.value = 300
        await settle()
        expect(waiting.result()?.status).toBe('cancelled')
        expect(scrolledTo).toEqual(['297'])
        expect(articleAt(500)).toBeNull()
    })
})

describe('jumpTo and an alternative step in flight', () => {
    test('A2-23: a jump during a step writes nothing until the hold has settled, then lands', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        writes.length = 0
        const before = mountedIndexes()
        const request = track(app!.jumpTo(500))
        await settle(false)
        await playFrames(20, 3)
        expect(writes).toEqual([])
        expect(mountedIndexes()).toEqual(before)
        expect(request.result()).toBeUndefined()
        release()
        await running
        await playFrames()
        await settle()
        expect(request.result()?.status).toBe('done')
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
    })
    test('A2-23: reader input while the jump waits cancels it', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        writes.length = 0
        const request = track(app!.jumpTo(500))
        await settle(false)
        emitIntent('older')
        release()
        await running
        await playFrames()
        await settle()
        expect(request.result()?.status).toBe('cancelled')
        expect(articleAt(500)).toBeNull()
    })
})

describe('jumpTo overtaken by the chat or the list going away', () => {
    test('A2-25: a chat switch while the jump waits for a step cancels it, with no write and no focus in the new chat', async () => {
        seedLong(character.chats[1], 1000)
        seedLong(activeChat(), 1000)
        await show(30, 15)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        const request = track(app!.jumpTo(500))
        await settle(false)
        character.chatPage = 1
        await settle()
        runFrames()
        runFrames()
        await tick()
        writes.length = 0
        const focus = vi.spyOn(HTMLElement.prototype, 'focus')
        release()
        await running
        await playFrames()
        await settle()
        expect(request.result()?.status).toBe('cancelled')
        expect(writes).toEqual([])
        expect(focus).not.toHaveBeenCalled()
        expect(articleAt(500)).toBeNull()
    })
    test('A2-26: a chat switch in the same tick as the request, to a chat too short for it, cancels instead of reporting out of range', async () => {
        seedLong(activeChat(), 1000)
        seedLong(character.chats[1], 10)
        await show(30, 15)
        const request = track(app!.jumpTo(500))
        character.chatPage = 1
        await settle()
        expect(request.result()?.status).toBe('cancelled')
    })
    test('A2-27: a step that starts during the flush holds the align write back until it settles, then the jump lands', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const runner = stepRow()
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const request = track(app!.jumpTo(500))
        flushSync()
        // The jump has asked for its window and waits for the flush; the step starts now.
        const running = runner(mountedIndexes()[0], () => gate)
        await settle(false)
        await playFrames(20, 3)
        expect(writes).toEqual([])
        expect(request.result()).toBeUndefined()
        release()
        await running
        await playFrames()
        await settle()
        expect(request.result()?.status).toBe('done')
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
    })
    test('A2-28: unmounting with a request that has not run yet cancels it', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const request = track(app!.jumpTo(500))
        const gone = app!
        app = undefined
        await unmount(gone)
        await tick()
        expect(request.result()?.status).toBe('cancelled')
    })
    test('A2-28: unmounting while the jump waits for a step cancels it and writes nothing', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(mountedIndexes()[3], () => gate)
        await tick()
        const request = track(app!.jumpTo(500))
        await settle(false)
        const gone = app!
        app = undefined
        await unmount(gone)
        writes.length = 0
        release()
        await running
        await playFrames()
        await tick()
        expect(request.result()?.status).toBe('cancelled')
        expect(writes).toEqual([])
    })
})

describe('jumpTo and following', () => {
    test('A2-29: a jump that lands at the bottom re-enters following: a later reply slides the window instead of growing it', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        await readFromEnd(1500)
        const request = app!.jumpTo(999)
        await settle()
        expect((await request).status).toBe('done')
        expect(props.atBottom).toBe(true)
        const mounted = mountedIndexes().length
        append('char', 1)
        await settle()
        // A reader who is not following keeps every mounted row and the window grows by the new message.
        expect(mountedIndexes().length).toBe(mounted)
        expect(articleAt(1000)).not.toBeNull()
    })
    test('A2-29: a following reader who jumps to a row that is not at the bottom stays there when the newest message grows', async () => {
        const callbacks: (() => void)[] = []
        class CapturingObserver {
            constructor(callback: () => void) { callbacks.push(callback) }
            observe(): void {}
            unobserve(): void {}
            disconnect(): void {}
        }
        vi.stubGlobal('ResizeObserver', CapturingObserver)
        captureHoldTimers()
        seedLong(activeChat(), 1000)
        await show(30, 15)
        // The reader rests at the bottom with the newest message mounted, so the follower is following.
        await readFromEnd(0)
        const request = app!.jumpTo(990)
        await settle()
        expect((await request).status).toBe('done')
        expect(articleAt(999)).not.toBeNull()
        expect(top).toBeLessThan(bottomTop())
        const landed = top
        heightOverride.set(999, 2000)
        for (const callback of [...callbacks]) callback()
        await settle()
        // The hold ends, and the position read after it must not re-enter a following that the jump released.
        for (const end of holdTimers) end()
        app!.onScroll()
        await settle()
        for (const callback of [...callbacks]) callback()
        await settle()
        expect(top).toBe(landed)
        expect(props.atBottom).toBe(false)
    })
})

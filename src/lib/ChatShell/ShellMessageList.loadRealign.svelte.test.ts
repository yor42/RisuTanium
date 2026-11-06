// @vitest-environment jsdom
// After a load-older restore the list holds the row at the top of the screen where the restore put it, for a short window, while
// the browser resolves the estimated heights of the older rows. These tests drive the real list with a layout model: rows are laid
// out newest first, a row's top is the summed height of the rows older than it, and a settle moves scrollTop the way native scroll
// anchoring does (the bottom-most visible row keeps its place). Every number below is derived from pages of 10 rows of 200 px (a window
// mounts one row more than its page count) and an 800 px viewport: the first page restores scrollTop to 2050, which puts row 9 at
// offset 150 and row 6 at the bottom of the screen; the second page restores to 2050 again with row 19 at offset 150.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'
import type { StepRowRunner } from '../../ts/chatShell/stepHold'
import type { IntentDirection, ReaderIntentListener, ReaderIntentSource } from '../../ts/chatShell/readerIntent'

let hiding: () => void = () => {}
const capturedStepRows = vi.hoisted(() => [] as (StepRowRunner | undefined)[])

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 10, chatLoadAdditionalPages: 10 } })
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
vi.mock('./ShellMessage.svelte', () => ({
    default: (_anchor: unknown, props: { stepRow?: StepRowRunner }) => {
        capturedStepRows.push(props.stepRow)
        return {}
    },
}))

import ShellMessageList from './ShellMessageList.svelte'
import { ScrollToMessageStore } from '../../ts/stores.svelte'
import { chatSurface as surface } from '../ChatScreens/chatSurface.svelte'

const CLIENT = 800
const ROW = 200
const ROW_SELECTOR = '[data-part="chat-message-container"], [data-part="chat-first-message"]'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let top = 0
// Height overrides by position in the DOM, which is newest first; every other row is ROW tall.
const heights = new Map<number, number>()
const writes: number[] = []
// A WebView stores the scroll position as a 32-bit float; `writes` keeps the value the list wrote, `top` the stored one.
let float32 = false

function messages(count: number): Message[] {
    return Array.from({ length: count }, (_, i) => ({ chatId: `m${i}`, role: i % 2 ? 'char' : 'user', data: String(i) }) as Message)
}
// Both chats carry the same chat ids, so a switch keeps the same row elements mounted.
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: messages(40) }, { id: 'other', message: messages(40) }] }) as Character

// The intent source is owned by the test, so a host event does not count as reader intent unless the test says so.
const intentListeners = new Set<ReaderIntentListener>()
const intentSource: ReaderIntentSource = { subscribe: (listener) => { intentListeners.add(listener); return () => { intentListeners.delete(listener) } } }
function emitIntent(direction: IntentDirection): void {
    for (const listener of [...intentListeners]) listener({ direction, distance: 40, source: 'wheel' })
}

interface RecordedObserver { callback: () => void, disconnected: boolean }
const observers: RecordedObserver[] = []
let baseline = 0
class RecordingObserver {
    private readonly record: RecordedObserver
    constructor(callback: () => void) {
        this.record = { callback, disconnected: false }
        observers.push(this.record)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void { this.record.disconnected = true }
}
// The observers created after the mount: the follower's own observer is not among them.
function windowObservers(): RecordedObserver[] { return observers.slice(baseline) }
function fireWindowObservers(): void {
    for (const record of windowObservers()) if (!record.disconnected) record.callback()
}

const frames = new Map<number, () => void>()
const cancelledFrames: number[] = []
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
function heightAt(position: number): number { return heights.get(position) ?? ROW }
function contentHeight(): number { return rowElements().reduce((sum, _row, position) => sum + heightAt(position), 0) }
// The rows are laid out newest first: a row's top is the summed height of the rows older than it.
function contentTopAt(position: number, count: number): number {
    let sum = 0
    for (let older = position + 1; older < count; older++) sum += heightAt(older)
    return sum
}
function rectAt(topEdge: number, height: number): DOMRect {
    return { x: 0, y: topEdge, top: topEdge, bottom: topEdge + height, left: 0, right: 100, width: 100, height, toJSON: () => ({}) }
}

async function show(): Promise<void> {
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => contentHeight(), configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: CLIENT, configurable: true })
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = float32 ? Math.fround(value) : value }, configurable: true })
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
    baseline = observers.length
}
// The reader pulled older (the follower leaves) and scrolled near the top: the page loads, the restore puts scrollTop at 2050 and the window opens.
async function loadOlderPage(at = 50): Promise<void> {
    top = at
    app!.onScroll()
    await tick()
    await tick()
}
async function openWindow(): Promise<void> {
    emitIntent('older')
    await loadOlderPage()
    expect(writes).toEqual([2050])
    writes.length = 0
}
function stepRow(): StepRowRunner {
    const runner = capturedStepRows[capturedStepRows.length - 1]
    if (!runner) throw new Error('no row captured stepRow')
    return runner
}
function expectWindowEnded(): void {
    expect(windowObservers().length).toBeGreaterThan(0)
    expect(windowObservers().every((record) => record.disconnected)).toBe(true)
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', RecordingObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { const id = nextFrame++; frames.set(id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); cancelledFrames.push(id) })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
        if (this === host) return rectAt(0, CLIENT)
        const rows = rowElements()
        const position = rows.indexOf(this)
        if (position < 0) return rectAt(0, 0)
        return rectAt(contentTopAt(position, rows.length) - top, heightAt(position))
    })
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true, writable: true })
    writes.length = 0
    heights.clear()
    observers.length = 0
    baseline = 0
    frames.clear()
    cancelledFrames.length = 0
    intentListeners.clear()
    capturedStepRows.length = 0
    top = 0
    float32 = false
    surface.hidden = false
    surface.rebuildEpoch = 0
    character.chatPage = 0
    ScrollToMessageStore.value = -1
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

describe('the top row is held after a load-older restore', () => {
    test('C1 a settle that anchoring leaves displaced is corrected back to the restore position', async () => {
        await show()
        await openWindow()
        // The row between the top row (row 9, offset 150) and the bottom-most visible row (row 6) shrinks 120; anchoring moves scrollTop by the same amount.
        // The frame in which the second restore pass runs shows no change yet; the layout settles after it and the resize observer fires.
        runFrame()
        expect(writes).toEqual([])
        heights.set(8, 80)
        top = 1930
        fireWindowObservers()
        expect(writes).toEqual([2050])
    })

    test('C16 a settle realised before the second restore pass is corrected and the pass does not undo it', async () => {
        await show()
        await openWindow()
        heights.set(8, 80)
        top = 1930
        runFrame()
        expect(writes).toEqual([2050])
    })

    test('a load-older restore opens exactly one window', async () => {
        await show()
        await openWindow()
        expect(windowObservers()).toHaveLength(1)
        expect(windowObservers()[0].disconnected).toBe(false)
    })

    test('C2 a settle that anchoring fully compensates causes no write', async () => {
        await show()
        await openWindow()
        // A row above the top row shrinks 120 and anchoring follows it, so the top row stays where it was.
        heights.set(10, 80)
        top = 1930
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([])
    })

    test('C3 a wheel on the host ends the window and a later settle writes nothing', async () => {
        await show()
        await openWindow()
        host.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
        expectWindowEnded()
        heights.set(7, 80)
        top = 1930
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([])
    })

    test('C4 an alternative step ends the window when it is called', async () => {
        await show()
        await openWindow()
        const running = stepRow()(5, () => {})
        expectWindowEnded()
        await running
        runFrame()
        writes.length = 0
        heights.set(7, 80)
        top = 1930
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([])
    })

    test.each([
        ['ScrollToMessage', async () => {
            const list = host.querySelector('[data-part="chat-message-list"]')!
            const row = document.createElement('div')
            row.setAttribute('data-chat-index', '1')
            list.appendChild(row)
            ScrollToMessageStore.value = 4
            flushSync()
            await tick()
            await tick()
        }],
        ['scrollToLatestMessage', async () => { app!.scrollToLatestMessage() }],
        ['anchorNewestBottom', async () => { app!.anchorNewestBottom() }],
        ['the surface hiding callback', async () => { hiding() }],
    ])('C5 %s ends the window when it is called', async (_name, move) => {
        await show()
        await openWindow()
        await move()
        expectWindowEnded()
        writes.length = 0
        heights.set(7, 80)
        top = 1930
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([])
    })

    test('C6 a chat switch that keeps the same rows mounted ends the window at the switch', async () => {
        await show()
        await openWindow()
        character.chatPage = 1
        flushSync()
        expectWindowEnded()
    })

    test('C7 unmounting ends the window and cancels its pending frame', async () => {
        await show()
        await openWindow()
        const pendingBefore = frames.size
        await unmount(app!)
        app = undefined
        expectWindowEnded()
        expect(cancelledFrames.length).toBeGreaterThan(0)
        expect(frames.size).toBeLessThan(pendingBefore)
    })

    test('C8 a second load-older replaces the window and holds its own top row', async () => {
        await show()
        await openWindow()
        runFrame()
        expect(writes).toEqual([])
        await loadOlderPage()
        expect(writes).toEqual([2050])
        writes.length = 0
        expect(windowObservers().filter((record) => !record.disconnected)).toHaveLength(1)
        // The second page has 30 rows: the top row is row 18 at offset 150; the row below it shrinks 60.
        runFrame()
        expect(writes).toEqual([])
        heights.set(17, 140)
        top = 1990
        fireWindowObservers()
        expect(writes).toEqual([2050])
    })

    test('C9 a settle that moves rows without changing the transcript size is corrected by the frame check', async () => {
        await show()
        await openWindow()
        // The row above the top row grows 100 while a row below it shrinks 100: the transcript keeps its size, so no observer fires.
        heights.set(10, 300)
        heights.set(8, 100)
        runFrame()
        expect(writes).toEqual([2150])
    })

    test('C10 a restore pass that moves the position after the rows below shrink re-captures the window', async () => {
        await show()
        await openWindow()
        // The newest row shrinks 100: the second restore pass keeps the distance from the bottom and writes 1950.
        heights.set(0, 100)
        runFrame()
        expect(writes).toEqual([1950])
        writes.length = 0
        // The new top row is row 9 at offset 50; the row below it shrinks 100 and anchoring follows.
        heights.set(8, 100)
        top = 1850
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([1950])
    })

    test('C11 reader motion after the restore ends the window without a write', async () => {
        await show()
        await openWindow()
        top = 1750
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([])
        expectWindowEnded()
        heights.set(7, 80)
        top = 1630
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([])
    })
})

describe('layout that moves rows while the scroll position stays put', () => {
    test('C17 a shrink above the top row that no anchoring followed is corrected', async () => {
        await show()
        await openWindow()
        runFrame()
        expect(writes).toEqual([])
        // A row above the top row (position 9) shrinks 120 and anchoring follows: nothing to correct.
        heights.set(12, 80)
        top = 1930
        fireWindowObservers()
        expect(writes).toEqual([])
        runFrame()
        expect(writes).toEqual([])
        // The next row above it shrinks 120 and the position stays: the top row moved up by 120.
        heights.set(11, 80)
        fireWindowObservers()
        expect(writes).toEqual([1810])
    })
})

describe('the second restore pass on a float32 scroll position', () => {
    async function openFloat32Window(): Promise<void> {
        await show()
        float32 = true
        emitIntent('older')
        await loadOlderPage(50.19)
        expect(writes).toHaveLength(1)
        expect(writes[0]).toBeCloseTo(2050.19, 6)
        writes.length = 0
    }

    test('C18 the pass runs when the stored position differs from the written one only by float precision, and writes when the content changed', async () => {
        await openFloat32Window()
        heights.set(0, 100)
        runFrame()
        expect(writes).toHaveLength(1)
        expect(writes[0]).toBeCloseTo(1950.19, 6)
    })

    test('C19 the pass writes nothing when the content did not change, and the window stays', async () => {
        await openFloat32Window()
        runFrame()
        expect(writes).toEqual([])
        expect(windowObservers()).toHaveLength(1)
        expect(windowObservers()[0].disconnected).toBe(false)
    })

    test('C20 the pass is skipped when the reader moved the position by 2 px', async () => {
        await openFloat32Window()
        top = 2048.19
        runFrame()
        expect(writes).toEqual([])
        expectWindowEnded()
    })
})

describe('the window starts only when the list allows it', () => {
    test('C12 a reader still following the newest message gets no window', async () => {
        await show()
        await loadOlderPage()
        expect(writes).toEqual([2050])
        writes.length = 0
        expect(windowObservers()).toHaveLength(0)
        heights.set(7, 80)
        top = 1930
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([])
    })

    test('C13 a step in flight when the restore runs gets no window after it ends', async () => {
        await show()
        emitIntent('older')
        top = 50
        app!.onScroll()
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(5, () => gate)
        await tick()
        await tick()
        expect(windowObservers()).toHaveLength(0)
        release()
        await running
        runFrame()
        expect(windowObservers()).toHaveLength(0)
    })

    test('C14 a reader intent that reaches the list after the restore ends the window', async () => {
        await show()
        await openWindow()
        emitIntent('newer')
        heights.set(7, 80)
        top = 1930
        fireWindowObservers()
        runFrame()
        expect(writes).toEqual([])
        expectWindowEnded()
    })

    test('C15 a hidden chat surface gets no window', async () => {
        await show()
        emitIntent('older')
        top = 50
        app!.onScroll()
        surface.hidden = true
        flushSync()
        await tick()
        await tick()
        expect(windowObservers()).toHaveLength(0)
    })
})

// @vitest-environment jsdom
// A return from Settings or Studio puts the reader back at the same message and offset: the list records the message at the top of the screen
// at the hide, and after the return's flush it aligns that message in place, reloads the window around it the way a jump does, or rests at the newest
// message when the reader was at the exact end. While the surface is hidden and for a few frames after it returns, the transcript host's native
// scroll anchoring is off; a step hold sets the same inline property, so the two must not end each other.
// The layout is a per-index model (row heights 90 and 117 px, with overrides for late layout) over the rows that are actually mounted; a
// ShellMessage stub renders one article per row and hands out the step runner. A test that opts in lays the rows out with the skipped-row model.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { StepRowRunner } from '../../ts/chatShell/stepHold'
import type { IntentDirection, ReaderIntentListener, ReaderIntentSource } from '../../ts/chatShell/readerIntent'
import type { JumpResult } from '../../ts/chatShell/jumpTarget'
import { RETURN_HOLD_RELEASE_FRAMES } from '../../ts/chatShell/returnAnchor'
import { CvLayoutModel } from './cvLayoutModel.test-helpers'

let hiding: () => void = () => {}
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
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: (callback: () => void) => { hiding = callback; return () => {} } }
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
import { recordCaughtError } from '../../ts/caughtErrors'

type Bound = { character: Character, host: HTMLElement, readerIntent: ReaderIntentSource, unread: boolean, atBottom: boolean, newCount: number, farFromLatest: boolean }

const CONTAINERS = '[data-part="chat-message-container"], [data-part="chat-first-message"]'

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
const heightOverride = new Map<number, number>()
let layoutModel: CvLayoutModel | null = null
// Called with every container whose rect is read, before the answer is computed.
let rectProbe: ((container: HTMLElement) => void) | null = null
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
function atEnd(): boolean { return host.scrollHeight - host.clientHeight - host.scrollTop <= 2 }
function modelIndexOf(element: HTMLElement): number | null {
    const article = element.matches('article[data-chat-index]') ? element
        : element.matches(CONTAINERS) ? element.querySelector<HTMLElement>('article[data-chat-index]') : null
    return article ? Number(article.dataset.chatIndex) : null
}
function rect(rectTop: number, height: number): DOMRect {
    return { x: 0, y: rectTop, top: rectTop, left: 0, right: 0, bottom: rectTop + height, width: 0, height, toJSON: () => ({}) }
}
function runFrames(): void {
    layoutModel?.runFrame()
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
async function show(initial: number, additional: number, height = 600, withModel = false): Promise<void> {
    DBState.db.chatLoadInitialPages = initial
    DBState.db.chatLoadAdditionalPages = additional
    hostHeight = height
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    layoutModel = withModel ? new CvLayoutModel({ list: host, hostHeight: () => hostHeight, realHeight: rowHeight }) : null
    Object.defineProperty(host, 'scrollHeight', { get: () => layoutModel ? layoutModel.scrollHeight : contentHeight(), configurable: true })
    Object.defineProperty(host, 'clientHeight', { get: () => hostHeight, configurable: true })
    Object.defineProperty(host, 'scrollTop', {
        get: () => layoutModel ? layoutModel.scrollTop : top,
        set: (value: number) => {
            const clamped = layoutModel ? layoutModel.write(value) : Math.max(0, Math.min(value, Math.max(0, contentHeight() - hostHeight)))
            writes.push(clamped)
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
    frames.clear()
}
// The reader rests `distance` px from the end of the mounted rows.
async function readFromEnd(distance: number): Promise<void> {
    top = contentHeight() - hostHeight - distance
    app!.onScroll()
    await settle()
}
function stepRow(): StepRowRunner {
    const runner = capturedStepRows[capturedStepRows.length - 1]
    if (!runner) throw new Error('no row captured stepRow')
    return runner
}
// The realign window's one-second timer is captured instead of scheduled, so a test sees whether a return started one.
const HOLD_MS = 1000
const holdTimers: (() => void)[] = []
function captureHoldTimers(): void {
    const real = window.setTimeout.bind(window)
    vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
        if (ms === HOLD_MS && typeof handler === 'function') {
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
function anchorValue(): string { return host.style.getPropertyValue('overflow-anchor') }
function forcedContainers(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>(CONTAINERS)].filter((container) => container.style.getPropertyValue('content-visibility') === 'visible')
}
function forcedIndexes(): number[] {
    return forcedContainers().map((container) => modelIndexOf(container)).filter((index): index is number => index !== null).sort((a, b) => a - b)
}
// The surface goes to Settings and comes back: the hiding callbacks run first, as they do in the real surface.
async function leave(): Promise<void> {
    hiding()
    chatSurface.hidden = true
    await settle(false)
}
// Frames are counted from the end of this settle: every microtask chain without a frame wait is done by then.
async function comeBack(rebuilt = false): Promise<void> {
    if (rebuilt) chatSurface.rebuildEpoch += 1
    chatSurface.hidden = false
    flushSync()
    await settle(false)
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    writes.length = 0; frames.clear(); heightOverride.clear(); holdTimers.length = 0
    capturedStepRows.length = 0
    intentListeners.clear()
    clock = 0
    editors.open = false
    chatSurface.hidden = false
    chatSurface.rebuildEpoch = 0
    chatSurface.heldGui = 0
    chatFoldedStateMessageIndex.index = -1
    ScrollToMessageStore.value = -1
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: function (this: HTMLElement) {}, configurable: true, writable: true })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this === host) return rect(0, hostHeight)
        rectProbe?.(this)
        const index = modelIndexOf(this)
        if (index === null) return rect(0, 0)
        if (layoutModel) {
            const placed = layoutModel.rectOf(index)
            return rect(placed.top, placed.height)
        }
        return rect(rowTop(index), rowHeight(index))
    })
    vi.mocked(recordCaughtError).mockClear()
    layoutModel = null
    rectProbe = null
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

// ---- fixtures: each ends right after the return's settle, before any frame ----

// A reader 297 px from the top of a full unslid window: message 903 is at the top edge, and the newest message is mounted.
async function showAtAnchor903(): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(99, 15)
    top = 297
}
async function fixtureNewestPlain(): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(99, 15)
    await readFromEnd(0)
    await leave()
    await comeBack(false)
}
async function fixtureNewestRebuilt(): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(99, 15, 600, true)
    await readFromEnd(0)
    await leave()
    for (const index of mountedIndexes()) heightOverride.set(index, rowHeight(index) * 1.2)
    const kept = host.scrollTop
    layoutModel!.reset()
    layoutModel!.write(kept)
    await comeBack(true)
}
async function fixtureAlignPlain(): Promise<void> {
    await showAtAnchor903()
    await leave()
    await comeBack(false)
}
// The page size grows while hidden: older rows mount above the reader, and nothing but the list moves it back.
async function fixtureAlignAfterGrowth(): Promise<{ index: number, offset: number }> {
    seedLong(activeChat(), 1000)
    await show(50, 15)
    top = 0
    const anchor = app!.readOrigin()!
    await leave()
    DBState.db.chatLoadInitialPages = 80
    await comeBack(false)
    return anchor
}
// A rebuilt return from the middle of a long, already resolved list; the rebuilt rows start at the estimate again.
async function sweepToResolved(): Promise<{ index: number, offset: number }> {
    for (let position = host.scrollHeight - hostHeight; position >= 0; position -= 300) {
        host.scrollTop = position
        runFrames()
    }
    host.scrollTop = 4500
    runFrames()
    const origin = app!.readOrigin()
    if (!origin) throw new Error('no anchor row')
    return { index: origin.index, offset: origin.offset }
}
async function fixtureAlignRebuilt(): Promise<{ index: number, offset: number }> {
    seedLong(activeChat(), 1000)
    await show(99, 15, 600, true)
    const anchor = await sweepToResolved()
    expect(layoutModel!.isEstimated(anchor.index)).toBe(false)
    await leave()
    const kept = host.scrollTop
    layoutModel!.reset()
    layoutModel!.write(kept)
    await comeBack(true)
    return anchor
}
async function fixtureOtherChat(): Promise<void> {
    seedLong(character.chats[1], 1000)
    await showAtAnchor903()
    await leave()
    character.chatPage = 1
    await comeBack(true)
}
// A following reader sits 21 px above the end with auto-scroll off, and 20 replies arrive while the surface is hidden: the window tracks the
// newest message, so the anchor (message 994, at the top edge) is no longer mounted at the return, and the page size has not changed.
async function showFollowingAboveEnd(): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(15, 15)
    DBState.db.autoScrollToNewMessage = false
    await readFromEnd(0)
    top = 1035
    await leave()
    append('char', 20)
    await settle()
}
async function fixtureJump(): Promise<void> {
    await showFollowingAboveEnd()
    await comeBack(false)
}
async function fixtureWaitingJump(): Promise<ReturnType<typeof track>> {
    await showFollowingAboveEnd()
    const request = track(app!.jumpTo(500))
    await settle()
    expect(request.result()?.status).toBe('deferred')
    await comeBack(false)
    return request
}
async function fixtureThrowingRestore(): Promise<void> {
    await showAtAnchor903()
    await leave()
    chatSurface.hidden = false
    flushSync()
    rectProbe = () => { rectProbe = null; throw new Error('probe') }
    await settle(false)
}

// The page size drops while hidden: the window shrinks to the newest rows, so a reader above them has to be reloaded or aligned.
async function lowerWhileHidden(anchorTop: number, setting: number): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(99, 15)
    top = anchorTop
    await leave()
    DBState.db.chatLoadInitialPages = setting
    await settle()
}
// The return, with the browser's clamp of the old position into the shorter content stood in for by `position`: inside the content and not at its end.
async function comeBackAt(position: number): Promise<void> {
    chatSurface.hidden = false
    flushSync()
    top = position
    writes.length = 0
    await settle(false)
}
// Anchor 930 at the top edge of rows 900-999; the lowered window (984-999) does not hold it, so the restore reloads around it.
async function fixtureLoweredJump(): Promise<void> {
    await lowerWhileHidden(3105, 15)
    await comeBackAt(621)
}
// Anchor 990 at the top edge of rows 900-999; the lowered window (969-999) holds it, so the restore aligns it in place.
async function fixtureLoweredAlign(): Promise<void> {
    await lowerWhileHidden(9315, 30)
    await comeBackAt(500)
}
// Anchor 903 with an editor open: the reload would slide the window and unmount the editor's row, so it is refused.
async function fixtureLoweredBlocked(): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(99, 15)
    top = 297
    await leave()
    editors.open = true
    DBState.db.chatLoadInitialPages = 15
    await settle()
    await comeBack(false)
}
// The return of fixtureLoweredJump while a step on message 990 holds the position, so the restore's jump waits for the step.
async function fixtureHeldJump(): Promise<{ release: () => void, running: Promise<void> }> {
    await lowerWhileHidden(3105, 15)
    chatSurface.hidden = false
    flushSync()
    // The browser would have clamped the old position into the shorter content.
    top = 621
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const running = stepRow()(990, () => gate)
    await settle(false)
    expect(articleAt(930)).toBeNull()
    return { release, running }
}

describe('G: the suppression spans the hidden period and ends frames after the return', () => {
    test.each([{ name: 'a plain return', rebuilt: false }, { name: 'a return that rebuilt the rows', rebuilt: true }])('G1: $name', async ({ rebuilt }) => {
        seedLong(activeChat(), 60)
        await show(30, 15)
        expect(anchorValue()).toBe('')
        hiding()
        expect(anchorValue()).toBe('none')
        chatSurface.hidden = true
        await settle(false)
        expect(anchorValue()).toBe('none')
        await comeBack(rebuilt)
        expect(anchorValue()).toBe('none')
        for (let i = 1; i < RETURN_HOLD_RELEASE_FRAMES; i += 1) {
            runFrames()
            expect(anchorValue()).toBe('none')
        }
        runFrames()
        expect(anchorValue()).toBe('')
    })
    test('G2a: a step hold that ended while the surface was hidden is asserted again at the return', async () => {
        seedLong(activeChat(), 60)
        await show(30, 15)
        const running = stepRow()(50, () => Promise.resolve())
        await leave()
        await running
        runFrames()
        await settle(false)
        runFrames()
        expect(anchorValue()).toBe('')
        chatSurface.hidden = false
        flushSync()
        expect(anchorValue()).toBe('none')
    })
    test('G2b: a step started during the return keeps the property past the release time and ends it with the step', async () => {
        seedLong(activeChat(), 60)
        await show(30, 15)
        await leave()
        await comeBack(false)
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const running = stepRow()(50, () => gate)
        await tick()
        for (let i = 0; i < RETURN_HOLD_RELEASE_FRAMES + 3; i += 1) {
            runFrames()
            expect(anchorValue()).toBe('none')
        }
        release()
        await running
        await settle(false)
        runFrames(); runFrames(); runFrames()
        expect(anchorValue()).toBe('')
    })
    test('G3: destroying the list while the surface is hidden leaves nothing suppressed', async () => {
        seedLong(activeChat(), 60)
        await show(30, 15)
        await leave()
        expect(anchorValue()).toBe('none')
        await unmount(app!)
        app = undefined
        expect(anchorValue()).toBe('')
    })
    test('G4: a hide before the release ends the earlier release; the suppression stays', async () => {
        seedLong(activeChat(), 60)
        await show(30, 15)
        await leave()
        await comeBack(false)
        runFrames()
        expect(anchorValue()).toBe('none')
        await leave()
        for (let i = 0; i < 4; i += 1) {
            runFrames()
            expect(anchorValue()).toBe('none')
        }
    })
    test('a list opened while the surface is hidden does not touch the property at its first return', async () => {
        seedLong(activeChat(), 60)
        chatSurface.hidden = true
        await show(30, 15)
        host.style.setProperty('overflow-anchor', 'none')
        chatSurface.hidden = false
        flushSync()
        await settle(false)
        for (let i = 0; i < 4; i += 1) runFrames()
        expect(anchorValue()).toBe('none')
    })
})

describe('X1: every return branch ends with the anchor property removed after the release frames', () => {
    const branches: { name: string, run: () => Promise<void>, landed: () => void }[] = [
        { name: 'a: newest, plain', run: fixtureNewestPlain, landed: () => expect(atEnd()).toBe(true) },
        { name: 'b: newest, rebuilt', run: fixtureNewestRebuilt, landed: () => expect(atEnd()).toBe(true) },
        { name: 'c: align without a write', run: fixtureAlignPlain, landed: () => expect(Math.abs(rowTop(903))).toBeLessThanOrEqual(0.5) },
        { name: 'd: align with a write', run: async () => { await fixtureAlignAfterGrowth() }, landed: () => expect(writes).toHaveLength(1) },
        { name: 'e: align after a rebuild', run: async () => { const anchor = await fixtureAlignRebuilt(); expect(Math.abs(layoutModel!.rectOf(anchor.index).top - anchor.offset)).toBeLessThanOrEqual(0.5) }, landed: () => {} },
        { name: 'g: none, the chat changed', run: fixtureOtherChat, landed: () => expect(top).toBe(bottomTop()) },
        { name: 'i: skipped, a deferred jump waits', run: async () => { await fixtureWaitingJump() }, landed: () => expect(articleAt(500)).not.toBeNull() },
        { name: 'j: jump, done', run: fixtureJump, landed: () => expect(Math.abs(rowTop(994))).toBeLessThanOrEqual(0.5) },
        { name: 'k: jump, blocked', run: fixtureLoweredBlocked, landed: () => expect(top).toBe(bottomTop()) },
        { name: 'l: the restore throws', run: fixtureThrowingRestore, landed: () => expect(recordCaughtError).toHaveBeenCalledWith('chat.returnRestore', expect.any(Error)) },
    ]
    test.each(branches)('$name', async ({ run, landed }) => {
        await run()
        landed()
        expect(anchorValue()).toBe('none')
        for (let i = 1; i < RETURN_HOLD_RELEASE_FRAMES; i += 1) {
            runFrames()
            expect(anchorValue()).toBe('none')
        }
        runFrames()
        expect(anchorValue()).toBe('')
    })
})

describe('the same message at the same offset', () => {
    test('R1: after a rebuild from a deep, already resolved start the anchor is back at its offset, and the hold has nothing left to correct', async () => {
        const anchor = await fixtureAlignRebuilt()
        // R1c: the rebuilt rows around the anchor are forced to their real sizes right after the return, and released at the second frame.
        expect(forcedIndexes()).toContain(anchor.index)
        expect(layoutModel!.containerOf(anchor.index)?.isConnected).toBe(true)
        expect(Math.abs(layoutModel!.rectOf(anchor.index).top - anchor.offset)).toBeLessThanOrEqual(0.5)
        expect(layoutModel!.isEstimated(anchor.index)).toBe(false)
        // R1b: the band's rows kept their sizes, so the realign window writes nothing.
        writes.length = 0
        runFrames()
        runFrames()
        expect(forcedContainers()).toHaveLength(0)
        expect(writes).toEqual([])
        expect(Math.abs(layoutModel!.rectOf(anchor.index).top - anchor.offset)).toBeLessThanOrEqual(0.5)
    })
    test('R1d: a late resolve above the anchor after the restore is corrected by the realign window', async () => {
        const anchor = await fixtureAlignRebuilt()
        runFrames()
        runFrames()
        const above = layoutModel!.mountedIndexes().filter((index) => index < anchor.index).pop()!
        heightOverride.set(above, rowHeight(above) + 40)
        runFrames()
        await tick()
        expect(Math.abs(layoutModel!.rectOf(anchor.index).top - anchor.offset)).toBeLessThanOrEqual(0.5)
    })
    test('R4b: a reader at the exact end stays at the end and keeps following after a plain return', async () => {
        await fixtureNewestPlain()
        await playFrames()
        expect(top).toBe(bottomTop())
        expect(writes).toEqual([])
        append('char', 1)
        await settle()
        expect(top).toBe(bottomTop())
    })
    test('R4: after a rebuild that changed the row heights a reader at the exact end is at the end', async () => {
        await fixtureNewestRebuilt()
        expect(atEnd()).toBe(true)
        runFrames(); runFrames()
        expect(atEnd()).toBe(true)
    })
    test('R4c: a reader at the exact end is put at the newest message, not aligned on the top row, when the rows grew', async () => {
        seedLong(activeChat(), 1000)
        await show(99, 15)
        await readFromEnd(0)
        await leave()
        for (const index of mountedIndexes()) heightOverride.set(index, rowHeight(index) * 1.2)
        await comeBack(true)
        expect(top).toBe(bottomTop())
    })
    test('R5: a chat that changed during the visit rests at its newest message and is not aligned', async () => {
        await fixtureOtherChat()
        await playFrames()
        expect(writes.length).toBeGreaterThan(0)
        for (const written of writes) expect(written).toBe(bottomTop())
    })
    test('R6: the record belongs to one visit: the second visit lands on where the reader was after the first', async () => {
        await showAtAnchor903()
        await leave()
        await comeBack(false)
        await playFrames()
        // The reader moves on to message 913 at the top edge before the second visit.
        top = layoutTop(913)
        await leave()
        await comeBack(true)
        await playFrames()
        expect(Math.abs(rowTop(913))).toBeLessThanOrEqual(0.5)
    })
    test('R10: a plain return with the anchor mounted writes nothing and forces nothing', async () => {
        await showAtAnchor903()
        await leave()
        const unread = props.unread
        captureHoldTimers()
        await comeBack(false)
        expect(articleAt(999)).not.toBeNull()
        expect(props.unread).toBe(unread)
        expect(writes).toEqual([])
        // Nothing moved, so no realign window is started either.
        expect(holdTimers).toHaveLength(0)
        expect(Math.abs(rowTop(903))).toBeLessThanOrEqual(0.5)
        expect(forcedIndexes()).toEqual([])
    })
    test('R10b: rows that mount above the reader on a return are corrected with one write', async () => {
        captureHoldTimers()
        const anchor = await fixtureAlignAfterGrowth()
        expect(articleAt(919)).not.toBeNull()
        expect(Math.abs(rowTop(anchor.index) - anchor.offset)).toBeLessThanOrEqual(0.5)
        expect(writes).toHaveLength(1)
        // The write starts the realign window.
        expect(holdTimers).toHaveLength(1)
    })
    test('R13: the effect that runs again while visible restores nothing', async () => {
        await fixtureAlignPlain()
        await playFrames()
        top = 597
        writes.length = 0
        chatSurface.heldGui += 1
        await settle()
        await playFrames()
        expect(writes).toEqual([])
        expect(articleAt(999)).not.toBeNull()
    })
    test('B1: a reader 50 px above the end is not moved to the newest message by a plain return or a rebuilt one', async () => {
        seedLong(activeChat(), 1000)
        await show(99, 15)
        await readFromEnd(50)
        const anchor = app!.readOrigin()!
        await leave()
        await comeBack(false)
        expect(writes).toEqual([])
        await playFrames()
        await leave()
        await comeBack(true)
        await playFrames()
        expect(Math.abs(rowTop(anchor.index) - anchor.offset)).toBeLessThanOrEqual(0.5)
        expect(bottomTop() - top).toBeGreaterThan(2)
    })
    test('B2: the follower state does not decide the end: a following reader scrolled away without input keeps the place', async () => {
        seedLong(activeChat(), 1000)
        await show(99, 15)
        await readFromEnd(0)
        top -= 50
        await leave()
        await comeBack(false)
        expect(writes).toEqual([])
    })
})

describe('a message that is not mounted after the return', () => {
    test('R3b: a following reader whose anchor fell off the tracking window gets the window reloaded around it, and no focus moves', async () => {
        const before = document.activeElement
        await fixtureJump()
        await playFrames()
        expect(articleAt(994)).not.toBeNull()
        expect(Math.abs(rowTop(994))).toBeLessThanOrEqual(0.5)
        expect(articleAt(1019)).not.toBeNull()
        expect(document.activeElement).toBe(before)
    })
    test('R7: a deferred jump that waits at the return is run, and the restore does not take its place', async () => {
        await fixtureWaitingJump()
        await playFrames()
        expect(articleAt(500)).not.toBeNull()
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
    })
    test('R11b: a hide before the restore has run leaves the position to the next visit: the stale restore neither jumps nor writes', async () => {
        seedLong(activeChat(), 1000)
        await show(99, 15)
        top = 3105
        await leave()
        DBState.db.chatLoadInitialPages = 15
        await settle()
        chatSurface.hidden = false
        flushSync()
        // The reader is at message 990 and leaves again before the first return's microtasks have run.
        top = 621
        hiding()
        chatSurface.hidden = true
        await settle(false)
        await comeBack(false)
        await playFrames()
        expect(Math.abs(rowTop(990))).toBeLessThanOrEqual(0.5)
        expect(top).not.toBe(bottomTop())
        expect(articleAt(930)).toBeNull()
    })
    test('R12: reader input while the restore waits on a step hold ends the wait, and nothing writes in its place', async () => {
        // The anchor (message 930) is outside the lowered window, so the restore takes the jump path and waits for the step on message 990.
        const held = await fixtureHeldJump()
        writes.length = 0
        emitIntent('older')
        runFrames()
        await settle(false)
        // The reader owns the position: the late page-size reset must not rest at the newest message while the step still holds.
        expect(writes).toEqual([])
        held.release()
        await held.running
        await settle()
        await playFrames()
        expect(top).toBe(621)
        expect(top).not.toBe(bottomTop())
    })
})

describe('a lowered page size with the anchor to restore', () => {
    test('R3: the window shrinks and the anchor is outside it: the window is reloaded around the anchor, and no focus moves', async () => {
        const before = document.activeElement
        await fixtureLoweredJump()
        await playFrames()
        expect(articleAt(930)).not.toBeNull()
        expect(Math.abs(rowTop(930))).toBeLessThanOrEqual(0.5)
        expect(top).not.toBe(bottomTop())
        // The jump's own write is the only one: the page-size reset does not rest at the newest message first.
        expect(writes).toHaveLength(1)
        expect(document.activeElement).toBe(before)
        expect(anchorValue()).toBe('')
    })
    test('R8: the window shrinks and the anchor is still inside it: the anchor is aligned in place, not rested at the newest message', async () => {
        await fixtureLoweredAlign()
        await playFrames()
        expect(articleAt(990)).not.toBeNull()
        expect(Math.abs(rowTop(990))).toBeLessThanOrEqual(0.5)
        expect(top).not.toBe(bottomTop())
        // One write puts the anchor back; the page-size reset does not rest at the newest message first.
        expect(writes).toEqual([2187])
    })
    test('R9: the reload is refused while an editor is open: the reader rests at the newest message, as before', async () => {
        await fixtureLoweredBlocked()
        await playFrames()
        expect(top).toBe(bottomTop())
        expect(articleAt(903)).toBeNull()
    })
    test('R11: a hide while the restore waits on a step ends that visit without a reset; the next return restores the second visit', async () => {
        const held = await fixtureHeldJump()
        hiding()
        chatSurface.hidden = true
        await settle(false)
        // The wait sees the hidden surface and gives up.
        runFrames()
        await settle(false)
        held.release()
        await held.running
        await settle()
        writes.length = 0
        await comeBack(false)
        await playFrames()
        expect(Math.abs(rowTop(990))).toBeLessThanOrEqual(0.5)
        expect(top).not.toBe(bottomTop())
        expect(writes).toEqual([])
    })
    test('R15: a newer jump that takes over from the waiting restore owns the position: no late reset rests at the newest message', async () => {
        const held = await fixtureHeldJump()
        writes.length = 0
        const newer = track(app!.jumpTo(500))
        // The restore's own jump notices the newer one at the next frame and gives up.
        runFrames()
        await settle(false)
        expect(writes).toEqual([])
        held.release()
        await held.running
        await settle()
        await playFrames()
        expect(newer.result()?.status).toBe('done')
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
    })
    test('R14: a restore that throws still ends with the late reset, so the reader rests at the newest message', async () => {
        await lowerWhileHidden(9315, 30)
        chatSurface.hidden = false
        flushSync()
        // The browser would have clamped the old position into the shorter content: message 990 at the top edge.
        top = 2187
        rectProbe = () => { rectProbe = null; throw new Error('probe') }
        await settle(false)
        await playFrames()
        expect(recordCaughtError).toHaveBeenCalledWith('chat.returnRestore', expect.any(Error))
        expect(top).toBe(bottomTop())
    })
    test('R14b: a reader who acts while the restore is thrown away keeps the place: no late reset', async () => {
        await lowerWhileHidden(9315, 30)
        chatSurface.hidden = false
        flushSync()
        // The browser would have clamped the old position into the shorter content: message 990 at the top edge.
        top = 2187
        rectProbe = () => { rectProbe = null; emitIntent('older'); throw new Error('probe') }
        await settle(false)
        await playFrames()
        expect(recordCaughtError).toHaveBeenCalledWith('chat.returnRestore', expect.any(Error))
        expect(top).not.toBe(bottomTop())
    })
    test('R16: a chat switched while the restore waits ends without a late reset: a reader who scrolled the new chat without intent keeps the place', async () => {
        seedLong(character.chats[1], 1000)
        const held = await fixtureHeldJump()
        character.chatPage = 1
        await settle(false)
        // A scrollbar drag moves the reader without an intent event.
        top = 800
        app!.onScroll()
        writes.length = 0
        runFrames()
        await settle(false)
        runFrames()
        await settle(false)
        expect(writes).toEqual([])
        held.release()
        await held.running
        await settle()
        await playFrames()
        expect(writes).toEqual([])
        expect(top).toBe(800)
    })
})

describe('a return that follows or does not follow the newest message', () => {
    // One 500 px reply arrives while the surface is hidden; the reader had come to rest at the exact end.
    async function fixtureReplyWhileHidden(autoScroll: boolean): Promise<{ before: number, anchor: { index: number, offset: number } }> {
        seedLong(activeChat(), 1000)
        await show(99, 15)
        DBState.db.autoScrollToNewMessage = autoScroll
        await readFromEnd(0)
        const before = top
        const anchor = app!.readOrigin()!
        await leave()
        heightOverride.set(1000, 500)
        append('char', 1)
        await settle()
        await comeBack(false)
        return { before, anchor }
    }
    test('R17: a reader at the exact end whom the app does not follow keeps the same message at the same offset when a reply arrived while hidden', async () => {
        const { anchor } = await fixtureReplyWhileHidden(false)
        await playFrames()
        expect(writes).not.toContain(bottomTop())
        expect(Math.abs(rowTop(anchor.index) - anchor.offset)).toBeLessThanOrEqual(0.5)
        expect(top).toBeLessThan(bottomTop())
    })
    test('R17b: a following reader lands at the newest message when a reply arrived while hidden', async () => {
        const { before } = await fixtureReplyWhileHidden(true)
        await playFrames()
        expect(top).toBe(bottomTop())
        expect(top).toBeGreaterThan(before)
    })
    test('R18: a jump made right after the return took the position is not cancelled by the restore', async () => {
        await showAtAnchor903()
        await leave()
        chatSurface.hidden = false
        flushSync()
        const newer = track(app!.jumpTo(500))
        await settle(false)
        await playFrames()
        expect(newer.result()?.status).toBe('done')
        expect(articleAt(500)).not.toBeNull()
        expect(Math.abs(rowTop(500) - hostHeight / 3)).toBeLessThanOrEqual(0.5)
    })
})

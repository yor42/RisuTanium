// @vitest-environment jsdom
/**
 * The shell wires the position scrubber: when it shows, what feeds the reader-intent source, where the thumb reads its place and which jump a
 * release runs. REAL: `ChatShell.svelte`, `Scrubber.svelte`, `scrubber.ts`, `readerIntent.ts`, `ReturnChip.svelte`, `returnChip.ts`, `jumpTarget.ts`.
 * MOCKED: stores, the message list (a stub whose `jumpTo` and `readOrigin` answer what the test sets and whose props expose the shell's reader
 * intent), the sheets, the composer, the floating buttons, the toast post and the language table. jsdom has no layout: the transcript's scroll
 * geometry, `scrollBy` and the rects of the transcript and the scrubber are stubbed.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { JumpOptions, JumpOrigin, JumpResult } from '../../ts/chatShell/jumpTarget'
import type { ReaderIntent, ReaderIntentEvent } from '../../ts/chatShell/readerIntent'

type ThisChatProps = { onjumpsheet?: (opener: HTMLElement | null) => void }

const captured = vi.hoisted(() => ({
    list: null as null | { readerIntent: ReaderIntent },
    thisChat: null as null | ThisChatProps,
    jumpSheet: false,
    jumpTo: null as null | ((index: number, options?: JumpOptions) => Promise<JumpResult>),
    readOrigin: null as null | (() => JumpOrigin | null),
}))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const chats = [{ id: 'chat-a', message: [] as unknown[] }, { id: 'chat-b', message: [] as unknown[] }]
    const state = $state({ db: { characters: [{ chaId: 'c', type: 'character', name: 'Seraphina', chatPage: 0, chats }] } })
    const selection = $state({ selId: 0 })
    return { DBState: state, selIdState: selection, MobileGUI: store(true), DynamicGUI: store(false), sideBarClosing: store(false), sideBarStore: store(false), alertStore: store({ type: 'none', msg: '' }) }
})
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: () => 0 }))
vi.mock('../../lang', () => ({
    language: {
        chatShellMessages: 'Messages', chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellThisChat: 'This chat',
        chatShellChatOpened: (name: string) => `Opened ${name}`, chatShellGoBack: 'Go back', chatShellJumpedBack: 'Moved. Go back returns.', chatShellJumpEditorOpen: 'Close the editor',
        chatShellScrubberBubble: (position: string, total: string) => `${position} / ${total}`,
        chatShellScrubberBubbleDated: (position: string, total: string, date: string) => `${position} / ${total} - ${date}`,
        hypaV3Modal: { connectedMessageNotFoundLabel: 'Message not found' },
    },
}))
vi.mock('./ShellComposer.svelte', () => ({ default: (anchor: Comment) => {
    const field = document.createElement('textarea')
    field.setAttribute('data-part', 'chat-composer-input')
    anchor.before(field)
    return {}
} }))
vi.mock('./ShellMessageList.svelte', () => ({ default: (_anchor: Comment, props: { readerIntent: ReaderIntent }) => {
    captured.list = props
    return {
        onScroll: () => {},
        anchorNewestBottom: () => {},
        jumpToLatest: async () => {},
        jumpTo: (...args: [number, JumpOptions?]) => captured.jumpTo!(...args),
        returnTo: async () => ({ status: 'done', from: null, to: 0 }),
        readOrigin: () => captured.readOrigin?.() ?? null,
    }
} }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: (_anchor: Comment, props: ThisChatProps) => {
    captured.thisChat = props
    return {}
} }))
vi.mock('./JumpSheet.svelte', () => ({ default: () => {
    captured.jumpSheet = true
    return {}
} }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, isComposerBusyIn: () => false, branchAt: vi.fn() }))

import ChatShell from './ChatShell.svelte'
import { DBState, selIdState } from '../../ts/stores.svelte'

type ChatRecord = { id: string, message: unknown[] }
type CharacterRecord = { chaId: string, type: string, name: string, chatPage: number, chats: ChatRecord[] }

const FRAME_TIMERS = ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
const origin: JumpOrigin = { index: 5, offset: 40, atBottom: false }

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
let jumpTo: Mock<(index: number, options?: JumpOptions) => Promise<JumpResult>>
let scroll: { top: number, log: string[], scrollBy: Mock<(options: ScrollToOptions) => void> }
let intents: ReaderIntentEvent[]
let stopIntents: (() => void) | undefined

const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const scrubber = () => target.querySelector<HTMLElement>('[data-part="chat-scrubber"]')!
const track = () => target.querySelector<HTMLElement>('[data-part="chat-scrubber-track"]')!
const thumb = () => target.querySelector<HTMLElement>('[data-part="chat-scrubber-thumb"]')!
const chipButton = () => target.querySelector<HTMLButtonElement>('[data-part="chat-return-chip"]')
const shown = () => !scrubber().hasAttribute('data-hidden')
const fractionNow = () => Number(scrubber().style.getPropertyValue('--chat-scrub-p'))
const characters = () => DBState.db.characters as unknown as CharacterRecord[]

async function mountShell(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!captured.list || !captured.thisChat?.onjumpsheet || !captured.jumpSheet || !scrubber()) throw new Error('waiting for the list, the sheets and the scrubber')
    }, { timeout: 15000 })
    stopIntents = captured.list!.readerIntent.subscribe((event) => { intents.push(event); scroll.log.push('intent') })
}

// A transcript that overflows and sits 300 px below its top, so a pull toward older content can move it.
function prepareTranscript(): void {
    const main = transcript()
    Object.defineProperty(main, 'scrollHeight', { value: 5000, configurable: true })
    Object.defineProperty(main, 'clientHeight', { value: 600, configurable: true })
    Object.defineProperty(main, 'scrollTop', { get: () => scroll.top, set: (value: number) => { scroll.top = value }, configurable: true })
    Object.assign(main, { scrollBy: scroll.scrollBy })
}

function pointer(on: Element, type: string, init: { y?: number, x?: number, pointerType?: string, relatedTarget?: Element | null } = {}): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 500, clientY: init.y ?? 0, relatedTarget: init.relatedTarget ?? null })
    Object.defineProperties(event, { pointerType: { value: init.pointerType ?? 'touch' }, pointerId: { value: 1 } })
    on.dispatchEvent(event)
    flushSync()
}

// Mouse at the right edge of the transcript, inside the 120 px hover band.
function hoverEdge(): void {
    pointer(transcript(), 'pointerenter', { pointerType: 'mouse', x: 390 })
    pointer(transcript(), 'pointermove', { pointerType: 'mouse', x: 390 })
}

function wheelOlder(): void {
    transcript().dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    flushSync()
}

function settleScrubber(): void {
    flushSync()
    flushSync()
}

beforeEach(() => {
    captured.list = null
    captured.thisChat = null
    captured.jumpSheet = false
    intents = []
    stopIntents = undefined
    scroll = { top: 300, log: [], scrollBy: vi.fn((options: ScrollToOptions) => { scroll.log.push('scrollBy'); scroll.top = Math.max(0, scroll.top + (options.top ?? 0)) }) }
    jumpTo = vi.fn<(index: number, options?: JumpOptions) => Promise<JumpResult>>(async () => ({ status: 'cancelled', from: null, to: 0 }))
    captured.jumpTo = (...args) => jumpTo(...args)
    captured.readOrigin = null
    characters()[0].chatPage = 0
    selIdState.selId = 0
    characters()[0].chats[0].message = new Array(200).fill(null)
    characters()[0].chats[1].message = new Array(200).fill(null)
    Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const part = this.dataset.part
        const height = part === 'chat-scrubber-track' ? 456 : part === 'chat-scrubber-thumb' ? 56 : part === 'chat-transcript' ? 600 : 0
        const top = part === 'chat-scrubber-track' || part === 'chat-scrubber-thumb' ? 100 : 0
        const right = part === 'chat-transcript' ? 400 : 44
        return { top, bottom: top + height, left: 0, right, width: right, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    })
})
afterEach(async () => {
    stopIntents?.()
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (app) await unmount(app).catch(() => {})
    app = undefined
    characters().length = 1
    document.body.replaceChildren()
})

describe('mounting and visibility', () => {
    test('W1: the scrubber sits in the jump host before the return chip, hidden from assistive technology', async () => {
        await mountShell()
        const host = target.querySelector('.jump-host')!
        expect(host.contains(scrubber())).toBe(true)
        expect(transcript().contains(scrubber())).toBe(false)
        expect(scrubber().getAttribute('aria-hidden')).toBe('true')
        expect(shown()).toBe(false)
    })
    test('W2: reader input shows it for 1500 ms and then it hides', async () => {
        await mountShell()
        prepareTranscript()
        vi.useFakeTimers({ toFake: [...FRAME_TIMERS] })
        wheelOlder()
        settleScrubber()
        expect(shown()).toBe(true)
        vi.advanceTimersByTime(1499)
        flushSync()
        expect(shown()).toBe(true)
        vi.advanceTimersByTime(1)
        flushSync()
        expect(shown()).toBe(false)
    })
    test('W3: a release runs one jump that keeps focus where it was and offers the chip for a long move', async () => {
        await mountShell()
        prepareTranscript()
        jumpTo.mockImplementationOnce(async () => ({ status: 'done', from: origin, to: 119 }))
        wheelOlder()
        settleScrubber()
        pointer(thumb(), 'pointerdown', { y: 128 })
        pointer(thumb(), 'pointermove', { y: 368 })
        pointer(thumb(), 'pointerup', { y: 368 })
        for (let round = 0; round < 8; round++) await tick()
        flushSync()
        expect(jumpTo).toHaveBeenCalledExactlyOnceWith(119, { focus: false })
        expect(chipButton()).not.toBeNull()
    })
    test('W4: a chat of one message, a transcript that does not overflow, and an open sheet each keep it hidden', async () => {
        await mountShell()
        prepareTranscript()
        characters()[0].chats[0].message = new Array(1).fill(null)
        flushSync()
        wheelOlder()
        settleScrubber()
        expect(shown()).toBe(false)
        characters()[0].chats[0].message = new Array(200).fill(null)
        flushSync()
        Object.defineProperty(transcript(), 'scrollHeight', { value: 600, configurable: true })
        scroll.top = 300
        wheelOlder()
        settleScrubber()
        expect(shown()).toBe(false)
        Object.defineProperty(transcript(), 'scrollHeight', { value: 5000, configurable: true })
        wheelOlder()
        settleScrubber()
        expect(shown()).toBe(true)
        captured.thisChat!.onjumpsheet!(null)
        settleScrubber()
        expect(shown()).toBe(false)
    })
})

describe('feeding the reader-intent source', () => {
    test('W5b: track paging feeds one wheel intent before the list moves, so a page that reaches the top still counts', async () => {
        await mountShell()
        prepareTranscript()
        hoverEdge()
        settleScrubber()
        expect(track().hasAttribute('data-interactive')).toBe(true)
        scroll.log.length = 0
        intents.length = 0
        track().dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 90 }))
        flushSync()
        expect(intents).toHaveLength(1)
        expect(intents[0].direction).toBe('older')
        expect(intents[0].source).toBe('wheel')
        expect(intents[0].distance).toBeCloseTo(540)
        expect(scroll.scrollBy).toHaveBeenCalledOnce()
        expect(scroll.scrollBy.mock.calls[0][0].top).toBeCloseTo(-540)
        expect(scroll.scrollBy.mock.calls[0][0].behavior).toBe('instant')
        expect(scroll.log).toEqual(['intent', 'scrollBy'])
    })
    test('W11: a wheel over the thumb scrolls once and feeds one intent; with ctrl it does neither', async () => {
        await mountShell()
        prepareTranscript()
        wheelOlder()
        settleScrubber()
        intents.length = 0
        scroll.scrollBy.mockClear()
        thumb().dispatchEvent(new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, bubbles: true, cancelable: true }))
        flushSync()
        expect(scroll.scrollBy).not.toHaveBeenCalled()
        expect(intents).toHaveLength(0)
        thumb().dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true }))
        flushSync()
        expect(scroll.scrollBy).toHaveBeenCalledOnce()
        expect(scroll.scrollBy.mock.calls[0][0].top).toBe(-40)
        expect(intents).toHaveLength(1)
    })
})

describe('hover', () => {
    test('W10: leaving the transcript onto the thumb keeps the track interactive', async () => {
        await mountShell()
        prepareTranscript()
        hoverEdge()
        settleScrubber()
        expect(shown()).toBe(true)
        expect(track().hasAttribute('data-interactive')).toBe(true)
        pointer(transcript(), 'pointerleave', { pointerType: 'mouse', x: 420, relatedTarget: thumb() })
        settleScrubber()
        expect(shown()).toBe(true)
        expect(track().hasAttribute('data-interactive')).toBe(true)
        pointer(transcript(), 'pointerleave', { pointerType: 'mouse', x: 420, relatedTarget: null })
        settleScrubber()
        expect(track().hasAttribute('data-interactive')).toBe(false)
    })
    test('W12: a mouse far from the right edge reveals nothing', async () => {
        await mountShell()
        prepareTranscript()
        pointer(transcript(), 'pointerenter', { pointerType: 'mouse', x: 100 })
        pointer(transcript(), 'pointermove', { pointerType: 'mouse', x: 100 })
        settleScrubber()
        expect(shown()).toBe(false)
    })
})

describe('the thumb position', () => {
    test('W9: the fraction is read one frame after a reveal and after a drag ends; a hidden surface keeps the last value', async () => {
        await mountShell()
        prepareTranscript()
        characters()[0].chats[0].message = new Array(5800).fill(null)
        flushSync()
        vi.useFakeTimers({ toFake: [...FRAME_TIMERS] })
        captured.readOrigin = () => ({ index: 5799, offset: 0, atBottom: true })
        hoverEdge()
        settleScrubber()
        vi.advanceTimersByTime(20)
        flushSync()
        expect(fractionNow()).toBe(1)

        captured.readOrigin = () => ({ index: 2900, offset: 0, atBottom: false })
        pointer(thumb(), 'pointerdown', { y: 428 })
        pointer(thumb(), 'pointermove', { y: 128 })
        pointer(thumb(), 'pointerup', { y: 128 })
        vi.advanceTimersByTime(20)
        flushSync()
        expect(fractionNow()).toBeCloseTo(2900 / 5799, 4)
        const settled = fractionNow()

        pointer(transcript(), 'pointerleave', { pointerType: 'mouse', x: 420 })
        vi.advanceTimersByTime(2000)
        flushSync()
        expect(shown()).toBe(false)
        captured.readOrigin = () => null
        hoverEdge()
        settleScrubber()
        vi.advanceTimersByTime(20)
        flushSync()
        expect(shown()).toBe(true)
        expect(fractionNow()).toBe(settled)
    })
})

describe('a chat switch', () => {
    test('W7b: a drag does not survive a switch to another character whose chat has the same id', async () => {
        await mountShell()
        prepareTranscript()
        characters().push({ chaId: 'd', type: 'character', name: 'Other', chatPage: 0, chats: [{ id: 'chat-a', message: new Array(200).fill(null) }] })
        wheelOlder()
        settleScrubber()
        const oldThumb = thumb()
        pointer(oldThumb, 'pointerdown', { y: 128 })
        pointer(oldThumb, 'pointermove', { y: 368 })
        selIdState.selId = 1
        flushSync()
        settleScrubber()
        pointer(oldThumb, 'pointerup', { y: 368 })
        for (let round = 0; round < 8; round++) await tick()
        expect(jumpTo).not.toHaveBeenCalled()
    })
})

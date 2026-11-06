// @vitest-environment jsdom
/**
 * The header rule (C-3) follows the reader's input only: touch travel, the wheel and the scrollbar. Scroll events, whatever
 * moved scrollTop (the list's restores, the browser's anchoring, clamps), neither show nor hide it, and neither do scroll keys.
 * REAL: `ChatShell.svelte`, `ShellHeader.svelte`, `readerIntent.ts`. MOCKED: stores, composer, sheets and the message list.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReaderIntentSource } from '../../ts/chatShell/readerIntent'

const captured = vi.hoisted(() => ({
    hardware: null as null | ((seen: boolean) => void),
    intent: null as null | ReaderIntentSource,
}))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const state = $state({ db: { characters: [{ chaId: 'c', type: 'character', name: 'Seraphina', chatPage: 0, chats: [{ id: 'chat', message: [] }] }] } })
    const selection = $state({ selId: 0 })
    return { DBState: state, selIdState: selection, MobileGUI: store(true), DynamicGUI: store(false), sideBarClosing: store(false), sideBarStore: store(false) }
})
vi.mock('../../ts/process/index.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return { doingChat: store(false), chatProcessStage: store(0) }
})
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../lang', () => ({ language: { chatShellMessages: 'Messages', chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona' } }))
vi.mock('../Mobile/mobileBack', () => ({ closeShellChat: vi.fn() }))
vi.mock('./ShellComposer.svelte', () => ({ default: (_anchor: Comment, props: { onhardwarechange: (seen: boolean) => void }) => {
    captured.hardware = props.onhardwarechange
    return {}
} }))
vi.mock('./ShellMessageList.svelte', () => ({ default: (_anchor: Comment, props: { readerIntent: ReaderIntentSource }) => {
    captured.intent = props.readerIntent
    return { onScroll: () => {}, anchorNewestBottom: () => {} }
} }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))

import ChatShell from './ChatShell.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
let scrollTop = 500

const header = () => target.querySelector('header')!
const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const hidden = () => header().hasAttribute('data-hidden')

async function mountShell(width = 400): Promise<void> {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!target.querySelector('header') || !captured.hardware || !captured.intent) throw new Error('waiting for the header and list')
    })
    // Room above and below the reader, so an intent in either direction is movable.
    Object.defineProperty(transcript(), 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(transcript(), 'clientHeight', { value: 800, configurable: true })
}

function touch(type: string, y: number | null): void {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'touches', { value: y === null ? [] : [{ clientX: 100, clientY: y }] })
    transcript().dispatchEvent(event)
    flushSync()
}

// A finger drag: down means older, up means newer; the travel is `distance` px in one move.
function drag(direction: 'older' | 'newer', distance: number): void {
    touch('touchstart', 400)
    touch('touchmove', direction === 'older' ? 400 + distance : 400 - distance)
    touch('touchend', null)
}

function wheel(deltaY: number): void {
    transcript().dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }))
    flushSync()
}

// The browser (or the list) moves scrollTop and a scroll event follows, with no input behind it.
function scrollMovesTo(top: number): void {
    scrollTop = top
    transcript().dispatchEvent(new Event('scroll'))
    flushSync()
}

beforeEach(() => {
    captured.hardware = null
    captured.intent = null
    scrollTop = 500
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1 })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value }, configurable: true })
})

afterEach(async () => {
    if (app) await unmount(app).catch(() => {})
    app = undefined
    document.body.replaceChildren()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
    vi.unstubAllGlobals()
})

describe('scroll events never drive the header', () => {
    test('T-A3a reproducer: a scrollTop increase with no gesture keeps a hidden header hidden', async () => {
        await mountShell()
        wheel(-40)
        expect(hidden()).toBe(true)
        scrollMovesTo(420)
        scrollMovesTo(700)
        expect(hidden()).toBe(true)
    })
    test('T-A3b reproducer: a 30 px scrollTop decrease with no gesture keeps a shown header shown', async () => {
        await mountShell()
        scrollMovesTo(500)
        scrollMovesTo(470)
        scrollMovesTo(300)
        expect(hidden()).toBe(false)
    })
    test('scroll keys do not drive the header', async () => {
        await mountShell()
        for (let press = 0; press < 5; press++) transcript().dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))
        flushSync()
        expect(hidden()).toBe(false)
    })
})

describe('the reader\'s input drives the header (C-3)', () => {
    test('T-A3c 23 px of older touch travel does not hide it, 24 px does', async () => {
        await mountShell()
        drag('older', 23)
        expect(hidden()).toBe(false)
        await unmount(app!)
        document.body.replaceChildren()
        await mountShell()
        drag('older', 24)
        expect(hidden()).toBe(true)
    })
    test('older travel accumulates across gestures until a newer one resets it', async () => {
        await mountShell()
        drag('older', 15)
        drag('newer', 10)
        drag('older', 15)
        expect(hidden()).toBe(false)
        drag('older', 15)
        expect(hidden()).toBe(true)
    })
    test('any newer travel shows a hidden header', async () => {
        await mountShell()
        drag('older', 40)
        expect(hidden()).toBe(true)
        drag('newer', 10)
        expect(hidden()).toBe(false)
    })
    test('the wheel drives it as touch does', async () => {
        await mountShell()
        wheel(-30)
        expect(hidden()).toBe(true)
        wheel(10)
        expect(hidden()).toBe(false)
    })
    test('an older pull at the oldest end does nothing', async () => {
        await mountShell()
        scrollTop = 0
        drag('older', 60)
        expect(hidden()).toBe(false)
    })
    test('a hardware keyboard keeps the header shown', async () => {
        await mountShell()
        captured.hardware!(true)
        flushSync()
        drag('older', 60)
        expect(hidden()).toBe(false)
    })
    test('the wide layout never hides it', async () => {
        await mountShell(1000)
        drag('older', 60)
        expect(hidden()).toBe(false)
    })
    test('the list receives the same intent source', async () => {
        await mountShell()
        const seen: string[] = []
        captured.intent!.subscribe((event) => seen.push(event.direction))
        wheel(-30)
        expect(seen).toEqual(['older'])
    })
    test('focus into the header shows it', async () => {
        await mountShell()
        wheel(-40)
        expect(hidden()).toBe(true)
        header().querySelector<HTMLButtonElement>('button')!.focus()
        await tick()
        flushSync()
        expect(hidden()).toBe(false)
    })
})

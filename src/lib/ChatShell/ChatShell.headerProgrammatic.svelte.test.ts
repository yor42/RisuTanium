// @vitest-environment jsdom
/**
 * The header rule (C-3) follows the reader's scrolling only. The list's own scrollTop writes (load-older restore, the bottom
 * anchor) raise scroll events that must neither show nor hide it. REAL: `ChatShell.svelte`, `ShellHeader.svelte`,
 * `bottomAnchor.ts` (the marker). MOCKED: stores, composer, sheets and the message list, which writes scrollTop and marks
 * it through the marker prop the shell hands it, as `ShellMessageList.svelte` does.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProgrammaticScrollMarker } from '../../ts/chatShell/bottomAnchor'

const captured = vi.hoisted(() => ({
    hardware: null as null | ((seen: boolean) => void),
    marker: null as null | ProgrammaticScrollMarker,
    anchor: null as null | (() => void),
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
vi.mock('./ShellMessageList.svelte', () => ({ default: (_anchor: Comment, props: { scrollMarker: ProgrammaticScrollMarker }) => {
    captured.marker = props.scrollMarker
    return { onScroll: () => {}, anchorNewestBottom: () => captured.anchor?.() }
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
let scrollTop = 0

const header = () => target.querySelector('header')!
const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const hidden = () => header().hasAttribute('data-hidden')

async function mountShell(): Promise<void> {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!target.querySelector('header') || !captured.hardware || !captured.marker) throw new Error('waiting for the header and list')
    })
}

// The reader scrolls: the position changes and the event arrives with no shell write behind it.
function readerScrollTo(top: number): void {
    scrollTop = top
    transcript().dispatchEvent(new Event('scroll'))
    flushSync()
}

// The list writes scrollTop itself and marks it; the scroll event is delivered afterwards.
function listWritesThenScrollEvent(top: number): void {
    scrollTop = top
    captured.marker!.mark(top)
    transcript().dispatchEvent(new Event('scroll'))
    flushSync()
}

beforeEach(() => {
    captured.hardware = null
    captured.marker = null
    captured.anchor = null
    scrollTop = 0
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

describe('programmatic scrolls leave the header alone', () => {
    test('reproducer: a load-older restore raising scrollTop while the header is hidden keeps it hidden', async () => {
        await mountShell()
        readerScrollTo(500)
        readerScrollTo(300)
        expect(hidden()).toBe(true)
        listWritesThenScrollEvent(420)
        expect(hidden()).toBe(true)
    })

    test('the next reader scroll toward newer still shows it after a programmatic one was ignored', async () => {
        await mountShell()
        readerScrollTo(500)
        readerScrollTo(300)
        listWritesThenScrollEvent(420)
        readerScrollTo(480)
        expect(hidden()).toBe(false)
    })

    test('a programmatic scroll does not hide a shown header either', async () => {
        await mountShell()
        readerScrollTo(500)
        listWritesThenScrollEvent(100)
        expect(hidden()).toBe(false)
    })

    test('anchorNewestBottom keeps the hidden state', async () => {
        await mountShell()
        // The hide itself requests the bottom anchor on the next frame; its write moves toward newer and its scroll event is not the reader's.
        const anchored = vi.fn(() => { scrollTop = 900; captured.marker!.mark(900) })
        captured.anchor = anchored
        readerScrollTo(500)
        readerScrollTo(300)
        expect(anchored).toHaveBeenCalledTimes(1)
        transcript().dispatchEvent(new Event('scroll'))
        flushSync()
        expect(hidden()).toBe(true)
    })
})

describe('the reader still drives the header (C-3)', () => {
    test('a scroll toward newer shows a hidden header', async () => {
        await mountShell()
        readerScrollTo(500)
        readerScrollTo(300)
        expect(hidden()).toBe(true)
        readerScrollTo(320)
        expect(hidden()).toBe(false)
    })

    test('a scroll toward older of 24 px or more hides it, and less does not', async () => {
        await mountShell()
        readerScrollTo(500)
        readerScrollTo(480)
        expect(hidden()).toBe(false)
        readerScrollTo(470)
        expect(hidden()).toBe(true)
    })

    test('focus into the header shows it', async () => {
        await mountShell()
        readerScrollTo(500)
        readerScrollTo(300)
        expect(hidden()).toBe(true)
        header().querySelector<HTMLButtonElement>('button')!.focus()
        await tick()
        flushSync()
        expect(hidden()).toBe(false)
    })
})

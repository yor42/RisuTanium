// @vitest-environment jsdom
/**
 * The chat header hides while the soft keyboard is open and returns when it closes, unless the scroll rule (C-3) wants
 * it hidden. REAL: `ChatShell.svelte`, `ShellHeader.svelte`, `softKeyboard.ts`, `bottomAnchor.ts`. MOCKED: stores, the
 * composer (a text field plus the hardware callback), the message list (records the bottom anchor) and the sheets.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const captured = vi.hoisted(() => ({
    hardware: null as null | ((seen: boolean) => void),
    anchor: null as null | (() => void),
    listProps: null as null | { atBottom: boolean },
}))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const state = $state({ db: { characters: [{ chaId: 'c', type: 'character', name: 'Seraphina', chatPage: 0, chats: [{ id: 'chat', message: [] }] }] } })
    const selection = $state({ selId: 0 })
    return { DBState: state, selIdState: selection, MobileGUI: store(true), DynamicGUI: store(false), sideBarClosing: store(false), sideBarStore: store(false) }
})
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../lang', () => ({ language: { chatShellMessages: 'Messages', chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona' } }))
vi.mock('../Mobile/mobileBack', () => ({ closeShellChat: vi.fn() }))
vi.mock('./ShellComposer.svelte', () => ({ default: (anchor: Comment, props: { onhardwarechange: (seen: boolean) => void }) => {
    captured.hardware = props.onhardwarechange
    const field = document.createElement('textarea')
    field.setAttribute('data-test', 'composer-field')
    anchor.before(field)
    return {}
} }))
vi.mock('./ShellMessageList.svelte', () => ({ default: (_anchor: Comment, props: { atBottom: boolean }) => {
    captured.listProps = props
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

class ViewportStub extends EventTarget {
    height = 800
    width = 400
    scale = 1
    resize(height: number): void {
        this.height = height
        this.dispatchEvent(new Event('resize'))
    }
}

const KEYBOARD_HEIGHT = 450
const URL_BAR_HEIGHT = 760

let viewport: ViewportStub
let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
let frames: Array<() => void>
const anchor = vi.fn()

async function mountShell(width = 400): Promise<void> {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    viewport = new ViewportStub()
    viewport.width = width
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!target.querySelector('header') || !captured.hardware) throw new Error('waiting for the header and composer')
    })
}

const header = () => target.querySelector('header')!
const field = () => target.querySelector<HTMLTextAreaElement>('[data-test="composer-field"]')!
const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const hidden = () => header().hasAttribute('data-hidden')

async function openKeyboard(): Promise<void> {
    field().focus()
    viewport.resize(KEYBOARD_HEIGHT)
    await tick()
    flushSync()
}

async function closeKeyboard(): Promise<void> {
    viewport.resize(800)
    field().blur()
    await tick()
    flushSync()
}

let scrollTop = 0
function scrollTo(top: number): void {
    scrollTop = top
    transcript().dispatchEvent(new Event('scroll'))
    flushSync()
}

beforeEach(() => {
    captured.hardware = null
    captured.listProps = null
    captured.anchor = anchor
    anchor.mockClear()
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frames.push(callback); return frames.length })
    scrollTop = 0
})

afterEach(async () => {
    if (app) await unmount(app).catch(() => {})
    app = undefined
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'visualViewport')
    vi.unstubAllGlobals()
})

function runFrames(): void {
    for (const frame of frames.splice(0)) frame()
}

describe('the header hides while the soft keyboard is open', () => {
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value }, configurable: true })
    })
    afterEach(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
    })

    test('reproducer: a focused composer and a clearly shorter viewport hide the header in the narrow layout', async () => {
        await mountShell()
        expect(hidden()).toBe(false)
        await openKeyboard()
        expect(hidden()).toBe(true)
    })

    test('closing the keyboard returns the header', async () => {
        await mountShell()
        await openKeyboard()
        await closeKeyboard()
        expect(hidden()).toBe(false)
    })

    test('closing the keyboard keeps the hidden state the scroll rule asked for before typing', async () => {
        await mountShell()
        scrollTo(500)
        scrollTo(300)
        expect(hidden()).toBe(true)
        await openKeyboard()
        expect(hidden()).toBe(true)
        await closeKeyboard()
        expect(hidden()).toBe(true)
    })

    test('while the keyboard is open a scroll toward newer messages does not show the header, and closing then returns it', async () => {
        await mountShell()
        scrollTo(500)
        scrollTo(300)
        await openKeyboard()
        scrollTo(600)
        expect(hidden()).toBe(true)
        await closeKeyboard()
        expect(hidden()).toBe(false)
    })

    test('the mid layout is narrow too', async () => {
        await mountShell(700)
        await openKeyboard()
        expect(hidden()).toBe(true)
    })

    test('the wide layout never hides the header for the keyboard', async () => {
        await mountShell(1000)
        await openKeyboard()
        expect(hidden()).toBe(false)
    })

    test('a hardware keyboard keeps the header shown while the keyboard rule applies', async () => {
        await mountShell()
        captured.hardware!(true)
        flushSync()
        await openKeyboard()
        expect(hidden()).toBe(false)
        captured.hardware!(false)
        flushSync()
        expect(hidden()).toBe(true)
    })

    test('a URL-bar-sized viewport change does not hide the header', async () => {
        await mountShell()
        field().focus()
        viewport.resize(URL_BAR_HEIGHT)
        await tick()
        flushSync()
        expect(hidden()).toBe(false)
    })

    test('a viewport change with no focused text field does not hide the header', async () => {
        await mountShell()
        viewport.resize(KEYBOARD_HEIGHT)
        await tick()
        flushSync()
        expect(hidden()).toBe(false)
    })

    test('focus moving into the header shows it again', async () => {
        await mountShell()
        await openKeyboard()
        expect(hidden()).toBe(true)
        header().querySelector<HTMLButtonElement>('button')!.focus()
        await tick()
        flushSync()
        expect(hidden()).toBe(false)
    })
})

describe('a reader at the newest message keeps the bottom when the header hides or shows', () => {
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value }, configurable: true })
    })
    afterEach(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
    })

    test('showing the header again when the keyboard closes requests the bottom anchor, though the viewport grew', async () => {
        await mountShell()
        await openKeyboard()
        runFrames()
        anchor.mockClear()
        await closeKeyboard()
        runFrames()
        expect(anchor).toHaveBeenCalledTimes(1)
    })

    test('hiding the header for the keyboard requests the bottom anchor', async () => {
        await mountShell()
        field().focus()
        anchor.mockClear()
        viewport.height = KEYBOARD_HEIGHT
        // The viewport shrink itself is announced by the resize event; this asserts the header's own request by
        // comparing against the same shrink without a focused text field.
        viewport.dispatchEvent(new Event('resize'))
        await tick()
        flushSync()
        runFrames()
        const withHeaderHide = anchor.mock.calls.length
        viewport.height = 800
        field().blur()
        viewport.dispatchEvent(new Event('resize'))
        await tick()
        flushSync()
        runFrames()
        anchor.mockClear()
        viewport.height = KEYBOARD_HEIGHT
        viewport.dispatchEvent(new Event('resize'))
        await tick()
        flushSync()
        runFrames()
        expect(withHeaderHide).toBe(anchor.mock.calls.length + 1)
    })

    test('a scroll-rule hide while resting at the newest message requests the bottom anchor once', async () => {
        await mountShell()
        scrollTo(500)
        anchor.mockClear()
        scrollTo(300)
        expect(hidden()).toBe(true)
        runFrames()
        expect(anchor).toHaveBeenCalledTimes(1)
    })

    test('a reader who is not at the bottom is not anchored', async () => {
        await mountShell()
        captured.listProps!.atBottom = false
        flushSync()
        anchor.mockClear()
        await openKeyboard()
        runFrames()
        expect(anchor).not.toHaveBeenCalled()
    })
})

// @vitest-environment jsdom
/**
 * The chat header hides while the soft keyboard is open and returns when it closes, unless the scroll rule (C-3) wants
 * it hidden. REAL: `ChatShell.svelte`, `ShellHeader.svelte`, `softKeyboard.ts`, `bottomAnchor.ts`, `hostBridge.ts`. MOCKED: stores, the
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
    // Room above and below the reader, so a wheel in either direction can move the transcript.
    Object.defineProperty(transcript(), 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(transcript(), 'clientHeight', { value: 800, configurable: true })
    scrollTop = 500
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
// The reader's own input: a negative deltaY pulls toward older messages, a positive one toward newer.
function wheel(deltaY: number): void {
    transcript().dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }))
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

    test('closing the keyboard keeps the hidden state the reader\'s input asked for before typing', async () => {
        await mountShell()
        wheel(-40)
        expect(hidden()).toBe(true)
        await openKeyboard()
        expect(hidden()).toBe(true)
        await closeKeyboard()
        expect(hidden()).toBe(true)
    })

    test('while the keyboard is open a wheel toward newer messages does not show the header, and closing then returns it', async () => {
        await mountShell()
        wheel(-40)
        await openKeyboard()
        wheel(40)
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

// Device heights: the portrait window, the same window with Gboard open, the lower split-screen window, and the window
// heights seen while rotating to landscape with the keyboard open.
const PORTRAIT = 773.7
const KEYBOARD_VIEWPORT = 485.3
const SPLIT_WINDOW = 370.7

describe('the header follows the keyboard, not the window size', () => {
    let imeVisible = false

    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value }, configurable: true })
    })
    afterEach(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
        Reflect.deleteProperty(window, '__risuTaniumIme')
    })

    // The host's separate keyboard object: the shell re-reads it when the visual viewport resizes.
    function installHost(): void {
        imeVisible = false
        Object.defineProperty(window, '__risuTaniumIme', { value: { visible: () => imeVisible, height: () => (imeVisible ? PORTRAIT - KEYBOARD_VIEWPORT : 0) }, configurable: true })
    }

    function resizeWindow(height: number): void {
        Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
        viewport.resize(height)
    }

    async function settle(): Promise<void> {
        await tick()
        flushSync()
    }

    test('reproducer: a split-screen entry with the composer focused shrinks both heights and does not hide the header', async () => {
        await mountShell()
        resizeWindow(PORTRAIT)
        field().focus()
        resizeWindow(SPLIT_WINDOW)
        await settle()
        expect(hidden()).toBe(false)
    })

    test('with the host, split screen with a focused composer and no keyboard keeps the header shown', async () => {
        installHost()
        await mountShell()
        resizeWindow(PORTRAIT)
        field().focus()
        resizeWindow(SPLIT_WINDOW)
        await settle()
        expect(hidden()).toBe(false)
    })

    test('with the host, the keyboard hides the header and closing it returns the header after a rotation round trip', async () => {
        installHost()
        await mountShell()
        resizeWindow(PORTRAIT)
        field().focus()
        imeVisible = true
        resizeWindow(KEYBOARD_VIEWPORT)
        await settle()
        expect(hidden()).toBe(true)
        resizeWindow(51)
        resizeWindow(387)
        resizeWindow(KEYBOARD_VIEWPORT)
        await settle()
        expect(hidden()).toBe(true)
        imeVisible = false
        resizeWindow(PORTRAIT)
        field().blur()
        await settle()
        expect(hidden()).toBe(false)
    })

    test('with the host, a floating keyboard that takes no space from the page leaves the header shown', async () => {
        installHost()
        await mountShell()
        field().focus()
        viewport.resize(450)
        await settle()
        expect(hidden()).toBe(false)
    })
})

describe('the shell reports the header concealed state for the scroll padding', () => {
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value }, configurable: true })
    })
    afterEach(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
    })
    const concealed = () => target.querySelector('[data-part="chat-shell"]')!.hasAttribute('data-header-concealed')

    test('the attribute follows the hidden flag and the hidden flag alone', async () => {
        await mountShell()
        expect(concealed()).toBe(false)
        wheel(-40)
        expect(concealed()).toBe(true)
        wheel(40)
        expect(concealed()).toBe(false)
    })

    test('a hardware keyboard shows the header, so the attribute is absent while the hidden flag is set', async () => {
        await mountShell()
        captured.hardware!(true)
        flushSync()
        await openKeyboard()
        expect(hidden()).toBe(false)
        expect(concealed()).toBe(false)
        captured.hardware!(false)
        flushSync()
        expect(concealed()).toBe(true)
    })

    test('focus inside the header shows it, so the attribute is absent', async () => {
        await mountShell()
        await openKeyboard()
        expect(concealed()).toBe(true)
        header().querySelector<HTMLButtonElement>('button')!.focus()
        await tick()
        flushSync()
        expect(concealed()).toBe(false)
    })

    test('the wide layout never conceals the header', async () => {
        await mountShell(1000)
        await openKeyboard()
        wheel(-40)
        expect(concealed()).toBe(false)
    })
})

describe('the floating header never changes the transcript geometry, so toggling it does not anchor', () => {
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value }, configurable: true })
    })
    afterEach(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
    })

    test('showing the header again when the keyboard closes does not request the bottom anchor', async () => {
        await mountShell()
        await openKeyboard()
        runFrames()
        anchor.mockClear()
        await closeKeyboard()
        runFrames()
        expect(hidden()).toBe(false)
        expect(anchor).not.toHaveBeenCalled()
    })

    test('a reader-input hide and show while resting at the newest message do not request the bottom anchor', async () => {
        await mountShell()
        anchor.mockClear()
        wheel(-40)
        expect(hidden()).toBe(true)
        runFrames()
        wheel(40)
        expect(hidden()).toBe(false)
        runFrames()
        expect(anchor).not.toHaveBeenCalled()
    })

    test('the keyboard resize itself still anchors a reader at the newest message', async () => {
        await mountShell()
        anchor.mockClear()
        await openKeyboard()
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

// @vitest-environment jsdom
/**
 * The shell wires the jump-to-latest button and the End key to the list. REAL: `ChatShell.svelte`, `shellJumpKeys.ts`, `jumpTarget.ts`.
 * MOCKED: stores, the message list (a stub whose `jumpToLatest` records its call), the floating buttons (a stub that renders a
 * real button and records its props), the composer and the sheets.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'

const captured = vi.hoisted(() => ({
    list: null as null | { atBottom: boolean, unread: boolean, newCount: number, farFromLatest: boolean },
    buttons: null as null | { visible: boolean, count: number, onclick: () => void },
    jump: null as null | ((options: { animate: boolean, focusNewest: boolean }) => Promise<void>),
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
vi.mock('../../lang', () => ({ language: { chatShellMessages: 'Messages', chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellThisChat: 'This chat' } }))
vi.mock('./ShellComposer.svelte', () => ({ default: (anchor: Comment) => {
    const field = document.createElement('textarea')
    field.setAttribute('data-test', 'composer-field')
    anchor.before(field)
    return {}
} }))
vi.mock('./ShellMessageList.svelte', () => ({ default: (_anchor: Comment, props: { atBottom: boolean, unread: boolean, newCount: number, farFromLatest: boolean }) => {
    captured.list = props
    return { onScroll: () => {}, anchorNewestBottom: () => {}, jumpToLatest: (options: { animate: boolean, focusNewest: boolean }) => captured.jump?.(options) }
} }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: (anchor: Comment, props: { visible: boolean, count: number, onclick: () => void }) => {
    captured.buttons = props
    const button = document.createElement('button')
    button.setAttribute('data-part', 'chat-new-message')
    button.addEventListener('click', () => props.onclick())
    anchor.before(button)
    return {}
} }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))

import ChatShell from './ChatShell.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
let jump: Mock<(options: { animate: boolean, focusNewest: boolean }) => Promise<void>>

const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const latestButton = () => target.querySelector<HTMLButtonElement>('[data-part="chat-new-message"]')!

async function mountShell(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!captured.list || !captured.buttons) throw new Error('waiting for the list and the buttons')
    })
}

function pressEnd(element: Element, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true, ...init })
    element.dispatchEvent(event)
    return event
}

beforeEach(() => {
    captured.list = null
    captured.buttons = null
    jump = vi.fn(async (_options: { animate: boolean, focusNewest: boolean }) => {})
    captured.jump = jump
    document.documentElement.classList.remove('nexus-low-power', 'rm')
    document.documentElement.removeAttribute('data-low-power')
})
afterEach(async () => {
    if (app) await unmount(app).catch(() => {})
    app = undefined
    document.body.replaceChildren()
    document.documentElement.classList.remove('nexus-low-power', 'rm')
})

describe('the jump-to-latest button', () => {
    test('A1-19: it shows away from the bottom for distance, an unread reply or a count, and never at the bottom', async () => {
        await mountShell()
        expect(captured.buttons!.visible).toBe(false)
        captured.list!.atBottom = false
        flushSync()
        expect(captured.buttons!.visible).toBe(false)
        captured.list!.farFromLatest = true
        flushSync()
        expect(captured.buttons!.visible).toBe(true)
        captured.list!.farFromLatest = false
        captured.list!.newCount = 3
        flushSync()
        expect(captured.buttons!.visible).toBe(true)
        expect(captured.buttons!.count).toBe(3)
        captured.list!.newCount = 0
        captured.list!.unread = true
        flushSync()
        expect(captured.buttons!.visible).toBe(true)
        captured.list!.atBottom = true
        flushSync()
        expect(captured.buttons!.visible).toBe(false)
    })
    test('A1-19: a click animates and focuses the newest message only when the button had focus', async () => {
        await mountShell()
        latestButton().click()
        expect(jump).toHaveBeenLastCalledWith({ animate: true, focusNewest: false })
        latestButton().focus()
        latestButton().click()
        expect(jump).toHaveBeenLastCalledWith({ animate: true, focusNewest: true })
    })
})

describe('End on the transcript', () => {
    test('A1-19: it asks the list to jump once, focusing the newest message, and is consumed', async () => {
        await mountShell()
        const event = pressEnd(transcript())
        expect(jump).toHaveBeenCalledOnce()
        expect(jump).toHaveBeenCalledWith({ animate: true, focusNewest: true })
        expect(event.defaultPrevented).toBe(true)
    })
    test('A1-19: the composer keeps its own End key', async () => {
        await mountShell()
        const event = pressEnd(target.querySelector('[data-test="composer-field"]')!)
        expect(jump).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
    })
    test('A1-19: low power and reduced motion turn the travel into an instant cut, for the key and the button', async () => {
        await mountShell()
        document.documentElement.classList.add('nexus-low-power')
        pressEnd(transcript())
        expect(jump).toHaveBeenLastCalledWith({ animate: false, focusNewest: true })
        document.documentElement.classList.remove('nexus-low-power')
        document.documentElement.classList.add('rm')
        latestButton().click()
        expect(jump).toHaveBeenLastCalledWith({ animate: false, focusNewest: false })
    })
})

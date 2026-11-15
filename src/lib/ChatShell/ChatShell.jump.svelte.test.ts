// @vitest-environment jsdom
/**
 * The shell wires the jump sheet, the return chip and the toasts around the list's `jumpTo` and `returnTo`.
 * REAL: `ChatShell.svelte`, `ReturnChip.svelte`, `returnChip.ts`, `jumpTarget.ts`, `shellJumpKeys.ts`. MOCKED: stores, the message list (a stub
 * whose `jumpTo` and `returnTo` answer what the test sets), the This-chat sheet and the jump sheet (stubs that record their props),
 * the floating buttons (a stub that renders a button), the composer, the other sheets, the toast post and the language table.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { JumpOptions, JumpOrigin, JumpResult } from '../../ts/chatShell/jumpTarget'

type JumpProps = { open: boolean, opener: HTMLElement | null, background: HTMLElement[], chat: { id: string, message: unknown[] } | null, onjump: (index: number) => void, onclose: () => void }
type ThisChatProps = { onjumpsheet?: (opener: HTMLElement | null) => void }

const captured = vi.hoisted(() => ({
    list: null as null | { atBottom: boolean },
    jump: null as null | JumpProps,
    thisChat: null as null | ThisChatProps,
    jumpTo: null as null | ((index: number, options?: JumpOptions) => Promise<JumpResult>),
    returnTo: null as null | ((origin: JumpOrigin) => Promise<JumpResult>),
    toast: null as null | ((init: { kind: string, text: string }) => number),
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
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: (init: { kind: string, text: string }) => captured.toast?.(init) ?? 0 }))
vi.mock('../../lang', () => ({
    language: {
        chatShellMessages: 'Messages', chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellThisChat: 'This chat',
        chatShellChatOpened: (name: string) => `Opened ${name}`, chatShellGoBack: 'Go back', chatShellJumpedBack: 'Moved. Go back returns.', chatShellJumpEditorOpen: 'Close the editor',
        hypaV3Modal: { connectedMessageNotFoundLabel: 'Message not found' },
    },
}))
vi.mock('./ShellComposer.svelte', () => ({ default: (anchor: Comment) => {
    const field = document.createElement('textarea')
    field.setAttribute('data-part', 'chat-composer-input')
    anchor.before(field)
    return {}
} }))
vi.mock('./ShellMessageList.svelte', () => ({ default: (_anchor: Comment, props: { atBottom: boolean }) => {
    captured.list = props
    return {
        onScroll: () => {},
        anchorNewestBottom: () => {},
        jumpToLatest: async () => {},
        jumpTo: (...args: [number, JumpOptions?]) => captured.jumpTo!(...args),
        returnTo: (origin: JumpOrigin) => captured.returnTo!(origin),
    }
} }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: (anchor: Comment) => {
    const button = document.createElement('button')
    button.setAttribute('data-part', 'chat-new-message')
    anchor.before(button)
    return {}
} }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: (_anchor: Comment, props: ThisChatProps) => {
    captured.thisChat = props
    return {}
} }))
vi.mock('./JumpSheet.svelte', () => ({ default: (_anchor: Comment, props: JumpProps) => {
    captured.jump = props
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
import { DBState } from '../../ts/stores.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
let jumpTo: Mock<(index: number, options?: JumpOptions) => Promise<JumpResult>>
let returnTo: Mock<(origin: JumpOrigin) => Promise<JumpResult>>
let toast: Mock<(init: { kind: string, text: string }) => number>
let openAtCall: boolean[]

const origin: JumpOrigin = { index: 5, offset: 40, atBottom: false }
const done = (to: number, from: JumpOrigin | null = origin): JumpResult => ({ status: 'done', from, to })
const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const chipButton = () => target.querySelector<HTMLButtonElement>('[data-part="chat-return-chip"]')
const announcer = () => target.querySelector('[data-part="chat-announcer"]')!.textContent
const character = () => DBState.db.characters[0] as unknown as { chatPage: number, chats: { id: string, message: unknown[] }[] }

async function mountShell(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!captured.list || !captured.jump || !captured.thisChat?.onjumpsheet) throw new Error('waiting for the list and the sheets')
    }, { timeout: 15000 })
}

async function runSheetJump(index: number, result: JumpResult): Promise<void> {
    jumpTo.mockImplementationOnce(async () => {
        openAtCall.push(captured.jump!.open)
        return result
    })
    captured.thisChat!.onjumpsheet!(null)
    flushSync()
    captured.jump!.onjump(index)
    // Only microtasks are awaited, so the test can run under fake timers.
    for (let round = 0; round < 8; round++) await tick()
    flushSync()
}

beforeEach(() => {
    captured.list = null
    captured.jump = null
    captured.thisChat = null
    openAtCall = []
    jumpTo = vi.fn<(index: number, options?: JumpOptions) => Promise<JumpResult>>(async () => {
        openAtCall.push(captured.jump!.open)
        return { status: 'cancelled', from: null, to: 0 }
    })
    returnTo = vi.fn<(origin: JumpOrigin) => Promise<JumpResult>>(async (): Promise<JumpResult> => ({ status: 'done', from: null, to: 5 }))
    toast = vi.fn<(init: { kind: string, text: string }) => number>(() => 1)
    captured.jumpTo = (...args) => jumpTo(...args)
    captured.returnTo = (value) => returnTo(value)
    captured.toast = toast
    character().chatPage = 0
    // Both chats are long enough that only the chat identity, never the length rule, can hide the chip.
    character().chats[0].message = new Array(200).fill(null)
    character().chats[1].message = new Array(200).fill(null)
})
afterEach(async () => {
    vi.useRealTimers()
    if (app) await unmount(app).catch(() => {})
    app = undefined
    document.body.replaceChildren()
})

describe('opening and running a jump', () => {
    test('A2-19: the This-chat entry opens the jump sheet for the shown chat, on the list when no opener is inside the shell', async () => {
        await mountShell()
        expect(captured.jump!.open).toBe(false)
        captured.thisChat!.onjumpsheet!(null)
        flushSync()
        expect(captured.jump!.open).toBe(true)
        expect(captured.jump!.chat).toBe(character().chats[0])
        expect(captured.jump!.opener).toBe(transcript())
    })
    test('A2-19: the jump runs after the sheet has closed, and the sheet stays closed', async () => {
        await mountShell()
        await runSheetJump(7, { status: 'cancelled', from: null, to: 7 })
        expect(jumpTo).toHaveBeenCalledExactlyOnceWith(7)
        expect(openAtCall).toEqual([false])
        expect(captured.jump!.open).toBe(false)
    })
    test('A2-19: the sheet is inert background: the chip and button host is part of what the sheet covers', async () => {
        await mountShell()
        captured.thisChat!.onjumpsheet!(null)
        flushSync()
        const host = target.querySelector('.jump-host')!
        expect(captured.jump!.background).toContain(host)
    })
    test('A2-19: the transcript, the chip, the button and the composer keep that tab order', async () => {
        await mountShell()
        await runSheetJump(100, done(100))
        const order = [transcript(), chipButton()!, target.querySelector('[data-part="chat-new-message"]')!, target.querySelector('[data-part="chat-composer-input"]')!]
        for (let i = 0; i < order.length - 1; i++) expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING, `position ${i}`).toBeTruthy()
    })
})

describe('the return chip', () => {
    test('A2-19: a long jump shows the chip and announces it; a short one does not', async () => {
        await mountShell()
        await runSheetJump(10, done(10))
        expect(chipButton()).toBeNull()
        expect(announcer()).toBe('')
        await runSheetJump(100, done(100))
        expect(chipButton()).not.toBeNull()
        expect(announcer()).toBe('Moved. Go back returns.')
    })
    test('A2-19: a jump that did not run (deferred, blocked) leaves no chip', async () => {
        await mountShell()
        await runSheetJump(100, { status: 'deferred', from: null, to: 100 })
        await runSheetJump(100, { status: 'blocked', from: origin, to: 100 })
        expect(chipButton()).toBeNull()
    })
    test('A2-19: a short jump while the chip shows leaves the chip, its origin and its timer alone', async () => {
        await mountShell()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        await runSheetJump(100, done(100))
        const chip = chipButton()!
        vi.advanceTimersByTime(10_000)
        await runSheetJump(60, done(60, { index: 55, offset: 0, atBottom: false }))
        expect(chipButton()).toBe(chip)
        vi.advanceTimersByTime(6_000)
        flushSync()
        expect(chipButton()).toBeNull()
    })
    test('A2-19: the chip stays while it is hovered and leaves 15 s after the pointer does', async () => {
        await mountShell()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        await runSheetJump(100, done(100))
        chipButton()!.dispatchEvent(new Event('pointerenter'))
        vi.advanceTimersByTime(20_000)
        flushSync()
        expect(chipButton()).not.toBeNull()
        chipButton()!.dispatchEvent(new Event('pointerleave'))
        vi.advanceTimersByTime(14_000)
        flushSync()
        expect(chipButton()).not.toBeNull()
        vi.advanceTimersByTime(2_000)
        flushSync()
        expect(chipButton()).toBeNull()
    })
    test('A2-19: a tap on the chip returns to the origin once and the chip leaves', async () => {
        await mountShell()
        await runSheetJump(100, done(100))
        chipButton()!.click()
        await tick()
        flushSync()
        expect(returnTo).toHaveBeenCalledExactlyOnceWith(origin)
        expect(chipButton()).toBeNull()
    })
    test('A2-19: the reader scrolling 80 px or more removes the chip', async () => {
        await mountShell()
        await runSheetJump(100, done(100))
        const main = transcript()
        Object.defineProperty(main, 'scrollHeight', { value: 5000, configurable: true })
        Object.defineProperty(main, 'clientHeight', { value: 600, configurable: true })
        main.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true }))
        flushSync()
        expect(chipButton()).not.toBeNull()
        main.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true }))
        flushSync()
        expect(chipButton()).toBeNull()
    })
    test('A2-19: a chat switch removes the chip and closes the sheet', async () => {
        await mountShell()
        await runSheetJump(100, done(100))
        captured.thisChat!.onjumpsheet!(null)
        flushSync()
        expect(captured.jump!.open).toBe(true)
        character().chatPage = 1
        flushSync()
        expect(chipButton()).toBeNull()
        expect(captured.jump!.open).toBe(false)
    })
    test('A2-24: the chip leaves when the chat shrinks to or below the origin index, and stays above it', async () => {
        await mountShell()
        character().chats[0].message = new Array(10).fill(null)
        flushSync()
        await runSheetJump(100, done(100))
        expect(chipButton()).not.toBeNull()
        character().chats[0].message = new Array(6).fill(null)
        flushSync()
        expect(chipButton()).not.toBeNull()
        character().chats[0].message = new Array(5).fill(null)
        flushSync()
        expect(chipButton()).toBeNull()
    })
})

describe('refusals', () => {
    test('A2-19: an editor-blocked jump posts a warning toast, an out-of-range one the not-found toast, and deferred or cancelled none', async () => {
        await mountShell()
        await runSheetJump(3, { status: 'blocked', from: null, to: 3 })
        expect(toast).toHaveBeenLastCalledWith({ kind: 'warning', text: 'Close the editor' })
        await runSheetJump(3, { status: 'outOfRange', from: null, to: 3 })
        expect(toast).toHaveBeenLastCalledWith({ kind: 'warning', text: 'Message not found' })
        expect(toast).toHaveBeenCalledTimes(2)
        await runSheetJump(3, { status: 'deferred', from: null, to: 3 })
        await runSheetJump(3, { status: 'cancelled', from: null, to: 3 })
        expect(toast).toHaveBeenCalledTimes(2)
    })
})

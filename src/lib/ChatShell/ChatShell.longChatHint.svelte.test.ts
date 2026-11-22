// @vitest-environment jsdom
/**
 * The long-chat hint in the shell: a chat over 2,000 messages shows one line in the jump host, once per chat, announced once;
 * the reader's first move, the search bar, any sheet, 8 s and a chat switch take it away, and it stays up after effects settle
 * (the flag write must not re-run the effect that shows it).
 *
 * REAL: ChatShell.svelte, LongChatHint.svelte, longChatHint.ts, chatDraftStore.ts, readerIntent.ts. MOCKED: the stores and database
 * (a plain rune object), the header, the composer, the message list and the sheets.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type TestChat = { id?: string, name: string, message: unknown[] }

const captured = vi.hoisted(() => ({
    thisChat: null as null | ((element: HTMLElement) => void),
    sheet: null as null | { onjumpsheet?: (active: Element | null) => void, onsearch?: (active: Element | null) => void },
}))

vi.mock('../../ts/stores.svelte', () => {
    const db = $state<{ db: { characters: Record<string, unknown>[], chatDrafts?: unknown } }>({ db: { characters: [] } })
    const selected = $state({ selId: 0 })
    return { DBState: db, selIdState: selected, sideBarStore: writable(false) }
})
vi.mock('../../ts/chatShell/switchTarget.svelte', () => ({ switchTarget: { target: null, phase: 'idle', reason: null }, retrySwitch: vi.fn(), backToPrevious: vi.fn(), abandonPendingSwitch: vi.fn() }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => undefined, backCloseHandler: () => () => false }))
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('../../ts/process/chatTreeView', () => ({ treeView: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../lang', () => ({ language: {
    chatShellMessages: 'Messages',
    chatShellChatOpened: (chat: string) => `Opened ${chat}`,
    chatShellReplyStarted: 'Reply started',
    chatShellReplyFinished: 'Reply finished',
    longChatLine: (count: string) => `Long chat · ${count} messages`,
} }))
vi.mock('./ShellHeader.svelte', () => ({ default: (_anchor: Comment, props: { onthischat: (element: HTMLElement) => void }) => {
    captured.thisChat = props.onthischat
    return {}
} }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({ onScroll: () => {}, anchorNewestBottom: () => {} }) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: (_anchor: Comment, props: { onjumpsheet?: (active: Element | null) => void, onsearch?: (active: Element | null) => void }) => {
    captured.sheet = props
    return {}
} }))
vi.mock('./JumpSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./FindBar.svelte', () => ({ default: () => ({ focusField: () => {} }) }))
vi.mock('./FindFiltersSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./FindResultsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ChatDeleteConfirm.svelte', () => ({ default: () => ({}) }))
vi.mock('./TogglesPanel.svelte', () => ({ default: () => ({}), toggleSummary: () => ({ n: 0, on: 0 }) }))
vi.mock('./SendFailureCard.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/chatShell/sendFailure.svelte', () => ({ failureOf: () => null, retrySendFailure: vi.fn() }))
vi.mock('../Setting/settingsRoute', () => ({ openSettingsForFix: vi.fn() }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))

import { DBState, selIdState } from '../../ts/stores.svelte'
import ChatShell from './ChatShell.svelte'

// The mock above is a plain rune object; the real type is far wider than these tests drive.
const state = DBState as unknown as { db: { characters: Record<string, unknown>[], chatDrafts?: unknown } }
const selection = selIdState

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined
let serial = 0
let scrollTop = 500

const transcript = () => target.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
const hintElement = () => target.querySelector<HTMLElement>('[data-part="chat-long-hint"]')
const region = () => target.querySelector('[data-part="chat-announcer"]')!

function rows(count: number): unknown[] {
    return Array.from({ length: count }, (_, index) => ({ role: index % 2 ? 'char' : 'user', data: `m${index}`, time: index }))
}

function seed(counts: number[], options: { idless?: boolean, page?: number } = {}): TestChat[] {
    serial += 1
    const chats = counts.map((count, index) => ({ ...(options.idless ? {} : { id: `chat-${serial}-${index}` }), name: `Chat ${index}`, message: rows(count) }))
    state.db = { characters: [{ chaId: `cha-${serial}`, type: 'character', name: 'Seraphina', chatPage: options.page ?? 0, chats }] }
    return chats
}

async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

async function mountShell(): Promise<void> {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        if (!captured.thisChat || !captured.sheet?.onjumpsheet || !captured.sheet.onsearch) throw new Error('waiting for the shell parts')
    })
    await settle()
    Object.defineProperty(transcript(), 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(transcript(), 'clientHeight', { value: 800, configurable: true })
}

async function unmountShell(): Promise<void> {
    if (app) await unmount(app).catch(() => {})
    app = undefined
    document.body.replaceChildren()
}

function wheel(deltaY: number): void {
    transcript().dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }))
    flushSync()
}

beforeEach(() => {
    captured.thisChat = null
    captured.sheet = null
    selection.selId = 0
    scrollTop = 500
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1 })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', { get: () => scrollTop, set: (value: number) => { scrollTop = value }, configurable: true })
})

afterEach(async () => {
    vi.useRealTimers()
    await unmountShell()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
    vi.unstubAllGlobals()
})

describe('the long-chat hint in the shell', () => {
    test('T4.4 a 2,001-message chat shows the grouped line in the jump host and announces it once', async () => {
        seed([2001])
        await mountShell()
        const hint = hintElement()
        expect(hint?.textContent).toBe('Long chat · 2,001 messages')
        expect(hint?.closest('.jump-host')).not.toBeNull()
        expect(region().textContent).toBe('Long chat · 2,001 messages')
    })

    test('T4.2 a 2,000-message chat shows nothing', async () => {
        seed([2000])
        await mountShell()
        expect(hintElement()).toBeNull()
        expect(region().textContent).toBe('')
    })

    test('T4.4 a reader-intent scroll takes the hint away', async () => {
        seed([2001])
        await mountShell()
        expect(hintElement()).not.toBeNull()
        wheel(-40)
        expect(hintElement()).toBeNull()
    })

    test('T4.4 the This-chat sheet takes the hint away', async () => {
        seed([2001])
        await mountShell()
        captured.thisChat!(document.createElement('button'))
        flushSync()
        expect(hintElement()).toBeNull()
    })

    test('T4.4 the jump sheet takes the hint away', async () => {
        seed([2001])
        await mountShell()
        captured.sheet!.onjumpsheet!(null)
        flushSync()
        expect(hintElement()).toBeNull()
    })

    test('T4.4 the search bar takes the hint away', async () => {
        seed([2001])
        await mountShell()
        captured.sheet!.onsearch!(null)
        flushSync()
        expect(hintElement()).toBeNull()
    })

    test('T4.3 the hint leaves when its 8-second timer fires', async () => {
        const real = window.setTimeout.bind(window)
        const eight: (() => void)[] = []
        vi.spyOn(window, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) => {
            if (ms === 8000) eight.push(callback)
            return real(callback, ms)
        }) as typeof window.setTimeout)
        seed([2001])
        await mountShell()
        expect(hintElement()).not.toBeNull()
        expect(eight).toHaveLength(1)
        eight[0]()
        flushSync()
        expect(hintElement()).toBeNull()
    })

    test('T4.8 the hint is still visible after effects settle, and after an unrelated draft write rewrites chatDrafts', async () => {
        seed([2001])
        await mountShell()
        flushSync()
        await tick()
        await tick()
        expect(hintElement()).not.toBeNull()
        expect(Array.isArray(state.db.chatDrafts)).toBe(true)
        state.db.chatDrafts = [...(state.db.chatDrafts as unknown[]), { cha: 'other', chat: 'other', drafts: [] }]
        await settle()
        expect(hintElement()).not.toBeNull()
    })

    test('T4.1 / T4.5 the flag is stored at show: a remount of the same chat shows nothing', async () => {
        seed([2001])
        await mountShell()
        expect(hintElement()).not.toBeNull()
        await unmountShell()
        await mountShell()
        expect(hintElement()).toBeNull()
        expect(region().textContent).toBe('')
    })

    test('a chat without an id is shown once per session', async () => {
        seed([2001], { idless: true })
        await mountShell()
        expect(hintElement()).not.toBeNull()
        expect(state.db.chatDrafts).toBeUndefined()
        await unmountShell()
        await mountShell()
        expect(hintElement()).toBeNull()
    })

    test('T4.9 a switch into a long chat announces the chat-opened text and the hint as one string', async () => {
        seed([10, 2001])
        await mountShell()
        expect(hintElement()).toBeNull()
        ;(state.db.characters[0] as { chatPage: number }).chatPage = 1
        await settle()
        expect(hintElement()).not.toBeNull()
        expect(region().textContent).toBe('Opened Chat 1 Long chat · 2,001 messages')
    })

    test('a switch to another chat takes the hint away', async () => {
        seed([2001, 10])
        await mountShell()
        expect(hintElement()).not.toBeNull()
        ;(state.db.characters[0] as { chatPage: number }).chatPage = 1
        await settle()
        expect(hintElement()).toBeNull()
    })

    test('T4.7 the hint takes no pointer events, holds no button and sits outside the transcript', async () => {
        seed([2001])
        await mountShell()
        const hint = hintElement()!
        expect(hint.getAttribute('aria-hidden')).toBe('true')
        expect(hint.querySelector('button, a, [tabindex]')).toBeNull()
        expect(transcript().contains(hint)).toBe(false)
    })
})

// @vitest-environment jsdom
/**
 * The new shell announces the shown chat's reply start and end through its polite region: "Reply started" on the rising edge
 * of isStreaming, "Reply finished" on every falling edge (success, Stop and error alike), no chat name, and nothing extra on
 * mount or on a chat switch.
 *
 * REAL: ChatShell.svelte. MOCKED: the stores and database (a plain rune object the test drives like the send pipeline), the
 * header, the composer, the message list and every sheet.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type TestChat = { id: string, name: string, message: unknown[], isStreaming?: boolean }

const state = $state<{ db: { characters: Record<string, unknown>[] } }>({ db: { characters: [] } })
const selection = $state({ selId: 0 })

vi.mock('../../ts/stores.svelte', () => ({ DBState: state, selIdState: selection, sideBarStore: writable(false) }))
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
} }))
vi.mock('./ShellHeader.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ChatDeleteConfirm.svelte', () => ({ default: () => ({}) }))
vi.mock('./TogglesPanel.svelte', () => ({ default: () => ({}), toggleSummary: () => ({ n: 0, on: 0 }) }))
vi.mock('./SendFailureCard.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/chatShell/sendFailure.svelte', () => ({ failureOf: () => null, retrySendFailure: vi.fn() }))
vi.mock('../Setting/settingsRoute', () => ({ openSettingsForFix: vi.fn() }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))

function chats(): TestChat[] {
    return state.db.characters[0].chats as TestChat[]
}

function seed(page: number, firstStreaming = false): void {
    state.db = { characters: [{ chaId: 'a', type: 'character', name: 'Seraphina', chatPage: page, chats: [
        { id: 'chat-1', name: 'First', message: [], isStreaming: firstStreaming },
        { id: 'chat-2', name: 'Second', message: [] },
    ] }] }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

async function mountShell() {
    const { default: ChatShell } = await import('./ChatShell.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ChatShell, { target })
    await settle()
    const region = target.querySelector('[data-part="chat-announcer"]')!
    return { app, region }
}

beforeEach(() => {
    seed(0)
    selection.selId = 0
})

afterEach(() => {
    document.body.innerHTML = ''
})

describe('the shell announces the shown chat reply edges', () => {
    test('reproducer: the rising edge announces "Reply started" and the falling edge "Reply finished"', async () => {
        const { app, region } = await mountShell()
        chats()[0].isStreaming = true
        await settle()
        expect(region.textContent).toBe('Reply started')
        chats()[0].isStreaming = false
        await settle()
        expect(region.textContent).toBe('Reply finished')
        await unmount(app)
    })

    test('reproducer: a Stop or an error ends the stream through the same falling edge and announces the same text', async () => {
        const { app, region } = await mountShell()
        chats()[0].isStreaming = true
        await settle()
        chats()[0].isStreaming = undefined
        await settle()
        expect(region.textContent).toBe('Reply finished')
        await unmount(app)
    })

    test('reproducer: a repeat reply announces again after the region was cleared', async () => {
        const { app, region } = await mountShell()
        const seen: string[] = []
        const watcher = new MutationObserver(() => seen.push(region.textContent ?? ''))
        watcher.observe(region, { childList: true, characterData: true, subtree: true })
        for (let round = 0; round < 2; round++) {
            chats()[0].isStreaming = true
            await settle()
            chats()[0].isStreaming = false
            await settle()
        }
        watcher.disconnect()
        expect(seen.filter((text) => text === 'Reply started')).toHaveLength(2)
        expect(seen.filter((text) => text === 'Reply finished')).toHaveLength(2)
        await unmount(app)
    })

    test('mounting on a streaming chat announces nothing', async () => {
        seed(0, true)
        const { app, region } = await mountShell()
        expect(region.textContent).toBe('')
        await unmount(app)
    })

    test('a chat switch announces only the chat opened, never a reply edge', async () => {
        seed(0, true)
        const { app, region } = await mountShell()
        state.db.characters[0].chatPage = 1
        await settle()
        expect(region.textContent).toBe('Opened Second')
        state.db.characters[0].chatPage = 0
        await settle()
        expect(region.textContent).toBe('Opened First')
        await unmount(app)
    })

    test('a chat that is not shown streaming announces nothing', async () => {
        const { app, region } = await mountShell()
        chats()[1].isStreaming = true
        await settle()
        chats()[1].isStreaming = false
        await settle()
        expect(region.textContent).toBe('')
        await unmount(app)
    })

    test('a shown chat that keeps streaming does not announce again', async () => {
        const { app, region } = await mountShell()
        chats()[0].isStreaming = true
        await settle()
        region.textContent = ''
        chats()[0].isStreaming = true
        await settle()
        expect(region.textContent).toBe('')
        await unmount(app)
    })
})

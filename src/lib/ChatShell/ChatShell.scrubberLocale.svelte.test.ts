// @vitest-environment jsdom
/**
 * The date the scrubber bubble shows follows the app language, live. REAL: `ChatShell.svelte`, the language module (`changeLanguage`).
 * MOCKED: stores, the message list, the sheets, the composer, the scrubber (a stub that captures its props) and the language table's strings.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

const captured = vi.hoisted(() => ({ scrubber: null as null | { formatter: Intl.DateTimeFormat } }))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const chats = [{ id: 'chat-a', message: [] as unknown[] }]
    const state = $state({ db: { characters: [{ chaId: 'c', type: 'character', name: 'Seraphina', chatPage: 0, chats }] } })
    const selection = $state({ selId: 0 })
    return { DBState: state, selIdState: selection, MobileGUI: store(true), DynamicGUI: store(false), sideBarClosing: store(false), sideBarStore: store(false), alertStore: store({ type: 'none', msg: '' }) }
})
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: () => 0 }))
vi.mock('../../lang', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../lang')>()
    const stub = {
        chatShellMessages: 'Messages', chatShellBack: 'Back', chatShellChoosePersona: 'Choose persona', chatShellThisChat: 'This chat',
        chatShellChatOpened: (name: string) => `Opened ${name}`, chatShellGoBack: 'Go back', chatShellJumpedBack: 'Moved. Go back returns.', chatShellJumpEditorOpen: 'Close the editor',
        chatShellScrubberBubble: (position: string, total: string) => `${position} / ${total}`,
        chatShellScrubberBubbleDated: (position: string, total: string, date: string) => `${position} / ${total} - ${date}`,
        hypaV3Modal: { connectedMessageNotFoundLabel: 'Message not found' },
    }
    return { ...actual, language: stub }
})
vi.mock('./Scrubber.svelte', () => ({ default: (_anchor: Comment, props: { formatter: Intl.DateTimeFormat }) => {
    captured.scrubber = props
    return {}
} }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({
    onScroll: () => {}, anchorNewestBottom: () => {}, jumpToLatest: async () => {}, jumpTo: async () => ({ status: 'cancelled', from: null, to: 0 }),
    returnTo: async () => ({ status: 'done', from: null, to: 0 }), readOrigin: () => null,
}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./JumpSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))

import { changeLanguage } from '../../lang'
import ChatShell from './ChatShell.svelte'

const hostLocale = (): string => new Intl.DateTimeFormat().resolvedOptions().locale
const localeOf = (tag: string): string => new Intl.DateTimeFormat(tag).resolvedOptions().locale

/** Two app languages whose resolved locale differs from the host's and from each other. */
function pickLanguages(): [string, string] {
    const fit = ['en', 'ko', 'de'].filter((tag) => localeOf(tag) !== hostLocale())
    return [fit[0], fit[1]]
}

let target: HTMLElement | undefined
let app: ReturnType<typeof mount> | undefined
afterEach(async () => {
    if (app) await unmount(app).catch(() => {})
    app = undefined
    target?.remove()
    changeLanguage('en')
    document.documentElement.removeAttribute('lang')
    captured.scrubber = null
})

describe('the scrubber date formatter', () => {
    test('follows the app language when it is set and when it changes', async () => {
        const [first, second] = pickLanguages()
        expect(localeOf(first)).not.toBe(hostLocale())
        expect(localeOf(second)).not.toBe(localeOf(first))
        changeLanguage(first)
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ChatShell, { target })
        await vi.waitFor(() => {
            flushSync()
            if (!captured.scrubber) throw new Error('waiting for the scrubber')
        }, { timeout: 15000 })
        expect(captured.scrubber!.formatter.resolvedOptions().locale).toBe(localeOf(first))
        changeLanguage(second)
        flushSync()
        expect(captured.scrubber!.formatter.resolvedOptions().locale).toBe(localeOf(second))
    })
})

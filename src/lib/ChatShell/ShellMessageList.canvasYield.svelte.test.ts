// @vitest-environment jsdom
// The message list's own fill yields to the user's background under a theme pack: while `canvasYield` holds, the list root carries an
// inline important background reset, written through style directives so properties the step hold writes on the same element survive.
// REAL: ShellMessageList.svelte, the built-in Office Sheet, the cascade model with importance tiers. MOCKED: everything the list reads.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character } from '../../ts/storage/database.svelte'
import { BUILTIN_PACKS } from '../../ts/themePack/builtins'
import { CascadeModel, compileRules } from '../../styles/tests/cascadeModel'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 3, chatLoadAdditionalPages: 3 } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0), ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling: vi.fn(), regenerateNewest: vi.fn() }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true }))
vi.mock('../../ts/android/hostBridge', () => ({ gestureInsetLeft: () => 0 }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }))
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn(), alertConfirm: vi.fn(), alertNormal: vi.fn(), alertSelect: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(),
    requestRemove: vi.fn(), deleteNow: vi.fn(), copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(),
    branchMessage: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(),
}))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, discardConfirmOpen: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { rebuildEpoch: 0, closeEpoch: 0, hidden: false, heldGui: 0, heldChat: {} }, isChatSurfaceInstalled: () => false, onSurfaceHiding: () => () => {} }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: {
    loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted',
    chatShellMoreActions: 'More actions', chatShellNewReply: 'New reply', bookmark: 'Bookmark',
    chatShellStillWriting: 'Still writing the reply', chatShellNoSavedReplies: 'No more saved replies',
    chatShellReleaseNewReply: 'Let go to generate a new reply', chatShellGenerateReply: 'Generate a reply',
    chatShellPreviousReply: 'Previous', chatShellNextReply: 'Next', chatShellFirstReply: 'First', chatShellLastReply: 'Last',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
    chatShellEndControl: (count: number) => `Bring back ${count}`,
} }))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'

const OFFICE_CSS = BUILTIN_PACKS.find((p) => p.id === 'builtin:office-sheet')!.chatCss
const IMPORTANT_LIST = OFFICE_CSS + '\n[data-part="chat-message-list"] { background-color: #ffffff !important; }'

class FakeObserver {
    observe(): void {}
    disconnect(): void {}
}

const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: [],
    chats: [{ id: 'room', message: [], alt: [] }] }) as unknown as Character
let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement

const squash = (text: string): string => text.replace(/\s+/g, '')
const rowsElement = (): HTMLElement => host.querySelector<HTMLElement>('[data-part="chat-message-list"]')!

async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

async function show(props: { canvasYield?: boolean }): Promise<void> {
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host, ...props } })
    await settle()
}

function modelOf(css: string): CascadeModel {
    return new CascadeModel(compileRules([{ name: 'pack', css }]), { important: true })
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {}, configurable: true, writable: true })
    DBState.db.chatLoadInitialPages = 3
    DBState.db.chatLoadAdditionalPages = 3
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('the message list yield', () => {
    test('L1 (reproducer): with canvasYield the list fill is reset important and Office Sheet keeps its page edge and shadow', async () => {
        await show({ canvasYield: true })
        expect(squash(rowsElement().getAttribute('style') ?? '')).toContain('background-color:transparent!important;background-image:none!important')
        const painted = modelOf(OFFICE_CSS).painted(rowsElement())
        expect(painted['background-color']).toBeUndefined()
        expect(painted['border-top-color']).toBeDefined()
        expect(painted['box-shadow']).toBeDefined()
    })

    test('L1b (reproducer): a pack list rule with background-color !important also yields', async () => {
        await show({ canvasYield: true })
        expect(modelOf(IMPORTANT_LIST).painted(rowsElement())['background-color']).toBeUndefined()
    })

    test('L2 (guard, passes before and after): without the prop the list carries no style attribute', async () => {
        await show({})
        expect(rowsElement().hasAttribute('style')).toBe(false)
    })

    test('L3: flipping the yield never erases a property written on the list directly', async () => {
        const props = $state({ canvasYield: true })
        DBState.db.characters = [character]
        target = document.createElement('div')
        host = document.createElement('main')
        target.appendChild(host)
        document.body.appendChild(target)
        app = mount(ShellMessageList, { target: host, props: { character, host, get canvasYield() { return props.canvasYield } } })
        await settle()
        rowsElement().style.setProperty('padding-bottom', '10px')
        props.canvasYield = false
        await settle()
        expect(rowsElement().getAttribute('style') ?? '').not.toContain('background')
        expect(rowsElement().style.paddingBottom).toBe('10px')
        props.canvasYield = true
        await settle()
        expect(squash(rowsElement().getAttribute('style') ?? '')).toContain('background-color:transparent!important;background-image:none!important')
        expect(rowsElement().style.paddingBottom).toBe('10px')
    })
})

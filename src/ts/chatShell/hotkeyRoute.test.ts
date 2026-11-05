// @vitest-environment jsdom
// The real initHotkey() listener and the real newest message row together: one Ctrl+Alt+R press must take exactly one route.
import { writable } from 'svelte/store'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({ index: 1, count: 2 }))

vi.mock(import('../storage/database.svelte'), () => ({
    getDatabase: () => ({}),
    changeToPreset: vi.fn(),
    getCurrentCharacter: () => null,
}) as unknown as typeof import('../storage/database.svelte'))
vi.mock(import('../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
    DBState: { db: { characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: [{ role: 'user', data: 'Hi', chatId: 'u' }, { role: 'char', data: 'Reply', chatId: 'm' }] }] }], translator: '', swipe: true } },
    selIdState: { selId: 0 },
    HideIconStore: writable(false),
    loadoutModalStore: { open: false },
    MobileGUIStack: writable(0),
    MobileSideBar: writable(0),
    openPersonaList: writable(false),
    openPresetList: writable(false),
    OpenRealmStore: writable(false),
    PlaygroundStore: writable(0),
    QuickSettings: { open: false, index: 0 },
    SafeModeStore: writable(false),
    selectedCharID: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('../stores.svelte'))
vi.mock(import('../alert'), () => ({
    alertMd: vi.fn(), alertSelect: vi.fn(), alertToast: vi.fn(), alertWait: vi.fn(), doingAlert: () => false,
    alertRequestLogs: vi.fn(), alertError: vi.fn(), alertRequestData: vi.fn(), alertConfirm: vi.fn(), alertNormal: vi.fn(),
}) as unknown as typeof import('../alert'))
vi.mock(import('../gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
    ColorSchemeTypeStore: writable(false),
}) as unknown as typeof import('../gui/colorscheme'))
vi.mock(import('../process/index.svelte'), () => ({ doingChat: writable(false), sendChat: vi.fn() }) as unknown as typeof import('../process/index.svelte'))
vi.mock(import('../characters'), () => ({ changeChar: vi.fn(), getCharImage: async () => null }) as unknown as typeof import('../characters'))
vi.mock(import('../process/composerActions.svelte'), () => ({ stepSibling, regenerateNewest }) as unknown as typeof import('../process/composerActions.svelte'))
vi.mock(import('./haptics'), () => ({ tickHaptic: vi.fn(), readHaptics: () => true }) as unknown as typeof import('./haptics'))
vi.mock(import('../backHandlers'), () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }) as unknown as typeof import('../backHandlers'))
vi.mock(import('../globalApi.svelte'), () => ({ aiLawApplies: () => false }) as unknown as typeof import('../globalApi.svelte'))
vi.mock(import('../parser/parser.svelte'), () => ({ ParseMarkdown: async (text: string) => text }) as unknown as typeof import('../parser/parser.svelte'))
vi.mock(import('../parser/chatML'), () => ({}) as unknown as typeof import('../parser/chatML'))
vi.mock(import('../process/moduleRefList'), () => ({ hasModuleStubs: () => false }) as unknown as typeof import('../process/moduleRefList'))
vi.mock(import('../process/moduleEnsure'), () => ({ ensureCurrentModulesOrAlert: async () => true }) as unknown as typeof import('../process/moduleEnsure'))
vi.mock(import('../translator/translator'), () => ({ getLLMCache: async () => null }) as unknown as typeof import('../translator/translator'))
vi.mock(import('../process/ttsModes'), () => ({ isTTSVoiceMode: () => false }) as unknown as typeof import('../process/ttsModes'))
vi.mock(import('../process/tts'), () => ({ stopTTS: vi.fn() }) as unknown as typeof import('../process/tts'))
vi.mock(import('../process/scripts'), () => ({ risuChatParser: (text: string) => text }) as unknown as typeof import('../process/scripts'))
vi.mock(import('../process/displayParseOptions'), () => ({ buildDisplayParseOptions: () => ({}) }) as unknown as typeof import('../process/displayParseOptions'))
vi.mock(import('../caughtErrors'), () => ({ recordCaughtError: vi.fn() }) as unknown as typeof import('../caughtErrors'))
vi.mock(import('../process/messageActions.svelte'), () => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(), requestRemove: vi.fn(), deleteNow: vi.fn(),
    copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(), branchMessage: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(),
}) as unknown as typeof import('../process/messageActions.svelte'))
vi.mock(import('../process/messageEditorController.svelte'), () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, discardConfirmOpen: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }) as unknown as typeof import('../process/messageEditorController.svelte'))
vi.mock(import('../model/modellist'), () => ({ getModelInfo: () => ({ shortName: 'model' }) }) as unknown as typeof import('../model/modellist'))
vi.mock('../../lib/ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatScreens/chatSurface.svelte', () => ({ chatSurface: { rebuildEpoch: 0, closeEpoch: 0 }, isChatSurfaceInstalled: () => false }))

import { initHotkey } from '../hotkey'
import ShellMessage from '../../lib/ChatShell/ShellMessage.svelte'
import { DBState } from '../stores.svelte'

let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined

beforeAll(() => { initHotkey() })

function show(index: number, count: number): HTMLElement {
    state.index = index
    state.count = count
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellMessage, { target, props: { idx: 1, chatId: 'm', expectedId: 'm', name: 'Ari', message: DBState.db.characters[0].chats[0].message[1], getTreeView: () => ({ at: () => ({ index: state.index, count: state.count }), continuation: 0 }) } })
    flushSync()
    return target.querySelector<HTMLElement>('article')!
}
function press(node: Element): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'r', ctrlKey: true, altKey: true })
    node.dispatchEvent(event)
    flushSync()
    return event
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    stepSibling.mockClear(); regenerateNewest.mockClear()
})

describe('Ctrl+Alt+R takes one route through the real hotkey listener', () => {
    test('with no message focused and an alternative ahead it steps forward once and never generates', () => {
        show(1, 2)
        press(document.body)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 1, 'm', 'forward', { generate: false })
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('with no message focused at the last alternative it generates once, although the next arrow is disabled', () => {
        show(2, 2)
        press(document.body)
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
        expect(stepSibling).not.toHaveBeenCalled()
    })
    test('with the newest message focused an alternative ahead steps once, not twice', () => {
        const article = show(1, 2)
        article.focus()
        press(article)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('with the newest message focused at the last alternative it generates once, not twice', () => {
        const article = show(2, 2)
        article.focus()
        press(article)
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
        expect(stepSibling).not.toHaveBeenCalled()
    })
})

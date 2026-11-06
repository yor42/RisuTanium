// @vitest-environment jsdom
/**
 * Reproducer (R9-P F6): consecutive taps on the newest reply's New reply button, three seconds apart, each send one request.
 * Mounts the real shell rows and the real composerActions.svelte.ts over the real send path with a mock provider.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database, Message } from 'src/ts/storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does.
import 'src/ts/polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const preLoadChatMock = vi.hoisted(() => vi.fn(async (): Promise<string> => 'ok'))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (value: string) => value } }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable: store } = await import('svelte/store')
    const state = $state({ db: {} as unknown as Database })
    const selection = $state({ selId: 0 })
    const selectedCharID = store(0)
    selectedCharID.subscribe((value) => { selection.selId = value })
    const scrollToMessage = $state({ value: -1 })
    const additionalChatMenu = $state([] as unknown[])
    const additionalFloatingActionButtons = $state([] as unknown[])
    const chatPanelStore = $state([] as unknown[])
    const easyPanelStore = $state({ open: false })
    const popUpEditorStore = $state({ open: false, value: '', mode: 'default', language: '' })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID,
        CharEmotion: store({}),
        ReloadChatPointer: store({} as Record<number, number>),
        ReloadGUIPointer: store(0),
        CurrentTriggerIdStore: store(null),
        PlaygroundStore: store(0),
        MobileGUI: store(false),
        MobileSideBar: store(0),
        HideIconStore: store(false),
        createSimpleCharacter: vi.fn(() => null),
        hypaV3ModalOpen: store(false),
        ScrollToMessageStore: scrollToMessage,
        additionalChatMenu,
        additionalFloatingActionButtons,
        chatPanelStore,
        easyPanelStore,
        popUpEditorStore,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const live = stores.DBState as unknown as { db: { characters: Array<{ chatPage: number, chats: unknown[] }> } }
    const current = () => live.db.characters[get(stores.selectedCharID)]
    return {
        appVer: '0.0.0',
        presetTemplate: {},
        changeToPreset: vi.fn(),
        getDatabase: vi.fn(() => live.db),
        setDatabase: vi.fn(),
        getCurrentCharacter: vi.fn(() => current()),
        getCurrentChat: vi.fn(() => current()?.chats?.[current().chatPage]),
        setCurrentChat: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async (text: string) => text.length),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(), alertNormal: vi.fn(), alertToast: vi.fn(), alertWait: vi.fn(), alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true), alertSelect: vi.fn(async () => '0'), alertInput: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/chatML'), () => ({ parseChatML: vi.fn(() => []) }) as unknown as typeof import('src/ts/parser/chatML'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    ParseMarkdown: vi.fn(), hasher: vi.fn((text: string) => text), risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })), snapshotSubject: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/util'), async () => {
    const realPunctuation = await vi.importActual<typeof import('src/ts/util')>('src/ts/util')
    const stores = await import('src/ts/stores.svelte')
    const state = stores.DBState as unknown as { db: { characters: Array<{ chaId?: string, type?: string }> } }
    return {
        findCharacterbyId: (id: string) => state.db.characters.find((candidate) => candidate.type !== 'group' && candidate.chaId === id)
            ?? { name: 'Unknown', chaId: 'unknown', type: 'character', bias: [], desc: '', chats: [], utilityBot: false, inlayViewScreen: false, additionalAssets: [], emotionImages: [], reloadKeys: 0 },
        getAuthorNoteDefaultText: vi.fn(() => ''), getPersonaPrompt: vi.fn(() => ''), getUserName: vi.fn(() => 'User'),
        getUserIcon: vi.fn(() => ''), capitalize: vi.fn((value: string) => value), checkPersonaBinded: vi.fn(() => false),
        pickHashRand: vi.fn(() => 0.5), replaceAsync: vi.fn(), asBuffer: vi.fn(), selectSingleFile: vi.fn(), selectMultipleFile: vi.fn(),
        replacePlaceholders: vi.fn((text: string) => text), getCustomBackground: vi.fn(async () => ''), getEmotion: vi.fn(() => ''),
        BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
        isLastCharPunctuation: realPunctuation.isLastCharPunctuation, trimUntilPunctuation: realPunctuation.trimUntilPunctuation,
        parseToggleSyntax: vi.fn(() => []), prebuiltAssetCommand: vi.fn(() => ''),
        parseKeyValue: vi.fn(() => []),
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: requestChatDataMock, requestChatDataMain: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))
vi.mock(import('src/ts/process/stableDiff'), () => ({ stableDiff: vi.fn(), generateAIImage: vi.fn(async () => null) }) as unknown as typeof import('src/ts/process/stableDiff'))
vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))
vi.mock(import('src/ts/process/exampleMessages'), () => ({ exampleMessage: vi.fn(() => []) }) as unknown as typeof import('src/ts/process/exampleMessages'))
vi.mock(import('src/ts/process/tts'), async (importOriginal) => ({ ...(await importOriginal()), sayTTS: vi.fn(), stopTTS: vi.fn() }) as unknown as typeof import('src/ts/process/tts'))
vi.mock(import('src/ts/process/memory/supaMemory'), () => ({ supaMemory: vi.fn() }) as unknown as typeof import('src/ts/process/memory/supaMemory'))
vi.mock(import('src/ts/process/group'), () => ({ groupOrder: vi.fn((order: unknown) => order) }) as unknown as typeof import('src/ts/process/group'))
vi.mock(import('src/ts/process/triggers'), () => ({ runTrigger: vi.fn(async () => undefined) }) as unknown as typeof import('src/ts/process/triggers'))
vi.mock(import('src/ts/process/command'), () => ({ processMultiCommand: vi.fn(async () => false) }) as unknown as typeof import('src/ts/process/command'))
vi.mock(import('src/ts/process/memory/hypamemory'), () => ({ HypaProcesser: class {} }) as unknown as typeof import('src/ts/process/memory/hypamemory'))
vi.mock(import('src/ts/process/embedding/addinfo'), () => ({ additionalInformations: vi.fn(async () => '') }) as unknown as typeof import('src/ts/process/embedding/addinfo'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(async () => ({ type: 'image', data: '' })), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/process/files/multisend'), () => ({ postChatFile: vi.fn(async () => []) }) as unknown as typeof import('src/ts/process/files/multisend'))
vi.mock(import('src/ts/process/models/modelString'), () => ({ getGenerationModelString: vi.fn(() => undefined) }) as unknown as typeof import('src/ts/process/models/modelString'))
vi.mock(import('src/ts/process/inlayScreen'), () => ({ runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })) }) as unknown as typeof import('src/ts/process/inlayScreen'))
vi.mock(import('src/ts/process/prereroll'), async (importOriginal) => ({
    renameContinuedMessage: (await importOriginal()).renameContinuedMessage, addRerolls: vi.fn(),
}) as unknown as typeof import('src/ts/process/prereroll'))
vi.mock(import('src/ts/process/transformers'), () => ({ runImageEmbedding: vi.fn(), runVITS: vi.fn() }) as unknown as typeof import('src/ts/process/transformers'))
vi.mock(import('src/ts/process/memory/hanuraiMemory'), () => ({ hanuraiMemory: vi.fn() }) as unknown as typeof import('src/ts/process/memory/hanuraiMemory'))
vi.mock(import('src/ts/process/memory/hypav2'), () => ({ hypaMemoryV2: vi.fn() }) as unknown as typeof import('src/ts/process/memory/hypav2'))
vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
    runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn(),
}) as unknown as typeof import('src/ts/process/scriptings'))
vi.mock(import('src/ts/model/modellist'), async (importOriginal) => ({
    ...(await importOriginal()),
    getModelInfo: vi.fn(() => ({ id: 'test-model', flags: [] })),
}) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/process/memory/hypav3'), () => ({ hypaMemoryV3: vi.fn() }) as unknown as typeof import('src/ts/process/memory/hypav3'))
vi.mock(import('src/ts/process/modules'), () => ({
    getModuleAssets: vi.fn(() => []), getModuleToggles: vi.fn(() => ''), getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []), getModuleRegexScripts: vi.fn(() => []), getModules: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/globalApi.svelte'), () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return {
        chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: vi.fn(() => false), aiWatermarkingLawApplies: vi.fn(() => false),
        downloadFile: vi.fn(), readImage: vi.fn(), fetchNative: vi.fn(), getFileSrc: vi.fn(async () => ''), saveAsset: vi.fn(async () => ''),
        globalFetch: vi.fn(), loadAsset: vi.fn(),
        forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})
vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false), translate: vi.fn(async () => ''), runTranslator: vi.fn(async (text: string) => text),
    translateVox: vi.fn(async (text: string) => text), getLLMCache: vi.fn(), searchLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    allowedDbKeys: [], customProviderStore: { providers: new Map() }, getV2PluginAPIs: () => ({}),
    pluginV2: { providers: new Map(), chatOutput: new Set(), editinput: new Set(), editoutput: new Set(), editdisplay: new Set(), editprocess: new Set() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(), updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn(), ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/process/mcp/pluginmcp'), () => ({ registerMCPModule: vi.fn(), unregisterMCPModule: vi.fn() }) as unknown as typeof import('src/ts/process/mcp/pluginmcp'))
vi.mock(import('src/ts/characters'), () => ({ getCharImage: vi.fn(() => '') }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const cold = await import('src/ts/process/coldstorageData')
    return {
        coldStorageHeader: cold.coldStorageHeader, preLoadChat: preLoadChatMock, retryLegacyColdChatLoad: vi.fn(async () => 'ok'),
        setColdStorageItem: vi.fn(), readColdStorageItem: vi.fn(),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})
vi.mock('src/ts/process/coldMemberRestore', () => ({ restoreColdCharacterByChaId: vi.fn(async () => false) }))
vi.mock('src/ts/chatCopy', () => ({ copyPlainText: vi.fn(), stripThoughtsForCopy: vi.fn((text: string) => text) }))
vi.mock('src/ts/chatCard', () => ({ captureCardTheme: vi.fn(), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn() }))

// Surfaces that are not part of the data path under test.
vi.mock('src/lib/ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatShell/StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatScreens/Chats.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('src/lib/ChatScreens/Chat.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('src/lib/ChatScreens/Suggestion.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('src/lib/UI/MainMenu.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('src/lib/Playground/PlaygroundMenu.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('src/lib/ChatScreens/ResizeBox.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatScreens/TransitionImage.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/ChatScreens/BackgroundDom.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/UI/GUI/SideBarArrow.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('src/lib/Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))

//#endregion

import ChatScreen from 'src/lib/ChatScreens/ChatScreen.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { setShellEnabled } from 'src/ts/chatShell/shellSwitch.svelte'
import { doingChat } from 'src/ts/process/index.svelte'
import { resetComposerActionsForTests } from 'src/ts/process/composerActions.svelte'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import { siblingsAt } from 'src/ts/process/chatTree'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { language } from 'src/lang'

//#region fixtures

const CHA_ID = 'cha-next-at-end'
const CHAT_ID = 'chat-next-at-end'

function installDb(): void {
    const chat = {
        id: CHAT_ID, note: '', name: '', localLore: [], fmIndex: -1, scriptstate: {},
        message: [{ role: 'char', data: 'Welcome', time: 1, chatId: 'greeting' }],
    } as unknown as Chat
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        characterOrder: [CHA_ID], statics: { messages: 0 }, aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500,
        bias: [], mainPrompt: '', globalNote: '', jailbreakToggle: false, chainOfThought: false, personaPrompt: '', promptPreprocess: false,
        additionalPrompt: '', descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptTemplate: undefined, promptInfoInsideChat: false, autoContinueMinTokens: 0, autoContinueChat: false,
        igpPrompt: '', notification: false, removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off',
        ttsAutoSpeech: false, presetChain: '', outputImageModal: false, rememberToolUsage: false, supaModelType: 'none',
        hypav2: false, hypaV3: false, hanuraiEnable: false, inlayErrorResponse: false, username: 'User', theme: '',
        askRemoval: false, instantRemove: false, personas: [{ name: 'User', largePortrait: false, icon: '' }], selectedPersona: 0,
        presetRegex: [], useSayNothing: false, playMessage: false, useAutoTranslateInput: false, translatorType: '', translator: '',
        newMessageButtonStyle: 'bottom-center', fixedChatTextarea: false, useChatSticker: false, sideMenuRerollButton: false,
        showMenuChatList: false, showMenuHypaMemoryModal: false, enableRisuaiProTools: false, sendWithEnter: true,
        useAutoSuggestions: false, subModel: '', autoSuggestClean: false, longPressToPopupEditor: false,
        textScreenColor: '', textBorder: false, textScreenRounded: false, textScreenBorder: '', customBackground: '',
        classicMaxWidth: false, waifuWidth: 100, waifuWidth2: 100, templateDefaultVariables: '', swipe: true,
        chatLoadInitialPages: 30, chatLoadAdditionalPages: 15,
        characters: [{
            chaId: CHA_ID, name: 'Next At End', type: 'character', chatPage: 0, chats: [chat], firstMessage: 'Hello!',
            alternateGreetings: [], desc: 'description', bias: [], utilityBot: false, inlayViewScreen: false, viewScreen: 'none',
            reloadKeys: 0, supaMemory: false, triggerscript: [], customscript: [], globalLore: [], largePortrait: false,
            removedQuotes: true, creatorNotes: '', image: '', ttsMode: 'none', additionalAssets: [],
        }],
    } as unknown as Database
    selectedCharID.set(0)
}

function liveChat(): Chat { return DBState.db.characters[0].chats[0] }
function datas(): string[] { return liveChat().message.map((message: Message) => message.data) }

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

function mountScreen(): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatScreen, { target })
    flushSync()
}

async function closeScreen(): Promise<void> {
    if (app) await unmount(app)
    app = null
    target?.remove()
}

async function until(condition: () => boolean, what: string): Promise<void> {
    await vi.waitFor(() => {
        flushSync()
        if (!condition()) throw new Error(`waiting for: ${what}`)
    }, { timeout: 15000, interval: 10 })
}

function replyWith(text: string): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
}

function newInput(): HTMLTextAreaElement | null { return target.querySelector<HTMLTextAreaElement>('[data-part="chat-composer-input"]') }
function arrow(label: string): HTMLButtonElement {
    return target.querySelector<HTMLButtonElement>(`[data-part="chat-message-alts"] [aria-label="${label}"]`)!
}

/** Sends one user message, then regenerates the reply through the row's "new reply" control, which leaves two sibling replies. */
async function buildTwoReplies(): Promise<void> {
    await until(() => newInput() !== null, 'the new composer')
    replyWith('Reply one.')
    newInput()!.value = 'hello there'
    newInput()!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-part="chat-send"]')!.click()
    await until(() => liveChat().message.length === 3 && !get(doingChat), 'the first reply')
    await until(() => target.querySelector('[data-action="newReply"]') !== null, 'the new reply control')
    replyWith('Reply two.')
    target.querySelector<HTMLButtonElement>('[data-action="newReply"]')!.click()
    await until(() => datas().includes('Reply two.') && !get(doingChat), 'the second reply')
    expect(datas()).toEqual(['Welcome', 'hello there', 'Reply two.'])
    expect(siblingsAt(liveChat(), 2).map((message) => message.data)).toEqual(['Reply one.', 'Reply two.'])
}

//#endregion

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'fail', result: 'unexpected request' })
    preLoadChatMock.mockReset()
    preLoadChatMock.mockResolvedValue('ok')
    composerDrafts.resetComposerDraftsForTests()
    resetComposerActionsForTests()
    resetLocalDraftsForTest()
    doingChat.set(false)
    localStorage.clear()
    installDb()
})

afterEach(async () => {
    await closeScreen()
    selectedCharID.set(-1)
})

async function openNewestActions(): Promise<void> {
    const newest = target.querySelector<HTMLElement>('article[data-role="char"][data-chat-index="2"]')!
    newest.querySelector<HTMLButtonElement>(`[aria-label="${language.chatShellMoreActions}"]`)!.click()
    flushSync()
    await tick()
}

let clockOffset = 0
let nowSpy: ReturnType<typeof vi.spyOn> | null = null
beforeEach(() => {
    clockOffset = 0
    const realNow = performance.now.bind(performance)
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => realNow() + clockOffset)
})
afterEach(() => { nowSpy?.mockRestore(); nowSpy = null })

describe('reproducer: every tap on the newest reply\'s New reply button generates', () => {
    test('eight taps three seconds apart each send one request', async () => {
        setShellEnabled(true)
        mountScreen()
        await buildTwoReplies()
        for (let tap = 1; tap <= 8; tap++) {
            clockOffset += 3000
            const before = requestChatDataMock.mock.calls.length
            replyWith(`Tap reply ${tap}.`)
            const button = target.querySelector<HTMLButtonElement>('[data-action="newReply"]')!
            expect(button.disabled).toBe(false)
            button.click()
            flushSync()
            await new Promise<void>((resolve) => setTimeout(resolve, 150))
            flushSync()
            expect(requestChatDataMock.mock.calls.length, `tap ${tap} sent a request`).toBe(before + 1)
            await until(() => !get(doingChat) && datas()[2] === `Tap reply ${tap}.`, `reply ${tap} settled`)
        }
    })
})

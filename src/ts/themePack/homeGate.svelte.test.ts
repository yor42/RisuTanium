// @vitest-environment jsdom
/**
 * HG-1: the real Home shell declares the home surface (AS-12). Fixture: ChatScreen.svelte on its home branch (no character selected,
 * the shell switch off), through DefaultChatScreen.svelte and HomeShell.svelte, with the real surface gate installed and a registered
 * home probe element. The mock set is the one of escapeWalk.home.svelte.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does.
import 'src/ts/polyfill'

//#region module mocks
const requestChatDataMock = vi.hoisted(() => vi.fn())
const preLoadChatMock = vi.hoisted(() => vi.fn(async (): Promise<string> => 'ok'))
const postChatFileMock = vi.hoisted(() => vi.fn(async (): Promise<Array<{ type: 'asset', data: string }> | null> => []))
const processScriptFullMock = vi.hoisted(() => vi.fn())

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
        OpenRealmStore: store(false), RealmInitialOpenChar: store(null), alertStore: store({ type: 'none', msg: '' }), sideBarStore: store(false), settingsOpen: store(false),
        additionalHamburgerMenu: [], DynamicGUI: store(false), sideBarClosing: store(false),
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
        moduleBackgroundEmbedding: store(''),
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
    processScriptFull: processScriptFullMock,
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
    getInlayDraftPreview: vi.fn(async () => ({ kind: 'media', type: 'image', url: '' })), forgetInlayRender: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/process/files/multisend'), () => ({ postChatFile: postChatFileMock }) as unknown as typeof import('src/ts/process/files/multisend'))
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
        globalFetch: vi.fn(), loadAsset: vi.fn(), getVersionString: vi.fn(() => 'test-version'), openURL: vi.fn(),
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
vi.mock(import('src/ts/characters'), () => ({ getCharImage: vi.fn(() => ''), archivedMemberIds: () => [], changeCharGeneration: () => 0, supersedeChangeChar: vi.fn() }) as unknown as typeof import('src/ts/characters'))
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
vi.mock('src/lib/ChatShell/ShellMessageList.svelte', () => ({ default: () => ({}) }))
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
vi.mock('src/lib/UI/Realm/RealmMain.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('src/lib/UI/Home/HomeLibrary.svelte', () => ({ default: () => {} }))
vi.mock(import('src/ts/characterCards'), () => ({ hubURL: 'https://hub.test', getRisuHub: vi.fn(() => new Promise(() => {})) }) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/characterPick'), () => ({ changeCharOrAlert: vi.fn() }) as unknown as typeof import('src/ts/characterPick'))
vi.mock('src/lib/Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))

//#endregion

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import ChatScreen from 'src/lib/ChatScreens/ChatScreen.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { setShellEnabled } from 'src/ts/chatShell/shellSwitch.svelte'

import { installThemePackGate, registerThemePackElement, resetThemePackGateForTests, screenMasked, shownScreen } from './surfaceGate.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement

function setViewport(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

async function showHome(width: number): Promise<void> {
    setViewport(width)
    selectedCharID.set(-1)
    target = document.createElement('main')
    document.body.appendChild(target)
    app = mount(ChatScreen, { target })
    await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector('[data-part="home-topbar"], [data-part="home-landing"]')).not.toBeNull()
    }, { timeout: 15000 })
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    setShellEnabled(false)
    DBState.db = { hideRealm: false, realmDirectOpen: false, hideAllImages: false, theme: '', characters: [], modules: [], personas: [{ name: 'User', largePortrait: false, icon: '' }], selectedPersona: 0, username: 'User', textScreenColor: '', customBackground: '', classicMaxWidth: false, waifuWidth: 100, waifuWidth2: 100, templateDefaultVariables: '' } as unknown as Database
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

afterEach(() => {
    resetThemePackGateForTests()
    document.head.innerHTML = ''
})

function homeProbe(): HTMLStyleElement {
    const element = document.createElement('style')
    element.setAttribute('data-theme-pack', 'home')
    element.setAttribute('media', 'not all')
    document.head.appendChild(element)
    registerThemePackElement(element, 'home', null)
    return element
}

describe('HG-1 the Home shell declares the home surface', () => {
    test('shown: the home element is on; Settings or Studio open masks it; unmounting turns it off', async () => {
        const open = { settingsOpen: false, studioOpen: false }
        installThemePackGate((area) => screenMasked(area, open))
        const home = homeProbe()
        await showHome(360)
        flushSync()
        expect(shownScreen()).toBe('home')
        expect(home.getAttribute('media')).toBe('all')
        await unmount(app!)
        app = undefined
        flushSync()
        expect(shownScreen()).toBeNull()
        expect(home.getAttribute('media')).toBe('not all')
    })

    test('a Settings or Studio cover turns the home element off while the shell stays mounted', async () => {
        const open = $state({ settingsOpen: false, studioOpen: false })
        installThemePackGate((area) => screenMasked(area, open))
        const home = homeProbe()
        await showHome(360)
        flushSync()
        expect(home.getAttribute('media')).toBe('all')
        open.settingsOpen = true
        flushSync()
        expect(home.getAttribute('media')).toBe('not all')
        open.settingsOpen = false
        open.studioOpen = true
        flushSync()
        expect(home.getAttribute('media')).toBe('not all')
        open.studioOpen = false
        flushSync()
        expect(home.getAttribute('media')).toBe('all')
    })
})

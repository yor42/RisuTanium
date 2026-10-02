// @vitest-environment happy-dom

/**
 * Deleting a chat or a character while a trigger run is in flight, and the busy
 * button during a send trigger.
 *
 * A stop (a confirmed delete or the busy button) ends a trigger's remaining
 * effects: the effect already running finishes and no later effect of that run,
 * or of a run nested in it, begins. Work bound to another character is untouched.
 * Mounts the real `Chat.svelte` (its trigger button) and `SideChatList.svelte`,
 * and drives the real trigger engine, command line, `sendChat`, auto mode and
 * `removeChar`. A trigger effect's model call is held on a gate the test
 * releases; every other provider request is a held streaming reply. Only the
 * provider, the scripts, Lua and the modules they import are mocked.
 *
 * A provider request is held open until the test feeds and closes its stream, so
 * a delete or a busy-button press can land at a known point of a generation.
 * Tests titled `guard:` pin behaviour that must be preserved; every other test
 * is a regression test for the behaviour it names.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'
import type { Origin } from 'src/ts/process/chatOrigin'
import type { CommandContext } from 'src/ts/process/command'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`).
import 'src/ts/polyfill'

//#region module mocks

interface ChatOutputArg {
    char: { chaId?: string }
    chat: { id?: string }
    characterIndex: number
    chatIndex: number
    messageIndex: number
}

/** What the trigger engine is handed for a run: the parts a command effect passes on. */
interface TriggerRunArg {
    origin?: Origin
    signal?: AbortSignal
    ownsWindow?: boolean
}

type TriggerHandler = (arg: TriggerRunArg) => unknown

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const triggerHandlers = vi.hoisted(() => ({} as Record<string, TriggerHandler | undefined>))
const downloadFileMock = vi.hoisted(() => vi.fn(async () => {}))
const platformBox = vi.hoisted(() => ({ isTauri: false }))
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
const chatOutputListeners = vi.hoisted(() => new Set<(arg: ChatOutputArg) => unknown>())
const interceptedSleeps = vi.hoisted(() => new Map<number, { gate: Promise<void>, markReached: () => void }>())
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_msg: string) => true))
const alertInputMock = vi.hoisted(() => vi.fn(async (_msg: string) => ''))
const changeChatToMock = vi.hoisted(() => vi.fn())
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selIdBox = $state({ selId: 0 })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
        bookmarkListOpen: writable(false),
        selIdState: selIdBox,
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => null),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const live = stores.DBState as unknown as { db: { characters: Array<{ chatPage: number, chats: unknown[] }> } }
    const currentCharacter = () => live.db.characters[get(stores.selectedCharID)]
    return {
        changeToPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        getDatabase: vi.fn(() => live.db),
        setDatabase: vi.fn((d: unknown) => { live.db = d as never }),
        getCurrentCharacter: vi.fn(() => currentCharacter()),
        getCurrentChat: vi.fn(() => {
            const char = currentCharacter()
            return char?.chats?.[char.chatPage]
        }),
        setCurrentChat: vi.fn(),
        setCurrentCharacter: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: alertErrorMock,
    alertToast: vi.fn(),
    alertInput: alertInputMock,
    alertClear: vi.fn(),
    alertRequestData: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: alertConfirmMock,
    alertWait: vi.fn(),
    alertChatOptions: vi.fn(async () => -1),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: hasherMock,
    parseMarkdownSafe: vi.fn(),
    ParseMarkdown: vi.fn(async (text: string) => text ?? ''),
    addMetadataToElement: vi.fn((html: string) => html),
    postTranslationParse: vi.fn((html: string) => html),
    trimMarkdown: vi.fn((html: string) => html),
    getDistance: vi.fn(() => 0),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/util'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const state = stores.DBState as unknown as { db: { characters: Array<{ chaId?: string, type?: string }> } }
    return {
        findCharacterbyId: (id: string) => {
            for (const candidate of state.db.characters) {
                if (candidate.type !== 'group' && candidate.chaId === id) {
                    return candidate
                }
            }
            return {
                name: 'Unknown Character',
                chaId: globalThis.crypto.randomUUID(),
                type: 'character',
                bias: [],
                desc: '',
                chats: [],
                utilityBot: false,
                inlayViewScreen: false,
                additionalAssets: [],
                emotionImages: [],
                reloadKeys: 0,
            }
        },
        findCharacterIndexbyId: (id: string) => state.db.characters.findIndex((c) => c.chaId === id),
        checkNullish: (v: unknown) => v === null || v === undefined,
        sortableOptions: { delay: 300, delayOnTouchOnly: true, filter: '.no-sort', onMove: () => true },
        capitalize: (s: string) => s,
        parseKeyValue: (template: string) => {
            if (!template) return []
            const kv: [string, string][] = []
            for (const line of template.split('\n')) {
                const [key, value] = line.split('=')
                if (key && value) kv.push([key, value])
            }
            return kv
        },
        getAuthorNoteDefaultText: vi.fn(() => ''),
        getPersonaPrompt: vi.fn(() => ''),
        getUserName: vi.fn(() => 'User'),
        getUserIcon: vi.fn(() => ''),
        checkPersonaBinded: vi.fn(() => false),
        asBuffer: vi.fn(),
        selectSingleFile: vi.fn(),
        selectMultipleFile: vi.fn(),
        BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
        isLastCharPunctuation: isLastCharPunctuationMock,
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
        // `ms === 10` is the composer's own wait after it appends the message;
        // a test parks it with `interceptedSleeps`. Any other duration is a
        // real timer.
        sleep: vi.fn((ms: number) => {
            const intercepted = interceptedSleeps.get(ms)
            if (intercepted) {
                intercepted.markReached()
                return intercepted.gate
            }
            return new Promise<void>((res) => setTimeout(res, ms))
        }),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: requestChatDataMock,
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    stableDiff: vi.fn(),
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/exampleMessages'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('src/ts/process/ttsHooks'))

vi.mock(import('src/ts/process/memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/supaMemory'))

vi.mock(import('src/ts/process/group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/process/embedding/addinfo'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
    postInlayAsset: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/models/modelString'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/prereroll'), () => ({
    addRerolls: vi.fn(),
    Prereroll: vi.fn(() => undefined),
    PreUnreroll: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/prereroll'))

vi.mock(import('src/ts/process/transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('src/ts/process/transformers'))

vi.mock(import('src/ts/process/memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hanuraiMemory'))

vi.mock(import('src/ts/process/memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav2'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
    runLuaButtonTrigger: vi.fn(async () => undefined),
    runScripted: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model', shortName: 'test-model', flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(),
    isPlainHttpFileSrc: vi.fn(() => false),
    fetchNative: vi.fn(),
    downloadFile: downloadFileMock,
    checkCharOrder: vi.fn(),
    getFetchLogs: vi.fn(),
    changeChatTo: changeChatToMock,
    requiresFullEncoderReload: { state: false },
    AppendableBuffer: class {},
    getFileSrc: vi.fn(async () => ''),
    createChatCopyName: vi.fn((name: string) => `${name} Copy`),
    reorderChatsKeepingCurrent: vi.fn(),
    aiLawApplies: vi.fn(() => false),
    foldChatToMessage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
    translateHTML: vi.fn(async (html: string) => html),
    setLLMCache: vi.fn(async () => {}),
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: { providers: new Map() },
    getV2PluginAPIs: () => ({
        safeLocalStorage: {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            keys: vi.fn(),
        },
    }),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: { providers: new Map(), chatOutput: chatOutputListeners },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/plugins/apiV3/factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('src/ts/plugins/apiV3/factory'))

vi.mock(import('src/ts/plugins/pluginSafeClass'), () => ({
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('src/ts/plugins/pluginSafeClass'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    ColorSchemeTypeStore: writable('dark'),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/mcp/pluginmcp'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/gui/longtouch'), () => ({
    longpress: vi.fn(() => ({ destroy: () => {} })),
}) as unknown as typeof import('src/ts/gui/longtouch'))

const FakeSortable = vi.hoisted(() => {
    class Sortable {
        static create() { return new Sortable() }
        destroy() {}
    }
    return Sortable
})

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
    default: FakeSortable,
}))

vi.mock('src/lib/SideBars/Toggles.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock('src/lib/ChatScreens/PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { send, reroll, unReroll, runAutoMode, abortChat, isAutoModeActive, resetComposerActionsForTests, type ComposerActionsSource } from 'src/ts/process/composerActions.svelte'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import { processMultiCommand } from 'src/ts/process/command'
import { postChatFile } from 'src/ts/process/files/multisend'
import { runAutopilot } from 'src/ts/process/devToolActions'
import { makeRisuaiAPIV3 } from 'src/ts/plugins/apiV3/v3.svelte'
import { DBState, selectedCharID, selIdState } from 'src/ts/stores.svelte'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { removeChar } from 'src/ts/characters'
import { language } from 'src/lang'
import { isWriting } from 'src/ts/process/chatOrigin'
import { flushSync, mount, unmount } from 'svelte'
import ChatMessage from 'src/lib/ChatScreens/Chat.svelte'
import SideChatList from 'src/lib/SideBars/SideChatList.svelte'
import ChatList from 'src/lib/Others/ChatList.svelte'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function makeChat(id: string, message: Message[], extra: Record<string, unknown> = {}): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message, scriptstate: {}, ...extra } as unknown as Chat
}

function makeCharacter(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        firstMessage: 'Hello!',
        alternateGreetings: [],
        desc: `${chaId} description`,
        bias: [],
        replaceGlobalNote: undefined,
        systemPrompt: undefined,
        utilityBot: false,
        inlayViewScreen: false,
        viewScreen: undefined,
        depth_prompt: undefined,
        reloadKeys: 0,
        supaMemory: false,
        triggerscript: [],
        customscript: [],
        globalLore: [],
        chats,
        ...extra,
    } as unknown as CharacterFixture
}

function installWorld(overrides: Record<string, unknown> = {}): void {
    const characters = [makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])])]
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        statics: { messages: 0 },
        aiModel: 'gpt-3.5-turbo',
        maxContext: 999999,
        maxResponse: 500,
        bias: [],
        mainPrompt: '',
        globalNote: '',
        jailbreakToggle: false,
        chainOfThought: false,
        personaPrompt: false,
        promptPreprocess: false,
        additionalPrompt: '',
        descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptTemplate: undefined,
        promptInfoInsideChat: false,
        autoContinueMinTokens: 0,
        autoContinueChat: false,
        igpPrompt: '',
        notification: false,
        removeIncompleteResponse: false,
        streamingDisplayOptimizationMode: 'off',
        ttsAutoSpeech: false,
        presetChain: '',
        outputImageModal: false,
        rememberToolUsage: false,
        supaModelType: 'none',
        hypav2: false,
        hypaV3: false,
        hanuraiEnable: false,
        inlayErrorResponse: false,
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        presetRegex: [],
        useSayNothing: false,
        playMessage: false,
        useAutoTranslateInput: false,
        translatorType: '',
        ...overrides,
    } as unknown as Database
    selectedCharID.set(0)
}

function theChat(): Chat {
    return DBState.db.characters[0].chats[0]
}

/** The text of every message in the chat, in order. */
function contents(): string[] {
    return theChat().message.map((m) => m.data)
}

function draftKey() {
    return { chaId: 'char-0', chatId: 'chat-0' }
}

function seedDraft(text: string): void {
    composerDrafts.write(draftKey(), (record) => { record.messageInput = text })
}

function draftText(): string {
    return composerDrafts.peek(draftKey()).messageInput
}

function makeSource(): ComposerActionsSource {
    return { closeMenu: () => {} }
}

let pluginCounter = 0

/** A v3 plugin API with its own script, so no permission decision is shared between tests. */
function makePluginApi() {
    pluginCounter++
    const plugin: RisuPlugin = {
        name: `ownership-plugin-${pluginCounter}`,
        script: `ownership-script-${pluginCounter}`,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

async function settle(): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, 0))
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (condition()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

interface ControlledStream {
    stream: ReadableStream<{ data: string }>
    push(text: string): void
    close(): void
}

function controlledStream(): ControlledStream {
    let controller: ReadableStreamDefaultController<{ data: string }> | undefined
    const stream = new ReadableStream<{ data: string }>({
        start(c) { controller = c },
    })
    return {
        stream,
        push(text) {
            try { controller?.enqueue({ data: text }) } catch { /* the reader cancelled it */ }
        },
        close() {
            try { controller?.close() } catch { /* the reader cancelled it */ }
        },
    }
}

interface HeldRequest {
    signal: AbortSignal | undefined
    source: ControlledStream
}

const held: HeldRequest[] = []

/** Every provider request from now on returns a stream the test feeds and closes by hand. */
function holdEveryRequest(): void {
    requestChatDataMock.mockImplementation(async (_arg: unknown, _mode: string, signal?: AbortSignal) => {
        const source = controlledStream()
        held.push({ signal, source })
        return { type: 'streaming', result: source.stream }
    })
}

function closeEveryHeldStream(): void {
    for (const request of held) {
        request.source.close()
    }
}

function mockReply(text: string): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
}

/** Waits until `count` requests are held, and feeds the last one a first chunk. */
async function requestHeld(count: number): Promise<HeldRequest> {
    await until(() => held.length >= count, `${count} held request(s)`)
    const request = held[count - 1]
    request.source.push(`chunk ${count}`)
    await settle()
    return request
}

/**
 * Closes every held stream, again and again, until `promise` settles; calls
 * `stop` part-way so a loop that would never end on its own is ended.
 */
async function drain(promise: Promise<unknown>, stop: () => void = () => {}): Promise<void> {
    let done = false
    void promise.then(() => { done = true }, () => { done = true })
    for (let i = 0; i < 80 && !done; i++) {
        closeEveryHeldStream()
        await settle()
        if (i === 25) {
            stop()
        }
    }
    if (!done) {
        throw new Error('the call did not settle although every stream was closed')
    }
}

function stopAutoMode(source: ComposerActionsSource): () => void {
    return () => {
        if (isAutoModeActive()) {
            void runAutoMode(source)
        }
    }
}

function settledOutcome<T>(promise: Promise<T>): Promise<T | Error> {
    return promise.then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

interface Observation<T> {
    state: 'pending' | 'resolved' | 'rejected'
    value?: T
    error?: Error
}

/** What `promise` has done after a few macrotasks, without waiting for it. */
async function observe<T>(promise: Promise<T>, ticks = 4): Promise<Observation<T>> {
    const seen: Observation<T> = { state: 'pending' }
    promise.then(
        (value) => { seen.state = 'resolved'; seen.value = value },
        (error: unknown) => { seen.state = 'rejected'; seen.error = error instanceof Error ? error : new Error(String(error)) },
    )
    for (let i = 0; i < ticks; i++) {
        await settle()
    }
    return { ...seen }
}

function makeLatch() {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    let markReached: () => void = () => {}
    const reached = new Promise<void>((res) => { markReached = res })
    return { gate, release, reached, markReached }
}

/** Holds the composer's input trigger open: the composer's window stays open until `release`. */
function gateInputTrigger() {
    const { gate, release, reached, markReached } = makeLatch()
    triggerHandlers.input = async () => {
        markReached()
        await gate
    }
    return { release, reached }
}

/**
 * The context a command effect of a run gives its command line: the run's own
 * chat, its cancel signal and whether it owns the composer's window.
 */
function commandContextOf(arg: TriggerRunArg): CommandContext {
    if (!arg.origin) {
        throw new Error('the trigger run carries no origin')
    }
    return { origin: arg.origin, signal: arg.signal, ownsWindow: arg.ownsWindow }
}

/** The context of a line typed in the composer of `char-0`'s chat: it owns the window the take opened. */
function composerCommandContext(): CommandContext {
    return { origin: draftKey(), ownsWindow: true }
}

/**
 * Post File as the chat screen calls it: with the key of the chat it was
 * clicked in and the objects that chat was read through.
 */
function postFile(query: Parameters<typeof postChatFile>[0]): ReturnType<typeof postChatFile> {
    return postChatFile(query, draftKey(), { owner: DBState.db.characters[0], chat: theChat() })
}

/** A `.po` file with one entry per text, each ended by a blank line. */
function poFile(...texts: string[]): { name: string, data: Uint8Array } {
    const body = texts.map((text) => `msgid "${text}"\nmsgstr ""\n\n`).join('')
    return { name: 'job.po', data: new TextEncoder().encode(body) }
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    alertErrorMock.mockReset()
    downloadFileMock.mockClear()
    platformBox.isTauri = false
    for (const key of Object.keys(triggerHandlers)) {
        delete triggerHandlers[key]
    }
    runTriggerMock.mockReset()
    runTriggerMock.mockImplementation(async (_char: unknown, mode: string, arg: TriggerRunArg) => triggerHandlers[mode]?.(arg))
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    chatOutputListeners.clear()
    interceptedSleeps.clear()
    held.length = 0
    resetLocalDraftsForTest()
    doingChat.set(false)
})

afterEach(() => {
    closeEveryHeldStream()
    resetComposerActionsForTests()
    selectedCharID.set(-1)
})

//#endregion
//#region fixtures and helpers

import { sayTTS } from 'src/ts/process/tts'
import { isComposerBusy, isComposerLocked } from 'src/ts/process/composerActions.svelte'

const BASE_CONFIRM = () => language.removeConfirm
const CHAT_WARNING = () => language.removeChatWhileWorking
const CHARACTER_WARNING = () => language.removeCharacterWhileWorking
const BASE_CONFIRM2 = () => language.removeConfirm2

interface Mounted { instance: Record<string, unknown>, target: HTMLElement }
const mountedComponents: Mounted[] = []

beforeEach(() => {
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    changeChatToMock.mockReset()
    changeChatToMock.mockImplementation((v: number | string) => {
        const char = DBState.db.characters[get(selectedCharID)]
        if (typeof v === 'number' && char) {
            char.chatPage = v
        }
    })
    vi.mocked(sayTTS).mockReset()
})

afterEach(async () => {
    for (const { instance, target } of mountedComponents.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    document.body.replaceChildren()
})

function installWorldWith(characters: CharacterFixture[], overrides: Record<string, unknown> = {}): void {
    installWorld(overrides)
    DBState.db.characters = characters
    DBState.db.characterOrder = characters.map((c) => c.chaId)
    selectedCharID.set(0)
}

function chatOf(id: string, name: string, texts: string[] = ['Hi'], extra: Record<string, unknown> = {}): Chat {
    return makeChat(id, texts.map((t) => msg('user', t)), { name, ...extra })
}

/** char-0 with the chats `A` (chat-0) and `B` (chat-1), the first one on screen, no folders. */
function twoChatWorld(): void {
    installWorldWith([
        makeCharacter('char-0', [chatOf('chat-0', 'Chat A'), chatOf('chat-1', 'Chat B', ['B last'])], { chatFolders: [] }),
    ])
}

function liveChar(index = 0): CharacterFixture {
    return DBState.db.characters[index]
}

function chatIds(index = 0): string[] {
    return liveChar(index).chats.map((c) => c.id as string)
}

function allMessageTexts(): string[] {
    return DBState.db.characters.flatMap((c) => c.chats.flatMap((chat) => chat.message.map((m) => m.data)))
}

function mountSide(chara: CharacterFixture): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(SideChatList, { target, props: { chara } }) as unknown as Record<string, unknown>
    mountedComponents.push({ instance, target })
    flushSync()
    return target
}

function mountChatList(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(ChatList, { target, props: {} }) as unknown as Record<string, unknown>
    mountedComponents.push({ instance, target })
    flushSync()
    return target
}

function lastRoleButton(row: Element | null | undefined): HTMLElement {
    if (!row) {
        throw new Error('chat row not found')
    }
    const buttons = row.querySelectorAll<HTMLElement>('div[role="button"]')
    if (buttons.length === 0) {
        throw new Error('no delete button in row')
    }
    return buttons[buttons.length - 1]
}

/** The trash button of `SideChatList`'s row for the chat at `index` (folder or folder-less branch). */
function sideDelete(target: HTMLElement, index: number): HTMLElement {
    return lastRoleButton(target.querySelector(`button[data-risu-chat-idx="${index}"]`))
}

/** The trash button of `ChatList`'s row number `row`. */
function chatListDelete(target: HTMLElement, row: number): HTMLElement {
    const rows = Array.from(target.querySelectorAll<HTMLElement>('button')).filter((b) => b.querySelector('div[role="button"]'))
    return lastRoleButton(rows[row])
}

async function settleMany(n = 6): Promise<void> {
    for (let i = 0; i < n; i++) {
        flushSync()
        await settle()
    }
}

/** The text of the n-th confirm the code under test asked. */
function confirmText(n = 0): string {
    const texts = alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((text) => !text.startsWith('Plugin '))
    return texts[n]
}

/** A plugin send into whatever chat is selected, held open with its first chunk fed. */
async function startHeldSend(count = 1): Promise<{ running: Promise<boolean>, request: HeldRequest }> {
    holdEveryRequest()
    const running = sendChat()
    const request = await requestHeld(count)
    return { running, request }
}

/** A send into the selected group, held open on its first member's turn. */
async function startHeldGroupSend(): Promise<{ running: Promise<boolean>, request: HeldRequest }> {
    holdEveryRequest()
    const running = sendChat()
    const request = await requestHeld(1)
    return { running, request }
}

/** Holds a gate that a mocked confirm can await, and marks the moment the confirm opened. */
function holdNextConfirm(during: () => Promise<void> | void = () => {}, answer = true): { opened: Promise<void> } {
    const { reached, markReached } = makeLatch()
    alertConfirmMock.mockImplementationOnce(async () => {
        markReached()
        await during()
        return answer
    })
    return { opened: reached }
}

//#endregion

//#region trigger fixtures

const CHAT_DB_OVERRIDES = {
    askRemoval: false, instantRemove: false, translatorType: 'none',
    translateBeforeHTMLFormatting: false, legacyTranslation: false,
    requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100,
    lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
    useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
    enableBookmark: true, createFolderOnBranch: false, iconsize: 100,
    memoryLimitThickness: 2, theme: 'default', guiHTML: '', roundIcons: false,
}

const BUTTON_HTML = '<button risu-trigger="t1" risu-id="i1">Click</button>'

interface ModelCall { release: () => void }

/** The trigger engine's own model calls (`noMultiGen`), each held until the test releases it. */
const modelCalls: ModelCall[] = []

/**
 * A trigger effect's model call waits on a gate the test releases; every other
 * request is a streaming reply the test feeds and closes, like `holdEveryRequest`.
 */
function installRequestMock(): void {
    requestChatDataMock.mockImplementation(async (arg: { noMultiGen?: boolean }, _mode: string, signal?: AbortSignal) => {
        if (arg?.noMultiGen) {
            const call = makeLatch()
            modelCalls.push({ release: call.release })
            await call.gate
            return { type: 'success', result: 'model says' }
        }
        const source = controlledStream()
        held.push({ signal, source })
        return { type: 'streaming', result: source.stream }
    })
}

beforeEach(() => {
    window.innerWidth = 1024
    modelCalls.length = 0
})

function llm(outputVar: string) {
    return { type: 'v2RunLLM', indent: 0, value: 'ask', valueType: 'value', outputVar, model: 'model' }
}

function say(text: string) {
    return { type: 'v2Impersonate', indent: 0, role: 'char', value: text, valueType: 'value' }
}

function command(text: string) {
    return { type: 'v2Command', indent: 0, value: text, valueType: 'value' }
}

interface TriggerWorldOptions {
    type?: 'manual' | 'start'
    withButton?: boolean
    secondCharacter?: boolean
}

/** char-0 (chats A and B) carrying one low-level trigger of `effects`; optionally a second character char-1. */
function triggerWorld(effects: unknown[], options: TriggerWorldOptions = {}): void {
    const withButton = options.withButton ?? true
    const a = makeChat('chat-0', withButton ? [msg('char', BUTTON_HTML)] : [msg('user', 'Hi')], { name: 'Chat A', bookmarks: [], bookmarkNames: {} })
    const b = makeChat('chat-1', [msg('user', 'B last')], { name: 'Chat B', bookmarks: [], bookmarkNames: {} })
    const char = makeCharacter('char-0', [a, b], {
        chatFolders: [],
        ttsMode: 'none',
        lowLevelAccess: true,
        triggerscript: [{
            comment: 't1',
            type: options.type ?? 'manual',
            conditions: [],
            lowLevelAccess: true,
            effect: effects,
        }],
    })
    const characters = [char]
    if (options.secondCharacter) {
        characters.push(makeCharacter('char-1', [chatOf('b-chat', 'B chat', ['b'])], { chatFolders: [] }))
    }
    installWorldWith(characters, CHAT_DB_OVERRIDES)
    selIdState.selId = 0
    installRequestMock()
}

async function mountChatMessage(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(ChatMessage, {
        target,
        props: { idx: 0, message: BUTTON_HTML, isLastMemory: false },
    }) as unknown as Record<string, unknown>
    mountedComponents.push({ instance, target })
    flushSync()
    await new Promise((r) => setTimeout(r, 20))
    flushSync()
    return target
}

/** Clicks chat A's trigger button and waits until its first model call is held. */
async function clickButtonHeldOnModelCall(): Promise<void> {
    const target = await mountChatMessage()
    const button = target.querySelector<HTMLButtonElement>('[risu-trigger="t1"]')
    if (!button) {
        throw new Error('the trigger button did not render')
    }
    button.click()
    await until(() => modelCalls.length >= 1, 'the trigger\'s first model call')
}

async function unmountChatMessage(): Promise<void> {
    const mountedChat = mountedComponents.shift()
    if (mountedChat) {
        await unmount(mountedChat.instance as never).catch(() => {})
        mountedChat.target.remove()
    }
}

function releaseCall(index: number): void {
    modelCalls[index]?.release()
}

//#endregion

describe('a trigger-button run held on a model call', () => {
    test('a trigger-button run held on a model call in chat A: deleting A shows a warning beyond the usual text', async () => {
        triggerWorld([llm('r'), say('posted by run')])
        await clickButtonHeldOnModelCall()
        const registered = isWriting({ chaId: 'char-0', chatId: 'chat-0' })
        const side = mountSide(liveChar())

        sideDelete(side, 0).click()
        await settleMany()
        const text = confirmText()
        releaseCall(0)
        await settleMany()

        expect(registered, 'the run is registered while held').toBe(true)
        expect(text).toBe(BASE_CONFIRM() + 'Chat A' + '\n' + CHAT_WARNING())
    })

    test('a trigger-button run of a held model call then /send y: trashing the character during the call, then releasing it, posts no y', async () => {
        triggerWorld([llm('r'), command('/send y')])
        await clickButtonHeldOnModelCall()

        await removeChar(liveChar(), 'char-0')
        await settleMany()
        releaseCall(0)
        await settleMany(10)
        const posted = allMessageTexts()

        expect(posted.includes('y'), 'y is posted somewhere').toBe(false)
    })

    test('guard: deleting chat A during the model call, then releasing it, posts y nowhere', async () => {
        triggerWorld([llm('r'), command('/send y')])
        await clickButtonHeldOnModelCall()
        const side = mountSide(liveChar())

        sideDelete(side, 0).click()
        await settleMany()
        releaseCall(0)
        await settleMany(10)
        const posted = allMessageTexts()

        expect.soft(chatIds(), 'chat A was deleted').toEqual(['chat-1'])
        expect.soft(posted.includes('y'), 'y is posted somewhere').toBe(false)
    })

    test('a trigger-button run of a model call, a posted message and a second model call: trashing the character during the first call posts no message and starts no second request', async () => {
        triggerWorld([llm('r'), say('posted by run'), llm('r2')])
        await clickButtonHeldOnModelCall()

        await removeChar(liveChar(), 'char-0')
        await settleMany()
        releaseCall(0)
        await settleMany(10)
        const posted = allMessageTexts().includes('posted by run')
        const calls = modelCalls.length
        releaseCall(1)

        expect.soft(posted, 'the message is posted somewhere').toBe(false)
        expect.soft(calls, 'model calls started').toBe(1)
    })
})

describe('a delete stops only the work in the deleted chat or character', () => {
    /**
     * A trigger-button run of a model call, a posted message and a second model
     * call, held on its first call in char-0's chat A, while another character
     * (char-1) has `other` running in its chat B. Then char-0's chat A is deleted
     * through SideChatList or the character is trashed through `removeChar`.
     */
    async function runS14(other: 'send' | 'auto', how: 'delete' | 'trash') {
        triggerWorld([llm('r'), say('posted by run'), llm('r2')], { secondCharacter: true })
        await clickButtonHeldOnModelCall()
        await unmountChatMessage()
        selectedCharID.set(1)
        selIdState.selId = 1
        const source = makeSource()
        const work = other === 'send' ? sendChat() : runAutoMode(source)
        const request = await requestHeld(1)

        if (how === 'delete') {
            const side = mountSide(DBState.db.characters[0])
            sideDelete(side, 0).click()
        }
        else {
            void removeChar(DBState.db.characters[0], 'char-0')
        }
        await settleMany()
        releaseCall(0)
        await settleMany(10)
        const posted = allMessageTexts().includes('posted by run')
        const calls = modelCalls.length
        const bAborted = request.signal?.aborted
        const flag = get(doingChat)
        const active = isAutoModeActive()
        const removed = how === 'delete'
            ? chatIds(0).join(',') === 'chat-1'
            : DBState.db.characters.find((c) => c.chaId === 'char-0')?.trashTime !== undefined
        request.source.close()
        await settleMany(4)
        releaseCall(1)
        await drain(work, stopAutoMode(source))
        return { posted, calls, bAborted, flag, active, removed }
    }

    test('a trigger-button run held on a model call in chat A and a send streaming in another character\'s chat B: trashing A\'s character starts no further effect and leaves B\'s request and flag alone', async () => {
        const r = await runS14('send', 'trash')

        expect.soft(r.removed, 'the character was trashed').toBe(true)
        expect.soft(r.posted, 'the run posted its next message').toBe(false)
        expect.soft(r.calls, 'model calls started by the run').toBe(1)
        expect.soft(r.bAborted, 'B\'s provider signal is aborted').toBe(false)
        expect.soft(r.flag, 'B\'s send still holds doingChat').toBe(true)
    })

    test('a trigger-button run held on a model call in chat A and auto mode running in another character\'s chat B: trashing A\'s character starts no further effect and leaves auto mode alone', async () => {
        const r = await runS14('auto', 'trash')

        expect.soft(r.removed, 'the character was trashed').toBe(true)
        expect.soft(r.posted, 'the run posted its next message').toBe(false)
        expect.soft(r.calls, 'model calls started by the run').toBe(1)
        expect.soft(r.bAborted, 'the tick\'s provider signal is aborted').toBe(false)
        expect.soft(r.active, 'auto mode is active').toBe(true)
    })

    test('guard: a trigger-button run held on a model call in chat A and a send streaming in another character\'s chat B: deleting chat A leaves B\'s request and flag alone', async () => {
        const r = await runS14('send', 'delete')

        expect.soft(r.removed, 'chat A was deleted').toBe(true)
        expect.soft(r.posted, 'the run posted its next message').toBe(false)
        expect.soft(r.calls, 'model calls started by the run').toBe(1)
        expect.soft(r.bAborted, 'B\'s provider signal is aborted').toBe(false)
        expect.soft(r.flag, 'B\'s send still holds doingChat').toBe(true)
    })

    test('guard: a trigger-button run held on a model call in chat A and auto mode running in another character\'s chat B: deleting chat A leaves auto mode alone', async () => {
        const r = await runS14('auto', 'delete')

        expect.soft(r.removed, 'chat A was deleted').toBe(true)
        expect.soft(r.posted, 'the run posted its next message').toBe(false)
        expect.soft(r.calls, 'model calls started by the run').toBe(1)
        expect.soft(r.bAborted, 'the tick\'s provider signal is aborted').toBe(false)
        expect.soft(r.active, 'auto mode is active').toBe(true)
    })
})

describe('the busy button and a send trigger\'s remaining effects', () => {
    test('a send whose start trigger holds a model call and then posts a message: the busy button pressed during the call, then releasing it, posts no message', async () => {
        triggerWorld([llm('r'), say('posted by start trigger')], { type: 'start', withButton: false })
        const running = sendChat()
        await until(() => modelCalls.length >= 1, 'the start trigger\'s model call')

        abortChat()
        releaseCall(0)
        await settleMany(10)
        const posted = allMessageTexts().includes('posted by start trigger')
        const outputVariable = (theChat().scriptstate as Record<string, unknown>)['$r']
        await drain(running)

        expect.soft(outputVariable, 'the model call already running finished and set its output variable').toBe('model says')
        expect.soft(posted, 'the start trigger posted its next message').toBe(false)
    })

    test('guard: the same send without the busy button posts the message and generates', async () => {
        triggerWorld([llm('r'), say('posted by start trigger')], { type: 'start', withButton: false })
        const running = sendChat()
        await until(() => modelCalls.length >= 1, 'the start trigger\'s model call')

        releaseCall(0)
        await requestHeld(1)
        const posted = allMessageTexts().includes('posted by start trigger')
        const requests = held.length
        await drain(running)

        expect.soft(posted, 'the start trigger posted its next message').toBe(true)
        expect.soft(requests, 'the send\'s own request started').toBe(1)
    })
})

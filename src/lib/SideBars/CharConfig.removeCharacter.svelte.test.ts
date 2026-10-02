// @vitest-environment happy-dom

/**
 * `CharConfig.svelte`'s remove-character button acts on the character that was
 * confirmed, even when the character list changes while its confirmations are open.
 *
 * Mounts the real `CharConfig.svelte` (its child lists are stubbed) over the real
 * `removeChar` in `src/ts/characters.ts`, against a real `$state` database. The
 * alert confirm is a mock the test can hold open.
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
        MobileGUI: writable(false),
        CharConfigSubMenu: writable(6),
        hypaV3ModalOpen: writable(false),
        OpenRealmStore: writable(null),
        bookmarkListOpen: writable(false),
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
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
    tokenizeNum: vi.fn(async () => [] as number[]),
    tokenizeAccurate: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: alertErrorMock,
    alertToast: vi.fn(),
    alertInput: vi.fn(async () => ''),
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

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: runTriggerMock,
}) as unknown as typeof import('src/ts/process/triggers'))

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
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model', flags: [] })),
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
    getFileSrc: vi.fn(),
    createChatCopyName: vi.fn((name: string) => `${name} Copy`),
    reorderChatsKeepingCurrent: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
    translateHTML: vi.fn(),
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

vi.mock('src/lib/SideBars/LoreBook/LoreBookSetting.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/Scripts/RegexList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/SideBars/Scripts/TriggerList.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))
vi.mock('src/lib/Others/Help.svelte', () => ({ default: (_target: unknown) => ({ destroy: () => {} }) }))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { send, reroll, unReroll, runAutoMode, abortChat, isAutoModeActive, resetComposerActionsForTests, type ComposerActionsSource } from 'src/ts/process/composerActions.svelte'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import { processMultiCommand } from 'src/ts/process/command'
import { postChatFile } from 'src/ts/process/files/multisend'
import { runAutopilot } from 'src/ts/process/devToolActions'
import { makeRisuaiAPIV3 } from 'src/ts/plugins/apiV3/v3.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { removeChar } from 'src/ts/characters'
import CharConfig from 'src/lib/SideBars/CharConfig.svelte'
import { language } from 'src/lang'
import { isWriting } from 'src/ts/process/chatOrigin'
import { flushSync, mount, unmount } from 'svelte'
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

describe('CharConfig\'s remove-character button acts on the character that was confirmed', () => {
    test('a character inserted before the selected one while the confirmations are open: the selected character is trashed and its neighbour is not', async () => {
        installWorldWith([
            makeCharacter('char-x', [chatOf('x-chat', 'X chat')], { chatFolders: [] }),
            makeCharacter('char-y', [chatOf('y-chat', 'Y chat')], { chatFolders: [] }),
        ])
        selectedCharID.set(1)
        holdNextConfirm(async () => {
            DBState.db.characters.unshift(makeCharacter('char-z', [chatOf('z-chat', 'Z chat')], { chatFolders: [] }))
        })
        const target = document.createElement('div')
        document.body.appendChild(target)
        const instance = mount(CharConfig, { target, props: {} }) as unknown as Record<string, unknown>
        mountedComponents.push({ instance, target })
        flushSync()
        // The app closes the character settings once no character is selected, which
        // is what a removal does; the component reads the selected character and
        // cannot stay mounted past that.
        let closed = false
        const stopWatching = selectedCharID.subscribe((id) => {
            if (id < 0 && !closed) {
                closed = true
                void unmount(instance as never)
            }
        })
        const button = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.removeCharacter.trim())
        if (!button) {
            throw new Error('the remove-character button did not render')
        }

        button.click()
        await settleMany()
        stopWatching()
        const trashed = (id: string) => DBState.db.characters.find((c) => c.chaId === id)?.trashTime !== undefined

        expect.soft(trashed('char-y'), 'the confirmed character is trashed').toBe(true)
        expect.soft(trashed('char-x'), 'its neighbour is trashed').toBe(false)
        expect.soft(trashed('char-z'), 'the inserted character is trashed').toBe(false)
    })
})

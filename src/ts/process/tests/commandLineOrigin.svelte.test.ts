/**
 * The command line, `/multisend` and Post File act on the chat they were
 * started for, whichever chat, character or Home is on screen by the time each
 * step runs.
 *
 * Drives the REAL `sendChat` (`../index.svelte`), the composer
 * (`../composerActions.svelte`), the command line (`../command`), the trigger
 * engine (`../triggers`) and Post File (`../files/multisend`) over a real
 * `$state` database. Only the provider request, the scripts, Lua and the
 * modules they import are mocked. A held provider request lets a test switch
 * chat, character or Home at a known point of a generation; `/speak` and
 * `/input` are parked the same way, by holding their mocked function.
 *
 * The trigger button is driven by `clickTriggerButton`, which mirrors the chat
 * screen's handler (the chat on screen is read once, at the click); it does not
 * mount the component. Post File is driven by `clickPostFile`, which mirrors the
 * chat screen's caller: the composer record's key, and the objects it read that
 * chat through, are taken at the click and handed to `postChatFile`.
 *
 * `setDatabase` is a spy that also mirrors the real normaliser's reset of every
 * chat's `isStreaming`. Nothing here proves native (Tauri) file behaviour: the
 * Tauri rows run the same code with `isTauri` set and `downloadFile` mocked.
 *
 * Tests whose title starts with `guard:` pin behaviour that must be preserved.
 *
 * The parser is an identity stand-in here; `commandLineOriginParser.svelte.test.ts` runs the rows that need CBS.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database, Chat, Message, character } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`).
import 'src/ts/polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const setDatabaseMock = vi.hoisted(() => vi.fn())
const downloadFileMock = vi.hoisted(() => vi.fn(async (_name: string, _data: string) => {}))
const selectMultipleFileMock = vi.hoisted(() => vi.fn())
const platformBox = vi.hoisted(() => ({ isTauri: false }))
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
const interceptedSleeps = vi.hoisted(() => new Map<number, { latch: Promise<void>, markReached: () => void }>())

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
    default: { addHook: vi.fn(), sanitize: (v: string) => v },
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
        selIdState: { selId: 0 },
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})

// `setDatabase` mirrors the one effect of the real normaliser that a command
// write can reach: every chat's `isStreaming` is reset.
vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const live = stores.DBState as unknown as { db: { characters: Array<{ chatPage: number, chats: Array<{ isStreaming?: boolean }> }> } }
    const currentCharacter = () => live.db.characters[get(stores.selectedCharID)]
    setDatabaseMock.mockImplementation((d: unknown) => {
        const data = d as typeof live.db
        for (const char of data.characters) {
            for (const chat of char.chats ?? []) {
                chat.isStreaming = false
            }
        }
        live.db = data
    })
    return {
        appVer: '0.0.0',
        changeToPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        getDatabase: vi.fn(() => live.db),
        setDatabase: setDatabaseMock,
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
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: alertErrorMock,
    alertToast: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn(async () => 'hash'),
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
        getAuthorNoteDefaultText: vi.fn(() => ''),
        getPersonaPrompt: vi.fn(() => ''),
        getUserName: vi.fn(() => 'User'),
        getUserIcon: vi.fn(() => ''),
        checkPersonaBinded: vi.fn(() => false),
        pickHashRand: vi.fn(() => 0.5),
        replaceAsync: vi.fn(),
        asBuffer: vi.fn(),
        selectSingleFile: vi.fn(),
        selectMultipleFile: selectMultipleFileMock,
        BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
        parseKeyValue: (template: string) => {
            if (!template) return []
            const kv: [string, string][] = []
            for (const line of template.split('\n')) {
                const [key, value] = line.split('=')
                if (key && value) kv.push([key, value])
            }
            return kv
        },
        isLastCharPunctuation: isLastCharPunctuationMock,
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
        // A duration registered in `interceptedSleeps` parks the caller until
        // the test releases it; any other duration is a real timer.
        sleep: vi.fn((ms: number) => {
            const intercepted = interceptedSleeps.get(ms)
            if (intercepted) {
                intercepted.markReached()
                return intercepted.latch
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

vi.mock(import('src/ts/process/scripts'), async () => {
    return {
        processScript: vi.fn(async (_char: unknown, text: string) => text),
        processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
        risuChatParser: vi.fn((text: string) => text ?? ''),
    } as unknown as typeof import('src/ts/process/scripts')
})

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
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/process/embedding/addinfo'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    getInlayAssetBlob: vi.fn(async () => undefined),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
    postInlayAsset: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/models/modelString'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
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

// Lua is not part of this suite: wasmoon's loader cannot start under happy-dom.
vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
    runScripted: vi.fn(async () => undefined),
    runLuaButtonTrigger: vi.fn(async () => undefined),
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
    getModules: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(),
    isPlainHttpFileSrc: vi.fn(() => false),
    fetchNative: vi.fn(),
    downloadFile: downloadFileMock,
    checkCharOrder: vi.fn(),
    getFetchLogs: vi.fn(),
    aiWatermarkingLawApplies: vi.fn(() => false),
    getFileSrc: vi.fn(async () => ''),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: { providers: new Map() },
    getV2PluginAPIs: () => ({}),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: { providers: new Map(), chatOutput: new Set() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

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
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { send, runAutoMode, abortChat, resetComposerActionsForTests, type ComposerActionsSource } from 'src/ts/process/composerActions.svelte'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import { postChatFile } from 'src/ts/process/files/multisend'
import { runTrigger } from 'src/ts/process/triggers'
import { beginWork } from 'src/ts/process/chatOrigin'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { getCurrentCharacter, getCurrentChat } from 'src/ts/storage/database.svelte'
import { sayTTS } from 'src/ts/process/tts'
import { loadLoreBookV3Prompt } from 'src/ts/process/lorebook.svelte'
import { alertInput } from 'src/ts/alert'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'

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

function makeGroup(chaId: string, chats: Chat[]): CharacterFixture {
    return makeCharacter(chaId, chats, {
        type: 'group',
        characters: [],
        characterActive: [],
        characterTalks: [],
    })
}

function installDb(characters: CharacterFixture[]): void {
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
    } as unknown as Database
    selectedCharID.set(0)
}

/** One character, `char-0`, whose chat `chat-0` holds one user message, `Hi`. */
function installWorld(): void {
    installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])])])
}

/** Adds `chat-1`, holding `B last`, after `chat-0` of `char-0`. */
function addSecondChat(): void {
    DBState.db.characters[0].chats.push(makeChat('chat-1', [msg('char', 'B last')]))
}

/** Adds `char-1` with one chat, `other-0`, holding `O1` and `O2`; not selected. */
function addSecondCharacter(): void {
    DBState.db.characters.push(makeCharacter('char-1', [makeChat('other-0', [msg('user', 'O1'), msg('char', 'O2')])]))
}

/** Moves the chat on screen to `chat-1` of `char-0`. */
function switchToSecondChat(): void {
    DBState.db.characters[0].chatPage = 1
}

function goHome(): void {
    selectedCharID.set(-1)
}

function texts(chatIndex: number, charIndex = 0): string[] {
    return DBState.db.characters[charIndex].chats[chatIndex].message.map((m) => m.data)
}

function theChat(): Chat {
    return DBState.db.characters[0].chats[0]
}

function contents(): string[] {
    return texts(0)
}

function vars(chatIndex: number, charIndex = 0): Record<string, unknown> {
    return DBState.db.characters[charIndex].chats[chatIndex].scriptstate as Record<string, unknown>
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

type TriggerKind = 'start' | 'manual' | 'output' | 'input'

interface TriggerFixture {
    comment: string
    type: TriggerKind
    conditions: unknown[]
    effect: unknown[]
}

/** A `command` effect of the first trigger format, or a `v2Command` effect of the second. */
type CommandEffectFormat = 'command' | 'v2Command'

const COMMAND_EFFECT_FORMATS: CommandEffectFormat[] = ['command', 'v2Command']

function commandEffect(format: CommandEffectFormat, line: string): unknown {
    return format === 'command'
        ? { type: 'command', value: line }
        : { type: 'v2Command', indent: 0, valueType: 'value', value: line }
}

function trigger(comment: string, type: TriggerKind, effect: unknown[]): TriggerFixture {
    return { comment, type, conditions: [], effect }
}

function setTriggers(charIndex: number, ...triggers: TriggerFixture[]): void {
    ;(DBState.db.characters[charIndex] as unknown as { triggerscript: TriggerFixture[] }).triggerscript = triggers
}

function makeSource(): ComposerActionsSource {
    return { closeMenu: () => {} }
}

/**
 * Runs `onTickEnd` at the end of every generation the composer hands over,
 * after the generation has settled and before the next auto-mode tick starts:
 * the composer plays its send sound there when `playMessage` is on. Returns
 * the restore for the stubbed `Audio` and the original `playMessage`.
 */
function onEveryTickEnd(onTickEnd: () => void): () => void {
    const playMessage = DBState.db.playMessage
    const originalAudio = globalThis.Audio
    DBState.db.playMessage = true
    vi.stubGlobal('Audio', class {
        play(): Promise<void> {
            onTickEnd()
            return Promise.resolve()
        }
    })
    return () => {
        vi.stubGlobal('Audio', originalAudio)
        DBState.db.playMessage = playMessage
    }
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

/** Waits for `condition`, and reports whether it held instead of throwing. */
async function reaches(condition: () => boolean): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
        if (condition()) {
            return true
        }
        await settle()
    }
    return condition()
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

/**
 * Every provider request from now on returns a stream that already carries
 * `reply N` (N counts the requests) and stays open until the test closes it,
 * or `drain` does.
 */
function holdEveryRequest(): void {
    requestChatDataMock.mockImplementation(async (_arg: unknown, _mode: string, signal?: AbortSignal) => {
        const source = controlledStream()
        held.push({ signal, source })
        source.push(`reply ${held.length}`)
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

/** The prompt each provider request was built from, as text. */
function promptOf(callIndex: number): string {
    const arg = requestChatDataMock.mock.calls[callIndex]?.[0] as { formated?: unknown } | undefined
    return JSON.stringify(arg?.formated ?? null)
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

function settledOutcome<T>(promise: Promise<T>): Promise<T | Error> {
    return promise.then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

function makeLatch() {
    let release: () => void = () => {}
    const latch = new Promise<void>((res) => { release = res })
    let markReached: () => void = () => {}
    const reached = new Promise<void>((res) => { markReached = res })
    return { latch, release, reached, markReached }
}

/** The next `/speak` parks until `release`. */
function holdNextSpeak() {
    const { latch, release, reached, markReached } = makeLatch()
    vi.mocked(sayTTS).mockImplementationOnce(async () => { markReached(); await latch })
    return { release, reached }
}

/** The next prompt shown by `/input` parks until `release`, then answers `answer`. */
function holdNextInput(answer: string) {
    const { latch, release, reached, markReached } = makeLatch()
    vi.mocked(alertInput).mockImplementationOnce(async () => { markReached(); await latch; return answer })
    return { release, reached }
}

/** The next lorebook scan parks until `release`, then finds nothing. */
function holdNextScan() {
    const { latch, release, reached, markReached } = makeLatch()
    vi.mocked(loadLoreBookV3Prompt).mockImplementationOnce(async () => { markReached(); await latch; return { actives: [] } as never })
    return { release, reached }
}

/** A trigger `v2Wait` of `seconds` parks until `release`. */
function holdWait(seconds: number) {
    const { latch, release, reached, markReached } = makeLatch()
    interceptedSleeps.set(seconds * 1000, { latch, markReached })
    return { release, reached }
}

/**
 * The trigger button's click, as the chat screen's handler runs it: the chat
 * on screen is read once, at the click, and the run is registered against it.
 * This mirrors the handler; it does not mount it.
 */
async function clickTriggerButton(name: string): Promise<unknown> {
    const char = getCurrentCharacter()
    const chat = getCurrentChat()
    const workHandle = beginWork(char, chat)
    if (!workHandle) {
        throw new Error('the button could not begin work')
    }
    try {
        return await runTrigger(char as character, 'manual', { chat, manualName: name, origin: workHandle.origin })
    } finally {
        workHandle.end()
    }
}

/** A `.po` file with one entry per text, each ended by a blank line. */
function poFile(...texts: string[]): { name: string, data: Uint8Array } {
    const body = texts.map((text) => `msgid "${text}"\nmsgstr ""\n\n`).join('')
    return { name: 'job.po', data: new TextEncoder().encode(body) }
}

/**
 * The chat-screen caller of Post File: it takes the composer record's key and
 * the objects it read that chat through at the click, and hands both on.
 * `postChatFile` is called with the key as its second argument and the hint
 * `{owner, chat}` as its third: the chat the click was made in.
 */
function clickPostFile(query: string | { name: string, data: Uint8Array }): ReturnType<typeof postChatFile> {
    const char = getCurrentCharacter()
    const chat = getCurrentChat()
    const key = { chaId: char.chaId as string, chatId: chat.id as string }
    return postChatFile(query, key, { owner: char, chat })
}

const marks = { tracker: { character: [] as string[] } }

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    alertErrorMock.mockReset()
    downloadFileMock.mockReset()
    downloadFileMock.mockImplementation(async () => {})
    selectMultipleFileMock.mockReset()
    setDatabaseMock.mockClear()
    vi.mocked(loadLoreBookV3Prompt).mockClear()
    vi.mocked(sayTTS).mockReset()
    vi.mocked(alertInput).mockReset()
    vi.mocked(alertInput).mockImplementation(async () => '')
    platformBox.isTauri = false
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    interceptedSleeps.clear()
    held.length = 0
    resetLocalDraftsForTest()
    resetCharacterSaveMarksForTest()
    marks.tracker = { character: [] }
    installCharacterSaveMarks({ tracker: marks.tracker as unknown as toSaveType, schedule: () => {} })
    doingChat.set(false)
})

afterEach(() => {
    closeEveryHeldStream()
    resetComposerActionsForTests()
    resetCharacterSaveMarksForTest()
    selectedCharID.set(-1)
})

//#endregion

function installChat(messages: string[], extra: Record<string, unknown> = {}): void {
    installDb([makeCharacter('char-0', [makeChat('chat-0', messages.map((data) => msg('user', data, extra)))])])
}

describe('a pipe typed in the composer acts on the chat the take started from', () => {
    test('/speak x|/send hi posts hi to the take\'s chat when the chat on screen changes during /speak', async () => {
        installWorld()
        addSecondChat()
        const speak = holdNextSpeak()
        seedDraft('/speak x|/send hi')
        const sending = send(makeSource())
        await speak.reached
        switchToSecondChat()
        speak.release()
        await sending

        expect.soft(contents()).toEqual(['Hi', 'hi'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test('/speak x|/send hi posts hi to the take\'s chat and throws nothing when the user goes Home during /speak', async () => {
        installWorld()
        const speak = holdNextSpeak()
        seedDraft('/speak x|/send hi')
        const sending = send(makeSource())
        await speak.reached
        goHome()
        speak.release()
        const outcome = await settledOutcome(sending)

        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(contents()).toEqual(['Hi', 'hi'])
    })

    test('/multisend a|||b answers both segments in the take\'s chat when the chat on screen changes during the first generation', async () => {
        installWorld()
        addSecondChat()
        holdEveryRequest()
        seedDraft('/multisend a|||b')
        const sending = send(makeSource())
        await until(() => held.length >= 1, 'the first request')
        switchToSecondChat()
        held[0].source.close()
        await drain(sending)

        expect.soft(contents()).toEqual(['Hi', 'a', 'reply 1', 'b', 'reply 2'])
        expect.soft(texts(1)).toEqual(['B last'])
        expect.soft(requestChatDataMock).toHaveBeenCalledTimes(2)
        for (let i = 0; i < requestChatDataMock.mock.calls.length; i++) {
            expect.soft(promptOf(i), `the prompt of request ${i + 1}`).not.toContain('B last')
        }
    })

    test('/multisend a|||b posts and answers both segments in the take\'s chat when the user goes Home during the first generation', async () => {
        installWorld()
        holdEveryRequest()
        seedDraft('/multisend a|||b')
        const sending = send(makeSource())
        await until(() => held.length >= 1, 'the first request')
        goHome()
        held[0].source.close()
        const outcome = await settledOutcome(drain(sending))

        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(contents()).toEqual(['Hi', 'a', 'reply 1', 'b', 'reply 2'])
    })

    test.each([
        ['/setvar key=s v', { $s: 'v', $n: '1', $k: 'zero' }],
        ['/addvar key=n 2', { $n: '3', $k: 'zero' }],
    ])('%s writes the take\'s chat variables, not those of the chat on screen after a switch', async (command, expected) => {
        installWorld()
        addSecondChat()
        theChat().scriptstate = { $n: '1', $k: 'zero' }
        DBState.db.characters[0].chats[1].scriptstate = { $k: 'one' }
        const speak = holdNextSpeak()
        seedDraft(`/speak x|${command}`)
        const sending = send(makeSource())
        await speak.reached
        switchToSecondChat()
        speak.release()
        await sending

        expect.soft(vars(0)).toMatchObject(expected)
        expect.soft(vars(1)).toEqual({ $k: 'one' })
    })

    test('/getvar reads the take\'s chat variable, not that of the chat on screen after a switch', async () => {
        installWorld()
        addSecondChat()
        theChat().scriptstate = { $k: 'zero' }
        DBState.db.characters[0].chats[1].scriptstate = { $k: 'one' }
        const speak = holdNextSpeak()
        seedDraft('/speak x|/getvar key=k|/send {{pipe}}')
        const sending = send(makeSource())
        await speak.reached
        switchToSecondChat()
        speak.release()
        await sending

        expect.soft(contents()).toEqual(['Hi', 'zero'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test.each([
        '/send hi',
        '/sendas hi',
        '/comment note',
        '/cut 0',
        '/del 1',
        '/setvar key=k v',
        '/addvar key=k 1',
        '/multisend a',
    ])('%s marks the take\'s character for save when another character is on screen by then', async (command) => {
        installChat(['m0', 'm1', 'm2'])
        addSecondCharacter()
        mockReply('reply a')
        mockReply('reply a2')
        const speak = holdNextSpeak()
        seedDraft(`/speak x|${command}`)
        const sending = send(makeSource())
        await speak.reached
        selectedCharID.set(1)
        speak.release()
        await sending

        expect(marks.tracker.character).toContain('char-0')
    })

    test.each([
        '/setvar key=k v',
        '/send hi',
    ])('%s leaves the streaming flag of every chat as it was', async (command) => {
        installWorld()
        addSecondChat()
        DBState.db.characters[0].chats[1].isStreaming = true
        seedDraft(command)
        await send(makeSource())

        expect(DBState.db.characters[0].chats[1].isStreaming).toBe(true)
    })

    test('/send hi lands in the chat the take started from when a chat holding the same id is on screen by then', async () => {
        installWorld()
        const speak = holdNextSpeak()
        seedDraft('/speak x|/send hi')
        const sending = send(makeSource())
        await speak.reached
        DBState.db.characters[0].chats.push(makeChat('chat-0', [msg('char', 'B last')]))
        switchToSecondChat()
        speak.release()
        await sending

        expect.soft(texts(0)).toEqual(['Hi', 'hi'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test('guard: an unknown command is sent as a message', async () => {
        installWorld()
        mockReply('reply')
        seedDraft('/nosuchcommand foo')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', '/nosuchcommand foo', 'reply'])
    })
})

describe('a pipe whose chat is gone stops', () => {
    test('a composer pipe posts nothing and runs no later command when its chat is deleted during /speak', async () => {
        installWorld()
        addSecondChat()
        const speak = holdNextSpeak()
        seedDraft('/speak x|/send hi|/setvar key=k v')
        const sending = send(makeSource())
        await speak.reached
        DBState.db.characters[0].chats.splice(0, 1)
        speak.release()
        await sending

        expect.soft(texts(0)).toEqual(['B last'])
        expect.soft(vars(0)).toEqual({})
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
    })

    test.each(COMMAND_EFFECT_FORMATS)('a %s pipe of a trigger button posts nothing and runs no later command when its chat is deleted during /speak', async (format) => {
        installWorld()
        addSecondChat()
        setTriggers(0, trigger('t', 'manual', [commandEffect(format, '/speak x|/send hi|/setvar key=k v')]))
        const speak = holdNextSpeak()
        const run = clickTriggerButton('t')
        await speak.reached
        DBState.db.characters[0].chats.splice(0, 1)
        speak.release()
        const outcome = await settledOutcome(run)

        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(texts(0)).toEqual(['B last'])
        expect.soft(vars(0)).toEqual({})
    })
})

describe('the busy button stops a pipe', () => {
    test('pressed during /speak in /speak x|/multisend a|||b, it puts the text back, posts nothing and makes no request', async () => {
        installWorld()
        mockReply('reply a')
        mockReply('reply b')
        const speak = holdNextSpeak()
        seedDraft('/speak x|/multisend a|||b')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect.soft(contents()).toEqual(['Hi'])
        expect.soft(draftText()).toBe('/speak x|/multisend a|||b')
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
    })

    test('guard: pressed during the first segment\'s generation in /multisend a|||b|||c, it posts no further segment and leaves the text box empty', async () => {
        installWorld()
        holdEveryRequest()
        seedDraft('/multisend a|||b|||c')
        const sending = send(makeSource())
        await until(() => held.length >= 1, 'the first request')
        abortChat()
        await drain(sending)

        expect.soft(contents()).toContain('a')
        expect.soft(contents()).not.toContain('b')
        expect.soft(contents()).not.toContain('c')
        expect.soft(draftText()).toBe('')
        expect.soft(get(doingChat)).toBe(false)
    })

    test.each(COMMAND_EFFECT_FORMATS)('pressed during /speak in a start trigger\'s %s pipe, it posts nothing more', async (format) => {
        installWorld()
        holdEveryRequest()
        setTriggers(0, trigger('s', 'start', [commandEffect(format, '/speak x|/send y')]))
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await drain(sending)

        expect(contents()).not.toContain('y')
    })

    test.each(COMMAND_EFFECT_FORMATS)('pressed during /speak in an output trigger\'s %s pipe, it posts nothing more', async (format) => {
        installWorld()
        holdEveryRequest()
        setTriggers(0, trigger('o', 'output', [commandEffect(format, '/speak x|/send y')]))
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await until(() => held.length >= 1, 'the first request')
        held[0].source.close()
        await speak.reached
        abortChat()
        speak.release()
        await drain(sending)

        expect(contents()).not.toContain('y')
    })

    test.each(COMMAND_EFFECT_FORMATS)('pressed during /speak in the composer\'s input trigger\'s %s pipe, it puts the text back and posts nothing more', async (format) => {
        installWorld()
        holdEveryRequest()
        setTriggers(0, trigger('i', 'input', [commandEffect(format, '/speak x|/send y')]))
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await drain(sending)

        expect.soft(contents()).toEqual(['Hi'])
        expect.soft(draftText()).toBe('hello')
    })

    test.each([
        ['runtrigger', { type: 'runtrigger', value: 'inner' }],
        ['v2RunTrigger', { type: 'v2RunTrigger', indent: 0, target: 'inner' }],
    ])('pressed during /speak in a trigger run by %s from a start trigger, it posts nothing more', async (_name, runInner) => {
        installWorld()
        holdEveryRequest()
        setTriggers(0,
            trigger('s', 'start', [runInner]),
            trigger('inner', 'manual', [commandEffect('command', '/speak x|/send y')]),
        )
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await drain(sending)

        expect(contents()).not.toContain('y')
    })

    test('guard: a trigger button\'s pipe has no cancel, so /speak x|/send y still posts y after the press', async () => {
        installWorld()
        setTriggers(0, trigger('t', 'manual', [commandEffect('command', '/speak x|/send y')]))
        const speak = holdNextSpeak()
        const run = clickTriggerButton('t')
        await speak.reached
        abortChat()
        speak.release()
        await run

        expect(contents()).toEqual(['Hi', 'y'])
    })
})

describe('a trigger run\'s command line acts on the run\'s chat', () => {
    test.each(COMMAND_EFFECT_FORMATS)('a button\'s %s pipe /speak x|/send hi posts hi to the button\'s chat when the chat on screen changes during /speak', async (format) => {
        installWorld()
        addSecondChat()
        setTriggers(0, trigger('t', 'manual', [commandEffect(format, '/speak x|/send hi')]))
        const speak = holdNextSpeak()
        const run = clickTriggerButton('t')
        await speak.reached
        switchToSecondChat()
        speak.release()
        await run

        expect.soft(contents()).toEqual(['Hi', 'hi'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test.each(COMMAND_EFFECT_FORMATS)('a start trigger\'s %s /send hi, run after an awaited step, posts hi to the send\'s chat when the chat on screen changed in between', async (format) => {
        installWorld()
        addSecondChat()
        holdEveryRequest()
        setTriggers(0, trigger('s', 'start', [
            { type: 'v2Wait', indent: 0, valueType: 'value', value: '7' },
            commandEffect(format, '/send hi'),
        ]))
        const wait = holdWait(7)
        seedDraft('hello')
        const sending = send(makeSource())
        await wait.reached
        switchToSecondChat()
        wait.release()
        await drain(sending)

        expect.soft(contents()).toContain('hi')
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test.each(COMMAND_EFFECT_FORMATS)('a button\'s %s pipe /speak x|/send hi posts hi to the button\'s chat and throws nothing when the user goes Home during /speak', async (format) => {
        installWorld()
        setTriggers(0, trigger('t', 'manual', [commandEffect(format, '/speak x|/send hi')]))
        const speak = holdNextSpeak()
        const run = clickTriggerButton('t')
        await speak.reached
        goHome()
        speak.release()
        const outcome = await settledOutcome(run)

        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(contents()).toEqual(['Hi', 'hi'])
    })

    test('guard: a run whose chat id gains a second holder before its command effect stops before that effect', async () => {
        installWorld()
        setTriggers(0, trigger('t', 'manual', [
            { type: 'v2Wait', indent: 0, valueType: 'value', value: '7' },
            commandEffect('command', '/send hi'),
        ]))
        const wait = holdWait(7)
        const run = clickTriggerButton('t')
        await wait.reached
        DBState.db.characters[0].chats.push(makeChat('chat-0', [msg('char', 'B last')]))
        wait.release()
        await run

        expect.soft(texts(0)).toEqual(['Hi'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test('/trigger t typed in the composer after /speak runs t on the take\'s chat when the chat on screen changes', async () => {
        installWorld()
        addSecondChat()
        setTriggers(0, trigger('t', 'manual', [{ type: 'setvar', var: 'ran', operator: '=', value: '1' }]))
        const speak = holdNextSpeak()
        seedDraft('/speak x|/trigger t')
        const sending = send(makeSource())
        await speak.reached
        switchToSecondChat()
        speak.release()
        await sending

        expect.soft(vars(0)).toMatchObject({ $ran: '1' })
        expect.soft(vars(1)).toEqual({})
    })
})

describe('a trigger button\'s /multisend and the composer\'s window', () => {
    const buttonMultisend = trigger('btn', 'manual', [commandEffect('command', '/multisend a|||b')])

    test('a button\'s /multisend posts both segments with no request and leaves the flag free while the take is held in its input trigger', async () => {
        installWorld()
        setTriggers(0, trigger('in', 'input', [commandEffect('command', '/speak hold')]), buttonMultisend)
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await speak.reached
        await clickTriggerButton('btn')

        expect.soft(contents()).toEqual(['Hi', 'a', 'b'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(get(doingChat)).toBe(false)

        mockReply('reply hello')
        speak.release()
        await sending

        expect.soft(contents()).toEqual(['Hi', 'a', 'b', 'hello', 'reply hello'])
        expect.soft(requestChatDataMock).toHaveBeenCalledTimes(1)
    })

    test('a button\'s /multisend posts both segments with no request and leaves the flag free while the take is at its / stage', async () => {
        installWorld()
        setTriggers(0, buttonMultisend)
        const speak = holdNextSpeak()
        seedDraft('/speak hold|/pass x')
        const sending = send(makeSource())
        await speak.reached
        await clickTriggerButton('btn')

        expect.soft(contents()).toEqual(['Hi', 'a', 'b'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(get(doingChat)).toBe(false)

        speak.release()
        await sending
    })

    test('a button\'s /multisend between two auto-mode ticks posts without replies and the next tick runs', async () => {
        installWorld()
        setTriggers(0, buttonMultisend)
        holdEveryRequest()
        let clicked: Promise<unknown> | null = null
        // The click starts inside the tick-end callback: the composer's window is open
        // for the whole auto-mode run and no send holds the flag at that point.
        const restore = onEveryTickEnd(() => {
            clicked ??= clickTriggerButton('btn')
        })
        let seen: string[]
        try {
            const auto = runAutoMode(makeSource())
            await until(() => held.length >= 1, 'the first tick\'s request')
            held[0].source.close()
            await until(() => held.length >= 2, 'a second request')
            seen = contents().slice(0, 4)
            abortChat()
            await drain(auto)
            await clicked
        } finally {
            restore()
        }

        expect(seen).toEqual(['Hi', 'reply 1', 'a', 'b'])
    })

    test('guard: the take\'s input trigger\'s own /multisend a|||b answers both segments, then the take\'s message is appended and answered', async () => {
        installWorld()
        setTriggers(0, trigger('in', 'input', [commandEffect('command', '/multisend a|||b')]))
        mockReply('reply a')
        mockReply('reply b')
        mockReply('reply hello')
        seedDraft('hello')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', 'a', 'reply a', 'b', 'reply b', 'hello', 'reply hello'])
    })

    test('guard: /multisend a|||b typed in the composer answers both segments', async () => {
        installWorld()
        mockReply('reply a')
        mockReply('reply b')
        seedDraft('/multisend a|||b')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', 'a', 'reply a', 'b', 'reply b'])
    })

    test('a button\'s /multisend in another chat does not stop the busy button putting the take\'s text back', async () => {
        installWorld()
        addSecondChat()
        setTriggers(0, trigger('btn', 'manual', [commandEffect('command', '/multisend p|||q')]))
        const speak = holdNextSpeak()
        seedDraft('/speak x|/pass y')
        const sending = send(makeSource())
        await speak.reached
        switchToSecondChat()
        await clickTriggerButton('btn')
        abortChat()
        speak.release()
        await sending

        expect.soft(draftText()).toBe('/speak x|/pass y')
        expect.soft(texts(1)).toEqual(['B last', 'p', 'q'])
    })

    test('guard: a button\'s /multisend answers both segments when no send holds the flag and no send is starting', async () => {
        installWorld()
        setTriggers(0, buttonMultisend)
        mockReply('reply a')
        mockReply('reply b')
        await clickTriggerButton('btn')

        expect(contents()).toEqual(['Hi', 'a', 'reply a', 'b', 'reply b'])
    })
})

describe('Post File acts on the chat it was clicked in', () => {
    test('every entry and reply lands in the chat where Post File was clicked when the file dialog closes after a switch', async () => {
        installWorld()
        addSecondChat()
        mockReply('r1')
        mockReply('r2')
        const dialog = makeLatch()
        selectMultipleFileMock.mockImplementationOnce(async () => {
            dialog.markReached()
            await dialog.latch
            return [poFile('one', 'two')]
        })
        const job = clickPostFile('')
        await dialog.reached
        switchToSecondChat()
        dialog.release()
        await job

        expect.soft(contents()).toEqual(['Hi', 'one', 'r1', 'two', 'r2'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test('entry 2 and its reply land in the click chat, and entry 1 records its own reply, when the chat on screen changes during entry 1', async () => {
        installWorld()
        addSecondChat()
        holdEveryRequest()
        const job = clickPostFile(poFile('one', 'two'))
        await until(() => held.length >= 1, 'the first request')
        switchToSecondChat()
        held[0].source.close()
        await drain(job)

        const downloaded = String(downloadFileMock.mock.calls.at(-1)?.[1] ?? '')
        expect.soft(contents()).toEqual(['Hi', 'one', 'reply 1', 'two', 'reply 2'])
        expect.soft(texts(1)).toEqual(['B last'])
        expect.soft(downloaded).toContain('msgstr ""\n"reply 1"')
        expect.soft(downloaded).not.toContain('B last')
    })

    test('the job continues in the click chat and downloads a file when the user goes Home during entry 1', async () => {
        installWorld()
        holdEveryRequest()
        const job = clickPostFile(poFile('one', 'two'))
        await until(() => held.length >= 1, 'the first request')
        goHome()
        held[0].source.close()
        const outcome = await settledOutcome(drain(job))

        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(contents()).toEqual(['Hi', 'one', 'reply 1', 'two', 'reply 2'])
        expect.soft(downloadFileMock).toHaveBeenCalledTimes(1)
    })

    test('on Tauri, a chat switch during the per-entry download leaves the chat switched to with its own messages and id', async () => {
        platformBox.isTauri = true
        installWorld()
        addSecondChat()
        mockReply('r1')
        mockReply('r2')
        mockReply('r3')
        const download = makeLatch()
        downloadFileMock.mockImplementationOnce(async () => {
            download.markReached()
            await download.latch
        })
        const job = clickPostFile(poFile('one', 'two'))
        await download.reached
        switchToSecondChat()
        download.release()
        await settledOutcome(job)

        const ids = DBState.db.characters[0].chats.map((chat) => chat.id)
        expect.soft(ids).toEqual(['chat-0', 'chat-1'])
        expect.soft(texts(1)).toEqual(['B last'])
        expect.soft(contents()).toEqual(['Hi', 'one', 'r1', 'two', 'r2'])
    })

    test('guard: the job stops and downloads the built file when the click chat is deleted during an entry\'s generation', async () => {
        installWorld()
        addSecondChat()
        holdEveryRequest()
        const job = clickPostFile(poFile('one', 'two', 'three'))
        await until(() => held.length >= 1, 'the first request')
        held[0].source.close()
        await until(() => held.length >= 2, 'the second request')
        DBState.db.characters[0].chats.splice(0, 1)
        held[1].source.close()
        await drain(job)

        const downloaded = String(downloadFileMock.mock.calls.at(-1)?.[1] ?? '')
        expect.soft(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect.soft(texts(0)).toEqual(['B last'])
        expect.soft(downloadFileMock).toHaveBeenCalledTimes(1)
        expect.soft(downloaded).toContain('"reply 1"')
        expect.soft(downloaded).not.toContain('three')
    })

    test('on Tauri, the job stops before entry 2 and downloads the built file when the click chat is deleted during entry 1\'s download', async () => {
        platformBox.isTauri = true
        installWorld()
        addSecondChat()
        mockReply('r1')
        mockReply('r2')
        mockReply('r3')
        const download = makeLatch()
        downloadFileMock.mockImplementationOnce(async () => {
            download.markReached()
            await download.latch
        })
        const job = clickPostFile(poFile('one', 'two', 'three'))
        await download.reached
        const removed = DBState.db.characters[0].chats[0]
        DBState.db.characters[0].chats.splice(0, 1)
        download.release()
        await settledOutcome(job)

        const downloaded = String(downloadFileMock.mock.calls.at(-1)?.[1] ?? '')
        expect.soft(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect.soft(texts(0)).toEqual(['B last'])
        expect.soft(downloaded).toContain('"r1"')
        expect.soft(downloaded).not.toContain('three')
        expect.soft(removed.message.map((m) => m.data)).toEqual(['Hi', 'one', 'r1'])
    })

    test('nothing is sent or downloaded when the click chat is deleted while the file dialog is open', async () => {
        installWorld()
        addSecondChat()
        const dialog = makeLatch()
        selectMultipleFileMock.mockImplementationOnce(async () => {
            dialog.markReached()
            await dialog.latch
            return [poFile('one', 'two')]
        })
        const job = clickPostFile('')
        await dialog.reached
        DBState.db.characters[0].chats.splice(0, 1)
        dialog.release()
        await settledOutcome(job)

        expect.soft(texts(0)).toEqual(['B last'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(downloadFileMock).not.toHaveBeenCalled()
    })

    test('a #. Note = line becomes Note: x with no prefix', async () => {
        installWorld()
        mockReply('r')
        const file = { name: 'job.po', data: new TextEncoder().encode('#. Note = x\nmsgid "one"\nmsgstr ""\n\n') }
        await clickPostFile(file)

        expect(contents()[1]).toBe('Note: x\none')
    })

    test('a job with more than 100 lines before its entry is not cut off', async () => {
        installWorld()
        mockReply('r')
        const comments = Array.from({ length: 120 }, (_, i) => `# c${i}`).join('\n')
        const file = { name: 'job.po', data: new TextEncoder().encode(`${comments}\nmsgid "one"\nmsgstr ""\n\n`) }
        await clickPostFile(file)

        const downloaded = String(downloadFileMock.mock.calls.at(-1)?.[1] ?? '')
        expect.soft(contents()).toContain('one')
        expect.soft(downloaded).toContain('# c119')
    })

    test('guard: on Tauri, a composer Send that opens its window between two entries makes the job push nothing more and stop', async () => {
        platformBox.isTauri = true
        installWorld()
        setTriggers(0, trigger('in', 'input', [commandEffect('command', '/speak hold')]))
        mockReply('reply one')
        const betweenEntries = makeLatch()
        downloadFileMock.mockImplementationOnce(async () => {
            betweenEntries.markReached()
            await betweenEntries.latch
        })
        const job = clickPostFile(poFile('one', 'two', 'three'))
        await betweenEntries.reached
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await speak.reached

        betweenEntries.release()
        await job
        const messagesAfterJob = contents()
        const requestsAfterJob = requestChatDataMock.mock.calls.length
        speak.release()
        await sending

        expect.soft(messagesAfterJob).toEqual(['Hi', 'one', 'reply one'])
        expect.soft(requestsAfterJob).toBe(1)
    })
})

describe('commands edit exactly the messages and variables they name', () => {
    test('/cut 1 removes message 1', async () => {
        installChat(['m0', 'm1', 'm2'])
        seedDraft('/cut 1')
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm2'])
    })

    test('/cut -1 removes the last message', async () => {
        installChat(['m0', 'm1', 'm2'])
        seedDraft('/cut -1')
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm1'])
    })

    test('/cut 1-3 removes the messages slice(1, 3) selects and keeps the rest', async () => {
        installChat(['m0', 'm1', 'm2', 'm3', 'm4'])
        seedDraft('/cut 1-3')
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm3', 'm4'])
    })

    test('/del 2 removes the last two messages', async () => {
        installChat(['m0', 'm1', 'm2', 'm3', 'm4'])
        seedDraft('/del 2')
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm1', 'm2'])
    })

    test('/del 0 removes nothing', async () => {
        installChat(['m0', 'm1', 'm2', 'm3', 'm4'])
        seedDraft('/del 0')
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
    })

    test('guard: /cut with a message id removes that message', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-0', [
            msg('user', 'm0', { chatId: 'x0' }),
            msg('user', 'm1', { chatId: 'x1' }),
            msg('user', 'm2', { chatId: 'x2' }),
        ])])])
        seedDraft('/cut x1')
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm2'])
    })

    test('/getvar on an unset variable pipes null and throws nothing', async () => {
        installChat(['m0'])
        seedDraft('/getvar key=unset|/send {{pipe}}')
        const outcome = await settledOutcome(send(makeSource()))

        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(contents()).toEqual(['m0', 'null'])
    })

    test('/addvar on an unset variable stores the added value', async () => {
        installChat(['m0'])
        seedDraft('/addvar key=unset 5')
        await send(makeSource())

        expect(vars(0)).toMatchObject({ $unset: '5' })
    })

    test('/comment in an empty chat throws nothing and lets the next command run', async () => {
        installChat([])
        seedDraft('/comment x|/setvar key=k v')
        const outcome = await settledOutcome(send(makeSource()))

        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(vars(0)).toMatchObject({ $k: 'v' })
    })

    test('/trigger t in a group chat passes the pipe on', async () => {
        installDb([makeGroup('char-0', [makeChat('chat-0', [msg('user', 'Hi')])])])
        seedDraft('/pass hello|/trigger t|/send {{pipe}}')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', 'hello'])
    })

    test('a trigger that runs /trigger on itself runs a bounded number of times', async () => {
        // The cap only ends a run that ignores the depth rule: a nested run past ten
        // levels runs nothing, so the count stays a little above ten.
        const RUN_CAP = 60
        const RUN_BOUND = 12
        installWorld()
        setTriggers(0, trigger('self', 'manual', [commandEffect('command', '/speak x|/trigger self')]))
        let runs = 0
        vi.mocked(sayTTS).mockImplementation(async () => {
            runs++
            if (runs >= RUN_CAP) {
                throw new Error('the trigger recursed past the cap')
            }
        })
        seedDraft('/trigger self')
        await settledOutcome(send(makeSource()))

        expect(runs).toBeLessThanOrEqual(RUN_BOUND)
    })
})

const UUID_IDS = [
    'aaaaaaaa-1111-4222-8333-000000000001',
    'bbbbbbbb-2222-4222-8333-000000000002',
    'cccccccc-3333-4222-8333-000000000003',
]

function installUuidChat(): void {
    installDb([makeCharacter('char-0', [makeChat('chat-0', UUID_IDS.map((id, i) => msg('user', `m${i}`, { chatId: id })))])])
}

describe('the command line acts on the take\'s character and chat for every command', () => {
    test('/speak x passes the take\'s character to sayTTS when another character is on screen by then', async () => {
        installWorld()
        addSecondCharacter()
        const input = holdNextInput('')
        seedDraft('/input q|/speak x')
        const sending = send(makeSource())
        await input.reached
        selectedCharID.set(1)
        input.release()
        await sending

        const spoken = vi.mocked(sayTTS).mock.calls[0]?.[0] as { chaId?: string } | undefined
        expect(spoken?.chaId).toBe('char-0')
    })

    test('/test_lorebook scans the take\'s chat when the chat on screen changes before it runs', async () => {
        installWorld()
        addSecondChat()
        const input = holdNextInput('')
        seedDraft('/input q|/test_lorebook')
        const sending = send(makeSource())
        await input.reached
        switchToSecondChat()
        input.release()
        await sending

        const subject = vi.mocked(loadLoreBookV3Prompt).mock.calls[0]?.[0] as { resolve(): { chat: { id: string } } | null } | undefined
        expect(subject?.resolve()?.chat.id).toBe('chat-0')
    })

    test.each([
        ['/sendas y', ['m0', 'm1', 'm2', 'y']],
        ['/comment y', ['m0', 'm1', 'm2<Comment>\ny\n</Comment>']],
        ['/cut 0', ['m1', 'm2']],
        ['/del 1', ['m0', 'm1']],
    ])('%s changes the take\'s chat and leaves the chat on screen alone after a switch', async (command, expected) => {
        installChat(['m0', 'm1', 'm2'])
        DBState.db.characters[0].chats.push(makeChat('chat-1', [msg('user', 'B1'), msg('user', 'B2'), msg('user', 'B3')]))
        const speak = holdNextSpeak()
        seedDraft(`/speak x|${command}`)
        const sending = send(makeSource())
        await speak.reached
        switchToSecondChat()
        speak.release()
        await sending

        expect.soft(contents()).toEqual(expected)
        expect.soft(texts(1)).toEqual(['B1', 'B2', 'B3'])
    })
})

describe('a pipe whose chat is gone ends with an observable step and leaves no trace', () => {
    const PIPE = '/speak x|/send hi|/setvar key=k v|/multisend z'

    test('a composer pipe makes no request and writes nothing to the detached chat when its chat is deleted during /speak', async () => {
        installWorld()
        addSecondChat()
        const detached = DBState.db.characters[0].chats[0]
        const speak = holdNextSpeak()
        seedDraft(PIPE)
        const sending = send(makeSource())
        await speak.reached
        DBState.db.characters[0].chats.splice(0, 1)
        speak.release()
        await sending

        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(detached.message.map((m) => m.data)).toEqual(['Hi'])
        expect.soft(detached.scriptstate).toEqual({})
        expect.soft(texts(0)).toEqual(['B last'])
    })

    test.each(COMMAND_EFFECT_FORMATS)('a %s pipe of a trigger button makes no request and writes nothing to the detached chat when its chat is deleted during /speak', async (format) => {
        installWorld()
        addSecondChat()
        const detached = DBState.db.characters[0].chats[0]
        setTriggers(0, trigger('t', 'manual', [commandEffect(format, PIPE)]))
        const speak = holdNextSpeak()
        const run = clickTriggerButton('t')
        await speak.reached
        DBState.db.characters[0].chats.splice(0, 1)
        speak.release()
        const outcome = await settledOutcome(run)

        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(detached.message.map((m) => m.data)).toEqual(['Hi'])
        expect.soft(detached.scriptstate).toEqual({})
        expect.soft(texts(0)).toEqual(['B last'])
    })
})

describe('the busy button and what the take\'s own pipe has already written', () => {
    test('pressed during /speak after /send x, it keeps x, leaves the composer empty and runs no later command', async () => {
        installWorld()
        const speak = holdNextSpeak()
        seedDraft('/send x|/speak y|/send z')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect.soft(contents()).toEqual(['Hi', 'x'])
        expect.soft(draftText()).toBe('')
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
    })

    test('pressed during /speak after /setvar, it keeps the variable and leaves the composer empty', async () => {
        installWorld()
        const speak = holdNextSpeak()
        seedDraft('/setvar key=k v|/speak y')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect.soft(draftText()).toBe('')
        expect.soft(vars(0)).toMatchObject({ $k: 'v' })
    })

    test('guard: pressed during /speak in the input trigger\'s pipe after its /send, it puts the text back and the trigger\'s write stays', async () => {
        installWorld()
        setTriggers(0, trigger('i', 'input', [commandEffect('command', '/send t|/speak x')]))
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect.soft(contents()).toEqual(['Hi', 't'])
        expect.soft(draftText()).toBe('hello')
    })

    // A trigger button's post never counts as the take's own pipe having written.
    test('a button\'s /multisend p|||q in the take\'s own chat during its / stage does not stop the busy button putting the text back', async () => {
        installWorld()
        setTriggers(0, trigger('btn', 'manual', [commandEffect('command', '/multisend p|||q')]))
        const speak = holdNextSpeak()
        seedDraft('/speak x|/pass y')
        const sending = send(makeSource())
        await speak.reached
        await clickTriggerButton('btn')
        abortChat()
        speak.release()
        await sending

        expect.soft(draftText()).toBe('/speak x|/pass y')
        expect.soft(contents()).toEqual(['Hi', 'p', 'q'])
    })
})

describe('window ownership through nested runs', () => {
    // Work nested under the take's input trigger or its / stage owns the composer's
    // window, so a /multisend there answers each segment.
    test.each([
        ['runtrigger', { type: 'runtrigger', value: 'inner' }],
        ['v2RunTrigger', { type: 'v2RunTrigger', indent: 0, target: 'inner' }],
    ])('guard: a trigger run by %s from the take\'s input trigger answers a /multisend\'s segments', async (_name, runInner) => {
        installWorld()
        setTriggers(0,
            trigger('in', 'input', [runInner]),
            trigger('inner', 'manual', [commandEffect('command', '/multisend a|||b')]),
        )
        mockReply('reply a')
        mockReply('reply b')
        mockReply('reply hello')
        seedDraft('hello')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', 'a', 'reply a', 'b', 'reply b', 'hello', 'reply hello'])
    })

    test('guard: a /trigger t in the take\'s / stage whose trigger runs /multisend a|||b answers both segments', async () => {
        installWorld()
        setTriggers(0, trigger('t', 'manual', [commandEffect('command', '/multisend a|||b')]))
        mockReply('reply a')
        mockReply('reply b')
        seedDraft('/trigger t')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', 'a', 'reply a', 'b', 'reply b'])
    })

    test('a /trigger t in a button\'s pipe whose trigger runs /multisend a|||b posts without replies while the window is open', async () => {
        installWorld()
        setTriggers(0,
            trigger('in', 'input', [commandEffect('command', '/speak hold')]),
            trigger('btn', 'manual', [commandEffect('command', '/trigger t')]),
            trigger('t', 'manual', [commandEffect('command', '/multisend a|||b')]),
        )
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await speak.reached
        await clickTriggerButton('btn')

        expect.soft(contents()).toEqual(['Hi', 'a', 'b'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(get(doingChat)).toBe(false)

        mockReply('reply hello')
        speak.release()
        await sending
    })
})

describe('Post File with a duplicated id, no key, an emptied chat and a character switch', () => {
    test('guard: every entry and reply lands in the chat Post File was clicked in when another chat holds the same id', async () => {
        installWorld()
        DBState.db.characters[0].chats.push(makeChat('chat-0', [msg('char', 'B last')]))
        mockReply('r1')
        mockReply('r2')
        await clickPostFile(poFile('one', 'two'))

        expect.soft(texts(0)).toEqual(['Hi', 'one', 'r1', 'two', 'r2'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test('entry 2 and its reply land in the chat Post File was clicked in when the chat on screen changes to the other holder of its id during entry 1', async () => {
        installWorld()
        DBState.db.characters[0].chats.push(makeChat('chat-0', [msg('char', 'B last')]))
        holdEveryRequest()
        const job = clickPostFile(poFile('one', 'two'))
        await until(() => held.length >= 1, 'the first request')
        switchToSecondChat()
        held[0].source.close()
        await drain(job)

        expect.soft(texts(0)).toEqual(['Hi', 'one', 'reply 1', 'two', 'reply 2'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test.each([undefined, null])('a .po file posted with the key %s sends and downloads nothing', async (key) => {
        installWorld()
        mockReply('r1')
        await postChatFile(poFile('one'), key)

        expect.soft(contents()).toEqual(['Hi'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(downloadFileMock).not.toHaveBeenCalled()
    })

    test('an entry whose chat has no messages after its send records an empty msgstr, and the job continues and downloads', async () => {
        installWorld()
        setTriggers(0, trigger('cut', 'output', [
            { type: 'v2CutChat', indent: 0, startType: 'value', start: '0', endType: 'value', end: '0' },
        ]))
        mockReply('r1')
        mockReply('r2')
        const job = clickPostFile(poFile('one', 'two'))
        const outcome = await settledOutcome(job)

        const downloaded = String(downloadFileMock.mock.calls.at(-1)?.[1] ?? '')
        expect.soft(outcome).not.toBeInstanceOf(Error)
        expect.soft(downloadFileMock).toHaveBeenCalledTimes(1)
        expect.soft(downloaded).toContain('msgid "one"\nmsgstr ""\n\n')
        expect.soft(downloaded).toContain('msgid "two"')
    })

    test('on Tauri, an entry pushed after a character switch marks the clicked character for save', async () => {
        platformBox.isTauri = true
        installWorld()
        addSecondCharacter()
        mockReply('r1')
        holdEveryRequest()
        const download = makeLatch()
        downloadFileMock.mockImplementationOnce(async () => {
            download.markReached()
            await download.latch
        })
        const job = clickPostFile(poFile('one', 'two'))
        await download.reached
        marks.tracker.character.length = 0
        selectedCharID.set(1)
        download.release()
        await until(() => held.length >= 1, 'the second entry\'s request')

        expect(marks.tracker.character).toContain('char-0')
        await drain(job)
    })
})

describe('the edge forms of /cut and /del, and other command results', () => {
    test('/cut with a uuid message id removes exactly that message', async () => {
        installUuidChat()
        seedDraft(`/cut ${UUID_IDS[1]}`)
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm2'])
    })

    test('/pass hello|/trigger t|/send {{pipe}} in a character\'s chat posts hello', async () => {
        installWorld()
        setTriggers(0, trigger('t', 'manual', [{ type: 'setvar', var: 'ran', operator: '=', value: '1' }]))
        seedDraft('/pass hello|/trigger t|/send {{pipe}}')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', 'hello'])
    })

    test.each([
        ['/cut -0', ['m1', 'm2']],
        ['/cut 9', ['m0', 'm1', 'm2']],
        ['/cut 3-1', ['m0', 'm1', 'm2']],
        ['/cut 1 - 2', ['m0', 'm2']],
        ['/cut 2-', ['m0', 'm1', 'm2']],
    ])('%s on three messages leaves the expected messages', async (command, expected) => {
        installChat(['m0', 'm1', 'm2'])
        seedDraft(command)
        await send(makeSource())

        expect(contents()).toEqual(expected)
    })

    // A start below the chat's first message must not fall back to message 0.
    test('guard: /cut -5 on three messages removes nothing', async () => {
        installChat(['m0', 'm1', 'm2'])
        seedDraft('/cut -5')
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm1', 'm2'])
    })

    test.each([
        ['/del 9', []],
        ['/del 4', []],
        ['/del -1', ['m0', 'm1', 'm2']],
        ['/del 2abc', ['m0', 'm1', 'm2']],
    ])('%s on three messages leaves the expected messages', async (command, expected) => {
        installChat(['m0', 'm1', 'm2'])
        seedDraft(command)
        await send(makeSource())

        expect(contents()).toEqual(expected)
    })

    test('guard: /del abc on three messages removes nothing', async () => {
        installChat(['m0', 'm1', 'm2'])
        seedDraft('/del abc')
        await send(makeSource())

        expect(contents()).toEqual(['m0', 'm1', 'm2'])
    })

    test('a trigger that alternates runtrigger and /trigger runs a bounded number of times', async () => {
        const RUN_CAP = 60
        const RUN_BOUND = 12
        installWorld()
        setTriggers(0,
            trigger('self', 'manual', [
                commandEffect('command', '/speak x'),
                { type: 'runtrigger', value: 'other' },
            ]),
            trigger('other', 'manual', [commandEffect('command', '/trigger self')]),
        )
        let runs = 0
        vi.mocked(sayTTS).mockImplementation(async () => {
            runs++
            if (runs >= RUN_CAP) {
                throw new Error('the triggers recursed past the cap')
            }
        })
        seedDraft('/trigger self')
        await settledOutcome(send(makeSource()))

        expect(runs).toBeLessThanOrEqual(RUN_BOUND)
    })
})

describe('a composer pipe that has started a counting command is handled', () => {
    test('/send x|/nosuchcommand posts x, does not post the command text and makes no request', async () => {
        installWorld()
        seedDraft('/send x|/nosuchcommand')
        await send(makeSource())

        expect.soft(contents()).toEqual(['Hi', 'x'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(draftText()).toBe('')
    })

    test('guard: /pass x|/nosuchcommand sends the command text as a message and answers it', async () => {
        installWorld()
        mockReply('reply')
        seedDraft('/pass x|/nosuchcommand')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', '/pass x|/nosuchcommand', 'reply'])
    })
})

describe('the busy button and a counting command that starts a run or a scan', () => {
    test('pressed during /speak in the trigger run by /trigger t, it posts nothing more and leaves the composer empty', async () => {
        installWorld()
        setTriggers(0, trigger('t', 'manual', [commandEffect('command', '/speak y|/send a')]))
        const speak = holdNextSpeak()
        seedDraft('/trigger t')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect.soft(contents()).toEqual(['Hi'])
        expect.soft(draftText()).toBe('')
    })

    test('pressed during /speak after /test_lorebook, it leaves the composer empty', async () => {
        installWorld()
        const speak = holdNextSpeak()
        seedDraft('/test_lorebook|/speak y')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect(draftText()).toBe('')
    })

    test('pressed during /speak after a /trigger whose run wrote nothing, it leaves the composer empty', async () => {
        installWorld()
        setTriggers(0, trigger('t', 'manual', []))
        const speak = holdNextSpeak()
        seedDraft('/trigger t|/speak y')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect(draftText()).toBe('')
    })
})

describe('depth and window ownership through /trigger chains', () => {
    test('guard: a /trigger chain whose character has low-level access runs past ten nested runs', async () => {
        const RUN_CAP = 30
        const NO_BOUND = 12
        installWorld()
        ;(DBState.db.characters[0] as unknown as { lowLevelAccess: boolean }).lowLevelAccess = true
        setTriggers(0, trigger('self', 'manual', [commandEffect('command', '/speak x|/trigger self')]))
        let runs = 0
        vi.mocked(sayTTS).mockImplementation(async () => {
            runs++
            if (runs >= RUN_CAP) {
                throw new Error('the chain reached its own cap')
            }
        })
        seedDraft('/trigger self')
        await settledOutcome(send(makeSource()))

        expect(runs).toBeGreaterThan(NO_BOUND)
    })

    test('guard: a /trigger t in the take\'s / stage whose run reaches /multisend a|||b through runtrigger answers both segments', async () => {
        installWorld()
        setTriggers(0,
            trigger('t', 'manual', [{ type: 'runtrigger', value: 'u' }]),
            trigger('u', 'manual', [commandEffect('command', '/multisend a|||b')]),
        )
        mockReply('reply a')
        mockReply('reply b')
        seedDraft('/trigger t')
        await send(makeSource())

        expect(contents()).toEqual(['Hi', 'a', 'reply a', 'b', 'reply b'])
    })

    test('a button\'s pipe /trigger t whose run reaches /multisend a|||b through runtrigger posts without replies while the window is open', async () => {
        installWorld()
        setTriggers(0,
            trigger('in', 'input', [commandEffect('command', '/speak hold')]),
            trigger('btn', 'manual', [commandEffect('command', '/trigger t')]),
            trigger('t', 'manual', [{ type: 'runtrigger', value: 'u' }]),
            trigger('u', 'manual', [commandEffect('command', '/multisend a|||b')]),
        )
        const speak = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await speak.reached
        await clickTriggerButton('btn')

        expect.soft(contents()).toEqual(['Hi', 'a', 'b'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(get(doingChat)).toBe(false)

        mockReply('reply hello')
        speak.release()
        await sending
    })
})

describe('the range and count edge forms of /cut and /del', () => {
    test.each([
        ['/cut -3', ['m1', 'm2']],
        ['/cut 1-9', ['m0']],
        ['/del 3', []],
    ])('%s on three messages leaves the expected messages', async (command, expected) => {
        installChat(['m0', 'm1', 'm2'])
        seedDraft(command)
        await send(makeSource())

        expect(contents()).toEqual(expected)
    })
})

describe('a cancel before the take\'s pipe has started a counting command puts the text back', () => {
    test('guard: pressed during /speak after /input, it puts the text back', async () => {
        installWorld()
        const speak = holdNextSpeak()
        seedDraft('/input q|/speak x')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect.soft(draftText()).toBe('/input q|/speak x')
        expect.soft(contents()).toEqual(['Hi'])
    })

    test('guard: pressed during /speak after /getvar, it puts the text back', async () => {
        installWorld()
        theChat().scriptstate = { $k: 'v' }
        const speak = holdNextSpeak()
        seedDraft('/getvar key=k|/speak x')
        const sending = send(makeSource())
        await speak.reached
        abortChat()
        speak.release()
        await sending

        expect.soft(draftText()).toBe('/getvar key=k|/speak x')
        expect.soft(contents()).toEqual(['Hi'])
    })
})

describe('a composer pipe that ran /trigger or /test_lorebook is handled when a later command is unknown', () => {
    test('/trigger t|/nosuchcommand posts nothing and makes no request', async () => {
        installWorld()
        setTriggers(0, trigger('t', 'manual', []))
        seedDraft('/trigger t|/nosuchcommand')
        await send(makeSource())

        expect.soft(contents()).toEqual(['Hi'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(draftText()).toBe('')
    })

    test('/test_lorebook|/nosuchcommand posts nothing and makes no request', async () => {
        installWorld()
        seedDraft('/test_lorebook|/nosuchcommand')
        await send(makeSource())

        expect.soft(contents()).toEqual(['Hi'])
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(draftText()).toBe('')
    })
})

describe('the busy button during a running lorebook scan', () => {
    test('pressed while /test_lorebook is scanning, it leaves the composer empty', async () => {
        installWorld()
        const scan = holdNextScan()
        seedDraft('/test_lorebook')
        const sending = send(makeSource())
        await scan.reached
        abortChat()
        scan.release()
        await sending

        expect(draftText()).toBe('')
    })
})

describe('a button\'s /multisend without replies still marks its character for save', () => {
    test('a button\'s pipe /speak x|/multisend a posts a in its chat and marks its character while the composer\'s window is open, after a character switch', async () => {
        installWorld()
        addSecondCharacter()
        setTriggers(0,
            trigger('in', 'input', [commandEffect('command', '/speak hold')]),
            trigger('btn', 'manual', [commandEffect('command', '/speak x|/multisend a')]),
        )
        const take = holdNextSpeak()
        seedDraft('hello')
        const sending = send(makeSource())
        await take.reached
        const buttonSpeak = holdNextSpeak()
        const run = clickTriggerButton('btn')
        await buttonSpeak.reached
        selectedCharID.set(1)
        marks.tracker.character.length = 0
        buttonSpeak.release()
        await run

        expect.soft(contents()).toEqual(['Hi', 'a'])
        expect.soft(marks.tracker.character).toContain('char-0')
        expect.soft(requestChatDataMock).not.toHaveBeenCalled()

        mockReply('reply hello')
        take.release()
        await sending
    })
})

describe('/trigger and runtrigger share one nesting rule', () => {
    const RUN_CAP = 5000
    const RUN_BOUND = 1023

    /** Runs `self` from the composer with the given effects, and counts how many times its `/speak x` ran. */
    async function countRuns(name: string, effects: unknown[]): Promise<number> {
        installWorld()
        setTriggers(0, trigger(name, 'manual', [commandEffect('command', '/speak x'), ...effects]))
        let runs = 0
        vi.mocked(sayTTS).mockReset()
        vi.mocked(sayTTS).mockImplementation(async () => {
            runs++
            if (runs >= RUN_CAP) {
                throw new Error('the triggers recursed past the cap')
            }
        })
        seedDraft(`/trigger ${name}`)
        await settledOutcome(send(makeSource()))
        return runs
    }

    test('/trigger fans out exactly as far as runtrigger does', async () => {
        const viaCommand = await countRuns('self', [commandEffect('command', '/trigger self|/trigger self')])
        const viaEffect = await countRuns('self2', [
            { type: 'runtrigger', value: 'self2' },
            { type: 'runtrigger', value: 'self2' },
        ])

        expect.soft(viaCommand).toBeLessThanOrEqual(RUN_BOUND)
        expect.soft(viaEffect).toBeLessThanOrEqual(RUN_BOUND)
        expect.soft(viaCommand).toBe(viaEffect)
    })

    test('a run\'s /trigger and its runtrigger effects draw from one count', async () => {
        const mixed = await countRuns('mix', [
            commandEffect('command', '/trigger mix'),
            { type: 'runtrigger', value: 'mix' },
        ])
        const pure = await countRuns('pure', [
            { type: 'runtrigger', value: 'pure' },
            { type: 'runtrigger', value: 'pure' },
        ])

        expect.soft(mixed).toBeLessThanOrEqual(RUN_BOUND)
        expect.soft(pure).toBeLessThanOrEqual(RUN_BOUND)
        expect.soft(mixed).toBe(pure)
    })
})

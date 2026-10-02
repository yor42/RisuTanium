/**
 * One generation at a time, owned by the send that started it.
 *
 * Drives the REAL modules that start, hold and cancel a generation together:
 * `sendChat` (`../index.svelte`), the composer (`../composerActions.svelte`),
 * the command line (`../command`), `postChatFile` and its `.po` job
 * (`../files/multisend`), DevTool's Autopilot (`../devToolActions`) and the v3
 * plugin API's `sendChat` (`../../plugins/apiV3/v3.svelte`), against a real
 * `$state` database. Only the provider request, the trigger engine, the
 * scripts and the modules they import are mocked, as in
 * `sendChatOwnership.svelte.test.ts` and `pluginSendChatColdGuard.svelte.test.ts`
 * (copied, not shared: each suite mocks its own graph). Nothing here clears
 * `doingChat` on a caller's behalf, and the busy button is the real
 * `abortChat`.
 *
 * A provider request is held open until the test feeds and closes its stream,
 * so a test can press the busy button, or start another unit, at a known
 * point of a generation. `runTrigger` is a mock: what a trigger effect does is
 * modelled by calling the real `processMultiCommand` from it, so the command
 * line, `/multisend` and the wrapper's refusals are the real ones while the
 * trigger engine itself is not exercised.
 *
 * Every call that can still be pending when an assertion fails is drained
 * through `drain`, which closes every held stream and stops auto mode, so a
 * test that fails cannot leave a loop running into the next one.
 *
 * Tests whose title starts with `guard:` pass before and after the ownership
 * change: they pin behaviour that must be preserved.
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
    hasher: hasherMock,
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
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

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

function makeGate() {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    let markReached: () => void = () => {}
    const reached = new Promise<void>((res) => { markReached = res })
    return { gate, release, reached, markReached }
}

/** Holds the composer's input trigger open: the composer's window stays open until `release`. */
function gateInputTrigger() {
    const { gate, release, reached, markReached } = makeGate()
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

describe('the composer\'s hand-off when another unit holds the flag', () => {
    test('a hand-off refused because another unit holds the flag leaves the flag set', async () => {
        installWorld()
        holdEveryRequest()
        const input = gateInputTrigger()
        seedDraft('hello')
        const sending = send(makeSource())
        await input.reached
        const other = sendChat(-1)
        await until(() => held.length === 1, 'the other unit\'s request')

        input.release()
        await sending
        const flagAfterHandOff = get(doingChat)
        const requestsAfterHandOff = held.length
        await drain(other)

        expect.soft(flagAfterHandOff).toBe(true)
        expect.soft(requestsAfterHandOff).toBe(1)
    })
})

describe('the composer\'s window, from Send\'s take until its hand-off returns', () => {
    test('the plugin sendChat throws and pushes nothing, and the composer\'s reply then generates', async () => {
        installWorld()
        holdEveryRequest()
        const input = gateInputTrigger()
        seedDraft('hello')
        const sending = send(makeSource())
        await input.reached
        const api = makePluginApi()

        const pluginCall = api.sendChat('plugin says')
        const pluginOutcome = await observe(pluginCall)
        const messagesDuringWindow = contents()
        input.release()
        await until(() => held.length >= 1, 'a request')
        const requestsSoFar = held.length
        held[0].source.push('composer reply')
        await drain(sending)
        await drain(pluginCall)

        expect.soft(pluginOutcome.state).toBe('rejected')
        expect.soft(pluginOutcome.error?.message).toBe('A chat is already in progress')
        expect.soft(messagesDuringWindow).toEqual(['Hi'])
        expect.soft(requestsSoFar).toBe(1)
        expect.soft(contents()).toEqual(['Hi', 'hello', 'composer reply'])
    })

    test('Autopilot started during the composer\'s wait pushes nothing', async () => {
        installWorld()
        holdEveryRequest()
        const input = gateInputTrigger()
        seedDraft('hello')
        const sending = send(makeSource())
        await input.reached

        const autopilot = runAutopilot(['autopilot says'])
        await settle()
        const messagesDuringWindow = contents()
        const requestsDuringWindow = held.length
        input.release()
        await drain(autopilot)
        await drain(sending)

        expect.soft(messagesDuringWindow).toEqual(['Hi'])
        expect.soft(requestsDuringWindow).toBe(0)
    })
})

describe('auto mode against another unit', () => {
    test('starting auto mode while a plugin send is in flight does nothing and leaves the flag with the plugin', async () => {
        installWorld()
        holdEveryRequest()
        const source = makeSource()
        const pluginCall = makePluginApi().sendChat('plugin says')
        await requestHeld(1)
        const flagValues: boolean[] = []
        const unsubscribe = doingChat.subscribe((v) => { flagValues.push(v) })

        const auto = runAutoMode(source)
        for (let i = 0; i < 5; i++) {
            await settle()
        }
        const requestsWhileAutoRuns = held.length
        unsubscribe()
        await drain(auto, stopAutoMode(source))
        await drain(pluginCall)

        expect.soft(requestsWhileAutoRuns).toBe(1)
        expect.soft(flagValues.includes(false)).toBe(false)
    })

    test('guard: in a character chat, auto mode runs past 50 ticks', async () => {
        installWorld()
        const source = makeSource()
        let requests = 0
        requestChatDataMock.mockImplementation(async () => {
            requests++
            if (requests === 60) {
                void runAutoMode(source)
            }
            return { type: 'success', result: `reply ${requests}` }
        })

        // Every tick makes a request, so the loop ends by the request bound
        // above; no timer is involved, however long a tick takes.
        await runAutoMode(source)

        expect(requests).toBe(60)
    })
})

describe('Autopilot', () => {
    test('three entries each get a reply, and the flag is false at the end', async () => {
        installWorld()
        mockReply('reply one')
        mockReply('reply two')
        mockReply('reply three')

        await runAutopilot(['one', 'two', 'three'])

        expect.soft(contents()).toEqual(['Hi', 'one', 'reply one', 'two', 'reply two', 'three', 'reply three'])
        expect.soft(get(doingChat)).toBe(false)
    })
})

describe('/multisend typed in the composer', () => {
    test('a|||b|||c posts three messages, each with its reply, and not the command text', async () => {
        installWorld()
        mockReply('reply a')
        mockReply('reply b')
        mockReply('reply c')
        seedDraft('/multisend a|||b|||c')

        await send(makeSource())

        expect.soft(contents()).toEqual(['Hi', 'a', 'reply a', 'b', 'reply b', 'c', 'reply c'])
        expect.soft(contents().some((text) => text.includes('/multisend'))).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
        expect.soft(draftText()).toBe('')
    })

    test('guard: a single | between two commands still runs both', async () => {
        installWorld()

        const result = await processMultiCommand('/setvar key=a 1|/setvar key=b 2', composerCommandContext())

        expect(result).not.toBe(false)
        expect(theChat().scriptstate).toMatchObject({ $a: '1', $b: '2' })
    })

    test('guard: || between two commands still fails on the empty command between them', async () => {
        installWorld()

        const result = await processMultiCommand('/setvar key=a 1||/setvar key=b 2', composerCommandContext())

        expect(result).toBe(false)
        expect(theChat().scriptstate).toMatchObject({ $a: '1' })
        expect(theChat().scriptstate).not.toHaveProperty('$b')
    })
})

describe('/multisend inside a send', () => {
    test('a plugin send whose output trigger runs /multisend x|||y posts both segments without a reply of their own', async () => {
        installWorld()
        mockReply('plugin reply')
        triggerHandlers.output = async (arg) => {
            await processMultiCommand('/multisend x|||y', commandContextOf(arg))
        }

        const result = await settledOutcome(makePluginApi().sendChat('plugin says'))

        expect.soft(result).toBe(true)
        expect.soft(contents()).toEqual(['Hi', 'plugin says', 'plugin reply', 'x', 'y'])
        expect.soft(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect.soft(get(doingChat)).toBe(false)
    })
})

describe('.po Post File', () => {
    test('the flag is false after the job', async () => {
        installWorld()
        mockReply('reply one')
        mockReply('reply two')

        await postFile(poFile('one', 'two'))

        expect(get(doingChat)).toBe(false)
    })

    test('guard: every entry gets its reply', async () => {
        installWorld()
        mockReply('reply one')
        mockReply('reply two')

        await postFile(poFile('one', 'two'))

        expect(contents()).toEqual(['Hi', 'one', 'reply one', 'two', 'reply two'])
    })

    test('on Tauri, a composer Send that opens its window between two entries makes the job push nothing more and stop', async () => {
        platformBox.isTauri = true
        installWorld()
        mockReply('reply one')
        const betweenEntries = makeGate()
        downloadFileMock.mockImplementationOnce(async () => {
            betweenEntries.markReached()
            await betweenEntries.gate
        })
        const job = postFile(poFile('one', 'two', 'three'))
        await betweenEntries.reached
        const input = gateInputTrigger()
        seedDraft('hello')
        const sending = send(makeSource())
        await input.reached

        betweenEntries.release()
        await job
        const messagesAfterJob = contents()
        const requestsAfterJob = requestChatDataMock.mock.calls.length
        input.release()
        await sending

        expect.soft(messagesAfterJob).toEqual(['Hi', 'one', 'reply one'])
        expect.soft(requestsAfterJob).toBe(1)
    })
})

describe('starters refused while a send runs', () => {
    /** A plugin send held open: the flag is set and its request is waiting. */
    async function startRunningSend(): Promise<{ running: Promise<boolean> }> {
        holdEveryRequest()
        const running = makePluginApi().sendChat('running send')
        await requestHeld(1)
        return { running }
    }

    test('a .po Post File pushes nothing', async () => {
        installWorld()
        const { running } = await startRunningSend()
        const before = contents()

        const job = postFile(poFile('one', 'two'))
        await settle()
        const after = contents()
        const requests = held.length
        await drain(job)
        await drain(running)

        expect.soft(after).toEqual(before)
        expect.soft(requests).toBe(1)
    })

    test('guard: Autopilot pushes nothing', async () => {
        installWorld()
        const { running } = await startRunningSend()
        const before = contents()

        const job = runAutopilot(['one', 'two'])
        await settle()
        const after = contents()
        const requests = held.length
        await drain(job)
        await drain(running)

        expect(after).toEqual(before)
        expect(requests).toBe(1)
    })

    test('guard: reroll and unreroll are refused and leave the chat untouched', async () => {
        installWorld()
        theChat().message.push(msg('char', 'the last reply'))
        const { running } = await startRunningSend()
        const before = contents()
        const source = makeSource()

        await reroll(source)
        await unReroll(source)
        const after = contents()
        const requests = held.length
        await drain(running)

        expect(after).toEqual(before)
        expect(requests).toBe(1)
    })
})

describe('the busy button during a generation started by something other than the composer', () => {
    test('aborts a plugin send during the stream; the plugin then resolves true and the flag is false', async () => {
        installWorld()
        holdEveryRequest()
        const call = makePluginApi().sendChat('plugin says')
        const request = await requestHeld(1)

        abortChat()
        const signalAborted = request.signal?.aborted
        await drain(call)
        const result = await settledOutcome(call)

        expect.soft(signalAborted).toBe(true)
        expect.soft(result).toBe(true)
        expect.soft(get(doingChat)).toBe(false)
    })

    test('guard: a plugin send cancelled after the stream, in the output trigger, resolves true and leaves the flag false', async () => {
        installWorld()
        triggerHandlers.output = () => { abortChat() }
        mockReply('plugin reply')

        const result = await settledOutcome(makePluginApi().sendChat('plugin says'))

        expect(result).toBe(true)
        expect(get(doingChat)).toBe(false)
    })

    test('aborts the Autopilot entry that streams, pushes no further entry and leaves the flag false', async () => {
        installWorld()
        holdEveryRequest()
        const run = runAutopilot(['one', 'two'])
        const request = await requestHeld(1)

        abortChat()
        const signalAborted = request.signal?.aborted
        await drain(run)

        expect.soft(signalAborted).toBe(true)
        expect.soft(contents().includes('two')).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
    })

    test('an Autopilot entry cancelled after the stream, in the output trigger, pushes no further entry', async () => {
        installWorld()
        holdEveryRequest()
        triggerHandlers.output = () => { abortChat() }
        const run = runAutopilot(['one', 'two'])
        const request = await requestHeld(1)
        request.source.close()
        await drain(run)

        expect.soft(contents().includes('two')).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
    })

    test('aborts the .po entry that streams, pushes no further entry and leaves the flag false', async () => {
        installWorld()
        holdEveryRequest()
        const job = postFile(poFile('one', 'two'))
        const request = await requestHeld(1)

        abortChat()
        const signalAborted = request.signal?.aborted
        await drain(job)

        expect.soft(signalAborted).toBe(true)
        expect.soft(contents().includes('two')).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
    })

    test('a .po entry cancelled after the stream, in the output trigger, pushes no further entry', async () => {
        installWorld()
        holdEveryRequest()
        triggerHandlers.output = () => { abortChat() }
        const job = postFile(poFile('one', 'two'))
        const request = await requestHeld(1)
        request.source.close()
        await drain(job)

        expect.soft(contents().includes('two')).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
    })

    test('aborts the auto-mode tick that streams and runs no further tick', async () => {
        installWorld()
        holdEveryRequest()
        const source = makeSource()
        const auto = runAutoMode(source)
        const request = await requestHeld(1)

        abortChat()
        const signalAborted = request.signal?.aborted
        await drain(auto, stopAutoMode(source))

        expect.soft(signalAborted).toBe(true)
        expect.soft(held.length).toBe(1)
        expect.soft(get(doingChat)).toBe(false)
    })

    test('an auto-mode tick cancelled after the stream, in the output trigger, runs no further tick', async () => {
        installWorld()
        holdEveryRequest()
        triggerHandlers.output = () => { abortChat() }
        const source = makeSource()
        const auto = runAutoMode(source)
        const request = await requestHeld(1)
        request.source.close()
        await drain(auto, stopAutoMode(source))

        expect.soft(held.length).toBe(1)
        expect.soft(get(doingChat)).toBe(false)
    })
})

describe('the busy button during a /multisend', () => {
    test('typed in the composer: aborts the running segment, posts no further segment and leaves the text box empty', async () => {
        installWorld()
        holdEveryRequest()
        seedDraft('/multisend a|||b')
        const sending = send(makeSource())
        const request = await requestHeld(1)

        abortChat()
        const signalAborted = request.signal?.aborted
        await drain(sending)

        expect.soft(signalAborted).toBe(true)
        expect.soft(contents().includes('b')).toBe(false)
        expect.soft(draftText()).toBe('')
        expect.soft(get(doingChat)).toBe(false)
    })

    test('typed in the composer: pressed after the stream, in the output trigger, it leaves the text box empty', async () => {
        installWorld()
        holdEveryRequest()
        triggerHandlers.output = () => { abortChat() }
        seedDraft('/multisend a|||b')
        const sending = send(makeSource())
        const request = await requestHeld(1)
        request.source.close()
        await drain(sending)

        expect.soft(contents().includes('b')).toBe(false)
        expect.soft(draftText()).toBe('')
        expect.soft(get(doingChat)).toBe(false)
    })

    test('typed in the composer as a|/trigger x: pressed during the trigger, the text is not put back', async () => {
        installWorld()
        mockReply('reply a')
        const trigger = makeGate()
        triggerHandlers.manual = async () => {
            trigger.markReached()
            await trigger.gate
        }
        seedDraft('/multisend a|/trigger x')
        const sending = send(makeSource())
        await trigger.reached

        abortChat()
        trigger.release()
        await sending

        expect.soft(draftText()).toBe('')
        expect.soft(contents()).toEqual(['Hi', 'a', 'reply a'])
    })

    test('run by the input trigger: aborts the running segment and posts no further segment', async () => {
        installWorld()
        holdEveryRequest()
        triggerHandlers.input = async (arg) => {
            await processMultiCommand('/multisend x|||y', commandContextOf(arg))
        }
        seedDraft('hello')
        const sending = send(makeSource())
        const request = await requestHeld(1)

        abortChat()
        const signalAborted = request.signal?.aborted
        await drain(sending)

        expect.soft(signalAborted).toBe(true)
        expect.soft(contents().includes('y')).toBe(false)
    })

    test('run by the input trigger: pressed after the stream, in the output trigger, it posts no further segment and leaves the flag false', async () => {
        installWorld()
        holdEveryRequest()
        triggerHandlers.output = () => { abortChat() }
        triggerHandlers.input = async (arg) => {
            await processMultiCommand('/multisend x|||y', commandContextOf(arg))
        }
        seedDraft('hello')
        const sending = send(makeSource())
        const request = await requestHeld(1)
        request.source.close()
        await drain(sending)

        expect.soft(contents().includes('y')).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
    })
})

describe('the other endings of a /multisend typed in the composer', () => {
    test('a|/nosuchcommand: posts a with its reply, and the command text is neither posted nor put back', async () => {
        installWorld()
        mockReply('reply a')
        seedDraft('/multisend a|/nosuchcommand')

        await send(makeSource())

        expect.soft(contents()).toEqual(['Hi', 'a', 'reply a'])
        expect.soft(draftText()).toBe('')
    })

    test('a|||b whose first segment\'s send throws: the text is not put back, b is not posted, and the error reaches the caller', async () => {
        installWorld()
        requestChatDataMock.mockRejectedValueOnce(new Error('provider down'))
        seedDraft('/multisend a|||b')

        const result = await settledOutcome(send(makeSource()))

        expect.soft(draftText()).toBe('')
        expect.soft(contents().includes('b')).toBe(false)
        expect.soft(result).toBeInstanceOf(Error)
        expect.soft((result as Error).message).toBe('provider down')
    })
})

describe('text typed with a leading / that is not a command, sent through an input trigger that runs /multisend', () => {
    function runMultisendFromInputTrigger(): void {
        triggerHandlers.input = async (arg) => {
            await processMultiCommand('/multisend x|||y', commandContextOf(arg))
        }
    }

    test('guard: plain text is put back when the busy button stops the trigger\'s segment', async () => {
        installWorld()
        holdEveryRequest()
        runMultisendFromInputTrigger()
        seedDraft('hello')
        const sending = send(makeSource())
        await requestHeld(1)

        abortChat()
        await drain(sending)

        expect(draftText()).toBe('hello')
    })

    test('the text is put back when the busy button stops the trigger\'s segment', async () => {
        installWorld()
        holdEveryRequest()
        runMultisendFromInputTrigger()
        seedDraft('/me waves')
        const sending = send(makeSource())
        await requestHeld(1)

        abortChat()
        await drain(sending)

        expect(draftText()).toBe('/me waves')
    })

    test('the text is put back when the trigger\'s segment send throws', async () => {
        installWorld()
        runMultisendFromInputTrigger()
        requestChatDataMock.mockRejectedValueOnce(new Error('provider down'))
        seedDraft('/me waves')

        const result = await settledOutcome(send(makeSource()))

        expect.soft(result).toBeInstanceOf(Error)
        expect.soft(draftText()).toBe('/me waves')
    })
})

describe('a loop whose entry\'s send throws', () => {
    test('guard: Autopilot rejects with the error and pushes no further entry', async () => {
        installWorld()
        requestChatDataMock.mockRejectedValueOnce(new Error('provider down'))

        const result = await settledOutcome(runAutopilot(['one', 'two']))

        expect(result).toBeInstanceOf(Error)
        expect((result as Error).message).toBe('provider down')
        expect(contents().includes('two')).toBe(false)
    })

    test('guard: a .po job rejects with the error, pushes no further entry and downloads nothing', async () => {
        installWorld()
        requestChatDataMock.mockRejectedValueOnce(new Error('provider down'))

        const result = await settledOutcome(postFile(poFile('one', 'two')))

        expect(result).toBeInstanceOf(Error)
        expect((result as Error).message).toBe('provider down')
        expect(contents().includes('two')).toBe(false)
        expect(downloadFileMock).not.toHaveBeenCalled()
    })

    test('guard: on Tauri, a .po job whose second entry throws has downloaded after the first entry only', async () => {
        platformBox.isTauri = true
        installWorld()
        mockReply('reply one')
        requestChatDataMock.mockRejectedValueOnce(new Error('provider down'))

        const result = await settledOutcome(postFile(poFile('one', 'two', 'three')))

        expect(result).toBeInstanceOf(Error)
        expect(downloadFileMock).toHaveBeenCalledTimes(1)
        expect(contents().includes('three')).toBe(false)
    })
})

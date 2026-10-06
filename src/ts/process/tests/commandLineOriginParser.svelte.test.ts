/**
 * CBS in a command's arguments is parsed for the chat the pipe runs in,
 * whichever chat is on screen by the time the command runs.
 *
 * Runs the real CBS parser (`vi.importActual` of `parser.svelte`, and through it
 * the real `cbs.ts` and `chatVar.svelte.ts`) for the rows that need it, over the
 * same real composer, command line and trigger engine as
 * `commandLineOrigin.svelte.test.ts`. Only the provider request, the scripts,
 * Lua and the modules they import are mocked. `/speak` and `/input` are parked
 * by holding their mocked function, so a test can switch chat at a known point.
 *
 * Tests whose title starts with `guard:` pin behaviour that must be preserved.
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

// The parser is the real one, and through it the real `cbs.ts` and `chatVar.svelte.ts`.

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
    const parser = await vi.importActual<typeof import('src/ts/parser/parser.svelte')>('src/ts/parser/parser.svelte')
    return {
        processScript: vi.fn(async (_char: unknown, text: string) => text),
        processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
        risuChatParser: parser.risuChatParser,
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

import { doingChat } from 'src/ts/process/index.svelte'
import { send, resetComposerActionsForTests, type ComposerActionsSource } from 'src/ts/process/composerActions.svelte'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
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

/** Moves the chat on screen to `chat-1` of `char-0`. */
function switchToSecondChat(): void {
    DBState.db.characters[0].chatPage = 1
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
    resetLocalDraftsForTest()
    resetCharacterSaveMarksForTest()
    marks.tracker = { character: [] }
    installCharacterSaveMarks({ tracker: marks.tracker as unknown as toSaveType, schedule: () => {} })
    doingChat.set(false)
})

afterEach(() => {
    resetComposerActionsForTests()
    resetCharacterSaveMarksForTest()
    selectedCharID.set(-1)
})

//#endregion

describe('CBS in a command\'s arguments is parsed for the pipe\'s chat', () => {
    // The command line parses its arguments without running variable writes, so a
    // {{setvar}} in an argument is text, not a write, in any chat.
    test('guard: {{setvar::k::v}} in a /pass argument writes no chat variable of the chat on screen after a switch', async () => {
        installWorld()
        addSecondChat()
        const speak = holdNextSpeak()
        seedDraft('/speak x|/pass {{setvar::k::v}}')
        const sending = send(makeSource())
        await speak.reached
        switchToSecondChat()
        speak.release()
        await sending

        expect(vars(1)).toEqual({})
    })

    test('{{getvar::k}} in a /send argument reads the take\'s chat variable after a switch', async () => {
        installWorld()
        addSecondChat()
        theChat().scriptstate = { $k: 'zero' }
        DBState.db.characters[0].chats[1].scriptstate = { $k: 'one' }
        const speak = holdNextSpeak()
        seedDraft('/speak x|/send {{getvar::k}}')
        const sending = send(makeSource())
        await speak.reached
        switchToSecondChat()
        speak.release()
        await sending

        expect.soft(contents()).toEqual(['Hi', 'zero'])
        expect.soft(texts(1)).toEqual(['B last'])
    })

    test.each(COMMAND_EFFECT_FORMATS)('CBS that reaches a button\'s %s pipe through /input reads the run\'s chat variable after a switch', async (format) => {
        installWorld()
        addSecondChat()
        theChat().scriptstate = { $k: 'zero' }
        DBState.db.characters[0].chats[1].scriptstate = { $k: 'one' }
        setTriggers(0, trigger('t', 'manual', [commandEffect(format, '/input q|/send {{pipe}}')]))
        const input = holdNextInput('{{getvar::k}}')
        const run = clickTriggerButton('t')
        await input.reached
        switchToSecondChat()
        input.release()
        await run

        expect.soft(contents()).toEqual(['Hi', 'zero'])
        expect.soft(texts(1)).toEqual(['B last'])
    })
})

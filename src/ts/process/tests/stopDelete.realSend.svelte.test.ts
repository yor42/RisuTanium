/**
 * Stop-and-delete (`requestStopDelete`, `src/ts/chatShell/stopDelete.svelte.ts`) against the REAL send.
 *
 * Drives the real composer `send`, the real `sendChat` (`index.svelte.ts`) with a mock provider that streams
 * one chunk and then waits, the real `abortChat`, and the real `messageActions.svelte.ts` freeze and settle
 * delete. Every other module the send imports is mocked as in `sendChatAutoContinue.svelte.test.ts`. The
 * save-mark tracker is the real `installCharacterSaveMarks` with a scheduler that logs, on each mark, whether
 * the watched reply is still in its chat and whether the origin still has work registered.
 *
 * Tests whose title starts with `guard:` pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does.
import '../../polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())

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
    default: { addHook: vi.fn(), sanitize: (value: string) => value },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    const live = stores.DBState as unknown as { db: unknown }
    return {
        appVer: '0.0.0',
        changeToPreset: vi.fn(),
        setCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => live.db),
        getCurrentCharacter: vi.fn(),
        getCurrentChat: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async (text: string) => text.length),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('../../alert'), () => ({
    alertError: alertErrorMock,
    alertNormal: alertNormalMock,
    alertToast: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertSelect: vi.fn(async () => '0'),
    alertInput: vi.fn(async () => ''),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../../parser/parser.svelte'), () => ({
    ParseMarkdown: vi.fn(),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    hasher: vi.fn((text: string) => text),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), async () => {
    const realPunctuation = await vi.importActual<typeof import('../../util')>('../../util')
    const stores = await import('../../stores.svelte')
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
        capitalize: vi.fn((value: string) => value),
        checkPersonaBinded: vi.fn(() => false),
        pickHashRand: vi.fn(() => 0.5),
        replaceAsync: vi.fn(),
        asBuffer: vi.fn(),
        selectSingleFile: vi.fn(),
        BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
        isLastCharPunctuation: realPunctuation.isLastCharPunctuation,
        trimUntilPunctuation: realPunctuation.trimUntilPunctuation,
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    } as unknown as typeof import('../../util')
})

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../scripts'))

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), async (importOriginal) => ({
    ...(await importOriginal()),
    sayTTS: vi.fn(),
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('../triggers'))

vi.mock(import('../command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('../command'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('../embedding/addinfo'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    getInlayAssetBlob: vi.fn(async () => undefined),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('../models/modelString'))

vi.mock(import('../inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), async (importOriginal) => ({
    renameContinuedMessage: (await importOriginal()).renameContinuedMessage,
    addRerolls: vi.fn(),
}) as unknown as typeof import('../prereroll'))

vi.mock(import('../transformers'), () => ({
    runImageEmbedding: vi.fn(),
    runVITS: vi.fn(),
}) as unknown as typeof import('../transformers'))

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('../memory/hanuraiMemory'))

vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
    runLuaButtonTrigger: vi.fn(),
    runLuaInteractionTrigger: vi.fn(),
}) as unknown as typeof import('../scriptings'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model', flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
    getModules: vi.fn(() => []),
}) as unknown as typeof import('../modules'))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    fetchNative: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    aiWatermarkingLawApplies: vi.fn(() => false),
    globalFetch: vi.fn(),
    loadAsset: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
    runTranslator: vi.fn(async (text: string) => text),
    translateVox: vi.fn(async (text: string) => text),
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: { providers: new Map() },
    getV2PluginAPIs: () => ({}),
    pluginV2: { providers: new Map(), chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../gui/colorscheme'))

vi.mock(import('../mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../mcp/pluginmcp'))

vi.mock(import('../coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../coldstorage.svelte'))

vi.mock('../coldMemberRestore', () => ({
    restoreColdCharacterByChaId: vi.fn(async () => false),
}))

vi.mock('../../chatCopy', () => ({ copyPlainText: vi.fn(), stripThoughtsForCopy: vi.fn((text: string) => text) }))
vi.mock('../../chatCard', () => ({ captureCardTheme: vi.fn(), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn() }))

//#endregion

import { doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { send, sendChatMain, resetComposerActionsForTests } from '../composerActions.svelte'
import * as composerDrafts from '../composerDrafts.svelte'
import { isWriting, originOf } from '../chatOrigin'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../storage/characterSaveMarks'
import { isStopDeletePending, requestStopDelete } from '../../chatShell/stopDelete.svelte'
import { language } from '../../../lang'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const CHA_ID = 'char-0'
const CHAT_ID = 'chat-origin'
const KEY = { chaId: CHA_ID, chatId: CHAT_ID }

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function installDb(overrides: Record<string, unknown> = {}): void {
    const chat = { id: CHAT_ID, note: '', name: '', localLore: [], fmIndex: -1, message: [msg('user', 'Hi', { chatId: 'seed-user' })], scriptstate: {} } as unknown as Chat
    const character = {
        chaId: CHA_ID, name: CHA_ID, type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
        desc: 'description', bias: [], replaceGlobalNote: undefined, systemPrompt: undefined, utilityBot: false,
        inlayViewScreen: false, viewScreen: undefined, depth_prompt: undefined, reloadKeys: 0, supaMemory: false, chats: [chat],
    } as unknown as CharacterFixture
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        characterOrder: [CHA_ID], characters: [character], statics: { messages: 0 }, aiModel: 'gpt-3.5-turbo',
        maxContext: 999999, maxResponse: 500, bias: [], mainPrompt: '', globalNote: '', jailbreakToggle: false,
        chainOfThought: false, personaPrompt: false, promptPreprocess: false, additionalPrompt: '', descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptTemplate: undefined, promptInfoInsideChat: false, autoContinueMinTokens: 0, autoContinueChat: false,
        igpPrompt: '', notification: false, removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off',
        ttsAutoSpeech: false, presetChain: '', outputImageModal: false, rememberToolUsage: false, supaModelType: 'none',
        hypav2: false, hypaV3: false, hanuraiEnable: false, inlayErrorResponse: false, username: 'User', theme: '',
        askRemoval: false, instantRemove: false, ...overrides,
    } as unknown as Database
    selectedCharID.set(0)
}

function liveOwner(): CharacterFixture {
    return DBState.db.characters[0]
}

function liveChat(): Chat {
    return liveOwner().chats[0]
}

async function turn(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 400; i++) {
        if (condition()) {
            return
        }
        await turn()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

/** A provider stream that sends one cumulative chunk and then waits until the reader is cancelled. */
function waitingStream(chunk: string, seen: { cancelled: boolean }): ReadableStream<{ data: string }> {
    let sent = false
    return new ReadableStream<{ data: string }>({
        pull(controller) {
            if (!sent) {
                sent = true
                controller.enqueue({ data: chunk })
                return undefined
            }
            return new Promise<void>(() => {})
        },
        cancel() {
            seen.cancelled = true
        },
    })
}

interface MarkEntry {
    replyPresent: boolean
    writing: boolean
}

let tracker: toSaveType
let log: MarkEntry[]
let watched: { chatId: string } | null

function installLoggingMarks(): void {
    resetCharacterSaveMarksForTest()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    log = []
    watched = null
    installCharacterSaveMarks({
        tracker,
        schedule: () => {
            if (!watched) {
                return
            }
            const id = watched.chatId
            log.push({
                replyPresent: liveChat().message.some((message) => message.chatId === id),
                writing: isWriting({ chaId: CHA_ID, chatId: CHAT_ID }),
            })
        },
    })
}

interface Running {
    sending: Promise<unknown>
    reply: Message
    provider: { cancelled: boolean }
}

/** The same stream, but handed to the real `sendChat` through `sendChatMain` with no composer registration around it. */
async function startStreamingDirect(chunk: string): Promise<Running> {
    const provider = { cancelled: false }
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: waitingStream(chunk, provider) })
    const origin = originOf(liveOwner(), liveChat())
    if (!origin) {
        throw new Error('the fixture chat has no origin')
    }
    const sending = sendChatMain({ origin, originHint: { owner: liveOwner(), chat: liveChat() } })
    await until(() => liveChat().message.length === 2 && liveChat().message[1].data === chunk, 'the reply is streaming')
    return { sending, reply: liveChat().message[1], provider }
}

/** Sends `text` through the composer with a provider that streams `chunk` and waits; resolves once the reply is streaming. */
async function startStreamingSend(text: string, chunk: string): Promise<Running> {
    const provider = { cancelled: false }
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: waitingStream(chunk, provider) })
    composerDrafts.write(KEY, (record) => { record.messageInput = text })
    const sending = send({ closeMenu: () => {} })
    await until(() => liveChat().message.length === 3 && liveChat().message[2].data === chunk, 'the reply is streaming')
    return { sending, reply: liveChat().message[2], provider }
}

/** The bounded tail a settled send needs: the send's promise, then the microtask the stop-and-delete runs in. */
async function settleAll(running: Running): Promise<void> {
    await running.sending
    await turn()
    await turn()
}

//#endregion

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'fail', result: 'unexpected request' })
    alertErrorMock.mockReset()
    alertNormalMock.mockReset()
    composerDrafts.resetComposerDraftsForTests()
    resetComposerActionsForTests()
    doingChat.set(false)
    installDb()
    installLoggingMarks()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    selectedCharID.set(-1)
})

describe('guard: stop-and-delete on the real send', () => {
    test('guard: a stopped reply is deleted once the send has settled and the chat holds only the earlier messages', async () => {
        const running = await startStreamingSend('hello', 'Short')
        expect(running.reply.role).toBe('char')
        expect(running.reply.chatId).toBeTruthy()
        watched = { chatId: running.reply.chatId! }

        expect(requestStopDelete(liveOwner(), liveChat(), running.reply, 'one')).toBe(true)
        expect(isStopDeletePending()).toBe(true)
        await settleAll(running)

        expect(running.provider.cancelled).toBe(true)
        expect(liveChat().message.map((message) => message.data)).toEqual(['Hi', 'hello'])
        expect(isStopDeletePending()).toBe(false)
        expect(alertNormalMock).not.toHaveBeenCalled()
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('guard: with auto-continue on, a short reply that was stopped makes exactly one provider request', async () => {
        installDb({ autoContinueChat: true })
        const running = await startStreamingSend('hello', 'Short unfinished reply')
        watched = { chatId: running.reply.chatId! }

        expect(requestStopDelete(liveOwner(), liveChat(), running.reply, 'one')).toBe(true)
        await settleAll(running)

        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect(liveChat().message.map((message) => message.data)).toEqual(['Hi', 'hello'])
        expect(liveChat().message.some((message) => message.data.includes('Short unfinished reply'))).toBe(false)
    })

    test('guard: on the real sendChat the delete mark comes after the settle mark and is written when the origin has no work registered', async () => {
        const running = await startStreamingDirect('Short')
        watched = { chatId: running.reply.chatId! }

        requestStopDelete(liveOwner(), liveChat(), running.reply, 'one')
        await settleAll(running)

        const firstAbsent = log.findIndex((entry) => !entry.replyPresent)
        expect(firstAbsent).toBeGreaterThan(0)
        expect(log.slice(0, firstAbsent).some((entry) => entry.replyPresent)).toBe(true)
        expect(log[firstAbsent].writing).toBe(false)
        expect(log.slice(firstAbsent).every((entry) => !entry.replyPresent)).toBe(true)
        expect(tracker.character).toContain(CHA_ID)
        expect(liveChat().message.map((message) => message.data)).toEqual(['Hi'])
    })

    // Open finding: through the composer's `send` the composer still holds its own work registration for the origin
    // when the delete runs (its registration ends in `sendMain`'s outer finally, after `sendChat` returned), so the
    // delete mark is written while `isWriting(origin)` is true. Flip this to a plain test once the delete waits for it.
    test.fails('reproducer: through the composer send the delete mark is written when the origin has no work registered', async () => {
        const running = await startStreamingSend('hello', 'Short')
        watched = { chatId: running.reply.chatId! }

        requestStopDelete(liveOwner(), liveChat(), running.reply, 'one')
        await settleAll(running)

        const firstAbsent = log.findIndex((entry) => !entry.replyPresent)
        expect(firstAbsent).toBeGreaterThan(0)
        expect(log[firstAbsent].writing).toBe(false)
    })

    test('guard: a theme change while the delete waits does not drop it, the module holds the request', async () => {
        const running = await startStreamingSend('hello', 'Short')
        watched = { chatId: running.reply.chatId! }

        expect(requestStopDelete(liveOwner(), liveChat(), running.reply, 'one')).toBe(true)
        DBState.db.theme = 'waifu'
        expect(isStopDeletePending({ chaId: CHA_ID, chatId: CHAT_ID })).toBe(true)
        await settleAll(running)

        expect(liveChat().message.map((message) => message.data)).toEqual(['Hi', 'hello'])
        expect(isStopDeletePending()).toBe(false)
    })

    test('guard: a reply that gained a sibling before the settle is refused and announced, nothing is deleted', async () => {
        const running = await startStreamingSend('hello', 'Short')
        watched = { chatId: running.reply.chatId! }

        expect(requestStopDelete(liveOwner(), liveChat(), running.reply, 'one')).toBe(true)
        const chat = liveChat()
        const parentId = chat.message[1].chatId
        expect(parentId).toBeTruthy()
        chat.alt = [{ m: msg('char', 'other take', { chatId: 'late-sibling' }), p: parentId!, a: 1 }]
        await settleAll(running)

        expect(alertNormalMock).toHaveBeenCalledWith(language.chatShellStopDeleteChanged)
        expect(liveChat().message.map((message) => message.data)).toEqual(['Hi', 'hello', 'Short'])
    })
})

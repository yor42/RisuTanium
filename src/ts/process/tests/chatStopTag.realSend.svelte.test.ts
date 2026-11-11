/**
 * The signal a real send hands the provider layer, and the chat target published with it (MC-1435).
 *
 * Drives the real `sendChatMain` and the real `sendChat` (`index.svelte.ts`) with a mock `requestChatData` that
 * records the abort signal it receives. The native request layer marks a request for the chat's Stop exactly when
 * its signal is the published send unit's, so these tests pin the leg from the send to the provider call. Every
 * other module the send imports is mocked as in `stopDelete.realSend.svelte.test.ts` (copied, not shared: each
 * suite mocks its own graph).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database, Chat, Message } from '../../storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does.
import '../../polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())

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

vi.mock(import('../../stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
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
    alertError: vi.fn(),
    alertNormal: vi.fn(),
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
import { sendChatMain, resetComposerActionsForTests } from '../composerActions.svelte'
import * as composerDrafts from '../composerDrafts.svelte'
import { originOf } from '../chatOrigin'
import { abortUnitInProgress, isUnitInProgressSignal, unitTargetOfSignal } from '../generationOwnership.svelte'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const CHA_ID = 'char-0'
const CHAT_ID = 'chat-origin'

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function installDb(): void {
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
        askRemoval: false, instantRemove: false,
    } as unknown as Database
    selectedCharID.set(0)
}

function liveOwner(): CharacterFixture {
    return DBState.db.characters[0]
}

function liveChat(): Chat {
    return liveOwner().chats[0]
}

interface Seen {
    signal: AbortSignal | null
    isUnit: boolean
    target: { chaId: string, chatId: string } | null
}

/** Runs the real send once; the provider call records what the published unit says about the signal it receives. */
async function sendOnce(): Promise<Seen> {
    const seen: Seen = { signal: null, isUnit: false, target: null }
    requestChatDataMock.mockImplementationOnce(async (_arg: unknown, _model: string, signal: AbortSignal) => {
        seen.signal = signal
        seen.isUnit = isUnitInProgressSignal(signal)
        seen.target = unitTargetOfSignal(signal)
        return { type: 'fail', result: 'stop here' }
    })
    const origin = originOf(liveOwner(), liveChat())
    if (!origin) {
        throw new Error('the fixture chat has no origin')
    }
    await sendChatMain({ origin, originHint: { owner: liveOwner(), chat: liveChat() } })
    return seen
}

//#endregion

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'fail', result: 'unexpected request' })
    composerDrafts.resetComposerDraftsForTests()
    resetComposerActionsForTests()
    doingChat.set(false)
    installDb()
})

afterEach(() => {
    selectedCharID.set(-1)
})

describe('the signal a real send hands the provider layer', () => {
    // V-5 (compatibility guard, base API only): the provider call receives the published unit's own signal, so the
    // page Stop (`abortUnitInProgress`) aborts exactly the signal the provider layer holds.
    test('guard: the main request receives the published unit signal and the page Stop aborts it', async () => {
        let abortedByStop = false
        requestChatDataMock.mockImplementationOnce(async (_arg: unknown, _model: string, signal: AbortSignal) => {
            abortUnitInProgress()
            abortedByStop = signal.aborted
            return { type: 'fail', result: 'stop here' }
        })
        const origin = originOf(liveOwner(), liveChat())!
        await sendChatMain({ origin, originHint: { owner: liveOwner(), chat: liveChat() } })

        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect(abortedByStop).toBe(true)
    })

    // V-6 (guard; base lacks `unitTargetOfSignal`, so it is not a reproducer): the unit is published with the chat
    // the keep-alive notice names, and that target is read through the very signal the provider call receives.
    test('a real send publishes the chat target with its signal', async () => {
        const seen = await sendOnce()

        expect(seen.signal).toBeInstanceOf(AbortSignal)
        expect(seen.isUnit).toBe(true)
        expect(seen.target).toEqual({ chaId: CHA_ID, chatId: CHAT_ID })
    })

    test('the unit and its target are withdrawn once the send has ended', async () => {
        const seen = await sendOnce()

        expect(isUnitInProgressSignal(seen.signal)).toBe(false)
        expect(unitTargetOfSignal(seen.signal)).toBeNull()
    })
})

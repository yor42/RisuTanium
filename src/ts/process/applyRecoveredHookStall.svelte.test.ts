/**
 * A hook that never settles cannot hold a recovered apply after a Stop. Drives the REAL `applyRecoveredReply` and
 * `applyRecoveredStreamReply` (`./index.svelte`) over a real rune database, with the module graph mocked as in
 * `applyRecoveredStreamReply.svelte.test.ts` (copied: each suite mocks its own graph).
 *
 * What it pins: the output trigger and the chat output listeners are raced on the unit's own signal, so the global Stop
 * ends the hook and the apply still finishes (the reply is already in the chat, so the outcome is `applied` and the save
 * is awaited); the unit, the registration and the deferral wake-up are released once the apply returns; and a throwing
 * hook without a Stop behaves as before.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Database, Chat, Message } from '../storage/database.svelte'
import '../polyfill'
import { heldReply, resetPageStateForTests, configurePageState, setReconcileTrigger } from '../nativeReply/pageState'

const requestChatDataMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const runInlayScreenMock = vi.hoisted(() => vi.fn())
const requestSaveNowMock = vi.hoisted(() => vi.fn())
const saveMarkCount = vi.hoisted(() => ({ value: 7 }))
const onScreen = vi.hoisted(() => ({ value: true }))
const replacerMock = vi.hoisted(() => vi.fn())
const chatOutputListeners = vi.hoisted(() => new Set<(arg: { messageIndex: number }) => unknown>())
const saveInlayedSignatureMock = vi.hoisted(() => vi.fn())
const registerWorkFault = vi.hoisted(() => ({ armed: false }))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (value: string) => value } }))
vi.mock(import('../platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('../platform'))
vi.mock(import('../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
        ReloadChatPointer: writable({} as Record<number, number>), ReloadGUIPointer: writable(0), CurrentTriggerIdStore: writable(null),
    } as unknown as typeof import('../stores.svelte')
})
vi.mock(import('../storage/database.svelte'), async () => {
    const stores = await import('../stores.svelte')
    const live = stores.DBState as unknown as { db: unknown }
    return {
        appVer: '0.0.0', changeToPreset: vi.fn(), setCurrentChat: vi.fn(), getDatabase: vi.fn(() => live.db), presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../storage/database.svelte')
})
vi.mock(import('../tokenizer'), () => ({
    ChatTokenizer: class { constructor(_extra: number, _mode: string) {} async tokenizeChat(_chat: unknown) { return 1 } },
    tokenize: vi.fn(async () => 1), tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('../tokenizer'))
vi.mock(import('../alert'), () => ({ alertError: vi.fn(), alertToast: vi.fn() }) as unknown as typeof import('../alert'))
vi.mock(import('../parser/chatML'), () => ({ parseChatML: vi.fn(() => []) }) as unknown as typeof import('../parser/chatML'))
vi.mock(import('./lorebook.svelte'), () => ({ loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })) }) as unknown as typeof import('./lorebook.svelte'))
vi.mock(import('../util'), () => ({
    findCharacterbyId: () => undefined, getAuthorNoteDefaultText: vi.fn(() => ''), getPersonaPrompt: vi.fn(() => ''), getUserName: vi.fn(() => 'User'),
    getUserIcon: vi.fn(() => ''), checkPersonaBinded: vi.fn(() => false), pickHashRand: vi.fn(() => 0.5), replaceAsync: vi.fn(), asBuffer: vi.fn(),
    selectSingleFile: vi.fn(), BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
    isLastCharPunctuation: vi.fn(() => false), trimUntilPunctuation: vi.fn((s: string) => s.replace(/[^.]*$/, '')),
    parseToggleSyntax: vi.fn(() => []), prebuiltAssetCommand: vi.fn(() => ''), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}) as unknown as typeof import('../util'))
vi.mock(import('./request/request'), () => ({ requestChatData: requestChatDataMock, requestChatDataMain: vi.fn() }) as unknown as typeof import('./request/request'))
vi.mock(import('./stableDiff'), () => ({ stableDiff: vi.fn(), generateAIImage: vi.fn(async () => null) }) as unknown as typeof import('./stableDiff'))
vi.mock(import('./scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: processScriptFullMock,
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('./scripts'))
vi.mock(import('./exampleMessages'), () => ({ exampleMessage: vi.fn(() => []) }) as unknown as typeof import('./exampleMessages'))
vi.mock(import('./tts'), () => ({ sayTTS: sayTTSMock }) as unknown as typeof import('./tts'))
vi.mock(import('./memory/supaMemory'), () => ({ supaMemory: vi.fn() }) as unknown as typeof import('./memory/supaMemory'))
vi.mock(import('./group'), () => ({ groupOrder: vi.fn((order: unknown) => order) }) as unknown as typeof import('./group'))
vi.mock(import('./triggers'), () => ({ runTrigger: runTriggerMock }) as unknown as typeof import('./triggers'))
vi.mock(import('./memory/hypamemory'), () => ({ HypaProcesser: class {} }) as unknown as typeof import('./memory/hypamemory'))
vi.mock(import('./embedding/addinfo'), () => ({ additionalInformations: vi.fn(async () => '') }) as unknown as typeof import('./embedding/addinfo'))
vi.mock(import('./files/inlays'), () => ({ getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), saveInlayedSignature: saveInlayedSignatureMock }) as unknown as typeof import('./files/inlays'))
vi.mock(import('./models/modelString'), () => ({ getGenerationModelString: vi.fn(() => undefined) }) as unknown as typeof import('./models/modelString'))
vi.mock(import('./inlayScreen'), () => ({ runInlayScreen: runInlayScreenMock }) as unknown as typeof import('./inlayScreen'))
vi.mock(import('./prereroll'), () => ({ renameContinuedMessage: vi.fn(), addRerolls: vi.fn() }) as unknown as typeof import('./prereroll'))
vi.mock(import('./transformers'), () => ({ runImageEmbedding: vi.fn(), runVITS: vi.fn() }) as unknown as typeof import('./transformers'))
vi.mock(import('./memory/hanuraiMemory'), () => ({ hanuraiMemory: vi.fn() }) as unknown as typeof import('./memory/hanuraiMemory'))
vi.mock(import('./memory/hypav2'), () => ({ hypaMemoryV2: vi.fn() }) as unknown as typeof import('./memory/hypav2'))
vi.mock(import('./scriptings'), () => ({ runLuaEditTrigger: vi.fn(async (_c: unknown, _t: string, formated: unknown) => formated) }) as unknown as typeof import('./scriptings'))
vi.mock(import('../model/modellist'), () => ({ getModelInfo: vi.fn(() => ({ id: 'test-model', flags: [] })), LLMFlags: {} }) as unknown as typeof import('../model/modellist'))
vi.mock(import('./memory/hypav3'), () => ({ hypaMemoryV3: vi.fn() }) as unknown as typeof import('./memory/hypav3'))
vi.mock(import('./modules'), () => ({
    getModuleAssets: vi.fn(() => []), getModuleToggles: vi.fn(() => ''), getModuleLorebooks: vi.fn(() => []), getModuleTriggers: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []), getModules: vi.fn(() => []),
}) as unknown as typeof import('./modules'))
vi.mock(import('../globalApi.svelte'), () => ({
    readImage: vi.fn(), fetchNative: vi.fn(), getFileSrc: vi.fn(async () => ''), aiWatermarkingLawApplies: vi.fn(() => false), globalFetch: vi.fn(),
    loadAsset: vi.fn(), forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    getSaveMarkCount: () => saveMarkCount.value, requestSaveNow: requestSaveNowMock,
}) as unknown as typeof import('../globalApi.svelte'))
vi.mock(import('../translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false), translate: vi.fn(async () => ''), runTranslator: vi.fn(async (text: string) => text),
    translateWholeText: vi.fn(), translateVox: vi.fn(async (text: string) => text), getLLMCache: vi.fn(), searchLLMCache: vi.fn(),
}) as unknown as typeof import('../translator/translator'))
vi.mock(import('../plugins/plugins.svelte'), () => ({
    allowedDbKeys: [], customProviderStore: { providers: new Map() }, getV2PluginAPIs: () => ({}),
    pluginV2: { providers: new Map(), chatOutput: chatOutputListeners, replacerafterRequest: [replacerMock] },
}) as unknown as typeof import('../plugins/plugins.svelte'))
vi.mock(import('../gui/colorscheme'), () => ({ changeColorScheme: vi.fn(), updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }) as unknown as typeof import('../gui/colorscheme'))
vi.mock(import('./mcp/pluginmcp'), () => ({ registerMCPModule: vi.fn(), unregisterMCPModule: vi.fn() }) as unknown as typeof import('./mcp/pluginmcp'))
vi.mock(import('./coldstorage.svelte'), () => ({ setColdStorageItem: vi.fn(), readColdStorageItem: vi.fn() }) as unknown as typeof import('./coldstorage.svelte'))
vi.mock('./coldMemberRestore', () => ({ restoreColdCharacterByChaId: vi.fn(async () => false) }))
vi.mock(import('./chatOnScreen.svelte'), () => ({ isChatOnScreen: vi.fn(() => onScreen.value) }) as unknown as typeof import('./chatOnScreen.svelte'))
vi.mock(import('../storage/characterSaveMarks'), () => ({ markCharacterForSave: vi.fn() }) as unknown as typeof import('../storage/characterSaveMarks'))
// The real registry, except that an armed fault makes the next registration throw once.
vi.mock('./chatOrigin', async (importOriginal) => {
    const original = await importOriginal<typeof import('./chatOrigin')>()
    return {
        ...original,
        registerWork: (...args: Parameters<typeof original.registerWork>) => {
            if(registerWorkFault.armed){
                registerWorkFault.armed = false
                throw new Error('register')
            }
            return original.registerWork(...args)
        },
    }
})


import { applyRecoveredReply, applyRecoveredStreamReply } from './index.svelte'
import { activeUnits } from './activeUnits'
import { hasAnyWork, isWriting } from './chatOrigin'
import { abortChat } from './composerActions.svelte'
import { DBState } from '../stores.svelte'
import { markCharacterForSave } from '../storage/characterSaveMarks'
import { createUsageMeter } from '../usage/usageMeter'
import { encodeStreamReplyBlob, type ReplyBlobBase, decodeReplyBlob, type StreamReplyBlob } from '../nativeReply/blob'
import type { RecoveredStreamInput } from '../nativeReply/reconcile'
import type { ReplyBlob } from '../nativeReply/blob'
import type { CharacterVerdict } from '../nativeReply/characterSaved'
import type { TokenUsage } from '../usage/usageTypes'
import type { GeminiSignatureRecord } from '../nativeReply/streamReplay'
import { LLMFormat } from '../model/types'
import { simulateRunningSend, clearRunningSends } from './tests/activeUnits.test-helpers'

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const TARGET = { chaId: 'cha', chatId: 'chat' }
const ELSEWHERE = { chaId: 'other-cha', chatId: 'other-chat' }
const base: ReplyBlobBase = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: KEY, model: 'm' }, promptInfo: { promptName: 'Main' }, escape: false, requestedMs: 1,
}
function streamBlob(escape = false): StreamReplyBlob {
    const text = encodeStreamReplyBlob({ ...base, escape }, { kind: 'openai-chat-stream', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }, { modelKey: 'gpt-4o', inputEstimate: 120 })
    const decoded = decodeReplyBlob(text, 1)
    if (!('blob' in decoded) || decoded.blob.parse.kind !== 'openai-chat-stream') {
        throw new Error('the fixture blob must decode as a stream blob')
    }
    return decoded.blob as StreamReplyBlob
}
const reportedUsage: TokenUsage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }

function input(extra: Partial<RecoveredStreamInput> & { reported?: TokenUsage | null } = {}): RecoveredStreamInput {
    const meter = createUsageMeter()
    const reported = extra.reported === undefined ? reportedUsage : extra.reported
    if (reported !== null) {
        meter.report(reported)
    }
    const { reported: _reported, ...rest } = extra
    return { key: KEY, blob: streamBlob(), modelText: 'Hello, world.', complete: true, outcome: 'done', meter, how: 'finished', signatures: [], ...rest }
}

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}
/** The chat: the page's own interrupted partial of the reply sits at index 1 by default. */
const interruptedPartial = () => msg('char', 'Hel', { chatId: KEY, interrupted: true })
function installDb(extraChar: Record<string, unknown> = {}, messages: Message[] = [msg('user', 'hi'), interruptedPartial()], overrides: Record<string, unknown> = {}): Chat {
    const chat = { id: 'chat', note: '', name: '', localLore: [], fmIndex: -1, message: messages, scriptstate: {} } as unknown as Chat
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        characterOrder: ['cha'], statics: { messages: 0 },
        characters: [{
            chaId: 'cha', name: 'Alice', type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [], desc: 'd', bias: [],
            utilityBot: false, inlayViewScreen: false, reloadKeys: 0, supaMemory: false, ttsMode: 'webspeech', chats: [chat], ...extraChar,
        }],
        aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500, bias: [], promptInfoInsideChat: false, autoContinueMinTokens: 10,
        autoContinueChat: true, igpPrompt: 'igp', removeIncompleteResponse: false, ttsAutoSpeech: true, username: 'User', ...overrides,
    } as unknown as Database
    return DBState.db.characters[0].chats[0]
}
const liveChat = (): Chat => DBState.db.characters[0].chats[0]
const ledger = (): Record<string, unknown> => DBState.db.statics as unknown as Record<string, unknown>
const usageKeys = (): string[] => Object.keys(ledger()).filter((key) => key.startsWith('u1|'))
/** The count of attempts the ledger holds for the model of the blob. */
const usageCount = (model = 'gpt-4o'): number => usageKeys()
    .filter((key) => key.endsWith(`|chat|n|${model}`))
    .reduce((sum, key) => sum + (ledger()[key] as number), 0)
const flush = async () => { for (let i = 0; i < 5; i++) { await Promise.resolve() } }

/** A waiter whose commits the test drives: `commit` runs the callbacks that asked to hear the next commit. */
function installWaiter() {
    const state = { committed: 0, verdict: 'saved' as CharacterVerdict, callbacks: [] as Array<() => void>, markCharacter: vi.fn(), requestSaveNow: vi.fn() }
    const consume = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
    configurePageState({
        store: { consume },
        waiter: {
            committedMarkCount: () => state.committed, markCount: () => saveMarkCount.value, verdict: () => state.verdict,
            afterNextCommit: (callback) => { if (!state.callbacks.includes(callback)) { state.callbacks.push(callback) } },
            markCharacter: state.markCharacter, requestSaveNow: state.requestSaveNow,
        },
        onUnreadable: () => {},
    })
    const commit = async (committed: number, verdict: CharacterVerdict) => {
        state.committed = committed
        state.verdict = verdict
        const due = state.callbacks.splice(0)
        for (const callback of due) { callback() }
        await flush()
    }
    return { consume, commit, state }
}

beforeEach(() => {
    vi.clearAllMocks()
    chatOutputListeners.clear()
    resetPageStateForTests()
    configurePageState({
        store: { consume: vi.fn(async () => ({ result: 'removed' as const, flushed: true })) },
        waiter: { committedMarkCount: () => 0, markCount: () => saveMarkCount.value, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
        onUnreadable: () => {},
    })
    onScreen.value = true
    saveMarkCount.value = 7
    clearRunningSends()
    registerWorkFault.armed = false
    vi.mocked(markCharacterForSave).mockImplementation(() => { saveMarkCount.value += 1 })
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    runTriggerMock.mockResolvedValue(null)
    runInlayScreenMock.mockImplementation((_char: unknown, text: string) => ({ text: `[emotion]${text}` }))
    replacerMock.mockImplementation(async (text: string) => `[replaced]${text}`)
    saveInlayedSignatureMock.mockReset()
    saveInlayedSignatureMock.mockResolvedValue('')
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

const REPLY_BLOB: ReplyBlob = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: KEY, model: 'm' }, promptInfo: { promptName: 'Main' }, escape: false, requestedMs: 1,
    parse: { kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false },
}
const replyInput = () => ({ key: KEY, blob: REPLY_BLOB, text: 'the recovered reply' })
const hang = () => new Promise<never>(() => {})
const settleTimers = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a hook that never settles in a recovered apply', () => {
    test('AP-1: a hanging chat output listener is abandoned by the Stop: applied, held for the save, unit and registration released', async () => {
        installDb({}, [msg('user', 'hi')])
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const listener = vi.fn(hang)
        chatOutputListeners.add(listener)

        let done = false
        const run = applyRecoveredReply(replyInput()).then((outcome) => { done = true; return outcome })
        await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
        await settleTimers()
        expect(done).toBe(false)
        abortChat()
        await settleTimers()
        expect(done).toBe(true)

        expect(await run).toBe('applied')
        expect(liveChat().message.map((m) => m.data)).toEqual(['hi', 'the recovered reply'])
        expect(heldReply(KEY)).toBeDefined()
        expect(activeUnits.any()).toBe(false)
        expect(hasAnyWork()).toBe(false)
    })

    test('AP-2: a hanging output trigger is abandoned by the Stop, and no listener runs after it', async () => {
        installDb({}, [msg('user', 'hi')])
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const listener = vi.fn()
        chatOutputListeners.add(listener)
        runTriggerMock.mockImplementation(hang)

        let done = false
        const run = applyRecoveredReply(replyInput()).then((outcome) => { done = true; return outcome })
        await vi.waitFor(() => expect(runTriggerMock).toHaveBeenCalledTimes(1))
        await settleTimers()
        expect(done).toBe(false)
        abortChat()
        await settleTimers()
        expect(done).toBe(true)

        expect(await run).toBe('applied')
        expect(heldReply(KEY)).toBeDefined()
        expect(activeUnits.any()).toBe(false)
        expect(hasAnyWork()).toBe(false)
        expect(listener).not.toHaveBeenCalled()
    })

    test('AP-3: the stream apply abandons a hanging output trigger, and a hanging listener, on the Stop', async () => {
        installDb()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        runTriggerMock.mockImplementation(hang)
        let firstDone = false
        const first = applyRecoveredStreamReply(input()).then((outcome) => { firstDone = true; return outcome })
        await vi.waitFor(() => expect(runTriggerMock).toHaveBeenCalledTimes(1))
        abortChat()
        await settleTimers()
        expect(firstDone).toBe(true)
        expect(await first).toBe('applied')
        expect(heldReply(KEY)).toBeDefined()
        expect(activeUnits.any()).toBe(false)
        expect(hasAnyWork()).toBe(false)

        installDb()
        resetPageStateForTests()
        runTriggerMock.mockResolvedValue(null)
        const listener = vi.fn(hang)
        chatOutputListeners.add(listener)
        let secondDone = false
        const second = applyRecoveredStreamReply(input()).then((outcome) => { secondDone = true; return outcome })
        await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
        abortChat()
        await settleTimers()
        expect(secondDone).toBe(true)
        expect(await second).toBe('applied')
        expect(activeUnits.any()).toBe(false)
        expect(hasAnyWork()).toBe(false)
    })

    test('AP-4: an apply deferred during the hang is woken once, after the Stop ends the hung apply', async () => {
        installDb({}, [msg('user', 'hi')])
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const reconcile = vi.fn()
        setReconcileTrigger(reconcile)
        const listener = vi.fn(hang)
        chatOutputListeners.add(listener)

        let done = false
        const run = applyRecoveredReply(replyInput()).then((outcome) => { done = true; return outcome })
        await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
        expect(await applyRecoveredReply(replyInput())).toBe('deferred')
        expect(reconcile).not.toHaveBeenCalled()
        abortChat()
        await settleTimers()
        expect(done).toBe(true)

        expect(await run).toBe('applied')
        expect(reconcile).toHaveBeenCalledTimes(1)
        expect(activeUnits.any()).toBe(false)
    })

    test('AP-7: guard, with no Stop a throwing listener is logged and the next one still runs; a rejecting trigger leaves the reply applied', async () => {
        installDb({}, [msg('user', 'hi')])
        const thrown = new Error('listener')
        const second = vi.fn()
        chatOutputListeners.add(() => { throw thrown })
        chatOutputListeners.add(second)

        expect(await applyRecoveredReply(replyInput())).toBe('applied')
        expect(second).toHaveBeenCalledWith(expect.objectContaining({ messageIndex: 1 }))
        expect(console.error).toHaveBeenCalledWith(thrown)

        installDb({}, [msg('user', 'hi')])
        resetPageStateForTests()
        runTriggerMock.mockRejectedValue(new Error('trigger'))
        expect(await applyRecoveredReply(replyInput())).toBe('applied')
        expect(liveChat().message).toHaveLength(2)
    })
})

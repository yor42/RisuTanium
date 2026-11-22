/**
 * Drives the REAL `applyRecoveredStreamReply` (`./index.svelte`) over a real rune database, with the module graph
 * mocked as in `applyRecoveredReply.svelte.test.ts` (copied: each suite mocks its own graph). The usage ledger, the usage
 * capture and the page state are real; the waiter is a fake whose commits the test drives.
 *
 * What it pins: the upgrade of a present interrupted message (`interrupted` re-checked where it writes), the hold of a
 * present one (never a consume by the apply), the append of an absent one, the stream branch's text order (trim before the
 * scripts, no escape, no replacers, no trim after), the partial rules (text only, `interrupted` kept), the `doingChat`
 * exclusion, the target read after the mark, consume only after a covering commit, and one ledger entry per applied record
 * from the blob's model. Mutants M13 (no re-check), M14 (ignores doingChat), M15 (consume instead of hold), M16 (target
 * before the mark), M17 (usage on present), M19 (model from settings), M20 (escape), M21 (trim after), M22/M23 (flag and
 * trigger of a partial), M29a (consume directly on present).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from '../storage/database.svelte'
import '../polyfill'
import { heldReply, resetPageStateForTests, configurePageState } from '../nativeReply/pageState'

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
vi.mock(import('./files/inlays'), () => ({ getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined) }) as unknown as typeof import('./files/inlays'))
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


import { applyRecoveredStreamReply, doingChat } from './index.svelte'
import { DBState } from '../stores.svelte'
import { markCharacterForSave } from '../storage/characterSaveMarks'
import { createUsageMeter } from '../usage/usageMeter'
import { encodeStreamReplyBlob, type ReplyBlobBase, decodeReplyBlob, type StreamReplyBlob } from '../nativeReply/blob'
import type { RecoveredStreamInput } from '../nativeReply/reconcile'
import type { CharacterVerdict } from '../nativeReply/characterSaved'
import type { TokenUsage } from '../usage/usageTypes'

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
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
    return { key: KEY, blob: streamBlob(), modelText: 'Hello, world.', complete: true, outcome: 'done', meter, how: 'finished', ...rest }
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
    doingChat.set(false)
    vi.mocked(markCharacterForSave).mockImplementation(() => { saveMarkCount.value += 1 })
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    runTriggerMock.mockResolvedValue(null)
    runInlayScreenMock.mockImplementation((_char: unknown, text: string) => ({ text: `[emotion]${text}` }))
    replacerMock.mockImplementation(async (text: string) => `[replaced]${text}`)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('an interrupted message that is present (the upgrade)', () => {
    test('replaces the text with the editoutput of the trimmed reply, clears interrupted, and runs the chain once', async () => {
        installDb()
        const listener = vi.fn()
        chatOutputListeners.add(listener)
        expect(await applyRecoveredStreamReply(input({ modelText: '  Hello, world.  ' }))).toBe('applied')
        const messages = liveChat().message
        expect(messages).toHaveLength(2)
        expect(messages[1].data).toBe('Hello, world.')
        expect(messages[1].interrupted).toBeUndefined()
        expect(messages[1].chatId).toBe(KEY)
        expect(processScriptFullMock).toHaveBeenCalledTimes(1)
        expect(processScriptFullMock).toHaveBeenCalledWith(expect.anything(), 'Hello, world.', 'editoutput', 1, {}, undefined, expect.anything(), { message: messages[1], index: 1 }, undefined, 'bypass')
        expect(runTriggerMock).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ messageIndex: 1 }))
        expect(sayTTSMock).not.toHaveBeenCalled()
        expect(requestChatDataMock).not.toHaveBeenCalled()
    })

    test('marks the character, and holds for the save at the mark count read after the mark', async () => {
        installDb()
        saveMarkCount.value = 12
        await applyRecoveredStreamReply(input())
        expect(markCharacterForSave).toHaveBeenCalledWith('cha')
        const entry = heldReply(KEY)
        expect(entry).toMatchObject({ state: 'awaiting-save' })
        // Every mark bumps the count here; a target read before the final mark would be lower than the count now.
        expect(entry?.target).toBe(saveMarkCount.value)
        expect(requestSaveNowMock).not.toHaveBeenCalled()
    })

    test('the stream branch order: trim before the scripts, no escape, no replacers, bypass cache, no trim after', async () => {
        installDb({}, [msg('user', 'hi'), interruptedPartial()], { removeIncompleteResponse: true })
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: `  ${text} <`, emoChanged: false }))
        await applyRecoveredStreamReply({ ...input({ modelText: '  One. Two' }), blob: streamBlob(true) })
        // trimUntilPunctuation('  One. Two') is '  One.'; the script input is that, trimmed.
        expect(processScriptFullMock.mock.calls[0][1]).toBe('One.')
        expect(processScriptFullMock.mock.calls[0][9]).toBe('bypass')
        expect(liveChat().message[1].data).toBe('  One. <')
        expect(replacerMock).not.toHaveBeenCalled()
    })

    test('the escape of the blob is not applied', async () => {
        installDb()
        await applyRecoveredStreamReply({ ...input({ modelText: '{{user}} said {{char}}' }), blob: streamBlob(true) })
        expect(processScriptFullMock.mock.calls[0][1]).toBe('{{user}} said {{char}}')
    })

    test('the emotion rewrite applies after the trigger; an image generation tag is left as it came', async () => {
        installDb({ inlayViewScreen: true, viewScreen: 'emotion' })
        const order: string[] = []
        runTriggerMock.mockImplementation(async () => { order.push('trigger'); return null })
        runInlayScreenMock.mockImplementation((_char: unknown, text: string) => { order.push('inlay'); return { text: `[emotion]${text}` } })
        await applyRecoveredStreamReply(input())
        expect(order).toEqual(['trigger', 'inlay'])
        expect(liveChat().message[1].data).toBe('[emotion]Hello, world.')

        installDb({ inlayViewScreen: true, viewScreen: 'imggen' })
        runInlayScreenMock.mockClear()
        await applyRecoveredStreamReply(input({ modelText: '<ImgGen="a cat">' }))
        expect(runInlayScreenMock).not.toHaveBeenCalled()
        expect(liveChat().message[1].data).toBe('<ImgGen="a cat">')
    })

    test('a chat that is not on screen gets the unseen mark; one on screen does not', async () => {
        installDb()
        await applyRecoveredStreamReply(input())
        expect(liveChat().unseenReply).toBeUndefined()
        installDb()
        onScreen.value = false
        await applyRecoveredStreamReply(input())
        expect(liveChat().unseenReply).toBe('reply')
    })

    test('an error after the write still awaits the save and counts the usage', async () => {
        installDb()
        runTriggerMock.mockRejectedValue(new Error('trigger'))
        expect(await applyRecoveredStreamReply(input())).toBe('applied')
        expect(liveChat().message[1].data).toBe('Hello, world.')
        expect(heldReply(KEY)?.state).toBe('awaiting-save')
        expect(usageCount()).toBe(1)
    })

    test('an error before the write keeps the record: failed, nothing written, no hold, no usage', async () => {
        installDb()
        processScriptFullMock.mockRejectedValue(new Error('script'))
        expect(await applyRecoveredStreamReply(input())).toBe('failed')
        expect(liveChat().message[1].data).toBe('Hel')
        expect(liveChat().message[1].interrupted).toBe(true)
        expect(heldReply(KEY)).toBeUndefined()
        expect(usageKeys()).toEqual([])
    })

    test('the flag is checked again where it writes: an edit during the awaits is never overwritten', async () => {
        installDb()
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => {
            delete liveChat().message[1].interrupted
            liveChat().message[1].data = 'edited by the person'
            return { data: text, emoChanged: false }
        })
        expect(await applyRecoveredStreamReply(input())).toBe('present')
        expect(liveChat().message[1].data).toBe('edited by the person')
        expect(runTriggerMock).not.toHaveBeenCalled()
        expect(usageKeys()).toEqual([])
        // It is held like the step-2 present path.
        expect(heldReply(KEY)).toMatchObject({ state: 'awaiting-save' })
    })

    test('a message that vanished during the awaits defers: the next pass appends', async () => {
        installDb()
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => {
            liveChat().message.splice(1, 1)
            return { data: text, emoChanged: false }
        })
        expect(await applyRecoveredStreamReply(input())).toBe('deferred')
        expect(liveChat().message).toHaveLength(1)
        expect(heldReply(KEY)).toBeUndefined()
        expect(usageKeys()).toEqual([])
    })
})

describe('a message that is present and not interrupted', () => {
    test('is marked and held for the save, written nowhere, counted nowhere', async () => {
        installDb({}, [msg('user', 'hi'), msg('char', 'Hello, world.', { chatId: KEY })])
        saveMarkCount.value = 12
        expect(await applyRecoveredStreamReply(input())).toBe('present')
        expect(liveChat().message[1].data).toBe('Hello, world.')
        expect(processScriptFullMock).not.toHaveBeenCalled()
        expect(runTriggerMock).not.toHaveBeenCalled()
        expect(usageKeys()).toEqual([])
        expect(markCharacterForSave).toHaveBeenCalledWith('cha')
        const entry = heldReply(KEY)
        expect(entry).toMatchObject({ state: 'awaiting-save' })
        expect(entry?.target).toBe(saveMarkCount.value)
    })

    test('a second pass over an upgraded message is the same present path and adds no usage', async () => {
        installDb()
        await applyRecoveredStreamReply(input())
        expect(await applyRecoveredStreamReply(input())).toBe('present')
        expect(usageCount()).toBe(1)
    })
})

describe('an absent message (the append)', () => {
    test('is appended once with the key as its id and the blob facts, and no interrupted flag', async () => {
        installDb({}, [msg('user', 'hi')])
        const listener = vi.fn()
        chatOutputListeners.add(listener)
        expect(await applyRecoveredStreamReply(input())).toBe('applied')
        const messages = liveChat().message
        expect(messages).toHaveLength(2)
        expect(messages[1]).toMatchObject({ role: 'char', data: 'Hello, world.', saying: 'cha', chatId: KEY, generationInfo: base.generationInfo, promptInfo: base.promptInfo })
        expect(messages[1].interrupted).toBeUndefined()
        expect(processScriptFullMock).toHaveBeenCalledWith(expect.anything(), 'Hello, world.', 'editoutput', 1, {}, undefined, expect.anything(), null, undefined, 'bypass')
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ messageIndex: 1 }))
        // The same record applied again finds its message and is present.
        expect(await applyRecoveredStreamReply(input())).toBe('present')
        expect(liveChat().message).toHaveLength(2)
    })

    test('a chat off screen gets the unseen mark; nothing on screen', async () => {
        installDb({}, [msg('user', 'hi')])
        onScreen.value = false
        await applyRecoveredStreamReply(input())
        expect(liveChat().unseenReply).toBe('reply')
    })

    test('a message that appeared during the awaits is held as present, not written twice', async () => {
        installDb({}, [msg('user', 'hi')])
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => {
            liveChat().message.push(msg('char', 'placed elsewhere', { chatId: KEY }))
            return { data: text, emoChanged: false }
        })
        expect(await applyRecoveredStreamReply(input())).toBe('present')
        expect(liveChat().message).toHaveLength(2)
        expect(liveChat().message[1].data).toBe('placed elsewhere')
        expect(heldReply(KEY)).toMatchObject({ state: 'awaiting-save' })
        expect(usageKeys()).toEqual([])
    })
})

describe('a partial (a prefix of a body)', () => {
    test('an upgrade writes the editoutput text only, keeps interrupted, runs no trigger or listener, counts the usage once', async () => {
        installDb()
        const listener = vi.fn()
        chatOutputListeners.add(listener)
        expect(await applyRecoveredStreamReply(input({ complete: false, outcome: 'dead', modelText: 'Hello, wor' }))).toBe('applied')
        expect(liveChat().message[1].data).toBe('Hello, wor')
        expect(liveChat().message[1].interrupted).toBe(true)
        expect(processScriptFullMock).toHaveBeenCalledTimes(1)
        expect(runTriggerMock).not.toHaveBeenCalled()
        expect(listener).not.toHaveBeenCalled()
        expect(runInlayScreenMock).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toMatchObject({ state: 'awaiting-save' })
        expect(usageCount()).toBe(1)
    })

    test('an append is pushed interrupted, and off screen it gets the unseen mark', async () => {
        installDb({ inlayViewScreen: true, viewScreen: 'emotion' }, [msg('user', 'hi')])
        onScreen.value = false
        await applyRecoveredStreamReply(input({ complete: false, outcome: 'incomplete', modelText: 'Hello, wor' }))
        expect(liveChat().message[1]).toMatchObject({ data: 'Hello, wor', interrupted: true, chatId: KEY })
        expect(liveChat().unseenReply).toBe('reply')
        expect(runTriggerMock).not.toHaveBeenCalled()
        expect(runInlayScreenMock).not.toHaveBeenCalled()
    })
})

describe('the exclusion', () => {
    test('a running send defers: nothing is written, held or counted, and the flag stays the sender\'s', async () => {
        installDb()
        doingChat.set(true)
        expect(await applyRecoveredStreamReply(input({ complete: false, outcome: 'dead' }))).toBe('deferred')
        expect(liveChat().message[1]).toMatchObject({ data: 'Hel', interrupted: true })
        expect(heldReply(KEY)).toBeUndefined()
        expect(usageKeys()).toEqual([])
        expect(processScriptFullMock).not.toHaveBeenCalled()
        const { get } = await import('svelte/store')
        expect(get(doingChat)).toBe(true)
        doingChat.set(false)
        await applyRecoveredStreamReply(input())
        expect(get(doingChat)).toBe(false)
    })

    test('a missing chat is a failure that writes nothing', async () => {
        installDb()
        DBState.db.characters[0].chats = []
        expect(await applyRecoveredStreamReply(input())).toBe('failed')
        expect(heldReply(KEY)).toBeUndefined()
    })
})

describe('consume only after a covering commit', () => {
    async function target(): Promise<number> {
        return heldReply(KEY)?.target ?? -1
    }

    test.each([
        ['an upgrade', () => installDb(), async () => (await applyRecoveredStreamReply(input())) === 'applied'],
        ['a present message', () => installDb({}, [msg('user', 'hi'), msg('char', 'Hello, world.', { chatId: KEY })]), async () => (await applyRecoveredStreamReply(input())) === 'present'],
        ['a message edited during the awaits', () => installDb(), async () => {
            processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => {
                delete liveChat().message[1].interrupted
                return { data: text, emoChanged: false }
            })
            return (await applyRecoveredStreamReply(input())) === 'present'
        }],
    ])('%s: no consume before the covering commit, one after a saved one', async (_name, install, run) => {
        install()
        const waiter = installWaiter()
        expect(await run()).toBe(true)
        const t = await target()
        expect(t).toBeGreaterThan(0)
        expect(waiter.consume).not.toHaveBeenCalled()
        // A commit that does not cover the mark counted after the write.
        await waiter.commit(t - 1, 'saved')
        expect(waiter.consume).not.toHaveBeenCalled()
        // The commit covers it but kept the saved copy of the character.
        await waiter.commit(t, 'skipped')
        expect(waiter.consume).not.toHaveBeenCalled()
        // The commit did not name the character: one self request, still no consume.
        await waiter.commit(t, 'absent')
        expect(waiter.consume).not.toHaveBeenCalled()
        expect(waiter.state.requestSaveNow).toHaveBeenCalledTimes(1)
        await waiter.commit(saveMarkCount.value, 'saved')
        expect(waiter.consume).toHaveBeenCalledTimes(1)
        expect(waiter.consume).toHaveBeenCalledWith(KEY)
    })
})

describe('the usage of an applied record', () => {
    test('is one ledger entry from the blob, with the model of the blob and the reported counters', async () => {
        installDb({}, [msg('user', 'hi'), interruptedPartial()], { aiModel: 'claude-other' })
        await applyRecoveredStreamReply(input())
        expect(usageCount('gpt-4o')).toBe(1)
        expect(usageCount('claude-other')).toBe(0)
        const month = usageKeys()[0].split('|')[1]
        expect(ledger()[`u1|${month}|chat|i|gpt-4o`]).toBe(10)
        expect(ledger()[`u1|${month}|chat|o|gpt-4o`]).toBe(5)
    })

    test('an append counts once; a pass that finds the message counts nothing more', async () => {
        installDb({}, [msg('user', 'hi')])
        await applyRecoveredStreamReply(input())
        await applyRecoveredStreamReply(input())
        await applyRecoveredStreamReply(input())
        expect(usageCount()).toBe(1)
    })

    test('with no reported usage it is one estimate: the input of the blob, the output of the text', async () => {
        installDb()
        await applyRecoveredStreamReply(input({ reported: null }))
        await vi.waitFor(() => expect(usageCount()).toBe(1))
        const month = usageKeys()[0].split('|')[1]
        expect(ledger()[`u1|${month}|chat|ei|gpt-4o`]).toBe(120)
        expect(ledger()[`u1|${month}|chat|eo|gpt-4o`]).toBe(1)
    })

    test('a failed outcome with no reported usage counts nothing; with reported usage it counts', async () => {
        installDb()
        await applyRecoveredStreamReply(input({ reported: null, how: 'failed', complete: false, outcome: 'failed' }))
        await flush()
        expect(usageKeys()).toEqual([])
        installDb()
        await applyRecoveredStreamReply(input({ how: 'failed', complete: false, outcome: 'failed' }))
        expect(usageCount()).toBe(1)
    })

    test('a deferred or failed apply counts nothing', async () => {
        installDb()
        doingChat.set(true)
        await applyRecoveredStreamReply(input())
        doingChat.set(false)
        DBState.db.characters[0].chats = []
        await applyRecoveredStreamReply(input())
        await flush()
        expect(usageKeys()).toEqual([])
    })
})

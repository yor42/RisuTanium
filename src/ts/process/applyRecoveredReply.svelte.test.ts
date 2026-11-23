/**
 * T14 (guard, new rule): what `applyRecoveredReply` does and does not do when it places a reply the native side
 * received while the page could not see it. It runs the output scripts, the output trigger and the chat output
 * listeners, expands variables, sets the unseen mark off screen and waits for the save; it plays no sound, speaks
 * nothing, requests no further model call, honours no `sendAIprompt`, leaves image tags as they came and requests no save.
 *
 * Drives the REAL `applyRecoveredReply` (`./index.svelte`) over a real `$state` database. Every other module
 * `index.svelte.ts` imports is mocked as in `tests/sendChatTts.svelte.test.ts` (copied: each suite mocks its own
 * graph). Mutants M24 (speech or auto-continue on a recovered reply), M25 (`sendAIprompt` honoured).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Database, Chat, Message } from '../storage/database.svelte'
import '../polyfill'
import { heldReply, resetPageStateForTests, configurePageState, setReconcileTrigger } from '../nativeReply/pageState'
import type { ReplyBlob } from '../nativeReply/blob'

const requestChatDataMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const runInlayScreenMock = vi.hoisted(() => vi.fn())
const requestSaveNowMock = vi.hoisted(() => vi.fn())
const saveMarkCount = vi.hoisted(() => ({ value: 7 }))
const onScreen = vi.hoisted(() => ({ value: true }))
const chatOutputListeners = vi.hoisted(() => new Set<(arg: { messageIndex: number }) => unknown>())
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
    pluginV2: { providers: new Map(), chatOutput: chatOutputListeners },
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

import { applyRecoveredReply, doingChat, sendChat } from './index.svelte'
import { activeUnits } from './activeUnits'
import { hasAnyWork, isWriting } from './chatOrigin'
import { abortChat } from './composerActions.svelte'
import { DBState } from '../stores.svelte'
import { markCharacterForSave } from '../storage/characterSaveMarks'
import { simulateRunningSend, clearRunningSends } from './tests/activeUnits.test-helpers'

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const TARGET = { chaId: 'cha', chatId: 'chat' }
const ELSEWHERE = { chaId: 'other-cha', chatId: 'other-chat' }
const blob: ReplyBlob = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: KEY, model: 'm' }, promptInfo: { promptName: 'Main' }, escape: false, requestedMs: 1,
    parse: { kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false },
}
const input = (text = 'the recovered reply') => ({ key: KEY, blob, text })

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}
function installDb(extraChar: Record<string, unknown> = {}, messages: Message[] = [msg('char', 'Hello!'), msg('user', 'hi')], overrides: Record<string, unknown> = {}): Chat {
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
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    runTriggerMock.mockResolvedValue(null)
    runInlayScreenMock.mockImplementation((_char: unknown, text: string) => ({ text: `[emotion]${text}` }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('applyRecoveredReply', () => {
    test('appends the reply after the newer messages, once, with the blob facts and the key as its id', async () => {
        installDb()
        expect(await applyRecoveredReply(input())).toBe('applied')
        const messages = liveChat().message
        expect(messages.map((m) => m.data)).toEqual(['Hello!', 'hi', 'the recovered reply'])
        expect(messages[2]).toMatchObject({ role: 'char', saying: 'cha', chatId: KEY, generationInfo: blob.generationInfo, promptInfo: blob.promptInfo })
        // The same record applied again finds its message.
        expect(await applyRecoveredReply(input())).toBe('applied')
        expect(liveChat().message).toHaveLength(3)
    })

    test('runs the output scripts, the output trigger and the chat output listeners on the reply', async () => {
        installDb()
        const listener = vi.fn()
        chatOutputListeners.add(listener)
        await applyRecoveredReply(input('  spaced  '))
        expect(processScriptFullMock).toHaveBeenCalledWith(expect.anything(), 'spaced', 'editoutput', 2, {}, undefined, expect.anything(), null)
        expect(runTriggerMock).toHaveBeenCalledWith(expect.anything(), 'output', expect.objectContaining({ chat: expect.anything() }))
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ messageIndex: 2 }))
    })

    test('speaks nothing and asks for no further request, and ignores sendAIprompt', async () => {
        installDb()
        runTriggerMock.mockResolvedValue({ sendAIprompt: true })
        await applyRecoveredReply(input('short'))
        expect(sayTTSMock).not.toHaveBeenCalled()
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(liveChat().message).toHaveLength(3)
    })

    test('an image generation tag is left as it came; the emotion rewrite applies', async () => {
        installDb({ inlayViewScreen: true, viewScreen: 'imggen' })
        await applyRecoveredReply(input('<ImgGen="a cat">'))
        expect(runInlayScreenMock).not.toHaveBeenCalled()
        expect(liveChat().message[2].data).toBe('<ImgGen="a cat">')

        installDb({ inlayViewScreen: true, viewScreen: 'emotion' })
        await applyRecoveredReply(input('hello'))
        expect(liveChat().message[2].data).toBe('[emotion]hello')
    })

    test('a chat that is not on screen gets the unseen mark; one on screen does not', async () => {
        installDb()
        await applyRecoveredReply(input())
        expect(liveChat().unseenReply).toBeUndefined()
        installDb()
        onScreen.value = false
        await applyRecoveredReply(input())
        expect(liveChat().unseenReply).toBe('reply')
    })

    test('marks the character, awaits the save at the mark count after the mark, and requests no save', async () => {
        installDb()
        saveMarkCount.value = 12
        await applyRecoveredReply(input())
        expect(markCharacterForSave).toHaveBeenCalledWith('cha')
        expect(heldReply(KEY)).toMatchObject({ state: 'awaiting-save', target: 12 })
        expect(requestSaveNowMock).not.toHaveBeenCalled()
    })

    test('defers while a send runs in its chat, writes nothing, and gives the flag back after a run', async () => {
        installDb()
        simulateRunningSend(TARGET)
        expect(await applyRecoveredReply(input())).toBe('deferred')
        expect(liveChat().message).toHaveLength(2)
        clearRunningSends()
        await applyRecoveredReply(input())
        const { get } = await import('svelte/store')
        expect(get(doingChat)).toBe(false)
    })

    test('a missing chat is a failure that writes nothing', async () => {
        installDb()
        DBState.db.characters[0].chats = []
        expect(await applyRecoveredReply(input())).toBe('failed')
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('an error after the push still awaits the save', async () => {
        installDb()
        runTriggerMock.mockRejectedValue(new Error('trigger'))
        expect(await applyRecoveredReply(input())).toBe('applied')
        expect(liveChat().message).toHaveLength(3)
        expect(heldReply(KEY)?.state).toBe('awaiting-save')
    })

    test('an error before the push keeps the record: failed, no entry', async () => {
        installDb()
        processScriptFullMock.mockRejectedValue(new Error('script'))
        expect(await applyRecoveredReply(input())).toBe('failed')
        expect(liveChat().message).toHaveLength(2)
        expect(heldReply(KEY)).toBeUndefined()
    })
})

describe('the unit an apply holds', () => {
    interface ScriptGate {
        entered: Promise<void>
        open(): void
        fail(error: Error): void
    }

    /** Holds the output script of the next apply, so a test reads the registry while that apply runs. */
    function holdOutputScript(): ScriptGate {
        let enter!: () => void
        const entered = new Promise<void>((resolve) => { enter = resolve })
        let open!: () => void
        let fail!: (error: Error) => void
        const opened = new Promise<void>((resolve, reject) => { open = resolve; fail = reject })
        // A gate nobody opens (a test that stopped early) is not an unhandled rejection.
        opened.catch(() => {})
        processScriptFullMock.mockImplementationOnce(async (_char: unknown, text: string) => {
            enter()
            await opened
            return { data: text, emoChanged: false }
        })
        return { entered, open: () => open(), fail: (error) => fail(error) }
    }

    test('A9: a unit held in another chat does not defer an apply into this chat: it writes, holds its own chat and releases it, and leaves the other unit held', async () => {
        installDb()
        simulateRunningSend(ELSEWHERE)

        expect(await applyRecoveredReply(input())).toBe('applied')

        expect(liveChat().message.map((m) => m.data)).toEqual(['Hello!', 'hi', 'the recovered reply'])
        expect(heldReply(KEY)).toBeDefined()
        expect(activeUnits.has(TARGET)).toBe(false)
        expect(activeUnits.has(ELSEWHERE)).toBe(true)
    })

    test('A10 and A10b: a unit held in the target chat defers the apply: nothing is written, the holder keeps its chat, and no reconcile pass is asked for', async () => {
        installDb()
        const reconcile = vi.fn()
        setReconcileTrigger(reconcile)
        simulateRunningSend(TARGET)

        expect(await applyRecoveredReply(input())).toBe('deferred')

        expect(liveChat().message).toHaveLength(2)
        expect(heldReply(KEY)).toBeUndefined()
        expect(processScriptFullMock).not.toHaveBeenCalled()
        // The refused apply never took the chat, so it releases nothing and wakes nothing.
        expect(activeUnits.has(TARGET)).toBe(true)
        expect(reconcile).not.toHaveBeenCalled()
    })

    test('A8c: the unit that ends a send it deferred wakes the reconcile once, and an apply that never took the chat does not', async () => {
        installDb()
        const reconcile = vi.fn()
        setReconcileTrigger(reconcile)
        const gate = holdOutputScript()
        const run = applyRecoveredReply(input())
        try {
            await gate.entered
            expect(await applyRecoveredReply(input())).toBe('deferred')
            expect(reconcile).not.toHaveBeenCalled()
        } finally {
            gate.open()
        }

        expect(await run).toBe('applied')
        expect(reconcile).toHaveBeenCalledTimes(1)
        expect(activeUnits.any()).toBe(false)
    })

    test('A8: a registration that throws releases the unit, writes nothing and fails the apply', async () => {
        installDb()
        registerWorkFault.armed = true

        expect(await applyRecoveredReply(input())).toBe('failed')

        expect(liveChat().message).toHaveLength(2)
        expect(activeUnits.has(TARGET)).toBe(false)
        expect(activeUnits.any()).toBe(false)
        expect(hasAnyWork()).toBe(false)
        // A later apply into the chat is admitted.
        expect(await applyRecoveredReply(input())).toBe('applied')
    })

    test('A8b: a throw in the finally after the write still ends the registration, releases the unit and wakes the deferred apply once', async () => {
        installDb()
        const reconcile = vi.fn()
        setReconcileTrigger(reconcile)
        const gate = holdOutputScript()
        // Armed after the push, so the finally's mark is what throws.
        runTriggerMock.mockImplementationOnce(async () => {
            vi.mocked(markCharacterForSave).mockImplementationOnce(() => { throw new Error('mark') })
            return null
        })
        const run = applyRecoveredReply(input())
        const settled = run.then(() => 'resolved', (error: Error) => error.message)
        try {
            await gate.entered
            expect(await applyRecoveredReply(input())).toBe('deferred')
        } finally {
            gate.open()
        }

        expect(await settled).toBe('mark')
        expect(liveChat().message).toHaveLength(3)
        expect(activeUnits.has(TARGET)).toBe(false)
        expect(hasAnyWork()).toBe(false)
        expect(isWriting(TARGET)).toBe(false)
        expect(reconcile).toHaveBeenCalledTimes(1)
    })

    const finishes: Array<[string, (gate: ScriptGate) => void, string]> = [
        ['a normal write', (gate) => gate.open(), 'applied'],
        ['a script that fails', (gate) => gate.fail(new Error('script')), 'failed'],
        ['a chat that went away', (gate) => { DBState.db.characters[0].chats = []; gate.open() }, 'deferred'],
        ['a message another write placed first', (gate) => { liveChat().message.push(msg('char', 'placed elsewhere', { chatId: KEY })); gate.open() }, 'applied'],
    ]

    test.each(finishes)('G3: %s: the apply holds its own chat while it runs, refuses a send into that chat, and releases once it returns', async (_name, finish, expected) => {
        installDb()
        const gate = holdOutputScript()
        const run = applyRecoveredReply(input())
        try {
            await gate.entered
            expect(get(doingChat)).toBe(true)
            expect(activeUnits.has(TARGET)).toBe(true)
            expect(await applyRecoveredReply(input())).toBe('deferred')
            const sent = sendChat(-1, { origin: TARGET }).catch(() => 'threw')
            expect(requestChatDataMock).not.toHaveBeenCalled()
            let timer: ReturnType<typeof setTimeout> | undefined
            const hung = new Promise<string>((resolve) => { timer = setTimeout(() => resolve('hung'), 2000) })
            expect(await Promise.race([sent, hung])).toBe(false)
            clearTimeout(timer)
        } finally {
            finish(gate)
        }

        expect(await run).toBe(expected)
        expect(get(doingChat)).toBe(false)
        expect(activeUnits.any()).toBe(false)
    })

    // R9 (regression reproducer, MC-3743): the global Stop reaches a running apply, which defers before its write.
    test('R9: the global Stop defers a running apply before its write: nothing is pushed', async () => {
        installDb()
        const gate = holdOutputScript()
        const run = applyRecoveredReply(input())
        try {
            await gate.entered
            abortChat()
        } finally {
            gate.open()
        }

        expect(await run).toBe('deferred')
        expect(liveChat().message).toHaveLength(2)
        expect(heldReply(KEY)).toBeUndefined()
        expect(activeUnits.any()).toBe(false)
    })

    test('O2: a subscriber sees no registered work for the chat when the unit is taken and when it is released', async () => {
        installDb()
        const seen: Array<{ busy: boolean, writing: boolean }> = []
        const stop = doingChat.subscribe((busy) => { seen.push({ busy, writing: isWriting(TARGET) }) })
        try {
            expect(await applyRecoveredReply(input())).toBe('applied')
        } finally {
            stop()
        }

        expect(seen).toEqual([
            { busy: false, writing: false },
            { busy: true, writing: false },
            { busy: false, writing: false },
        ])
    })
})

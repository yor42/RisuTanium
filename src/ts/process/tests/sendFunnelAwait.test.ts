/**
 * `sendChat` waits for the module stubs its chat references before the body runs. The `doingChat` check and take stay
 * one synchronous stretch (the wait comes after the take), a failed load stops the send with one alert naming the module
 * and releases the flag and the unit, and the busy button aborts the wait silently. Drives the REAL `sendChat` with the
 * module mocks of `inFlightWork.sendChat.svelte.test.ts` (copied, not shared: each suite mocks its own graph), extended
 * with the database reads the module reference list needs. A loader double is registered through `registerModuleLoader`.
 *
 * Labels: R = regression reproducer (the base sends at once and never waits), G = guard (passes before and after).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
import 'src/ts/polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())

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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const { get } = await import('svelte/store')
    const state = stores.DBState as unknown as { db: { characters: Array<{ chatPage: number, chats: unknown[] }> } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        changeToPreset: vi.fn(),
        setCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        presetTemplate: { name: 'test-preset' },
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
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

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
        checkPersonaBinded: vi.fn(() => false),
        getAuthorNoteDefaultText: vi.fn(() => ''),
        getPersonaPrompt: vi.fn(() => ''),
        getUserName: vi.fn(() => 'User'),
        isLastCharPunctuation: vi.fn(() => true),
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: processScriptFullMock,
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/exampleMessages'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

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
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/models/modelString'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/prereroll'), () => ({
    addRerolls: vi.fn(),
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

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { abortUnitInProgress } from 'src/ts/process/generationOwnership.svelte'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import { ModuleLoadError, registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { get } from 'svelte/store'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string): Message {
    return { role, data, time: 1 } as unknown as Message
}

function installStubbedWorld(): void {
    const chat = { id: 'chat-0', note: '', name: '', localLore: [], fmIndex: -1, message: [msg('user', 'Hi')], modules: [] } as unknown as Chat
    const character = {
        chaId: 'char-0', name: 'char-0', type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
        desc: 'char-0 description', bias: [], utilityBot: false, inlayViewScreen: false, reloadKeys: 0, supaMemory: false,
        chats: [chat], modules: [],
    } as unknown as CharacterFixture
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        modules: [{ id: 'm1', name: 'Alpha', description: '', [MODULE_STUB_KEY]: 1 }],
        enabledModules: ['m1'], moduleIntergration: '', personas: [],
        characterOrder: ['char-0'], characters: [character], statics: { messages: 0 },
        aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500, bias: [], mainPrompt: '', globalNote: '',
        jailbreakToggle: false, chainOfThought: false, personaPrompt: false, promptPreprocess: false, additionalPrompt: '',
        descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptInfoInsideChat: false, autoContinueMinTokens: 0, autoContinueChat: false, igpPrompt: '', notification: false,
        removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off', ttsAutoSpeech: false, presetChain: '',
        outputImageModal: false, rememberToolUsage: false, supaModelType: 'none', hypav2: false, hypaV3: false, hanuraiEnable: false,
        inlayErrorResponse: false,
    } as unknown as Database
    selectedCharID.set(0)
}

let loaderCalls: string[] = []
let releaseLoad: () => void = () => {}

/** A loader that waits for `releaseLoad`, then installs a resident module in the slot, or fails. */
function registerGatedLoader(failure: Error | null = null): void {
    loaderCalls = []
    registerModuleLoader(async (handle, signal) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        loaderCalls.push(id)
        await new Promise<void>((resolve) => {
            releaseLoad = resolve
            signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        if (signal?.aborted) {
            throw signal.reason
        }
        if (failure) {
            throw failure
        }
        const modules = DBState.db.modules as unknown as Array<Record<string, unknown>>
        const index = modules.findIndex((m) => m.id === id)
        modules[index] = { id, name: id, description: '', lorebook: [] }
        return modules[index] as never
    })
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await new Promise<void>((res) => setTimeout(res, 0))
    }
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'Reply.' })
    alertErrorMock.mockReset()
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    doingChat.set(false)
    installStubbedWorld()
})

afterEach(() => {
    unregisterModuleLoader()
    selectedCharID.set(-1)
})

//#endregion

describe('sendChat waits for the referenced module stubs', () => {
    test('R send-waits-for-the-module-before-the-body-runs', async () => {
        registerGatedLoader()
        const outcome = sendChat()
        await settle()
        expect(loaderCalls).toEqual(['m1'])
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(get(doingChat)).toBe(true)

        releaseLoad()
        await outcome
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect(get(doingChat)).toBe(false)
    })

    test('R failed-load-stops-send-names-module', async () => {
        registerGatedLoader(new ModuleLoadError('unreadable', 'm1', 'Alpha'))
        const outcome = sendChat()
        await settle()
        releaseLoad()
        await expect(outcome).resolves.toBe(false)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(String(alertErrorMock.mock.calls[0][0])).toContain('Alpha')
        expect(get(doingChat)).toBe(false)
    })

    test('R busy-button-during-ensure-ends-the-send-silently', async () => {
        registerGatedLoader()
        const outcome = sendChat()
        await settle()
        abortUnitInProgress()
        await expect(outcome).resolves.toBe(false)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(get(doingChat)).toBe(false)
    })

    test('G doingChat-take-stays-synchronous', async () => {
        registerGatedLoader()
        const first = sendChat()
        const second = sendChat()
        await expect(second).resolves.toBe(false)
        expect(get(doingChat)).toBe(true)
        releaseLoad()
        await first
        expect(get(doingChat)).toBe(false)
    })

    test('R send-loads-the-stub-of-a-duplicated-character-id', async () => {
        const original = DBState.db.characters[0] as unknown as Record<string, unknown>
        original.modules = ['m1']
        DBState.db.enabledModules = []
        // A second holder of the same chaId: the send resolves to the selected character through its hint, and so must the wait.
        const twin = { ...original, chats: [{ id: 'chat-twin', message: [], modules: [] }], modules: [] }
        DBState.db.characters.push(twin as never)
        registerGatedLoader()
        const outcome = sendChat()
        await settle()
        expect(loaderCalls).toEqual(['m1'])
        releaseLoad()
        await outcome
    })

    test('R send-waits-for-the-stub-of-the-chat-it-was-given-not-the-selection', async () => {
        const other = {
            ...(DBState.db.characters[0] as unknown as Record<string, unknown>),
            chaId: 'char-1', name: 'char-1', modules: ['m1'],
            chats: [{ id: 'chat-1', note: '', name: '', localLore: [], fmIndex: -1, message: [msg('user', 'Hi')], modules: [] }],
        }
        DBState.db.characters.push(other as never)
        DBState.db.enabledModules = []
        registerGatedLoader()
        const outcome = sendChat(-1, { origin: { chaId: 'char-1', chatId: 'chat-1' } })
        await settle()
        expect(loaderCalls).toEqual(['m1'])
        releaseLoad()
        await outcome
    })

    test('G no-stub-send-adds-no-load', async () => {
        ;(DBState.db.modules as unknown as Array<Record<string, unknown>>).splice(0)
        registerGatedLoader()
        await sendChat()
        expect(loaderCalls).toEqual([])
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
    })
})

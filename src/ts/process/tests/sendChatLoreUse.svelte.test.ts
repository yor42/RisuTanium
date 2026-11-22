/**
 * The list under a reply (MC-3333): `sendChat` records the scan's `used` entries against the `chatId` it gives the reply
 * it writes, on the non-streaming and the streaming push alike, and a continue leaves the latest reply's list alone.
 * Regression reproducers: a send that records nothing, or records under another id, fails them.
 *
 * Drives the REAL, unmocked `sendChat` with the mock set of `sendChatNativeReplyPush.svelte.test.ts`; the lorebook scan
 * returns a fixed `used` list.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'

//#region module mocks

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

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/database.svelte'), () => ({
    changeToPreset: vi.fn(),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertToast: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

const lore = vi.hoisted(() => ({
    used: [{ source: 'character', ownerId: 'char-0', index: 2, name: 'Harbour' }],
}))
vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [], matchLog: [], used: lore.used })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), () => ({
    findCharacterbyId: vi.fn(() => undefined),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    getPersonaPrompt: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    isLastCharPunctuation: vi.fn(() => true),
    trimUntilPunctuation: vi.fn((s: string) => s),
    parseToggleSyntax: vi.fn(() => []),
    prebuiltAssetCommand: vi.fn(() => ''),
}) as unknown as typeof import('../../util'))

const requestChatDataMock = vi.hoisted(() => vi.fn())

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../scripts'))

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn(),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('../triggers'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('../embedding/addinfo'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('../models/modelString'))

vi.mock(import('../inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), () => ({
    addRerolls: vi.fn(),
    renameContinuedMessage: vi.fn(),
}) as unknown as typeof import('../prereroll'))

vi.mock(import('../transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('../transformers'))

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('../memory/hanuraiMemory'))

vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('../scriptings'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('../modules'))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    getSaveMarkCount: vi.fn(() => 0),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

//#endregion

import { get } from 'svelte/store'
import { sendChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { latestLoreUse, noteLoreUse } from '../loreUse'
import { clearRunningSends } from './activeUnits.test-helpers'

function installDb(useStreaming: boolean, messages: unknown[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-0'],
        characters: [{
            chaId: 'char-0',
            name: 'Character Zero',
            type: 'character',
            chatPage: 0,
            firstMessage: 'Hello!',
            alternateGreetings: [],
            desc: 'A test character.',
            bias: [],
            utilityBot: false,
            inlayViewScreen: false,
            reloadKeys: 0,
            chats: [{
                id: 'char-0-chat-0',
                note: '',
                name: '',
                localLore: [],
                fmIndex: -1,
                message: messages,
            }],
        }],
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
        useStreaming,
    } as unknown as Database
}

function streamOf(text: string): ReadableStream<Record<string, string>> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue({ firstmsg: text })
            controller.close()
        },
    })
}

beforeEach(() => {
    noteLoreUse('', [])
    selectedCharID.set(0)
    clearRunningSends()
})

describe('sendChat: the lorebook entries of the latest reply', () => {
    test('regression reproducer: a non-streaming send records the used entries under its reply chatId', async () => {
        installDb(false, [{ role: 'user', data: 'Hi', time: 1 }])
        requestChatDataMock.mockImplementationOnce(async () => ({ type: 'success', result: 'Reply' }))
        expect(await sendChat()).toBe(true)
        const reply = DBState.db.characters[0].chats[0].message[1]
        expect(reply.data).toBe('Reply')
        expect(get(latestLoreUse)).toEqual({ replyChatId: reply.chatId, entries: lore.used })
    })

    test('regression reproducer: a streaming send records the used entries under its reply chatId', async () => {
        installDb(true, [{ role: 'user', data: 'Hi', time: 1 }])
        requestChatDataMock.mockImplementationOnce(async () => ({ type: 'streaming', result: streamOf('Streamed') }))
        expect(await sendChat()).toBe(true)
        const reply = DBState.db.characters[0].chats[0].message[1]
        expect(reply.data).toBe('Streamed')
        expect(get(latestLoreUse)).toEqual({ replyChatId: reply.chatId, entries: lore.used })
    })

    test('regression reproducer: a continue keeps the list of the reply it extends, under the new id of that reply', async () => {
        installDb(false, [{ role: 'user', data: 'Hi', time: 1 }, { role: 'char', data: 'Start', time: 2, chatId: 'reply-1' }])
        const earlier = [{ source: 'chat' as const, ownerId: 'char-0-chat-0', index: 0, name: 'Earlier' }]
        noteLoreUse('reply-1', earlier)
        requestChatDataMock.mockImplementationOnce(async () => ({ type: 'success', result: ' more' }))
        expect(await sendChat(-1, { continue: true })).toBe(true)
        const reply = DBState.db.characters[0].chats[0].message[1]
        expect(reply.data).toBe('Start more')
        // The non-streaming continue gives the extended reply a new id; its list follows it.
        expect(reply.chatId).not.toBe('reply-1')
        expect(get(latestLoreUse)).toEqual({ replyChatId: reply.chatId, entries: earlier })
    })
})
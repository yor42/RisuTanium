/**
 * With the inline-error setting on, an error raised while a generation runs is
 * written into the chat. It goes into the reply that generation is producing
 * or continuing, and into a message of its own otherwise: a message that lies
 * before the generation's output (the base of a reroll, another group
 * member's reply) is never changed by it.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) against a real
 * `$state` database, with the same module mocks as
 * `sendChatGroupOrigin.svelte.test.ts` (copied, not shared: each suite mocks
 * its own graph). The request layer is a stand-in that fails, streams or
 * succeeds as the test queues it.
 *
 * Tests whose title starts with `guard:` pass with or without the rule that
 * keeps the error out of an earlier message: they pin behaviour that must be
 * preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
import { language } from '../../../lang'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`).
import '../../polyfill'

//#region module mocks

interface ChatOutputArg {
    char: { chaId?: string }
    chat: { id?: string }
    characterIndex: number
    chatIndex: number
    messageIndex: number
}

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const runInlayScreenMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const hypaMemoryV3Mock = vi.hoisted(() => vi.fn())
const supaMemoryMock = vi.hoisted(() => vi.fn())
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
const chatOutputListeners = vi.hoisted(() => new Set<(arg: ChatOutputArg) => unknown>())
const restoreColdCharacterMock = vi.hoisted(() => vi.fn())

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
    alertError: alertErrorMock,
    alertToast: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters: Array<{ chaId?: string, type?: string }> } }
    return {
        // Faithful to production: the live non-group character holding the
        // id, or a blank one with a fresh id.
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
        isLastCharPunctuation: isLastCharPunctuationMock,
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
    } as unknown as typeof import('../../util')
})

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: processScriptFullMock,
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../scripts'))

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), () => ({
    sayTTS: sayTTSMock,
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: supaMemoryMock,
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: runTriggerMock,
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
    runInlayScreen: runInlayScreenMock,
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), () => ({
    addRerolls: vi.fn(),
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
    hypaMemoryV3: hypaMemoryV3Mock,
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('../modules'))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: chatOutputListeners },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
    installCharacterSaveMarks: vi.fn(),
    resetCharacterSaveMarksForTest: vi.fn(),
}) as unknown as typeof import('../../storage/characterSaveMarks'))

vi.mock('../coldMemberRestore', () => ({
    restoreColdCharacterByChaId: restoreColdCharacterMock,
}))

//#endregion

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function makeChat(id: string, message: Message[]): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message } as unknown as Chat
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
        chats,
        ...extra,
    } as unknown as CharacterFixture
}

function makeGroup(chaId: string, memberIds: string[], chats: Chat[]): CharacterFixture {
    return {
        chaId,
        name: chaId,
        type: 'group',
        chatPage: 0,
        image: '',
        characters: [...memberIds],
        characterActive: memberIds.map(() => true),
        characterTalks: memberIds.map(() => 1),
        orderByOrder: true,
        reloadKeys: 0,
        supaMemory: false,
        chats,
    } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[], overrides: Record<string, unknown> = {}): void {
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
        inlayErrorResponse: true,
        ...overrides,
    } as unknown as Database
}

/** One character with one chat holding `messages`, selected. */
function installSingleChat(messages: Message[], character: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}): Chat {
    installDb([makeCharacter('char-0', [makeChat('chat-0', messages)], character)], overrides)
    selectedCharID.set(0)
    return DBState.db.characters[0].chats[0]
}

/** A group of three members, selected, with a chat holding `messages`. */
function installGroupChat(messages: Message[]): Chat {
    const memberIds = ['member-1', 'member-2', 'member-3']
    const members = memberIds.map((id) => makeCharacter(id, [makeChat(`${id}-chat`, [msg('user', `${id} own`)])]))
    installDb([makeGroup('group-1', memberIds, [makeChat('group-chat', messages)]), ...members])
    selectedCharID.set(0)
    return DBState.db.characters[0].chats[0]
}

const datas = (chat: Chat): string[] => chat.message.map((m) => m.data)

function streamOf(...chunks: string[]): ReadableStream<{ data: string }> {
    let i = 0
    return new ReadableStream<{ data: string }>({
        pull(controller) {
            if (i < chunks.length) {
                controller.enqueue({ data: chunks[i] })
                i++
            } else {
                controller.close()
            }
        },
    })
}

const queueFailure = (reason: string): void => { requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: reason }) }
const queueStream = (...chunks: string[]): void => { requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: streamOf(...chunks) }) }
const queueReply = (text: string): void => { requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text }) }

/** A character whose reply is followed by a request for an emotion word. */
const emotionCharacter = { viewScreen: 'emotion', emotionImages: [['happy', 'happy-image']] }

function settled(call: () => Promise<boolean>): Promise<boolean | Error> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

const errorBlock = (text: string): string => `\`\`\`risuerror\n${text}\n\`\`\``

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    alertErrorMock.mockReset()
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    sayTTSMock.mockReset()
    runInlayScreenMock.mockReset()
    runInlayScreenMock.mockImplementation((_char: unknown, text: string) => ({ text, promise: undefined }))
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    hypaMemoryV3Mock.mockReset()
    supaMemoryMock.mockReset()
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    chatOutputListeners.clear()
    restoreColdCharacterMock.mockReset()
    doingChat.set(false)
})

afterEach(() => {
    selectedCharID.set(-1)
})

//#endregion

describe('an inline error stays out of messages before the generation\'s own output', () => {
    test('a failed request on a chat that ends with an earlier char message adds the error as a message of its own', async () => {
        const chat = installSingleChat([msg('user', 'u0'), msg('char', 'c0')])
        queueFailure('boom')

        const result = await settled(() => sendChat())

        expect(result).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(chat.message[1].data).toBe('c0')
        expect(chat.message.length).toBe(3)
        expect(chat.message[2].role).toBe('char')
        expect(chat.message[2].data).toBe(errorBlock('boom'))
    })

    test('an error raised before the generation exists adds a message of its own and throws nothing', async () => {
        const chat = installSingleChat([msg('user', 'u0'), msg('char', 'c0')], {}, { maxContext: 0 })

        const result = await settled(() => sendChat())

        expect(result).toBe(false)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(chat.message[1].data).toBe('c0')
        expect(chat.message.length).toBe(3)
        expect(chat.message[2].role).toBe('char')
        expect(chat.message[2].data).toContain(language.errors.toomuchtoken)
    })

    test('a failed turn of a group member adds a message of its own and leaves the previous member\'s reply unchanged', async () => {
        const chat = installGroupChat([msg('user', 'Hi'), msg('char', 'reply 1', { saying: 'member-1' })])
        queueFailure('boom')

        const result = await settled(() => sendChat(1))

        expect(result).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(chat.message[1].data).toBe('reply 1')
        expect(chat.message.length).toBe(3)
        expect(chat.message[2].role).toBe('char')
        expect(chat.message[2].data).toBe(errorBlock('boom'))
    })

    test('an emotion error after an output trigger appended a message adds the error as a message of its own', async () => {
        const chat = installSingleChat([msg('user', 'u0')], emotionCharacter)
        queueReply('whole reply')
        queueFailure('emotion failed')
        runTriggerMock.mockImplementation(async (_char: unknown, type: string, arg: { chat: Chat }) => {
            if (type === 'output') {
                arg.chat.message.push(msg('char', 'trigger message'))
            }
            return undefined
        })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(datas(chat).slice(0, 3)).toEqual(['u0', 'whole reply', 'trigger message'])
        expect(chat.message.length).toBe(4)
        expect(chat.message[3].data).toBe(errorBlock('emotion failed'))
    })

    test('guard: a failed request on a chat that ends with a user message adds the error as a message of its own', async () => {
        const chat = installSingleChat([msg('char', 'c0'), msg('user', 'u0')])
        queueFailure('boom')

        const result = await settled(() => sendChat())

        expect(result).toBe(false)
        expect(chat.message.length).toBe(3)
        expect(chat.message[0].data).toBe('c0')
        expect(chat.message[2].role).toBe('char')
        expect(chat.message[2].data).toBe(errorBlock('boom'))
    })
})

describe('an inline error goes into the reply the generation is producing or continuing', () => {
    test('guard: an error after a streamed reply is appended to that reply', async () => {
        const chat = installSingleChat([msg('user', 'u0')], emotionCharacter)
        queueStream('streamed reply')
        queueFailure('emotion failed')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(chat.message.length).toBe(2)
        expect(chat.message[1].data).toBe(`streamed reply${'\n'}${errorBlock('emotion failed')}`)
    })

    test('guard: an error after a reply that arrived whole is appended to that reply', async () => {
        const chat = installSingleChat([msg('user', 'u0')], emotionCharacter)
        queueReply('whole reply')
        queueFailure('emotion failed')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(chat.message.length).toBe(2)
        expect(chat.message[1].data).toBe(`whole reply${'\n'}${errorBlock('emotion failed')}`)
    })

    test('guard: a Continue whose request fails appends the error to the continued reply', async () => {
        const chat = installSingleChat([msg('user', 'u0'), msg('char', 'c0')])
        queueFailure('boom')

        const result = await settled(() => sendChat(-1, { continue: true }))

        expect(result).toBe(false)
        expect(chat.message.length).toBe(2)
        expect(chat.message[1].data).toBe(`c0${'\n'}${errorBlock('boom')}`)
    })

    test('guard: a streaming Continue followed by an error appends the error to the continued reply', async () => {
        const chat = installSingleChat([msg('user', 'u0'), msg('char', 'c0')], emotionCharacter)
        queueStream(' and more')
        queueFailure('emotion failed')

        const result = await settled(() => sendChat(-1, { continue: true }))

        expect(result).toBe(true)
        expect(chat.message.length).toBe(2)
        expect(chat.message[1].data).toContain('c0 and more')
        expect(chat.message[1].data.endsWith(errorBlock('emotion failed'))).toBe(true)
    })

    test('guard: a non-streaming Continue followed by an error appends the error to the continued reply', async () => {
        const chat = installSingleChat([msg('user', 'u0'), msg('char', 'c0')], emotionCharacter)
        queueReply(' and more')
        queueFailure('emotion failed')

        const result = await settled(() => sendChat(-1, { continue: true }))

        expect(result).toBe(true)
        expect(chat.message.length).toBe(2)
        expect(chat.message[1].data).toContain('c0 and more')
        expect(chat.message[1].data.endsWith(errorBlock('emotion failed'))).toBe(true)
    })
})

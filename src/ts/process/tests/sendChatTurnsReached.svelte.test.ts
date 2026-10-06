/**
 * Acceptance tests of where the turns-reached count is taken: the "reaches no
 * turn" cases pass before the count exists and fail only against a count
 * taken too early.
 *
 * A send reports, through `turnsReachedCount`, whether it settled on a
 * character it speaks as. Auto mode compares the count before and after a
 * tick, so a tick that ends without any turn (nobody left who can speak) can
 * be told from one whose turn ran.
 *
 * Drives the REAL `sendChat` with the same module mocks as
 * `sendChatOwnership.svelte.test.ts` (copied, not shared: each suite mocks its
 * own graph).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
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
const workSpies = vi.hoisted(() => ({ beginWork: vi.fn(), registerWork: vi.fn() }))
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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    changeToPreset: vi.fn(),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
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
    sayTTS: sayTTSMock,
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/memory/supaMemory'), () => ({
    supaMemory: supaMemoryMock,
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
    runInlayScreen: runInlayScreenMock,
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
    hypaMemoryV3: hypaMemoryV3Mock,
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
    pluginV2: { chatOutput: chatOutputListeners },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

// The real work registry, with its two entry points wrapped so a test can
// count how many calls registered work.
vi.mock('src/ts/process/chatOrigin', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/process/chatOrigin')>()
    workSpies.beginWork.mockImplementation(actual.beginWork)
    workSpies.registerWork.mockImplementation(actual.registerWork)
    return { ...actual, beginWork: workSpies.beginWork, registerWork: workSpies.registerWork }
})

// The helper that brings a cold-storage group member back into memory: a
// test simulates a successful restore by replacing the member's slot with the
// full character and resolving true, or a failed one by resolving false.
vi.mock('src/ts/process/coldMemberRestore', () => ({
    restoreColdCharacterByChaId: restoreColdCharacterMock,
}))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { turnsReachedCount } from 'src/ts/process/generationOwnership.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function makeChat(id: string, message: Message[], extra: Record<string, unknown> = {}): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message, ...extra } as unknown as Chat
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
        inlayErrorResponse: false,
        ...overrides,
    } as unknown as Database
}

function installGroup(members: CharacterFixture[], memberIds: string[], lastSaying: string | undefined): void {
    const lastMessage = msg('char', 'earlier', lastSaying ? { saying: lastSaying } : {})
    const group = makeGroup('group-1', memberIds, [makeChat('group-chat', [msg('user', 'Hi'), lastMessage])])
    // A random-order group: the member who spoke last is dropped from the order.
    ;(group as unknown as { orderByOrder: boolean }).orderByOrder = false
    installDb([group, ...members])
    selectedCharID.set(0)
}

function member(chaId: string): CharacterFixture {
    return makeCharacter(chaId, [makeChat(`${chaId}-chat`, [msg('user', `${chaId} own`)])])
}

/** What cold storage leaves in a character's slot: enough to list it, and its `coldstorage` key. */
function coldPlaceholder(chaId: string): CharacterFixture {
    return {
        type: 'character',
        name: chaId,
        chaId,
        chats: [{ id: `${chaId}-placeholder-chat`, message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldstorage: `cold-key-${chaId}`,
        coldStoragedChats: [],
    } as unknown as CharacterFixture
}

/** How many turns one `sendChat` call reached. */
async function turnsOfOneSend(): Promise<{ turns: number, result: boolean }> {
    const before = turnsReachedCount()
    const result = await sendChat()
    return { turns: turnsReachedCount() - before, result }
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'a reply.' })
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

describe('a send that reaches a turn', () => {
    test('a character chat reaches one turn', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])])])
        selectedCharID.set(0)

        const { turns, result } = await turnsOfOneSend()

        expect(result).toBe(true)
        expect(turns).toBe(1)
    })

    test('a group tick whose member is not the last speaker reaches that member\'s turn, and the group\'s own dispatch counts for nothing', async () => {
        installGroup([member('m-1'), member('m-2')], ['m-1', 'm-2'], 'm-2')

        const { turns, result } = await turnsOfOneSend()

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect(turns).toBe(1)
    })
})

describe('a send whose member is in cold storage', () => {
    test('the member is restored and takes the turn, which is reached', async () => {
        installGroup([member('m-1'), coldPlaceholder('m-cold')], ['m-1', 'm-cold'], 'm-1')
        restoreColdCharacterMock.mockImplementation(async (chaId: string) => {
            const index = DBState.db.characters.findIndex((c) => c.chaId === chaId)
            DBState.db.characters[index] = member(chaId)
            return true
        })

        const { turns, result } = await turnsOfOneSend()

        expect(restoreColdCharacterMock).toHaveBeenCalledTimes(1)
        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect(turns).toBe(1)
    })

    test('a restore that fails passes the member over: the send resolves true and no turn is reached', async () => {
        installGroup([member('m-1'), coldPlaceholder('m-cold')], ['m-1', 'm-cold'], 'm-1')
        restoreColdCharacterMock.mockResolvedValue(false)

        const { turns, result } = await turnsOfOneSend()

        expect(restoreColdCharacterMock).toHaveBeenCalledTimes(1)
        expect(result).toBe(true)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(turns).toBe(0)
    })
})

describe('a send that reaches no turn', () => {
    test('the only member who can speak spoke last', async () => {
        installGroup([member('m-1')], ['m-1'], 'm-1')

        const { turns, result } = await turnsOfOneSend()

        expect(result).toBe(true)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(turns).toBe(0)
    })

    test('the other member is deleted', async () => {
        installGroup([member('m-1')], ['m-1', 'm-gone'], 'm-1')

        const { turns, result } = await turnsOfOneSend()

        expect(result).toBe(true)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(turns).toBe(0)
    })

    test('the other member\'s id has two holders', async () => {
        installGroup([member('m-1'), member('m-2'), member('m-2')], ['m-1', 'm-2'], 'm-1')

        const { turns, result } = await turnsOfOneSend()

        expect(result).toBe(true)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(turns).toBe(0)
    })
})

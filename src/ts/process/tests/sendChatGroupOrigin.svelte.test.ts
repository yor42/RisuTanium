/**
 * Group turns write into the group's chat, each as its own member, whatever
 * moves between one turn and the next.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) against a real
 * `$state` database, with the same module mocks as
 * `sendChatOrigin.svelte.test.ts` (copied, not shared: each suite mocks its
 * own graph). `findCharacterbyId` is a faithful fake: the live character
 * holding the id (a cold-storage placeholder included), or a blank one with a
 * fresh `chaId` on a miss, as production does. The helper that restores a
 * cold-storage member (`../coldMemberRestore`) is mocked: a test simulates a
 * successful restore by replacing the member's slot with the full character
 * and resolving true, or a failed one by resolving false.
 *
 * Tests whose title starts with `guard:` pass with or without the origin
 * binding: they pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
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
const saveMarkHook = vi.hoisted(() => ({ run: null as (() => void) | null }))

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
        // id (a cold placeholder included), or a blank one with a fresh id.
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

// The call that marks a character for save also stands in for the moment a
// turn has fully settled: a test hooks it to act between two turns.
vi.mock(import('../../storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(() => { saveMarkHook.run?.() }),
    installCharacterSaveMarks: vi.fn(),
    resetCharacterSaveMarksForTest: vi.fn(),
}) as unknown as typeof import('../../storage/characterSaveMarks'))

// The helper that brings a cold-storage group member back into memory.
vi.mock('../coldMemberRestore', () => ({
    restoreColdCharacterByChaId: restoreColdCharacterMock,
}))

//#endregion

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { isWriting, writeAt, type Origin } from '../chatOrigin'

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

function snap<T>(value: T): T {
    return $state.snapshot(value) as T
}

function charById(chaId: string): CharacterFixture {
    return DBState.db.characters.find((c) => c.chaId === chaId)!
}

function chatById(chaId: string, chatId: string): Chat {
    return charById(chaId).chats.find((c) => c.id === chatId)!
}

function datas(chat: Chat): string[] {
    return chat.message.map((m) => m.data)
}

function mockReply(text: string): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
}

function settled(call: () => Promise<boolean>): Promise<boolean | Error> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

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

//#region group fixtures

interface GroupLists {
    characters: string[]
    characterActive: boolean[]
    characterTalks: number[]
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

function groupLists(chaId: string): GroupLists {
    return charById(chaId) as unknown as GroupLists
}

function makeMember(chaId: string, description = `${chaId} description`): CharacterFixture {
    return makeCharacter(chaId, [makeChat(`${chaId}-chat`, [msg('user', `${chaId} own`, { chatId: `${chaId}-own-id` })])], { desc: description })
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

/** The group, selected, in slot 0 and three members in slots 1 to 3. */
function installGroupWorld(cold: string[] = []): void {
    const members = ['member-1', 'member-2', 'member-3'].map((id) => (cold.includes(id) ? coldPlaceholder(id) : makeMember(id)))
    const group = makeGroup('group-1', ['member-1', 'member-2', 'member-3'], [makeChat('group-chat', [msg('user', 'Hi')])])
    installDb([group, ...members])
    selectedCharID.set(0)
}

function indexOfCharacter(chaId: string): number {
    return DBState.db.characters.findIndex((c) => c.chaId === chaId)
}

function groupChat(): Chat {
    return chatById('group-1', 'group-chat')
}

function sayings(): Array<string | undefined> {
    return groupChat().message.filter((m) => m.role === 'char').map((m) => m.saying)
}

/** Runs `action` the first time a reply has been written, that is, between two turns. */
function afterFirstReply(action: () => void): void {
    let done = false
    chatOutputListeners.add(() => {
        if (!done) {
            done = true
            action()
        }
    })
}

/** Installs a restore that swaps the placeholder in the member's slot for the full character. */
function restoreByReplacingSlot(beforeInstall: () => void = () => {}): void {
    restoreColdCharacterMock.mockImplementation(async (chaId: string) => {
        beforeInstall()
        const index = indexOfCharacter(chaId)
        DBState.db.characters[index] = makeMember(chaId, `restored ${chaId} description`)
        return true
    })
}

//#endregion

describe('group turns', () => {
    test('guard: every active member speaks once, in order, as itself', async () => {
        installGroupWorld()
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(datas(groupChat())).toEqual(['Hi', 'reply 1', 'reply 2', 'reply 3'])
        expect(sayings()).toEqual(['member-1', 'member-2', 'member-3'])
    })

    test('guard: a send to member i of the selected group speaks as that member only', async () => {
        installGroupWorld()
        mockReply('reply from the second member')

        const result = await settled(() => sendChat(1))

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect(datas(groupChat())).toEqual(['Hi', 'reply from the second member'])
        expect(sayings()).toEqual(['member-2'])
    })

    test('a character switch between two turns leaves both turns in the group chat, each as its own member', async () => {
        installGroupWorld()
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')
        afterFirstReply(() => { selectedCharID.set(indexOfCharacter('member-1')) })
        const firstMemberBefore = snap(charById('member-1'))

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-2', 'member-3'])
        expect(datas(groupChat())).toEqual(['Hi', 'reply 1', 'reply 2', 'reply 3'])
        expect(snap(charById('member-1'))).toEqual(firstMemberBefore)
    })

    test('the group and the speaking member are registered as being written to during their turn and released afterwards', async () => {
        installGroupWorld()
        const seen: Array<Record<string, boolean>> = []
        for (let turn = 0; turn < 3; turn++) {
            requestChatDataMock.mockImplementationOnce(async () => {
                seen.push({
                    group: isWriting({ chaId: 'group-1', chatId: 'group-chat' }),
                    member1: isWriting({ chaId: 'member-1' }),
                    member2: isWriting({ chaId: 'member-2' }),
                    member3: isWriting({ chaId: 'member-3' }),
                })
                return { type: 'success', result: `reply ${turn + 1}` }
            })
        }

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(seen).toEqual([
            { group: true, member1: true, member2: false, member3: false },
            { group: true, member1: false, member2: true, member3: false },
            { group: true, member1: false, member2: false, member3: true },
        ])
        for (const id of ['group-1', 'member-1', 'member-2', 'member-3']) {
            expect(isWriting({ chaId: id })).toBe(false)
        }
    })
})

describe('a member who is gone when their turn comes', () => {
    test('a member removed from the group between turns is skipped and the other turns run', async () => {
        installGroupWorld()
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')
        afterFirstReply(() => {
            const lists = groupLists('group-1')
            lists.characters.splice(1, 1)
            lists.characterActive.splice(1, 1)
            lists.characterTalks.splice(1, 1)
        })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-3'])
        expect(datas(groupChat())).toEqual(['Hi', 'reply 1', 'reply 2'])
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
    })

    test('a member deleted permanently between turns is skipped and the other turns run', async () => {
        installGroupWorld()
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')
        afterFirstReply(() => {
            DBState.db.characters.splice(indexOfCharacter('member-2'), 1)
        })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-3'])
        expect(datas(groupChat())).toEqual(['Hi', 'reply 1', 'reply 2'])
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
    })

    test('a member whose chaId has two holders when their turn comes is skipped and the other turns run', async () => {
        installGroupWorld()
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')
        afterFirstReply(() => {
            DBState.db.characters.push(snap(charById('member-2')))
        })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-3'])
        expect(datas(groupChat())).toEqual(['Hi', 'reply 1', 'reply 2'])
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
    })
})

describe('a member who is in cold storage when their turn comes', () => {
    test('they are restored, and their turn runs as the restored character', async () => {
        installGroupWorld(['member-2'])
        restoreByReplacingSlot()
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-2', 'member-3'])
        expect(restoreColdCharacterMock).toHaveBeenCalledTimes(1)
        expect(restoreColdCharacterMock).toHaveBeenCalledWith('member-2')
        expect(requestChatDataMock.mock.calls[1][0].currentChar.desc).toBe('restored member-2 description')
        expect(charById('member-2').coldstorage).toBeUndefined()
    })

    test('a character inserted below them during the restore does not stop their turn', async () => {
        installGroupWorld(['member-2'])
        restoreByReplacingSlot(() => {
            DBState.db.characters.splice(1, 0, makeMember('inserted-during-restore'))
        })
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-2', 'member-3'])
        expect(restoreColdCharacterMock).toHaveBeenCalledWith('member-2')
        expect(requestChatDataMock.mock.calls[1][0].currentChar.desc).toBe('restored member-2 description')
    })

    // What the user is told about the failed member is covered with the real
    // restore in `sendChatGroupColdMember.svelte.test.ts`.
    test('a restore that fails passes the member over and the other members speak', async () => {
        installGroupWorld(['member-2'])
        restoreColdCharacterMock.mockResolvedValue(false)
        mockReply('reply 1')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(restoreColdCharacterMock).toHaveBeenCalledWith('member-2')
        expect(sayings()).toEqual(['member-1', 'member-3'])
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(charById('member-2').coldstorage).toBe('cold-key-member-2')
        expect(isWriting({ chaId: 'group-1' })).toBe(false)
    })
})

describe('a first member whose reply goes missing', () => {
    test('guard: an output trigger that rebuilds the chat without message ids leaves the second member their turn', async () => {
        installGroupWorld()
        let rebuilt = false
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string, arg: { origin: Origin }) => {
            if (mode === 'output' && !rebuilt) {
                rebuilt = true
                writeAt(arg.origin, (ctx) => {
                    ctx.chat.message = ctx.chat.message.map((v) => ({ role: v.role, data: v.data }) as Message)
                })
            }
            return undefined
        })
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(rebuilt).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(datas(groupChat())).toEqual(['Hi', 'reply 1', 'reply 2', 'reply 3'])
        expect(groupChat().message.slice(-2).map((m) => m.saying)).toEqual(['member-2', 'member-3'])
    })

    test('guard: the user deleting the reply during the first member\'s turn leaves the second member their turn', async () => {
        installGroupWorld()
        let deleted = false
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string, arg: { origin: Origin }) => {
            if (mode === 'output' && !deleted) {
                deleted = true
                writeAt(arg.origin, (ctx) => {
                    ctx.chat.message.pop()
                })
            }
            return undefined
        })
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(deleted).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(datas(groupChat())).toEqual(['Hi', 'reply 2', 'reply 3'])
        expect(sayings()).toEqual(['member-2', 'member-3'])
    })
})

describe('a cold member deleted during their own restore', () => {
    test('their turn is skipped without an alert and the other members speak', async () => {
        installGroupWorld(['member-2'])
        restoreColdCharacterMock.mockImplementation(async (chaId: string) => {
            DBState.db.characters.splice(indexOfCharacter(chaId), 1)
            return false
        })
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(restoreColdCharacterMock).toHaveBeenCalledWith('member-2')
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-3'])
        expect(datas(groupChat())).toEqual(['Hi', 'reply 1', 'reply 2'])
    })
})

describe('a group chat deleted between two turns', () => {
    test('the send ends quietly and clears doingChat itself', async () => {
        installGroupWorld()
        const group = charById('group-1')
        group.chats.push(makeChat('group-other-chat', [msg('user', 'other-1')]))
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')
        // The first turn has fully settled once its member is not
        // registered any more; the chat is deleted then, before the second turn starts.
        let deleted = false
        saveMarkHook.run = () => {
            if (!deleted && requestChatDataMock.mock.calls.length === 1 && !isWriting({ chaId: 'member-1' })) {
                deleted = true
                const chats = charById('group-1').chats
                chats.splice(chats.findIndex((c) => c.id === 'group-chat'), 1)
            }
        }
        try {
            const result = await settled(() => sendChat())

            expect(deleted).toBe(true)
            expect(result).toBe(false)
            expect(alertErrorMock).not.toHaveBeenCalled()
            expect(requestChatDataMock).toHaveBeenCalledTimes(1)
            expect(get(doingChat)).toBe(false)
            expect(datas(chatById('group-1', 'group-other-chat'))).toEqual(['other-1'])
            expect(isWriting({ chaId: 'group-1' })).toBe(false)
        } finally {
            saveMarkHook.run = null
        }
    })
})

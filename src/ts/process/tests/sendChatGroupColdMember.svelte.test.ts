/**
 * A group turn whose member is archived: a placeholder (the "stub") in
 * `DBState.db.characters` whose full data lives in a cold-storage unit.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) and the real restore
 * of an archived member (`../coldMemberRestore`, `../coldCharacterRestore`)
 * against a real `$state` database. Only the unit read
 * (`readColdStorageItem`), the character-format step and the alerts are
 * mocked, so what the user is told comes from the code under test. The other
 * module mocks are copied from `sendChatGroupOrigin.svelte.test.ts`.
 *
 * Invariants exercised here:
 * - A member whose archive cannot be restored is passed over: the walk goes on
 *   to the next member, the send resolves true, and the user is told once, by
 *   name, with the missing or unreadable wording that fits.
 * - The failed member stays archived and a later send tries its restore again.
 * - A member deleted from the list while being restored is passed over without
 *   an alert.
 *
 * Tests whose title starts with `guard:` pass before and after the rule that
 * passes a failed member over: they pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
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
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const runInlayScreenMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const hypaMemoryV3Mock = vi.hoisted(() => vi.fn())
const supaMemoryMock = vi.hoisted(() => vi.fn())
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
const chatOutputListeners = vi.hoisted(() => new Set<(arg: ChatOutputArg) => unknown>())
const readColdStorageItemMock = vi.hoisted(() => vi.fn())
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
    alertNormal: alertNormalMock,
    alertMd: alertMdMock,
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

// The cold-storage unit read: the restore of an archived member is the real
// one, so what the user is told comes from the code under test.
vi.mock(import('../coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('../coldstorage.svelte'))

vi.mock(import('../../characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('../../characters'))

//#endregion

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { isWriting } from '../chatOrigin'
import { language } from '../../../lang'

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
    readColdStorageItemMock.mockReset()
    alertNormalMock.mockReset()
    alertMdMock.mockReset()
    doingChat.set(false)
})

afterEach(() => {
    selectedCharID.set(-1)
})

//#endregion

//#region group fixtures

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

/** Names the archived member in slot order, so an alert naming it can be told from any other text. */
function nameMember(chaId: string, name: string): void {
    charById(chaId).name = name
}

function ok(restored: CharacterFixture) {
    return { status: 'ok', value: { character: restored } }
}

function shownAlerts(): string[] {
    return [alertErrorMock, alertNormalMock, alertMdMock].flatMap((fn) => fn.mock.calls.map((args) => String(args[0])))
}

//#endregion

describe('a group turn whose archived member cannot be restored', () => {
    test('a missing unit passes the member over, lets the others speak, and shows one alert naming the member', async () => {
        installGroupWorld(['member-1'])
        nameMember('member-1', 'Alice')
        readColdStorageItemMock.mockResolvedValue({ status: 'missing' })
        mockReply('reply 2')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-2', 'member-3'])
        expect(datas(groupChat())).toEqual(['Hi', 'reply 2', 'reply 3'])
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(shownAlerts()).toEqual([language.errors.coldStorageNamedRestoreFailed('Alice')])
        expect(charById('member-1').coldstorage).toBe('cold-key-member-1')
        expect(isWriting({ chaId: 'group-1' })).toBe(false)
    })

    test('an unreadable unit passes the member over, lets the others speak, and shows one alert naming the member with the unreadable wording', async () => {
        installGroupWorld(['member-2'])
        nameMember('member-2', 'Alice')
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('disk unavailable') })
        mockReply('reply 1')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-3'])
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(shownAlerts()).toEqual([language.errors.coldStorageNamedRestoreUnreadable('Alice')])
        expect(charById('member-2').coldstorage).toBe('cold-key-member-2')
    })

    test('guard: a later send tries the archived member\'s restore again, and the member speaks when it works', async () => {
        installGroupWorld(['member-1'])
        nameMember('member-1', 'Alice')
        readColdStorageItemMock.mockResolvedValueOnce({ status: 'missing' })
        mockReply('reply 2')
        mockReply('reply 3')
        await settled(() => sendChat())
        readColdStorageItemMock.mockResolvedValueOnce(ok(makeMember('member-1', 'restored member-1 description')))
        mockReply('reply 1 again')
        mockReply('reply 2 again')
        mockReply('reply 3 again')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(readColdStorageItemMock).toHaveBeenCalledTimes(2)
        expect(sayings().slice(-3)).toEqual(['member-1', 'member-2', 'member-3'])
        expect(charById('member-1').coldstorage).toBeUndefined()
    })
})

describe('a group turn whose archived member is restored or deleted during the restore', () => {
    test('guard: a restore that succeeds lets the member speak as the restored character, with no alert', async () => {
        installGroupWorld(['member-2'])
        readColdStorageItemMock.mockResolvedValue(ok(makeMember('member-2', 'restored member-2 description')))
        mockReply('reply 1')
        mockReply('reply 2')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-2', 'member-3'])
        expect(requestChatDataMock.mock.calls[1][0].currentChar.desc).toBe('restored member-2 description')
        expect(shownAlerts()).toEqual([])
    })

    test('guard: a member deleted during its own restore is passed over without an alert', async () => {
        installGroupWorld(['member-2'])
        readColdStorageItemMock.mockImplementation(async () => {
            DBState.db.characters.splice(indexOfCharacter('member-2'), 1)
            return ok(makeMember('member-2', 'restored member-2 description'))
        })
        mockReply('reply 1')
        mockReply('reply 3')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayings()).toEqual(['member-1', 'member-3'])
        expect(shownAlerts()).toEqual([])
    })
})


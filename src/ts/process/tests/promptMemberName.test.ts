/**
 * The speaker name a group turn puts into the prompt for an earlier member message: the live member's
 * name, else the group's join record, else "Unknown Character". The name reaches the prompt through the
 * group template, which the prompt builder expands by `risuChatParser` with `chara` set to that name.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) against a plain-object database (no `$state` rune: this is not a .svelte.test.ts), with the
 * module mocks of `sendChatGroupSpeaker.svelte.test.ts` (copied, not shared: each suite mocks its own
 * graph) except that `risuChatParser` records its calls. `groupMembers` is the real module.
 *
 * Coverage limit: the per-message `name` the builder computes next to the template name is read only by
 * the ChroMemory capture, which this harness does not enable; the template call is the observable path.
 *
 * Classes: `regression reproducer:` fails on the code before the member record existed (a deleted member
 * was named "Unknown Character"); `guard:` passes before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does (`import "./ts/polyfill"`).
import '../../polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const runInlayScreenMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
const parserMock = vi.hoisted(() => vi.fn((text: string, _arg?: unknown) => text ?? ''))

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
    // A plain object: this file is not a .svelte.test.ts, so it cannot use the $state rune.
    const state = { db: {} as unknown as Database }
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
        // Faithful to production: the live non-group character holding the id, or a blank one with a fresh id.
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
    risuChatParser: parserMock,
}) as unknown as typeof import('../scripts'))

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), () => ({
    sayTTS: sayTTSMock,
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
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

vi.mock(import('../prereroll'), async (importOriginal) => ({
    renameContinuedMessage: (await importOriginal()).renameContinuedMessage,
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
    hypaMemoryV3: vi.fn(),
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
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
    installCharacterSaveMarks: vi.fn(),
    resetCharacterSaveMarksForTest: vi.fn(),
}) as unknown as typeof import('../../storage/characterSaveMarks'))

vi.mock('../coldMemberRestore', () => ({
    restoreColdCharacterByChaId: vi.fn(async () => false),
}))

// The thumbnail module is replaced: no avatar is generated, and every image is a local asset.
vi.mock('../../media/avatarThumb', () => ({
    isThumbEligible: (loc: string) => loc.startsWith('assets/'),
    peekAvatarThumb: () => undefined,
    getAvatarThumbSrc: vi.fn(async () => null),
}))

//#endregion

import { sendChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { resetActiveStreamsForTest } from '../activeStreams'
import { clearRunningSends } from './activeUnits.test-helpers'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const GROUP_ID = 'group-1'
const CHAT_ID = 'group-chat'
const TARGET = { chaId: GROUP_ID, chatId: CHAT_ID }

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function makeChat(id: string, message: Message[]): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message } as unknown as Chat
}

function makeCharacter(chaId: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name: `Name of ${chaId}`,
        type: 'character',
        chatPage: 0,
        firstMessage: 'Hello!',
        alternateGreetings: [],
        desc: `${chaId} description`,
        image: `assets/${chaId}.png`,
        bias: [],
        utilityBot: false,
        inlayViewScreen: false,
        reloadKeys: 0,
        supaMemory: false,
        chats: [makeChat(`${chaId}-chat`, [msg('user', `${chaId} own`, { chatId: `${chaId}-own-id` })])],
        ...extra,
    } as unknown as CharacterFixture
}

function makeGroup(memberIds: string[]): CharacterFixture {
    return {
        chaId: GROUP_ID,
        name: 'The Group',
        type: 'group',
        chatPage: 0,
        image: 'assets/group.png',
        characters: [...memberIds],
        characterActive: memberIds.map(() => true),
        characterTalks: memberIds.map(() => 1),
        orderByOrder: true,
        reloadKeys: 0,
        supaMemory: false,
        chats: [makeChat(CHAT_ID, [msg('user', 'Hi')])],
    } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[]): void {
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
    } as unknown as Database
}

/** The group, selected, in slot 0 and two members in slots 1 and 2. */
function installGroupWorld(): void {
    installDb([makeGroup(['m1', 'm2']), makeCharacter('m1'), makeCharacter('m2')])
    selectedCharID.set(0)
}

/** One plain character in slot 0, selected. */
function installSingleWorld(): void {
    installDb([makeCharacter('solo', { chats: [makeChat(CHAT_ID, [msg('user', 'Hi')])] })])
    selectedCharID.set(0)
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
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    parserMock.mockClear()
    clearRunningSends()
    resetActiveStreamsForTest()
})

afterEach(() => {
    selectedCharID.set(-1)
})

//#endregion

//#region fixtures for the member record

const DEFAULT_TEMPLATE_MARK = "Message>"

// The names the group template was expanded with, in prompt order: the template text carries the
// "Message>" tags and its `chara` argument is the speaker name.
function templateNames(): unknown[] {
    return parserMock.mock.calls
        .filter(([text]) => typeof text === 'string' && text.includes(DEFAULT_TEMPLATE_MARK))
        .map(([, arg]) => (arg as { chara?: unknown } | undefined)?.chara)
}

// A group of one live member 'm1' whose chat holds an earlier message said by 'gone'. `members` is the
// group's risutanium_members exactly as joinRecord writes it ({name, slot 0..7}).
function installGoneWorld(members: Record<string, unknown> | undefined, goneLive: boolean): void {
    const group = makeGroup(['m1'])
    group.chats[0].message = [msg('char', 'earlier words', { saying: 'gone' })]
    if (members !== undefined) {
        (group as unknown as { risutanium_members: unknown }).risutanium_members = members
    }
    const characters = [group, makeCharacter('m1')]
    if (goneLive) {
        characters.push(makeCharacter('gone', { name: 'Alicia' }))
    }
    installDb(characters)
    selectedCharID.set(0)
}

//#endregion

describe('the speaker name of an earlier member message in a group prompt', () => {
    test('regression reproducer: a deleted member is named by the record in the group template', async () => {
        installGoneWorld({ gone: { name: 'Alice', slot: 0 } }, false)
        requestChatDataMock.mockResolvedValue({ type: 'success', result: 'reply' })

        expect(await sendChat(0)).toBe(true)

        expect(templateNames()).toEqual(['Alice'])
    })

    test('guard: a live member is named by its own name, not the record', async () => {
        installGoneWorld({ gone: { name: 'Alice', slot: 0 } }, true)
        requestChatDataMock.mockResolvedValue({ type: 'success', result: 'reply' })

        expect(await sendChat(0)).toBe(true)

        expect(templateNames()).toEqual(['Alicia'])
    })

    test('guard: a deleted member with no record is named Unknown Character', async () => {
        installGoneWorld(undefined, false)
        requestChatDataMock.mockResolvedValue({ type: 'success', result: 'reply' })

        expect(await sendChat(0)).toBe(true)

        expect(templateNames()).toEqual(['Unknown Character'])
    })
})
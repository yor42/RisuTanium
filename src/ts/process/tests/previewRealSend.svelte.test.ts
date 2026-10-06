/**
 * The prompt previews and the stage boundaries of a send, against the REAL,
 * unmocked `sendChat` (`src/ts/process/index.svelte`) over a real `$state`
 * database, with the same module mocks as `sendChatGroupOrigin.svelte.test.ts`
 * (copied, not shared: each suite mocks its own graph) except that
 * `src/ts/alert.ts` and `src/ts/process/group.ts` are real, and the real
 * `runPreviewPrompt` (`src/ts/process/devToolActions`) runs on top of the real
 * send. `alertStore` is a real `writable`, so what a test reads is what the
 * user would see. `requestChatData` is a mock; it says nothing about how a
 * provider builds or returns a request body.
 *
 * `findCharacterbyId` is a faithful fake: the live character holding the id
 * (a cold-storage placeholder included), or a blank one with a fresh `chaId`
 * on a miss, as production does. The helper that restores a cold-storage
 * member is mocked: a test simulates a failed restore by resolving false.
 *
 * A stage is aborted the way the busy button aborts it: `abortUnitInProgress`
 * from `generationOwnership.svelte`, called from inside the mock that stands
 * for that stage.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they
 * pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
import type { alertData } from 'src/ts/alert'
import type { OpenAIChat, PreviewResult } from 'src/ts/process/index.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`).
import 'src/ts/polyfill'

//#region module mocks

interface RequestArg {
    formated: OpenAIChat[]
    currentChar: { chaId?: string, name?: string }
    previewBody?: boolean
}

const requestChatDataMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const runInlayScreenMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const hypaMemoryV3Mock = vi.hoisted(() => vi.fn())
const supaMemoryMock = vi.hoisted(() => vi.fn())
const exampleMessageMock = vi.hoisted(() => vi.fn())
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
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

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        changeToPreset: vi.fn(),
        setCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        getCurrentCharacter: vi.fn(() => ({ name: 'Current' })),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        alertStore: writable({ type: 'none', msg: '' }),
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
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
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
    exampleMessage: exampleMessageMock,
}) as unknown as typeof import('src/ts/process/exampleMessages'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: sayTTSMock,
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/memory/supaMemory'), () => ({
    supaMemory: supaMemoryMock,
}) as unknown as typeof import('src/ts/process/memory/supaMemory'))

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
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
    installCharacterSaveMarks: vi.fn(),
    resetCharacterSaveMarksForTest: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

// The helper that brings a cold-storage group member back into memory.
vi.mock('../coldMemberRestore', () => ({
    restoreColdCharacterByChaId: restoreColdCharacterMock,
}))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { runPreviewPrompt } from 'src/ts/process/devToolActions'
import { abortUnitInProgress } from 'src/ts/process/generationOwnership.svelte'
import { alertStore, DBState, selectedCharID } from 'src/ts/stores.svelte'
import { runLuaEditTrigger } from 'src/ts/process/scriptings'
import { language } from 'src/lang'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const NONE: alertData = { type: 'none', msg: '' }
const stopRecording: Array<() => void> = []

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

function datas(chat: Chat): string[] {
    return chat.message.map((m) => m.data)
}

function settled(call: () => Promise<unknown>): Promise<unknown> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

function shown(): alertData {
    return get(alertStore) as alertData
}

/** Every alert the store holds from now on, in order. */
function recordAlerts(): { markdown: () => alertData[] } {
    const seen: alertData[] = []
    stopRecording.push(alertStore.subscribe((value) => { seen.push(value as alertData) }))
    return { markdown: () => seen.filter((value) => value.type === 'markdown') }
}

const REQUEST_BODY = JSON.stringify({
    url: 'https://api.example.com/v1/chat',
    body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
    headers: { 'content-type': 'application/json' },
})

/** Answers a request the way the request layer does for a prompt preview, naming the member it was for. */
function answerPreviewRequests(): void {
    requestChatDataMock.mockImplementation(async (arg: RequestArg) => {
        if (arg.previewBody) {
            return { type: 'success', result: JSON.stringify({ url: 'u', body: { for: arg.currentChar.chaId }, headers: {} }) }
        }
        return { type: 'success', result: `a reply from ${arg.currentChar.chaId}` }
    })
}

function requestArgs(): RequestArg[] {
    return requestChatDataMock.mock.calls.map((call) => call[0] as RequestArg)
}

function installCharWorld(extra: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}): void {
    installDb([makeCharacter('char-1', [makeChat('chat-1', [msg('user', 'Hi')])], extra)], overrides)
    selectedCharID.set(0)
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    sayTTSMock.mockReset()
    runInlayScreenMock.mockReset()
    runInlayScreenMock.mockImplementation((_char: unknown, text: string) => ({ text, promise: undefined }))
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    hypaMemoryV3Mock.mockReset()
    supaMemoryMock.mockReset()
    supaMemoryMock.mockImplementation(async (chats: OpenAIChat[], currentTokens: number) => ({ chats, currentTokens }))
    exampleMessageMock.mockReset()
    exampleMessageMock.mockReturnValue([])
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    restoreColdCharacterMock.mockReset()
    doingChat.set(false)
    alertStore.set(NONE)
})

afterEach(() => {
    while (stopRecording.length > 0) {
        stopRecording.pop()!()
    }
    selectedCharID.set(-1)
    alertStore.set(NONE)
})

//#endregion

//#region group fixtures

function makeGroup(chaId: string, memberIds: string[], chats: Chat[], extra: Record<string, unknown> = {}): CharacterFixture {
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
        ...extra,
    } as unknown as CharacterFixture
}

function makeMember(chaId: string, name = chaId): CharacterFixture {
    return makeCharacter(chaId, [makeChat(`${chaId}-chat`, [msg('user', `${chaId} own`, { chatId: `${chaId}-own-id` })])], { name })
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

interface GroupWorldOptions {
    cold?: string[]
    names?: Record<string, string>
    groupExtra?: Record<string, unknown>
    lastMessage?: string
}

/** The group, selected, in slot 0 and three members in slots 1 to 3. */
function installGroupWorld(options: GroupWorldOptions = {}): void {
    const ids = ['member-1', 'member-2', 'member-3']
    const members = ids.map((id) => (options.cold?.includes(id) ? coldPlaceholder(id) : makeMember(id, options.names?.[id])))
    const group = makeGroup('group-1', ids, [makeChat('group-chat', [msg('user', options.lastMessage ?? 'Hi')])], options.groupExtra)
    installDb([group, ...members])
    selectedCharID.set(0)
}

function groupChat(): Chat {
    return charById('group-1').chats.find((c) => c.id === 'group-chat')!
}

function indexOfCharacter(chaId: string): number {
    return DBState.db.characters.findIndex((c) => c.chaId === chaId)
}

//#endregion

describe('the DevTool preview over the real send', () => {
    test('a first preview refused at Home does not throw, leaves no notice and shows no preview', async () => {
        installCharWorld()
        selectedCharID.set(-1)
        const alerts = recordAlerts()

        const outcome = await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect.soft(outcome, 'the run rejected with').not.toBeInstanceOf(Error)
        expect.soft(shown().type, 'the alert still showing').toBe('none')
        expect.soft(alerts.markdown(), 'previews shown').toEqual([])
    })

    test('an abort that lands after the request\'s last abort check shows nothing', async () => {
        installCharWorld()
        requestChatDataMock.mockImplementation(async () => {
            abortUnitInProgress()
            return { type: 'success', result: REQUEST_BODY }
        })
        const alerts = recordAlerts()

        const outcome = await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect.soft(outcome, 'the run rejected with').not.toBeInstanceOf(Error)
        expect.soft(alerts.markdown(), 'previews shown').toEqual([])
        expect.soft(shown().type, 'the alert still showing').toBe('none')
    })
})

describe.each([
    ['a real send', {}],
    ['a prompt preview', { previewPrompt: true }],
])('%s aborted at a stage boundary', (_label, sendArg) => {
    test('an abort before the start trigger does not run the trigger, and ends the send with no alert', async () => {
        installCharWorld()
        exampleMessageMock.mockImplementation(() => {
            abortUnitInProgress()
            return []
        })

        const result = await settled(() => sendChat(-1, { ...sendArg }))

        expect.soft(runTriggerMock, 'trigger runs').not.toHaveBeenCalled()
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(result).toBe(false)
        expect.soft(shown().type, 'the alert showing').toBe('none')
    })

    test.each([
        ['returns nothing', undefined],
        ['returns a result that does not stop the send', { additonalSysPrompt: { start: '', historyend: '', promptend: '' }, tokens: 0, stopSending: false, sendAIprompt: false }],
    ])('an abort during a start trigger that %s stops the memory summarisation, and ends the send with no alert', async (_triggerLabel, triggerReturn) => {
        installCharWorld({ supaMemory: true }, { supaModelType: 'openAI' })
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => {
            if (mode === 'start') {
                abortUnitInProgress()
            }
            return triggerReturn
        })

        const result = await settled(() => sendChat(-1, { ...sendArg }))

        expect.soft(processScriptFullMock, 'message script runs').not.toHaveBeenCalled()
        expect.soft(supaMemoryMock, 'memory summarisations').not.toHaveBeenCalled()
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(result).toBe(false)
        expect.soft(shown().type, 'the alert showing').toBe('none')
    })

    test('an abort during memory summarisation sends no request, and ends the send with no alert', async () => {
        installCharWorld({ supaMemory: true }, { supaModelType: 'openAI' })
        supaMemoryMock.mockImplementation(async (chats: OpenAIChat[], currentTokens: number) => {
            abortUnitInProgress()
            return { chats, currentTokens }
        })

        const result = await settled(() => sendChat(-1, { ...sendArg }))

        expect(supaMemoryMock).toHaveBeenCalledTimes(1)
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(result).toBe(false)
        expect.soft(shown().type, 'the alert showing').toBe('none')
    })
})

describe('a formatted preview aborted at a stage boundary', () => {
    test('guard: an abort during memory summarisation ends it with no request and no alert', async () => {
        installCharWorld({ supaMemory: true }, { supaModelType: 'openAI' })
        supaMemoryMock.mockImplementation(async (chats: OpenAIChat[], currentTokens: number) => {
            abortUnitInProgress()
            return { chats, currentTokens }
        })

        const result = await settled(() => sendChat(-1, { preview: true, previewResult: {} }))

        expect(supaMemoryMock).toHaveBeenCalledTimes(1)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(result).toBe(false)
        expect(shown().type).toBe('none')
    })
})

describe.each([
    ['a real send', {}],
    ['a prompt preview', { previewPrompt: true }],
])('a group turn order walked by %s and aborted while a member is passed over', (_label, sendArg) => {
    test('an abort during the restore of a member who is then gone starts no later member', async () => {
        installGroupWorld({ cold: ['member-1', 'member-2'] })
        restoreColdCharacterMock.mockImplementation(async (chaId: string) => {
            if (chaId === 'member-1') {
                abortUnitInProgress()
                DBState.db.characters.splice(indexOfCharacter(chaId), 1)
                return false
            }
            DBState.db.characters[indexOfCharacter(chaId)] = makeMember(chaId)
            return true
        })
        answerPreviewRequests()

        const result = await settled(() => sendChat(-1, { ...sendArg }))

        expect.soft(restoreColdCharacterMock.mock.calls.map((call) => call[0]), 'members restored').toEqual(['member-1'])
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(result).toBe(false)
        expect.soft(shown().type, 'the alert showing').toBe('none')
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
    })
})

describe('a real group send aborted while a member still reports success', () => {
    test('an abort during a member\'s output trigger starts no later member', async () => {
        installGroupWorld({ cold: ['member-2'] })
        restoreColdCharacterMock.mockImplementation(async (chaId: string) => {
            DBState.db.characters[indexOfCharacter(chaId)] = makeMember(chaId)
            return true
        })
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => {
            if (mode === 'output') {
                abortUnitInProgress()
            }
            return undefined
        })
        requestChatDataMock.mockResolvedValue({ type: 'success', result: 'reply 1' })

        const result = await settled(() => sendChat())

        expect.soft(requestChatDataMock, 'requests').toHaveBeenCalledTimes(1)
        expect.soft(restoreColdCharacterMock, 'restores').not.toHaveBeenCalled()
        expect.soft(result).toBe(false)
        expect.soft(shown().type, 'the alert showing').toBe('none')
    })
})

describe('a prompt preview in a group chat', () => {
    test('it appends no reply, and every request the send makes carries the preview flag', async () => {
        installGroupWorld()
        answerPreviewRequests()

        const result = await settled(() => sendChat(-1, { previewPrompt: true, previewResult: {} }))

        expect.soft(result).toBe(true)
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
        expect.soft(requestArgs().length, 'requests').toBeGreaterThan(0)
        expect.soft(requestArgs().map((arg) => arg.previewBody), 'the preview flag on each request').toEqual(requestArgs().map(() => true))
    })

    test('it previews the first member in the order, once, and names them', async () => {
        installGroupWorld({ names: { 'member-1': 'Alice', 'member-2': 'Bob', 'member-3': 'Carol' } })
        answerPreviewRequests()
        const previewResult: PreviewResult = {}

        await settled(() => sendChat(-1, { previewPrompt: true, previewResult }))

        expect.soft(requestArgs().map((arg) => arg.currentChar.chaId), 'members requested').toEqual(['member-1'])
        expect.soft(previewResult.body, 'the previewed body').toBe(JSON.stringify({ url: 'u', body: { for: 'member-1' }, headers: {} }))
        expect.soft(previewResult.memberName, 'the member named').toBe('Alice')
    })

    test('without an order by order, a member named in the last message is the one previewed', async () => {
        installGroupWorld({
            names: { 'member-1': 'Alice', 'member-2': 'Bob', 'member-3': 'Carol' },
            lastMessage: 'Hello Carol',
            groupExtra: { orderByOrder: false },
        })
        answerPreviewRequests()
        const previewResult: PreviewResult = {}

        await settled(() => sendChat(-1, { previewPrompt: true, previewResult }))

        expect.soft(requestArgs().map((arg) => arg.currentChar.chaId), 'members requested').toEqual(['member-3'])
        expect.soft(previewResult.memberName, 'the member named').toBe('Carol')
    })

    test('a member who is gone ahead of the previewed one is skipped', async () => {
        installGroupWorld({ names: { 'member-1': 'Alice', 'member-2': 'Bob', 'member-3': 'Carol' } })
        DBState.db.characters.splice(indexOfCharacter('member-1'), 1)
        answerPreviewRequests()
        const previewResult: PreviewResult = {}

        await settled(() => sendChat(-1, { previewPrompt: true, previewResult }))

        expect.soft(requestArgs().map((arg) => arg.currentChar.chaId), 'members requested').toEqual(['member-2'])
        expect.soft(previewResult.memberName, 'the member named').toBe('Bob')
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
    })

    test('a member held twice ahead of the previewed one is skipped', async () => {
        installGroupWorld({ names: { 'member-1': 'Alice', 'member-2': 'Bob', 'member-3': 'Carol' } })
        DBState.db.characters.push(makeMember('member-1', 'Alice again'))
        answerPreviewRequests()
        const previewResult: PreviewResult = {}

        await settled(() => sendChat(-1, { previewPrompt: true, previewResult }))

        expect.soft(requestArgs().map((arg) => arg.currentChar.chaId), 'members requested').toEqual(['member-2'])
        expect.soft(previewResult.memberName, 'the member named').toBe('Bob')
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
    })

    test('a member call that fails ends the run as false, with its request made as a preview and no result', async () => {
        installGroupWorld()
        requestChatDataMock.mockResolvedValue({ type: 'fail', result: 'the provider refused' })
        const previewResult: PreviewResult = {}

        const result = await settled(() => sendChat(-1, { previewPrompt: true, previewResult }))

        expect.soft(result).toBe(false)
        expect.soft(requestArgs().length, 'requests').toBe(1)
        expect.soft(requestArgs().map((arg) => arg.previewBody), 'the preview flag on each request').toEqual([true])
        expect.soft(previewResult.body, 'the previewed body').toBeUndefined()
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
    })

    test('a member name with Markdown and HTML in it is shown as text', async () => {
        installGroupWorld({ names: { 'member-1': '<img src=x onerror=alert(1)> *bold* [link](https://example.com)' } })
        answerPreviewRequests()

        await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect.soft(shown().type, 'the alert showing').toBe('markdown')
        expect.soft(shown().msg, 'the name is shown').toContain('bold')
        expect.soft(shown().msg, 'a raw tag').not.toContain('<img')
        expect.soft(shown().msg, 'raw emphasis').not.toMatch(/(?<!\\)\*bold\*/)
        expect.soft(shown().msg, 'a raw link').not.toMatch(/(?<!\\)\[link\]\(/)
    })
})

describe('a group chat in which nobody is eligible to speak, without an order by order', () => {
    function installNobodyActive(): void {
        installGroupWorld({ groupExtra: { orderByOrder: false } })
        const lists = charById('group-1') as unknown as { characterActive: boolean[] }
        lists.characterActive = lists.characterActive.map(() => false)
    }

    test('a prompt preview does not throw, generates nothing and changes no chat', async () => {
        installNobodyActive()
        answerPreviewRequests()
        const previewResult: PreviewResult = {}

        const result = await settled(() => sendChat(-1, { previewPrompt: true, previewResult }))

        expect.soft(result, 'the outcome').toBe(true)
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
    })

    test('a real send does not throw, generates nothing and changes no chat', async () => {
        installNobodyActive()
        answerPreviewRequests()

        const result = await settled(() => sendChat())

        expect.soft(result, 'the outcome').toBe(true)
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
        expect.soft(get(doingChat), 'the busy flag').toBe(false)
    })
})

describe.each([
    ['order by order with nobody active', () => {
        installGroupWorld({ groupExtra: { orderByOrder: true } })
        const lists = charById('group-1') as unknown as { characterActive: boolean[] }
        lists.characterActive = lists.characterActive.map(() => false)
    }],
    ['no order by order with nobody active', () => {
        installGroupWorld({ groupExtra: { orderByOrder: false } })
        const lists = charById('group-1') as unknown as { characterActive: boolean[] }
        lists.characterActive = lists.characterActive.map(() => false)
    }],
    ['the only eligible member being the one who spoke last', () => {
        installGroupWorld({ groupExtra: { orderByOrder: false } })
        const lists = charById('group-1') as unknown as { characterActive: boolean[] }
        lists.characterActive = lists.characterActive.map((_active, i) => i === 0)
        groupChat().message[0].saying = 'member-1'
    }],
    ['every member in the order being skipped by its checks', () => {
        installGroupWorld({ groupExtra: { orderByOrder: true } })
        for (const id of ['member-1', 'member-2', 'member-3']) {
            DBState.db.characters.splice(indexOfCharacter(id), 1)
        }
    }],
])('a prompt preview in a group where nobody would speak: %s', (_label, arrange) => {
    test('the send reports no speaker, generates nothing and changes no chat', async () => {
        arrange()
        answerPreviewRequests()
        const previewResult: PreviewResult = {}

        const result = await settled(() => sendChat(-1, { previewPrompt: true, previewResult }))

        expect.soft(result, 'the outcome').toBe(true)
        expect.soft(previewResult.noSpeaker, 'no speaker').toBe(true)
        expect.soft(previewResult.body, 'the previewed body').toBeUndefined()
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
    })

    test.each([
        ['the prompt preview', 'prompt'],
        ['the formatted preview', 'no'],
    ])('%s shows the no-speaker message and nothing else', async (_modeLabel, join) => {
        arrange()
        answerPreviewRequests()
        const alerts = recordAlerts()

        await settled(() => runPreviewPrompt('normal', join, 'chatml', ''))

        expect.soft(shown()).toMatchObject({ type: 'markdown', msg: language.groupPreviewNoSpeaker })
        expect.soft(alerts.markdown().length, 'previews shown').toBe(1)
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
        expect.soft(get(doingChat), 'the busy flag').toBe(false)
    })
})

describe('a formatted preview in a group chat', () => {
    test('it names the previewed member above the messages, sends no request and appends no reply', async () => {
        installGroupWorld({ names: { 'member-1': 'Alice', 'member-2': 'Bob', 'member-3': 'Carol' } })
        answerPreviewRequests()

        await settled(() => runPreviewPrompt('normal', 'no', 'chatml', ''))

        expect.soft(shown().type, 'the alert showing').toBe('markdown')
        expect.soft(shown().msg.startsWith('> Previewing Alice\n### ')).toBe(true)
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(datas(groupChat()), 'the group chat').toEqual(['Hi'])
    })

    test('a member name with Markdown and HTML in it is shown as text', async () => {
        installGroupWorld({ names: { 'member-1': '<img src=x onerror=alert(1)> *bold*' } })

        await settled(() => runPreviewPrompt('normal', 'no', 'chatml', ''))

        const firstLine = shown().msg.split('\n')[0]
        expect.soft(firstLine, 'a raw tag').not.toContain('<img')
        expect.soft(firstLine, 'raw emphasis').not.toMatch(/(?<!\\)\*bold\*/)
        expect.soft(firstLine, 'the name is shown').toContain('bold')
    })

    test('a formatted preview of a single character has no Previewing line', async () => {
        installCharWorld()

        await settled(() => runPreviewPrompt('normal', 'no', 'chatml', ''))

        expect.soft(shown().type, 'the alert showing').toBe('markdown')
        expect.soft(shown().msg).not.toContain('Previewing')
    })

    test('a prompt preview names the previewed member in its heading', async () => {
        installGroupWorld({ names: { 'member-1': 'Alice', 'member-2': 'Bob', 'member-3': 'Carol' } })
        answerPreviewRequests()

        await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect(shown().type).toBe('markdown')
        expect(shown().msg.startsWith('### Prompt — Alice\n')).toBe(true)
    })

    test('a prompt preview of a single character has no member in its heading', async () => {
        installCharWorld()
        answerPreviewRequests()

        await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect(shown().type).toBe('markdown')
        expect(shown().msg.startsWith('### Prompt\n')).toBe(true)
    })
})

describe('a formatted preview aborted after its last stage', () => {
    test('an abort during the request-editing hook shows nothing and releases the busy flag', async () => {
        installCharWorld()
        vi.mocked(runLuaEditTrigger).mockImplementation(async (_char: unknown, type: string, formated: unknown) => {
            if (type === 'editRequest') {
                abortUnitInProgress()
            }
            return formated as never
        })
        const alerts = recordAlerts()

        try {
            const outcome = await settled(() => runPreviewPrompt('normal', 'no', 'chatml', ''))

            expect.soft(outcome, 'the run rejected with').not.toBeInstanceOf(Error)
            expect.soft(alerts.markdown(), 'previews shown').toEqual([])
            expect.soft(shown().type, 'the alert still showing').toBe('none')
            expect.soft(get(doingChat), 'the busy flag').toBe(false)
        } finally {
            vi.mocked(runLuaEditTrigger).mockImplementation(async (_char: unknown, _type: string, formated: unknown) => formated as never)
        }
    })
})

describe('Cancel on the preview\'s notice over the real send', () => {
    test('a Cancel before the start trigger stops the send there, shows nothing and releases the busy flag once the unit settles', async () => {
        installCharWorld()
        let busyWhenCancelled: boolean | undefined
        let noticeWasCancellable: boolean | undefined
        exampleMessageMock.mockImplementation(() => {
            busyWhenCancelled = get(doingChat)
            noticeWasCancellable = typeof shown().onCancel === 'function'
            shown().onCancel?.()
            return []
        })
        const alerts = recordAlerts()

        const outcome = await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect.soft(noticeWasCancellable, 'the notice had a cancel action').toBe(true)
        expect.soft(busyWhenCancelled, 'the busy flag while the send ran').toBe(true)
        expect.soft(outcome, 'the run rejected with').not.toBeInstanceOf(Error)
        expect.soft(runTriggerMock, 'trigger runs').not.toHaveBeenCalled()
        expect.soft(requestChatDataMock, 'requests').not.toHaveBeenCalled()
        expect.soft(alerts.markdown(), 'previews shown').toEqual([])
        expect.soft(shown().type, 'the alert still showing').toBe('none')
        expect.soft(get(doingChat), 'the busy flag after the unit settled').toBe(false)
    })

    test('a Cancel during the request of a prompt preview shows nothing, and a later preview runs', async () => {
        installCharWorld()
        requestChatDataMock.mockImplementationOnce(async () => {
            shown().onCancel?.()
            return { type: 'success', result: REQUEST_BODY }
        })
        const alerts = recordAlerts()

        await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect.soft(alerts.markdown(), 'previews shown by the cancelled run').toEqual([])
        expect.soft(get(doingChat), 'the busy flag').toBe(false)

        answerPreviewRequests()
        await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect.soft(shown().type, 'the alert showing after a later preview').toBe('markdown')
    })
})

describe('a prompt preview\'s masking is display only', () => {
    const SECRET_RESPONSE = JSON.stringify({
        url: 'https://api.example.com/v1/chat?key=URL-SECRET-VALUE',
        body: { model: 'test-model' },
        headers: { Authorization: 'Bearer HEADER-SECRET-VALUE', 'x-api-key': 'ANOTHER-SECRET-VALUE', 'content-type': 'application/json' },
    })

    test('the call\'s own result keeps the request as the request layer returned it, while the display hides the secrets', async () => {
        installCharWorld()
        requestChatDataMock.mockResolvedValue({ type: 'success', result: SECRET_RESPONSE })
        const previewResult: PreviewResult = {}

        await settled(() => sendChat(-1, { previewPrompt: true, previewResult }))

        expect.soft(previewResult.body, 'the result as the request layer returned it').toBe(SECRET_RESPONSE)

        await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect.soft(shown().type, 'the alert showing').toBe('markdown')
        expect.soft(shown().msg).toContain('test-model')
        expect.soft(shown().msg).toContain('application/json')
        expect.soft(shown().msg).not.toContain('URL-SECRET-VALUE')
        expect.soft(shown().msg).not.toContain('HEADER-SECRET-VALUE')
        expect.soft(shown().msg).not.toContain('ANOTHER-SECRET-VALUE')
        expect.soft(shown().msg).toContain('Bearer ••••')
        expect.soft(previewResult.body, 'the result after the display was rendered').toBe(SECRET_RESPONSE)
    })

    test('every request the send makes is a preview request with no mask in its arguments', async () => {
        installCharWorld()
        requestChatDataMock.mockResolvedValue({ type: 'success', result: SECRET_RESPONSE })

        await settled(() => runPreviewPrompt('normal', 'prompt', 'chatml', ''))

        expect.soft(requestArgs().length, 'requests').toBe(1)
        expect.soft(requestArgs().map((arg) => arg.previewBody), 'the preview flag').toEqual([true])
        expect.soft(JSON.stringify(requestArgs().map((arg) => arg.formated)), 'the messages sent').not.toContain('••••')
    })
})

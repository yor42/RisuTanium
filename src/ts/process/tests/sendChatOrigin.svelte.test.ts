/**
 * A send writes into the chat it started in, whatever moves while it runs.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) against a real
 * `$state` database, with the stream fed by a controllable `ReadableStream`
 * so an edit (a Branch, a delete, a switch) lands between two chunks
 * deterministically. Every module `index.svelte.ts` imports is mocked below
 * purely so the module can be exercised without real providers or storage,
 * copied from `sendChatSaveMarks.svelte.test.ts`; the differences are that
 * the mocks a scenario needs to steer (`runTrigger`, `runInlayScreen`, the
 * memory modules, `isLastCharPunctuation`, `processScriptFull`) are hoisted
 * spies, and `findCharacterbyId` is a faithful fake: the live character, or
 * a blank one with a fresh `chaId` on a miss, as production does.
 *
 * A caller that holds an origin passes it (with the objects it started from)
 * as `origin` and `originHint`; a caller that passes none gets one captured
 * at entry. Both must give the same result.
 *
 * Tests whose title starts with `guard:` pass with or without the origin
 * binding: they pin behaviour that must be preserved.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
import type { SendChatArg } from '../index.svelte'
import type { Origin } from '../chatOrigin'
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

//#endregion

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { isWriting, writeAt } from '../chatOrigin'
import { coldStorageHeader } from '../coldstorageData'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, decodeRisuSave } from '../../storage/risuSave'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../storage/characterSaveMarks'

//#region fixtures

type CharacterFixture = Database['characters'][number]

/** The call arguments of a caller that already holds an origin. */
interface OriginArgs extends SendChatArg {
    origin: Origin
    originHint: { owner: CharacterFixture, chat: Chat }
}

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

/** What a caller that holds the origin of `chatId` passes to `sendChat`. */
function originArgs(chaId: string, chatId: string, extra: SendChatArg = {}): OriginArgs {
    const owner = charById(chaId)
    const chat = owner.chats.find((c) => c.id === chatId)!
    return { ...extra, origin: { chaId, chatId }, originHint: { owner, chat } }
}

/**
 * A Branch on `chaId`'s chat `chatId`: a copy with a fresh id is put in front
 * of the character's chats and shown. Returns the copy's messages as they
 * were at that moment.
 */
function branchChat(chaId: string, chatId: string, copyId: string): Message[] {
    const owner = charById(chaId)
    const source = owner.chats.find((c) => c.id === chatId)!
    const copy = { ...snap(source), id: copyId } as Chat
    owner.chats.unshift(copy)
    owner.chatPage = 0
    return snap(owner.chats[0].message)
}

async function settle(): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, 0))
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (condition()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

interface ControlledStream {
    stream: ReadableStream<{ data: string }>
    push(text: string): void
    close(): void
}

function controlledStream(): ControlledStream {
    let controller: ReadableStreamDefaultController<{ data: string }> | undefined
    const stream = new ReadableStream<{ data: string }>({
        start(c) { controller = c },
    })
    return {
        stream,
        push(text) {
            try { controller?.enqueue({ data: text }) } catch { /* the reader cancelled it */ }
        },
        close() {
            try { controller?.close() } catch { /* the reader cancelled it */ }
        },
    }
}

/** A stream whose chunks are all available at once. */
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

function mockStreamingReply(...chunks: string[]): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: streamOf(...chunks) })
}

function mockReply(text: string): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
}

/**
 * Runs `call` against a stream that delivers `first`, lets the send process
 * it, runs `disturb`, then delivers `after` and ends the stream. Resolves to
 * the send's result, or to the error it threw.
 */
async function runStreamingSend(
    call: () => Promise<boolean>,
    plan: { first: string, disturb: () => void, after?: string[] },
): Promise<boolean | Error> {
    const source = controlledStream()
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
    const outcome = call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
    let finished = false
    void outcome.then(() => { finished = true })
    await until(() => finished || requestChatDataMock.mock.calls.length > 0, 'the request')
    if (finished) {
        return outcome
    }
    source.push(plan.first)
    await settle()
    plan.disturb()
    for (const chunk of plan.after ?? []) {
        source.push(chunk)
    }
    source.close()
    return outcome
}

function settled(call: () => Promise<boolean>): Promise<boolean | Error> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

const disposers: Array<() => void> = []

/**
 * The real change-tracking effects, save marks and encoder, set up the way
 * `saveDb` does, so a test can encode the database after a send and decode
 * what would be persisted.
 */
async function startSaveHarness() {
    const tracker = makeTracker()
    const markChanged = vi.fn()
    const cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged })
    })
    disposers.push(() => {
        cleanup()
        resetCharacterSaveMarksForTest()
    })
    flushSync()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    const encoder = new RisuSaveEncoder()
    await encoder.init(snap(DBState.db), { compression: false })
    tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]
    return {
        async decoded() {
            flushSync()
            const toSave = structuredClone(tracker) as toSaveType
            await encoder.set(snap(DBState.db), toSave)
            return decodeRisuSave(new Uint8Array(encoder.encode()!))
        },
    }
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
    doingChat.set(false)
})

afterEach(() => {
    while (disposers.length > 0) {
        disposers.pop()!()
    }
    selectedCharID.set(-1)
})

//#endregion

describe('a Branch during the stream', () => {
    test.each([
        ['captured at entry', false],
        ['passed by the caller', true],
    ] as const)('the whole reply lands in the chat it was sent from and is saved (origin %s)', async (_label, explicit) => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const save = await startSaveHarness()

        let copyBefore: Message[] = []
        const call = () => (explicit ? sendChat(-1, originArgs('char-0', 'chat-origin')) : sendChat())
        const result = await runStreamingSend(call, {
            first: 'Hello ',
            disturb: () => { copyBefore = branchChat('char-0', 'chat-origin', 'chat-branch') },
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        const origin = chatById('char-0', 'chat-origin')
        expect(datas(origin)).toEqual(['Hi', 'Hello World!'])
        expect(snap(chatById('char-0', 'chat-branch').message)).toEqual(copyBefore)

        const decoded = await save.decoded()
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-0')
        expect(decodedChar).toBeTruthy()
        const decodedOrigin = decodedChar!.chats.find((c: Chat) => c.id === 'chat-origin')
        const decodedCopy = decodedChar!.chats.find((c: Chat) => c.id === 'chat-branch')
        expect(decodedOrigin!.message.map((m: Message) => m.data)).toEqual(['Hi', 'Hello World!'])
        expect(decodedCopy!.message).toEqual(copyBefore)
    })

    test('the generation info and the streaming flags end on the origin chat, not on the copy', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)

        let copyBefore: Message[] = []
        const result = await runStreamingSend(() => sendChat(), {
            first: 'Hello ',
            disturb: () => { copyBefore = branchChat('char-0', 'chat-origin', 'chat-branch') },
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        const origin = chatById('char-0', 'chat-origin')
        expect(origin.isStreaming).toBe(false)
        expect(origin.message.at(-1)?.generationInfo?.stageTiming?.stage3).toEqual(expect.any(Number))
        expect(origin.message.at(-1)?.generationInfo?.stageTiming?.stage4).toEqual(expect.any(Number))
        expect(snap(chatById('char-0', 'chat-branch').message)).toEqual(copyBefore)
    })

    test('the chatOutput listeners are told the origin chat and its current indices', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const seen: ChatOutputArg[] = []
        chatOutputListeners.add((arg) => { seen.push(arg) })

        const result = await runStreamingSend(() => sendChat(), {
            first: 'Hello ',
            disturb: () => { branchChat('char-0', 'chat-origin', 'chat-branch') },
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        expect(seen).toHaveLength(1)
        expect(seen[0].char.chaId).toBe('char-0')
        expect(seen[0].chat.id).toBe('chat-origin')
        expect(seen[0].characterIndex).toBe(0)
        expect(seen[0].chatIndex).toBe(1)
        expect(seen[0].messageIndex).toBe(1)
    })
})

describe('a character inserted or deleted below the sending character during the stream', () => {
    test.each([
        ['a lower character is deleted permanently', 'char-c'],
        ['a character is inserted at a lower index', 'char-a'],
    ] as const)('the reply lands in the sending character and the character now at its old index is unchanged (%s)', async (label, victimId) => {
        const others = (id: string) => makeCharacter(id, [makeChat(`${id}-chat`, [msg('user', 'Hi'), msg('char', `${id}-reply`)])])
        installDb([
            others('char-a'),
            makeCharacter('char-b', [makeChat('b-chat', [msg('user', 'Hi')])]),
            others('char-c'),
        ])
        selectedCharID.set(1)
        const victimBefore = snap(charById(victimId))

        const result = await runStreamingSend(() => sendChat(), {
            first: 'Hello ',
            disturb: () => {
                if (label.startsWith('a lower character is deleted')) {
                    DBState.db.characters.splice(0, 1)
                    selectedCharID.set(-1)
                } else {
                    DBState.db.characters.unshift(others('char-new'))
                    selectedCharID.set(2)
                }
            },
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        expect(datas(chatById('char-b', 'b-chat'))).toEqual(['Hi', 'Hello World!'])
        expect(snap(charById(victimId))).toEqual(victimBefore)
    })
})

describe('an auto-continue after a switch to another chat of the same character', () => {
    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('the continuation is appended to the origin chat\'s reply and the other chat is unchanged (%s reply)', async (site) => {
        installDb(
            [makeCharacter('char-0', [
                makeChat('chat-origin', [msg('user', 'Hi')]),
                makeChat('chat-other', [msg('user', 'other-1'), msg('char', 'other-last', { chatId: 'other-last-id' })]),
            ])],
            { autoContinueChat: true },
        )
        selectedCharID.set(0)
        isLastCharPunctuationMock.mockImplementation((text: string) => /[.!?]$/.test(text))
        if (site === 'streaming') {
            mockStreamingReply('Hello')
            mockStreamingReply(' there.')
        } else {
            mockReply('Hello')
            mockReply(' there.')
        }
        let switched = false
        chatOutputListeners.add(() => {
            if (!switched) {
                switched = true
                charById('char-0').chatPage = 1
            }
        })
        const otherBefore = snap(chatById('char-0', 'chat-other'))

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'Hello there.'])
        expect(snap(chatById('char-0', 'chat-other'))).toEqual(otherBefore)
    })
})

describe('a resend requested by an output trigger after a switch to another chat', () => {
    test('the second generation is appended to the origin chat and the other chat is unchanged', async () => {
        installDb([makeCharacter('char-0', [
            makeChat('chat-origin', [msg('user', 'Hi')]),
            makeChat('chat-other', [msg('user', 'other-1'), msg('char', 'other-2')]),
        ])])
        selectedCharID.set(0)
        let resent = false
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => {
            if (mode === 'output' && !resent) {
                resent = true
                return { sendAIprompt: true }
            }
            return undefined
        })
        let switched = false
        chatOutputListeners.add(() => {
            if (!switched) {
                switched = true
                charById('char-0').chatPage = 1
            }
        })
        mockReply('First reply.')
        mockReply('Second reply.')
        const otherBefore = snap(chatById('char-0', 'chat-other'))

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'First reply.', 'Second reply.'])
        expect(snap(chatById('char-0', 'chat-other'))).toEqual(otherBefore)
    })
})

describe('the origin chat deleted during the stream', () => {
    test('the send ends quietly: no error, nothing written elsewhere, no continuation, doingChat cleared', async () => {
        installDb(
            [makeCharacter('char-0', [
                makeChat('chat-origin', [msg('user', 'Hi')]),
                makeChat('chat-other', [msg('user', 'other-1'), msg('char', 'other-2')]),
            ])],
            { autoContinueChat: true },
        )
        selectedCharID.set(0)
        isLastCharPunctuationMock.mockReturnValueOnce(false)
        const listener = vi.fn()
        chatOutputListeners.add(listener)
        const otherBefore = snap(chatById('char-0', 'chat-other'))

        const result = await runStreamingSend(() => sendChat(), {
            first: 'Hello ',
            disturb: () => { charById('char-0').chats.splice(0, 1) },
            after: ['Hello World!'],
        })

        expect(result).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(snap(chatById('char-0', 'chat-other'))).toEqual(otherBefore)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect(listener).not.toHaveBeenCalled()
        expect(runTriggerMock.mock.calls.filter((call) => call[1] === 'output')).toHaveLength(0)
        expect(get(doingChat)).toBe(false)
        expect(isWriting({ chaId: 'char-0' })).toBe(false)
    })
})

describe('the origin registered as being written to', () => {
    test('is registered for the whole request and stream and released afterwards', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const target = { chaId: 'char-0', chatId: 'chat-origin' }
        let duringRequest: boolean | undefined
        let duringStream: boolean | undefined
        let otherChatDuringStream: boolean | undefined
        requestChatDataMock.mockImplementationOnce(async () => {
            duringRequest = isWriting(target)
            return { type: 'streaming', result: streamOf('Hello') }
        })

        const result = await settled(() => sendChat())
        expect(duringRequest).toBe(true)
        expect(result).toBe(true)
        expect(isWriting(target)).toBe(false)

        doingChat.set(false)
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const second = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length >= 2, 'the second request')
        source.push('Hello')
        await settle()
        duringStream = isWriting(target)
        otherChatDuringStream = isWriting({ chaId: 'char-0', chatId: 'some-other-chat' })
        source.close()
        await second

        expect(duringStream).toBe(true)
        expect(otherChatDuringStream).toBe(false)
        expect(isWriting(target)).toBe(false)
    })

    test('ends when the request throws', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const target = { chaId: 'char-0', chatId: 'chat-origin' }
        let duringRequest: boolean | undefined
        requestChatDataMock.mockImplementationOnce(async () => {
            duringRequest = isWriting(target)
            throw new Error('provider down')
        })

        const result = await settled(() => sendChat())

        expect(duringRequest).toBe(true)
        expect(result).toBeInstanceOf(Error)
        expect(isWriting(target)).toBe(false)
    })

    test('ends when the caller aborts the stream', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const target = { chaId: 'char-0', chatId: 'chat-origin' }
        const controller = new AbortController()
        let duringStream: boolean | undefined

        const result = await runStreamingSend(() => sendChat(-1, { signal: controller.signal }), {
            first: 'Hello ',
            disturb: () => {
                duringStream = isWriting(target)
                controller.abort()
            },
        })

        expect(duringStream).toBe(true)
        expect(result).toBe(false)
        expect(isWriting(target)).toBe(false)
    })

    test('guard: a send refused because a generation is already running registers nothing and fills no ids', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        doingChat.set(true)

        const result = await settled(() => sendChat())

        expect(result).toBe(false)
        expect(isWriting({ chaId: 'char-0' })).toBe(false)
        expect(chatById('char-0', 'chat-origin').message[0].chatId).toBeUndefined()
        expect(get(doingChat)).toBe(true)
        expect(requestChatDataMock).not.toHaveBeenCalled()
    })

    test('guard: a send refused because its chat is still loading from cold storage registers nothing and fills no ids', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', `${coldStorageHeader}key`)])])])
        selectedCharID.set(0)

        const result = await settled(() => sendChat())

        expect(result).toBe(false)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(isWriting({ chaId: 'char-0' })).toBe(false)
        expect(chatById('char-0', 'chat-origin').message[0].chatId).toBeUndefined()
        expect(get(doingChat)).toBe(false)
    })
})

describe('a memory result and a Branch during the memory await', () => {
    test('a HypaV3 summary is written only to the origin chat', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])], { supaMemory: true })],
            { hypaV3: true },
        )
        selectedCharID.set(0)
        const memory = { summaries: [{ text: 'summary of the origin chat', chatMemos: [], isImportant: false }] }
        hypaMemoryV3Mock.mockImplementationOnce(async (chats: unknown[], currentTokens: number) => {
            branchChat('char-0', 'chat-origin', 'chat-branch')
            return { chats, currentTokens, memory }
        })
        mockReply('The reply.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(snap(chatById('char-0', 'chat-branch').hypaV3Data)).toBeUndefined()
        expect(snap(chatById('char-0', 'chat-origin').hypaV3Data)).toEqual(memory)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'The reply.'])
        expect(datas(chatById('char-0', 'chat-branch'))).toEqual(['Hi'])
    })

    test('a SupaMemory summary is written only to the origin chat', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])], { supaMemory: true })],
            { supaModelType: 'subModel' },
        )
        selectedCharID.set(0)
        supaMemoryMock.mockImplementationOnce(async (chats: unknown[], currentTokens: number) => {
            branchChat('char-0', 'chat-origin', 'chat-branch')
            return { chats, currentTokens, memory: 'summary of the origin chat', lastId: 'last-id' }
        })
        mockReply('The reply.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(chatById('char-0', 'chat-branch').supaMemoryData).toBeUndefined()
        expect(chatById('char-0', 'chat-origin').supaMemoryData).toBe('summary of the origin chat')
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'The reply.'])
        expect(datas(chatById('char-0', 'chat-branch'))).toEqual(['Hi'])
    })
})

describe('a send whose origin is passed while another screen is showing', () => {
    const screens: Array<[string, () => void]> = [
        ['another chat of the same character is on screen', () => { charById('char-0').chatPage = 1 }],
        ['another character is on screen', () => { selectedCharID.set(1) }],
        ['a cold chat that is still loading is on screen', () => {
            charById('char-1').chats[0].message[0].data = `${coldStorageHeader}key`
            selectedCharID.set(1)
        }],
        ['Home is showing', () => { selectedCharID.set(-1) }],
    ]

    function installTwoCharacters(): void {
        installDb([
            makeCharacter('char-0', [
                makeChat('chat-origin', [msg('user', 'Hi')]),
                makeChat('chat-other', [msg('user', 'other-1'), msg('char', 'other-2')]),
            ]),
            makeCharacter('char-1', [makeChat('c1-chat', [msg('user', 'c1-1'), msg('char', 'c1-2')])]),
        ])
    }

    test.each(screens)('the send generates into the origin and leaves the screen untouched (%s)', async (_label, showScreen) => {
        installTwoCharacters()
        selectedCharID.set(0)
        showScreen()
        const args = originArgs('char-0', 'chat-origin')
        const otherChatBefore = snap(chatById('char-0', 'chat-other'))
        const otherCharBefore = snap(charById('char-1'))
        const selectionBefore = get(selectedCharID)
        const pageBefore = charById('char-0').chatPage
        mockReply('The reply.')

        const result = await settled(() => sendChat(-1, args))

        expect(result).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'The reply.'])
        expect(snap(chatById('char-0', 'chat-other'))).toEqual(otherChatBefore)
        expect(snap(charById('char-1'))).toEqual(otherCharBefore)
        expect(get(selectedCharID)).toBe(selectionBefore)
        expect(charById('char-0').chatPage).toBe(pageBefore)
    })

    test('a reply written into a character that is not on screen is saved', async () => {
        installTwoCharacters()
        selectedCharID.set(1)
        const save = await startSaveHarness()
        const args = originArgs('char-0', 'chat-origin')
        mockReply('The reply.')

        const result = await settled(() => sendChat(-1, args))

        expect(result).toBe(true)
        const decoded = await save.decoded()
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-0')
        const decodedOrigin = decodedChar!.chats.find((c: Chat) => c.id === 'chat-origin')
        expect(decodedOrigin!.message.map((m: Message) => m.data)).toEqual(['Hi', 'The reply.'])
    })
})

describe('a send with nothing selected', () => {
    test.each([
        ['no arguments', () => sendChat()],
        ['an empty argument object', () => sendChat(-1, {})],
    ] as const)('returns false, throws nothing and leaves doingChat as it found it (%s)', async (_label, call) => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(-1)

        const result = await settled(call)

        expect(result).toBe(false)
        expect(get(doingChat)).toBe(false)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi'])
    })
})

describe('the reply deleted during the stream', () => {
    interface Remaining {
        label: string
        /** Removes the reply, and whatever else the variant removes, leaving the chat's last message as described. */
        remove: (chat: Chat) => void
        last: number
    }
    const remainings: Remaining[] = [
        {
            label: 'the user message the send answers is left last',
            remove: (chat) => { chat.message.pop() },
            last: 2,
        },
        {
            label: 'an earlier reply that carries generation info is left last',
            remove: (chat) => { chat.message.splice(2, 2) },
            last: 1,
        },
    ]
    const consequences = [
        ['auto-continue', { autoContinueChat: true }],
        ['the image-prompt append and the generation info write', { igpPrompt: 'describe the scene' }],
    ] as const

    describe.each(remainings.map((r) => [r.label, r] as const))('with %s', (_label, { remove, last }) => {
        test.each(consequences)('nothing is written to another message, no output trigger, TTS or listener runs for it, and the send carries on (%s)', async (label, overrides) => {
            const earlierInfo = { model: 'earlier-model', generationId: 'earlier-gen', inputTokens: 7, outputTokens: 8, maxContext: 9 }
            installDb(
                [makeCharacter('char-0', [makeChat('chat-origin', [
                    msg('user', 'q0', { chatId: 'q0-id' }),
                    msg('char', 'a0', { chatId: 'a0-id', generationInfo: earlierInfo }),
                    msg('user', 'q1', { chatId: 'q1-id' }),
                ])])],
                { ...overrides, ttsAutoSpeech: true },
            )
            selectedCharID.set(0)
            isLastCharPunctuationMock.mockReturnValueOnce(false)
            const listener = vi.fn()
            chatOutputListeners.add(listener)
            const before = snap(chatById('char-0', 'chat-origin').message)

            const result = await runStreamingSend(() => sendChat(), {
                first: 'Hello',
                disturb: () => { remove(chatById('char-0', 'chat-origin')) },
                after: [' World!'],
            })

            expect(result).toBe(true)
            const chat = chatById('char-0', 'chat-origin')
            expect(snap(chat.message)).toEqual(before.slice(0, last + 1))
            expect(chat.message[1].generationInfo).toEqual(earlierInfo)
            if (label === 'auto-continue') {
                expect(requestChatDataMock).toHaveBeenCalledTimes(1)
            }
            expect(sayTTSMock).not.toHaveBeenCalled()
            expect(listener).not.toHaveBeenCalled()
            expect(runTriggerMock.mock.calls.filter((call) => call[1] === 'output')).toHaveLength(0)
        })
    })

    test.each([
        ['deleted', (chat: Chat) => { chat.message.splice(0, 1) }, ['a0', 'q1', 'Hello World!']],
        ['inserted', (chat: Chat) => { chat.message.unshift(msg('user', 'inserted-early')) }, ['inserted-early', 'q0', 'a0', 'q1', 'Hello World!']],
    ] as const)('an earlier message %s during the stream leaves the reply complete and correct', async (_label, disturb, expected) => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [
            msg('user', 'q0'),
            msg('char', 'a0'),
            msg('user', 'q1'),
        ])])])
        selectedCharID.set(0)

        const result = await runStreamingSend(() => sendChat(), {
            first: 'Hello ',
            disturb: () => { disturb(chatById('char-0', 'chat-origin')) },
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        const chat = chatById('char-0', 'chat-origin')
        expect(datas(chat)).toEqual(expected)
        const lastFlush = processScriptFullMock.mock.calls.filter((call) => call[2] === 'editoutput').at(-1)!
        expect(lastFlush[3]).toBe(chat.message.length - 1)
    })
})

describe('a non-streaming continue with an inlay promise pending', () => {
    async function runContinue(disturb: (chat: Chat) => void): Promise<{ result: boolean | Error, chat: Chat, listenerIndex: number[] }> {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [
            msg('user', 'q0'),
            msg('char', 'Part one', { chatId: 'old-reply-id' }),
        ])])])
        selectedCharID.set(0)
        const listenerIndex: number[] = []
        chatOutputListeners.add((arg) => { listenerIndex.push(arg.messageIndex) })
        let release: (value: string) => void = () => {}
        const gate = new Promise<string>((res) => { release = res })
        let reached = false
        runInlayScreenMock.mockImplementationOnce((_char: unknown, text: string) => {
            reached = true
            return { text, promise: gate }
        })
        mockReply(' part two.')

        const outcome = settled(() => sendChat(-1, { continue: true }))
        await until(() => reached, 'the inlay promise')
        await settle()
        disturb(chatById('char-0', 'chat-origin'))
        release('Part one part two with inlay')
        const result = await outcome
        return { result, chat: chatById('char-0', 'chat-origin'), listenerIndex }
    }

    test('guard: with no other edit, the inlay text lands on the continued message', async () => {
        const { result, chat, listenerIndex } = await runContinue(() => {})

        expect(result).toBe(true)
        expect(datas(chat)).toEqual(['q0', 'Part one part two with inlay'])
        expect(listenerIndex).toEqual([1])
    })

    test.each([
        ['deleted', (chat: Chat) => { chat.message.splice(0, 1) }, ['Part one part two with inlay']],
        ['inserted', (chat: Chat) => { chat.message.unshift(msg('user', 'inserted-early')) }, ['inserted-early', 'q0', 'Part one part two with inlay']],
    ] as const)('an earlier message %s during the wait does not redirect the inlay write', async (_label, disturb, expected) => {
        const { result, chat, listenerIndex } = await runContinue(disturb)

        expect(result).toBe(true)
        expect(datas(chat)).toEqual(expected)
        expect(listenerIndex).toEqual([chat.message.length - 1])
    })
})

describe('a chat whose id is held twice during the send', () => {
    function duplicateOf(chaId: string, chatId: string): Chat {
        return snap(chatById(chaId, chatId))
    }

    test('guard: a copy that keeps the id and sits in front of the chat on screen before the send does not take the reply', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const originObject = chatById('char-0', 'chat-origin')
        const copy = duplicateOf('char-0', 'chat-origin')
        const owner = charById('char-0')
        owner.chats.unshift(copy)
        owner.chatPage = 1
        const copyBefore = snap(owner.chats[0].message)
        mockReply('The reply.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(datas(originObject)).toEqual(['Hi', 'The reply.'])
        expect(snap(owner.chats[0].message)).toEqual(copyBefore)
    })

    test.each([
        ['captured at entry', false],
        ['passed by the caller', true],
    ] as const)('a copy that keeps the id and is put in front during the stream does not take the reply (origin %s)', async (_label, explicit) => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const originObject = chatById('char-0', 'chat-origin')
        let copyBefore: Message[] = []

        const call = () => (explicit ? sendChat(-1, originArgs('char-0', 'chat-origin')) : sendChat())
        const result = await runStreamingSend(call, {
            first: 'Hello ',
            disturb: () => {
                const owner = charById('char-0')
                owner.chats.unshift(duplicateOf('char-0', 'chat-origin'))
                copyBefore = snap(owner.chats[0].message)
            },
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        expect(datas(originObject)).toEqual(['Hi', 'Hello World!'])
        expect(snap(charById('char-0').chats[0].message)).toEqual(copyBefore)
    })

    test('guard: a copy that keeps the id and is appended during the stream does not take the reply', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const originObject = chatById('char-0', 'chat-origin')
        let copyBefore: Message[] = []

        const result = await runStreamingSend(() => sendChat(), {
            first: 'Hello ',
            disturb: () => {
                const owner = charById('char-0')
                owner.chats.push(duplicateOf('char-0', 'chat-origin'))
                copyBefore = snap(owner.chats[1].message)
            },
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        expect(datas(originObject)).toEqual(['Hi', 'Hello World!'])
        expect(snap(charById('char-0').chats[1].message)).toEqual(copyBefore)
    })

    test('an auto-continue after a copy that keeps the id is put in front continues the reply in the chat it was sent from', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])],
            { autoContinueChat: true },
        )
        selectedCharID.set(0)
        isLastCharPunctuationMock.mockImplementation((text: string) => /[.!?]$/.test(text))
        const originObject = chatById('char-0', 'chat-origin')
        let copyBefore: Message[] = []
        let done = false
        chatOutputListeners.add(() => {
            if (!done) {
                done = true
                const owner = charById('char-0')
                owner.chats.unshift(duplicateOf('char-0', 'chat-origin'))
                copyBefore = snap(owner.chats[0].message)
            }
        })
        mockReply('Hello')
        mockReply(' there.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(datas(originObject)).toEqual(['Hi', 'Hello there.'])
        expect(snap(charById('char-0').chats[0].message)).toEqual(copyBefore)
    })

    test('a character copy that keeps the chaId and is put in front during the stream does not take the reply', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const originObject = charById('char-0')
        let copyBefore: CharacterFixture | undefined

        const result = await runStreamingSend(() => sendChat(), {
            first: 'Hello ',
            disturb: () => {
                DBState.db.characters.unshift(snap(charById('char-0')))
                copyBefore = snap(DBState.db.characters[0])
            },
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        expect(datas(originObject.chats[0])).toEqual(['Hi', 'Hello World!'])
        expect(snap(DBState.db.characters[0])).toEqual(copyBefore)
    })
})

describe('an output trigger that appends a message after the reply', () => {
    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('no continuation runs and neither the reply nor the appended message changes (%s reply)', async (site) => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])],
            { autoContinueChat: true },
        )
        selectedCharID.set(0)
        isLastCharPunctuationMock.mockImplementation((text: string) => /[.!?]$/.test(text))
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string, arg: { origin: Origin }) => {
            if (mode === 'output') {
                writeAt(arg.origin, (ctx) => {
                    ctx.chat.message.push(msg('char', 'appended by trigger', { chatId: 'appended-id' }))
                })
            }
            return undefined
        })
        if (site === 'streaming') {
            mockStreamingReply('Hello')
        } else {
            mockReply('Hello')
        }

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'Hello', 'appended by trigger'])
    })
})

describe('an error line after a Branch', () => {
    test('is written into the origin chat and not into the copy', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])],
            { inlayErrorResponse: true },
        )
        selectedCharID.set(0)
        let copyBefore: Message[] = []
        requestChatDataMock.mockImplementationOnce(async () => {
            copyBefore = branchChat('char-0', 'chat-origin', 'chat-branch')
            return { type: 'fail', result: 'provider exploded' }
        })

        const result = await settled(() => sendChat())

        expect(result).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
        const origin = chatById('char-0', 'chat-origin')
        expect(origin.message).toHaveLength(2)
        expect(origin.message[1].role).toBe('char')
        expect(origin.message[1].data).toContain('provider exploded')
        expect(snap(chatById('char-0', 'chat-branch').message)).toEqual(copyBefore)
    })
})

describe('guard: a send with no switch and no edit', () => {
    const generationKeys = ['generationId', 'inputTokens', 'maxContext', 'model', 'outputTokens', 'stageTiming']

    test('a streamed reply carries the fields it always carried', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)

        const result = await runStreamingSend(() => sendChat(), {
            first: 'Hello ',
            disturb: () => {},
            after: ['Hello World!'],
        })

        expect(result).toBe(true)
        const chat = chatById('char-0', 'chat-origin')
        expect(datas(chat)).toEqual(['Hi', 'Hello World!'])
        const reply = snap(chat.message[1])
        expect(Object.keys(reply).sort()).toEqual(['chatId', 'data', 'generationInfo', 'promptInfo', 'role', 'saying', 'time'])
        expect(reply.role).toBe('char')
        expect(reply.saying).toBe('char-0')
        expect(Object.keys(reply.generationInfo!).sort()).toEqual(generationKeys)
        expect(reply.generationInfo).toMatchObject({
            generationId: reply.chatId,
            maxContext: 999999,
            stageTiming: { stage1: expect.any(Number), stage2: expect.any(Number), stage3: expect.any(Number), stage4: expect.any(Number) },
        })
        expect(chat.isStreaming).toBe(false)
        expect(chat.activeStreamingDisplayOptimizationMode).toBeUndefined()
        expect(chat.message[0].chatId).toEqual(expect.any(String))
        expect(charById('char-0').reloadKeys).toBeGreaterThan(0)
        expect(DBState.db.statics.messages).toBe(1)
    })

    test('a non-streamed reply carries the fields it always carried', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        mockReply('The reply.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        const chat = chatById('char-0', 'chat-origin')
        expect(datas(chat)).toEqual(['Hi', 'The reply.'])
        const reply = snap(chat.message[1])
        expect(Object.keys(reply).sort()).toEqual(['chatId', 'data', 'generationInfo', 'promptInfo', 'role', 'saying', 'time'])
        expect(reply.saying).toBe('char-0')
        expect(Object.keys(reply.generationInfo!).sort()).toEqual(generationKeys)
        expect(reply.generationInfo).toMatchObject({
            generationId: reply.chatId,
            stageTiming: { stage1: expect.any(Number), stage2: expect.any(Number), stage3: expect.any(Number), stage4: expect.any(Number) },
        })
    })

    test('a streamed continue extends the last message in place', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [
            msg('user', 'Hi'),
            msg('char', 'Part one', { chatId: 'reply-id', saying: 'char-0', generationInfo: { generationId: 'old-generation' } }),
        ])])])
        selectedCharID.set(0)
        mockStreamingReply(' part two.')

        const result = await settled(() => sendChat(-1, { continue: true }))

        expect(result).toBe(true)
        const chat = chatById('char-0', 'chat-origin')
        expect(datas(chat)).toEqual(['Hi', 'Part one part two.'])
        expect(chat.message[1].chatId).toBe('reply-id')
        expect(chat.message[1].saying).toBe('char-0')
        expect(chat.message[1].generationInfo?.generationId).not.toBe('old-generation')
    })

    test('an auto-continue appends to the reply', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])],
            { autoContinueChat: true },
        )
        selectedCharID.set(0)
        isLastCharPunctuationMock.mockImplementation((text: string) => /[.!?]$/.test(text))
        mockStreamingReply('Hello')
        mockStreamingReply(' there.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'Hello there.'])
    })

    test('a HypaV3 summary is written to the chat', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])], { supaMemory: true })],
            { hypaV3: true },
        )
        selectedCharID.set(0)
        const memory = { summaries: [{ text: 'summary', chatMemos: [], isImportant: false }] }
        hypaMemoryV3Mock.mockImplementationOnce(async (chats: unknown[], currentTokens: number) => ({ chats, currentTokens, memory }))
        mockReply('The reply.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(snap(chatById('char-0', 'chat-origin').hypaV3Data)).toEqual(memory)
    })

    test('a SupaMemory summary and its last id are written to the chat', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])], { supaMemory: true })],
            { supaModelType: 'subModel' },
        )
        selectedCharID.set(0)
        supaMemoryMock.mockImplementationOnce(async (chats: unknown[], currentTokens: number) => ({ chats, currentTokens, memory: 'summary', lastId: 'last-id' }))
        mockReply('The reply.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        const chat = chatById('char-0', 'chat-origin')
        expect(chat.supaMemoryData).toBe('summary')
        expect(chat.lastMemory).toBe('last-id')
    })
})

describe('an output trigger that rebuilds the chat without message ids', () => {
    /** As a Lua `setFullChat` does: every message is rebuilt from its role and data alone. */
    function rebuildChatWithoutIds(_char: unknown, mode: string, arg: { origin: Origin }) {
        if (mode === 'output') {
            writeAt(arg.origin, (ctx) => {
                ctx.chat.message = ctx.chat.message.map((v) => ({ role: v.role, data: v.data }) as Message)
            })
        }
        return Promise.resolve(undefined)
    }

    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('the send carries on (guard): it returns true and the emotion request and the chatOutput listeners run; no TTS is spoken for the unlocatable reply (%s reply)', async (site) => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])], { viewScreen: 'emotion', emotionImages: [['happy', 'img']] })],
            { ttsAutoSpeech: true },
        )
        selectedCharID.set(0)
        runTriggerMock.mockImplementation(rebuildChatWithoutIds)
        const listener = vi.fn()
        chatOutputListeners.add(listener)
        if (site === 'streaming') {
            mockStreamingReply('Hello there.')
        } else {
            mockReply('Hello there.')
        }
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'happy' })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayTTSMock).not.toHaveBeenCalled()
        expect(requestChatDataMock.mock.calls.filter((call) => call[1] === 'emotion')).toHaveLength(1)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener.mock.calls[0][0].messageIndex).toBe(-1)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'Hello there.'])
    })

    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('nothing is written as the reply\'s inlay, generation info or image-prompt append, and no continuation runs (%s reply)', async (site) => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])],
            { autoContinueChat: true, igpPrompt: 'describe the scene' },
        )
        selectedCharID.set(0)
        runTriggerMock.mockImplementation(rebuildChatWithoutIds)
        isLastCharPunctuationMock.mockReturnValueOnce(false)
        if (site === 'streaming') {
            runInlayScreenMock.mockImplementation((_char: unknown, text: string) => ({ text, promise: Promise.resolve('INLAY-TEXT') }))
            mockStreamingReply('Hello there.')
        } else {
            mockReply('Hello there.')
        }
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'IGP-TEXT' })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(requestChatDataMock.mock.calls.filter((call) => call[1] === 'model')).toHaveLength(1)
        const chat = chatById('char-0', 'chat-origin')
        expect(datas(chat)).toEqual(['Hi', 'Hello there.'])
        expect(snap(chat.message).some((m) => 'generationInfo' in m)).toBe(false)
    })
})

describe('the tail writes of a send go to the reply, not to the last message', () => {
    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('the image-prompt text and the final generation info land on the reply and the appended message is unchanged (%s reply)', async (site) => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])],
            { igpPrompt: 'describe the scene' },
        )
        selectedCharID.set(0)
        const appendedInfo = { model: 'appended-model', generationId: 'appended-generation', inputTokens: 1, outputTokens: 2, maxContext: 3 }
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string, arg: { origin: Origin }) => {
            if (mode === 'output') {
                writeAt(arg.origin, (ctx) => {
                    ctx.chat.message.push(msg('char', 'appended by trigger', { chatId: 'appended-id', generationInfo: appendedInfo }))
                })
            }
            return undefined
        })
        if (site === 'streaming') {
            mockStreamingReply('Hello there.')
        } else {
            mockReply('Hello there.')
        }
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'IGP-TEXT' })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        const chat = chatById('char-0', 'chat-origin')
        expect(chat.message).toHaveLength(3)
        expect(snap(chat.message[2])).toEqual(msg('char', 'appended by trigger', { chatId: 'appended-id', generationInfo: appendedInfo }))
        expect(chat.message[1].data).toBe('Hello there.IGP-TEXT')
        expect(chat.message[1].generationInfo?.generationId).toBe(chat.message[1].chatId)
        expect(chat.message[1].generationInfo?.stageTiming?.stage4).toEqual(expect.any(Number))
    })
})

describe('the image-prompt request\'s result', () => {
    test('the text of a successful image-prompt request is appended to the reply', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])],
            { igpPrompt: 'describe the scene' },
        )
        selectedCharID.set(0)
        mockReply('Hello there.')
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'IGP-TEXT' })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(chatById('char-0', 'chat-origin').message[1].data).toBe('Hello there.IGP-TEXT')
    })

    test('a failed image-prompt request appends nothing to the reply', async () => {
        installDb(
            [makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])],
            { igpPrompt: 'describe the scene' },
        )
        selectedCharID.set(0)
        mockReply('Hello there.')
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'request failed' })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(chatById('char-0', 'chat-origin').message[1].data).toBe('Hello there.')
    })
})

describe('the ambiguity warning of a send', () => {
    const ambiguityWarnings = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.filter((call) => String(call[0]).includes('More than one'))

    test('guard: is logged at most once when the chat id is held twice and none is the chat the send started from, however many flushes follow', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const result = await runFlushedSend(12, 3, () => {
                const owner = charById('char-0')
                const copy = snap(owner.chats[0])
                owner.chats.splice(0, 1, copy, snap(copy))
            })

            expect(result).not.toBeInstanceOf(Error)
            expect(ambiguityWarnings(warn).length).toBeLessThanOrEqual(1)
            expect(alertErrorMock).not.toHaveBeenCalled()
        } finally {
            warn.mockRestore()
        }
    })

    test('is logged at most once when the chat id is held twice and one holder is the chat the send started from, however many flushes follow', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])])])
        selectedCharID.set(0)
        const originObject = chatById('char-0', 'chat-origin')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const result = await runFlushedSend(30, 3, () => {
                charById('char-0').chats.unshift(snap(originObject))
            })

            expect(result).toBe(true)
            expect(datas(originObject).at(-1)).toBe(cumulativeWords(30).at(-1))
            expect(ambiguityWarnings(warn).length).toBeLessThanOrEqual(1)
        } finally {
            warn.mockRestore()
        }
    })
})

function cumulativeWords(count: number): string[] {
    const words = Array.from({ length: count }, (_, i) => `w${i + 1}`)
    return words.map((_, i) => words.slice(0, i + 1).join(' '))
}

/** Streams `count` cumulative chunks into `sendChat()`, running `edit` just before chunk `editAt`. */
async function runFlushedSend(count: number, editAt: number, edit: () => void): Promise<boolean | Error> {
    const source = controlledStream()
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
    const outcome = settled(() => sendChat())
    let finished = false
    void outcome.then(() => { finished = true })
    await until(() => finished || requestChatDataMock.mock.calls.length > 0, 'the request')
    await settle()
    const chunks = cumulativeWords(count)
    for (let i = 0; i < chunks.length; i++) {
        if (i === editAt) {
            edit()
        }
        source.push(chunks[i])
        await settle()
    }
    source.close()
    return outcome
}

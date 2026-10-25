/**
 * A reply that ends while the page is hidden is saved at once, at the stream end (or the write of a
 * non-streaming reply) and again at the unit end. A hidden page's timers may be stopped, so the
 * debounce behind an ordinary mark never runs; only an explicit save request can commit the reply.
 *
 * Drives the REAL `sendChat` and observes the two persistence entry points it reaches: the
 * `requestSaveNow` and `markCharacterForSave` mocks. The module mocks follow
 * `sendChatInterrupted.svelte.test.ts` (copied, not shared: each suite mocks its own graph).
 * Mocked success does not prove native WebView behavior.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
import 'src/ts/polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const requestSaveNowMock = vi.hoisted(() => vi.fn())
const markSpy = vi.hoisted(() => vi.fn())

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
    alertError: vi.fn(),
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

// The persistence entry points under observation: the save request and the marks the helper adds.
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    requestSaveNow: requestSaveNowMock,
    requestNetSweep: vi.fn(),
    hasUnsavedSaveMarks: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('src/ts/storage/characterSaveMarks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/storage/characterSaveMarks')>()
    return { ...actual, markCharacterForSave: markSpy }
})

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { abortUnitInProgress } from 'src/ts/process/generationOwnership.svelte'
import { resetActiveStreamsForTest } from 'src/ts/process/activeStreams'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string): Message {
    return { role, data, time: 1 } as unknown as Message
}

function makeChat(id: string, message: Message[]): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message } as unknown as Chat
}

function makeCharacter(chaId: string, chats: Chat[]): CharacterFixture {
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

function chatById(chaId: string, chatId: string): Chat {
    return DBState.db.characters.find((c) => c.chaId === chaId)!.chats.find((c) => c.id === chatId)!
}

function installSingleChat(): void {
    installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])])])
    selectedCharID.set(0)
}

/** Two characters; the first generates, the test moves the selection to the second. */
function installTwoCharacters(): void {
    installDb([
        makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])]),
        makeCharacter('char-1', [makeChat('chat-1', [msg('user', 'Other')])]),
    ])
    selectedCharID.set(0)
}

function installGroupWorld(memberIds: string[]): void {
    const members = memberIds.map((id) => makeCharacter(id, [makeChat(`${id}-chat`, [msg('user', `${id} own`)])]))
    const group = makeGroup('group-1', memberIds, [makeChat('group-chat', [msg('user', 'Hi')])])
    installDb([group, ...members])
    selectedCharID.set(0)
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

function settled(call: () => Promise<boolean>): Promise<boolean | Error> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

/** The page's visibility, as the production helper reads it. */
function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

/** An output trigger that stays pending until released, like a trigger waiting on a stopped timer. */
function holdOutputTrigger(): { release: () => void } {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    runTriggerMock.mockImplementation(async (_char: unknown, type: string) => {
        if (type === 'output') {
            await held
        }
        return undefined
    })
    return { release }
}

interface SaveRequest {
    /** Marks made before this request, in order. */
    marks: Array<string | undefined>
    /** The watched reply message as it stood when the request was made. */
    data: string | undefined
    interrupted: boolean
}

const requests: SaveRequest[] = []
let watched: { chaId: string, chatId: string } = { chaId: 'char-0', chatId: 'chat-0' }

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    markSpy.mockReset()
    requestSaveNowMock.mockReset()
    requests.length = 0
    watched = { chaId: 'char-0', chatId: 'chat-0' }
    requestSaveNowMock.mockImplementation(() => {
        const chat = chatById(watched.chaId, watched.chatId)
        const reply = chat.message.at(-1)
        requests.push({
            marks: markSpy.mock.calls.map((call) => call[0] as string | undefined),
            data: reply?.data,
            interrupted: reply !== undefined && 'interrupted' in reply,
        })
    })
    doingChat.set(false)
    resetActiveStreamsForTest()
    setVisibility('hidden')
})

afterEach(() => {
    selectedCharID.set(-1)
    Reflect.deleteProperty(document, 'visibilityState')
})

//#endregion

describe('a reply that ends while the page is hidden', () => {
    test('streaming: the final text is requested for saving at the stream end, before a stuck output trigger', async () => {
        installSingleChat()
        const trigger = holdOutputTrigger()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: streamOf('Hello there.') })

        const outcome = settled(() => sendChat())
        await until(() => requests.length > 0, 'the save request at the stream end')

        expect(requests).toHaveLength(1)
        expect(requests[0].data).toBe('Hello there.')
        expect(requests[0].interrupted).toBe(false)
        expect(requests[0].marks).toContain('char-0')

        trigger.release()
        expect(await outcome).toBe(true)
    })

    test('non-streaming: the written reply is requested for saving before a stuck output trigger', async () => {
        installSingleChat()
        const trigger = holdOutputTrigger()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Plain reply.' })

        const outcome = settled(() => sendChat())
        await until(() => requests.length > 0, 'the save request after the reply was written')

        expect(requests).toHaveLength(1)
        expect(requests[0].data).toBe('Plain reply.')
        expect(requests[0].marks).toContain('char-0')

        trigger.release()
        expect(await outcome).toBe(true)
    })

    test('streaming: a finished unit requests a save at the stream end and again at the unit end', async () => {
        installSingleChat()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: streamOf('One.') })

        expect(await settled(() => sendChat())).toBe(true)

        expect(requests).toHaveLength(2)
        expect(requests.map((request) => request.data)).toEqual(['One.', 'One.'])
        expect(requests.every((request) => !request.interrupted)).toBe(true)
    })

    test('non-streaming: a finished unit requests a save after the write and again at the unit end', async () => {
        installSingleChat()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Done.' })

        expect(await settled(() => sendChat())).toBe(true)

        expect(requests).toHaveLength(2)
        expect(requests.map((request) => request.data)).toEqual(['Done.', 'Done.'])
    })

    test('the marks come before each request', async () => {
        installSingleChat()
        const order: string[] = []
        markSpy.mockImplementation((id: string | undefined) => { order.push(`mark:${id}`) })
        requestSaveNowMock.mockImplementation(() => { order.push('save') })
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Done.' })

        await settled(() => sendChat())

        expect(order.indexOf('mark:char-0')).toBeGreaterThanOrEqual(0)
        expect(order.indexOf('save')).toBeGreaterThan(order.indexOf('mark:char-0'))
    })

    test('a chat switch during generation: the generating character is marked, not the selected one', async () => {
        installTwoCharacters()
        const trigger = holdOutputTrigger()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.push('Half ')
        await settle()
        selectedCharID.set(1)
        source.push('Half done.')
        source.close()
        await until(() => requests.length > 0, 'the save request at the stream end')

        expect(requests[0].data).toBe('Half done.')
        expect(requests[0].marks).toContain('char-0')
        expect(requests[0].marks).not.toContain('char-1')

        trigger.release()
        await outcome
    })

    test('a group turn: the group and the speaking member are both marked', async () => {
        installGroupWorld(['member-a'])
        watched = { chaId: 'group-1', chatId: 'group-chat' }
        const trigger = holdOutputTrigger()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: streamOf('A speaks.') })

        const outcome = settled(() => sendChat())
        await until(() => requests.length > 0, 'the save request at the stream end')

        expect(requests[0].data).toBe('A speaks.')
        expect(requests[0].marks).toContain('group-1')
        expect(requests[0].marks).toContain('member-a')

        trigger.release()
        await outcome
    })

    test('a stopped reply: the text kept so far is requested for saving without the interrupted flag', async () => {
        installSingleChat()
        const trigger = holdOutputTrigger()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.push('Partial')
        await settle()
        abortUnitInProgress()
        source.close()
        await outcome

        expect(requests.length).toBeGreaterThanOrEqual(1)
        expect(requests[0].data).toBe('Partial')
        expect(requests[0].interrupted).toBe(false)
        expect(requests[0].marks).toContain('char-0')
        trigger.release()
    })
})

describe('a reply that ends while the page is visible', () => {
    // Compatibility guard: passes before and after the change. A visible page keeps its debounce.
    test('guard: streaming and non-streaming units request no save', async () => {
        setVisibility('visible')
        installSingleChat()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: streamOf('One.') })
        expect(await settled(() => sendChat())).toBe(true)
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Two.' })
        expect(await settled(() => sendChat())).toBe(true)

        expect(requestSaveNowMock).not.toHaveBeenCalled()
    })
})

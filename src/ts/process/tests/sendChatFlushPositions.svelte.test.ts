/**
 * The positions a streamed reply is written at, on every flush, equal those
 * of a fresh full resolution of the send's origin with the identity
 * tie-break (`resolveOriginWithHint`): the owner, the chat, the group turn's
 * member and the reply message.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) against a real
 * `$state` database, with the mocks of `sendChatOrigin.svelte.test.ts`. The
 * stream is fed one chunk at a time from a controllable `ReadableStream`, and
 * an edit lands between two chunks. `setStreamFlushObserverForTests` reports,
 * on each write to the reply, the indices the send used; the observer takes
 * the reference resolution in the same synchronous stretch, so both see the
 * same database.
 *
 * A group turn pins its member when the turn starts, so a `chaId` that gains
 * a second holder mid-turn keeps its member where a fresh resolution finds
 * none; the test that pins this is labelled `guard:`.
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

import { sendChat, doingChat, setStreamFlushObserverForTests, type StreamFlushUse } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { resolveOriginWithHint, resolutionCountForTests, resetResolutionCountForTests, type OriginContext } from '../chatOrigin'

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
    doingChat.set(false)
})

afterEach(() => {
    selectedCharID.set(-1)
})

//#endregion

//#region flush observation

interface FlushRecord {
    use: StreamFlushUse
    /** A fresh full resolution with the identity tie-break, taken in the same synchronous stretch as the write. */
    ref: OriginContext | null
    /** The index of the tracked reply in the reference's chat, by the same tie-break one level down. */
    refReplyIndex: number
    /** How many full scans had been made when the write happened. */
    scans: number
}

/**
 * The reply's index in the reference resolution's chat: the sole holder of
 * the id, or, when several messages hold it, the one that is the message
 * object the reply started as (-1 when none is).
 */
function referenceReplyIndex(ref: OriginContext | null, replyId: string, startingObject: Message | undefined): number {
    if (!ref) {
        return -1
    }
    const holders: number[] = []
    ref.chat.message.forEach((m, i) => {
        if (m.chatId === replyId) {
            holders.push(i)
        }
    })
    if (holders.length === 1) {
        return holders[0]
    }
    return holders.find((i) => ref.chat.message[i] === startingObject) ?? -1
}

interface FlushRun {
    result: boolean | Error
    records: FlushRecord[]
}

/**
 * Streams `chunks` (each one the whole reply so far) into `call`, one flush
 * per chunk, applying `edits[i]` just before chunk `i` is delivered and
 * letting the send finish each flush before the next chunk. Every write the
 * send makes to the reply is recorded together with a fresh full resolution.
 */
async function runFlushes(options: {
    call: () => Promise<boolean>
    replyChat: () => Chat
    chunks: string[]
    edits?: Record<number, () => void>
}): Promise<FlushRun> {
    const records: FlushRecord[] = []
    let startingObject: Message | undefined
    setStreamFlushObserverForTests((use) => {
        const ref = resolveOriginWithHint(use.origin, use.hint)
        records.push({ use, ref, refReplyIndex: referenceReplyIndex(ref, use.replyId, startingObject), scans: resolutionCountForTests() })
    })
    try {
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(options.call)
        let finished = false
        void outcome.then(() => { finished = true })
        await until(() => finished || options.replyChat().message.at(-1)?.role === 'char', 'the reply placeholder')
        startingObject = options.replyChat().message.at(-1)
        for (let i = 0; i < options.chunks.length; i++) {
            options.edits?.[i]?.()
            source.push(options.chunks[i])
            await settle()
        }
        source.close()
        return { result: await outcome, records }
    } finally {
        setStreamFlushObserverForTests(null)
    }
}

function cumulative(count: number): string[] {
    const words = Array.from({ length: count }, (_, i) => `w${i + 1}`)
    return words.map((_, i) => words.slice(0, i + 1).join(' '))
}

/** Every flush used the positions a fresh full resolution gives. */
function expectSamePositionsAsReference(records: FlushRecord[]): void {
    expect(records.every((r) => r.ref !== null)).toBe(true)
    const used = records.map((r) => ({ owner: r.use.ownerIndex, chat: r.use.chatIndex, member: r.use.memberIndex, reply: r.use.replyIndex }))
    const reference = records.map((r) => ({ owner: r.ref?.ownerIndex, chat: r.ref?.chatIndex, member: r.ref?.memberIndex, reply: r.refReplyIndex }))
    expect(used).toEqual(reference)
}

//#endregion

//#region worlds

/** The sending character is in slot 1 of 3, and its sending chat in slot 1 of 3. */
function installOneCharacterWorld(): void {
    installDb([
        makeCharacter('char-a', [makeChat('a-chat', [msg('user', 'a-1')])]),
        makeCharacter('char-0', [
            makeChat('chat-x', [msg('user', 'x-1')]),
            makeChat('chat-origin', [msg('user', 'q0'), msg('char', 'a0'), msg('user', 'q1')]),
            makeChat('chat-z', [msg('user', 'z-1')]),
        ], { chatPage: 1 }),
        makeCharacter('char-c', [makeChat('c-chat', [msg('user', 'c-1')])]),
    ])
    selectedCharID.set(1)
}

function originChat(): Chat {
    return chatById('char-0', 'chat-origin')
}

function makeMember(chaId: string): CharacterFixture {
    return makeCharacter(chaId, [makeChat(`${chaId}-chat`, [msg('user', `${chaId} own`)])])
}

/** The group is in slot 0 with its sending chat in slot 1 of 2, and three members are in slots 1 to 3. */
function installGroupWorld(): void {
    const group = {
        chaId: 'group-1',
        name: 'group-1',
        type: 'group',
        chatPage: 1,
        image: '',
        characters: ['member-1', 'member-2', 'member-3'],
        characterActive: [true, true, true],
        characterTalks: [1, 1, 1],
        orderByOrder: true,
        reloadKeys: 0,
        supaMemory: false,
        chats: [
            makeChat('g-chat-x', [msg('user', 'x-1')]),
            makeChat('group-chat', [msg('user', 'q0'), msg('char', 'a0', { saying: 'member-1' }), msg('user', 'q1')]),
        ],
    } as unknown as CharacterFixture
    installDb([group, makeMember('member-1'), makeMember('member-2'), makeMember('member-3')])
    selectedCharID.set(0)
}

function groupReplyChat(): Chat {
    return chatById('group-1', 'group-chat')
}

//#endregion

describe('the positions a streamed reply is written at equal a full resolution', () => {
    test('guard: an undisturbed stream never scans per flush, whatever its length', async () => {
        const runOnce = async (chunkCount: number) => {
            installOneCharacterWorld()
            resetResolutionCountForTests()
            const run = await runFlushes({ call: () => sendChat(), replyChat: originChat, chunks: cumulative(chunkCount) })
            return { run, scans: resolutionCountForTests() }
        }

        const short = await runOnce(2)
        doingChat.set(false)
        const long = await runOnce(40)

        expect(long.run.result).toBe(true)
        expect(long.run.records).toHaveLength(40)
        expectSamePositionsAsReference(long.run.records)
        expect(long.run.records.map((r) => r.use.ownerIndex)).toEqual(Array(40).fill(1))
        expect(long.run.records.map((r) => r.use.chatIndex)).toEqual(Array(40).fill(1))
        expect(long.run.records.map((r) => r.use.replyIndex)).toEqual(Array(40).fill(3))
        // A flush that takes the fast path makes no full scan, so the count
        // does not move between two flushes and does not depend on how many
        // chunks the stream has.
        expect(long.run.records.map((r) => r.scans - long.run.records[0].scans)).toEqual(Array(40).fill(0))
        expect(long.scans).toBe(short.scans)
    })

    test('guard: an undisturbed group turn never scans per flush, whatever its length', async () => {
        const runOnce = async (chunkCount: number) => {
            installGroupWorld()
            resetResolutionCountForTests()
            const run = await runFlushes({ call: () => sendChat(1), replyChat: groupReplyChat, chunks: cumulative(chunkCount) })
            return { run, scans: resolutionCountForTests() }
        }

        const short = await runOnce(2)
        doingChat.set(false)
        const long = await runOnce(40)

        expect(long.run.result).toBe(true)
        expect(long.run.records).toHaveLength(40)
        expectSamePositionsAsReference(long.run.records)
        expect(long.run.records.map((r) => r.use.memberIndex)).toEqual(Array(40).fill(2))
        expect(long.run.records.map((r) => r.scans - long.run.records[0].scans)).toEqual(Array(40).fill(0))
        expect(long.scans).toBe(short.scans)
    })

    test('a whole-slot replacement of the origin character with the same ids is adopted and every later flush matches', async () => {
        installOneCharacterWorld()
        const chunks = cumulative(5)

        const { result, records } = await runFlushes({
            call: () => sendChat(),
            replyChat: originChat,
            chunks,
            edits: { 2: () => { DBState.db.characters[1] = snap(charById('char-0')) } },
        })

        expect(result).toBe(true)
        expect(records).toHaveLength(5)
        expectSamePositionsAsReference(records)
        expect(originChat().message.at(-1)?.data).toBe(chunks[4])
        for (let i = 2; i < records.length; i++) {
            expect(records[i].scans).toBeGreaterThan(records[i - 1].scans)
        }
    })

    test('a whole-slot replacement of the origin chat with the same id is adopted and every later flush matches', async () => {
        installOneCharacterWorld()
        const chunks = cumulative(5)

        const { result, records } = await runFlushes({
            call: () => sendChat(),
            replyChat: originChat,
            chunks,
            edits: { 2: () => { charById('char-0').chats[1] = snap(originChat()) } },
        })

        expect(result).toBe(true)
        expect(records).toHaveLength(5)
        expectSamePositionsAsReference(records)
        expect(originChat().message.at(-1)?.data).toBe(chunks[4])
        for (let i = 2; i < records.length; i++) {
            expect(records[i].scans).toBeGreaterThan(records[i - 1].scans)
        }
    })

    test('an in-place change of the origin chat id ends the writes: nothing is written anywhere afterwards', async () => {
        installOneCharacterWorld()
        let afterEdit: unknown
        let originWasGone = false

        const { result, records } = await runFlushes({
            call: () => sendChat(),
            replyChat: originChat,
            chunks: cumulative(5),
            edits: {
                2: () => {
                    originChat().id = 'renamed-chat'
                    afterEdit = snap(DBState.db.characters)
                    originWasGone = resolveOriginWithHint({ chaId: 'char-0', chatId: 'chat-origin' }) === null
                },
            },
        })

        expect(originWasGone).toBe(true)
        expect(result).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(records).toHaveLength(2)
        expectSamePositionsAsReference(records)
        expect(snap(DBState.db.characters)).toEqual(afterEdit)
        expect(get(doingChat)).toBe(false)
    })

    test.each([
        ['a chat put in front of the sending chat', () => {
            const group = charById('group-1')
            group.chats.unshift(makeChat('g-chat-new', [msg('user', 'new-1')]))
        }, 2, 2],
        ['a chat put in front of the sending chat and a character put in front of the members', () => {
            const group = charById('group-1')
            group.chats.unshift(makeChat('g-chat-new', [msg('user', 'new-1')]))
            DBState.db.characters.unshift(makeMember('inserted'))
        }, 2, 3],
        ['the group\'s chats reversed', () => {
            charById('group-1').chats.reverse()
        }, 0, 2],
    ] as const)('in a group turn, %s: the owner falls back and the member is still found', async (_label, edit, expectedChat, expectedMember) => {
        installGroupWorld()
        const chunks = cumulative(5)

        const { result, records } = await runFlushes({
            call: () => sendChat(1),
            replyChat: groupReplyChat,
            chunks,
            edits: { 2: edit },
        })

        expect(result).toBe(true)
        expect(records).toHaveLength(5)
        expectSamePositionsAsReference(records)
        expect(records.slice(2).map((r) => r.use.memberIndex)).toEqual(Array(3).fill(expectedMember))
        expect(groupReplyChat().message.at(-1)?.data).toBe(chunks[4])
        expect(records.slice(2).map((r) => r.use.chatIndex)).toEqual(Array(3).fill(expectedChat))
    })

    test('a copy of the reply that keeps its id, inserted before it, leaves the reply the message the send started with', async () => {
        installOneCharacterWorld()
        const chunks = cumulative(5)
        let copyBefore: Message | undefined

        const { result, records } = await runFlushes({
            call: () => sendChat(),
            replyChat: originChat,
            chunks,
            edits: {
                2: () => {
                    const chat = originChat()
                    const replyIndex = chat.message.length - 1
                    chat.message.splice(replyIndex, 0, snap(chat.message[replyIndex]))
                    copyBefore = snap(chat.message[replyIndex])
                },
            },
        })

        expect(result).toBe(true)
        expect(records).toHaveLength(5)
        expectSamePositionsAsReference(records)
        expect(records.map((r) => r.use.replyIndex)).toEqual([3, 3, 4, 4, 4])
        expect(originChat().message).toHaveLength(5)
        expect(originChat().message[3].data).toBe(copyBefore?.data)
        expect(snap(originChat().message[3])).toEqual(copyBefore)
        expect(originChat().message[4].data).toBe(chunks[4])
    })

    test('guard: a member chaId held twice mid-turn keeps the turn\'s member, where a fresh full resolution finds none', async () => {
        installGroupWorld()
        const chunks = cumulative(5)

        const { result, records } = await runFlushes({
            call: () => sendChat(1),
            replyChat: groupReplyChat,
            chunks,
            edits: { 2: () => { DBState.db.characters.push(snap(charById('member-2'))) } },
        })

        expect(result).toBe(true)
        expect(records).toHaveLength(5)
        expect(records.map((r) => r.use.memberIndex)).toEqual(Array(5).fill(2))
        expect(records.map((r) => r.ref?.memberIndex ?? null).slice(2)).not.toContain(2)
        expect(records.map((r) => [r.use.ownerIndex, r.use.chatIndex, r.use.replyIndex])).toEqual(
            records.map((r) => [r.ref?.ownerIndex, r.ref?.chatIndex, r.refReplyIndex]),
        )
        expect(groupReplyChat().message.at(-1)?.data).toBe(chunks[4])
    })
})

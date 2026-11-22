/**
 * The text a streamed reply stores while a CBS block is still open (#444): the open span stays raw from its opener on, so
 * the chat view's hold can hide it behind the Formatting chip, and the text stored when the stream ends is the output
 * scripts' pass over the whole text, as it is without the hold.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) against a real `$state` database, with the mocks and the eager
 * producer of `sendChatStreamLatest.svelte.test.ts`. `processScriptFull` is the observation point of the 'editoutput' pass:
 * the test records its inputs and models what the scripts do to CBS (a macro is replaced, every other `{{...}}` tag is
 * consumed). The stored text is judged by the REAL `splitStreamingText` and `describeOpenTail`.
 *
 * Classes: T-P1, T-P1b and T-P5 (balanced) are regression reproducers: on the pre-change base the pass input is the whole
 * partial text. T-P2, T-P3, T-P4, T-P4b and T-P5 (strong) are compatibility guards: the stored final text is the pass over
 * the whole text, before and after the change.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does (`import "./ts/polyfill"`).
import '../../polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())

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

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), async () => {
    const stores = await import('../../stores.svelte')
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
    sayTTS: vi.fn(),
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
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

//#endregion

import { sendChat, setStreamFlushObserverForTests } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { activeStreamChars, resetActiveStreamsForTest } from '../activeStreams'
import { settleUsage } from '../../usage/usageCapture'
import { createUsageMeter } from '../../usage/usageMeter'
import type { StreamResponseChunk } from '../request/request'
import { describeOpenTail, splitStreamingText } from '../../chatShell/streamingSafe'
import { clearRunningSends } from './activeUnits.test-helpers'

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

/** One character with one chat, selected. */
function installOneCharacterWorld(): void {
    installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'q0')])])])
    selectedCharID.set(0)
}

function originChat(): Chat {
    return DBState.db.characters.find((c) => c.chaId === 'char-0')!.chats.find((c) => c.id === 'chat-origin')!
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

/**
 * The producer of a request module: eager (the controller is captured and enqueued to without checking `desiredSize`,
 * a fresh object per snapshot), behind the real `settleUsage` pass-through, which is what the send reads.
 */
function eagerProducer(): {
    result: ReadableStream<StreamResponseChunk>
    push(text: string, extra?: StreamResponseChunk): void
    close(): void
    error(reason: unknown): void
    cancelCount(): number
} {
    let controller: ReadableStreamDefaultController<StreamResponseChunk> | undefined
    let cancels = 0
    const inner = new ReadableStream<StreamResponseChunk>({
        start(c) { controller = c },
        cancel() { cancels += 1 },
    })
    const arg = { usageMeter: createUsageMeter(), aiModel: 'm', formated: [] }
    const wrapped = settleUsage(arg, 'model', { type: 'streaming', result: inner })
    if (wrapped.type !== 'streaming') {
        throw new Error('settleUsage did not wrap the stream')
    }
    return {
        result: wrapped.result,
        push(text, extra) { try { controller?.enqueue({ '0': text, ...extra }) } catch { /* the reader cancelled it */ } },
        close() { try { controller?.close() } catch { /* the reader cancelled it */ } },
        error(reason) { try { controller?.error(reason) } catch { /* the reader cancelled it */ } },
        cancelCount: () => cancels,
    }
}

/** What the observer saw at each write of the reply: its stored text and the hidden keep-alive read. */
function observeWrites(): { writes: Array<{ stored: string, hidden: number | null }>, stop(): void } {
    const writes: Array<{ stored: string, hidden: number | null }> = []
    setStreamFlushObserverForTests(() => {
        writes.push({ stored: originChat().message.at(-1)?.data ?? '', hidden: activeStreamChars('char-0', true) })
    })
    return { writes, stop: () => setStreamFlushObserverForTests(null) }
}

async function startStreamingSend(source: ReturnType<typeof eagerProducer>, arg: Parameters<typeof sendChat>[1] = {}): Promise<{ sent: Promise<unknown> }> {
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.result })
    const outcome = sendChat(-1, arg).catch((error: unknown) => error)
    await until(() => originChat().message.at(-1)?.role === 'char', 'the reply placeholder')
    return { sent: outcome }
}

// The frame functions as the environment had them, put back after a test replaced them.
let originalFrames: { request: typeof requestAnimationFrame, cancel: typeof cancelAnimationFrame } | null = null

function installFramesRunSoon(): void {
    originalFrames ??= { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame }
    globalThis.requestAnimationFrame = ((callback: () => void) => setTimeout(callback, 0)) as unknown as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((handle: number) => clearTimeout(handle)) as unknown as typeof cancelAnimationFrame
}

function restoreFrames(): void {
    if (originalFrames !== null) {
        globalThis.requestAnimationFrame = originalFrames.request
        globalThis.cancelAnimationFrame = originalFrames.cancel
        originalFrames = null
    }
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    clearRunningSends()
    resetActiveStreamsForTest()
})

afterEach(() => {
    selectedCharID.set(-1)
    setStreamFlushObserverForTests(null)
    restoreFrames()
})

//#endregion
//#region the output scripts' model

const PARTIAL = 'A {{user}}\n\n{{#if 1}}\n\nB\n\nC\n\n'

/** The pass over a whole text: a macro is replaced and every other CBS tag is consumed, as the real scripts do. */
function scripted(text: string): string {
    return text.replace(/\{\{user\}\}/g, 'Ari').replace(/\{\{[^}]*\}\}/g, '')
}

/** What every write of the send receives: the text as `reformatContent` leaves it. */
function sent(text: string): string {
    return text.trim()
}

/** Records the text of every 'editoutput' pass; the pass throws for a text that holds `failOn`. */
function recordPasses(failOn?: string): string[] {
    const inputs: string[] = []
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string, type: string) => {
        if (type !== 'editoutput') {
            return { data: text, emoChanged: false }
        }
        inputs.push(text)
        if (failOn !== undefined && text.includes(failOn)) {
            throw new Error('script failed')
        }
        return { data: scripted(text), emoChanged: false }
    })
    return inputs
}

async function untilLong(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 1000; i++) {
        if (condition()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

//#endregion

describe('the stored partial keeps an open CBS block raw', () => {
    // Regression reproducer (T-P1). Pre-fix base: the whole text is processed, so the opener is consumed and B and C
    // show as finished paragraphs after a stray gap.
    test('T-P1 off mode: only the text before the open block is processed, the block stays raw behind the Formatting chip', async () => {
        installOneCharacterWorld()
        const inputs = recordPasses()
        const observed = observeWrites()
        try {
            const source = eagerProducer()
            const started = await startStreamingSend(source)
            source.push(PARTIAL)
            await until(() => observed.writes.length === 1, 'the partial write')
            source.close()
            await started.sent
        } finally {
            observed.stop()
        }

        expect(inputs[0]).toBe('A {{user}}\n\n')
        const stored = observed.writes[0].stored
        expect(stored).toBe('A Ari\n\n{{#if 1}}\n\nB\n\nC')
        const split = splitStreamingText(stored)
        expect(split.finished).toEqual(['A Ari\n\n'])
        expect(describeOpenTail(split.open).chip?.kind).toBe('formatting')
    })

    // Regression reproducer (T-P1b). Pre-fix base: the whole text is processed. A split at the first span instead of the
    // open one would leave the closed block and the paragraph after it unprocessed.
    test('T-P1b a closed block before the open one is processed, the split is at the open one', async () => {
        installOneCharacterWorld()
        const inputs = recordPasses()
        const observed = observeWrites()
        const partial = 'A {{user}}\n\n{{#if 1}}x{{/if}}\n\nB\n\n{{#if 1}}\n\nC\n\nD'
        try {
            const source = eagerProducer()
            const started = await startStreamingSend(source)
            source.push(partial)
            await until(() => observed.writes.length === 1, 'the partial write')
            source.close()
            await started.sent
        } finally {
            observed.stop()
        }

        expect(inputs[0]).toBe('A {{user}}\n\n{{#if 1}}x{{/if}}\n\nB\n\n')
        expect(observed.writes[0].stored).toBe('A Ari\n\nx\n\nB\n\n{{#if 1}}\n\nC\n\nD')
    })

    // Compatibility guard (T-P2): passes before and after. The block closes: the last write is the pass over the whole
    // text and nothing is processed again at the end.
    test('T-P2 a block that closes is processed whole by the closing write, with no extra pass at the end', async () => {
        installOneCharacterWorld()
        const inputs = recordPasses()
        const closed = PARTIAL + '{{/if}}\n\nD'
        const source = eagerProducer()
        const started = await startStreamingSend(source)
        source.push(PARTIAL)
        await until(() => inputs.length === 1, 'the first pass')
        await settle()
        source.push(closed)
        await until(() => inputs.length === 2, 'the second pass')
        await settle()
        source.close()
        const outcome = await started.sent

        expect(outcome).toBe(true)
        expect(inputs).toHaveLength(2)
        expect(inputs[1]).toBe(sent(closed))
        expect(originChat().message.at(-1)?.data).toBe(scripted(sent(closed)))
    })

    // Compatibility guard (T-P3): passes before; fails without the settle step.
    test('T-P3 a stream that ends with the block open stores the pass over the whole text', async () => {
        installOneCharacterWorld()
        const inputs = recordPasses()
        const source = eagerProducer()
        const started = await startStreamingSend(source)
        source.push(PARTIAL)
        await until(() => inputs.length === 1, 'the first pass')
        await settle()
        source.close()
        const outcome = await started.sent

        expect(outcome).toBe(true)
        expect(inputs.at(-1)).toBe(sent(PARTIAL))
        expect(originChat().message.at(-1)?.data).toBe(scripted(sent(PARTIAL)))
        expect(originChat().message.at(-1)?.interrupted).toBeUndefined()
    })

    // Compatibility guard (T-P4): the Stop pattern of sendChatStreamLatest G2.
    test('T-P4 Stop while the block is open stores the pass over the whole written text', async () => {
        installOneCharacterWorld()
        const inputs = recordPasses()
        const stop = new AbortController()
        const source = eagerProducer()
        const started = await startStreamingSend(source, { signal: stop.signal })
        source.push(PARTIAL)
        await until(() => inputs.length === 1, 'the first pass')
        await settle()
        stop.abort()
        const outcome = await started.sent

        expect(outcome).toBe(false)
        expect(inputs.at(-1)).toBe(sent(PARTIAL))
        expect(originChat().message.at(-1)?.data).toBe(scripted(sent(PARTIAL)))
    })

    // Compatibility guard (T-P4b): passes before and after. A script error on a later partial does not leave the raw
    // remainder of the earlier one: the last text written successfully is settled, as the last processed write is today.
    test('T-P4b a script error on a later partial settles the last written text before the error surfaces', async () => {
        installOneCharacterWorld()
        const inputs = recordPasses('{{boom}}')
        const source = eagerProducer()
        const started = await startStreamingSend(source)
        source.push(PARTIAL)
        await until(() => inputs.length === 1, 'the first pass')
        await settle()
        source.push('A {{user}}\n\nZ {{boom}}\n\n{{#if 1}}\n\nB\n\nC')
        const outcome = await started.sent

        expect(outcome).toBeInstanceOf(Error)
        expect(originChat().message.at(-1)?.data).toBe(scripted(sent(PARTIAL)))
    })
})

describe('the coalesced modes', () => {
    // T-P5 balanced is a regression reproducer: on the pre-fix base the flushed partial is the pass over the whole text.
    // T-P5 strong is a compatibility guard: partial writes are raw and the one pass runs on the whole text at the end,
    // which only an open block at the end tells apart from a deferred final that holds the span.
    test.each(['balanced', 'strong'] as const)('T-P5 %s mode', async (mode) => {
        installOneCharacterWorld()
        DBState.db.streamingDisplayOptimizationMode = mode
        installFramesRunSoon()
        const inputs = recordPasses()
        const observed = observeWrites()
        let outcome: unknown
        try {
            const source = eagerProducer()
            const started = await startStreamingSend(source)
            source.push(PARTIAL)
            await untilLong(() => observed.writes.length === 1, 'the flushed partial')
            source.close()
            outcome = await started.sent
        } finally {
            observed.stop()
        }

        expect(outcome).toBe(true)
        const partial = observed.writes[0].stored
        if (mode === 'balanced') {
            expect(inputs[0]).toBe('A {{user}}\n\n')
            expect(partial).toBe('A Ari\n\n{{#if 1}}\n\nB\n\nC')
            const split = splitStreamingText(partial)
            expect(split.finished).toEqual(['A Ari\n\n'])
            expect(describeOpenTail(split.open).chip?.kind).toBe('formatting')
            expect(inputs.at(-1)).toBe(sent(PARTIAL))
        } else {
            expect(partial).toBe(sent(PARTIAL))
            expect(inputs).toEqual([sent(PARTIAL)])
        }
        expect(originChat().message.at(-1)?.data).toBe(scripted(sent(PARTIAL)))
    })
})

/**
 * What the 'off' reply loop processes when snapshots arrive faster than a pass finishes (#455, MC-2990, MC-2991).
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) against a real `$state` database, with the mocks of
 * `streamCharCount.svelte.test.ts`. The producer has the real shape: an eager `ReadableStream` whose `start()` captures
 * the controller and enqueues a fresh cumulative `{ '0': text }` object without looking at `desiredSize`, wrapped by the
 * REAL `settleUsage` pass-through of `usageCapture` (pull-based, high-water mark 0), exactly as `requestChatData` hands
 * a stream to the send. `processScriptFull` is the observation point of the 'editoutput' pass: the test records its
 * inputs and can hold or slow a pass.
 *
 * Classes: R1, R2, R3 are regression reproducers (they fail on the pre-change base on the number of passes). G2, G4 and
 * G5 are compatibility guards: they pass before and after the change.
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

import { sendChat, doingChat, setStreamFlushObserverForTests } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { activeStreamChars, resetActiveStreamsForTest } from '../activeStreams'
import { settleUsage } from '../../usage/usageCapture'
import { createUsageMeter } from '../../usage/usageMeter'
import type { StreamResponseChunk } from '../request/request'

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

/** Microtask drain only: no macrotask runs. */
async function drain(count = 60): Promise<void> {
    for (let i = 0; i < count; i++) {
        await Promise.resolve()
    }
}

/** Each chunk is the whole reply so far. */
function cumulative(count: number): string[] {
    const words = Array.from({ length: count }, (_, i) => `w${i + 1}`)
    return words.map((_, i) => words.slice(0, i + 1).join(' '))
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

/**
 * Records the text of every 'editoutput' pass and writes `[text]`. The first pass runs `onFirst` (synchronously, before it
 * returns) and then waits for `gate`, which models a plugin round trip or a long script.
 */
function recordPasses(hooks: { onFirst?: () => void, gate?: Promise<void> } = {}): string[] {
    const inputs: string[] = []
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string, type: string) => {
        if (type !== 'editoutput') {
            return { data: text, emoChanged: false }
        }
        inputs.push(text)
        if (inputs.length === 1) {
            hooks.onFirst?.()
            if (hooks.gate) {
                await hooks.gate
            }
        }
        return { data: `[${text}]`, emoChanged: false }
    })
    return inputs
}

function manualGate(): { gate: Promise<void>, release(): void } {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    return { gate, release: () => release() }
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

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    doingChat.set(false)
    resetActiveStreamsForTest()
})

afterEach(() => {
    selectedCharID.set(-1)
    setStreamFlushObserverForTests(null)
})

//#endregion

describe('regression reproducers: superseded snapshots are not processed', () => {
    // Regression reproducer (R1). Pre-fix base: the consumer reads one snapshot per pass, so all 20 are processed.
    test('R1 a pass that crosses tasks: snapshots that arrive meanwhile are skipped, the last one is exact', async () => {
        installOneCharacterWorld()
        const snapshots = cumulative(20)
        const { gate, release } = manualGate()
        const inputs = recordPasses({ gate })
        const observed = observeWrites()
        let outcome: unknown
        try {
            const source = eagerProducer()
            const { sent } = await startStreamingSend(source)
            source.push(snapshots[0])
            await until(() => inputs.length === 1, 'the first pass to start')
            for (const snapshot of snapshots.slice(1)) {
                source.push(snapshot)
            }
            source.close()
            await settle()
            await settle()
            release()
            outcome = await sent
        } finally {
            observed.stop()
        }

        expect(outcome).toBe(true)
        expect(inputs).toEqual([snapshots[0], snapshots[19]])
        expect(observed.writes).toHaveLength(2)
        // The reply holds the processed last snapshot, and the hidden keep-alive read is each write's processed length.
        expect(originChat().message.at(-1)?.data).toBe(`[${snapshots[19]}]`)
        expect(observed.writes.map((write) => write.hidden)).toEqual(observed.writes.map((write) => write.stored.length))
    })

    // Regression reproducer (R2). Pre-fix base: `controller.error` resets the producer's queue, so only s1 was ever read.
    test('R2 an error after a backlog: the newest snapshot the reader had read is written before the error surfaces', async () => {
        installOneCharacterWorld()
        const snapshots = cumulative(5)
        const { gate, release } = manualGate()
        const inputs = recordPasses({ gate })
        const source = eagerProducer()
        const { sent } = await startStreamingSend(source)
        source.push(snapshots[0])
        await until(() => inputs.length === 1, 'the first pass to start')
        // One snapshot at a time with a microtask drain after each: this models the producer's await on a body read
        // between enqueues (the anthropic start loop), so the reader has taken each one before the next arrives.
        for (const snapshot of snapshots.slice(1)) {
            source.push(snapshot)
            await drain(60)
        }
        source.error(new Error('boom'))
        await drain(60)
        release()
        const outcome = await sent

        expect(inputs).toEqual([snapshots[0], snapshots[4]])
        expect(originChat().message.at(-1)?.data).toBe(`[${snapshots[4]}]`)
        // The send reports the error as it does today: it does not complete with success.
        expect(outcome).not.toBe(true)
    })

    // Regression reproducer (R3). Pre-fix base: each arrival is processed inside its own task (the consumer is waiting),
    // so a synchronous pass skips nothing.
    test('R3 a synchronous pass: snapshots that arrive as separate macrotasks meanwhile are coalesced', async () => {
        installOneCharacterWorld()
        const snapshots = cumulative(20)
        const source = eagerProducer()
        // Scheduled together inside the first pass, so they all expire in one timers phase, one task each, as native
        // events do. The 20th closes the source. Blocking the thread past their 1 ms expiry before yielding makes every
        // timer already due when the loop reaches the timers phase; without it a loaded machine can cross a millisecond
        // boundary between phases and split the arrivals over several of them.
        const inputs = recordPasses({
            onFirst: () => {
                for (const snapshot of snapshots.slice(1)) {
                    setTimeout(() => source.push(snapshot), 0)
                }
                setTimeout(() => source.close(), 0)
                const due = performance.now() + 5
                while (performance.now() < due) { /* block until every timer above is due */ }
            },
        })
        const { sent } = await startStreamingSend(source)
        source.push(snapshots[0])
        const outcome = await sent

        expect(outcome).toBe(true)
        expect(inputs.length).toBeLessThanOrEqual(3)
        expect(inputs[0]).toBe(snapshots[0])
        expect(inputs.at(-1)).toBe(snapshots[19])
        expect(originChat().message.at(-1)?.data).toBe(`[${snapshots[19]}]`)
    })
})

describe('compatibility guards (pass before and after the change)', () => {
    // Compatibility guard (G2): Stop reaches the source while a pass is suspended, and no further pass runs.
    test('G2 Stop while a pass is suspended with snapshots pending: the source is cancelled first, no further pass', async () => {
        installOneCharacterWorld()
        const snapshots = cumulative(5)
        const { gate, release } = manualGate()
        const inputs = recordPasses({ gate })
        const stop = new AbortController()
        const source = eagerProducer()
        const { sent } = await startStreamingSend(source, { signal: stop.signal })
        source.push(snapshots[0])
        await until(() => inputs.length === 1, 'the first pass to start')
        for (const snapshot of snapshots.slice(1)) {
            source.push(snapshot)
        }
        await settle()
        stop.abort()
        const cancelledBeforeRelease = source.cancelCount()
        release()
        const outcome = await sent

        expect(cancelledBeforeRelease).toBeGreaterThanOrEqual(1)
        expect(inputs).toEqual([snapshots[0]])
        expect(outcome).toBe(false)
    })

    // Compatibility guard (G4): the reply text is the first key of the chunk, whatever other keys it carries.
    test('G4 the reply is built from the first key of the newest chunk', async () => {
        installOneCharacterWorld()
        const inputs = recordPasses()
        const source = eagerProducer()
        const { sent } = await startStreamingSend(source)
        source.push('first', { '1': 'ignored one' })
        await settle()
        source.push('first second', { '1': 'ignored two' })
        await settle()
        source.close()
        const outcome = await sent

        expect(outcome).toBe(true)
        expect(inputs.at(-1)).toBe('first second')
        expect(originChat().message.at(-1)?.data).toBe('[first second]')
    })

    // Compatibility guard (G5): a snapshot that wakes an idle consumer is processed without waiting for any macrotask.
    // It cannot pass on a build that yields before every pass.
    test('G5 an idle consumer processes an arriving snapshot within microtasks, first chunk and later ones alike', async () => {
        installOneCharacterWorld()
        const inputs = recordPasses()
        const source = eagerProducer()
        const { sent } = await startStreamingSend(source)

        source.push('s1')
        await drain(200)
        expect(inputs).toEqual(['s1'])

        // Idle again after the pass and whatever task the loop yields after it.
        await settle()
        await settle()
        source.push('s2')
        await drain(200)
        expect(inputs).toEqual(['s1', 's2'])

        source.close()
        expect(await sent).toBe(true)
    })
})

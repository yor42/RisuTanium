/**
 * The end bookkeeping of the stream branch of sendChat (src/ts/process/index.svelte.ts) for an owned stream: with the
 * reply in memory the character is marked after delete interrupted and the waiter's target is read after that mark; with
 * no reply (deleted, chat gone, abort before the push) the end is noted and the native request abandoned, so the record is
 * consumed at the unit's settle. Every fact is per reply key: a second reply in flight is never settled, announced or
 * abandoned by the first.
 *
 * Drives the REAL, unmocked sendChat with a fake streaming result; the mock set is the one of
 * sendChatNativeReplyPush.svelte.test.ts. The request mock registers the probe, bind and invoke the way the call site of
 * requestOpenAI does. Real pageState with a fake store and a fake commit source.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'

//#region module mocks

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

vi.mock(import('../../util'), () => ({
    findCharacterbyId: vi.fn(() => undefined),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    getPersonaPrompt: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    isLastCharPunctuation: vi.fn(() => true),
    trimUntilPunctuation: vi.fn((s: string) => s),
    parseToggleSyntax: vi.fn(() => []),
    prebuiltAssetCommand: vi.fn(() => ''),
}) as unknown as typeof import('../../util'))

const requestChatDataMock = vi.hoisted(() => vi.fn())

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('../stableDiff'))

const processScriptFullMock = vi.hoisted(() => vi.fn())

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
    groupOrder: vi.fn(),
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

// The save-mark count is what the page state is told; it moves only through the counting mark below.
const world = vi.hoisted(() => ({
    markCount: 0,
    android: false,
    /** Runs inside every mark, so a test can read the chat at the moment of the mark. */
    onMark: null as ((chaId: unknown) => void) | null,
}))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    getSaveMarkCount: vi.fn(() => world.markCount),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../storage/characterSaveMarks'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        markCharacterForSave: vi.fn((chaId: unknown) => {
            world.markCount += 1
            world.onMark?.(chaId)
        }),
    }
})

vi.mock(import('../../storage/tauriByteTransport'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        isAndroidTransport: () => world.android,
    }
})

const announceSpy = vi.hoisted(() => vi.fn())

vi.mock(import('../replyNotice'), async (importOriginal) => ({
    ...(await importOriginal()),
    announceReply: announceSpy,
}))

const hiddenFlush = vi.hoisted(() => ({ onCall: null as null | (() => void) }))

vi.mock(import('../saveOnHide'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        flushPageReplyEndWhenHidden: ((origin: Parameters<typeof actual.flushPageReplyEndWhenHidden>[0]) => {
            hiddenFlush.onCall?.()
            return actual.flushPageReplyEndWhenHidden(origin)
        }) as typeof actual.flushPageReplyEndWhenHidden,
    }
})

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))


//#endregion

import { applyRecoveredReply, applyRecoveredStreamReply, doingChat, sendChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { abortUnitInProgress } from '../generationOwnership.svelte'
import {
    configurePageState, heldReply, holdInflight, noteAnnounced, noteBound, noteInvoked, noteUnowned, resetPageStateForTests,
    setReconcileTrigger, takeAnnounced,
} from '../../nativeReply/pageState'
import { createStreamProbe, endOwnedRead, resetOwnedStreamsForTests, retireOwnedStream } from '../../nativeReply/ownedStream'
import type { PumpProbe, ReplyStamp } from '../../nativeReply/ownedBody'
import type { RecoveredReplyInput, RecoveredStreamInput } from '../../nativeReply/reconcile'
import { clearRunningSends } from './activeUnits.test-helpers'
import { activeUnits } from '../activeUnits'
import { pluginV2 } from '../../plugins/plugins.svelte'

const CHAT = 'char-0-chat-0'

/** Every mark of the run, with the reply as the chat held it at that moment and the count the mark produced. */
const marks: Array<{ count: number, interrupted: boolean | undefined, data: string | undefined }> = []

/** The commits the fake waiter listens for; `landCommit` is one commit that covers every mark so far. */
const commits = { covered: 0, callbacks: [] as Array<() => void> }

/** How many times the native request had been abandoned when the page cancelled the stream's reader. */
const abandonsAtCancel: number[] = []

const consumeSeen: Array<{ key: string, pageEnded: boolean | undefined }> = []
const consume = vi.fn(async (key: string) => {
    consumeSeen.push({ key, pageEnded: heldReply(key)?.pageEnded })
    return { result: 'removed' as const, flushed: true }
})
const reconcile = vi.fn()

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-0'],
        characters: [{
            chaId: 'char-0',
            name: 'Character Zero',
            type: 'character',
            chatPage: 0,
            firstMessage: 'Hello!',
            alternateGreetings: [],
            desc: 'A test character.',
            bias: [],
            utilityBot: false,
            inlayViewScreen: false,
            reloadKeys: 0,
            chats: [{
                id: CHAT,
                note: '',
                name: '',
                localLore: [],
                fmIndex: -1,
                message: [{ role: 'user', data: 'Hi', time: 1 }],
            }],
        }],
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
        useStreaming: true,
    } as unknown as Database
}

function chatMessages() {
    return DBState.db.characters[0].chats[0].message
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
    fail(error: Error): void
}

function controlledStream(onCancel: () => void = () => {}): ControlledStream {
    let controller: ReadableStreamDefaultController<{ data: string }> | undefined
    const stream = new ReadableStream<{ data: string }>({
        start(c) { controller = c },
        cancel() { onCancel() },
    })
    return {
        stream,
        push(text) {
            try { controller?.enqueue({ data: text }) } catch { /* the reader cancelled it */ }
        },
        close() {
            try { controller?.close() } catch { /* the reader cancelled it */ }
        },
        fail(error) {
            try { controller?.error(error) } catch { /* the reader cancelled it */ }
        },
    }
}

function settled(call: () => Promise<boolean>): Promise<boolean | Error> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

function landCommit(): void {
    commits.covered = world.markCount
    const callbacks = commits.callbacks.splice(0)
    for (const callback of callbacks) {
        callback()
    }
}

interface OwnedRun {
    key: string
    probe: PumpProbe
    abandon: ReturnType<typeof vi.fn>
    source: ControlledStream
    outcome: Promise<boolean | Error>
}

interface StartOptions {
    /** The answer of Rust to the ownership request; `null` is not yet answered. */
    owned?: boolean | null
    /** Runs inside the request, after the probe is registered and before the streaming result is returned. */
    onRequest?: (key: string, signal: AbortSignal) => void
    /** Whether the first chunk is delivered before the run is handed back. */
    firstChunk?: boolean
}

/**
 * Starts a send whose request registers the probe the way the call site of `requestOpenAI` does (bind, invoke, owner
 * answer, abandon), and hands back the stream the test feeds by hand.
 */
async function startOwnedSend(options: StartOptions = {}): Promise<OwnedRun> {
    const abandon = vi.fn()
    const source = controlledStream(() => { abandonsAtCancel.push(abandon.mock.calls.length) })
    const captured: { key?: string, probe?: PumpProbe } = {}
    requestChatDataMock.mockImplementationOnce(async (args: { chatId: string }, _model: string, signal: AbortSignal) => {
        const key = args.chatId
        noteBound(key)
        noteInvoked(key)
        const probe = createStreamProbe(key)
        probe.owned = options.owned ?? true
        probe.abandon = abandon
        if (options.owned === false) {
            noteUnowned(key)
        }
        captured.key = key
        captured.probe = probe
        options.onRequest?.(key, signal)
        return { type: 'streaming', result: source.stream }
    })
    const outcome = settled(() => sendChat())
    await until(() => captured.key !== undefined, 'the request')
    if (options.firstChunk !== false) {
        source.push('Hello')
        await settle()
    }
    return { key: captured.key!, probe: captured.probe!, abandon, source, outcome }
}

/** A second reply in flight in another chat: its probe and held entry are registered, nothing of its own runs. */
function registerOtherReply(key: string): { probe: PumpProbe, abandon: ReturnType<typeof vi.fn> } {
    holdInflight(key)
    noteBound(key)
    noteInvoked(key)
    const probe = createStreamProbe(key)
    const abandon = vi.fn()
    probe.owned = true
    probe.abandon = abandon
    return { probe, abandon }
}

const OTHER = '0b9c1a7e-0000-4000-8000-0000000000aa'

function stamp(key: string, extra: Partial<ReplyStamp> = {}): ReplyStamp {
    return { key, outcome: 'done', stored: true, ...extra }
}

beforeEach(() => {
    world.markCount = 0
    world.android = true
    world.onMark = () => {
        const last = chatMessages().at(-1)
        marks.push({ count: world.markCount, interrupted: last?.interrupted, data: last?.data })
    }
    marks.length = 0
    commits.covered = 0
    commits.callbacks.length = 0
    consumeSeen.length = 0
    abandonsAtCancel.length = 0
    consume.mockClear()
    reconcile.mockClear()
    announceSpy.mockClear()
    requestChatDataMock.mockReset()
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    resetPageStateForTests()
    resetOwnedStreamsForTests()
    configurePageState({
        store: { consume },
        waiter: {
            committedMarkCount: () => commits.covered,
            markCount: () => world.markCount,
            verdict: () => 'saved',
            afterNextCommit: (callback) => { commits.callbacks.push(callback) },
            markCharacter: () => {},
            requestSaveNow: () => {},
        },
        onUnreadable: () => {},
    })
    setReconcileTrigger(reconcile)
    installDb()
    selectedCharID.set(0)
    clearRunningSends()
})

afterEach(() => {
    setReconcileTrigger(null)
    selectedCharID.set(-1)
})

/** The held entry waits for the commit that covers the mark of the settled reply, and the record is not consumed before it. */
async function expectAwaitingTheCommit(run: OwnedRun): Promise<void> {
    const entry = heldReply(run.key)
    expect(entry?.state).toBe('awaiting-save')
    expect(entry?.chaId).toBe('char-0')
    expect(consume).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    landCommit()
    await settle()
    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith(run.key)
}

describe('sendChat stream branch: end bookkeeping of an owned stream', () => {
    test('a natural end holds the reply for its commit; the mark follows `delete interrupted` and the target follows the mark (P11)', async () => {
        const run = await startOwnedSend()
        run.source.push('Hello world')
        run.source.close()
        expect(await run.outcome).toBe(true)

        const entry = heldReply(run.key)
        const atTarget = marks.filter((mark) => mark.count === entry?.target)
        expect(atTarget).toHaveLength(1)
        expect(atTarget[0].interrupted).toBeUndefined()
        expect(atTarget[0].data).toBe('Hello world')
        expect(run.abandon).not.toHaveBeenCalled()
        await expectAwaitingTheCommit(run)
    })

    test('T30: the settle (mark and noteReplyPushed) runs before the hidden-page flush, so the flush save covers the mark', async () => {
        const seen: Array<{ state: string | undefined, target: number | undefined, marks: number }> = []
        let key = ''
        hiddenFlush.onCall = () => {
            const entry = heldReply(key)
            seen.push({ state: entry?.state, target: entry?.target, marks: world.markCount })
        }
        try {
            const run = await startOwnedSend({ onRequest: (k) => { key = k } })
            run.source.push('Hello world')
            run.source.close()
            expect(await run.outcome).toBe(true)
        } finally {
            hiddenFlush.onCall = null
        }

        // The first flush is the stream branch's own; later flushes belong to the send's end.
        expect(seen.length).toBeGreaterThanOrEqual(1)
        expect(seen[0].state).toBe('awaiting-save')
        expect(seen[0].target).toBeDefined()
        expect(seen[0].marks).toBeGreaterThanOrEqual(seen[0].target!)
    })

    test('a natural end whose stamp says failed body-too-large still waits for its commit', async () => {
        const run = await startOwnedSend()
        run.probe.onStamp!(stamp(run.key, { outcome: 'failed', stored: false }))
        run.source.close()
        expect(await run.outcome).toBe(true)
        expect(heldReply(run.key)?.terminal).toMatchObject({ outcome: 'failed' })
        await expectAwaitingTheCommit(run)
    })

    test('Stop with the reply in memory waits for its commit and abandons nothing here', async () => {
        const run = await startOwnedSend()
        abortUnitInProgress()
        run.source.close()
        await run.outcome
        expect(run.abandon).not.toHaveBeenCalled()
        await expectAwaitingTheCommit(run)
    })

    test('a native stopped stamp followed by the page abort waits for its commit', async () => {
        const run = await startOwnedSend()
        run.probe.onStamp!(stamp(run.key, { outcome: 'stopped', stored: false }))
        abortUnitInProgress()
        run.source.close()
        await run.outcome
        await expectAwaitingTheCommit(run)
    })

    test('a mid-body transport failure waits for its commit', async () => {
        const run = await startOwnedSend()
        run.probe.onStamp!(stamp(run.key, { outcome: 'failed', stored: false }))
        run.source.fail(new Error('network lost'))
        expect(await run.outcome).toBeInstanceOf(Error)
        await expectAwaitingTheCommit(run)
    })

    test('a script error inside the loop still waits for its commit', async () => {
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string, mode: string) => {
            if (mode === 'editoutput') {
                throw new Error('script failed')
            }
            return { data: text, emoChanged: false }
        })
        const run = await startOwnedSend()
        run.source.close()
        expect(await run.outcome).toBeInstanceOf(Error)
        expect(run.abandon).not.toHaveBeenCalled()
        await expectAwaitingTheCommit(run)
    })

    test('a reply of a refused owner is only ended: nothing is marked for it, nothing is abandoned, nothing is consumed', async () => {
        const run = await startOwnedSend({ owned: false })
        run.source.push('Hello world')
        run.source.close()
        expect(await run.outcome).toBe(true)
        await settle()
        expect(run.abandon).not.toHaveBeenCalled()
        expect(consume).not.toHaveBeenCalled()
        expect(heldReply(run.key)).toBeUndefined()
    })

    test('P10-D: a reply deleted mid-stream abandons the native request once, notes the end and is consumed at the unit settle', async () => {
        const run = await startOwnedSend()
        chatMessages().pop()
        run.source.push('Hello more')
        run.source.close()
        expect(await run.outcome).not.toBeInstanceOf(Error)
        await settle()

        expect(run.abandon).toHaveBeenCalledTimes(1)
        expect(consume).toHaveBeenCalledWith(run.key)
        expect(consumeSeen).toEqual([{ key: run.key, pageEnded: true }])
        expect(reconcile).not.toHaveBeenCalled()
        expect(heldReply(run.key)).toBeUndefined()
    })

    test('P10-E: a chat that is gone before the stream branch abandons the native request once and is consumed at the settle', async () => {
        const run = await startOwnedSend({
            firstChunk: false,
            onRequest: () => { DBState.db.characters.splice(0, 1) },
        })
        await run.outcome
        await settle()

        expect(run.abandon).toHaveBeenCalledTimes(1)
        // The reader's cancel never reaches the native request, so the abandon came first.
        expect(abandonsAtCancel).toEqual([1])
        expect(consumeSeen).toEqual([{ key: run.key, pageEnded: true }])
        expect(reconcile).not.toHaveBeenCalled()
    })

    test('an abort before the reply is pushed (the request noted the end through its abort listener) is consumed at the settle', async () => {
        const run = await startOwnedSend({
            firstChunk: false,
            onRequest: (key, signal) => {
                signal.addEventListener('abort', () => endOwnedRead(key))
                abortUnitInProgress()
            },
        })
        await run.outcome
        await settle()

        expect(run.abandon).toHaveBeenCalledTimes(1)
        expect(consumeSeen).toEqual([{ key: run.key, pageEnded: true }])
        expect(reconcile).not.toHaveBeenCalled()
        expect(chatMessages().map((message) => message.data)).toEqual(['Hi'])
    })

    test('an abort before the push that nothing noted is ended by the unit settle: abandoned once, then consumed', async () => {
        const run = await startOwnedSend({
            firstChunk: false,
            onRequest: () => { abortUnitInProgress() },
        })
        await run.outcome
        await settle()

        expect(run.abandon).toHaveBeenCalledTimes(1)
        expect(consumeSeen).toEqual([{ key: run.key, pageEnded: true }])
        expect(reconcile).not.toHaveBeenCalled()
    })

    test('P13: an announced stamp reaches the reply notice as announced; an unannounced one does not', async () => {
        const announced = await startOwnedSend()
        announced.probe.onStamp!(stamp(announced.key, { outcome: 'failed', stored: false, announced: true }))
        announced.source.close()
        await announced.outcome
        expect(announceSpy.mock.calls.at(-1)?.[2]).toBe(true)

        announceSpy.mockClear()
        resetPageStateForTests()
        resetOwnedStreamsForTests()
        installDb()
        const quiet = await startOwnedSend()
        quiet.source.close()
        await quiet.outcome
        expect(announceSpy.mock.calls.at(-1)?.[2]).toBe(false)
    })
})

describe('sendChat stream branch: two replies in flight never settle each other', () => {
    test('a natural end of one reply leaves the other held entry, probe and announced fact as they were', async () => {
        const other = registerOtherReply(OTHER)
        noteAnnounced(OTHER)
        const before = structuredClone(heldReply(OTHER))
        const run = await startOwnedSend()
        run.source.close()
        await run.outcome

        expect(heldReply(OTHER)).toEqual(before)
        expect(other.abandon).not.toHaveBeenCalled()
        expect(takeAnnounced([run.key])).toBe(false)
        expect(takeAnnounced([OTHER])).toBe(true)
        expect(consume).not.toHaveBeenCalledWith(OTHER)
    })

    test('the page end of one reply (reply deleted) abandons only its own native request', async () => {
        const other = registerOtherReply(OTHER)
        const before = structuredClone(heldReply(OTHER))
        const run = await startOwnedSend()
        chatMessages().pop()
        run.source.close()
        await run.outcome
        await settle()

        expect(run.abandon).toHaveBeenCalledTimes(1)
        expect(other.abandon).not.toHaveBeenCalled()
        expect(heldReply(OTHER)).toEqual(before)
        expect(consume).toHaveBeenCalledTimes(1)
        expect(consume).toHaveBeenCalledWith(run.key)
    })

    test('a terminal stamp or a page end of the other reply while this one streams never settles this one', async () => {
        const other = registerOtherReply(OTHER)
        const run = await startOwnedSend()
        other.probe.onStamp!(stamp(OTHER, { outcome: 'failed', stored: false, announced: true }))
        endOwnedRead(OTHER)

        expect(heldReply(run.key)?.terminal).toBeUndefined()
        expect(heldReply(run.key)?.pageEnded).toBeUndefined()
        expect(run.abandon).not.toHaveBeenCalled()
        run.source.push('Hello world')
        run.source.close()
        expect(await run.outcome).toBe(true)
        expect(heldReply(run.key)?.state).toBe('awaiting-save')
        expect(takeAnnounced([run.key])).toBe(false)
        expect(other.abandon).toHaveBeenCalledTimes(1)
    })
})

describe('sendChat: a recovered reply that meets a running send', () => {
    const target = { chaId: 'char-0', chatId: CHAT }
    const recoveredReply = { key: OTHER, blob: { target }, text: 'Recovered' } as unknown as RecoveredReplyInput
    const recoveredStream = { key: OTHER, blob: { target }, modelText: 'Recovered', complete: true, how: 'live' } as unknown as RecoveredStreamInput

    test('applyRecoveredReply defers, writes nothing, and the send end asks the reconcile once', async () => {
        const run = await startOwnedSend()
        const messages = chatMessages().length
        expect(await applyRecoveredReply(recoveredReply)).toBe('deferred')
        expect(chatMessages()).toHaveLength(messages)
        expect(reconcile).not.toHaveBeenCalled()
        run.source.close()
        await run.outcome
        expect(reconcile).toHaveBeenCalledTimes(1)
    })

    test('applyRecoveredStreamReply defers, writes nothing, and the send end asks the reconcile once', async () => {
        const run = await startOwnedSend()
        const messages = chatMessages().length
        expect(await applyRecoveredStreamReply(recoveredStream)).toBe('deferred')
        expect(chatMessages()).toHaveLength(messages)
        expect(reconcile).not.toHaveBeenCalled()
        run.source.close()
        await run.outcome
        expect(reconcile).toHaveBeenCalledTimes(1)
    })
})

describe('sendChat: the unit stays held until the send settles, whatever the reply record already did', () => {
    const target = { chaId: 'char-0', chatId: CHAT }
    const recoveredReply = { key: OTHER, blob: { target }, text: 'Recovered' } as unknown as RecoveredReplyInput

    test('HL1: a record retired mid-stream, as the overload path does, leaves the flag and the unit held, refuses a send, defers an apply, and releases once at the end', async () => {
        const values: boolean[] = []
        const stop = doingChat.subscribe((busy) => { values.push(busy) })
        let run: OwnedRun | undefined
        try {
            run = await startOwnedSend()
            await retireOwnedStream(run.key)
            takeAnnounced([run.key])

            expect(get(doingChat)).toBe(true)
            expect(activeUnits.has(target)).toBe(true)
            expect(await settled(() => sendChat())).toBe(false)
            expect(await applyRecoveredReply(recoveredReply)).toBe('deferred')
            expect(requestChatDataMock).toHaveBeenCalledTimes(1)

            run.source.push(' more')
            await settle()
            expect(get(doingChat)).toBe(true)
            run.source.close()
            await run.outcome
        } finally {
            run?.source.close()
            await run?.outcome
            stop()
        }

        expect(values).toEqual([false, true, false])
        expect(activeUnits.any()).toBe(false)
    })

    test('HL2: still held while a chatOutput listener works: the record is consumed by its commit, the unit is not released until the listener resolves', async () => {
        let enter!: () => void
        const entered = new Promise<void>((resolve) => { enter = resolve })
        let open!: () => void
        const gate = new Promise<void>((resolve) => { open = resolve })
        const listener = async () => {
            enter()
            await gate
        }
        pluginV2.chatOutput.add(listener)
        let run: OwnedRun | undefined
        try {
            run = await startOwnedSend()
            run.source.push(' world')
            run.source.close()
            await entered
            // The reply is in the chat and marked: the commit that covers the mark consumes its record.
            landCommit()
            await settle()
            expect(consume).toHaveBeenCalledWith(run.key)

            expect(get(doingChat)).toBe(true)
            expect(activeUnits.has(target)).toBe(true)
            expect(await settled(() => sendChat())).toBe(false)
            expect(await applyRecoveredReply(recoveredReply)).toBe('deferred')

            open()
            expect(await run.outcome).toBe(true)
        } finally {
            open()
            pluginV2.chatOutput.delete(listener)
            run?.source.close()
            await run?.outcome
        }

        expect(get(doingChat)).toBe(false)
        expect(activeUnits.any()).toBe(false)
    })
})

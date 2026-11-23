// @vitest-environment happy-dom

/**
 * A TTS hook that never settles cannot hold a speech after the unit's Stop. Drives the REAL `sayTTS` (`./tts`), the REAL
 * hook pipelines (`./ttsHooks`) and, for the `/speak` row, the REAL `processMultiCommand` (`./command`).
 *
 * Invariants pinned here:
 *  - the unit's own signal (`options.signal`) ends a speech at its preprocessor, at its postprocessor and at its
 *    provider request, as `stopTTS` does: nothing starts after the abort, whatever a hook or a request later resolves;
 *  - the unit's signal reaches the provider request itself;
 *  - a `sayTTS` with no signal still ends at `stopTTS` and still plays;
 *  - a `/speak` line passes the line's own signal to the speech.
 *
 * `AudioContext`, `fetch`, the translator, the alert and the command line's collaborators are fakes; nothing here touches
 * a network or an audio device.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const alertErrorMock = vi.hoisted(() => vi.fn())
const dbBox = vi.hoisted(() => ({
    db: { huggingfaceKey: 'hf-key', elevenLabKey: 'el-key', openAIKey: 'oai-key', characters: [] as unknown[] },
}))

vi.mock(import('../alert'), () => ({
    alertError: alertErrorMock,
    alertInput: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
}) as unknown as typeof import('../alert'))

vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => dbBox.db.characters[0]),
    getCurrentChat: vi.fn(),
    setDatabase: vi.fn(),
    getDatabase: vi.fn(() => dbBox.db),
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../translator/translator'), () => ({
    runTranslator: vi.fn(async (text: string) => text),
    translateVox: vi.fn(async (text: string) => text),
}) as unknown as typeof import('../translator/translator'))

vi.mock(import('../globalApi.svelte'), () => ({
    globalFetch: vi.fn(),
    loadAsset: vi.fn(async () => new Uint8Array(4)),
    saveAsset: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('../util'), () => ({
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    asBuffer: (buffer: ArrayBuffer) => buffer,
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('../util'))

// The command line's collaborators, as `command.speak.test.ts` fakes them; `./tts` stays real.
vi.mock(import('../parser/parser.svelte'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('../parser/parser.svelte'))

vi.mock(import('./index.svelte'), () => ({
    doingChat: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
    sendChat: vi.fn(),
}) as unknown as typeof import('./index.svelte'))

vi.mock(import('./lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(),
}) as unknown as typeof import('./lorebook.svelte'))

vi.mock(import('./triggers'), () => ({
    runTrigger: vi.fn(),
}) as unknown as typeof import('./triggers'))

vi.mock(import('./generationOwnership.svelte'), () => ({
    isComposerWindowOpen: vi.fn(() => false),
    composerWindowFor: vi.fn(() => undefined),
}) as unknown as typeof import('./generationOwnership.svelte'))

vi.mock(import('../stores.svelte'), () => ({
    get DBState() { return dbBox },
    selectedCharID: { subscribe: (run: (value: number) => void) => { run(0); return () => {} } },
}) as unknown as typeof import('../stores.svelte'))

//#endregion

import { sayTTS, stopTTS } from './tts'
import { processMultiCommand } from './command'
import { registerTTSPostprocessor, registerTTSPreprocessor, unregisterTTSPostprocessor, unregisterTTSPreprocessor } from './ttsHooks'
import type { AfterTTSContext, AfterTTSResult, BeforeTTSContext, BeforeTTSResult, TTSHookFn } from './ttsHooks'
import type { character } from '../storage/database.svelte'

//#region fakes

interface Deferred<T> {
    promise: Promise<T>
    resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>((res) => { resolve = res })
    return { promise, resolve }
}

const hang = () => new Promise<never>(() => {})

class FakeNode {
    buffer: unknown = null
    onended: (() => void) | null = null
    connect = vi.fn()
    start = vi.fn()
    stop = vi.fn()
}

class FakeAudioContext {
    static instances: FakeAudioContext[] = []
    nodes: FakeNode[] = []
    destination = {}
    closed = false
    close = vi.fn(async () => { this.closed = true })
    constructor() {
        FakeAudioContext.instances.push(this)
    }
    decodeAudioData(_data: ArrayBuffer, ok?: (buffer: unknown) => void) {
        const decoded = { duration: 1 }
        ok?.(decoded)
        return Promise.resolve(decoded)
    }
    createBufferSource() {
        const node = new FakeNode()
        this.nodes.push(node)
        return node
    }
    createGain() {
        return { gain: { value: 1 }, connect: vi.fn() }
    }
}

function startedNodes(): FakeNode[] {
    return FakeAudioContext.instances.flatMap((context) => context.nodes).filter((node) => node.start.mock.calls.length > 0)
}

function fakeReply(status: number) {
    return {
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
        text: async () => '',
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(8),
    }
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<unknown>

function stubFetch(handler: FetchHandler) {
    const fetchMock = vi.fn(handler)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

/** A request that stays pending until its signal aborts. */
function pendingUntilAbort(): FetchHandler {
    return (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
}

function track<T>(promise: Promise<T>) {
    const state: { settled: boolean, error: unknown } = { settled: false, error: undefined }
    void promise.then(() => { state.settled = true }, (error: unknown) => { state.settled = true; state.error = error })
    return state
}

/** Lets every ready continuation run, with the faked clock held still. */
async function flush(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        await Promise.resolve()
    }
    await vi.advanceTimersByTimeAsync(0)
}

const elevenLabs = () => ({ chaId: 'char-a', type: 'character', ttsMode: 'elevenlab', ttsSpeech: 'voice-1' }) as unknown as character

const registeredBefore: TTSHookFn<BeforeTTSContext, BeforeTTSResult>[] = []
const registeredAfter: TTSHookFn<AfterTTSContext, AfterTTSResult>[] = []

function addPreprocessor(hook: TTSHookFn<BeforeTTSContext, BeforeTTSResult>) {
    registeredBefore.push(hook)
    registerTTSPreprocessor(hook)
}

function addPostprocessor(hook: TTSHookFn<AfterTTSContext, AfterTTSResult>) {
    registeredAfter.push(hook)
    registerTTSPostprocessor(hook)
}

//#endregion

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.instances = []
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('caches', { open: async () => ({ put: async () => {}, match: async () => undefined }) })
    alertErrorMock.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    stubFetch(async () => fakeReply(200))
})

afterEach(async () => {
    stopTTS()
    for (const hook of registeredBefore.splice(0)) unregisterTTSPreprocessor(hook)
    for (const hook of registeredAfter.splice(0)) unregisterTTSPostprocessor(hook)
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    // Node reports an unhandled rejection after the microtask queue drains, so wait one real macrotask before reading.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled, 'an abandoned hook or request leaves no unhandled rejection').toEqual([])
})

describe('a TTS preprocessor that outlives the unit', () => {
    test('T-1 regression reproducer: a preprocessor that never settles is abandoned by the unit abort; the speech ends and the provider is never asked', async () => {
        const fetchMock = stubFetch(async () => fakeReply(200))
        addPreprocessor(hang)
        const unit = new AbortController()

        const done = track(sayTTS(elevenLabs(), 'Hello', { signal: unit.signal }))
        await flush()
        expect(done.settled).toBe(false)
        unit.abort()
        await flush()

        expect(done.settled, 'the speech ends at the abort').toBe(true)
        expect(fetchMock).not.toHaveBeenCalled()
        expect(startedNodes()).toHaveLength(0)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('T-2 regression reproducer: a preprocessor that settles after the abort starts no request', async () => {
        const fetchMock = stubFetch(async () => fakeReply(200))
        const gate = deferred<void>()
        addPreprocessor(async () => { await gate.promise })
        const unit = new AbortController()

        const done = track(sayTTS(elevenLabs(), 'Hello', { signal: unit.signal }))
        await flush()
        unit.abort()
        gate.resolve()
        await flush()

        expect(fetchMock).not.toHaveBeenCalled()
        expect(startedNodes()).toHaveLength(0)
        expect(done.settled).toBe(true)
    })
})

describe('a TTS postprocessor and a provider request that outlive the unit', () => {
    test('T-4 regression reproducer: a postprocessor that never settles is abandoned by the unit abort; no clip starts', async () => {
        let entered = false
        addPostprocessor(() => { entered = true; return hang() })
        const unit = new AbortController()

        const done = track(sayTTS(elevenLabs(), 'Hello', { signal: unit.signal }))
        await flush()
        expect(entered).toBe(true)
        expect(done.settled).toBe(false)
        unit.abort()
        await flush()

        expect(done.settled, 'the speech ends at the abort').toBe(true)
        expect(startedNodes()).toHaveLength(0)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('T-5 regression reproducer: a postprocessor that settles after the abort starts no clip', async () => {
        const gate = deferred<void>()
        let entered = false
        addPostprocessor(async () => { entered = true; await gate.promise })
        const unit = new AbortController()

        const done = track(sayTTS(elevenLabs(), 'Hello', { signal: unit.signal }))
        await flush()
        expect(entered).toBe(true)
        unit.abort()
        gate.resolve()
        await flush()

        expect(startedNodes()).toHaveLength(0)
        expect(done.settled).toBe(true)
    })

    test('T-5b regression reproducer: a provider request that ignores its signal and answers after the abort starts no clip', async () => {
        const gate = deferred<unknown>()
        stubFetch(() => gate.promise)
        const unit = new AbortController()

        const done = track(sayTTS(elevenLabs(), 'Hello', { signal: unit.signal }))
        await flush()
        unit.abort()
        gate.resolve(fakeReply(200))
        await flush()

        expect(startedNodes()).toHaveLength(0)
        expect(done.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('T-6 regression reproducer: the provider request receives a signal that the unit abort aborts', async () => {
        const fetchMock = stubFetch(pendingUntilAbort())
        const unit = new AbortController()

        const done = track(sayTTS(elevenLabs(), 'Hello', { signal: unit.signal }))
        await flush()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        unit.abort()
        await flush()

        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
        expect(done.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('a speech with no unit signal', () => {
    test('T-7 compatibility guard (passes before and after): plays normally, and stopTTS still cancels a pending request', async () => {
        const played = track(sayTTS(elevenLabs(), 'Hello'))
        await flush()
        expect(played.settled).toBe(true)
        expect(startedNodes()).toHaveLength(1)

        const fetchMock = stubFetch(pendingUntilAbort())
        const stopped = track(sayTTS(elevenLabs(), 'Hello'))
        await flush()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        stopTTS()
        await flush()

        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
        expect(stopped.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('a /speak line', () => {
    test('T-8 regression reproducer: the line\'s signal ends the speech; a preprocessor that settles after the abort starts no request', async () => {
        dbBox.db.characters = [{
            chaId: 'char-a', name: 'Alpha', type: 'character', chatPage: 0, ttsMode: 'elevenlab', ttsSpeech: 'voice-1',
            chats: [{ id: 'chat-a', message: [], scriptstate: {} }],
        }]
        const fetchMock = stubFetch(async () => fakeReply(200))
        const gate = deferred<void>()
        addPreprocessor(async () => { await gate.promise })
        const line = new AbortController()

        const run = track(processMultiCommand('/speak Hello', { origin: { chaId: 'char-a', chatId: 'chat-a' }, signal: line.signal }))
        await flush()
        expect(run.settled).toBe(false)
        line.abort()
        gate.resolve()
        await flush()

        expect(fetchMock).not.toHaveBeenCalled()
        expect(startedNodes()).toHaveLength(0)
        expect(run.settled).toBe(true)
    })
})

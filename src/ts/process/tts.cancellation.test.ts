// @vitest-environment happy-dom

/**
 * `stopTTS` against the REAL `sayTTS` (`./tts`), the REAL `runVITS`
 * (`./transformers`) and the REAL hook pipelines (`./ttsHooks`).
 *
 * Invariants pinned here:
 *  - after `stopTTS()` nothing that was audible is still audible: every clip
 *    from every provider path is stopped and its audio context closed;
 *  - a `sayTTS` that began before the Stop starts no audio at any later await
 *    (translation, hook pipelines, fetch, retry wait, decode, VITS synthesis,
 *    VITS decode callback, Web Speech `speak`) and shows no alert;
 *  - its pending requests are aborted where the transport takes a signal, and
 *    the Hugging Face retry wait ends at once;
 *  - a `sayTTS` that begins after the Stop plays normally, including after a
 *    Stop while idle and after two Stops in a row;
 *  - a missing `speechSynthesis` never throws.
 *
 * `AudioContext`, `speechSynthesis`, `fetch`, `globalFetch`, the translator,
 * the VITS pipeline and the alert are fakes; nothing here touches a network,
 * an audio device or a speech engine. A passing test says nothing about a
 * real browser's audio or the real transformers runtime.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setImmediate as realSetImmediate } from 'node:timers'

//#region module mocks

const alertErrorMock = vi.hoisted(() => vi.fn())
const runTranslatorMock = vi.hoisted(() => vi.fn(async (text: string, _reverse: boolean, _from: string, _to: string): Promise<string> => text))
const globalFetchMock = vi.hoisted(() => vi.fn())
const synthBox = vi.hoisted(() => ({ run: async (_text: string): Promise<{ sampling_rate: number, audio: Float32Array }> => ({ sampling_rate: 16000, audio: new Float32Array(4) }) }))

vi.mock(import('../alert'), () => ({
    alertError: alertErrorMock,
}) as unknown as typeof import('../alert'))

vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getDatabase: vi.fn(() => ({ huggingfaceKey: 'hf-key', elevenLabKey: 'el-key', openAIKey: 'oai-key' })),
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../translator/translator'), () => ({
    runTranslator: runTranslatorMock,
    translateVox: vi.fn(async (text: string) => text),
}) as unknown as typeof import('../translator/translator'))

vi.mock(import('../globalApi.svelte'), () => ({
    globalFetch: globalFetchMock,
    loadAsset: vi.fn(async () => new Uint8Array(4)),
    saveAsset: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))

// The sleep the code under test may use; it follows the faked clock.
vi.mock(import('../util'), () => ({
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    asBuffer: (buffer: ArrayBuffer) => buffer,
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('../util'))

vi.mock('@huggingface/transformers', () => ({
    env: {},
    pipeline: vi.fn(async () => (text: string) => synthBox.run(text)),
}))

vi.mock('wavefile', () => ({
    WaveFile: class {
        fromScratch() {}
        toBuffer() {
            return { buffer: new ArrayBuffer(8) }
        }
    },
}))

//#endregion

import { sayTTS, stopTTS } from './tts'
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

const DECODED = { duration: 1 }

interface PendingDecode {
    release: () => void
}

class FakeNode {
    buffer: unknown = null
    onended: (() => void) | null = null
    connect = vi.fn()
    start = vi.fn()
    stop = vi.fn()
}

class FakeAudioContext {
    static instances: FakeAudioContext[] = []
    static manualDecode = false
    static rejectDecode = false
    nodes: FakeNode[] = []
    pending: PendingDecode[] = []
    destination = {}
    closed = false
    close = vi.fn(async () => {
        if (this.closed) {
            throw new DOMException('already closed', 'InvalidStateError')
        }
        this.closed = true
    })
    constructor() {
        FakeAudioContext.instances.push(this)
    }
    decodeAudioData(_data: ArrayBuffer, ok?: (buffer: unknown) => void, fail?: (error: unknown) => void) {
        if (FakeAudioContext.rejectDecode) {
            const error = new DOMException('bad audio', 'EncodingError')
            fail?.(error)
            return Promise.reject(error)
        }
        let release: () => void = () => {}
        const promise = new Promise<unknown>((resolve) => {
            release = () => {
                ok?.(DECODED)
                resolve(DECODED)
            }
        })
        if (FakeAudioContext.manualDecode) {
            this.pending.push({ release })
        } else {
            queueMicrotask(release)
        }
        return promise
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

function allNodes(): FakeNode[] {
    return FakeAudioContext.instances.flatMap((context) => context.nodes)
}

function startedNodes(): FakeNode[] {
    return allNodes().filter((node) => node.start.mock.calls.length > 0)
}

function pendingDecodes(): PendingDecode[] {
    return FakeAudioContext.instances.flatMap((context) => context.pending)
}

class FakeUtterance {
    constructor(public text: string) {}
    voice: unknown = null
}

const speechStub = {
    getVoices: vi.fn(() => [{ name: 'voice-a' }]),
    speak: vi.fn(),
    cancel: vi.fn(),
}

function fakeReply(status: number, init: { json?: unknown, text?: string, type?: string } = {}) {
    const body = init.json !== undefined ? JSON.stringify(init.json) : (init.text ?? '')
    const type = init.type ?? (init.json !== undefined ? 'application/json' : 'audio/mpeg')
    return {
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
        text: async () => body,
        json: async () => JSON.parse(body),
        arrayBuffer: async () => new ArrayBuffer(8),
    }
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<unknown>

function stubFetch(handler: FetchHandler) {
    const fetchMock = vi.fn(handler)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

/** A request that stays pending until it is answered by hand or its signal aborts. */
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

function makeCharacter(mode: string, extra: Record<string, unknown> = {}): character {
    return { chaId: `char-${mode}`, type: 'character', ttsMode: mode, ...extra } as unknown as character
}

const elevenLabs = () => makeCharacter('elevenlab', { ttsSpeech: 'voice-1' })
const openAi = () => makeCharacter('openai')
const webSpeech = () => makeCharacter('webspeech', { ttsSpeech: 'voice-a' })
const vits = () => makeCharacter('vits', { vits: 'Xenova/test' })
const huggingFace = (languageCode = 'en') => makeCharacter('huggingface', { hfTTS: { model: 'm/x', language: languageCode } })
const gptSoVits = () => makeCharacter('gptsovits', {
    gptSoVitsConfig: {
        ref_audio_data: { assetId: 'asset-1', fileName: 'ref.wav' },
        text_lang: 'en',
        prompt_lang: 'en',
        use_auto_path: false,
        use_prompt: false,
        use_long_audio: false,
        ref_audio_path: '/audio',
        url: 'http://localhost:9880',
        volume: 0.5,
    },
})

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
    FakeAudioContext.manualDecode = false
    FakeAudioContext.rejectDecode = false
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('speechSynthesis', speechStub)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('caches', { open: async () => ({ put: async () => {}, match: async () => undefined }) })
    speechStub.speak.mockClear()
    speechStub.cancel.mockClear()
    alertErrorMock.mockReset()
    globalFetchMock.mockReset()
    runTranslatorMock.mockReset()
    runTranslatorMock.mockImplementation(async (text: string) => text)
    synthBox.run = async () => ({ sampling_rate: 16000, audio: new Float32Array(4) })
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    stubFetch(async () => fakeReply(200))
})

afterEach(() => {
    stopTTS()
    process.off('unhandledRejection', onUnhandled)
    for (const hook of registeredBefore.splice(0)) unregisterTTSPreprocessor(hook)
    for (const hook of registeredAfter.splice(0)) unregisterTTSPostprocessor(hook)
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('Stop during the wait for a loading Hugging Face model', () => {
    test('regression reproducer: the wait ends at once, no further request is made, nothing plays and no alert shows', async () => {
        const fetchMock = stubFetch(async () => fakeReply(503, { json: { estimated_time: 5 } }))

        const done = track(sayTTS(huggingFace(), 'Hello'))
        await flush()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        stopTTS()
        await flush()
        expect(done.settled, 'the call ends without waiting out the 5 s').toBe(true)
        await vi.advanceTimersByTimeAsync(60_000)

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(startedNodes()).toHaveLength(0)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('regression reproducer: a translation that finishes after the Stop is discarded and no request follows', async () => {
        const translation = deferred<string>()
        runTranslatorMock.mockImplementation(() => translation.promise)
        const fetchMock = stubFetch(async () => fakeReply(200))

        const done = track(sayTTS(huggingFace('ja'), 'Hello'))
        await flush()
        stopTTS()
        translation.resolve('JA:Hello')
        await flush()

        expect(fetchMock).not.toHaveBeenCalled()
        expect(startedNodes()).toHaveLength(0)
        expect(done.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('Stop during a pending request', () => {
    test('regression reproducer: a pending fetch is aborted, the call ends and no alert shows', async () => {
        const fetchMock = stubFetch(pendingUntilAbort())

        const done = track(sayTTS(elevenLabs(), 'Hello'))
        await flush()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        stopTTS()
        await flush()

        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
        expect(done.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(startedNodes()).toHaveLength(0)
    })

    test('regression reproducer: a pending globalFetch is aborted, the call ends and no alert shows', async () => {
        // An aborted globalFetch returns `{ ok: false, data: 'aborted' }` rather than throwing.
        globalFetchMock.mockImplementation((_url: string, options: { abortSignal?: AbortSignal }) => new Promise((resolve) => {
            options.abortSignal?.addEventListener('abort', () => resolve({ ok: false, data: 'aborted' }))
        }))

        const done = track(sayTTS(openAi(), 'Hello'))
        await flush()
        expect(globalFetchMock).toHaveBeenCalledTimes(1)
        stopTTS()
        await flush()

        expect(globalFetchMock.mock.calls[0][1].abortSignal?.aborted).toBe(true)
        expect(done.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('Stop while audio is decoded or post-processed', () => {
    test('regression reproducer: a decode that finishes after the Stop starts no audio and closes its context', async () => {
        FakeAudioContext.manualDecode = true

        const done = track(sayTTS(elevenLabs(), 'Hello'))
        await flush()
        expect(pendingDecodes()).toHaveLength(1)
        stopTTS()
        pendingDecodes()[0].release()
        await flush()

        expect(startedNodes()).toHaveLength(0)
        expect(done.settled).toBe(true)
        expect(FakeAudioContext.instances.every((context) => context.closed)).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('regression reproducer: a postprocessor that finishes after the Stop leaves nothing playing', async () => {
        const gate = deferred<void>()
        let entered = false
        addPostprocessor(async () => {
            entered = true
            await gate.promise
        })

        const done = track(sayTTS(elevenLabs(), 'Hello'))
        await flush()
        expect(entered).toBe(true)
        stopTTS()
        gate.resolve()
        await flush()

        expect(startedNodes()).toHaveLength(0)
        expect(done.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('Stop during local VITS synthesis', () => {
    test('regression reproducer: a synthesis that finishes after the Stop starts no audio', async () => {
        const synthesis = deferred<{ sampling_rate: number, audio: Float32Array }>()
        synthBox.run = () => synthesis.promise

        const done = track(sayTTS(vits(), 'Hello'))
        await flush()
        stopTTS()
        synthesis.resolve({ sampling_rate: 16000, audio: new Float32Array(4) })
        await flush()

        expect(startedNodes()).toHaveLength(0)
        expect(done.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('regression reproducer: a decode callback that fires after the Stop starts no audio and closes the context', async () => {
        FakeAudioContext.manualDecode = true

        const done = track(sayTTS(vits(), 'Hello'))
        await flush()
        expect(pendingDecodes()).toHaveLength(1)
        stopTTS()
        pendingDecodes()[0].release()
        await flush()

        expect(startedNodes()).toHaveLength(0)
        expect(done.settled).toBe(true)
        expect(FakeAudioContext.instances.every((context) => context.closed)).toBe(true)
    })

    test('regression reproducer: a rejected decode releases the clip, starts no audio and raises no unhandled rejection', async () => {
        FakeAudioContext.rejectDecode = true

        const done = track(sayTTS(vits(), 'Hello'))
        await flush()
        await new Promise<void>((resolve) => realSetImmediate(resolve))

        expect(startedNodes()).toHaveLength(0)
        expect(FakeAudioContext.instances.every((context) => context.closed)).toBe(true)
        expect(done.settled).toBe(true)
        expect(unhandled).toEqual([])
    })

    test('regression reproducer: a VITS clip that is already playing is stopped by the Stop', async () => {
        const done = track(sayTTS(vits(), 'Hello'))
        await flush()
        expect(startedNodes()).toHaveLength(1)
        stopTTS()

        expect(startedNodes()[0].stop).toHaveBeenCalledTimes(1)
        expect(FakeAudioContext.instances[0].closed).toBe(true)
        expect(done.settled).toBe(true)
    })
})

describe('Stop during the Web Speech pipeline', () => {
    test('regression reproducer: a pre-hook that finishes after the Stop does not reach speak', async () => {
        const gate = deferred<void>()
        let entered = false
        addPreprocessor(async () => {
            entered = true
            await gate.promise
        })

        const done = track(sayTTS(webSpeech(), 'Hello'))
        await flush()
        expect(entered).toBe(true)
        stopTTS()
        gate.resolve()
        await flush()

        expect(speechStub.speak).not.toHaveBeenCalled()
        expect(done.settled).toBe(true)
        expect(speechStub.cancel).toHaveBeenCalled()
    })

    test('guard: speech starts when nothing was stopped', async () => {
        await sayTTS(webSpeech(), 'Hello')

        expect(speechStub.speak).toHaveBeenCalledTimes(1)
    })
})

describe('Stop with more than one clip', () => {
    test('regression reproducer: two overlapping clips are both stopped and both contexts closed', async () => {
        const first = track(sayTTS(elevenLabs(), 'First'))
        const second = track(sayTTS(elevenLabs(), 'Second'))
        await flush()
        expect(startedNodes()).toHaveLength(2)

        stopTTS()

        for (const node of startedNodes()) {
            expect(node.stop).toHaveBeenCalledTimes(1)
        }
        for (const context of FakeAudioContext.instances) {
            expect(context.close).toHaveBeenCalledTimes(1)
        }
        expect(first.settled && second.settled).toBe(true)
    })

    test('regression reproducer: a call in flight at the Stop stays silent when it is answered, and a call begun after the Stop plays', async () => {
        const stale = deferred<ReturnType<typeof fakeReply>>()
        let calls = 0
        stubFetch(async () => {
            calls++
            return calls === 1 ? stale.promise : fakeReply(200)
        })

        const first = track(sayTTS(elevenLabs(), 'First'))
        await flush()
        stopTTS()
        const second = track(sayTTS(elevenLabs(), 'Second'))
        await flush()
        expect(startedNodes()).toHaveLength(1)
        stale.resolve(fakeReply(200))
        await flush()

        expect(startedNodes()).toHaveLength(1)
        expect(first.settled && second.settled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('regression reproducer: a clip played through the gain path is stopped and its context closed', async () => {
        globalFetchMock.mockResolvedValue({ ok: true, data: { buffer: new ArrayBuffer(8) } })

        const done = track(sayTTS(gptSoVits(), 'Hello'))
        await flush()
        expect(startedNodes()).toHaveLength(1)
        stopTTS()

        expect(startedNodes()[0].stop).toHaveBeenCalledTimes(1)
        expect(FakeAudioContext.instances[0].closed).toBe(true)
        expect(done.settled).toBe(true)
    })
})

describe('Stop when nothing is playing', () => {
    test('guard: a Stop while idle leaves the next call playing', async () => {
        stopTTS()

        await sayTTS(elevenLabs(), 'Hello')

        expect(startedNodes()).toHaveLength(1)
    })

    test('guard: two Stops in a row leave the next call playing', async () => {
        stopTTS()
        stopTTS()

        await sayTTS(elevenLabs(), 'Hello')

        expect(startedNodes()).toHaveLength(1)
    })

    test('regression reproducer: a clip that ended, then a Stop, closes its context once and raises no rejection', async () => {
        await sayTTS(elevenLabs(), 'Hello')
        const node = startedNodes()[0]
        node.onended?.()
        stopTTS()
        node.onended?.()
        await flush()

        expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
    })
})

describe('a missing speechSynthesis', () => {
    test('regression reproducer: Stop does not throw', () => {
        Reflect.deleteProperty(globalThis, 'speechSynthesis')
        Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance')

        expect(() => stopTTS()).not.toThrow()
    })

    test('regression reproducer: a Web Speech call ends without an alert or a throw', async () => {
        Reflect.deleteProperty(globalThis, 'speechSynthesis')
        Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance')

        await expect(sayTTS(webSpeech(), 'Hello')).resolves.toBeUndefined()

        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('a plugin-defined voice mode', () => {
    test('guard: a pre-hook that skips ends the call without a throw, a request or an alert', async () => {
        const fetchMock = stubFetch(async () => fakeReply(200))
        addPreprocessor(() => ({ skip: true }))

        await expect(sayTTS(makeCharacter('my-plugin-voice'), 'Hello')).resolves.toBeUndefined()

        expect(fetchMock).not.toHaveBeenCalled()
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(startedNodes()).toHaveLength(0)
    })

    test('guard: the pre-hook receives the mode and the text, and a mode no provider handles ends silently', async () => {
        const seen: BeforeTTSContext[] = []
        addPreprocessor((context) => { seen.push({ ...context }) })

        await sayTTS(makeCharacter('my-plugin-voice'), 'Hello')

        expect(seen).toEqual([{ text: 'Hello', ttsMode: 'my-plugin-voice', characterId: 'char-my-plugin-voice' }])
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

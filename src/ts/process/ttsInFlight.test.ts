// @vitest-environment happy-dom

/**
 * The 'tts' in-flight tokens of the REAL `sayTTS` (`./tts`), `stopTTS`, the
 * REAL playback registry (`./ttsPlayback`) and the REAL `runVITS`
 * (`./transformers`).
 *
 * Invariants pinned here:
 *  - `sayTTS` holds a token while it synthesises and decodes, and ends it
 *    however it settles;
 *  - a started clip holds its own token, begun before the `sayTTS` token ends,
 *    ended when the audio ends, when the clip is cancelled, and by a max age
 *    when `onended` never fires;
 *  - Web Speech holds a token per utterance, ended by `onend`, `onerror`,
 *    `stopTTS` or a max age that grows with the text;
 *  - `runVITS` holds a token over its decode, which finishes after it returns.
 *
 * `AudioContext`, `speechSynthesis`, `fetch`, the translator and the VITS
 * pipeline are fakes; a passing test says nothing about a real browser's audio.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const alertErrorMock = vi.hoisted(() => vi.fn())
const synthBox = vi.hoisted(() => ({ run: async (_text: string): Promise<{ sampling_rate: number, audio: Float32Array }> => ({ sampling_rate: 16000, audio: new Float32Array(4) }) }))

vi.mock(import('../alert'), () => ({
    alertError: alertErrorMock,
}) as unknown as typeof import('../alert'))

vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getDatabase: vi.fn(() => ({ elevenLabKey: 'el-key' })),
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
import { beginInFlight, inFlightKinds, resetInFlightForTest, subscribeInFlight } from './inFlightWork'
import { runVITS } from './transformers'
import type { character } from '../storage/database.svelte'

//#region fakes

const DECODED = { duration: 2 }

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
    nodes: FakeNode[] = []
    pending: Array<() => void> = []
    destination = {}
    close = vi.fn(async () => {})
    constructor() {
        FakeAudioContext.instances.push(this)
    }
    decodeAudioData(_data: ArrayBuffer, ok?: (buffer: unknown) => void) {
        let release: () => void = () => {}
        const promise = new Promise<unknown>((resolve) => {
            release = () => {
                ok?.(DECODED)
                resolve(DECODED)
            }
        })
        if (FakeAudioContext.manualDecode) {
            this.pending.push(release)
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

function startedNodes(): FakeNode[] {
    return FakeAudioContext.instances.flatMap((context) => context.nodes).filter((node) => node.start.mock.calls.length > 0)
}

class FakeUtterance {
    constructor(public text: string) {}
    voice: unknown = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
}

const speechStub = {
    getVoices: vi.fn(() => [{ name: 'voice-a' }]),
    speak: vi.fn(),
    cancel: vi.fn(),
}

function lastUtterance(): FakeUtterance {
    const calls = speechStub.speak.mock.calls
    return calls[calls.length - 1][0] as FakeUtterance
}

function audioReply() {
    return {
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(8),
    }
}

function makeCharacter(mode: string, extra: Record<string, unknown> = {}): character {
    return { chaId: `char-${mode}`, type: 'character', ttsMode: mode, ...extra } as unknown as character
}

const elevenLabs = () => makeCharacter('elevenlab', { ttsSpeech: 'voice-1' })
const webSpeech = () => makeCharacter('webspeech', { ttsSpeech: 'voice-a' })
const vits = () => makeCharacter('vits', { vits: 'Xenova/test' })

//#endregion

beforeEach(() => {
    vi.useFakeTimers()
    resetInFlightForTest()
    stopTTS()
    FakeAudioContext.instances = []
    FakeAudioContext.manualDecode = false
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('speechSynthesis', speechStub)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('caches', { open: async () => ({ put: async () => {}, match: async () => undefined }) })
    vi.stubGlobal('fetch', vi.fn(async () => audioReply()))
    speechStub.speak.mockReset()
    speechStub.cancel.mockClear()
    alertErrorMock.mockReset()
    synthBox.run = async () => ({ sampling_rate: 16000, audio: new Float32Array(4) })
})

afterEach(() => {
    stopTTS()
    resetInFlightForTest()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('the sayTTS token', () => {
    test('is held while the provider request runs', async () => {
        let during: string[] = []
        vi.stubGlobal('fetch', vi.fn(async () => {
            during = inFlightKinds()
            return audioReply()
        }))

        await sayTTS(elevenLabs(), 'Hello')

        expect(during).toEqual(['tts'])
    })

    test('is ended when the provider request throws', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

        await sayTTS(elevenLabs(), 'Hello')

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(inFlightKinds()).toEqual([])
    })

    test('is ended when there is nothing to say', async () => {
        await sayTTS(elevenLabs(), '')

        expect(inFlightKinds()).toEqual([])
    })
})

describe('the clip token', () => {
    test('begins before the sayTTS token ends, so the registry is never idle while audio is pending or playing', async () => {
        const snapshots: string[][] = []
        const unsubscribe = subscribeInFlight(() => { snapshots.push(inFlightKinds()) })

        await sayTTS(elevenLabs(), 'Hello')
        expect(startedNodes()).toHaveLength(1)
        expect(inFlightKinds()).toEqual(['tts'])
        startedNodes()[0].onended?.()
        unsubscribe()

        expect(inFlightKinds()).toEqual([])
        expect(snapshots.slice(0, -1).every((kinds) => kinds.length > 0)).toBe(true)
        expect(snapshots[snapshots.length - 1]).toEqual([])
    })

    test('ends when the audio ends', async () => {
        await sayTTS(elevenLabs(), 'Hello')
        expect(inFlightKinds()).toEqual(['tts'])

        startedNodes()[0].onended?.()

        expect(inFlightKinds()).toEqual([])
    })

    test('ends when playback is cancelled', async () => {
        await sayTTS(elevenLabs(), 'Hello')
        expect(inFlightKinds()).toEqual(['tts'])

        stopTTS()

        expect(inFlightKinds()).toEqual([])
    })

    test('is released after the clip duration plus ten seconds when onended never fires', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        await sayTTS(elevenLabs(), 'Hello')

        await vi.advanceTimersByTimeAsync(2000 + 10_000 - 1)
        expect(inFlightKinds()).toEqual(['tts'])
        await vi.advanceTimersByTimeAsync(1)
        expect(inFlightKinds()).toEqual([])
    })
})

describe('the Web Speech token', () => {
    test('is held after sayTTS returns and ended by the utterance end', async () => {
        await sayTTS(webSpeech(), 'Hello')
        expect(speechStub.speak).toHaveBeenCalledTimes(1)
        expect(inFlightKinds()).toEqual(['tts'])

        lastUtterance().onend?.()

        expect(inFlightKinds()).toEqual([])
    })

    test('is ended by the utterance error', async () => {
        await sayTTS(webSpeech(), 'Hello')
        expect(inFlightKinds()).toEqual(['tts'])

        lastUtterance().onerror?.()

        expect(inFlightKinds()).toEqual([])
    })

    test('is ended by stopTTS even when the engine reports nothing', async () => {
        await sayTTS(webSpeech(), 'Hello')
        expect(inFlightKinds()).toEqual(['tts'])

        stopTTS()

        expect(inFlightKinds()).toEqual([])
    })

    test('ending twice (event, then stop) does not end another unit token', async () => {
        const endOther = beginInFlight('tts')
        await sayTTS(webSpeech(), 'Hello')

        lastUtterance().onend?.()
        stopTTS()

        expect(inFlightKinds()).toEqual(['tts'])
        endOther()
    })

    test('is released after sixty seconds plus a hundred milliseconds per character when no event arrives', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const text = 'Hello there'
        await sayTTS(webSpeech(), text)
        const limit = 60_000 + 100 * text.length

        await vi.advanceTimersByTimeAsync(limit - 1)
        expect(inFlightKinds()).toEqual(['tts'])
        await vi.advanceTimersByTimeAsync(1)
        expect(inFlightKinds()).toEqual([])
    })

    test('is ended when the engine refuses to speak', async () => {
        speechStub.speak.mockImplementation(() => { throw new Error('engine refused') })

        await sayTTS(webSpeech(), 'Hello')

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(inFlightKinds()).toEqual([])
    })
})

describe('the VITS decode token', () => {
    test('covers the decode that finishes after runVITS returns, then hands over to the clip token', async () => {
        FakeAudioContext.manualDecode = true

        await runVITS('Hello', 'Xenova/test')
        const pending = FakeAudioContext.instances.flatMap((context) => context.pending)
        expect(pending).toHaveLength(1)
        expect(inFlightKinds()).toEqual(['tts'])

        pending[0]()
        expect(startedNodes()).toHaveLength(1)
        expect(inFlightKinds()).toEqual(['tts'])

        startedNodes()[0].onended?.()
        expect(inFlightKinds()).toEqual([])
    })

    test('through sayTTS leaves no gap and ends with the clip', async () => {
        FakeAudioContext.manualDecode = true
        const snapshots: string[][] = []
        const unsubscribe = subscribeInFlight(() => { snapshots.push(inFlightKinds()) })

        await sayTTS(vits(), 'Hello')
        FakeAudioContext.instances.flatMap((context) => context.pending)[0]()
        startedNodes()[0].onended?.()
        unsubscribe()

        expect(snapshots.slice(0, -1).every((kinds) => kinds.length > 0)).toBe(true)
        expect(inFlightKinds()).toEqual([])
    })
})

// @vitest-environment happy-dom

/**
 * The Hugging Face text-to-speech path of the REAL `sayTTS` (`./tts`).
 *
 * Invariants pinned here:
 *  - the reply is translated en -> `hfTTS.language` exactly once per call,
 *    before any request, and never when the language is empty or English
 *    (compared after trim and lower-casing), or when there is nothing to say;
 *  - the request goes to the Hugging Face router with a Bearer header and an
 *    `inputs` body;
 *  - a "model is loading" 503 is retried only while fewer than 5 requests were
 *    made and the advertised wait fits in the 30 s budget that is left; every
 *    other 503, and every other non-audio outcome, ends with one alert.
 *
 * `fetch`, the translator, the alert, the database, `globalFetch` and
 * `AudioContext` are recording fakes and time is faked, so nothing here
 * touches a network, an audio device or a real clock. A passing test says
 * nothing about the live Hugging Face service or a real browser's audio.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const alertErrorMock = vi.hoisted(() => vi.fn())
const runTranslatorMock = vi.hoisted(() => vi.fn(async (text: string, _reverse: boolean, _from: string, _to: string): Promise<string> => text))
const dbBox = vi.hoisted(() => ({ db: { huggingfaceKey: 'hf-key' } as Record<string, unknown> }))

vi.mock(import('../alert'), () => ({
    alertError: alertErrorMock,
}) as unknown as typeof import('../alert'))

vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getDatabase: vi.fn(() => dbBox.db),
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../translator/translator'), () => ({
    runTranslator: runTranslatorMock,
    translateVox: vi.fn(async (text: string) => text),
}) as unknown as typeof import('../translator/translator'))

vi.mock(import('../globalApi.svelte'), () => ({
    globalFetch: vi.fn(),
    loadAsset: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('./transformers'), () => ({
    runVITS: vi.fn(),
}) as unknown as typeof import('./transformers'))

// The sleep the code under test may use; it follows the faked clock.
vi.mock(import('../util'), () => ({
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}) as unknown as typeof import('../util'))

//#endregion

import { sayTTS } from './tts'
import { language } from 'src/lang'
import type { character } from '../storage/database.svelte'

//#region fakes

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
    close = vi.fn(async () => {})
    constructor() {
        FakeAudioContext.instances.push(this)
    }
    decodeAudioData(_data: ArrayBuffer) {
        return Promise.resolve({ duration: 1 })
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

function startedClips(): number {
    return FakeAudioContext.instances.reduce((sum, context) => sum + context.nodes.filter((node) => node.start.mock.calls.length > 0).length, 0)
}

interface FakeReplyInit {
    json?: unknown
    text?: string
    type?: string
}

function fakeReply(status: number, init: FakeReplyInit = {}) {
    const body = init.json !== undefined ? JSON.stringify(init.json) : (init.text ?? '')
    const type = init.type ?? (init.json !== undefined ? 'application/json' : 'audio/wav')
    return {
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
        text: async () => body,
        json: async () => JSON.parse(body),
        arrayBuffer: async () => new ArrayBuffer(8),
    }
}

type FakeReply = ReturnType<typeof fakeReply>

/** Answers each request with the next reply, repeating the last one; a runaway retry loop throws. */
function replyWith(...replies: FakeReply[]) {
    let calls = 0
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
        calls++
        if (calls > 40) {
            throw new Error('runaway request loop')
        }
        return replies[Math.min(calls - 1, replies.length - 1)]
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

function loading(estimatedTime: unknown): FakeReply {
    return fakeReply(503, { json: { error: 'Model is loading', estimated_time: estimatedTime } })
}

function hfCharacter(languageCode: string | undefined = 'ja'): character {
    return {
        chaId: 'char-hf',
        type: 'character',
        ttsMode: 'huggingface',
        hfTTS: { model: 'facebook/mms-tts', language: languageCode },
    } as unknown as character
}

function track<T>(promise: Promise<T>) {
    const state = { settled: false }
    void promise.then(() => { state.settled = true }, () => { state.settled = true })
    return state
}

//#endregion

beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.instances = []
    vi.stubGlobal('AudioContext', FakeAudioContext)
    alertErrorMock.mockReset()
    runTranslatorMock.mockClear()
    runTranslatorMock.mockImplementation(async (text: string) => `JA:${text}`)
    dbBox.db = { huggingfaceKey: 'hf-key' }
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('the translation of a Hugging Face reply', () => {
    test('regression reproducer: a reply for language ja is translated en to ja once and the translation is the request input', async () => {
        const fetchMock = replyWith(fakeReply(200))

        await sayTTS(hfCharacter('ja'), 'Hello')

        expect(runTranslatorMock).toHaveBeenCalledTimes(1)
        expect(runTranslatorMock).toHaveBeenCalledWith('Hello', true, 'en', 'ja')
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ inputs: 'JA:Hello' })
        expect(startedClips()).toBe(1)
    })

    test.each([
        ['regression reproducer: an empty language', ''],
        ['guard: en', 'en'],
        ['regression reproducer: en with padding and capitals', ' EN '],
    ])('%s is not translated and the reply is sent as written', async (_label, languageCode) => {
        const fetchMock = replyWith(fakeReply(200))

        await sayTTS(hfCharacter(languageCode), 'Hello')

        expect(runTranslatorMock).not.toHaveBeenCalled()
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ inputs: 'Hello' })
    })

    test('guard: a language of ja and then en on the same character translates only the first call', async () => {
        replyWith(fakeReply(200))
        const speaker = hfCharacter('ja')

        await sayTTS(speaker, 'First')
        speaker.hfTTS.language = 'en'
        await sayTTS(speaker, 'Second')

        expect(runTranslatorMock).toHaveBeenCalledTimes(1)
        expect(runTranslatorMock.mock.calls[0][0]).toBe('First')
    })

    test('regression reproducer: text that is only whitespace makes no translator call and no request', async () => {
        const fetchMock = replyWith(fakeReply(200))

        await sayTTS(hfCharacter('ja'), ' \n ')

        expect(runTranslatorMock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('regression reproducer: three loading answers then audio translate once, make four requests and play once', async () => {
        const fetchMock = replyWith(loading(2), loading(2), loading(2), fakeReply(200))

        const done = track(sayTTS(hfCharacter('ja'), 'Hello'))
        await vi.advanceTimersByTimeAsync(10_000)

        expect(done.settled).toBe(true)
        expect(runTranslatorMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledTimes(4)
        expect(startedClips()).toBe(1)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('the request to Hugging Face', () => {
    test('regression reproducer: the request goes to the router with a Bearer key and an inputs body', async () => {
        const fetchMock = replyWith(fakeReply(200))

        await sayTTS(hfCharacter('en'), 'Hello')

        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://router.huggingface.co/hf-inference/models/facebook/mms-tts')
        expect(init?.method).toBe('POST')
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer hf-key')
        expect(JSON.parse(String(init?.body))).toEqual({ inputs: 'Hello' })
    })
})

describe('the retry of a loading model', () => {
    test.each([
        [2, 5],
        [7, 5],
        [10, 4],
    ])('regression reproducer: loading answers of %s s stop after %s requests with one alert, within the 30 s budget', async (estimatedTime, expectedRequests) => {
        const fetchMock = replyWith(loading(estimatedTime))

        const done = track(sayTTS(hfCharacter('en'), 'Hello'))
        await vi.advanceTimersByTimeAsync(30_000)

        expect(fetchMock).toHaveBeenCalledTimes(expectedRequests)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(done.settled).toBe(true)
        expect(alertErrorMock.mock.calls[0][0]).toContain(language.errors.httpError)
        expect(alertErrorMock.mock.calls[0][0]).toContain('Model is loading')
        expect(vi.getTimerCount()).toBe(0)
        expect(startedClips()).toBe(0)
    })

    test('regression reproducer: an advertised wait larger than the budget makes one request, waits for nothing and alerts at once', async () => {
        const fetchMock = replyWith(loading(120))

        const done = track(sayTTS(hfCharacter('en'), 'Hello'))
        await vi.advanceTimersByTimeAsync(0)

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(done.settled).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    test('guard: waits that add up to exactly the 30 s budget are all taken and the fifth request plays', async () => {
        const fetchMock = replyWith(loading(7.5), loading(7.5), loading(7.5), loading(7.5), fakeReply(200))

        const done = track(sayTTS(hfCharacter('en'), 'Hello'))
        await vi.advanceTimersByTimeAsync(29_999)
        expect(done.settled).toBe(false)
        expect(fetchMock).toHaveBeenCalledTimes(4)
        await vi.advanceTimersByTimeAsync(1)

        expect(done.settled).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(5)
        expect(startedClips()).toBe(1)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('regression reproducer: a wait that does not fit in what is left of the budget alerts without taking it', async () => {
        const fetchMock = replyWith(loading(7.51))

        const done = track(sayTTS(hfCharacter('en'), 'Hello'))
        await vi.advanceTimersByTimeAsync(30_000)

        expect(fetchMock).toHaveBeenCalledTimes(4)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(done.settled).toBe(true)
    })

    test.each([
        ['no estimated_time', undefined],
        ['an estimated_time that is not a number', 'x'],
        ['a zero estimated_time', 0],
        ['a negative estimated_time', -3],
    ])('regression reproducer: a loading answer with %s alerts with its body and is not retried', async (_label, estimatedTime) => {
        const fetchMock = replyWith(fakeReply(503, { json: estimatedTime === undefined ? { error: 'Model is loading' } : { error: 'Model is loading', estimated_time: estimatedTime } }))

        const done = track(sayTTS(hfCharacter('en'), 'Hello'))
        await vi.advanceTimersByTimeAsync(1_000)

        expect(done.settled).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock.mock.calls[0][0]).toContain('Model is loading')
    })

    test('guard: a 503 whose body is not JSON alerts with the body and is not retried', async () => {
        const fetchMock = replyWith(fakeReply(503, { text: 'upstream gone', type: 'application/json' }))

        const done = track(sayTTS(hfCharacter('en'), 'Hello'))
        await vi.advanceTimersByTimeAsync(1_000)

        expect(done.settled).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock.mock.calls[0][0]).toContain('upstream gone')
    })
})

describe('the other outcomes of a request', () => {
    test('guard: an error status alerts once with the body and plays nothing', async () => {
        replyWith(fakeReply(401, { text: 'bad key', type: 'text/plain' }))

        await sayTTS(hfCharacter('en'), 'Hello')

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock.mock.calls[0][0]).toContain('bad key')
        expect(startedClips()).toBe(0)
    })

    test('guard: a status that is neither success nor error alerts once', async () => {
        replyWith(fakeReply(204, { text: '', type: 'text/plain' }))

        await sayTTS(hfCharacter('en'), 'Hello')

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(startedClips()).toBe(0)
    })

    test('guard: audio is played once with no alert', async () => {
        replyWith(fakeReply(200))

        await sayTTS(hfCharacter('en'), 'Hello')

        expect(startedClips()).toBe(1)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

// @vitest-environment happy-dom

/**
 * `sayTTS` (`./tts`) for a character whose provider config is missing, and for
 * text that is empty once it reaches the provider.
 *
 * Invariants pinned here:
 *  - a missing or null `naittsConfig`, `voicevoxConfig` or `fishSpeechConfig`
 *    behaves as the defaults the character editor sets, and `sayTTS` never
 *    throws a TypeError for any of the five provider configs;
 *  - GPT-SoVITS without a url or a reference audio, and Hugging Face without a
 *    model, end with a "not set up" alert before any request, any asset read
 *    and any translation;
 *  - `sayTTS` never writes into the character it is given;
 *  - text that is empty or whitespace after the text filter and the preprocessor
 *    hooks makes no request, no audio and no alert; a hook that supplies text
 *    still gets it spoken.
 *
 * `fetch`, `globalFetch`, `loadAsset`, the translator, the alert and
 * `AudioContext` are recording fakes; nothing here touches a network, a file or
 * an audio device. Alert assertions use "contains" because a thrown Error is
 * shown as "TTS Error: Error: ...".
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const alertErrorMock = vi.hoisted(() => vi.fn())
const globalFetchMock = vi.hoisted(() => vi.fn())
const loadAssetMock = vi.hoisted(() => vi.fn())
const runTranslatorMock = vi.hoisted(() => vi.fn(async (text: string): Promise<string> => text))

vi.mock(import('../alert'), () => ({
    alertError: alertErrorMock,
}) as unknown as typeof import('../alert'))

vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getDatabase: vi.fn(() => ({
        elevenLabKey: 'el-key',
        NAIApiKey: 'nai-key',
        huggingfaceKey: 'hf-key',
        fishSpeechKey: 'fish-key',
        voicevoxUrl: 'http://voicevox.test',
    })),
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../translator/translator'), () => ({
    runTranslator: runTranslatorMock,
    translateVox: vi.fn(async (text: string) => text),
}) as unknown as typeof import('../translator/translator'))

vi.mock(import('../globalApi.svelte'), () => ({
    globalFetch: globalFetchMock,
    loadAsset: loadAssetMock,
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('./transformers'), () => ({
    runVITS: vi.fn(),
}) as unknown as typeof import('./transformers'))

vi.mock(import('../util'), () => ({
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}) as unknown as typeof import('../util'))

//#endregion

import { sayTTS } from './tts'
import { registerTTSPreprocessor, unregisterTTSPreprocessor, type BeforeTTSContext, type BeforeTTSResult } from './ttsHooks'
import type { character } from '../storage/database.svelte'

class FakeContext {
    destination = {}
    close = vi.fn(async () => {})
    decodeAudioData() { return Promise.resolve({ duration: 1 }) }
    createBufferSource() { return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null } }
    createGain() { return { gain: { value: 1 }, connect: vi.fn() } }
}

const NOT_SET_UP = 'TTS is not set up for this character'

let fetchMock: ReturnType<typeof vi.fn>

function character_(fields: Record<string, unknown>): character {
    return { chaId: 'c', type: 'character', ttsSpeech: 'v', ...fields } as unknown as character
}

function alertTexts(): string[] {
    return alertErrorMock.mock.calls.map((call) => String(call[0]))
}

function okAudio() {
    return { ok: true, data: { buffer: new ArrayBuffer(8) } }
}

beforeEach(() => {
    fetchMock = vi.fn(async () => ({
        status: 200,
        headers: { get: () => 'audio/mpeg' },
        arrayBuffer: async () => new ArrayBuffer(8),
        text: async () => '',
        json: async () => ({ accent_phrases: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class {})
    globalFetchMock.mockImplementation(async () => okAudio())
    loadAssetMock.mockImplementation(async () => new Uint8Array([1, 2, 3]))
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('a missing NovelAI config', () => {
    test.each([['undefined', undefined], ['null', null]])('%s: speaks with the default voice and version', async (_label, config) => {
        const speaker = character_({ ttsMode: 'novelai', naittsConfig: config })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toEqual([])
        expect(globalFetchMock).toHaveBeenCalledTimes(1)
        const url = String(globalFetchMock.mock.calls[0][0])
        expect(url).toContain('seed=Aini')
        expect(url).toContain('version=v2')
    })
})

describe('a missing VOICEVOX config', () => {
    test.each([['undefined', undefined], ['null', null]])('%s: synthesises with the default scales', async (_label, config) => {
        const speaker = character_({ ttsMode: 'VOICEVOX', voicevoxConfig: config })
        fetchMock.mockImplementation(async (url: string) => {
            const isSynthesis = String(url).includes('/synthesis')
            return {
                status: 200,
                headers: { get: () => (isSynthesis ? 'audio/wav' : 'application/json') },
                arrayBuffer: async () => new ArrayBuffer(8),
                json: async () => ({ accent_phrases: [] }),
                text: async () => '',
            }
        })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toEqual([])
        const synthesis = fetchMock.mock.calls.find((call) => String(call[0]).includes('/synthesis'))
        expect(synthesis, 'the synthesis request').toBeDefined()
        const body = JSON.parse(String(synthesis![1].body))
        expect(body.speedScale).toBe(1)
        expect(body.pitchScale).toBe(0)
        expect(body.intonationScale).toBe(1)
        expect(body.volumeScale).toBe(1)
    })
})

describe('a missing Fish Speech config', () => {
    test.each([['undefined', undefined], ['null', null]])('%s: ends with the model-not-selected error and no request', async (_label, config) => {
        const speaker = character_({ ttsMode: 'fishspeech', fishSpeechConfig: config })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toHaveLength(1)
        expect(alertTexts()[0]).toContain('FishSpeech Model is not selected')
        expect(globalFetchMock).not.toHaveBeenCalled()
    })
})

describe('GPT-SoVITS that is not set up', () => {
    const configured = { url: 'http://sovits.test', ref_audio_data: { fileName: 'a.wav', assetId: 'asset-1' } }

    test.each([
        ['an undefined config', undefined],
        ['a null config', null],
        ['an empty url', { ...configured, url: '' }],
        ['a missing url', { ...configured, url: undefined }],
        ['an empty reference asset id', { ...configured, ref_audio_data: { fileName: '', assetId: '' } }],
        ['a missing reference audio', { url: 'http://sovits.test' }],
    ])('%s: one "not set up" alert and no asset read or request', async (_label, config) => {
        const speaker = character_({ ttsMode: 'gptsovits', gptSoVitsConfig: config })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toHaveLength(1)
        expect(alertTexts()[0]).toContain(NOT_SET_UP)
        expect(loadAssetMock).not.toHaveBeenCalled()
        expect(globalFetchMock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('guard: a configured character reads its reference audio and requests the server', async () => {
        const speaker = character_({ ttsMode: 'gptsovits', gptSoVitsConfig: { ...configured, use_auto_path: false, ref_audio_path: '/r' } })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toEqual([])
        expect(loadAssetMock).toHaveBeenCalledWith('asset-1')
        expect(String(globalFetchMock.mock.calls[0][0])).toBe('http://sovits.test/tts')
    })
})

describe('Hugging Face that is not set up', () => {
    test.each([
        ['an undefined config', undefined],
        ['a null config', null],
        ['a missing model', { language: 'ja' }],
        ['an empty model', { model: '', language: 'ja' }],
        ['a whitespace model', { model: '   ', language: 'ja' }],
    ])('%s: one "not set up" alert and no translation or request', async (_label, config) => {
        const speaker = character_({ ttsMode: 'huggingface', hfTTS: config })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toHaveLength(1)
        expect(alertTexts()[0]).toContain(NOT_SET_UP)
        expect(runTranslatorMock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('guard: a model with an empty language requests the router', async () => {
        const speaker = character_({ ttsMode: 'huggingface', hfTTS: { model: 'm/x', language: '' } })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toEqual([])
        expect(String(fetchMock.mock.calls[0][0])).toContain('/models/m/x')
    })
})

describe('sayTTS and the character it is given', () => {
    test.each([
        ['novelai', 'naittsConfig'],
        ['VOICEVOX', 'voicevoxConfig'],
        ['fishspeech', 'fishSpeechConfig'],
        ['gptsovits', 'gptSoVitsConfig'],
        ['huggingface', 'hfTTS'],
    ])('%s without %s leaves the character unchanged', async (ttsMode, field) => {
        const speaker = character_({ ttsMode, [field]: undefined })
        const before = structuredClone(speaker)

        await sayTTS(speaker, 'Hello')

        expect(speaker).toEqual(before)
        expect(Object.keys(speaker).sort()).toEqual(Object.keys(before).sort())
        expect(alertTexts().join('\n')).not.toContain('TypeError')
    })
})

describe('text that is empty when it reaches the provider', () => {
    function elevenSpeaker(readOnlyQuoted: boolean): character {
        return character_({ ttsMode: 'elevenlab', ttsReadOnlyQuoted: readOnlyQuoted })
    }

    test('a read-only-quoted character and quote-free text makes no request', async () => {
        await sayTTS(elevenSpeaker(true), 'Hello there')

        expect(fetchMock).not.toHaveBeenCalled()
        expect(alertTexts()).toEqual([])
    })

    test.each([['only asterisks', '***'], ['only spaces', '  ']])('%s makes no request', async (_label, text) => {
        await sayTTS(elevenSpeaker(false), text)

        expect(fetchMock).not.toHaveBeenCalled()
        expect(alertTexts()).toEqual([])
    })

    test('a preprocessor hook that returns null text makes no request and no alert', async () => {
        const hook = vi.fn((): BeforeTTSResult => ({ text: null as unknown as string }))
        registerTTSPreprocessor(hook)
        try {
            await sayTTS(elevenSpeaker(false), 'Hello')
        } finally {
            unregisterTTSPreprocessor(hook)
        }

        expect(hook).toHaveBeenCalledTimes(1)
        expect(fetchMock).not.toHaveBeenCalled()
        expect(alertTexts()).toEqual([])
    })

    test('guard: a preprocessor hook that supplies text for an empty one gets it spoken', async () => {
        const hook = vi.fn((_ctx: BeforeTTSContext): BeforeTTSResult => ({ text: 'Supplied' }))
        registerTTSPreprocessor(hook)
        try {
            await sayTTS(elevenSpeaker(false), '***')
        } finally {
            unregisterTTSPreprocessor(hook)
        }

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).text).toBe('Supplied')
    })

    test('guard: ordinary text is still spoken', async () => {
        await sayTTS(elevenSpeaker(false), 'Hello')

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

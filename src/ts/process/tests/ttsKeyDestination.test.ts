// @vitest-environment happy-dom

/**
 * The app-wide OpenAI key and the per-character OpenAI TTS `baseURL`.
 *
 * Invariants pinned here:
 *  - the app-wide key, plaintext or a reference, is never sent to a host other than the default OpenAI
 *    host when the character carries no key of its own;
 *  - the character's own key, the default host and a keyless local server keep working.
 *
 * `globalFetch`, the alert and `AudioContext` are recording fakes; nothing touches a network or an audio
 * device. Tests whose title starts with `guard:` pass with or without the change.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const alertErrorMock = vi.hoisted(() => vi.fn())
const globalFetchMock = vi.hoisted(() => vi.fn())
const dbHolder = vi.hoisted(() => ({ db: { openAIKey: '' } as { openAIKey: string } }))

vi.mock(import('../../alert'), () => ({
    alertError: alertErrorMock,
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getDatabase: vi.fn(() => dbHolder.db),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../translator/translator'), () => ({
    runTranslator: vi.fn(async (text: string): Promise<string> => text),
    translateVox: vi.fn(async (text: string) => text),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../globalApi.svelte'), () => ({
    globalFetch: globalFetchMock,
    loadAsset: vi.fn(),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../transformers'), () => ({
    runVITS: vi.fn(),
}) as unknown as typeof import('../transformers'))

vi.mock(import('../../util'), () => ({
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}) as unknown as typeof import('../../util'))

//#endregion

import { sayTTS } from '../tts'
import type { character } from '../../storage/database.svelte'

class FakeContext {
    destination = {}
    close = vi.fn(async () => {})
    decodeAudioData() { return Promise.resolve({ duration: 1 }) }
    createBufferSource() { return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null } }
    createGain() { return { gain: { value: 1 }, connect: vi.fn() } }
}

function openAICharacter(config: { baseURL: string, apiKey: string }): character {
    return {
        chaId: 'c', type: 'character', ttsMode: 'openai',
        oaiTTSConfig: { enabled: true, baseURL: config.baseURL, apiKey: config.apiKey },
    } as unknown as character
}

function sentHeaders(): Array<Record<string, string>> {
    return globalFetchMock.mock.calls.map((call) => (call[1] as { headers: Record<string, string> }).headers)
}

function alertTexts(): string[] {
    return alertErrorMock.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
    dbHolder.db = { openAIKey: '' }
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class {})
    globalFetchMock.mockImplementation(async () => ({ ok: true, data: { buffer: new ArrayBuffer(8) } }))
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('the app-wide OpenAI key and a foreign TTS host', () => {
    test('a plaintext app-wide key is not sent to a foreign host when the card has no key', async () => {
        dbHolder.db.openAIKey = 'sk-global'

        await sayTTS(openAICharacter({ baseURL: 'https://evil.test/v1', apiKey: '' }), 'Hello')

        expect(globalFetchMock.mock.calls.map((call) => String(call[0]))).toEqual([])
        expect(alertTexts().join('\n')).toContain('app-wide OpenAI key was not sent')
    })

    test('guard: the default host with the app-wide plaintext key sends it', async () => {
        dbHolder.db.openAIKey = 'sk-global'

        await sayTTS(openAICharacter({ baseURL: 'https://api.openai.com/v1', apiKey: '' }), 'Hello')

        expect(sentHeaders().map((h) => h.Authorization)).toEqual(['Bearer sk-global'])
    })

    test('guard: a foreign host with the card\'s own key sends the card\'s key', async () => {
        dbHolder.db.openAIKey = 'sk-global'

        await sayTTS(openAICharacter({ baseURL: 'https://evil.test/v1', apiKey: 'sk-card' }), 'Hello')

        expect(sentHeaders().map((h) => h.Authorization)).toEqual(['Bearer sk-card'])
    })

    test('guard: an app-wide key reference is still refused for a foreign host', async () => {
        dbHolder.db.openAIKey = '${OPENAI_KEY}'

        await sayTTS(openAICharacter({ baseURL: 'https://evil.test/v1', apiKey: '' }), 'Hello')

        expect(globalFetchMock).not.toHaveBeenCalled()
        expect(alertTexts().join('\n')).toContain('OPENAI_KEY')
    })

    test('guard: a local server with no key anywhere is called without an Authorization header', async () => {
        await sayTTS(openAICharacter({ baseURL: 'http://127.0.0.1:8880/v1', apiKey: '' }), 'Hello')

        expect(globalFetchMock).toHaveBeenCalledTimes(1)
        expect(String(globalFetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:8880/v1/audio/speech')
        expect(sentHeaders()[0]).not.toHaveProperty('Authorization')
        expect(alertTexts()).toEqual([])
    })
})

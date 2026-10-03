// @vitest-environment happy-dom

/**
 * The text filter step of the REAL `sayTTS` (`./tts`), seen through the body
 * of the ElevenLabs request.
 *
 * Invariants pinned here:
 *  - by default `sayTTS` removes asterisks and, for a character that reads
 *    only quoted speech, keeps only the quoted spans;
 *  - a caller that passes already-filtered text and `skipTextFilter` gets that
 *    text sent as it is (the quote filter would turn quote-free text into an
 *    empty string);
 *  - text that is empty ends the call without a request.
 *
 * `fetch`, `AudioContext`, the translator and the alert are fakes.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('../alert'))
vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getDatabase: vi.fn(() => ({ elevenLabKey: 'el-key' })),
}) as unknown as typeof import('../storage/database.svelte'))
vi.mock(import('../translator/translator'), () => ({
    runTranslator: vi.fn(),
    translateVox: vi.fn(),
}) as unknown as typeof import('../translator/translator'))
vi.mock(import('../globalApi.svelte'), () => ({
    globalFetch: vi.fn(),
    loadAsset: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))
vi.mock(import('./transformers'), () => ({ runVITS: vi.fn() }) as unknown as typeof import('./transformers'))
vi.mock(import('../util'), () => ({
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}) as unknown as typeof import('../util'))

import { sayTTS } from './tts'
import type { character } from '../storage/database.svelte'

class FakeContext {
    destination = {}
    close = vi.fn(async () => {})
    decodeAudioData() { return Promise.resolve({ duration: 1 }) }
    createBufferSource() { return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null } }
}

let fetchMock: ReturnType<typeof vi.fn>

function speaker(readOnlyQuoted: boolean): character {
    return { chaId: 'c', type: 'character', ttsMode: 'elevenlab', ttsSpeech: 'v', ttsReadOnlyQuoted: readOnlyQuoted } as unknown as character
}

function sentText(): string {
    expect(fetchMock).toHaveBeenCalledTimes(1)
    return JSON.parse(String(fetchMock.mock.calls[0][1].body)).text
}

beforeEach(() => {
    fetchMock = vi.fn(async () => ({
        status: 200,
        headers: { get: () => 'audio/mpeg' },
        arrayBuffer: async () => new ArrayBuffer(8),
        text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class {})
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('sayTTS text filter', () => {
    test('guard: asterisks are removed from the text that is sent', async () => {
        await sayTTS(speaker(false), 'a *b* c')

        expect(sentText()).toBe('a b c')
    })

    test('guard: a read-only-quoted character is sent only its quoted spans', async () => {
        await sayTTS(speaker(true), 'He said "Hi" and left')

        expect(sentText()).toBe('Hi')
    })

    test('new behaviour: with skipTextFilter the text is sent as given, quote-free text included', async () => {
        await sayTTS(speaker(true), 'Hello there', { skipTextFilter: true })

        expect(sentText()).toBe('Hello there')
    })

    test('new behaviour: with skipTextFilter asterisks are left as given', async () => {
        await sayTTS(speaker(false), 'a *b* c', { skipTextFilter: true })

        expect(sentText()).toBe('a *b* c')
    })

    test('guard: empty text makes no request', async () => {
        await sayTTS(speaker(false), '')

        expect(fetchMock).not.toHaveBeenCalled()
    })
})

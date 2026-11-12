// @vitest-environment happy-dom

/**
 * `sayTTS` (`./tts`) for VOICEVOX on Android with an `http:` server address: the release build's cleartext policy refuses
 * the WebView fetch, which surfaces as `TypeError: Failed to fetch`.
 *
 * Invariants pinned here:
 *  - a refused VOICEVOX fetch on Android with an http address (the audio query or the synthesis) ends with the one
 *    "TTS Error" alert that names the cause, and the alert carries no "Failed to fetch" text;
 *  - the cause is attached to those two fetches only: the same TypeError from the translation step, or from a non-Android
 *    page, keeps the alert it had before.
 *
 * `fetch`, the translator, the alert and `AudioContext` are recording fakes, and the operating-system plugin is a box
 * mock; nothing here touches a network or an audio device.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const alertErrorMock = vi.hoisted(() => vi.fn())
const translateVoxMock = vi.hoisted(() => vi.fn(async (text: string): Promise<string> => text))
const box = vi.hoisted(() => ({ os: 'android' }))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (box.os === 'throw') {
            throw new Error('no operating-system plugin')
        }
        return box.os
    },
}))

vi.mock(import('../alert'), () => ({
    alertError: alertErrorMock,
}) as unknown as typeof import('../alert'))

vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getDatabase: vi.fn(() => ({ voicevoxUrl: 'http://voicevox.test' })),
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../translator/translator'), () => ({
    runTranslator: vi.fn(async (text: string): Promise<string> => text),
    translateVox: translateVoxMock,
}) as unknown as typeof import('../translator/translator'))

vi.mock(import('../globalApi.svelte'), () => ({
    globalFetch: vi.fn(),
    loadAsset: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('./transformers'), () => ({
    runVITS: vi.fn(),
}) as unknown as typeof import('./transformers'))

vi.mock(import('../util'), () => ({
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}) as unknown as typeof import('../util'))

//#endregion

import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { sayTTS } from './tts'
import type { character } from '../storage/database.svelte'

class FakeContext {
    destination = {}
    close = vi.fn(async () => {})
    decodeAudioData() { return Promise.resolve({ duration: 1 }) }
    createBufferSource() { return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null } }
    createGain() { return { gain: { value: 1 }, connect: vi.fn() } }
}

const speaker = { chaId: 'c', type: 'character', ttsSpeech: 'v', ttsMode: 'VOICEVOX' } as unknown as character

let fetchMock: ReturnType<typeof vi.fn>

const queryReply = () => ({
    status: 200,
    headers: { get: () => 'application/json' },
    arrayBuffer: async () => new ArrayBuffer(8),
    json: async () => ({ accent_phrases: [] }),
})

const alertTexts = () => alertErrorMock.mock.calls.map((call) => String(call[0]))

beforeEach(() => {
    box.os = 'android'
    translateVoxMock.mockImplementation(async (text: string) => text)
    fetchMock = vi.fn(async () => queryReply())
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('speechSynthesis', { cancel: vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class {})
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

const causeAlert = fillLang(language.errors.ttsError, { error: language.errors.androidHttpBlocked })
const plainAlert = fillLang(language.errors.ttsError, { error: 'TypeError: Failed to fetch' })

describe('VOICEVOX on Android with an http address', () => {
    test('R4 a refused audio query ends with the alert that names the cause', async () => {
        fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toHaveLength(1)
        expect(alertTexts()[0]).not.toContain('Failed to fetch')
        expect(alertTexts()[0]).toBe(causeAlert)
    })

    test('R4b a refused synthesis after a good audio query ends with the same alert', async () => {
        fetchMock.mockImplementationOnce(async () => queryReply())
        fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })

        await sayTTS(speaker, 'Hello')

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(alertTexts()).toHaveLength(1)
        expect(alertTexts()[0]).not.toContain('Failed to fetch')
        expect(alertTexts()[0]).toBe(causeAlert)
    })

    test('G4 the same refusal on a desktop page keeps the alert it had', async () => {
        box.os = 'windows'
        fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toEqual([plainAlert])
    })

    test('G5 a TypeError from the translation step is not named as the cause and no fetch is made', async () => {
        translateVoxMock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })

        await sayTTS(speaker, 'Hello')

        expect(alertTexts()).toEqual([plainAlert])
        expect(alertTexts()[0]).not.toContain(language.errors.androidHttpBlocked)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

/**
 * A media credential (text-to-speech, image generation, the Playground subtitle transcription)
 * that is a whole `${NAME}` reference is resolved when the request is built: the resolved value
 * lands where the provider expects its credential and the literal reference is never sent. A
 * reference that cannot be resolved stops that one request before any network call and the user
 * sees the error. A value that is not a reference is sent exactly as typed.
 *
 * The per-character OpenAI TTS key never resolves, and the app-wide `openAIKey` fallback resolves
 * only when the effective base URL is `https://api.openai.com`.
 *
 * Drives the real `sayTTS`, `getElevenTTSVoices`, `fetchFishSpeechModels`, `generateAIImage`,
 * `requestWavespeedModels` and the Playground `requestOpenAITranscription`. Mocked: the resolver
 * (`resolveSecret`), the transports (`globalFetch`, global `fetch`), the database, alerts, audio
 * playback and the collaborators these paths touch but the tests do not exercise. The
 * `globalFetch` stub applies the real `assertNoSecretRef` tripwire, as the real function does at
 * its entry. Nothing here says anything about a native backend or the real environment lookup.
 * The components' own error handling around these calls (the Playground subtitle page,
 * CharConfig's Fish model list, OtherBotSettings' WaveSpeed model list) is not mounted here.
 *
 * Tests whose title starts with `guard:` pin behaviour that must be preserved for a plain key.
 * They pass with or without the change, except the rows for `fetchFishSpeechModels`,
 * `requestWavespeedModels` and `requestOpenAITranscription`: those functions are extracted by
 * this change, so their rows cannot run against the code before it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import '../../polyfill'
import type { character } from '../../storage/database.svelte'
import { assertNoSecretRef, SecretRefError } from '../../secretRef'
import { language } from 'src/lang'

//#region module mocks

type Call = { via: string, url: string, headers: Record<string, string>, body: string }

const h = vi.hoisted(() => ({
    calls: [] as Array<{ via: string, url: string, headers: Record<string, string>, body: string }>,
    resolved: 'SENTINEL-resolved-value',
    resolveCalls: [] as string[],
    db: {} as Record<string, unknown>,
    alerts: [] as string[],
    responder: null as null | ((url: string) => unknown),
}))

vi.mock('../../secretRef', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../secretRef')>()
    return {
        ...actual,
        resolveSecret: vi.fn(async (value: string) => {
            const name = actual.secretRefName(value)
            if (name === null) {
                return value
            }
            h.resolveCalls.push(name)
            if (name === 'RISU_UNSET_KEY') {
                throw new actual.SecretRefError(name, 'unavailable')
            }
            return h.resolved
        }),
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn((message: unknown) => { h.alerts.push(String(message)) }),
    alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertWait: vi.fn(),
    alertStore: writable({ type: '', msg: '' }),
}))

vi.mock('../../storage/database.svelte', () => ({
    getDatabase: vi.fn(() => h.db),
    getCurrentCharacter: vi.fn(() => ({ type: 'group' })),
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: { language: 'en', aiModel: '' } },
    CharEmotion: writable({}),
}))

vi.mock('../../translator/translator', () => ({ runTranslator: vi.fn(async (text: string) => text), translateVox: vi.fn(async (text: string) => text) }))
vi.mock('../transformers', () => ({ runVITS: vi.fn() }))
vi.mock('../ttsPlayback', () => ({
    cancelTTSPlayback: vi.fn(),
    currentTTSSignal: vi.fn(() => new AbortController().signal),
    playEncodedAudio: vi.fn(async () => {}),
}))
vi.mock('../ttsHooks', () => ({
    getTTSPreprocessors: vi.fn(() => []),
    getTTSPostprocessors: vi.fn(() => []),
    runHookPipeline: vi.fn(async (_hooks: unknown, ctx: unknown) => ({ skip: false, ctx })),
}))
vi.mock('./request', () => ({ requestChatData: vi.fn() }))
vi.mock('../processzip', () => ({ processZip: vi.fn(async () => '') }))

function record(via: string, url: string, headers: unknown, body: unknown) {
    const normalized: Record<string, string> = {}
    if (headers instanceof Headers) {
        headers.forEach((value, key) => { normalized[key.toLowerCase()] = value })
    }
    else if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) {
            if (value !== undefined) {
                normalized[key.toLowerCase()] = String(value)
            }
        }
    }
    let text = ''
    if (typeof body === 'string') { text = body }
    else if (body !== undefined && body !== null) { text = JSON.stringify(body) }
    h.calls.push({ via, url: String(url), headers: normalized, body: text })
}

vi.mock('../../globalApi.svelte', () => ({
    globalFetch: vi.fn(async (url: string, opts?: { headers?: unknown, body?: unknown }) => {
        try {
            assertNoSecretRef(opts?.headers as Record<string, string> | undefined, url)
        }
        catch (error) {
            return { ok: false, data: `${error}`, headers: {}, status: 400 }
        }
        record('globalFetch', url, opts?.headers, opts?.body)
        const scripted = h.responder?.(url)
        if (scripted) {
            return scripted
        }
        return { ok: false, data: new Uint8Array(), headers: {}, status: 500 }
    }),
    fetchNative: vi.fn(),
    readImage: vi.fn(async () => null),
    loadAsset: vi.fn(async () => new Uint8Array()),
    downloadFile: vi.fn(),
    AppendableBuffer: class {},
    getLanguageCodes: vi.fn(() => []),
}))

//#region Playground component collaborators
vi.mock('src/lib/UI/GUI/TextInput.svelte', () => ({ default: {} }))
vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: {} }))
vi.mock('src/lib/UI/GUI/Button.svelte', () => ({ default: {} }))
vi.mock('src/lib/UI/GUI/SelectInput.svelte', () => ({ default: {} }))
vi.mock('src/lib/UI/GUI/OptionInput.svelte', () => ({ default: {} }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: vi.fn(() => ({})), LLMFlags: {} }))
vi.mock('src/ts/util', () => ({ asBuffer: vi.fn(), selectFileByDom: vi.fn(), selectSingleFile: vi.fn(), sleep: vi.fn() }))
vi.mock('src/ts/parser/parser.svelte', () => ({ risuChatParser: vi.fn((s: string) => s) }))
vi.mock('../../../etc/send.mp3', () => ({ default: '' }))
//#endregion

//#endregion

const { sayTTS, getElevenTTSVoices, fetchFishSpeechModels } = await import('../tts')
const { generateAIImage } = await import('../stableDiff')
const { requestWavespeedModels } = await import('../wavespeedModels')
const { requestOpenAITranscription } = await import('../../../lib/Playground/PlaygroundSubtitle.svelte')

const REF = '${RISU_TEST_KEY}'
const UNSET_REF = '${RISU_UNSET_KEY}'
const PLAIN = 'plain-key-123'

function makeCharacter(patch: Record<string, unknown>): character {
    return { chaId: 'cha-1', ttsSpeech: 'speech', ...patch } as unknown as character
}

function baseDb(): Record<string, unknown> {
    return {
        sdProvider: '',
        NAIImgModel: 'nai-diffusion-3',
        NAIImgUrl: 'https://image.novelai.net/ai/generate-image',
        NAII2I: false,
        NAIImgConfig: { cfg_rescale: 0, decrisp: false, width: 64, height: 64, sampler: 's', steps: 1, scale: 1, sm: false, sm_dyn: false, noise_schedule: 'n', legacy_uc: false },
        sdConfig: { width: 64, height: 64 },
        stabilityModel: 'core',
        falModel: 'fal-ai/flux',
        ImagenModel: 'imagen-3.0-generate-002',
        google: { accessToken: '' },
        openaiCompatImage: { url: 'https://compat.example/v1/images', key: '', model: '', size: '', quality: '' },
        wavespeedImage: { key: '', model: 'm', loras: [] },
        elevenLabKey: '', huggingfaceKey: '', fishSpeechKey: '', NAIApiKey: '', openAIKey: '', stabilityKey: '', falToken: '',
    }
}

function headerIs(name: string, expected: (key: string) => string) {
    return (call: Call, key: string) => call.headers[name] === expected(key)
}

type Row = {
    field: string
    arrange: (key: string) => void
    run: () => Promise<unknown>
    carries: (call: Call, key: string) => boolean
    /** The call throws to its caller instead of alerting. */
    rejects?: boolean
}

const rows: Row[] = [
    {
        field: 'elevenLabKey (sayTTS)',
        arrange: (key) => { h.db.elevenLabKey = key },
        run: () => sayTTS(makeCharacter({ ttsMode: 'elevenlab' }), 'hello'),
        carries: headerIs('xi-api-key', (key) => key),
    },
    {
        field: 'elevenLabKey (voice list)',
        arrange: (key) => { h.db.elevenLabKey = key },
        run: () => getElevenTTSVoices(),
        carries: headerIs('xi-api-key', (key) => key),
        rejects: true,
    },
    {
        field: 'fishSpeechKey (model list)',
        arrange: (key) => { h.db.fishSpeechKey = key },
        run: () => fetchFishSpeechModels(h.db.fishSpeechKey as string),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
        rejects: true,
    },
    {
        field: 'wavespeedImage.key (model list)',
        arrange: (key) => { (h.db.wavespeedImage as Record<string, unknown>).key = key },
        run: () => requestWavespeedModels((h.db.wavespeedImage as Record<string, unknown>).key as string),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
        rejects: true,
    },
    {
        field: 'huggingfaceKey',
        arrange: (key) => { h.db.huggingfaceKey = key },
        run: () => sayTTS(makeCharacter({ ttsMode: 'huggingface', hfTTS: { model: 'some/model', language: '' } }), 'hello'),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'fishSpeechKey',
        arrange: (key) => { h.db.fishSpeechKey = key },
        run: () => sayTTS(makeCharacter({ ttsMode: 'fishspeech', fishSpeechConfig: { model: { _id: 'm' }, chunk_length: 200, normalize: true } }), 'hello'),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'NAIApiKey (TTS)',
        arrange: (key) => { h.db.NAIApiKey = key },
        run: () => sayTTS(makeCharacter({ ttsMode: 'novelai', naittsConfig: { voice: 'Aini', version: 'v2' } }), 'hello'),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'openAIKey (OpenAI TTS fallback)',
        arrange: (key) => { h.db.openAIKey = key },
        run: () => sayTTS(makeCharacter({ ttsMode: 'openai' }), 'hello'),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'NAIApiKey (image)',
        arrange: (key) => { h.db.sdProvider = 'novelai'; h.db.NAIApiKey = key },
        run: () => generateAIImage('a prompt', makeCharacter({}), '', ''),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'openAIKey (DALL-E)',
        arrange: (key) => { h.db.sdProvider = 'dalle'; h.db.openAIKey = key },
        run: () => generateAIImage('a prompt', makeCharacter({}), '', ''),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'stabilityKey',
        arrange: (key) => { h.db.sdProvider = 'stability'; h.db.stabilityKey = key },
        run: () => generateAIImage('a prompt', makeCharacter({}), '', ''),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'falToken',
        arrange: (key) => { h.db.sdProvider = 'fal'; h.db.falToken = key },
        run: () => generateAIImage('a prompt', makeCharacter({}), '', ''),
        carries: headerIs('authorization', (key) => 'Key ' + key),
    },
    {
        field: 'google.accessToken (Imagen)',
        arrange: (key) => { h.db.sdProvider = 'Imagen'; h.db.google = { accessToken: key } },
        run: () => generateAIImage('a prompt', makeCharacter({}), '', ''),
        carries: (call, key) => call.url.endsWith(':predict?key=' + key),
    },
    {
        field: 'openaiCompatImage.key',
        arrange: (key) => { h.db.sdProvider = 'openai-compat'; (h.db.openaiCompatImage as Record<string, unknown>).key = key },
        run: () => generateAIImage('a prompt', makeCharacter({}), '', ''),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'wavespeedImage.key',
        arrange: (key) => { h.db.sdProvider = 'wavespeed'; (h.db.wavespeedImage as Record<string, unknown>).key = key },
        run: () => generateAIImage('a prompt', makeCharacter({}), '', ''),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
    },
    {
        field: 'openAIKey (Playground subtitle)',
        arrange: (key) => { h.db.openAIKey = key },
        run: () => requestOpenAITranscription(new File(['x'], 'a.mp3'), h.db.openAIKey as string),
        carries: headerIs('authorization', (key) => 'Bearer ' + key),
        rejects: true,
    },
]

function serialized(call: Call): string {
    return [call.url, JSON.stringify(call.headers), call.body].join('\n')
}

async function settle(row: Row) {
    if (row.rejects) {
        await row.run().catch(() => {})
    }
    else {
        await row.run()
    }
}

beforeEach(() => {
    h.calls.length = 0
    h.resolveCalls.length = 0
    h.alerts.length = 0
    h.responder = null
    h.db = baseDb()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: unknown, body?: unknown }) => {
        record('fetch', url, init?.headers, init?.body)
        return new Response('{}', { status: 500, headers: { 'content-type': 'text/plain' } })
    }))
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('a referenced media credential is resolved into the request', () => {
    test.each(rows)('$field: the resolved value goes where the key goes and the literal is never sent', async (row) => {
        row.arrange(REF)
        await settle(row)

        expect(h.resolveCalls).toEqual(['RISU_TEST_KEY'])
        const withKey = h.calls.filter((call) => row.carries(call, h.resolved))
        expect(withKey.length).toBeGreaterThan(0)
        for (const call of h.calls) {
            expect(serialized(call)).not.toContain('${')
        }
    })

    test.each(rows)('guard: $field: a plain key is sent exactly as typed and never resolved', async (row) => {
        row.arrange(PLAIN)
        await settle(row)

        expect(h.resolveCalls).toEqual([])
        expect(h.calls.filter((call) => row.carries(call, PLAIN)).length).toBeGreaterThan(0)
    })

    test.each(rows)('$field: a reference that cannot be resolved sends nothing and tells the user', async (row) => {
        row.arrange(UNSET_REF)
        const outcome = row.run()
        if (row.rejects) {
            await expect(outcome).rejects.toBeInstanceOf(SecretRefError)
        }
        else {
            await outcome
            expect(h.alerts.some((message) => message.includes(UNSET_REF))).toBe(true)
        }

        expect(h.calls).toEqual([])
        expect(h.resolveCalls).toEqual(['RISU_UNSET_KEY'])
    })
})

describe('WaveSpeed image generation', () => {
    function scriptWaveSpeed() {
        h.responder = (url) => {
            if (url === 'https://api.wavespeed.ai/api/v3/m') {
                return { ok: true, data: { data: { id: 'task-1' } }, headers: {}, status: 200 }
            }
            if (url === 'https://api.wavespeed.ai/api/v3/predictions/task-1/result') {
                return { ok: true, data: { data: { status: 'completed', outputs: ['https://cdn.example/out.png'] } }, headers: {}, status: 200 }
            }
            if (url === 'https://cdn.example/out.png') {
                return { ok: true, data: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'image/png' }, status: 200 }
            }
            return null
        }
        h.db.sdProvider = 'wavespeed'
    }

    test('the submit, poll and result requests all carry the resolved key and never the reference', async () => {
        scriptWaveSpeed();
        (h.db.wavespeedImage as Record<string, unknown>).key = REF
        const image = await generateAIImage('a prompt', makeCharacter({}), '', 'inlay')

        expect(image).toMatch(/^data:image\/png;base64,/)
        expect(h.calls.map((call) => call.url)).toEqual([
            'https://api.wavespeed.ai/api/v3/m',
            'https://api.wavespeed.ai/api/v3/predictions/task-1/result',
            'https://cdn.example/out.png',
        ])
        for (const call of h.calls) {
            expect(call.headers['authorization']).toBe('Bearer ' + h.resolved)
            expect(serialized(call)).not.toContain('${')
        }
    })

    test('guard: a plain key is sent as typed on the submit, poll and result requests', async () => {
        scriptWaveSpeed();
        (h.db.wavespeedImage as Record<string, unknown>).key = PLAIN
        await generateAIImage('a prompt', makeCharacter({}), '', 'inlay')

        expect(h.calls).toHaveLength(3)
        for (const call of h.calls) {
            expect(call.headers['authorization']).toBe('Bearer ' + PLAIN)
        }
        expect(h.resolveCalls).toEqual([])
    })
})

describe('OpenAI TTS key sources', () => {
    const foreign = language.errors.secretRefNotForeign(REF)

    function arrangeOpenAI(options: { baseURL?: string, cardKey?: string, dbKey: string }) {
        h.db.openAIKey = options.dbKey
        const oaiTTSConfig = options.baseURL !== undefined || options.cardKey !== undefined
            ? { enabled: true, baseURL: options.baseURL ?? '', apiKey: options.cardKey ?? '', model: '', voice: '', format: '' }
            : undefined
        return makeCharacter({ ttsMode: 'openai', oaiTTSConfig })
    }

    test.each([
        'https://evil.example',
        'https://api.openai.com.evil.example/v1',
        'https://api.openai.com@evil.example/',
        'http://api.openai.com/v1',
        'not a url',
    ])('a referenced app-wide key is never resolved or sent to %s', async (baseURL) => {
        await sayTTS(arrangeOpenAI({ baseURL, dbKey: REF }), 'hello')

        expect(h.resolveCalls).toEqual([])
        expect(h.calls).toEqual([])
        expect(h.alerts.some((message) => message.includes(foreign))).toBe(true)
    })

    test.each([
        undefined,
        'https://api.openai.com/v1',
        'https://api.openai.com/v1///',
        '  https://api.openai.com/v1  ',
    ])('a referenced app-wide key resolves and is sent to the default host (%s)', async (baseURL) => {
        await sayTTS(arrangeOpenAI({ baseURL, dbKey: REF }), 'hello')

        expect(h.resolveCalls).toEqual(['RISU_TEST_KEY'])
        expect(h.calls).toHaveLength(1)
        expect(h.calls[0].url).toBe('https://api.openai.com/v1/audio/speech')
        expect(h.calls[0].headers['authorization']).toBe('Bearer ' + h.resolved)
    })

    test('guard: a plain app-wide key is still sent to a card-chosen host as typed', async () => {
        await sayTTS(arrangeOpenAI({ baseURL: 'https://tts.example/v1', dbKey: PLAIN }), 'hello')

        expect(h.resolveCalls).toEqual([])
        expect(h.calls).toHaveLength(1)
        expect(h.calls[0].url).toBe('https://tts.example/v1/audio/speech')
        expect(h.calls[0].headers['authorization']).toBe('Bearer ' + PLAIN)
    })

    test.each([
        { baseURL: 'https://api.openai.com/v1', dbKey: PLAIN },
        { baseURL: 'https://evil.example', dbKey: REF },
        { baseURL: 'https://api.openai.com/v1', dbKey: REF },
    ])('guard: a referenced card key is never resolved and no request carries it (base $baseURL, app key $dbKey)', async ({ baseURL, dbKey }) => {
        await sayTTS(arrangeOpenAI({ baseURL, cardKey: REF, dbKey }), 'hello')

        expect(h.resolveCalls).toEqual([])
        for (const call of h.calls) {
            expect(serialized(call)).not.toContain('${')
            expect(serialized(call)).not.toContain(h.resolved)
        }
        expect(h.alerts.length).toBeGreaterThan(0)
    })

    test('guard: a plain card key is sent as typed', async () => {
        await sayTTS(arrangeOpenAI({ baseURL: 'https://tts.example/v1', cardKey: 'card-key-1', dbKey: REF }), 'hello')

        expect(h.resolveCalls).toEqual([])
        expect(h.calls).toHaveLength(1)
        expect(h.calls[0].headers['authorization']).toBe('Bearer card-key-1')
    })
})

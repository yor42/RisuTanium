/**
 * The text-side readers of API keys resolve a whole `${NAME}` reference when the request is built:
 * the DeepL and DeepLX translators, the Gemini token count, the dynamic model registry (Google,
 * Anthropic, OpenAI) and the Ollama cloud model list. The resolved value lands where the provider
 * expects its credential and the literal reference is never sent. A reference that cannot be
 * resolved sends nothing and reaches the reader's existing error path. A value that is not a
 * reference is sent exactly as typed. A key-presence gate treats a reference as present.
 *
 * Drives the real `runTranslator`, `encode`, `registerModelDynamic` and `getOllamaModels`. Mocked:
 * the resolver (`resolveSecret`), the transports (`globalFetch`, `fetchNative`, global `fetch`),
 * and the collaborators these readers touch but the tests do not exercise. Nothing here says
 * anything about the real environment lookup or a native backend.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that
 * must be preserved.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

type Call = { via: string, url: string, headers: Record<string, string>, body: string }

const h = vi.hoisted(() => ({
    calls: [] as Call[],
    resolved: 'SENTINEL-resolved-value',
    resolveCalls: [] as string[],
    fail: false,
    db: {} as Record<string, unknown>,
    alertError: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}))

function normalizeHeaders(headers: unknown): Record<string, string> {
    const out: Record<string, string> = {}
    if (headers instanceof Headers) {
        headers.forEach((value, key) => { out[key.toLowerCase()] = value })
    }
    else if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) { out[key.toLowerCase()] = String(value) }
    }
    return out
}

function record(via: string, url: string, headers: unknown, body: unknown) {
    let text = ''
    if (typeof body === 'string') { text = body }
    else if (body !== undefined && body !== null) { text = JSON.stringify(body) }
    h.calls.push({ via, url: String(url), headers: normalizeHeaders(headers), body: text })
}

vi.mock('../../secretRef', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../secretRef')>()
    return {
        ...actual,
        resolveSecret: vi.fn(async (value: string) => {
            if (!actual.isSecretRef(value)) {
                return value
            }
            h.resolveCalls.push(value)
            if (h.fail) {
                throw new actual.SecretRefError(actual.secretRefName(value) as string, 'unavailable')
            }
            return h.resolved
        }),
    }
})

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string, init?: { headers?: unknown, body?: unknown }) => {
        record('fetchNative', url, init?.headers, init?.body)
        return new Response(JSON.stringify({ models: [], data: [] }), { status: 200 })
    }),
    globalFetch: vi.fn(async (url: string, opts?: { headers?: unknown, body?: unknown }) => {
        record('globalFetch', url, opts?.headers, opts?.body)
        if (url.includes('deepl.com')) {
            return { ok: true, data: { translations: [{ text: 'TRANSLATED' }] } }
        }
        if (url.endsWith('/translate')) {
            return { ok: true, data: { data: 'TRANSLATED' } }
        }
        return { ok: true, data: { models: [] } }
    }),
}))

vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => h.db }))
vi.mock('../../stores.svelte', () => ({
    get DBState() { return { db: h.db } },
    selectedCharID: writable(-1),
}))
vi.mock('../../alert', () => {
    h.alertError = vi.fn()
    return { alertError: h.alertError }
})
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) }) } }))
vi.mock('../../../etc/send.mp3', () => ({ default: '' }))
vi.mock('../../parser/chatML', () => ({ parseChatML: vi.fn() }))
vi.mock('../../translator/presets', () => ({ defaultTranslatorPrompt: '', getCurrentTranslatorPresetFromState: vi.fn() }))
vi.mock('../request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('../index.svelte', () => ({ doingChat: writable(false) }))
vi.mock('../../parser/parser.svelte', () => ({ applyMarkdownToNode: vi.fn(), risuChatParser: vi.fn() }))
vi.mock('../modules', () => ({ getModuleRegexScripts: vi.fn(() => []) }))
vi.mock('../../util', () => ({ getNodetextToSentence: vi.fn(), sleep: vi.fn(async () => {}) }))
vi.mock('../scripts', () => ({ processScriptFull: vi.fn() }))
vi.mock('../../plugins/plugins.svelte', () => ({
    customProviderStore: writable([]),
    pluginV2: { providerOptions: new Map(), providers: new Map() },
}))
vi.mock('../../plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: writable(new Map()) }))
vi.mock('../files/inlays', () => ({ supportsInlayImage: vi.fn(() => false) }))
vi.mock('../models/local', () => ({ tokenizeGGUFModel: vi.fn(async () => []) }))
vi.mock('@mlc-ai/web-tokenizers', () => {
    const tokenizer = { encode: () => new Int32Array(2), free() {} }
    return { Tokenizer: { fromJSON: async () => tokenizer, fromSentencePiece: async () => tokenizer } }
})

//#endregion

import { runTranslator } from '../../translator/translator'
import { encode } from '../../tokenizer'
import { registerModelDynamic } from '../../model/modellist'
import { getOllamaModels } from '../../model/ollama'

const REF = '${RISU_TEST_KEY}'
const PLAIN = 'plain-key-value'

let fetchCalls: Call[]
let countSeq = 0

beforeEach(() => {
    h.calls = []
    h.resolveCalls = []
    h.fail = false
    h.alertError.mockClear()
    fetchCalls = []
    vi.stubGlobal('safeStructuredClone', <T>(value: T): T => structuredClone(value))
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: unknown, body?: unknown }) => {
        fetchCalls.push({ via: 'fetch', url: String(url), headers: normalizeHeaders(init?.headers), body: typeof init?.body === 'string' ? init.body : '' })
        if (String(url).includes('generativelanguage')) {
            return new Response(JSON.stringify({ totalTokens: 3 }), { status: 200 })
        }
        return new Response(new ArrayBuffer(8), { status: 200 })
    }))
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        translatorType: 'deepl',
        noWaitForTranslate: true,
        deeplOptions: { key: '', freeApi: false },
        deeplXOptions: { url: 'http://localhost:1188', token: '' },
        aiModel: 'gemini-3.8-flash',
        googleClaudeTokenizing: true,
        useTokenizerCaching: false,
        currentPluginProvider: '',
        customTokenizer: '',
        dynamicModelRegistry: true,
        google: { accessToken: '' },
        claudeAPIKey: '',
        openAIKey: '',
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

function noLiteral(call: Call) {
    expect(call.url).not.toContain('${')
    expect(JSON.stringify(call.headers)).not.toContain('${')
    expect(call.body).not.toContain('${')
}

//#region readers

type Reader = {
    name: string
    setKey: (value: string) => void
    run: () => Promise<unknown>
    calls: () => Call[]
    /** Where the credential lands, as a predicate over the recorded call. */
    carries: (call: Call, key: string) => boolean
    /** Asserts the reader's existing error path after a failed resolution. */
    expectFailureSurfaced: (outcome: { value?: unknown, error?: unknown }, errorSpy: ReturnType<typeof vi.spyOn>) => void
}

const consoleErrorSurfaced = (outcome: { value?: unknown, error?: unknown }, errorSpy: ReturnType<typeof vi.spyOn>) => {
    expect(errorSpy).toHaveBeenCalled()
    const surfaced = errorSpy.mock.calls.some((args) => args.some((arg) => arg instanceof Error && arg.message.includes('RISU_TEST_KEY')))
    expect(surfaced).toBe(true)
}

const readers: Reader[] = [
    {
        name: 'DeepL translator',
        setKey: (value) => { (h.db.deeplOptions as { key: string }).key = value },
        run: () => runTranslator('hello', false, 'ko', 'en'),
        calls: () => h.calls,
        carries: (call, key) => call.headers['authorization'] === 'DeepL-Auth-Key ' + key,
        expectFailureSurfaced: () => {
            expect(h.alertError).toHaveBeenCalledTimes(1)
            expect(String(h.alertError.mock.calls[0][0])).toContain('RISU_TEST_KEY')
        },
    },
    {
        name: 'DeepLX translator',
        setKey: (value) => { h.db.translatorType = 'deeplX'; (h.db.deeplXOptions as { token: string }).token = value },
        run: () => runTranslator('hello', false, 'ko', 'en'),
        calls: () => h.calls,
        carries: (call, key) => call.headers['authorization'] === 'Bearer ' + key,
        expectFailureSurfaced: () => {
            expect(h.alertError).toHaveBeenCalledTimes(1)
            expect(String(h.alertError.mock.calls[0][0])).toContain('RISU_TEST_KEY')
        },
    },
    {
        name: 'Gemini token count',
        setKey: (value) => { (h.db.google as { accessToken: string }).accessToken = value },
        // The tokenizer memoizes counts per text, so each run counts a text no earlier run used.
        run: () => encode(`some text to count ${++countSeq}`),
        calls: () => fetchCalls.filter((call) => call.url.includes('generativelanguage')),
        carries: (call, key) => new URL(call.url).searchParams.get('key') === key,
        expectFailureSurfaced: consoleErrorSurfaced,
    },
    {
        name: 'Google model registry',
        setKey: (value) => { (h.db.google as { accessToken: string }).accessToken = value },
        run: () => registerModelDynamic(),
        calls: () => h.calls.filter((call) => call.url.includes('generativelanguage')),
        carries: (call, key) => new URL(call.url).searchParams.get('key') === key,
        expectFailureSurfaced: consoleErrorSurfaced,
    },
    {
        name: 'Anthropic model registry',
        setKey: (value) => { h.db.claudeAPIKey = value },
        run: () => registerModelDynamic(),
        calls: () => h.calls.filter((call) => call.url.includes('anthropic.com')),
        carries: (call, key) => call.headers['x-api-key'] === key,
        expectFailureSurfaced: consoleErrorSurfaced,
    },
    {
        name: 'OpenAI model registry',
        setKey: (value) => { h.db.openAIKey = value },
        run: () => registerModelDynamic(),
        calls: () => h.calls.filter((call) => call.url.includes('api.openai.com')),
        carries: (call, key) => call.headers['authorization'] === 'Bearer ' + key,
        expectFailureSurfaced: consoleErrorSurfaced,
    },
    {
        name: 'Ollama cloud model list',
        setKey: (value) => { h.db.ollamaApiKey = value },
        run: () => getOllamaModels('http://localhost:11434', 'cloud', h.db.ollamaApiKey as string),
        calls: () => h.calls,
        carries: (call, key) => call.headers['authorization'] === 'Bearer ' + key,
        expectFailureSurfaced: (outcome) => {
            expect(outcome.error).toBeInstanceOf(Error)
            expect((outcome.error as Error).message).toContain('RISU_TEST_KEY')
        },
    },
]

async function runReader(reader: Reader) {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const outcome: { value?: unknown, error?: unknown } = {}
    try {
        outcome.value = await reader.run()
    }
    catch (error) {
        outcome.error = error
    }
    return { outcome, errorSpy }
}

describe.each(readers)('$name', (reader) => {
    test('a reference resolves to the value where the key goes and the literal is never sent', async () => {
        reader.setKey(REF)
        const { errorSpy } = await runReader(reader)
        errorSpy.mockRestore()
        const sent = reader.calls()
        expect(sent.length).toBeGreaterThan(0)
        for (const call of sent) {
            noLiteral(call)
            expect(reader.carries(call, h.resolved)).toBe(true)
        }
        expect(h.resolveCalls).toContain(REF)
    })

    test('guard: a plain key is sent exactly as typed', async () => {
        reader.setKey(PLAIN)
        const { errorSpy } = await runReader(reader)
        errorSpy.mockRestore()
        const sent = reader.calls()
        expect(sent.length).toBeGreaterThan(0)
        for (const call of sent) {
            expect(reader.carries(call, PLAIN)).toBe(true)
        }
    })

    test('a failed resolution sends no request and reaches the existing error path', async () => {
        h.fail = true
        reader.setKey(REF)
        const { outcome, errorSpy } = await runReader(reader)
        expect(reader.calls()).toHaveLength(0)
        reader.expectFailureSurfaced(outcome, errorSpy)
        errorSpy.mockRestore()
    })

    test('guard: a key-presence gate treats a reference as present and still runs the reader', async () => {
        reader.setKey(REF)
        const { errorSpy } = await runReader(reader)
        errorSpy.mockRestore()
        expect(reader.calls().length).toBeGreaterThan(0)
    })
})

//#endregion

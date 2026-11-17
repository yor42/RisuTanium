/**
 * Key rotation on a key limit. A key field holds one key per line. When a provider answers 429 or
 * 402 for the leased line, the same request is resent at once with the next line not yet found
 * limited; each line is sent at most once per fallback model's pass, and when every line is limited
 * the attempt fails with a summary. A 5xx never rotates, rotation spends no retries, and a field
 * with a single key behaves as before.
 *
 * Drives the real `requestChatData` and the real OpenAI, Anthropic (including Bedrock signing),
 * Google and Ollama request paths. Mocked: the resolver (`resolveSecret`), the transports
 * (`globalFetch`, `fetchNative`, global `fetch`; they answer by the key a request carries), the
 * platform and Tauri/IO packages, and the collaborators the request path touches but these tests do
 * not exercise. Keys are synthetic. Nothing here says anything about a native backend.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must
 * be preserved.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'
import { resetKeyRings } from './keyRing'

//#region module mocks

type Scripted = { status: number, body: unknown }
type Recorded = { via: string, url: string, headers: Record<string, string>, body: string }

const h = vi.hoisted(() => ({
    calls: [] as Array<{ via: string, url: string, headers: Record<string, string>, body: string }>,
    /** Answers one request of the scripted transports. */
    script: null as unknown as (call: { via: string, url: string, headers: Record<string, string>, body: string }) => { status: number, body: unknown },
    refs: {} as Record<string, string>,
    onCall: null as null | (() => void),
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: {} },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: writable(null),
}))

vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))

function record(via: string, url: string, headers: unknown, body: unknown): Recorded {
    const normalized: Record<string, string> = {}
    if (headers instanceof Headers) {
        headers.forEach((value, key) => { normalized[key.toLowerCase()] = value })
    }
    else if (Array.isArray(headers)) {
        for (const [key, value] of headers) { normalized[String(key).toLowerCase()] = String(value) }
    }
    else if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) { normalized[key.toLowerCase()] = String(value) }
    }
    let text = ''
    if (typeof body === 'string') { text = body }
    else if (body instanceof Uint8Array || body instanceof ArrayBuffer) { text = new TextDecoder().decode(body) }
    else if (body !== undefined && body !== null) { text = JSON.stringify(body) }
    const call = { via, url: String(url), headers: normalized, body: text }
    h.calls.push(call)
    h.onCall?.()
    return call
}

function asResponse(scripted: Scripted): Response {
    return new Response(JSON.stringify(scripted.body), { status: scripted.status, headers: { 'Content-Type': 'application/json' } })
}

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string, init?: { headers?: unknown, body?: unknown }) => {
        return asResponse(h.script(record('fetchNative', url, init?.headers, init?.body)))
    }),
    globalFetch: vi.fn(async (url: string, opts?: { headers?: unknown, body?: unknown }) => {
        const scripted = h.script(record('globalFetch', url, opts?.headers, opts?.body))
        return { ok: scripted.status >= 200 && scripted.status < 300, status: scripted.status, data: scripted.body }
    }),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async (stream: ReadableStream<Uint8Array>) => await new Response(stream).text()),
    readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))

vi.mock('../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))

vi.mock('../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }))
vi.mock('../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../files/inlays', () => ({
    getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'x'), supportsInlayImage: vi.fn(() => false),
    saveInlayedSignature: vi.fn(), setInlayAsset: vi.fn(),
}))
vi.mock('../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../tts', () => ({ sayTTS: vi.fn() }))

vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
        replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: vi.fn(),
}))

vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn(), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: object }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

// A reference resolves to the value the test names for it; the reference syntax and the error type stay real.
vi.mock('../../secretRef', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../secretRef')>()
    return {
        ...actual,
        resolveSecret: vi.fn(async (value: string) => {
            const name = actual.secretRefName(value)
            if (name === null) {
                return value
            }
            const resolved = h.refs[name]
            if (resolved === undefined) {
                throw new actual.SecretRefError(name, 'unavailable')
            }
            return resolved
        }),
    }
})

//#endregion

type Result = { type: string, result: unknown, noRetry?: boolean }
let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }

const A = 'sk-test-A'
const B = 'sk-test-B'
const C = 'sk-test-C'
const LIMIT: Scripted = { status: 429, body: { error: { message: 'rate limited' } } }
const OPENAI_OK: Scripted = { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'hello' } }] } }
const CLAUDE_OK: Scripted = { status: 200, body: { content: [{ type: 'text', text: 'hello' }] } }
const GEMINI_OK: Scripted = { status: 200, body: { candidates: [{ content: { parts: [{ text: 'hello' }] } }] } }
const GEMINI_LIMIT: Scripted = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } } }

beforeAll(async () => {
    requestChatData = (await import('../request/request')).requestChatData as never
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }
}, 60_000)

function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: '',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        google: { accessToken: '', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
        claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', nanogptKey: '', openrouterKey: '', proxyKey: '',
        OaiCompAPIKeys: {}, ollamaCloudModel: 'cloud-m', ollamaModel: 'local-m', ollamaURL: 'http://ollama.test', ollamaThinkingMode: 'default',
        modelTools: [], customAPIFormat: 0,
        ...extra,
    } as unknown as Database
}

const messages = () => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

function ask(extra: Record<string, unknown> = {}, signal: AbortSignal | null = null) {
    return requestChatData({ formated: messages(), bias: {}, useStreaming: false, noMultiGen: true, tools: [], ...extra }, 'model', signal)
        .catch(() => ({ type: 'threw', result: '' }) as Result)
}

type Call = typeof h.calls[number]
/** The key a request carries, wherever its provider puts it. */
function keyOf(call: Call): string {
    const auth = call.headers['authorization']
    if (auth?.startsWith('Bearer ')) { return auth.slice('Bearer '.length) }
    if (call.headers['x-api-key']) { return call.headers['x-api-key'] }
    const fromUrl = decodeURIComponent(call.url).match(/key=([^&]*)/)
    return fromUrl ? fromUrl[1] : ''
}
const keys = () => h.calls.map(keyOf)

/** A transport that answers by key: a key with no entry gets `otherwise`. */
function answerByKey(table: Record<string, Scripted | Scripted[]>, otherwise: Scripted = OPENAI_OK) {
    const seen = new Map<string, number>()
    h.script = (call) => {
        const key = keyOf(call)
        const entry = table[key]
        if (entry === undefined) { return otherwise }
        if (!Array.isArray(entry)) { return entry }
        const n = seen.get(key) ?? 0
        seen.set(key, n + 1)
        return entry[Math.min(n, entry.length - 1)]
    }
}

let realFetch: typeof globalThis.fetch

beforeEach(() => {
    h.calls.length = 0
    h.refs = {}
    h.onCall = null
    h.script = () => OPENAI_OK
    resetKeyRings()
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: string, init?: { headers?: unknown, body?: unknown }) => {
        record('fetch', url, init?.headers, init?.body)
        return { json: async () => ({ data: [] }), status: 200, ok: true, text: async () => '' }
    }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
    globalThis.fetch = realFetch
})

describe('a key limit rotates to the next line of the field', () => {
    test('P1: A is limited, the reply comes via B, in two calls', async () => {
        installDb({ openAIKey: `${A}\n${B}` })
        answerByKey({ [A]: LIMIT })

        const out = await ask()

        expect(keys()).toEqual([A, B])
        expect(out).toMatchObject({ type: 'success', result: 'hello' })
    })

    test('P1: a CRLF list and a lone CR list rotate the same way', async () => {
        for (const separator of ['\r\n', '\r']) {
            h.calls.length = 0
            resetKeyRings()
            installDb({ openAIKey: `${A}${separator}${B}` })
            answerByKey({ [A]: LIMIT })

            const out = await ask()

            expect(keys()).toEqual([A, B])
            expect(out.type).toBe('success')
        }
    })

    test('P2: a Claude pre-stream limit rotates', async () => {
        installDb({ aiModel: 'claude-3-5-sonnet-latest', claudeAPIKey: `${A}\n${B}`, useStreaming: true })
        h.script = (call) => keyOf(call) === A ? { status: 429, body: { type: 'error' } } : { status: 200, body: {} }

        await ask({ useStreaming: true })

        expect(keys().slice(0, 2)).toEqual([A, B])
    })

    test('P2: a Claude non-stream limit rotates', async () => {
        installDb({ aiModel: 'claude-3-5-sonnet-latest', claudeAPIKey: `${A}\n${B}` })
        answerByKey({ [A]: { status: 429, body: { type: 'error' } } }, CLAUDE_OK)

        const out = await ask()

        expect(keys()).toEqual([A, B])
        expect(out).toMatchObject({ type: 'success', result: 'hello' })
    })

    test('P3: a Gemini 429 rotates and does not resend the same key', async () => {
        installDb({ aiModel: 'gemini-2.5-flash', google: { accessToken: `${A}\n${B}`, projectId: 'proj' }, requestRetrys: 0 })
        answerByKey({ [A]: GEMINI_LIMIT }, GEMINI_OK)

        const out = await ask()

        expect(keys()).toEqual([A, B])
        expect(out.type).toBe('success')
    })

    test('P4: every key limited, each is tried once and the reply is the summary then the last error', async () => {
        installDb({ openAIKey: `${A}\n${B}\n${C}`, requestRetrys: 2 })
        h.script = () => LIMIT

        const out = await ask()

        expect(keys()).toEqual([A, B, C])
        expect(out.type).toBe('fail')
        expect(String(out.result)).toContain('All 3 keys hit a rate or quota limit.\n')
        expect(String(out.result)).toContain('rate limited')
    })

    test('P5: the next request starts on the key that worked', async () => {
        installDb({ openAIKey: `${A}\n${B}` })
        answerByKey({ [A]: LIMIT })
        await ask()
        h.calls.length = 0

        await ask()

        expect(keys()).toEqual([B])
    })

    test('P16: a NovelList limit rotates to the next line', async () => {
        installDb({ aiModel: 'novellist', novellistAPI: `${A}\n${B}`, ainconfig: {} })
        answerByKey({ [A]: { status: 429, body: { error: 'busy' } } }, { status: 200, body: { data: ['hello'] } })

        await ask()

        expect(keys()).toEqual([A, B])
    })

    test('P5: a 402 rotates like a 429', async () => {
        installDb({ openAIKey: `${A}\n${B}` })
        answerByKey({ [A]: { status: 402, body: { error: { message: 'payment required' } } } })

        const out = await ask()

        expect(keys()).toEqual([A, B])
        expect(out.type).toBe('success')
    })
})

describe('what does not rotate', () => {
    test('P6: a 529 overload resends the same key under the retry budget', async () => {
        installDb({ aiModel: 'claude-3-5-sonnet-latest', claudeAPIKey: `${A}\n${B}`, requestRetrys: 1 })
        h.script = () => ({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } })

        await ask()

        expect(keys()).toEqual([A, A])
    })

    test('P7: rotation spends no retry: a 429 then a 500 then success under one retry', async () => {
        installDb({ openAIKey: `${A}\n${B}`, requestRetrys: 1 })
        answerByKey({ [A]: LIMIT, [B]: [{ status: 500, body: { error: 'internal' } }, OPENAI_OK] })

        const out = await ask()

        expect(keys()).toEqual([A, B, B])
        expect(out.type).toBe('success')
    })

    test('guard: P17: a Kobold custom model sends no key, so a 429 is one call and no key summary', async () => {
        installDb({
            aiModel: 'xcustom:::kobold',
            koboldURL: 'http://kobold.test/',
            customModels: [{ id: 'xcustom:::kobold', name: 'kobold', internalId: 'k', url: 'http://kobold.test/', format: 14, flags: [], tokenizer: 0, key: `${A}\n${B}\n${C}` }],
        })
        h.script = () => ({ status: 429, body: { error: 'busy' } })

        const out = await ask()

        expect(h.calls).toHaveLength(1)
        expect(String(out.result)).not.toContain('keys hit a rate or quota limit')
    })

    test('guard: P12: a single key is resent under the retry budget and never summarised', async () => {
        installDb({ openAIKey: A, requestRetrys: 1 })
        h.script = () => LIMIT

        const out = await ask()

        expect(keys()).toEqual([A, A])
        expect(String(out.result)).not.toContain('keys hit a rate or quota limit')
    })

    test('guard: P12: a single Gemini key that is out of quota is resent by the Gemini fallback', async () => {
        installDb({ aiModel: 'gemini-2.5-flash', google: { accessToken: A, projectId: 'proj' }, antiServerOverloads: true, requestRetrys: 0 })
        let sends = 0
        h.script = () => (++sends > 2 ? GEMINI_OK : GEMINI_LIMIT)

        await ask()

        expect(keys().length).toBeGreaterThan(1)
        expect(new Set(keys())).toEqual(new Set([A]))
    })

    test('guard: P12: a single Ollama cloud key that is limited throws as before', async () => {
        installDb({ aiModel: 'ollama-cloud', ollamaApiKey: A, ollamaRequestFormat: 3 })
        h.script = () => ({ status: 429, body: { error: 'rate limited' } })

        const out = await ask()

        expect(out.type).toBe('threw')
        expect(keys()).toEqual([A])
    })
})

/** A custom model row shaped like the settings page stores it. */
function customRow(id: string, format: number, key: string, url = 'http://custom.test/v1/chat/completions') {
    return { id, name: id, internalId: 'm', url, format, flags: [], tokenizer: 0, key }
}

const NL_OK: Scripted = { status: 200, body: { data: ['hello'] } }
const MANCER_OK: Scripted = { status: 200, body: { results: [{ text: 'hello' }] } }
const BUSY: Scripted = { status: 429, body: { error: 'busy' } }
const ooba = { textgenWebUIStreamURL: 'http://ooba.test/api', textgenWebUIBlockingURL: 'http://ooba.test/api', ooba: { formating: { userPrefix: 'user:', seperator: '\n' } } }

describe('a limit judges only the field the request sent', () => {
    test('P18: a NovelList custom model sends novellistAPI, so a leased custom key does not rotate', async () => {
        installDb({
            aiModel: 'xcustom:::nl', ainconfig: {}, novellistAPI: 'nl-key',
            customModels: [customRow('xcustom:::nl', 7, `${A}\n${B}\n${C}`)],
        })
        h.script = () => BUSY

        const out = await ask()

        expect(h.calls).toHaveLength(1)
        expect(String(out.result)).not.toContain('keys hit a rate')
    })

    test('P19: a Mancer custom model sends mancerHeader, so a leased custom key does not rotate', async () => {
        installDb({
            ...ooba, aiModel: 'xcustom:::mc', mancerHeader: 'mc-key',
            customModels: [customRow('xcustom:::mc', 11, `${A}\n${B}\n${C}`)],
        })
        h.script = () => BUSY

        const out = await ask()

        expect(h.calls).toHaveLength(1)
        expect(String(out.result)).not.toContain('keys hit a rate')
    })

    test('P20: the summary counts the lines of the field that was sent', async () => {
        installDb({
            aiModel: 'xcustom:::nl', ainconfig: {}, novellistAPI: 'nl-1\nnl-2',
            customModels: [customRow('xcustom:::nl', 7, `${A}\n${B}\n${C}`)],
        })
        h.script = () => BUSY

        const out = await ask()

        expect(keys()).toEqual(['nl-1', 'nl-2'])
        expect(String(out.result)).toMatch(/^All 2 keys hit a rate or quota limit\./)
    })

    test('P21: the summary shows a structured provider body as JSON, never as an object', async () => {
        installDb({ aiModel: 'novellist', novellistAPI: `${A}\n${B}`, ainconfig: {} })
        h.script = () => ({ status: 429, body: { error: 'quota exceeded for this key' } })

        const out = await ask()

        expect(String(out.result)).toContain('quota exceeded for this key')
        expect(String(out.result)).not.toContain('[object Object]')
    })

    test('P26: a fallback model leases its own field after a main model whose custom key was not sent', async () => {
        installDb({
            aiModel: 'xcustom:::mc', ...ooba, mancerHeader: 'mc-key', openAIKey: 'oa-1\noa-2',
            customModels: [customRow('xcustom:::mc', 11, `${A}\n${B}\n${C}`)],
            fallbackModels: { model: ['gpt4o'] },
        })
        answerByKey({ 'mc-key': BUSY, 'oa-1': LIMIT }, OPENAI_OK)

        const out = await ask()

        expect(keys()).toEqual(['mc-key', 'oa-1', 'oa-2'])
        expect(out).toMatchObject({ type: 'success', result: 'hello' })
    })

    test('P27: a local Ollama custom model sends no key, so a leased custom key does not rotate', async () => {
        installDb({
            aiModel: 'xcustom:::ol',
            customModels: [customRow('xcustom:::ol', 15, `${A}\n${B}\n${C}`, 'http://ollama.test')],
        })
        h.script = () => ({ status: 429, body: { error: 'rate limited' } })
        // A local Ollama server is reached through the global fetch, which answers by the same script.
        globalThis.fetch = vi.fn(async (url: string, init?: { headers?: unknown, body?: unknown }) => {
            return asResponse(h.script(record('fetch', url, init?.headers, init?.body)))
        }) as unknown as typeof globalThis.fetch

        const out = await ask()

        expect(h.calls).toHaveLength(1)
        expect(out.type).toBe('threw')
    })

    test('guard: P22: a limited field summarises as the count line then the provider body as the base shows it', async () => {
        installDb({ openAIKey: `${A}\n${B}` })
        h.script = () => LIMIT

        const out = await ask()

        expect(String(out.result)).toMatch(/^All 2 keys hit a rate or quota limit\.\n[^"]/)
    })

    test('guard: P23: a single custom key with a multi-line mancerHeader rotates the header', async () => {
        installDb({
            ...ooba, aiModel: 'xcustom:::mc',
            mancerHeader: 'mc-1\nmc-2',
            customModels: [customRow('xcustom:::mc', 11, 'custom-single')],
        })
        answerByKey({ 'mc-1': BUSY }, MANCER_OK)

        await ask()

        expect(keys()).toEqual(['mc-1', 'mc-2'])
    })

    test('guard: P24: a custom OpenAI-compatible model rotates its own key lines', async () => {
        installDb({
            aiModel: 'xcustom:::oa',
            customModels: [customRow('xcustom:::oa', 0, `${A}\n${B}`)],
        })
        answerByKey({ [A]: LIMIT })

        const out = await ask()

        expect(keys()).toEqual([A, B])
        expect(out.type).toBe('success')
    })

    test('guard: P25: the reverse proxy rotates its proxy key lines', async () => {
        installDb({
            aiModel: 'reverse_proxy', customAPIFormat: 0, forceReplaceUrl: 'http://proxy.test/v1/chat/completions',
            customProxyRequestModel: 'm', proxyKey: `${A}\n${B}`,
        })
        answerByKey({ [A]: LIMIT })

        const out = await ask()

        expect(keys()).toEqual([A, B])
        expect(out.type).toBe('success')
    })
})

describe('credentials are taken per line', () => {
    test('P8: a Bedrock triple is taken per line and the second request is signed with the second triple', async () => {
        installDb({
            aiModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
            claudeAPIKey: 'AKIDONE:SECRETONE:us-east-1\nAKIDTWO:SECRETTWO:eu-west-1',
        })
        h.script = (call) => (call.headers['authorization'] ?? '').includes('Credential=AKIDONE/') ? { status: 429, body: { message: 'Too many requests' } } : CLAUDE_OK

        const out = await ask()

        expect(h.calls).toHaveLength(2)
        expect(h.calls[0].url).toContain('bedrock-runtime.us-east-1.amazonaws.com')
        expect(h.calls[1].url).toContain('bedrock-runtime.eu-west-1.amazonaws.com')
        expect(h.calls[1].headers['authorization']).toContain('Credential=AKIDTWO/')
        expect(out.type).toBe('success')
    })

    test('P9: each line resolves on its own and the reference never leaves', async () => {
        installDb({ openAIKey: '${RISU_A_KEY}\n${RISU_B_KEY}' })
        h.refs = { RISU_A_KEY: 'resolved-value-A', RISU_B_KEY: 'resolved-value-B' }
        answerByKey({ 'resolved-value-A': LIMIT })

        const out = await ask()

        expect(keys()).toEqual(['resolved-value-A', 'resolved-value-B'])
        for (const call of h.calls) {
            expect(`${call.url}\n${JSON.stringify(call.headers)}\n${call.body}`).not.toContain('${')
        }
        expect(out.type).toBe('success')
        expect(JSON.stringify(DBState.db)).not.toContain('resolved-value')
    })

    test('P9: an unset reference on the leased line ends the attempt without a retry', async () => {
        installDb({ openAIKey: '${RISU_UNSET_KEY}\nsk-test-B', requestRetrys: 2 })

        const out = await ask()

        expect(out).toMatchObject({ type: 'fail', noRetry: true })
        expect(h.calls).toHaveLength(0)
    })

    test('P10: the preview shows the current line as typed and no other line', async () => {
        installDb({ openAIKey: `${A}\n${B}` })

        const out = await ask({ previewBody: true })

        expect(out.type).toBe('success')
        expect(String(out.result)).toContain(A)
        expect(String(out.result)).not.toContain(B)
        expect(h.calls).toHaveLength(0)
    })

    test('P10: a preview of a referenced current line keeps the reference', async () => {
        installDb({ openAIKey: '${RISU_A_KEY}\nsk-test-B' })
        h.refs = { RISU_A_KEY: 'resolved-value-A' }

        const out = await ask({ previewBody: true })

        expect(String(out.result)).toContain('${RISU_A_KEY}')
        expect(String(out.result)).not.toContain('resolved-value-A')
    })

    test('P14: a reader that never rotates uses the current line, not the whole value', async () => {
        installDb({ openAIKey: `${A}\n${B}`, openrouterKey: `${A}\n${B}` })
        answerByKey({ [A]: LIMIT })
        await ask()
        h.calls.length = 0

        const { getOpenRouterModels } = await import('../../model/openrouter')
        await getOpenRouterModels()

        expect(keys()).toEqual([A])
    })
})

describe('abort', () => {
    test('guard: P11: an abort during the first call returns the silent result after one call', async () => {
        installDb({ openAIKey: `${A}\n${B}` })
        const controller = new AbortController()
        h.onCall = () => controller.abort()
        h.script = () => LIMIT

        const out = await ask({}, controller.signal)

        expect(out).toMatchObject({ type: 'fail', result: 'Aborted' })
        expect(h.calls).toHaveLength(1)
    })

    test('P11b: an abort during the call that exhausts the keys is silent, never the summary', async () => {
        installDb({ openAIKey: `${A}\n${B}` })
        const controller = new AbortController()
        h.onCall = () => { if (h.calls.length === 2) { controller.abort() } }
        h.script = () => LIMIT

        const out = await ask({}, controller.signal)

        expect(h.calls).toHaveLength(2)
        expect(out).toEqual({ type: 'fail', result: 'Aborted' })
    })
})

describe('fallback models get their own pass', () => {
    test('P13a: a same-field fallback model starts a fresh pass from the cursor', async () => {
        installDb({ openAIKey: `${A}\n${B}`, fallbackModels: { model: ['gpt4o'] } })
        h.script = () => LIMIT

        const out = await ask()

        expect(keys()).toEqual([A, B, B, A])
        expect(String(out.result)).toContain('All 2 keys hit a rate or quota limit.')
    })

    test('P13b: a fallback model on another provider is reached after the first model is exhausted', async () => {
        installDb({ openAIKey: `${A}\n${B}`, claudeAPIKey: C, fallbackModels: { model: ['claude-3-5-sonnet-latest'] } })
        h.script = (call) => call.headers['x-api-key'] === C ? CLAUDE_OK : LIMIT

        const out = await ask()

        expect(keys()).toEqual([A, B, C])
        expect(out).toMatchObject({ type: 'success', result: 'hello' })
    })
})

describe('Ollama cloud', () => {
    test('P15: a 429 from the native client rotates to the next key', async () => {
        installDb({ aiModel: 'ollama-cloud', ollamaApiKey: `${A}\n${B}`, ollamaRequestFormat: 3 })
        const ollamaOk: Scripted = { status: 200, body: { model: 'cloud-m', created_at: '2026-01-01T00:00:00Z', message: { role: 'assistant', content: 'hello' }, done: true } }
        answerByKey({ [A]: { status: 429, body: { error: 'rate limited' } } }, ollamaOk)

        const out = await ask()

        expect(keys()).toEqual([A, B])
        expect(out.type).toBe('success')
    })
})

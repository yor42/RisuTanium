/**
 * A chat-provider credential that is a whole `${NAME}` reference is resolved when the request is
 * built: the resolved value lands where the provider expects its credential, the literal reference
 * is never sent, and nothing resolved or derived is written to the database. A reference that
 * cannot be resolved ends that model's attempt with a noRetry failure and no network call. A value
 * that is not a reference is sent exactly as typed. A request preview is built from the reference,
 * never from the resolved value.
 *
 * Drives the real `requestChatData` / `requestChatDataMain` and the real OpenAI, Anthropic
 * (including Bedrock signing), Google (including Vertex), NovelAI, NovelList, Cohere, Ollama, Horde
 * and Mancer request paths. Mocked: the resolver (`resolveSecret`), the transports
 * (`globalFetch`, `fetchNative`, global `fetch`), the platform and Tauri/IO packages, and the
 * collaborators the request path touches but these tests do not exercise (the database and store
 * modules, tokenizer, characters, commands, inlays, media, TTS, plugins, MCP, alerts and
 * `sleep`). Nothing here says anything about a native backend or the real environment lookup.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that
 * must be preserved. The preview tests also hold for providers that never resolved a credential;
 * they fail without the change only for the Bedrock and Vertex previews.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { absorbLegacyForTest } from '../../connections/tests/legacyFixture'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'
import { redactResolved, resetSecretRefState } from '../../secretRef'
import { language } from '../../../lang'
import { fillLang } from '../../../lang/fill'

//#region module mocks

const h = vi.hoisted(() => ({
    calls: [] as Array<{ via: string, url: string, headers: Record<string, string>, body: string }>,
    resolved: 'SENTINEL-resolved-value',
    resolveCalls: [] as string[],
    setDatabase: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    /** The token endpoint's answer; `gate` holds every answer until it settles. */
    oauth: { answer: null as null | (() => unknown), gate: null as null | Promise<void> },
    /** Holds the private key read of the Vertex slot after the stored value has been read; `reached` counts the held reads. */
    keyRead: { gate: null as null | Promise<void>, reached: 0 },
}))

// The read of the stored key is passed through unchanged; only a held Vertex read is delayed after the
// value is in hand, which is where the Android vault unwrap awaits.
vi.mock('./secretKey', async (importOriginal) => {
    const original = await importOriginal<typeof import('./secretKey')>()
    return {
        ...original,
        readKeyField: async (...args: Parameters<typeof original.readKeyField>) => {
            const value = await original.readKeyField(...args)
            if (args[1] === 'vertexPrivateKey' && h.keyRead.gate) {
                h.keyRead.reached++
                await h.keyRead.gate
            }
            return value
        },
    }
})

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

/** Answers a token request after the gate, if any, with the configured answer or a minted token. */
async function serveOauth(): Promise<unknown> {
    if (h.oauth.gate) {
        await h.oauth.gate
    }
    if (h.oauth.answer) {
        return h.oauth.answer()
    }
    return { ok: true, status: 200, json: async () => ({ access_token: 'MINTED-access-token' }) }
}

function record(via: string, url: string, headers: unknown, body: unknown) {
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
    h.calls.push({ via, url: String(url), headers: normalized, body: text })
}

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string, init?: { headers?: unknown, body?: unknown }) => {
        record('fetchNative', url, init?.headers, init?.body)
        if (String(url).includes('oauth2.googleapis.com')) {
            return await serveOauth() as Response
        }
        return new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 500 })
    }),
    globalFetch: vi.fn(async (url: string, opts?: { headers?: unknown, body?: unknown }) => {
        record('globalFetch', url, opts?.headers, opts?.body)
        return { ok: false, data: {} }
    }),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
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
    h.setDatabase = vi.fn()
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: h.setDatabase,
        getDatabase: vi.fn(() => absorbLegacyForTest(state.db)), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

// The resolver is the only part of the secret module replaced: the reference syntax and the error
// type stay real, so the failure path is the one the application takes.
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
            if (name.startsWith('RISU_PEM')) {
                return pem
            }
            return h.resolved
        }),
    }
})

//#endregion

let pem = ''
let publicKey: CryptoKey

type Result = { type: string, result: unknown, noRetry?: boolean }
let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }

const REF = '${RISU_TEST_KEY}'
const UNSET = '${RISU_UNSET_KEY}'
const PLAIN = 'plain-key-0123456789'

beforeAll(async () => {
    requestChatData = (await import('../request/request')).requestChatData as never
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }

    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    publicKey = pair.publicKey
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    let binary = ''
    for (const byte of der) { binary += String.fromCharCode(byte) }
    pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`
})

function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 2, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: '',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        NAIsettings: { seperator: '\n', starter: '', topK: 1, topP: 1, topA: 1, tailFreeSampling: 1, repetitionPenalty: 1, repetitionPenaltyRange: 1, repetitionPenaltySlope: 1, frequencyPenalty: 0, presencePenalty: 0, typicalp: 1 },
        NAIappendName: true, NAIadventure: false, novelai: { token: '' }, novellistAPI: '',
        ainconfig: { top_p: 1, top_k: 1, rep_pen: 1, top_a: 1, rep_pen_slope: 1, rep_pen_range: 1, typical_p: 1, badwords: '', stoptokens: '' },
        ooba: { formating: { userPrefix: 'U:', seperator: '\n' }, top_k: 1, top_p: 1, repetition_penalty: 1, typical_p: 1 },
        textgenWebUIStreamURL: 'ws://ooba.test/api/v1/stream', textgenWebUIBlockingURL: 'http://ooba.test/api/v1/generate', reverseProxyOobaArgs: {}, mancerHeader: '',
        hordeConfig: { apiKey: '' }, top_k: 1, top_p: 1,
        google: { accessToken: '', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
        vertexClientEmail: 'sa@proj.iam.gserviceaccount.com', vertexPrivateKey: '',
        claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', nanogptKey: '', openrouterKey: '', proxyKey: '',
        OaiCompAPIKeys: {}, ollamaCloudModel: 'cloud-m', ollamaModel: 'local-m', ollamaURL: 'http://ollama.test', ollamaThinkingMode: 'default',
        openrouterRequestModel: 'x/y', proxyRequestModel: 'x', nanogptRequestModel: 'n/m', customProxyRequestModel: 'proxy-m',
        modelTools: [], customAPIFormat: 0, forceReplaceUrl: 'http://proxy.test/v1/chat/completions', autofillRequestUrl: false,
        ...extra,
    } as unknown as Database
}

const messages = () => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

/** A request that threw instead of returning a result reports `type: 'threw'`. */
function ask(extra: Record<string, unknown> = {}) {
    return requestChatData({ formated: messages(), bias: {}, useStreaming: false, noMultiGen: true, tools: [], ...extra }, 'model', null)
        .catch(() => ({ type: 'threw', result: '' }) as Result)
}

let realFetch: typeof globalThis.fetch

beforeEach(() => {
    h.calls.length = 0
    h.resolveCalls.length = 0
    h.resolved = 'SENTINEL-resolved-value'
    h.setDatabase.mockClear()
    h.oauth.answer = null
    h.oauth.gate = null
    h.keyRead.gate = null
    h.keyRead.reached = 0
    realFetch = globalThis.fetch
    // Plain assignment: the setup file's global stubs must stay in place.
    globalThis.fetch = vi.fn(async (url: string, init?: { headers?: unknown, body?: unknown }) => {
        record('fetch', url, init?.headers, init?.body)
        if (String(url).includes('oauth2.googleapis.com')) {
            return await serveOauth()
        }
        if (String(url).endsWith('/generate/text/async')) {
            return { status: 202, json: async () => ({ id: 'job', kudos: 0 }), text: async () => '' }
        }
        return { json: async () => ({ is_possible: false }), status: 200, ok: true, text: async () => '' }
    }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
    globalThis.fetch = realFetch
})

//#endregion

//#region the credential fields of the chat providers

type Call = typeof h.calls[number]

type Row = {
    field: string
    model: string
    /** The database fields that hold the credential `key`. */
    db: (key: string) => Record<string, unknown>
    /** True when `key` sits where this provider expects its credential. */
    lands: (call: Call, key: string) => boolean
    /** The resolved value to hand out when it must have a particular shape. */
    resolved?: string
    /** False where the preview of this provider shows no request at all. */
    previewShowsRequest?: boolean
}

const bearer = (call: Call, key: string) => call.headers['authorization'] === `Bearer ${key}`
const urlHasKey = (call: Call, key: string) => decodeURIComponent(call.url).includes(`key=${key}`)
const customModel = (format: number, key: string, extra: Record<string, unknown> = {}) => ({
    customModels: [{ id: 'xcustom:::c1', name: 'c1', url: 'http://custom.test/v1/chat/completions', key, internalId: 'c-model', format, flags: [], tokenizer: 0, params: '', ...extra }],
})

const ROWS: Row[] = [
    { field: 'openAIKey', model: 'gpt4o', db: (k) => ({ openAIKey: k }), lands: bearer },
    { field: 'openAIKey (responses API)', model: 'gpt4o-response-api', db: (k) => ({ openAIKey: k }), lands: bearer },
    { field: 'openAIKey (legacy instruct)', model: 'instructgpt35', db: (k) => ({ openAIKey: k }), lands: bearer, previewShowsRequest: false },
    { field: 'proxyKey', model: 'reverse_proxy', db: (k) => ({ proxyKey: k }), lands: bearer },
    { field: 'proxyKey (responses format)', model: 'reverse_proxy', db: (k) => ({ proxyKey: k, customAPIFormat: 18, forceReplaceUrl: 'http://proxy.test/v1/responses' }), lands: bearer },
    { field: 'proxyKey (anthropic format)', model: 'reverse_proxy', db: (k) => ({ proxyKey: k, customAPIFormat: 2, forceReplaceUrl: 'http://proxy.test/v1/messages' }), lands: (c, k) => c.headers['x-api-key'] === k },
    { field: 'OaiCompAPIKeys[*]', model: 'deepseek-chat', db: (k) => ({ OaiCompAPIKeys: { deepseek: k } }), lands: bearer },
    { field: 'nanogptKey', model: 'nanogpt', db: (k) => ({ nanogptKey: k }), lands: bearer },
    { field: 'openrouterKey', model: 'openrouter', db: (k) => ({ openrouterKey: k }), lands: bearer },
    { field: 'mistralKey', model: 'mistral-small-latest', db: (k) => ({ mistralKey: k }), lands: bearer },
    { field: 'customModels[].key (openai-compatible)', model: 'xcustom:::c1', db: (k) => customModel(0, k), lands: bearer },
    { field: 'customModels[].key (anthropic)', model: 'xcustom:::c1', db: (k) => customModel(2, k), lands: (c, k) => c.headers['x-api-key'] === k },
    { field: 'customModels[].key (google)', model: 'xcustom:::c1', db: (k) => customModel(5, k), lands: urlHasKey },
    { field: 'claudeAPIKey', model: 'claude-3-5-sonnet-latest', db: (k) => ({ claudeAPIKey: k }), lands: (c, k) => c.headers['x-api-key'] === k },
    {
        field: 'claudeAPIKey (Bedrock triple)', model: 'anthropic.claude-sonnet-4-5-20250929-v1:0', db: (k) => ({ claudeAPIKey: k }),
        resolved: 'AKIDSENTINEL:SECRETSENTINEL:us-east-1',
        lands: (c, k) => (c.headers['authorization'] ?? '').includes(`Credential=${k.split(':')[0]}/`) && c.url.includes(`bedrock-runtime.${k.split(':')[2]}.amazonaws.com`),
    },
    { field: 'google.accessToken', model: 'gemini-2.5-flash', db: (k) => ({ google: { accessToken: k, projectId: 'proj' } }), lands: urlHasKey },
    { field: 'novelai.token', model: 'novelai_kayra', db: (k) => ({ novelai: { token: k } }), lands: bearer, previewShowsRequest: false },
    { field: 'novellistAPI', model: 'novellist', db: (k) => ({ novellistAPI: k }), lands: bearer },
    { field: 'cohereAPIKey', model: 'cohere-command-r', db: (k) => ({ cohereAPIKey: k }), lands: bearer },
    { field: 'ollamaApiKey (openai format)', model: 'ollama-cloud', db: (k) => ({ ollamaApiKey: k, ollamaRequestFormat: 0 }), lands: bearer },
    { field: 'ollamaApiKey (responses format)', model: 'ollama-cloud', db: (k) => ({ ollamaApiKey: k, ollamaRequestFormat: 18 }), lands: bearer },
    { field: 'ollamaApiKey (anthropic format)', model: 'ollama-cloud', db: (k) => ({ ollamaApiKey: k, ollamaRequestFormat: 2 }), lands: (c, k) => c.headers['authorization'] === `Bearer ${k}` },
    { field: 'ollamaApiKey (native format)', model: 'ollama-cloud', db: (k) => ({ ollamaApiKey: k, ollamaRequestFormat: 3 }), lands: bearer },
    { field: 'hordeConfig.apiKey', model: 'horde:::auto', db: (k) => ({ hordeConfig: { apiKey: k } }), lands: (c, k) => c.headers['apikey'] === k, previewShowsRequest: false },
    { field: 'mancerHeader', model: 'mancer', db: (k) => ({ mancerHeader: k }), lands: (c, k) => c.headers['x-api-key'] === k },
]

/** The whole outgoing request as one searchable string. */
const wire = (call: Call) => `${call.url}\n${JSON.stringify(call.headers)}\n${call.body}`
const calledNetwork = () => h.calls.length > 0

describe('a referenced credential is resolved into the request', () => {
    for (const row of ROWS) {
        test(`${row.field}: the resolved value lands in the request and the reference never leaves`, async () => {
            h.resolved = row.resolved ?? h.resolved
            installDb({ aiModel: row.model, ...row.db(REF) })

            await ask()

            for (const call of h.calls) {
                expect(wire(call)).not.toContain('${')
            }
            const sent = h.calls.filter((call) => !call.url.includes('oauth2'))
            expect(sent.length).toBeGreaterThan(0)
            expect(sent.some((call) => row.lands(call, h.resolved))).toBe(true)
            expect(JSON.stringify(DBState.db)).not.toContain(h.resolved)
        })

        test(`${row.field}: an unset reference fails without a network call and without a retry`, async () => {
            installDb({ aiModel: row.model, ...row.db(UNSET) })

            const out = await ask()

            expect(out.type).toBe('fail')
            expect(out.noRetry).toBe(true)
            expect(String(out.result)).toContain('RISU_UNSET_KEY')
            expect(calledNetwork()).toBe(false)
            expect(h.resolveCalls.filter((name) => name === 'RISU_UNSET_KEY')).toHaveLength(1)
        })

        test(`guard: ${row.field}: a plain value is sent exactly as typed`, async () => {
            const plain = row.resolved ? 'plain-akid:plain-secret:eu-west-1' : PLAIN
            installDb({ aiModel: row.model, ...row.db(plain) })

            await ask()

            expect(h.calls.some((call) => row.lands(call, plain))).toBe(true)
            expect(h.resolveCalls).toEqual([])
        })

        test(`${row.field}: the preview is built from the reference, not the resolved value`, async () => {
            h.resolved = row.resolved ?? h.resolved
            installDb({ aiModel: row.model, ...row.db(REF) })

            const out = await ask({ previewBody: true })

            expect(String(out.result)).not.toContain(h.resolved)
            expect(String(out.result)).not.toContain(h.resolved.split(':')[0] + '/')
            expect(h.resolveCalls).toEqual([])
            expect(calledNetwork()).toBe(false)
            if (row.previewShowsRequest !== false) {
                expect(out.type).toBe('success')
            }
        })
    }
})

//#endregion

//#region fallback and Vertex

describe('a resolution failure ends only that model', () => {
    test('the failing model is attempted once and the next fallback model answers with its own key', async () => {
        installDb({ aiModel: 'gpt4o', openAIKey: UNSET, claudeAPIKey: PLAIN, fallbackModels: { model: ['claude-3-5-sonnet-latest'] } })

        await ask()

        // Two retries are allowed, so the unset model would be attempted three times if the failure were retried.
        expect(h.resolveCalls).toEqual(['RISU_UNSET_KEY'])
        expect(h.calls.length).toBeGreaterThan(0)
        expect(h.calls.every((call) => call.url.includes('api.anthropic.com') && call.headers['x-api-key'] === PLAIN)).toBe(true)
    })

    test('the last model returns the failure, naming the variable and never a value', async () => {
        installDb({ aiModel: 'gpt4o', openAIKey: UNSET })

        const out = await ask()

        expect(out).toMatchObject({ type: 'fail', noRetry: true })
        expect(String(out.result)).toContain('${RISU_UNSET_KEY}')
    })
})

describe('Vertex service-account key as a reference', () => {
    const vertexDb = (key: string) => ({ aiModel: 'gemini-2.5-flash-vertex', vertexPrivateKey: key })

    test('the minted access token is used for the request and written nowhere', async () => {
        installDb(vertexDb('${RISU_PEM_ONE}'))

        await ask()

        const sent = h.calls.find((call) => call.url.includes('aiplatform.googleapis.com'))
        expect(sent?.headers['authorization']).toBe('Bearer MINTED-access-token')
        expect(h.setDatabase).not.toHaveBeenCalled()
        expect(DBState.db.vertexAccessToken).toBe('')
        expect(DBState.db.vertexAccessTokenExpires).toBe(0)
        expect(JSON.stringify(DBState.db)).not.toContain('MINTED-access-token')
        expect(JSON.stringify(DBState.db)).not.toContain('BEGIN PRIVATE KEY')
        for (const call of h.calls) {
            expect(wire(call)).not.toContain('${')
        }
    })

    test('a second request within the token lifetime reuses the in-memory token', async () => {
        installDb({ ...vertexDb('${RISU_PEM_TWO}'), requestRetrys: 0 })

        await ask()
        await ask()

        expect(h.calls.filter((call) => call.url.includes('oauth2.googleapis.com'))).toHaveLength(1)
        expect(h.calls.filter((call) => call.url.includes('aiplatform.googleapis.com'))).toHaveLength(2)
        expect(h.setDatabase).not.toHaveBeenCalled()
    })

    test('guard: a resolved value that is not a PEM is rejected before the token endpoint is contacted', async () => {
        installDb(vertexDb('${RISU_PEM_THREE}'))
        const realPem = pem
        pem = 'not a pem'
        try {
            const out = await ask()
            expect(out.type).toBe('threw')
            expect(h.calls.filter((call) => call.url.includes('oauth2.googleapis.com'))).toHaveLength(0)
        }
        finally {
            pem = realPem
        }
    })

    test('guard: a plain key is exchanged for a token that is cached in the database', async () => {
        installDb(vertexDb(pem))

        await ask()

        expect(DBState.db.vertexAccessToken).toBe('MINTED-access-token')
        expect(h.setDatabase).toHaveBeenCalled()
        expect(h.resolveCalls).toEqual([])
    })

    test('the preview shows the reference as the bearer value and mints no token', async () => {
        installDb(vertexDb('${RISU_PEM_FOUR}'))

        const out = await ask({ previewBody: true })

        expect(out.type).toBe('success')
        expect(JSON.parse(String(out.result)).headers.Authorization).toContain('${RISU_PEM_FOUR}')
        expect(calledNetwork()).toBe(false)
        expect(h.resolveCalls).toEqual([])
        expect(h.setDatabase).not.toHaveBeenCalled()
    })

    test('a plain-key preview with an expired token mints no token and writes nothing to the database', async () => {
        const expiredAt = Date.now() - 1000
        installDb({ ...vertexDb(pem), vertexAccessToken: '', vertexAccessTokenExpires: expiredAt })

        const out = await ask({ previewBody: true })

        expect(out.type).toBe('success')
        expect(calledNetwork()).toBe(false)
        expect(h.setDatabase).not.toHaveBeenCalled()
        expect(DBState.db.vertexAccessToken).toBe('')
        expect(DBState.db.vertexAccessTokenExpires).toBe(expiredAt)
        expect(JSON.parse(String(out.result)).headers.Authorization).not.toContain('BEGIN PRIVATE KEY')
    })

    test('an unset reference fails without contacting the token endpoint', async () => {
        installDb(vertexDb(UNSET))

        const out = await ask()

        expect(out).toMatchObject({ type: 'fail', noRetry: true })
        expect(calledNetwork()).toBe(false)
    })

    test('an unusable reference in the Gemini key does not fail a Vertex request that does not carry the key', async () => {
        installDb({ ...vertexDb(pem), google: { accessToken: UNSET, projectId: 'proj' } })

        await ask()

        const sent = h.calls.find((call) => call.url.includes('aiplatform.googleapis.com'))
        expect(sent?.headers['authorization']).toBe('Bearer MINTED-access-token')
        expect(h.resolveCalls).toEqual([])
    })

    test('the minted token is registered for log redaction under a label that names the reference', async () => {
        resetSecretRefState()
        installDb(vertexDb('${RISU_PEM_FIVE}'))
        expect(redactResolved('Bearer MINTED-access-token')).toBe('Bearer MINTED-access-token')

        await ask()

        const logged = redactResolved(`{"Authorization":"Bearer MINTED-access-token"}`)
        expect(logged).not.toContain('MINTED-access-token')
        expect(logged).toContain('${RISU_PEM_FIVE}:token')
    })
})

//#endregion

describe('Vertex token service: one mint per credential, redacted, through the shared transport', () => {
    const vertexDb = (key: string) => ({ aiModel: 'gemini-2.5-flash-vertex', vertexPrivateKey: key, requestRetrys: 0 })
    const oauthCalls = () => h.calls.filter((call) => call.url.includes('oauth2.googleapis.com'))
    const aiplatformCalls = () => h.calls.filter((call) => call.url.includes('aiplatform.googleapis.com'))
    const pause = (ms = 25) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const holdTokenEndpoint = () => {
        let release: () => void = () => {}
        h.oauth.gate = new Promise<void>((resolve) => { release = resolve })
        return release
    }
    const waitForOauth = async (count: number) => {
        for (let i = 0; i < 200 && oauthCalls().length < count; i++) { await pause(5) }
        expect(oauthCalls().length).toBeGreaterThanOrEqual(count)
    }
    const rejectionOf = () => requestChatData({ formated: messages(), bias: {}, useStreaming: false, noMultiGen: true, tools: [] }, 'model', null)
        .then(() => null, (error: unknown) => error)
    const vertexConnectionId = () => (DBState.db.connections as unknown as Array<{ id: string, provider: string }>).find((conn) => conn.provider === 'vertex')?.id ?? ''

    test('R1 concurrent requests on a plain key with an expired token make one token request and all carry its token', async () => {
        installDb(vertexDb(pem))
        const release = holdTokenEndpoint()

        const all = Promise.all([ask(), ask(), ask()])
        await waitForOauth(1)
        await pause()
        release()
        await all

        expect(oauthCalls()).toHaveLength(1)
        expect(aiplatformCalls()).toHaveLength(3)
        for (const call of aiplatformCalls()) {
            expect(call.headers['authorization']).toBe('Bearer MINTED-access-token')
        }
    })

    test('R2 a minted token on a plain key is registered for log redaction', async () => {
        resetSecretRefState()
        installDb(vertexDb(pem))

        await ask()

        expect(redactResolved('Bearer MINTED-access-token')).not.toContain('MINTED-access-token')
    })

    test('R3 the token request goes through the shared transport, never the global fetch', async () => {
        installDb(vertexDb(pem))

        await ask()

        expect(oauthCalls().map((call) => call.via)).toEqual(['fetchNative'])
    })

    test('R4a a connection deleted while a plain-key mint is in flight leaves no persisted token', async () => {
        installDb(vertexDb(pem))
        const release = holdTokenEndpoint()
        const { deleteConnection } = await import('../../connections/connectionEditor')

        const request = ask()
        await waitForOauth(1)
        const id = vertexConnectionId()
        expect(id).not.toBe('')
        expect(deleteConnection(DBState.db, id)).not.toBeNull()
        release()
        await request

        expect(DBState.db.vertexAccessToken).toBe('')
        expect(DBState.db.vertexAccessTokenExpires).toBe(0)
    })

    test('R4b a connection deleted while a referenced-key mint is in flight leaves no memory token', async () => {
        installDb(vertexDb('${RISU_PEM_SIX}'))
        const release = holdTokenEndpoint()
        const { deleteConnection } = await import('../../connections/connectionEditor')

        const request = ask()
        await waitForOauth(1)
        const id = vertexConnectionId()
        expect(id).not.toBe('')
        expect(deleteConnection(DBState.db, id)).not.toBeNull()
        release()
        await request
        installDb(vertexDb('${RISU_PEM_SIX}'))
        await ask()

        expect(oauthCalls()).toHaveLength(2)
    })

    const holdKeyRead = () => {
        let release: () => void = () => {}
        h.keyRead.gate = new Promise<void>((resolve) => { release = resolve })
        return release
    }
    const waitForKeyRead = async () => {
        for (let i = 0; i < 200 && h.keyRead.reached < 1; i++) { await pause(5) }
        expect(h.keyRead.reached).toBeGreaterThanOrEqual(1)
    }

    test('R7a a connection deleted while the private key is still being read leaves no persisted token', async () => {
        installDb(vertexDb(pem))
        const release = holdKeyRead()
        const { deleteConnection } = await import('../../connections/connectionEditor')

        const request = ask()
        await waitForKeyRead()
        const id = vertexConnectionId()
        expect(id).not.toBe('')
        expect(deleteConnection(DBState.db, id)).not.toBeNull()
        release()
        await request

        expect(DBState.db.vertexAccessToken).toBe('')
        expect(DBState.db.vertexAccessTokenExpires).toBe(0)
    })

    test('R7b a connection deleted while a referenced private key is still being read fills no memory token', async () => {
        installDb(vertexDb('${RISU_PEM_SIX}'))
        const release = holdKeyRead()
        const { deleteConnection } = await import('../../connections/connectionEditor')

        const request = ask()
        await waitForKeyRead()
        const id = vertexConnectionId()
        expect(id).not.toBe('')
        expect(deleteConnection(DBState.db, id)).not.toBeNull()
        release()
        await request
        h.keyRead.gate = null
        installDb(vertexDb('${RISU_PEM_SIX}'))
        await ask()

        expect(oauthCalls()).toHaveLength(2)
    })

    describe('a failing token endpoint', () => {
        const failure = () => ({ ok: false, status: 500, json: async () => ({ e: 'srv' }) })

        test('R5a concurrent failing requests share one token request and one rejection message', async () => {
            installDb(vertexDb(pem))
            h.oauth.answer = failure
            const release = holdTokenEndpoint()

            const both = Promise.all([rejectionOf(), rejectionOf()])
            await waitForOauth(1)
            await pause()
            release()
            const [first, second] = await both

            expect(oauthCalls()).toHaveLength(1)
            const expected = fillLang(language.errors.googleTokenRefreshFailed, { error: '{"e":"srv"}' })
            expect((first as Error).message).toBe(expected)
            expect((second as Error).message).toBe(expected)
        })

        test('R5b guard: a failed mint caches nothing, so the next request mints and persists', async () => {
            installDb(vertexDb(pem))
            h.oauth.answer = failure
            await rejectionOf()
            expect(DBState.db.vertexAccessToken).toBe('')
            h.oauth.answer = null

            await ask()

            expect(oauthCalls()).toHaveLength(2)
            expect(DBState.db.vertexAccessToken).toBe('MINTED-access-token')
        })
    })

    test('R6 a token endpoint error that echoes the assertion shows no JWT in the thrown message', async () => {
        resetSecretRefState()
        installDb(vertexDb(pem))
        let jwt = ''
        h.oauth.answer = () => {
            jwt = new URLSearchParams(oauthCalls()[0].body).get('assertion') ?? ''
            return { ok: false, status: 400, json: async () => ({ error: jwt }) }
        }

        const error = await rejectionOf()

        expect(jwt.split('.')).toHaveLength(3)
        expect((error as Error).message).toContain(language.errors.googleTokenRefreshFailed.split('{')[0])
        expect((error as Error).message).not.toContain(jwt)
    })
})

describe('Vertex token minting on a page without crypto.subtle', () => {
    const realCrypto = globalThis.crypto
    const realSubtle = realCrypto.subtle
    const vertexDb = (key: string) => ({ aiModel: 'gemini-2.5-flash-vertex', vertexPrivateKey: key, requestRetrys: 0 })
    const noSubtle = () => {
        vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
        expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined()
    }
    // The setup file's other global stubs must stay in place, so only `crypto` is put back.
    afterEach(() => { vi.stubGlobal('crypto', realCrypto) })

    /** The rejection of `requestChatData`; `ask()` would drop the reason. */
    const rejectionOf = () => requestChatData({ formated: messages(), bias: {}, useStreaming: false, noMultiGen: true, tools: [] }, 'model', null)
        .then(() => null, (error: unknown) => error)
    const oauthCalls = () => h.calls.filter((call) => call.url.includes('oauth2.googleapis.com'))
    const pemOf = (der: Uint8Array) => {
        let binary = ''
        for (const byte of der) { binary += String.fromCharCode(byte) }
        return `-----BEGIN PRIVATE KEY-----\n${btoa(binary).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`
    }
    const pemBytes = () => Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s/g, '')), (c) => c.charCodeAt(0))
    const malformedKeys = async (): Promise<Array<[string, string]>> => {
        const ec = await realSubtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        return [
            ['truncated DER', pemOf(pemBytes().slice(0, -1))],
            ['EC PKCS#8', pemOf(new Uint8Array(await realSubtle.exportKey('pkcs8', ec.privateKey)))],
        ]
    }
    const invalidKeyMessage = () => language.errors.vertexInvalidPrivateKey
    const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

    async function expectSignedToken(db: Record<string, unknown>) {
        installDb(db)
        noSubtle()

        await ask()

        const oauth = oauthCalls()
        expect(oauth).toHaveLength(1)
        const jwt = new URLSearchParams(oauth[0].body).get('assertion') ?? ''
        const [encodedHeader, encodedClaims, encodedSignature] = jwt.split('.')
        expect(JSON.parse(new TextDecoder().decode(fromBase64url(encodedHeader)))).toEqual({ alg: 'RS256', typ: 'JWT' })
        const signed = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)
        const signature = fromBase64url(encodedSignature)
        expect(await realSubtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signed)).toBe(true)
        const key = await realSubtle.importKey('pkcs8', pemBytes(), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
        expect(hex(signature)).toBe(hex(new Uint8Array(await realSubtle.sign('RSASSA-PKCS1-v1_5', key, signed))))
        const sent = h.calls.find((call) => call.url.includes('aiplatform.googleapis.com'))
        expect(sent?.headers['authorization']).toBe('Bearer MINTED-access-token')
    }

    test('a referenced key is exchanged for a token without crypto.subtle, and the JWT verifies', async () => {
        await expectSignedToken(vertexDb('${RISU_PEM_PLAIN}'))
    })

    test('a plain key is exchanged for a token without crypto.subtle, and the JWT verifies', async () => {
        await expectSignedToken(vertexDb(pem))
    })

    test('a malformed key is reported as an invalid private key without crypto.subtle', async () => {
        for (const [label, key] of await malformedKeys()) {
            h.calls.length = 0
            installDb(vertexDb(key))
            noSubtle()

            const error = await rejectionOf()

            expect((error as Error | null)?.message, label).toBe(invalidKeyMessage())
            expect(oauthCalls(), label).toHaveLength(0)
        }
    })

    test('a malformed key is reported as an invalid private key with crypto.subtle', async () => {
        for (const [label, key] of await malformedKeys()) {
            h.calls.length = 0
            installDb(vertexDb(key))

            const error = await rejectionOf()

            expect((error as Error | null)?.message, label).toBe(invalidKeyMessage())
            expect(oauthCalls(), label).toHaveLength(0)
        }
    })

    test('a key body that is not base64 is reported as an invalid private key on both paths', async () => {
        const key = '-----BEGIN PRIVATE KEY-----\nab$cd\n-----END PRIVATE KEY-----\n'
        for (const withSubtle of [true, false]) {
            h.calls.length = 0
            installDb(vertexDb(key))
            if (!withSubtle) { noSubtle() }

            const error = await rejectionOf()

            expect((error as Error | null)?.message, String(withSubtle)).toBe(invalidKeyMessage())
            expect(oauthCalls()).toHaveLength(0)
            vi.stubGlobal('crypto', realCrypto)
        }
    })

    describe('guard: failures outside the key keep their own messages', () => {
        const oauthAnswer = (answer: () => unknown) => {
            h.oauth.answer = answer
            return () => { h.oauth.answer = null }
        }

        test('a token endpoint error status', async () => {
            installDb(vertexDb(pem))
            const restore = oauthAnswer(() => ({ ok: false, status: 500, json: async () => ({ e: 'srv' }) }))
            try {
                const error = await rejectionOf()
                expect((error as Error).message).toBe(fillLang(language.errors.googleTokenRefreshFailed, { error: '{"e":"srv"}' }))
            }
            finally { restore() }
        })

        test('a network failure', async () => {
            installDb(vertexDb(pem))
            const failure = new TypeError('net down')
            const restore = oauthAnswer(() => { throw failure })
            try {
                expect(await rejectionOf()).toBe(failure)
            }
            finally { restore() }
        })

        test('a response without an access token', async () => {
            installDb(vertexDb(pem))
            const restore = oauthAnswer(() => ({ ok: true, status: 200, json: async () => ({}) }))
            try {
                const error = await rejectionOf()
                expect((error as Error).message).toBe(language.errors.googleNoAccessToken)
            }
            finally { restore() }
        })

        test('a WebCrypto sign failure is not relabelled as a key problem', async () => {
            installDb(vertexDb(pem))
            vi.stubGlobal('crypto', {
                getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
                subtle: { importKey: realSubtle.importKey.bind(realSubtle), sign: async () => { throw new DOMException('x', 'OperationError') } },
            })

            const error = await rejectionOf()

            expect((error as { name?: string }).name).toBe('OperationError')
            expect((error as Error).message).not.toBe(invalidKeyMessage())
        })
    })
})

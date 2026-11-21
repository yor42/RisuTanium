/**
 * Requests read the chat key and URL from the stored connections, never from the legacy fields.
 *
 * Compat file: it imports no module that is new with connections, so it also runs against the tree before
 * connections existed. The databases are built as a stored database looks after the migration (a `connections`
 * list plus references, legacy fields empty), except T16w, which hands a legacy database to the real `setDatabase`.
 * Drives the real `requestChatData` and `leaseRequestKey`; the transports (`globalFetch`, `fetchNative`, global
 * `fetch`) and the collaborators the request path touches are mocked. Keys are synthetic. Nothing here says
 * anything about a native backend.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import '../../../polyfill'
import { resetKeyRings } from '../keyRing'
import { leaseRequestKey } from '../secretKey'

//#region module mocks

type Scripted = { status: number, body: unknown }
type Recorded = { via: string, url: string, headers: Record<string, string>, body: string }

const h = vi.hoisted(() => ({
    calls: [] as Array<{ via: string, url: string, headers: Record<string, string>, body: string }>,
    /** Answers one request of the scripted transports. */
    script: null as unknown as (call: { via: string, url: string, headers: Record<string, string>, body: string }) => { status: number, body: unknown },
}))

/** The first test imports the real database module, whose graph is large; a cold transform can pass a hook's default timeout. */
const COLD_TRANSFORM_HOOK_MS = 300_000

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))

vi.mock('../../../stores.svelte', () => ({
    DBState: { db: {} },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: writable(null),
}))

vi.mock('../../../alert', () => ({
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
    return call
}

function asResponse(scripted: Scripted): Response {
    return new Response(JSON.stringify(scripted.body), { status: scripted.status, headers: { 'Content-Type': 'application/json' } })
}

vi.mock('../../../globalApi.svelte', () => ({
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

vi.mock('../../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))
vi.mock('../../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }))
vi.mock('../../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../../files/inlays', () => ({
    getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'x'), supportsInlayImage: vi.fn(() => false),
    saveInlayedSignature: vi.fn(), setInlayAsset: vi.fn(),
}))
vi.mock('../../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
        replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: vi.fn(),
}))
vi.mock('../../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn(), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))
vi.mock('../../composerActions.svelte', () => ({ sendMain: vi.fn(async () => {}), regenerateNewest: vi.fn(async () => {}) }))
vi.mock('../../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../util')>()),
    sleep: async () => {},
}))
vi.mock('../../../storage/database.svelte', async () => {
    const stores = await import('../../../stores.svelte')
    const state = stores.DBState as unknown as { db: object }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

//#endregion

type Result = { type: string, result: unknown, noRetry?: boolean }
let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let shellGenerationSource: typeof import('../../../chatShell/sendFailure.svelte').shellGenerationSource
let realSetDatabase: (data: Database) => void
let DBState: { db: Database }

beforeAll(async () => {
    requestChatData = (await import('../request')).requestChatData as never
    DBState = (await import('../../../stores.svelte')).DBState as unknown as { db: Database }
    shellGenerationSource = (await import('../../../chatShell/sendFailure.svelte')).shellGenerationSource
    realSetDatabase = (await vi.importActual<typeof import('../../../storage/database.svelte')>('../../../storage/database.svelte')).setDatabase as never
}, COLD_TRANSFORM_HOOK_MS)

/** `fallbackModels` is left out on purpose: the real `setDatabase` defaults a missing one, and throws on a partial one. */
function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: '',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        google: { accessToken: '', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
        claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', nanogptKey: '', openrouterKey: '', proxyKey: '', forceReplaceUrl: '',
        OaiCompAPIKeys: {}, ollamaCloudModel: 'cloud-m', ollamaModel: 'local-m', ollamaURL: 'http://ollama.test', ollamaThinkingMode: 'default',
        modelTools: [], customAPIFormat: 0,
        ...extra,
    } as unknown as Database
}

const OPENAI_OK: Scripted = { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'hello' } }] } }
const OLLAMA_OK: Scripted = { status: 200, body: { model: 'cloud-m', created_at: '2026-01-01T00:00:00Z', message: { role: 'assistant', content: 'hello' }, done: true } }
const LIMIT: Scripted = { status: 429, body: { error: { message: 'rate limited' } } }

const messages = () => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

function ask(extra: Record<string, unknown> = {}) {
    return requestChatData({ formated: messages(), bias: {}, useStreaming: false, noMultiGen: true, tools: [], ...extra }, 'model', null)
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
/** Everything a call put on the wire, for a search for a key that must not appear. */
const wireOf = (call: Call) => `${call.url}\n${JSON.stringify(call.headers)}\n${call.body}`

function answerByKey(table: Record<string, Scripted>, otherwise: Scripted = OPENAI_OK) {
    h.script = (call) => table[keyOf(call)] ?? otherwise
}

let realFetch: typeof globalThis.fetch

beforeEach(() => {
    h.calls.length = 0
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

const ANTHROPIC_KEY = 'sk-ant-X'
const anthropicConnection = { id: 'conn-1', name: 'Claude', provider: 'anthropic', key: ANTHROPIC_KEY }

describe('a request resolves its key and URL from the stored connections', () => {
    test('T13: the OpenAI key is the one the openai connection stores', async () => {
        installDb({ connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-a' }] })

        expect(await leaseRequestKey({}, 'openAIKey')).toBe('sk-a')
    })

    test('T14: a reverse proxy request goes to the URL of the working proxy connection, with its key', async () => {
        installDb({
            aiModel: 'reverse_proxy', customProxyRequestModel: 'm', proxyConnectionId: 'conn-2',
            connections: [{ id: 'conn-2', name: 'p.invalid', provider: 'reverse_proxy', key: 'K-proxy', url: 'https://p.invalid/v1/chat/completions' }],
        })

        await ask()

        expect(h.calls.map((call) => call.url)).toEqual(['https://p.invalid/v1/chat/completions'])
        expect(keys()).toEqual(['K-proxy'])
    })

    test('T15: a 429 on line 1 of the stored key resends on line 2', async () => {
        installDb({ connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'L1\nL2' }] })
        answerByKey({ L1: LIMIT })

        const out = await ask()

        expect(keys()).toEqual(['L1', 'L2'])
        expect(out).toMatchObject({ type: 'success', result: 'hello' })
    })

    test('T16: the send gate of the chat shell accepts a send whose key is stored in a connection', () => {
        installDb({ connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-a' }] })
        DBState.db.aiModel = 'gpt4o'

        const refused = shellGenerationSource(() => {}).refuseGeneration?.({ origin: { chaId: 'cha-a', chatId: 'chat-a' } as never, action: 'send' })

        expect(refused).toBe(false)
    })

    test('T16w: a whitespace-only legacy Ollama key sends no Authorization header', async () => {
        installDb({ aiModel: 'ollama-cloud', ollamaRequestFormat: 3, ollamaApiKey: '   ' })
        realSetDatabase(DBState.db)
        answerByKey({}, OLLAMA_OK)

        await ask()

        expect(h.calls.length).toBeGreaterThan(0)
        expect(h.calls.every((call) => call.headers['authorization'] === undefined)).toBe(true)
    })
})

describe('a connection of another provider is never used', () => {
    test('T25: a proxy reference naming an Anthropic connection sends no key and no leased proxy key', async () => {
        installDb({ aiModel: 'reverse_proxy', customProxyRequestModel: 'm', proxyConnectionId: 'conn-1', connections: [anthropicConnection] })

        await ask()

        expect(h.calls.some((call) => wireOf(call).includes(ANTHROPIC_KEY))).toBe(false)
        expect(await leaseRequestKey({}, 'proxyKey')).not.toBe(ANTHROPIC_KEY)
    })

    test('T25c: a custom model reference naming an Anthropic connection sends no key and reaches no provider host', async () => {
        installDb({
            aiModel: 'xcustom:::c1', connections: [anthropicConnection],
            customModels: [{ id: 'xcustom:::c1', name: 'c1', internalId: 'c1', url: 'https://c.invalid/v1', key: '', format: 0, flags: [], tokenizer: 0, connectionId: 'conn-1' }],
        })

        await ask()

        expect(h.calls.some((call) => wireOf(call).includes(ANTHROPIC_KEY))).toBe(false)
        expect(h.calls.some((call) => call.url.includes('api.openai.com'))).toBe(false)
    })
})
describe('a legacy database loaded through the real setDatabase still reaches the request', () => {
    // Guards: they pass on the tree before connections existed (the key is read from the legacy field) and after (it is read from the migrated connection).
    test('T13p: the legacy OpenAI key is the one the request carries', async () => {
        installDb({ openAIKey: 'sk-a' })
        realSetDatabase(DBState.db)

        await ask()

        expect(keys()).toEqual(['sk-a'])
    })

    test('T15p: a legacy multi-line key resends on line 2 after a 429 on line 1', async () => {
        installDb({ openAIKey: 'L1\nL2' })
        realSetDatabase(DBState.db)
        answerByKey({ L1: LIMIT })

        const out = await ask()

        expect(keys()).toEqual(['L1', 'L2'])
        expect(out).toMatchObject({ type: 'success', result: 'hello' })
    })
})

/**
 * A wrapped key that is temporarily unreadable fails the send with the vault's own message: the real
 * `requestChatData` returns a `fail` result carrying `language.vaultKeyTemporarilyUnavailable`, sends
 * nothing, and neither throws nor reports a provider auth error. The shell's send gate still accepts
 * the send, because the key counts as present. The vault and the transports are mocked and the keys are
 * synthetic; nothing here says anything about native behaviour.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import '../../../polyfill'
import { resetKeyRings } from '../keyRing'
import { language } from '../../../../lang'
import { installVaultHost, resetVaultStoreForTest } from '../../../connections/keyVaultStore.svelte'

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



const vault = vi.hoisted(() => ({ code: 'timeout' as string }))
vi.mock('../../../android/keyVault', () => ({
    unwrapKey: vi.fn(async () => vault.code === 'ok' ? { ok: true, value: 'SYNTH-WRAPPED-KEY' } : { ok: false, code: vault.code }),
    wrapKey: vi.fn(async () => ({ ok: false, code: 'other' })),
    watchdogFired: () => false,
}))

//#endregion

type Result = { type: string, result: unknown, noRetry?: boolean }
let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let shellGenerationSource: typeof import('../../../chatShell/sendFailure.svelte').shellGenerationSource
let DBState: { db: Database }

beforeAll(async () => {
    requestChatData = (await import('../request')).requestChatData as never
    DBState = (await import('../../../stores.svelte')).DBState as unknown as { db: Database }
    shellGenerationSource = (await import('../../../chatShell/sendFailure.svelte')).shellGenerationSource
}, COLD_TRANSFORM_HOOK_MS)

function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', requestRetrys: 2, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: '',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        google: { accessToken: '', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
        claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', nanogptKey: '', openrouterKey: '', proxyKey: '', forceReplaceUrl: '',
        OaiCompAPIKeys: {}, modelTools: [], customAPIFormat: 0,
        ...extra,
    } as unknown as Database
}

const wrappedConnection = { id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '', keyWrapped: 'ENVELOPE' }

beforeEach(() => {
    h.calls.length = 0
    h.script = () => ({ status: 200, body: { choices: [{ message: { role: 'assistant', content: 'hello' } }] } })
    resetKeyRings()
    resetVaultStoreForTest()
    installDb({ connections: [{ ...wrappedConnection }] })
    const conns = (DBState.db as unknown as { connections: Array<typeof wrappedConnection> }).connections
    installVaultHost({
        platform: 'vault',
        findConnection: (id) => conns.find((conn) => conn.id === id) as never,
        listConnections: () => conns as never,
        requestSaveNow: () => {},
        markBootWrite: () => {},
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => {}, wrapped: () => {}, reentry: () => {} },
        messages: { keyUnavailable: () => language.vaultKeyTemporarilyUnavailable },
    })
})

afterEach(() => {
    resetVaultStoreForTest()
})

const ask = () => requestChatData(
    { formated: [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }], bias: {}, useStreaming: false, noMultiGen: true, tools: [] },
    'model', null,
)

describe('a send with a temporarily unreadable wrapped key', () => {
    test('fails with the vault message, sends nothing and does not throw', async () => {
        vault.code = 'timeout'

        const out = await ask()

        expect(out).toMatchObject({ type: 'fail', result: language.vaultKeyTemporarilyUnavailable, noRetry: true })
        expect(h.calls).toEqual([])
    })

    test('the send gate of the chat shell still accepts the send, since the key counts as present', () => {
        vault.code = 'timeout'

        const refused = shellGenerationSource(() => {}).refuseGeneration?.({ origin: { chaId: 'cha-a', chatId: 'chat-a' } as never, action: 'send' })

        expect(refused).toBe(false)
    })

    test('sends with the decrypted key once the vault answers', async () => {
        vault.code = 'ok'

        const out = await ask()

        expect(out).toMatchObject({ type: 'success', result: 'hello' })
        expect(h.calls.map((call) => call.headers['authorization'])).toEqual(['Bearer SYNTH-WRAPPED-KEY'])
    })
})
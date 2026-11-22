/**
 * T3, T4, T18 (guards, new rules): the reply grant reaches only the first attempt of the first model, an earlier fetch
 * of the send cannot take it, and an announced native failure ends the turn.
 *
 * Drives the real `requestChatData` and the real OpenAI request path over the module mocks of `keyRotation.test.ts`
 * (copied: each suite mocks its own graph). The transport is a mock, so nothing here says anything about native
 * behaviour. Mutants M8 (grant on every attempt), M9 (a module-level grant), M30 (`announced` ignored).
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'
import { resetKeyRings } from './keyRing'
import { bindGrant, issueNativeReplyGrant, takeReplyOwner } from '../../nativeReply/grant'
import { heldReply, resetPageStateForTests } from '../../nativeReply/pageState'

type Reply = { status: number, body: unknown, nativeFinal?: boolean }

const h = vi.hoisted(() => ({
    calls: [] as Array<{ nativeReply: unknown, url: string }>,
    script: null as unknown as (n: number) => { status: number, body: unknown, nativeFinal?: boolean },
    beforeRequest: new Set<(formated: unknown, model: string) => unknown>(),
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
vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(async (url: string, opts?: { nativeReply?: unknown }) => {
        h.calls.push({ nativeReply: opts?.nativeReply ?? null, url: String(url) })
        const scripted = h.script(h.calls.length)
        return { ok: scripted.status >= 200 && scripted.status < 300, status: scripted.status, data: scripted.body, headers: {}, nativeFinal: scripted.nativeFinal }
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
        replacerbeforeRequest: h.beforeRequest, replacerafterRequest: new Set(), providers: new Map(),
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

type Result = { type: string, result: unknown, endsTurn?: boolean }
let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const OK: Reply = { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'hello' } }] } }
const FAIL: Reply = { status: 500, body: { error: { message: 'boom' } } }
const parseBase = { target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha', generationInfo: {}, promptInfo: {}, escape: false, requestedMs: 1 }

beforeAll(async () => {
    requestChatData = (await import('./request')).requestChatData as never
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }
}, 60_000)

function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: 'sk-test',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        google: { accessToken: '', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
        claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', nanogptKey: '', openrouterKey: '', proxyKey: '',
        OaiCompAPIKeys: {}, ollamaCloudModel: 'cloud-m', ollamaModel: 'local-m', ollamaURL: 'http://ollama.test', ollamaThinkingMode: 'default',
        modelTools: [], customAPIFormat: 0,
        ...extra,
    } as unknown as Database
}

function ask(extra: Record<string, unknown> = {}) {
    return requestChatData({ formated: [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }], bias: {}, useStreaming: false, noMultiGen: true, tools: [], ...extra }, 'model', null)
        .catch(() => ({ type: 'threw', result: '' }) as Result)
}

beforeEach(() => {
    h.calls.length = 0
    h.beforeRequest.clear()
    h.script = () => OK
    resetKeyRings()
    resetPageStateForTests()
})

describe('the grant goes to the first attempt only', () => {
    test('T3: the first request carries the owner; a retry carries none', async () => {
        installDb({ requestRetrys: 1 })
        h.script = (n) => (n === 1 ? FAIL : OK)
        const grant = issueNativeReplyGrant(KEY, parseBase)

        const out = await ask({ nativeReplyGrant: grant })

        expect(out).toMatchObject({ type: 'success', result: 'hello' })
        expect(h.calls).toHaveLength(2)
        expect(h.calls[0].nativeReply).not.toBeNull()
        expect(h.calls[1].nativeReply).toBeNull()
        expect(heldReply(KEY)?.bound).toBe(true)
    })

    test('T3: a fallback model never gets the grant', async () => {
        installDb({ fallbackModels: { model: ['gpt4o'] }, requestRetrys: 0 })
        h.script = (n) => (n === 1 ? FAIL : OK)
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(h.calls.map((call) => call.nativeReply !== null)).toEqual([true, false])
    })

    test('T3: a request with tools offers none', async () => {
        installDb({})
        const grant = issueNativeReplyGrant(KEY, parseBase)
        await ask({ nativeReplyGrant: grant, tools: [{ name: 't', description: '', inputSchema: {} }] })
        expect(h.calls.every((call) => call.nativeReply === null)).toBe(true)
        expect(heldReply(KEY)?.bound).toBe(false)
    })

    test('T3: a streamed OpenAI-compatible request is offered the grant and binds it', async () => {
        installDb({ useStreaming: true })
        const { fetchNative } = await import('../../globalApi.svelte')
        vi.mocked(fetchNative).mockRejectedValueOnce(new Error('no transport in this suite'))
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), useStreaming: true, chatId: KEY, usageInputEstimate: 3 })
        expect(heldReply(KEY)?.bound).toBe(true)
    })

    test('T4: a fetch made before the request binds cannot take ownership', async () => {
        installDb({})
        const grant = issueNativeReplyGrant(KEY, parseBase)
        const early: unknown[] = []
        h.beforeRequest.add((formated) => {
            // What a plugin could try with what it can reach: the grant itself and an object shaped like an owner.
            early.push(takeReplyOwner(grant), takeReplyOwner({ key: KEY, pageVersion: 1, blob: '{}' }), bindGrant({ key: KEY }, { kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }))
            return formated
        })

        await ask({ nativeReplyGrant: grant })

        expect(early).toEqual([null, null, null])
        const owner = h.calls[0].nativeReply
        expect(takeReplyOwner(owner)).toMatchObject({ key: KEY })
        expect(takeReplyOwner(owner)).toBeNull()
    })
})

describe('an announced failure ends the turn', () => {
    test('T18: without the field the failure is retried', async () => {
        installDb({ requestRetrys: 2 })
        h.script = () => FAIL
        const out = await ask()
        expect(out.type).toBe('fail')
        expect(h.calls).toHaveLength(3)
    })

    test('T18: with `announced` the turn ends after one request', async () => {
        installDb({ requestRetrys: 2 })
        h.script = () => ({ ...FAIL, nativeFinal: true })
        const out = await ask()
        expect(out.type).toBe('fail')
        expect(h.calls).toHaveLength(1)
    })
})

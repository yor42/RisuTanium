/**
 * Every non-streamed chat request site asks `globalFetch` to deliver its reply while a hidden Android page is
 * frozen, and nothing else does. A missing flag at one site keeps that provider on the plugin route whose body
 * read never settles on a frozen page. Bedrock is signed by hand and stays on its own route.
 *
 * Drives the real `requestChatData` for each provider with `globalFetch` and `fetchNative` mocked; only the
 * arguments the site passes are asserted, so the test says nothing about the transport behind them.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import '../../../polyfill'

const h = vi.hoisted(() => ({
    calls: [] as Array<{ via: string, url: string, deliverWhileFrozen: unknown }>,
}))

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

vi.mock('../../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string) => {
        h.calls.push({ via: 'fetchNative', url: String(url), deliverWhileFrozen: undefined })
        return new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 500 })
    }),
    globalFetch: vi.fn(async (url: string, opts?: { deliverWhileFrozen?: unknown }) => {
        h.calls.push({ via: 'globalFetch', url: String(url), deliverWhileFrozen: opts?.deliverWhileFrozen })
        return { ok: false, data: {} }
    }),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
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

type Result = { type: string, result: unknown, noRetry?: boolean }
let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }

beforeAll(async () => {
    requestChatData = (await import('../request')).requestChatData as never
    DBState = (await import('../../../stores.svelte')).DBState as unknown as { db: Database }
})

function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: 'k',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        NAIsettings: { seperator: '\n', starter: '', topK: 1, topP: 1, topA: 1, tailFreeSampling: 1, repetitionPenalty: 1, repetitionPenaltyRange: 1, repetitionPenaltySlope: 1, frequencyPenalty: 0, presencePenalty: 0, typicalp: 1 },
        NAIappendName: true, NAIadventure: false, novelai: { token: 'k' }, novellistAPI: 'k',
        ainconfig: { top_p: 1, top_k: 1, rep_pen: 1, top_a: 1, rep_pen_slope: 1, rep_pen_range: 1, typical_p: 1, badwords: '', stoptokens: '' },
        ooba: { formating: { userPrefix: 'U:', seperator: '\n' }, top_k: 1, top_p: 1, repetition_penalty: 1, typical_p: 1 },
        textgenWebUIStreamURL: 'ws://ooba.test/api/v1/stream', textgenWebUIBlockingURL: 'http://ooba.test/api/v1/generate', reverseProxyOobaArgs: {}, mancerHeader: 'k',
        hordeConfig: { apiKey: '' }, top_k: 1, top_p: 1,
        google: { accessToken: 'k', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
        claudeAPIKey: 'k', mistralKey: 'k', cohereAPIKey: 'k', ollamaApiKey: '', proxyKey: '',
        OaiCompAPIKeys: {}, modelTools: [], customAPIFormat: 0, forceReplaceUrl: '', autofillRequestUrl: false,
        ...extra,
    } as unknown as Database
}

async function ask(model: string, extra: Record<string, unknown> = {}) {
    installDb({ aiModel: model, ...extra })
    await requestChatData({ formated: [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }], bias: {}, useStreaming: false, noMultiGen: true, tools: [] }, 'model', null)
        .catch(() => undefined)
    return h.calls.filter((call) => call.via === 'globalFetch')
}

let realFetch: typeof globalThis.fetch

beforeEach(() => {
    h.calls.length = 0
    realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({}), status: 500, ok: false, text: async () => '' })) as unknown as typeof globalThis.fetch
})

afterEach(() => {
    globalThis.fetch = realFetch
})

describe('a non-streamed chat request site delivers while frozen', () => {
    const SITES: Array<[string, string, Record<string, unknown>]> = [
        ['OpenAI chat completions', 'gpt4o', {}],
        ['OpenAI Responses API', 'gpt4o-response-api', {}],
        ['OpenAI legacy instruct', 'instructgpt35', {}],
        ['Mistral', 'mistral-small-latest', {}],
        ['Anthropic direct', 'claude-3-5-sonnet-latest', {}],
        ['NovelAI', 'novelai_kayra', {}],
        ['Ooba', 'ooba', {}],
        ['Mancer (legacy Ooba format)', 'mancer', {}],
        ['Kobold', 'kobold', { koboldURL: 'http://kobold.test' }],
        ['NovelList', 'novellist', {}],
        ['Cohere', 'cohere-command-r', {}],
    ]
    for (const [name, model, extra] of SITES) {
        test(`${name} passes deliverWhileFrozen: true`, async () => {
            const sent = await ask(model, extra)
            expect(sent.length).toBeGreaterThan(0)
            expect(sent.every((call) => call.deliverWhileFrozen === true)).toBe(true)
        })
    }

    test('Bedrock is signed by hand and does not ask for the frozen route', async () => {
        const sent = await ask('anthropic.claude-sonnet-4-5-20250929-v1:0', { claudeAPIKey: 'AKID:SECRET:us-east-1' })
        expect(sent.length).toBeGreaterThan(0)
        expect(sent.every((call) => call.deliverWhileFrozen === undefined)).toBe(true)
    })
})

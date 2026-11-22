/**
 * The tool follow-ups of a Utility workspace run: the request that follows a tool round carries the run's signal, so
 * it skips the plugin body interceptors like the first request, on every non-streamed Utility format and on the
 * Responses API. A role-play tool loop (no registered signal) is still intercepted on both requests.
 *
 * Drives the real `sendUtility`, `requestChatDataMain`, the real tool loops of the OpenAI-compatible, Anthropic,
 * Google (including Vertex) and Responses API paths and the real `globalFetch` and `fetchNative`. Mocked: the platform
 * packages, the page's `fetch` (a fake proxy that answers a tool call and then text), `callTool` (its answer), the
 * stores and the collaborators of the request path. The streamed tool loops are not driven: a workspace run is sent
 * non-streamed, so no workspace request reaches them.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be preserved.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import '../../../polyfill'
import { interceptorsSuppressed, suppressInterceptorsFor } from '../interceptorSuppression'

//#region module mocks

const h = vi.hoisted(() => ({
    interceptors: [] as Array<{ id: string, callback: (body: unknown, type: string) => Promise<unknown> }>,
    seen: [] as string[],
    sent: [] as Array<{ url: string, body: string }>,
    replies: [] as Array<{ status: number, body: unknown }>,
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: vi.fn(async () => '/appdata'), join: vi.fn(async (...p: string[]) => p.join('/')), basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null), open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, createWriteStream: () => ({ ready: Promise.resolve(), writable: { getWriter: () => ({ write: async () => {}, close: async () => {} }) } }) } }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../../platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
vi.mock('../../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn(), installCharacterSaveMarks: vi.fn(), appendIfAbsent: vi.fn() }))

vi.mock('../../../stores.svelte', () => ({
    DBState: { db: {} },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    botMakerMode: writable(false), LoadingStatusState: { text: '' }, savingStoppedReason: writable(null),
    frozenSaveKeysStore: writable([]), peerWaitingStatus: writable(null), MobileGUI: writable(false), loadedStore: writable(false),
    bodyIntercepterStore: h.interceptors,
}))

vi.mock('../../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
    alertMd: vi.fn(), waitAlert: vi.fn(async () => {}), alertNormalWait: vi.fn(), alertAddCharacter: vi.fn(),
}))

vi.mock('../../../storage/nodeStorage', () => ({ getNodeServerProxyAuth: vi.fn(async () => null) }))
vi.mock('../../../update', () => ({ checkRisuUpdate: vi.fn(async () => {}) }))
vi.mock('../../../plugins/plugins.svelte', () => ({
    loadPlugins: vi.fn(async () => {}),
    pluginV2: {
        editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
        replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: vi.fn(),
}))
vi.mock('../../../characterCards', () => ({ characterURLImport: vi.fn(), hubURL: 'https://example.invalid' }))
vi.mock('../../../storage/dbChangeEffects.svelte', () => ({ registerDbChangeEffects: vi.fn() }))
vi.mock('../../../storage/autoStorage', () => ({ AutoStorage: class { async getItem() { return null } async setItem() {} async keys() { return [] as string[] } async removeItem() {} } }))
vi.mock('../../../gui/animation', () => ({ updateAnimationSpeed: vi.fn() }))
vi.mock('../../../gui/colorscheme', () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }))
vi.mock('../../../observer.svelte', () => ({ startObserveDom: vi.fn() }))
vi.mock('../../../gui/guisize', () => ({ updateGuisize: vi.fn() }))
vi.mock('../../../hotkey', () => ({ initMobileGesture: vi.fn() }))
vi.mock('../../modules', () => ({ moduleUpdate: vi.fn(async () => {}) }))
vi.mock('../../coldstorage.svelte', () => ({ getColdStorageItem: vi.fn() }))

vi.mock('../../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))

vi.mock('../../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn(), updateLorebooks: vi.fn((v: unknown) => v) }))
vi.mock('../../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../../files/inlays', () => ({
    getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'x'), supportsInlayImage: vi.fn(() => false),
    saveInlayedSignature: vi.fn(), setInlayAsset: vi.fn(),
}))
vi.mock('../../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn(async () => [{ type: 'text', text: 'listing' }]), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))
vi.mock('../../utility/workspace/workspaceModel.svelte', () => ({ hasWorkspace: vi.fn(() => true) }))
vi.mock('../../utility/workspace/instructionSources', () => ({ buildWorkspaceInstructions: vi.fn(async () => ({ text: '' })) }))

vi.mock('../../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../util')>()),
    sleep: async () => {},
}))

vi.mock('../../../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../storage/tauriByteTransport')>()),
    isDesktopTransport: () => true,
}))

vi.mock('../../../storage/database.svelte', async () => {
    const stores = await import('../../../stores.svelte')
    const state = stores.DBState as unknown as { db: object }
    return {
        appVer: '0.0.0', appSubVer: '', presetTemplate: {}, defaultSdDataFunc: vi.fn(() => ({})), changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

//#endregion

let DBState: { db: Database }
let setPageStorageMode: (typeof import('../../../storage/pageStorageMode'))['setPageStorageMode']
let utility: typeof import('../../utility/utilityConversation.svelte')

beforeAll(async () => {
    DBState = (await import('../../../stores.svelte')).DBState as unknown as { db: Database }
    setPageStorageMode = (await import('../../../storage/pageStorageMode')).setPageStorageMode
    utility = await import('../../utility/utilityConversation.svelte')
}, 60000)

function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: 'k', claudeAPIKey: 'k',
        google: { accessToken: 'k', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 4102444800000, vertexAccessToken: 'cached-token',
        vertexClientEmail: 'sa@proj.iam.gserviceaccount.com', vertexPrivateKey: '',
        top_k: 1, top_p: 1, frequencyPenalty: 0, PresensePenalty: 0, reverseProxyOobaArgs: {}, reverseProxyOobaMode: false,
        modelTools: [], customAPIFormat: 0, customProxyRequestModel: 'proxy-m', forceReplaceUrl: 'http://proxy.test/v1/chat/completions',
        jsonSchemaEnabled: false, jsonSchema: '', extractJson: '', useInstructPrompt: false,
        ...extra,
    } as unknown as Database
}

/** The fake proxy: records the target url and body of every request and answers from the queue, or with a 500. */
const realFetch = globalThis.fetch

function installFetch(): void {
    globalThis.fetch = (vi.fn(async (_proxy: string, init: { body?: unknown, headers?: Record<string, string> }) => {
        const url = decodeURIComponent(init.headers?.['risu-url'] ?? '')
        const body = typeof init.body === 'string' ? init.body : init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : ''
        h.sent.push({ url, body })
        const reply = h.replies.shift() ?? { status: 500, body: {} }
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch)
}

beforeEach(() => {
    h.seen.length = 0
    h.sent.length = 0
    h.replies.length = 0
    h.interceptors.length = 0
    h.interceptors.push({ id: 'spy', callback: async (body, type) => { h.seen.push(type); return body } })
    setPageStorageMode({ kind: 'store2' })
    installFetch()
})

afterEach(() => {
    globalThis.fetch = realFetch
})

async function send(model: string, workspaceId: string | null): Promise<void> {
    installDb({ taskPresets: [{ id: 'p1', name: 'Fixer', instructions: 'Fix text', model }] })
    await utility.newUtilityConversation(async () => true)
    await utility.sendUtility('p1', 'hello', workspaceId)
}

import { WORKSPACE_TOOLS } from '../../mcp/workspaceclient'

const TOOL_CALL = 'list_files'

const FORMATS = [
    {
        name: 'OpenAICompatible', model: 'gpt4o', interceptor: 'openai_basic',
        toolReply: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: TOOL_CALL, arguments: '{}' } }] } }] },
        textReply: { choices: [{ message: { role: 'assistant', content: 'done' } }] },
    },
    {
        name: 'Anthropic', model: 'claude-3-5-sonnet-latest', interceptor: 'anthropic_http',
        toolReply: { content: [{ type: 'tool_use', id: 'c1', name: TOOL_CALL, input: {} }] },
        textReply: { content: [{ type: 'text', text: 'done' }] },
    },
    {
        name: 'GoogleCloud', model: 'gemini-2.5-flash', interceptor: 'gemini_base',
        toolReply: { candidates: [{ content: { parts: [{ functionCall: { name: TOOL_CALL, args: {} } }] } }] },
        textReply: { candidates: [{ content: { parts: [{ text: 'done' }] } }] },
    },
    {
        name: 'VertexAIGemini', model: 'gemini-2.5-flash-vertex', interceptor: 'gemini_base',
        toolReply: { candidates: [{ content: { parts: [{ functionCall: { name: TOOL_CALL, args: {} } }] } }] },
        textReply: { candidates: [{ content: { parts: [{ text: 'done' }] } }] },
    },
    {
        name: 'ResponsesAPI', model: 'gpt4o-response-api', interceptor: 'openai_response_api',
        toolReply: { status: 'completed', output: [{ type: 'function_call', call_id: 'c1', name: TOOL_CALL, arguments: '{}' }] },
        textReply: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] },
    },
]

function queueToolRound(format: (typeof FORMATS)[number]): void {
    h.replies.push({ status: 200, body: format.toolReply }, { status: 200, body: format.textReply })
}

/** A role-play style loop: the same request with the workspace's tools offered, on a signal nothing registered. */
async function rolePlayLoop(model: string): Promise<{ type: string, result: string }> {
    installDb({})
    const { requestChatDataMain } = await import('../request')
    return await requestChatDataMain({
        formated: [{ role: 'user', content: 'hi' }], bias: {}, useStreaming: false, noMultiGen: true,
        tools: WORKSPACE_TOOLS.map((tool) => ({ ...tool, mcpURL: 'internal:mcp' })),
        staticModel: model,
    } as never, 'model', new AbortController().signal) as { type: string, result: string }
}

describe('the follow-up of a workspace tool round', () => {
    for (const format of FORMATS.filter((candidate) => candidate.name !== 'ResponsesAPI')) {
        test(`${format.name}: both requests skip the plugin body interceptors`, async () => {
            queueToolRound(format)

            await send(format.model, 'ws-1')

            expect(h.sent).toHaveLength(2)
            expect(h.seen).toEqual([])
        })
    }

    test('ResponsesAPI: both requests skip the plugin body interceptors', async () => {
        const format = FORMATS[4]
        queueToolRound(format)
        installDb({})
        const controller = new AbortController()
        suppressInterceptorsFor(controller.signal)
        const { requestChatDataMain } = await import('../request')

        await requestChatDataMain({
            formated: [{ role: 'user', content: 'hi' }], bias: {}, useStreaming: false, noMultiGen: true,
            tools: WORKSPACE_TOOLS.map((tool) => ({ ...tool, mcpURL: 'internal:workspace' })),
            staticModel: format.model,
        } as never, 'model', controller.signal)

        expect(h.sent).toHaveLength(2)
        expect(h.seen).toEqual([])
    })
})

describe('the loop of a request whose signal is not a workspace run', () => {
    for (const format of FORMATS) {
        test(`guard: ${format.name}: both requests are intercepted`, async () => {
            queueToolRound(format)

            await rolePlayLoop(format.model)

            expect(h.sent).toHaveLength(2)
            expect(h.seen).toEqual([format.interceptor, format.interceptor])
        })
    }

    test('a derived signal is not suppressed, so it fails closed to running the interceptors', async () => {
        const controller = new AbortController()
        suppressInterceptorsFor(controller.signal)

        expect(interceptorsSuppressed(controller.signal)).toBe(true)
        expect(interceptorsSuppressed(AbortSignal.any([controller.signal]))).toBe(false)
        expect(interceptorsSuppressed(null)).toBe(false)
        expect(interceptorsSuppressed(undefined)).toBe(false)
    })
})

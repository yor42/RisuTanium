/**
 * The Utility request switches on `requestChatDataMain`: a per-request temperature (`temperatureOverride`) and the
 * schema switch (`noJsonSchema`), and the Utility send built on them.
 *
 * Drives the real `requestChatDataMain`, the real OpenAI-compatible, Anthropic and Google (including Vertex) request
 * paths and the real `applyParameters`, and reads the body each provider would send through `previewBody`. Mocked: the
 * transports, the platform and Tauri packages, and the collaborators the request path touches but these tests do not
 * exercise (database and store modules, tokenizer, characters, plugins, MCP, alerts).
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be preserved.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import '../../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    calls: [] as Array<{ url: string, body: string }>,
    replacers: new Set<(formated: unknown, mode: string) => Promise<unknown>>(),
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

function record(url: string, body: unknown) {
    let text = ''
    if (typeof body === 'string') { text = body }
    else if (body instanceof Uint8Array || body instanceof ArrayBuffer) { text = new TextDecoder().decode(body) }
    else if (body !== undefined && body !== null) { text = JSON.stringify(body) }
    h.calls.push({ url: String(url), body: text })
}

vi.mock('../../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string, init?: { body?: unknown }) => {
        record(url, init?.body)
        return new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 500 })
    }),
    globalFetch: vi.fn(async (url: string, opts?: { body?: unknown }) => {
        record(url, opts?.body)
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
        replacerbeforeRequest: h.replacers, replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: vi.fn(),
}))

vi.mock('../../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn(), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))

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
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

//#endregion

type Result = { type: string, result: string }
type Arg = Record<string, unknown>
let requestChatDataMain: (arg: Arg, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let requestChatData: (arg: Arg, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }
let setPageStorageMode: (typeof import('../../../storage/pageStorageMode'))['setPageStorageMode']
let utility: typeof import('../../utility/utilityConversation.svelte')

beforeAll(async () => {
    const request = await import('../request')
    requestChatDataMain = request.requestChatDataMain as never
    requestChatData = request.requestChatData as never
    DBState = (await import('../../../stores.svelte')).DBState as unknown as { db: Database }
    setPageStorageMode = (await import('../../../storage/pageStorageMode')).setPageStorageMode
    utility = await import('../../utility/utilityConversation.svelte')
})

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

beforeEach(() => {
    h.calls.length = 0
    h.replacers.clear()
    setPageStorageMode({ kind: 'store2' })
})

afterEach(() => {
    h.replacers.clear()
})

const messages = () => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

/** The body the provider would send. `previewBody` builds it without any network call. */
async function bodyOf(model: string, extra: Arg = {}, mode = 'model'): Promise<Record<string, unknown>> {
    const out = await requestChatDataMain({ formated: messages(), bias: {}, useStreaming: false, noMultiGen: true, tools: [], staticModel: model, previewBody: true, ...extra }, mode, null)
    expect(out.type).toBe('success')
    const preview = JSON.parse(out.result) as { body: unknown }
    return (typeof preview.body === 'string' ? JSON.parse(preview.body) : preview.body) as Record<string, unknown>
}

interface Format {
    name: string
    model: string
    temperature: (body: Record<string, unknown>) => unknown
    maxTokens: (body: Record<string, unknown>) => unknown
    schemaKey?: (body: Record<string, unknown>) => unknown
}

const generation = (body: Record<string, unknown>) => body.generation_config as Record<string, unknown>

const FORMATS: Format[] = [
    { name: 'OpenAICompatible', model: 'gpt4o', temperature: (b) => b.temperature, maxTokens: (b) => b.max_tokens ?? b.max_completion_tokens, schemaKey: (b) => b.response_format },
    { name: 'Anthropic', model: 'claude-3-5-sonnet-latest', temperature: (b) => b.temperature, maxTokens: (b) => b.max_tokens },
    { name: 'GoogleCloud', model: 'gemini-2.5-flash', temperature: (b) => generation(b).temperature, maxTokens: (b) => generation(b).maxOutputTokens, schemaKey: (b) => generation(b).response_schema },
    { name: 'VertexAIGemini', model: 'gemini-2.5-flash-vertex', temperature: (b) => generation(b).temperature, maxTokens: (b) => generation(b).maxOutputTokens, schemaKey: (b) => generation(b).response_schema },
]

describe('temperatureOverride', () => {
    for (const format of FORMATS) {
        test(`${format.name}: the override replaces the configured temperature and the preset's token limit is used`, async () => {
            installDb({ aiModel: format.model, additionalParams: [], reverseProxyOobaMode: false })

            const body = await bodyOf(format.model, { temperatureOverride: 0.3, maxTokens: 321 })

            expect(format.temperature(body)).toBe(0.3)
            expect(format.maxTokens(body)).toBe(321)
        })

        test(`guard: ${format.name}: without an override the configured temperature is sent`, async () => {
            installDb({ aiModel: format.model })

            const body = await bodyOf(format.model)

            expect(format.temperature(body)).toBe(0.8)
        })

        test(`guard: ${format.name}: without an override the per-mode separate temperature is sent`, async () => {
            installDb({
                aiModel: format.model,
                seperateParametersEnabled: true,
                seperateParameters: { memory: { temperature: 55, top_k: 1, top_p: 1, frequency_penalty: 0, presence_penalty: 0 }, emotion: {}, translate: {}, otherAx: {}, overrides: {} },
            })

            const body = await bodyOf(format.model, {}, 'memory')

            expect(format.temperature(body)).toBe(0.55)
        })

        test(`${format.name}: the override replaces the by-model separate temperature`, async () => {
            installDb({
                aiModel: format.model,
                seperateParametersEnabled: true,
                seperateParametersByModel: true,
                seperateParameters: { memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: { [format.model]: { temperature: 55 } } },
            })

            const body = await bodyOf(format.model, { temperatureOverride: 0.3 })

            expect(format.temperature(body)).toBe(0.3)
        })
    }

    test('a model whose parameter list has no temperature gets no temperature key (OpenAI-compatible)', async () => {
        installDb({ aiModel: 'o3-pro' })

        const body = await bodyOf('o3-pro', { temperatureOverride: 0.3 })

        expect('temperature' in body).toBe(false)
    })

    test('a model whose parameter list has no temperature gets no temperature key (Google)', async () => {
        installDb({ aiModel: 'gemini-flash-latest' })

        const body = await bodyOf('gemini-flash-latest', { temperatureOverride: 0.3 })

        expect('temperature' in generation(body)).toBe(false)
    })

    test('guard: an additional parameter still replaces the preset temperature (OpenAI-compatible)', async () => {
        installDb({ aiModel: 'gpt4o', applyAdditionalParamsToAll: true, additionalParams: [['temperature', '0.9']] })

        const body = await bodyOf('gpt4o', { temperatureOverride: 0.3 })

        expect(body.temperature).toBe(0.9)
    })

    test('by-model separate parameters with no entry for the pinned model throw the named error', async () => {
        installDb({ aiModel: 'gpt4o', seperateParametersEnabled: true, seperateParametersByModel: true, seperateParameters: { memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {} } })

        await expect(bodyOf('gpt4o', { temperatureOverride: 0.3 })).rejects.toThrow('gpt4o')
    })
})

describe('noJsonSchema', () => {
    const schema = JSON.stringify({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false })

    for (const format of FORMATS.filter((candidate) => candidate.schemaKey)) {
        test(`guard: ${format.name}: the global schema is sent when it is on`, async () => {
            installDb({ aiModel: format.model, jsonSchemaEnabled: true, jsonSchema: schema, extractJson: 'a' })

            const body = await bodyOf(format.model)

            expect(format.schemaKey?.(body)).toBeDefined()
        })

        test(`${format.name}: noJsonSchema keeps the global schema out of the body`, async () => {
            installDb({ aiModel: format.model, jsonSchemaEnabled: true, jsonSchema: schema, extractJson: 'a' })

            const body = await bodyOf(format.model, { noJsonSchema: true, extractJson: '' })

            expect(format.schemaKey?.(body)).toBeUndefined()
            if (format.name !== 'OpenAICompatible') {
                expect(generation(body).response_mime_type).toBeUndefined()
            }
        })
    }
})

describe('the Utility send', () => {
    function lastTurn() {
        return utility.utilityConversation.turns[utility.utilityConversation.turns.length - 1]
    }

    async function freshConversation(): Promise<void> {
        await utility.newUtilityConversation(async () => true)
    }

    function installUtilityDb(preset: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
        installDb({ taskPresets: [{ id: 'p1', name: 'Fixer', instructions: 'Fix {{char}} text', model: 'claude-3-5-sonnet-latest', ...preset }], ...extra })
    }

    test('the pinned model is used, not the configured one', async () => {
        installUtilityDb({})
        await freshConversation()

        await utility.sendUtility('p1', 'hello')

        const sent = h.calls.find((call) => call.url.includes('api.anthropic.com'))
        expect(sent).toBeDefined()
        expect(h.calls.some((call) => call.url.includes('api.openai.com'))).toBe(false)
    })

    test('the text is sent literally: no replacer, trigger or macro expansion reaches the body', async () => {
        h.replacers.add(async (formated) => (formated as Array<{ content: string }>).map((m) => ({ ...m, content: `${m.content}[REPLACED]` })))
        installUtilityDb({})
        await freshConversation()

        await utility.sendUtility('p1', 'hello')

        const sent = h.calls.find((call) => call.url.includes('api.anthropic.com'))
        expect(sent?.body).toContain('Fix {{char}} text')
        expect(sent?.body).not.toContain('[REPLACED]')
    })

    test('guard: the replacer does reach a request made through requestChatData', async () => {
        h.replacers.add(async (formated) => (formated as Array<{ content: string }>).map((m) => ({ ...m, content: `${m.content}[REPLACED]` })))
        installDb({})

        const out = await requestChatData({ formated: messages(), bias: {}, useStreaming: false, noMultiGen: true, tools: [], previewBody: true }, 'model', null)

        expect(out.result).toContain('[REPLACED]')
    })

    test('an unknown separate-parameters model is an inline failure with the named text and no alert', async () => {
        const alerts = await import('../../../alert')
        installUtilityDb({}, { seperateParametersEnabled: true, seperateParametersByModel: true, seperateParameters: { memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {} } })
        await freshConversation()

        await utility.sendUtility('p1', 'hello')

        expect(lastTurn().state).toBe('failed')
        expect(lastTurn().error).toContain('claude-3-5-sonnet-latest')
        expect(alerts.alertError).not.toHaveBeenCalled()
        expect(utility.utilityConversation.runId).toBeNull()
    })

    test('the global JSON schema and extraction settings stay out of a Utility body', async () => {
        installUtilityDb({ model: 'gpt4o' }, { jsonSchemaEnabled: true, jsonSchema: JSON.stringify({ type: 'object', properties: {} }), extractJson: 'a' })
        await freshConversation()

        await utility.sendUtility('p1', 'hello')

        const sent = h.calls.find((call) => call.url.includes('api.openai.com'))
        expect(sent).toBeDefined()
        expect(sent?.body).not.toContain('response_format')
    })
})

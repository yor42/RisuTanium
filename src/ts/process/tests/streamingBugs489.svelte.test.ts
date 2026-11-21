/**
 * Three streamed-reply contracts of the request modules (#489):
 *
 * - A tool round's follow-up stream that yields no chunk ends the reply. The previous round's tool calls are
 *   not dispatched again (Gemini and OpenAI-compatible streaming, which share the wrapper shape).
 * - OpenAI-compatible streaming with several generations hands every generation's key to the consumer, which
 *   turns each into a reroll candidate.
 * - Legacy Ooba websocket streaming emits chunk records keyed "0", the shape the reply consumer reads; a bare
 *   string would be read as its first character.
 *
 * Drives the real `requestChatData` and the real provider request modules. Only the network (`globalFetch`,
 * `fetchNative`, a stub `WebSocket`), the tool path (`callTool` is a spy), the tokenizer and the platform
 * packages are fakes, so nothing here says anything about a native backend or a live provider reply.
 */
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'

//#region module mocks

type Recorded = { transport: 'global' | 'native', url: string, interceptor: string | undefined, signal: AbortSignal | null | undefined }

const h = vi.hoisted(() => ({
    /** Every provider request, `globalFetch` and `fetchNative` together, in order. */
    requests: [] as Array<{ transport: 'global' | 'native', url: string, interceptor: string | undefined, signal: AbortSignal | null | undefined }>,
    /** The answer to request number `index`. */
    responder: null as null | ((index: number) => unknown),
    /** Runs after the entry check of a request; a defined return value is the answer instead of the responder's. */
    override: null as null | ((index: number) => unknown),
    alerts: [] as string[],
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: () => {} }))

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''), bodyIntercepterStore: [] as unknown[],
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn((message: string) => { h.alerts.push(message) }), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string, options: { signal?: AbortSignal | null, interceptor?: string }) => {
        const index = h.requests.length
        h.requests.push({ transport: 'native', url, interceptor: options?.interceptor, signal: options?.signal })
        if (options?.signal?.aborted) {
            throw new Error('aborted')
        }
        const forced = h.override?.(index)
        if (forced !== undefined) {
            return forced
        }
        return h.responder!(index)
    }),
    globalFetch: vi.fn(async (url: string, options: { abortSignal?: AbortSignal | null, interceptor?: string }) => {
        const index = h.requests.length
        h.requests.push({ transport: 'global', url, interceptor: options?.interceptor, signal: options?.abortSignal })
        if (options?.abortSignal?.aborted) {
            return { ok: false, data: 'aborted', status: 400 }
        }
        const forced = h.override?.(index)
        if (forced !== undefined) {
            return forced
        }
        return h.responder!(index)
    }),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(),
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

const m = vi.hoisted(() => ({ callTool: vi.fn() }))

// The tool path is a spy: what a loop dispatches is what this file counts.
vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: m.callTool, decodeToolCall: vi.fn(), encodeToolCall: vi.fn(async () => '') }))

vi.mock('../transformers', () => ({
    runTransformers: vi.fn(async () => ({ generated_text: '' })),
    runImageEmbedding: vi.fn(),
}))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    let selected = -1
    stores.selectedCharID.subscribe((v: number) => { selected = v })
    const getCurrentCharacter = () => state.db.characters?.[selected]
    const getCurrentChat = () => { const c = getCurrentCharacter(); return c?.chats?.[c.chatPage] }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(getCurrentCharacter), getCurrentChat: vi.fn(getCurrentChat),
    }
})

//#endregion

//#region fixtures

type Result = { type: string, result: unknown }
type Chunk = Record<string, string>

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>

beforeAll(async () => {
    const request = await import('../request/request')
    requestChatData = request.requestChatData as never
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
})

beforeEach(() => {
    h.requests.length = 0
    h.responder = null
    h.override = null
    h.alerts.length = 0
    m.callTool.mockReset()
    m.callTool.mockResolvedValue([{ type: 'text', text: 'tool-out' }])
})

function installDb(model: string, extra: Record<string, unknown> = {}): void {
    const character = {
        chaId: 'a', name: 'AliceName', type: 'character', chatPage: 0, triggerscript: [], modules: [], customscript: [], globalLore: [],
        lowLevelAccess: false, defaultVariables: '',
        chats: [{ id: 'cA', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
    }
    DBState.db = {
        characters: [character], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 2, banCharacterset: [],
        aiModel: model, subModel: model, maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser',
        personas: [{ id: 'p-S', name: 'Persona', personaPrompt: '', icon: '' }], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: true, openAIKey: 'k', useInstructPrompt: false,
        ...extra,
    } as unknown as Database
    selectedCharID.set(0)
}

const prompt = () => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

const TOOLS = [{ name: 'lookup', description: 'd', inputSchema: { type: 'object', properties: { q: { type: 'number' } } }, mcpURL: 'https://u.test/mcp' }]

function sse(events: string[]) {
    const enc = new TextEncoder()
    return {
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: new ReadableStream<Uint8Array>({ start(c) { if (events.length > 0) { c.enqueue(enc.encode(events.join(''))) } c.close() } }),
    }
}
const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

/** Drains a streaming result; keeps every chunk and the error that ended the stream, if any. */
async function drain(result: Result): Promise<{ chunks: Chunk[], error: Error | null }> {
    expect(result.type).toBe('streaming')
    const chunks: Chunk[] = []
    let error: Error | null = null
    try {
        const reader = (result.result as ReadableStream<Chunk>).getReader()
        while (true) {
            const { done, value } = await reader.read()
            if (done) { break }
            chunks.push(value)
        }
    }
    catch (e) {
        error = e as Error
    }
    return { chunks, error }
}

//#endregion

describe('an empty follow-up stream ends the tool loop', () => {
    const cases = [
        {
            id: 'G2', model: 'gemini-3.8-flash', extra: { google: { accessToken: 'k' } },
            toolReply: () => sse([data({ candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: { q: 1 } } }] } }] })]),
        },
        {
            id: 'O2', model: 'gpt4o', extra: {},
            toolReply: () => sse([data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c0', function: { name: 'lookup', arguments: '{"q":1}' } }] } }] }), 'data: [DONE]\n\n']),
        },
    ] as const

    test.each(cases)('$id: the previous round\'s tool calls are dispatched once, and the stream ends cleanly', async ({ model, extra, toolReply }) => {
        installDb(model, extra)
        h.responder = (index) => index === 0 ? toolReply() : sse([])

        const result = await requestChatData({ formated: prompt(), bias: {}, useStreaming: true, noMultiGen: true, tools: TOOLS }, 'model', null)
        const { error } = await drain(result)

        expect(m.callTool.mock.calls, 'tool calls dispatched').toHaveLength(1)
        expect(h.requests, 'provider requests: the first and one follow-up').toHaveLength(2)
        expect(error, 'the stream ends without the round-cap error').toBeNull()
        expect(h.alerts).toEqual([])
    })
})

describe('OpenAI-compatible streaming with several generations', () => {
    test('every generation key reaches the consumer', async () => {
        installDb('gpt4o', { genTime: 2 })
        h.responder = () => sse([
            data({ choices: [{ index: 0, delta: { content: 'first' } }, { index: 1, delta: { content: 'second' } }] }),
            data({ choices: [{ index: 1, delta: { content: ' more' } }] }),
            'data: [DONE]\n\n',
        ])

        const result = await requestChatData({ formated: prompt(), bias: {}, useStreaming: true, tools: [] }, 'model', null)
        const { chunks, error } = await drain(result)

        expect(error).toBeNull()
        const last = chunks.at(-1)
        expect(last?.['0']).toBe('first')
        expect(last?.['1']).toBe('second more')
    })

    test('guard: a single generation streams key 0 only', async () => {
        installDb('gpt4o', { genTime: 1 })
        h.responder = () => sse([data({ choices: [{ index: 0, delta: { content: 'only' } }] }), 'data: [DONE]\n\n'])

        const result = await requestChatData({ formated: prompt(), bias: {}, useStreaming: true, tools: [] }, 'model', null)
        const { chunks } = await drain(result)

        expect(Object.keys(chunks.at(-1) ?? {})).toEqual(['0'])
        expect(chunks.at(-1)?.['0']).toBe('only')
    })
})

describe('legacy Ooba websocket streaming', () => {
    class FakeSocket {
        static last: FakeSocket | null = null
        onopen: (() => void) | null = null
        onerror: (() => void) | null = null
        onclose: ((e: { code: number }) => void) | null = null
        onmessage: ((e: { data: string }) => void) | null = null
        sent: string[] = []
        constructor(public url: string) {
            FakeSocket.last = this
            queueMicrotask(() => this.onopen?.())
        }
        send(payload: string) {
            this.sent.push(payload)
            queueMicrotask(() => {
                for (const event of [{ event: 'text_stream', text: 'Hel' }, { event: 'text_stream', text: 'lo' }, { event: 'stream_end' }]) {
                    this.onmessage?.({ data: JSON.stringify(event) })
                }
            })
        }
        close() {}
    }

    test('chunks are records keyed "0" holding the cumulative text', async () => {
        vi.stubGlobal('WebSocket', FakeSocket)
        try {
            installDb('mancer', {
                textgenWebUIStreamURL: 'wss://ooba.test/api/v1/stream', textgenWebUIBlockingURL: 'https://ooba.test/api/v1/generate',
                ooba: { formating: { userPrefix: '', seperator: '' } }, localStopStrings: null, instructChatTemplate: 'jinja', JinjaTemplate: '{% for m in messages %}{{ m.content }}{% endfor %}',
            })

            const result = await requestChatData({ formated: prompt(), bias: {}, useStreaming: true }, 'model', null)
            const { chunks, error } = await drain(result)

            expect(error).toBeNull()
            expect(FakeSocket.last?.sent, 'the request was sent').toHaveLength(1)
            expect(chunks).toEqual([{ '0': 'Hel' }, { '0': 'Hello' }])
        }
        finally {
            vi.unstubAllGlobals()
        }
    })
})

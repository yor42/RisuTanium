/**
 * The Gemini streaming tool loop prefixes every later iteration with the earlier iterations' output, each
 * wrapped in its own `<Thoughts>` block. This drives the real `requestChatData` and the real google.ts
 * stream (two iterations: thought + text + functionCall, then thought + text) and captures the text the
 * loop finally hands to the chat. Only the network (`fetchNative`), the tool registry and the platform/IO
 * packages are mocked, so nothing here says anything about a native backend or a real Gemini server.
 */
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'
import { GEMINI_TOOL_LOOP_TEXT } from './fixtures/geminiToolLoopThoughts'

//#region module mocks

const h = vi.hoisted(() => ({
    nativeScript: [] as unknown[],
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

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''), bodyIntercepterStore: [] as unknown[],
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async () => h.nativeScript.shift()),
    globalFetch: vi.fn(async () => ({ ok: true, data: {} })),
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

// `encodeToolCall` writes the record that the chat later decodes and returns the reference the chat stores.
vi.mock('../mcp/mcp', () => ({
    getTools: vi.fn(async () => []),
    callTool: vi.fn(async () => [{ type: 'text', text: 'tool-out' }]),
    decodeToolCall: vi.fn(),
    encodeToolCall: vi.fn(async (call: { call: { id?: string, name: string } }) => `<tool_call>${call.call.id}${call.call.name}</tool_call>\n\n`),
}))

vi.mock('../transformers', () => ({ runTransformers: vi.fn(), runImageEmbedding: vi.fn() }))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: Record<string, unknown> }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

//#endregion

//#region fixtures

type Msg = { role: string, content: string }

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<{ type: string, result: unknown }>
let DBState: { db: Database }

beforeAll(async () => {
    requestChatData = (await import('../request/request')).requestChatData as never
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }
})

function installDb(extra: Record<string, unknown> = {}): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 2, banCharacterset: [],
        aiModel: 'gemini-3.8-flash', subModel: 'gemini-3.8-flash', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser',
        personas: [], selectedPersona: 0, seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, useStreaming: true, google: { accessToken: 'k' },
        rememberToolUsage: true, simplifiedToolUse: false, streamGeminiThoughts: false,
        ...extra,
    } as unknown as Database
}

function sseBytes(events: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder()
    return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(events.join(''))); c.close() } })
}

const sse = (parts: unknown[]) => `data: ${JSON.stringify({ candidates: [{ content: { parts } }] })}\n\n`

/** The tool's client URL as `getTools` reports it. */
const TOOLS = [{ name: 'lookup', description: 'd', inputSchema: { type: 'object', properties: { q: { type: 'number' } } }, mcpURL: 'https://u.test/mcp' }]

/** Reads a stream to its end and returns the text of its last chunk, which is the whole text the chat shows. */
async function lastChunkText(stream: ReadableStream<Record<string, string>>): Promise<string> {
    let last = ''
    const reader = stream.getReader()
    while (true) {
        const { done, value } = await reader.read()
        if (done) { break }
        last = value['0'] ?? last
    }
    return last
}

beforeEach(() => {
    h.nativeScript.length = 0
})

//#endregion

describe('the Gemini streaming tool loop, two iterations with a thought each', () => {
    test('produces the captured text of the fixture', async () => {
        installDb()
        h.nativeScript.push(
            { status: 200, body: sseBytes([sse([{ text: 'THOUGHT-ONE', thought: true }, { text: 'MIDDLE' }, { functionCall: { id: 'call-1', name: 'lookup', args: { q: 1 } } }])]) },
            { status: 200, body: sseBytes([sse([{ text: 'THOUGHT-TWO', thought: true }, { text: 'END' }])]) },
        )

        const prompt: Msg[] = [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]
        const result = await requestChatData({ formated: prompt, bias: {}, useStreaming: true, noMultiGen: true, tools: TOOLS, rememberToolUsage: true }, 'model')
        expect(result.type).toBe('streaming')
        const text = await lastChunkText(result.result as ReadableStream<Record<string, string>>)

        expect(text).toBe(GEMINI_TOOL_LOOP_TEXT)
        expect(text.match(/<Thoughts>/g)).toHaveLength(2)
        const between = text.slice(text.indexOf('</Thoughts>'), text.lastIndexOf('<Thoughts>'))
        expect(between).toContain('MIDDLE')
        expect(between).toContain('<tool_call')
    })
})

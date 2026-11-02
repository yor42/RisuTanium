/**
 * One user turn spends at most 25 tool rounds, in every tool loop the request modules run themselves
 * (Anthropic, OpenAI-compatible and Responses, each streaming and not, and Gemini, streaming and not),
 * however the rounds are reached: by recursion, by a retried follow-up, or by a wrapper retry or fallback.
 * A spent budget fails the turn with an error that names the cap and is never retried. The caller's Stop
 * ends every loop quietly: no later block is dispatched, no later request is sent, and the "Failed to fetch
 * model response after tool execution" alert is not shown for a request that Stop itself cut short.
 *
 * Drives the real `requestChatData`, `requestChatDataMain` and the real provider request modules. Only the
 * network (`globalFetch`, `fetchNative`), the tool path (`callTool` is a spy), the tokenizer and the
 * platform packages are recording fakes, so nothing here says anything about a native backend, a real MCP
 * server or a live provider reply. The abort behaviour of the two transports is a stand-in: `globalFetch`
 * answers `ok: false` when its signal is already aborted, and `fetchNative` throws when its signal is
 * already aborted.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be
 * preserved.
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

type Fixture = Record<string, unknown>
type Msg = { role: string, content: string }
type Result = { type: string, result: unknown }
type Kind = 'A1' | 'O1' | 'O2' | 'R1' | 'R2' | 'G1' | 'G2'
type Loop = { kind: Kind, model: string, extra: Fixture, streaming: boolean }

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let requestChatDataMain: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>

beforeAll(async () => {
    const request = await import('../request/request')
    requestChatData = request.requestChatData as never
    requestChatDataMain = request.requestChatDataMain as never
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

const LOOPS: Loop[] = [
    { kind: 'A1', model: 'claude-opus-5', extra: { claudeAPIKey: 'k', thinkingType: 'off' }, streaming: false },
    { kind: 'O1', model: 'gpt4o', extra: {}, streaming: false },
    { kind: 'O2', model: 'gpt4o', extra: {}, streaming: true },
    { kind: 'R1', model: 'gpt4o-response-api', extra: { modelTools: [] }, streaming: false },
    { kind: 'R2', model: 'gpt4o-response-api', extra: { modelTools: [] }, streaming: true },
    { kind: 'G1', model: 'gemini-3.8-flash', extra: { google: { accessToken: 'k' } }, streaming: false },
    { kind: 'G2', model: 'gemini-3.8-flash', extra: { google: { accessToken: 'k' } }, streaming: true },
]
const loopOf = (kind: Kind): Loop => LOOPS.find((loop) => loop.kind === kind)!

function installDb(loop: Loop, extra: Fixture = {}): void {
    const character = {
        chaId: 'a', name: 'AliceName', type: 'character', chatPage: 0, triggerscript: [], modules: [], customscript: [], globalLore: [],
        lowLevelAccess: false, defaultVariables: '',
        chats: [{ id: 'cA', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
    }
    DBState.db = {
        characters: [character], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 2, banCharacterset: [],
        aiModel: loop.model, subModel: loop.model, maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser',
        personas: [{ id: 'p-S', name: 'Persona', personaPrompt: '', icon: '' }], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: loop.streaming, openAIKey: 'k', useInstructPrompt: false,
        ...loop.extra, ...extra,
    } as unknown as Database
    selectedCharID.set(0)
}

const prompt = (): Msg[] => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

const U = 'https://u.test/mcp'
const TOOLS = [{ name: 'lookup', description: 'd', inputSchema: { type: 'object', properties: { q: { type: 'number' } } }, mcpURL: U }]
const ARGS = '{"q":1}'

function sse(events: string[]) {
    const enc = new TextEncoder()
    return {
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(events.join(''))); c.close() } }),
    }
}
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

/** A reply of loop `kind` that asks for `blocks` calls of `lookup`; `n` keeps the call ids distinct. */
function toolAnswer(kind: Kind, n: number, blocks = 1): unknown {
    const ids = Array.from({ length: blocks }, (_, i) => `c${n}_${i}`)
    switch (kind) {
        case 'A1': return { ok: true, data: { content: ids.map((id) => ({ type: 'tool_use', id, name: 'lookup', input: { q: 1 } })) } }
        case 'O1': return { ok: true, data: { choices: [{ message: { role: 'assistant', content: null, tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'lookup', arguments: ARGS } })) } }] } }
        case 'R1': return { ok: true, data: { output: ids.map((id) => ({ id: `fc_${id}`, type: 'function_call', call_id: id, name: 'lookup', arguments: ARGS, status: 'completed' })) } }
        case 'G1': return okJson({ candidates: [{ content: { parts: ids.map(() => ({ functionCall: { name: 'lookup', args: { q: 1 } } })) } }] })
        case 'O2': return sse([data({ choices: [{ delta: { tool_calls: ids.map((id, index) => ({ index, id, function: { name: 'lookup', arguments: ARGS } })) } }] }), 'data: [DONE]\n\n'])
        case 'R2': return sse([data({ type: 'response.completed', response: { output_text: 'step', output: ids.map((id) => ({ id: `fc_${id}`, type: 'function_call', call_id: id, name: 'lookup', arguments: ARGS, status: 'completed' })) } })])
        case 'G2': return sse([data({ candidates: [{ content: { parts: ids.map(() => ({ functionCall: { name: 'lookup', args: { q: 1 } } })) } }] })])
    }
}

/** The closing text reply of loop `kind`. */
function textAnswer(kind: Kind): unknown {
    switch (kind) {
        case 'A1': return { ok: true, data: { content: [{ type: 'text', text: 'done' }] } }
        case 'O1': return { ok: true, data: { choices: [{ message: { role: 'assistant', content: 'done' } }] } }
        case 'R1': return { ok: true, data: { output_text: 'final' } }
        case 'G1': return okJson({ candidates: [{ content: { parts: [{ text: 'done' }] } }] })
        case 'O2': return sse([data({ choices: [{ delta: { content: 'done' } }] }), 'data: [DONE]\n\n'])
        case 'R2': return sse([data({ type: 'response.completed', response: { output_text: 'final', output: [{ type: 'message', content: [{ type: 'output_text', text: 'final' }] }] } })])
        case 'G2': return sse([data({ candidates: [{ content: { parts: [{ text: 'done' }] } }] })])
    }
}

/** Every reply asks for tools until `toolReplies` tool replies were given, then answers with text. */
function chain(kind: Kind, toolReplies: number, blocks = 1): (index: number) => unknown {
    let given = 0
    return (index) => {
        if (given < toolReplies) {
            given++
            return toolAnswer(kind, index, blocks)
        }
        return textAnswer(kind)
    }
}

type Outcome = { result: Result, error: Error | null }

/** Runs a request of `loop`; a streaming result is drained to its end and the error that ended it, if any, is kept. */
async function run(loop: Loop, options: { controller?: AbortController, main?: boolean, arg?: Fixture } = {}): Promise<Outcome> {
    const send = options.main ? requestChatDataMain : requestChatData
    const result = await send({
        formated: prompt(), bias: {}, useStreaming: loop.streaming, noMultiGen: true, tools: TOOLS, ...options.arg,
    }, 'model', options.controller?.signal ?? null)
    if (result.type !== 'streaming') {
        return { result, error: null }
    }
    let error: Error | null = null
    try {
        const reader = (result.result as ReadableStream<Record<string, string>>).getReader()
        while (!(await reader.read()).done) { /* drain */ }
    }
    catch (e) {
        error = e as Error
    }
    return { result, error }
}

/** The tool spy stops the caller during its first call. */
function stopDuringFirstCall(controller: AbortController): void {
    m.callTool.mockImplementation(async () => {
        controller.abort()
        return [{ type: 'text', text: 'tool-out' }]
    })
}

const FOLLOW_UP_ALERT = 'Failed to fetch model response after tool execution'

//#endregion

describe('a turn is bounded to 25 tool rounds in every loop', () => {
    test.each(LOOPS.map((loop, index) => [`S2-R${index + 1}`, loop.kind] as const))('%s %s stops at exactly 25 rounds and fails the turn naming the cap', async (_id, kind) => {
        const loop = loopOf(kind)
        installDb(loop)
        h.responder = chain(kind, 30)

        const { result, error } = await run(loop)

        expect(m.callTool.mock.calls, 'tool calls dispatched').toHaveLength(25)
        expect(h.requests, 'provider requests: the first and one follow-up per round').toHaveLength(26)
        if (loop.streaming) {
            expect(result.type).toBe('streaming')
            expect(error?.message, 'the stream error').toContain('25')
        }
        else {
            expect(result.type).toBe('fail')
            expect(String(result.result)).toContain('25')
        }
        expect(h.alerts).toEqual([])
    })

    test('S2-R8 a spent budget is not retried and does not move to a fallback model', async () => {
        const loop = loopOf('A1')
        installDb(loop, { fallbackModels: { model: ['claude-opus-5'] } })
        h.responder = chain('A1', 30)

        const { result } = await run(loop)

        expect(h.requests, 'provider requests').toHaveLength(26)
        expect(result.type).toBe('fail')
        expect(String(result.result)).toContain('25')
    })

    test('S2-R9 a retried follow-up does not take a round', async () => {
        const loop = loopOf('O1')
        installDb(loop)
        let toolReplies = 0
        let lastWasTool = false
        h.responder = (index) => {
            if (index > 0 && lastWasTool) {
                lastWasTool = false
                return { ok: false, data: { error: { message: 'boom' } } }
            }
            if (toolReplies < 30) {
                toolReplies++
                lastWasTool = true
                return toolAnswer('O1', index)
            }
            return textAnswer('O1')
        }

        const { result } = await run(loop)

        expect(m.callTool.mock.calls, 'tool calls dispatched').toHaveLength(25)
        expect(result.type).toBe('fail')
        expect(String(result.result)).toContain('25')
    })

    test('S2-R10 a wrapper retry of a failed follow-up continues the same budget', async () => {
        const loop = loopOf('A1')
        installDb(loop)
        let toolReplies = 0
        h.responder = (index) => {
            if (index === 10) {
                return { ok: false, data: 'boom' }
            }
            if (toolReplies < 30) {
                toolReplies++
                return toolAnswer('A1', index)
            }
            return textAnswer('A1')
        }

        const { result } = await run(loop)

        expect(m.callTool.mock.calls, 'tool calls dispatched in total').toHaveLength(25)
        expect(result.type).toBe('fail')
        expect(String(result.result)).toContain('25')
    })
})

describe('Stop during a round ends every loop at once', () => {
    test.each(LOOPS.map((loop, index) => [index === 0 ? 'guard: S2-G8' : `S2-R${index + 10}`, loop.kind] as const))('%s %s skips the remaining blocks, the next round and the retries, with no alert', async (_id, kind) => {
        const loop = loopOf(kind)
        installDb(loop)
        const controller = new AbortController()
        stopDuringFirstCall(controller)
        h.responder = chain(kind, 30, 2)

        const { result, error } = await run(loop, { controller })

        expect(m.callTool.mock.calls, 'tool calls dispatched').toHaveLength(1)
        expect(h.requests, 'provider requests').toHaveLength(1)
        expect(h.alerts).toEqual([])
        if (loop.streaming) {
            expect(error, 'the stream ends cleanly').toBeNull()
        }
        else {
            expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
        }
    })

    test('S2-R19 O1: a Stop during the last attempt of the follow-up ends the turn without the alert', async () => {
        const loop = loopOf('O1')
        installDb(loop, { requestRetrys: 0 })
        const controller = new AbortController()
        h.responder = chain('O1', 1)
        h.override = (index) => {
            if (index === 1) {
                controller.abort()
                return { ok: false, data: 'aborted', status: 400 }
            }
            return undefined
        }

        const { result } = await run(loop, { controller, main: true })

        expect(h.alerts, 'alerts shown').toEqual([])
        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
    })

    test('S2-R20 G1: a Stop after a failed head arrived ends the turn without the alert', async () => {
        const loop = loopOf('G1')
        installDb(loop, { requestRetrys: 0 })
        const controller = new AbortController()
        h.responder = chain('G1', 1)
        h.override = (index) => {
            if (index === 1) {
                controller.abort()
                return { ok: false, status: 500, text: async () => 'server error' }
            }
            return undefined
        }

        const { result } = await run(loop, { controller, main: true })

        expect(h.alerts, 'alerts shown').toEqual([])
        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
    })

    test('S2-R21 R1: a Stop during the last attempt of the follow-up ends the turn as stopped', async () => {
        const loop = loopOf('R1')
        installDb(loop, { requestRetrys: 0 })
        const controller = new AbortController()
        h.responder = chain('R1', 1)
        h.override = (index) => {
            if (index === 1) {
                controller.abort()
                return { ok: false, data: 'aborted', status: 400 }
            }
            return undefined
        }

        const { result } = await run(loop, { controller, main: true })

        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
    })

    test.each([['S2-R22', 'O2'], ['S2-R23', 'R2'], ['S2-R24', 'G2']] as const)('%s %s: a Stop after a failed head arrived ends the stream without the alert', async (_id, kind) => {
        const loop = loopOf(kind)
        installDb(loop, { requestRetrys: 0 })
        const controller = new AbortController()
        h.responder = chain(kind, 1)
        h.override = (index) => {
            if (index === 1) {
                controller.abort()
                return { ...sse([]), status: 500 }
            }
            return undefined
        }

        const { error } = await run(loop, { controller, main: true })

        expect(h.alerts, 'alerts shown').toEqual([])
        expect(error).toBeNull()
    })
})

describe('what is bounded by neither the cap nor Stop is unchanged', () => {
    test.each(LOOPS.map((loop) => [loop.kind] as const))('guard: S2-G1 %s a 3-round chain completes with its final text', async (kind) => {
        const loop = loopOf(kind)
        installDb(loop)
        h.responder = chain(kind, 3)

        const { result, error } = await run(loop)

        expect(error).toBeNull()
        expect(m.callTool.mock.calls).toHaveLength(3)
        expect(h.requests).toHaveLength(4)
        if (!loop.streaming) {
            expect(result.type).toBe('success')
        }
        expect(h.alerts).toEqual([])
    })

    test('guard: S2-G2 O1 a follow-up that fails beyond its retries still returns the partial reply and the alert', async () => {
        const loop = loopOf('O1')
        installDb(loop)
        h.responder = (index) => index === 0 ? toolAnswer('O1', index) : { ok: false, data: { error: { message: 'boom' } } }

        const { result } = await run(loop, { main: true })

        expect(result.type).toBe('success')
        expect(h.alerts).toEqual([FOLLOW_UP_ALERT])
        expect(h.requests, 'the first request and three attempts').toHaveLength(4)
    })

    test('guard: S2-G6 G1 a Stop that makes the follow-up throw still gives the silent result and no alert', async () => {
        const loop = loopOf('G1')
        installDb(loop, { requestRetrys: 0 })
        const controller = new AbortController()
        h.responder = chain('G1', 1)
        h.override = (index) => {
            if (index === 1) {
                controller.abort()
                throw new Error('aborted')
            }
            return undefined
        }

        const { result } = await run(loop, { controller })

        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
        expect(h.alerts).toEqual([])
        expect(h.requests).toHaveLength(2)
    })

    test('guard: S2-G7 a caller without a signal runs a chain to its end', async () => {
        const loop = loopOf('A1')
        installDb(loop)
        h.responder = chain('A1', 2)

        const { result } = await run(loop)

        expect(result).toMatchObject({ type: 'success', result: 'done' })
        expect(h.requests.every((request: Recorded) => request.signal === null || request.signal === undefined)).toBe(true)
    })
})

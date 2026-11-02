/**
 * The non-streaming Anthropic loop dispatches only tools the request advertised. A `tool_use` for any other
 * name is answered with a "not available" `tool_result` that keeps the model's call paired, and is never handed
 * to the MCP registry: routing it would search every module's client, start the stdio programs that were
 * approved and ask for consent for the ones that were not, and reach `internal:risuai`. The same loop also
 * honours the caller's Stop: the signal reaches the fetch, and no later block or follow-up request is sent.
 *
 * Drives the real `requestChatData`, `requestChatDataMain`, `requestClaude`, `mcp.ts`, `modules`, the stdio
 * approval gate and the Utility conversation. The network (`globalFetch`), the MCP clients, the shell plugin,
 * the `internal:risuai` client and the prompt are recording fakes, so nothing here says anything about a
 * native spawn or a live Anthropic reply (whether Anthropic accepts a `tool_use` and a `tool_result` in a
 * request that lists no `tools` is not established).
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be
 * preserved.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { ByteStore } from '../../storage/store/contract'
import { createMemoryByteStore } from '../files/tests/memoryByteStore'
import '../../polyfill'

//#region module mocks

type FetchCall = { url: string, body: Record<string, unknown>, abortSignal: AbortSignal | undefined }
type FetchOptions = { body: Record<string, unknown>, abortSignal?: AbortSignal }

const h = vi.hoisted(() => ({
    /** Every `globalFetch` call, in order. */
    fetches: [] as Array<{ url: string, body: Record<string, unknown>, abortSignal: AbortSignal | undefined }>,
    /** Scripted answers of `globalFetch`, taken before the default text answer. */
    script: [] as Array<(call: { url: string, body: Record<string, unknown>, abortSignal: AbortSignal | undefined }, options: { body: Record<string, unknown> }) => unknown>,
    /** Runs when a fake MCP client is called. */
    onClientCall: null as null | ((name: string) => void),
    prompts: [] as string[],
    answers: [true] as boolean[],
    store: null as ByteStore | null,
    /** Calls to `getModuleMcpEntries`, with the number of `globalFetch` calls made before each. */
    entryCalls: [] as number[],
    /** Runs when the remembered-tool-call store is written. */
    onEncode: null as null | (() => void),
}))

const shell = vi.hoisted(() => ({
    created: [] as string[],
}))

const f = vi.hoisted(() => ({
    /** The URLs of the fake MCP clients that were constructed. */
    created: [] as string[],
    /** Tool calls that reached a fake MCP client: `<url>#<tool>`. */
    calls: [] as string[],
    /** Constructions of the fake `internal:risuai` client. */
    risuaccessBuilt: 0,
    risuaccessCalls: [] as string[],
}))

const SENTINEL = 'OTHER-DESC-SECRET'

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { h.onEncode?.() }), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: true, isNodeServer: false }))
vi.mock('../../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../storage/tauriByteTransport')>()),
    isAndroidTransport: () => false,
    isDesktopTransport: () => true,
}))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: () => {} }))
vi.mock('../../storage/store/appStore', () => ({ getAppStore: async () => h.store }))

vi.mock('@tauri-apps/plugin-shell', () => ({
    Command: {
        create: (command: string) => {
            shell.created.push(command)
            let onLine: ((line: string) => void) | null = null
            return {
                stdout: { on: (_event: string, callback: (line: string) => void) => { onLine = callback } },
                spawn: async () => ({
                    write: async (data: string) => {
                        const message = JSON.parse(data) as { id: string, method?: string }
                        if (message.method === 'ping') {
                            onLine?.(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }))
                        }
                    },
                    kill: () => {},
                }),
            }
        },
    },
}))

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID, selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''), bodyIntercepterStore: [] as unknown[],
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async (message: string) => {
        h.prompts.push(message)
        return h.answers.length > 1 ? h.answers.shift()! : h.answers[0]
    }),
    alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(), waitUnreadNotice: vi.fn(async () => {}),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(async (url: string, options: FetchOptions) => {
        const call: FetchCall = { url, body: JSON.parse(JSON.stringify(options?.body ?? {})), abortSignal: options?.abortSignal }
        h.fetches.push(call)
        const next = h.script.shift()
        if (next) {
            return next(call, options)
        }
        return { ok: true, data: { content: [{ type: 'text', text: 'done' }] } }
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
    const getCurrentCharacter = () => {
        let id = -1
        stores.selectedCharID.subscribe((v: number) => { id = v })()
        return state.db.characters?.[id]
    }
    const getCurrentChat = () => { const c = getCurrentCharacter(); return c?.chats?.[c.chatPage] }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(getCurrentCharacter), getCurrentChat: vi.fn(getCurrentChat),
    }
})

vi.mock('../modules', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../modules')>()
    return {
        ...orig,
        getModuleMcpEntries: vi.fn((subject?: Parameters<typeof orig.getModuleMcpEntries>[0]) => {
            h.entryCalls.push(h.fetches.length)
            return orig.getModuleMcpEntries(subject)
        }),
    }
})

vi.mock('../mcp/mcplib', async (importOriginal) => {
    const orig = await importOriginal<Record<string, unknown>>()
    class FakeMCPClient {
        url: string
        serverInfo = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }
        onDestroy: (() => void) | null = null
        registerRefreshToken: unknown = null
        getRefreshToken: unknown = null
        customTransport: unknown = null
        constructor(url: string) { this.url = url; f.created.push(url) }
        async checkHandshake() { return this.serverInfo }
        async getToolList() { return [{ name: 'tool', description: '', inputSchema: { type: 'object', properties: {} } }] }
        async callTool(name: string) {
            f.calls.push(`${this.url}#${name}`)
            h.onClientCall?.(name)
            return [{ type: 'text', text: 'tool-out' }]
        }
        destroy() {}
    }
    return { ...orig, MCPClient: FakeMCPClient }
})

vi.mock('../mcp/risuaccess', () => ({
    RisuAccessClient: class {
        serverInfo = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'risuai', version: '1' } }
        constructor() { f.risuaccessBuilt++ }
        async checkHandshake() { return this.serverInfo }
        async getToolList() { return [{ name: 'risu-list-characters', description: SENTINEL, inputSchema: { type: 'object', properties: {} } }] }
        async callTool(name: string) {
            f.risuaccessCalls.push(name)
            return [{ type: 'text', text: SENTINEL }]
        }
        destroy() {}
    },
}))

//#endregion

//#region fixtures

type Fixture = Record<string, unknown>
type Msg = { role: string, content: string }
type Result = { type: string, result: unknown }

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let requestChatDataMain: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let mcp: typeof import('../mcp/mcp')
let utility: typeof import('../utility/utilityConversation.svelte')

const U = 'https://u.test/mcp'
const STDIO_URL = 'stdio:{"command":"npx","args":["-y","@x/server"]}'

/** A fresh page: every module reloaded, the approvals' store kept. */
async function boot() {
    if (DBState) { DBState.db = {} as unknown as Database }
    vi.resetModules()
    const request = await import('../request/request')
    requestChatData = request.requestChatData as never
    requestChatDataMain = request.requestChatDataMain as never
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    mcp = await import('../mcp/mcp')
    utility = await import('../utility/utilityConversation.svelte')
    const { setPageStorageMode } = await import('../../storage/pageStorageMode')
    setPageStorageMode({ kind: 'store2' })
}

beforeEach(async () => {
    h.fetches.length = 0
    h.script.length = 0
    h.onClientCall = null
    h.onEncode = null
    h.prompts.length = 0
    h.answers = [true]
    h.entryCalls.length = 0
    h.store = createMemoryByteStore()
    shell.created.length = 0
    f.created.length = 0
    f.calls.length = 0
    f.risuaccessBuilt = 0
    f.risuaccessCalls.length = 0
    await boot()
    selectedCharID.set(-1)
})

const mod = (id: string, name: string, url: string) => ({ id, name, description: '', mcp: { url } })

function chat(id: string): Fixture {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }
}

/** One selected character that has the module ids `moduleIds` enabled, and a Utility preset on an Anthropic model. */
function install(moduleIds: string[], modules: Fixture[]): void {
    const characters = [{
        chaId: 'c0', name: 'Char0', type: 'character', chatPage: 0, chats: [chat('chat0')], triggerscript: [], modules: moduleIds,
        customscript: [], globalLore: [], lowLevelAccess: false, defaultVariables: '',
    }]
    DBState.db = {
        characters, enabledModules: [], modules, templateDefaultVariables: '', authRefreshes: [], fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        personas: [{ id: 'p-S', name: 'Persona', personaPrompt: '', icon: '' }], selectedPersona: 0, username: 'User',
        aiModel: 'claude-3-5-sonnet-latest', subModel: 'claude-3-5-sonnet-latest', claudeAPIKey: 'k', thinkingType: 'off',
        maxResponse: 100, temperature: 80, maxContext: 4000, seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {},
        customModels: [], additionalParams: [], cipherChat: false, newOAIHandle: false, useInstructPrompt: false,
        taskPresets: [{ id: 'preset1', name: 'Preset', instructions: 'be brief', model: 'claude-3-5-sonnet-latest', temperature: 0.5, maxTokens: 100 }],
    } as unknown as Database
    selectedCharID.set(0)
}

const prompt = (): Msg[] => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

const TOOL = { name: 'tool', description: 'd', inputSchema: { type: 'object', properties: {} } }
/** A tool the request advertises, with the URL of the client that listed it. */
const LISTED = [{ ...TOOL, mcpURL: U }]

const reply = (...content: unknown[]) => () => ({ ok: true, data: { content } })
const toolUse = (id: string, name: string) => ({ type: 'tool_use', id, name, input: {} })
const text = (value: string) => ({ type: 'text', text: value })

/** The chat messages of `globalFetch` call number `n`, as one string. */
function bodyOf(n: number): string {
    return JSON.stringify(h.fetches[n].body.messages)
}

/** The `tool_result` blocks of the last message of `globalFetch` call number `n`. */
function resultsOf(n: number): Array<{ type: string, tool_use_id: string, content: Array<{ text: string }> }> {
    const messages = h.fetches[n].body.messages as Array<{ role: string, content: Array<{ type: string }> }>
    return messages[messages.length - 1].content as never
}

async function sendUtility(): Promise<void> {
    await utility.sendUtility('preset1', 'hello')
}

function lastTurn() {
    return utility.utilityConversation.turns[utility.utilityConversation.turns.length - 1]
}

/** The request of a non-streaming Anthropic call that lists `tools`, with the signal of a caller that may stop it. */
function direct(tools: unknown, controller?: AbortController, extra: Fixture = {}) {
    return requestChatDataMain({
        formated: prompt(), bias: {}, useStreaming: false, noMultiGen: true, ...(tools === undefined ? {} : { tools }), ...extra,
    }, 'model', controller?.signal ?? null)
}

/** The answer of a `globalFetch` that is held until the caller stops it or `h` releases it, like a request in flight. */
let release: () => void = () => {}
function held(call: FetchCall): Promise<unknown> {
    return new Promise((resolve) => {
        release = () => resolve({ ok: true, data: { content: [text('late')] } })
        call.abortSignal?.addEventListener('abort', () => resolve({ ok: false, data: 'aborted', status: 400 }), { once: true })
    })
}

//#endregion

describe('a tool the request did not advertise is refused before it is routed', () => {
    test('S1-R1 Utility: an unadvertised risuaccess name starts no client and gets a paired "not available" result', async () => {
        install([], [])
        h.script.push(reply(toolUse('toolu_1', 'risu-list-characters')), reply(text('done')))

        await sendUtility()

        expect(f.risuaccessBuilt, 'the internal:risuai client was constructed for a refused name').toBe(0)
        expect(h.entryCalls, 'the module clients were searched after the first reply').toEqual([])
        expect(h.fetches).toHaveLength(2)
        expect(bodyOf(1)).not.toContain(SENTINEL)
        const results = resultsOf(1)
        expect(results).toHaveLength(1)
        expect(results[0].tool_use_id).toBe('toolu_1')
        expect(results[0].content[0].text).toContain('not available')
        expect(lastTurn().state).toBe('done')
    })

    test('S1-R2a an approved stdio module is not spawned for a refused name', async () => {
        const modules = [mod('m1', 'Mod One', STDIO_URL)]
        install(['m1'], modules)
        await mcp.getMCPTools()
        expect(shell.created, 'the approval run started the program once').toHaveLength(1)
        await vi.waitFor(() => { expect((h.store as ReturnType<typeof createMemoryByteStore>).writes).toHaveLength(1) })

        await boot()
        install(['m1'], modules)
        shell.created.length = 0
        h.prompts.length = 0
        h.script.push(reply(toolUse('toolu_1', 'risu-list-characters')), reply(text('done')))
        await sendUtility()

        expect(shell.created, 'the approved program was started for a refused name').toEqual([])
        expect(h.prompts).toEqual([])
        expect(resultsOf(1)[0].content[0].text).toContain('not available')
    })

    test('S1-R2b an unapproved stdio module is neither started nor asked about for a refused name', async () => {
        install(['m1'], [mod('m1', 'Mod One', STDIO_URL)])
        h.answers = [false]
        h.script.push(reply(toolUse('toolu_1', 'risu-list-characters')), reply(text('done')))

        await sendUtility()

        expect(h.prompts, 'a consent prompt was shown for a refused name').toEqual([])
        expect(shell.created).toEqual([])
    })

    test('S1-R3 the RP shape: a name that is not listed is refused', async () => {
        install(['mU'], [mod('mU', 'Mod U', U)])
        h.script.push(reply(toolUse('toolu_1', 'risu-list-characters')), reply(text('done')))

        const result = await requestChatData({ formated: prompt(), bias: {}, useStreaming: false, noMultiGen: true }, 'model')

        expect(result.type).toBe('success')
        expect(f.risuaccessBuilt, 'the internal:risuai client was constructed for a refused name').toBe(0)
        expect(bodyOf(1)).not.toContain(SENTINEL)
        expect(resultsOf(1)[0].content[0].text).toContain('not available')
    })

    test('S1-R4 undefined tools refuse every name', async () => {
        install(['mU'], [mod('mU', 'Mod U', U)])
        h.script.push(reply(toolUse('toolu_1', 'tool')), reply(text('done')))

        const result = await direct(undefined)

        expect(result.type).toBe('success')
        expect(f.calls, 'a module client was called for a name nobody advertised').toEqual([])
        expect(resultsOf(1)[0].content[0].text).toContain('not available')
    })

    test('S1-R5 Utility: a tools list added to the body by an interceptor does not make a name dispatchable', async () => {
        install([], [])
        h.script.push((_call, options) => {
            // The interceptor edits the body the request holds, after the request built it.
            ;(options.body as Record<string, unknown>).tools = [{ name: 'risu-list-characters', description: 'x', input_schema: { type: 'object', properties: {} } }]
            return { ok: true, data: { content: [toolUse('toolu_1', 'risu-list-characters')] } }
        }, reply(text('done')))

        await sendUtility()

        expect(f.risuaccessBuilt, 'the internal:risuai client was constructed for a refused name').toBe(0)
        expect(f.risuaccessCalls).toEqual([])
        expect(bodyOf(1)).not.toContain(SENTINEL)
    })
})

describe('the loop honours the caller\'s Stop', () => {
    test('S1-R6 the signal reaches the fetch', async () => {
        install([], [])

        await sendUtility()

        expect(h.fetches[0].abortSignal, 'the signal was not passed to globalFetch').toBeInstanceOf(AbortSignal)
    })

    test('S1-R7 Stop cancels a pending request and ends the run', async () => {
        install([], [])
        h.script.push(held)

        const running = sendUtility()
        try {
            await vi.waitFor(() => { expect(h.fetches).toHaveLength(1) })
            utility.stopUtility()
            await vi.waitFor(() => { expect(utility.utilityConversation.runId).toBeNull() }, { timeout: 1000 })
        }
        finally {
            release()
            await running
        }

        expect(lastTurn().state).toBe('stopped')
        expect(h.fetches).toHaveLength(1)
    })

    test('S1-R6b a reply that arrives after Stop is not returned as a success', async () => {
        install([], [])
        const controller = new AbortController()
        h.script.push(() => {
            controller.abort()
            return { ok: true, data: { content: [text('late')] } }
        })

        const result = await direct(undefined, controller)

        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
    })

    test('S1-R8 Stop during a block skips the later blocks and the follow-up', async () => {
        install([], [])
        const controller = new AbortController()
        h.onClientCall = () => { controller.abort() }
        h.script.push(reply(toolUse('toolu_1', 'tool'), toolUse('toolu_2', 'tool')), reply(text('done')))

        const result = await direct(LISTED, controller)

        expect(f.calls, 'a later block was dispatched after Stop').toEqual([`${U}#tool`])
        expect(h.fetches, 'a follow-up request was sent after Stop').toHaveLength(1)
        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
    })

    test('S1-R9 Stop during the last block sends no follow-up', async () => {
        install([], [])
        const controller = new AbortController()
        h.onClientCall = () => { controller.abort() }
        h.script.push(reply(toolUse('toolu_1', 'tool')), reply(text('done')))

        const result = await direct(LISTED, controller)

        expect(f.calls).toEqual([`${U}#tool`])
        expect(h.fetches, 'a follow-up request was sent after Stop').toHaveLength(1)
        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
    })

    test('S1-R10 Stop during the remembered-call store of a block skips the later blocks', async () => {
        install([], [])
        const controller = new AbortController()
        h.onEncode = () => { controller.abort() }
        h.script.push(reply(toolUse('toolu_1', 'tool'), toolUse('toolu_2', 'tool')), reply(text('done')))

        const result = await direct(LISTED, controller, { rememberToolUsage: true })

        expect(f.calls, 'a later block was dispatched after Stop').toEqual([`${U}#tool`])
        expect(h.fetches, 'a follow-up request was sent after Stop').toHaveLength(1)
        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
    })
})

describe('a refusal matches the whole name and is not remembered', () => {
    test('S1-R11 a name that merely contains an advertised name is refused', async () => {
        install(['mU'], [mod('mU', 'Mod U', U)])
        h.script.push(reply(toolUse('toolu_1', 'tool2')), reply(text('done')))

        const result = await direct(LISTED)

        expect(result.type).toBe('success')
        expect(f.calls, 'a client was called for a name nobody advertised').toEqual([])
        expect(resultsOf(1)[0].content[0].text).toContain('not available')
    })

    test('S1-R12 a refused call is not stored for later turns, and an advertised one is', async () => {
        install(['mU'], [mod('mU', 'Mod U', U)])
        h.script.push(reply(toolUse('toolu_1', 'risu-list-characters')), reply(text('done')))

        const refused = await direct(undefined, undefined, { rememberToolUsage: true })

        expect(refused).toMatchObject({ type: 'success', result: 'done' })
        expect(String(refused.result)).not.toContain('<tool_call>')

        h.fetches.length = 0
        h.script.push(reply(toolUse('toolu_2', 'tool')), reply(text('done')))
        const listed = await direct(LISTED, undefined, { rememberToolUsage: true })

        expect(String(listed.result), 'an advertised call is remembered').toContain('<tool_call>toolu_2')
    })
})

describe('what is advertised, or has no tools, is unchanged', () => {
    test('guard: S1-G1 a listed tool is routed to the client that listed it, and nothing else starts', async () => {
        install(['mU'], [mod('mU', 'Mod U', U)])
        h.script.push(reply(toolUse('toolu_1', 'tool')), reply(text('done')))

        const result = await requestChatData({ formated: prompt(), bias: {}, useStreaming: false, noMultiGen: true }, 'model')

        expect(result.type).toBe('success')
        expect(f.calls).toEqual([`${U}#tool`])
        expect(f.risuaccessBuilt).toBe(0)
        expect(resultsOf(1)[0].content[0].text).toBe('tool-out')
    })

    test('guard: S1-G2 an advertised tool without a client URL is found by the search', async () => {
        install(['mU'], [mod('mU', 'Mod U', U)])
        h.script.push(reply(toolUse('toolu_1', 'tool')), reply(text('done')))

        const result = await direct([TOOL])

        expect(result.type).toBe('success')
        expect(f.calls).toEqual([`${U}#tool`])
        expect(resultsOf(1)[0].content[0].text).toBe('tool-out')
    })

    test('guard: S1-G3 a plain reply, and a chain without a signal, complete', async () => {
        install([], [])
        const plain = await direct(undefined)
        expect(plain).toMatchObject({ type: 'success', result: 'done' })
        expect(h.fetches).toHaveLength(1)

        h.fetches.length = 0
        h.script.push(reply(toolUse('toolu_1', 'tool')), reply(text('chained')))
        const chain = await direct(LISTED)
        expect(chain).toMatchObject({ type: 'success', result: 'chained' })
        expect(h.fetches).toHaveLength(2)
        expect(f.calls).toEqual([`${U}#tool`])
    })
})

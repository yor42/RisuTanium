/**
 * A declined sign-in-helper confirmation cancels the login cleanly at the registry level: a decline during an
 * import, a chat-time listing or a tool call leaves the client registered and quiet (no request, no prompt, no
 * error), concurrent activities on one client see one prompt, and within a client's lifetime only the explicit Import MCP asks again.
 *
 * Drives the real `mcp.ts`, `modules`, `chatOrigin` and the REAL `MCPClient`. MOCKED: `fetchNative` (a router
 * over the server's JSON-RPC methods and the OAuth URLs), `openURL`, the alert helpers and the byte store.
 * Nothing here says anything about the native command or the real prompt UI.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be
 * preserved; every other test is a regression reproducer for the behaviour it names.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { ByteStore } from '../../storage/store/contract'
import { createMemoryByteStore } from '../files/tests/memoryByteStore'
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    tauri: true,
    /** Prompt texts of the confirmations, in order. */
    prompts: [] as string[],
    /** The answer of the next confirmations; the last one repeats. */
    answers: [false] as boolean[],
    typedUrl: '',
    store: null as ByteStore | null,
    fetchNative: vi.fn(),
    openURL: vi.fn(),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ get isTauri() { return h.tauri }, isNodeServer: false }))
vi.mock('../../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../storage/tauriByteTransport')>()),
    isAndroidTransport: () => false,
}))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: () => {} }))
vi.mock('../../storage/store/appStore', () => ({ getAppStore: async () => h.store }))

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID, selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    }
})

vi.mock('../mcp/toolApproval', () => ({ TOOL_SUMMARY_LIMIT: 800, askToolApproval: vi.fn(async () => 'once') }))

vi.mock('../../alert', () => ({
    alertError: h.alertError, alertToast: vi.fn(), alertInput: vi.fn(async () => h.typedUrl), alertNormal: h.alertNormal, alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async (message: string) => {
        h.prompts.push(message)
        return h.answers.length > 1 ? h.answers.shift()! : h.answers[0]
    }),
    alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(), waitUnreadNotice: vi.fn(async () => {}),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: h.fetchNative, openURL: h.openURL, globalFetch: vi.fn(async () => ({ ok: true, data: {} })),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(),
    readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))

vi.mock('../../network/privateNetworkConsent', () => ({ getAllowPrivate: vi.fn(async () => false) }))

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

//#endregion

//#region the server

const SERVER = 'https://mcp.example.invalid/mcp'
const HELPER_API = 'https://account.sionyw.com/oauthhelper/api'
const DISCOVERY = 'https://mcp.example.invalid/.well-known/oauth-authorization-server'
const REGISTER = 'https://mcp.example.invalid/register'
const TOKEN = 'https://mcp.example.invalid/token'

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
})

const initResult = (capabilities: Record<string, unknown> = {}) => ({
    jsonrpc: '2.0', id: 'x',
    result: { protocolVersion: '2025-03-26', capabilities, serverInfo: { name: 's', version: '1' } },
})

type World = {
    /** The reply to the n-th initialize POST (1-based), given the request headers. */
    initialize: (n: number, headers: Record<string, string>) => Response
    rpc: Record<string, () => Response>
    urls: Record<string, () => Response>
    initializes: number
    /** A further initialize throws, which ends a login loop the base would otherwise run. */
    initializeBound: number
}

const world: World = { initialize: () => json({}, 401), rpc: {}, urls: {}, initializes: 0, initializeBound: Infinity }

function fullOAuth() {
    world.urls = {
        [DISCOVERY]: () => json({}, 404),
        [REGISTER]: () => json({ client_id: 'id', client_secret: 'secret' }, 201),
        [HELPER_API]: () => json({ success: true, payload: { code: 'c' } }),
        [TOKEN]: () => json({ access_token: 'tok' }),
    }
}

type Call = { url: string, arg: { body?: string, headers?: Record<string, string> } }
const calls = (): Call[] => h.fetchNative.mock.calls.map(([url, arg]) => ({ url, arg }))
const helperCalls = () => calls().filter((call) => new URL(call.url).hostname === 'account.sionyw.com')
const initializeCalls = () => calls().filter((call) => call.url === SERVER && JSON.parse(call.arg.body!).method === 'initialize')

/** The server is live: session s1, tools, an empty tool list. */
function serverLive() {
    world.initialize = () => json(initResult({ tools: {} }), 200, { 'Mcp-Session-Id': 's1' })
    world.rpc = {
        'notifications/initialized': () => json({}),
        'tools/list': () => json({ jsonrpc: '2.0', id: 'x', result: { tools: [] } }),
        'tools/call': () => json({ jsonrpc: '2.0', id: 'x', result: { content: [{ type: 'text', text: 'ok' }] } }),
    }
}

/** The server loses the session: it answers 404 to session requests and 401 to initialize. */
function serverLosesSession() {
    world.initialize = () => json({}, 401)
    world.rpc = {
        'notifications/initialized': () => json({}),
        'tools/list': () => json({}, 404),
        'tools/call': () => json({}, 404),
    }
}

//#endregion

//#region fixtures

type Fixture = Record<string, unknown>

let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let mcp: typeof import('../mcp/mcp')

/** A fresh page: every module reloaded. */
async function boot() {
    if (DBState) { DBState.db = {} as unknown as Database }
    vi.resetModules()
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    mcp = await import('../mcp/mcp')
}

beforeEach(async () => {
    h.tauri = true
    h.prompts.length = 0
    h.answers = [false]
    h.typedUrl = ''
    h.store = createMemoryByteStore()
    h.fetchNative.mockReset()
    h.openURL.mockReset()
    h.alertError.mockReset()
    h.alertNormal.mockReset()
    world.initialize = () => json({}, 401)
    world.rpc = {}
    world.urls = {}
    world.initializes = 0
    world.initializeBound = Infinity
    h.fetchNative.mockImplementation(async (url: string, arg: { body?: string, headers?: Record<string, string> }) => {
        if (url === SERVER) {
            const method = JSON.parse(arg.body!).method as string
            if (method === 'initialize') {
                world.initializes++
                if (world.initializes > world.initializeBound) {
                    throw new Error('initialize bound')
                }
                return world.initialize(world.initializes, arg.headers ?? {})
            }
            const reply = world.rpc[method]
            if (!reply) {
                throw new Error('no reply for ' + method)
            }
            return reply()
        }
        const reply = world.urls[url]
        if (!reply) {
            throw new Error('stop')
        }
        return reply()
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await boot()
    selectedCharID.set(-1)
})

function chat(id: string): Fixture {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }
}

/** Character `i` holds one chat and has the module ids of `sets[i]` enabled. The first one is selected. */
function install(sets: string[][], modules: Fixture[]): void {
    const characters = sets.map((ids, i) => ({
        chaId: `c${i}`, name: `Char${i}`, type: 'character', chatPage: 0, chats: [chat(`chat${i}`)], triggerscript: [], modules: ids,
        customscript: [], globalLore: [], lowLevelAccess: false, defaultVariables: '',
    }))
    DBState.db = {
        characters, enabledModules: [], modules, templateDefaultVariables: '', authRefreshes: [], personas: [], selectedPersona: 0, username: 'User',
    } as unknown as Database
    selectedCharID.set(0)
}

const declinedClient = () => mcp.MCPs[SERVER] as unknown as { oauthDeclined?: boolean, initialized: boolean }

/** The settled state of a call, so a rejection does not hide the assertion that names the defect. */
const settle = <T>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))

/** SERVER goes live, loses its session, and the next listing re-handshakes into a decline. Returns the client. */
async function listThenDecline() {
    fullOAuth()
    world.initializeBound = 4
    serverLive()
    expect(await mcp.getMCPTools([SERVER])).toEqual([])
    const client = mcp.MCPs[SERVER]
    serverLosesSession()
    const dropped = await settle(mcp.getMCPTools([SERVER]))
    expect(dropped.ok).toBe(true)
    const declined = await settle(mcp.getMCPTools([SERVER]))
    return { client, declined }
}

//#endregion

describe('Import MCP of a server that needs sign-in', () => {
    test('a decline shows no error and adds no module, and the client stays registered and declined', async () => {
        install([], [])
        h.typedUrl = SERVER

        await mcp.importMCPModule()

        expect(h.prompts).toHaveLength(1)
        expect(h.prompts[0]).toContain('account.sionyw.com')
        expect(h.alertError).not.toHaveBeenCalled()
        expect(DBState.db.modules).toHaveLength(0)
        expect(helperCalls()).toEqual([])
        expect(declinedClient().oauthDeclined).toBe(true)
    })

    test('guard: a network failure still reports the module as not found and asks nothing', async () => {
        install([], [])
        h.typedUrl = SERVER
        world.initialize = () => { throw new Error('network') }

        await mcp.importMCPModule()

        expect(h.alertError).toHaveBeenCalledWith('MCP module not found or invalid URL')
        expect(h.prompts).toEqual([])
    })
})

describe('a chat-time activity on a live client whose session is lost', () => {
    test('a listing that is declined resolves without tools; the client stays registered and quiet', async () => {
        install([], [])

        const { client, declined } = await listThenDecline()

        expect(declined.ok).toBe(true)
        expect(declined.ok && declined.value).toEqual([])
        expect(helperCalls()).toEqual([])
        expect(h.openURL).not.toHaveBeenCalled()
        expect(h.prompts).toHaveLength(1)
        expect(mcp.MCPs[SERVER]).toBe(client)
        expect(declinedClient().oauthDeclined).toBe(true)

        const before = calls().length
        expect(await mcp.getMCPTools([SERVER])).toEqual([])
        expect(calls().length).toBe(before)
        expect(h.prompts).toHaveLength(1)
    })

    test('a routed tool call that is declined resolves to the cancelled-tool text', async () => {
        install([], [])
        fullOAuth()
        world.initializeBound = 4
        serverLive()
        expect(await mcp.callMCPTool('t', {}, { mcpURL: SERVER })).toEqual([{ type: 'text', text: 'ok' }])
        serverLosesSession()
        const dropped = await settle(mcp.callMCPTool('t', {}, { mcpURL: SERVER }))
        expect(dropped.ok).toBe(true)

        const declined = await settle(mcp.callMCPTool('t', {}, { mcpURL: SERVER }))

        expect(declined.ok).toBe(true)
        const text = declined.ok ? JSON.stringify(declined.value) : ''
        expect(text).toContain('cancelled')
        expect(helperCalls()).toEqual([])
        expect(h.openURL).not.toHaveBeenCalled()
        expect(h.prompts).toHaveLength(1)

        const before = calls().length
        expect(JSON.stringify(await mcp.callMCPTool('t', {}, { mcpURL: SERVER }))).toContain('cancelled')
        expect(calls().length).toBe(before)
    })

    test('a tool call without a routing URL is refused and touches no client', async () => {
        install([['m1']], [{ id: 'm1', name: 'M', description: '', mcp: { url: SERVER } }])
        fullOAuth()
        world.initializeBound = 4
        serverLive()
        await mcp.callMCPTool('t', {}, { mcpURL: SERVER })
        serverLosesSession()
        const before = calls().length
        const promptsBefore = h.prompts.length

        const refused = await settle(mcp.callMCPTool('t', {}))

        expect(refused.ok && JSON.stringify(refused.value)).toContain('without a server')
        expect(helperCalls()).toEqual([])
        expect(h.prompts).toHaveLength(promptsBefore)
        expect(calls().length).toBe(before)
    })

    test('concurrent listings share one prompt and one handshake', async () => {
        install([], [])
        fullOAuth()
        world.initializeBound = 6
        serverLive()
        await mcp.getMCPTools([SERVER])
        serverLosesSession()
        await mcp.getMCPTools([SERVER])
        const initializesBefore = initializeCalls().length

        const both = await Promise.all([settle(mcp.getMCPTools([SERVER])), settle(mcp.getMCPTools([SERVER]))])

        expect(both.map((outcome) => outcome.ok && outcome.value)).toEqual([[], []])
        expect(h.prompts).toHaveLength(1)
        expect(initializeCalls().length - initializesBefore).toBe(1)
        expect(helperCalls()).toEqual([])
    })
})

describe('Import MCP of a declined server asks again', () => {
    test('a decline adds nothing, and an acceptance signs in and adds the module', async () => {
        install([], [])
        await listThenDecline()
        expect(h.prompts).toHaveLength(1)
        h.typedUrl = SERVER

        await mcp.importMCPModule()

        expect(h.prompts).toHaveLength(2)
        expect(h.alertError).not.toHaveBeenCalled()
        expect(DBState.db.modules).toHaveLength(0)
        expect(declinedClient().oauthDeclined).toBe(true)

        // The server signs in: initialize answers 401 until a request carries the new token.
        world.initializeBound = 8
        world.initialize = (_n, headers) => headers.Authorization === 'Bearer tok'
            ? json(initResult({ tools: {} }), 200, { 'Mcp-Session-Id': 's2' })
            : json({}, 401)
        h.answers = [true]

        await mcp.importMCPModule()

        expect(h.prompts).toHaveLength(3)
        expect(DBState.db.modules).toHaveLength(1)
        expect(DBState.db.modules[0].name).toBe('s')
        expect(declinedClient().oauthDeclined).toBe(false)
        expect(declinedClient().initialized).toBe(true)
    })
})

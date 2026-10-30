/**
 * No module or card `stdio:` MCP program starts without this device's consent. Every route to a spawn
 * -- a listing, a tool call, the user-typed import -- goes through one gate that asks the user, naming the
 * program and every argument, and an approval is the triple (module id, hash of the parsed command, args and
 * env, this device).
 *
 * Drives the real `mcp.ts`, `modules`, `chatOrigin`, the approval gate and the spec parser. The shell plugin
 * is a recording fake whose child answers each ping, the MCP client is a recording fake, the prompt is a
 * recording fake and the approvals' byte store is the in-memory test store. Nothing here says anything about
 * a native spawn: the desktop diagnostic is owed separately.
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

const h = vi.hoisted(() => ({
    tauri: true,
    android: false,
    /** Prompt texts, in order. */
    prompts: [] as string[],
    /** Everything observable in order: `prompt` and `spawn:<command>`. */
    events: [] as string[],
    /** The answer of the next prompts; the last one repeats. */
    answers: [true] as boolean[],
    /** When set, a prompt waits for it. */
    hold: null as null | Promise<void>,
    typedUrl: '',
    store: null as ByteStore | null,
    marks: [] as string[],
}))

const shell = vi.hoisted(() => ({
    created: [] as Array<{ command: string, args: string[], env: Record<string, string> | undefined }>,
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
    isAndroidTransport: () => h.android,
}))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: (id: string) => { h.marks.push(id) } }))
vi.mock('../../storage/store/appStore', () => ({ getAppStore: async () => h.store }))

vi.mock('@tauri-apps/plugin-shell', () => ({
    Command: {
        create: (command: string, args: string[], options?: { env?: Record<string, string> }) => {
            shell.created.push({ command, args, env: options?.env })
            h.events.push(`spawn:${command}`)
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
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => h.typedUrl), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async (message: string) => {
        h.prompts.push(message)
        h.events.push('prompt')
        if (h.hold) { await h.hold }
        return h.answers.length > 1 ? h.answers.shift()! : h.answers[0]
    }),
    alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(), waitUnreadNotice: vi.fn(async () => {}),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(), globalFetch: vi.fn(async () => ({ ok: true, data: {} })),
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

const f = vi.hoisted(() => ({ created: [] as string[] }))

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
        async callTool() { return [{ type: 'text', text: 'ok' }] }
        destroy() {}
    }
    return { ...orig, MCPClient: FakeMCPClient }
})

//#endregion

//#region fixtures

type Fixture = Record<string, unknown>

let createSendSubject: typeof import('../chatOrigin').createSendSubject
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let mcp: typeof import('../mcp/mcp')

/** A fresh page: every module reloaded, the approvals' store kept. */
async function boot() {
    if (DBState) { DBState.db = {} as unknown as Database }
    vi.resetModules()
    createSendSubject = (await import('../chatOrigin')).createSendSubject
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    mcp = await import('../mcp/mcp')
}

beforeEach(async () => {
    h.tauri = true
    h.android = false
    h.prompts.length = 0
    h.events.length = 0
    h.answers = [true]
    h.hold = null
    h.typedUrl = ''
    h.store = createMemoryByteStore()
    shell.created.length = 0
    f.created.length = 0
    await boot()
    selectedCharID.set(-1)
})

const STDIO_URL = 'stdio:{"command":"npx","args":["-y","@x/server"]}'
const mod = (id: string, name: string, url: string) => ({ id, name, description: '', mcp: { url } })

function chat(id: string): Fixture {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }
}

/** Character `i` is named `Char<i>`, holds one chat, and has the module ids of `sets[i]` enabled. The first one is selected. */
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

function subjectAt(charIndex: number) {
    const owner = DBState.db.characters[charIndex] as unknown as { chaId: string, chats: Array<{ id: string }> }
    const target = owner.chats[0]
    return createSendSubject({ chaId: owner.chaId, chatId: target.id }, { owner: owner as never, chat: target as never })
}

/** A fresh page over the same approvals, with the given modules enabled on one selected character. */
async function newPage(modules: Fixture[]) {
    await boot()
    install([modules.map((m) => m.id as string)], modules)
}

const names = (tools: Array<{ name: string }>) => tools.map((t) => t.name)

//#endregion

describe('a stdio program starts only with consent', () => {
    test('a decline starts nothing and lists no tools', async () => {
        install([['m1']], [mod('m1', 'Mod One', STDIO_URL)])
        h.answers = [false]

        const tools = await mcp.getMCPTools()

        expect(shell.created).toEqual([])
        expect(tools).toEqual([])
    })

    test('the prompt names the module, the program and every argument, and comes before the spawn', async () => {
        install([['m1']], [mod('m1', 'Mod One', STDIO_URL)])

        const tools = await mcp.getMCPTools()

        expect(h.prompts).toHaveLength(1)
        expect(h.prompts[0]).toContain('Mod One')
        expect(h.prompts[0]).toContain('"npx"')
        expect(h.prompts[0]).toContain('"-y"')
        expect(h.prompts[0]).toContain('"@x/server"')
        expect(h.events).toEqual(['prompt', 'spawn:npx'])
        expect(shell.created).toEqual([{ command: 'npx', args: ['-y', '@x/server'], env: {} }])
        expect(names(tools)).toEqual(['tool'])
    })

    test('an approval survives a restart: the next page starts it with no prompt', async () => {
        const modules = [mod('m1', 'Mod One', STDIO_URL)]
        install([['m1']], modules)
        await mcp.getMCPTools()
        expect(h.prompts).toHaveLength(1)
        await vi.waitFor(() => { expect((h.store as ReturnType<typeof createMemoryByteStore>).writes).toHaveLength(1) })

        await newPage(modules)
        shell.created.length = 0
        const tools = await mcp.getMCPTools()

        expect(h.prompts).toHaveLength(1)
        expect(shell.created).toHaveLength(1)
        expect(names(tools)).toEqual(['tool'])
    })

    test('changed arguments ask again, and a decline starts nothing', async () => {
        const modules = [mod('m1', 'Mod One', STDIO_URL)]
        install([['m1']], modules)
        await mcp.getMCPTools()
        shell.created.length = 0
        h.answers = [false]
        modules[0].mcp = { url: 'stdio:{"command":"npx","args":["-y","@evil/x"]}' }

        await newPage(modules)
        const tools = await mcp.getMCPTools()

        expect(h.prompts).toHaveLength(2)
        expect(h.prompts[1]).toContain('"@evil/x"')
        expect(shell.created.map((c) => c.args)).not.toContainEqual(['-y', '@evil/x'])
        expect(tools).toEqual([])
    })

    test('a changed environment asks again, and a decline starts nothing', async () => {
        const modules = [mod('m1', 'Mod One', STDIO_URL)]
        install([['m1']], modules)
        await mcp.getMCPTools()
        shell.created.length = 0
        h.answers = [false]
        modules[0].mcp = { url: 'stdio:{"command":"npx","args":["-y","@x/server"],"env":{"NODE_OPTIONS":"--require /tmp/x.js"}}' }

        await newPage(modules)
        await mcp.getMCPTools()

        expect(h.prompts).toHaveLength(2)
        expect(h.prompts[1]).toContain('NODE_OPTIONS')
        expect(shell.created).toEqual([])
    })

    test('another module with the same command asks on its own', async () => {
        install([['m1']], [mod('m1', 'Mod One', STDIO_URL)])
        await mcp.getMCPTools()
        h.prompts.length = 0
        h.answers = [false]
        shell.created.length = 0

        await newPage([mod('m2', 'Mod Two', STDIO_URL)])
        await mcp.getMCPTools()

        expect(h.prompts).toHaveLength(1)
        expect(h.prompts[0]).toContain('Mod Two')
        expect(shell.created).toEqual([])
    })

    test('a module that carries approval fields of its own still asks', async () => {
        const { parseMcpUrl, stdioSpecHash } = await import('../mcp/stdioSpec')
        const parsed = parseMcpUrl(STDIO_URL)
        if (parsed.kind !== 'stdio-spawn') { throw new Error('the fixture is not a spawn') }
        const hash = await stdioSpecHash(parsed.spec)
        type ModuleWithSelfApproval = ReturnType<typeof mod> & { mcp: { url: string, approved?: boolean, approval?: string } }
        const module: ModuleWithSelfApproval = {
            ...mod('m1', 'Mod One', STDIO_URL),
            mcp: { url: STDIO_URL, approved: true, approval: hash },
        }
        install([['m1']], [{ ...module, lowLevelAccess: true }])
        Object.assign(DBState.db, { mcpStdioApprovals: { m1: { [hash]: {} } } })
        h.answers = [false]

        await mcp.getMCPTools()

        expect(h.prompts).toHaveLength(1)
        expect(shell.created).toEqual([])
    })

    test('an approved module\'s live process does not serve an unapproved module\'s activity', async () => {
        install([['m1'], ['m2']], [mod('m1', 'Mod One', STDIO_URL), mod('m2', 'Mod Two', STDIO_URL)])
        h.answers = [true, false]

        const a = await mcp.getMCPTools(undefined, subjectAt(0))
        const b = await mcp.getMCPTools(undefined, subjectAt(1))

        expect(names(a)).toEqual(['tool'])
        expect(shell.created).toHaveLength(1)
        expect(h.prompts).toHaveLength(2)
        expect(b).toEqual([])
    })

    test('a tool call whose mcpURL no active module owns never starts a program and asks nothing', async () => {
        install([['m1']], [mod('m1', 'Mod One', 'https://x.test/mcp')])

        const result = await mcp.callMCPTool('t', {}, { mcpURL: STDIO_URL })

        expect(shell.created).toEqual([])
        expect(h.prompts).toEqual([])
        expect(JSON.stringify(result)).toContain('not found')
    })

    test('concurrent listings share one prompt and one spawn', async () => {
        install([['m1']], [mod('m1', 'Mod One', STDIO_URL)])
        let release!: () => void
        h.hold = new Promise<void>((resolve) => { release = resolve })

        const first = mcp.getMCPTools()
        const second = mcp.getMCPTools()
        await vi.waitFor(() => { expect(h.prompts).toHaveLength(1) })
        release()
        await Promise.all([first, second])

        expect(h.prompts).toHaveLength(1)
        expect(shell.created).toHaveLength(1)
    })

    test('a decline is remembered for the page: the next listing does not ask again', async () => {
        install([['m1']], [mod('m1', 'Mod One', STDIO_URL)])
        h.answers = [false]

        await mcp.getMCPTools()
        await mcp.getMCPTools()

        expect(h.prompts).toHaveLength(1)
        expect(shell.created).toEqual([])
    })

    test('a user-typed stdio import asks before the spawn and approves the id of the created module', async () => {
        install([['m0']], [mod('m0', 'Other', 'https://x.test/mcp')])
        h.typedUrl = STDIO_URL

        await mcp.importMCPModule()

        expect(h.prompts).toHaveLength(1)
        expect(h.events).toEqual(['prompt', 'spawn:npx'])
        const created = DBState.db.modules.filter((m) => m.id !== 'm0')
        expect(created).toHaveLength(1)

        await newPage([created[0] as unknown as Fixture])
        h.prompts.length = 0
        shell.created.length = 0
        await mcp.getMCPTools()
        expect(h.prompts).toEqual([])
        expect(shell.created).toHaveLength(1)
    })

    test('a user-typed stdio import that is declined creates no module and starts nothing', async () => {
        install([['m0']], [mod('m0', 'Other', 'https://x.test/mcp')])
        h.typedUrl = STDIO_URL
        h.answers = [false]

        await mcp.importMCPModule()

        expect(shell.created).toEqual([])
        expect(DBState.db.modules).toHaveLength(1)
    })

    test('guard: approving, declining and running leave every module and the database keys unchanged', async () => {
        const modules = [mod('m1', 'Mod One', STDIO_URL)]
        install([['m1']], modules)
        const before = JSON.stringify(DBState.db.modules)
        const keys = Object.keys(DBState.db)

        await mcp.getMCPTools()

        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(Object.keys(DBState.db)).toEqual(keys)

        h.store = createMemoryByteStore()
        h.answers = [false]
        await newPage(modules)
        await mcp.getMCPTools()

        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(Object.keys(DBState.db)).toEqual(keys)
    })
})

describe('what is not a spawn is unchanged', () => {
    test('guard: http, internal and stdio-url MCPs ask nothing and spawn nothing', async () => {
        install([['a', 'b', 'c']], [
            mod('a', 'A', 'https://x.test/mcp'),
            mod('b', 'B', 'internal:dice'),
            mod('c', 'C', 'stdio:{"url":"https://u.test/mcp","command":"npx","args":[]}'),
        ])

        await mcp.getMCPTools()

        expect(h.prompts).toEqual([])
        expect(shell.created).toEqual([])
        expect(f.created).toEqual(['https://x.test/mcp', 'https://u.test/mcp'])
    })

    test('guard: off the desktop app the stdio rejection is unchanged and nothing is asked', async () => {
        h.tauri = false
        install([['m1']], [mod('m1', 'Mod One', STDIO_URL)])

        await expect(mcp.getMCPTools()).rejects.toThrow(/only supported in Local Version/)

        expect(h.prompts).toEqual([])
        expect(shell.created).toEqual([])
    })

    test('on Android a stdio program is refused with the desktop-app text before any prompt or spawn', async () => {
        h.android = true
        install([['m1']], [mod('m1', 'Mod One', STDIO_URL)])

        await expect(mcp.getMCPTools()).rejects.toThrow(/desktop app/)

        expect(h.prompts).toEqual([])
        expect(shell.created).toEqual([])
    })
})

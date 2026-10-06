/**
 * The MCP registry serves each activity -- a listing, a metadata read or a tool call -- from its own
 * module set: the subject's when the activity carries one, the selection's otherwise. A client is
 * shared by every activity that uses its URL, is built once per URL however many activities ask for
 * it at once, and is shut down only when it is idle: no call in flight, and not created, listed or
 * called within the guard period.
 *
 * Drives the real `mcp.ts`, `modules` and `chatOrigin` and the real internal clients (`internal:fs`,
 * `internal:risuai`, plugin MCPs). The network MCP client is a fake that records
 * what is built, called and destroyed; the directory picker is a stub. Every test loads a fresh copy of
 * the modules, because the registry is module-level state. Nothing here says anything about a native
 * backend or a real `stdio:` child.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be
 * preserved. Where a guard also names the wrong implementation it must fail, the comment above it says
 * so.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    /** Every `globalFetch` call, in order. */
    fetches: [] as Array<{ url: string, body: Record<string, unknown> }>,
    /** Calls to `globalFetch` that answer with a failure before answering normally. */
    failNext: 0,
    /** Runs after each `globalFetch` call has answered. */
    afterFetch: null as null | ((count: number) => void),
    reply: 'ok',
    transformerPrompt: null as null | string,
    marks: [] as string[],
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: (id: string) => { h.marks.push(id) } }))

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
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))

/** The answer to any `globalFetch` call: one body that every provider under test reads its own field from. */
function answer(reply: string) {
    return {
        ok: true,
        data: {
            output: reply,
            data: [reply],
            results: [{ text: reply }],
            choices: [{ text: reply, message: { content: reply } }],
        },
    }
}

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(async (url: string, opts: { body: Record<string, unknown> }) => {
        h.fetches.push({ url, body: JSON.parse(JSON.stringify(opts?.body ?? {})) })
        const count = h.fetches.length
        let out: unknown = answer(h.reply)
        if (h.failNext > 0) {
            h.failNext--
            out = { ok: false, data: { error: { message: 'boom' } } }
        }
        h.afterFetch?.(count)
        return out
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
    runTransformers: vi.fn(async (prompt: string) => { h.transformerPrompt = prompt; return { generated_text: h.reply } }),
    runImageEmbedding: vi.fn(),
}))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    const getCurrentChat = () => { const c = getCurrentCharacter(); return c?.chats?.[c.chatPage] }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(getCurrentCharacter), getCurrentChat: vi.fn(getCurrentChat),
    }
})

//#endregion

//#region the fake network client and the counted internal client

const f = vi.hoisted(() => ({
    created: [] as string[], destroyed: [] as string[], calls: [] as string[],
    handshakeMs: 0, pending: null as null | Promise<void>, release: null as null | (() => void),
    /** URLs whose handshake rejects every time. */
    bad: new Set<string>(),
    /** URLs whose handshake rejects on the first attempt only. */
    badOnce: new Set<string>(),
    /** URLs whose `callTool` throws. */
    throwCall: new Set<string>(),
    /** URLs whose `destroy()` throws. */
    throwDestroy: new Set<string>(),
    /** URL -> a promise that `getToolList` of that URL waits for. */
    listHold: {} as Record<string, Promise<void>>,
    /** Constructions of `RisuAccessClient`. */
    risuInstances: 0,
    /** URLs whose `getToolList` is waiting on its hold. */
    held: [] as string[],
}))

vi.mock('../mcp/mcplib', async (importOriginal) => {
    const orig = await importOriginal<Record<string, unknown>>()
    class FakeMCPClient {
        url: string
        serverInfo = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }
        destroyedFlag = false
        onDestroy: (() => void) | null = null
        registerRefreshToken: unknown = null
        getRefreshToken: unknown = null
        constructor(url: string) { this.url = url; f.created.push(url) }
        async checkHandshake() {
            if (f.handshakeMs) { await new Promise((r) => setTimeout(r, f.handshakeMs)) }
            if (f.bad.has(this.url)) { throw new Error('handshake failed: ' + this.url) }
            if (f.badOnce.has(this.url)) { f.badOnce.delete(this.url); throw new Error('handshake failed once: ' + this.url) }
            return this.serverInfo
        }
        async getToolList() {
            const hold = f.listHold[this.url]
            if (hold) { f.held.push(this.url); await hold }
            return [{ name: 'tool_' + new URL(this.url).hostname.split('.')[0], description: '', inputSchema: { type: 'object', properties: {} } }]
        }
        async callTool(name: string, _args: unknown) {
            f.calls.push(this.url + ':' + name)
            if (f.throwCall.has(this.url)) { throw new Error('call failed: ' + this.url) }
            if (f.pending) { await f.pending }
            return [{ type: 'text', text: `ok:${this.url}:destroyedDuringCall=${this.destroyedFlag}` }]
        }
        destroy() {
            if (f.throwDestroy.has(this.url)) { throw new Error('destroy failed: ' + this.url) }
            this.destroyedFlag = true; f.destroyed.push(this.url)
        }
    }
    return { ...orig, MCPClient: FakeMCPClient }
})

vi.mock('../mcp/risuaccess', async (importOriginal) => {
    const orig = await importOriginal<{ RisuAccessClient: new () => object }>()
    class Counted extends (orig.RisuAccessClient as unknown as new () => object) { constructor() { super(); f.risuInstances++ } }
    return { ...orig, RisuAccessClient: Counted }
})

//#endregion

//#region fixtures

type Fixture = Record<string, unknown>

let createSendSubject: typeof import('../chatOrigin').createSendSubject
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let mcp: typeof import('../mcp/mcp')

/** Loads a fresh copy of every module under test: the registry keeps module-level state, and one test must not leave its clients to the next. */
async function boot() {
    // A module-level effect of the parser reads the database as soon as it loads; the database of the previous test must not be there for it to read.
    if (DBState) { DBState.db = {} as unknown as Database }
    vi.resetModules()
    createSendSubject = (await import('../chatOrigin')).createSendSubject
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    mcp = await import('../mcp/mcp')
}

beforeEach(async () => {
    await boot()
    f.created.length = 0; f.destroyed.length = 0; f.calls.length = 0; f.handshakeMs = 0; f.release = null; f.pending = null
    f.bad.clear(); f.badOnce.clear(); f.throwCall.clear(); f.throwDestroy.clear(); f.risuInstances = 0; f.held.length = 0
    for (const k of Object.keys(f.listHold)) { delete f.listHold[k] }
    selectedCharID.set(-1)
})

const X_URL = 'https://x.test/mcp'
const Y_URL = 'https://y.test/mcp'
const M_X = 'mod-x'
const M_Y = 'mod-y'
const M_RISU = 'mod-risu'
const mod = (id: string, url: string) => ({ id, name: id, description: '', mcp: { url } })
const modX = mod(M_X, X_URL)
const modY = mod(M_Y, Y_URL)
const modRisu = mod(M_RISU, 'internal:risuai')

const textOf = (r: Array<{ type: string, text?: string }>) => r.map((x) => x.text ?? '').join('|')
const names = (t: Array<{ name: string }>) => t.map((x) => x.name)
const builtOf = (url: string) => f.created.filter((u) => u === url).length

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

/** The subject of a send that started in the only chat of character `charIndex`. */
function subjectAt(charIndex: number) {
    const owner = DBState.db.characters[charIndex] as unknown as { chaId: string, chats: Array<{ id: string }> }
    const target = owner.chats[0]
    return createSendSubject({ chaId: owner.chaId, chatId: target.id }, { owner: owner as never, chat: target as never })
}

const MINUTE = 60 * 1000
const AFTER_GUARD = 60 * MINUTE

//#endregion

describe('the tools of an activity follow its subject, not the selection', () => {
    test('a subject-bound listing returns the tools of the subject\'s module set while the selection is on another set', async () => {
        install([[M_X], [M_Y]], [modX, modY])
        selectedCharID.set(1)

        const tools = await mcp.getTools(subjectAt(0))

        expect(names(tools)).toEqual(['tool_x'])
        expect(tools[0].mcpURL).toBe(X_URL)
    })

    test('a subject-bound listing returns the tools of the subject\'s module set while the selection is at Home', async () => {
        install([[M_X]], [modX])
        selectedCharID.set(-1)

        const tools = await mcp.getTools(subjectAt(0))

        expect(names(tools)).toEqual(['tool_x'])
    })

    test('guard: a listing with no subject returns the tools of the selection\'s module set', async () => {
        install([[M_X], [M_Y]], [modX, modY])

        const first = await mcp.getTools()
        selectedCharID.set(1)
        const second = await mcp.getTools()

        expect(names(first)).toEqual(['tool_x'])
        expect(names(second)).toEqual(['tool_y'])
    })
})

describe('a client that a request is using is not shut down by another request', () => {
    test('a client with a call in flight survives another module set\'s listing and the call completes on it', async () => {
        install([[M_X], [M_Y]], [modX, modY])
        const requestA = subjectAt(0)
        const requestB = subjectAt(1)
        await mcp.getMCPTools(undefined, requestA)
        f.pending = new Promise<void>((res) => { f.release = res })
        const call = mcp.callTool('tool_x', {}, { subject: requestA, mcpURL: X_URL })
        await vi.waitFor(() => { expect(f.calls).toHaveLength(1) })
        selectedCharID.set(1)

        await mcp.getMCPTools(undefined, requestB)
        f.release!()
        const result = await call

        expect(textOf(result)).toContain('destroyedDuringCall=false')
        expect(f.destroyed).not.toContain(X_URL)
    })

    test('a call still in flight past the guard period is not shut down by another set\'s activity', async () => {
        vi.useFakeTimers()
        try {
            install([[M_X], [M_Y]], [modX, modY])
            const requestA = subjectAt(0)
            await mcp.getMCPTools(undefined, requestA)
            f.pending = new Promise<void>((res) => { f.release = res })
            const call = mcp.callTool('tool_x', {}, { subject: requestA, mcpURL: X_URL })
            await vi.waitFor(() => { expect(f.calls).toHaveLength(1) })
            selectedCharID.set(1)
            await vi.advanceTimersByTimeAsync(AFTER_GUARD)

            await mcp.getMCPTools(undefined, subjectAt(1))
            const destroyedWhileInFlight = [...f.destroyed]
            f.release!()
            const result = await call

            expect(destroyedWhileInFlight).not.toContain(X_URL)
            expect(textOf(result)).toContain('destroyedDuringCall=false')
        } finally {
            vi.useRealTimers()
        }
    })

    test('a later call of a subject-bound request reaches its client after the selection moved to another set', async () => {
        install([[M_X], [M_Y]], [modX, modY])
        const requestA = subjectAt(0)
        await mcp.getMCPTools(undefined, requestA)
        selectedCharID.set(1)

        const result = await mcp.callTool('tool_x', {}, { subject: requestA, mcpURL: X_URL })

        expect(textOf(result)).toContain('ok:' + X_URL)
    })

    test('a client ensured by a request survives another set\'s activity that runs before the request lists or calls it', async () => {
        install([[M_X], [M_Y]], [modX, modY])
        const requestA = subjectAt(0)
        const requestB = subjectAt(1)
        await mcp.initializeMCPs(undefined, requestA)
        selectedCharID.set(1)
        await mcp.getMCPTools(undefined, requestB)

        const result = await mcp.callTool('tool_x', {}, { subject: requestA, mcpURL: X_URL })

        expect(f.destroyed).not.toContain(X_URL)
        expect(builtOf(X_URL)).toBe(1)
        expect(textOf(result)).toContain('ok:' + X_URL)
    })

    test('a request calls a client by URL after the client left its subject\'s module set and the guard period passed, without shutting it down or rebuilding it', async () => {
        vi.useFakeTimers()
        try {
            install([[M_X]], [modX])
            const request = subjectAt(0)
            await mcp.getMCPTools(undefined, request)
            await vi.advanceTimersByTimeAsync(AFTER_GUARD)
            ;(DBState.db.characters[0] as unknown as { modules: string[] }).modules = []

            const result = await mcp.callTool('tool_x', {}, { subject: request, mcpURL: X_URL })

            expect(f.destroyed).not.toContain(X_URL)
            expect(builtOf(X_URL)).toBe(1)
            expect(textOf(result)).toContain('ok:' + X_URL)
        } finally {
            vi.useRealTimers()
        }
    })

    test('guard: two requests on one module set share one client and shut none down', async () => {
        install([[M_X]], [modX])

        await mcp.getMCPTools(undefined, subjectAt(0))
        await mcp.getMCPTools(undefined, subjectAt(0))

        expect(builtOf(X_URL)).toBe(1)
        expect(f.destroyed).toEqual([])
    })
})

describe('one URL has one live client however many activities ask for it at once', () => {
    test('three concurrent listings of one URL build one client', async () => {
        install([[M_X]], [modX])
        f.handshakeMs = 20
        const request = subjectAt(0)

        await Promise.all([mcp.getMCPTools(undefined, request), mcp.getMCPTools(undefined, request), mcp.getMCPTools(undefined, request)])

        expect(builtOf(X_URL)).toBe(1)
        expect(Object.keys(mcp.MCPs)).toEqual([X_URL])
    })

    test('guard: a URL swept out after the guard period gets a new live client when it is ensured again', async () => {
        vi.useFakeTimers()
        try {
            install([[M_X], [M_Y]], [modX, modY])
            await mcp.getMCPTools(undefined, subjectAt(0))
            const first = mcp.MCPs[X_URL]
            selectedCharID.set(1)
            await mcp.getMCPTools(undefined, subjectAt(1))
            await vi.advanceTimersByTimeAsync(AFTER_GUARD)
            await mcp.getMCPTools(undefined, subjectAt(1))
            selectedCharID.set(0)

            const tools = await mcp.getMCPTools(undefined, subjectAt(0))

            const second = mcp.MCPs[X_URL] as unknown as { destroyedFlag: boolean }
            expect(second).toBeTruthy()
            expect(second).not.toBe(first)
            expect(second.destroyedFlag).toBe(false)
            expect(names(tools)).toEqual(['tool_x'])
        } finally {
            vi.useRealTimers()
        }
    })

    // Fails an implementation that keeps a rejected creation as the URL's pending promise.
    test('guard: a creation whose handshake rejects once is retried by the next activity', async () => {
        install([[M_X]], [modX])
        f.badOnce.add(X_URL)
        const request = subjectAt(0)

        const first = await mcp.getMCPTools(undefined, request)
        const second = await mcp.getMCPTools(undefined, request)

        expect(names(first)).toEqual([])
        expect(names(second)).toEqual(['tool_x'])
    })

    test('guard: an unknown internal: URL rejects every activity and is never registered', async () => {
        install([[M_X]], [mod(M_X, 'internal:nope')])
        const request = subjectAt(0)
        const outcomes: string[] = []

        for (let i = 0; i < 2; i++) {
            outcomes.push(await mcp.getMCPTools(undefined, request).then(() => 'listed', () => 'rejected'))
        }

        expect(outcomes).toEqual(['rejected', 'rejected'])
        expect(Object.keys(mcp.MCPs)).not.toContain('internal:nope')
    })

    test('guard: a stdio: URL outside Tauri rejects every activity', async () => {
        install([[M_X]], [mod(M_X, 'stdio:{"command":"x","args":["y"]}')])
        const request = subjectAt(0)
        const outcomes: string[] = []

        for (let i = 0; i < 2; i++) {
            outcomes.push(await mcp.getMCPTools(undefined, request).then(() => 'listed', () => 'rejected'))
        }

        expect(outcomes).toEqual(['rejected', 'rejected'])
    })

    // Fails an implementation that lets a URL whose handshake failed abort the whole listing, or that reads a client it does not have.
    test('guard: a listing skips a URL whose handshake fails between two live ones, and a call reaches each live one', async () => {
        install([['m-a', 'm-bad', 'm-c']], [mod('m-a', 'https://a.test/mcp'), mod('m-bad', 'https://bad.test/mcp'), mod('m-c', 'https://c.test/mcp')])
        f.bad.add('https://bad.test/mcp')
        const request = subjectAt(0)

        const tools = await mcp.getMCPTools(undefined, request)
        const callA = await mcp.callTool('tool_a', {}, { subject: request, mcpURL: 'https://a.test/mcp' })
        const callC = await mcp.callTool('tool_c', {}, { subject: request, mcpURL: 'https://c.test/mcp' })

        expect(names(tools)).toEqual(['tool_a', 'tool_c'])
        expect(textOf(callA)).toContain('ok:https://a.test/mcp')
        expect(textOf(callC)).toContain('ok:https://c.test/mcp')
        expect(Object.keys(mcp.MCPs)).toEqual(['https://a.test/mcp', 'https://c.test/mcp'])
    })
})

describe('an activity lists and calls only its own module set', () => {
    // Fails an implementation that lists every registered client once a client may outlive a switch.
    test('guard: after a switch from set X to set Y a listing with no subject returns only Y\'s tools', async () => {
        install([[M_X], [M_Y]], [modX, modY])

        const listedX = await mcp.getMCPTools()
        selectedCharID.set(1)
        const listedY = await mcp.getMCPTools()

        expect(names(listedX)).toEqual(['tool_x'])
        expect(names(listedY)).toEqual(['tool_y'])
    })

    // Fails an implementation that lists every registered client, including one kept registered by a call in flight.
    test('guard: a listing hides a client that another request\'s call in flight keeps registered', async () => {
        install([[M_X], [M_Y]], [modX, modY])
        await mcp.getMCPTools(undefined, subjectAt(0))
        f.pending = new Promise<void>((res) => { f.release = res })
        const call = mcp.callTool('tool_x', {}, { subject: subjectAt(0), mcpURL: X_URL })
        await vi.waitFor(() => { expect(f.calls).toHaveLength(1) })
        selectedCharID.set(1)

        const listedY = await mcp.getMCPTools(undefined, subjectAt(1))
        f.release!()
        await call

        expect(names(listedY)).toEqual(['tool_y'])
    })

    // Fails an implementation that scans every registered client by name and reaches the first one that has the tool.
    test('guard: a call by name with no subject reaches the selection\'s client, never another set\'s client with a same-named tool', async () => {
        const modXo = mod('m-xo', 'https://x.other/mcp')
        install([[M_X], ['m-xo']], [modX, modXo])
        await mcp.getMCPTools()
        selectedCharID.set(1)
        await mcp.getMCPTools()

        const result = await mcp.callTool('tool_x', {})

        expect(textOf(result)).toContain('ok:https://x.other/mcp')
    })

    // Fails an implementation that reports every registered client.
    test('guard: the metadata read returns only the selection\'s module set', async () => {
        const modXo = mod('m-xo', 'https://x.other/mcp')
        install([[M_X], ['m-xo']], [modX, modXo])
        await mcp.getMCPTools()
        selectedCharID.set(1)

        const meta = await mcp.getMCPMeta()

        expect(Object.keys(meta)).toEqual(['https://x.other/mcp'])
    })
})

describe('an idle client is kept for the guard period and then shut down', () => {
    test('an idle client survives the switch to another module set and that set\'s listing', async () => {
        install([[M_X], [M_Y]], [modX, modY])
        await mcp.getMCPTools(undefined, subjectAt(0))
        selectedCharID.set(1)

        await mcp.getMCPTools(undefined, subjectAt(1))

        expect(f.destroyed).not.toContain(X_URL)
        expect(Object.keys(mcp.MCPs)).toContain(X_URL)
    })

    test('an idle client is alive 30 seconds after another set\'s listing and is shut down by the first activity after the guard period', async () => {
        vi.useFakeTimers()
        try {
            install([[M_X], [M_Y]], [modX, modY])
            await mcp.getMCPTools(undefined, subjectAt(0))
            selectedCharID.set(1)
            await vi.advanceTimersByTimeAsync(30 * 1000)
            await mcp.getMCPTools(undefined, subjectAt(1))
            const destroyedWithinGuard = [...f.destroyed]

            await vi.advanceTimersByTimeAsync(AFTER_GUARD)
            await mcp.getMCPTools(undefined, subjectAt(1))

            expect(destroyedWithinGuard).not.toContain(X_URL)
            expect(f.destroyed).toContain(X_URL)
            expect(Object.keys(mcp.MCPs)).not.toContain(X_URL)
        } finally {
            vi.useRealTimers()
        }
    })

    // Fails an implementation whose in-flight count is not lowered when the call throws.
    test('guard: a client whose call threw is shut down after the guard period and one more activity', async () => {
        vi.useFakeTimers()
        try {
            install([[M_X], [M_Y]], [modX, modY])
            const request = subjectAt(0)
            await mcp.getMCPTools(undefined, request)
            f.throwCall.add(X_URL)
            const outcome = await mcp.callTool('tool_x', {}, { subject: request, mcpURL: X_URL }).then(() => 'returned', (e) => String(e))
            selectedCharID.set(1)
            await vi.advanceTimersByTimeAsync(AFTER_GUARD)

            await mcp.getMCPTools(undefined, subjectAt(1))

            expect(outcome).toContain('call failed')
            expect(f.destroyed).toContain(X_URL)
            expect(Object.keys(mcp.MCPs)).not.toContain(X_URL)
        } finally {
            vi.useRealTimers()
        }
    })

    test('a client whose destroy() throws does not lose the activity\'s result and is removed from the registry', async () => {
        vi.useFakeTimers()
        try {
            install([[M_X], [M_Y]], [modX, modY])
            await mcp.getMCPTools(undefined, subjectAt(0))
            f.throwDestroy.add(X_URL)
            selectedCharID.set(1)
            await vi.advanceTimersByTimeAsync(AFTER_GUARD)

            const outcome = await mcp.getMCPTools(undefined, subjectAt(1)).then((t) => names(t), (e) => 'rejected: ' + String(e))

            expect(outcome).toEqual(['tool_y'])
            expect(Object.keys(mcp.MCPs)).not.toContain(X_URL)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('one sweep shuts down every stale client and keeps the selection\'s idle ones', () => {
    test('one sweep removes two stale clients when the first one\'s destroy() throws', async () => {
        vi.useFakeTimers()
        try {
            const Z_URL = 'https://z.test/mcp'
            install([[M_X, 'm-z'], [M_Y]], [modX, modY, mod('m-z', Z_URL)])
            await mcp.getMCPTools(undefined, subjectAt(0))
            f.throwDestroy.add(X_URL)
            selectedCharID.set(1)
            await vi.advanceTimersByTimeAsync(AFTER_GUARD)

            await mcp.getMCPTools(undefined, subjectAt(1))

            expect(Object.keys(mcp.MCPs)).toEqual([Y_URL])
            expect(f.destroyed).toContain(Z_URL)
        } finally {
            vi.useRealTimers()
        }
    })

    // Fails an implementation whose sweep keeps only the activity's own URLs and shuts down the selection's idle ones.
    test('guard: a subject-bound activity keeps the selection\'s idle clients', async () => {
        vi.useFakeTimers()
        try {
            install([[M_X], [M_Y]], [modX, modY])
            selectedCharID.set(1)
            await mcp.getMCPTools()
            await vi.advanceTimersByTimeAsync(AFTER_GUARD)

            await mcp.getMCPTools(undefined, subjectAt(0))

            expect(f.destroyed).not.toContain(Y_URL)
            expect(Object.keys(mcp.MCPs)).toContain(Y_URL)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('internal:fs keeps the directory the user picked across a switch', () => {
    const M_FS = 'mod-fs'
    let pickerCalls = 0
    let savedPicker: unknown

    beforeEach(() => {
        pickerCalls = 0
        savedPicker = (globalThis as Record<string, unknown>).showDirectoryPicker
        const picker = async () => { pickerCalls++; return { name: `dir${pickerCalls}` } }
        ;(globalThis as Record<string, unknown>).showDirectoryPicker = picker
        ;(window as unknown as Record<string, unknown>).showDirectoryPicker = picker
    })

    afterEach(() => {
        ;(globalThis as Record<string, unknown>).showDirectoryPicker = savedPicker
        ;(window as unknown as Record<string, unknown>).showDirectoryPicker = savedPicker
    })

    test('a switch away from a set with internal:fs and back asks for the directory once and keeps the same client', async () => {
        install([[M_FS], [M_Y]], [mod(M_FS, 'internal:fs'), modY])
        await mcp.getMCPTools(undefined, subjectAt(0))
        const first = mcp.MCPs['internal:fs']
        selectedCharID.set(1)
        await mcp.getMCPTools(undefined, subjectAt(1))
        selectedCharID.set(0)

        await mcp.getMCPTools(undefined, subjectAt(0))

        expect(pickerCalls).toBe(1)
        expect(mcp.MCPs['internal:fs']).toBe(first)
    })

    test('a request bound to the set with internal:fs reaches the same client while the selection is on another set', async () => {
        install([[M_FS], [M_Y]], [mod(M_FS, 'internal:fs'), modY])
        const request = subjectAt(0)
        await mcp.getMCPTools(undefined, request)
        const first = mcp.MCPs['internal:fs']
        selectedCharID.set(1)
        await mcp.getMCPTools(undefined, subjectAt(1))

        const result = await mcp.callTool('fs_read_file', { path: 'nope.txt' }, { subject: request, mcpURL: 'internal:fs' })

        expect(pickerCalls).toBe(1)
        expect(mcp.MCPs['internal:fs']).toBe(first)
        expect(textOf(result)).not.toContain('not found')
    })

    test('guard: listing the same set twice asks for the directory once', async () => {
        install([[M_FS]], [mod(M_FS, 'internal:fs')])

        await mcp.getMCPTools(undefined, subjectAt(0))
        await mcp.getMCPTools(undefined, subjectAt(0))

        expect(pickerCalls).toBe(1)
    })
})

describe('internal:risuai is callable from every set and listed only by the sets that include it', () => {
    const slow = mod('m-slow', 'https://slow.test/mcp')
    const sets = [['m-slow', M_RISU], [M_Y]]

    test('a listing of the set that includes it keeps it although another set\'s activity ran between the listing\'s start and its read, and builds one client', async () => {
        install(sets, [slow, modRisu, modY])
        let openHold!: () => void
        f.listHold['https://slow.test/mcp'] = new Promise<void>((res) => { openHold = res })
        const listing = mcp.getMCPTools(undefined, subjectAt(0)).then((t) => names(t), (e) => 'rejected: ' + String(e))
        await vi.waitFor(() => { expect(f.held).toContain('https://slow.test/mcp') })
        selectedCharID.set(1)
        await mcp.getMCPTools(undefined, subjectAt(1))
        openHold()

        const listed = await listing

        expect(listed).toContain('risu-list-characters')
        expect(f.risuInstances).toBe(1)
    })

    test('alternating between a set that includes it and one that does not builds one client and keeps it listed', async () => {
        install(sets, [slow, modRisu, modY])

        await mcp.getMCPTools(undefined, subjectAt(0))
        selectedCharID.set(1)
        await mcp.getMCPTools(undefined, subjectAt(1))
        selectedCharID.set(0)
        const listedAgain = await mcp.getMCPTools(undefined, subjectAt(0))

        expect(listedAgain.filter((t) => t.name.startsWith('risu-')).length).toBeGreaterThan(0)
        expect(f.risuInstances).toBe(1)
    })

    test('guard: a call by name with no subject under a set that does not include it reaches it', async () => {
        install(sets, [slow, modRisu, modY])
        selectedCharID.set(1)
        await mcp.getMCPTools()

        const result = await mcp.callTool('risu-list-characters', {})

        expect(textOf(result)).not.toContain('not found')
        expect(textOf(result)).toContain('Char0')
    })
})

describe('a plugin MCP callback receives exactly the tool name and the arguments', () => {
    // Fails an implementation that spreads the subject or the call context into the arguments, or forwards a third argument.
    test('guard: the callback is called with (toolName, args) on the route with a subject and on the route without one', async () => {
        const pluginMcp = await import('../mcp/pluginmcp')
        const callback = vi.fn(async (_name: string, _args: unknown) => [{ type: 'text' as const, text: 'plug-ok' }])
        await pluginMcp.registerMCPModule(
            { identifier: 'plugin:p1', name: 'p', version: '1', description: 'd' },
            async () => [{ name: 'plug_tool', description: '', inputSchema: { type: 'object', properties: {} } }],
            callback as never,
        )
        install([['mod-p']], [mod('mod-p', 'plugin:p1')])
        const request = subjectAt(0)

        const tools = await mcp.getMCPTools(undefined, request)
        const withSubject = await mcp.callTool('plug_tool', { a: 1 }, { subject: request, mcpURL: 'plugin:p1' })
        const withoutSubject = await mcp.callTool('plug_tool', { a: 1 })

        expect(names(tools)).toEqual(['plug_tool'])
        expect(textOf(withSubject)).toBe('plug-ok')
        expect(textOf(withoutSubject)).toBe('plug-ok')
        expect(callback.mock.calls).toEqual([['plug_tool', { a: 1 }], ['plug_tool', { a: 1 }]])
        expect(callback.mock.calls.map((c) => c.length)).toEqual([2, 2])
    })
})

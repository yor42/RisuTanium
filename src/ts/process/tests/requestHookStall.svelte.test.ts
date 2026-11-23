/**
 * A plugin hook on the request path that never settles cannot hold a request after a Stop. The tool list, a
 * before-request replacer, the request trigger, the plugin provider and an after-request replacer are each raced on
 * the request's own signal; the request ends `Aborted`, sends nothing further, and never returns a half-replaced
 * success. A hook that settles later leaves no unhandled rejection and a late provider stream is cancelled.
 *
 * Drives the real `requestChatData` (the harness of `requestFallback.svelte.test.ts`); the network, the tool path and
 * the trigger runner are mocked.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RunSubject } from '../chatOrigin'
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    /** Every `globalFetch` call, in order. */
    fetches: [] as Array<{ url: string, body: Record<string, unknown> }>,
    /** Calls to `globalFetch` that answer with a failure before answering normally. */
    failNext: 0,
    /** Runs after each `globalFetch` call has answered. */
    afterFetch: null as null | ((count: number) => void),
    /** Runs on each attempt after the `replacerbeforeRequest` awaits, i.e. between `getTools()` and the trigger. */
    hook: null as null | (() => void),
    reply: 'ok',
    hordeBody: null as null | Record<string, unknown>,
    transformerPrompt: null as null | string,
    ollamaBody: null as null | Record<string, unknown>,
    marks: [] as string[],
    counting: false,
    reads: [] as string[],
    getToolsImpl: (async () => []) as () => Promise<unknown[]>,
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
    const inner = writable(-1)
    // Every read of the selection goes through `subscribe` (`get()` included); `set` does not.
    const selectedCharID = {
        ...inner,
        subscribe: (run: (v: number) => void, invalidate?: () => void) => {
            if (h.counting) {
                h.reads.push(new Error().stack ?? '')
            }
            return inner.subscribe(run, invalidate)
        },
    }
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

// The tool path is mocked: which tools a request gets is outside what this file checks.
vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => h.getToolsImpl()), callTool: vi.fn() }))

vi.mock('../triggers', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../triggers')>()),
    runTrigger: vi.fn(async () => null),
}))

vi.mock('../transformers', () => ({
    runTransformers: vi.fn(async (prompt: string) => { h.transformerPrompt = prompt; return { generated_text: h.reply } }),
    runImageEmbedding: vi.fn(),
}))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../request/anthropic', () => ({ requestClaude: vi.fn() }))
vi.mock('../request/google', () => ({ requestGoogleCloudVertex: vi.fn() }))

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

type Msg = { role: string, content: string }
type Fixture = Record<string, unknown>
type Outcome = { type: string, result: unknown, model?: string }

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Outcome>
let createSendSubject: typeof import('../chatOrigin').createSendSubject
let runTrigger: ReturnType<typeof vi.fn>
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let pluginV2: {
    replacerbeforeRequest: Set<(f: unknown, m: string) => Promise<unknown>>
    replacerafterRequest: Set<(r: unknown, m: string) => Promise<unknown>>
    providers: Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>
}

beforeAll(async () => {
    requestChatData = (await import('../request/request')).requestChatData as never
    createSendSubject = (await import('../chatOrigin')).createSendSubject
    runTrigger = (await import('../triggers')).runTrigger as never
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    pluginV2 = (await import('../../plugins/plugins.svelte')).pluginV2 as never
})

function makeChar(): Fixture {
    return {
        chaId: 'a', name: 'AliceName', type: 'character', chatPage: 0, triggerscript: [], modules: [], customscript: [], globalLore: [],
        lowLevelAccess: false, defaultVariables: '',
        chats: [{ id: 'cA', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
    }
}

function installDb(extra: Fixture = {}): void {
    DBState.db = {
        characters: [makeChar()], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser',
        personas: [{ id: 'p-S', name: 'SelectedPersona', personaPrompt: '', icon: '' }], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: 'k', top_k: 1, top_p: 1, reverseProxyOobaArgs: {},
        useInstructPrompt: false, ...extra,
    } as unknown as Database
    selectedCharID.set(0)
}

const prompt = (): Msg[] => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

function subjectOfChat(): RunSubject {
    const owner = DBState.db.characters[0] as unknown as { chaId: string, chats: Array<{ id: string }> }
    const target = owner.chats[0]
    return createSendSubject({ chaId: owner.chaId, chatId: target.id }, { owner: owner as never, chat: target as never })
}

function ask(signal?: AbortSignal | null, extra: Fixture = {}) {
    return requestChatData({ formated: prompt(), bias: {}, useStreaming: false, noMultiGen: true, ...extra }, 'model', signal ?? null)
}

const hang = () => new Promise<never>(() => {})

/** Two macrotask flushes, so a late rejection would have reached the process handler. */
async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Starts `ask`, lets it reach the hook, aborts, and reports whether and how it settled. */
async function stopped(extra: Fixture = {}, use: 'none' | 'subject' = 'none') {
    const controller = new AbortController()
    let settled = false
    const call = ask(controller.signal, use === 'subject' ? { subject: subjectOfChat(), ...extra } : extra).then((value) => { settled = true; return value })
    await flush()
    const before = settled
    controller.abort()
    await flush()
    return { before, after: settled, call }
}

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    h.fetches.length = 0; h.failNext = 0; h.afterFetch = null; h.hook = null; h.reply = 'ok'; h.getToolsImpl = async () => []
    pluginV2.replacerbeforeRequest.clear()
    pluginV2.replacerafterRequest.clear()
    pluginV2.providers.clear()
    runTrigger.mockReset()
    runTrigger.mockImplementation(async () => null)
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    installDb()
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
})

describe('a hook on the request path that never settles', () => {
    test('MCP-1: the tool list never settles, the abort ends the request Aborted and nothing is sent', async () => {
        h.getToolsImpl = hang
        const run = await stopped()

        expect(run.before).toBe(false)
        expect(run.after).toBe(true)
        expect(await run.call).toMatchObject({ type: 'fail', result: 'Aborted' })
        expect(h.fetches).toEqual([])
    })

    test('R-1: a before-request replacer never settles, the request ends Aborted and nothing is sent', async () => {
        pluginV2.replacerbeforeRequest.add(hang)
        const run = await stopped()

        expect(run.before).toBe(false)
        expect(run.after).toBe(true)
        expect(await run.call).toMatchObject({ type: 'fail', result: 'Aborted' })
        expect(h.fetches).toEqual([])
    })

    test('R-4: the request trigger never settles, the request ends Aborted and nothing is sent', async () => {
        runTrigger.mockImplementation(hang)
        const run = await stopped()

        expect(run.before).toBe(false)
        expect(run.after).toBe(true)
        expect(await run.call).toMatchObject({ type: 'fail', result: 'Aborted' })
        expect(h.fetches).toEqual([])
    })

    test('R-4: the same holds for a request that carries a subject', async () => {
        runTrigger.mockImplementation(hang)
        const run = await stopped({}, 'subject')

        expect(run.before).toBe(false)
        expect(run.after).toBe(true)
        expect(await run.call).toMatchObject({ type: 'fail', result: 'Aborted' })
        expect(h.fetches).toEqual([])
    })

    test('R-2: an after-request replacer never settles, the request ends Aborted and not with the answer', async () => {
        pluginV2.replacerafterRequest.add(hang)
        const run = await stopped()

        expect(h.fetches).toHaveLength(1)
        expect(run.before).toBe(false)
        expect(run.after).toBe(true)
        expect(await run.call).toMatchObject({ type: 'fail', result: 'Aborted' })
    })
})

describe('the request trigger', () => {
    test('R-3: it is called with the request signal, with and without a subject', async () => {
        const controller = new AbortController()

        await ask(controller.signal)
        await ask(controller.signal, { subject: subjectOfChat() })

        const requests = runTrigger.mock.calls.filter((call) => call[1] === 'request')
        expect(requests).toHaveLength(2)
        for (const call of requests) {
            expect(call[2].signal).toBe(controller.signal)
        }
    })

    test('R-7: a trigger that settles in the tick of the Stop leaves no request to send', async () => {
        const controller = new AbortController()
        runTrigger.mockImplementation(() => new Promise((resolve) => {
            // Resolved first, aborted by the next microtask: the race has already taken the value.
            setTimeout(() => { resolve(null); queueMicrotask(() => controller.abort()) }, 0)
        }))

        const outcome = await ask(controller.signal)

        expect(outcome).toMatchObject({ type: 'fail', result: 'Aborted' })
        expect(h.fetches).toEqual([])
    })
})

describe('the plugin provider', () => {
    const provider = (answer: () => Promise<unknown>) => {
        installDb({ aiModel: 'custom', currentPluginProvider: 'X' })
        pluginV2.providers.set('X', answer as never)
    }

    test('R-5: a provider that ignores the signal ends the request Aborted at the abort', async () => {
        provider(hang)
        const run = await stopped()

        expect(run.before).toBe(false)
        expect(run.after).toBe(true)
        expect(await run.call).toMatchObject({ type: 'fail', result: 'Aborted' })
    })

    async function lateAnswer(value: unknown) {
        let resolve: (value: unknown) => void = () => {}
        provider(() => new Promise((r) => { resolve = r }))
        const run = await stopped()
        expect(run.after).toBe(true)
        resolve(value)
        await flush()
        await flush()
    }

    test('R-5 (a): a late readable stream is cancelled', async () => {
        const cancel = vi.fn()

        await lateAnswer({ success: true, content: new ReadableStream({ cancel }) })

        expect(cancel).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
    })

    test('R-5 (b): a late stream the provider already errored is one warning and no unhandled rejection', async () => {
        const error = new Error('AbortError: plugin fetch aborted')

        await lateAnswer({ success: true, content: new ReadableStream({ start(controller) { controller.error(error) } }) })

        expect(unhandled).toEqual([])
        expect(console.warn).toHaveBeenCalledWith('The plugin provider', error)
    })

    test('R-5 (c): a late stream whose source cancel throws is one warning and no unhandled rejection', async () => {
        const error = new Error('source cancel failed')

        await lateAnswer({ success: true, content: new ReadableStream({ cancel() { throw error } }) })

        expect(unhandled).toEqual([])
        expect(console.warn).toHaveBeenCalledWith('The plugin provider', error)
    })

    test('R-5 (d): a late undefined answer is no warning and no unhandled rejection', async () => {
        await lateAnswer(undefined)

        expect(unhandled).toEqual([])
        expect(vi.mocked(console.warn).mock.calls.filter((call) => call.length > 1)).toEqual([])
    })
})

describe('no signal', () => {
    test('R-6: guard, replacers and the trigger are awaited as before and the answer is returned', async () => {
        pluginV2.replacerbeforeRequest.add(async (formated) => { await new Promise((resolve) => setTimeout(resolve, 5)); return formated })
        pluginV2.replacerafterRequest.add(async (result) => `${String(result)}+after`)

        const outcome = await ask(null)

        expect(outcome).toMatchObject({ type: 'success', result: 'ok+after' })
        expect(h.fetches).toHaveLength(1)
        expect(runTrigger.mock.calls.find((call) => call[1] === 'request')![2].signal).toBeUndefined()
    })
})

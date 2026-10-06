/**
 * A request that carries a subject runs its `request` trigger, and formats the names in a
 * text-completion prompt, as the chat the subject stands for -- whatever the selection is at the
 * time. A request with no subject keeps reading the selection.
 *
 * Drives the real `requestChatData`, `runTrigger`, `modules`, `chatOrigin`, `parser`, `util`,
 * `stringlize`, `nai`, `chatTemplate`, the real `modellist` and the real OpenAI-compatible request
 * module. Only the network (`globalFetch`, the global `fetch`, the Ollama client, the transformers
 * runner), the tool path, the tokenizer and the platform/IO packages are mocked, so nothing here says
 * anything about a native backend.
 *
 * `subject` is passed to `requestChatData` through a cast: the field belongs to the request
 * argument type.
 *
 * Tests whose title starts with `guard:` pass with or without the binding and pin behaviour that
 * must be preserved.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { flushSync } from 'svelte'
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
vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn() }))

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

//#region fixtures

type Msg = { role: string, content: string }
type Fixture = Record<string, unknown>

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<{ type: string, result: unknown, model?: string }>
let runTrigger: (char: unknown, mode: string, arg: Record<string, unknown>) => Promise<{ displayData?: string } | null>
let createSendSubject: typeof import('../chatOrigin').createSendSubject
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let pluginV2: {
    replacerbeforeRequest: Set<(f: unknown, m: string) => Promise<unknown>>
    providers: Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>
}

beforeAll(async () => {
    const origFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string, body?: string }) => {
        if (String(url).includes('stablehorde.net')) {
            if (init?.method === 'POST') {
                h.hordeBody = JSON.parse(init.body ?? '{}')
                return { status: 202, json: async () => ({ id: 'job-1', message: '' }), text: async () => '' }
            }
            return { status: 200, json: async () => ({ is_possible: true, done: true, generations: [{ text: h.reply }] }) }
        }
        if (String(url).includes('ollama.test')) {
            h.ollamaBody = JSON.parse(init?.body ?? '{}')
            return new Response(JSON.stringify({ model: 'llama', created_at: '', message: { role: 'assistant', content: h.reply }, done: true }), {
                status: 200, headers: { 'Content-Type': 'application/json' },
            })
        }
        return origFetch(url as never, init as never)
    }))
    requestChatData = (await import('../request/request')).requestChatData as never
    runTrigger = (await import('../triggers')).runTrigger as never
    const chatOrigin = await import('../chatOrigin')
    createSendSubject = chatOrigin.createSendSubject
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    pluginV2 = (await import('../../plugins/plugins.svelte')).pluginV2 as never
})

afterAll(() => {
    vi.unstubAllGlobals()
})

/** The persona at `selectedPersona` is a third one, so no chat below is bound to it. */
const PERSONAS = [
    { id: 'p-S', name: 'SelectedPersona', personaPrompt: '', icon: '' },
    { id: 'p-A', name: 'PersonaAlpha', personaPrompt: '', icon: '' },
    { id: 'p-B', name: 'SentinelPersona', personaPrompt: '', icon: '' },
]

let moduleCounter = 0
function newModuleId(): string {
    moduleCounter++
    return `mod-${moduleCounter}`
}

function chat(id: string, vars: Record<string, string> = {}, extra: Fixture = {}): Fixture {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: vars, GLGlobalVariables: {}, modules: [], ...extra }
}

/** A `request` trigger that sets one message of the prompt to `${tag}:${$v}` (the chat variable `v`). */
function reqTrigger(tag: string, index = '0'): Fixture {
    return {
        comment: `request ${tag}`, type: 'request', conditions: [], lowLevelAccess: false,
        effect: [{ type: 'v2SetRequestState', index, indexType: 'value', value: `${tag}:{{getvar::v}}`, valueType: 'value', indent: 0 }],
    }
}

function makeChar(chaId: string, name: string, chats: Fixture[], triggers: Fixture[] = [], extra: Fixture = {}): Fixture {
    return {
        chaId, name, type: 'character', chatPage: 0, chats, triggerscript: triggers, modules: [], customscript: [], globalLore: [],
        lowLevelAccess: false, defaultVariables: '', ...extra,
    }
}

function makeGroup(chaId: string, name: string, chats: Fixture[], members: string[]): Fixture {
    return { chaId, name, type: 'group', chatPage: 0, chats, characters: members, triggerscript: [], modules: [], customscript: [], globalLore: [], defaultVariables: '' }
}

const JINJA = "{% for message in messages %}[{{ message['role'] }}] {{ message['content'] }}\n{% endfor %}RC=[{{ risu_char }}] RU=[{{ risu_user }}]"

function installDb(characters: Fixture[], extra: Fixture = {}, modules: Fixture[] = []): void {
    DBState.db = {
        characters, enabledModules: [], modules, templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 2, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: PERSONAS, selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: 'k',
        instructChatTemplate: 'jinja', JinjaTemplate: JINJA, localStopStrings: ['{{char}}:', '{{user}}:'],
        NAIsettings: { seperator: '\n', starter: '', topK: 1, topP: 1, topA: 1, tailFreeSampling: 1, repetitionPenalty: 1, repetitionPenaltyRange: 1, repetitionPenaltySlope: 1, frequencyPenalty: 0, presencePenalty: 0, typicalp: 1 },
        NAIappendName: true, NAIadventure: false, novelai: { token: 't' },
        ainconfig: { top_p: 1, top_k: 1, rep_pen: 1, top_a: 1, rep_pen_slope: 1, rep_pen_range: 1, typical_p: 1, badwords: '', stoptokens: '' }, novellistAPI: 'k',
        ooba: { formating: { userPrefix: 'U:', seperator: '\n' }, top_k: 1, top_p: 1, repetition_penalty: 1, typical_p: 1 },
        textgenWebUIStreamURL: 'ws://ooba.test/api/v1/stream', textgenWebUIBlockingURL: 'http://ooba.test/api/v1/generate', reverseProxyOobaArgs: {}, mancerHeader: 'k',
        koboldURL: 'http://kobold.test/api/v1/generate', hordeConfig: { apiKey: '' }, top_k: 1, top_p: 1,
        ollamaURL: 'http://ollama.test', ollamaModel: 'llama', ollamaThinkingMode: 'default', ollamaModelSource: 'x',
        useInstructPrompt: false, openrouterRequestModel: 'x/y', openrouterKey: 'k', proxyRequestModel: 'x',
        ...extra,
    } as unknown as Database
}

const prompt = (): Msg[] => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

/** A request that carries `subject` (when given); the provider is the model in `db.aiModel`. */
async function ask(subject: RunSubject | null, extra: Fixture = {}, formated: Msg[] = prompt(), model = 'model') {
    return requestChatData({
        formated, bias: {}, useStreaming: false, noMultiGen: true, ...(subject ? { subject } : {}), ...extra,
    }, model)
}

/** The chat messages of the `globalFetch` call number `n` (the last one by default), as one string per message. */
function messagesOf(n = -1): string[] {
    const call = h.fetches.at(n)!
    return (call.body.messages as Msg[]).map((m) => m.content)
}

beforeEach(() => {
    h.fetches.length = 0; h.failNext = 0; h.afterFetch = null; h.hook = null; h.reply = 'ok'
    h.hordeBody = null; h.transformerPrompt = null; h.ollamaBody = null; h.marks.length = 0; h.counting = false; h.reads.length = 0
    pluginV2.replacerbeforeRequest.clear()
    pluginV2.replacerbeforeRequest.add(async (f) => { const run = h.hook; h.hook = null; run?.(); return f })
    pluginV2.providers.clear()
    selectedCharID.set(-1)
})

//#endregion

//#region the request trigger

const chatsOf = (c: Fixture) => c.chats as Fixture[]

/** The subject of a send that started in chat `chatIndex` of the character at `charIndex`, read back through the live database. */
function subjectAt(charIndex: number, chatIndex = 0, memberChaId?: string): RunSubject {
    const owner = DBState.db.characters[charIndex] as unknown as { chaId: string, chats: Array<{ id: string }> }
    const target = owner.chats[chatIndex]
    return createSendSubject(
        { chaId: owner.chaId, chatId: target.id, ...(memberChaId ? { memberChaId } : {}) },
        { owner: owner as never, chat: target as never },
    )
}

const liveChar = (index: number) => DBState.db.characters[index] as unknown as Fixture & { chatPage: number, chats: Fixture[] }

describe('a request with a subject runs the request trigger as the subject\'s chat', () => {
    test('a switch to Home between getTools and the trigger still rewrites the prompt with the subject\'s trigger', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        installDb([A]); selectedCharID.set(0)
        h.hook = () => selectedCharID.set(-1)

        await ask(subjectAt(0))

        expect(messagesOf()[0]).toContain('TA:A1')
    })

    test('a switch to the character\'s other chat still reads the variables of the subject\'s chat', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' }), chat('c1b', { $v: 'A2' })], [reqTrigger('TA')])
        installDb([A]); selectedCharID.set(0)
        h.hook = () => { liveChar(0).chatPage = 1 }

        await ask(subjectAt(0, 0))

        expect(messagesOf()[0]).toContain('TA:A1')
    })

    test('a switch to another character runs the subject\'s trigger, not the other character\'s', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
        installDb([A, B]); selectedCharID.set(0)
        h.hook = () => selectedCharID.set(1)

        await ask(subjectAt(0))

        expect(messagesOf()[0]).toContain('TA:A1')
    })

    test('a switch to a group still runs the subject\'s trigger', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const G = makeGroup('g', 'TheGroup', [chat('gc')], ['a'])
        installDb([A, G]); selectedCharID.set(0)
        h.hook = () => selectedCharID.set(1)

        await ask(subjectAt(0))

        expect(messagesOf()[0]).toContain('TA:A1')
    })

    test('a chat-level module trigger present only in the chat switched to does not run over the subject\'s prompt', async () => {
        const modId = newModuleId()
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' }), chat('c1b', { $v: 'A2' }, { modules: [modId] })], [reqTrigger('TA')])
        installDb([A], {}, [{ id: modId, name: 'other chat module', description: '', trigger: [reqTrigger('MOD-X', '1')], lowLevelAccess: false }])
        selectedCharID.set(0)
        h.hook = () => { liveChar(0).chatPage = 1 }

        await ask(subjectAt(0, 0))

        expect.soft(messagesOf().join('|'), 'the module trigger of the other chat ran').not.toContain('MOD-X')
        expect.soft(messagesOf()[0]).toContain('TA:A1')
    })

    test('a retry after a switch runs the subject\'s trigger, not the selection\'s', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
        installDb([A, B]); selectedCharID.set(0)
        h.failNext = 1
        h.afterFetch = (count) => { if (count === 1) selectedCharID.set(1) }

        await ask(subjectAt(0))

        expect(h.fetches.length, 'the provider failed once and was retried').toBe(2)
        expect(messagesOf(1)[0]).toContain('TA:A1')
    })

    test('a fallback model after a switch runs the subject\'s trigger, not the selection\'s', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
        installDb([A, B], { requestRetrys: 0, fallbackModels: { model: ['gpt4om', 'gpt4o'] } }); selectedCharID.set(0)
        h.failNext = 1
        h.afterFetch = (count) => { if (count === 1) selectedCharID.set(1) }

        await ask(subjectAt(0))

        expect(h.fetches.length, 'the first model failed and the next one was tried').toBe(2)
        expect(messagesOf(1)[0]).toContain('TA:A1')
    })

    test('a subject whose chat was removed before the trigger skips the trigger instead of running it on the character\'s other chat', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' }), chat('c1b', { $v: 'A2' })], [reqTrigger('TA')])
        installDb([A]); selectedCharID.set(0)
        const subject = subjectAt(0, 0)
        h.hook = () => { liveChar(0).chats.splice(0, 1) }

        await ask(subject)

        expect(messagesOf()[0]).toContain('ORIG')
    })

    test('a subject whose chat id has two holders skips the trigger even when the selection is on the first holder', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'X' }), chat('c1', { $v: 'Y' })], [reqTrigger('TA')])
        installDb([A]); selectedCharID.set(0)

        await ask(subjectAt(0, 1))

        expect(messagesOf()[0]).toContain('ORIG')
    })

    test('a group send while a character is selected does not run that character\'s trigger over the group turn\'s prompt', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const G = makeGroup('g', 'TheGroup', [chat('gc')], ['a'])
        installDb([A, G]); selectedCharID.set(0)

        await ask(subjectAt(1, 0, 'a'), { currentChar: liveChar(0) })

        expect(messagesOf()[0]).toContain('ORIG')
    })

    test('guard: a group send does not run a request trigger of a module enabled on the chat of the group', async () => {
        const modId = newModuleId()
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const G = makeGroup('g', 'TheGroup', [chat('gc', {}, { modules: [modId] })], ['a'])
        installDb([A, G], {}, [{ id: modId, name: 'group chat module', description: '', trigger: [reqTrigger('GMOD')], lowLevelAccess: false }])
        selectedCharID.set(1)

        await ask(subjectAt(1, 0, 'a'), { currentChar: liveChar(0) })

        expect(messagesOf()[0]).toContain('ORIG')
        expect(messagesOf().join('|')).not.toContain('GMOD')
    })
})

describe('the request run writes nothing and marks nothing', () => {
    test('guard: a request-mode run under a plain origin changes no character and marks no save', async () => {
        const trigger = {
            comment: 'r', type: 'request', conditions: [], lowLevelAccess: false,
            effect: [
                { type: 'v2SetRequestState', index: '0', indexType: 'value', value: 'TA:{{getvar::v}}', valueType: 'value', indent: 0 },
                { type: 'v2SetVar', var: 'tmp', value: '1', valueType: 'value', operator: '=', indent: 0 },
            ],
        }
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [trigger])
        const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
        installDb([A, B]); selectedCharID.set(1)
        const before = JSON.stringify($state.snapshot(DBState.db.characters))

        const out = await runTrigger(liveChar(0), 'request', {
            chat: liveChar(0).chats[0], displayMode: true, displayData: JSON.stringify(prompt()), origin: { chaId: 'a', chatId: 'c1' },
        })

        expect(JSON.parse(out!.displayData!)[0].content, 'the run read the origin\'s chat').toBe('TA:A1')
        expect(JSON.stringify($state.snapshot(DBState.db.characters))).toBe(before)
        expect(h.marks).toEqual([])
    })

    test('guard: a request with a subject changes no chat variable of any character and marks no save', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
        installDb([A, B]); selectedCharID.set(1)
        const before = JSON.stringify($state.snapshot(DBState.db.characters))

        await ask(subjectAt(0))

        expect(JSON.stringify($state.snapshot(DBState.db.characters))).toBe(before)
        expect(h.marks).toEqual([])
    })
})

describe('a request with no subject follows the selection', () => {
    test('guard: the selected character\'s trigger runs over the prompt', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        installDb([A]); selectedCharID.set(0)

        await ask(null)

        expect(messagesOf()[0]).toContain('TA:A1')
    })

    test('guard: a selected group skips the trigger', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const G = makeGroup('g', 'TheGroup', [chat('gc')], ['a'])
        installDb([A, G]); selectedCharID.set(1)

        await ask(null)

        expect(messagesOf()[0]).toContain('ORIG')
    })

    test('guard: nothing selected sends the prompt as built', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        installDb([A]); selectedCharID.set(-1)

        const out = await ask(null)

        expect(out.type).toBe('success')
        expect(messagesOf()[0]).toContain('ORIG')
    })
})

describe('a request with nothing switched', () => {
    test('guard: the subject\'s trigger rewrites the prompt with the subject\'s chat variable', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        installDb([A]); selectedCharID.set(0)

        await ask(subjectAt(0))

        expect(messagesOf()[0]).toContain('TA:A1')
    })

    test('guard: a group send with the group selected skips the trigger and names the group', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const G = makeGroup('g', 'TheGroup', [chat('gc')], ['a'])
        installDb([A, G], { aiModel: 'novelai_kayra' }); selectedCharID.set(1)

        await ask(subjectAt(1, 0, 'a'), { currentChar: liveChar(0) })

        const input = String(h.fetches.at(-1)!.body.input)
        expect.soft(input, 'the trigger was skipped').toContain('ORIG')
        expect.soft(input, 'the group\'s name ends the prompt').toMatch(/TheGroup:$/)
    })

    test('guard: a plugin provider is handed no subject', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [])
        installDb([A], { aiModel: 'custom', currentPluginProvider: 'plug' }); selectedCharID.set(0)
        const seen: Array<Record<string, unknown>> = []
        pluginV2.providers.set('plug', async (args) => { seen.push(args); return { success: true, content: 'fine' } })
        const subject = subjectAt(0)

        const out = await ask(subject)

        expect(out.result).toBe('fine')
        expect(seen.length).toBe(1)
        expect(Object.keys(seen[0])).not.toContain('subject')
        expect(Object.values(seen[0])).not.toContain(subject)
    })
})

//#endregion

//#region a trigger run's model calls

/** A trigger whose one effect runs the model on `hello` (the effect types that make a model call). */
function llmTrigger(kind: 'v2RunLLM' | 'runLLM' | 'runAxLLM', lowLevelAccess = true): Fixture {
    return {
        comment: 'llm', type: 'start', conditions: [], lowLevelAccess,
        effect: [kind === 'v2RunLLM'
            ? { type: 'v2RunLLM', value: 'hello', valueType: 'value', model: 'model', outputVar: 'o', streaming: false, indent: 0 }
            : { type: kind, value: 'hello', inputVar: 'o', indent: 0 }],
    }
}

/** Runs the start trigger of a character that owns one chat, while the selection is on another character, and returns the chat's `o` variable. */
async function runAxLLMTrigger(lowLevelAccess: boolean, db: Fixture): Promise<string | undefined> {
    const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [llmTrigger('runAxLLM')], { lowLevelAccess })
    const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })])
    installDb([A, B], db); selectedCharID.set(1)

    await runTrigger(liveChar(0), 'start', { chat: liveChar(0).chats[0], origin: { chaId: 'a', chatId: 'c1' } })

    return (liveChar(0).chats[0].scriptstate as Record<string, string>)['$o']
}

describe('a trigger run\'s model call follows the run\'s own chat', () => {
    for (const kind of ['v2RunLLM', 'runLLM'] as const) {
        test(`${kind} in a run on chat A runs A's request trigger when the selection is on another character`, async () => {
            const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [llmTrigger(kind), reqTrigger('TA')], { lowLevelAccess: true })
            const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
            installDb([A, B]); selectedCharID.set(1)

            await runTrigger(liveChar(0), 'start', { chat: liveChar(0).chats[0], origin: { chaId: 'a', chatId: 'c1' } })

            expect(h.fetches.length, 'the model was called once').toBe(1)
            expect(messagesOf()[0]).toContain('TA:A1')
        })
    }

    test('a group-owned run\'s model call skips the request trigger of the selected character', async () => {
        const modId = newModuleId()
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [reqTrigger('TA')])
        const G = makeGroup('g', 'TheGroup', [chat('gc', {}, { modules: [modId] })], ['a'])
        installDb([A, G], {}, [{ id: modId, name: 'group module', description: '', trigger: [llmTrigger('v2RunLLM')], lowLevelAccess: true }])
        selectedCharID.set(0)

        await runTrigger(liveChar(1), 'start', { chat: liveChar(1).chats[0], origin: { chaId: 'g', chatId: 'gc' } })

        expect(h.fetches.length, 'the model was called once').toBe(1)
        expect(messagesOf()[0]).toContain('hello')
    })

    test('runAxLLM calls the separate other-auxiliary model and writes the answer into its own chat', async () => {
        h.reply = 'ax-answer'
        const o = await runAxLLMTrigger(true, { aiModel: 'gpt4o', subModel: 'gpt4om', seperateModelsForAxModels: true, seperateModels: { otherAx: 'gpt41' } })

        expect(h.fetches.length, 'the model was called once').toBe(1)
        expect(h.fetches[0].body.model).toBe('gpt-4.1')
        expect(o).toBe('ax-answer')
    })

    test('runAxLLM calls the sub model when separate models are off', async () => {
        const o = await runAxLLMTrigger(true, { aiModel: 'gpt4o', subModel: 'gpt4om', seperateModelsForAxModels: false, seperateModels: { otherAx: 'gpt41' } })

        expect(h.fetches.length, 'the model was called once').toBe(1)
        expect(h.fetches[0].body.model).toBe('gpt-4o-mini')
        expect(o).toBe('ok')
    })

    test('runAxLLM writes the failure into its variable behind "Error: "', async () => {
        h.failNext = 10
        const o = await runAxLLMTrigger(true, {})

        expect(h.fetches.length, 'every attempt failed').toBeGreaterThan(0)
        expect(o).toMatch(/^Error: /)
    })

    test('guard: a runAxLLM in a run without low-level access makes no request', async () => {
        const o = await runAxLLMTrigger(false, {})

        expect(h.fetches.length).toBe(0)
        expect(o).toBeUndefined()
    })

    test('guard: a v2RunLLM in a chat whose id has two holders never reaches the provider', async () => {
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'X' }), chat('c1', { $v: 'Y' })], [llmTrigger('v2RunLLM'), reqTrigger('TA')], { lowLevelAccess: true })
        installDb([A]); selectedCharID.set(0)

        await runTrigger(liveChar(0), 'start', { chat: liveChar(0).chats[1], origin: { chaId: 'a', chatId: 'c1' } })

        expect(h.fetches.length).toBe(0)
    })
})

//#endregion

//#region every text-formatting provider path

type Reply = 'none' | 'user' | 'char'
type State = 'home' | 'poisoned' | 'aligned'

interface ProviderCase {
    key: string
    model: string
    db?: Fixture
    /** How the provider's own answer names a participant, so the reply parse can be told which names it knows. */
    replies: Reply[]
    /** The text the provider handed to the network. */
    payload(): string
    /** The stop strings the provider sent, when it sends any. */
    stops?(): unknown
    /** Where the names of the chat show up in `payload()`. */
    names: 'template' | 'novelai' | 'novellist' | 'none'
}

const lastBody = (): Record<string, unknown> => h.fetches.at(-1)?.body ?? {}

const PROVIDERS: ProviderCase[] = [
    { key: 'novelai', model: 'novelai_kayra', replies: ['user', 'char'], names: 'novelai', payload: () => String(lastBody().input ?? '') },
    { key: 'novellist', model: 'novellist', replies: ['user', 'char'], names: 'novellist', payload: () => String(lastBody().text ?? '') },
    { key: 'oobalegacy', model: 'mancer', replies: ['user', 'char'], names: 'template', payload: () => String(lastBody().prompt ?? ''), stops: () => lastBody().stopping_strings },
    { key: 'ooba', model: 'ooba', replies: ['none'], names: 'template', payload: () => String(lastBody().prompt ?? ''), stops: () => lastBody().stop },
    { key: 'kobold', model: 'kobold', replies: ['none'], names: 'template', payload: () => String(lastBody().prompt ?? '') },
    { key: 'horde', model: 'horde:::model-x', replies: ['user', 'char'], names: 'template', payload: () => String(h.hordeBody?.prompt ?? '') },
    { key: 'webllm', model: 'hf:::Xenova/opt-350m', replies: ['user', 'char'], names: 'template', payload: () => h.transformerPrompt ?? '' },
    { key: 'ollama', model: 'ollama-hosted', replies: ['user', 'char'], names: 'none', payload: () => JSON.stringify(h.ollamaBody?.messages ?? []) },
    { key: 'instruct', model: 'openrouter', db: { useInstructPrompt: true }, replies: ['none'], names: 'template', payload: () => String(lastBody().prompt ?? '') },
    { key: 'control', model: 'gpt4o', replies: ['none'], names: 'none', payload: () => JSON.stringify(lastBody().messages ?? []) },
]

const STATES: State[] = ['home', 'poisoned', 'aligned']
const WHERE: Record<State, string> = { home: 'at Home', poisoned: 'on a sentinel character', aligned: 'on the character of chat A' }

const SWEEP_PROMPT = (): Msg[] => [
    { role: 'system', content: 'ORIG-SYS' },
    { role: 'user', content: 'ask "one"' },
    { role: 'assistant', content: 'answer "spoken"' },
    { role: 'user', content: 'hi "there"' },
]

/** The provider's answer that contains a turn label for the participant `reply` names. */
function replyText(pc: ProviderCase, reply: Reply): string {
    if (pc.key === 'novellist') {
        return reply === 'user' ? 'hello」PersonaAlpha 「yo」' : 'hello」AliceName 「yo」'
    }
    return reply === 'user' ? 'R\nPersonaAlpha: z' : reply === 'char' ? 'R\nAliceName: z' : 'ok'
}

function expectedParse(pc: ProviderCase, reply: Reply): unknown {
    if (pc.key === 'novellist') {
        return reply === 'user' ? [['char', '「hello」'], ['user', '「yo」']] : [['char', '「hello」'], ['char', '「yo」']]
    }
    return 'R'
}

/** Chat A (Alice, persona bound) and a sentinel character B whose triggers, chat module, persona and persona module mark everything they touch. */
function sweepWorld(pc: ProviderCase): void {
    const modB = newModuleId()
    const modPersona = newModuleId()
    const A = makeChar('a', 'AliceName', [chat('cA', { $v: 'A1' }, { bindedPersona: 'p-A' })], [reqTrigger('TRIG-A')])
    const B = makeChar('b', 'SentinelBob', [chat('cB', { $v: 'SENTINEL-VAR' }, { bindedPersona: 'p-B', modules: [modB] })], [reqTrigger('SENTINEL-TRIG-B')])
    const personas = PERSONAS.map((p) => p.id === 'p-B' ? { ...p, embeddedModule: { id: modPersona } } : p)
    installDb([A, B], { aiModel: pc.model, personas, ...pc.db }, [
        { id: modB, name: 'sentinel chat module', description: '', trigger: [reqTrigger('SENTINEL-MOD-B', '1')], lowLevelAccess: false },
        { id: modPersona, name: 'sentinel persona module', description: '', trigger: [reqTrigger('SENTINEL-PERSONA-MOD', '3')], lowLevelAccess: false },
    ])
}

async function settle(): Promise<void> {
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 30))
}

/** The first two frames inside the repository's sources that led to a read of the selection. */
function readSite(stack: string): string {
    return stack.split('\n').filter((line) => line.includes('/src/ts/') && !line.includes('/process/tests/')).slice(0, 2)
        .map((line) => line.trim().replace(/^at /, '').replace(/^.*\/src\/ts\//, '')).join(' <- ')
}

interface RunOutcome {
    result: { type: string, result: unknown } | null
    error: unknown
    payload: string
    stops: unknown
    reads: string[]
    dbBefore: string
    dbAfter: string
}

/** One request through the provider under `state`, carrying a subject for chat A (or none), with the selection reads counted. */
async function runCase(pc: ProviderCase, state: State, reply: Reply, subject: 'a' | 'none' = 'a'): Promise<RunOutcome> {
    sweepWorld(pc)
    selectedCharID.set(state === 'home' ? -1 : state === 'poisoned' ? 1 : 0)
    await settle()
    h.fetches.length = 0; h.hordeBody = null; h.transformerPrompt = null; h.ollamaBody = null
    h.reply = replyText(pc, reply)
    const dbBefore = JSON.stringify($state.snapshot(DBState.db))
    const asSubject = subject === 'a' ? subjectAt(0) : null
    let result: RunOutcome['result'] = null
    let error: unknown
    h.reads.length = 0
    h.counting = true
    try {
        result = await ask(asSubject, { currentChar: liveChar(0) }, SWEEP_PROMPT())
    } catch (caught) {
        error = caught
    } finally {
        h.counting = false
    }
    return {
        result, error, payload: pc.payload(), stops: pc.stops?.(), reads: [...h.reads],
        dbBefore, dbAfter: JSON.stringify($state.snapshot(DBState.db)),
    }
}

describe('a request with a subject formats its prompt as the subject\'s chat', () => {
    for (const pc of PROVIDERS) {
        for (const state of STATES) {
            test(`${state === 'aligned' ? 'guard: ' : ''}${pc.key}: the payload names chat A and carries A's trigger with the selection ${WHERE[state]}`, async () => {
                const first = await runCase(pc, state, pc.replies[0])

                expect.soft(first.error, 'the request does not reject').toBeUndefined()
                expect.soft(first.payload, 'A\'s request trigger rewrote the prompt').toContain('TRIG-A:A1')
                expect.soft(first.payload, 'nothing of the sentinel character, its module or its persona').not.toMatch(/sentinel/i)
                if (pc.names === 'template') {
                    expect.soft(first.payload, 'risu_char and risu_user').toContain('RC=[AliceName] RU=[PersonaAlpha]')
                }
                if (pc.names === 'novelai') {
                    expect.soft(first.payload, 'the user turn is labelled with A\'s persona').toContain('PersonaAlpha: hi "there"')
                    expect.soft(first.payload, 'the assistant turn is labelled with A\'s name').toContain('AliceName: answer "spoken"')
                    expect.soft(first.payload, 'the prompt ends with A\'s name').toMatch(/\nAliceName:$/)
                }
                if (pc.names === 'novellist') {
                    expect.soft(first.payload, 'the user turn is labelled with A\'s persona').toContain('PersonaAlpha 「there」')
                    expect.soft(first.payload, 'the assistant turn is labelled with A\'s name').toContain('AliceName 「spoken」')
                }
                if (pc.stops) {
                    expect.soft(first.stops, 'local stop strings parsed as chat A').toEqual(expect.arrayContaining(['AliceName:', 'PersonaAlpha:']))
                    expect.soft(String(JSON.stringify(first.stops)), 'local stop strings carry nothing of the sentinel').not.toMatch(/sentinel/i)
                }
            })
        }
    }

    for (const pc of PROVIDERS) {
        for (const state of STATES) {
            for (const reply of pc.replies.filter((r) => r !== 'none')) {
                // The Ollama reply parse takes the character's name from the request's `currentChar`, which the
                // request already carries; only the user's name follows the subject.
                const isGuard = state === 'aligned' || (pc.key === 'ollama' && reply === 'char')
                test(`${isGuard ? 'guard: ' : ''}${pc.key}: a reply that opens a turn as ${reply === 'user' ? 'A\'s persona' : 'A\'s character'} is cut there with the selection ${WHERE[state]}`, async () => {
                    const run = await runCase(pc, state, reply)

                    expect.soft(run.error, 'the request does not reject').toBeUndefined()
                    expect.soft(run.result?.result, 'the parsed reply').toEqual(expectedParse(pc, reply))
                })
            }
        }
    }
})

describe('a request with no subject formats its prompt as the selection', () => {
    test('a template provider at Home does not reject and gives the template no character', async () => {
        sweepWorld(PROVIDERS.find((p) => p.key === 'kobold')!)
        selectedCharID.set(-1)

        const out = await ask(null, {}, SWEEP_PROMPT())

        expect.soft(out.type).toBe('success')
        expect.soft(String(lastBody().prompt)).toContain('RC=[] RU=[GlobalUser]')
    })

    test('guard: a template provider with a character selected labels the prompt with that character and its persona', async () => {
        sweepWorld(PROVIDERS.find((p) => p.key === 'kobold')!)
        selectedCharID.set(0)

        await ask(null, {}, SWEEP_PROMPT())

        expect(String(lastBody().prompt)).toContain('RC=[AliceName] RU=[PersonaAlpha]')
    })

    test('guard: a template provider labels a request without a subject with the sentinel selection, not with any chat A', async () => {
        sweepWorld(PROVIDERS.find((p) => p.key === 'kobold')!)
        selectedCharID.set(1)

        await ask(null, {}, SWEEP_PROMPT())

        expect(String(lastBody().prompt)).toContain('RC=[SentinelBob] RU=[SentinelPersona]')
    })
})

//#endregion

//#region the selection is not read

describe('a request with a subject makes no read of the selection between its start and its result', () => {
    for (const pc of PROVIDERS) {
        test(`${pc.key}: no read of the selection and no change to the database`, async () => {
            const run = await runCase(pc, 'poisoned', pc.replies[0])

            expect.soft(run.error, 'the request does not reject').toBeUndefined()
            expect.soft([...new Set(run.reads.map(readSite))].join(' ;; '), 'reads of the selection').toBe('')
            expect.soft(run.dbAfter === run.dbBefore, 'the database is unchanged by the request').toBe(true)
        })
    }
})

//#endregion

//#region persona modules and a subject that is gone

describe('a request with a subject reads the persona module of the subject\'s chat', () => {
    test('the module embedded in the persona bound to the subject\'s chat runs, and the one bound to the selection\'s chat does not', async () => {
        const modA = newModuleId()
        const modB = newModuleId()
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' }, { bindedPersona: 'p-A' })], [reqTrigger('TA')])
        const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' }, { bindedPersona: 'p-B' })], [reqTrigger('TB')])
        const personas = PERSONAS.map((p) => p.id === 'p-A' ? { ...p, embeddedModule: { id: modA } } : p.id === 'p-B' ? { ...p, embeddedModule: { id: modB } } : p)
        installDb([A, B], { personas }, [
            { id: modA, name: 'persona A module', description: '', trigger: [reqTrigger('PMOD-A', '1')], lowLevelAccess: false },
            { id: modB, name: 'persona B module', description: '', trigger: [reqTrigger('PMOD-B', '1')], lowLevelAccess: false },
        ])
        selectedCharID.set(0)
        h.hook = () => selectedCharID.set(1)

        await ask(subjectAt(0))

        expect.soft(messagesOf()[1], 'the persona module of the selection\'s chat ran').not.toContain('PMOD-B')
        expect.soft(messagesOf()[1], 'the persona module of the subject\'s chat ran').toContain('PMOD-A')
    })
})

describe('a request whose subject is gone uses nothing of the selection', () => {
    test('a template provider gets no character and the database user name, and no trigger runs', async () => {
        const pc = PROVIDERS.find((p) => p.key === 'kobold')!
        sweepWorld(pc)
        liveChar(0).chats.push(chat('cA2', { $v: 'A2' }) as never)
        selectedCharID.set(1)
        const subject = subjectAt(0, 0)
        liveChar(0).chats.splice(0, 1)

        const out = await ask(subject, { currentChar: liveChar(0) }, SWEEP_PROMPT())

        expect.soft(out.type).toBe('success')
        expect.soft(String(lastBody().prompt), 'the trigger of A\'s other chat or of the selection ran').not.toMatch(/TRIG-A|sentinel/i)
        expect.soft(String(lastBody().prompt)).toContain('RC=[] RU=[GlobalUser]')
    })
})

//#endregion

/**
 * The JSON schema of a request, and the extraction of its reply, resolve their CBS as the request's
 * subject: `{{char}}` in the schema and in the extraction path is the subject's character, whatever the
 * selection is at the time. A request with no subject keeps reading the selection. A Claude request
 * that sets an extraction path returns the extracted field, on both non-streaming branches.
 *
 * Drives the real `requestChatData`, `jsonSchema`, `parser`, `modules`, `chatOrigin`, the real
 * OpenAI-compatible request module and the real Anthropic request module. Only the network
 * (`globalFetch`), the tokenizer and the platform/IO packages are mocked, so nothing here says anything
 * about a native backend.
 *
 * Tests whose title starts with `guard:` pass with or without the binding and pin behaviour that must be
 * preserved.
 */
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
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
    /** Whether the default answer carries the reply in the chat-completion field only. */
    chatOnly: false,
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
            choices: [h.chatOnly ? { message: { content: reply } } : { text: reply, message: { content: reply } }],
        },
    }
}

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(async (url: string, opts: { body: Record<string, unknown> }) => {
        h.fetches.push({ url, body: JSON.parse(JSON.stringify(opts?.body ?? {})) })
        if (String(url).includes('api.anthropic.com') || String(url).includes('amazonaws.com')) { return { ok: true, data: { content: [{ type: 'text', text: h.reply }] } } }
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
let createSendSubject: typeof import('../chatOrigin').createSendSubject
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let pluginV2: {
    replacerbeforeRequest: Set<(f: unknown, m: string) => Promise<unknown>>
    providers: Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>
}

beforeAll(async () => {
    requestChatData = (await import('../request/request')).requestChatData as never
    const chatOrigin = await import('../chatOrigin')
    createSendSubject = chatOrigin.createSendSubject
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    pluginV2 = (await import('../../plugins/plugins.svelte')).pluginV2 as never
})

/** The persona at `selectedPersona` is a third one, so no chat below is bound to it. */
const PERSONAS = [
    { id: 'p-S', name: 'SelectedPersona', personaPrompt: '', icon: '' },
    { id: 'p-A', name: 'PersonaAlpha', personaPrompt: '', icon: '' },
    { id: 'p-B', name: 'SentinelPersona', personaPrompt: '', icon: '' },
]

function chat(id: string, vars: Record<string, string> = {}, extra: Fixture = {}): Fixture {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: vars, GLGlobalVariables: {}, modules: [], ...extra }
}

function makeChar(chaId: string, name: string, chats: Fixture[], triggers: Fixture[] = [], extra: Fixture = {}): Fixture {
    return {
        chaId, name, type: 'character', chatPage: 0, chats, triggerscript: triggers, modules: [], customscript: [], globalLore: [],
        lowLevelAccess: false, defaultVariables: '', ...extra,
    }
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

//#region the JSON schema and the extraction path

beforeEach(() => {
    h.chatOnly = false
})

/** The subject of a send that started in chat `chatIndex` of the character at `charIndex`, read back through the live database. */
function subjectAt(charIndex: number, chatIndex = 0): RunSubject {
    const owner = DBState.db.characters[charIndex] as unknown as { chaId: string, chats: Array<{ id: string }> }
    const target = owner.chats[chatIndex]
    return createSendSubject({ chaId: owner.chaId, chatId: target.id }, { owner: owner as never, chat: target as never })
}

const SCHEMA = 'interface R {\n  speaker: "{{char}}"\n  who: "{{user}}"\n}'

/** The `const` of one property of the JSON schema the last OpenAI-compatible request carried. */
const constOf = (key: string) => {
    const body = h.fetches.at(-1)!.body as { response_format?: { json_schema?: { schema?: { properties?: Record<string, { const?: string }> } } } }
    return body.response_format?.json_schema?.schema?.properties?.[key]?.const
}

const schemaDb = { jsonSchemaEnabled: true, jsonSchema: SCHEMA, strictJsonSchema: false }

describe('the CBS in the JSON schema and the extraction path reads the request\'s subject', () => {
    test('the schema of a request with a subject names the subject\'s character while the selection is on another character', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $v: 'A1' })], [])
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B], schemaDb); selectedCharID.set(1)

        await ask(subjectAt(0))

        expect(constOf('speaker')).toBe('AliceName')
    })

    test('the schema of a request with a subject is built while the selection is at Home', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $v: 'A1' })], [])
        installDb([A], schemaDb); selectedCharID.set(-1)

        const outcome = await ask(subjectAt(0)).then((r) => r.type, (e) => 'rejected: ' + String(e))

        expect(outcome).toBe('success')
        expect(constOf('speaker')).toBe('AliceName')
    })

    test('guard: the schema of a request with no subject names the selection\'s character', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $v: 'A1' })], [])
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B], schemaDb); selectedCharID.set(1)

        await ask(null)

        expect(constOf('speaker')).toBe('SentinelBob')
    })

    test('an extraction path with {{char}} extracts the field of the subject\'s character while the selection is on another character', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $v: 'A1' })], [])
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B], { ...schemaDb, extractJson: '{{char}}' }); selectedCharID.set(1)
        h.chatOnly = true
        h.reply = '{"AliceName":"from-alice","SentinelBob":"from-bob"}'

        const result = await ask(subjectAt(0))

        expect(result.result).toBe('from-alice')
    })
})

//#endregion

//#region Claude's extraction

describe('a Claude request with the JSON schema on returns the extracted field', () => {
    const CLAUDE_SCHEMA = 'interface R {\n  speaker: string\n}'
    const REPLY = '{"speaker":"hello"}'
    const claudeDb = { aiModel: 'claude-opus-5', claudeAPIKey: 'k', jsonSchemaEnabled: true, jsonSchema: CLAUDE_SCHEMA, thinkingType: 'off' }

    test('on the HTTP non-streaming branch', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], claudeDb); selectedCharID.set(0)
        h.reply = REPLY

        const result = await ask(null, { extractJson: 'speaker' })

        expect(h.fetches.filter((x) => x.url.includes('anthropic.com'))).toHaveLength(1)
        expect(result.result).toBe('hello')
    })

    test('on the Bedrock non-streaming branch', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { ...claudeDb, aiModel: 'anthropic.claude-opus-4-6-v1', claudeAPIKey: 'AKID:SECRET:us-east-1' }); selectedCharID.set(0)
        h.reply = REPLY

        const result = await ask(null, { extractJson: 'speaker' })

        expect(h.fetches.filter((x) => x.url.includes('amazonaws.com'))).toHaveLength(1)
        expect(result.result).toBe('hello')
    })

    test('guard: with no extraction path the raw reply is returned', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], claudeDb); selectedCharID.set(0)
        h.reply = REPLY

        const result = await ask(null, {})

        expect(result.result).toBe(REPLY)
    })
})

//#endregion

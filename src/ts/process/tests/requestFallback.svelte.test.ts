/**
 * The models of a request are the selected model first and then each entry of the fallback list, in
 * order. A failed attempt moves on to the next model, whatever the provider: a plugin provider that
 * failed through its retries, and a provider that skips its retries, move on like any other; only the
 * last model's failure ends the request. The returned `model` names the model that answered. A
 * NovelList prompt ends with the character's name label.
 *
 * Drives the real `requestChatData`, `modellist`, `stringlize`, `chatTemplate` and the real
 * OpenAI-compatible, Kobold and NovelList request paths. Only the network (`globalFetch`), the tool
 * path, the tokenizer and the platform/IO packages are mocked, so nothing here says anything about a
 * native backend.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be
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

//#region the fallback models

const modelsTried = () => h.fetches.map((x) => String(x.body.model))
const urlsTried = () => h.fetches.map((x) => x.url.replace(/^https?:\/\//, '').split('/')[0])

describe('the selected model is tried first, then the fallback list', () => {
    test('guard: with no fallback list the selected model is the only attempt', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackModels: {} }); selectedCharID.set(0)

        await ask(null)

        expect(modelsTried()).toEqual(['gpt-4o'])
    })

    test('a healthy selected model answers with one request although a fallback list is set', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)

        await ask(null)

        expect(modelsTried()).toEqual(['gpt-4o'])
    })

    test('a failing selected model is followed by the fallback list, and the list\'s answer is returned', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)
        h.failNext = 1

        const result = await ask(null)

        expect(modelsTried()).toEqual(['gpt-4o', 'gpt-4o-mini'])
        expect(result.type).toBe('success')
    })

    test('guard: a blank entry in the list is skipped', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackModels: { model: ['', 'gpt4om'] } }); selectedCharID.set(0)
        h.failNext = 1

        await ask(null)

        expect(modelsTried()).toEqual(['gpt-4o', 'gpt-4o-mini'])
    })

    test('a trailing blank entry in the list is never requested', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackModels: { model: ['gpt4om', ''] } }); selectedCharID.set(0)
        h.failNext = 2

        const result = await ask(null)

        expect(modelsTried()).toEqual(['gpt-4o', 'gpt-4o-mini'])
        expect(result.type).toBe('fail')
    })
})

describe('a provider that skips its retries moves on to the next model', () => {
    test('a Kobold selected model that fails once is followed by the list, and the list\'s answer is returned', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 2, aiModel: 'kobold', fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)
        h.failNext = 1

        const result = await ask(null)

        expect(urlsTried()).toEqual(['kobold.test', 'api.openai.com'])
        expect(result.type).toBe('success')
    })

    test('guard: a failing Kobold selected model with no list is attempted once and the request fails', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 2, aiModel: 'kobold', fallbackModels: {} }); selectedCharID.set(0)
        h.failNext = 3

        const result = await ask(null)

        expect(urlsTried()).toEqual(['kobold.test'])
        expect(result.type).toBe('fail')
    })

    test('a NovelList selected model that keeps failing is retried like any other provider and then followed by the list', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 2, aiModel: 'novellist', fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)
        h.failNext = 3

        const result = await ask(null)

        expect(urlsTried()).toEqual(['api.tringpt.com', 'api.tringpt.com', 'api.tringpt.com', 'api.openai.com'])
        expect(result.type).toBe('success')
    })

    test('guard: a failing NovelList selected model with no list is attempted once plus its retries', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 2, aiModel: 'novellist', fallbackModels: {} }); selectedCharID.set(0)
        h.failNext = 5

        const result = await ask(null)

        expect(urlsTried()).toHaveLength(3)
        expect(result.type).toBe('fail')
    })
})

describe('a blank reply advances to the next model only when that is switched on and a model remains', () => {
    test('a blank reply from the selected model advances to the list', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackWhenBlankResponse: true, fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)
        h.reply = ''
        h.afterFetch = () => { h.reply = 'second' }

        const result = await ask(null)

        expect(modelsTried()).toEqual(['gpt-4o', 'gpt-4o-mini'])
        expect(result.result).toBe('second')
    })

    test('a blank reply from the last model is accepted after the selected model was tried first', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackWhenBlankResponse: true, fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)
        h.reply = ''

        const result = await ask(null)

        expect(modelsTried()).toEqual(['gpt-4o', 'gpt-4o-mini'])
        expect(result.type).toBe('success')
        expect(result.result).toBe('')
    })

    test('guard: a blank reply from the last list entry is accepted', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackWhenBlankResponse: true, fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)
        h.reply = ''

        const result = await ask(null)

        expect(modelsTried().at(-1)).toBe('gpt-4o-mini')
        expect(result.type).toBe('success')
        expect(result.result).toBe('')
    })

    test('guard: a blank entry in the list is skipped when the reply is blank', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackWhenBlankResponse: true, fallbackModels: { model: ['', 'gpt4om'] } }); selectedCharID.set(0)
        h.reply = ''
        h.afterFetch = () => { h.reply = 'second' }

        const result = await ask(null)

        expect(modelsTried()).toEqual(['gpt-4o', 'gpt-4o-mini'])
        expect(result.result).toBe('second')
    })
})

describe('the returned model names the model that answered', () => {
    test('guard: with no list an OpenAI-compatible answer carries no model', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackModels: {} }); selectedCharID.set(0)

        const result = await ask(null)

        expect(result.model).toBeUndefined()
    })

    test('a selected model that answers returns the provider\'s own model field, as it does with no list', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)

        const result = await ask(null)

        expect(result.model).toBeUndefined()
    })

    test('a list entry that answers after the selected model failed names itself', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)
        h.failNext = 1

        const result = await ask(null)

        expect(result.type).toBe('success')
        expect(result.model).toBe('gpt4om')
    })

    test('guard: a plugin provider that answers returns the plugin\'s own model', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 0, aiModel: 'custom', currentPluginProvider: 'X', fallbackModels: {} }); selectedCharID.set(0)
        pluginV2.providers.set('X', (async () => ({ success: true, content: 'plugin-ok' })) as never)

        const result = await ask(null)

        expect(result.model).toBe('custom')
    })
})

describe('a plugin provider that failed through its retries moves on to the next model', () => {
    let calls = 0
    beforeEach(() => { calls = 0 })
    const failing = async () => { calls++; return { success: false, content: 'plugin-boom' } }

    test('a plugin selected model is followed by the list', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 2, aiModel: 'custom', currentPluginProvider: 'X', fallbackModels: { model: ['gpt4om'] } }); selectedCharID.set(0)
        pluginV2.providers.set('X', failing as never)

        const result = await ask(null)

        expect(calls).toBe(3)
        expect(modelsTried()).toEqual(['gpt-4o-mini'])
        expect(result.type).toBe('success')
    })

    test('a plugin selected model is followed by the list when the list starts with a blank entry', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 2, aiModel: 'custom', currentPluginProvider: 'X', fallbackModels: { model: ['', 'gpt4om'] } }); selectedCharID.set(0)
        pluginV2.providers.set('X', failing as never)

        const result = await ask(null)

        expect(calls).toBe(3)
        expect(modelsTried()).toEqual(['gpt-4o-mini'])
        expect(result.type).toBe('success')
    })

    test('a registered plugin model as the selected model is followed by the list', async () => {
        const v3 = await import('../../plugins/apiV3/v3.svelte')
        const modellist = await import('../../model/modellist')
        v3.customV3ProviderMetaStore.push({ id: 'pluginmodel:::X', name: 'X', provider: 'AsIs', format: modellist.LLMFormat.Plugin, flags: [], parameters: [], tokenizer: 0 } as never)
        try {
            const A = makeChar('a', 'AliceName', [chat('cA')], [])
            installDb([A], { requestRetrys: 2, aiModel: 'pluginmodel:::X', fallbackModels: { model: ['', 'gpt4om'] } }); selectedCharID.set(0)
            pluginV2.providers.set('X', failing as never)

            const result = await ask(null)

            expect(calls).toBe(3)
            expect(modelsTried()).toEqual(['gpt-4o-mini'])
            expect(result.type).toBe('success')
        } finally {
            v3.customV3ProviderMetaStore.length = 0
        }
    })

    test('a plugin entry of the list that fails is followed by the next entry', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 2, currentPluginProvider: 'X', fallbackModels: { model: ['custom', 'gpt4om'] } }); selectedCharID.set(0)
        pluginV2.providers.set('X', failing as never)
        h.failNext = 3

        const result = await ask(null)

        expect(result.type).toBe('success')
        expect(modelsTried()).toEqual(['gpt-4o', 'gpt-4o', 'gpt-4o', 'gpt-4o-mini'])
        expect(calls).toBe(3)
    })

    test('guard: a plugin selected model that recovers within its retries answers', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { requestRetrys: 2, aiModel: 'custom', currentPluginProvider: 'X', fallbackModels: {} }); selectedCharID.set(0)
        let attempts = 0
        pluginV2.providers.set('X', (async () => { calls++; attempts++; return attempts === 1 ? { success: false, content: 'boom' } : { success: true, content: 'plugin-ok' } }) as never)

        const result = await ask(null)

        expect(result.result).toBe('plugin-ok')
        expect(calls).toBe(2)
    })
})

//#endregion

//#region the NovelList prompt

describe('the NovelList prompt ends with the character\'s name label', () => {
    test('the prompt ends with the name label and an opening bracket', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $v: 'A1' })], [])
        installDb([A], { aiModel: 'novellist' }); selectedCharID.set(0)

        await ask(null, {}, prompt(), 'model')

        const text = String(h.fetches.at(-1)?.body.text)
        expect(text.endsWith('\n\nAliceName 「')).toBe(true)
        expect(text).not.toContain('NaN')
    })

    test('guard: a continued prompt ends with the opening bracket only', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $v: 'A1' })], [])
        installDb([A], { aiModel: 'novellist' }); selectedCharID.set(0)

        await ask(null, { continue: true }, prompt(), 'model')

        const text = String(h.fetches.at(-1)?.body.text)
        expect(text.endsWith(' 「')).toBe(true)
    })
})

//#endregion

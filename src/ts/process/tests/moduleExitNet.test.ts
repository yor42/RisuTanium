/**
 * The exit net of the main send: `requestChatData` called with `mainSend` refuses to send when a module the run
 * references is still an unloaded stub, and names every such module in one text. It reads the same deduplicated
 * list the producers read (`unloadedModulesOf`), so a resident first holder of an id hides a later stub of the same
 * id, and a namespace reference finds a stub by namespace. Any call without `mainSend` is untouched.
 *
 * Drives the real `requestChatData` and the real `modules.ts`; only the network, the tool path, the tokenizer and the
 * platform packages are mocked (the harness of `requestFallback.svelte.test.ts`).
 *
 * Labels: R = fails on the pre-change base at an assertion, G = guard (passes before and after).
 */
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import { MODULE_STUB_KEY } from '../../storage/moduleStub'
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    fetches: [] as Array<{ url: string }>,
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
    const state = { db: {} as unknown as Database }
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(async (url: string) => {
        h.fetches.push({ url })
        return { ok: true, data: { choices: [{ text: 'ok', message: { content: 'ok' } }] } }
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

vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn() }))

vi.mock('../transformers', () => ({
    runTransformers: vi.fn(async () => ({ generated_text: 'ok' })),
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

type Fixture = Record<string, unknown>
type Reply = { type: string, result: unknown }

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Reply>
let createRunSubject: typeof import('../chatOrigin').createRunSubject
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>

beforeAll(async () => {
    requestChatData = (await import('../request/request')).requestChatData as never
    createRunSubject = (await import('../chatOrigin')).createRunSubject
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
})

const PERSONAS = [{ id: 'p-S', name: 'SelectedPersona', personaPrompt: '', icon: '' }]

function stub(id: string, name: string, extra: Fixture = {}): Fixture {
    return { id, name, description: '', [MODULE_STUB_KEY]: 1, ...extra }
}

function resident(id: string, name: string, extra: Fixture = {}): Fixture {
    return { id, name, description: '', lorebook: [], ...extra }
}

function installDb(modules: Fixture[], enabled: string[], integration = ''): void {
    const character = {
        chaId: 'a', name: 'AliceName', type: 'character', chatPage: 0, modules: [], customscript: [], globalLore: [], triggerscript: [],
        lowLevelAccess: false, defaultVariables: '',
        chats: [{ id: 'cA', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
    }
    DBState.db = {
        characters: [character], enabledModules: enabled, modules, moduleIntergration: integration, templateDefaultVariables: '', fallbackModels: {},
        requestRetrys: 0, banCharacterset: [], aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000,
        username: 'GlobalUser', personas: PERSONAS, selectedPersona: 0, seperateModelsForAxModels: false, seperateModels: {},
        globalChatVariables: {}, customModels: [], additionalParams: [], cipherChat: false, newOAIHandle: false, useStreaming: false,
        openAIKey: 'k', useInstructPrompt: false, localStopStrings: [],
    } as unknown as Database
    selectedCharID.set(0)
}

async function ask(extra: Fixture = {}): Promise<Reply> {
    const subject = createRunSubject({ chaId: 'a', chatId: 'cA' })
    return requestChatData({
        formated: [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }],
        bias: {}, useStreaming: false, noMultiGen: true, subject, ...extra,
    }, 'model')
}

beforeEach(() => {
    h.fetches.length = 0
    selectedCharID.set(-1)
})

//#endregion

describe('the main send is stopped while a referenced module is a stub', () => {
    test('R exit-net-stops-main-send-with-stub-referenced', async () => {
        installDb([stub('m1', 'Alpha')], ['m1'])
        const reply = await ask({ mainSend: true })
        expect(reply.type).toBe('fail')
        expect(String(reply.result)).toContain('Alpha')
        expect(h.fetches).toHaveLength(0)
    })

    test('R exit-net-detects-namespace-stub', async () => {
        installDb([stub('m1', 'Alpha', { namespace: 'ns' })], [], 'ns')
        const reply = await ask({ mainSend: true })
        expect(reply.type).toBe('fail')
        expect(String(reply.result)).toContain('Alpha')
        expect(h.fetches).toHaveLength(0)
    })

    test('R exit-net-names-every-stub-in-one-text', async () => {
        installDb([stub('m1', 'Alpha'), stub('m2', 'Beta')], ['m1', 'm2'])
        const reply = await ask({ mainSend: true })
        expect(reply.type).toBe('fail')
        expect(String(reply.result)).toContain('Alpha')
        expect(String(reply.result)).toContain('Beta')
    })
})

describe('the net reads the run\'s own origin, not the selection', () => {
    test('R exit-net-stops-a-send-whose-origin-is-not-the-selected-chat', async () => {
        installDb([stub('m1', 'Alpha')], [])
        const characters = DBState.db.characters as unknown as Fixture[]
        characters[0].modules = ['m1']
        characters.push({
            chaId: 'b', name: 'BobName', type: 'character', chatPage: 0, modules: [], customscript: [], globalLore: [], triggerscript: [],
            lowLevelAccess: false, defaultVariables: '',
            chats: [{ id: 'cB', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
        })
        selectedCharID.set(1)
        const reply = await ask({ mainSend: true })
        expect(reply.type).toBe('fail')
        expect(String(reply.result)).toContain('Alpha')
        expect(h.fetches).toHaveLength(0)
    })

    test('G exit-net-ignores-a-stub-only-the-selection-references', async () => {
        installDb([stub('m1', 'Alpha')], [])
        const characters = DBState.db.characters as unknown as Fixture[]
        characters.push({
            chaId: 'b', name: 'BobName', type: 'character', chatPage: 0, modules: ['m1'], customscript: [], globalLore: [], triggerscript: [],
            lowLevelAccess: false, defaultVariables: '',
            chats: [{ id: 'cB', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
        })
        selectedCharID.set(1)
        const reply = await ask({ mainSend: true })
        expect(reply.type).not.toBe('fail')
        expect(h.fetches).toHaveLength(1)
    })
})

describe('the net stays out of every other path', () => {
    test('G exit-net-only-main-send', async () => {
        installDb([stub('m1', 'Alpha')], ['m1'])
        const reply = await ask()
        expect(reply.type).not.toBe('fail')
        expect(h.fetches).toHaveLength(1)
    })

    test('G exit-net-ignores-stub-behind-resident-first-holder', async () => {
        installDb([resident('m1', 'Alpha'), stub('m1', 'AlphaStub')], ['m1'])
        const reply = await ask({ mainSend: true })
        expect(reply.type).not.toBe('fail')
        expect(h.fetches).toHaveLength(1)
    })

    test('G exit-net-ignores-an-unreferenced-stub', async () => {
        installDb([stub('m1', 'Alpha'), resident('m2', 'Beta')], ['m2'])
        const reply = await ask({ mainSend: true })
        expect(reply.type).not.toBe('fail')
        expect(h.fetches).toHaveLength(1)
    })

    test('G exit-net-no-stub-sends-normally', async () => {
        installDb([resident('m1', 'Alpha')], ['m1'])
        const reply = await ask({ mainSend: true })
        expect(reply.type).not.toBe('fail')
        expect(h.fetches).toHaveLength(1)
    })
})

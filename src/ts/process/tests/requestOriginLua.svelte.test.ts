// @vitest-environment node
/**
 * A Lua run's model calls (`LLM`, `simpleLLM`, `axLLM`) go through the request layer as the chat the
 * run stands for: with an origin, the request's `request` trigger and names are that chat's; with no
 * origin they follow the selection.
 *
 * Drives the real `request.ts`, `triggers.ts`, `modules.ts`, `chatOrigin.ts`, `scriptings.ts` and the
 * real wasmoon Lua engine (node environment). The model list, the OpenAI-compatible provider, the tool
 * path and the network are mocked, so nothing here says anything about a native backend.
 *
 * Tests whose title starts with `guard:` pass with or without the binding.
 */
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { writable, get } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'

const h = vi.hoisted(() => ({
    seen: [] as Array<{ formated: Array<{ role: string, content: string }> }>,
    marks: [] as string[],
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook() {}, sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: (id: string) => { h.marks.push(id) } }))

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
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
    fetchNative: vi.fn(), globalFetch: vi.fn(), readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))
vi.mock('../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }))
vi.mock('../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../files/inlays', () => ({ getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'x') }))
vi.mock('../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../characterCards', () => ({ exportCharacterCard: vi.fn(), importCharacterProcess: vi.fn() }))
vi.mock('../../rpack/rpack_js', () => ({ decodeRPack: vi.fn(), encodeRPack: vi.fn() }))
vi.mock('../../interchangeability', () => ({ convertCharacterToModule: vi.fn(), convertModuleToCharacter: vi.fn() }))
vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: { editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(), replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map() },
    pluginProcess: vi.fn(),
}))
vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn() }))
vi.mock('../transformers', () => ({ runTransformers: vi.fn(), runImageEmbedding: vi.fn() }))
vi.mock('../../model/modellist', async () => {
    const types = await import('../../model/types')
    return {
        LLMFlags: types.LLMFlags, LLMFormat: types.LLMFormat, LLMProvider: types.LLMProvider,
        getModelInfo: (id: string) => ({ id, name: id, shortName: id, internalID: id, format: types.LLMFormat.OpenAICompatible, provider: types.LLMProvider.OpenAI, tokenizer: 0, flags: [types.LLMFlags.hasFullSystemPrompt], parameters: [] }),
    }
})
const providerStub = async (arg: { formated: Array<{ role: string, content: string }> }) => {
    h.seen.push({ formated: JSON.parse(JSON.stringify(arg.formated)) })
    return { type: 'success', result: 'ok' }
}
vi.mock('../request/anthropic', () => ({ requestClaude: providerStub }))
vi.mock('../request/google', () => ({ requestGoogleCloudVertex: providerStub }))
vi.mock('../request/openAI/requests', () => ({ requestOpenAI: providerStub, requestOpenAILegacyInstruct: providerStub, requestOpenAIResponseAPI: providerStub }))
vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    const getCurrentChat = () => { const c = getCurrentCharacter(); return c?.chats?.[c.chatPage] }
    return { appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(), getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(getCurrentCharacter), getCurrentChat: vi.fn(getCurrentChat) }
})

vi.mock('../memory/hypamemory', () => ({ HypaProcesser: class { async addText() {} async similaritySearch() { return [] } } }))
vi.mock('../stableDiff', () => ({ stableDiff: vi.fn(), generateAIImage: vi.fn(async () => null) }))

let runLuaEditTrigger: typeof import('../scriptings').runLuaEditTrigger
let runLuaButtonTrigger: typeof import('../scriptings').runLuaButtonTrigger
let createSendSubject: typeof import('../chatOrigin').createSendSubject
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>

beforeAll(async () => {
    const { readFile } = await import('node:fs/promises')
    const jsonLua = await readFile(fileURLToPath(new URL('../../../../public/lua/json.lua', import.meta.url)), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
    await import('../request/request')
    const s = await import('../scriptings')
    runLuaEditTrigger = s.runLuaEditTrigger; runLuaButtonTrigger = s.runLuaButtonTrigger
    createSendSubject = (await import('../chatOrigin')).createSendSubject
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
})

function chat(id: string, vars: Record<string, string> = {}) {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: vars, GLGlobalVariables: {}, modules: [] }
}
function reqTrigger(tag: string) {
    return { comment: 'r', type: 'request', conditions: [], lowLevelAccess: false,
        effect: [{ type: 'v2SetRequestState', index: '0', indexType: 'value', value: `${tag}:{{getvar::v}}`, valueType: 'value', indent: 0 }] }
}
function luaTrig(code: string) { return { comment: 'lua', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code }] } }
function makeChar(chaId: string, name: string, chats: unknown[], trig: unknown[] = [], extra: Record<string, unknown> = {}) {
    return { chaId, name, type: 'character', chatPage: 0, chats, triggerscript: trig, modules: [], customscript: [], globalLore: [], lowLevelAccess: true, defaultVariables: '', ...extra }
}
function installDb(characters: unknown[]) {
    DBState.db = { characters, enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 2, banCharacterset: [],
        aiModel: 'gpt-3.5-turbo', subModel: 'gpt-3.5-turbo', maxResponse: 100, temperature: 80, username: 'U', personas: [], selectedPersona: 0, seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {} } as unknown as Database
}
beforeEach(() => { h.seen.length = 0; h.marks.length = 0 })
const prompt = () => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]


const liveChar = (index: number) => DBState.db.characters[index] as unknown as { chats: unknown[] }
const sentContents = () => h.seen.map((call) => call.formated.map((m) => m.content).join('|'))

const LUA_CALLS = {
    LLM: 'LLM(id, {{role="user", content="hello"}})',
    simpleLLM: 'simpleLLM(id, "hello")',
    axLLM: 'axLLM(id, {{role="user", content="hello"}})',
} as const

describe('a Lua run\'s model call follows the run\'s own chat', () => {
    for (const [name, call] of Object.entries(LUA_CALLS)) {
        test(`${name} in a trigger run on chat A runs A's request trigger when the selection is on another character`, async () => {
            const runtime = await import('../triggers')
            const code = `function onStart(id) ${call} end`
            const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [luaTrig(code), reqTrigger('TA')])
            const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
            installDb([A, B]); selectedCharID.set(1)

            await runtime.runTrigger(liveChar(0) as never, 'start', { chat: liveChar(0).chats[0] as never, origin: { chaId: 'a', chatId: 'c1' } })

            expect(h.seen.length, 'the model was called once').toBe(1)
            expect(sentContents()[0]).toContain('TA:A1')
        })
    }

    test('LLM from a button trigger with an origin runs A\'s request trigger when the selection is on another character', async () => {
        const code = `function onButtonClick(id, data) ${LUA_CALLS.LLM} end`
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [luaTrig(code), reqTrigger('TA')])
        const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
        installDb([A, B]); selectedCharID.set(1)

        await runLuaButtonTrigger(liveChar(0) as never, 'btn', { chaId: 'a', chatId: 'c1' })

        expect(h.seen.length, 'the model was called once').toBe(1)
        expect(sentContents()[0]).toContain('TA:A1')
    })

    test('LLM from a button trigger in a chat whose id has two holders skips the request trigger of the selected holder', async () => {
        const code = `function onButtonClick(id, data) ${LUA_CALLS.LLM} end`
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'X' }), chat('c1', { $v: 'Y' })], [luaTrig(code), reqTrigger('TA')])
        installDb([A]); selectedCharID.set(0)

        await runLuaButtonTrigger(liveChar(0) as never, 'btn', { chaId: 'a', chatId: 'c1' })

        expect(h.seen.length, 'the model was called once').toBe(1)
        expect(sentContents()[0]).toContain('hello')
        expect(sentContents()[0]).not.toContain('TA:')
    })

    test('guard: LLM from a button trigger with no origin follows the selection', async () => {
        const code = `function onButtonClick(id, data) ${LUA_CALLS.LLM} end`
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'A1' })], [luaTrig(code), reqTrigger('TA')])
        const B = makeChar('b', 'Bob', [chat('c2', { $v: 'B1' })], [reqTrigger('TB')])
        installDb([A, B]); selectedCharID.set(1)

        await runLuaButtonTrigger(liveChar(0) as never, 'btn')

        expect(h.seen.length, 'the model was called once').toBe(1)
        expect(sentContents()[0]).toContain('TB:B1')
    })

    test('guard: LLM from an editRequest trigger never reaches the provider, so an edit trigger makes no model call', async () => {
        const code = 'listenEdit("editRequest", function(id, data) local r = LLM(id, {{role="user", content="hello"}}) return data end)'
        const A = makeChar('a', 'Alice', [chat('c1', { $v: 'X' })], [luaTrig(code), reqTrigger('TA')])
        installDb([A]); selectedCharID.set(0)
        const subject = createSendSubject({ chaId: 'a', chatId: 'c1' }, { owner: liveChar(0) as never, chat: liveChar(0).chats[0] as never })

        await runLuaEditTrigger(liveChar(0) as never, 'editRequest', prompt() as never, undefined, undefined, subject)

        expect(h.seen.length).toBe(0)
    })
})

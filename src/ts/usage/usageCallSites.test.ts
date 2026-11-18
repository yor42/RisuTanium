// @vitest-environment node

/**
 * The argument each real call site hands to the request layer carries the usage statistics fields: the Utility send
 * labels its request `utility`, the V3 `runLLMModel` labels it `plugin`, and the main chat send passes the input
 * token count it already computed as `usageInputEstimate`. Compatibility guards: they pass on the current code and
 * fail when the field is dropped from the call site.
 *
 * Each section loads the REAL call-site module over its own mock set (`vi.doMock` plus `vi.resetModules`), because
 * the three sites need incompatible stand-ins for the same modules. The request layer, the database, the stores and
 * the platform packages are mocked, so nothing here says anything about a real provider request or a native backend.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writable } from 'svelte/store'

type MockSet = Record<string, () => unknown>

let mocked: string[] = []

/** Loads a fresh module graph in which exactly `mocks` are replaced. */
async function withMocks<T>(mocks: MockSet, load: () => Promise<T>): Promise<T> {
    vi.resetModules()
    for (const path of mocked) {
        vi.doUnmock(path)
    }
    mocked = Object.keys(mocks)
    for (const [path, factory] of Object.entries(mocks)) {
        vi.doMock(path, factory as () => unknown)
    }
    return load()
}

afterEach(() => {
    for (const path of mocked) {
        vi.doUnmock(path)
    }
    mocked = []
})

const COLD = 120000

// ---- Utility send ----

describe('Utility send', () => {
    test('the request argument is labelled utility', async () => {
        const request = vi.fn(async () => ({ type: 'success', result: 'fixed' }))
        const utility = await withMocks({
            '../process/request/request': () => ({ requestChatDataMain: request }),
            '../storage/tauriByteTransport': () => ({ isDesktopTransport: () => true }),
            '../stores.svelte': () => ({ DBState: { db: {} } }),
            '../model/modellist': async () => {
                const types = await import('../model/types')
                return { LLMFormat: types.LLMFormat, getModelInfo: (id: string) => ({ id, format: types.LLMFormat.OpenAICompatible }) }
            },
        }, () => import('../process/utility/utilityConversation.svelte'))
        const { DBState } = await import('../stores.svelte')
        const { setPageStorageMode } = await import('../storage/pageStorageMode')
        const { LLMFormat } = await import('../model/types')
        DBState.db = { taskPresets: [{ id: 'p1', name: 'Fixer', instructions: 'Fix it.', model: 'gpt4o' }], customAPIFormat: LLMFormat.OpenAICompatible, useInstructPrompt: false } as never
        setPageStorageMode({ kind: 'store2' })

        await utility.sendUtility('p1', 'broken')

        expect(request).toHaveBeenCalledTimes(1)
        const calls = request.mock.calls as unknown as Array<[Record<string, unknown>, string]>
        expect(calls[0][0].usagePurpose).toBe('utility')
    }, COLD)
})

// ---- V3 runLLMModel ----

describe('V3 runLLMModel', () => {
    test('the request argument is labelled plugin', async () => {
        const request = vi.fn(async () => ({ type: 'success', result: 'ok' }))
        const mocks: MockSet = {
            'localforage': () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }),
            '@tauri-apps/plugin-fs': () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }),
            'dompurify': () => ({ default: { sanitize: (v: string) => v } }),
            '../plugins/apiV3/factory': () => ({ SandboxHost: class {} }),
            '../storage/database.svelte': () => ({
                getCurrentCharacter: vi.fn(),
                getDatabase: vi.fn(() => ({})),
                setDatabase: vi.fn(),
                setDatabaseLite: vi.fn(),
                presetTemplate: { name: 'test-preset' },
            }),
            '../plugins/pluginSafeClass': () => ({
                SafeDocument: class {}, SafeIdbFactory: class {},
                SafeLocalStorage: class { getItem = vi.fn(); setItem = vi.fn(); removeItem = vi.fn(); clear = vi.fn(); key = vi.fn(); keys = vi.fn() },
                SafeLocalPluginStorage: class {}, tagWhitelist: [],
            }),
            '../plugins/apiV3/transpiler': () => ({ pluginCodeTranspiler: vi.fn((code: string) => code) }),
            '../stores.svelte': () => ({
                DBState: { db: { plugins: [], pluginCustomStorage: {}, characters: [], characterOrder: [], modules: [], loadouts: [], botPresets: [] } },
                selectedCharID: writable(-1), hotReloading: writable(false),
                additionalChatMenu: [], additionalFloatingActionButtons: [], additionalHamburgerMenu: [], additionalSettingsMenu: [],
                bodyIntercepterStore: [], chatPanelStore: [],
            }),
            '../util': () => ({ sleep: vi.fn(async () => {}), selectSingleFile: vi.fn() }),
            '../alert': () => ({ alertConfirm: vi.fn(async () => true), alertError: vi.fn(), alertNormal: vi.fn(), alertPluginConfirm: vi.fn(async () => true) }),
            '../globalApi.svelte': () => ({
                checkCharOrder: vi.fn(),
                forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
                getFetchLogs: vi.fn(), fetchNative: vi.fn(), globalFetch: vi.fn(), readImage: vi.fn(), saveAsset: vi.fn(),
                toGetter: vi.fn((obj: unknown) => obj),
            }),
            '../gui/colorscheme': () => ({ changeColorScheme: vi.fn(), updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }),
            '../platform': () => ({ isNodeServer: false, isTauri: false }),
            '../process/mcp/pluginmcp': () => ({ registerMCPModule: vi.fn(), unregisterMCPModule: vi.fn() }),
            '../process/coldstorage.svelte': () => ({ setColdStorageItem: vi.fn(), readColdStorageItem: vi.fn() }),
            '../process/files/inlays': () => ({ getInlayAsset: vi.fn() }),
            '../translator/translator': () => ({ getLLMCache: vi.fn(), searchLLMCache: vi.fn() }),
            '../parser/parser.svelte': () => ({ hasher: vi.fn(async () => 'hash'), risuChatParser: vi.fn() }),
            '../model/types': () => ({ LLMFlags: {}, LLMFormat: {}, LLMProvider: {}, LLMTokenizer: {} }),
            '../process/index.svelte': () => ({ sendChat: vi.fn(async () => {}), doingChat: writable(false) }),
            '../process/scripts': () => ({ processScriptFull: vi.fn() }),
            '../model/modellist': () => ({ getModelInfo: vi.fn(() => ({ id: 'test-model' })) }),
            '../process/request/request': () => ({ requestChatDataMain: request }),
            '../process/modules': () => ({ getModuleLorebooks: vi.fn() }),
            '../process/ttsHooks': () => ({
                registerTTSPreprocessor: vi.fn(), unregisterTTSPreprocessor: vi.fn(),
                registerTTSPostprocessor: vi.fn(), unregisterTTSPostprocessor: vi.fn(),
            }),
        }
        const v3 = await withMocks(mocks, () => import('../plugins/apiV3/v3.svelte'))
        const api = v3.makeRisuaiAPIV3({} as HTMLIFrameElement, { name: 'A', script: '' } as never)

        await api.runLLMModel({ mode: 'model', messages: [{ role: 'user', content: 'hi' }] })

        expect(request).toHaveBeenCalledTimes(1)
        const calls = request.mock.calls as unknown as Array<[Record<string, unknown>, string]>
        expect(calls[0][0].usagePurpose).toBe('plugin')
    }, COLD)
})

// ---- Main chat send ----

describe('main chat send', () => {
    test('the request argument carries the input token count the send computed', async () => {
        const request = vi.fn(async () => ({ type: 'success', result: 'reply' }))
        const PER_CHAT = 7
        const mocks: MockSet = {
            'localforage': () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }),
            '@tauri-apps/plugin-fs': () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }),
            '@tauri-apps/plugin-dialog': () => ({ open: vi.fn(async () => null) }),
            '@tauri-apps/api/path': () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }),
            '@tauri-apps/api/webviewWindow': () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }),
            'src/lib/UI/PopupList.svelte': () => ({ default: class {} }),
            'dompurify': () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }),
            '../storage/tauriByteTransport': async () => ({ ...(await vi.importActual<object>('../storage/tauriByteTransport')), isAndroidTransport: () => false }),
            '../platform': () => ({ isTauri: false, isNodeServer: false }),
            '../stores.svelte': () => ({
                DBState: { db: {} },
                CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
                CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
                HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
            }),
            '../alert': () => ({
                alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(),
                alertSelect: vi.fn(async () => ''), alertConfirm: vi.fn(async () => true), alertClear: vi.fn(),
                alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
            }),
            '../globalApi.svelte': () => ({
                fetchNative: vi.fn(), readImage: vi.fn(async () => undefined), aiWatermarkingLawApplies: vi.fn(() => false),
                getFileSrc: vi.fn(async () => ''),
                forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
                AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
            }),
            '../tokenizer': () => ({
                ChatTokenizer: class { constructor(_extra: number, _mode: string) {} async tokenizeChat() { return PER_CHAT } },
                tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
            }),
            '../characters': () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }),
            '../process/command': () => ({ processMultiCommand: vi.fn(async () => {}) }),
            '../process/files/inlays': () => ({ getInlayAsset: vi.fn(), getInlaySummary: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'inlay-id') }),
            '../process/memory/hypamemory': () => ({ HypaProcesser: class { async addText() {} async similaritySearch() { return [] } } }),
            '../process/request/request': () => ({ requestChatData: request }),
            '../process/stableDiff': () => ({ stableDiff: vi.fn(), generateAIImage: vi.fn(async () => null) }),
            '../model/modellist': () => ({
                getModelInfo: vi.fn(() => ({ id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder', internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0, flags: [] })),
                LLMFlags: { hasImageInput: 0 },
            }),
            '../plugins/plugins.svelte': () => ({
                pluginV2: { editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(), providerOptions: new Map() },
            }),
            '../media': () => ({ compressImage: vi.fn(async (v: unknown) => v) }),
            '../rpack/rpack_js': () => ({ decodeRPack: vi.fn(async () => new Uint8Array()), encodeRPack: vi.fn(async () => new Uint8Array()) }),
            '../interchangeability': () => ({ convertCharacterToModule: vi.fn(), convertModuleToCharacter: vi.fn() }),
            '../characterCards': () => ({ exportCharacterCard: vi.fn(), importCharacterProcess: vi.fn() }),
            '../storage/database.svelte': async () => {
                const stores = await import('../stores.svelte')
                const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
                const getCurrentCharacter = () => state.db.characters?.[0]
                const getCurrentChat = () => {
                    const current = getCurrentCharacter()
                    return current?.chats?.[current.chatPage]
                }
                return {
                    appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
                    getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(getCurrentCharacter), getCurrentChat: vi.fn(getCurrentChat),
                }
            },
            '../parser/chatML': () => ({ parseChatML: vi.fn(() => []) }),
            '../process/exampleMessages': () => ({ exampleMessage: vi.fn(() => []) }),
            '../process/tts': () => ({ sayTTS: vi.fn() }),
            '../process/memory/supaMemory': () => ({ supaMemory: vi.fn() }),
            '../process/memory/hanuraiMemory': () => ({ hanuraiMemory: vi.fn() }),
            '../process/memory/hypav2': () => ({ hypaMemoryV2: vi.fn() }),
            '../process/memory/hypav3': () => ({ hypaMemoryV3: vi.fn() }),
            '../process/group': () => ({ groupOrder: vi.fn((order: unknown) => order) }),
            '../process/triggers': () => ({ runTrigger: vi.fn(async () => undefined) }),
            '../process/embedding/addinfo': () => ({ additionalInformations: vi.fn(async () => '') }),
            '../process/models/modelString': () => ({ getGenerationModelString: vi.fn(() => undefined) }),
            '../process/inlayScreen': () => ({ runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })) }),
            '../process/prereroll': async () => ({ renameContinuedMessage: (await vi.importActual<typeof import('../process/prereroll')>('../process/prereroll')).renameContinuedMessage, addRerolls: vi.fn() }),
            '../process/transformers': () => ({ runImageEmbedding: vi.fn() }),
        }
        const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
        vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
        try {
            await withMocks(mocks, () => import('../polyfill'))
            const index = await import('../process/index.svelte')
            const { beginWork } = await import('../process/chatOrigin')
            const stores = await import('../stores.svelte')
            const owner = {
                chaId: 'char-A', name: 'Alice', type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
                desc: 'Alice desc', personality: '', scenario: '', bias: [], utilityBot: false, inlayViewScreen: false, reloadKeys: 0,
                supaMemory: false, customscript: [], triggerscript: [], globalLore: [], emotionImages: [], additionalAssets: [], modules: [],
                chats: [{
                    id: 'chat-A', note: '', name: '', localLore: [], fmIndex: -1, scriptstate: {}, GLGlobalVariables: {}, modules: [],
                    message: [{ role: 'user', data: 'hello there', time: 1 }],
                }],
            }
            stores.DBState.db = {
                formatversion: 5, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
                personas: [], selectedPersona: 0, characterOrder: ['char-A'], characters: [owner],
                statics: { messages: 0 }, aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500,
                bias: [], mainPrompt: '', globalNote: '', jailbreakToggle: false, chainOfThought: false,
                personaPrompt: false, promptPreprocess: false, additionalPrompt: '', descriptionPrefix: '',
                promptTemplate: undefined, promptInfoInsideChat: false,
                formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
                autoContinueMinTokens: 0, autoContinueChat: false, igpPrompt: '', notification: false,
                removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off', ttsAutoSpeech: false,
                presetChain: '', outputImageModal: false, rememberToolUsage: false, supaModelType: 'none',
                hypav2: false, hypaV3: false, hanuraiEnable: false, inlayErrorResponse: false,
                loreBookDepth: 20, loreBookToken: 999999, templateDefaultVariables: '', globalChatVariables: {},
                enabledModules: [],
            } as never
            ;(globalThis as unknown as { __risuTestDb: unknown }).__risuTestDb = stores.DBState.db
            stores.selectedCharID.set(0)
            const handle = beginWork(owner as never, owner.chats[0] as never)!
            try {
                await index.sendChat(-1, { origin: handle.origin, originHint: { owner: owner as never, chat: owner.chats[0] as never } })
            } finally {
                handle.end()
            }

            expect(request).toHaveBeenCalledTimes(1)
            const calls = request.mock.calls as unknown as Array<[{ formated: unknown[], usageInputEstimate?: number }]>
            const body = calls[0][0]
            expect(body.formated.length).toBeGreaterThan(0)
            expect(body.usageInputEstimate).toBe(PER_CHAT * body.formated.length)
        } finally {
            vi.unstubAllGlobals()
        }
    }, COLD)
})

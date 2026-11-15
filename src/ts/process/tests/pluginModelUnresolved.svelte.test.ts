// @vitest-environment jsdom

/**
 * A plugin model id (`pluginmodel:::X`) whose plugin is not registered resolves to a Plugin-format
 * placeholder, so a send fails locally with `language.pluginProviderNotFound` and nothing is requested
 * from any network. The saved model selection is never rewritten.
 *
 * The no-request claim holds for the unresolved model itself: a configured `fallbackModels` entry
 * legitimately sends to its own provider, and retries stay local. Every send below therefore runs with
 * `requestRetrys: 0` and an empty fallback list.
 *
 * Drives the real `requestChatData`, `modellist` and `v3.svelte` (real `addProvider` and unload
 * cleanup); the sandbox host, the network and the platform/IO packages are mocked, so nothing here says
 * anything about a native backend. `pluginProcess` answers like the real producer: a failure carrying
 * `language.pluginProviderNotFound`.
 *
 * Labels: R = regression reproducer (fails on the pre-fix code), G = compatibility guard (passes before
 * and after). The module-mock set comes from `requestFallback.svelte.test.ts` and
 * `v3.lifecycle.svelte.test.ts`.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { LLMModel } from '../../model/types'
import { language } from '../../../lang'
import '../../polyfill'

//#region module mocks

const spies = vi.hoisted(() => ({
    /** Every `globalFetch` call. */
    globalFetch: vi.fn(async (_url: string, _opts?: unknown) => ({ ok: true, data: { choices: [{ message: { content: 'net' } }] } })),
    /** Every `fetchNative` call; a 500 answer keeps a pre-fix streaming run from throwing. */
    fetchNative: vi.fn(async (_url: string, _opts?: unknown) => new Response('', { status: 500 })),
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
        additionalChatMenu: [], additionalFloatingActionButtons: [], additionalHamburgerMenu: [], additionalSettingsMenu: [],
        bodyIntercepterStore: [], chatPanelStore: [],
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: spies.fetchNative,
    globalFetch: spies.globalFetch,
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(), checkCharOrder: vi.fn(), getFetchLogs: vi.fn(() => []),
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

vi.mock('../../plugins/plugins.svelte', async () => {
    const { language: lang } = await import('../../../lang')
    return {
        allowedDbKeys: [],
        customProviderStore: writable([] as string[]),
        handlePluginInstallViaPlugin: vi.fn(),
        getV2PluginAPIs: () => ({
            safeLocalStorage: {
                getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), keys: vi.fn(),
            },
            addRisuReplacer: vi.fn(), removeRisuReplacer: vi.fn(),
            addRisuChatListener: vi.fn(), removeRisuChatListener: vi.fn(),
            addRisuScriptHandler: vi.fn(), removeRisuScriptHandler: vi.fn(),
        }),
        pluginV2: {
            editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
            replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map(), providerOptions: new Map(),
        },
        // Same body as the real producer's "no provider" answer.
        pluginProcess: vi.fn(async () => ({ success: false, content: lang.pluginProviderNotFound })),
    }
})

vi.mock('../../plugins/apiV3/factory', () => ({ SandboxHost: class { constructor(_api: unknown) {} run() {} terminate() {} } }))

vi.mock('../../plugins/pluginSafeClass', () => ({ SafeLocalPluginStorage: class {}, tagWhitelist: [] }))
vi.mock('../../gui/colorscheme', () => ({ changeColorScheme: vi.fn(), updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }))
vi.mock('../mcp/pluginmcp', () => ({ registeredCustomPluginMCPs: new Map(), registerMCPModule: vi.fn(), unregisterMCPModule: vi.fn() }))
vi.mock('../coldstorage.svelte', () => ({ setColdStorageItem: vi.fn(), readColdStorageItem: vi.fn() }))
vi.mock('../ttsHooks', () => ({
    registerTTSPreprocessor: vi.fn(), unregisterTTSPreprocessor: vi.fn(), registerTTSPostprocessor: vi.fn(), unregisterTTSPostprocessor: vi.fn(),
}))

vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn() }))
vi.mock('../transformers', () => ({ runTransformers: vi.fn(), runImageEmbedding: vi.fn() }))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../request/anthropic', () => ({ requestClaude: vi.fn() }))
vi.mock('../request/google', () => ({ requestGoogleCloudVertex: vi.fn() }))

vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: Record<string, unknown> }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

//#endregion

//#region fixtures

type Result = { type: string, result: unknown, model?: string }

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }
let getModelInfo: typeof import('../../model/modellist').getModelInfo
let LLMFormat: typeof import('../../model/types').LLMFormat
let LLMProvider: typeof import('../../model/types').LLMProvider
let LLMTokenizer: typeof import('../../model/types').LLMTokenizer
let OpenAIParameters: LLMModel['parameters']
let v3: typeof import('../../plugins/apiV3/v3.svelte')
let pluginV2: { providers: Map<string, unknown>, providerOptions: Map<string, unknown> }
let customProviderStore: ReturnType<typeof writable<string[]>>
const fetchSpy = vi.fn(async () => new Response('', { status: 500 }))

// jsdom has no iframe `sandbox` token list; only the real `SandboxHost.run` would use it.
if (!('sandbox' in HTMLIFrameElement.prototype)) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', {
        configurable: true,
        get() { return { add() {} } },
    })
}

beforeAll(async () => {
    requestChatData = (await import('../request/request')).requestChatData as never
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }
    getModelInfo = (await import('../../model/modellist')).getModelInfo
    const types = await import('../../model/types')
    LLMFormat = types.LLMFormat
    LLMProvider = types.LLMProvider
    LLMTokenizer = types.LLMTokenizer
    OpenAIParameters = getModelInfo('some-unknown-model').parameters
    v3 = await import('../../plugins/apiV3/v3.svelte')
    const plugins = await import('../../plugins/plugins.svelte')
    pluginV2 = plugins.pluginV2 as never
    customProviderStore = plugins.customProviderStore as never
}, 60000)

let scenario = 0
function makePlugin() {
    scenario += 1
    return {
        name: `unresolved-plugin-${scenario}`,
        script: `script-unresolved-${scenario}`,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    } as unknown as Parameters<typeof v3.executePluginV3>[0]
}

function installDb(extra: Record<string, unknown> = {}): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: 'k',
        useInstructPrompt: false, localStopStrings: [], PresensePenalty: 0, frequencyPenalty: 0,
        ...extra,
    } as unknown as Database
}

async function send(): Promise<Result> {
    return requestChatData({
        formated: [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }],
        bias: {}, useStreaming: DBState.db.useStreaming, noMultiGen: true, tools: [],
    }, 'model')
}

const noNetwork = () => {
    expect(spies.globalFetch).not.toHaveBeenCalled()
    expect(spies.fetchNative).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
}

beforeEach(() => {
    spies.globalFetch.mockClear()
    spies.fetchNative.mockClear()
    fetchSpy.mockClear()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    pluginV2.providers.clear()
    pluginV2.providerOptions.clear()
    customProviderStore.set([])
    v3.customV3ProviderMetaStore.length = 0
    installDb()
})

afterEach(async () => {
    await v3.loadV3Plugins([])
    v3.customV3ProviderMetaStore.length = 0
    pluginV2.providers.clear()
    pluginV2.providerOptions.clear()
})

//#endregion

describe('getModelInfo for a plugin model id', () => {
    test('R-M1: an unregistered plugin id resolves to a Plugin-format placeholder, otherwise like the generic fallback', () => {
        DBState.db.enableCustomFlags = true
        DBState.db.customFlags = [999 as never]

        expect(getModelInfo('pluginmodel:::missing')).toEqual({
            id: 'pluginmodel:::missing',
            name: 'pluginmodel:::missing',
            shortName: 'pluginmodel:::missing',
            fullName: 'pluginmodel:::missing',
            internalID: 'pluginmodel:::missing',
            provider: LLMProvider.AsIs,
            format: LLMFormat.Plugin,
            flags: [],
            parameters: OpenAIParameters,
            tokenizer: LLMTokenizer.Unknown,
        })
    })

    test('guard: other unknown ids stay OpenAI-compatible and a registered plugin meta is returned by identity', () => {
        expect(getModelInfo('my-proxy-model').format).toBe(LLMFormat.OpenAICompatible)
        const meta = { id: 'pluginmodel:::p1', name: 'p1', shortName: 'p1', fullName: 'p1', internalID: 'pluginmodel:::p1', provider: LLMProvider.AsIs, format: LLMFormat.Plugin, flags: [], parameters: OpenAIParameters, tokenizer: LLMTokenizer.Unknown } as LLMModel
        v3.customV3ProviderMetaStore.push(meta)

        expect(getModelInfo('pluginmodel:::p1')).toBe(meta)
    })
})

describe('sending with an unresolved plugin model', () => {
    test('R-B1: a plugin that never registered fails locally, with no request, and the selection is kept', async () => {
        installDb({ aiModel: 'pluginmodel:::X', useStreaming: false })

        const result = await send()

        noNetwork()
        expect(result).toMatchObject({ type: 'fail', result: language.pluginProviderNotFound })
        expect(DBState.db.aiModel).toBe('pluginmodel:::X')
    })

    test('R-B2: the streaming path fails locally as well', async () => {
        installDb({ aiModel: 'pluginmodel:::X', useStreaming: true })

        const result = await send().catch(() => null)

        noNetwork()
        expect(result).toMatchObject({ type: 'fail', result: language.pluginProviderNotFound })
    })

    test('R-B3: a plugin that answered and then unloaded fails locally on the next send', async () => {
        const plugin = makePlugin()
        await v3.executePluginV3(plugin)
        const fn = vi.fn(async () => ({ success: true, content: 'ok' }))
        v3.makeRisuaiAPIV3({} as HTMLIFrameElement, plugin).addProvider('X', fn)
        installDb({ aiModel: 'pluginmodel:::X' })

        const first = await send()
        expect(first).toMatchObject({ type: 'success', result: 'ok' })
        noNetwork()

        await v3.loadV3Plugins([])
        expect(v3.customV3ProviderMetaStore).toHaveLength(0)
        const second = await send()

        noNetwork()
        expect(second).toMatchObject({ type: 'fail', result: language.pluginProviderNotFound })
        expect(fn).toHaveBeenCalledTimes(1)
        expect(DBState.db.aiModel).toBe('pluginmodel:::X')
    })

    test('guard: a registered plugin model is called in v3 mode and answers without a request', async () => {
        const plugin = makePlugin()
        await v3.executePluginV3(plugin)
        const fn = vi.fn(async (_arg: { mode?: string }) => ({ success: true, content: 'ok' }))
        v3.makeRisuaiAPIV3({} as HTMLIFrameElement, plugin).addProvider('X', fn)
        installDb({ aiModel: 'pluginmodel:::X' })

        const result = await send()

        expect(result).toMatchObject({ type: 'success', result: 'ok' })
        expect(fn.mock.calls[0][0].mode).toBe('v3')
        noNetwork()
    })

    test('guard: catalog and unknown non-plugin ids still go to the OpenAI-compatible endpoint', async () => {
        installDb({ aiModel: 'gpt4o' })
        await send()
        installDb({ aiModel: 'my-proxy-model' })
        await send()

        const urls = spies.globalFetch.mock.calls.map((call) => call[0])
        expect(urls).toHaveLength(2)
        for (const url of urls) {
            expect(url).toContain('api.openai.com')
        }
    })
})

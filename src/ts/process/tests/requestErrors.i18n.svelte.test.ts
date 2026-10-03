/**
 * Request-failure texts that `requestChatDataMain` returns are read from the active UI language at
 * the time of the failure, and raw upstream values (a Horde message, a plugin error dump, a socket
 * URL) are inserted into them verbatim. The language module is switched per test and restored to
 * English afterwards.
 *
 * Drives the real `requestChatDataMain` and its Horde, plugin, Ooba and OpenAI-compatible paths.
 * The network (`fetch`, `globalFetch`, `WebSocket`), the plugin provider and the platform/IO
 * packages are mocked, so nothing here says anything about a native backend.
 *
 * Tests titled "compatibility guard" pin the exact English text; tests titled "regression
 * reproducer" pin the localized or corrected output.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'

//#region module mocks

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
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(async () => ({ ok: false, data: {} })),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(),
    readImage: vi.fn(), isPlainHttpFileSrc: vi.fn(() => false), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
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

const h = vi.hoisted(() => ({
    pluginProcess: vi.fn(),
}))

vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
        replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: h.pluginProcess,
}))

vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn() }))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../request/anthropic', () => ({ requestClaude: vi.fn() }))
vi.mock('../request/google', () => ({ requestGoogleCloudVertex: vi.fn() }))

vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: object }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

//#endregion

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'

const realFetch = globalThis.fetch
const realWebSocket = globalThis.WebSocket

type Result = { type: string, result: unknown }
let requestChatDataMain: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }

beforeAll(async () => {
    requestChatDataMain = (await import('../request/request')).requestChatDataMain as never
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }
})

function installDb(extra: Record<string, unknown>): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: 'k',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        ooba: { formating: { userPrefix: 'U:', seperator: '\n' }, top_k: 1, top_p: 1, repetition_penalty: 1, typical_p: 1 },
        textgenWebUIStreamURL: 'ws://ooba.test/api/v1/stream', textgenWebUIBlockingURL: 'http://ooba.test/api/v1/generate', reverseProxyOobaArgs: {}, mancerHeader: 'k',
        hordeConfig: { apiKey: '' }, top_k: 1, top_p: 1,
        ...extra,
    } as unknown as Database
}

const messages = () => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

function ask(extra: Record<string, unknown> = {}, signal: AbortSignal | null = null) {
    return requestChatDataMain({ formated: messages(), bias: {}, useStreaming: false, noMultiGen: true, ...extra }, 'model', signal)
}

afterEach(() => {
    changeLanguage('en')
    // Only the stubs made here are undone; the setup file's global helpers stay.
    globalThis.fetch = realFetch
    globalThis.WebSocket = realWebSocket
    h.pluginProcess.mockReset()
})

//#region Horde

/** A Horde server that accepts the job and then reports it as impossible, with `message` when given. */
function stubHorde(message?: string) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.endsWith('/generate/text/async')) {
            return { status: 202, json: async () => ({ id: 'job', kudos: 0, ...(message === undefined ? {} : { message }) }), text: async () => '' }
        }
        return { json: async () => ({ is_possible: false }), status: 200 }
    }))
}

describe('Horde: job that is not possible', () => {
    beforeEach(() => installDb({ aiModel: 'horde:::auto' }))

    test('regression reproducer: the server message follows a colon and a space', async () => {
        stubHorde('Out of workers')
        const out = await ask()
        expect(out).toMatchObject({ type: 'fail', result: 'Response not possible: Out of workers', noRetry: true })
    })

    test('regression reproducer: without a server message the text is the bare sentence with its full stop', async () => {
        stubHorde()
        const out = await ask()
        expect(out).toMatchObject({ type: 'fail', result: 'Response not possible.', noRetry: true })
    })

    test('regression reproducer: Korean uses the Korean locale values and keeps the message verbatim', async () => {
        changeLanguage('ko')
        const withMessage = languageKorean.errors.hordeNotPossibleWith
        const bare = languageKorean.errors.hordeNotPossible
        expect(withMessage).not.toBe(languageEnglish.errors.hordeNotPossibleWith)
        expect(bare).not.toBe(languageEnglish.errors.hordeNotPossible)

        stubHorde('50% of $& {message}')
        expect((await ask()).result).toBe(withMessage.replace('{message}', () => '50% of $& {message}'))

        stubHorde()
        expect((await ask()).result).toBe(bare)
    })
})

//#endregion

//#region plugin provider

describe('plugin provider failure', () => {
    beforeEach(() => installDb({ aiModel: 'custom', currentPluginProvider: 'prov' }))

    test('compatibility guard: the JSON dump is inserted verbatim even when it contains $& and {x}', async () => {
        const thrown = { detail: 'cost $& is {x}' }
        h.pluginProcess.mockRejectedValue(thrown)
        const out = await ask()
        expect(out.type).toBe('fail')
        expect(out.result).toBe(`Plugin Error from prov: ${JSON.stringify(thrown)}`)
        expect(String(out.result)).toContain('$&')
        expect(String(out.result)).toContain('{x}')
    })

    test('regression reproducer: Korean uses the Korean locale value with provider and dump intact', async () => {
        changeLanguage('ko')
        const template = languageKorean.errors.pluginProviderError
        expect(template).not.toBe(languageEnglish.errors.pluginProviderError)
        const thrown = { detail: 'cost $& is {x}' }
        h.pluginProcess.mockRejectedValue(thrown)
        const out = await ask()
        expect(out.result).toBe(template.replace('{provider}', () => 'prov').replace('{error}', () => JSON.stringify(thrown)))
    })
})

//#endregion

//#region Ooba WebSocket

class FakeSocket {
    static onCreate: ((socket: FakeSocket) => void) | null = null
    onopen: (() => void) | null = null
    onerror: (() => void) | null = null
    onclose: ((e: { code: number }) => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    constructor(public url: string) {
        FakeSocket.onCreate?.(this)
        // The connection fails once the caller has had a chance to attach its handlers.
        queueMicrotask(() => this.onerror?.())
    }
    close() {}
}

describe('Ooba WebSocket connection failure', () => {
    beforeEach(() => {
        installDb({ aiModel: 'mancer', useStreaming: true })
        vi.stubGlobal('WebSocket', FakeSocket)
    })
    afterEach(() => { FakeSocket.onCreate = null })

    test('regression reproducer: the failure names the URL in a well-formed sentence', async () => {
        const out = await ask({ useStreaming: true })
        expect(out).toMatchObject({ type: 'fail', result: "WebSocket connection to 'ws://ooba.test/api/v1/stream' failed." })
    })

    test('compatibility guard: an abort reason wins over the connection failure text', async () => {
        const controller = new AbortController()
        FakeSocket.onCreate = () => controller.abort('stopped by user')
        const out = await ask({ useStreaming: true }, controller.signal)
        expect(out).toMatchObject({ type: 'fail', result: 'stopped by user' })
    })

    test('regression reproducer: Korean uses the Korean locale value with the URL intact', async () => {
        changeLanguage('ko')
        const template = languageKorean.errors.websocketConnectFailed
        expect(template).not.toBe(languageEnglish.errors.websocketConnectFailed)
        const out = await ask({ useStreaming: true })
        expect(out.result).toBe(template.replace('{url}', 'ws://ooba.test/api/v1/stream'))
    })
})

//#endregion

//#region local streaming block

describe('OpenAI-compatible streaming to a local address from the web build', () => {
    beforeEach(() => installDb({
        aiModel: 'reverse_proxy', useStreaming: true, customAPIFormat: 0, forceReplaceUrl: 'http://localhost:5001/v1/chat/completions',
        customProxyRequestModel: 'm', proxyRequestModel: 'm', proxyKey: 'k', forceReplaceUrl2: '',
    }))

    test('regression reproducer: the failure explains the policy and the remedy in plain English', async () => {
        const out = await ask({ useStreaming: true })
        expect(out).toMatchObject({
            type: 'fail',
            result: 'Local requests cannot use streaming because of browser and OS security policy. Turn off streaming.',
        })
    })

    test('regression reproducer: Korean uses the Korean locale value', async () => {
        changeLanguage('ko')
        expect(languageKorean.errors.localStreamingBlocked).not.toBe(languageEnglish.errors.localStreamingBlocked)
        const out = await ask({ useStreaming: true })
        expect(out.result).toBe(languageKorean.errors.localStreamingBlocked)
    })
})

//#endregion

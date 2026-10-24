import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(), globalFetch: vi.fn(),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
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
vi.mock('../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db, setDatabase: vi.fn(),
    getCurrentCharacter: vi.fn(() => ({ type: 'group' })), getCurrentChat: vi.fn(() => null),
}))
vi.mock('../../stores.svelte', () => ({
    get DBState() { return { db: h.db } },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: writable(null),
}))
vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../alert', () => ({ alertError: vi.fn() }))
vi.mock('../files/inlays', () => ({
    saveInlayedSignature: vi.fn(),
    setInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(),
    supportsInlayImage: vi.fn(() => false),
}))
vi.mock('../mcp/mcp', () => ({ callTool: vi.fn(), decodeToolCall: vi.fn(), encodeToolCall: vi.fn(), getTools: vi.fn(async () => []) }))
vi.mock('../triggers', () => ({ runTrigger: vi.fn(async () => null) }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../plugins/plugins.svelte', () => ({
    customProviderStore: writable([]),
    pluginV2: {
        providerOptions: new Map(), providers: new Map(),
        replacerbeforeRequest: new Set(), replacerafterRequest: new Set(),
    },
    pluginProcess: vi.fn(),
}))
vi.mock('../../plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: [] }))
vi.mock('../../model/modelData/modelDataStore', () => ({
    startModelData: vi.fn(),
    refreshModelDataNow: vi.fn(),
    loadProviderLists: vi.fn(),
    saveProviderLists: vi.fn(async () => {}),
}))
vi.mock('./openAI/requests', () => ({
    requestOpenAI: vi.fn(),
    requestOpenAILegacyInstruct: vi.fn(),
    requestOpenAIResponseAPI: vi.fn(),
}))
vi.mock('./anthropic', () => ({ requestClaude: vi.fn() }))
vi.mock('./google', () => ({ requestGoogleCloudVertex: vi.fn() }))

import { requestChatData } from './request'
import { requestOpenAI } from './openAI/requests'

/**
 * The provider layer (`requestOpenAI`) is mocked, so this proves only how `requestChatData`
 * treats a throw from below and says nothing about native or network behaviour.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */

const requestOpenAIMock = vi.mocked(requestOpenAI)
const arg = () => ({
    formated: [{ role: 'user' as const, content: 'hello' }],
    bias: {},
})

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        aiModel: 'gpt4o',
        subModel: 'gpt4o',
        fallbackModels: {},
        requestRetrys: 0,
        temperature: 70,
        maxResponse: 100,
        genTime: 1,
        useStreaming: false,
        banCharacterset: [],
        customModels: [],
    })
    requestOpenAIMock.mockReset()
})

describe('requestChatData over a provider request that throws', () => {
    test('a throw while the caller has stopped returns the silent Aborted result', async () => {
        const controller = new AbortController()
        requestOpenAIMock.mockImplementation(async () => {
            controller.abort()
            throw new Error('Failed to fetch')
        })

        const result = await requestChatData(arg(), 'model', controller.signal)

        expect(result).toEqual({ type: 'fail', result: 'Aborted' })
        expect(requestOpenAIMock).toHaveBeenCalledTimes(1)
    })

    test('guard: a throw while the caller has not stopped still throws', async () => {
        const controller = new AbortController()
        requestOpenAIMock.mockRejectedValue(new Error('Failed to fetch'))

        await expect(requestChatData(arg(), 'model', controller.signal)).rejects.toThrow('Failed to fetch')
    })

    test('guard: a throw with no signal still throws', async () => {
        requestOpenAIMock.mockRejectedValue(new Error('Failed to fetch'))

        await expect(requestChatData(arg(), 'model')).rejects.toThrow('Failed to fetch')
    })

    test('guard: a timeout before headers still reports its own error', async () => {
        const controller = new AbortController()
        requestOpenAIMock.mockRejectedValue(new Error('Request timed out'))

        await expect(requestChatData(arg(), 'model', controller.signal)).rejects.toThrow('Request timed out')
        expect(controller.signal.aborted).toBe(false)
    })

    test('guard: a Stop noticed after the await still returns Aborted', async () => {
        const controller = new AbortController()
        requestOpenAIMock.mockImplementation(async () => {
            controller.abort()
            return { type: 'success', result: 'late' }
        })

        const result = await requestChatData(arg(), 'model', controller.signal)

        expect(result).toEqual({ type: 'fail', result: 'Aborted' })
    })
})

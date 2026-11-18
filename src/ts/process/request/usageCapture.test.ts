import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    tokenizerThrows: false,
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(), globalFetch: vi.fn(),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
    readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))
vi.mock('../../tokenizer', () => ({
    ChatTokenizer: class {
        constructor(_a: number, _b: string) {}
        async tokenizeChat() {
            if (h.tokenizerThrows) { throw new Error('tokenizer failed') }
            return 7
        }
    },
    tokenize: vi.fn(async (s: string) => {
        if (h.tokenizerThrows) { throw new Error('tokenizer failed') }
        return s?.length ?? 0
    }),
    tokenizeNum: vi.fn(async () => [] as number[]),
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

import { usageModelKey } from '../../usage/usageCapture'
import { isUsageKey, localMonth } from '../../usage/usageLedger'
import type { TokenUsage } from '../../usage/usageTypes'
import { requestChatData, requestChatDataMain, type RequestDataArgumentExtended, type requestDataResponse, type StreamResponseChunk } from './request'
import { requestOpenAI } from './openAI/requests'

/**
 * Usage capture over the real `requestChatData`/`requestChatDataMain` and the real ledger. The provider layer
 * (`requestOpenAI`) is mocked: each mock reports usage to the meter on the argument like a provider call site does,
 * so a passing test says nothing about native or network behaviour. The database and token counting are mocked.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */

const requestOpenAIMock = vi.mocked(requestOpenAI)
const USAGE_A: TokenUsage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }
const MONTH = () => localMonth(new Date())
const key = (purpose: string, counter: string, model = 'gpt4o') => `u1|${MONTH()}|${purpose}|${counter}|${model}`

const arg = (extra: Record<string, unknown> = {}) => ({
    formated: [{ role: 'user' as const, content: 'hello' }],
    bias: {},
    ...extra,
})

function statics(): Record<string, unknown> {
    return h.db.statics as Record<string, unknown>
}
function usageKeysOf(): string[] {
    return Object.keys(statics()).filter(isUsageKey).sort()
}
/** The estimate runs after the result is returned, off the request path. */
async function settled(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

function reportingProvider(usage: TokenUsage | null, result: requestDataResponse = { type: 'success', result: 'hello back' }) {
    requestOpenAIMock.mockImplementation(async (a: RequestDataArgumentExtended) => {
        if (usage) { a.usageMeter?.report(usage) }
        return result
    })
}

function innerStream(chunks: StreamResponseChunk[], options: { cancel?: (reason: unknown) => void, errorAfter?: { error: Error } } = {}): ReadableStream<StreamResponseChunk> {
    let next = 0
    return new ReadableStream<StreamResponseChunk>({
        pull(controller) {
            if (next < chunks.length) {
                controller.enqueue(chunks[next++])
                return
            }
            if (options.errorAfter) {
                controller.error(options.errorAfter.error)
                return
            }
            controller.close()
        },
        cancel(reason) { options.cancel?.(reason) },
    })
}

async function readAll(stream: ReadableStream<StreamResponseChunk>): Promise<StreamResponseChunk[]> {
    const reader = stream.getReader()
    const out: StreamResponseChunk[] = []
    while (true) {
        const { done, value } = await reader.read()
        if (done) { return out }
        out.push(value)
    }
}

beforeEach(() => {
    for (const k of Object.keys(h.db)) { delete h.db[k] }
    h.tokenizerThrows = false
    Object.assign(h.db, {
        aiModel: 'gpt4o',
        subModel: 'gpt4o',
        fallbackModels: {},
        requestRetrys: 0,
        temperature: 70,
        maxResponse: 100,
        genTime: 1,
        useStreaming: true,
        banCharacterset: [],
        customModels: [],
        modules: [],
        statics: { messages: 0, imports: 0 },
    })
    requestOpenAIMock.mockReset()
})

describe('reported usage is recorded once per attempt', () => {
    test('a streamed Utility attempt records under utility with the reported counters', async () => {
        requestOpenAIMock.mockImplementation(async (a: RequestDataArgumentExtended) => ({
            type: 'streaming',
            result: new ReadableStream<StreamResponseChunk>({
                start(controller) {
                    controller.enqueue({ '0': 'hi' })
                    a.usageMeter?.report(USAGE_A)
                    controller.close()
                },
            }),
        }))
        const result = await requestChatData(arg({ useStreaming: true, usagePurpose: 'utility' }), 'model')
        expect(result.type).toBe('streaming')
        await readAll(result.result as ReadableStream<StreamResponseChunk>)
        expect(statics()).toMatchObject({ [key('utility', 'n')]: 1, [key('utility', 'i')]: 10, [key('utility', 'o')]: 5 })
        expect(usageKeysOf().some((k) => k.includes('|ei|') || k.includes('|eo|'))).toBe(false)
    })

    test('a non-streamed plugin attempt records under plugin', async () => {
        reportingProvider(USAGE_A)
        await requestChatData(arg({ useStreaming: false, usagePurpose: 'plugin' }), 'model')
        await settled()
        expect(statics()).toMatchObject({ [key('plugin', 'n')]: 1, [key('plugin', 'i')]: 10, [key('plugin', 'o')]: 5 })
        expect(usageKeysOf().some((k) => k.includes('|ei|') || k.includes('|eo|'))).toBe(false)
    })

    test('the main send records under chat and the mode label records under its mode', async () => {
        reportingProvider(USAGE_A)
        await requestChatData(arg({ useStreaming: false, mainSend: true }), 'model')
        await requestChatData(arg({ useStreaming: false }), 'memory')
        expect(statics()[key('chat', 'n')]).toBe(1)
        expect(statics()[key('memory', 'n')]).toBe(1)
    })

    test('a banned-charset retry records two attempts', async () => {
        h.db.banCharacterset = ['Han']
        h.db.requestRetrys = 1
        let call = 0
        requestOpenAIMock.mockImplementation(async (a: RequestDataArgumentExtended) => {
            a.usageMeter?.report(USAGE_A)
            return { type: 'success', result: call++ === 0 ? '漢字' : 'plain' }
        })
        await requestChatData(arg({ useStreaming: false }), 'model')
        expect(statics()).toMatchObject({ [key('model', 'n')]: 2, [key('model', 'i')]: 20 })
    })

    test('the same argument object sent twice gives two separate records', async () => {
        let call = 0
        requestOpenAIMock.mockImplementation(async (a: RequestDataArgumentExtended) => {
            a.usageMeter?.report(call++ === 0 ? { ...USAGE_A, input: 10 } : { ...USAGE_A, input: 20 })
            return { type: 'success', result: 'ok' }
        })
        const shared = arg({ useStreaming: false })
        await requestChatDataMain(shared, 'model')
        await requestChatDataMain(shared, 'model')
        expect(statics()).toMatchObject({ [key('model', 'n')]: 2, [key('model', 'i')]: 30 })
    })
})

describe('estimated attempts', () => {
    test('an attempt without reported usage records the estimate and never the exact counters', async () => {
        reportingProvider(null, { type: 'success', result: 'hello' })
        await requestChatData(arg({ useStreaming: false, mainSend: true, usageInputEstimate: 123 }), 'model')
        await settled()
        expect(statics()).toMatchObject({ [key('chat', 'n')]: 1, [key('chat', 'ei')]: 123, [key('chat', 'eo')]: 5 })
        expect(usageKeysOf().some((k) => k.includes('|i|') || k.includes('|o|'))).toBe(false)
    })

    test('without an input estimate the tokenizer counts the prompt', async () => {
        reportingProvider(null, { type: 'success', result: 'hello' })
        await requestChatData(arg({ useStreaming: false }), 'model')
        await settled()
        expect(statics()[key('model', 'ei')]).toBe(7)
    })

    test('a cancelled stream settles once from the last chunk and forwards the same reason to the inner stream', async () => {
        const cancel = vi.fn()
        requestOpenAIMock.mockImplementation(async () => ({
            type: 'streaming',
            result: innerStream([{ '0': 'ab' }, { '0': 'abcd' }, { '0': 'abcdef' }], { cancel }),
        }))
        const result = await requestChatData(arg({ usageInputEstimate: 50 }), 'model')
        const reader = (result.result as ReadableStream<StreamResponseChunk>).getReader()
        await reader.read()
        await reader.read()
        const reason = new Error('user stop')
        await reader.cancel(reason)
        await settled()
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(cancel.mock.calls[0][0]).toBe(reason)
        expect(statics()).toMatchObject({ [key('model', 'n')]: 1, [key('model', 'ei')]: 50, [key('model', 'eo')]: 4 })
    })

    test('a stream closed and then cancelled settles once', async () => {
        requestOpenAIMock.mockImplementation(async () => ({ type: 'streaming', result: innerStream([{ '0': 'abc' }]) }))
        const result = await requestChatData(arg({ usageInputEstimate: 1 }), 'model')
        const stream = result.result as ReadableStream<StreamResponseChunk>
        const reader = stream.getReader()
        await reader.read()
        await reader.read()
        await reader.cancel('late')
        await settled()
        expect(statics()[key('model', 'n')]).toBe(1)
    })
})

describe('failed attempts', () => {
    test('a fail result without usage records nothing', async () => {
        reportingProvider(null, { type: 'fail', result: 'boom' })
        await requestChatData(arg({ useStreaming: false }), 'model')
        await settled()
        expect(usageKeysOf()).toEqual([])
    })

    test('a fail result that already reported usage is recorded as reported', async () => {
        reportingProvider(USAGE_A, { type: 'fail', result: 'boom after a tool round' })
        await requestChatData(arg({ useStreaming: false }), 'model')
        expect(statics()).toMatchObject({ [key('model', 'n')]: 1, [key('model', 'i')]: 10 })
    })

    test('a throw without usage records nothing and the same error object is re-thrown', async () => {
        const error = new Error('Failed to fetch')
        requestOpenAIMock.mockRejectedValue(error)
        await expect(requestChatData(arg({ useStreaming: false }), 'model')).rejects.toBe(error)
        await settled()
        expect(usageKeysOf()).toEqual([])
    })

    test('a throw after a tool round reported usage records the reported counters', async () => {
        requestOpenAIMock.mockImplementation(async (a: RequestDataArgumentExtended) => {
            a.usageMeter?.report(USAGE_A)
            throw new Error('second round failed')
        })
        await expect(requestChatData(arg({ useStreaming: false }), 'model')).rejects.toThrow('second round failed')
        expect(statics()).toMatchObject({ [key('model', 'n')]: 1, [key('model', 'i')]: 10 })
    })

    test('an attempt the provider marked failed, with no reported usage, records nothing even if it ends in a stream', async () => {
        requestOpenAIMock.mockImplementation(async (a: RequestDataArgumentExtended) => {
            a.usageMeter?.markFailed()
            return { type: 'streaming', result: innerStream([{ '0': 'Error:Bad thing' }]) }
        })
        const result = await requestChatData(arg({ usageInputEstimate: 5 }), 'model')
        await readAll(result.result as ReadableStream<StreamResponseChunk>)
        await settled()
        expect(usageKeysOf()).toEqual([])
    })

    test('an inner read error reaches the consumer as the same object and records nothing without reported usage', async () => {
        const error = new Error('socket reset')
        requestOpenAIMock.mockImplementation(async () => ({ type: 'streaming', result: innerStream([{ '0': 'a' }], { errorAfter: { error } }) }))
        const result = await requestChatData(arg({ usageInputEstimate: 5 }), 'model')
        const reader = (result.result as ReadableStream<StreamResponseChunk>).getReader()
        await reader.read()
        await expect(reader.read()).rejects.toBe(error)
        await settled()
        expect(usageKeysOf()).toEqual([])
    })

    test('guard: previewBody records nothing', async () => {
        reportingProvider(USAGE_A, { type: 'success', result: '{"body":{}}' })
        await requestChatData(arg({ useStreaming: false, previewBody: true }), 'model')
        await settled()
        expect(usageKeysOf()).toEqual([])
    })
})

describe('capture never changes a request', () => {
    test('guard: the wrapper forwards the same chunk objects in order', async () => {
        const chunks: StreamResponseChunk[] = [{ '0': 'a' }, { '0': 'ab' }, { '0': 'abc' }]
        requestOpenAIMock.mockImplementation(async () => ({ type: 'streaming', result: innerStream(chunks) }))
        const result = await requestChatData(arg({ usageInputEstimate: 1 }), 'model')
        const out = await readAll(result.result as ReadableStream<StreamResponseChunk>)
        expect(out).toHaveLength(3)
        out.forEach((chunk, index) => expect(chunk).toBe(chunks[index]))
    })

    test('guard: a profile without statics and a throwing tokenizer leave the result unchanged', async () => {
        delete h.db.statics
        h.tokenizerThrows = true
        reportingProvider(null, { type: 'success', result: 'hello' })
        const result = await requestChatData(arg({ useStreaming: false }), 'model')
        await settled()
        expect(result).toEqual({ type: 'success', result: 'hello' })
    })

    test('a throwing tokenizer still counts the request', async () => {
        h.tokenizerThrows = true
        reportingProvider(null, { type: 'success', result: 'hello' })
        await requestChatData(arg({ useStreaming: false }), 'model')
        await settled()
        expect(statics()[key('model', 'n')]).toBe(1)
    })
})

describe('usageModelKey', () => {
    const db = {
        openrouterRequestModel: 'or-model',
        customProxyRequestModel: 'proxy-model',
        nanogptRequestModel: 'nano-model',
        ollamaModel: 'hosted-model',
        ollamaCloudModel: 'cloud-model',
    }

    test.each([
        ['openrouter', 'openrouter>or-model'],
        ['reverse_proxy', 'reverse_proxy>proxy-model'],
        ['nanogpt', 'nanogpt>nano-model'],
        ['ollama-hosted', 'ollama>hosted-model'],
        ['ollama-cloud', 'ollama>cloud-model'],
        ['gpt-4o', 'gpt-4o'],
    ])('%s is labelled %s', (aiModel, expected) => {
        expect(usageModelKey(aiModel, db)).toBe(expected)
    })

    test('a routed model without a configured target is labelled with an empty target', () => {
        expect(usageModelKey('openrouter', undefined)).toBe('openrouter>')
        expect(usageModelKey('ollama-cloud', {})).toBe('ollama>')
    })
})
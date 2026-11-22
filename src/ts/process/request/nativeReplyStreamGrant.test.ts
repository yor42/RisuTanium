/**
 * P1 (reproducer), P3-P7 and P10 request-level rows (guards, new rules): an OpenAI-compatible stream of a single
 * character is offered the reply grant, binds it for its own reply only with the blob and the usage context of the
 * request, reads the stream with the same rule the blob stores, and tells the page when it stops reading the owned
 * request (failed head, page timeout, a missing Content-Type, a Stop before anything is pushed).
 *
 * Drives the real `requestChatData` and the real OpenAI request path over the module mocks of `nativeReplyGrant.test.ts`
 * (copied: each suite mocks its own graph). `fetchNative` is a mock that takes the owner the way the real one does, so
 * nothing here says anything about native behaviour. Mutants PM1-PM8, PM15, PM18-PM19, PM21 in the S2 plan.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'
import { resetKeyRings } from './keyRing'
import { issueNativeReplyGrant, takeReplyOwner, type NativeReplyOwnerArg } from '../../nativeReply/grant'
import { configurePageState, heldReply, noteInvoked, resetPageStateForTests, setReconcileTrigger, settleNativeReplyInflight, takeAnnounced } from '../../nativeReply/pageState'
import type { PumpProbe, ReplyStamp } from '../../nativeReply/ownedBody'
import type { fetchNative as FetchNative } from '../../globalApi.svelte'

type FetchArg = NonNullable<Parameters<typeof FetchNative>[1]>
interface FetchCall {
    taken: NativeReplyOwnerArg | null
    probe: PumpProbe | undefined
    signal: AbortSignal | undefined
    abandon: ReturnType<typeof vi.fn>
    arg: FetchArg
}

const h = vi.hoisted(() => ({
    log: [] as string[],
    rules: [] as unknown[],
    beforeRequest: new Set<(formated: unknown, model: string) => unknown>(),
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
vi.mock('../../stores.svelte', () => ({
    DBState: { db: {} },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: writable(null),
}))
vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))
vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
    readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))
vi.mock('./openAI/chatStreamTransform', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./openAI/chatStreamTransform')>()
    return {
        ...actual,
        openAIChatStreamTransform: (rule: Parameters<typeof actual.openAIChatStreamTransform>[0], io: Parameters<typeof actual.openAIChatStreamTransform>[1]) => {
            h.rules.push(rule)
            return actual.openAIChatStreamTransform(rule, io)
        },
    }
})
vi.mock('../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }))
vi.mock('../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../files/inlays', () => ({
    getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'x'), supportsInlayImage: vi.fn(() => false),
    saveInlayedSignature: vi.fn(), setInlayAsset: vi.fn(),
}))
vi.mock('../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
        replacerbeforeRequest: h.beforeRequest, replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: vi.fn(),
}))
vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn(), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))
vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))
vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: object }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

type Result = { type: string, result: unknown, endsTurn?: boolean }
let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }
let fetchNativeMock: typeof FetchNative

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const OTHER = '0b9c1a7e-0000-4000-8000-000000000002'
const parseBase = { target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha', generationInfo: {}, promptInfo: {}, escape: false, requestedMs: 1 }
const encoder = new TextEncoder()
const SSE = 'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'
const sse = (extra: Record<string, string> = {}) => new Response(SSE, { status: 200, headers: { 'Content-Type': 'text/event-stream', ...extra } })
const calls: FetchCall[] = []
const consume = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
const trigger = vi.fn()

beforeAll(async () => {
    requestChatData = (await import('./request')).requestChatData as never
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }
    fetchNativeMock = (await import('../../globalApi.svelte')).fetchNative
}, 60_000)

function installDb(extra: Record<string, unknown> = {}): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: true, openAIKey: 'sk-test',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        google: { accessToken: '', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
        claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', nanogptKey: '', openrouterKey: '', proxyKey: '',
        OaiCompAPIKeys: {}, ollamaCloudModel: 'cloud-m', ollamaModel: 'local-m', ollamaThinkingMode: 'default',
        modelTools: [], customAPIFormat: 0,
        ...extra,
    } as unknown as Database
}

/** The transport mock: takes the owner and answers like the real `fetchNative` for an owned request that was invoked. */
function script(answer: (call: FetchCall, n: number) => Promise<Response> | Response): void {
    vi.mocked(fetchNativeMock).mockImplementation(async (_url: string, arg: FetchArg) => {
        const taken = takeReplyOwner(arg?.nativeReply)
        const call: FetchCall = { taken, probe: arg?.pumpProbe, signal: arg?.signal, abandon: vi.fn(), arg }
        calls.push(call)
        h.log.push('fetch')
        if (taken) {
            noteInvoked(taken.key)
            if (call.probe) {
                call.probe.owned = true
                call.probe.abandon = call.abandon as unknown as () => void
            }
        }
        return answer(call, calls.length)
    })
}

/** What the pump does on an end event: the probe learns the stamp, and the stream's own hook is told. */
function stamp(call: FetchCall, value: ReplyStamp): void {
    if (call.probe) {
        call.probe.stamp = value
        call.probe.onStamp?.(value)
    }
}

function ask(extra: Record<string, unknown> = {}, model = 'model', signal: AbortSignal | null = null) {
    return requestChatData({
        formated: [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }], bias: {}, useStreaming: true, noMultiGen: true, tools: [],
        chatId: KEY, usageInputEstimate: 7, ...extra,
    }, model, signal).catch((error: unknown) => ({ type: 'threw', result: error }) as Result)
}

beforeEach(() => {
    calls.length = 0
    h.log.length = 0
    h.rules.length = 0
    h.beforeRequest.clear()
    consume.mockReset()
    consume.mockImplementation(async (_key: string) => { h.log.push('consume'); return { result: 'removed' as const, flushed: true } })
    trigger.mockReset()
    resetKeyRings()
    resetPageStateForTests()
    configurePageState({
        store: { consume },
        waiter: { committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
        onUnreadable: () => {},
    })
    setReconcileTrigger(trigger)
    installDb()
    script(() => sse())
})

describe('P1: the stream binds with the stream blob and its usage context', () => {
    test('the first stream request carries an owner whose blob is an openai-chat-stream with the usage context', async () => {
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(calls).toHaveLength(1)
        expect(heldReply(KEY)?.bound).toBe(true)
        const taken = calls[0].taken
        expect(taken).not.toBeNull()
        const blob = JSON.parse(taken!.blob) as { parse: { kind: string }, usage: { modelKey: string, inputEstimate: number } }
        expect(blob.parse.kind).toBe('openai-chat-stream')
        expect(blob.usage).toEqual({ modelKey: 'gpt4o', inputEstimate: 7 })
        expect(calls[0].probe).toBeDefined()
    })

    test('the usage model key is the model the request runs, not the database main model', async () => {
        installDb({ aiModel: 'gpt4o', subModel: 'gpt4o-mini' })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) }, 'submodel')
        const blob = JSON.parse(calls[0].taken!.blob) as { usage: { modelKey: string } }
        expect(blob.usage.modelKey).toBe('gpt4o-mini')
    })
})

describe('P3: other formats never own a stream', () => {
    test.each([
        ['Mistral', 'mistral-large-latest'],
        ['NanoGPT', 'nanogpt'],
        ['Anthropic', 'claude-3-5-sonnet-latest'],
        ['Gemini', 'gemini-2.5-pro'],
    ])('a %s stream leaves the grant unbound', async (_label, aiModel) => {
        installDb({ aiModel, subModel: aiModel })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(heldReply(KEY)?.bound).toBe(false)
        expect(calls.every((call) => call.taken === null)).toBe(true)
    })
})

describe('P4: a failed head is retired before any retry, and an announced one ends the turn', () => {
    test('429 unannounced, then 200: the first record is consumed before the retry, which is unowned', async () => {
        installDb({ requestRetrys: 1 })
        script((call, n) => {
            if (n === 1) {
                stamp(call, { key: KEY, outcome: 'done', stored: true, status: 429 })
                return new Response('slow down', { status: 429 })
            }
            return sse()
        })

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(calls).toHaveLength(2)
        expect(calls[0].taken).not.toBeNull()
        expect(calls[1].taken).toBeNull()
        expect(consume).toHaveBeenCalledTimes(1)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('an announced 429 gives one request and ends the turn', async () => {
        installDb({ requestRetrys: 2 })
        script((call) => {
            stamp(call, { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 })
            return new Response('slow down', { status: 429 })
        })

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out).toMatchObject({ type: 'fail', endsTurn: true })
        expect(calls).toHaveLength(1)
        expect(consume).toHaveBeenCalledTimes(1)
    })

    test('a 200 that is not an event stream is retired and retried', async () => {
        installDb({ requestRetrys: 1 })
        script((_call, n) => (n === 1 ? new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) : sse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
    })

    test('a failed head of a request with no owner consumes nothing', async () => {
        installDb({ requestRetrys: 1 })
        script((_call, n) => (n === 1 ? new Response('x', { status: 500 }) : sse()))
        await ask({})
        expect(consume).not.toHaveBeenCalled()
    })
})

describe('P5: a grant binds only its own reply', () => {
    test('two replies each own their request; a request of another chat binds nothing and leaves the grant usable', async () => {
        const grantA = issueNativeReplyGrant(KEY, parseBase)
        const grantB = issueNativeReplyGrant(OTHER, parseBase)
        await ask({ nativeReplyGrant: grantA, chatId: KEY })
        await ask({ nativeReplyGrant: grantB, chatId: OTHER })
        expect(calls.map((call) => call.taken?.key)).toEqual([KEY, OTHER])

        const stray = issueNativeReplyGrant('0b9c1a7e-0000-4000-8000-000000000003', parseBase)
        await ask({ nativeReplyGrant: stray, chatId: KEY })
        expect(calls[2].taken).toBeNull()
        expect(heldReply('0b9c1a7e-0000-4000-8000-000000000003')?.bound).toBe(false)
        const { bindStreamGrant } = await import('../../nativeReply/grant')
        const own = bindStreamGrant(stray, '0b9c1a7e-0000-4000-8000-000000000003', { kind: 'openai-chat-stream', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }, { modelKey: 'gpt4o', inputEstimate: 1 })
        expect(own).not.toBeNull()
    })
})

describe('P6: a usage context that is not a model key and a finite estimate binds nothing', () => {
    test.each([
        ['undefined', undefined],
        ['NaN', Number.NaN],
        ['negative', -1],
    ])('an input estimate of %s runs the request page-owned', async (_label, estimate) => {
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), usageInputEstimate: estimate })
        expect(calls[0].taken).toBeNull()
        expect(heldReply(KEY)?.bound).toBe(false)
    })
})

describe('P7: the blob and the live read use one rule', () => {
    test('a switch flipped after the bind cannot make the live rule differ from the stored one', async () => {
        script((call) => {
            // The database changes between the bind and the transform: the transform must still read the bound rule.
            ;(DBState.db as unknown as Record<string, unknown>).jsonSchemaEnabled = true
            expect(call.taken).not.toBeNull()
            return sse()
        })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), extractJson: 'text' })

        const stored = (JSON.parse(calls[0].taken!.blob) as { parse: Record<string, unknown> }).parse
        expect(h.rules).toHaveLength(1)
        const live = h.rules[0] as Record<string, unknown>
        for (const field of ['deepSeekThinkingOutput', 'extractJson', 'jsonSchema', 'multiGen']) {
            expect(live[field]).toEqual(stored[field])
        }
        expect(stored.jsonSchema).toBe(false)
    })
})

describe('P10 request rows: a throw before the hand-off is the page ending its read', () => {
    test('P10-H: a head that fails before it arrives notes pageEnded, and settle consumes', async () => {
        script((call) => {
            stamp(call, { key: KEY, outcome: 'failed', stored: false })
            throw new Error('connection refused')
        })
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(out.type).toBe('threw')
        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)

        await settleNativeReplyInflight(KEY)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(trigger).not.toHaveBeenCalled()
    })

    test('P10-T: a page timeout before the head notes pageEnded; settle consumes and never asks for a reconcile; a live answer leaves release', async () => {
        script(() => { throw new Error('requestTimedOut') })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)

        await settleNativeReplyInflight(KEY)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(trigger).not.toHaveBeenCalled()
    })

    test('P10-T: a consume that answers live: leaves the entry released', async () => {
        script(() => { throw new Error('requestTimedOut') })
        consume.mockRejectedValue(new Error('live: still writing'))
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        await settleNativeReplyInflight(KEY)
        expect(heldReply(KEY)?.state).toBe('release')
        expect(trigger).not.toHaveBeenCalled()
    })

    test('a throw before the invoke (no owner taken, nothing abandoned) is dropped at settle without a consume', async () => {
        vi.mocked(fetchNativeMock).mockImplementation(async () => { throw new Error('aborted') })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        await settleNativeReplyInflight(KEY)
        expect(consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('P10-X: a 200 with no Content-Type header throws as today, notes pageEnded and abandons', async () => {
        const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(SSE)) } })
        script(() => {
            const response = new Response(body, { status: 200 })
            expect(response.headers.get('Content-Type')).toBeNull()
            return response
        })

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('threw')
        expect(out.result).toBeInstanceOf(TypeError)
        expect(calls).toHaveLength(1)
        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)

        await settleNativeReplyInflight(KEY)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(trigger).not.toHaveBeenCalled()
    })

    test('a stop after the stream is returned and before anything is pushed notes pageEnded and abandons with no settle', async () => {
        const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(SSE)) } })
        script(() => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
        const controller = new AbortController()

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) }, 'model', controller.signal)
        expect(out.type).toBe('streaming')
        expect(heldReply(KEY)?.pageEnded).toBeUndefined()

        controller.abort()

        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)
        expect(consume).not.toHaveBeenCalled()
    })

    test('an announced stream stamp feeds the announced fact through the probe the call site registered', async () => {
        script((call) => {
            stamp(call, { key: KEY, outcome: 'done', stored: true, announced: true })
            return sse()
        })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(takeAnnounced([KEY])).toBe(true)
    })
})

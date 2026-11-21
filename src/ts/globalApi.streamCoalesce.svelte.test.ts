/**
 * D2 (diagnostic guard, #455): the JavaScript chain from one native stream event to a snapshot at the consumer is
 * promise-only. This is what the 'off' reply loop's posted-message yield relies on to coalesce a synchronous pass: a
 * native event that queued during the pass reaches the reader before the yield's message task runs.
 *
 * Drives the REAL `fetchNative` pump of `globalApi.svelte.ts` with the module mocks of
 * `globalApi.streamedFetch.svelte.test.ts` (copied, not shared); the Tauri command and event bridge are mocks, and
 * `emit` calls the captured `listen` callback synchronously. The body goes through the REAL OpenAI `getTranStream`
 * transform, then an eager wrapper loop that is a copy of the shape of `wrapToolStream` in the same module (the real
 * `requestOpenAI` entry is not loaded: its module graph needs request-module mocks this harness does not carry), then the real `settleUsage`.
 *
 * It proves nothing about the order of native event tasks and message tasks on a device (the Node run gives the
 * answer for a promise-only chain by construction); it detects a macrotask entering the chain.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const platform = vi.hoisted(() => ({ isTauri: true }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platform.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: [],
    savingStoppedReason: writable(null),
    frozenSaveKeysStore: writable([]),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

// No operating-system plugin by default, like the test runner; a test sets `os.kind` to pick a transport.
const os = vi.hoisted(() => ({ kind: '' }))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (!os.kind) {
            throw new Error('no operating-system plugin')
        }
        return os.kind
    },
}))

const streamEvents = vi.hoisted(() => ({ emit: (_payload: string) => {} }))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (_name: string, callback: (event: { payload: string }) => void) => {
        streamEvents.emit = (payload: string) => callback({ payload })
        return vi.fn()
    }),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        async getItem(_key: string) { return null }
        async setItem(_key: string, _value: Uint8Array) {}
        async keys() { return [] as string[] }
        async removeItem(_key: string) {}
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

// The provider module graph reaches the real send, which this suite never runs.
vi.mock(import('src/ts/process/index.svelte'), () => ({}) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))


import { invoke } from '@tauri-apps/api/core'
import { fetchNative } from 'src/ts/globalApi.svelte'
import { resetInFlightForTest } from 'src/ts/process/inFlightWork'
import { __testOpenAIChatStream } from 'src/ts/process/request/openAI/requests'
import { settleUsage } from 'src/ts/usage/usageCapture'
import { createUsageMeter } from 'src/ts/usage/usageMeter'
import type { RequestDataArgumentExtended, StreamResponseChunk } from 'src/ts/process/request/request'

const invokeMock = vi.mocked(invoke)

const STREAM_URL = 'https://api.example.invalid/v1/stream'
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const emit = (id: string, event: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...event }))
const b64 = (text: string) => Buffer.from(text).toString('base64')

function sseEvent(word: string): string {
    const payload = {
        id: 'chatcmpl-abc123', object: 'chat.completion.chunk', created: 1731000000, model: 'gpt-4o-mini',
        choices: [{ index: 0, delta: { content: word }, finish_reason: null }],
    }
    return 'data: ' + JSON.stringify(payload) + '\n\n'
}

/** The eager start loop of `wrapToolStream`: reads every snapshot as it arrives and enqueues it, ignoring `desiredSize`. */
function eagerWrapper(stream: ReadableStream<StreamResponseChunk>): ReadableStream<StreamResponseChunk> {
    return new ReadableStream<StreamResponseChunk>({
        async start(controller) {
            const reader = stream.getReader()
            while (true) {
                const { done, value } = await reader.read()
                if (done) {
                    controller.close()
                    return
                }
                controller.enqueue(value)
            }
        },
    })
}

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    resetInFlightForTest()
    invokeMock.mockReset()
    invokeMock.mockImplementation((command: string) => command === 'streamed_fetch'
        ? new Promise<string>(() => {})
        : Promise.resolve(undefined))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    platform.isTauri = true
    vi.restoreAllMocks()
    resetInFlightForTest()
})

describe('D2 native event to snapshot, on the real fetchNative pump and the real OpenAI transform', () => {
    // Diagnostic guard: asserts the promise-only premise; a failure means a macrotask entered the chain.
    test('a pushed native event reaches the consumer before a message posted just before the push', async () => {
        const pending = fetchNative(STREAM_URL, { body: '{}', chatId: 'coalesce-0' })
        for (let i = 0; i < 50 && !invokeMock.mock.calls.some((call) => call[0] === 'streamed_fetch'); i++) {
            await tick()
        }
        const id = (invokeMock.mock.calls.find((call) => call[0] === 'streamed_fetch')![1] as { id: string }).id
        emit(id, { type: 'headers', body: {}, status: 200 })
        const response = await pending
        const transformed = response.body!.pipeThrough(__testOpenAIChatStream.getTranStream({
            usageMeter: createUsageMeter(), modelInfo: { flags: [] }, multiGen: false,
        } as unknown as RequestDataArgumentExtended))
        const arg = { usageMeter: createUsageMeter(), aiModel: 'm', formated: [] }
        const settled = settleUsage(arg, 'model', { type: 'streaming', result: eagerWrapper(transformed) })
        if (settled.type !== 'streaming') {
            throw new Error('settleUsage did not wrap the stream')
        }
        const reader = settled.result.getReader()

        emit(id, { type: 'chunk', body: b64(sseEvent('w1 ')) })
        const first = await reader.read()
        expect(first.value?.['0']).toContain('w1')

        // The reader waits; then, in one synchronous block, a message is posted and a native event is emitted.
        const order: string[] = []
        const arrived = (async () => {
            while (true) {
                const { done, value } = await reader.read()
                if (done) {
                    return
                }
                if (value['0'].includes('w2')) {
                    order.push('C')
                    return
                }
            }
        })()
        await tick()
        const messageSeen = new Promise<void>((resolve) => {
            const channel = new MessageChannel()
            channel.port1.onmessage = () => {
                channel.port1.close()
                order.push('M')
                resolve()
            }
            channel.port2.postMessage(null)
        })
        emit(id, { type: 'chunk', body: b64(sseEvent('w2 ')) })
        await Promise.all([arrived, messageSeen])

        expect(order).toEqual(['C', 'M'])
        expect(unhandled).toEqual([])
    })
})
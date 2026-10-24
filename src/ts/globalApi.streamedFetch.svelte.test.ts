/**
 * `fetchNative` over the native streamed fetch: Stop, timeout and native failure
 * contracts of the pump and the Response stream.
 *
 * Drives the REAL `fetchNative` with the module mocks of
 * `globalApi.inFlight.svelte.test.ts` (copied, not shared: each suite mocks its
 * own graph). The Tauri command and event bridge are mocks, so a passing test
 * says nothing about native behaviour.
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

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))


import { invoke } from '@tauri-apps/api/core'
import { fetchNative, getFetchData } from 'src/ts/globalApi.svelte'
import { resetInFlightForTest } from 'src/ts/process/inFlightWork'

const invokeMock = vi.mocked(invoke)

const STREAM_URL = 'https://api.example.invalid/v1/stream'
const STALL_MS = 400
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 6; i++) { await tick() } }
const within = <T,>(promise: Promise<T>): Promise<T> => Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('stalled')), STALL_MS)),
])
const emit = (id: string, event: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...event }))
const b64 = (text: string) => Buffer.from(text).toString('base64')
const decoder = new TextDecoder()

// requestTimeoutMs both unset and set; the large value never fires within a test.
const TIMEOUT_CASES: [string, number | undefined][] = [['unset', undefined], ['set', 60000]]

let nativeResult: { resolve: (value: string) => void, reject: (reason: unknown) => void } = {
    resolve: () => {}, reject: () => {},
}
let chatSeq = 0

const cancelCalls = () => invokeMock.mock.calls.filter((call) => call[0] === 'cancel_streamed_fetch')

async function begin(options: { signal?: AbortSignal, timeoutMs?: number } = {}) {
    invokeMock.mockClear()
    const chatId = `streamed-${chatSeq++}`
    const outcome = { response: null as Response | null, error: null as string | null }
    const pending = fetchNative(STREAM_URL, {
        body: '{}',
        signal: options.signal,
        requestTimeoutMs: options.timeoutMs,
        chatId,
    }).then(
        (response) => { outcome.response = response; return response },
        (error: unknown) => { outcome.error = error instanceof Error ? error.message : String(error); return null },
    )
    for (let i = 0; i < 50 && !invokeMock.mock.calls.some((call) => call[0] === 'streamed_fetch'); i++) {
        await tick()
    }
    const id = (invokeMock.mock.calls.find((call) => call[0] === 'streamed_fetch')![1] as { id: string }).id
    return { id, pending, outcome, chatId }
}

/** Reads until the stream settles; the error message is returned instead of thrown. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let text = ''
    for (let i = 0; i < 50; i++) {
        try {
            const { done, value } = await within(reader.read())
            if (done) {
                return { text, error: null as string | null }
            }
            text += decoder.decode(value)
        } catch (error) {
            return { text, error: error instanceof Error ? error.message : String(error) }
        }
    }
    throw new Error('stream never settled')
}

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    resetInFlightForTest()
    invokeMock.mockReset()
    // The native command stays pending until the test settles it; cancel answers at once.
    invokeMock.mockImplementation((command: string) => command === 'streamed_fetch'
        ? new Promise<string>((resolve, reject) => { nativeResult = { resolve, reject } })
        : Promise.resolve(undefined))
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
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

describe.each(TIMEOUT_CASES)('fetchNative stop (requestTimeoutMs %s)', (_label, timeoutMs) => {
    test('stop after the headers cancels the native request once and ends the stream quietly', async () => {
        const controller = new AbortController()
        const { id, pending } = await begin({ signal: controller.signal, timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('partial') })
        const response = await within(pending)
        const reader: ReadableStreamDefaultReader<Uint8Array> = response!.body!.getReader()
        expect(decoder.decode((await within(reader.read())).value)).toBe('partial')

        controller.abort()
        await settle()

        expect(cancelCalls()).toEqual([['cancel_streamed_fetch', { id }]])
        expect(await drain(reader)).toEqual({ text: '', error: null })
    })

    test('stop before the headers cancels the native request once and rejects as aborted', async () => {
        const controller = new AbortController()
        const { id, pending, outcome } = await begin({ signal: controller.signal, timeoutMs })

        controller.abort()
        await within(pending)

        expect(outcome.error).toBe('aborted')
        expect(cancelCalls()).toEqual([['cancel_streamed_fetch', { id }]])
    })

    test('stop while the headers event is queued but not yet consumed still ends the request', async () => {
        const controller = new AbortController()
        const { id, pending, outcome, chatId } = await begin({ signal: controller.signal, timeoutMs })

        emit(id, { type: 'headers', body: {}, status: 200 })
        controller.abort()
        await within(pending)
        await settle()

        expect(outcome.error).toBe('aborted')
        expect(cancelCalls()).toEqual([['cancel_streamed_fetch', { id }]])
        // The pump has exited and written the log entry.
        expect(getFetchData(chatId)?.response).toBe('')
        // A late event for the finished request is dropped.
        expect(() => emit(id, { type: 'chunk', body: b64('late') })).not.toThrow()
    })

    test('reader.cancel() cancels the native request once and leaves the stream un-errored', async () => {
        const { id, pending } = await begin({ timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('one') })
        const response = await within(pending)
        const reader: ReadableStreamDefaultReader<Uint8Array> = response!.body!.getReader()
        await within(reader.read())

        await within(reader.cancel())
        emit(id, { type: 'chunk', body: b64('after') })
        await settle()

        expect(cancelCalls()).toEqual([['cancel_streamed_fetch', { id }]])
        expect(await drain(reader)).toEqual({ text: '', error: null })
        // The pump's own close on a stream the consumer already settled is guarded, not logged.
        expect(console.error).not.toHaveBeenCalled()
    })

    test('guard: no cancel is sent after the stream ended and late events are ignored', async () => {
        const controller = new AbortController()
        const { id, pending } = await begin({ signal: controller.signal, timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('done') })
        emit(id, { type: 'end' })
        const response = await within(pending)
        expect(await drain(response!.body!.getReader())).toEqual({ text: 'done', error: null })

        controller.abort()
        emit(id, { type: 'error', body: 'late failure' })
        emit(id, { type: 'end' })
        await settle()

        expect(cancelCalls()).toEqual([])
    })

    test('guard: cancelling a stream that already finished sends no native cancel', async () => {
        const { id, pending } = await begin({ timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('unread') })
        emit(id, { type: 'end' })
        const response = await within(pending)
        await settle()

        await within(response!.body!.cancel())

        expect(cancelCalls()).toEqual([])
    })
})

test('a request timeout before the headers cancels the native request once and reports the timeout', async () => {
    const { id, pending, outcome } = await begin({ timeoutMs: 30 })

    await within(pending)
    await settle()

    expect(outcome.error).toBe('Request timed out')
    expect(cancelCalls()).toEqual([['cancel_streamed_fetch', { id }]])
})

describe.each(TIMEOUT_CASES)('fetchNative native failure (requestTimeoutMs %s)', (_label, timeoutMs) => {
    test('an error event after the headers errors the stream and keeps the earlier chunks', async () => {
        const { id, pending } = await begin({ timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('kept ') })
        emit(id, { type: 'chunk', body: b64('text') })
        emit(id, { type: 'error', body: 'connection reset' })
        const response = await within(pending)

        expect(await drain(response!.body!.getReader())).toEqual({ text: 'kept text', error: 'connection reset' })
        expect(cancelCalls()).toEqual([])
    })

    test('a failed command result after the headers errors the stream after the buffered chunks', async () => {
        const { id, pending } = await begin({ timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('a') })
        emit(id, { type: 'chunk', body: b64('b') })
        nativeResult.resolve(JSON.stringify({ success: false, body: 'reset by peer' }))
        const response = await within(pending)

        expect(await drain(response!.body!.getReader())).toEqual({ text: 'ab', error: 'reset by peer' })
    })

    test('an error event before the headers rejects the call', async () => {
        const { id, pending, outcome } = await begin({ timeoutMs })
        emit(id, { type: 'error', body: 'refused' })

        await within(pending)

        expect(outcome.error).toBe('refused')
    })

    test('a rejected command before the headers rejects the call instead of hanging', async () => {
        const { pending, outcome } = await begin({ timeoutMs })
        nativeResult.reject('ipc unavailable')

        await within(pending)

        expect(outcome.error).toBe('ipc unavailable')
    })

    test('a rejected command after the headers errors the stream instead of hanging', async () => {
        const { id, pending } = await begin({ timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('so far') })
        const response = await within(pending)
        nativeResult.reject(new Error('ipc closed'))

        expect(await drain(response!.body!.getReader())).toEqual({ text: 'so far', error: 'ipc closed' })
    })

    test('guard: a successful command result arriving before the last events does not truncate the reply', async () => {
        const { id, pending } = await begin({ timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        nativeResult.resolve(JSON.stringify({ success: true }))
        const response = await within(pending)
        await settle()
        emit(id, { type: 'chunk', body: b64('late one ') })
        emit(id, { type: 'chunk', body: b64('late two') })
        emit(id, { type: 'end' })

        expect(await drain(response!.body!.getReader())).toEqual({ text: 'late one late two', error: null })
    })

    test('guard: a native stream error raises no unhandled rejection', async () => {
        const { id, pending } = await begin({ timeoutMs })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'error', body: 'connection reset' })
        const response = await within(pending)
        await drain(response!.body!.getReader())
        await settle()

        expect(unhandled).toEqual([])
    })
})

describe('fetchNative stream nobody reads after a native failure', () => {
    test('the request is already finished: log written, queue dropped, no cancel on a later cancel', async () => {
        const { id, pending, chatId } = await begin()
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('unread') })
        emit(id, { type: 'chunk', body: b64(' more') })
        emit(id, { type: 'error', body: 'reset' })
        const response = await within(pending)
        await settle()

        // The pump finished before it waited for the consumer, so only the stream object stays.
        expect(getFetchData(chatId)?.response).toBe('unread more')
        expect(() => emit(id, { type: 'chunk', body: b64('late') })).not.toThrow()
        await within(response!.body!.cancel())
        expect(cancelCalls()).toEqual([])
    })
})

describe('fetchNative fetch log', () => {
    test('guard: the log response equals the body after a normal end', async () => {
        const { id, pending, chatId } = await begin()
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('hello ') })
        emit(id, { type: 'chunk', body: b64('world') })
        emit(id, { type: 'end' })
        const response = await within(pending)
        await drain(response!.body!.getReader())

        expect(getFetchData(chatId)?.response).toBe('hello world')
    })

    test('the log response keeps the received text after a stop', async () => {
        const controller = new AbortController()
        const { id, pending, chatId } = await begin({ signal: controller.signal })
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('cut ') })
        const response = await within(pending)
        const reader: ReadableStreamDefaultReader<Uint8Array> = response!.body!.getReader()
        await within(reader.read())

        controller.abort()
        await drain(reader)

        expect(getFetchData(chatId)?.response).toBe('cut ')
    })

    test('the log response keeps the received text after an error', async () => {
        const { id, pending, chatId } = await begin()
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('before ') })
        emit(id, { type: 'error', body: 'reset' })
        const response = await within(pending)
        await drain(response!.body!.getReader())

        expect(getFetchData(chatId)?.response).toBe('before ')
    })
})

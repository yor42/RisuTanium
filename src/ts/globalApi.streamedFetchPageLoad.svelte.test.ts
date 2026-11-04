/**
 * `fetchNative` at page load: the module-level listener setup finishes
 * `cancel_all_streamed_fetch` before the first native request, and a Stop during
 * that setup sends no native request.
 *
 * The cancel runs when `globalApi.svelte` is evaluated, so every test resets the
 * module registry and imports it again. The Tauri command and event bridge are
 * mocks, so a passing test says nothing about native behaviour.
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

// The bridge outlives vi.resetModules(): the mock factories below delegate to it.
const bridge = vi.hoisted(() => ({
    calls: [] as unknown[][],
    invokeImpl: (_command: string, _args?: unknown): unknown => undefined,
    listenImpl: (): Promise<() => void> => Promise.resolve(() => {}),
    emit: (_payload: string) => {},
}))

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
    convertFileSrc: (p: string) => p,
    invoke: (...args: unknown[]) => {
        bridge.calls.push(args)
        return bridge.invokeImpl(args[0] as string, args[1])
    },
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

vi.mock('@tauri-apps/api/event', () => ({
    listen: (_name: string, callback: (event: { payload: string }) => void) => {
        bridge.emit = (payload: string) => callback({ payload })
        return bridge.listenImpl()
    },
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

const STREAM_URL = 'https://api.example.invalid/v1/stream'
const CANCEL_ALL = 'cancel_all_streamed_fetch'
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 6; i++) { await tick() } }
const b64 = (text: string) => Buffer.from(text).toString('base64')
const emit = (id: string, event: Record<string, unknown>) => bridge.emit(JSON.stringify({ id, ...event }))

function deferred<T>() {
    let resolve: (value: T) => void = () => {}
    let reject: (reason: unknown) => void = () => {}
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

const callsOf = (command: string) => bridge.calls.filter((call) => call[0] === command)

/** Imports a fresh `globalApi.svelte`, so the load-time listener setup runs again. */
async function loadModule() {
    vi.resetModules()
    return await import('src/ts/globalApi.svelte')
}

type FetchNative = Awaited<ReturnType<typeof loadModule>>['fetchNative']

/** Pending native `streamed_fetch` result, settled by `completeRequest`. */
let nativeResult = deferred<string>()

async function waitForCall(command: string, count: number) {
    for (let i = 0; i < 50 && callsOf(command).length < count; i++) {
        await tick()
    }
}

/** Streams one chunk and ends the request the way the native pump does. */
async function completeRequest(pending: ReturnType<FetchNative>) {
    const id = (callsOf('streamed_fetch')[0][1] as { id: string }).id
    emit(id, { type: 'headers', body: {}, status: 200 })
    emit(id, { type: 'chunk', body: b64('hello') })
    emit(id, { type: 'end' })
    nativeResult.resolve('{"success":true}')
    const response = await pending
    return { status: response.status, text: await response.text() }
}

beforeEach(() => {
    bridge.calls = []
    nativeResult = deferred<string>()
    bridge.listenImpl = () => Promise.resolve(() => {})
    bridge.invokeImpl = (command) => command === 'streamed_fetch' ? nativeResult.promise : undefined
    bridge.emit = () => {}
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    platform.isTauri = true
    vi.restoreAllMocks()
})

describe('fetchNative at page load', () => {
    // Reproducer: without the cancel_all wait the first streamed_fetch is sent at once.
    test('the first request waits for cancel_all to finish', async () => {
        const cancel = deferred<undefined>()
        bridge.invokeImpl = (command) => command === CANCEL_ALL
            ? cancel.promise
            : command === 'streamed_fetch' ? nativeResult.promise : undefined
        const { fetchNative } = await loadModule()

        const pending = fetchNative(STREAM_URL, { body: '{}', chatId: 'page-load-j1' })
        await settle()

        expect(callsOf(CANCEL_ALL)).toEqual([[CANCEL_ALL]])
        expect(callsOf('streamed_fetch')).toHaveLength(0)

        cancel.resolve(undefined)
        await waitForCall('streamed_fetch', 1)

        expect(callsOf('streamed_fetch')).toHaveLength(1)
        expect(await completeRequest(pending)).toEqual({ status: 200, text: 'hello' })
    })

    // Guard: passes before and after the change; a failed cancel never blocks requests.
    test('a rejected cancel_all still lets requests start', async () => {
        bridge.invokeImpl = (command) => command === CANCEL_ALL
            ? Promise.reject(new Error('cancel failed'))
            : command === 'streamed_fetch' ? nativeResult.promise : undefined
        const { fetchNative } = await loadModule()

        const pending = fetchNative(STREAM_URL, { body: '{}', chatId: 'page-load-j2' })
        await waitForCall('streamed_fetch', 1)

        expect(callsOf('streamed_fetch')).toHaveLength(1)
        expect(await completeRequest(pending)).toEqual({ status: 200, text: 'hello' })
    })

    // Guard: passes before and after the change; the wrap in the listener setup tolerates a
    // cancel_all that returns no promise or throws synchronously.
    test.each([
        ['returns undefined', () => undefined],
        ['throws synchronously', () => { throw new Error('cancel threw') }],
    ] as [string, () => undefined][])('a cancel_all invoke that %s still lets a request complete', async (_label, cancelBehavior) => {
        bridge.invokeImpl = (command) => command === CANCEL_ALL
            ? cancelBehavior()
            : command === 'streamed_fetch' ? nativeResult.promise : undefined
        const { fetchNative } = await loadModule()

        const pending = fetchNative(STREAM_URL, { body: '{}', chatId: 'page-load-j3' })
        await waitForCall('streamed_fetch', 1)

        expect(callsOf('streamed_fetch')).toHaveLength(1)
        expect(await completeRequest(pending)).toEqual({ status: 200, text: 'hello' })
    })

    // Reproducer: the abort check must follow the listener wait.
    test('a stop during the listener wait sends no request', async () => {
        const listening = deferred<() => void>()
        bridge.listenImpl = () => listening.promise
        const { fetchNative } = await loadModule()
        const controller = new AbortController()

        const pending = fetchNative(STREAM_URL, { body: '{}', signal: controller.signal, chatId: 'page-load-j4a' })
        const outcome = pending.then(() => 'resolved', (error: unknown) => error instanceof Error ? error.message : String(error))
        await settle()
        controller.abort()
        listening.resolve(() => {})

        expect(await outcome).toBe('aborted')
        await settle()
        expect(callsOf('streamed_fetch')).toHaveLength(0)
        expect(callsOf('cancel_streamed_fetch')).toHaveLength(0)
    })

    // New rule: the same holds while cancel_all is still pending.
    test('a stop while cancel_all is pending sends no request', async () => {
        const cancel = deferred<undefined>()
        bridge.invokeImpl = (command) => command === CANCEL_ALL ? cancel.promise : undefined
        const { fetchNative } = await loadModule()
        const controller = new AbortController()

        const pending = fetchNative(STREAM_URL, { body: '{}', signal: controller.signal, chatId: 'page-load-j4b' })
        const outcome = pending.then(() => 'resolved', (error: unknown) => error instanceof Error ? error.message : String(error))
        await settle()
        expect(callsOf(CANCEL_ALL)).toHaveLength(1)
        controller.abort()
        cancel.resolve(undefined)

        expect(await outcome).toBe('aborted')
        await settle()
        expect(callsOf('streamed_fetch')).toHaveLength(0)
        expect(callsOf('cancel_streamed_fetch')).toHaveLength(0)
    })
})

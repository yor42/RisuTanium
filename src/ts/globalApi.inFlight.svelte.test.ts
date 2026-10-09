/**
 * `globalFetch` holds a 'request' in-flight token for the whole transfer, and
 * `fetchNative` stops waiting for response headers when its request is aborted.
 *
 * Drives the REAL `globalFetch` and `fetchNative` with the module mocks of
 * `globalApi.secretRef.svelte.test.ts` (copied, not shared: each suite mocks
 * its own graph). The Tauri HTTP plugin and the Tauri command are mocks, so a
 * passing test says nothing about native behaviour.
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
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { fetchNative, globalFetch } from 'src/ts/globalApi.svelte'
import { sleep } from 'src/ts/util'
import { inFlightKinds, resetInFlightForTest } from 'src/ts/process/inFlightWork'

const tauriFetchMock = vi.mocked(tauriFetch)
const invokeMock = vi.mocked(invoke)

beforeEach(() => {
    resetInFlightForTest()
    tauriFetchMock.mockReset()
    invokeMock.mockReset()
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    platform.isTauri = true
    vi.restoreAllMocks()
    resetInFlightForTest()
})

describe('globalFetch request token', () => {
    test('is held while the transport runs and ended when the result is returned', async () => {
        let during: string[] = []
        tauriFetchMock.mockImplementation(async () => {
            during = inFlightKinds()
            return new Response(JSON.stringify({ ok: true }), { status: 200 })
        })

        const result = await globalFetch('https://api.example.invalid/v1/chat', { body: {} })

        expect(result.ok).toBe(true)
        expect(during).toEqual(['request'])
        expect(inFlightKinds()).toEqual([])
    })

    test('is ended when the transport throws', async () => {
        tauriFetchMock.mockRejectedValue(new Error('network down'))

        const result = await globalFetch('https://api.example.invalid/v1/chat', { body: {} })

        expect(result.ok).toBe(false)
        expect(inFlightKinds()).toEqual([])
    })

    test('is ended when the body read fails after the response arrived', async () => {
        tauriFetchMock.mockResolvedValue({
            status: 200,
            headers: new Headers(),
            json: async () => { throw new Error('body cut off') },
            text: async () => { throw new Error('body cut off') },
            arrayBuffer: async () => { throw new Error('body cut off') },
        } as unknown as Response)

        const result = await globalFetch('https://api.example.invalid/v1/chat', { body: {} })

        expect(result.ok).toBe(false)
        expect(inFlightKinds()).toEqual([])
    })

    test('is ended when the request is refused before any transport', async () => {
        const controller = new AbortController()
        controller.abort()

        const result = await globalFetch('https://api.example.invalid/v1/chat', { body: {}, abortSignal: controller.signal })

        expect(result.ok).toBe(false)
        expect(tauriFetchMock).not.toHaveBeenCalled()
        expect(inFlightKinds()).toEqual([])
    })

    test('is ended when the request is refused for carrying a secret reference', async () => {
        const result = await globalFetch('https://api.example.invalid/v1/chat', {
            body: {},
            headers: { Authorization: 'Bearer ${RISU_X_KEY}' },
        })

        expect(result.ok).toBe(false)
        expect(inFlightKinds()).toEqual([])
    })
})

describe('fetchNative before the first byte', () => {
    test('an abort while the headers are awaited rejects as aborted', async () => {
        invokeMock.mockImplementation(() => new Promise(() => {}))
        const controller = new AbortController()

        const pending = fetchNative('https://api.example.invalid/v1/stream', { body: '{}', signal: controller.signal })
        const outcome = pending.then(() => 'resolved', (error: unknown) => (error instanceof Error ? error.message : String(error)))
        await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('streamed_fetch', expect.anything()))
        controller.abort()

        expect(await outcome).toBe('aborted')
        // Lets the stream pump, which keeps reading until the native side ends, finish.
        const id = (invokeMock.mock.calls[0][1] as { id: string }).id
        streamEvents.emit(JSON.stringify({ id, type: 'end' }))
    })

    test('guard: headers that arrive before an abort still return the response', async () => {
        invokeMock.mockImplementation(async () => JSON.stringify({ success: true }))
        const controller = new AbortController()

        const pending = fetchNative('https://api.example.invalid/v1/stream', { body: '{}', signal: controller.signal })
        await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('streamed_fetch', expect.anything()))
        const id = (invokeMock.mock.calls[0][1] as { id: string }).id
        streamEvents.emit(JSON.stringify({ id, type: 'headers', body: {}, status: 200 }))

        const response = await pending
        expect(response.status).toBe(200)

        controller.abort()
        streamEvents.emit(JSON.stringify({ id, type: 'end' }))
    })
})

describe('fetchNative stream pump while timers do not run', () => {
    // A hidden page throttles timers, so the pump and the header wait must be
    // driven by native events alone: every `sleep` here never resolves.
    const STALL_MS = 300
    const STREAM_URL = 'https://api.example.invalid/v1/stream'
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    const within = <T,>(promise: Promise<T>): Promise<T> => Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('stalled')), STALL_MS)),
    ])
    const emit = (id: string, event: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...event }))
    const b64 = (text: string) => Buffer.from(text).toString('base64')

    async function begin(signal?: AbortSignal) {
        invokeMock.mockClear()
        const outcome = { response: null as Response | null, error: null as string | null }
        const pending = fetchNative(STREAM_URL, { body: '{}', signal }).then(
            (response) => { outcome.response = response; return response },
            (error: unknown) => { outcome.error = error instanceof Error ? error.message : String(error); return null },
        )
        for (let i = 0; i < 50 && invokeMock.mock.calls.length === 0; i++) {
            await tick()
        }
        const id = (invokeMock.mock.calls[0][1] as { id: string }).id
        return { id, pending, outcome }
    }

    beforeEach(() => {
        vi.mocked(sleep).mockImplementation(() => new Promise<void>(() => {}))
    })

    afterEach(() => {
        vi.mocked(sleep).mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 1)))
    })

    test('headers, chunks and end reach the reader in order', async () => {
        invokeMock.mockImplementation(async () => JSON.stringify({ success: true }))
        const { id, pending } = await begin()

        emit(id, { type: 'headers', body: { 'x-test': '1' }, status: 201 })
        emit(id, { type: 'chunk', body: b64('one ') })
        emit(id, { type: 'chunk', body: b64('two ') })
        emit(id, { type: 'chunk', body: b64('three') })
        emit(id, { type: 'end' })

        const response = await within(pending)
        expect(response?.status).toBe(201)
        expect(response?.headers.get('x-test')).toBe('1')
        expect(await within(response!.text())).toBe('one two three')
    })

    test('a chunk pushed at any point of the drain is not lost', async () => {
        invokeMock.mockImplementation(async () => JSON.stringify({ success: true }))
        for (let gap = 0; gap < 6; gap++) {
            const { id, pending } = await begin()
            emit(id, { type: 'headers', body: {}, status: 200 })
            emit(id, { type: 'chunk', body: b64('a') })
            for (let i = 0; i < gap; i++) {
                await Promise.resolve()
            }
            emit(id, { type: 'chunk', body: b64('b') })
            for (let i = 0; i < gap; i++) {
                await Promise.resolve()
            }
            emit(id, { type: 'end' })

            const response = await within(pending)
            expect(await within(response!.text())).toBe('ab')
        }
    })

    test('a chunk pushed while the pump is idle wakes it', async () => {
        invokeMock.mockImplementation(async () => JSON.stringify({ success: true }))
        const { id, pending } = await begin()
        emit(id, { type: 'headers', body: {}, status: 200 })
        const response = await within(pending)
        const reader: ReadableStreamDefaultReader<Uint8Array> = response!.body!.getReader()
        await tick()

        emit(id, { type: 'chunk', body: b64('late') })
        const first = await within(reader.read())
        expect(new TextDecoder().decode(first.value)).toBe('late')

        emit(id, { type: 'end' })
        expect((await within(reader.read())).done).toBe(true)
    })

    test('an end before any headers still resolves with the empty header default', async () => {
        invokeMock.mockImplementation(async () => JSON.stringify({ success: true }))
        const { id, pending } = await begin()

        emit(id, { type: 'end' })

        const response = await within(pending)
        expect(response?.status).toBe(400)
        expect([...response!.headers.keys()]).toEqual([])
    })

    test('a command failure before the headers rejects with its message', async () => {
        invokeMock.mockImplementation(async () => JSON.stringify({ success: false, body: 'connection refused' }))
        const { pending, outcome } = await begin()

        await within(pending)

        expect(outcome.error).toBe('connection refused')
    })

    test('an unparsable command result before the headers rejects with the parse failure', async () => {
        invokeMock.mockImplementation(async () => 'not json')
        const { pending, outcome } = await begin()

        await within(pending)

        expect(outcome.error).toBeTruthy()
        expect(outcome.response).toBeNull()
    })

    test('a command failure after the headers ends the stream', async () => {
        let finish: (value: string) => void = () => {}
        invokeMock.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve }))
        const { id, pending } = await begin()
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'chunk', body: b64('partial') })
        const response = await within(pending)

        finish(JSON.stringify({ success: false, body: 'reset' }))

        expect(await within(response!.text())).toBe('partial')
    })

    test('an abort before the headers rejects as aborted', async () => {
        invokeMock.mockImplementation(() => new Promise(() => {}))
        const controller = new AbortController()
        const { pending, outcome } = await begin(controller.signal)

        controller.abort()
        await within(pending)

        expect(outcome.error).toBe('aborted')
    })

    test('an event for a stream that already closed is ignored', async () => {
        invokeMock.mockImplementation(async () => JSON.stringify({ success: true }))
        const { id, pending } = await begin()
        emit(id, { type: 'headers', body: {}, status: 200 })
        emit(id, { type: 'end' })
        const response = await within(pending)
        await within(response!.text())
        const errors = vi.mocked(console.error).mock.calls.length

        expect(() => emit(id, { type: 'chunk', body: b64('stray') })).not.toThrow()
        expect(vi.mocked(console.error).mock.calls.length).toBe(errors)
    })
})

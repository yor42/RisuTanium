/**
 * The untrusted native route of `globalFetch` and `fetchNative` on Tauri: a request that carries the
 * internal native policy always reaches `streamed_fetch` with it, whatever the options bag, the
 * userscript hook, the plain-fetch setting or the network route say; an app request carries none.
 *
 * Drives the REAL `globalFetch` and `fetchNative` with the module mocks of
 * `globalApi.streamedFetch.svelte.test.ts` (copied, not shared: each suite mocks its own graph). The
 * Tauri command and event bridge are mocks, so a passing test says nothing about native behaviour.
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
import { fetch as TauriHTTPFetch } from '@tauri-apps/plugin-http'
import { fetchNative, globalFetch } from 'src/ts/globalApi.svelte'
import { resetInFlightForTest } from 'src/ts/process/inFlightWork'

const invokeMock = vi.mocked(invoke)
const httpMock = vi.mocked(TauriHTTPFetch)

const URL_PUBLIC = 'https://api.example.invalid/v1/x'
const POLICY_OFF = { nativePolicy: { allowPrivate: false } }
const POLICY_ON = { nativePolicy: { allowPrivate: true } }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const b64 = (text: string) => Buffer.from(text).toString('base64')
const emit = (id: string, event: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...event }))

type StreamedArgs = { id: string, url: string, headers: string, method: string, policy?: unknown }
let nativeResult: { resolve: (value: string) => void, reject: (reason: unknown) => void } = {
    resolve: () => {}, reject: () => {},
}

async function nativeCall(): Promise<StreamedArgs> {
    for (let i = 0; i < 50 && !invokeMock.mock.calls.some((call) => call[0] === 'streamed_fetch'); i++) {
        await tick()
    }
    const found = invokeMock.mock.calls.find((call) => call[0] === 'streamed_fetch')
    if (!found) {
        throw new Error('the request never reached streamed_fetch')
    }
    return found[1] as StreamedArgs
}

/** Answers the pending streamed_fetch with a complete reply. */
async function reply(status: number, body: string) {
    const call = await nativeCall()
    emit(call.id, { type: 'headers', body: { 'content-type': 'application/json' }, status })
    emit(call.id, { type: 'chunk', body: b64(body) })
    emit(call.id, { type: 'end' })
    return call
}

beforeEach(() => {
    resetInFlightForTest()
    invokeMock.mockReset()
    httpMock.mockReset()
    invokeMock.mockImplementation((command: string) => command === 'streamed_fetch'
        ? new Promise<string>((resolve, reject) => { nativeResult = { resolve, reject } })
        : Promise.resolve(undefined))
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
    platform.isTauri = true
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
    platform.isTauri = true
    vi.restoreAllMocks()
    resetInFlightForTest()
})

describe('untrusted globalFetch on Tauri', () => {
    test('T2 a JSON reply comes back as a GlobalFetchResult over streamed_fetch with the policy, never the HTTP plugin', async () => {
        const pending = globalFetch(URL_PUBLIC, { body: { a: 1 } }, POLICY_OFF)
        const call = await reply(200, '{"ok":true}')
        const result = await pending

        expect(call.policy).toEqual({ allowPrivate: false })
        expect(httpMock).not.toHaveBeenCalled()
        expect(result.ok).toBe(true)
        expect(result.status).toBe(200)
        expect(result.data).toEqual({ ok: true })
        expect(result.headers).toBeTypeOf('object')
    })

    test('T2 rawResponse returns the bytes', async () => {
        const pending = globalFetch(URL_PUBLIC, { body: {}, rawResponse: true }, POLICY_OFF)
        await reply(200, 'raw-bytes')
        const result = await pending

        expect(result.ok).toBe(true)
        expect(result.data).toBeInstanceOf(Uint8Array)
        expect(new TextDecoder().decode(result.data)).toBe('raw-bytes')
    })

    test.each([
        ['plainFetchForce', { plainFetchForce: true }, URL_PUBLIC],
        ['the local-network route', { networkRoute: 'local_network' as const }, 'http://192.168.1.10/v1/x'],
    ])('T2 %s does not take the request off streamed_fetch', async (_label, options, url) => {
        const plain = vi.fn(async () => new Response('{}'))
        vi.stubGlobal('fetch', plain)
        try {
            const pending = globalFetch(url, { body: {}, ...options }, POLICY_OFF)
            const call = await reply(200, '{}')
            await pending

            expect(call.policy).toEqual({ allowPrivate: false })
            expect(call.url).toBe(url)
            expect(httpMock).not.toHaveBeenCalled()
            expect(plain).not.toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    test('E1 an untrusted request with window.userScriptFetch defined still reaches streamed_fetch with the policy', async () => {
        const userScriptFetch = vi.fn(async () => new Response('{}'))
        ;(window as { userScriptFetch?: unknown }).userScriptFetch = userScriptFetch

        const pending = globalFetch(URL_PUBLIC, { body: {} }, POLICY_ON)
        const call = await reply(200, '{}')
        await pending

        expect(call.policy).toEqual({ allowPrivate: true })
        expect(userScriptFetch).not.toHaveBeenCalled()
        expect(httpMock).not.toHaveBeenCalled()
    })

    test('a native refusal comes back as a failed result carrying the marker', async () => {
        const pending = globalFetch('https://192.168.1.10/', { body: {} }, POLICY_OFF)
        await nativeCall()
        nativeResult.resolve(JSON.stringify({ success: false, body: 'NATIVE_DESTINATION_BLOCKED (private): 192.168.1.10' }))
        const result = await pending

        expect(result.ok).toBe(false)
        expect(String(result.data)).toContain('NATIVE_DESTINATION_BLOCKED')
    })
})

describe('untrusted fetchNative on Tauri', () => {
    test('E1 window.userScriptFetch is not used and the policy is sent', async () => {
        const userScriptFetch = vi.fn(async () => new Response('{}'))
        ;(window as { userScriptFetch?: unknown }).userScriptFetch = userScriptFetch

        const pending = fetchNative(URL_PUBLIC, { body: '{}' }, POLICY_OFF)
        const call = await reply(200, '{}')
        await pending

        expect(call.policy).toEqual({ allowPrivate: false })
        expect(userScriptFetch).not.toHaveBeenCalled()
    })

    test('the toggle on is sent as allowPrivate true', async () => {
        const pending = fetchNative(URL_PUBLIC, { body: '{}' }, POLICY_ON)
        const call = await reply(200, '{}')
        await pending
        expect(call.policy).toEqual({ allowPrivate: true })
    })

    test('T4 guard: an app request sends no policy, and keeps the userscript hook', async () => {
        const pending = fetchNative(URL_PUBLIC, { body: '{}' })
        const call = await reply(200, '{}')
        await pending
        expect(call.policy).toBeNull()

        invokeMock.mockClear()
        const userScriptFetch = vi.fn(async () => new Response('{}'))
        ;(window as { userScriptFetch?: unknown }).userScriptFetch = userScriptFetch
        await fetchNative(URL_PUBLIC, { body: '{}' })
        expect(userScriptFetch).toHaveBeenCalledTimes(1)
        expect(invokeMock.mock.calls.some((c) => c[0] === 'streamed_fetch')).toBe(false)
    })

    test('guard: an options-bag policy is not read', async () => {
        const arg = { body: '{}', policy: { allowPrivate: true }, nativePolicy: { allowPrivate: true } } as unknown as Parameters<typeof fetchNative>[1]
        const pending = fetchNative(URL_PUBLIC, arg)
        const call = await reply(200, '{}')
        await pending
        expect(call.policy).toBeNull()
    })
})

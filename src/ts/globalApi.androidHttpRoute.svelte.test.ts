/**
 * The route `globalFetch` takes for an `http:` request on Android: the WebView fetch (the plain route) is refused by the
 * release build's cleartext policy, so an Android http request never takes it, whatever Force Plain Fetch says. Everything
 * else keeps its route: https on Android, every protocol on desktop and the web, and the deforce, local-network and
 * untrusted routes.
 *
 * Drives the REAL `globalFetch` with the module mocks of `globalApi.untrustedNative.svelte.test.ts` (copied, not shared:
 * each suite mocks its own graph) and a box for the operating-system plugin. The WebView fetch, the HTTP plugin and the
 * Tauri command bridge are recording fakes, so a pass proves the page-side choice of route only, never native behaviour.
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
const box = vi.hoisted(() => ({
    /** what the operating-system plugin answers; 'throw' models a page without the plugin */
    os: 'android',
    db: {} as Record<string, unknown>,
}))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (box.os === 'throw') {
            throw new Error('no operating-system plugin')
        }
        return box.os
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platform.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => box.db),
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
import { globalFetch } from 'src/ts/globalApi.svelte'
import { resetInFlightForTest } from 'src/ts/process/inFlightWork'

const invokeMock = vi.mocked(invoke)
const httpMock = vi.mocked(TauriHTTPFetch)

const URL_HTTP = 'http://127.0.0.1:5001/v1/chat'
const URL_HTTP_UPPER = 'HTTP://127.0.0.1:5001/v1/chat'
// A host the web build does not refuse as local, so the plain route is reachable without the Tauri shell.
const URL_HTTP_PUBLIC = 'http://api.example.invalid/v1/chat'
const URL_HTTPS ='https://api.example.invalid/v1/chat'
const URL_LAN = 'http://192.168.1.10:5001/v1/chat'
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const b64 = (text: string) => Buffer.from(text).toString('base64')
const emit = (id: string, event: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...event }))

const jsonReply = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })

let plain: ReturnType<typeof vi.fn>

type StreamedArgs = { id: string, url: string, headers: string, method: string, policy?: unknown }

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

async function replyStreamed(body: string) {
    const call = await nativeCall()
    emit(call.id, { type: 'headers', body: { 'content-type': 'application/json' }, status: 200 })
    emit(call.id, { type: 'chunk', body: b64(body) })
    emit(call.id, { type: 'end' })
    return call
}

beforeEach(() => {
    resetInFlightForTest()
    invokeMock.mockReset()
    httpMock.mockReset()
    invokeMock.mockImplementation((command: string) => command === 'streamed_fetch'
        ? new Promise<string>(() => {})
        : Promise.resolve(undefined))
    httpMock.mockImplementation(async () => jsonReply())
    plain = vi.fn(async () => jsonReply())
    vi.stubGlobal('fetch', plain)
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
    platform.isTauri = true
    box.os = 'android'
    box.db = {}
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
    platform.isTauri = true
    box.os = 'android'
    box.db = {}
    vi.restoreAllMocks()
    resetInFlightForTest()
})

describe('an http request on Android never takes the plain route', () => {
    test.each([
        ['R1 Force Plain Fetch on', URL_HTTP],
        ['R1 an upper-case scheme', URL_HTTP_UPPER],
    ])('%s goes through the HTTP plugin and the reply comes back', async (_label, url) => {
        box.db = { usePlainFetch: true }

        const result = await globalFetch(url, { body: { a: 1 } })

        expect(plain).not.toHaveBeenCalled()
        expect(httpMock).toHaveBeenCalledTimes(1)
        expect(result.ok).toBe(true)
        expect(result.data).toEqual({ ok: true })
    })

    test('R2 plainFetchForce on one request with the setting off goes through the HTTP plugin', async () => {
        box.db = {}

        const result = await globalFetch(URL_HTTP, { body: { a: 1 }, plainFetchForce: true })

        expect(plain).not.toHaveBeenCalled()
        expect(httpMock).toHaveBeenCalledTimes(1)
        expect(result.ok).toBe(true)
    })

    test('R3 a request that delivers while frozen goes over streamed_fetch', async () => {
        box.db = { usePlainFetch: true }

        const pending = globalFetch(URL_HTTP, { body: { a: 1 }, deliverWhileFrozen: true })
        const call = await replyStreamed('{"ok":true}')
        const result = await pending

        expect(call.url).toBe(URL_HTTP)
        expect(plain).not.toHaveBeenCalled()
        expect(httpMock).not.toHaveBeenCalled()
        expect(result.ok).toBe(true)
    })

    test('R6 a page that defines window.userScriptFetch sends the request to it, not to the plain fetch', async () => {
        box.db = { usePlainFetch: true }
        const userScriptFetch = vi.fn(async () => jsonReply())
        ;(window as { userScriptFetch?: unknown }).userScriptFetch = userScriptFetch

        const result = await globalFetch(URL_HTTP, { body: { a: 1 } })

        expect(plain).not.toHaveBeenCalled()
        expect(userScriptFetch).toHaveBeenCalledTimes(1)
        expect(result.ok).toBe(true)
    })
})

describe('every other request keeps its route', () => {
    test('G1 https on Android with Force Plain Fetch on takes the plain route', async () => {
        box.db = { usePlainFetch: true }

        const result = await globalFetch(URL_HTTPS, { body: { a: 1 } })

        expect(plain).toHaveBeenCalledTimes(1)
        expect(httpMock).not.toHaveBeenCalled()
        expect(result.ok).toBe(true)
    })

    test.each([
        ['desktop', 'windows'],
        ['a page without the operating-system plugin', 'throw'],
    ])('G2 http on %s with Force Plain Fetch on takes the plain route', async (_label, os) => {
        box.os = os
        box.db = { usePlainFetch: true }
        platform.isTauri = os !== 'throw'

        const result = await globalFetch(URL_HTTP_PUBLIC, { body: { a: 1 } })

        expect(plain).toHaveBeenCalledTimes(1)
        expect(httpMock).not.toHaveBeenCalled()
        expect(result.ok).toBe(true)
    })

    test('G3 http on Android with the setting off goes through the HTTP plugin', async () => {
        box.db = {}

        await globalFetch(URL_HTTP, { body: { a: 1 } })

        expect(plain).not.toHaveBeenCalled()
        expect(httpMock).toHaveBeenCalledTimes(1)
    })

    test('G3 plainFetchDeforce keeps the setting off the plain route', async () => {
        box.db = { usePlainFetch: true }

        await globalFetch(URL_HTTP, { body: { a: 1 }, plainFetchDeforce: true })

        expect(plain).not.toHaveBeenCalled()
        expect(httpMock).toHaveBeenCalledTimes(1)
    })

    test('G3 the local-network route goes through the HTTP plugin with the setting on', async () => {
        box.db = { usePlainFetch: true }

        await globalFetch(URL_LAN, { body: { a: 1 }, networkRoute: 'local_network' })

        expect(plain).not.toHaveBeenCalled()
        expect(httpMock).toHaveBeenCalledTimes(1)
    })
})

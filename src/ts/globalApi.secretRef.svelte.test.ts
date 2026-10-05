/**
 * `globalFetch` and `fetchNative` are reachable from plugins, so they never
 * substitute an environment-variable reference and refuse to send one; and
 * the in-app fetch log never stores a value resolved this session.
 *
 * This file drives the REAL `globalFetch`, `fetchNative`, `getFetchLogs` and
 * the REAL secret module (`src/ts/secretRef`). The other modules
 * `globalApi.svelte.ts` imports are mocked, following
 * `globalApi.openURL.svelte.test.ts`. The Tauri HTTP plugin, the Tauri
 * command, `window.userScriptFetch` and the global `fetch` are mocks, so a
 * passing test says nothing about native behaviour.
 *
 * Tests whose title starts with `guard:` pass with or without the change and
 * pin behaviour that must be preserved.
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
import { fetchNative, getFetchLogs, globalFetch } from 'src/ts/globalApi.svelte'
import { SecretRefError, resetSecretRefState, resolveSecret } from 'src/ts/secretRef'

const KEY_VALUE = 'sk-live-0123456789abcdef'
const tauriFetchMock = vi.mocked(tauriFetch)
const invokeMock = vi.mocked(invoke)
const userScriptFetch = vi.fn(async () => new Response('plain', { status: 200 }))
const plainFetch = vi.fn(async () => new Response('{}', { status: 200 }))
const inRequestMessage = new SecretRefError('RISU_X_KEY', 'inRequest').message

beforeEach(() => {
    resetSecretRefState()
    getFetchLogs().length = 0
    tauriFetchMock.mockReset()
    tauriFetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    invokeMock.mockReset()
    userScriptFetch.mockClear()
    plainFetch.mockClear()
    vi.stubGlobal('fetch', plainFetch)
    window.userScriptFetch = userScriptFetch as unknown as typeof window.userScriptFetch
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    platform.isTauri = true
    vi.unstubAllGlobals()
    delete (window as { userScriptFetch?: unknown }).userScriptFetch
    vi.restoreAllMocks()
})

async function resolveKey() {
    invokeMock.mockResolvedValue(KEY_VALUE)
    expect(await resolveSecret('${RISU_X_KEY}')).toBe(KEY_VALUE)
}

/** Every transport a request can leave through: the Tauri HTTP plugin, the userscript fetch, the global fetch and the Tauri command. */
function expectNoTransportCalled() {
    expect(tauriFetchMock).not.toHaveBeenCalled()
    expect(userScriptFetch).not.toHaveBeenCalled()
    expect(plainFetch).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
}

/** Everything every transport mock received, as one searchable string. */
function receivedByTransports() {
    return JSON.stringify([tauriFetchMock.mock.calls, userScriptFetch.mock.calls, plainFetch.mock.calls, invokeMock.mock.calls])
}

describe('globalFetch tripwire', () => {
    test('a reference header returns { ok: false } with the in-request error and sends nothing', async () => {
        const result = await globalFetch('https://api.example.invalid/v1/chat', {
            body: {},
            headers: { Authorization: 'Bearer ${RISU_X_KEY}' },
        })
        expect(result.ok).toBe(false)
        expect(String(result.data)).toContain(inRequestMessage)
        expectNoTransportCalled()
    })

    test('a whole-reference header without a scheme prefix trips', async () => {
        const result = await globalFetch('https://api.example.invalid/v1/chat', {
            body: {},
            headers: { 'x-api-key': '${RISU_X_KEY}' },
        })
        expect(result.ok).toBe(false)
        expect(String(result.data)).toContain(inRequestMessage)
        expectNoTransportCalled()
    })

    test('a reference in a URL query value trips', async () => {
        const result = await globalFetch('https://api.example.invalid/v1/models?key=${RISU_X_KEY}', { body: {} })
        expect(result.ok).toBe(false)
        expect(String(result.data)).toContain(inRequestMessage)
        expectNoTransportCalled()
    })

    test('guard: a plain key is sent unchanged', async () => {
        delete (window as { userScriptFetch?: unknown }).userScriptFetch
        const result = await globalFetch('https://api.example.invalid/v1/chat', {
            body: { a: 1 },
            headers: { Authorization: 'Bearer sk-plain-key' },
        })
        expect(result.ok).toBe(true)
        expect(tauriFetchMock).toHaveBeenCalledTimes(1)
        const init = tauriFetchMock.mock.calls[0][1] as { headers: Record<string, string> }
        expect(init.headers.Authorization).toBe('Bearer sk-plain-key')
    })

    test('it does not substitute a warm-cache reference into any transport', async () => {
        await resolveKey()
        invokeMock.mockReset()
        const result = await globalFetch('https://api.example.invalid/v1/chat', {
            body: {},
            headers: { Authorization: 'Bearer ${RISU_X_KEY}' },
        })
        expect(result.ok).toBe(false)
        expect(String(result.data)).toContain(inRequestMessage)
        expect(receivedByTransports()).not.toContain(KEY_VALUE)
        expectNoTransportCalled()
    })
})

describe('fetchNative tripwire', () => {
    test('a reference header throws before any network call', async () => {
        await expect(fetchNative('https://api.example.invalid/v1/chat', {
            body: '{}',
            headers: { Authorization: 'Bearer ${RISU_X_KEY}' },
        })).rejects.toThrow(inRequestMessage)
        expectNoTransportCalled()
        expect(getFetchLogs()).toHaveLength(0)
    })

    test('a reference in a URL query value throws', async () => {
        await expect(fetchNative('https://api.example.invalid/v1/stream?key=${RISU_X_KEY}', { body: '{}' })).rejects.toThrow(inRequestMessage)
        expectNoTransportCalled()
    })

    test('it does not substitute a warm-cache reference into any transport', async () => {
        await resolveKey()
        invokeMock.mockReset()
        await expect(fetchNative('https://api.example.invalid/v1/chat', {
            body: '{}',
            headers: { Authorization: 'Bearer ${RISU_X_KEY}' },
        })).rejects.toThrow(inRequestMessage)
        expect(receivedByTransports()).not.toContain(KEY_VALUE)
        expectNoTransportCalled()
    })

    test('guard: a plain key reaches the transport unchanged', async () => {
        const response = await fetchNative('https://api.example.invalid/v1/chat', {
            body: '{}',
            headers: { Authorization: 'Bearer sk-plain-key' },
        })
        expect(await response.text()).toBe('plain')
        expect(userScriptFetch).toHaveBeenCalledTimes(1)
        const init = (userScriptFetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1]
        expect(init.headers.Authorization).toBe('Bearer sk-plain-key')
    })
})

describe('fetch log redaction', () => {
    test('globalFetch success and failure entries store the reference, not the resolved value', async () => {
        await resolveKey()
        delete (window as { userScriptFetch?: unknown }).userScriptFetch

        tauriFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ echo: KEY_VALUE }), { status: 200 }))
        await globalFetch(`https://api.example.invalid/v1/chat?k=${KEY_VALUE}`, {
            body: { prompt: 'hello' },
            headers: { Authorization: `Bearer ${KEY_VALUE}`, 'x-json': JSON.stringify({ key: KEY_VALUE }) },
        })
        tauriFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: `Incorrect API key ${KEY_VALUE}` }), { status: 401 }))
        await globalFetch('https://api.example.invalid/v1/chat', {
            body: { prompt: KEY_VALUE },
            headers: { Authorization: `Bearer ${KEY_VALUE}` },
        })

        const logs = getFetchLogs()
        expect(logs).toHaveLength(2)
        for (const log of logs) {
            expect(JSON.stringify(log)).not.toContain(KEY_VALUE)
            expect(JSON.stringify(log)).toContain('${RISU_X_KEY}')
        }
    })

    test('fetchNative stores the request headers, body and URL with the reference, not the value', async () => {
        await resolveKey()
        const response = await fetchNative(`https://api.example.invalid/v1/stream?k=${KEY_VALUE}`, {
            body: JSON.stringify({ prompt: 'hello', key: KEY_VALUE }),
            headers: { Authorization: `Bearer ${KEY_VALUE}` },
        })
        await response.text()
        const logs = getFetchLogs()
        expect(logs).toHaveLength(1)
        expect(JSON.stringify(logs[0])).not.toContain(KEY_VALUE)
        expect(logs[0].header).toContain('${RISU_X_KEY}')
        expect(logs[0].body).toContain('${RISU_X_KEY}')
        expect(logs[0].url).toContain('${RISU_X_KEY}')
    })

    test('guard: with nothing resolved, log text is stored as written', async () => {
        delete (window as { userScriptFetch?: unknown }).userScriptFetch
        await globalFetch('https://api.example.invalid/v1/chat', { body: { a: 'sk-plain-key' }, headers: { Authorization: 'Bearer sk-plain-key' } })
        const [log] = getFetchLogs()
        expect(log.header).toContain('Bearer sk-plain-key')
        expect(log.body).toContain('sk-plain-key')
    })
})

describe('fetch log redaction on other paths', () => {
    test('a streamed Tauri response that echoes a resolved value is stored redacted', async () => {
        await resolveKey()
        delete (window as { userScriptFetch?: unknown }).userScriptFetch
        vi.mocked(invoke).mockImplementation(async (command: string) => (
            command === 'streamed_fetch' ? JSON.stringify({ success: true }) : KEY_VALUE
        ))
        vi.mocked(invoke).mockClear()

        const pending = fetchNative('https://api.example.invalid/v1/stream', {
            body: '{}',
            headers: { Authorization: `Bearer ${KEY_VALUE}` },
        })
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('streamed_fetch', expect.anything()))
        const id = (vi.mocked(invoke).mock.calls[0][1] as { id: string }).id
        const send = (frame: Record<string, unknown>) => streamEvents.emit(JSON.stringify({ id, ...frame }))
        send({ type: 'headers', body: {}, status: 401 })
        send({ type: 'chunk', body: Buffer.from(`Incorrect API key provided: ${KEY_VALUE}`).toString('base64') })
        send({ type: 'end' })

        const response = await pending
        expect(await response.text()).toContain(KEY_VALUE)
        await vi.waitFor(() => expect(getFetchLogs()[0].response).toContain('Incorrect API key'))
        const [log] = getFetchLogs()
        expect(log.response).not.toContain(KEY_VALUE)
        expect(log.response).toContain('${RISU_X_KEY}')
        expect(JSON.stringify(log)).not.toContain(KEY_VALUE)
    })

    test('fetchNative on a non-Tauri transport stores the request redacted', async () => {
        await resolveKey()
        platform.isTauri = false
        delete (window as { userScriptFetch?: unknown }).userScriptFetch
        const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)

        const response = await fetchNative('https://api.example.invalid/v1/stream', {
            body: JSON.stringify({ key: KEY_VALUE }),
            headers: { Authorization: `Bearer ${KEY_VALUE}` },
        })
        await response.text()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [log] = getFetchLogs()
        expect(JSON.stringify(log)).not.toContain(KEY_VALUE)
        expect(log.header).toContain('${RISU_X_KEY}')
        expect(log.body).toContain('${RISU_X_KEY}')
    })

    test('the fallback entry of the global fetch log, written when the response cannot be serialised, is redacted', async () => {
        await resolveKey()
        delete (window as { userScriptFetch?: unknown }).userScriptFetch
        const circular: Record<string, unknown> = {}
        circular.self = circular
        circular.toString = () => `unserialisable ${KEY_VALUE}`
        tauriFetchMock.mockResolvedValueOnce({
            status: 200,
            headers: new Headers(),
            json: async () => circular,
        } as unknown as Response)

        const result = await globalFetch('https://api.example.invalid/v1/chat', { body: {}, headers: { Authorization: `Bearer ${KEY_VALUE}` } })
        expect(result.ok).toBe(true)
        const [log] = getFetchLogs()
        expect(log.response).toContain('unserialisable')
        expect(JSON.stringify(log)).not.toContain(KEY_VALUE)
        expect(log.response).toContain('${RISU_X_KEY}')
    })
})

/**
 * A streamed request's finished text lands in its own request-log entry, even when
 * other requests are logged while the stream runs, and the log never holds more
 * than 20 entries.
 *
 * Drives the REAL `addFetchLog`, `pipeFetchLog` and `getFetchLogs`. The other modules
 * `globalApi.svelte.ts` imports are mocked, copied from
 * `globalApi.requestLogRedact.svelte.test.ts` (each suite mocks its own graph).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
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

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
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

import { addFetchLog, getFetchLogs, pipeFetchLog } from 'src/ts/globalApi.svelte'

function log(url: string, response = 'Streamed Fetch') {
    return addFetchLog({ body: '{}', headers: {}, response, success: true, url, resType: 'stream' })
}

function controlledStream() {
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    return {
        stream,
        finish: (text: string) => {
            controller.enqueue(encoder.encode(text))
            controller.close()
        },
    }
}

beforeEach(() => {
    getFetchLogs().length = 0
})

describe('request log streamed entry', () => {
    test('F1 the streamed text lands in the stream\'s own entry when another request is logged mid-stream', async () => {
        const started = log('https://api.example.invalid/v1/stream')
        const { stream, finish } = controlledStream()
        const piped = pipeFetchLog(started, stream)

        const newer = log('https://api.example.invalid/v1/other', 'other response')
        finish('streamed answer')
        await new Response(piped).text()
        await vi.waitFor(() => expect(getFetchLogs().find(e => e.url.endsWith('/stream'))?.response).toBe('streamed answer'))

        const logs = getFetchLogs()
        expect(logs[0].url).toBe('https://api.example.invalid/v1/other')
        expect(logs[0].response).toBe('other response')
        expect(logs[1].url).toBe('https://api.example.invalid/v1/stream')
        expect(logs[1].response).toBe('streamed answer')
        expect(newer.response).toBe('other response')
    })

    test('F2 an entry evicted by the cap before the stream ends is not re-inserted', async () => {
        const started = log('https://api.example.invalid/v1/stream')
        const { stream, finish } = controlledStream()
        const piped = pipeFetchLog(started, stream)
        for (let i = 0; i < 25; i++) log(`https://api.example.invalid/v1/n${i}`)
        finish('late text')
        await new Response(piped).text()
        await new Promise((resolve) => setTimeout(resolve, 0))

        const logs = getFetchLogs()
        expect(logs).toHaveLength(20)
        expect(logs.some(e => e.url.endsWith('/stream'))).toBe(false)
        expect(logs.every(e => e.response === 'Streamed Fetch')).toBe(true)
    })

    test('F3 the log stays at 20 entries after 25 addFetchLog calls, newest first', () => {
        for (let i = 0; i < 25; i++) log(`https://api.example.invalid/v1/n${i}`)
        const logs = getFetchLogs()
        expect(logs).toHaveLength(20)
        expect(logs[0].url).toBe('https://api.example.invalid/v1/n24')
        expect(logs[19].url).toBe('https://api.example.invalid/v1/n5')
    })
})

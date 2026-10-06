/**
 * `getFileSrc` on a Node-hosted page: an `assets/` key that the server's asset
 * route serves gets the store's `urlFor` URL without reading a byte, with the
 * service worker on or off. Everything else keeps its existing path. This file
 * drives the REAL `globalApi.svelte.ts`; the modules it reaches are mocked with
 * the set that `globalApiFileCacheAv3.svelte.test.ts` proves loads it. The
 * platform flags and the page store are controlled per test.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const platform = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))
const store = vi.hoisted(() => ({
    read: vi.fn(),
    urlFor: vi.fn(),
    hasUrlFor: true,
}))

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
    get isTauri() { return platform.isTauri },
    get isNodeServer() { return platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

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
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => `converted:${p}`),
    invoke: vi.fn(async () => undefined),
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
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
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
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
        removeItem = vi.fn(async () => {})
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => (store.hasUrlFor
        ? { read: store.read, urlFor: store.urlFor }
        : { read: store.read }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

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

//#endregion

import { getFileSrc, setUsingSw, __fileCacheTestHooks } from 'src/ts/globalApi.svelte'

const ROUTE_URL = (loc: string) => `/api/asset/${Buffer.from(loc, 'utf-8').toString('hex')}?risu-auth=tok.en.sig`

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
    platform.isTauri = false
    platform.isNodeServer = true
    store.hasUrlFor = true
    store.read.mockReset()
    store.read.mockResolvedValue({ bytes: Uint8Array.from([1, 2, 3]), version: null })
    store.urlFor.mockReset()
    store.urlFor.mockImplementation(async (key: string) => ROUTE_URL(key))
    __fileCacheTestHooks.reset()
    setUsingSw(false)
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ able: true })))
    vi.stubGlobal('fetch', fetchSpy)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    __fileCacheTestHooks.reset()
    setUsingSw(false)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('getFileSrc on a Node-hosted page', () => {
    test.each([
        ['on plain HTTP', false],
        ['with the service worker on', true],
    ])('returns the route URL without reading the asset %s', async (_label, usingSw) => {
        setUsingSw(usingSw)
        const loc = 'assets/0123abcd.png'
        expect(await getFileSrc(loc)).toBe(ROUTE_URL(loc))
        expect(store.read).not.toHaveBeenCalled()
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    test('guard: falls back to reading the bytes when urlFor throws', async () => {
        store.urlFor.mockRejectedValue(new Error('no key pair'))
        const loc = 'assets/fallback.png'
        expect(await getFileSrc(loc)).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`)
        expect(store.read).toHaveBeenCalledWith(loc)
    })

    test('guard: falls back to the service worker path when urlFor throws and the worker is on', async () => {
        store.urlFor.mockRejectedValue(new Error('no key pair'))
        setUsingSw(true)
        const loc = 'assets/fallback-sw.png'
        expect(await getFileSrc(loc)).toBe(`/sw/img/${Buffer.from(loc, 'utf-8').toString('hex')}`)
    })

    test('guard: falls back to the bytes when the store offers no urlFor', async () => {
        store.hasUrlFor = false
        const loc = 'assets/no-url.png'
        expect(await getFileSrc(loc)).toMatch(/^data:image\/png;base64,/)
        expect(store.read).toHaveBeenCalledWith(loc)
    })

    test.each([
        ['a location outside assets', 'avatars/me.png'],
        ['a bare name', 'me.png'],
        ['a key with a dot-dot segment', 'assets/../database/database.bin'],
        ['a key with a backslash', 'assets/a\\b.png'],
    ])('guard: keeps the byte path for %s', async (_label, loc) => {
        const src = await getFileSrc(loc)
        expect(src).toMatch(/^data:image\/png;base64,/)
        expect(store.urlFor).not.toHaveBeenCalled()
        expect(store.read).toHaveBeenCalledWith(loc)
    })

    test('guard: a pure web page (no Node server) never asks the store for a URL', async () => {
        platform.isNodeServer = false
        const loc = 'assets/web.png'
        expect(await getFileSrc(loc)).toMatch(/^data:image\/png;base64,/)
        expect(store.urlFor).not.toHaveBeenCalled()
    })

    test('guard: a pure web page with the service worker on registers the bytes with the worker', async () => {
        platform.isNodeServer = false
        setUsingSw(true)
        fetchSpy.mockImplementation(async (url: string) => (url.startsWith('/sw/check/')
            ? new Response(JSON.stringify({ able: false }))
            : new Response(null)))
        const loc = 'assets/web-sw.png'
        expect(await getFileSrc(loc)).toBe(`/sw/img/${Buffer.from(loc, 'utf-8').toString('hex')}`)
        expect(store.urlFor).not.toHaveBeenCalled()
        expect(store.read).toHaveBeenCalledWith(loc)
    })

    test('guard: Tauri still takes the store URL for an assets key and the converted path for any other', async () => {
        platform.isTauri = true
        platform.isNodeServer = false
        expect(await getFileSrc('assets/tauri.png')).toBe(ROUTE_URL('assets/tauri.png'))
        expect(await getFileSrc('elsewhere/tauri.png')).toBe('converted:elsewhere/tauri.png')
        expect(store.read).not.toHaveBeenCalled()
    })
})

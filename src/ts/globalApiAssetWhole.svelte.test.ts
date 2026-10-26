/**
 * `getFileSrc` on a Tauri page: on Android a `'whole'` use of an asset whose
 * stored size is above the limit gets no URL, while a media use keeps it. This
 * file drives the REAL `globalApi.svelte.ts` and the REAL gate; only the stored
 * size (`statStoredSize`) and the platform are controlled, at the module
 * boundary, with declared sizes and no bytes. The module mocks are the set that
 * `globalApiNodeAssetRoute.svelte.test.ts` proves loads `globalApi.svelte.ts`.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const platform = vi.hoisted(() => ({ isTauri: true, isNodeServer: false }))
const transport = vi.hoisted(() => ({ android: true, stat: vi.fn() }))
const store = vi.hoisted(() => ({ urlFor: vi.fn() }))

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

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...(await importOriginal()),
    isAndroidTransport: () => transport.android,
    statStoredSize: (key: string) => transport.stat(key),
}))

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
    getAppStore: async () => ({ urlFor: store.urlFor }),
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

import { getFileSrc, releaseAssetObjectUrl } from 'src/ts/globalApi.svelte'
import { ANDROID_WHOLE_READ_URL_LIMIT_BYTES, resetAssetUrlGateForTest } from 'src/ts/storage/assetUrlGate'

const MIB = 1024 * 1024
const URL_OF = (key: string) => `asset://localhost/${key}`

beforeEach(() => {
    platform.isTauri = true
    platform.isNodeServer = false
    transport.android = true
    transport.stat.mockReset()
    store.urlFor.mockReset()
    store.urlFor.mockImplementation(async (key: string) => URL_OF(key))
    resetAssetUrlGateForTest()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('getFileSrc on Android above the whole-read limit', () => {
    test('reproducer: a whole use (the default) of an asset over the limit gets no URL and the store is not asked', async () => {
        transport.stat.mockResolvedValue(ANDROID_WHOLE_READ_URL_LIMIT_BYTES + 1)

        expect(await getFileSrc('assets/big')).toBe('')
        expect(await getFileSrc('assets/big', 'whole')).toBe('')
        expect(store.urlFor).not.toHaveBeenCalled()
    })

    test('guard: an asset of exactly the limit keeps its URL, as does a small one', async () => {
        transport.stat.mockImplementation(async (key: string) => (key === 'assets/edge' ? ANDROID_WHOLE_READ_URL_LIMIT_BYTES : 1))

        expect(await getFileSrc('assets/edge')).toBe(URL_OF('assets/edge'))
        expect(await getFileSrc('assets/tiny')).toBe(URL_OF('assets/tiny'))
    })

    test('guard: a media use keeps the URL of a 1 GiB asset and asks no size', async () => {
        transport.stat.mockResolvedValue(1024 * MIB)

        expect(await getFileSrc('assets/video', 'media')).toBe(URL_OF('assets/video'))
        expect(transport.stat).not.toHaveBeenCalled()
    })

    test('reproducer: an unreadable size gives no URL, is logged once, and is probed again on the next call', async () => {
        transport.stat.mockRejectedValueOnce(new Error('failed to open (os error 2)'))
        transport.stat.mockRejectedValueOnce(new Error('failed to open (os error 2)'))
        transport.stat.mockResolvedValue(ANDROID_WHOLE_READ_URL_LIMIT_BYTES + 1)

        expect(await getFileSrc('assets/late')).toBe('')
        expect(await getFileSrc('assets/late')).toBe('')
        expect(console.error).toHaveBeenCalledTimes(1)
        expect(await getFileSrc('assets/late')).toBe('')
        expect(transport.stat).toHaveBeenCalledTimes(3)
        expect(store.urlFor).not.toHaveBeenCalled()
    })

    test('reproducer: a file missing at first and small later gets its URL on the later call', async () => {
        transport.stat.mockRejectedValueOnce(new Error('failed to open (os error 2)'))
        transport.stat.mockResolvedValue(10)

        expect(await getFileSrc('assets/appears')).toBe('')
        expect(await getFileSrc('assets/appears')).toBe(URL_OF('assets/appears'))
    })

    test('a size is probed once while the asset stays, and again after it is released', async () => {
        transport.stat.mockResolvedValueOnce(5)
        transport.stat.mockResolvedValueOnce(ANDROID_WHOLE_READ_URL_LIMIT_BYTES + 1)

        expect(await getFileSrc('assets/a')).toBe(URL_OF('assets/a'))
        expect(await getFileSrc('assets/a')).toBe(URL_OF('assets/a'))
        expect(transport.stat).toHaveBeenCalledTimes(1)

        releaseAssetObjectUrl(['assets/a'])

        expect(await getFileSrc('assets/a')).toBe('')
        expect(transport.stat).toHaveBeenCalledTimes(2)
    })
})

describe('getFileSrc off Android', () => {
    test('guard: a page that is not the Android transport keeps the URL of a 1 GiB asset and never probes a size', async () => {
        transport.android = false
        transport.stat.mockResolvedValue(1024 * MIB)

        expect(await getFileSrc('assets/huge')).toBe(URL_OF('assets/huge'))
        expect(transport.stat).not.toHaveBeenCalled()
    })

    test('guard: a path outside the assets keys is converted as before and never probed', async () => {
        transport.stat.mockResolvedValue(1024 * MIB)

        expect(await getFileSrc('/some/where.png')).toBe('converted:/some/where.png')
        expect(transport.stat).not.toHaveBeenCalled()
    })
})

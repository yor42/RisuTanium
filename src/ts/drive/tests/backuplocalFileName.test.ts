// @vitest-environment happy-dom

/**
 * The default file name a local backup offers, and that `LocalWriter.init` offers nothing new to a caller that
 * passes no suggested name. `SaveLocalBackup` and `SavePartialLocalBackup` are driven for real against the real
 * `LocalWriter`; only the writer factory (`openWebExportWriter`) and the Tauri save dialog are spies, so the
 * name each one is asked for can be read directly. This proves the arguments handed to the dialog and the web
 * writer, not what a native dialog or a browser does with them.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const saveMock = vi.hoisted(() => vi.fn(async (_options?: unknown): Promise<string | null> => 'chosen.bin'))
const openWebExportWriterMock = vi.hoisted(() => vi.fn(async (_filename: string) => ({
    write: async (_data: Uint8Array) => { },
    close: async () => { },
})))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: saveMock,
}))

vi.mock('src/ts/exportWriters', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/exportWriters')>()),
    TauriWriter: class {
        constructor(public path: string) { }
        async write(_data: Uint8Array) { }
        async close() { }
    },
    openWebExportWriter: openWebExportWriterMock,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => { }),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => new Uint8Array()),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown as Database),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
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
    alertNormalWait: vi.fn(async () => { }),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
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
        getItem = vi.fn(async () => null)
        setItem = vi.fn(async () => { })
        keys = vi.fn(async () => [])
        removeItem = vi.fn(async () => { })
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
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: vi.fn(() => null),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: vi.fn(() => false),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

// The assets are listed and read through the page's byte store; here it holds none.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('src/ts/storage/tests/appStoreMock')
    return appStoreModuleOver(() => forageOverMap(new Map())) as unknown as typeof import('src/ts/storage/store/appStore')
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { LocalWriter } from 'src/ts/globalApi.svelte'

beforeEach(() => {
    saveMock.mockClear()
    openWebExportWriterMock.mockClear()
    platformBox.isTauri = false
    // Late evening on 10 Oct in the device's own time zone, whatever that is.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 10, 23, 30, 0))
})

afterEach(() => {
    vi.useRealTimers()
})

describe('LocalWriter.init without a suggested name behaves as before', () => {
    test('guard: web download name is Binary.bin', async () => {
        const writer = new LocalWriter()
        expect(await writer.init()).toBe(true)
        expect(openWebExportWriterMock).toHaveBeenCalledExactlyOnceWith('Binary.bin')
    })

    test('guard: web download name follows the name and first extension', async () => {
        const writer = new LocalWriter()
        await writer.init('Character', ['png', 'jpg'])
        expect(openWebExportWriterMock).toHaveBeenCalledExactlyOnceWith('Character.png')
    })

    test('guard: Tauri dialog gets the filter and no defaultPath key', async () => {
        platformBox.isTauri = true
        const writer = new LocalWriter()
        expect(await writer.init()).toBe(true)
        expect(saveMock).toHaveBeenCalledTimes(1)
        expect(saveMock.mock.calls[0][0]).toStrictEqual({ filters: [{ name: 'Binary', extensions: ['bin'] }] })
    })
})

describe('LocalWriter.init with a suggested name', () => {
    test('web download uses the suggested name', async () => {
        const writer = new LocalWriter()
        await writer.init(undefined, undefined, 'local-20261010.bin')
        expect(openWebExportWriterMock).toHaveBeenCalledExactlyOnceWith('local-20261010.bin')
    })

    test('Tauri dialog gets the suggested name as defaultPath and keeps the filter', async () => {
        platformBox.isTauri = true
        const writer = new LocalWriter()
        await writer.init(undefined, undefined, 'local-20261010.bin')
        expect(saveMock.mock.calls[0][0]).toStrictEqual({
            defaultPath: 'local-20261010.bin',
            filters: [{ name: 'Binary', extensions: ['bin'] }],
        })
    })
})

describe('the local backups request a dated default name', () => {
    test('SaveLocalBackup on web asks for local-YYYYMMDD.bin', async () => {
        await SaveLocalBackup()
        expect(openWebExportWriterMock).toHaveBeenCalledExactlyOnceWith('local-20261010.bin')
    })

    test('SavePartialLocalBackup on web asks for local-partial-YYYYMMDD.bin', async () => {
        await SavePartialLocalBackup()
        expect(openWebExportWriterMock).toHaveBeenCalledExactlyOnceWith('local-partial-20261010.bin')
    })

    test('SaveLocalBackup on Tauri offers local-YYYYMMDD.bin in the save dialog', async () => {
        platformBox.isTauri = true
        await SaveLocalBackup()
        expect(saveMock.mock.calls[0][0]).toMatchObject({ defaultPath: 'local-20261010.bin' })
    })

    test('SavePartialLocalBackup on Tauri offers local-partial-YYYYMMDD.bin in the save dialog', async () => {
        platformBox.isTauri = true
        await SavePartialLocalBackup()
        expect(saveMock.mock.calls[0][0]).toMatchObject({ defaultPath: 'local-partial-20261010.bin' })
    })
})

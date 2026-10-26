// @vitest-environment happy-dom

/**
 * `exportThisTabBackup`, the export a parked Node page offers before it reloads. New behaviour: it writes the
 * partial-backup shape (the database, characters and profile images, no other assets and no inlays), asks neither of
 * the two partial-backup explanation confirms, holds the `backupSave` busy entry until the `database.risudat` entry, and
 * ends with the typed outcome. The real `LocalWriter` and the real writer body are driven; the web writer records the
 * entries written.
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

const world = vi.hoisted(() => ({
    db: {} as unknown,
    files: new Map<string, Uint8Array>(),
    confirm: [] as string[],
    confirmAnswer: true,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => 'chosen.bin'),
}))

vi.mock('src/ts/exportWriters', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/exportWriters')>()),
    TauriWriter: class {
        constructor(public path: string) { }
        async write(_data: Uint8Array) { }
        async close() { }
    },
    openWebExportWriter: vi.fn(async (_filename: string) => ({
        write: async (_data: Uint8Array) => { },
        close: async () => { },
    })),
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
    getDatabase: vi.fn(() => world.db as Database),
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
    alertConfirm: vi.fn(async (msg: string) => {
        world.confirm.push(msg)
        return world.confirmAnswer
    }),
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

// The assets are listed and read through the page's byte store; `world.files` is what it holds.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('src/ts/storage/tests/appStoreMock')
    return appStoreModuleOver(() => forageOverMap(world.files)) as unknown as typeof import('src/ts/storage/store/appStore')
})

//#endregion

import { exportThisTabBackup } from 'src/ts/drive/backuplocal'
import { LocalWriter } from 'src/ts/globalApi.svelte'
import { busyKinds } from 'src/ts/process/memory/busyActions'
import { alertError } from 'src/ts/alert'
import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { createPeerUi } from 'src/ts/storage/store2/ui/peerUi'

/** The entry names written, and the busy kinds seen when the `database.risudat` entry was written. */
let written: string[] = []
let busyAtDatabaseEntry: boolean[] = []

const bytes = (text: string) => new TextEncoder().encode(text)

beforeEach(() => {
    platformBox.isTauri = false
    written = []
    busyAtDatabaseEntry = []
    world.confirm = []
    world.confirmAnswer = true
    world.files = new Map([
        ['assets/profile.png', bytes('profile')],
        ['assets/emotion.png', bytes('emotion')],
        ['assets/extra.png', bytes('extra')],
    ])
    world.db = {
        characters: [{
            chaId: 'a',
            name: 'A',
            type: 'character',
            chatPage: 0,
            chats: [],
            image: 'assets/profile.png',
            emotionImages: [['happy', 'assets/emotion.png']],
            additionalAssets: [['extra', 'assets/extra.png', 'png']],
        }],
        personas: [],
        characterOrder: ['a'],
        botPresets: [],
    }
    const original = LocalWriter.prototype.writeBackup
    vi.spyOn(LocalWriter.prototype, 'writeBackup').mockImplementation(async function (this: LocalWriter, name: string, data: Uint8Array) {
        written.push(name)
        if (name === 'database.risudat') {
            busyAtDatabaseEntry.push(busyKinds().includes('backupSave'))
        }
        return original.call(this, name, data)
    })
    // The streamed database entry starts with its header instead of one writeBackup call.
    const originalHeader = LocalWriter.prototype.writeBackupHeader
    vi.spyOn(LocalWriter.prototype, 'writeBackupHeader').mockImplementation(async function (this: LocalWriter, name: string, length: number) {
        written.push(name)
        if (name === 'database.risudat') {
            busyAtDatabaseEntry.push(busyKinds().includes('backupSave'))
        }
        return originalHeader.call(this, name, length)
    })
    return () => {
        vi.restoreAllMocks()
    }
})

describe('exportThisTabBackup', () => {
    test('new behaviour: it writes the partial-backup shape, the profile image and no other asset, and ends saved', async () => {
        const outcome = await exportThisTabBackup()

        expect(outcome.status).toBe('saved')
        expect(written).toContain('assets/profile.png')
        expect(written).toContain('database.risudat')
        expect(written).not.toContain('assets/emotion.png')
        expect(written).not.toContain('assets/extra.png')
    })

    test('new behaviour: it asks neither of the two partial-backup explanation confirms', async () => {
        world.confirmAnswer = false
        const outcome = await exportThisTabBackup()

        expect(world.confirm).toEqual([])
        expect(outcome.status).toBe('saved')
    })

    test('new behaviour: it holds the backupSave busy entry at the database.risudat entry and releases it afterwards', async () => {
        expect(busyKinds()).not.toContain('backupSave')

        await exportThisTabBackup()

        expect(busyAtDatabaseEntry).toEqual([true])
        expect(busyKinds()).not.toContain('backupSave')
    })

    test('a throw of the writer is the typed failed outcome and the busy entry is released', async () => {
        vi.spyOn(LocalWriter.prototype, 'close').mockRejectedValueOnce(new Error('disk full'))

        const outcome = await exportThisTabBackup()

        expect(outcome.status).toBe('failed')
        expect(busyKinds()).not.toContain('backupSave')
    })
})

describe('exportThisTabBackup with an unreadable module', () => {
    function arrangeBrokenModule(): void {
        const db = world.db as { modules?: unknown[] }
        db.modules = [{ id: 'm-b', name: 'Broken Module', [MODULE_STUB_KEY]: MODULE_STUB_VALUE }]
        DBState.db = world.db as Database
        registerModuleLoader(async () => {
            throw new Error('read failed')
        })
        vi.mocked(alertError).mockClear()
    }

    afterEach(() => {
        unregisterModuleLoader()
    })

    test('unreadable-module-names-it: the alert names the module, not the generic text, and nothing is written', async () => {
        arrangeBrokenModule()

        const outcome = await exportThisTabBackup()

        expect(outcome.status).toBe('failed')
        expect(written).toEqual([])
        expect(alertError).toHaveBeenCalledTimes(1)
        const shown = String(vi.mocked(alertError).mock.calls[0][0])
        expect(shown).toContain('Broken Module')
        expect(shown).not.toBe(language.backupFailedNothingWritten())
        expect(shown).toBe(language.backupFailedModuleUnreadable('Broken Module', 'unreadable'))
    })

    test('unreadable-module-names-it: the rescue autoExport reports failed, which the loop words as not finished, and shows the named alert', async () => {
        arrangeBrokenModule()
        const peer = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: async () => await exportThisTabBackup() })

        await expect(peer.autoExport?.('manifest')).resolves.toBe('failed')

        expect(String(vi.mocked(alertError).mock.calls[0][0])).toBe(language.backupFailedModuleUnreadable('Broken Module', 'unreadable'))
    })
})

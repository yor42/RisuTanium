// @vitest-environment happy-dom

/**
 * A module export (`exportModule` as `.charx`, `exportModuleLegacy` as `.risum`) while the Android save dialog is
 * pending. The real exports, `LocalWriter`, `TauriWriter` and the real alert module run over a working `alertStore`;
 * only the file system (`writeFile`, and `invoke` for the Android `content://` document), the save dialog and the asset
 * reads are replaced. A mocked dialog is not evidence of the native picker.
 *
 * Labels: (R) regression reproducer, fails before the change by assertion; (G) guard, passes with or without it.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})

const world = vi.hoisted(() => ({
    errors: [] as string[],
    android: true,
    // every file-system call: the path and the number of bytes
    calls: [] as Array<{ path: string, length: number }>,
    // runs at the first call that reaches the file system
    onFirstCall: null as (() => void) | null,
    png: new Uint8Array() as Uint8Array,
}))

vi.mock('uuid', () => ({ v4: () => 'uuid-1' }))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => 'content://documents/1'),
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
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
        if (world.calls.length === 0) {
            world.onFirstCall?.()
        }
        world.calls.push({ path, length: data.byteLength })
    }),
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
    invoke: vi.fn(async (command: string, args?: { uri?: string, data?: string }) => {
        if (command !== 'export_append_b64' || !args?.uri || args.data === undefined) {
            return undefined
        }
        if (world.calls.length === 0) {
            world.onFirstCall?.()
        }
        const length = Buffer.from(args.data, 'base64').byteLength
        world.calls.push({ path: args.uri, length })
        return { written: length }
    }),
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

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], goCharacterOnImport: false })),
    setDatabase: vi.fn(),
    setDatabaseLite: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: [], imageCompression: false } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
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
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

// The alert module is the real one over the store above; only the calls that block or show an error are replaced.
vi.mock('src/ts/alert', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/alert')>()),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { world.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertMd: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/util')>()),
    isKnownUri: vi.fn(() => false),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/characters')>()),
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

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

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/media/compressImage/lossyCompression'), () => ({
    doLossyCompression: vi.fn(async (data: Uint8Array) => Buffer.from(data)),
}))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

// `readImage` is the one function of `globalApi.svelte` that is replaced, so the module needs no asset store.
vi.mock('src/ts/globalApi.svelte', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/globalApi.svelte')>()),
    readImage: vi.fn(async () => world.png),
    loadAsset: vi.fn(async () => new Uint8Array()),
    saveAsset: vi.fn(async () => 'saved'),
}))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: vi.fn(async () => ({ bytes: null })),
        readValue: vi.fn(async () => null),
    })),
    getAppStoreKind: vi.fn(async () => 'tauri'),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...await importOriginal(),
    isDesktopTransport: () => !world.android,
    isAndroidTransport: () => world.android,
    transportKind: () => 'web',
}) as unknown as typeof import('src/ts/storage/tauriByteTransport'))

//#endregion

import { save } from '@tauri-apps/plugin-dialog'
import { exportModule, exportModuleLegacy, type RisuModule } from 'src/ts/process/modules'
import { busyKinds, isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { inFlightKinds } from 'src/ts/process/inFlightWork'
import { refuseBackupLoadWhileBusy } from 'src/ts/drive/backupWorkGuard'
import { alertStore } from 'src/ts/stores.svelte'
import { noteSelectedStore } from 'src/ts/storage/assetLimit'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { alertError } from 'src/ts/alert'
import { resetTaskHostForTests, taskHostView, taskShown } from 'src/ts/alertTask.svelte'
import { language } from 'src/lang'

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

/** A module with an icon, so the export never fetches the stand-in image. */
function moduleOf(assets: number): RisuModule {
    return {
        name: 'Synthetic Module',
        description: 'd',
        id: 'module-1',
        icon: 'assets/icon',
        assets: Array.from({ length: assets }, (_, i) => [`asset${i + 1}`, `assets/a${i + 1}`, 'png'] as [string, string, string]),
    }
}

/** Makes the next save dialog answer only when `deliver` is called. */
function holdSaveDialog(): { deliver: (path: string | null) => void } {
    let deliver: (path: string | null) => void = () => { }
    vi.mocked(save).mockImplementationOnce(() => new Promise<string | null>((resolve) => { deliver = resolve }))
    return { deliver: (path) => deliver(path) }
}

beforeEach(() => {
    platformBox.isTauri = true
    world.android = true
    world.errors = []
    world.calls = []
    world.onFirstCall = null
    world.png = syntheticPng()
    resetBusyActionsForTest()
    vi.mocked(save).mockClear()
    vi.mocked(alertError).mockClear()
    resetTaskHostForTests()
    noteSelectedStore('tauri', { read: vi.fn(), readValue: vi.fn() } as unknown as ByteStore)
    alertStore.set({ type: 'none', msg: '' })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    // The card export falls back to the stand-in image when the icon is not in storage.
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(world.png.slice())) as unknown as typeof fetch
    return () => {
        globalThis.fetch = realFetch
        vi.restoreAllMocks()
    }
})

const exportsUnderTest = [
    // `entriesAtFirstWrite`: the .charx first write belongs to the nested card export, which holds its own entry beside the outer one.
    { name: 'exportModule (.charx)', entriesAtFirstWrite: 2, run: () => exportModule(moduleOf(0), { alertEnd: false }) },
    { name: 'exportModuleLegacy (.risum) without assets', entriesAtFirstWrite: 1, run: () => exportModuleLegacy(moduleOf(0), { alertEnd: false }) },
    { name: 'exportModuleLegacy (.risum) with assets', entriesAtFirstWrite: 1, run: () => exportModuleLegacy(moduleOf(2), { alertEnd: false }) },
]

describe('a module export waiting on the save dialog', () => {
    // Regression reproducers (R6, R7).
    test.each(exportsUnderTest)('(R) $name: a pending Android save dialog does not refuse a backup Load; the first write does', async ({ run, entriesAtFirstWrite }) => {
        const dialog = holdSaveDialog()
        const atFirstWrite: { refused: boolean, kinds: string[] }[] = []
        world.onFirstCall = () => { atFirstWrite.push({ refused: refuseBackupLoadWhileBusy(), kinds: busyKinds() }) }

        const exporting = run()
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        expect(refuseBackupLoadWhileBusy()).toBe(false)
        expect(world.errors).toEqual([])
        expect(isBusy()).toBe(true)
        expect(busyKinds()).toContain('export')
        expect(inFlightKinds()).toContain('busy')

        dialog.deliver('content://documents/1')
        await exporting

        expect(atFirstWrite).toHaveLength(1)
        expect(atFirstWrite[0].refused).toBe(true)
        expect(atFirstWrite[0].kinds).toEqual(Array<string>(entriesAtFirstWrite).fill('export'))
        expect(isBusy()).toBe(false)
        expect(inFlightKinds()).not.toContain('busy')
    })

    // AD2: the card opens only after the picker answered.
    test.each(exportsUnderTest)('(R) $name: no card while the Android save dialog is pending; after the path is delivered the module card runs', async ({ run }) => {
        const dialog = holdSaveDialog()
        let titleAtFirstCall: string | undefined
        world.onFirstCall = () => { titleAtFirstCall = taskHostView()?.title }
        const exporting = run()
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        expect(taskShown()).toBe(false)

        dialog.deliver('content://documents/1')
        await exporting

        expect(titleAtFirstCall).toBe(language.exportTaskModuleTitle)
        expect(taskShown()).toBe(false)
    })

    // AD4: a failure before the card was opened ends as today: the legacy error, never a card; the export resolves.
    test.each(exportsUnderTest)('(G) $name: a rejected save dialog call resolves with the legacy error and never shows a card', async ({ run }) => {
        vi.mocked(save).mockRejectedValueOnce(new Error('dialog plugin failed'))
        let cardSeen = false
        const stop = alertStore.subscribe(() => { cardSeen ||= taskShown() })
        world.onFirstCall = () => { cardSeen ||= taskShown() }

        const outcome = await run().then(() => 'resolved', () => 'rejected')
        stop()

        expect(outcome).toBe('resolved')
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(world.errors).toEqual(['dialog plugin failed'])
        expect(cardSeen).toBe(false)
        expect(taskShown()).toBe(false)
        expect(isBusy()).toBe(false)
    })

    // Compatibility guard (G5): a desktop dialog is modal and keeps refusing a Load.
    test.each(exportsUnderTest)('(G) $name: a desktop save dialog keeps refusing a backup Load while it is pending', async ({ run }) => {
        world.android = false
        const dialog = holdSaveDialog()
        const exporting = run()
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        expect(refuseBackupLoadWhileBusy()).toBe(true)

        dialog.deliver('chosen.out')
        await exporting
    })

    // Compatibility guard: a dismissed dialog leaves nothing registered.
    test.each(exportsUnderTest)('(G) $name: a dismissed Android save dialog leaves no entry or token', async ({ run }) => {
        const dialog = holdSaveDialog()
        const exporting = run()
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        dialog.deliver(null)
        await exporting

        expect(world.calls).toEqual([])
        expect(isBusy()).toBe(false)
        expect(inFlightKinds()).not.toContain('busy')
    })
})

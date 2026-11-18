// @vitest-environment happy-dom

/**
 * A card export (`exportCharacterCard`) while the Android save dialog is pending. The real `exportCharacterCard`,
 * `LocalWriter`, `TauriWriter` and the real alert module run over a working `alertStore`; only the file system, the
 * save dialog and the card's image source are replaced. A mocked dialog is not evidence of the native picker.
 *
 * Labels: (R) regression reproducer, fails before the change by assertion; (G) guard, passes with or without it.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { character } from 'src/ts/storage/database.svelte'
import { save } from '@tauri-apps/plugin-dialog'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})

const world = vi.hoisted(() => ({
    png: new Uint8Array() as Uint8Array,
    errors: [] as string[],
    os: 'android',
    // every file-system call: the path, the number of bytes and whether it appended
    calls: [] as Array<{ path: string, length: number, append: boolean }>,
    // runs at the first call that reaches the file system
    onFirstCall: null as (() => void) | null,
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

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => world.os }))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async (path: string, data: Uint8Array, options?: { append?: boolean }) => {
        if (world.calls.length === 0) {
            world.onFirstCall?.()
        }
        world.calls.push({ path, length: data.byteLength, append: options?.append === true })
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
        world.calls.push({ path: args.uri, length, append: false })
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

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    readModule: vi.fn(),
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

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

// `readImage` is the one function of `globalApi.svelte` that is replaced, so the card needs no asset store.
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

//#endregion

import { exportCharacterCard } from 'src/ts/characterCards'
import { busyKinds, isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { inFlightKinds } from 'src/ts/process/inFlightWork'
import { refuseBackupLoadWhileBusy } from 'src/ts/drive/backupWorkGuard'
import { alertStore } from 'src/ts/stores.svelte'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { noteSelectedStore } from 'src/ts/storage/assetLimit'
import type { ByteStore } from 'src/ts/storage/store/contract'
import type { alertData } from 'src/ts/alert'

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

function syntheticCharacter(): character {
    const uris = [1, 2, 3].map((n) => `assets/a${n}`)
    return {
        name: 'Synthetic',
        image: 'synthetic-image',
        globalLore: [],
        desc: 'd',
        firstMessage: 'hi',
        ccAssets: uris.map((uri, i) => ({ type: 'x-risu-asset', uri, name: `asset${i}`, ext: 'png' })),
    } as unknown as character
}

/** Makes the next save dialog answer only when `deliver` is called. */
function holdSaveDialog(): { deliver: (path: string | null) => void } {
    let deliver: (path: string | null) => void = () => { }
    vi.mocked(save).mockImplementationOnce(() => new Promise<string | null>((resolve) => { deliver = resolve }))
    return { deliver: (path) => deliver(path) }
}

let shown: alertData[] = []

beforeEach(() => {
    platformBox.isTauri = true
    world.os = 'android'
    world.png = syntheticPng()
    world.errors = []
    world.calls = []
    world.onFirstCall = null
    resetBusyActionsForTest()
    resetByteTransportForTests()
    vi.mocked(save).mockClear()
    noteSelectedStore('tauri', { read: vi.fn(), readValue: vi.fn() } as unknown as ByteStore)
    alertStore.set({ type: 'none', msg: '' })
    shown = []
    const unsubscribe = alertStore.subscribe((value) => { shown.push(value as alertData) })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    return () => {
        unsubscribe()
        vi.restoreAllMocks()
    }
})

describe('a card export waiting on the save dialog', () => {
    // Regression reproducer (R5).
    test('(R) a pending Android save dialog does not refuse a backup Load; the first write does', async () => {
        const dialog = holdSaveDialog()
        const atFirstWrite: { refused: boolean, kinds: string[] }[] = []
        world.onFirstCall = () => { atFirstWrite.push({ refused: refuseBackupLoadWhileBusy(), kinds: busyKinds() }) }

        const exporting = exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        expect(refuseBackupLoadWhileBusy()).toBe(false)
        expect(world.errors).toEqual([])
        expect(isBusy()).toBe(true)
        expect(busyKinds()).toContain('export')
        expect(inFlightKinds()).toContain('busy')

        dialog.deliver('content://documents/1')
        expect(await exporting).toBe(true)

        expect(atFirstWrite).toEqual([{ refused: true, kinds: ['export'] }])
        expect(isBusy()).toBe(false)
        expect(inFlightKinds()).not.toContain('busy')
    })

    // Compatibility guard (G16 c): a png export posts nothing before its save dialog, so S2 leaves nothing on screen to change.
    test('(G) nothing is shown while the Android save dialog is pending', async () => {
        const dialog = holdSaveDialog()
        const exporting = exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        expect((get(alertStore) as alertData).type).toBe('none')
        expect(shown.every((value) => value.type === 'none')).toBe(true)

        dialog.deliver('content://documents/1')
        await exporting
    })

    // Compatibility guard (G1): a dismissed dialog gives today's outcome and leaves nothing registered.
    test('(G) a dismissed Android save dialog ends the export unexported, silent, with no entry or token', async () => {
        const dialog = holdSaveDialog()
        const exporting = exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        dialog.deliver(null)

        expect(await exporting).toBe(false)
        expect(world.errors).toEqual([])
        expect(world.calls).toEqual([])
        expect(isBusy()).toBe(false)
        expect(inFlightKinds()).not.toContain('busy')
    })

    // Compatibility guard (G5): a desktop dialog is modal and keeps refusing a Load.
    test('(G) a desktop save dialog keeps refusing a backup Load while it is pending', async () => {
        world.os = 'windows'
        resetByteTransportForTests()
        const dialog = holdSaveDialog()
        const exporting = exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        expect(refuseBackupLoadWhileBusy()).toBe(true)

        dialog.deliver('chosen.png')
        await exporting
    })
})

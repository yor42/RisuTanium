// @vitest-environment happy-dom

/**
 * The Cancel of a web module export (`exportModule`). The real `exportModule`, `exportCharacterCard`, `LocalWriter`,
 * `openWebExportWriter`, `pngChunk` and `CharXWriter` run; the vendored download helper (`streamSaver`) is replaced by
 * a stream writer that can stop taking writes, which is what a browser that ended its download early looks like to the
 * page. This proves what the page does, not what a browser does with the download.
 *
 * Labels: (R) reproducer, fails on the code before the Cancel existed because the dialog on screen at the stall has
 * no `onCancel`; (N) new behaviour; (G) guard, passes with or without the change.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import { language } from 'src/lang'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const world = vi.hoisted(() => ({
    png: new Uint8Array() as Uint8Array,
    files: new Map<string, Uint8Array>(),
    stallAfter: Number.POSITIVE_INFINITY,
    writes: [] as Uint8Array[],
    closes: 0,
    aborts: 0,
    releases: [] as Array<() => void>,
    errors: [] as string[],
}))

const streamBox = vi.hoisted(() => ({
    useBlobFallback: false,
    mitm: '',
    createWriteStream: undefined as unknown,
}))

vi.mock('uuid', () => ({ v4: () => 'uuid-1' }))

vi.mock('src/ts/vendor/streamSaver', () => ({ default: streamBox }))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => 'chosen.bin'),
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
    DBState: { get db() { return { characters: [] } } },
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

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'PNG'),
}) as unknown as typeof import('src/ts/media'))

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

// The assets are read through the page's byte store; `world.files` is what it holds.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('src/ts/storage/tests/appStoreMock')
    return appStoreModuleOver(() => forageOverMap(world.files)) as unknown as typeof import('src/ts/storage/store/appStore')
})

//#endregion

import { exportModule, type RisuModule } from 'src/ts/process/modules'
import { busyKinds } from 'src/ts/process/memory/busyActions'
import { alertStore } from 'src/ts/stores.svelte'
import type { alertData } from 'src/ts/alert'

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

/** A module with three assets, so its card export shows its progress more than once before it writes the card. */
function syntheticModule(): RisuModule {
    return {
        name: 'Synthetic Module',
        description: 'd',
        id: 'module-1',
        assets: [1, 2, 3].map((n) => [`asset${n}`, `assets/a${n}`, 'png'] as [string, string, string]),
    }
}

let shown: alertData[] = []
let unsubscribe: () => void = () => { }
const realFetch = globalThis.fetch

beforeEach(() => {
    platformBox.isTauri = false
    world.png = syntheticPng()
    world.files = new Map([1, 2, 3].map((n) => [`assets/a${n}`, syntheticPng()] as [string, Uint8Array]))
    world.stallAfter = Number.POSITIVE_INFINITY
    world.writes = []
    world.closes = 0
    world.aborts = 0
    world.releases = []
    world.errors = []
    streamBox.useBlobFallback = false
    streamBox.createWriteStream = vi.fn((_filename: string) => ({
        ready: Promise.resolve(),
        writable: {
            getWriter: () => ({
                write: (data: Uint8Array) => {
                    world.writes.push(data.slice())
                    if (world.writes.length > world.stallAfter) {
                        return new Promise<void>((resolve) => { world.releases.push(resolve) })
                    }
                    return Promise.resolve()
                },
                close: () => {
                    world.closes += 1
                    return Promise.resolve()
                },
                // An abort waits behind a write the far side never takes.
                abort: () => {
                    world.aborts += 1
                    return world.releases.length > 0 ? new Promise<void>(() => { }) : Promise.resolve()
                },
            }),
        },
    }))
    // A module has no image of its own; the export fetches the placeholder.
    globalThis.fetch = vi.fn(async () => new Response(syntheticPng().buffer as ArrayBuffer, { status: 200 })) as unknown as typeof fetch
    alertStore.set({ type: 'none', msg: '' })
    shown = []
    unsubscribe = alertStore.subscribe((value) => { shown.push(value as alertData) })
    return () => {
        unsubscribe()
        globalThis.fetch = realFetch
        vi.restoreAllMocks()
    }
})

/** Starts a module export whose writer stops taking writes after `stallAfter`, and waits until it is stalled. */
async function stalledModuleExport(stallAfter: number): Promise<{ done: Promise<void> }> {
    world.stallAfter = stallAfter
    const done = exportModule(syntheticModule())
    await vi.waitFor(() => expect(world.writes.length).toBe(stallAfter + 1))
    return { done }
}

describe('a module export stalled mid-write', () => {
    test('(R) the dialog on screen at the stall carries a Cancel, and pressing it ends the export with no success and no error', async () => {
        const { done } = await stalledModuleExport(2)

        const dialog = get(alertStore) as alertData
        expect(dialog.onCancel).toBeTypeOf('function')
        expect(dialog.type).toBe('wait')
        dialog.onCancel?.()
        await done

        expect(world.errors).toEqual([])
        expect(shown.filter((value) => value.msg === language.successExport)).toEqual([])
        expect(busyKinds()).not.toContain('export')
    })

    test('(N) a cancel after the stream opened says any saved file is incomplete, once, and closes nothing', async () => {
        const { done } = await stalledModuleExport(2)

        ;(get(alertStore) as alertData).onCancel?.()
        await done

        const notice = get(alertStore) as alertData
        expect(notice.type).toBe('normal')
        expect(notice.msg).toBe(language.exportCancelledFileIncomplete)
        expect(shown.filter((value) => value.msg === language.exportCancelledFileIncomplete)).toHaveLength(1)
        expect(world.aborts).toBe(1)
        expect(world.closes).toBe(0)
    })
})

describe('guards', () => {
    test('(G) a normal module export closes the file and reports success once', async () => {
        await exportModule(syntheticModule())

        expect(world.closes).toBe(1)
        expect(world.aborts).toBe(0)
        expect(world.errors).toEqual([])
        expect(shown.filter((value) => value.msg === language.successExport).length).toBeGreaterThan(0)
    })

    test('(G) a desktop module export offers no Cancel', async () => {
        platformBox.isTauri = true
        await exportModule(syntheticModule())

        expect(shown.filter((value) => value.onCancel !== undefined)).toEqual([])
    })
})

// @vitest-environment happy-dom

/**
 * The Cancel of a web character-card export (PNG and CharX). The real `exportCharacterCard`, `LocalWriter`,
 * `openWebExportWriter`, `pngChunk` and `CharXWriter` run; the vendored download helper (`streamSaver`) is replaced by
 * a stream writer that can stop taking writes, which is what a browser that ended its download early looks like to the
 * page. This proves what the page does, not what a browser does with the download.
 *
 * Labels: (R) reproducer, fails on the code before the Cancel existed because the dialog on screen at the stall has
 * no `onCancel`; (N) new behaviour; (G) guard, passes with or without the change.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { character } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const world = vi.hoisted(() => ({
    png: new Uint8Array() as Uint8Array,
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

vi.mock(import('src/ts/characters'), () => ({
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

// `readImage` is the one function of `globalApi.svelte` that is replaced, so the card needs no asset store.
vi.mock('src/ts/globalApi.svelte', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/globalApi.svelte')>()),
    readImage: vi.fn(async () => world.png),
    loadAsset: vi.fn(async () => new Uint8Array()),
    saveAsset: vi.fn(async () => 'saved'),
}))

//#endregion

import { exportCharacterCard } from 'src/ts/characterCards'
import { busyKinds } from 'src/ts/process/memory/busyActions'
import { alertStore } from 'src/ts/stores.svelte'
import type { alertData } from 'src/ts/alert'

function syntheticPng(idatChunks = 0): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    // The stream writer copies each chunk without reading its checksum, so the one-byte data chunks need no valid one.
    const idat = [0, 0, 0, 1, 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0, 0]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    const chunks: number[] = []
    for (let i = 0; i < idatChunks; i++) {
        chunks.push(...idat)
    }
    return new Uint8Array([...signature, ...ihdr, ...chunks, ...iend])
}

/** A character whose card carries three assets, so the export shows its progress more than once before it writes the card. */
function syntheticCharacter(): character {
    return {
        name: 'Synthetic',
        image: 'synthetic-image',
        globalLore: [],
        desc: 'd',
        firstMessage: 'hi',
        ccAssets: [1, 2, 3].map((n) => ({ type: 'x-risu-asset', uri: `assets/a${n}`, name: `asset${n}`, ext: 'png' })),
    } as unknown as character
}

let shown: alertData[] = []
let unsubscribe: () => void = () => { }

beforeEach(() => {
    platformBox.isTauri = false
    world.png = syntheticPng()
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
    alertStore.set({ type: 'none', msg: '' })
    shown = []
    unsubscribe = alertStore.subscribe((value) => { shown.push(value as alertData) })
    return () => {
        unsubscribe()
        vi.restoreAllMocks()
    }
})

/** Starts a PNG card export whose writer stops taking writes after `stallAfter`, and waits until it is stalled. */
async function stalledCardExport(stallAfter: number, type: 'png' | 'charx' = 'png'): Promise<{ result: Promise<boolean> }> {
    world.stallAfter = stallAfter
    const result = exportCharacterCard(syntheticCharacter(), type, { spec: 'v3' })
    await vi.waitFor(() => expect(world.writes.length).toBe(stallAfter + 1))
    return { result }
}

describe('a card export stalled mid-write', () => {
    test('(R) the dialog on screen at the stall carries a Cancel, and pressing it ends the export without an error', async () => {
        const { result } = await stalledCardExport(2)

        const dialog = get(alertStore) as alertData
        expect(dialog.onCancel).toBeTypeOf('function')
        expect(dialog.type).toBe('wait')
        dialog.onCancel?.()

        expect(await result).toBe(false)
        expect(world.errors).toEqual([])
    })

    test('(R) a stall inside the image chunks, before any progress, still shows a Cancel that ends the export and tells of the cut-off file', async () => {
        // Signature, header and three data chunks are written by the writer's own init; the fourth write never settles.
        world.png = syntheticPng(3)
        const { result } = await stalledCardExport(3)

        const dialog = get(alertStore) as alertData
        expect(dialog.type).toBe('wait')
        expect(dialog.onCancel).toBeTypeOf('function')
        expect(shown.filter((value) => value.msg.startsWith(language.alerts.addingCardAssets))).toEqual([])
        dialog.onCancel?.()

        expect(await result).toBe(false)
        expect(world.errors).toEqual([])
        expect(busyKinds()).not.toContain('export')
        const notice = get(alertStore) as alertData
        expect(notice.type).toBe('normal')
        expect(notice.msg).toBe(language.exportCancelledFileIncomplete)
        expect(world.aborts).toBe(1)
    })

    test('(N) the progress shows the percentage as text in a cancellable wait, not as a bar', async () => {
        const { result } = await stalledCardExport(2)

        const progress = shown.filter((value) => value.msg.startsWith(language.alerts.addingCardAssets))
        expect(progress.length).toBeGreaterThan(0)
        expect(progress.every((value) => value.type === 'wait' && value.onCancel !== undefined && /\(\d+\.\d\d%\)$/.test(value.msg))).toBe(true)
        expect(shown.filter((value) => value.type === 'progress')).toEqual([])

        ;(get(alertStore) as alertData).onCancel?.()
        await result
    })

    test('(N) a cancel after the stream opened says any saved file is incomplete, once; nothing is closed or reported as success', async () => {
        const { result } = await stalledCardExport(2)

        ;(get(alertStore) as alertData).onCancel?.()
        await result

        const notice = get(alertStore) as alertData
        expect(notice.type).toBe('normal')
        expect(notice.msg).toBe(language.exportCancelledFileIncomplete)
        expect(shown.filter((value) => value.msg === language.exportCancelledFileIncomplete)).toHaveLength(1)
        expect(shown.filter((value) => value.msg === language.successExport)).toEqual([])
        expect(world.aborts).toBe(1)
        expect(world.closes).toBe(0)
        expect(busyKinds()).not.toContain('export')
    })

    test('(N) a write that settles after the cancel posts nothing and closes nothing', async () => {
        const { result } = await stalledCardExport(2)
        ;(get(alertStore) as alertData).onCancel?.()
        await result
        const seen = shown.length

        for (const release of world.releases) {
            release()
        }
        for (let i = 0; i < 6; i++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }

        expect(shown).toHaveLength(seen)
        expect(world.closes).toBe(0)
    })

    test('(R) a CharX export is cancellable at its stall too', async () => {
        const { result } = await stalledCardExport(1, 'charx')

        const dialog = get(alertStore) as alertData
        expect(dialog.onCancel).toBeTypeOf('function')
        dialog.onCancel?.()

        expect(await result).toBe(false)
        expect(world.errors).toEqual([])
    })
})

describe('guards', () => {
    test('(G) a normal export is unchanged: it closes the file and reports success', async () => {
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(true)

        expect(world.closes).toBe(1)
        expect(world.aborts).toBe(0)
        expect(shown.filter((value) => value.msg === language.successExport)).toHaveLength(1)
    })

    test('(G) a JSON card export keeps its dialogs: nothing stalls, no Cancel is offered', async () => {
        const character = syntheticCharacter()
        expect(await exportCharacterCard(character, 'json', { spec: 'v3' })).toBe(true)

        expect(shown.filter((value) => value.onCancel !== undefined)).toEqual([])
        expect(shown.filter((value) => value.type === 'progress').length).toBeGreaterThan(0)
    })

    test('(G) a desktop card export keeps its progress bar and offers no Cancel', async () => {
        platformBox.isTauri = true
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(true)

        expect(shown.filter((value) => value.onCancel !== undefined)).toEqual([])
        expect(shown.filter((value) => value.type === 'progress').length).toBeGreaterThan(0)
    })
})

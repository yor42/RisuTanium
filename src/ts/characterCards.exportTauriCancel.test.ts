// @vitest-environment happy-dom

/**
 * The Cancel, the file-state notices and the dismissed save dialog of a desktop or Android card export (CHORE-375
 * stage C3). The real `exportCharacterCard`, `LocalWriter`, `TauriWriter`, `CharXWriter` and `exportWriters` run over
 * the real alert module and a working `alertStore`. Only the file system (`writeFile`, and `invoke` for the Android
 * `content://` document), the save dialog and the size and piece source of one large asset are replaced, and the calls
 * made are counted. A mocked file system is not evidence of native file behaviour.
 *
 * Labels: (R) reproducer, fails on the code before the change by assertion; (G) guard, passes with or without the
 * change; (N) new behaviour with nothing on the base to fail against.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { character } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})

const world = vi.hoisted(() => ({
    png: new Uint8Array() as Uint8Array,
    errors: [] as string[],
    // the path the save dialog returns; null is a dismissed dialog
    savePath: null as string | null,
    android: false,
    // every file-system call: the path, the number of bytes and whether it appended
    calls: [] as Array<{ path: string, length: number, append: boolean }>,
    // the call that starts after this many bytes were written waits until `release` is called
    holdAfterBytes: Number.POSITIVE_INFINITY,
    held: false,
    release: null as null | (() => void),
    // a key whose image read fails
    failRead: new Set<string>(),
    sizes: new Map<string, number>(),
    served: new Set<string>(),
}))

vi.mock('uuid', () => ({ v4: () => 'uuid-1' }))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => world.savePath),
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
    writeFile: vi.fn(async (path: string, data: Uint8Array, options?: { append?: boolean }) => {
        const written = world.calls.reduce((sum, call) => sum + call.length, 0)
        world.calls.push({ path, length: data.byteLength, append: options?.append === true })
        if (!world.held && written >= world.holdAfterBytes) {
            world.held = true
            await new Promise<void>((resolve) => { world.release = resolve })
        }
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
    readImage: vi.fn(async (key: string) => {
        if (world.failRead.has(key)) {
            throw new Error(`synthetic read failure of ${key}`)
        }
        return world.png
    }),
    loadAsset: vi.fn(async () => new Uint8Array()),
    saveAsset: vi.fn(async () => 'saved'),
}))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: vi.fn(async () => ({ bytes: null })),
        readValue: vi.fn(async (name: string) => {
            const size = world.sizes.get(name)
            return size === undefined ? null : new SizedBlob(size)
        }),
    })),
    getAppStoreKind: vi.fn(async () => 'tauri'),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

// The pieces of a served key: 4 MiB each of a fixed pattern, so the two passes read the same bytes.
vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...await importOriginal(),
    isDesktopTransport: () => !world.android,
    isAndroidTransport: () => world.android,
    transportKind: () => 'web',
    readRangedPieces: async function* (key: string) {
        const size = world.sizes.get(key)
        if (size === undefined || !world.served.has(key)) {
            throw new Error('the pre-check never reads pieces')
        }
        const piece = 4 * 1024 * 1024
        for (let offset = 0; offset < size; offset += piece) {
            yield { bytes: new Uint8Array(Math.min(piece, size - offset)).fill((offset / piece) & 255), offset, total: size, identity: 'id-1' }
        }
    },
    statStoredSize: async (key: string) => {
        const size = world.sizes.get(key)
        if (size === undefined) {
            throw new Error('size unknown')
        }
        return size
    },
}) as unknown as typeof import('src/ts/storage/tauriByteTransport'))

//#endregion

import { exportCharacterCard, exportOffersCancel } from 'src/ts/characterCards'
import { busyKinds } from 'src/ts/process/memory/busyActions'
import { alertStore } from 'src/ts/stores.svelte'
import { noteSelectedStore } from 'src/ts/storage/assetLimit'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { ExportCancelToken } from 'src/ts/exportCancel'
import { LocalWriter, VirtualWriter, readImage } from 'src/ts/globalApi.svelte'
import { alertError, type alertData } from 'src/ts/alert'

/** A Blob that reports a size and holds no bytes. */
class SizedBlob extends Blob {
    constructor(private readonly reported: number) { super([]) }
    get size() { return this.reported }
}

const MIB = 1024 * 1024
const key = (name: string) => `assets/${name.padEnd(64, '0')}.bin`
const BIG = key('big')

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

/** A card with three small assets, and the large one when `large` is set. */
function syntheticCharacter(large: boolean): character {
    const uris = [1, 2, 3].map((n) => `assets/a${n}`)
    if (large) {
        uris.unshift(BIG)
    }
    return {
        name: 'Synthetic',
        image: 'synthetic-image',
        globalLore: [],
        desc: 'd',
        firstMessage: 'hi',
        ccAssets: uris.map((uri, i) => ({ type: 'x-risu-asset', uri, name: large && i === 0 ? 'Big Video' : `asset${i}`, ext: 'png' })),
    } as unknown as character
}

function serveBig(): void {
    world.sizes.set(BIG, 65 * MIB)
    world.served.add(BIG)
}

let shown: alertData[] = []

beforeEach(() => {
    platformBox.isTauri = true
    world.png = syntheticPng()
    world.errors = []
    world.savePath = 'chosen.charx'
    world.android = false
    world.calls = []
    world.holdAfterBytes = Number.POSITIVE_INFINITY
    world.held = false
    world.release = null
    world.failRead.clear()
    world.sizes.clear()
    world.served.clear()
    noteSelectedStore('tauri', { read: vi.fn(), readValue: vi.fn() } as unknown as ByteStore)
    alertStore.set({ type: 'none', msg: '' })
    shown = []
    const unsubscribe = alertStore.subscribe((value) => { shown.push(value as alertData) })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.mocked(alertError).mockClear()
    vi.mocked(readImage).mockImplementation(async (name: string) => {
        if (world.failRead.has(name)) {
            throw new Error(`synthetic read failure of ${name}`)
        }
        return world.png
    })
    return () => {
        unsubscribe()
        world.release?.()
        vi.restoreAllMocks()
    }
})

describe('Cancel of a large-asset CharX export on Tauri', () => {
    test('(R) a cancel after 4 MiB were written ends the export with the reworded notice, and the file is not closed', async () => {
        serveBig()
        world.holdAfterBytes = 4 * MIB
        const result = exportCharacterCard(syntheticCharacter(true), 'charx', { spec: 'v3' })
        try {
            await vi.waitFor(() => expect(world.held).toBe(true))
            const callsAtCancel = world.calls.length

            const dialog = get(alertStore) as alertData
            expect(dialog.type).toBe('wait')
            expect(dialog.onCancel).toBeTypeOf('function')
            dialog.onCancel?.()
            world.release?.()

            expect(await result).toBe(false)
            const notice = get(alertStore) as alertData
            expect(notice.type).toBe('normal')
            expect(notice.msg).toBe(language.exportCancelledFileIncomplete)
            expect(world.errors).toEqual([])
            // only the call that was already in flight at the cancel ran
            expect(world.calls.length).toBe(callsAtCancel)
            expect(busyKinds()).not.toContain('export')
        } finally {
            // A failed assertion must not leave the export running into the next test's held write.
            world.release?.()
            await result.catch(() => false)
        }
    })

    test('(R) a cancel during a write of several 4 MiB slices lets only the slice in flight run', async () => {
        const writer = new LocalWriter()
        expect(await writer.init('x', ['charx'])).toBe(true)
        const token = new ExportCancelToken()
        writer.useCancel(token)
        world.holdAfterBytes = 0

        const written = writer.write(new Uint8Array(12 * MIB))
        const outcome = written.then(() => 'written', (error: unknown) => (error as Error).name)
        await vi.waitFor(() => expect(world.held).toBe(true))
        token.cancel()
        world.release?.()

        expect(await outcome).toBe('ExportCancelledError')
        for (let i = 0; i < 6; i++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        expect(world.calls).toHaveLength(1)
    })

    test('(G) a cancelled desktop file takes no later write or close, and the cancel is the failure they reject with', async () => {
        const writer = new LocalWriter()
        await writer.init('x', ['charx'])
        const token = new ExportCancelToken()
        writer.useCancel(token)
        await writer.write(new Uint8Array(8))
        token.cancel()
        await expect(writer.write(new Uint8Array(8))).rejects.toMatchObject({ name: 'ExportCancelledError' })
        await expect(writer.close()).rejects.toMatchObject({ name: 'ExportCancelledError' })
        expect(world.calls).toEqual([])
    })
})

describe('exportOffersCancel', () => {
    const base = { writer: undefined, type: 'charx' as const, tauri: true, largeAssetCount: 1 }

    test('(N) Tauri offers Cancel for a CharX or CharX-JPEG with a large asset only', () => {
        expect(exportOffersCancel(base)).toBe(true)
        expect(exportOffersCancel({ ...base, type: 'charxJpeg' })).toBe(true)
        expect(exportOffersCancel({ ...base, largeAssetCount: 0 })).toBe(false)
        expect(exportOffersCancel({ ...base, type: 'png' })).toBe(false)
        expect(exportOffersCancel({ ...base, type: 'json' })).toBe(false)
    })

    test('(N) the web offers Cancel for every file export but JSON, large asset or not', () => {
        expect(exportOffersCancel({ ...base, tauri: false, largeAssetCount: 0 })).toBe(true)
        expect(exportOffersCancel({ ...base, tauri: false, type: 'png', largeAssetCount: 0 })).toBe(true)
        expect(exportOffersCancel({ ...base, tauri: false, type: 'json' })).toBe(false)
    })

    test('(N) a writer that is not a LocalWriter gets no Cancel', () => {
        expect(exportOffersCancel({ ...base, writer: new VirtualWriter() })).toBe(false)
        expect(exportOffersCancel({ ...base, writer: new LocalWriter() })).toBe(true)
    })
})

describe('no Cancel without a large asset', () => {
    test('(G) a desktop CharX with small assets only keeps its progress and offers no Cancel', async () => {
        expect(await exportCharacterCard(syntheticCharacter(false), 'charx', { spec: 'v3' })).toBe(true)

        expect(shown.filter((value) => value.onCancel !== undefined)).toEqual([])
        expect(shown.filter((value) => value.type === 'progress').length).toBeGreaterThan(0)
    })
})

describe('a failure after the file was opened', () => {
    test('(G) a failure before any call reached a desktop file adds no sentence', async () => {
        world.failRead.add('assets/a2')
        expect(await exportCharacterCard(syntheticCharacter(false), 'charx', { spec: 'v3' })).toBe(false)

        expect(world.calls).toEqual([])
        expect(world.errors).toEqual(['synthetic read failure of assets/a2'])
    })

    test('(R) a failure after the Android document was created adds the sentence, though no byte was written', async () => {
        world.android = true
        world.savePath = 'content://documents/1'
        world.failRead.add('assets/a2')
        expect(await exportCharacterCard(syntheticCharacter(false), 'charx', { spec: 'v3' })).toBe(false)

        expect(world.calls).toEqual([])
        expect(world.errors).toEqual(['synthetic read failure of assets/a2\n' + language.exportFailedFileIncomplete])
    })

    test('(G) a content:// path off the Android transport is still untouched before its first call', async () => {
        world.savePath = 'content://documents/1'
        world.failRead.add('assets/a2')
        expect(await exportCharacterCard(syntheticCharacter(false), 'charx', { spec: 'v3' })).toBe(false)

        expect(world.errors).toEqual(['synthetic read failure of assets/a2'])
    })

    test('(N) a failure that is not an Error keeps its text and gets the sentence once', async () => {
        world.android = true
        world.savePath = 'content://documents/1'
        vi.mocked(readImage).mockImplementation(async (name: string) => {
            if (name === 'assets/a2') {
                throw 'plain string failure'
            }
            return world.png
        })
        expect(await exportCharacterCard(syntheticCharacter(false), 'charx', { spec: 'v3' })).toBe(false)

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(world.errors).toEqual(['plain string failure\n' + language.exportFailedFileIncomplete])
    })
})

describe('the failure text of a kept file', () => {
    test('(N) a thrown object is shown as the alert shows it, with the sentence after it', async () => {
        world.android = true
        world.savePath = 'content://documents/1'
        vi.mocked(readImage).mockImplementation(async (name: string) => {
            if (name === 'assets/a2') {
                throw { code: 7 }
            }
            return world.png
        })
        expect(await exportCharacterCard(syntheticCharacter(false), 'charx', { spec: 'v3' })).toBe(false)

        expect(world.errors).toEqual(['{"code":7}\n' + language.exportFailedFileIncomplete])
    })
})

describe('a dismissed save dialog', () => {
    test('(R) a small desktop export is not exported, shows no error and leaves no dialog', async () => {
        world.savePath = null
        expect(await exportCharacterCard(syntheticCharacter(false), 'charx', { spec: 'v3' })).toBe(false)

        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(world.errors).toEqual([])
        expect((get(alertStore) as alertData).type).toBe('none')
        expect(shown.filter((value) => value.type === 'normal' || value.type === 'error')).toEqual([])
        expect(world.calls).toEqual([])
    })

    test('(R) a large-asset desktop CharX removes its wait dialog, shows no error and writes nothing', async () => {
        serveBig()
        world.savePath = null
        expect(await exportCharacterCard(syntheticCharacter(true), 'charx', { spec: 'v3' })).toBe(false)

        expect(shown.some((value) => value.type === 'wait' && value.onCancel !== undefined)).toBe(true)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(world.errors).toEqual([])
        expect((get(alertStore) as alertData).type).toBe('none')
        expect(world.calls).toEqual([])
    })
})

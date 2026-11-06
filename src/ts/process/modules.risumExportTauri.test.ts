// @vitest-environment happy-dom

/**
 * The streamed `.risum` export of a desktop or Android build (CHORE-635 stage B): the save dialog opens first, records
 * stream one at a time through the real `LocalWriter` and `TauriWriter`, the terminator is the last byte, the success
 * notice follows `close()`, and a Cancel is offered for any module with an asset. The real `exportModuleLegacy`,
 * `exportOffersCancel`, `LocalWriter`, `TauriWriter` and the real alert module over a working `alertStore` run. Only
 * the file system (`writeFile`, and `invoke` for the Android `content://` document), the save dialog, the asset reads
 * and the RPack table (a fixed invertible byte map) are replaced. A mocked file system is not evidence of native file
 * behaviour.
 *
 * This file also carries the scenarios that need the real writers on a desktop build and a held call: the ordered
 * read/write log, the terminator, the failure path, the cancel before any file call, and a module without assets.
 *
 * Labels: (R) reproducer, fails on the code before the change by assertion; (G) guard, passes with or without the
 * change; (N) new behaviour with nothing on the base to fail against.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import { language } from 'src/lang'

//#region module mocks

type WorldEvent =
    | { k: 'save', options: unknown }
    | { k: 'read', key: string, busy: boolean }
    | { k: 'encode', main: boolean }
    | { k: 'write', bytes: Uint8Array }
    | { k: 'close' }
    | { k: 'abort' }

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})

const world = vi.hoisted(() => ({
    errors: [] as string[],
    // the path the save dialog returns; null is a dismissed dialog
    savePath: null as string | null,
    // while set, the save dialog does not answer
    saveGate: null as null | Promise<void>,
    android: false,
    // every file-system call: the path, the bytes and whether it appended
    calls: [] as Array<{ path: string, bytes: Uint8Array, append: boolean }>,
    // the call that starts after this many bytes were written waits until `release` is called
    holdAfterBytes: Number.POSITIVE_INFINITY,
    held: false,
    release: null as null | (() => void),
    // the `export_append_b64` call (1-based) that fails
    failInvokeAt: 0,
    invokeCount: 0,
    // while set, `close` does not return
    closeGate: null as null | Promise<void>,
    // a key whose image read fails
    failRead: new Set<string>(),
    // the bytes a key reads as; an unlisted key reads as the small png
    assets: new Map<string, Uint8Array>(),
    png: new Uint8Array() as Uint8Array,
    log: [] as unknown[],
}))

vi.mock('uuid', () => ({ v4: () => 'uuid-1' }))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (options?: unknown): Promise<string | null> => {
        world.log.push({ k: 'save', options })
        await world.saveGate
        return world.savePath
    }),
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
        const written = world.calls.reduce((sum, call) => sum + call.bytes.byteLength, 0)
        world.calls.push({ path, bytes: data.slice(), append: options?.append === true })
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
        world.invokeCount += 1
        if (world.invokeCount === world.failInvokeAt) {
            throw new Error('synthetic append failure')
        }
        const bytes = Uint8Array.from(Buffer.from(args.data, 'base64'))
        const written = world.calls.reduce((sum, call) => sum + call.bytes.byteLength, 0)
        world.calls.push({ path: args.uri, bytes, append: false })
        if (!world.held && written >= world.holdAfterBytes) {
            world.held = true
            await new Promise<void>((resolve) => { world.release = resolve })
        }
        return { written: bytes.byteLength }
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

// A fixed invertible byte map in place of the RPack table (3 is added after multiplying by 7).
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => {
        world.log.push({ k: 'encode', main: data[0] === 0x7b })
        return Uint8Array.from(data, (b) => (b * 7 + 3) & 0xff)
    }),
    decodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, (b) => ((b - 3 + 256) * 183) & 0xff)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

// `readImage` is the one function of `globalApi.svelte` that is replaced, so the module needs no asset store.
vi.mock('src/ts/globalApi.svelte', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/globalApi.svelte')>()),
    readImage: vi.fn(async (key: string) => {
        const { busyKinds } = await import('src/ts/process/memory/busyActions')
        world.log.push({ k: 'read', key, busy: busyKinds().includes('export') })
        if (world.failRead.has(key)) {
            throw new Error(`synthetic read failure of ${key}`)
        }
        return world.assets.get(key) ?? world.png
    }),
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

import { exportModuleLegacy, type RisuModule } from 'src/ts/process/modules'
import { busyKinds } from 'src/ts/process/memory/busyActions'
import { alertStore } from 'src/ts/stores.svelte'
import { noteSelectedStore } from 'src/ts/storage/assetLimit'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { LocalWriter } from 'src/ts/globalApi.svelte'
import type { alertData } from 'src/ts/alert'

const MIB = 1024 * 1024

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

function moduleOf(count: number): RisuModule {
    return {
        name: 'Synthetic Module',
        description: 'd',
        id: 'module-1',
        assets: Array.from({ length: count }, (_, i) => [`asset${i + 1}`, `assets/a${i + 1}`, 'png'] as [string, string, string]),
    }
}

/** The file as the former whole-file builder wrote it, for the given record bodies (already mapped by the RPack stand-in). */
const mapBytes = (data: Uint8Array) => Uint8Array.from(data, (b) => (b * 7 + 3) & 0xff)

function referenceMain(mod: RisuModule): Uint8Array {
    const blanked = { ...mod, assets: (mod.assets ?? []).map((asset) => [asset[0], '', asset[2]]) }
    return mapBytes(Buffer.from(JSON.stringify({ module: blanked, type: 'risuModule' }, null, 2), 'utf-8'))
}

function referenceRisum(mod: RisuModule, bodies: Uint8Array[]): Buffer {
    const map = mapBytes
    const main = referenceMain(mod)
    const parts: Buffer[] = [Buffer.from([111, 0])]
    const length = (n: number) => {
        const out = Buffer.alloc(4)
        out.writeUInt32LE(n, 0)
        return out
    }
    parts.push(length(main.length), Buffer.from(main))
    for (const body of bodies) {
        const mapped = map(body)
        parts.push(Buffer.from([1]), length(mapped.length), Buffer.from(mapped))
    }
    parts.push(Buffer.from([0]))
    return Buffer.concat(parts)
}

function events(): WorldEvent[] {
    return world.log as WorldEvent[]
}

function fileBytes(): Buffer {
    return Buffer.concat(world.calls.map((call) => call.bytes))
}

async function runExport(mod: RisuModule, arg?: { alertEnd?: boolean }): Promise<{ result: Uint8Array | null | undefined, error: unknown }> {
    try {
        return { result: await exportModuleLegacy(mod, arg), error: undefined }
    } catch (error) {
        return { result: undefined, error }
    }
}

let shown: alertData[] = []
const noticeCount = (msg: string) => shown.filter((value) => value.msg === msg).length

beforeEach(() => {
    platformBox.isTauri = true
    world.errors = []
    world.savePath = 'chosen.risum'
    world.saveGate = null
    world.android = false
    world.calls = []
    world.holdAfterBytes = Number.POSITIVE_INFINITY
    world.held = false
    world.release = null
    world.failInvokeAt = 0
    world.invokeCount = 0
    world.closeGate = null
    world.failRead.clear()
    world.assets = new Map()
    world.png = syntheticPng()
    world.log = []
    noteSelectedStore('tauri', { read: vi.fn(), readValue: vi.fn() } as unknown as ByteStore)
    alertStore.set({ type: 'none', msg: '' })
    shown = []
    const unsubscribe = alertStore.subscribe((value) => { shown.push(value as alertData) })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    const realWrite = LocalWriter.prototype.write
    const realClose = LocalWriter.prototype.close
    const realAbort = LocalWriter.prototype.abort
    vi.spyOn(LocalWriter.prototype, 'write').mockImplementation(async function (this: LocalWriter, data: Uint8Array) {
        world.log.push({ k: 'write', bytes: data.slice() })
        return realWrite.call(this, data)
    })
    vi.spyOn(LocalWriter.prototype, 'close').mockImplementation(async function (this: LocalWriter) {
        world.log.push({ k: 'close' })
        await world.closeGate
        return realClose.call(this)
    })
    vi.spyOn(LocalWriter.prototype, 'abort').mockImplementation(function (this: LocalWriter, reason: unknown) {
        world.log.push({ k: 'abort' })
        return realAbort.call(this, reason)
    })
    return () => {
        unsubscribe()
        world.release?.()
        vi.restoreAllMocks()
    }
})

describe('the save dialog opens first', () => {
    test('(R) desktop: the dialog opens once, before any asset is read or the main block is encoded, and the file goes to the chosen path', async () => {
        const outcome = await runExport(moduleOf(2), { alertEnd: false })

        expect(outcome.error).toBeUndefined()
        const saves = events().filter((event) => event.k === 'save')
        expect(saves).toHaveLength(1)
        expect(saves[0]).toMatchObject({ options: { defaultPath: 'Synthetic Module.risum', filters: [{ name: 'RisuM File', extensions: ['risum'] }] } })
        const saveAt = events().findIndex((event) => event.k === 'save')
        expect(saveAt).toBeLessThan(events().findIndex((event) => event.k === 'read'))
        expect(saveAt).toBeLessThan(events().findIndex((event) => event.k === 'encode' && event.main))
        expect(world.calls.length).toBeGreaterThan(0)
        expect(world.calls.every((call) => call.path === 'chosen.risum')).toBe(true)
    })

    test('(R) Android: a dismissed picker reads nothing, says nothing and leaves nothing busy', async () => {
        world.android = true
        world.savePath = null
        const outcome = await runExport(moduleOf(2))

        expect(events().filter((event) => event.k === 'read')).toEqual([])
        expect(outcome.error).toBeUndefined()
        expect(outcome.result).toBeNull()
        expect(world.errors).toEqual([])
        expect(shown.filter((value) => value.type === 'normal' || value.type === 'error')).toEqual([])
        expect((get(alertStore) as alertData).type).toBe('none')
        expect(world.calls).toEqual([])
        expect(busyKinds()).not.toContain('export')
    })

    test('(R) desktop: a dismissed dialog reads nothing, removes its Cancel dialog and shows no error', async () => {
        world.savePath = null
        const outcome = await runExport(moduleOf(2))

        expect(events().filter((event) => event.k === 'read')).toEqual([])
        expect(outcome.result).toBeNull()
        expect(shown.some((value) => value.type === 'wait' && value.onCancel !== undefined)).toBe(true)
        expect((get(alertStore) as alertData).type).toBe('none')
        expect(world.errors).toEqual([])
        expect(world.calls).toEqual([])
    })
})

describe('records stream one at a time', () => {
    test('(R) the export is busy while a record is read', async () => {
        await runExport(moduleOf(2), { alertEnd: false })

        const reads = events().filter((event) => event.k === 'read')
        expect(reads).toHaveLength(2)
        expect(reads.every((event) => event.k === 'read' && event.busy)).toBe(true)
        expect(busyKinds()).not.toContain('export')
    })

    test('(R) asset j+1 is read only after record j was handed to the writer, and no write exceeds the largest body or the main block', async () => {
        world.assets.set('assets/a2', new Uint8Array(50).fill(9))
        await runExport(moduleOf(3), { alertEnd: false })

        const sequence = events().flatMap((event) => event.k === 'read' ? [`read ${event.key}`] : event.k === 'write' ? [`write ${event.bytes.length}`] : event.k === 'close' ? ['close'] : [])
        const mainLength = referenceMain(moduleOf(3)).length
        const png = world.png.length
        expect(sequence).toEqual([
            'write 6', `write ${mainLength}`,
            'read assets/a1', 'write 5', `write ${png}`,
            'read assets/a2', 'write 5', 'write 50',
            'read assets/a3', 'write 5', `write ${png}`,
            'write 1', 'close',
        ])
    })

    test('(G) the written file is byte-identical to the former whole-file layout', async () => {
        world.assets.set('assets/a2', new Uint8Array(300).map((_, i) => i & 255))
        await runExport(moduleOf(3), { alertEnd: false })

        const expected = referenceRisum(moduleOf(3), [world.png, world.assets.get('assets/a2') as Uint8Array, world.png])
        expect(fileBytes().equals(expected)).toBe(true)
    })

    test('(G) a module without assets completes with the head, the main block and the terminator, and shows no Cancel', async () => {
        const outcome = await runExport(moduleOf(0), { alertEnd: false })

        expect(outcome.error).toBeUndefined()
        expect(fileBytes().equals(referenceRisum(moduleOf(0), []))).toBe(true)
        expect(shown.filter((value) => value.onCancel !== undefined)).toEqual([])
        expect(events().filter((event) => event.k === 'read')).toEqual([])
        expect(world.errors).toEqual([])
    })

    test('(G) a 5 MiB body passes through whole and the terminator is still the last byte of the file', async () => {
        world.assets.set('assets/a1', new Uint8Array(5 * MIB).fill(4))
        await runExport(moduleOf(1), { alertEnd: false })

        const bytes = fileBytes()
        expect(bytes.length).toBe(referenceRisum(moduleOf(1), [new Uint8Array(5 * MIB).fill(4)]).length)
        expect(bytes[bytes.length - 1]).toBe(0)
        expect(Math.max(...world.calls.map((call) => call.bytes.length))).toBeLessThanOrEqual(4 * MIB)
    })
})

describe('success follows close', () => {
    test('(N) the success notice is posted once, only after close() resolved', async () => {
        let open: () => void = () => { }
        world.closeGate = new Promise<void>((resolve) => { open = resolve })
        const done = runExport(moduleOf(1))
        try {
            await vi.waitFor(() => expect(events().some((event) => event.k === 'close')).toBe(true))
            await new Promise<void>((resolve) => setTimeout(resolve, 5))
            expect(noticeCount(language.successExportChosenLocation)).toBe(0)
        } finally {
            open()
        }
        await done

        expect(noticeCount(language.successExportChosenLocation)).toBe(1)
    })

    test('(R) desktop: the notice names the chosen location, never the download directory', async () => {
        await runExport(moduleOf(1))

        expect(noticeCount(language.successExportChosenLocation)).toBe(1)
        expect(noticeCount(language.successExport)).toBe(0)
        expect(language.successExportChosenLocation).not.toBe(language.successExport)
    })

    test('(G) web: the notice says the download started, never that the file went to a chosen location', async () => {
        platformBox.isTauri = false
        vi.spyOn(LocalWriter.prototype, 'init').mockImplementation(async () => true)
        vi.spyOn(LocalWriter.prototype, 'write').mockImplementation(async () => { })
        vi.spyOn(LocalWriter.prototype, 'close').mockImplementation(async () => { })
        const outcome = await runExport(moduleOf(1))

        expect(outcome.error).toBeUndefined()
        expect(noticeCount(language.exportDownloadStarted)).toBe(1)
        expect(noticeCount(language.successExportChosenLocation)).toBe(0)
        expect(language.exportDownloadStarted).not.toBe(language.successExportChosenLocation)
    })

    test('(N) with alertEnd false there is no notice and the Cancel dialog is gone after success', async () => {
        const outcome = await runExport(moduleOf(2), { alertEnd: false })

        expect(outcome.error).toBeUndefined()
        expect(noticeCount(language.successExportChosenLocation)).toBe(0)
        expect(shown.some((value) => value.type === 'wait' && value.onCancel !== undefined)).toBe(true)
        expect((get(alertStore) as alertData).type).toBe('none')
    })

    test('(N) the last write before close is the single terminator byte 0', async () => {
        await runExport(moduleOf(2), { alertEnd: false })

        const log = events()
        const closeAt = log.findIndex((event) => event.k === 'close')
        expect(closeAt).toBeGreaterThan(0)
        const last = log[closeAt - 1]
        expect(last.k).toBe('write')
        expect(last.k === 'write' ? Array.from(last.bytes) : null).toEqual([0])
        expect(log.slice(closeAt + 1)).toEqual([])
    })
})

describe('a failure', () => {
    test('(N) a failing read stops the stream: no later write, no close, no terminator, and the text is shown', async () => {
        world.failRead.add('assets/a2')
        const outcome = await runExport(moduleOf(3))

        expect(outcome.error).toBeUndefined()
        expect(outcome.result).toBeNull()
        const log = events()
        const failedAt = log.findIndex((event) => event.k === 'read' && event.key === 'assets/a2')
        expect(failedAt).toBeGreaterThan(-1)
        expect(log.slice(failedAt + 1).filter((event) => event.k === 'write' || event.k === 'close')).toEqual([])
        expect(log.some((event) => event.k === 'abort')).toBe(true)
        expect(world.errors).toEqual(['synthetic read failure of assets/a2'])
        expect(world.calls).toEqual([])
    })

    test('(R) Android: a failing write after the picker resolves null, aborts the writer and says the file is incomplete', async () => {
        world.android = true
        world.savePath = 'content://documents/1'
        world.failInvokeAt = 1
        const outcome = await runExport(moduleOf(2))

        expect(outcome.error).toBeUndefined()
        expect(outcome.result).toBeNull()
        expect(world.errors).toEqual(['synthetic append failure\n' + language.exportFailedFileIncomplete])
        expect(events().filter((event) => event.k === 'abort')).toHaveLength(1)
        expect(noticeCount(language.successExportChosenLocation)).toBe(0)
    })
})

describe('Cancel', () => {
    test('(R) desktop, a held file call: the dialog carries Cancel, and pressing it gives the incomplete notice once and no close', async () => {
        world.assets.set('assets/a1', new Uint8Array(5 * MIB).fill(4))
        world.holdAfterBytes = 0
        const done = runExport(moduleOf(1))
        try {
            await vi.waitFor(() => expect(world.held).toBe(true))
            const callsAtCancel = world.calls.length
            const dialog = get(alertStore) as alertData
            expect(dialog.type).toBe('wait')
            expect(dialog.onCancel).toBeTypeOf('function')
            dialog.onCancel?.()
            world.release?.()
            const outcome = await done

            expect(outcome.error).toBeUndefined()
            expect(outcome.result).toBeNull()
            expect(noticeCount(language.exportCancelledFileIncomplete)).toBe(1)
            expect((get(alertStore) as alertData).msg).toBe(language.exportCancelledFileIncomplete)
            expect(world.errors).toEqual([])
            expect(events().some((event) => event.k === 'close')).toBe(false)
            expect(world.calls.length).toBe(callsAtCancel)
            expect(busyKinds()).not.toContain('export')
        } finally {
            world.release?.()
            await done
        }
    })

    test('(R) Android, a held append: the dialog carries Cancel, and pressing it gives the incomplete notice once and no close', async () => {
        world.android = true
        world.savePath = 'content://documents/1'
        world.assets.set('assets/a1', new Uint8Array(5 * MIB).fill(4))
        world.holdAfterBytes = 0
        const done = runExport(moduleOf(1))
        try {
            await vi.waitFor(() => expect(world.held).toBe(true))
            const dialog = get(alertStore) as alertData
            expect(dialog.onCancel).toBeTypeOf('function')
            dialog.onCancel?.()
            world.release?.()
            const outcome = await done

            expect(outcome.result).toBeNull()
            expect(noticeCount(language.exportCancelledFileIncomplete)).toBe(1)
            expect(world.errors).toEqual([])
            expect(events().some((event) => event.k === 'close')).toBe(false)
        } finally {
            world.release?.()
            await done
        }
    })

    test('(N) desktop, a cancel while the dialog is open and before any file call: no notice, no error, no read, no file call', async () => {
        let answer: () => void = () => { }
        world.saveGate = new Promise<void>((resolve) => { answer = resolve })
        const done = runExport(moduleOf(2))
        try {
            await vi.waitFor(() => expect(events().some((event) => event.k === 'save')).toBe(true))
            const dialog = get(alertStore) as alertData
            expect(dialog.onCancel).toBeTypeOf('function')
            dialog.onCancel?.()
        } finally {
            answer()
        }
        const outcome = await done

        expect(outcome.error).toBeUndefined()
        expect(outcome.result).toBeNull()
        expect(shown.filter((value) => value.type === 'normal' || value.type === 'error')).toEqual([])
        expect(world.errors).toEqual([])
        expect(events().filter((event) => event.k === 'read')).toEqual([])
        expect(world.calls).toEqual([])
    })
})

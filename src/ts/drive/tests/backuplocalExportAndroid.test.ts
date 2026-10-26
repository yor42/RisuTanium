// @vitest-environment happy-dom

/**
 * `SaveLocalBackup` (`src/ts/drive/backuplocal.ts`) on an Android page: the
 * export lists assets with `list_assets_sized` and reads them in
 * `get_assets_batch` calls, and not one `read_range` per asset. The page's own
 * `listAssetsSized`, `readAssetBatch` and `parseReadFrames` run for real over an
 * `invoke` stand-in that follows the frame rules of the Rust command (a missing
 * file, `large` above the batch limit, a response budget after which every later
 * key answers `deferred`), and answers as an `ArrayBuffer` or, when switched, as
 * a number array, the two forms the Android bridge delivers. A mocked command is
 * not evidence about the native backend or the bridge; the Rust side is covered
 * by the `asset_batch` tests of `src-tauri`.
 *
 * Pinned: batched reads with exact call counts; at most the Android reader's
 * calls outstanding; the number-array reply; the oversize question for an asset
 * at the limit; a failed or malformed batch, a failed listing and a batch
 * `missing` each lose no asset silently; the export phases reach the ring only
 * under the measurement key.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})
const BACKUP_PATH = vi.hoisted(() => 'backup-output.bin')
const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const osBox = vi.hoisted(() => ({ os: 'android' }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 8 * 1024 * 1024 }))

/** The Android bridge stand-in: what it was asked, and how it answers. */
const bridge = vi.hoisted(() => ({
    /** Every command that reached it, in order, with the keys a read named. */
    calls: [] as { command: string, keys: string[], len?: number }[],
    /** Answers `get_assets_batch` as a number array instead of an ArrayBuffer. */
    asNumberArray: false,
    /** Makes `list_assets_sized` reject. */
    failListing: false,
    /** Makes `get_assets_batch` reject as a whole. */
    rejectBatch: false,
    /** Makes `get_assets_batch` answer this value instead of frames. */
    junkReply: undefined as unknown,
    /** Keys answered `missing` though their file exists. */
    forceMissing: new Set<string>(),
    /** Sizes the listing reports instead of the files' own. */
    listedSizes: new Map<string, number>(),
    /** `get_assets_batch` calls running now and the most at once. */
    outstanding: 0,
    maxOutstanding: 0,
    /** Holds every `get_assets_batch` call until it resolves. */
    hold: null as Promise<void> | null,
}))

/** Response budget of one `get_assets_batch` call and the size above which a file answers `large`. */
const RUST_RESPONSE_MAX = 4 * 1024 * 1024

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { },
    isAppInitiatedReload: () => false,
}) as unknown as typeof import('src/ts/reloadGuard'))

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

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))

vi.mock('@tauri-apps/plugin-fs', () => ({
    ...fakeFs.module,
    writeFile: async (path: string, data: Uint8Array, options?: { createNew?: boolean, baseDir?: number }) => {
        if (path === BACKUP_PATH) {
            backupSink.writes.push(data.slice())
            return
        }
        await fakeFs.module.writeFile(path, data, options)
    },
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => BACKUP_PATH),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] })),
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

const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertMdMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: alertMdMock,
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

/** Answers one `get_assets_batch` call with the frame rules of the Rust command. */
function batchReply(keys: readonly string[]): ArrayBuffer {
    const frames: Uint8Array[] = []
    let served = 0
    let exhausted = false
    const push = (status: number, body: Uint8Array) => {
        const frame = new Uint8Array(5 + body.length)
        frame[0] = status
        new DataView(frame.buffer).setUint32(1, body.length, true)
        frame.set(body, 5)
        frames.push(frame)
    }
    for (const key of keys) {
        const file = fakeFs.files.get(key)
        if (exhausted) {
            // Once the budget is spent, every later key is deferred, even a missing or large one.
            push(5, new Uint8Array(0))
        } else if (file === undefined || bridge.forceMissing.has(key)) {
            push(1, new Uint8Array(0))
        } else if (file.length > RUST_RESPONSE_MAX) {
            push(4, new Uint8Array(0))
        } else if (served > 0 && served + file.length > RUST_RESPONSE_MAX) {
            // The first key that does not fit is asked for again later.
            exhausted = true
            push(5, new Uint8Array(0))
        } else {
            served += file.length
            push(0, file)
        }
    }
    const out = new Uint8Array(frames.reduce((n, frame) => n + frame.length, 0))
    let offset = 0
    for (const frame of frames) {
        out.set(frame, offset)
        offset += frame.length
    }
    return out.buffer
}

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: async (command: string, args?: unknown, options?: unknown) => {
        if (command === 'list_assets_sized') {
            bridge.calls.push({ command, keys: [] })
            if (bridge.failListing) {
                throw new Error('scratch: the listing command failed')
            }
            return fakeFs.listing('assets').map((name) => {
                const key = `assets/${name}`
                return [key, bridge.listedSizes.get(key) ?? fakeFs.files.get(key)?.length ?? 0]
            })
        }
        if (command === 'get_assets_batch') {
            const keys = (args as { keys: string[] }).keys
            bridge.calls.push({ command, keys: [...keys] })
            bridge.outstanding += 1
            bridge.maxOutstanding = Math.max(bridge.maxOutstanding, bridge.outstanding)
            try {
                await Promise.resolve()
                if (bridge.hold !== null) {
                    await bridge.hold
                }
                if (bridge.rejectBatch) {
                    throw new Error('scratch: the bridge went away')
                }
                if (bridge.junkReply !== undefined) {
                    return bridge.junkReply
                }
                const reply = batchReply(keys)
                return bridge.asNumberArray ? Array.from(new Uint8Array(reply)) : reply
            } finally {
                bridge.outstanding -= 1
            }
        }
        if (command === 'read_range') {
            bridge.calls.push({ command, keys: [(args as { key: string }).key], len: (args as { len: number }).len })
        }
        return (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options)
    },
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

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { getColdStorageBackupKey } = await import('src/ts/process/coldstorageData')
    return {
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        getColdStorageBackupKey,
        getColdStorageItem: vi.fn(async () => null),
        isColdStorageBackupData: vi.fn(() => true),
        listColdDataKeys: vi.fn(async () => []),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { getDatabase } from 'src/ts/storage/database.svelte'
import { readAppInlayRecord, writeAppInlay, type InlayAsset } from 'src/ts/process/files/inlayStore'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { CHUNK_MAX, resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import type { ImportPhaseRingHandle } from 'src/ts/drive/importPhaseRing'

//#region helpers

const MIB = 1024 * 1024
const OVERSIZE_PROMPT = 'item(s)'

function patterned(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        out[i] = (i * 13 + seed) % 251
    }
    return out
}

function same(actual: Uint8Array | undefined, expected: Uint8Array | undefined): boolean {
    return actual !== undefined && expected !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

/** Plants `count` small assets `s000.png`..; each has its own length and bytes. */
function plantSmall(count: number, size = 500): string[] {
    const keys: string[] = []
    for (let i = 0; i < count; i++) {
        const key = `assets/s${String(i).padStart(4, '0')}.png`
        fakeFs.plant(key, patterned(size + (i % 7), i))
        keys.push(key)
    }
    return keys
}

/** The entries of the export written to the sink, in order, with the database entry last. */
function exportedEntries(): { name: string, data: Uint8Array }[] {
    const total = backupSink.writes.reduce((n, part) => n + part.length, 0)
    const bytes = new Uint8Array(total)
    let at = 0
    for (const part of backupSink.writes) {
        bytes.set(part, at)
        at += part.length
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const out: { name: string, data: Uint8Array }[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        out.push({ name, data: bytes.subarray(offset, offset + dataLength) })
        offset += dataLength
    }
    return out
}

/** The asset entries by their name in the file (the file keeps the name without `assets/`). */
function exportedAssets(): Map<string, Uint8Array> {
    return new Map(exportedEntries().filter((entry) => entry.name !== 'database.risudat').map((entry) => [entry.name, entry.data]))
}

function expectEveryAssetExported(keys: readonly string[]): void {
    const written = exportedAssets()
    expect([...written.keys()].sort()).toEqual(keys.map((key) => key.slice('assets/'.length)).sort())
    for (const key of keys) {
        expect(same(written.get(key.slice('assets/'.length)), fakeFs.files.get(key)), key).toBe(true)
    }
}

const commandCalls = (command: string) => bridge.calls.filter((call) => call.command === command)
const oversizePrompts = (): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((text) => text.includes(OVERSIZE_PROMPT))

function ring(): ImportPhaseRingHandle | undefined {
    return (globalThis as { __risuImportPhases?: ImportPhaseRingHandle }).__risuImportPhases
}

//#endregion

let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    platformBox.isTauri = true
    osBox.os = 'android'
    backupSink.writes.length = 0
    desktop.reset()
    bridge.calls.length = 0
    bridge.asNumberArray = false
    bridge.failListing = false
    bridge.rejectBatch = false
    bridge.junkReply = undefined
    bridge.forceMissing.clear()
    bridge.listedSizes.clear()
    bridge.outstanding = 0
    bridge.maxOutstanding = 0
    bridge.hold = null
    resetByteTransportForTests()
    resetAssetBatchAvailabilityForTests()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    vi.mocked(getDatabase).mockImplementation(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
    alertMdMock.mockClear()
    alertErrorMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
    localStorage.removeItem('risu-measure-import')
    ring()?.reset()
})

afterEach(() => {
    resetBusyActionsForTest()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
    localStorage.removeItem('risu-measure-import')
})

describe('an export on an Android page', () => {
    // Regression reproducer: before the batched read was turned on for Android, the sized listing and the batch command
    // were never called and every asset was its own ranged read.
    test('lists once, reads the small assets in ceil(N / 256) batch calls, and reads only the large asset with the ranged reader', async () => {
        const small = plantSmall(300)
        const large = patterned(5 * MIB, 9)
        fakeFs.plant('assets/z-large.bin', large)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(commandCalls('list_assets_sized')).toHaveLength(1)
        expect(commandCalls('get_assets_batch')).toHaveLength(Math.ceil(300 / 256))
        expect(commandCalls('get_assets_batch').flatMap((call) => call.keys)).toEqual(small)
        const ranged = commandCalls('read_range')
        expect(ranged.length).toBeGreaterThanOrEqual(1)
        expect(ranged.every((call) => call.keys[0] === 'assets/z-large.bin')).toBe(true)
        expectEveryAssetExported([...small, 'assets/z-large.bin'])
        expect(outcome.status === 'saved' && outcome.omitted.assets).toEqual([])
    })

    // The reader's limits on Android: two calls outstanding at most. Desktop limits would allow four.
    test('keeps at most two get_assets_batch calls outstanding', async () => {
        const keys = plantSmall(256 * 6, 40)
        let release: () => void = () => { }
        bridge.hold = new Promise<void>((resolve) => { release = resolve })

        const exporting = SaveLocalBackup()
        await vi.waitFor(() => { expect(commandCalls('get_assets_batch').length).toBeGreaterThanOrEqual(2) })
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(bridge.maxOutstanding).toBe(2)
        expect(commandCalls('get_assets_batch')).toHaveLength(2)
        release()
        const outcome = await exporting

        expect(outcome.status).toBe('saved')
        expect(bridge.maxOutstanding).toBe(2)
        expect(commandCalls('get_assets_batch')).toHaveLength(6)
        expectEveryAssetExported(keys)
    })

    test('a key the command defers for its response budget is asked for again, and every asset is written whole', async () => {
        fakeFs.plant('assets/a.bin', patterned(3 * MIB, 1))
        fakeFs.plant('assets/b.bin', patterned(3 * MIB, 2))
        // The listing reports small sizes, so both keys are requested in one call; the response budget defers the second.
        bridge.listedSizes.set('assets/a.bin', 100)
        bridge.listedSizes.set('assets/b.bin', 100)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(commandCalls('get_assets_batch').map((call) => call.keys)).toEqual([['assets/a.bin', 'assets/b.bin'], ['assets/b.bin']])
        expect(commandCalls('read_range')).toHaveLength(0)
        expectEveryAssetExported(['assets/a.bin', 'assets/b.bin'])
    })

    // The bridge delivers a number array once its fast channel has failed; it must parse exactly like the ArrayBuffer.
    test('a reply that arrives as a number array is parsed whole: no ranged read, every asset written', async () => {
        const small = plantSmall(40)
        bridge.asNumberArray = true

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(commandCalls('get_assets_batch')).toHaveLength(1)
        expect(commandCalls('read_range')).toHaveLength(0)
        expectEveryAssetExported(small)
        expect(console.error).not.toHaveBeenCalled()
    })
})

describe('the oversize question on an Android export', () => {
    function plantMixed(limit: number): { small: string[], over: string } {
        const small = plantSmall(5, 100)
        fakeFs.plant('assets/over.bin', patterned(limit, 4))
        return { small, over: 'assets/over.bin' }
    }

    test('names an asset at the limit; declining writes nothing', async () => {
        plantMixed(2000)
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(OVERSIZE_PROMPT))

        const outcome = await SaveLocalBackup({ limitBytes: 2000 })

        expect(outcome).toEqual({ status: 'declined', cause: 'oversize-declined' })
        expect(oversizePrompts()).toHaveLength(1)
        expect(oversizePrompts()[0]).toContain('assets/over.bin')
        expect(backupSink.writes).toEqual([])
        expect(commandCalls('get_assets_batch')).toHaveLength(0)
    })

    test('continuing leaves it out, reports it, and writes the others byte-exact without reading it', async () => {
        const { small } = plantMixed(2000)

        const outcome = await SaveLocalBackup({ limitBytes: 2000 })

        expect(outcome.status).toBe('saved')
        expect(oversizePrompts()).toHaveLength(1)
        expect(outcome.status === 'saved' && outcome.omitted.oversize).toHaveLength(1)
        expect(outcome.status === 'saved' && outcome.omitted.oversize[0]).toContain('assets/over.bin')
        expectEveryAssetExported(small)
        expect(commandCalls('get_assets_batch').flatMap((call) => call.keys)).not.toContain('assets/over.bin')
    })

    test('asks nothing when every asset is below the limit', async () => {
        const { small } = plantMixed(1999)

        const outcome = await SaveLocalBackup({ limitBytes: 2000 })

        expect(outcome.status).toBe('saved')
        expect(oversizePrompts()).toEqual([])
        expectEveryAssetExported([...small, 'assets/over.bin'])
    })
})

describe('an Android export whose batched read does not deliver', () => {
    // Each guard also asserts that a batch call happened, so a path that never batches cannot pass it.
    test('guard: a get_assets_batch call that rejects leaves every asset to the ranged reader', async () => {
        const small = plantSmall(20)
        bridge.rejectBatch = true

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(commandCalls('get_assets_batch').length).toBeGreaterThanOrEqual(1)
        expect(commandCalls('read_range').map((call) => call.keys[0]).sort()).toEqual([...small].sort())
        expectEveryAssetExported(small)
        expect(outcome.status === 'saved' && outcome.omitted.assets).toEqual([])
    })

    test('guard: a reply that is not bytes leaves every asset to the ranged reader', async () => {
        const small = plantSmall(20)
        bridge.junkReply = 'not bytes'

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(commandCalls('get_assets_batch').length).toBeGreaterThanOrEqual(1)
        expect(commandCalls('read_range').map((call) => call.keys[0]).sort()).toEqual([...small].sort())
        expectEveryAssetExported(small)
        expect(outcome.status === 'saved' && outcome.omitted.assets).toEqual([])
    })

    // A batch `missing` comes only from a not-found open, so the key is reported and not read again.
    test('guard: a key the batch answers missing is reported, never silently dropped, and is not read again', async () => {
        const small = plantSmall(6)
        const missing = small[2]
        bridge.forceMissing.add(missing)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(commandCalls('get_assets_batch').length).toBeGreaterThanOrEqual(1)
        expect(outcome.status === 'saved' && outcome.omitted.assets).toEqual([missing])
        expect(alertMdMock.mock.calls.map((call) => String(call[0])).join('\n')).toContain(missing)
        expect(commandCalls('read_range')).toHaveLength(0)
        expectEveryAssetExported(small.filter((key) => key !== missing))
    })

    test('guard: a listing that fails writes every asset through the store, with no batch read and no oversize question', async () => {
        const small = plantSmall(12, 100)
        bridge.failListing = true

        const outcome = await SaveLocalBackup({ limitBytes: 50 })

        expect(outcome.status).toBe('saved')
        expect(commandCalls('list_assets_sized').length).toBeGreaterThanOrEqual(1)
        expect(commandCalls('get_assets_batch')).toHaveLength(0)
        expect(oversizePrompts()).toEqual([])
        expectEveryAssetExported(small)
    })
})

describe('the export phases', () => {
    const FIRST_FIXED = ['export start', 'export cold collected']
    const LAST_FIXED = [
        'export inlays done',
        'export cold payloads done',
        'export database encoded',
        'export stub and late payloads done',
        'export database written',
        'export closed',
    ]

    test('are recorded in order under the measurement key, with the delivery counts', async () => {
        localStorage.setItem('risu-measure-import', 'on')
        const small = plantSmall(30)
        fakeFs.plant('assets/z-large.bin', patterned(5 * MIB, 3))
        bridge.asNumberArray = true

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        const recorded = (ring()?.snapshot() ?? []).map((record) => record.phase)
        // The measurement figures a note appends are checked in exportMeasure.test.ts; here only the order and the delivery counts.
        expect(recorded.find((phase) => phase.startsWith('export cold collected'))).toContain('stubChars=')
        expect(recorded.find((phase) => phase.startsWith('export closed'))).toContain('writeCalls=')
        expect(recorded.find((phase) => phase.startsWith('export closed'))).toContain('appendSynced=')
        const phases = recorded.map((phase) => phase.replace(/ (?:stubChars|writeCalls)=.*$/, ''))
        expect(phases).toEqual([
            ...FIRST_FIXED,
            `export listed, ${small.length + 1} assets`,
            'export writer opened',
            `export assets done, batched=${small.length} fallback=1 missing=0 numberArrayReplies=1`,
            ...LAST_FIXED,
        ])
    })

    test('the counts name a missing key and a reply form that was bytes', async () => {
        localStorage.setItem('risu-measure-import', 'on')
        const small = plantSmall(10)
        bridge.forceMissing.add(small[0])

        await SaveLocalBackup()

        const done = (ring()?.snapshot() ?? []).map((record) => record.phase).find((phase) => phase.startsWith('export assets done'))
        expect(done).toBe('export assets done, batched=9 fallback=0 missing=1 numberArrayReplies=0')
    })

    test('record nothing while the measurement key is absent', async () => {
        plantSmall(10)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(ring()?.snapshot() ?? []).toEqual([])
    })
})

//#region streamed asset reads

const PIECE_LIMIT = 2 * MIB

/** One backup entry built independently of the code under test: name length, name, data length, data, all little-endian. */
function referenceEntry(name: string, data: Uint8Array): Buffer {
    const nameBytes = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(4)
    head.writeUInt32LE(nameBytes.length, 0)
    const tail = Buffer.alloc(4)
    tail.writeUInt32LE(data.length, 0)
    return Buffer.concat([head, nameBytes, tail, Buffer.from(data)])
}

function writtenFile(): Buffer {
    return Buffer.concat(backupSink.writes.map((part) => Buffer.from(part)))
}

/** Every reference entry is in the file whole and in the given order. */
function expectEntriesInOrder(entries: readonly { name: string, data: Uint8Array }[]): void {
    const file = writtenFile()
    let from = 0
    for (const entry of entries) {
        const at = file.indexOf(referenceEntry(entry.name, entry.data), from)
        expect(at, entry.name).toBeGreaterThanOrEqual(from)
        from = at
    }
}

const rangeLens = (): number[] => commandCalls('read_range').map((call) => call.len ?? -1)

describe('an Android export reads a large asset in pieces', () => {
    // Regression reproducer: on the base the asset above the batch size was read whole, as one 8 MiB range request.
    test('full export: every read_range of a 5 MiB asset asks for at most 2 MiB, and no read is whole', async () => {
        const large = patterned(5 * MIB, 9)
        fakeFs.plant('assets/z-large.bin', large)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        const lens = rangeLens()
        expect(lens.length).toBeGreaterThanOrEqual(3)
        expect(Math.max(...lens)).toBeLessThanOrEqual(PIECE_LIMIT)
        expectEveryAssetExported(['assets/z-large.bin'])
    })

    // Compatibility guard inside the reproducer: the entry bytes are what an independent encoder makes, so the format is unchanged.
    test('full export: the streamed entry is byte-identical to an independently encoded one, among the batched ones', async () => {
        const small = plantSmall(3, 300)
        const large = patterned(5 * MIB + 17, 5)
        fakeFs.plant('assets/z-large.bin', large)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(rangeLens().length).toBeGreaterThanOrEqual(3)
        expectEntriesInOrder([
            ...small.map((key) => ({ name: key.slice('assets/'.length), data: fakeFs.files.get(key)! })),
            { name: 'z-large.bin', data: large },
        ])
    })

    test('guard: small assets keep the batch path and make no ranged read', async () => {
        const keys = plantSmall(4, 1000)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(rangeLens()).toEqual([])
        expectEveryAssetExported(keys)
    })

    // Regression reproducer: on the base the inlay body of an Android export was read whole.
    test('full export: an inlay body is read in pieces of at most 2 MiB', async () => {
        const body = patterned(5 * MIB, 2)
        const store = createTauriFilesStore({ platform: 'posix' })
        injectRestoreStore(store)
        const asset: InlayAsset = { name: 'v.png', ext: 'png', type: 'image', data: new Blob([body as unknown as Uint8Array<ArrayBuffer>], { type: 'image/png' }) }
        await writeAppInlay(store, 'v', asset)
        const record = (await readAppInlayRecord(store, 'v'))!
        bridge.calls.length = 0

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        const inlayReads = commandCalls('read_range').filter((call) => call.keys[0] === record.body)
        expect(inlayReads.length).toBeGreaterThanOrEqual(3)
        expect(Math.max(...inlayReads.map((call) => call.len ?? -1))).toBeLessThanOrEqual(PIECE_LIMIT)
        const file = writtenFile()
        expect(file.indexOf(Buffer.from(body.subarray(0, 4096)))).toBeGreaterThan(-1)
    })

    describe('partial export', () => {
        function partialDatabase(icons: { userIcon?: string, personaIcon?: string, customBackground?: string }) {
            vi.mocked(getDatabase).mockImplementation(() => ({
                characters: [],
                personas: icons.personaIcon === undefined ? [] : [{ name: 'p', icon: icons.personaIcon }],
                characterOrder: [],
                botPresets: [],
                userIcon: icons.userIcon,
                customBackground: icons.customBackground,
            }) as unknown as Database)
        }

        // Regression reproducer: on the base every asset of a partial export was one whole store read.
        test('reads a large profile image in pieces of at most 2 MiB and writes the same entry bytes', async () => {
            const large = patterned(5 * MIB, 3)
            const icon = patterned(900, 4)
            fakeFs.plant('assets/big.png', large)
            fakeFs.plant('assets/icon.png', icon)
            partialDatabase({ userIcon: 'assets/big.png', personaIcon: 'assets/icon.png' })

            const outcome = await SavePartialLocalBackup()

            expect(outcome.status).toBe('saved')
            expect(rangeLens().length).toBeGreaterThanOrEqual(4)
            expect(Math.max(...rangeLens())).toBeLessThanOrEqual(PIECE_LIMIT)
            expectEntriesInOrder([
                { name: 'big.png', data: large },
                { name: 'icon.png', data: icon },
            ])
        })

        // Compatibility guard (passes before and after): an absent referenced asset is reported missing and the others are still written.
        test('guard: an absent asset is reported missing, and the rest is written', async () => {
            const icon = patterned(700, 8)
            fakeFs.plant('assets/icon.png', icon)
            partialDatabase({ userIcon: 'assets/absent.png', personaIcon: 'assets/icon.png' })

            const outcome = await SavePartialLocalBackup()

            expect(outcome.status).toBe('saved')
            expect(outcome.status === 'saved' && outcome.omitted.assets).toEqual(['assets/absent.png'])
            expectEntriesInOrder([{ name: 'icon.png', data: icon }])
        })

        // Check of the new behaviour, not a guard: the ranged reader logs the absence, which the base did not.
        test('an absent asset is logged by the ranged reader exactly once', async () => {
            fakeFs.plant('assets/icon.png', patterned(700, 8))
            partialDatabase({ userIcon: 'assets/absent.png', personaIcon: 'assets/icon.png' })

            await SavePartialLocalBackup()

            expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1)
        })
    })

    // Compatibility guards: the pieces change only on an Android page whose store is the files store.
    describe('guard: the other platforms keep their reads', () => {
        test('a desktop page keeps its own piece size, not the Android one', async () => {
            osBox.os = 'windows'
            resetByteTransportForTests()
            fakeFs.plant('assets/z-large.bin', patterned(5 * MIB, 9))

            const outcome = await SaveLocalBackup()

            expect(outcome.status).toBe('saved')
            expect(rangeLens().length).toBeGreaterThanOrEqual(1)
            expect(rangeLens()[0]).toBe(CHUNK_MAX)
            expect(CHUNK_MAX).toBeGreaterThan(PIECE_LIMIT)
            expectEveryAssetExported(['assets/z-large.bin'])
        })

        test('a desktop page reads an inlay body above one piece with its own piece size', async () => {
            osBox.os = 'windows'
            resetByteTransportForTests()
            const body = patterned(CHUNK_MAX + MIB, 2)
            const store = createTauriFilesStore({ platform: 'posix' })
            injectRestoreStore(store)
            const asset: InlayAsset = { name: 'v.png', ext: 'png', type: 'image', data: new Blob([body as unknown as Uint8Array<ArrayBuffer>], { type: 'image/png' }) }
            await writeAppInlay(store, 'v', asset)
            const record = (await readAppInlayRecord(store, 'v'))!
            bridge.calls.length = 0

            const outcome = await SaveLocalBackup()

            expect(outcome.status).toBe('saved')
            const inlayReads = commandCalls('read_range').filter((call) => call.keys[0] === record.body)
            expect(inlayReads.length).toBeGreaterThanOrEqual(1)
            expect(inlayReads[0].len).toBe(CHUNK_MAX)
        })

        test('an Android page whose store is not the files store keeps the whole read', async () => {
            injectRestoreStore(createTauriFilesStore({ platform: 'posix' }), 'indexeddb')
            fakeFs.plant('assets/z-large.bin', patterned(5 * MIB, 9))

            const outcome = await SaveLocalBackup()

            expect(outcome.status).toBe('saved')
            expect(rangeLens().length).toBeGreaterThanOrEqual(1)
            expect(Math.min(...rangeLens())).toBeGreaterThan(PIECE_LIMIT)
            expectEveryAssetExported(['assets/z-large.bin'])
        })
    })
})

//#endregion

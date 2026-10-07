// @vitest-environment happy-dom

/**
 * `LoadLocalBackup` and `SaveLocalBackup` (`src/ts/drive/backuplocal.ts`) on a
 * desktop page whose asset commands are answered by `assetBatchFake.ts` over the
 * real desktop store on the in-memory file model of `tauriFsFake.ts`. The calls
 * the fake receives are held and released by the tests, so the order in which
 * restore and export start, wait for and settle batches is observable.
 *
 * What is pinned: a restore or export that leaves early (a stop with a message,
 * a failed batch, an unreadable slice, a writer that fails) shows nothing and
 * returns nothing while a batch is still in flight; no entry is read or sent
 * after a failure was seen; the skip report is in file order whatever order the
 * batches settle in; the last of two entries with the same key wins; a command
 * that refuses raw bodies moves the rest of the restore to the per-entry path;
 * a partial backup never uses the batch commands. An asset above `CHUNK_MAX`
 * travels only in calls of at most `CHUNK_MAX` bytes in both directions, on the
 * desktop transport of `tauriDesktopFake.ts` with a per-call cap; a restore
 * entry is read from the file in header-first slices. A mocked command is not
 * evidence about the native backend.
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

const backupSink = vi.hoisted(() => ({
    writes: [] as Uint8Array[],
    failWrites: false,
    failedWrites: 0,
    /** Paths the page asked the plugin to remove. */
    removed: [] as string[],
    failRemove: false,
}))
const osBox = vi.hoisted(() => ({ os: 'windows' }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 4 * 1024 * 1024 }))
/** What the page called and showed, in order, for tests of the order of an abort and a message. */
const eventLog = vi.hoisted(() => ({ events: [] as string[], holdAbort: null as Promise<void> | null, rawInFlight: [] as number[] }))
/** A size the trailer of every `read_range` of a key reports instead of the file's own, for keys larger than any file the test can hold. */
const reportedTotals = vi.hoisted(() => new Map<string, number>())
const batchFake = await vi.hoisted(async () => (await import('./assetBatchFake')).createAssetBatchFake())
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const setDatabaseMock = vi.hoisted(() => vi.fn())
const setColdStorageItemMock = vi.hoisted(() => vi.fn(async () => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertNormalWaitMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<void> => { }))
const reloadMark = vi.hoisted(() => ({ marked: false }))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { reloadMark.marked = true },
    isAppInitiatedReload: () => reloadMark.marked,
}) as unknown as typeof import('src/ts/reloadGuard'))

/** What the old `inlay` database holds; every other LocalForage instance is empty. */
const legacyInlays = vi.hoisted(() => new Map<string, unknown>())

vi.mock('localforage', () => ({
    default: {
        createInstance: (config?: { name?: string }) => config?.name === 'inlay'
            ? {
                getItem: vi.fn(async (key: string) => legacyInlays.get(key) ?? null),
                setItem: vi.fn(async (key: string, value: unknown) => { legacyInlays.set(key, value) }),
                removeItem: vi.fn(async (key: string) => { legacyInlays.delete(key) }),
                keys: vi.fn(async () => [...legacyInlays.keys()]),
            }
            : {
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => { }),
                removeItem: vi.fn(async () => { }),
            },
    },
}))

// The inlay module only asks the model list about image input support, which no test here reaches.
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
    remove: async (path: string, options?: unknown) => {
        if (path === BACKUP_PATH) {
            if (backupSink.failRemove) {
                throw new Error('scratch: the backup file cannot be removed')
            }
            backupSink.removed.push(path)
            return
        }
        await (fakeFs.module.remove as (path: string, options?: unknown) => Promise<void>)(path, options)
    },
    writeFile: async (path: string, data: Uint8Array, options?: { createNew?: boolean, baseDir?: number }) => {
        if (path === BACKUP_PATH) {
            if (backupSink.failWrites) {
                backupSink.failedWrites += 1
                throw new Error('scratch: the backup file cannot be written')
            }
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

vi.mock('src/ts/storage/tauriAssetBatch', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriAssetBatch')>()),
    ...batchFake.module,
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: setDatabaseMock,
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
    alertError: (...args: unknown[]) => { eventLog.events.push('alertError'); return alertErrorMock(...args) },
    alertWait: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: alertNormalMock,
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: alertNormalWaitMock,
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

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: async (command: string, args?: unknown, options?: unknown) => {
        eventLog.events.push(command)
        if (command === 'write_chunk_raw' || command === 'write_chunk') {
            eventLog.rawInFlight.push(batchFake.ctl.inFlight)
        }
        if (command === 'abort_chunked' && eventLog.holdAbort) {
            await eventLog.holdAbort
        }
        const reply = await (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options)
        if (command === 'abort_chunked') {
            eventLog.events.push('abort_chunked done')
        }
        const reported = command === 'read_range' ? reportedTotals.get((args as { key: string }).key) : undefined
        if (reported !== undefined && reply instanceof ArrayBuffer) {
            // The trailer is the last 56 bytes; its first word is the file size.
            new DataView(reply, reply.byteLength - 56).setBigUint64(0, BigInt(reported), true)
        }
        return reply
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
        setColdStorageItem: setColdStorageItemMock,
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup, LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { LocalWriter, dbWriteLock, wasAssetWrittenThisPage } from 'src/ts/globalApi.svelte'
import { BlobDownloadWriter, type ExportByteWriter, type TauriWriter } from 'src/ts/exportWriters'
import { language } from 'src/lang'
import { alertWait } from 'src/ts/alert'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { getAppStore } from 'src/ts/storage/store/appStore'
import { CHUNK_MAX, resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { collectColdStorageBackupPayloads } from 'src/ts/process/coldstorage.svelte'
import { getInlayAsset, setInlayAsset } from 'src/ts/process/files/inlays'

//#region helpers

const encoder = new TextEncoder()
const MIB = 1024 * 1024

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = encoder.encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    out.set(u32le(nameBuf.length), 0)
    out.set(nameBuf, 4)
    out.set(u32le(data.length), 4 + nameBuf.length)
    out.set(data, 8 + nameBuf.length)
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function filled(size: number, fill: number): Uint8Array {
    return new Uint8Array(size).fill(fill)
}

function databaseWith(fields: Record<string, unknown>): Database {
    return { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
}

function databaseChunk(): Uint8Array {
    return buildChunk('database.risudat', encodeRisuSaveLegacy(databaseWith({}), 'noCompression'))
}

function backupOf(entries: [string, Uint8Array][]): Uint8Array {
    return concat([...entries.map(([name, data]) => buildChunk(name, data)), databaseChunk()])
}

function hex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Asset key -> hex of its bytes, for what the file model holds under `assets/`. */
function storedAssets(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [path, data] of fakeFs.files.entries()) {
        if (path.startsWith('assets/')) {
            out[path] = hex(data)
        }
    }
    return out
}

function storedBytes(name: string): Uint8Array | undefined {
    return fakeFs.files.get(`assets/${name}`)
}

interface Gate {
    promise: Promise<void>
    release(): void
}

function gate(): Gate {
    let release: () => void = () => { }
    const promise = new Promise<void>((resolve) => { release = resolve })
    return { promise, release }
}

/** Holds the write calls with these indexes (in the order the fake receives them) until their gate is released. */
function holdWrites(indexes: number[]): Map<number, Gate> {
    const gates = new Map<number, Gate>(indexes.map((index) => [index, gate()]))
    batchFake.ctl.beforeWrite = (_call, index) => gates.get(index)?.promise
    return gates
}

function holdReads(indexes: number[]): Map<number, Gate> {
    const gates = new Map<number, Gate>(indexes.map((index) => [index, gate()]))
    batchFake.ctl.beforeRead = (_call, index) => gates.get(index)?.promise
    return gates
}

async function settleTimers(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25))
}

function allCallsSettled(): boolean {
    return batchFake.ctl.calls.every((call) => call.settled)
}

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

/** Starts a restore of `file` and returns the promise of its change handler. */
function startRestore(file: File): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    return (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

function restoreBytes(bytes: Uint8Array): Promise<void> {
    return startRestore(new File([asBlobPart(bytes)], 'backup.bin'))
}

/**
 * A file whose first `walkSliceCalls` slices (the walk of the file) read
 * `walkBytes` and whose later slices (the restore pass) read `passBytes`.
 */
function fileThatChanges(walkBytes: Uint8Array, passBytes: Uint8Array, walkSliceCalls: number): File {
    const base = new File([asBlobPart(walkBytes)], 'backup.bin')
    let calls = 0
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (start = 0, end = walkBytes.length) => {
                    calls += 1
                    const source = calls <= walkSliceCalls ? walkBytes : passBytes
                    const bytes = source.slice(start, end)
                    return { arrayBuffer: async () => bytes.buffer as ArrayBuffer } as unknown as Blob
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
}

/** A file whose slices read `bytes` until the `rejectFromCall`-th slice, which and every later one reject. */
function fileWithRejectingSlice(bytes: Uint8Array, rejectFromCall: number): File {
    const base = new File([asBlobPart(bytes)], 'backup.bin')
    let calls = 0
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (...args: [number?, number?, string?]) => {
                    calls += 1
                    if (calls >= rejectFromCall) {
                        return { arrayBuffer: () => Promise.reject(new Error('scratch: unreadable region')) } as unknown as Blob
                    }
                    return (target.slice as (...a: unknown[]) => Blob).apply(target, args)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
}

function patterned(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        out[i] = (i * 13 + seed) % 251
    }
    return out
}

function same(actual: Uint8Array | null | undefined, expected: Uint8Array): boolean {
    return actual !== null && actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

/** A file whose every slice call is recorded by its size, over the bytes it holds. */
function recordingFile(bytes: Uint8Array): { file: File, sizes: number[] } {
    const base = new File([asBlobPart(bytes)], 'backup.bin')
    const sizes: number[] = []
    const file = new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (start = 0, end = target.size) => {
                    sizes.push(end - start)
                    return target.slice(start, end)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
    return { file, sizes }
}

/** A file whose slice of `size` bytes rejects when `fails(size, n)` holds for the `n`-th (from 0) slice of that size. */
function fileWithFailingSlice(bytes: Uint8Array, fails: (size: number, nth: number) => boolean): File {
    const base = new File([asBlobPart(bytes)], 'backup.bin')
    const seen = new Map<number, number>()
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (start = 0, end = target.size) => {
                    const size = end - start
                    const nth = seen.get(size) ?? 0
                    seen.set(size, nth + 1)
                    if (fails(size, nth)) {
                        return { arrayBuffer: () => Promise.reject(new Error('scratch: unreadable region')) } as unknown as Blob
                    }
                    return target.slice(start, end)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
}

async function outcomeOf(run: () => Promise<void>): Promise<unknown> {
    return run().then(() => null, (error: unknown) => error)
}

function isPending(promise: Promise<unknown>): Promise<boolean> {
    let settled = false
    void promise.then(() => { settled = true }, () => { settled = true })
    return settleTimers().then(() => !settled)
}

const unhandled: unknown[] = []
function recordUnhandled(reason: unknown): void {
    unhandled.push(reason)
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = true
    backupSink.writes.length = 0
    backupSink.failWrites = false
    backupSink.failedWrites = 0
    backupSink.removed.length = 0
    backupSink.failRemove = false
    osBox.os = 'windows'
    desktop.reset()
    eventLog.events.length = 0
    eventLog.rawInFlight.length = 0
    eventLog.holdAbort = null
    reportedTotals.clear()
    legacyInlays.clear()
    resetByteTransportForTests()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    batchFake.reset()
    batchFake.useStore(getAppStore)
    batchFake.ctl.available = true
    setDatabaseMock.mockReset()
    setColdStorageItemMock.mockClear()
    alertErrorMock.mockReset()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    alertNormalWaitMock.mockReset().mockImplementation(async () => { })
    reloadMark.marked = false
    unhandled.length = 0
    process.on('unhandledRejection', recordUnhandled)
    vi.spyOn(console, 'error').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    getDatabaseMock.mockImplementation(() => databaseWith({}))
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })

    capturedInput = null
    const realCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
})

afterEach(() => {
    process.off('unhandledRejection', recordUnhandled)
    createElementSpy.mockRestore()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

describe('a restore through the batch commands', () => {
    test('writes every asset with its own bytes, and installs the database only after every batch has settled', async () => {
        const names = ['a.png', 'b.mp3', 'c.webp', 'd.jpg', 'e.mp4', 'F.PNG']
        let settledWhenInstalled: boolean | null = null
        setDatabaseMock.mockImplementation(() => { settledWhenInstalled = allCallsSettled() })

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(100 + index, index + 1)])))

        expect(batchFake.ctl.calls.some((call) => call.kind === 'batch')).toBe(true)
        for (const [index, name] of names.entries()) {
            expect(Array.from(storedBytes(name) ?? [])).toEqual(Array.from(filled(100 + index, index + 1)))
        }
        expect(fakeFs.files.has('blocks/head')).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        expect(settledWhenInstalled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('records every key for the startup sweep before the batch that carries it is sent', async () => {
        const noted: boolean[] = []
        batchFake.ctl.beforeWrite = (call) => {
            noted.push(...call.keys.map((key) => wasAssetWrittenThisPage(key)))
        }

        await restoreBytes(backupOf([['noted1.png', filled(8, 1)], ['noted2.png', filled(8, 2)]]))

        expect(noted).toEqual([true, true])
    })

    test('names the refused entries in file order though a later batch settles first, and still writes the others', async () => {
        const gates = holdWrites([0])
        const entries: [string, Uint8Array][] = [
            ['.badA', filled(3 * MIB, 1)],
            ['.badB', filled(3 * MIB, 2)],
            ['good.png', filled(3 * MIB, 3)],
        ]

        const restoring = restoreBytes(backupOf(entries))
        await vi.waitFor(() => { expect(batchFake.ctl.calls.length).toBeGreaterThanOrEqual(2) })
        await settleTimers()
        gates.get(0)?.release()
        await restoring

        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(2, ['.badA', '.badB']))
        expect(storedBytes('good.png')?.length).toBe(3 * MIB)
        expect(fakeFs.files.has('blocks/head')).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('an error on one entry stops the restore: no batch is sent and no entry read after it, the message waits for every batch in flight, and the head is not written', async () => {
        // Calls 0..3 are in flight and the loop waits for room for the fifth; call 1 reports the failure first.
        const gates = holdWrites([0, 1, 2, 3])
        const failing = filled(3 * MIB, 2)
        fakeFs.failWritesOf((data) => data.length === failing.length && data[0] === 2)
        const entries: [string, Uint8Array][] = [0, 1, 2, 3, 4, 5].map((index) => [`e${index}.png`, filled(3 * MIB, index + 1)])
        // An entry the loop would act on if it kept reading after the failure.
        entries.push([`coldstorage_11111111-1111-1111-1111-111111111111.json`, encoder.encode(JSON.stringify({ message: [] }))])
        let settledAtMessage: boolean | null = null
        alertErrorMock.mockImplementation(() => { settledAtMessage = allCallsSettled() })

        const restoring = restoreBytes(backupOf(entries))
        await vi.waitFor(() => { expect(batchFake.ctl.calls).toHaveLength(4) })
        await settleTimers()
        gates.get(1)?.release()
        await settleTimers()
        expect(alertErrorMock).not.toHaveBeenCalled()
        for (const index of [0, 2, 3]) {
            gates.get(index)?.release()
        }
        await restoring

        expect(batchFake.ctl.calls).toHaveLength(4)
        expect(batchFake.ctl.calls.flatMap((call) => call.keys)).not.toContain('assets/e4.png')
        expect(batchFake.ctl.calls.flatMap((call) => call.keys)).not.toContain('assets/e5.png')
        // The cold-storage entry lies after the failed batch: reading it would write it.
        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(settledAtMessage).toBe(true)
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(unhandled).toEqual([])
    })

    test('an exception inside the pass while a batch is in flight is reported only after that batch has settled', async () => {
        const gates = holdWrites([0])
        let settledAtMessage: boolean | null = null
        alertErrorMock.mockImplementation(() => { settledAtMessage = allCallsSettled() })
        // The first progress notice of the pass after a batch was sent throws.
        let thrown = false
        vi.mocked(alertWait).mockImplementation((message: string) => {
            if (!thrown && batchFake.ctl.calls.length > 0 && message.startsWith('Loading local Backup')) {
                thrown = true
                throw new Error('scratch: the pass failed')
            }
            return {} as ReturnType<typeof alertWait>
        })
        const entries: [string, Uint8Array][] = [0, 1, 2].map((index) => [`x${index}.png`, filled(3 * MIB, index + 1)])

        try {
            const restoring = restoreBytes(backupOf(entries))
            await vi.waitFor(() => { expect(thrown).toBe(true) })
            await settleTimers()
            expect(alertErrorMock).not.toHaveBeenCalled()
            gates.get(0)?.release()
            await restoring
        } finally {
            vi.mocked(alertWait).mockReset()
        }

        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(settledAtMessage).toBe(true)
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(unhandled).toEqual([])
    })

    test('a batch whose call rejects stops the restore with the same single message, after every other batch settled, with no unhandled rejection', async () => {
        const gates = new Map<number, Gate>([[1, gate()]])
        batchFake.ctl.beforeWrite = async (_call, index) => {
            if (index === 0) {
                // Rejects only once the second batch is in flight beside it.
                await vi.waitFor(() => { expect(batchFake.ctl.calls.length).toBeGreaterThanOrEqual(2) })
                throw new Error('scratch: transport went away')
            }
            await gates.get(index)?.promise
        }
        let settledAtMessage: boolean | null = null
        alertErrorMock.mockImplementation(() => { settledAtMessage = allCallsSettled() })
        const entries: [string, Uint8Array][] = [0, 1, 2].map((index) => [`t${index}.png`, filled(3 * MIB, index + 1)])

        const restoring = restoreBytes(backupOf(entries))
        await vi.waitFor(() => { expect(batchFake.ctl.calls.length).toBeGreaterThanOrEqual(2) })
        await settleTimers()
        expect(alertErrorMock).not.toHaveBeenCalled()
        gates.get(1)?.release()
        await restoring
        await settleTimers()

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(settledAtMessage).toBe(true)
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(unhandled).toEqual([])
    })
})

describe('a restore that stops early while a batch is being written', () => {
    const MARKER = encoder.encode(JSON.stringify({ type: 'account', time: 1 }))

    function walkView(): Uint8Array {
        return concat([buildChunk('first.png', filled(16, 1)), buildChunk('second.png', filled(16, 2)), databaseChunk()])
    }

    test('a marker met mid-restore shows its message only after the batch holding the earlier asset has settled, and nothing after the marker is written', async () => {
        const gates = holdWrites([0])
        let settledAtMessage: boolean | null = null
        alertErrorMock.mockImplementation(() => { settledAtMessage = allCallsSettled() })
        const passView = concat([buildChunk('first.png', filled(16, 1)), buildChunk('encryption.risudat', MARKER)])

        const restoring = startRestore(fileThatChanges(walkView(), passView, 3))
        await vi.waitFor(() => { expect(batchFake.ctl.calls).toHaveLength(1) })
        await settleTimers()
        expect(alertErrorMock).not.toHaveBeenCalled()
        gates.get(0)?.release()
        await restoring

        expect(alertErrorMock).toHaveBeenCalledWith(language.encryptedBackupImportStopped)
        expect(settledAtMessage).toBe(true)
        expect(Object.keys(storedAssets())).toEqual(['assets/first.png'])
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    test('a file that changed under the pass shows the changed-file message only after the batch settled', async () => {
        const gates = holdWrites([0])
        let settledAtMessage: boolean | null = null
        alertErrorMock.mockImplementation(() => { settledAtMessage = allCallsSettled() })
        const passView = concat([buildChunk('first.png', filled(16, 1)), buildChunk('second.png', filled(17, 2))])

        const restoring = startRestore(fileThatChanges(walkView(), passView, 3))
        await vi.waitFor(() => { expect(batchFake.ctl.calls).toHaveLength(1) })
        await settleTimers()
        expect(alertErrorMock).not.toHaveBeenCalled()
        gates.get(0)?.release()
        await restoring

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
        expect(settledAtMessage).toBe(true)
        expect(Object.keys(storedAssets())).toEqual(['assets/first.png'])
        expect(fakeFs.files.has('blocks/head')).toBe(false)
    })

    test('an unreadable slice shows the changed-file message only after the batch settled', async () => {
        const gates = holdWrites([0])
        let settledAtMessage: boolean | null = null
        alertErrorMock.mockImplementation(() => { settledAtMessage = allCallsSettled() })

        // Calls 1-3 are the walk, calls 4 and 5 read the header and the data of the first asset, call 6 rejects.
        const restoring = startRestore(fileWithRejectingSlice(walkView(), 6))
        await vi.waitFor(() => { expect(batchFake.ctl.calls).toHaveLength(1) })
        await settleTimers()
        expect(alertErrorMock).not.toHaveBeenCalled()
        gates.get(0)?.release()
        await restoring

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
        expect(settledAtMessage).toBe(true)
        expect(Object.keys(storedAssets())).toEqual(['assets/first.png'])
        expect(fakeFs.files.has('blocks/head')).toBe(false)
    })
})

describe('two entries with the same key in one backup', () => {
    test('the last one in the file is what ends up on disk when they are adjacent, and the second is not sent until the first has settled', async () => {
        const gates = holdWrites([0])

        const restoring = restoreBytes(backupOf([['dup.png', filled(8, 1)], ['dup.png', filled(8, 2)]]))
        await vi.waitFor(() => { expect(batchFake.ctl.calls).toHaveLength(1) })
        await settleTimers()
        expect(batchFake.ctl.calls).toHaveLength(1)
        gates.get(0)?.release()
        await restoring

        expect(batchFake.ctl.calls.map((call) => call.keys)).toEqual([['assets/dup.png'], ['assets/dup.png']])
        expect(batchFake.ctl.calls[1].inFlightAtStart).toBe(0)
        expect(Array.from(storedBytes('dup.png') ?? [])).toEqual(Array.from(filled(8, 2)))
    })

    test('the last one in the file wins when other entries lie between them and the first is in an earlier batch', async () => {
        const gates = holdWrites([0])
        const entries: [string, Uint8Array][] = [
            ['dup.png', filled(3 * MIB, 1)],
            ['mid1.png', filled(3 * MIB, 5)],
            ['mid2.png', filled(3 * MIB, 6)],
            ['dup.png', filled(3 * MIB, 2)],
        ]

        const restoring = restoreBytes(backupOf(entries))
        await vi.waitFor(() => { expect(batchFake.ctl.calls.length).toBeGreaterThanOrEqual(2) })
        await settleTimers()
        // Nothing carrying the second dup.png has been sent while the first is in flight.
        expect(batchFake.ctl.calls.filter((call) => call.keys.includes('assets/dup.png'))).toHaveLength(1)
        gates.get(0)?.release()
        await restoring

        expect(batchFake.ctl.calls.filter((call) => call.keys.includes('assets/dup.png'))).toHaveLength(2)
        expect(storedBytes('dup.png')?.[0]).toBe(2)
    })

    test('a key that differs only in case or Unicode composition is not written until the earlier one has settled, and the later one is what the file holds last', async () => {
        const gates = holdWrites([0, 1])
        const cafeComposed = 'café.png'
        const cafeDecomposed = 'café.png'

        const restoring = restoreBytes(backupOf([
            ['Pic.PNG', filled(8, 1)],
            ['pic.png', filled(8, 2)],
            [cafeComposed, filled(8, 3)],
            [cafeDecomposed, filled(8, 4)],
        ]))
        await vi.waitFor(() => { expect(batchFake.ctl.calls).toHaveLength(1) })
        await settleTimers()
        expect(batchFake.ctl.calls).toHaveLength(1)
        gates.get(0)?.release()
        await vi.waitFor(() => { expect(batchFake.ctl.calls).toHaveLength(2) })
        await settleTimers()
        expect(batchFake.ctl.calls).toHaveLength(2)
        gates.get(1)?.release()
        await restoring

        expect(batchFake.ctl.calls.map((call) => call.keys)).toEqual([
            ['assets/Pic.PNG'],
            ['assets/pic.png', `assets/${cafeComposed}`],
            [`assets/${cafeDecomposed}`],
        ])
        expect(batchFake.ctl.calls.map((call) => call.inFlightAtStart)).toEqual([0, 0, 0])
    })
})

describe('a restore of an asset above CHUNK_MAX', () => {
    function tempFiles(): string[] {
        return [...fakeFs.files.keys()].filter((path) => path.includes('risu-write'))
    }

    test('is streamed alone in chunks of at most CHUNK_MAX, durably, while the batches around it carry only the small assets', async () => {
        const big = patterned(17 * MIB, 3)
        batchFake.ctl.beforeWrite = (call) => { eventLog.events.push(`batch ${call.keys.join()}`) }

        await restoreBytes(backupOf([['before.png', filled(8, 1)], ['huge.bin', big], ['after.png', filled(8, 2)]]))

        expect(batchFake.ctl.calls.map((call) => [call.kind, call.keys])).toEqual([
            ['batch', ['assets/before.png']],
            ['batch', ['assets/after.png']],
        ])
        expect(batchFake.ctl.calls.map((call) => call.inFlightAtStart)).toEqual([0, 0])
        expect(eventLog.events.filter((event) => event.startsWith('batch') || event === 'write_chunk_raw')).toEqual([
            'batch assets/before.png',
            'write_chunk_raw', 'write_chunk_raw', 'write_chunk_raw', 'write_chunk_raw', 'write_chunk_raw',
            'batch assets/after.png',
        ])
        expect(eventLog.rawInFlight).toEqual([0, 0, 0, 0, 0])
        expect(desktop.rawCalls.map((call) => [call.key, call.offset, call.size, call.last, call.durable])).toEqual([
            ['assets/huge.bin', 0, CHUNK_MAX, false, true],
            ['assets/huge.bin', CHUNK_MAX, CHUNK_MAX, false, true],
            ['assets/huge.bin', 2 * CHUNK_MAX, CHUNK_MAX, false, true],
            ['assets/huge.bin', 3 * CHUNK_MAX, CHUNK_MAX, false, true],
            ['assets/huge.bin', 4 * CHUNK_MAX, MIB, true, true],
        ])
        expect(same(storedBytes('huge.bin'), big)).toBe(true)
        expect(Math.max(...desktop.payloads)).toBeLessThanOrEqual(CHUNK_MAX)
        expect(tempFiles()).toEqual([])
        expect(wasAssetWrittenThisPage('assets/huge.bin')).toBe(true)
        expect(fakeFs.files.has('blocks/head')).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('reads each entry header first and an asset in slices of at most CHUNK_MAX: no slice of the backup above CHUNK_MAX', async () => {
        const recorded = recordingFile(backupOf([['small.png', filled(100, 1)], ['huge.bin', patterned(9 * MIB, 5)]]))

        await startRestore(recorded.file)

        expect(Math.max(...recorded.sizes)).toBeLessThanOrEqual(CHUNK_MAX)
        expect(recorded.sizes.filter((size) => size === CHUNK_MAX)).toHaveLength(2)
        expect(storedBytes('huge.bin')?.length).toBe(9 * MIB)
    })

    test('an entry whose header changed since the walk has its data left unread', async () => {
        const walkView = concat([buildChunk('first.png', filled(16, 1)), buildChunk('second.png', filled(16, 2)), databaseChunk()])
        const passView = concat([buildChunk('first.png', filled(16, 1)), buildChunk('second.png', filled(17, 2))])
        const recorded = recordingFile(walkView)
        const changing = fileThatChanges(walkView, passView, 3)
        const file = new Proxy(changing, {
            get(target, prop, receiver) {
                if (prop === 'slice') {
                    return (start: number, end: number) => {
                        recorded.sizes.push(end - start)
                        return (target.slice as (start: number, end: number) => Blob)(start, end)
                    }
                }
                return Reflect.get(target, prop, receiver)
            },
        })

        await startRestore(file)

        // Three slices walk the file; then the first entry's header and data, and only the second entry's header.
        expect(recorded.sizes).toHaveLength(3 + 3)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
    })

    test('the last entry of a key is what the store holds whether it was streamed or batched, and a streamed entry waits for the batch in flight that holds its key', async () => {
        const gates = holdWrites([0])
        const lastBig = patterned(5 * MIB, 9)

        const restoring = restoreBytes(backupOf([
            ['dup.png', patterned(5 * MIB, 1)],
            ['dup.png', filled(8, 2)],
            ['dup.png', lastBig],
        ]))
        await vi.waitFor(() => { expect(batchFake.ctl.calls).toHaveLength(1) })
        await settleTimers()
        // The first streamed write is complete (two chunks); the second must not start while the batch is in flight.
        expect(desktop.rawCalls).toHaveLength(2)
        gates.get(0)?.release()
        await restoring

        expect(desktop.rawCalls).toHaveLength(4)
        expect(same(storedBytes('dup.png'), lastBig)).toBe(true)
    })

    test.each(['bad:name.png', 'bad.'])('an entry named %s that the store refuses is skipped before any call and reported, and the restore goes on', async (badName) => {
        const good = patterned(5 * MIB, 4)

        await restoreBytes(backupOf([[badName, patterned(5 * MIB, 1)], ['good.png', good]]))

        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, [badName]))
        expect(desktop.rawCalls.every((call) => call.key === 'assets/good.png')).toBe(true)
        expect(same(storedBytes('good.png'), good)).toBe(true)
        expect(storedBytes(badName)).toBeUndefined()
        expect(fakeFs.files.has('blocks/head')).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('a refused name is skipped and reported the same way once raw chunk bodies were refused and chunks travel as base64', async () => {
        desktop.refuseRawBodies()
        const good = patterned(5 * MIB, 4)

        await restoreBytes(backupOf([['first.png', patterned(5 * MIB, 2)], ['bad:name.png', patterned(5 * MIB, 1)], ['good.png', good]]))

        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, ['bad:name.png']))
        expect(desktop.chunk.callsOf('write_chunk').every((call) => call.args.key !== 'assets/bad:name.png')).toBe(true)
        expect(same(storedBytes('good.png'), good)).toBe(true)
        expect(storedBytes('first.png')?.length).toBe(5 * MIB)
        expect(fakeFs.files.has('blocks/head')).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('when raw chunk bodies are refused the chunks continue as base64, each within the bound, and the file is complete', async () => {
        desktop.refuseRawBodies()
        const big = patterned(9 * MIB, 6)

        await restoreBytes(backupOf([['huge.bin', big]]))

        expect(desktop.chunk.chunkSizes).toEqual([CHUNK_MAX, CHUNK_MAX, MIB])
        expect(desktop.rawCalls).toEqual([])
        expect(same(storedBytes('huge.bin'), big)).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('with the batch commands off for the page a large asset is still streamed, and the small ones are written one at a time', async () => {
        batchFake.ctl.available = false
        const big = patterned(9 * MIB, 8)

        await restoreBytes(backupOf([['small.png', filled(8, 1)], ['huge.bin', big]]))

        expect(batchFake.ctl.calls).toHaveLength(0)
        expect(desktop.rawCalls.map((call) => call.size)).toEqual([CHUNK_MAX, CHUNK_MAX, MIB])
        expect(same(storedBytes('huge.bin'), big)).toBe(true)
        expect(storedBytes('small.png')?.length).toBe(8)
        expect(fakeFs.files.has('blocks/head')).toBe(true)
    })

    test('a slice of the backup that cannot be read stops the restore with the changed-file message, the write is aborted before that message, and no later entry is written', async () => {
        const bytes = backupOf([['huge.bin', patterned(13 * MIB, 3)], ['after.png', filled(8, 2)]])
        // The third slice of CHUNK_MAX bytes: the first chunk has been sent by then.
        const file = fileWithFailingSlice(bytes, (size, nth) => size === CHUNK_MAX && nth === 2)

        await startRestore(file)

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
        expect(desktop.count('abort_chunked')).toBe(1)
        expect(eventLog.events.indexOf('abort_chunked done')).toBeGreaterThan(-1)
        expect(eventLog.events.indexOf('abort_chunked done')).toBeLessThan(eventLog.events.indexOf('alertError'))
        expect(tempFiles()).toEqual([])
        expect(storedBytes('huge.bin')).toBeUndefined()
        expect(storedBytes('after.png')).toBeUndefined()
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    test('the message of a stopped restore waits for the abort of the write to finish', async () => {
        const abortGate = gate()
        eventLog.holdAbort = abortGate.promise
        const file = fileWithFailingSlice(backupOf([['huge.bin', patterned(13 * MIB, 3)]]), (size, nth) => size === CHUNK_MAX && nth === 2)

        const restoring = startRestore(file)
        await vi.waitFor(() => { expect(eventLog.events).toContain('abort_chunked') })
        await settleTimers()
        expect(alertErrorMock).not.toHaveBeenCalled()
        abortGate.release()
        await restoring

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
        expect(tempFiles()).toEqual([])
    })

    test.each([
        ['the second chunk', ({ offset }: { offset: number }) => offset === CHUNK_MAX],
        ['the last chunk', ({ last }: { last: boolean }) => last],
    ])('a write that fails at %s leaves the key as it was, removes the temp file, stops the restore on the failure path and writes no later entry', async (_title, failsAt) => {
        const previous = filled(12, 5)
        fakeFs.plant('assets/huge.bin', previous)
        desktop.chunk.failWrites((call) => failsAt(call) ? 'scratch: the disk is full' : undefined)

        await restoreBytes(backupOf([['huge.bin', patterned(9 * MIB, 3)], ['after.png', filled(8, 2)]]))

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(same(storedBytes('huge.bin'), previous)).toBe(true)
        expect(tempFiles()).toEqual([])
        expect(storedBytes('after.png')).toBeUndefined()
        expect(batchFake.ctl.calls.flatMap((call) => call.keys)).not.toContain('assets/after.png')
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(unhandled).toEqual([])
    })

    test('a failure of the first chunk leaves no file and no temp file', async () => {
        desktop.chunk.failWrites(({ offset }) => offset === 0 ? 'scratch: the disk is full' : undefined)

        await restoreBytes(backupOf([['huge.bin', patterned(9 * MIB, 3)]]))

        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(storedBytes('huge.bin')).toBeUndefined()
        expect(tempFiles()).toEqual([])
    })
})

describe('a command that refuses a body that is not raw', () => {
    test('moves the rest of the restore to the per-entry path and ends with every asset written and the head installed', async () => {
        batchFake.ctl.beforeWrite = () => {
            batchFake.ctl.available = false
            throw new Error('not-raw: the body arrived as text')
        }
        const entries: [string, Uint8Array][] = [0, 1, 2, 3].map((index) => [`n${index}.png`, filled(3 * MIB, index + 1)])

        await restoreBytes(backupOf(entries))

        expect(batchFake.ctl.calls.length).toBeLessThanOrEqual(2)
        for (const index of [0, 1, 2, 3]) {
            expect(storedBytes(`n${index}.png`)?.[0]).toBe(index + 1)
        }
        expect(fakeFs.files.has('blocks/head')).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(unhandled).toEqual([])
    })
})

describe('an export through the batch commands', () => {
    const NAMES = ['a.png', 'b.mp3', 'c.webp']

    function plant(names: string[]) {
        for (const name of names) {
            fakeFs.plant(`assets/${name}`, filled(32, name.charCodeAt(0)))
        }
    }

    function exportedAssets(): Record<string, string> {
        const bytes = concat(backupSink.writes)
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const out: Record<string, string> = {}
        let offset = 0
        while (offset + 4 <= bytes.length) {
            const nameLength = view.getUint32(offset, true)
            offset += 4
            const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
            offset += nameLength
            const dataLength = view.getUint32(offset, true)
            offset += 4
            if (name !== 'database.risudat') {
                out[name] = hex(bytes.slice(offset, offset + dataLength))
            }
            offset += dataLength
        }
        return out
    }

    function expectedExport(names: string[]): Record<string, string> {
        return Object.fromEntries(names.map((name) => [name, hex(filled(32, name.charCodeAt(0)))]))
    }

    test('writes every asset in listing order with its own bytes', async () => {
        plant(NAMES)

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(batchFake.ctl.calls.some((call) => call.kind === 'read')).toBe(true)
        expect(exportedAssets()).toEqual(expectedExport(NAMES))
        expect(Object.keys(exportedAssets())).toEqual(fakeFs.listing('assets'))
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })

    test('an asset deleted between the listing and the read is reported as missing and the others are still written', async () => {
        plant(NAMES)
        batchFake.ctl.beforeRead = () => { fakeFs.files.delete('assets/b.mp3') }

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(exportedAssets()).toEqual(expectedExport(['a.png', 'c.webp']))
        expect(alertMdMock.mock.calls.map((call) => String(call[0])).join('\n')).toContain('assets/b.mp3')
    })

    test('a key the batch answers with invalid or error is read with the ranged reader and exported, and the export goes on', async () => {
        plant(NAMES)
        batchFake.ctl.invalidReads.add('assets/a.png')
        batchFake.ctl.erroredReads.add('assets/c.webp')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(exportedAssets()).toEqual(expectedExport(NAMES))
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })

    test('a read call that rejects leaves every key of its batch to be read with the ranged reader, and the export completes', async () => {
        plant(NAMES)
        batchFake.ctl.beforeRead = () => { throw new Error('scratch: transport went away') }

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(exportedAssets()).toEqual(expectedExport(NAMES))
    })

    test('a listing command that fails falls back to the store listing and no batched read is made', async () => {
        plant(NAMES)
        batchFake.ctl.failListing = true

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(batchFake.ctl.calls.filter((call) => call.kind === 'read')).toHaveLength(0)
        expect(exportedAssets()).toEqual(expectedExport(NAMES))
    })

    test('a writer that fails ends the export with the failed-and-deleted message only after every read in flight has settled', async () => {
        for (const index of [0, 1, 2, 3]) {
            fakeFs.plant(`assets/big${index}.bin`, filled(3 * MIB, index + 1))
        }
        const gates = holdReads([1, 2, 3])
        backupSink.failWrites = true

        const exporting = outcomeOf(SaveLocalBackup)
        await vi.waitFor(() => { expect(batchFake.ctl.calls.filter((call) => call.kind === 'read')).toHaveLength(4) })
        // Only the second read is released; the writer fails on what it brings,
        // while the third and fourth reads are still outstanding.
        gates.get(1)?.release()
        await vi.waitFor(() => { expect(backupSink.failedWrites).toBeGreaterThan(0) })
        expect(await isPending(exporting)).toBe(true)
        expect(allCallsSettled()).toBe(false)
        gates.get(2)?.release()
        gates.get(3)?.release()
        expect(await exporting).toBeNull()

        expect(allCallsSettled()).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileDeleted(null))
        expect(backupSink.removed).toEqual([BACKUP_PATH])
        expect(alertNormalMock).not.toHaveBeenCalled()
        expect(unhandled).toEqual([])
    })
})

/** The entries of the export written to the sink, in order, with the database entry last. */
function exportedEntries(): { name: string, data: Uint8Array }[] {
    const bytes = concat(backupSink.writes)
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

function exportedHasName(name: string): boolean {
    return Buffer.from(concat(backupSink.writes)).includes(name)
}

describe('an export of assets above CHUNK_MAX', () => {
    const BIG = 9 * MIB

    beforeEach(() => {
        // The listing reads sizes from metadata, not from the file, as the command does.
        batchFake.ctl.sizeOf = (key) => fakeFs.files.get(key)?.length
    })

    function plantBig(): Uint8Array {
        const data = patterned(BIG, 21)
        fakeFs.plant('assets/big.bin', data)
        return data
    }

    /** The asset entries as the container writes them: what a whole-asset export of these files produces. */
    function wholeExport(): Uint8Array {
        return concat(fakeFs.listing('assets').map((name) => buildChunk(name, fakeFs.files.get(`assets/${name}`) ?? new Uint8Array(0))))
    }

    test('a large asset is exported from the ranged reader in pieces of at most CHUNK_MAX, and every entry equals what a whole-asset export writes', async () => {
        fakeFs.plant('assets/a.png', filled(32, 1))
        plantBig()
        fakeFs.plant('assets/c.webp', patterned(CHUNK_MAX, 3))
        fakeFs.plant('assets/empty.bin', new Uint8Array(0))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const expected = wholeExport()
        const written = concat(backupSink.writes)
        expect(same(written.subarray(0, expected.length), expected)).toBe(true)
        expect(exportedEntries().at(-1)?.name).toBe('database.risudat')
        // The large key is never part of a batched read; the pieces come from read_range.
        expect(batchFake.ctl.calls.filter((call) => call.kind === 'read').flatMap((call) => call.keys)).not.toContain('assets/big.bin')
        expect(desktop.chunk.callsOf('read_range').filter((call) => call.args.key === 'assets/big.bin').map((call) => call.args.offset)).toEqual([0, CHUNK_MAX, 2 * CHUNK_MAX])
        expect(Math.max(...desktop.payloads)).toBeLessThanOrEqual(CHUNK_MAX)
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })

    test('a file that grew past the listed size is answered large by the batch and exported from the ranged reader', async () => {
        const data = plantBig()
        batchFake.ctl.listedSizes.set('assets/big.bin', 100)

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(batchFake.ctl.calls.filter((call) => call.kind === 'read').flatMap((call) => call.keys)).toContain('assets/big.bin')
        expect(same(exportedEntries()[0].data, data)).toBe(true)
        expect(alertMdMock).not.toHaveBeenCalled()
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })

    test('a key the batch defers is asked for again in a later batch and exported whole', async () => {
        fakeFs.plant('assets/a.png', filled(32, 1))
        fakeFs.plant('assets/b.png', filled(32, 2))
        batchFake.ctl.deferOnce.add('assets/b.png')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(batchFake.ctl.calls.filter((call) => call.kind === 'read').map((call) => call.keys)).toEqual([['assets/a.png', 'assets/b.png'], ['assets/b.png']])
        expect(same(concat(backupSink.writes).subarray(0, wholeExport().length), wholeExport())).toBe(true)
    })

    test('with the listing command failed every asset is exported from the ranged reader, none is reported missing, and the large one is whole', async () => {
        fakeFs.plant('assets/a.png', filled(32, 1))
        const data = plantBig()
        batchFake.ctl.failListing = true

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(batchFake.ctl.calls.filter((call) => call.kind === 'read')).toHaveLength(0)
        const names = exportedEntries().map((entry) => entry.name)
        expect(names).toEqual(['a.png', 'big.bin', 'database.risudat'])
        expect(same(exportedEntries()[1].data, data)).toBe(true)
        expect(alertMdMock).not.toHaveBeenCalled()
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })

    test('an asset absent when the ranged reader asks for it is reported as missing and the export goes on', async () => {
        fakeFs.plant('assets/a.png', filled(32, 1))
        fakeFs.plant('assets/gone.png', filled(32, 2))
        batchFake.ctl.failListing = true
        desktop.chunk.hooks.before = ({ key }) => { fakeFs.files.delete(key === 'assets/gone.png' ? key : '') }

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(exportedEntries().map((entry) => entry.name)).toEqual(['a.png', 'database.risudat'])
        expect(alertMdMock.mock.calls.map((call) => String(call[0])).join('\n')).toContain('assets/gone.png')
    })

    function replaceBigBetweenPieces(): void {
        desktop.chunk.hooks.before = ({ key, offset }) => {
            if (key === 'assets/big.bin' && offset > 0) {
                fakeFs.files.set(key, patterned(BIG, 99))
            }
        }
    }

    test('an asset that changes between pieces stops the export: the file is deleted, the message names the asset, and nothing says the backup succeeded', async () => {
        getDatabaseMock.mockImplementation(() => databaseWith({ userIcon: 'assets/big.bin' }))
        fakeFs.plant('assets/a.png', filled(32, 1))
        plantBig()
        replaceBigBetweenPieces()

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileDeleted(`'User Icon' from User Settings`))
        expect(backupSink.removed).toEqual([BACKUP_PATH])
        expect(alertNormalMock).not.toHaveBeenCalled()
        expect(alertMdMock).not.toHaveBeenCalled()
        // Nothing follows the changed asset: the database entry is never written.
        expect(exportedHasName('database.risudat')).toBe(false)
    })

    test('when the incomplete file cannot be deleted the message says so and says not to use it', async () => {
        plantBig()
        replaceBigBetweenPieces()
        backupSink.failRemove = true

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()
console.log('DBG', desktop.commands.slice(-12), eventLog.events.slice(-12));

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileKept(`'assets/big.bin'`))
        expect(backupSink.removed).toEqual([])
        expect(alertNormalMock).not.toHaveBeenCalled()
    })

    test('an asset that vanishes between pieces stops the export the same way', async () => {
        plantBig()
        desktop.chunk.hooks.before = ({ key, offset }) => {
            if (key === 'assets/big.bin' && offset > 0) {
                fakeFs.files.delete(key)
            }
        }

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileDeleted(`'assets/big.bin'`))
        expect(backupSink.removed).toEqual([BACKUP_PATH])
    })

    test('a failure before the output file is touched says nothing was written and deletes nothing', async () => {
        vi.mocked(collectColdStorageBackupPayloads).mockRejectedValueOnce(new Error('scratch: cold storage cannot be read'))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedNothingWritten())
        expect(backupSink.removed).toEqual([])
        expect(alertNormalMock).not.toHaveBeenCalled()
    })

    test('a failure after the writer is initialised and before any byte reached the file keeps the existing file and says nothing was written', async () => {
        // The late cold-storage collection runs after init and before the first write of a small profile.
        const empty = { payloads: [], missingKeys: [], invalidKeys: [] }
        vi.mocked(collectColdStorageBackupPayloads)
            .mockResolvedValueOnce(empty as unknown as Awaited<ReturnType<typeof collectColdStorageBackupPayloads>>)
            .mockRejectedValueOnce(new Error('scratch: late cold storage cannot be read'))
        fakeFs.plant('assets/a.png', filled(32, 1))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedNothingWritten())
        expect(backupSink.writes).toEqual([])
        expect(backupSink.removed).toEqual([])
        expect(alertNormalMock).not.toHaveBeenCalled()
    })

    describe('an asset larger than a backup entry can hold', () => {
        const TOO_BIG = 2 ** 32 + 5

        /** A 5 MiB asset first, so the writer has passed bytes to the file before the oversized one is reached. */
        function plantWrittenThenTooBig(): void {
            fakeFs.plant('assets/a.bin', patterned(5 * MIB, 4))
            plantBig()
            reportedTotals.set('assets/big.bin', TOO_BIG)
        }

        test('a first read_range trailer above 4 GiB ends the export on the failure path: the file is deleted, the message names the asset, and no entry of it, the database or a success is written', async () => {
            plantWrittenThenTooBig()

            expect(await outcomeOf(SaveLocalBackup)).toBeNull()

            expect(backupSink.writes.length).toBeGreaterThan(0)
            expect(alertErrorMock).toHaveBeenCalledTimes(1)
            expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedAssetTooLarge(`'assets/big.bin'`, 'deleted'))
            expect(backupSink.removed).toEqual([BACKUP_PATH])
            expect(alertNormalMock).not.toHaveBeenCalled()
            expect(alertMdMock).not.toHaveBeenCalled()
            expect(exportedHasName('big.bin')).toBe(false)
            expect(exportedHasName('database.risudat')).toBe(false)
            // Only the first piece was asked for: nothing is read on after the size is known to be too large.
            expect(desktop.chunk.callsOf('read_range').filter((call) => call.args.key === 'assets/big.bin')).toHaveLength(1)
        })

        test('the message says the asset is too large for an entry and does not tell the person to run the backup again', async () => {
            plantWrittenThenTooBig()

            expect(await outcomeOf(SaveLocalBackup)).toBeNull()

            const message = language.backupFailedAssetTooLarge(`'assets/big.bin'`, 'deleted')
            expect(message).toContain("'assets/big.bin'")
            expect(message).toContain('too large for a backup entry')
            expect(message).toContain('about 4.29 GB')
            expect(message).not.toMatch(/run the backup again/i)
            expect(alertErrorMock).toHaveBeenCalledWith(message)
        })

        test('when nothing reached the file the message says so and nothing is deleted', async () => {
            plantBig()
            reportedTotals.set('assets/big.bin', TOO_BIG)

            expect(await outcomeOf(SaveLocalBackup)).toBeNull()

            expect(alertErrorMock).toHaveBeenCalledTimes(1)
            expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedAssetTooLarge(`'assets/big.bin'`, 'untouched'))
            expect(backupSink.removed).toEqual([])
        })

        test('when the incomplete file cannot be deleted the message says not to use it', async () => {
            plantWrittenThenTooBig()
            backupSink.failRemove = true

            expect(await outcomeOf(SaveLocalBackup)).toBeNull()

            expect(alertErrorMock).toHaveBeenCalledTimes(1)
            expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedAssetTooLarge(`'assets/big.bin'`, 'kept'))
            expect(backupSink.removed).toEqual([])
        })
    })
    test('the busy marker of the export ends however the export ends', async () => {
        plantBig()
        replaceBigBetweenPieces()

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        // A second export is accepted: nothing is left marked as running.
        fakeFs.files.delete('assets/big.bin')
        backupSink.writes.length = 0
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })
})

describe('LocalWriter.writeBackupHeader', () => {
    test('rejects a body of 4 GiB or more and writes nothing, and accepts the largest length the container can state', async () => {
        const writer = new LocalWriter()
        expect(await writer.init()).toBe(true)

        await expect(writer.writeBackupHeader('assets/huge.bin', 2 ** 32)).rejects.toThrow('too large')
        await writer.close()
        expect(backupSink.writes).toEqual([])
        expect((writer.writer as TauriWriter).touchedFile).toBe(false)

        const second = new LocalWriter()
        expect(await second.init()).toBe(true)
        await expect(second.writeBackupHeader('assets/ok.bin', 0xFFFFFFFF)).resolves.toBeUndefined()
        await second.close()
        const header = concat(backupSink.writes)
        expect(new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(header.length - 4, true)).toBe(0xFFFFFFFF)
    })
})

describe('a failed export on a page that is not the desktop app', () => {
    /** Runs a full export on `target` that fails after the writer is initialised, from the late cold-storage collection. */
    async function failExportOn(target: ExportByteWriter): Promise<void> {
        vi.spyOn(LocalWriter.prototype, 'init').mockImplementation(async function (this: LocalWriter) {
            this.writer = target
            return true
        })
        const empty = { payloads: [], missingKeys: [], invalidKeys: [] }
        vi.mocked(collectColdStorageBackupPayloads)
            .mockResolvedValueOnce(empty as unknown as Awaited<ReturnType<typeof collectColdStorageBackupPayloads>>)
            .mockRejectedValueOnce(new Error('scratch: late cold storage cannot be read'))
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()
    }

    test('an export held in memory says nothing was written, since no download was produced, and drops what it held', async () => {
        const target = new BlobDownloadWriter('out.bin')
        const abort = vi.spyOn(target, 'abort')

        await failExportOn(target)

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedNothingWritten())
        expect(abort).toHaveBeenCalledTimes(1)
        expect(target.heldInMemory).toBe(true)
        expect(alertNormalMock).not.toHaveBeenCalled()
    })

    test('a stream that may already have reached the browser says the file is incomplete, and the stream is aborted', async () => {
        const written: Uint8Array[] = []
        const abort = vi.fn(async (_reason?: unknown) => { })
        const target: ExportByteWriter = {
            write: async (data) => { written.push(data) },
            close: async () => { },
            abort,
        }

        await failExportOn(target)

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileKept(null))
        expect(abort).toHaveBeenCalledTimes(1)
        expect(alertNormalMock).not.toHaveBeenCalled()
    })

    test('a stream whose abort fails is still reported as incomplete', async () => {
        const target: ExportByteWriter = {
            write: async () => { },
            close: async () => { },
            abort: async () => { throw new Error('scratch: the stream cannot be aborted') },
        }

        await failExportOn(target)

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileKept(null))
    })
})

describe('a partial backup', () => {
    test('reads its assets from the ranged reader and makes no batch call', async () => {
        getDatabaseMock.mockImplementation(() => databaseWith({ customBackground: 'assets/bg.webp' }))
        fakeFs.plant('assets/bg.webp', filled(16, 9))

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(batchFake.ctl.calls).toHaveLength(0)
        expect(concat(backupSink.writes).length).toBeGreaterThan(16)
        expect(desktop.count('read_range')).toBe(1)
    })

    test('a large profile image is exported in pieces of at most CHUNK_MAX and equals the file', async () => {
        const data = patterned(9 * MIB, 17)
        getDatabaseMock.mockImplementation(() => databaseWith({ customBackground: 'assets/bg.webp', userIcon: 'assets/icon.png' }))
        fakeFs.plant('assets/bg.webp', data)
        fakeFs.plant('assets/icon.png', filled(10, 2))

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        const entries = exportedEntries()
        expect(entries.map((entry) => entry.name)).toEqual(['icon.png', 'bg.webp', 'database.risudat'])
        expect(same(entries[1].data, data)).toBe(true)
        expect(Math.max(...desktop.payloads)).toBeLessThanOrEqual(CHUNK_MAX)
        expect(batchFake.ctl.calls).toHaveLength(0)
    })

    test('an asset that changes between pieces stops the partial backup: the file is deleted and the message names the asset', async () => {
        getDatabaseMock.mockImplementation(() => databaseWith({ customBackground: 'assets/bg.webp' }))
        fakeFs.plant('assets/bg.webp', patterned(9 * MIB, 17))
        desktop.chunk.hooks.before = ({ key, offset }) => {
            if (key === 'assets/bg.webp' && offset > 0) {
                fakeFs.files.set(key, patterned(9 * MIB, 18))
            }
        }

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileDeleted(`'Custom Background' from User Settings`))
        expect(backupSink.removed).toEqual([BACKUP_PATH])
        expect(alertNormalMock).not.toHaveBeenCalled()
        expect(exportedHasName('database.risudat')).toBe(false)
    })

    test('a writer that fails ends the partial backup with the failed-and-deleted message', async () => {
        getDatabaseMock.mockImplementation(() => databaseWith({ customBackground: 'assets/bg.webp' }))
        fakeFs.plant('assets/bg.webp', filled(16, 9))
        backupSink.failWrites = true

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileDeleted(null))
        expect(backupSink.removed).toEqual([BACKUP_PATH])
    })
})

describe('inlays on the desktop', () => {
    function bigImage(size: number, seed: number) {
        return { name: `big-${seed}.png`, ext: 'png', type: 'image' as const, width: 5, height: 6, data: new Blob([asBlobPart(patterned(size, seed))], { type: 'image/png' }) }
    }

    function dropStoredInlays(): void {
        for (const key of [...fakeFs.files.keys()]) {
            if (key.startsWith('inlays/')) {
                fakeFs.files.delete(key)
            }
        }
        legacyInlays.clear()
    }

    test('reproducer: an inlay body over CHUNK_MAX restores as an inlay and is never written as an asset', async () => {
        await setInlayAsset('big', bigImage(5 * MIB + 17, 3))
        await setInlayAsset('small', bigImage(400, 4))
        const before = { big: await getInlayAsset('big'), small: await getInlayAsset('small') }
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()
        const backup = concat(backupSink.writes)
        dropStoredInlays()
        expect(await getInlayAsset('big')).toBeNull()

        await restoreBytes(backup)

        expect(await getInlayAsset('big')).not.toBeNull()
        expect({ big: await getInlayAsset('big'), small: await getInlayAsset('small') }).toEqual(before)
        expect(Object.keys(storedAssets()).filter((key) => key.includes('inlay'))).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(fakeFs.files.has('blocks/head')).toBe(true)
    })

    test('acceptance: the export reads a stored inlay body in pieces of at most CHUNK_MAX and holds no whole-body read', async () => {
        await setInlayAsset('big', bigImage(9 * MIB, 5))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const reads = desktop.chunk.callsOf('read_range').filter((call) => String(call.args.key).startsWith('inlays/b-'))
        expect(reads.length).toBeGreaterThanOrEqual(3)
        for (const call of reads) {
            expect(call.args.len).toBeLessThanOrEqual(CHUNK_MAX)
        }
        const entries = exportedEntries().map((entry) => entry.name).filter((name) => name.startsWith('risu-inlay-'))
        expect(entries).toHaveLength(1)
    })
})

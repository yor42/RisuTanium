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
 * a partial backup never uses the commands. A mocked command is not evidence
 * about the native backend.
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

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[], failWrites: false, failedWrites: 0 }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
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

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    ...fakeFs.module,
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
    alertError: alertErrorMock,
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
    invoke: fakeFs.invoke,
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
import { dbWriteLock, wasAssetWrittenThisPage } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { alertWait } from 'src/ts/alert'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { getAppStore } from 'src/ts/storage/store/appStore'

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

        // Calls 1-3 are the walk, call 4 reads the first asset, call 5 rejects.
        const restoring = startRestore(fileWithRejectingSlice(walkView(), 5))
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

describe('an entry larger than the byte budget', () => {
    test('is written alone through the single-entry command, with nothing else in flight before, during or until it settles', async () => {
        const big = filled(17 * MIB, 7)

        await restoreBytes(backupOf([['before.png', filled(8, 1)], ['huge.bin', big], ['after.png', filled(8, 2)]]))

        expect(batchFake.ctl.calls.map((call) => [call.kind, call.keys])).toEqual([
            ['batch', ['assets/before.png']],
            ['single', ['assets/huge.bin']],
            ['batch', ['assets/after.png']],
        ])
        expect(batchFake.ctl.calls.map((call) => call.inFlightAtStart)).toEqual([0, 0, 0])
        expect(storedBytes('huge.bin')?.length).toBe(big.length)
        expect(storedBytes('huge.bin')?.[0]).toBe(7)
        expect(fakeFs.files.has('blocks/head')).toBe(true)
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

    test('a key the batch answers with invalid or error is read through the store and exported, and the export goes on', async () => {
        plant(NAMES)
        batchFake.ctl.invalidReads.add('assets/a.png')
        batchFake.ctl.erroredReads.add('assets/c.webp')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(exportedAssets()).toEqual(expectedExport(NAMES))
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })

    test('a read call that rejects leaves every key of its batch to be read through the store, and the export completes', async () => {
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

    test('a writer that fails leaves the export rejected only after every read in flight has settled', async () => {
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
        const outcome = await exporting

        expect(outcome).toBeInstanceOf(Error)
        expect(allCallsSettled()).toBe(true)
        expect(unhandled).toEqual([])
    })
})

describe('a partial backup', () => {
    test('reads its assets one at a time through the store and makes no batch call', async () => {
        getDatabaseMock.mockImplementation(() => databaseWith({ customBackground: 'assets/bg.webp' }))
        fakeFs.plant('assets/bg.webp', filled(16, 9))

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(batchFake.ctl.calls).toHaveLength(0)
        expect(concat(backupSink.writes).length).toBeGreaterThan(16)
    })
})

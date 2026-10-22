// @vitest-environment happy-dom

/**
 * `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) on an Android page: the
 * restore's asset writes go to `put_assets_batch_b64` in batches, and not one
 * `mkdir` plus one `write_chunk` per asset. The batch command is a recording
 * stand-in that writes through the page's real store, so a refused name, a failed
 * frame and a rejected call can be injected; the chunk commands are answered by
 * the in-memory chunk fake. A mocked command is not evidence about the native
 * backend or the Android bridge; the Rust side is covered by the `asset_batch`
 * tests of `src-tauri`.
 *
 * Pinned: an Android page batches (red when the Android pipeline is missing); a
 * batch carries at most the pipeline's `batchBytes`, and that same number is the
 * size limit handed to the command; an asset above `batchBytes` is streamed and
 * never raises a `RangeError`; the desktop page keeps the raw command; a failed
 * frame or a rejected call stops the restore before any commit, names the failure
 * with the existing message, and leaves the assets that landed in place; a refused
 * name is reported in the skip notice and the restore goes on.
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
const osBox = vi.hoisted(() => ({ os: 'android' }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 4 * 1024 * 1024 }))

interface WireBatch {
    command: 'put_assets_batch' | 'put_assets_batch_b64'
    maxEntryBytes: number | undefined
    keys: string[]
    entryBytes: number
}
/** What reached the stand-in batch commands and the chunk command, in order. */
const wire = vi.hoisted(() => ({
    batches: [] as WireBatch[],
    chunkKeys: [] as string[],
    /** The key whose frame is answered `error` without being written. */
    errorKey: null as string | null,
    /** The 0-based call that rejects as a whole, before anything is written. */
    rejectCall: -1,
    rangeErrors: [] as unknown[],
    /** Stand-in batch calls running now; chunk calls made inside one are not the page's own. */
    inBatch: 0,
    /** Batch calls made and not yet answered, the most at once, and a hold every call waits at before it is recorded. */
    batchOutstanding: 0,
    maxBatchOutstanding: 0,
    batchHold: null as Promise<void> | null,
    /** How many batch calls had started a tick after the first failing call answered; no call may start after that. */
    failureSeen: null as number | null,
}))
/** The chunk writes of the page's large-entry streams (keys `assets/l*`): the write ids open now, the most open at once, and a hold on every stream's first chunk. */
const streamTrack = vi.hoisted(() => ({
    open: new Set<string>(),
    maxOpen: 0,
    /** The keys whose first chunk write is waiting at `hold`. */
    held: new Set<string>(),
    hold: null as Promise<void> | null,
    /** When set, only the stream of this key waits at `hold`. */
    holdOnly: null as string | null,
    /** Lets the held writes go; the cleanup of a test whose restore is still held. */
    release: null as (() => void) | null,
}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const setDatabaseMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
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

vi.mock('@tauri-apps/plugin-fs', () => ({ ...fakeFs.module }))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => 'backup-output.bin'),
}))

/**
 * The batch commands as recording stand-ins over the page's store. The real
 * `encodePutFrames` runs first, so a call above its size limit rejects here as
 * it does on the page, and the recorded sizes are those of the real frames.
 */
vi.mock('src/ts/storage/tauriAssetBatch', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/storage/tauriAssetBatch')>()
    const { getAppStore } = await import('src/ts/storage/store/appStore')
    const { StoreInvalidKeyError } = await import('src/ts/storage/store/errors')
    function noteFailureAnswered(): void {
        // A macrotask later every consequence of the answer has run, so a call counted after this one started after the failure settled.
        setTimeout(() => { wire.failureSeen ??= wire.batches.length }, 0)
    }
    /** Counts the calls outstanding at once, and holds each at `wire.batchHold` before it is recorded. */
    async function counted(command: WireBatch['command'], entries: readonly { key: string, data: Uint8Array }[], maxEntryBytes: number | undefined) {
        wire.batchOutstanding += 1
        wire.maxBatchOutstanding = Math.max(wire.maxBatchOutstanding, wire.batchOutstanding)
        try {
            if (wire.batchHold !== null) {
                await wire.batchHold
            }
            return await run(command, entries, maxEntryBytes)
        } finally {
            wire.batchOutstanding -= 1
        }
    }
    async function run(command: WireBatch['command'], entries: readonly { key: string, data: Uint8Array }[], maxEntryBytes: number | undefined) {
        const callIndex = wire.batches.length
        try {
            original.encodePutFrames(entries, maxEntryBytes)
        } catch (error) {
            wire.rangeErrors.push(error)
            throw error
        }
        wire.batches.push({
            command,
            maxEntryBytes,
            keys: entries.map((entry) => entry.key),
            entryBytes: entries.reduce((sum, entry) => sum + entry.data.length, 0),
        })
        await Promise.resolve()
        if (callIndex === wire.rejectCall) {
            noteFailureAnswered()
            throw new Error('scratch: the bridge went away')
        }
        const store = await getAppStore()
        const results: Awaited<ReturnType<typeof original.writeAssetBatch>> = []
        // The stand-in writes through the store, whose chunk calls are the native command's own work here.
        wire.inBatch += 1
        try {
            for (const entry of entries) {
                if (entry.key === wire.errorKey) {
                    results.push({ k: 'error', message: 'scratch: disk full' })
                    noteFailureAnswered()
                    continue
                }
                try {
                    await store.write(entry.key, entry.data, 'unconditional')
                    results.push({ k: 'ok' })
                } catch (error) {
                    if (error instanceof StoreInvalidKeyError) {
                        results.push({ k: 'invalid', reason: error.message })
                    } else {
                        throw error
                    }
                }
            }
        } finally {
            wire.inBatch -= 1
        }
        return results
    }
    return {
        ...original,
        writeAssetBatch: (entries: readonly { key: string, data: Uint8Array }[], maxEntryBytes?: number) => counted('put_assets_batch', entries, maxEntryBytes),
        writeAssetBatchB64: (entries: readonly { key: string, data: Uint8Array }[], maxEntryBytes: number) => counted('put_assets_batch_b64', entries, maxEntryBytes),
    }
})

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
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
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
        if (command === 'write_chunk' && wire.inBatch === 0) {
            wire.chunkKeys.push((args as { key: string }).key)
        }
        const chunk = command === 'write_chunk' ? args as { key: string, id: string, offset: number, last: boolean } : undefined
        const isStream = chunk !== undefined && chunk.key.startsWith('assets/l')
        if (isStream) {
            streamTrack.open.add(chunk.id)
            streamTrack.maxOpen = Math.max(streamTrack.maxOpen, streamTrack.open.size)
            if (streamTrack.hold !== null && chunk.offset === 0 && (streamTrack.holdOnly === null || streamTrack.holdOnly === chunk.key)) {
                streamTrack.held.add(chunk.key)
                await streamTrack.hold
            }
        }
        const reply = await (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options)
        if (isStream && chunk.last) {
            streamTrack.open.delete(chunk.id)
        }
        if (command === 'abort_chunked') {
            streamTrack.open.delete(String((args as { id?: string } | undefined)?.id))
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
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { alertWait } from 'src/ts/alert'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { CHUNK_MAX, resetByteTransportForTests, WRITE_CHUNK_BYTES } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { overrideBackupWindowBytes } from 'src/ts/drive/backupContainer'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'

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

function filled(size: number, fill: number): Uint8Array {
    return new Uint8Array(size).fill(fill)
}

function databaseChunk(): Uint8Array {
    const database = { characters: [], personas: [], characterOrder: [], botPresets: [] } as unknown as Database
    return buildChunk('database.risudat', encodeRisuSaveLegacy(database, 'noCompression'))
}

function backupOf(entries: [string, Uint8Array][]): Uint8Array {
    return concat([...entries.map(([name, data]) => buildChunk(name, data)), databaseChunk()])
}

function storedBytes(name: string): Uint8Array | undefined {
    return fakeFs.files.get(`assets/${name}`)
}

function sameBytes(actual: Uint8Array | undefined, expected: Uint8Array): boolean {
    return actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

let lastRestore: Promise<void> | null = null

function restoreFile(file: File): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    lastRestore = (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    return lastRestore
}

function restoreBytes(bytes: Uint8Array): Promise<void> {
    return restoreFile(new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'))
}

function patterned(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        out[i] = (i * 13 + seed) % 251
    }
    return out
}

interface Gate {
    promise: Promise<void>
    release(): void
}

/** Every gate made since the test began, so the cleanup can open the ones a failed test left closed. */
const madeGates: Gate[] = []

function gate(): Gate {
    let release: () => void = () => { }
    const promise = new Promise<void>((resolve) => { release = resolve })
    const made = { promise, release }
    madeGates.push(made)
    return made
}

/** Longest a step waits for the restore to reach a held state; below `RESTORE_TEST_TIMEOUT_MS`, and long enough for a loaded machine. */
const PROGRESS_WAIT_MS = 8000
const RESTORE_TEST_TIMEOUT_MS = 20000
/** Longest the cleanup waits for a released restore to end before it reports the leak. */
const RESTORE_END_WAIT_MS = 2000
vi.setConfig({ testTimeout: RESTORE_TEST_TIMEOUT_MS })

/** `vi.waitFor` for a step that waits on large-entry progress. */
function waitForProgress(check: () => void): Promise<void> {
    return vi.waitFor(check, { timeout: PROGRESS_WAIT_MS })
}

async function settleTimers(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25))
}

/** The asset keys written by a per-asset `write_chunk`, as the Android store does without a batch. */
function perAssetChunkKeys(): string[] {
    return wire.chunkKeys.filter((key) => key.startsWith('assets/'))
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = true
    osBox.os = 'android'
    desktop.reset()
    wire.batches.length = 0
    wire.chunkKeys.length = 0
    wire.errorKey = null
    wire.rejectCall = -1
    wire.rangeErrors.length = 0
    wire.inBatch = 0
    wire.batchOutstanding = 0
    wire.maxBatchOutstanding = 0
    wire.batchHold = null
    wire.failureSeen = null
    streamTrack.open.clear()
    streamTrack.maxOpen = 0
    streamTrack.held.clear()
    streamTrack.hold = null
    streamTrack.holdOnly = null
    streamTrack.release = null
    resetByteTransportForTests()
    resetAssetBatchAvailabilityForTests()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    setDatabaseMock.mockReset()
    alertErrorMock.mockReset()
    alertNormalWaitMock.mockReset().mockImplementation(async () => { })
    reloadMark.marked = false
    vi.spyOn(console, 'error').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    getDatabaseMock.mockImplementation(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
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

afterEach(async () => {
    // A test that failed while its restore was held leaves that restore running, and the next test's restore would be refused as busy.
    for (const held of madeGates.splice(0)) {
        held.release()
    }
    streamTrack.release?.()
    let leaked = false
    if (lastRestore !== null) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const ended = await Promise.race([
            lastRestore.then(() => true, () => true),
            new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), RESTORE_END_WAIT_MS) }),
        ])
        clearTimeout(timer)
        leaked = !ended
    }
    lastRestore = null
    capturedInput = null
    resetBusyActionsForTest()
    overrideBackupWindowBytes(null)
    localStorage.removeItem('risu-measure-copy')
    vi.mocked(alertWait).mockReset()
    createElementSpy.mockRestore()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
    if (leaked) {
        throw new Error('the restore of this test did not end after every hold was released; its state was reset so the next test starts clean')
    }
})

describe('a restore on an Android page', () => {
    // Regression reproducer: without an Android pipeline every asset is its own store write (a chunk call each),
    // and no batch call is made.
    test('writes many small assets in batch calls and not one chunk write per asset', async () => {
        const names = Array.from({ length: 40 }, (_, index) => `s${index}.png`)

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(1000 + index, index + 1)])))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(perAssetChunkKeys()).toEqual([])
        expect(wire.batches.length).toBeGreaterThanOrEqual(1)
        expect(wire.batches.length).toBeLessThan(names.length / 4)
        expect(wire.batches.every((batch) => batch.command === 'put_assets_batch_b64')).toBe(true)
        expect(wire.batches.flatMap((batch) => batch.keys).sort()).toEqual(names.map((name) => `assets/${name}`).sort())
        for (const [index, name] of names.entries()) {
            expect(sameBytes(storedBytes(name), filled(1000 + index, index + 1))).toBe(true)
        }
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('hands the command exactly the pipeline batch size, and no call carries more entry bytes than that', async () => {
        const names = Array.from({ length: 12 }, (_, index) => `m${index}.png`)

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(300 * 1024, index + 1)])))

        expect(wire.batches.length).toBeGreaterThan(1)
        for (const batch of wire.batches) {
            expect(batch.maxEntryBytes).toBe(WRITE_CHUNK_BYTES)
            expect(batch.entryBytes).toBeLessThanOrEqual(WRITE_CHUNK_BYTES)
        }
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    // The loop used to compare with CHUNK_MAX: a 1 MiB to 4 MiB asset would reach `add` and throw a RangeError.
    test('streams every asset above the batch size, so an asset between 1 and 4 MiB raises no RangeError', async () => {
        const sizes: [string, number][] = [
            ['below.bin', MIB - 1],
            ['exact.bin', MIB],
            ['above.bin', MIB + 1],
            ['huge.bin', CHUNK_MAX + 1],
        ]
        const entries = sizes.map(([name, size], index): [string, Uint8Array] => [name, filled(size, index + 10)])

        await restoreBytes(backupOf([['tiny.png', filled(5, 1)], ...entries]))

        expect(wire.rangeErrors).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        const batched = wire.batches.flatMap((batch) => batch.keys)
        expect(batched).toContain('assets/tiny.png')
        expect(batched).toContain('assets/below.bin')
        expect(batched).toContain('assets/exact.bin')
        expect(batched).not.toContain('assets/above.bin')
        expect(batched).not.toContain('assets/huge.bin')
        for (const [index, [name, size]] of sizes.entries()) {
            expect(sameBytes(storedBytes(name), filled(size, index + 10))).toBe(true)
        }
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('a frame answered error stops the restore with the existing message, commits nothing and leaves the assets that landed', async () => {
        const names = Array.from({ length: 12 }, (_, index) => `e${index}.png`)
        wire.errorKey = 'assets/e1.png'

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(300 * 1024, index + 1)])))

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        // The frames of the failing batch around the failed one landed; the failed one did not.
        expect(storedBytes('e0.png')).toBeDefined()
        expect(storedBytes('e2.png')).toBeDefined()
        expect(storedBytes('e1.png')).toBeUndefined()
        // Nothing is sent after the failure was seen: no batch call starts once the failing call has settled.
        await settleTimers()
        expect(wire.failureSeen).not.toBeNull()
        expect(wire.batches.length).toBe(wire.failureSeen)
    })

    test('a call that rejects as a whole stops the restore the same way', async () => {
        const names = Array.from({ length: 12 }, (_, index) => `r${index}.png`)
        wire.rejectCall = 0

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(300 * 1024, index + 1)])))

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        await settleTimers()
        expect(wire.failureSeen).not.toBeNull()
        expect(wire.batches.length).toBe(wire.failureSeen)
    })

    test('a name the store refuses is named in the skip notice and the restore goes on', async () => {
        await restoreBytes(backupOf([['.badA', filled(20, 1)], ['good.png', filled(20, 2)], ['.badB', filled(20, 3)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(2, ['.badA', '.badB']))
        expect(sameBytes(storedBytes('good.png'), filled(20, 2))).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Regression reproducer: a streamed asset (above batchBytes) skips the batch path, and the Android chunked
    // writer does not apply the page key rule, so the refusal used to surface as a whole-import failure.
    test('a streamed asset whose name the store refuses is named in the skip notice and the restore goes on', async () => {
        await restoreBytes(backupOf([['.bigbad', filled(MIB + 1, 7)], ['good.png', filled(20, 2)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, ['.bigbad']))
        expect(storedBytes('.bigbad')).toBeUndefined()
        expect(sameBytes(storedBytes('good.png'), filled(20, 2))).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('a batch hands the sender distinct frames in file order with the key rules of the page store', async () => {
        await restoreBytes(backupOf([['one.png', filled(4, 1)], ['two.png', filled(4, 2)], ['three.png', filled(4, 3)]]))

        expect(wire.batches).toHaveLength(1)
        expect(wire.batches[0].keys).toEqual(['assets/one.png', 'assets/two.png', 'assets/three.png'])
    })
})

// The backups here are built entry by entry (`buildChunk`) rather than exported: this harness has no export path, and the
// layout of one entry is the container's own, the same one the desktop harness's exported backups end up in.
describe('a restore on an Android page with several large-entry streams at once', () => {
    const KNOB = 'risu-measure-copy'
    const LARGE_SIZE = MIB + MIB / 2
    const LARGE_NAMES = ['l1.bin', 'l2.bin', 'l3.bin', 'l4.bin', 'l5.bin']
    const SMALL_NAMES = ['s1.png', 's2.png', 's3.png']

    function tempFiles(): string[] {
        return [...fakeFs.files.keys()].filter((path) => path.includes('risu-write'))
    }

    function largeBody(name: string): Uint8Array {
        return patterned(LARGE_SIZE, LARGE_NAMES.indexOf(name) + 1)
    }

    function smallBody(name: string): Uint8Array {
        return filled(40, SMALL_NAMES.indexOf(name) + 1)
    }

    function backupFor(largeNames: string[]): Uint8Array {
        return backupOf([
            ...SMALL_NAMES.map((name): [string, Uint8Array] => [name, smallBody(name)]),
            ...largeNames.map((name): [string, Uint8Array] => [name, largeBody(name)]),
        ])
    }

    function expectEveryAssetRestored(largeNames: string[]): void {
        for (const name of largeNames) {
            expect(sameBytes(storedBytes(name), largeBody(name))).toBe(true)
        }
        for (const name of SMALL_NAMES) {
            expect(sameBytes(storedBytes(name), smallBody(name))).toBe(true)
        }
    }

    /** A file whose slice of exactly WRITE_CHUNK_BYTES that is the `nth` (from 0) of that size rejects once `until` holds. */
    function fileWithLateFailingSlice(bytes: Uint8Array, nth: number, until: () => boolean): File {
        const base = new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
        let seen = 0
        return new Proxy(base, {
            get(target, prop, receiver) {
                if (prop === 'slice') {
                    return (start = 0, end = target.size) => {
                        if (end - start === WRITE_CHUNK_BYTES && seen++ === nth) {
                            return {
                                arrayBuffer: async () => {
                                    while (!until()) {
                                        await new Promise((resolve) => setTimeout(resolve, 1))
                                    }
                                    throw new Error('scratch: unreadable region')
                                },
                            } as unknown as Blob
                        }
                        return target.slice(start, end)
                    }
                }
                return Reflect.get(target, prop, receiver)
            },
        })
    }

    test('five large entries restore byte-exact with three streams at once and never more, in chunks of at most WRITE_CHUNK_BYTES', async () => {
        localStorage.setItem(KNOB, '3,2')
        const release = gate()
        streamTrack.hold = release.promise
        streamTrack.release = release.release

        const restoring = restoreBytes(backupFor(LARGE_NAMES))
        await waitForProgress(() => { expect(streamTrack.held.size).toBe(3) })
        await settleTimers()

        expect(streamTrack.held.size).toBe(3)
        expect(streamTrack.open.size).toBe(3)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        release.release()
        await restoring

        expect(streamTrack.maxOpen).toBe(3)
        expectEveryAssetRestored(LARGE_NAMES)
        expect(Math.max(...desktop.chunk.chunkSizes)).toBeLessThanOrEqual(WRITE_CHUNK_BYTES)
        expect(tempFiles()).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('the database is not installed while a stream is still writing, and every asset is complete when it is', async () => {
        const largeNames = LARGE_NAMES.slice(0, 3)
        localStorage.setItem(KNOB, '3,2')
        const release = gate()
        streamTrack.hold = release.promise
        streamTrack.release = release.release
        let completeAtInstall: boolean | null = null
        setDatabaseMock.mockImplementation(() => {
            completeAtInstall = largeNames.every((name) => sameBytes(storedBytes(name), largeBody(name)))
                && SMALL_NAMES.every((name) => sameBytes(storedBytes(name), smallBody(name)))
        })

        const restoring = restoreBytes(backupFor(largeNames))
        await waitForProgress(() => { expect(streamTrack.held.size).toBe(3) })
        await settleTimers()

        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(largeNames.some((name) => storedBytes(name) !== undefined)).toBe(false)
        release.release()
        await restoring

        expect(completeAtInstall).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Guard: passes before and after. Natural timing may run one stream or two, never more than the Android cap of two;
    // the test below holds the streams and proves the cap is reached.
    test('guard: without the knob the same backup restores byte-exact with at most two streams at a time', async () => {
        await restoreBytes(backupFor(LARGE_NAMES))

        expect(streamTrack.maxOpen).toBeLessThanOrEqual(2)
        expectEveryAssetRestored(LARGE_NAMES)
        expect(tempFiles()).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Regression of the default (red on the base, where the Android default is one stream; not a defect reproducer).
    test('without the knob two large entries stream at once and a third waits for a free slot', async () => {
        const release = gate()
        streamTrack.hold = release.promise
        streamTrack.release = release.release

        const restoring = restoreBytes(backupFor(LARGE_NAMES))
        await waitForProgress(() => { expect(streamTrack.held.size).toBe(2) })
        await settleTimers()

        expect(streamTrack.held.size).toBe(2)
        expect(streamTrack.open.size).toBe(2)
        release.release()
        await restoring

        expect(streamTrack.maxOpen).toBe(2)
        expectEveryAssetRestored(LARGE_NAMES)
        expect(tempFiles()).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Regression of the default (red on the base, where two batch calls are the most in flight; not a defect reproducer).
    test('without the knob four batch calls are outstanding at once and a fifth waits for one to settle', async () => {
        const names = Array.from({ length: 24 }, (_, index) => `m${index}.png`)
        const hold = gate()
        wire.batchHold = hold.promise

        const restoring = restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(300 * 1024, index + 1)])))
        await waitForProgress(() => { expect(wire.batchOutstanding).toBe(4) })
        await settleTimers()

        expect(wire.batchOutstanding).toBe(4)
        expect(wire.maxBatchOutstanding).toBe(4)
        hold.release()
        await restoring

        expect(wire.maxBatchOutstanding).toBe(4)
        for (const [index, name] of names.entries()) {
            expect(sameBytes(storedBytes(name), filled(300 * 1024, index + 1))).toBe(true)
        }
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    function seededRandom(seed: number): () => number {
        let state = seed >>> 0
        return () => {
            state = (state + 0x6D2B79F5) >>> 0
            let t = state
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }

    const MIX_COUNT = 60
    const MIX_FORCED_LARGE = [4, 11, 17, 26, MIX_COUNT - 1]

    /**
     * A phone-like mix built entry by entry: most entries a few KiB, about one in ten between 1 and 4 MiB spread through the
     * file, the last entry before the database a large one, and every body distinct.
     */
    function phoneMix(): { entries: [string, Uint8Array][], largeCount: number } {
        const random = seededRandom(20261022)
        const entries: [string, Uint8Array][] = []
        let largeCount = 0
        for (let index = 0; index < MIX_COUNT; index++) {
            const large = MIX_FORCED_LARGE.includes(index) || random() < 0.08
            if (large) {
                largeCount++
                entries.push([`l${index}.bin`, patterned(MIB + 1 + Math.floor(random() * 3 * MIB - 1), index + 1)])
            } else {
                entries.push([`s${index}.png`, patterned(1024 + Math.floor(random() * 8 * 1024), index + 1)])
            }
        }
        return { entries, largeCount }
    }

    // Guard at the knob values, which the base honours as well; red on the base with no knob, where the held streams never reach two.
    test.each([
        { knob: '2,4', streams: 2 },
        { knob: '4,4', streams: 4 },
        { knob: null, streams: 2 },
    ])('a phone-like mix restores byte-exact with $streams streams at once (knob $knob), complete when the database is installed', async ({ knob, streams }) => {
        if (knob !== null) {
            localStorage.setItem(KNOB, knob)
        }
        const mix = phoneMix()
        expect(mix.largeCount).toBeGreaterThan(streams)
        expect(mix.entries[mix.entries.length - 1][0]).toMatch(/^l/)
        const release = gate()
        streamTrack.hold = release.promise
        streamTrack.release = release.release
        let completeAtInstall: boolean | null = null
        setDatabaseMock.mockImplementation(() => {
            completeAtInstall = mix.entries.every(([name, body]) => sameBytes(storedBytes(name), body))
        })

        const restoring = restoreBytes(backupOf(mix.entries))
        await waitForProgress(() => { expect(streamTrack.held.size).toBe(streams) })
        await settleTimers()

        expect(streamTrack.held.size).toBe(streams)
        expect(streamTrack.open.size).toBe(streams)
        // The last entry's stream is held at a second gate once the first streams are let go: the database must wait for it.
        const lastKey = `assets/${mix.entries[mix.entries.length - 1][0]}`
        const releaseLast = gate()
        streamTrack.holdOnly = lastKey
        streamTrack.hold = releaseLast.promise
        streamTrack.release = releaseLast.release
        release.release()
        await waitForProgress(() => { expect(streamTrack.held.has(lastKey)).toBe(true) })
        await settleTimers()
        expect(setDatabaseMock).not.toHaveBeenCalled()
        releaseLast.release()
        await restoring

        expect(streamTrack.maxOpen).toBe(streams)
        for (const [name, body] of mix.entries) {
            expect(sameBytes(storedBytes(name), body)).toBe(true)
        }
        expect(completeAtInstall).toBe(true)
        expect(tempFiles()).toEqual([])
        expect(wire.rangeErrors).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Guard on the base, where the serial path records the refused name as well. At the default the beside path runs it, and the
    // mutant that drops the refused name on that path turns it red, as it does the streamed refused-name test of the first group.
    test('guard: a large entry whose name the store refuses is skipped and its large neighbours land byte-exact', async () => {
        const first = patterned(LARGE_SIZE, 1)
        const second = patterned(LARGE_SIZE, 2)

        await restoreBytes(backupOf([['l1.bin', first], ['.bad1', filled(MIB + 1, 7)], ['l2.bin', second], ['s1.png', filled(40, 3)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, ['.bad1']))
        expect(storedBytes('.bad1')).toBeUndefined()
        expect(sameBytes(storedBytes('l1.bin'), first)).toBe(true)
        expect(sameBytes(storedBytes('l2.bin'), second)).toBe(true)
        expect(sameBytes(storedBytes('s1.png'), filled(40, 3))).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Regression of the default: a throw in the loop while a large stream is active stops that stream at its next chunk.
    // Red on the base because the base runs one stream, which finishes before the throw; not a defect reproducer. The mutant
    // that skips `stopStreams` on a thrown pass turns it red at the default.
    test('a throw in the loop while a large stream is active shows the failure, installs nothing and leaves no bytes or temp file of that stream', async () => {
        const release = gate()
        streamTrack.hold = release.promise
        streamTrack.release = release.release
        const inlayName = `risu-inlay-${'a'.repeat(64)}-0.part`
        const bytes = backupOf([['l1.bin', patterned(LARGE_SIZE, 1)], [inlayName, filled(77, 3)], ['s1.png', filled(40, 1)]])
        const base = new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
        // The inlay part is read with a slice of exactly its size, outside any handler of the entry loop.
        const file = new Proxy(base, {
            get(target, prop, receiver) {
                if (prop === 'slice') {
                    return (start = 0, end = target.size) => {
                        if (end - start === 77) {
                            throw new Error('scratch: slice threw')
                        }
                        return target.slice(start, end)
                    }
                }
                return Reflect.get(target, prop, receiver)
            },
        })

        const restoring = restoreFile(file)
        await waitForProgress(() => { expect(streamTrack.held.size).toBe(1) })
        await settleTimers()
        release.release()
        await restoring

        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(storedBytes('l1.bin')).toBeUndefined()
        expect(tempFiles()).toEqual([])
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    test('a stream whose source cannot be read stops the others at their next chunk: the changed-file message after every stream settled, nothing finished, nothing installed', async () => {
        const largeNames = LARGE_NAMES.slice(0, 3)
        localStorage.setItem(KNOB, '3,2')
        const release = gate()
        streamTrack.hold = release.promise
        streamTrack.release = release.release
        // Windows of 64 KiB, so the slices of WRITE_CHUNK_BYTES bytes are the streams' own; the third stream's first read fails once the other two are held.
        overrideBackupWindowBytes({ walk: 65536, copy: 65536 })
        const file = fileWithLateFailingSlice(backupFor(largeNames), 2, () => streamTrack.held.size >= 2)

        const restoring = restoreFile(file)
        await waitForProgress(() => { expect(streamTrack.held.size).toBe(2) })
        await settleTimers()
        expect(alertErrorMock).not.toHaveBeenCalled()
        release.release()
        await restoring

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
        expect(largeNames.some((name) => storedBytes(name) !== undefined)).toBe(false)
        expect(tempFiles()).toEqual([])
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(fakeFs.files.has('blocks/head')).toBe(false)
    })
})

describe('the message while the copies finish on an Android page', () => {
    const FINISHING = 'Finishing copying files...'
    const PROGRESS = 'Loading local Backup...'
    const LARGE_SIZE = MIB + MIB / 2

    function waitTexts(): string[] {
        return vi.mocked(alertWait).mock.calls.map((call) => String(call[0]))
    }

    function lastProgressPercent(): number {
        const texts = waitTexts().filter((text) => text.startsWith(PROGRESS))
        const match = /\((\d+\.\d+)%\)/.exec(texts[texts.length - 1] ?? '')
        return match === null ? Number.NaN : Number(match[1])
    }

    function lastIndexWhere(texts: string[], matches: (text: string) => boolean): number {
        for (let index = texts.length - 1; index >= 0; index--) {
            if (matches(texts[index])) {
                return index
            }
        }
        return -1
    }

    // Regression: the base keeps the last percentage until the commit and never shows the message, so the wait times out.
    test.each([
        { label: 'small entries and large entries', entries: [['s1.png', filled(40, 1)], ['l1.bin', patterned(LARGE_SIZE, 1)], ['l2.bin', patterned(LARGE_SIZE, 2)]] as [string, Uint8Array][] },
        { label: 'large entries only, so only a stream is outstanding', entries: [['l1.bin', patterned(LARGE_SIZE, 1)], ['l2.bin', patterned(LARGE_SIZE, 2)]] as [string, Uint8Array][] },
    ])('shows the finishing message once every entry is read, while $label are still being copied, and ends it when the copies end', async ({ entries }) => {
        const release = gate()
        streamTrack.hold = release.promise
        streamTrack.release = release.release

        const restoring = restoreBytes(backupOf(entries))
        await waitForProgress(() => { expect(waitTexts()).toContain(FINISHING) })
        await settleTimers()

        const held = waitTexts()
        expect(held[held.length - 1]).toBe(FINISHING)
        expect(held.filter((text) => text === FINISHING)).toHaveLength(1)
        // After the last entry was shown, not inside the loop.
        expect(held.indexOf(FINISHING)).toBeGreaterThan(lastIndexWhere(held, (text) => text.startsWith(PROGRESS)))
        expect(setDatabaseMock).not.toHaveBeenCalled()
        release.release()
        await restoring

        const all = waitTexts()
        expect(all.filter((text) => text === FINISHING)).toHaveLength(1)
        expect(all[all.length - 1]).toBe('Loading backup...')
        expect(all.indexOf(FINISHING)).toBeLessThan(all.lastIndexOf('Loading backup...'))
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Guard on the base: nothing is outstanding, so the base shows no message either. The replacement text is asserted above.
    test('shows no finishing message for a backup without assets', async () => {
        await restoreBytes(backupOf([]))

        expect(waitTexts()).not.toContain(FINISHING)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Guard on the base, which never shows the message; the mutant that drops the failure term turns it red.
    test('shows no finishing message when a failed batch stopped the restore before the end', async () => {
        const names = Array.from({ length: 60 }, (_, index) => `e${index}.png`)
        wire.errorKey = 'assets/e1.png'

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(300 * 1024, index + 1)])))

        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(waitTexts()).not.toContain(FINISHING)
        expect(lastProgressPercent()).toBeLessThan(100)
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    // Guard on the base, which never shows the message. A stream's source failure is seen at the top of the loop, which sets the
    // stop message, and the source is marked changed: either the stop-message term or the changed-source term keeps the message away.
    test('shows no finishing message when a stream found the file changed before the end', async () => {
        overrideBackupWindowBytes({ walk: 65536, copy: 65536 })
        const small = Array.from({ length: 60 }, (_, index): [string, Uint8Array] => [`s${index}.png`, filled(20 * 1024, index + 1)])
        const bytes = backupOf([['l1.bin', patterned(LARGE_SIZE, 1)], ...small])
        const base = new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
        // The stream's first slice, the only read of the writer chunk size or more, cannot be read.
        const file = new Proxy(base, {
            get(target, prop, receiver) {
                if (prop === 'slice') {
                    return (start = 0, end = target.size) => {
                        if (end - start >= WRITE_CHUNK_BYTES) {
                            return { arrayBuffer: async () => { throw new Error('scratch: unreadable region') } } as unknown as Blob
                        }
                        return target.slice(start, end)
                    }
                }
                return Reflect.get(target, prop, receiver)
            },
        })

        await restoreFile(file)

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
        expect(waitTexts()).not.toContain(FINISHING)
        expect(lastProgressPercent()).toBeLessThan(100)
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })
})

describe('a restore on a desktop page', () => {
    // Compatibility guard: passes before and after. The desktop keeps the raw command and its 4 MiB batches.
    test('guard: keeps the raw command with the CHUNK_MAX size limit and never the base64 command', async () => {
        osBox.os = 'windows'

        await restoreBytes(backupOf([['d1.png', filled(10, 1)], ['d2.png', filled(10, 2)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(wire.batches.length).toBeGreaterThanOrEqual(1)
        for (const batch of wire.batches) {
            expect(batch.command).toBe('put_assets_batch')
            expect(batch.maxEntryBytes).toBe(CHUNK_MAX)
        }
    })

    // Compatibility guard: passes before and after. The desktop chunked writer applies the page key rule itself.
    test('guard: a streamed asset whose name the store refuses is named in the skip notice', async () => {
        osBox.os = 'windows'

        await restoreBytes(backupOf([['.bigbad', filled(CHUNK_MAX + 1, 7)], ['good.png', filled(20, 2)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, ['.bigbad']))
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })
})

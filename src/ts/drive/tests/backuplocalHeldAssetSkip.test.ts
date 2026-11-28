// @vitest-environment happy-dom

/**
 * `LoadPickedLocalBackup` (`src/ts/drive/backuplocal.ts`) on a desktop page that already holds assets: an asset entry
 * whose key the store holds with the same length and exactly the same bytes is not written (`binAssetHeld.ts`). The
 * page is the desktop one of `backuplocalAssetBatch.test.ts`: the asset commands are answered by `assetBatchFake.ts`
 * over the real files store on the in-memory file model of `tauriFsFake.ts`, and the held values are planted there.
 * The `.bin` files are built entry by entry, as the container writes them. A mocked command is not evidence about the
 * native backend.
 *
 * Labels: S1 (every held asset skipped, small and large) is a regression reproducer: on the base the held bytes are
 * sent again and no `present` count exists. The rows on a differing, absent, unreadable or stale held value and on the
 * order of duplicate keys are compatibility guards: the base writes the entry in each of them, so their outcome is the
 * same before and after, and a mutant of the skip rule is what they catch. The rows on the note before a held read,
 * the read bounds and the copy line of a skip observe the held reads themselves, which the base never makes.
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
const osBox = vi.hoisted(() => ({ os: 'windows' }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 4 * 1024 * 1024 }))
/** What the page called, in order: every command, and the asset keys it noted and read. */
const eventLog = vi.hoisted(() => ({ events: [] as string[] }))
/** A size the trailer of every `read_range` of a key reports instead of the file's own. */
const reportedTotals = vi.hoisted(() => new Map<string, number>())
const batchFake = await vi.hoisted(async () => (await import('./assetBatchFake')).createAssetBatchFake())
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
        eventLog.events.push(command === 'read_range' ? `read_range ${(args as { key: string }).key}` : command)
        const reply = await (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options)
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
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

// A clean page: the restore's save-first step returns at its clean check instead of waiting out its bound. Every key the
// restore notes for the startup sweep is logged, so a test can order the note against the held read.
vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/globalApi.svelte')>()
    return {
        ...original,
        isSaveClean: () => true,
        noteAssetWrittenThisPage: (key: string) => {
            eventLog.events.push(`note ${key}`)
            original.noteAssetWrittenThisPage(key)
        },
    }
})

const shell = vi.hoisted((): Store2ShellBox => ({ commits: [], events: [] }))
vi.mock(import('src/ts/drive/storeImport'), (importOriginal) => store2ShellMock(shell)(importOriginal))

/** What a card restore reported to the seam, in order. */
interface SeamCall {
    kind: 'phase' | 'bytes'
    step: string
    done: number
}
const seam = vi.hoisted(() => ({ calls: [] as SeamCall[] }))

// The real card seam, recording the progress calls the restore makes on it.
vi.mock('src/ts/drive/restoreProgress', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/drive/restoreProgress')>()
    return {
        ...actual,
        cardRestoreProgress: (...args: Parameters<typeof actual.cardRestoreProgress>) => {
            const real = actual.cardRestoreProgress(...args)
            return {
                ...real,
                get cancelRequested() { return real.cancelRequested },
                phase(step: string, text: string | null) {
                    seam.calls.push({ kind: 'phase', step, done: -1 })
                    real.phase(step, text)
                },
                bytes(step: string, done: number, total: number, text: string | null) {
                    seam.calls.push({ kind: 'bytes', step, done })
                    real.bytes(step, done, total, text)
                },
            }
        },
    }
})

//#endregion

import { resetStore2ShellBox, store2ShellMock, useStore2RestorePage, type Store2ShellBox } from './store2ShellStub'
import { LoadPickedLocalBackup, type LocalBackupEnd } from 'src/ts/drive/backuplocal'
import { overrideBackupWindowBytes } from 'src/ts/drive/backupContainer'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { alertWait } from 'src/ts/alert'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { getAppStore } from 'src/ts/storage/store/appStore'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { CHUNK_MAX, resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'

//#region helpers

const encoder = new TextEncoder()

/** An entry above CHUNK_MAX with three full held pieces and a short last one. */
const BIG = 3 * CHUNK_MAX + 7

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

/** Offset-sensitive bytes: period 251 is coprime with every power of two, so a piece compared against the wrong offset differs. */
function patterned(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        out[i] = (i * 13 + seed) % 251
    }
    return out
}

function databaseChunk(): Uint8Array {
    const database = { characters: [], personas: [], characterOrder: [], botPresets: [] } as unknown as Database
    return buildChunk('database.risudat', encodeRisuSaveLegacy(database, 'noCompression'))
}

function backupOf(entries: [string, Uint8Array][]): Uint8Array {
    return concat([...entries.map(([name, data]) => buildChunk(name, data)), databaseChunk()])
}

function same(actual: Uint8Array | null | undefined, expected: Uint8Array): boolean {
    return actual !== null && actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

function withLastByteFlipped(bytes: Uint8Array): Uint8Array {
    const out = bytes.slice()
    out[out.length - 1] ^= 0xff
    return out
}

function storedBytes(name: string): Uint8Array | undefined {
    return fakeFs.files.get(`assets/${name}`)
}

/** Puts a value in the store the way an earlier write left it. */
function hold(name: string, bytes: Uint8Array): void {
    fakeFs.plant(`assets/${name}`, bytes)
}

interface Gate {
    promise: Promise<void>
    release(): void
}

const madeGates: Gate[] = []

function gate(): Gate {
    let release: () => void = () => { }
    const promise = new Promise<void>((resolve) => { release = resolve })
    const made = { promise, release }
    madeGates.push(made)
    return made
}

const PROGRESS_WAIT_MS = 8000
const RESTORE_TEST_TIMEOUT_MS = 20000
const RESTORE_END_WAIT_MS = 2000
vi.setConfig({ testTimeout: RESTORE_TEST_TIMEOUT_MS })

function waitForProgress(check: () => void): Promise<void> {
    return vi.waitFor(check, { timeout: PROGRESS_WAIT_MS })
}

async function settleTimers(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25))
}

/** Holds the write calls with these indexes (in the order the fake receives them) until their gate is released. */
function holdWrites(indexes: number[]): Map<number, Gate> {
    const gates = new Map<number, Gate>(indexes.map((index) => [index, gate()]))
    batchFake.ctl.beforeWrite = (_call, index) => gates.get(index)?.promise
    return gates
}

let lastRestore: Promise<unknown> | null = null

/** Restores `file` through the card route, which reports the end of the run and the copy line. */
function restoreFile(file: File): Promise<LocalBackupEnd> {
    const run = LoadPickedLocalBackup(file, undefined, { card: true })
    lastRestore = run
    return run
}

function restoreBytes(bytes: Uint8Array): Promise<LocalBackupEnd> {
    return restoreFile(new File([asBlobPart(bytes)], 'backup.bin'))
}

/** The import's counts of the assets it wrote and found held. */
function assetFacts(end: LocalBackupEnd): { written: number, present: number } | null {
    const assets = end.detail.assets
    // A build without the count reads as none present.
    return assets === null ? null : { written: assets.written, present: assets.present ?? 0 }
}

/** The keys that reached the batch write command, in order. */
function batchedKeys(): string[] {
    return batchFake.ctl.calls.filter((call) => call.kind === 'batch').flatMap((call) => call.keys)
}

/** The keys a large-entry stream wrote through `write_chunk_raw`. */
function streamedKeys(): string[] {
    return [...new Set(desktop.rawCalls.map((call) => call.key))]
}

/** Every `read_range` call for a key, in order: the held reads of a compare. */
function heldReads(key: string): { offset: number, len: number }[] {
    return desktop.chunk.callsOf('read_range')
        .filter((call) => call.args.key === key)
        .map((call) => ({ offset: Number(call.args.offset), len: Number(call.args.len) }))
}

/** No asset byte of the import travelled to the store by any command. */
function expectNothingWritten(): void {
    expect(batchedKeys()).toEqual([])
    expect(desktop.rawCalls).toEqual([])
    expect(eventLog.events.filter((event) => event === 'write_chunk' || event === 'write_chunk_raw')).toEqual([])
}

function expectCommittedOnce(): void {
    expect(shell.commits).toHaveLength(1)
    expect(shell.commits[0].batchesSettled).toBe(true)
    expect(vi.mocked(alertWait).mock.calls.some((call) => call[0] === language.store2RestoreSaving)).toBe(false)
}

function expectNotCommitted(): void {
    expect(shell.commits).toHaveLength(0)
}

function allCallsSettled(): boolean {
    return batchFake.ctl.calls.every((call) => call.settled)
}

/** The copy line's reports in order. */
function copyReports(): number[] {
    return seam.calls.filter((call) => call.kind === 'bytes' && call.step === 'copy').map((call) => call.done)
}

/** The line never falls, never passes the file size, and ends at it. */
function expectCopyLineSound(fileSize: number): void {
    const values = copyReports()
    expect(values.length).toBeGreaterThan(0)
    for (let i = 1; i < values.length; i++) {
        expect(values[i], `report ${i} after ${values[i - 1]}`).toBeGreaterThanOrEqual(values[i - 1])
    }
    expect(Math.max(...values)).toBeLessThanOrEqual(fileSize)
    expect(values.at(-1)).toBe(fileSize)
}

/** A file that logs the `(start, end)` of every slice. */
function rangeRecordingFile(bytes: Uint8Array): { file: File, ranges: [number, number][] } {
    const base = new File([asBlobPart(bytes)], 'backup.bin')
    const ranges: [number, number][] = []
    const file = new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (start = 0, end = target.size) => {
                    ranges.push([start, end])
                    return target.slice(start, end)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
    return { file, ranges }
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

//#endregion

beforeEach(() => {
    platformBox.isTauri = true
    osBox.os = 'windows'
    desktop.reset()
    eventLog.events.length = 0
    reportedTotals.clear()
    resetByteTransportForTests()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    batchFake.reset()
    batchFake.useStore(getAppStore)
    batchFake.ctl.available = true
    // The listing takes sizes from the file model, so building it reads no asset through the ranged reader.
    batchFake.ctl.sizeOf = (key) => fakeFs.files.get(key)?.length
    seam.calls.length = 0
    setDatabaseMock.mockReset()
    alertErrorMock.mockReset()
    alertNormalWaitMock.mockReset().mockImplementation(async () => { })
    reloadMark.marked = false
    resetStore2ShellBox(shell)
    shell.batchesSettled = allCallsSettled
    vi.spyOn(console, 'error').mockImplementation(() => { })
    useStore2RestorePage(createTauriFilesStore({ platform: 'posix' }))
    getDatabaseMock.mockImplementation(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(async () => {
    for (const held of madeGates.splice(0)) {
        held.release()
    }
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
    resetBusyActionsForTest()
    overrideBackupWindowBytes(null)
    vi.mocked(alertWait).mockReset()
    vi.restoreAllMocks()
    if (leaked) {
        throw new Error('the restore of this test did not end after every hold was released')
    }
})

describe('a restore over a store that holds every asset of the backup', () => {
    // Regression reproducer (T1). On the base every held entry is sent again: the batch command carries the small keys,
    // `write_chunk_raw` carries the large one, and the end names no `present` count.
    test('T1: small and large assets with the held bytes are not written, the held files are left untouched, and each counts as present', async () => {
        const a = patterned(1000, 1)
        const b = patterned(3000, 2)
        const big = patterned(BIG, 3)
        hold('a.png', a)
        hold('b.png', b)
        hold('big.bin', big)
        const before = ['a.png', 'b.png', 'big.bin'].map((name) => storedBytes(name))

        const end = await restoreBytes(backupOf([['a.png', a], ['big.bin', big], ['b.png', b]]))

        expectNothingWritten()
        // An untouched file is the very object the page held; a rewrite replaces it.
        expect(storedBytes('a.png')).toBe(before[0])
        expect(storedBytes('b.png')).toBe(before[1])
        expect(storedBytes('big.bin')).toBe(before[2])
        expect(assetFacts(end)).toEqual({ written: 0, present: 3 })
        // The large compare reads the held value piece by piece: three full pieces and the short last one.
        expect(heldReads('assets/big.bin').map((read) => read.offset)).toEqual([0, CHUNK_MAX, 2 * CHUNK_MAX, 3 * CHUNK_MAX])
        expectCommittedOnce()
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    // The held keys stay live for the startup sweep as if they had been written, and the note comes before any held read.
    test('T13: every held key is noted for the sweep before the first held read of that key', async () => {
        const a = patterned(500, 1)
        const big = patterned(BIG, 2)
        hold('a.png', a)
        hold('big.bin', big)

        await restoreBytes(backupOf([['a.png', a], ['big.bin', big]]))

        for (const key of ['assets/a.png', 'assets/big.bin']) {
            const noted = eventLog.events.indexOf(`note ${key}`)
            const read = eventLog.events.indexOf(`read_range ${key}`)
            expect(noted, `${key} noted`).toBeGreaterThanOrEqual(0)
            expect(read, `${key} read`).toBeGreaterThanOrEqual(0)
            expect(noted, `${key} noted before its first held read`).toBeLessThan(read)
        }
        expectNothingWritten()
    })

    test('T15d: the held compare reads through the ranged reader, never a whole-asset read of an asset key', async () => {
        const a = patterned(500, 1)
        const big = patterned(BIG, 2)
        hold('a.png', a)
        hold('big.bin', big)
        const store = await getAppStore()
        const readSpy = vi.spyOn(store, 'read')

        await restoreBytes(backupOf([['a.png', a], ['big.bin', big]]))

        expect(readSpy.mock.calls.map((call) => call[0]).filter((key) => key.startsWith('assets/'))).toEqual([])
        expect(batchFake.ctl.calls.filter((call) => call.kind === 'read')).toEqual([])
        expect(heldReads('assets/a.png')).toEqual([{ offset: 0, len: CHUNK_MAX }])
    })
})

describe('a restore over a store whose held value is not the entry', () => {
    test('T5 small: one flipped byte writes the entry', async () => {
        const entry = patterned(2000, 1)
        hold('a.png', withLastByteFlipped(entry))

        const end = await restoreBytes(backupOf([['a.png', entry]]))

        expect(batchedKeys()).toEqual(['assets/a.png'])
        expect(same(storedBytes('a.png'), entry)).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expectCommittedOnce()
    })

    test('T5 large: a difference in the last byte of the last piece writes the entry', async () => {
        const entry = patterned(BIG, 1)
        hold('big.bin', withLastByteFlipped(entry))

        const end = await restoreBytes(backupOf([['big.bin', entry]]))

        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(same(storedBytes('big.bin'), entry)).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expectCommittedOnce()
    })

    test('T5 large: a difference in the first byte of a later piece writes the entry, though the first piece is equal', async () => {
        const entry = patterned(BIG, 1)
        const held = entry.slice()
        held[CHUNK_MAX] ^= 0xff
        hold('big.bin', held)

        await restoreBytes(backupOf([['big.bin', entry]]))

        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(same(storedBytes('big.bin'), entry)).toBe(true)
        expectCommittedOnce()
    })

    test('T6: a different length, an absent key and a listed size that is not the entry size are all written', async () => {
        const shorter = patterned(300, 1)
        const listedOff = patterned(300, 2)
        hold('short.png', shorter.subarray(0, 299))
        hold('off.png', listedOff)
        batchFake.ctl.listedSizes.set('assets/off.png', 0)

        const end = await restoreBytes(backupOf([['short.png', shorter], ['absent.png', filled(40, 3)], ['off.png', listedOff]]))

        expect(batchedKeys().sort()).toEqual(['assets/absent.png', 'assets/off.png', 'assets/short.png'])
        expect(same(storedBytes('short.png'), shorter)).toBe(true)
        expect(same(storedBytes('absent.png'), filled(40, 3))).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 3, present: 0 })
    })

    test('T11: with the sized listing failed every asset is written, and the import succeeds', async () => {
        const a = patterned(500, 1)
        const big = patterned(BIG, 2)
        hold('a.png', a)
        hold('big.bin', big)
        batchFake.ctl.failListing = true

        const end = await restoreBytes(backupOf([['a.png', a], ['big.bin', big]]))

        expect(batchedKeys()).toEqual(['assets/a.png'])
        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(heldReads('assets/a.png')).toEqual([])
        expect(heldReads('assets/big.bin')).toEqual([])
        expect(assetFacts(end)).toEqual({ written: 2, present: 0 })
        expect(alertErrorMock).not.toHaveBeenCalled()
        expectCommittedOnce()
    })
})

describe('a restore with the held side failing', () => {
    // Guard: a held read that fails means the value is not known to be equal, so the entry is written.
    test('T9 small: a held read that fails writes the entry and the import succeeds', async () => {
        const entry = patterned(500, 1)
        hold('a.png', entry)
        desktop.chunk.hooks.before = ({ key }) => {
            if (key === 'assets/a.png') {
                throw 'scratch: the held value cannot be read'
            }
        }

        const end = await restoreBytes(backupOf([['a.png', entry]]))

        expect(batchedKeys()).toEqual(['assets/a.png'])
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expect(alertErrorMock).not.toHaveBeenCalled()
        expectCommittedOnce()
    })

    test('T9 large: a held read that fails writes the entry and the import succeeds', async () => {
        const entry = patterned(BIG, 1)
        hold('big.bin', entry)
        desktop.chunk.hooks.before = ({ key }) => {
            if (key === 'assets/big.bin') {
                throw 'scratch: the held value cannot be read'
            }
        }

        const end = await restoreBytes(backupOf([['big.bin', entry]]))

        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expect(alertErrorMock).not.toHaveBeenCalled()
        expectCommittedOnce()
    })

    test('T9 small: a held value that vanished after the listing is written', async () => {
        const entry = patterned(500, 1)
        hold('a.png', entry)
        desktop.chunk.hooks.before = ({ key }) => {
            if (key === 'assets/a.png') {
                fakeFs.files.delete(key)
            }
        }

        const end = await restoreBytes(backupOf([['a.png', entry]]))

        expect(batchedKeys()).toEqual(['assets/a.png'])
        expect(same(storedBytes('a.png'), entry)).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expectCommittedOnce()
    })

    test('T9 large: a held value replaced between two pieces is written', async () => {
        const entry = patterned(BIG, 1)
        hold('big.bin', entry)
        desktop.chunk.hooks.before = ({ key, offset }) => {
            if (key === 'assets/big.bin' && offset === CHUNK_MAX) {
                const current = fakeFs.files.get(key)
                if (current !== undefined) {
                    // Equal bytes under a new file identity: the reader refuses the second piece.
                    fakeFs.files.set(key, current.slice())
                }
            }
        }

        const end = await restoreBytes(backupOf([['big.bin', entry]]))

        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expect(alertErrorMock).not.toHaveBeenCalled()
        expectCommittedOnce()
    })
})

describe('a restore whose backup file fails during the compare', () => {
    // Guard (T10): a failure of the backup file is a stop, never "equal" and never a silent fall back to a write. The
    // fault is one-shot, so a mutant that turns the stop into a write would let the fallback write finish and commit.
    test('T10: a backup slice that rejects during a large compare ends the import with the changed-file message and commits nothing', async () => {
        const entry = patterned(BIG, 1)
        hold('big.bin', entry)
        overrideBackupWindowBytes({ walk: 65536, copy: 65536 })
        const file = fileWithFailingSlice(backupOf([['big.bin', entry]]), (size, nth) => size === CHUNK_MAX && nth === 1)

        await restoreFile(file)

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
        expectNotCommitted()
        expect(streamedKeys()).toEqual([])
        expect(storedBytes('big.bin')).toBeDefined()
    })
})

describe('two entries of one key or one fold in a backup over a store that holds a later one', () => {
    // The later entry must win. A skip of the later entry while the earlier one is still written would leave the earlier
    // one in the store.
    test('T7: K=X then K=Y with the store holding Y: the store ends on Y though the first batch is still in flight', async () => {
        const X = filled(40, 1)
        const Y = filled(40, 2)
        hold('dup.png', Y)
        const gates = holdWrites([0])

        const restoring = restoreBytes(backupOf([['dup.png', X], ['dup.png', Y]]))
        await waitForProgress(() => { expect(batchFake.ctl.calls.length).toBeGreaterThanOrEqual(1) })
        await settleTimers()
        gates.get(0)?.release()
        const end = await restoring

        expect(same(storedBytes('dup.png'), Y)).toBe(true)
        expect(batchedKeys()).toEqual(['assets/dup.png', 'assets/dup.png'])
        expect(assetFacts(end)).toEqual({ written: 2, present: 0 })
        expectCommittedOnce()
    })

    // The first entry of the fold has another size, so it is never compared; it is still the entry that makes the
    // later one a duplicate.
    test('T7b: the first entry of a different size, then the entry the store holds: the store ends on the later entry', async () => {
        const X = filled(60, 1)
        const Y = filled(40, 2)
        hold('dup.png', Y)
        const gates = holdWrites([0])

        const restoring = restoreBytes(backupOf([['dup.png', X], ['dup.png', Y]]))
        await waitForProgress(() => { expect(batchFake.ctl.calls.length).toBeGreaterThanOrEqual(1) })
        await settleTimers()
        gates.get(0)?.release()
        await restoring

        expect(same(storedBytes('dup.png'), Y)).toBe(true)
        expect(batchedKeys()).toEqual(['assets/dup.png', 'assets/dup.png'])
        expectCommittedOnce()
    })

    test('T7b large: a large first entry of another size, then the large entry the store holds: the store ends on the later entry', async () => {
        const X = patterned(BIG + 11, 1)
        const Y = patterned(BIG, 2)
        hold('dup.bin', Y)

        await restoreBytes(backupOf([['dup.bin', X], ['dup.bin', Y]]))

        expect(same(storedBytes('dup.bin'), Y)).toBe(true)
        expect(desktop.rawCalls.filter((call) => call.last)).toHaveLength(2)
        // The first entry's size differs, so it is not compared; the second is not compared either.
        expect(heldReads('assets/dup.bin')).toEqual([])
        expectCommittedOnce()
    })

    test('T8: the store holds the LATER variant of a case pair and of a Unicode composition pair: the later entry is sent', async () => {
        const composed = 'café.png'
        const decomposed = 'café.png'
        const Y1 = filled(8, 2)
        const Y2 = filled(8, 4)
        hold('pic.png', Y1)
        hold(decomposed, Y2)

        await restoreBytes(backupOf([
            ['Pic.PNG', filled(8, 1)],
            ['pic.png', Y1],
            [composed, filled(8, 3)],
            [decomposed, Y2],
        ]))

        const keys = batchedKeys()
        expect(keys).toContain('assets/pic.png')
        expect(keys).toContain(`assets/${decomposed}`)
        expect(keys).toContain('assets/Pic.PNG')
        expect(keys).toContain(`assets/${composed}`)
        expectCommittedOnce()
    })
})

describe('the copy line of a restore that skips assets', () => {
    test('T14 small skip: the line rises with each entry, stays within the file size and ends at it', async () => {
        const a = patterned(1000, 1)
        const b = patterned(2000, 2)
        hold('a.png', a)
        hold('b.png', b)
        const bytes = backupOf([['a.png', a], ['b.png', b]])

        await restoreBytes(bytes)

        expectNothingWritten()
        expectCopyLineSound(bytes.length)
    })

    test('T14 large skip: the compare slices and the rest of the entry count each byte once', async () => {
        const big = patterned(BIG, 1)
        hold('big.bin', big)
        overrideBackupWindowBytes({ walk: 65536, copy: 65536 })
        const bytes = backupOf([['big.bin', big]])

        await restoreBytes(bytes)

        expectNothingWritten()
        expectCopyLineSound(bytes.length)
        // The entry's body counted in the compare's own slices: one report per held piece, not one jump at the end.
        const rises = new Set(copyReports().filter((value) => value > 0 && value < bytes.length))
        expect(rises.size).toBeGreaterThanOrEqual(3)
    })

    test('T14 large mismatch: the compare reads most of the entry and the write reads it again, and no byte is counted twice', async () => {
        const big = patterned(BIG, 1)
        hold('big.bin', withLastByteFlipped(big))
        overrideBackupWindowBytes({ walk: 65536, copy: 65536 })
        const bytes = backupOf([['big.bin', big]])

        await restoreBytes(bytes)

        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(same(storedBytes('big.bin'), big)).toBe(true)
        expectCopyLineSound(bytes.length)
    })
})

describe('a held value that is shorter or longer than the entry while the listing says the sizes are equal', () => {
    // S12: a stale listing, a short trailer, or a value that changed after the listing.
    test('T19a / T15a: a held value that is the first 2*CHUNK_MAX bytes of the entry is written, after one held read', async () => {
        const entry = patterned(3 * CHUNK_MAX + 7, 1)
        hold('big.bin', entry.subarray(0, 2 * CHUNK_MAX))
        batchFake.ctl.listedSizes.set('assets/big.bin', entry.length)

        const end = await restoreBytes(backupOf([['big.bin', entry]]))

        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(same(storedBytes('big.bin'), entry)).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        // The total of the first held piece decides: no second piece is asked for.
        expect(heldReads('assets/big.bin')).toHaveLength(1)
        expectCommittedOnce()
    })

    test('T19b: a held value whose read trailer reports less than the entry is written', async () => {
        const entry = patterned(2 * CHUNK_MAX + 5, 1)
        hold('big.bin', entry)
        reportedTotals.set('assets/big.bin', CHUNK_MAX)

        const end = await restoreBytes(backupOf([['big.bin', entry]]))

        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(same(storedBytes('big.bin'), entry)).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expectCommittedOnce()
    })

    test('T19d: a small held value one byte short of the entry is written', async () => {
        const entry = patterned(3000, 1)
        hold('a.png', entry.subarray(0, entry.length - 1))
        batchFake.ctl.listedSizes.set('assets/a.png', entry.length)

        const end = await restoreBytes(backupOf([['a.png', entry]]))

        expect(batchedKeys()).toEqual(['assets/a.png'])
        expect(same(storedBytes('a.png'), entry)).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expectCommittedOnce()
    })

    test('T19e (a), small: a held value that is the entry plus 7 bytes is written', async () => {
        const entry = patterned(3000, 1)
        hold('a.png', concat([entry, filled(7, 9)]))
        batchFake.ctl.listedSizes.set('assets/a.png', entry.length)

        const end = await restoreBytes(backupOf([['a.png', entry]]))

        expect(batchedKeys()).toEqual(['assets/a.png'])
        expect(same(storedBytes('a.png'), entry)).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 1, present: 0 })
        expectCommittedOnce()
    })

    // The held value is the entry and one more CHUNK_MAX piece. Without the held-total check and the overrun check, the
    // compare would ask the backup file for bytes past the entry's data, which are the next entry's header.
    test('T19e (b) / T15b, large: a held value longer than the entry is written after one held read, and no compare slice ends past the entry', async () => {
        const entry = patterned(BIG, 1)
        const next = filled(64, 7)
        hold('big.bin', concat([entry, patterned(CHUNK_MAX, 5)]))
        batchFake.ctl.listedSizes.set('assets/big.bin', entry.length)
        overrideBackupWindowBytes({ walk: 65536, copy: 65536 })
        const bytes = backupOf([['big.bin', entry], ['next.png', next]])
        const recorded = rangeRecordingFile(bytes)
        const dataStart = buildChunk('big.bin', new Uint8Array(0)).length
        const dataEnd = dataStart + entry.length

        const end = await restoreFile(recorded.file)

        const inside = recorded.ranges.filter(([start]) => start >= dataStart && start < dataEnd)
        expect(inside.length).toBeGreaterThan(0)
        for (const [start, stop] of inside) {
            expect(stop, `slice [${start}, ${stop}) of the entry's data`).toBeLessThanOrEqual(dataEnd)
        }
        expect(streamedKeys()).toEqual(['assets/big.bin'])
        expect(same(storedBytes('big.bin'), entry)).toBe(true)
        expect(assetFacts(end)).toEqual({ written: 2, present: 0 })
        expect(heldReads('assets/big.bin')).toHaveLength(1)
        expectCommittedOnce()
    })
})

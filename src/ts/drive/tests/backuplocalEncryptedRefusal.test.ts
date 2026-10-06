// @vitest-environment happy-dom

/**
 * MC-081. `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) must refuse to
 * import a `.bin` that carries any entry whose complete name decodes to
 * `encryption.risudat` -- wherever that entry sits in the file, whatever its
 * content, and whether or not its declared data length fits -- before
 * performing any write: no asset write (`forageStorage.setItem('assets/...')`
 * or Tauri `writeFile`), no `setColdStorageItem`, no database write,
 * no `setDatabase`, no `localStorage` write and no `fetch`. Any exception
 * encountered while looking for the marker also aborts the import before any
 * write, with its own message, distinct from the refusal. Without such an
 * entry present anywhere in the file, an import restores every entry in
 * file order, including a file truncated inside its final entry.
 *
 * `getColdStorageBackupKey`/`isColdStorageBackupData` are the REAL functions
 * from `src/ts/process/coldstorageData.ts` (pure, no side effects); only
 * `setColdStorageItem` itself is a spy. Backup bytes are built to match
 * `LoadLocalBackup`'s own `[u32 nameLength][name][u32 dataLength][data]`
 * framing (unsigned, little-endian, no header/trailer/count), and every
 * `database.risudat` entry is encoded with the REAL `encodeRisuSaveLegacy`
 * (`src/ts/storage/risuSave.ts`), matching `backuplocalIdRepair.test.ts`'s
 * own mocking pattern.
 *
 * Every export of the alert module is spied, and `alertStore.set` calls are
 * also inspected for a `msg` field, so a shown message can be found
 * regardless of which alert function or path eventually carries it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '../../storage/database.svelte'
import { language } from 'src/lang'
import {
    getColdStorageBackupKey as realGetColdStorageBackupKey,
    isColdStorageBackupData as realIsColdStorageBackupData,
} from '../../process/coldstorageData'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

const tauriWriteFileMock = vi.hoisted(() => vi.fn(async () => {}))
const tauriRenameMock = vi.hoisted(() => vi.fn(async () => {}))
const tauriRemoveMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: tauriWriteFileMock,
    rename: tauriRenameMock,
    remove: tauriRemoveMock,
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => {}),
}))

const setDatabaseMock = vi.hoisted(() => vi.fn())

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: setDatabaseMock,
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

const requiresFullEncoderReloadMock = vi.hoisted(() => ({ state: false }))
const forageFiles = vi.hoisted(() => new Map<string, Uint8Array>())
const forageSetItemMock = vi.hoisted(() => vi.fn(async (key: string, data: Uint8Array) => { forageFiles.set(key, data) }))
const acquireExclusiveStorageMigrationLockMock = vi.hoisted(() => vi.fn(async () => (async () => {})))

vi.mock(import('../../globalApi.svelte'), () => ({
    LocalWriter: class {},
    forageStorage: {
        keys: vi.fn(async () => Array.from(forageFiles.keys())),
        getItem: vi.fn(async (key: string) => forageFiles.get(key) ?? null),
        setItem: forageSetItemMock,
        removeItem: vi.fn(async (key: string) => { forageFiles.delete(key) }),
    },
    requiresFullEncoderReload: requiresFullEncoderReloadMock,
    noteAssetWrittenThisPage: vi.fn(),
    dbWriteLock: { acquire: vi.fn(async () => vi.fn()) },
    // Granted immediately, standing in for "no other tab is open". The
    // encrypted-backup refusal (MC-081) fires before any lock is attempted
    // (asserted below, J7); the blocks that restore a backup with no marker
    // on a web build do reach this lock and rely on it being granted.
    acquireExclusiveStorageMigrationLock: acquireExclusiveStorageMigrationLockMock,
    // `LoadLocalBackup()` imports `locksSupported` and `tabPresenceLockAcquired`
    // by name, and a module mock must provide every export its importers read.
    locksSupported: true,
    tabPresenceLockAcquired: Promise.resolve(),
}) as unknown as typeof import('../../globalApi.svelte'))

const alertMocks = vi.hoisted(() => ({
    alertGenerationInfoStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertStore: { set: vi.fn() },
    alertError: vi.fn(),
    waitAlert: vi.fn(async () => {}),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertAddCharacter: vi.fn(async () => ''),
    alertChatOptions: vi.fn(async () => 0),
    alertSelect: vi.fn(async () => ''),
    alertErrorWait: vi.fn(async () => {}),
    alertMd: vi.fn(),
    doingAlert: vi.fn(() => false),
    alertToast: vi.fn(),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
    alertSelectChar: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertPluginConfirm: vi.fn(async () => true),
    alertCardExport: vi.fn(async () => ({ type: '', type2: '' })),
    alertInput: vi.fn(async () => ''),
    alertModuleSelect: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
    showHypaV2Alert: vi.fn(),
    alertRequestLogs: vi.fn(),
}))

vi.mock(import('../../alert'), () => alertMocks as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

const yieldToEventLoopMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock(import('../../storage/saveYield'), async (importOriginal) => ({
    ...(await importOriginal()),
    yieldToEventLoop: yieldToEventLoopMock,
}))

/** What `decodeRisuSave` was handed, in call order. */
const decodeCapture = vi.hoisted(() => ({ inputs: [] as Uint8Array[] }))

vi.mock(import('../../storage/risuSave'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        decodeRisuSave: async (...args: Parameters<typeof actual.decodeRisuSave>) => {
            decodeCapture.inputs.push(args[0])
            return actual.decodeRisuSave(...args)
        },
    }
})

const setColdStorageItemMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: (name: string) => realGetColdStorageBackupKey(name),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: (data: unknown) => realIsColdStorageBackupData(data),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: setColdStorageItemMock,
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
}) as unknown as typeof import('../../stores.svelte'))

//#endregion

import { LoadLocalBackup } from '../backuplocal'
import { encodeRisuSaveLegacy } from '../../storage/risuSave'
import { isAppInitiatedReload } from '../../reloadGuard'
import { forageStorage } from '../../globalApi.svelte'
import { injectRestoreStore } from './restoreSupport'
import { StoreInvalidKeyError } from '../../storage/store/errors'
import { createForageBackedStore, type ForageLike } from '../../storage/tests/forageBackedStore'
import { sleep } from '../../util'

/** Narrows a `Uint8Array<ArrayBufferLike>` to the `Uint8Array<ArrayBuffer>` shape `BlobPart` requires; mirrors `asBuffer` in `src/ts/util.ts`. */
function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

//#region byte-layout helpers, matching LoadLocalBackup's own framing

const ASSET_NAME = 'asset1.png'
const COLD_UUID = '11111111-1111-1111-1111-111111111111'
const COLD_NAME = `coldstorage_${COLD_UUID}.json`
const DATABASE_NAME = 'database.risudat'
const MARKER_NAME = 'encryption.risudat'

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function buildChunkWithRawName(nameBytes: Uint8Array, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    let offset = 0
    out.set(u32le(nameBytes.length), offset); offset += 4
    out.set(nameBytes, offset); offset += nameBytes.length
    out.set(u32le(data.length), offset); offset += 4
    out.set(data, offset)
    return out
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    return buildChunkWithRawName(new TextEncoder().encode(name), data)
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((a, c) => a + c.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.length }
    return out
}

function assetEntry(size = 16, name = ASSET_NAME): Uint8Array {
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) data[i] = i % 256
    return buildChunk(name, data)
}

function coldEntry(): Uint8Array {
    const data = new TextEncoder().encode(JSON.stringify({ message: [] }))
    return buildChunk(COLD_NAME, data)
}

function databaseEntry(): Uint8Array {
    const db = { characters: [] } as unknown as Database
    return buildChunk(DATABASE_NAME, encodeRisuSaveLegacy(db, 'noCompression'))
}

function wellFormedMarkerBody(): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ type: 'account', time: Date.now() }))
}

function markerEntry(body: Uint8Array): Uint8Array {
    return buildChunk(MARKER_NAME, body)
}

//#endregion

//#region File wrappers over real happy-dom File/Blob instances

/** What a file's `slice()` read, so a test can see how the restore reached the bytes. */
interface SliceReads {
    /** Every `slice(start, end)` request, in order. `end` is clamped to the file's size. */
    ranges: { start: number; end: number }[]
    /** Every `ArrayBuffer` a `slice().arrayBuffer()` handed out, in order. */
    buffers: ArrayBuffer[]
    /** How many times `stream()` was called. */
    streamCalls: number
}

/**
 * A real File whose `slice()` reads `walkBytes` for its first `walkSliceCalls`
 * calls -- what the pre-read walk sees -- and `restoreBytes` afterwards -- what
 * the restore pass sees. Models a file that changes between the two passes.
 * `size` stays the size of `walkBytes`, as the browser reports it for the file
 * the user picked. `stream()` counts its calls and serves `walkBytes`.
 */
function fileWithTimeDivergentSlice(walkBytes: Uint8Array, restoreBytes: Uint8Array, walkSliceCalls: number, name = 'backup.bin'): { file: File; reads: SliceReads } {
    const base = new File([asBlobPart(walkBytes)], name)
    const reads: SliceReads = { ranges: [], buffers: [], streamCalls: 0 }
    const file = new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'stream') {
                return () => {
                    reads.streamCalls += 1
                    return target.stream()
                }
            }
            if (prop === 'slice') {
                return (start = 0, end = walkBytes.length) => {
                    const source = reads.ranges.length < walkSliceCalls ? walkBytes : restoreBytes
                    reads.ranges.push({ start, end: Math.min(end, walkBytes.length) })
                    const bytes = source.slice(start, end)
                    return {
                        arrayBuffer: async () => {
                            const buffer = bytes.buffer as ArrayBuffer
                            reads.buffers.push(buffer)
                            return buffer
                        },
                    } as unknown as Blob
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
    return { file, reads }
}

/** A file whose bytes never change, with the same read record as `fileWithTimeDivergentSlice`. */
function fileRecordingReads(bytes: Uint8Array, name = 'backup.bin'): { file: File; reads: SliceReads } {
    return fileWithTimeDivergentSlice(bytes, bytes, Number.POSITIVE_INFINITY, name)
}

/** A real File whose `slice(...).arrayBuffer()` rejects from the `rejectFromCall`-th `slice()` call onward. */
function fileWithRejectingSlice(bytes: Uint8Array, rejectFromCall: number, name = 'backup.bin'): File {
    const base = new File([asBlobPart(bytes)], name)
    let calls = 0
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (...args: [number?, number?, string?]) => {
                    calls += 1
                    if (calls >= rejectFromCall) {
                        return {
                            arrayBuffer: () => Promise.reject(new Error('scratch: unreadable region')),
                        } as unknown as Blob
                    }
                    return (target.slice as (...a: unknown[]) => Blob).apply(target, args)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
}

//#endregion

//#region fixtures

function upstreamOrderFixture(): Uint8Array {
    return concatChunks([assetEntry(), coldEntry(), markerEntry(wellFormedMarkerBody()), databaseEntry()])
}

function malformedMarkerFixture(): Uint8Array {
    const body = new TextEncoder().encode('not-json{')
    return concatChunks([assetEntry(), coldEntry(), markerEntry(body), databaseEntry()])
}

function noneTypeMarkerFixture(): Uint8Array {
    const body = new TextEncoder().encode(JSON.stringify({ type: 'none' }))
    return concatChunks([assetEntry(), coldEntry(), markerEntry(body), databaseEntry()])
}

function emptyMarkerFixture(): Uint8Array {
    return concatChunks([assetEntry(), coldEntry(), markerEntry(new Uint8Array(0)), databaseEntry()])
}

function markerFirstFixture(): Uint8Array {
    return concatChunks([markerEntry(wellFormedMarkerBody()), assetEntry(), coldEntry(), databaseEntry()])
}

function markerLastFixture(): Uint8Array {
    return concatChunks([assetEntry(), coldEntry(), databaseEntry(), markerEntry(wellFormedMarkerBody())])
}

function noMarkerFixture(): Uint8Array {
    return concatChunks([assetEntry(), coldEntry(), databaseEntry()])
}

function bigPreMarkerFixture(): Uint8Array {
    const bigAsset = buildChunk('bigasset.png', new Uint8Array(1024 * 1024 + 123).fill(7))
    return concatChunks([bigAsset, assetEntry(32, 'asset2.png'), coldEntry(), markerEntry(wellFormedMarkerBody()), databaseEntry()])
}

function bomMarkerNameBytes(): Uint8Array {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF])
    const nameBytes = new TextEncoder().encode(MARKER_NAME)
    const out = new Uint8Array(bom.length + nameBytes.length)
    out.set(bom, 0)
    out.set(nameBytes, bom.length)
    return out
}

function bomMarkerFixture(): Uint8Array {
    const markerChunk = buildChunkWithRawName(bomMarkerNameBytes(), wellFormedMarkerBody())
    return concatChunks([assetEntry(), coldEntry(), markerChunk, databaseEntry()])
}

/** The marker's name is complete, but its declared data length runs past the actual end of the file. */
function truncatedMarkerDataLengthFixture(): Uint8Array {
    const nameBytes = new TextEncoder().encode(MARKER_NAME)
    const declaredDataLength = 5000
    const header = new Uint8Array(4 + nameBytes.length + 4)
    let offset = 0
    header.set(u32le(nameBytes.length), offset); offset += 4
    header.set(nameBytes, offset); offset += nameBytes.length
    header.set(u32le(declaredDataLength), offset)
    const shortTrailingData = new Uint8Array([1, 2, 3, 4])
    return concatChunks([assetEntry(), coldEntry(), header, shortTrailingData])
}

/** A marker header whose declared data length (5000) runs past the end of the bytes given. */
function markerHeaderWithDataLengthPastEnd(): Uint8Array {
    const nameBytes = new TextEncoder().encode(MARKER_NAME)
    return concatChunks([u32le(nameBytes.length), nameBytes, u32le(5000)])
}

/** A marker whose name is complete but whose own 4-byte data-length field is cut off after 2 bytes. */
function markerHeaderWithDataLengthFieldCutOff(): Uint8Array {
    const nameBytes = new TextEncoder().encode(MARKER_NAME)
    return concatChunks([u32le(nameBytes.length), nameBytes, new Uint8Array([1, 2])])
}

/**
 * What the pre-read walk sees in the time-divergence cases: a self-consistent
 * backup with no marker at all, `[asset1, asset2, database]`. The restore pass
 * is handed bytes with the same offsets in which one entry has changed.
 */
function walkViewBytes(): Uint8Array {
    return concatChunks([assetEntry(16, 'asset1.png'), assetEntry(16, 'asset2.png'), databaseEntry()])
}

/** `walkViewBytes()` with its second entry's place taken by `replacement`; everything before it is unchanged. */
function restoreViewWithSecondEntryReplaced(replacement: Uint8Array): Uint8Array {
    return concatChunks([assetEntry(16, 'asset1.png'), replacement])
}

/** The number of `slice()` calls the walk makes over `walkViewBytes()`: one header window per entry. */
const WALK_VIEW_SLICE_CALLS = 3

/** The marker's name is complete, but its own 4-byte data-length field is itself cut off by the end of the file (not merely a body or a data length that runs past it). */
function markerNameCompleteDataLengthFieldCutOffFixture(): Uint8Array {
    const nameBytes = new TextEncoder().encode(MARKER_NAME)
    const header = concatChunks([u32le(nameBytes.length), nameBytes, new Uint8Array([1, 2])])
    return concatChunks([assetEntry(), coldEntry(), header])
}

function bigNoMarkerFixture(): Uint8Array {
    const bigAsset = buildChunk('bigasset2.png', new Uint8Array(1024 * 1024 + 77).fill(3))
    return concatChunks([bigAsset, coldEntry(), databaseEntry()])
}

function bigUpstreamOrderFixture(): Uint8Array {
    const bigAsset = buildChunk('bigasset3.png', new Uint8Array(1024 * 1024 + 55).fill(5))
    return concatChunks([bigAsset, coldEntry(), markerEntry(wellFormedMarkerBody()), databaseEntry()])
}

/** Cuts a well-formed, marker-free backup inside the data of its final (database) entry. */
function truncatedDatabaseFixture(): Uint8Array {
    const dbChunk = databaseEntry()
    const headerLength = 4 + new TextEncoder().encode(DATABASE_NAME).length + 4
    const dataLength = dbChunk.length - headerLength
    if (dataLength <= 8) {
        throw new Error('fixture assumption violated: encoded database payload too small to truncate safely')
    }
    const full = concatChunks([assetEntry(), coldEntry(), dbChunk])
    return full.slice(0, full.length - 5)
}

//#endregion

//#region harness plumbing

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
let localStorageSetItemSpy: ReturnType<typeof vi.spyOn>
const fetchMock = vi.hoisted(() => vi.fn())

beforeEach(() => {
    setDatabaseMock.mockClear()
    forageSetItemMock.mockClear()
    forageFiles.clear()
    decodeCapture.inputs.length = 0
    yieldToEventLoopMock.mockReset()
    yieldToEventLoopMock.mockImplementation(async () => {})
    vi.mocked(sleep).mockClear()
    // The restore writes a block generation through the page's byte store; here it is the storage-object model above, on a desktop-kind page.
    // Like the real stores, it refuses an asset key with a leading dot.
    const forageBackedStore = createForageBackedStore(forageStorage as unknown as ForageLike)
    injectRestoreStore({
        ...forageBackedStore,
        write: async (key, bytes, condition) => {
            if (key.startsWith('assets/.')) {
                throw new StoreInvalidKeyError(key, 'leading dot')
            }
            return forageBackedStore.write(key, bytes, condition)
        },
    })
    tauriWriteFileMock.mockClear()
    tauriRenameMock.mockClear()
    tauriRemoveMock.mockClear()
    setColdStorageItemMock.mockClear()
    acquireExclusiveStorageMigrationLockMock.mockClear()
    requiresFullEncoderReloadMock.state = false

    for (const value of Object.values(alertMocks)) {
        if (typeof value === 'function') {
            (value as ReturnType<typeof vi.fn>).mockClear()
        } else if (value && typeof value === 'object') {
            for (const inner of Object.values(value)) {
                if (typeof inner === 'function') {
                    (inner as ReturnType<typeof vi.fn>).mockClear()
                }
            }
        }
    }

    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => ({ json: async () => ({ key: 'unused-test-key' }) }))
    vi.stubGlobal('fetch', fetchMock)

    localStorageSetItemSpy = vi.spyOn(localStorage, 'setItem')

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
    createElementSpy.mockRestore()
    localStorageSetItemSpy.mockRestore()
    vi.unstubAllGlobals()
})

/** Drives `loadFn` (defaulting to the real `LoadLocalBackup`) with `file` as the selected file, and awaits its onchange handler. */
async function loadBackupWithFile(file: File, loadFn: () => void = LoadLocalBackup): Promise<void> {
    loadFn()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

async function loadBackupBytes(bytes: Uint8Array): Promise<void> {
    await loadBackupWithFile(new File([asBlobPart(bytes)], 'backup.bin'))
}

function collectAlertMessages(): string[] {
    const messages: string[] = []
    for (const call of alertMocks.alertStore.set.mock.calls) {
        const arg = call[0] as { msg?: unknown } | undefined
        if (arg && typeof arg.msg === 'string') {
            messages.push(arg.msg)
        }
    }
    for (const [key, value] of Object.entries(alertMocks)) {
        if (key === 'alertStore' || key === 'alertGenerationInfoStore') {
            continue
        }
        const spy = value as ReturnType<typeof vi.fn>
        for (const call of spy.mock.calls) {
            const first = call[0]
            if (typeof first === 'string') {
                messages.push(first)
            }
        }
    }
    return messages
}

function expectNoWritesNoInstallNoNetwork(): void {
    expect(forageSetItemMock).not.toHaveBeenCalled()
    expect(tauriWriteFileMock).not.toHaveBeenCalled()
    expect(tauriRenameMock).not.toHaveBeenCalled()
    expect(setColdStorageItemMock).not.toHaveBeenCalled()
    expect(setDatabaseMock).not.toHaveBeenCalled()
    expect(localStorageSetItemSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
}

function expectMessageShown(expected: string): void {
    const shown = collectAlertMessages()
    expect(shown).toContain(expected)
    expect(typeof expected).toBe('string')
    expect(expected.length).toBeGreaterThan(0)
}

function expectMessageNotShown(text: string | undefined): void {
    if (typeof text !== 'string') {
        return
    }
    expect(collectAlertMessages()).not.toContain(text)
}

function expectRefusalShown(): void {
    expectMessageShown(language.encryptedBackupRefused)
}

function expectLoopGuardShown(): void {
    expectMessageShown(language.encryptedBackupImportStopped)
}

function expectWalkErrorShown(): void {
    expectMessageShown(language.backupFileUnreadable)
}

function expectRefusalNotShown(): void {
    expectMessageNotShown(language.encryptedBackupRefused)
}

//#endregion

describe('the refusal fires before any write, wherever the marker sits and whatever its content (I1)', () => {
    test('refuses a backup whose marker sits between an existing asset/cold entry and the database, writing nothing', async () => {
        await loadBackupBytes(upstreamOrderFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('takes no cross-tab lock (J7): the encrypted-backup refusal never calls acquireExclusiveStorageMigrationLock', async () => {
        await loadBackupBytes(upstreamOrderFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
        expect(acquireExclusiveStorageMigrationLockMock).not.toHaveBeenCalled()
    })

    test('refuses a backup whose marker body is not valid JSON, writing nothing', async () => {
        await loadBackupBytes(malformedMarkerFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('refuses a backup whose marker declares type none, writing nothing', async () => {
        await loadBackupBytes(noneTypeMarkerFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('refuses a backup whose marker body is empty, writing nothing', async () => {
        await loadBackupBytes(emptyMarkerFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('refuses a backup whose marker is the very first entry in the file, writing nothing', async () => {
        await loadBackupBytes(markerFirstFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('refuses a backup whose marker is the very last entry, after the database, writing nothing', async () => {
        await loadBackupBytes(markerLastFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('refuses a backup whose marker sits beyond a pre-marker asset body of at least 1 MiB, writing nothing', async () => {
        await loadBackupBytes(bigPreMarkerFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('refuses a backup whose marker name carries a leading UTF-8 byte-order mark, writing nothing', async () => {
        await loadBackupBytes(bomMarkerFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('refuses a backup whose marker data length runs past the end of the file, writing nothing', async () => {
        await loadBackupBytes(truncatedMarkerDataLengthFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test('refuses a backup whose marker name is complete but whose own data-length field is cut off by the end of the file, writing nothing', async () => {
        await loadBackupBytes(markerNameCompleteDataLengthFieldCutOffFixture())

        expectNoWritesNoInstallNoNetwork()
        expectRefusalShown()
    })

    test.each([
        { label: 'per-entry path', batched: false },
        { label: 'batch path', batched: true },
    ])('compatibility guard, $label: refuses under Tauri without ever calling the native filesystem write or an asset batch command', async ({ batched }) => {
        vi.doMock(import('../../platform'), () => ({
            isTauri: true,
            isNodeServer: false,
        }) as unknown as typeof import('../../platform'))
        const batchCommands = {
            writeAssetBatch: vi.fn(async () => []),
            writeAssetSingle: vi.fn(async () => ({ k: 'ok' })),
            readAssetBatch: vi.fn(async () => []),
            listAssetsSized: vi.fn(async () => []),
        }
        vi.doMock(import('../../storage/tauriAssetBatch'), async (importOriginal) => ({
            ...(await importOriginal()),
            ...batchCommands,
            isAssetBatchAvailable: () => batched,
        }) as unknown as typeof import('../../storage/tauriAssetBatch'))
        vi.resetModules()

        try {
            const { LoadLocalBackup: loadUnderTauri } = await import('../backuplocal')
            await loadBackupWithFile(new File([asBlobPart(upstreamOrderFixture())], 'backup.bin'), loadUnderTauri)

            expectNoWritesNoInstallNoNetwork()
            expectRefusalShown()
            expect(batchCommands.writeAssetBatch).not.toHaveBeenCalled()
            expect(batchCommands.writeAssetSingle).not.toHaveBeenCalled()
        } finally {
            vi.doUnmock(import('../../platform'))
            vi.doUnmock(import('../../storage/tauriAssetBatch'))
            vi.resetModules()
        }
    })
})

/** Only the entries before the divergence were written; nothing after it, no database install, no cold unit, no network. */
function expectWritesStoppedAfter(writtenKeys: string[]): void {
    expect(forageSetItemMock.mock.calls.map((call) => call[0])).toEqual(writtenKeys)
    expect(tauriWriteFileMock).not.toHaveBeenCalled()
    expect(setColdStorageItemMock).not.toHaveBeenCalled()
    expect(setDatabaseMock).not.toHaveBeenCalled()
    expect(localStorageSetItemSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
}

describe('the restore pass guards independently of a walk that missed the marker (I3, defense in depth, slice view that changes between the passes)', () => {
    test('stops when the marker appears at an indexed offset right after one asset, writing nothing after it', async () => {
        const { file, reads } = fileWithTimeDivergentSlice(
            walkViewBytes(),
            restoreViewWithSecondEntryReplaced(markerEntry(wellFormedMarkerBody())),
            WALK_VIEW_SLICE_CALLS,
        )

        await loadBackupWithFile(file)

        expect(reads.ranges.length).toBeGreaterThan(WALK_VIEW_SLICE_CALLS)
        expectWritesStoppedAfter(['assets/asset1.png'])
        expectLoopGuardShown()
        expectMessageNotShown(language.backupFileChangedWhileReading)
    })

    test('stops when the marker at an indexed offset declares a data length that runs past the end of the file', async () => {
        const { file } = fileWithTimeDivergentSlice(
            walkViewBytes(),
            restoreViewWithSecondEntryReplaced(markerHeaderWithDataLengthPastEnd()),
            WALK_VIEW_SLICE_CALLS,
        )

        await loadBackupWithFile(file)

        expectWritesStoppedAfter(['assets/asset1.png'])
        expectLoopGuardShown()
        expectMessageNotShown(language.backupFileChangedWhileReading)
    })

    test('stops with the marker message, not the changed-file message, when a complete marker name is followed by a data-length field cut off at the end of the file', async () => {
        const { file } = fileWithTimeDivergentSlice(
            walkViewBytes(),
            restoreViewWithSecondEntryReplaced(markerHeaderWithDataLengthFieldCutOff()),
            WALK_VIEW_SLICE_CALLS,
        )

        await loadBackupWithFile(file)

        expectWritesStoppedAfter(['assets/asset1.png'])
        expectLoopGuardShown()
        expectMessageNotShown(language.backupFileChangedWhileReading)
    })

    test('never installs a database that was already read once the marker shows up at a later indexed offset', async () => {
        const walkBytes = concatChunks([assetEntry(16, 'asset1.png'), databaseEntry(), assetEntry(16, 'asset2.png')])
        const restoreBytes = concatChunks([assetEntry(16, 'asset1.png'), databaseEntry(), markerEntry(wellFormedMarkerBody())])
        const { file } = fileWithTimeDivergentSlice(walkBytes, restoreBytes, 3)

        await loadBackupWithFile(file)

        expectWritesStoppedAfter(['assets/asset1.png'])
        expect(forageSetItemMock).not.toHaveBeenCalledWith('database/database.bin', expect.anything())
        expect(forageSetItemMock).not.toHaveBeenCalledWith('blocks/head', expect.anything())
        expectLoopGuardShown()
    })
})

describe('the restore pass stops when the file differs from what the walk indexed (changed file)', () => {
    function expectChangedFileStop(): void {
        expectMessageShown(language.backupFileChangedWhileReading)
        expectMessageNotShown(language.encryptedBackupImportStopped)
        expectMessageNotShown(language.encryptedBackupRefused)
        // The message must not tell the user that nothing was imported: earlier entries were written.
        expect(language.backupFileChangedWhileReading).toContain('may already have been added')
        expect(language.backupFileChangedWhileReading).not.toContain('Nothing was imported')
    }

    test('stops when an indexed entry now has a name of a different length', async () => {
        const { file } = fileWithTimeDivergentSlice(
            walkViewBytes(),
            restoreViewWithSecondEntryReplaced(assetEntry(16, 'asset2-renamed.png')),
            WALK_VIEW_SLICE_CALLS,
        )

        await loadBackupWithFile(file)

        expectWritesStoppedAfter(['assets/asset1.png'])
        expectChangedFileStop()
    })

    test('stops when an indexed entry now declares a different data length', async () => {
        const { file } = fileWithTimeDivergentSlice(
            walkViewBytes(),
            restoreViewWithSecondEntryReplaced(assetEntry(17, 'asset2.png')),
            WALK_VIEW_SLICE_CALLS,
        )

        await loadBackupWithFile(file)

        expectWritesStoppedAfter(['assets/asset1.png'])
        expectChangedFileStop()
    })

    test('stops when the bytes of an indexed entry have fewer bytes than its header declares', async () => {
        const shortAsset = assetEntry(16, 'asset2.png').slice(0, -5)
        const { file } = fileWithTimeDivergentSlice(
            walkViewBytes(),
            restoreViewWithSecondEntryReplaced(shortAsset),
            WALK_VIEW_SLICE_CALLS,
        )

        await loadBackupWithFile(file)

        expectWritesStoppedAfter(['assets/asset1.png'])
        expectChangedFileStop()
    })

    test('stops, with the changed-file message and not the walk-error message, when reading an indexed entry throws', async () => {
        // Calls 1-3 are the walk; call 4 reads asset1, call 5 reads asset2 and rejects.
        const file = fileWithRejectingSlice(walkViewBytes(), 5)

        await loadBackupWithFile(file)

        expectWritesStoppedAfter(['assets/asset1.png'])
        expectChangedFileStop()
        expectMessageNotShown(language.backupFileUnreadable)
    })
})

describe('an unreadable header region aborts with the walk-error message, never the refusal (I1)', () => {
    test('aborts without writing anything when a header region is unreadable and no marker is present', async () => {
        const file = fileWithRejectingSlice(bigNoMarkerFixture(), 2)

        await loadBackupWithFile(file)

        expectNoWritesNoInstallNoNetwork()
        expectWalkErrorShown()
        expectRefusalNotShown()
    })

    test('aborts without writing anything when a header region is unreadable and the upstream marker order is present', async () => {
        const file = fileWithRejectingSlice(bigUpstreamOrderFixture(), 2)

        await loadBackupWithFile(file)

        expectNoWritesNoInstallNoNetwork()
        expectWalkErrorShown()
        expectRefusalNotShown()
    })
})

describe('a backup with no encryption.risudat entry anywhere restores every entry, in file order (I2)', () => {
    test('guard: writes three assets, a cold entry, an entry the store cannot hold and the database exactly once each, in file order, with the bytes of each entry', async () => {
        const asset1 = assetEntry(16, 'asset1.png')
        const asset2 = assetEntry(20, 'asset2.png')
        const rejectedName = assetEntry(8, '.hidden.png')
        const asset3 = assetEntry(7, 'asset3.png')
        const cold = coldEntry()
        const db = databaseEntry()
        const bytes = concatChunks([asset1, asset2, rejectedName, asset3, cold, db])

        await loadBackupBytes(bytes)

        // The assets are written in file order, then the database as a block generation whose head is the last key written.
        const writtenKeys = forageSetItemMock.mock.calls.map((call) => call[0])
        expect(writtenKeys.slice(0, 3)).toEqual([
            'assets/asset1.png',
            'assets/asset2.png',
            'assets/asset3.png',
        ])
        expect(writtenKeys.slice(3).every((key) => key.startsWith('blocks/'))).toBe(true)
        expect(writtenKeys[writtenKeys.length - 1]).toBe('blocks/head')
        expect(writtenKeys).not.toContain('database/database.bin')
        const expectedAssetBytes = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_, i) => i % 256)
        expect(Array.from(forageSetItemMock.mock.calls[0][1])).toEqual(Array.from(expectedAssetBytes(16)))
        expect(Array.from(forageSetItemMock.mock.calls[1][1])).toEqual(Array.from(expectedAssetBytes(20)))
        expect(Array.from(forageSetItemMock.mock.calls[2][1])).toEqual(Array.from(expectedAssetBytes(7)))
        expect(setColdStorageItemMock).toHaveBeenCalledTimes(1)
        expect(setColdStorageItemMock).toHaveBeenCalledWith(COLD_UUID, { message: [] })
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        const installed = setDatabaseMock.mock.calls[0][0] as Database
        expect(installed.characters).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
        // The one name the store cannot hold is reported after the database is written.
        expect(alertMocks.alertNormalWait).toHaveBeenCalledTimes(1)
        expect(alertMocks.alertNormalWait).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, ['.hidden.png']))
        // A successful restore reloads instead of showing a "Success" alert,
        // and marks that reload app-initiated so the app's own "Leave site?"
        // guard lets it through.
        expect(alertMocks.alertNormal).not.toHaveBeenCalledWith('Success')
        expect(isAppInitiatedReload()).toBe(true)
    })

    test('reads one entry at a time through slice(), never calls stream(), and hands the database to the decoder as a view over the bytes read for it', async () => {
        // Every entry is at least as large as the walk's 4096-byte header
        // window, so a slice that stays inside one entry is one header plus
        // one body at most.
        const entries = [
            assetEntry(5000, 'big1.png'),
            assetEntry(6000, 'big2.png'),
            buildChunk(COLD_NAME, new TextEncoder().encode(JSON.stringify({ message: [], padding: 'x'.repeat(5000) }))),
            buildChunk(DATABASE_NAME, encodeRisuSaveLegacy({ characters: [], padding: Array.from({ length: 800 }, (_, i) => `padding-${i}`) } as unknown as Database, 'noCompression')),
        ]
        const bytes = concatChunks(entries)
        const { file, reads } = fileRecordingReads(bytes)

        await loadBackupWithFile(file)

        expect(reads.streamCalls).toBe(0)
        const bounds: { start: number; end: number }[] = []
        let offset = 0
        for (const entry of entries) {
            bounds.push({ start: offset, end: offset + entry.length })
            offset += entry.length
        }
        for (const range of reads.ranges) {
            expect(bounds.some((entryBounds) => range.start >= entryBounds.start && range.end <= entryBounds.end)).toBe(true)
        }
        // The database's own slice is requested for the whole entry, not in parts.
        expect(reads.ranges.some((range) => range.start === bounds[3].start && range.end === bounds[3].end)).toBe(true)

        expect(decodeCapture.inputs).toHaveLength(1)
        const decoded = decodeCapture.inputs[0]
        expect(reads.buffers).toContain(decoded.buffer)
        const databaseHeaderLength = 4 + DATABASE_NAME.length + 4
        expect(decoded.byteOffset).toBe(databaseHeaderLength)
        expect(decoded.byteLength).toBe(entries[3].length - databaseHeaderLength)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('never sleeps per entry, and yields to the event loop at least once per interval of a slow store', async () => {
        const entryCount = 10
        const bytes = concatChunks([
            ...Array.from({ length: entryCount }, (_, i) => assetEntry(16, `slow${i}.png`)),
            databaseEntry(),
        ])
        let clock = 0
        const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock)
        const yieldedAt: number[] = []
        yieldToEventLoopMock.mockImplementation(async () => { yieldedAt.push(clock) })
        forageSetItemMock.mockImplementation(async () => { clock += 30 })

        try {
            await loadBackupBytes(bytes)
        } finally {
            nowSpy.mockRestore()
            forageSetItemMock.mockImplementation(async () => {})
        }

        expect(sleep).not.toHaveBeenCalled()
        expect(yieldedAt.length).toBeGreaterThanOrEqual(4)
        // Never more than the 50 ms interval plus one entry's own 30 ms between yields.
        let previous = 0
        for (const at of yieldedAt) {
            expect(at - previous).toBeLessThanOrEqual(80)
            previous = at
        }
    })

    test('does not yield when the store answers instantly', async () => {
        const bytes = concatChunks([assetEntry(16, 'fast1.png'), assetEntry(16, 'fast2.png'), databaseEntry()])
        const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => 0)

        try {
            await loadBackupBytes(bytes)
        } finally {
            nowSpy.mockRestore()
        }

        expect(yieldToEventLoopMock).not.toHaveBeenCalled()
        expect(sleep).not.toHaveBeenCalled()
    })

    test('updates the progress text only when the shown percentage changes', async () => {
        // The three small entries in front of the large one each end below
        // 0.01% of the file, so they show the same percentage; so do the
        // large entry and the database behind it, which end within 0.01% of
        // the file's end.
        const entries = [
            assetEntry(1, 't0.png'),
            assetEntry(1, 't1.png'),
            assetEntry(1, 't2.png'),
            buildChunk('huge.png', new Uint8Array(2 * 1024 * 1024)),
            databaseEntry(),
        ]
        const bytes = concatChunks(entries)
        const expectedTexts: string[] = []
        let end = 0
        for (const entry of entries) {
            end += entry.length
            const text = `Loading local Backup... (${((end / bytes.length) * 100).toFixed(2)}%)`
            if (expectedTexts[expectedTexts.length - 1] !== text) {
                expectedTexts.push(text)
            }
        }

        await loadBackupBytes(bytes)

        const loadingTexts = alertMocks.alertWait.mock.calls
            .map((call) => String(call[0]))
            .filter((text) => text.startsWith('Loading local Backup...'))
        expect(expectedTexts).toEqual(['Loading local Backup... (0.00%)', 'Loading local Backup... (100.00%)'])
        expect(loadingTexts).toEqual(expectedTexts)
    })

    test('imports the entries before a truncated final database entry and reports file corruption', async () => {
        await loadBackupBytes(truncatedDatabaseFixture())

        expect(forageSetItemMock).toHaveBeenCalledWith(`assets/${ASSET_NAME}`, expect.any(Uint8Array))
        expect(setColdStorageItemMock).toHaveBeenCalledWith(COLD_UUID, { message: [] })
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(forageSetItemMock).not.toHaveBeenCalledWith('database/database.bin', expect.anything())
        expect(forageSetItemMock).not.toHaveBeenCalledWith('blocks/head', expect.anything())
        expect(fetchMock).not.toHaveBeenCalled()
        expect(alertMocks.alertError).toHaveBeenCalledWith('Failed, Is file corrupted?')
    })
})

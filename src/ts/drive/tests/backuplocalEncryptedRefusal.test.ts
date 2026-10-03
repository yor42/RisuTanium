// @vitest-environment happy-dom

/**
 * MC-081. `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) must refuse to
 * import a `.bin` that carries any entry whose complete name decodes to
 * `encryption.risudat` -- wherever that entry sits in the file, whatever its
 * content, and whether or not its declared data length fits -- before
 * performing any write: no asset write (`forageStorage.setItem('assets/...')`
 * or Tauri `writeFile`), no `setColdStorageItem`, no `database.bin` write,
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
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array) => {}))
const acquireExclusiveStorageMigrationLockMock = vi.hoisted(() => vi.fn(async () => (async () => {})))

vi.mock(import('../../globalApi.svelte'), () => ({
    LocalWriter: class {},
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: forageSetItemMock,
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
import { injectAppStore } from '../../storage/store/appStore'
import { createForageBackedStore, type ForageLike } from '../../storage/tests/forageBackedStore'

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

type ChunkSizes = number | number[]

function readableStreamFromBytes(bytes: Uint8Array, chunkSizes: ChunkSizes): ReadableStream<Uint8Array> {
    let offset = 0
    let sizeIndex = 0
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset >= bytes.length) {
                controller.close()
                return
            }
            const size = Array.isArray(chunkSizes)
                ? chunkSizes[Math.min(sizeIndex, chunkSizes.length - 1)]
                : chunkSizes
            sizeIndex += 1
            const end = Math.min(offset + Math.max(1, size), bytes.length)
            controller.enqueue(bytes.slice(offset, end))
            offset = end
        },
    })
}

/** A real File whose `stream()` yields the given chunk size(s) over `bytes`, instead of the engine's own chunking. */
function fileWithChunkedStream(bytes: Uint8Array, chunkSizes: ChunkSizes, name = 'backup.bin'): File {
    const base = new File([asBlobPart(bytes)], name)
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'stream') {
                return () => readableStreamFromBytes(bytes, chunkSizes)
            }
            return Reflect.get(target, prop, receiver)
        },
    })
}

/**
 * A real File whose `stream()` reads `streamBytes` -- what the streaming
 * import loop actually sees -- while `slice()` reads a differently-shaped
 * `sliceBytes` -- what a pre-read header walk would see. Models a
 * `File`/`Blob` whose two read paths disagree, so a guard that only
 * consults one of them can be evaded.
 */
function fileWithDivergentViews(streamBytes: Uint8Array, sliceBytes: Uint8Array, name = 'backup.bin', streamChunkSizes: ChunkSizes = 65536): File {
    const base = new File([asBlobPart(streamBytes)], name)
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'stream') {
                return () => readableStreamFromBytes(streamBytes, streamChunkSizes)
            }
            if (prop === 'slice') {
                return (start = 0, end = sliceBytes.length) => new Blob([asBlobPart(sliceBytes.slice(start, end))])
            }
            return Reflect.get(target, prop, receiver)
        },
    })
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

function divergentStreamBytes(): Uint8Array {
    return concatChunks([assetEntry(), markerEntry(wellFormedMarkerBody()), databaseEntry()])
}

/** The database entry resolves out of an earlier stream batch than the marker, unlike divergentStreamBytes above where the marker precedes the database. */
function divergentStreamBytesDatabaseBeforeMarker(): Uint8Array {
    return concatChunks([assetEntry(), databaseEntry(), markerEntry(wellFormedMarkerBody())])
}

function divergentSliceBytes(): Uint8Array {
    // A self-consistent backup with no marker at all -- what a pre-read
    // header walk alone would conclude if it trusted only this view.
    return concatChunks([assetEntry(), databaseEntry()])
}

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
    // The restore writes the main file through the page's byte store; here it is the storage-object model above.
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike))
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

    test('refuses under Tauri without ever calling the native filesystem write', async () => {
        vi.doMock(import('../../platform'), () => ({
            isTauri: true,
            isNodeServer: false,
        }) as unknown as typeof import('../../platform'))
        vi.resetModules()

        try {
            const { LoadLocalBackup: loadUnderTauri } = await import('../backuplocal')
            await loadBackupWithFile(new File([asBlobPart(upstreamOrderFixture())], 'backup.bin'), loadUnderTauri)

            expectNoWritesNoInstallNoNetwork()
            expectRefusalShown()
        } finally {
            vi.doUnmock(import('../../platform'))
            vi.resetModules()
        }
    })
})

describe('the import loop guards independently of a pre-read view that missed the marker (I3, defense in depth)', () => {
    test('aborts mid-loop when the marker is absent from the slice() view but present in the streamed bytes right after one asset', async () => {
        const file = fileWithDivergentViews(divergentStreamBytes(), divergentSliceBytes())

        await loadBackupWithFile(file)

        expectNoWritesNoInstallNoNetwork()
        expectLoopGuardShown()
    })

    test('aborts before writing anything when the marker declares a data length that runs past the end of a one-chunk streamed batch, even though the slice() view shows no marker', async () => {
        const nameBytes = new TextEncoder().encode(MARKER_NAME)
        const declaredDataLength = 5000
        const header = new Uint8Array(4 + nameBytes.length + 4)
        let offset = 0
        header.set(u32le(nameBytes.length), offset); offset += 4
        header.set(nameBytes, offset); offset += nameBytes.length
        header.set(u32le(declaredDataLength), offset)
        const streamBytes = concatChunks([assetEntry(), header])
        const file = fileWithDivergentViews(streamBytes, divergentSliceBytes())

        await loadBackupWithFile(file)

        expectNoWritesNoInstallNoNetwork()
        expectLoopGuardShown()
    })

    test('aborts before writing anything when a complete marker name is followed by a data-length field cut off at the end of a one-chunk streamed batch, even though the slice() view shows no marker', async () => {
        const nameBytes = new TextEncoder().encode(MARKER_NAME)
        const header = concatChunks([u32le(nameBytes.length), nameBytes, new Uint8Array([1, 2])])
        const streamBytes = concatChunks([assetEntry(), header])
        const file = fileWithDivergentViews(streamBytes, divergentSliceBytes())

        await loadBackupWithFile(file)

        expectNoWritesNoInstallNoNetwork()
        expectLoopGuardShown()
    })

    test('never installs a database resolved out of an earlier stream batch once a later batch reveals the marker, even though the slice() view shows no marker', async () => {
        // 7-byte chunks force the database entry to finish resolving, in its
        // own batch, well before the marker's batch: the guard must still
        // stop the whole import, not just decline to write the marker's own
        // batch, or a database resolved earlier would reach setDatabase.
        const file = fileWithDivergentViews(divergentStreamBytesDatabaseBeforeMarker(), divergentSliceBytes(), 'backup.bin', 7)

        await loadBackupWithFile(file)

        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(forageSetItemMock).not.toHaveBeenCalledWith('database/database.bin', expect.anything())
        expectLoopGuardShown()
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
    test('writes three assets, a cold entry and the database exactly once each, in file order, even when two entries resolve out of the same stream batch', async () => {
        const asset1 = assetEntry(16, 'asset1.png')
        const asset2 = assetEntry(16, 'asset2.png')
        const asset3 = assetEntry(16, 'asset3.png')
        const cold = coldEntry()
        const db = databaseEntry()
        const bytes = concatChunks([asset1, asset2, asset3, cold, db])
        // The first stream chunk covers asset1 and asset2 exactly, so both
        // resolve together out of one batch; every later chunk is 7 bytes,
        // so each remaining entry resolves out of a batch of its own. A
        // batch written out of order, or re-written on a later batch because
        // the consumed bytes were never trimmed, would show up in this list.
        const file = fileWithChunkedStream(bytes, [asset1.length + asset2.length, 7])

        await loadBackupWithFile(file)

        expect(forageSetItemMock.mock.calls.map((call) => call[0])).toEqual([
            'assets/asset1.png',
            'assets/asset2.png',
            'assets/asset3.png',
            'database/database.bin',
        ])
        expect(setColdStorageItemMock).toHaveBeenCalledTimes(1)
        expect(setColdStorageItemMock).toHaveBeenCalledWith(COLD_UUID, { message: [] })
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        const installed = setDatabaseMock.mock.calls[0][0] as Database
        expect(installed.characters).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
        // A successful restore reloads instead of showing a "Success" alert,
        // and marks that reload app-initiated so the app's own "Leave site?"
        // guard lets it through.
        expect(alertMocks.alertNormal).not.toHaveBeenCalledWith('Success')
        expect(isAppInitiatedReload()).toBe(true)
    })

    test('imports the entries before a truncated final database entry and reports file corruption', async () => {
        await loadBackupBytes(truncatedDatabaseFixture())

        expect(forageSetItemMock).toHaveBeenCalledWith(`assets/${ASSET_NAME}`, expect.any(Uint8Array))
        expect(setColdStorageItemMock).toHaveBeenCalledWith(COLD_UUID, { message: [] })
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(forageSetItemMock).not.toHaveBeenCalledWith('database/database.bin', expect.anything())
        expect(fetchMock).not.toHaveBeenCalled()
        expect(alertMocks.alertError).toHaveBeenCalledWith('Failed, Is file corrupted?')
    })
})

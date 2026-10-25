// @vitest-environment happy-dom

/**
 * `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) on the browser's IndexedDB page: an asset entry of
 * `ASSET_PIECE_SAVE_MIN_BYTES` or more is stored as a slice of the backup file (`writeBlob`) and is never read
 * into memory; smaller entries, the database and the cold-storage units keep their whole-value paths. A browser
 * that cannot keep a Blob (`StoreBlobUnsupportedError`) restores the entry through the whole-entry path whatever
 * its size, as a restore always has on the web. Any other failure of the Blob write stops the restore and falls
 * back to nothing.
 *
 * The piece threshold is mocked to 1000 bytes and the browser bound to 5000 bytes so the fixtures stay small.
 * Storage is the in-memory forage model behind the byte-store seam plus a Map of kept Blobs; nothing here proves
 * a real browser's IndexedDB behaviour, memory use or quota.
 *
 * Titles say what a test pins: `reproducer` fails on the code before the change, `guard` holds before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '../../storage/database.svelte'
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

const platformBox = vi.hoisted(() => ({ isNodeServer: false }))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platformBox.isNodeServer },
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/nodeBodyLimit'), async (importOriginal) => ({
    ...(await importOriginal()),
    WEB_ASSET_LIMIT_BYTES: 5000,
}))

vi.mock(import('../../assetHash'), async (importOriginal) => ({
    ...(await importOriginal()),
    ASSET_PIECE_SAVE_MIN_BYTES: 1000,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
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
    requiresFullEncoderReload: { state: false },
    noteAssetWrittenThisPage: vi.fn(),
    dbWriteLock: { acquire: vi.fn(async () => vi.fn()) },
    acquireExclusiveStorageMigrationLock: acquireExclusiveStorageMigrationLockMock,
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
    alertConfirm: vi.fn(async (_message: string) => true),
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
import { overrideBackupWindowBytes } from '../backupContainer'
import { encodeRisuSaveLegacy } from '../../storage/risuSave'
import { forageStorage } from '../../globalApi.svelte'
import { injectRestoreStore } from './restoreSupport'
import { injectAppStore } from '../../storage/store/appStore'
import { getPageBlockOwner } from '../../storage/pageBlockOwner'
import { StoreBlobUnsupportedError, StoreInvalidKeyError } from '../../storage/store/errors'
import type { ByteStore } from '../../storage/store/contract'
import { createForageBackedStore, type ForageLike } from '../../storage/tests/forageBackedStore'

//#region fixtures

const LIMIT = 1024 * 1024
const COLD_UUID = '22222222-2222-2222-2222-222222222222'
const COLD_NAME = `coldstorage_${COLD_UUID}.json`

function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    out.set(u32le(nameBytes.length), 0)
    out.set(nameBytes, 4)
    out.set(u32le(data.length), 4 + nameBytes.length)
    out.set(data, 8 + nameBytes.length)
    return out
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
    }
    return out
}

function assetEntry(name: string, size: number): Uint8Array {
    return buildChunk(name, new Uint8Array(size).fill(9))
}

function databaseEntry(): Uint8Array {
    return buildChunk('database.risudat', encodeRisuSaveLegacy({ characters: [] } as unknown as Database, 'noCompression'))
}

/** A cold unit whose JSON is larger than the limit but whose compressed form would fit. */
function bigColdEntry(): Uint8Array {
    return buildChunk(COLD_NAME, new TextEncoder().encode(JSON.stringify({ message: [], padding: 'x'.repeat(LIMIT + 100) })))
}

//#endregion

//#region harness plumbing

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
/** The Blobs the store kept, by key, and what the next Blob write does. */
const keptBlobs = new Map<string, Blob>()
const blobWrites = { failure: undefined as unknown, keys: [] as string[] }
let restoreStore: ByteStore

beforeEach(async () => {
    setDatabaseMock.mockClear()
    forageFiles.clear()
    forageSetItemMock.mockClear()
    setColdStorageItemMock.mockClear()
    acquireExclusiveStorageMigrationLockMock.mockClear()
    keptBlobs.clear()
    blobWrites.failure = undefined
    blobWrites.keys = []
    platformBox.isNodeServer = false
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
    alertMocks.alertConfirm.mockReset()
    alertMocks.alertConfirm.mockImplementation(async () => true)

    const forageBackedStore = createForageBackedStore(forageStorage as unknown as ForageLike)
    // The restore writes a block generation through the page's byte store; here it is the storage-object model above. The model has
    // no revision API, so the block store runs in its mutex-head mode. The store keeps Blobs like the browser's IndexedDB does
    // (writeBlob, readBlob) and offers no openWriter here.
    restoreStore = {
        ...forageBackedStore,
        writeBlob: async (key, blob) => {
            blobWrites.keys.push(key)
            if (blobWrites.failure !== undefined) {
                throw blobWrites.failure
            }
            keptBlobs.set(key, blob)
            return { version: null }
        },
        readBlob: async (key) => keptBlobs.get(key) ?? null,
    }
    // The page's block owner is built while the kind is 'tauri' (a mutex head swap), because the model has no revision API for
    // the IndexedDB head swap; the owner stays cached when the selected kind then becomes 'indexeddb', which the size limits follow.
    injectRestoreStore(restoreStore, 'tauri')
    await getPageBlockOwner()
    injectAppStore(restoreStore, 'indexeddb')

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
})

async function loadBackupBytes(bytes: Uint8Array) {
    const ended = LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [new File([asBlobPart(bytes)], 'backup.bin')], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    return await ended
}

function writtenKeys(): string[] {
    return forageSetItemMock.mock.calls.map((call) => call[0])
}

/** The asset keys written, in order. */
function writtenAssetKeys(): string[] {
    return writtenKeys().filter((key) => key.startsWith('assets/'))
}

/** Whether the restored database was committed as a block generation, and never as a `database.bin`. */
function expectBlockGenerationCommitted(): void {
    expect(writtenKeys()).toContain('blocks/head')
    expect(writtenKeys()).not.toContain('database/database.bin')
}

function shownErrors(): string[] {
    return alertMocks.alertError.mock.calls.map((call) => String(call[0]))
}

//#endregion

const PIECE_MIN = 1000
const BROWSER_BOUND = 5000

async function blobBytes(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer())
}

describe('a web restore of an asset entry the browser keeps as a Blob', () => {
    // Windows smaller than an entry, so the walk and the copy never read an entry's data into a window of their own.
    beforeEach(() => overrideBackupWindowBytes({ walk: 64, copy: 64 }))
    afterEach(() => overrideBackupWindowBytes(null))

    test('reproducer: an entry at the piece threshold is stored as a Blob of exactly its bytes and is never read into memory; a smaller one is written whole', async () => {
        const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')
        const bytes = concatChunks([assetEntry('small.png', PIECE_MIN - 1), assetEntry('large.png', PIECE_MIN), assetEntry('larger.png', 3000), databaseEntry()])

        const ended = await loadBackupBytes(bytes)

        expect(ended.detail.assets).toEqual({ written: 3, skipped: [] })
        expect(blobWrites.keys).toEqual(['assets/large.png', 'assets/larger.png'])
        expect(writtenAssetKeys()).toEqual(['assets/small.png'])
        expect(await blobBytes(keptBlobs.get('assets/large.png')!)).toEqual(new Uint8Array(PIECE_MIN).fill(9))
        expect(await blobBytes(keptBlobs.get('assets/larger.png')!)).toEqual(new Uint8Array(3000).fill(9))
        // The reads above are the test's own; the restore read none of an entry's data.
        const restoreReadSizes = reads.mock.contexts.slice(0, reads.mock.contexts.length - 2).map((context) => (context as Blob).size)
        expect(Math.max(...restoreReadSizes)).toBeLessThan(PIECE_MIN)
        expectBlockGenerationCommitted()
        expect(alertMocks.alertNormalWait).not.toHaveBeenCalled()
    })

    test('guard: a cold-storage unit above the threshold is decoded whole and never stored as an asset Blob', async () => {
        const bytes = concatChunks([bigColdEntry(), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(blobWrites.keys).toEqual([])
        expect(writtenAssetKeys()).toEqual([])
        expect(setColdStorageItemMock).toHaveBeenCalledTimes(1)
        expectBlockGenerationCommitted()
    })

    test('guard: a name the store refuses is skipped and the restore goes on', async () => {
        blobWrites.failure = new StoreInvalidKeyError('assets/large.png', 'refused by the store')
        const bytes = concatChunks([assetEntry('large.png', PIECE_MIN), assetEntry('small.png', 16), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(writtenAssetKeys()).toEqual(['assets/small.png'])
        expectBlockGenerationCommitted()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('guard: a failure of the Blob write that is not a missing Blob capability stops the restore with no whole-entry fallback', async () => {
        blobWrites.failure = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        const bytes = concatChunks([assetEntry('large.png', PIECE_MIN), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(writtenAssetKeys()).toEqual([])
        expect(keptBlobs.size).toBe(0)
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })
})

describe('a web restore in a browser that cannot keep a Blob', () => {
    beforeEach(() => {
        blobWrites.failure = new StoreBlobUnsupportedError('assets/x', new DOMException('no blobs', 'DataCloneError'))
    })

    test('reproducer: an entry within the browser bound is restored through the whole-entry path with its exact bytes, and the restore goes on', async () => {
        const bytes = concatChunks([assetEntry('before.png', 16), assetEntry('large.png', 3000), assetEntry('after.png', 16), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(blobWrites.keys).toEqual(['assets/large.png'])
        expect(writtenAssetKeys()).toEqual(['assets/before.png', 'assets/large.png', 'assets/after.png'])
        const stored = forageSetItemMock.mock.calls.find((call) => call[0] === 'assets/large.png')?.[1]
        expect(stored).toEqual(new Uint8Array(3000).fill(9))
        expectBlockGenerationCommitted()
        expect(alertMocks.alertNormalWait).not.toHaveBeenCalled()
    })

    test('reproducer: an entry above the browser bound is restored whole with its exact bytes, counted, and nothing is listed as skipped', async () => {
        const bytes = concatChunks([assetEntry('first.png', 16), assetEntry('huge.png', BROWSER_BOUND + 10), assetEntry('last.png', 16), databaseEntry()])

        const ended = await loadBackupBytes(bytes)

        expect(writtenAssetKeys()).toEqual(['assets/first.png', 'assets/huge.png', 'assets/last.png'])
        const stored = forageSetItemMock.mock.calls.find((call) => call[0] === 'assets/huge.png')?.[1]
        expect(stored).toEqual(new Uint8Array(BROWSER_BOUND + 10).fill(9))
        expect(ended.detail.assets).toEqual({ written: 3, skipped: [] })
        expectBlockGenerationCommitted()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        expect(alertMocks.alertNormalWait).not.toHaveBeenCalled()
        expect(shownErrors()).toEqual([])
    })

    test('guard: an entry exactly at the browser bound and one a byte above it are both restored whole and counted', async () => {
        const bytes = concatChunks([assetEntry('at.png', BROWSER_BOUND), assetEntry('above.png', BROWSER_BOUND + 1), databaseEntry()])

        const ended = await loadBackupBytes(bytes)

        expect(writtenAssetKeys()).toEqual(['assets/at.png', 'assets/above.png'])
        expect(ended.detail.assets).toEqual({ written: 2, skipped: [] })
        expect(alertMocks.alertNormalWait).not.toHaveBeenCalled()
    })
})

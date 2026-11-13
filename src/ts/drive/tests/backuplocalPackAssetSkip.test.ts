// @vitest-environment happy-dom

/**
 * A `.bin` restore never installs a theme pack's file: an entry whose basename is a pack file's name
 * (`tp-<64 hex>.<ext>`, any case) is skipped on every write route of the copy pass, before anything is noted, sent or
 * written, so the page's own file under that name is never replaced, and no notice names the entry. On a Node page the
 * same entry is also left out of the oversize question, whatever its size, but an entry whose name is longer than the
 * walk's 1024-byte bound is still judged on the prefix the walk kept, so an ordinary oversized asset is never written.
 *
 * Routes covered: the desktop asset pipeline's `add` (small entry), its `addStreamed` (entry above one batch), the
 * desktop chunk streamer `streamAssetEntry` (pipeline off), the browser's slice-of-the-file Blob write, and the direct
 * store write. The stores here are stand-ins over an in-memory file model; a mocked success is not evidence about a
 * native backend. Titles: `reproducer` fails when the skip is absent; `guard` passes before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import {
    getColdStorageBackupKey as realGetColdStorageBackupKey,
    isColdStorageBackupData as realIsColdStorageBackupData,
} from 'src/ts/process/coldstorageData'

//#region module mocks

const platformBox = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))
const osBox = vi.hoisted(() => ({ os: 'windows' }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 4 * 1024 * 1024 }))
const batchFake = await vi.hoisted(async () => (await import('./assetBatchFake')).createAssetBatchFake())
/** The key of every chunked write the page's streamer started, from the raw chunk headers. */
const streamedKeys = vi.hoisted(() => ({ keys: [] as string[] }))
const forageFiles = vi.hoisted(() => new Map<string, Uint8Array>())
const forageSetItemMock = vi.hoisted(() => vi.fn(async (key: string, data: Uint8Array) => { forageFiles.set(key, data) }))
const noteWrittenMock = vi.hoisted(() => vi.fn())
const setDatabaseMock = vi.hoisted(() => vi.fn())
const setColdStorageItemMock = vi.hoisted(() => vi.fn(async () => true))
const acquireExclusiveStorageMigrationLockMock = vi.hoisted(() => vi.fn(async () => (async () => { })))

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

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { },
    isAppInitiatedReload: () => false,
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    get isNodeServer() { return platformBox.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))

vi.mock(import('src/ts/storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 1024 * 1024,
    NODE_ASSET_LIMIT_BYTES: 8 * 1024 * 1024,
    WEB_ASSET_LIMIT_BYTES: 2 * 1024 * 1024,
}) as unknown as typeof import('src/ts/storage/nodeBodyLimit'))

vi.mock(import('src/ts/assetHash'), async (importOriginal) => ({
    ...(await importOriginal()),
    ASSET_PIECE_SAVE_MIN_BYTES: 1000,
}))

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('src/ts/storage/tauriAssetBatch', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriAssetBatch')>()),
    ...batchFake.module,
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: setDatabaseMock,
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    LocalWriter: class { },
    forageStorage: {
        keys: vi.fn(async () => Array.from(forageFiles.keys())),
        getItem: vi.fn(async (key: string) => forageFiles.get(key) ?? null),
        setItem: forageSetItemMock,
        removeItem: vi.fn(async (key: string) => { forageFiles.delete(key) }),
    },
    requiresFullEncoderReload: { state: false },
    noteAssetWrittenThisPage: noteWrittenMock,
    dbWriteLock: { acquire: vi.fn(async () => vi.fn()) },
    acquireExclusiveStorageMigrationLock: acquireExclusiveStorageMigrationLockMock,
    locksSupported: true,
    tabPresenceLockAcquired: Promise.resolve(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

const alertMocks = vi.hoisted(() => ({
    alertGenerationInfoStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertStore: { set: vi.fn() },
    alertError: vi.fn(),
    waitAlert: vi.fn(async () => { }),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertAddCharacter: vi.fn(async () => ''),
    alertChatOptions: vi.fn(async () => 0),
    alertSelect: vi.fn(async () => ''),
    alertErrorWait: vi.fn(async () => { }),
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

vi.mock(import('src/ts/alert'), () => alertMocks as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: async (command: string, args?: unknown, options?: unknown) => {
        const headers = command === 'write_chunk_raw' ? (options as { headers?: Record<string, string> } | undefined)?.headers : undefined
        if (headers?.['x-risu-key'] !== undefined) {
            streamedKeys.keys.push(decodeURIComponent(headers['x-risu-key']))
        }
        return await (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options)
    },
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: (name: string) => realGetColdStorageBackupKey(name),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: (data: unknown) => realIsColdStorageBackupData(data),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: setColdStorageItemMock,
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

//#endregion

import { LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { overrideBackupWindowBytes } from 'src/ts/drive/backupContainer'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { forageStorage } from 'src/ts/globalApi.svelte'
import { injectRestoreStore } from './restoreSupport'
import { injectAppStore, getAppStore } from 'src/ts/storage/store/appStore'
import { getPageBlockOwner } from 'src/ts/storage/pageBlockOwner'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region fixtures

const MIB = 1024 * 1024
const HEX = 'ab'.repeat(32)
const PACK_NAME = `tp-${HEX}.png`
const PACK_KEY = `assets/${PACK_NAME}`
/** The page's own bytes under the pack name: what the restore must leave as it is. */
const PAGE_BYTES = new Uint8Array([7, 7, 7, 7])

function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, nameBytes.length, true)
    out.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, data.length, true)
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

function entry(name: string, size: number, fill = 9): Uint8Array {
    return buildChunk(name, new Uint8Array(size).fill(fill))
}

function databaseEntry(): Uint8Array {
    return buildChunk('database.risudat', encodeRisuSaveLegacy({ characters: [] } as unknown as Database, 'noCompression'))
}

function same(actual: Uint8Array | undefined, expected: Uint8Array): boolean {
    return actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

//#endregion

//#region harness plumbing

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
const keptBlobs = new Map<string, Blob>()
const blobWrites = { keys: [] as string[] }
let restoreStore: ByteStore

beforeEach(() => {
    platformBox.isTauri = false
    platformBox.isNodeServer = false
    osBox.os = 'windows'
    desktop.reset()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    resetByteTransportForTests()
    batchFake.reset()
    batchFake.useStore(getAppStore)
    streamedKeys.keys.length = 0
    forageFiles.clear()
    forageSetItemMock.mockClear()
    noteWrittenMock.mockClear()
    setDatabaseMock.mockClear()
    setColdStorageItemMock.mockClear()
    acquireExclusiveStorageMigrationLockMock.mockClear()
    keptBlobs.clear()
    blobWrites.keys = []
    for (const value of Object.values(alertMocks)) {
        if (typeof value === 'function') {
            (value as ReturnType<typeof vi.fn>).mockClear()
        }
    }
    alertMocks.alertConfirm.mockReset()
    alertMocks.alertConfirm.mockImplementation(async () => true)
    vi.spyOn(console, 'error').mockImplementation(() => { })
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
    resetBusyActionsForTest()
    overrideBackupWindowBytes(null)
    createElementSpy.mockRestore()
    vi.restoreAllMocks()
})

/** The desktop page: the files store over the in-memory file model, the batch commands on or off. */
function desktopPage(options: { pipeline: boolean }): void {
    platformBox.isTauri = true
    batchFake.ctl.available = options.pipeline
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    fakeFs.plant(PACK_KEY, PAGE_BYTES)
}

/** A browser page over the forage model; `blobs` gives the store the Blob methods of IndexedDB, `node` the Node server's page kind. */
async function webPage(options: { blobs?: boolean, node?: boolean, piecesRecorded?: boolean } = {}): Promise<void> {
    platformBox.isNodeServer = options.node === true
    const base = createForageBackedStore(forageStorage as unknown as ForageLike)
    restoreStore = {
        ...base,
        ...(options.blobs === true
            ? {
                writeBlob: async (key: string, blob: Blob) => {
                    blobWrites.keys.push(key)
                    keptBlobs.set(key, blob)
                    return { version: null }
                },
                readBlob: async (key: string) => keptBlobs.get(key) ?? null,
            }
            : {}),
        ...(options.node === true
            ? {
                piecesRecorded: () => options.piecesRecorded === true,
                readPieces: async () => null,
                openWriter: (key: string) => {
                    const parts: Uint8Array[] = []
                    return {
                        write: async (data: Uint8Array) => { parts.push(data.slice()) },
                        finish: async (finalKey?: string) => {
                            await (forageStorage as unknown as ForageLike).setItem(finalKey ?? key, concatChunks(parts))
                        },
                        abort: async () => { parts.length = 0 },
                    }
                },
            }
            : {}),
    } as ByteStore
    // The block owner is built as a mutex-head store while the kind is 'tauri'; the page's own kind follows for the limits.
    injectRestoreStore(restoreStore, 'tauri')
    await getPageBlockOwner()
    injectAppStore(restoreStore, options.node === true ? 'node' : 'indexeddb')
    forageFiles.set(PACK_KEY, PAGE_BYTES)
}

async function loadBackupBytes(bytes: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [new File([asBlobPart(bytes)], 'backup.bin')], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

/** Every text a notice or a question showed. */
function shownTexts(): string {
    const texts: string[] = []
    for (const value of Object.values(alertMocks)) {
        if (typeof value === 'function') {
            for (const call of (value as ReturnType<typeof vi.fn>).mock.calls) {
                texts.push(String(call[0]))
            }
        }
    }
    return texts.join('\n')
}

const writtenAssetKeys = (): string[] => forageSetItemMock.mock.calls.map((call) => call[0]).filter((key) => key.startsWith('assets/'))
const notedKeys = (): string[] => noteWrittenMock.mock.calls.map((call) => String(call[0]))

//#endregion

describe('a desktop restore leaves the page\'s pack file as it is, on every route', () => {
    test('T2-16 reproducer: the pipeline\'s add (a small entry): the page\'s bytes stay, nothing is sent for the name, and an ordinary entry is written', async () => {
        desktopPage({ pipeline: true })

        await loadBackupBytes(concatChunks([entry(PACK_NAME, 200, 1), entry('ordinary.png', 100, 2), databaseEntry()]))

        expect(same(fakeFs.files.get(PACK_KEY), PAGE_BYTES)).toBe(true)
        expect(batchFake.ctl.calls.some((call) => call.kind === 'batch')).toBe(true)
        expect(batchFake.ctl.calls.flatMap((call) => call.keys)).not.toContain(PACK_KEY)
        expect(fakeFs.files.has('assets/ordinary.png')).toBe(true)
        expect(notedKeys()).not.toContain(PACK_KEY)
        expect(shownTexts()).not.toContain('tp-')
    })

    test('T2-16 reproducer: the pipeline\'s addStreamed (an entry above one batch): the page\'s bytes stay, no stream starts for the name', async () => {
        desktopPage({ pipeline: true })

        await loadBackupBytes(concatChunks([entry(PACK_NAME, 5 * MIB, 1), entry('ordinary.png', 100, 2), databaseEntry()]))

        expect(same(fakeFs.files.get(PACK_KEY), PAGE_BYTES)).toBe(true)
        expect(streamedKeys.keys).not.toContain(PACK_KEY)
        expect(batchFake.ctl.calls.flatMap((call) => call.keys)).not.toContain(PACK_KEY)
        expect(fakeFs.files.has('assets/ordinary.png')).toBe(true)
        expect(notedKeys()).not.toContain(PACK_KEY)
        expect(shownTexts()).not.toContain('tp-')
    })

    test('T2-16 reproducer: the chunk streamer\'s streamAssetEntry (pipeline off): the page\'s bytes stay, no stream starts for the name', async () => {
        desktopPage({ pipeline: false })

        await loadBackupBytes(concatChunks([entry(PACK_NAME, 5 * MIB, 1), entry('ordinary.png', 100, 2), databaseEntry()]))

        expect(same(fakeFs.files.get(PACK_KEY), PAGE_BYTES)).toBe(true)
        expect(streamedKeys.keys).not.toContain(PACK_KEY)
        expect(fakeFs.files.has('assets/ordinary.png')).toBe(true)
        expect(notedKeys()).not.toContain(PACK_KEY)
        expect(shownTexts()).not.toContain('tp-')
    })

    test('T2-16 reproducer: the direct store write (pipeline off, small entry): the page\'s bytes stay and the name is not noted', async () => {
        desktopPage({ pipeline: false })

        await loadBackupBytes(concatChunks([entry(PACK_NAME, 200, 1), entry('ordinary.png', 100, 2), databaseEntry()]))

        expect(same(fakeFs.files.get(PACK_KEY), PAGE_BYTES)).toBe(true)
        expect(fakeFs.files.has('assets/ordinary.png')).toBe(true)
        expect(notedKeys()).toContain('assets/ordinary.png')
        expect(notedKeys()).not.toContain(PACK_KEY)
        expect(shownTexts()).not.toContain('tp-')
    })
})

describe('a browser restore leaves the page\'s pack file as it is, on every route', () => {
    test('T2-16 reproducer: the slice-of-the-file Blob route (an entry at the piece threshold): no Blob is kept for the name, the page\'s bytes stay', async () => {
        await webPage({ blobs: true })

        await loadBackupBytes(concatChunks([entry(PACK_NAME, 1500, 1), entry('ordinary.png', 1500, 2), databaseEntry()]))

        expect(blobWrites.keys).toEqual(['assets/ordinary.png'])
        expect(same(forageFiles.get(PACK_KEY), PAGE_BYTES)).toBe(true)
        expect(notedKeys()).toEqual(['assets/ordinary.png'])
        expect(shownTexts()).not.toContain('tp-')
    })

    test('T2-16 reproducer: the direct write route: the page\'s bytes stay, only the ordinary entry is written and noted', async () => {
        await webPage()

        await loadBackupBytes(concatChunks([entry(PACK_NAME, 200, 1), entry('ordinary.png', 100, 2), databaseEntry()]))

        expect(writtenAssetKeys()).toEqual(['assets/ordinary.png'])
        expect(same(forageFiles.get(PACK_KEY), PAGE_BYTES)).toBe(true)
        expect(notedKeys()).toEqual(['assets/ordinary.png'])
        expect(shownTexts()).not.toContain('tp-')
    })

    test('T2-16c reproducer: an upper-case spelling of the pack name is skipped as well (a case-folding file system would overwrite the page\'s file)', async () => {
        await webPage()

        await loadBackupBytes(concatChunks([entry(`TP-${HEX.toUpperCase()}.PNG`, 200, 1), entry('ordinary.png', 100, 2), databaseEntry()]))

        expect(writtenAssetKeys()).toEqual(['assets/ordinary.png'])
        expect(notedKeys()).toEqual(['assets/ordinary.png'])
    })

    test('T2-16 guard: a name that only starts like a pack name, or holds the stem inside a longer name, is an ordinary asset', async () => {
        await webPage()
        const nearMisses = [`tp-${HEX.slice(1)}.png`, `tp-${HEX}0.png`, `atp-${HEX}.png`, `tp-${HEX}.`, `tp-${HEX}.png.extra`]

        await loadBackupBytes(concatChunks([...nearMisses.map((name) => entry(name, 50)), databaseEntry()]))

        expect(writtenAssetKeys().sort()).toEqual(nearMisses.map((name) => `assets/${name}`).sort())
    })
})

describe('a Node restore leaves a pack-named entry out of the oversize question', () => {
    const LIMIT = 1024 * 1024

    test('T2-16d reproducer: an oversized pack-named entry beside an ordinary oversized one: the question names only the ordinary asset, and neither is written', async () => {
        await webPage({ node: true })

        await loadBackupBytes(concatChunks([entry(PACK_NAME, LIMIT + 10, 1), entry('huge.png', LIMIT + 10, 2), databaseEntry()]))

        expect(alertMocks.alertConfirm).toHaveBeenCalledTimes(1)
        expect(alertMocks.alertConfirm).toHaveBeenCalledWith(language.restoreOversizedAssetsConfirm(1, ['huge.png'], LIMIT))
        expect(writtenAssetKeys()).toEqual([])
        expect(same(forageFiles.get(PACK_KEY), PAGE_BYTES)).toBe(true)
        expect(alertMocks.alertNormalWait).toHaveBeenCalledWith(language.restoreAssetsSkippedTooLarge(1, ['huge.png'], LIMIT))
        expect(shownTexts()).not.toContain('tp-')
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('T2-16d reproducer: an oversized pack-named entry alone raises no question and no notice, and the restore completes', async () => {
        await webPage({ node: true })

        await loadBackupBytes(concatChunks([entry(PACK_NAME, LIMIT + 10, 1), entry('small.png', 16, 2), databaseEntry()]))

        expect(alertMocks.alertConfirm).not.toHaveBeenCalled()
        expect(alertMocks.alertNormalWait).not.toHaveBeenCalled()
        expect(writtenAssetKeys()).toEqual(['assets/small.png'])
        expect(same(forageFiles.get(PACK_KEY), PAGE_BYTES)).toBe(true)
        expect(shownTexts()).not.toContain('tp-')
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('T2-16e guard: an oversized entry whose name is longer than the walk\'s bound and whose first 1024 bytes end in a pack name is still asked about and never written', async () => {
        await webPage({ node: true })
        // The walk keeps the first 1024 bytes of a long name; they end exactly at a pack basename, the full name does not.
        const prefix = `${'n'.repeat(1024 - PACK_NAME.length - 1)}/${PACK_NAME}`
        expect(prefix.length).toBe(1024)
        const longName = `${prefix}.extra`

        await loadBackupBytes(concatChunks([entry(longName, LIMIT + 10, 1), entry('small.png', 16, 2), databaseEntry()]))

        expect(alertMocks.alertConfirm).toHaveBeenCalledTimes(1)
        expect(writtenAssetKeys()).toEqual(['assets/small.png'])
        expect(forageFiles.has(`assets/${longName}`)).toBe(false)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })
})

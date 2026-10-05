// @vitest-environment happy-dom

/**
 * `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) on a Node-served page: an
 * asset whose body is over what the server accepts in one request is named
 * before anything is written, the user decides whether to continue without
 * it, and the skipped names are reported after the database is written. A 413
 * for an asset that was under the limit is a refusal by the server or a proxy
 * in front of it and stops the restore with a message that says so. Cold
 * units are never size-checked: they are stored compressed.
 *
 * The limit is mocked to 1 MiB so the fixtures stay small. Storage is the
 * in-memory forage model behind the byte-store seam, with a wrapper that can
 * throw the Node store's `NodeHttpError` for chosen keys; nothing here proves
 * the Node server's behaviour.
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

const platformBox = vi.hoisted(() => ({ isNodeServer: true }))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platformBox.isNodeServer },
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 1024 * 1024,
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
import { encodeRisuSaveLegacy } from '../../storage/risuSave'
import { forageStorage } from '../../globalApi.svelte'
import { injectRestoreStore } from './restoreSupport'
import { NodeHttpError } from '../../storage/store/nodeHttpStore'
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
/** Keys whose store write throws the given error. */
const failingWrites = new Map<string, Error>()

beforeEach(() => {
    setDatabaseMock.mockClear()
    forageFiles.clear()
    forageSetItemMock.mockClear()
    setColdStorageItemMock.mockClear()
    acquireExclusiveStorageMigrationLockMock.mockClear()
    failingWrites.clear()
    platformBox.isNodeServer = true
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
    // no revision API, so the page is a desktop-kind one (a mutex head swap); the Node behaviour under test is the platform flag
    // above and the thrown NodeHttpError.
    injectRestoreStore({
        ...forageBackedStore,
        write: async (key, bytes, condition) => {
            const failure = failingWrites.get(key)
            if (failure) {
                throw failure
            }
            return forageBackedStore.write(key, bytes, condition)
        },
    })

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

async function loadBackupBytes(bytes: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [new File([asBlobPart(bytes)], 'backup.bin')], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
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

describe('an asset over the Node server body limit is disclosed before anything is written', () => {
    test('asks first, with the asset named, and writes nothing, takes no lock, until the user answers', async () => {
        let writesAtPrompt = -1
        let lockCallsAtPrompt = -1
        alertMocks.alertConfirm.mockImplementation(async () => {
            writesAtPrompt = forageSetItemMock.mock.calls.length + setColdStorageItemMock.mock.calls.length
            lockCallsAtPrompt = acquireExclusiveStorageMigrationLockMock.mock.calls.length
            return true
        })
        const bytes = concatChunks([assetEntry('small.png', 16), assetEntry('huge.png', LIMIT + 10), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(alertMocks.alertConfirm).toHaveBeenCalledTimes(1)
        expect(alertMocks.alertConfirm).toHaveBeenCalledWith(language.restoreOversizedAssetsConfirm(1, ['huge.png'], LIMIT))
        expect(writesAtPrompt).toBe(0)
        expect(lockCallsAtPrompt).toBe(0)
    })

    test('declining writes nothing, installs nothing and takes no lock', async () => {
        alertMocks.alertConfirm.mockImplementation(async () => false)
        const bytes = concatChunks([assetEntry('small.png', 16), assetEntry('huge.png', LIMIT + 10), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(forageSetItemMock).not.toHaveBeenCalled()
        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(acquireExclusiveStorageMigrationLockMock).not.toHaveBeenCalled()
    })

    test('continuing restores everything else in file order and reports the skipped asset under the size reason', async () => {
        const bytes = concatChunks([
            assetEntry('first.png', 16),
            assetEntry('huge.png', LIMIT + 10),
            assetEntry('last.png', 16),
            databaseEntry(),
        ])

        await loadBackupBytes(bytes)

        expect(writtenAssetKeys()).toEqual(['assets/first.png', 'assets/last.png'])
        expectBlockGenerationCommitted()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        expect(alertMocks.alertNormalWait).toHaveBeenCalledTimes(1)
        expect(alertMocks.alertNormalWait).toHaveBeenCalledWith(language.restoreAssetsSkippedTooLarge(1, ['huge.png'], LIMIT))
    })

    test('an asset exactly at the limit is not listed and is written', async () => {
        const bytes = concatChunks([assetEntry('exact.png', LIMIT), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(alertMocks.alertConfirm).not.toHaveBeenCalled()
        expect(writtenAssetKeys()).toEqual(['assets/exact.png'])
        expectBlockGenerationCommitted()
        expect(alertMocks.alertNormalWait).not.toHaveBeenCalled()
    })

    test('a cold unit whose JSON is over the limit restores and is not listed', async () => {
        const bytes = concatChunks([bigColdEntry(), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(alertMocks.alertConfirm).not.toHaveBeenCalled()
        expect(setColdStorageItemMock).toHaveBeenCalledTimes(1)
        expect(setColdStorageItemMock.mock.calls[0]).toEqual([COLD_UUID, expect.objectContaining({ message: [] })])
        expect(alertMocks.alertNormalWait).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('an oversized asset on a page that is not Node-served is written, with no question asked', async () => {
        platformBox.isNodeServer = false
        const bytes = concatChunks([assetEntry('huge.png', LIMIT + 10), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(alertMocks.alertConfirm).not.toHaveBeenCalled()
        expect(writtenAssetKeys()).toEqual(['assets/huge.png'])
        expectBlockGenerationCommitted()
    })
})

describe('a refusal by the server for an asset under the limit', () => {
    test('a 413 stops the restore with the too-large message and installs nothing', async () => {
        failingWrites.set('assets/small.png', new NodeHttpError(413, 'write'))
        const bytes = concatChunks([assetEntry('before.png', 16), assetEntry('small.png', 16), assetEntry('after.png', 16), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(shownErrors()).toEqual([language.restoreAssetRefusedTooLarge('small.png')])
        expect(writtenKeys()).toEqual(['assets/before.png'])
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    test('any other store error keeps the generic failure message', async () => {
        failingWrites.set('assets/small.png', new NodeHttpError(500, 'write'))
        const bytes = concatChunks([assetEntry('small.png', 16), databaseEntry()])

        await loadBackupBytes(bytes)

        expect(shownErrors()).toEqual(['Failed, Is file corrupted?'])
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })
})

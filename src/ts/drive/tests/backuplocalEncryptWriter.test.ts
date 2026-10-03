// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://risuai.xyz/"}

/**
 * MC-081, I3. The fork must never write an `encryption.risudat` marker into
 * a local backup, and never treat it as a plain asset -- regardless of the
 * page's origin. `SaveLocalBackup` and `SavePartialLocalBackup`
 * (`src/ts/drive/backuplocal.ts`) are driven for real, with `LocalWriter`
 * replaced by a spy on `writeBackup` so every entry name either function
 * writes can be inspected directly.
 *
 * This file's origin is pinned to `https://risuai.xyz/` via the per-file
 * `@vitest-environment-options` docblock: upstream's `SaveLocalBackup`
 * fetches a key and encrypts the database into this marker entry only on
 * that origin. This fork's writer must never write it, on this origin or
 * any other.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '../../storage/database.svelte'

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

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => {}),
}))

const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({} as unknown as Database)))

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

const writeBackupMock = vi.hoisted(() => vi.fn(async (_name: string, _data: Uint8Array) => {}))
const localWriterInitMock = vi.hoisted(() => vi.fn(async () => true))
const localWriterCloseMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock(import('../../globalApi.svelte'), () => ({
    LocalWriter: class {
        init = localWriterInitMock
        writeBackup = writeBackupMock
        close = localWriterCloseMock
    },
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    requiresFullEncoderReload: { state: false },
}) as unknown as typeof import('../../globalApi.svelte'))

// The assets are listed and read through the page's byte store; here it holds none.
vi.mock(import('../../storage/store/appStore'), async () => {
    const { appStoreModuleOver, forageOverMap } = await import('../../storage/tests/appStoreMock')
    return appStoreModuleOver(() => forageOverMap(new Map())) as unknown as typeof import('../../storage/store/appStore')
})

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertStore: { set: vi.fn() },
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../characterCards'), () => ({
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('../../characterCards'))

const encryptBufferMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => data.buffer))

vi.mock(import('../../util'), () => ({
    decryptBuffer: vi.fn(),
    encryptBuffer: encryptBufferMock,
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: vi.fn(() => null),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: vi.fn(() => false),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
}) as unknown as typeof import('../../stores.svelte'))

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup } from '../backuplocal'

const fetchMock = vi.hoisted(() => vi.fn())

beforeEach(() => {
    getDatabaseMock.mockClear()
    writeBackupMock.mockClear()
    localWriterInitMock.mockClear()
    localWriterCloseMock.mockClear()
    encryptBufferMock.mockClear()

    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => ({ json: async () => ({ key: 'k' }) }))
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

function writtenEntryNames(): unknown[] {
    return writeBackupMock.mock.calls.map((call) => call[0])
}

describe('a local backup never contains an account-sync encryption marker (I3)', () => {
    test('SaveLocalBackup never writes an encryption.risudat entry, even on risuai.xyz', async () => {
        expect(location.origin).toBe('https://risuai.xyz')

        await SaveLocalBackup()

        // A writer that returned early -- before ever writing the database
        // entry, let alone a marker -- would vacuously pass a bare
        // not.toContain('encryption.risudat') check.
        expect(writtenEntryNames()).not.toContain('encryption.risudat')
        expect(writtenEntryNames()).toContain('database.risudat')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('SavePartialLocalBackup never writes an encryption.risudat entry, even on risuai.xyz', async () => {
        expect(location.origin).toBe('https://risuai.xyz')

        await SavePartialLocalBackup()

        expect(writtenEntryNames()).not.toContain('encryption.risudat')
        expect(writtenEntryNames()).toContain('database.risudat')
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

// @vitest-environment happy-dom

/**
 * A page that runs from OPFS this time (the copy back into IndexedDB could
 * not run) is read-only for its session. `LoadLocalBackup`
 * (`src/ts/drive/backuplocal.ts`) refuses the `.bin` restore there once the
 * file is picked and before it streams or writes anything: no asset write, no
 * cold-storage write, no write of the restored profile, no `setDatabase`, no cross-tab lock,
 * and the read-only notice is shown. The same restore on any other page goes
 * on to write.
 *
 * The mocks follow `backuplocalEncryptedRefusal.test.ts`; a passing test here
 * says nothing about a real browser's OPFS.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '../../storage/database.svelte'
import { language } from 'src/lang'

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

const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array) => {}))
const acquireExclusiveStorageMigrationLockMock = vi.hoisted(() => vi.fn(async () => (async () => {})))

vi.mock(import('../../globalApi.svelte'), () => ({
    LocalWriter: class {},
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: forageSetItemMock,
    },
    requiresFullEncoderReload: { state: false },
    noteAssetWrittenThisPage: vi.fn(),
    dbWriteLock: { acquire: vi.fn(async () => vi.fn()) },
    acquireExclusiveStorageMigrationLock: acquireExclusiveStorageMigrationLockMock,
    locksSupported: true,
    tabPresenceLockAcquired: Promise.resolve(),
}) as unknown as typeof import('../../globalApi.svelte'))

const alertErrorMock = vi.hoisted(() => vi.fn())

vi.mock(import('../../alert'), () => ({
    alertStore: { set: vi.fn() },
    alertError: alertErrorMock,
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertMd: vi.fn(),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

const setColdStorageItemMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: () => null,
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: () => false,
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: setColdStorageItemMock,
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
}) as unknown as typeof import('../../stores.svelte'))

import { LoadLocalBackup } from '../backuplocal'
import { encodeRisuSaveLegacy } from '../../storage/risuSave'
import { forageStorage } from '../../globalApi.svelte'
import { injectAppStore } from '../../storage/store/appStore'
import { createForageBackedStore, type ForageLike } from '../../storage/tests/forageBackedStore'

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function chunk(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    out.set(u32le(nameBytes.length), 0)
    out.set(nameBytes, 4)
    out.set(u32le(data.length), 4 + nameBytes.length)
    out.set(data, 8 + nameBytes.length)
    return out
}

/** A restorable backup: one asset and the database. */
function backupBytes(): Uint8Array {
    const parts = [
        chunk('asset1.png', new Uint8Array([1, 2, 3, 4])),
        chunk('database.risudat', encodeRisuSaveLegacy({ characters: [] } as unknown as Database, 'noCompression')),
    ]
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    setDatabaseMock.mockClear()
    forageSetItemMock.mockClear()
    setColdStorageItemMock.mockClear()
    acquireExclusiveStorageMigrationLockMock.mockClear()
    alertErrorMock.mockClear()
    capturedInput = null
    const realCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ key: 'unused' }) })))
})

afterEach(() => {
    createElementSpy.mockRestore()
    vi.unstubAllGlobals()
})

async function restore(bytes: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput as HTMLInputElement | null
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

describe('the .bin restore on a page that runs from OPFS this time', () => {
    test('is refused with the read-only notice before it takes a lock or writes an asset, a unit, the restored profile or the page', async () => {
        injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'opfs-transitional')

        await restore(backupBytes())

        expect(alertErrorMock).toHaveBeenCalledWith(language.opfsReadOnlyNotice)
        expect(acquireExclusiveStorageMigrationLockMock).not.toHaveBeenCalled()
        expect(forageSetItemMock).not.toHaveBeenCalled()
        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    test('guard: the same restore on any other page goes on to write the asset', async () => {
        injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'indexeddb')

        await restore(backupBytes())

        expect(alertErrorMock).not.toHaveBeenCalledWith(language.opfsReadOnlyNotice)
        expect(forageSetItemMock.mock.calls.map((call) => call[0])).toContain('assets/asset1.png')
    })
})

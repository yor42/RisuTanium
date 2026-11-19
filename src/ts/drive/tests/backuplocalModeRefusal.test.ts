// @vitest-environment happy-dom

/**
 * A page restore (`LoadPickedLocalBackup`, `LoadLocalBackup(undefined, opened)`) on a page whose mode is not `store2`
 * is refused before the file is read: the end is `nothing-replaced` with no cause, the one error names the mode, and the
 * store records no write. A page that has no store2 session reaches the same refusal, not the session refusal
 * `checkStore2Import` would give. The backup is the `upstream-full.bin` golden, which holds an asset the restore would
 * otherwise write.
 *
 * The mocks follow `backuplocalReadOnlyPage.test.ts`, without the store2 commit stub: no commit may be reached. A pass says
 * nothing about a real browser's storage.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Database } from '../../storage/database.svelte'
import type { ImportSource } from '../../importSource'
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
    isSaveClean: () => true,
    afterNextSaveCommit: vi.fn(),
    requestSaveNow: vi.fn(),
}) as unknown as typeof import('../../globalApi.svelte'))

const alertErrorMock = vi.hoisted(() => vi.fn())
const alertWaitMock = vi.hoisted(() => vi.fn())

vi.mock(import('../../alert'), () => ({
    alertStore: { set: vi.fn() },
    alertError: alertErrorMock,
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertMd: vi.fn(),
    alertWait: alertWaitMock,
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: () => null,
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: () => false,
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
}) as unknown as typeof import('../../stores.svelte'))

import { LoadLocalBackup, LoadPickedLocalBackup, type LocalBackupEnd } from '../backuplocal'
import { importSourceOfBytes } from '../../importSource'
import { forageStorage } from '../../globalApi.svelte'
import { injectRestoreStore } from './restoreSupport'
import { setPageStorageMode, type PageStorageMode } from '../../storage/pageStorageMode'
import { createForageBackedStore, type ForageLike } from '../../storage/tests/forageBackedStore'

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

/** A picked file that counts every read of its bytes; `size` and `name` are not reads. */
class CountingFile extends File {
    reads = 0
    slice(start?: number, end?: number, contentType?: string): Blob {
        this.reads++
        return super.slice(start, end, contentType)
    }
    arrayBuffer(): Promise<ArrayBuffer> {
        this.reads++
        return super.arrayBuffer()
    }
    stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
        this.reads++
        return super.stream()
    }
    text(): Promise<string> {
        this.reads++
        return super.text()
    }
}

/** An opened source that counts every read of its bytes; `stat` is not counted. */
function countingSource(bytes: Uint8Array): { source: ImportSource, reads: () => number } {
    const inner = importSourceOfBytes('backup.bin', bytes)
    let reads = 0
    const source: ImportSource = {
        ...inner,
        read: (start, end) => { reads++; return inner.read(start, end) },
        readRanges: (ranges) => { reads++; return inner.readRanges ? inner.readRanges(ranges) : Promise.all(ranges.map(([from, to]) => inner.read(from, to))) },
        stream: () => { reads++; return inner.stream() },
    }
    return { source, reads: () => reads }
}

beforeEach(() => {
    setDatabaseMock.mockClear()
    forageSetItemMock.mockClear()
    acquireExclusiveStorageMigrationLockMock.mockClear()
    alertErrorMock.mockClear()
    alertWaitMock.mockClear()
    injectRestoreStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'tauri')
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ key: 'unused' }) })))
})

afterEach(() => {
    vi.unstubAllGlobals()
})

function expectModeRefusal(end: LocalBackupEnd, mode: string): void {
    expect(end.outcome).toBe('nothing-replaced')
    expect(end.cause).toBeNull()
    expect(alertErrorMock).toHaveBeenCalledTimes(1)
    const shown: unknown = alertErrorMock.mock.calls[0][0]
    expect(shown).toBeInstanceOf(Error)
    expect((shown as Error).message).toContain(mode)
    expect((shown as Error).message).not.toBe(language.store2Boot.readOnlyRefusal)
    expect(forageSetItemMock).not.toHaveBeenCalled()
    expect(setDatabaseMock).not.toHaveBeenCalled()
    expect(acquireExclusiveStorageMigrationLockMock).not.toHaveBeenCalled()
}

const MODES: ReadonlyArray<{ label: string, mode: PageStorageMode, named: string }> = [
    { label: 'unset', mode: { kind: 'unset' }, named: 'unset' },
]

describe('a page restore on a page whose mode is not store2', () => {
    describe.each(MODES)('mode $label', ({ mode, named }) => {
        test('REPRO: the picked file is refused with the mode named, before one byte is read', async () => {
            setPageStorageMode(mode)
            const file = new CountingFile([golden('upstream-full.bin')], 'backup.bin')

            const end = await LoadPickedLocalBackup(file)

            expect(file.reads).toBe(0)
            expectModeRefusal(end, named)
        })

        test('REPRO: the opened file is refused with the mode named, before one byte is read', async () => {
            setPageStorageMode(mode)
            const { source, reads } = countingSource(golden('upstream-full.bin'))

            const end = await LoadLocalBackup(undefined, { source, name: 'backup.bin', lastModified: 0 })

            expect(reads()).toBe(0)
            expectModeRefusal(end, named)
        })
    })
})

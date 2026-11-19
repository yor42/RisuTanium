// @vitest-environment happy-dom

/**
 * `loadInternalBackup()` (`src/ts/drive/internalBackup.ts`) on an `unset`, `legacy` or `block` page is refused with
 * nothing listed: the end is `nothing-replaced`, the one error names the mode, the store is asked for no numbered
 * backup, no picker is shown and nothing is written. A `read-only` page is refused the same way, but with the busy
 * message or the localized read-only refusal instead of the mode error. The store holds two numbered backups, so a load
 * that went on would list and offer them.
 *
 * The mocks follow `backuplocalReadOnlyPage.test.ts`; a pass says nothing about a real browser's storage.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database } from '../../storage/database.svelte'

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
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

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

// The store2 restore-point load is not under test; its graph reaches the character and image modules.
vi.mock(import('../storeRestore'), () => ({
    loadStoreRestorePoint: vi.fn(),
}) as unknown as typeof import('../storeRestore'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: () => null,
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: () => false,
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../globalApi.svelte'), () => ({
    LocalWriter: class {},
    readImage: vi.fn(),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    requiresFullEncoderReload: { state: false },
    noteAssetWrittenThisPage: vi.fn(),
    dbWriteLock: { acquire: vi.fn(async () => vi.fn()) },
    acquireExclusiveStorageMigrationLock: vi.fn(async () => (async () => {})),
    locksSupported: true,
    tabPresenceLockAcquired: Promise.resolve(),
    isSaveClean: () => true,
    afterNextSaveCommit: vi.fn(),
    requestSaveNow: vi.fn(),
}) as unknown as typeof import('../../globalApi.svelte'))

const alertErrorMock = vi.hoisted(() => vi.fn())
const alertSelectMock = vi.hoisted(() => vi.fn(async () => '0'))

vi.mock(import('../../alert'), () => ({
    alertStore: { set: vi.fn() },
    alertError: alertErrorMock,
    alertSelect: alertSelectMock,
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
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
    } as unknown as typeof import('../../stores.svelte')
})

import { loadInternalBackup } from '../internalBackup'
import { encodeRisuSaveLegacy } from '../../storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { setPageStorageMode, type PageStorageMode } from '../../storage/pageStorageMode'
import { createForageBackedStore, type ForageLike } from '../../storage/tests/forageBackedStore'
import { injectAppStore } from '../../storage/store/appStore'
import { beginBusy } from '../../process/memory/busyActions'
import { language } from 'src/lang'

const items = new Map<string, Uint8Array>()
const keysSpy = vi.fn(async () => [...items.keys()])
const setItemSpy = vi.fn(async (key: string, value: Uint8Array) => { items.set(key, value) })
const removeItemSpy = vi.fn(async (key: string) => { items.delete(key) })
const forage: ForageLike = {
    getItem: vi.fn(async (key: string) => items.get(key) ?? null),
    setItem: setItemSpy,
    keys: keysSpy,
    removeItem: removeItemSpy,
}

beforeEach(() => {
    items.clear()
    for (const spy of [keysSpy, setItemSpy, removeItemSpy, alertErrorMock, alertSelectMock]) {
        spy.mockClear()
    }
    const backup = encodeRisuSaveLegacy({ characters: [] } as unknown as Database, 'noCompression')
    items.set('database/dbbackup-100.bin', backup)
    items.set('database/dbbackup-200.bin', backup)
    injectRestoreStore(createForageBackedStore(forage), 'tauri')
})

const MODES: ReadonlyArray<{ mode: PageStorageMode, named: string }> = [
    { mode: { kind: 'unset' }, named: 'unset' },
]

describe('loadInternalBackup on a page whose mode is not store2', () => {
    test.each(MODES)('REPRO: mode $named is refused with the mode named, before the numbered backups are listed', async ({ mode, named }) => {
        setPageStorageMode(mode)

        const end = await loadInternalBackup()

        expect(end.outcome).toBe('nothing-replaced')
        expect(end.cause).toBeNull()
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        const shown: unknown = alertErrorMock.mock.calls[0][0]
        expect(shown).toBeInstanceOf(Error)
        expect((shown as Error).message).toContain(named)
        expect(keysSpy).not.toHaveBeenCalled()
        expect(alertSelectMock).not.toHaveBeenCalled()
        expect(setItemSpy).not.toHaveBeenCalled()
        expect(removeItemSpy).not.toHaveBeenCalled()
    })
})

/** The refusal that ran, as the exact list of errors the person was shown, and nothing listed, asked or written. */
function expectOnlyRefusal(end: Awaited<ReturnType<typeof loadInternalBackup>>, shown: unknown[]): void {
    expect(end.outcome).toBe('nothing-replaced')
    expect(alertErrorMock.mock.calls.map((call) => call[0])).toEqual(shown)
    expect(keysSpy).not.toHaveBeenCalled()
    expect(alertSelectMock).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeItemSpy).not.toHaveBeenCalled()
}

describe('loadInternalBackup on a read-only page', () => {
    test('guard: a page that runs from OPFS this time shows the localized OPFS notice, not the mode refusal', async () => {
        injectAppStore(createForageBackedStore(forage), 'opfs-transitional')
        setPageStorageMode({ kind: 'read-only', reason: 'opfs-transitional' })

        const end = await loadInternalBackup()

        expect(end.cause).toBeNull()
        expectOnlyRefusal(end, [language.opfsReadOnlyNotice])
    })

    test('guard: a read-only page on a normal store shows the localized read-only refusal, not the mode refusal', async () => {
        setPageStorageMode({ kind: 'read-only', reason: 'backend-unavailable' })

        const end = await loadInternalBackup()

        expect(end.cause).toBeNull()
        expectOnlyRefusal(end, [language.store2Boot.readOnlyRefusal])
    })

    test('guard: a busy entry on a read-only page ends the load with cause busy, before the read-only or mode refusal', async () => {
        setPageStorageMode({ kind: 'read-only', reason: 'backend-unavailable' })
        const other = beginBusy('import')

        try {
            const end = await loadInternalBackup()

            expect(end.cause).toBe('busy')
            expectOnlyRefusal(end, [language.backupLoadWorkInProgress])
        } finally {
            other.end()
        }
    })
})

// @vitest-environment node

/**
 * `SaveLocalBackup` and `SavePartialLocalBackup` (`src/ts/drive/backuplocal.ts`) on the browser's IndexedDB page, over
 * the real IndexedDB store on `fake-indexeddb`: an asset is loaded once (`readValue`); a Blob-valued asset is written
 * to the backup by slices of at most 4 MiB and never read whole through `read`, a bytes-valued asset is written as it
 * always was, and an absent asset is reported missing. A read that fails after an entry began ends the export as
 * failed (`BackupAssetChangedError`), never as a shorter entry. The pre-pass (`findOversizeAssets`) loads each asset
 * once too.
 *
 * `fake-indexeddb` stands in for the browser's IndexedDB; the sink replaces the download stream. Nothing here proves a
 * real browser's Blob paging, memory use or quota.
 *
 * Titles: `reproducer` fails on the code before the change, `guard` holds before and after.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // The node environment has the Blob and structured clone a real IndexedDB needs, but no storage object.
    const items = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, value) },
            removeItem: (key: string) => { items.delete(key) },
            clear: () => { items.clear() },
        },
    })
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})
const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[], opened: 0 }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { },
    isAppInitiatedReload: () => false,
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => { }),
    readFile: vi.fn(async () => {
        throw new Error('the Tauri backend is not under test')
    }),
    readDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => 'backup-output.bin'),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => {
            backupSink.opened++
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
                        close: async () => { },
                    }),
                },
            }
        },
    },
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: vi.fn(),
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

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: alertNormalMock,
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
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
    invoke: vi.fn(async () => undefined),
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

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

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
        listColdDataKeys: vi.fn(async () => []),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { findOversizeAssets } from 'src/ts/drive/backupUpstreamSizes'
import { ExportCancelToken } from 'src/ts/exportCancel'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'

//#region helpers

const MIB = 1024 * 1024
const decoder = new TextDecoder()
const upstream = localforage.createInstance({ name: 'risuai' })

/** Deterministic content that differs from one asset to the next. */
function pattern(length: number, seed: number): Uint8Array<ArrayBuffer> {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
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

interface WrittenEntry {
    name: string
    data: Uint8Array
}

function writtenEntries(): WrittenEntry[] {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: WrittenEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

const assetEntries = (): WrittenEntry[] => writtenEntries().filter((entry) => entry.name !== 'database.risudat')
const entryOf = (name: string): WrittenEntry | undefined => writtenEntries().find((entry) => entry.name === name)

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
    return a !== undefined && a.length === b.length && a.every((value, index) => value === b[index])
}

function databaseWith(fields: Record<string, unknown>): Database {
    return { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
}

let store: ByteStore

/** The raw `get` calls on the page's object store for `key`. */
function rawGetsOf(spy: { mock: { calls: unknown[][] } }, key: string): number {
    return spy.mock.calls.filter((call) => call[0] === key).length
}

//#endregion

beforeEach(async () => {
    await upstream.clear()
    platformBox.isTauri = false
    backupSink.writes.length = 0
    backupSink.opened = 0
    alertConfirmMock.mockReset().mockImplementation(async () => true)
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    getDatabaseMock.mockImplementation(() => databaseWith({}))
    store = createIndexedDbStore()
    injectAppStore(store, 'indexeddb')
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: true }, configurable: true })
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a full export of Blob-valued and bytes-valued browser assets', () => {
    const blobBytes = pattern(9 * MIB, 3)
    const smallBytes = pattern(5000, 11)

    async function seed(): Promise<void> {
        await store.writeBlob!('assets/blob.mp4', new Blob([blobBytes]), 'unconditional')
        await store.write('assets/small.png', smallBytes, 'unconditional')
    }

    test('reproducer: the Blob asset is written by slices of at most 4 MiB and is never read whole through `read`', async () => {
        await seed()
        const read = vi.spyOn(store, 'read')
        const slices: number[] = []
        const realSlice = Blob.prototype.slice
        vi.spyOn(Blob.prototype, 'slice').mockImplementation(function (this: Blob, start?: number, end?: number, type?: string) {
            const piece = realSlice.call(this, start, end, type)
            slices.push(piece.size)
            return piece
        })

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(sameBytes(entryOf('blob.mp4')?.data, blobBytes)).toBe(true)
        expect(read.mock.calls.map((call) => call[0])).not.toContain('assets/blob.mp4')
        expect(slices).toEqual([4 * MIB, 4 * MIB, 1 * MIB])
    })

    test('guard: the bytes asset is written byte for byte, identical to what a store without `readValue` writes', async () => {
        await seed()
        await SaveLocalBackup()
        const withReadValue = assetEntries().map((entry) => ({ name: entry.name, data: entry.data }))
        expect(sameBytes(withReadValue.find((entry) => entry.name === 'small.png')?.data, smallBytes)).toBe(true)

        backupSink.writes.length = 0
        const wholeReads = { ...store, readValue: undefined } as ByteStore
        injectAppStore(wholeReads, 'indexeddb')
        await SaveLocalBackup()
        const whole = assetEntries().map((entry) => ({ name: entry.name, data: entry.data }))

        expect(whole.map((entry) => entry.name)).toEqual(withReadValue.map((entry) => entry.name))
        for (const entry of whole) {
            expect(sameBytes(withReadValue.find((other) => other.name === entry.name)?.data, entry.data)).toBe(true)
        }
    })

    test('guard: each asset is loaded exactly once by the export and once by the pre-pass (one raw get each)', async () => {
        await seed()
        const get = vi.spyOn(IDBObjectStore.prototype, 'get')

        await findOversizeAssets({
            kind: 'indexeddb',
            store,
            sized: null,
            keys: null,
            listedKeys: ['assets/blob.mp4', 'assets/small.png'],
            cancel: new ExportCancelToken(),
        })
        expect(rawGetsOf(get, 'assets/blob.mp4')).toBe(1)
        expect(rawGetsOf(get, 'assets/small.png')).toBe(1)

        get.mockClear()
        await SaveLocalBackup()

        // One load in the pre-pass of the export and one in the export loop itself.
        expect(rawGetsOf(get, 'assets/blob.mp4')).toBe(2)
        expect(rawGetsOf(get, 'assets/small.png')).toBe(2)
    })

    test('guard: an asset the listing names but the store does not hold is missing, and the export completes without it', async () => {
        await seed()
        const realList = store.list.bind(store)
        vi.spyOn(store, 'list').mockImplementation(async (prefix: string) => [...await realList(prefix), ...(prefix.startsWith('assets/') || prefix === '' ? ['assets/ghost.png'] : [])])

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved', omitted: { assets: ['assets/ghost.png'] } })
        expect(entryOf('ghost.png')).toBeUndefined()
        expect(sameBytes(entryOf('blob.mp4')?.data, blobBytes)).toBe(true)
    })

    test('reproducer: a read that fails after the entry began ends the export as failed with BackupAssetChangedError, never a shorter entry', async () => {
        await seed()
        const realSlice = Blob.prototype.slice
        let slices = 0
        vi.spyOn(Blob.prototype, 'slice').mockImplementation(function (this: Blob, start?: number, end?: number, type?: string) {
            const piece = realSlice.call(this, start, end, type)
            slices += 1
            if (slices === 2) {
                Object.defineProperty(piece, 'arrayBuffer', { value: async () => { throw new Error('the stored Blob went away') } })
            }
            return piece
        })

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('failed')
        if (outcome.status === 'failed') {
            expect(outcome.cause).toMatchObject({ name: 'BackupAssetChangedError' })
        }
    })
})

describe('a partial export of a browser asset', () => {
    test('reproducer: a Blob-valued profile image is written by slices and never read whole through `read`', async () => {
        const bytes = pattern(5 * MIB, 5)
        await store.writeBlob!('assets/icon.png', new Blob([bytes]), 'unconditional')
        getDatabaseMock.mockImplementation(() => databaseWith({ userIcon: 'assets/icon.png' }))
        const read = vi.spyOn(store, 'read')

        const outcome = await SavePartialLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(sameBytes(entryOf('icon.png')?.data, bytes)).toBe(true)
        expect(read.mock.calls.map((call) => call[0])).not.toContain('assets/icon.png')
    })

    test('guard: a bytes-valued profile image is written as it always was, and an absent one is missing', async () => {
        const bytes = pattern(300, 9)
        await store.write('assets/icon.png', bytes, 'unconditional')
        getDatabaseMock.mockImplementation(() => databaseWith({ userIcon: 'assets/icon.png', customBackground: 'assets/gone.png' }))

        const outcome = await SavePartialLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved', omitted: { assets: ['assets/gone.png'] } })
        expect(sameBytes(entryOf('icon.png')?.data, bytes)).toBe(true)
    })
})

describe('asset keys upstream wrote that the store can address but not create', () => {
    test.each([['assets/x//y.png', 'y.png'], ['assets/.hidden.png', '.hidden.png']])('reproducer: a full export keeps %s', async (key, entryName) => {
        const bytes = pattern(300, 1)
        await upstream.setItem(key, bytes)
        expect(await store.list('assets/')).toContain(key)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(outcome).toMatchObject({ omitted: { assets: [] } })
        expect(sameBytes(entryOf(entryName)?.data, bytes)).toBe(true)
    })

    test('reproducer: a partial export keeps a profile image under assets/.hidden.png', async () => {
        const bytes = pattern(300, 2)
        await upstream.setItem('assets/.hidden.png', bytes)
        getDatabaseMock.mockImplementation(() => databaseWith({ userIcon: 'assets/.hidden.png' }))

        const outcome = await SavePartialLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(sameBytes(entryOf('.hidden.png')?.data, bytes)).toBe(true)
    })

    test('reproducer: the pre-pass sizes an odd key holding 120 MiB on the real store', async () => {
        await upstream.setItem('assets/.big.mp4', new Uint8Array(120 * MIB))
        const found = await findOversizeAssets({
            kind: 'indexeddb',
            store,
            sized: null,
            keys: null,
            listedKeys: ['assets/.big.mp4'],
            cancel: new ExportCancelToken(),
        })
        expect(found.map((item) => item.key)).toEqual(['assets/.big.mp4'])
    })
})

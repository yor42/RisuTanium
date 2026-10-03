// @vitest-environment happy-dom

/**
 * A restore of a local backup tells the main-file record exactly the bytes it
 * wrote to `database/database.bin`, and tells it nothing when that write
 * fails, so the record never claims a file state storage does not hold.
 *
 * `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) runs for real with the
 * real `globalApi.svelte.ts`; the storage backend, the Tauri file system, the
 * dialogs and the main-file record are mocked. A passing test here is not
 * evidence about a native Tauri backend or a real browser storage backend.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation:
    // without it restore takes its no-Web-Locks branch and never waits on
    // another tab, which is outside what this file exercises.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})
const BACKUP_PATH = vi.hoisted(() => 'backup-output.bin')

interface DirEntryFixture {
    name: string
    isFile: boolean
    isDirectory: boolean
    isSymlink: boolean
}

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs())
const readDirMock = vi.hoisted(() => vi.fn(async (_path: string, _options?: unknown): Promise<DirEntryFixture[]> => []))
const readFileMock = vi.hoisted(() => vi.fn(async (_path: string, _options?: unknown): Promise<Uint8Array | undefined> => new Uint8Array()))
const writeFileMock = vi.hoisted(() => vi.fn(async (path: string, data: Uint8Array, options?: { createNew?: boolean, baseDir?: number }): Promise<void> => {
    if (path === BACKUP_PATH) {
        backupSink.writes.push(data.slice())
        return
    }
    await fakeFs.module.writeFile(path, data, options)
}))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const setColdStorageItemMock = vi.hoisted(() => vi.fn(async () => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const noteMainFileBytesMock = vi.hoisted(() => vi.fn((_bytes: Uint8Array): void => { }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: writeFileMock,
    readFile: readFileMock,
    readDir: readDirMock,
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    remove: fakeFs.module.remove,
    rename: fakeFs.module.rename,
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => BACKUP_PATH),
}))

vi.mock('streamsaver', () => ({
    default: {
        createWriteStream: () => ({
            getWriter: () => ({
                write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
                close: async () => { },
            }),
        }),
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

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: alertNormalMock,
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
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
        getItem = forageGetItemMock
        setItem = forageSetItemMock
        keys = forageKeysMock
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
    // The real, dependency-light name matcher: restore must classify a
    // cold-storage entry exactly as production does.
    const { getColdStorageBackupKey } = await import('src/ts/process/coldstorageData')
    return {
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        getColdStorageBackupKey,
        getColdStorageItem: vi.fn(async () => null),
        isColdStorageBackupData: vi.fn(() => true),
        listColdDataKeys: vi.fn(async () => []),
        setColdStorageItem: setColdStorageItemMock,
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

vi.mock(import('src/ts/storage/mainFileRecord'), () => ({
    noteMainFileBytes: noteMainFileBytesMock,
    resetMainFileRecordForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

//#endregion

import { LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { language } from 'src/lang'
import { injectAppStore, readMainFile } from 'src/ts/storage/store/appStore'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { FakeNodeServer } from 'src/ts/storage/tests/manualCleanupHarness'
import { StoreVersionConflictError } from 'src/ts/storage/store/errors'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'

//#region helpers

const encoder = new TextEncoder()
const MAIN_FILE = 'database/database.bin'

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

/** One `[nameLength][name][dataLength][data]` chunk, matching LoadLocalBackup's reader. */
function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = encoder.encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    let offset = 0
    out.set(u32le(nameBuf.length), offset); offset += 4
    out.set(nameBuf, offset); offset += nameBuf.length
    out.set(u32le(data.length), offset); offset += 4
    out.set(data, offset)
    return out
}

/** Narrows a `Uint8Array<ArrayBufferLike>` to the `Uint8Array<ArrayBuffer>` shape `BlobPart` requires. */
function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function databaseWith(fields: Record<string, unknown>): Database {
    return { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
}

function backupWithDatabase(marker: string): Uint8Array {
    const dbData = encodeRisuSaveLegacy(databaseWith({ mainPrompt: marker }), 'noCompression')
    return buildChunk('database.risudat', dbData)
}

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

/** Drives LoadLocalBackup() with `bytes` as the selected file's content, and awaits its onchange handler. */
async function loadBackupBytes(bytes: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    const file = new File([asBlobPart(bytes)], 'backup.bin')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

/**
 * Every body the restore put into `database/database.bin` on the current
 * platform. On Tauri a body counts when its file was the source of a rename to
 * the main path (or it was written to that path directly).
 */
function mainFileWrites(): Uint8Array[] {
    if (platformBox.isTauri) {
        const renamedSources = new Set(fakeFs.renameLog.filter((entry) => entry.to.replace(/^\.\//, '') === MAIN_FILE).map((entry) => entry.from))
        return fakeFs.writeLog
            .filter((entry) => entry.path === MAIN_FILE || renamedSources.has(entry.path))
            .map((entry) => entry.data)
    }
    return forageSetItemMock.mock.calls.filter((c) => c[0] === MAIN_FILE).map((c) => c[1])
}

function hex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Makes the write of the restored main file reject on the current platform.
 * On Tauri the fault fires on any write, whatever path it is given, and the
 * returned handle counts its firings; on web it returns `undefined`.
 */
function failMainFileWrite() {
    if (platformBox.isTauri) {
        return fakeFs.failWritesOf(() => true)
    }
    forageSetItemMock.mockImplementation(async (key: string) => {
        if (key === MAIN_FILE) {
            throw new Error('write failed')
        }
    })
    return undefined
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    readDirMock.mockReset().mockImplementation(async () => [])
    readFileMock.mockReset().mockImplementation(async () => new Uint8Array())
    fakeFs.reset()
    writeFileMock.mockClear()
    forageKeysMock.mockReset().mockImplementation(async () => [])
    forageGetItemMock.mockReset().mockImplementation(async () => null)
    forageSetItemMock.mockReset().mockImplementation(async () => { })
    // The web build's byte store is the storage-object model above; a Tauri
    // test switches to the real desktop store over the file system model.
    injectAppStore(createForageBackedStore({
        getItem: forageGetItemMock,
        setItem: forageSetItemMock,
        keys: forageKeysMock,
        removeItem: async () => { },
    }))
    setColdStorageItemMock.mockClear()
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    noteMainFileBytesMock.mockClear()
    getDatabaseMock.mockImplementation(() => databaseWith({}))

    // A successful restore keeps the database write lock closed for the rest
    // of the page's life, so each restore in this file takes a private release.
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })

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
    dbWriteLockSpy.mockRestore()
})

for (const platform of ['web', 'tauri'] as const) {
    describe(`restoring a local backup on ${platform}`, () => {
        beforeEach(() => {
            platformBox.isTauri = platform === 'tauri'
            if (platform === 'tauri') {
                injectAppStore(null)
            }
        })

        test('the main-file record receives exactly the bytes written to database.bin', async () => {
            await loadBackupBytes(backupWithDatabase(`restored-${platform}`))

            const writes = mainFileWrites()
            expect(writes).toHaveLength(1)
            expect(noteMainFileBytesMock).toHaveBeenCalledTimes(1)
            expect(hex(noteMainFileBytesMock.mock.calls[0][0])).toBe(hex(writes[0]))
        })

        test('guard: a failed write of database.bin does not reach the main-file record', async () => {
            const fault = failMainFileWrite()

            await loadBackupBytes(backupWithDatabase(`failed-${platform}`)).catch(() => { })

            if (fault) {
                expect(fault.fired).toBe(1)
            } else {
                expect(mainFileWrites().length).toBeGreaterThan(0)
            }
            expect(noteMainFileBytesMock).not.toHaveBeenCalled()
        })
    })
}

describe('restoring a local backup when the store refuses the main-file write with a version conflict', () => {
    test('reports the restore as failed and tells the main-file record nothing', async () => {
        forageSetItemMock.mockImplementation(async (key: string) => {
            if (key === MAIN_FILE) {
                throw new StoreVersionConflictError(MAIN_FILE, 7)
            }
        })

        await loadBackupBytes(backupWithDatabase('refused-by-conflict'))

        expect(alertErrorMock).toHaveBeenCalledWith(language.restoreWriteFailed)
        expect(noteMainFileBytesMock).not.toHaveBeenCalled()
    })
})

describe('restoring a local backup on the real Node store over the server stand-in', () => {
    async function nodeWorld() {
        const server = new FakeNodeServer()
        injectAppStore(createNodeHttpStore({ authHeader: async () => 'token', fetch: server.fetch }))
        server.seed(MAIN_FILE, encoder.encode('live-main-file-bytes'))
        // The page's boot read: it takes the version the restore's write presents.
        const read = await readMainFile()
        return { server, readVersion: read.version }
    }

    function mainRequests(server: FakeNodeServer) {
        return server.requestsTo('/api/write').filter((request) => Buffer.from(request.headers['file-path'], 'hex').toString('utf-8') === MAIN_FILE)
    }

    test('the main-file write presents the version the page read and lands the restored bytes', async () => {
        const { server, readVersion } = await nodeWorld()

        await loadBackupBytes(backupWithDatabase('restored-on-node'))

        expect(mainRequests(server)).toHaveLength(1)
        expect(mainRequests(server)[0].headers['if-match-revision']).toBe(String(readVersion))
        expect(noteMainFileBytesMock).toHaveBeenCalledTimes(1)
        expect(hex(server.files.get(MAIN_FILE)!.bytes)).toBe(hex(noteMainFileBytesMock.mock.calls[0][0]))
    })

    test('after another device saved the main file the write is refused with the restore-failed message and nothing is written', async () => {
        const { server } = await nodeWorld()
        const peerFile = encoder.encode('saved by another device')
        server.peerWrite(MAIN_FILE, peerFile)

        await loadBackupBytes(backupWithDatabase('refused-on-node'))

        expect(alertErrorMock).toHaveBeenCalledWith(language.restoreWriteFailed)
        expect(hex(server.files.get(MAIN_FILE)!.bytes)).toBe(hex(peerFile))
        expect(noteMainFileBytesMock).not.toHaveBeenCalled()
    })
})

describe('restoring a local backup on tauri replaces the main file atomically', () => {
    const OLD_MAIN = encoder.encode('old-main-file-bytes')

    beforeEach(() => {
        platformBox.isTauri = true
        injectAppStore(null)
        fakeFs.files.set(MAIN_FILE, OLD_MAIN.slice())
    })

    test('a write that fails part-way leaves the old main file byte-identical and reports the restore as failed', async () => {
        const fault = fakeFs.failWritesOf(() => true)

        await loadBackupBytes(backupWithDatabase('restore-fails'))

        expect(fault.fired).toBe(1)
        expect(hex(fakeFs.files.get(MAIN_FILE)!)).toBe(hex(OLD_MAIN))
        expect(alertErrorMock).toHaveBeenCalledWith(language.restoreWriteFailed)
        expect(noteMainFileBytesMock).not.toHaveBeenCalled()
        expect(fakeFs.listing('database')).toEqual(['database.bin'])
    })

    test('a successful write leaves the new bytes at the main path, no temp file, and never opens the main path for writing', async () => {
        await loadBackupBytes(backupWithDatabase('restore-succeeds'))

        const noted = noteMainFileBytesMock.mock.calls[0][0]
        expect(hex(fakeFs.files.get(MAIN_FILE)!)).toBe(hex(noted))
        expect(hex(noted)).not.toBe(hex(OLD_MAIN))
        expect(fakeFs.listing('database')).toEqual(['database.bin'])
        expect(fakeFs.writesTo(MAIN_FILE)).toHaveLength(0)
    })
})

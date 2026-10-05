// @vitest-environment happy-dom

/**
 * A local backup carries every asset the profile owns, whatever its file
 * extension: the full backup writes every key under `assets/` (web) and every
 * file in the `assets` directory (Tauri); the partial backup writes every
 * referenced asset. Restore stores every asset entry under `assets/<name>`
 * without looking at the extension.
 *
 * `SaveLocalBackup`, `SavePartialLocalBackup` and `LoadLocalBackup`
 * (`src/ts/drive/backuplocal.ts`) run for real together with the REAL
 * `LocalWriter` from `src/ts/globalApi.svelte.ts`. Only its sinks are
 * replaced: `streamsaver` (web) and `@tauri-apps/plugin-fs` `writeFile`
 * (Tauri) capture the bytes the writer emits, so the assertions read real
 * `[nameLength][name][dataLength][data]` entries. The assets go through the
 * page's byte store: the real desktop store over the in-memory file system of
 * `tauriFsFake.ts` on Tauri, and a store over a key/value mock on the web.
 * Every dialog is mocked; a passing test here is not evidence about a native
 * Tauri backend or a real browser storage backend.
 *
 * Titles say what a test pins: `guard` tests hold before and after the assets
 * moved behind the byte store, `reproducer` tests fail against the code that
 * read the asset directory itself, and `new behaviour` tests assert what only
 * the store-based export and restore do.
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

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
/** The Tauri file system: the desktop store runs for real over this in-memory model. */
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
/** Paths whose read the plugin answers with no data at all. */
const emptyReads = vi.hoisted(() => new Set<string>())
/** A path relative to AppData: the byte store addresses every key with a leading `./`. */
const bare = vi.hoisted(() => (path: string): string => path.replace(/^\.\//, ''))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
/** What the web storage object holds. */
const webFiles = vi.hoisted(() => new Map<string, Uint8Array>())
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const setColdStorageItemMock = vi.hoisted(() => vi.fn(async () => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertNormalWaitMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<void> => { }))
/** Whether the page was marked as about to reload itself; the real mark expires on a timer, which a test cannot reset. */
const reloadMark = vi.hoisted(() => ({ marked: false }))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { reloadMark.marked = true },
    isAppInitiatedReload: () => reloadMark.marked,
}) as unknown as typeof import('src/ts/reloadGuard'))

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
    ...fakeFs.module,
    // The backup file the writer saves is a sink, not a file of the model.
    writeFile: async (path: string, data: Uint8Array, options?: { createNew?: boolean, baseDir?: number }) => {
        if (path === BACKUP_PATH) {
            backupSink.writes.push(data.slice())
            return
        }
        await fakeFs.module.writeFile(path, data, options)
    },
    readFile: async (path: string) => {
        if (emptyReads.has(bare(path))) {
            return undefined
        }
        return await fakeFs.module.readFile(path)
    },
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
    alertNormalWait: alertNormalWaitMock,
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
    invoke: fakeFs.invoke,
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

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup, LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { LocalWriter, dbWriteLock, wasAssetWrittenThisPage } from 'src/ts/globalApi.svelte'
import { alertStore } from 'src/ts/alert'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { createForageBackedStore, createSwitchedStore } from 'src/ts/storage/tests/forageBackedStore'

//#region helpers

const encoder = new TextEncoder()

/** The distinct, recognisable bytes a fixture stores under `name`. */
function bytesFor(name: string): Uint8Array {
    return encoder.encode(`content-of:${name}`)
}

function hex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

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

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** Narrows a `Uint8Array<ArrayBufferLike>` to the `Uint8Array<ArrayBuffer>` shape `BlobPart` requires. */
function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

interface WrittenEntry {
    name: string
    declaredLength: number
    /** The entry body, or `null` when the sink holds fewer bytes than the header declares. */
    data: Uint8Array | null
}

/** Parses the entries the real `LocalWriter` emitted into the sink, tolerating a header whose declared length exceeds what follows. */
function writtenEntries(): WrittenEntry[] {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: WrittenEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        if (offset + 4 > bytes.length) {
            break
        }
        const declaredLength = view.getUint32(offset, true)
        offset += 4
        if (offset + declaredLength > bytes.length) {
            entries.push({ name, declaredLength, data: null })
            break
        }
        entries.push({ name, declaredLength, data: bytes.slice(offset, offset + declaredLength) })
        offset += declaredLength
    }
    return entries
}

/** Entry name -> hex of its bytes, for every entry except the database. */
function writtenAssets(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const entry of writtenEntries()) {
        if (entry.name !== 'database.risudat' && entry.data) {
            out[entry.name] = hex(entry.data)
        }
    }
    return out
}

function expectedAssets(names: string[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const name of names) {
        out[name] = hex(bytesFor(name))
    }
    return out
}

function sortedRecord(record: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

/** A directory under `assets/`, which holds no value. */
function plantDirectory(name: string) {
    fakeFs.directories.add(`assets/${name}`)
}

/** A link to a file, as the plugin reports one: neither a file nor a directory, and followed by `exists` and `readFile`. */
function plantFileLink(name: string) {
    fakeFs.plantSymlink(`assets/${name}`, { kind: 'file', data: bytesFor(name) })
}

/** Makes the read of `assets/<name>` reject and serves every other path as before. */
function failReadOf(path: string) {
    fakeFs.failReadFiles('Access is denied. (os error 5)', (requested) => requested === path)
}

/** Every path a file read was given, relative to AppData. */
function readPaths(): string[] {
    return fakeFs.calls.filter((call) => call.op === 'readFile').map((call) => bare(call.path))
}

/** Serves each `assets/<name>` from `bytesFor`, on both the web storage mock and the Tauri file model. */
function serveAssets(names: string[]) {
    forageKeysMock.mockImplementation(async () => names.map((n) => `assets/${n}`))
    forageGetItemMock.mockImplementation(async (key) => {
        const name = key.replace(/^assets\//, '')
        return names.includes(name) ? bytesFor(name) : null
    })
    for (const name of names) {
        fakeFs.plant(`assets/${name}`, bytesFor(name))
    }
}

/** Runs a save and returns what it threw, or `null` when it completed. */
async function outcomeOf(run: () => Promise<void>): Promise<unknown> {
    return run().then(() => null, (error: unknown) => error)
}

function databaseWith(fields: Record<string, unknown>): Database {
    return { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
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

/** Asset writes a restore performed, by name under `assets/`, as hex; the database key is excluded. */
function restoredAssets(): Record<string, string> {
    const out: Record<string, string> = {}
    const calls: [string, Uint8Array][] = platformBox.isTauri
        ? Array.from(fakeFs.files.entries())
        : forageSetItemMock.mock.calls.map((c) => [c[0], c[1]])
    for (const [path, data] of calls) {
        if (path.startsWith('assets/')) {
            out[path] = hex(data)
        }
    }
    return out
}

function withPrefix(record: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(record).map(([name, value]) => [`assets/${name}`, value]))
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    fakeFs.reset()
    fakeFs.directories.add('assets')
    emptyReads.clear()
    forageKeysMock.mockClear()
    forageGetItemMock.mockClear()
    forageSetItemMock.mockClear()
    setColdStorageItemMock.mockClear()
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    alertNormalWaitMock.mockReset().mockImplementation(async () => { })
    reloadMark.marked = false
    webFiles.clear()
    forageKeysMock.mockImplementation(async () => Array.from(webFiles.keys()))
    forageGetItemMock.mockImplementation(async (key) => webFiles.get(key) ?? null)
    forageSetItemMock.mockImplementation(async (key, data) => { webFiles.set(key, data) })
    // The page's byte store follows the platform model of each test: the
    // storage-object model on the web, the desktop store over the file model on Tauri.
    const webStore = createForageBackedStore({
        getItem: forageGetItemMock,
        setItem: forageSetItemMock,
        keys: forageKeysMock,
        removeItem: async () => { },
    })
    const tauriStore = createTauriFilesStore({ platform: 'posix' })
    injectRestoreStore(createSwitchedStore(() => platformBox.isTauri ? tauriStore : webStore))
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

const ASSET_NAMES = ['a.png', 'b.mp3', 'c.webp', 'd.jpg', 'e.mp4', 'F.PNG']

describe('a full backup on the web writes every asset key whatever its extension', () => {
    beforeEach(() => {
        serveAssets(ASSET_NAMES)
        forageKeysMock.mockImplementation(async () => [
            ...ASSET_NAMES.map((n) => `assets/${n}`),
            'database/database.bin',
            'database/dbbackup-1.bin',
            'remotes/x.bin',
            'remotes/x.meta',
            'migrated',
        ])
        forageGetItemMock.mockImplementation(async (key) => bytesFor(key))
    })

    test('writes png, mp3, webp, jpg, mp4 and upper-case PNG assets under their bare names with their own bytes', async () => {
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(
            Object.fromEntries(ASSET_NAMES.map((n) => [n, hex(bytesFor(`assets/${n}`))]))
        ))
    })

    test('guard: keys outside assets/ are not written as asset entries', async () => {
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const names = writtenEntries().map((e) => e.name)
        for (const outside of ['database.bin', 'dbbackup-1.bin', 'x.bin', 'x.meta', 'migrated']) {
            expect(names).not.toContain(outside)
        }
    })

    test('guard: the database is still written as database.risudat', async () => {
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const names = writtenEntries().map((e) => e.name)
        expect(names.filter((n) => n === 'database.risudat')).toHaveLength(1)
    })
})

describe('a full backup on Tauri writes every file in the assets directory whatever its extension', () => {
    beforeEach(() => {
        platformBox.isTauri = true
    })

    test('writes png, mp3, webp, jpg, mp4 and upper-case PNG files under their bare names with their own bytes', async () => {
        serveAssets(ASSET_NAMES)

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(ASSET_NAMES)))
    })

    test('guard: a directory is never read and the backup still completes', async () => {
        serveAssets(['a.png', 'b.mp3'])
        plantDirectory('sub')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(readPaths()).not.toContain('assets/sub')
        expect(writtenEntries().map((e) => e.name)).toContain('database.risudat')
    })

    test('guard: a symlink to a file is read and written like a file', async () => {
        serveAssets(['a.png'])
        plantFileLink('link.mp3')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'link.mp3'])))
    })

    test('a symlink that resolves but whose read fails is reported as missing and the other assets are still written', async () => {
        serveAssets(['a.png', 'c.png'])
        plantFileLink('broken.mp3')
        failReadOf('assets/broken.mp3')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'c.png'])))
        expect(writtenEntries().map((e) => e.name)).toContain('database.risudat')
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('broken.mp3')
    })

    test('reproducer: a dangling symlink is dropped from the backup, not reported as missing, and the other assets are still written', async () => {
        serveAssets(['a.png', 'c.png'])
        fakeFs.plantSymlink('assets/dangling.mp3', { kind: 'missing' })

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'c.png'])))
        expect(writtenEntries().map((e) => e.name)).toContain('database.risudat')
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).not.toContain('dangling.mp3')
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })

    test('guard: a directory that is not a symlink is never read while a symlink beside it is', async () => {
        serveAssets(['a.png'])
        plantDirectory('sub')
        plantFileLink('link.mp3')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(readPaths()).not.toContain('assets/sub')
        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'link.mp3'])))
    })

    test('a file whose read fails is reported as missing and the other assets are still written', async () => {
        serveAssets(['a.png', 'bad.png', 'c.png'])
        failReadOf('assets/bad.png')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'c.png'])))
        expect(writtenEntries().map((e) => e.name)).toContain('database.risudat')
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('bad.png')
    })

    test('guard: a file whose read yields no data is reported as missing and the other assets are still written', async () => {
        serveAssets(['a.png', 'empty.png', 'c.png'])
        emptyReads.add('assets/empty.png')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'c.png'])))
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('empty.png')
    })

    test('reproducer: the temp file of an atomic write in flight is not a backup entry', async () => {
        serveAssets(['a.png', 'c.png'])
        fakeFs.plant('assets/risu-write-0123456789abcdef.tmp', encoder.encode('half a write'))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'c.png'])))
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })

    test('guard: an asset with an unusual name that the store can list is kept under its bare name', async () => {
        serveAssets(['a.png', 'weird name.PNG', 'noext'])

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'weird name.PNG', 'noext'])))
    })

    test('new behaviour: a file in a nested directory of assets/ is exported under its bare name', async () => {
        serveAssets(['a.png'])
        fakeFs.plant('assets/d/nested.mp3', bytesFor('nested.mp3'))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'nested.mp3'])))
    })
})

describe('hardening: a partial backup includes every referenced asset whatever its extension', () => {
    const referencedDb = () => databaseWith({
        customBackground: 'assets/bg.webp',
        characters: [
            { chaId: 'c1', name: 'One', type: 'character', image: 'assets/x.webp', chats: [] },
            { chaId: 'c2', name: 'Two', type: 'character', image: 'assets/y.png', chats: [] },
        ],
    })
    const STORED = ['bg.webp', 'x.webp', 'y.png', 'unreferenced.webp', 'unreferenced.png']

    beforeEach(() => {
        getDatabaseMock.mockImplementation(referencedDb)
        serveAssets(STORED)
    })

    test('web: writes the referenced webp background and webp character image', async () => {
        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(
            Object.fromEntries(['bg.webp', 'x.webp', 'y.png'].map((n) => [n, hex(bytesFor(n))]))
        ))
    })

    test('Tauri: writes the referenced webp background and webp character image', async () => {
        platformBox.isTauri = true

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['bg.webp', 'x.webp', 'y.png'])))
    })

    test('guard: Tauri: a referenced asset that is a symlink to a file is read and written', async () => {
        platformBox.isTauri = true
        fakeFs.files.delete('assets/x.webp')
        plantFileLink('x.webp')

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['bg.webp', 'x.webp', 'y.png'])))
    })

    test('new behaviour: Tauri: a referenced asset that is absent is reported as missing and the other referenced assets are still written', async () => {
        platformBox.isTauri = true
        fakeFs.files.delete('assets/x.webp')

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['bg.webp', 'y.png'])))
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('assets/x.webp')
    })

    test('Tauri: a referenced asset whose read fails is reported as missing and the other referenced assets and the database are still written', async () => {
        platformBox.isTauri = true
        failReadOf('assets/x.webp')

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['bg.webp', 'y.png'])))
        expect(writtenEntries().map((e) => e.name)).toContain('database.risudat')
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('assets/x.webp')
    })

    test('new behaviour: Tauri: a referenced name that is a directory is reported as missing and the other referenced assets are still written', async () => {
        platformBox.isTauri = true
        fakeFs.files.delete('assets/x.webp')
        plantDirectory('x.webp')

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['bg.webp', 'y.png'])))
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('assets/x.webp')
    })

    test('guard: web writes a referenced png and leaves unreferenced assets out', async () => {
        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        const names = writtenEntries().map((e) => e.name)
        expect(names).toContain('y.png')
        expect(names).not.toContain('unreferenced.png')
        expect(names).not.toContain('unreferenced.webp')
    })

    test('guard: Tauri writes a referenced png and leaves unreferenced assets out', async () => {
        platformBox.isTauri = true

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        const names = writtenEntries().map((e) => e.name)
        expect(names).toContain('y.png')
        expect(names).not.toContain('unreferenced.png')
        expect(names).not.toContain('unreferenced.webp')
    })
})

describe('a backup written by SaveLocalBackup restores every asset with identical bytes', () => {
    const ROUND_TRIP = ['a.png', 'b.mp3', 'c.webp']

    test('web: assets/b.mp3 and assets/c.webp return to storage', async () => {
        getDatabaseMock.mockImplementation(() => databaseWith({}))
        serveAssets(ROUND_TRIP)
        forageGetItemMock.mockImplementation(async (key) => bytesFor(key))
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()
        const backupBytes = concat(backupSink.writes)
        forageSetItemMock.mockClear()

        await loadBackupBytes(backupBytes)

        expect(sortedRecord(restoredAssets())).toEqual(sortedRecord(
            Object.fromEntries(ROUND_TRIP.map((n) => [`assets/${n}`, hex(bytesFor(`assets/${n}`))]))
        ))
    })

    test('Tauri: assets/b.mp3 and assets/c.webp are written back to the assets directory', async () => {
        platformBox.isTauri = true
        getDatabaseMock.mockImplementation(() => databaseWith({}))
        serveAssets(ROUND_TRIP)
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()
        const backupBytes = concat(backupSink.writes)
        for (const key of Array.from(fakeFs.files.keys()).filter((key) => key.startsWith('assets/'))) {
            fakeFs.files.delete(key)
        }

        await loadBackupBytes(backupBytes)

        expect(sortedRecord(restoredAssets())).toEqual(sortedRecord(withPrefix(expectedAssets(ROUND_TRIP))))
    })
})

describe('restoring a backup keeps every asset entry under assets/ whatever its extension', () => {
    const RESTORED = ['x.mp3', 'y.mp4', 'z.webp', 'w.jpg']

    async function restoreHandBuiltBackup() {
        const dbData = encodeRisuSaveLegacy(databaseWith({}), 'noCompression')
        const parts = RESTORED.map((name) => buildChunk(name, bytesFor(name)))
        parts.push(buildChunk('database.risudat', dbData))
        await loadBackupBytes(concat(parts))
    }

    test('guard: web stores x.mp3, y.mp4, z.webp and w.jpg as assets/<name>, not as cold storage', async () => {
        await restoreHandBuiltBackup()

        expect(sortedRecord(restoredAssets())).toEqual(sortedRecord(withPrefix(expectedAssets(RESTORED))))
        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        // The database is committed as a block generation whose head is written once; no main file is written.
        expect(forageSetItemMock.mock.calls.filter((c) => c[0] === 'blocks/head')).toHaveLength(1)
        expect(forageSetItemMock.mock.calls.filter((c) => c[0] === 'database/database.bin')).toHaveLength(0)
    })

    test('guard: Tauri writes x.mp3, y.mp4, z.webp and w.jpg to assets/<name>, not as cold storage', async () => {
        platformBox.isTauri = true

        await restoreHandBuiltBackup()

        expect(sortedRecord(restoredAssets())).toEqual(sortedRecord(withPrefix(expectedAssets(RESTORED))))
        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        // The database is committed as a block generation whose head is replaced durably, once; no main file is written.
        expect(fakeFs.durableLog.filter((key) => key === 'blocks/head')).toHaveLength(1)
        expect(fakeFs.files.has('blocks/head')).toBe(true)
        expect(fakeFs.files.has('database/database.bin')).toBe(false)
        expect(fakeFs.renameLog.filter((entry) => bare(entry.to) === 'database/database.bin')).toHaveLength(0)
    })
})

describe('restoring a backup onto the desktop store', () => {
    const TEMP_NAME = 'risu-write-0123456789abcdef.tmp'
    const KEPT = ['good1.png', 'good2.mp3']

    function backupOf(entries: [string, Uint8Array][]): Uint8Array {
        const parts = entries.map(([name, data]) => buildChunk(name, data))
        parts.push(buildChunk('database.risudat', encodeRisuSaveLegacy(databaseWith({}), 'noCompression')))
        return concat(parts)
    }

    function entriesOf(names: string[]): [string, Uint8Array][] {
        return names.map((name) => [name, bytesFor(name)])
    }

    /** The messages of the `Success` wait alert and every other alert the restore set in the shared store, in order. */
    function recordAlertStore(): { messages: string[], stop: () => void } {
        const messages: string[] = []
        const shared = alertStore as unknown as { set(value: { type: string, msg: string }): void, subscribe(run: (value: { msg: string }) => void): () => void }
        // The store keeps the last notice of an earlier test; a subscriber is told it first.
        shared.set({ type: 'none', msg: '' })
        const stop = shared.subscribe((value) => {
            if (value.msg) {
                messages.push(value.msg)
            }
        })
        return { messages, stop }
    }

    beforeEach(() => {
        platformBox.isTauri = true
    })

    test('reproducer: a write that fails over an existing asset leaves the old bytes whole and no temp file', async () => {
        const OLD = encoder.encode('old bytes of x.mp3, kept')
        const NEW = encoder.encode('new bytes of x.mp3, restored but the write fails')
        fakeFs.plant('assets/x.mp3', OLD)
        const fault = fakeFs.failWritesOf((data) => data.length === NEW.length && data.every((byte, index) => byte === NEW[index]))

        await loadBackupBytes(backupOf([['x.mp3', NEW]]))

        expect(fault.fired).toBeGreaterThan(0)
        expect(Array.from(fakeFs.files.get('assets/x.mp3') ?? [])).toEqual(Array.from(OLD))
        expect(fakeFs.listing('assets')).toEqual(['x.mp3'])
        expect(alertErrorMock).toHaveBeenCalled()
        expect(fakeFs.files.has('database/database.bin')).toBe(false)
        expect(fakeFs.files.has('blocks/head')).toBe(false)
    })

    test('guard: a write error other than a refused name aborts the restore before the database is written', async () => {
        fakeFs.failWritesOf((data) => data.length === bytesFor('bad.mp3').length && data.every((byte, index) => byte === bytesFor('bad.mp3')[index]))

        await loadBackupBytes(backupOf(entriesOf(['bad.mp3', 'later.png'])))

        expect(alertErrorMock).toHaveBeenCalled()
        expect(fakeFs.files.has('database/database.bin')).toBe(false)
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(fakeFs.files.has('assets/later.png')).toBe(false)
        expect(alertNormalWaitMock).not.toHaveBeenCalled()
    })

    test('new behaviour: names the store refuses are skipped, every other asset and the database are written, and the notice lists exactly the refused names', async () => {
        const REFUSED = ['.DS_Store', TEMP_NAME, 'trailing.']

        await loadBackupBytes(backupOf(entriesOf([KEPT[0], ...REFUSED, KEPT[1]])))

        expect(sortedRecord(restoredAssets())).toEqual(sortedRecord(withPrefix(expectedAssets(KEPT))))
        expect(fakeFs.files.has('blocks/head')).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
        const notice = alertNormalWaitMock.mock.calls[0][0]
        for (const name of REFUSED) {
            expect(notice).toContain(name)
        }
        for (const name of KEPT) {
            expect(notice).not.toContain(name)
        }
        expect(notice).toContain('3')
        expect(alertMdMock).not.toHaveBeenCalled()
    })

    test('new behaviour: the notice gives the count and only the first 20 refused names', async () => {
        const REFUSED = Array.from({ length: 25 }, (_, index) => `.hidden${String(index).padStart(2, '0')}`)

        await loadBackupBytes(backupOf(entriesOf(REFUSED)))

        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
        const notice = alertNormalWaitMock.mock.calls[0][0]
        expect(notice).toContain('25')
        expect(notice).toContain('5 more')
        expect(REFUSED.filter((name) => notice.includes(name))).toEqual(REFUSED.slice(0, 20))
    })

    test('new behaviour: a very long refused name is cut in the notice', async () => {
        const LONG = '.' + 'n'.repeat(500)

        await loadBackupBytes(backupOf(entriesOf([LONG])))

        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
        const notice = alertNormalWaitMock.mock.calls[0][0]
        expect(notice).not.toContain(LONG)
        expect(notice).toContain('.' + 'n'.repeat(50))
    })

    test('new behaviour: the notice is shown after the database is written, awaited before the success notice, and before the reload is marked', async () => {
        let releaseNotice: () => void = () => { }
        let markedWhenShown: boolean | null = null
        let databaseWrittenWhenShown: boolean | null = null
        alertNormalWaitMock.mockImplementation(() => {
            markedWhenShown = reloadMark.marked
            databaseWrittenWhenShown = fakeFs.files.has('blocks/head')
            return new Promise<void>((resolve) => { releaseNotice = resolve })
        })
        const seen = recordAlertStore()

        const restoring = loadBackupBytes(backupOf(entriesOf(['.DS_Store', KEPT[0]])))
        await vi.waitFor(() => { expect(alertNormalWaitMock).toHaveBeenCalledTimes(1) })
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(seen.messages.some((message) => message.includes('Success, Refreshing your app.'))).toBe(false)

        releaseNotice()
        await restoring
        seen.stop()

        expect(seen.messages.some((message) => message.includes('Success, Refreshing your app.'))).toBe(true)
        expect(markedWhenShown).toBe(false)
        expect(reloadMark.marked).toBe(true)
        expect(databaseWrittenWhenShown).toBe(true)
    })

    test('guard: a restore with no refused name shows no notice', async () => {
        await loadBackupBytes(backupOf(entriesOf(KEPT)))

        expect(alertNormalWaitMock).not.toHaveBeenCalled()
        expect(sortedRecord(restoredAssets())).toEqual(sortedRecord(withPrefix(expectedAssets(KEPT))))
    })

    test('new behaviour: every key the restore wrote or tried to write is recorded for the startup sweep, before the database is written', async () => {
        await loadBackupBytes(backupOf(entriesOf([KEPT[0], '.DS_Store'])))

        expect(wasAssetWrittenThisPage(`assets/${KEPT[0]}`)).toBe(true)
        expect(wasAssetWrittenThisPage('assets/.DS_Store')).toBe(true)
        expect(wasAssetWrittenThisPage('assets/never-seen.png')).toBe(false)
    })
})

describe('an entry too large for the 32-bit length field fails the backup loudly', () => {
    /** A real, empty `Uint8Array` that reports a size past the 32-bit limit, so no 4 GiB allocation is needed. */
    function oversizedData(): Uint8Array {
        const data = new Uint8Array(0)
        Object.defineProperty(data, 'byteLength', { value: 2 ** 32 + 5 })
        return data
    }

    /** A real, empty `Uint8Array` that reports exactly `byteLength` bytes. */
    function dataReporting(byteLength: number): Uint8Array {
        const data = new Uint8Array(0)
        Object.defineProperty(data, 'byteLength', { value: byteLength })
        return data
    }

    test.each([
        { byteLength: 2 ** 32, wrapped: 0 },
        { byteLength: 2 ** 32 + 5, wrapped: 5 },
    ])('LocalWriter.writeBackup rejects an entry of $byteLength bytes without writing its wrapped length $wrapped', async ({ byteLength, wrapped }) => {
        const writer = new LocalWriter()
        await writer.init()

        const outcome = await outcomeOf(() => writer.writeBackup('assets/big.mp4', dataReporting(byteLength)))

        const declared = writtenEntries().filter((e) => e.name === 'big.mp4').map((e) => e.declaredLength)
        expect(declared).not.toContain(wrapped)
        expect(outcome).toBeInstanceOf(Error)
    })

    test('guard: LocalWriter.writeBackup accepts an entry of 2^32 - 1 bytes and declares that length', async () => {
        const writer = new LocalWriter()
        await writer.init()

        const outcome = await outcomeOf(() => writer.writeBackup('assets/edge.mp4', dataReporting(0xFFFFFFFF)))

        expect(outcome).toBeNull()
        const declared = writtenEntries().filter((e) => e.name === 'edge.mp4').map((e) => e.declaredLength)
        expect(declared).toEqual([0xFFFFFFFF])
    })

    test('SaveLocalBackup with an oversized asset throws or reports it, and writes no wrapped length', async () => {
        serveAssets(['ok.png'])
        forageKeysMock.mockImplementation(async () => ['assets/ok.png', 'assets/big.png'])
        forageGetItemMock.mockImplementation(async (key) => key === 'assets/big.png' ? oversizedData() : bytesFor(key))

        const outcome = await outcomeOf(SaveLocalBackup)

        const declared = writtenEntries().filter((e) => e.name === 'big.png').map((e) => e.declaredLength)
        expect(declared).not.toContain(5)
        const reported = outcome !== null
            || alertErrorMock.mock.calls.length > 0
            || alertMdMock.mock.calls.some((c) => String(c[0]).includes('big.png'))
        expect(reported).toBe(true)
    })
})

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
 * `[nameLength][name][dataLength][data]` entries. The storage backend, the
 * Tauri file system and every dialog are mocked; a passing test here is not
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
const readDirMock = vi.hoisted(() => vi.fn(async (_path: string, _options?: unknown): Promise<DirEntryFixture[]> => []))
const readFileMock = vi.hoisted(() => vi.fn(async (_path: string, _options?: unknown): Promise<Uint8Array | undefined> => new Uint8Array()))
const tauriFiles = vi.hoisted(() => new Map<string, Uint8Array>())
const writeFileMock = vi.hoisted(() => vi.fn(async (path: string, data: Uint8Array, _options?: unknown): Promise<void> => {
    if (path === BACKUP_PATH) {
        backupSink.writes.push(data.slice())
        return
    }
    tauriFiles.set(path, data.slice())
}))
const renameMock = vi.hoisted(() => vi.fn(async (from: string, to: string, _options?: unknown): Promise<void> => {
    const found = tauriFiles.get(from)
    if (!found) {
        throw `no such file ${from} (os error 2)`
    }
    tauriFiles.set(to, found)
    tauriFiles.delete(from)
}))
const removeMock = vi.hoisted(() => vi.fn(async (path: string, _options?: unknown): Promise<void> => {
    tauriFiles.delete(path)
}))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const setColdStorageItemMock = vi.hoisted(() => vi.fn(async () => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())

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
    remove: removeMock,
    rename: renameMock,
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

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup, LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { LocalWriter, dbWriteLock } from 'src/ts/globalApi.svelte'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'

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

function fileEntry(name: string): DirEntryFixture {
    return { name, isFile: true, isDirectory: false, isSymlink: false }
}

function directoryEntry(name: string): DirEntryFixture {
    return { name, isFile: false, isDirectory: true, isSymlink: false }
}

/** How Tauri's `readDir` reports a link to a file: it does not follow links, so `isFile` is false. */
function symlinkEntry(name: string): DirEntryFixture {
    return { name, isFile: false, isDirectory: false, isSymlink: true }
}

/** Makes `readFile` reject for `path` and serve every other path as before. */
function failReadOf(path: string) {
    const serve = readFileMock.getMockImplementation()
    readFileMock.mockImplementation(async (requested, options) => {
        if (requested === path) {
            throw new Error('read failed')
        }
        return serve ? serve(requested, options) : undefined
    })
}

/** Serves each `assets/<name>` from `bytesFor`, on both the web storage mock and the Tauri file mock. */
function serveAssets(names: string[]) {
    forageKeysMock.mockImplementation(async () => names.map((n) => `assets/${n}`))
    forageGetItemMock.mockImplementation(async (key) => {
        const name = key.replace(/^assets\//, '')
        return names.includes(name) ? bytesFor(name) : null
    })
    readDirMock.mockImplementation(async () => names.map(fileEntry))
    readFileMock.mockImplementation(async (path) => {
        const name = path.replace(/^assets\//, '')
        if (!names.includes(name)) {
            throw new Error(`no such file: ${path}`)
        }
        return bytesFor(name)
    })
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
        ? writeFileMock.mock.calls.map((c) => [c[0], c[1]])
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
    readDirMock.mockClear()
    readFileMock.mockClear()
    writeFileMock.mockClear()
    renameMock.mockClear()
    removeMock.mockClear()
    tauriFiles.clear()
    forageKeysMock.mockClear()
    forageGetItemMock.mockClear()
    forageSetItemMock.mockClear()
    setColdStorageItemMock.mockClear()
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    readDirMock.mockImplementation(async () => [])
    readFileMock.mockImplementation(async () => new Uint8Array())
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
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

    test('guard: a directory entry is never read and the backup still completes', async () => {
        serveAssets(['a.png', 'b.mp3'])
        readDirMock.mockImplementation(async () => [fileEntry('a.png'), directoryEntry('sub'), fileEntry('b.mp3')])

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const readPaths = readFileMock.mock.calls.map((c) => c[0])
        expect(readPaths).not.toContain('assets/sub')
        expect(writtenEntries().map((e) => e.name)).toContain('database.risudat')
    })

    test('a symlink entry is read and written like a file', async () => {
        serveAssets(['a.png', 'link.mp3'])
        readDirMock.mockImplementation(async () => [fileEntry('a.png'), symlinkEntry('link.mp3')])

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'link.mp3'])))
    })

    test('a symlink whose read fails is reported as missing and the other assets are still written', async () => {
        serveAssets(['a.png', 'c.png'])
        readDirMock.mockImplementation(async () => [fileEntry('a.png'), symlinkEntry('broken.mp3'), fileEntry('c.png')])
        failReadOf('assets/broken.mp3')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'c.png'])))
        expect(writtenEntries().map((e) => e.name)).toContain('database.risudat')
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('broken.mp3')
    })

    test('guard: a directory entry that is not a symlink is never read while a symlink beside it is', async () => {
        serveAssets(['a.png', 'link.mp3'])
        readDirMock.mockImplementation(async () => [directoryEntry('sub'), symlinkEntry('link.mp3'), fileEntry('a.png')])

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const readPaths = readFileMock.mock.calls.map((c) => c[0])
        expect(readPaths).not.toContain('assets/sub')
    })

    test('a file whose read fails is reported as missing and the other assets are still written', async () => {
        serveAssets(['a.png', 'c.png'])
        readDirMock.mockImplementation(async () => [fileEntry('a.png'), fileEntry('bad.png'), fileEntry('c.png')])
        failReadOf('assets/bad.png')

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'c.png'])))
        expect(writtenEntries().map((e) => e.name)).toContain('database.risudat')
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('bad.png')
    })

    test('guard: a file whose read yields no data is reported as missing and the other assets are still written', async () => {
        serveAssets(['a.png', 'c.png'])
        readDirMock.mockImplementation(async () => [fileEntry('a.png'), fileEntry('empty.png'), fileEntry('c.png')])
        const serve = readFileMock.getMockImplementation()
        readFileMock.mockImplementation(async (path, options) => {
            if (path === 'assets/empty.png') {
                return undefined
            }
            return serve ? serve(path, options) : undefined
        })

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['a.png', 'c.png'])))
        const report = alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
        expect(report).toContain('empty.png')
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

    test('Tauri: a referenced asset reported as a symlink is read and written', async () => {
        platformBox.isTauri = true
        readDirMock.mockImplementation(async () => [
            fileEntry('bg.webp'), symlinkEntry('x.webp'), fileEntry('y.png'), fileEntry('unreferenced.png'),
        ])

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(sortedRecord(writtenAssets())).toEqual(sortedRecord(expectedAssets(['bg.webp', 'x.webp', 'y.png'])))
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

    test('guard: Tauri never reads a directory entry that carries a referenced name', async () => {
        platformBox.isTauri = true
        readDirMock.mockImplementation(async () => [fileEntry('bg.webp'), directoryEntry('x.webp'), fileEntry('y.png')])

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        const readPaths = readFileMock.mock.calls.map((c) => c[0])
        expect(readPaths).not.toContain('assets/x.webp')
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
        writeFileMock.mockClear()

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
        const databaseWrites = forageSetItemMock.mock.calls.filter((c) => c[0] === 'database/database.bin')
        expect(databaseWrites).toHaveLength(1)
    })

    test('guard: Tauri writes x.mp3, y.mp4, z.webp and w.jpg to assets/<name>, not as cold storage', async () => {
        platformBox.isTauri = true

        await restoreHandBuiltBackup()

        expect(sortedRecord(restoredAssets())).toEqual(sortedRecord(withPrefix(expectedAssets(RESTORED))))
        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        // The database entry reaches the main path by a rename over it, once, and no write opens the main path.
        const databaseRenames = renameMock.mock.calls.filter((c) => c[1] === 'database/database.bin')
        expect(databaseRenames).toHaveLength(1)
        expect(writeFileMock.mock.calls.filter((c) => c[0] === 'database/database.bin')).toHaveLength(0)
        expect(tauriFiles.has('database/database.bin')).toBe(true)
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

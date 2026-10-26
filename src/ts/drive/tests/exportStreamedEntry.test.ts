/**
 * The `database.risudat` entry of a full and a partial local export (`SaveLocalBackup`, `SavePartialLocalBackup`,
 * `src/ts/drive/backuplocal.ts`) is written as a header with the total length followed by compressed pieces. The
 * recording stream keeps the chunk references it is given, not copies, so a block the sink wrote into again after
 * handing it out would show in the parsed bytes.
 *
 * There is no pre-fix reproducer (the benefit is memory); every test is a guard with a named scratch mutant. The
 * harness is the one `backuplocalCharacterIdsExport.test.ts` documents: the real writer, collector and unit store with
 * every dialog mocked. A passing test here is not evidence about the Tauri or Node backends.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { decompressSync } from 'fflate'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation:
    // without it restore takes its no-Web-Locks branch and never waits on
    // another tab, which is outside what this file exercises.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())

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
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk) },
                    close: async () => { },
                }),
            },
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
        realStorage: unknown = undefined
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

/** The characters a store2 entity stub reads back, by entity key; any other stub reads through the real unit store. */
const entityBox = vi.hoisted(() => ({ characters: new Map<string, unknown>() }))

vi.mock(import('src/ts/process/coldCharacterRestore'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        readColdCharacterCopy: async (stub: Parameters<typeof original.readColdCharacterCopy>[0]) => {
            const entity = entityBox.characters.get(String(stub.coldstorage))
            return entity === undefined
                ? original.readColdCharacterCopy(stub)
                : { status: 'ok' as const, character: structuredClone(entity) as typeof stub }
        },
    }
})

//#endregion

//#region units and the legacy OPFS stand-in

/** The page store's units (coldstorage/<key>), kept apart from the assets, and every unit key read from it. */
const unitMem = new Map<string, Uint8Array>()
const unitReadLog: string[] = []

function isUnitKey(key: string): boolean {
    return key.startsWith('coldstorage/')
}

/** Places raw bytes as the page store's unit key. */
function putRawUnit(key: string, bytes: Uint8Array): void {
    unitMem.set('coldstorage/' + key, bytes)
}

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

/** The legacy OPFS unit files: no test here places one, so every read falls through to "not found". */
const mockDirectoryHandle = {
    async getFileHandle(name: string) {
        throw new MockNotFoundError("not found: " + name)
    },
    async removeEntry() { },
    entries() {
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        return { done: true as const, value: undefined }
                    },
                }
            },
        }
    },
}
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: async () => mockDirectoryHandle,
    },
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock, LocalWriter } from 'src/ts/globalApi.svelte'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { writeRisuSaveV0 } from 'src/ts/storage/risuSaveV0'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'

//#region helpers

const decoder = new TextDecoder()
const HEADER_LENGTH = 11

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** Deterministic bytes that do not compress, so a couple of MiB of them make more than one 1 MiB output block. */
function noise(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    let state = seed >>> 0
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        out[i] = state >>> 24
    }
    return out
}

interface WrittenEntry {
    name: string
    data: Uint8Array
}

/**
 * The entries in the sink, parsed from the chunk references the stream was given, so a block the sink wrote into again
 * after emitting it shows up here. The parse is strict: every length field must hold exactly the bytes that follow, and
 * the last entry must end at the last byte written.
 */
function writtenEntries(): WrittenEntry[] {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: WrittenEntry[] = []
    let offset = 0
    while (offset < bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        if (offset + dataLength > bytes.length) {
            throw new Error(`entry ${name} claims ${dataLength} bytes but ${bytes.length - offset} follow`)
        }
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

function databaseEntry(): Uint8Array {
    const entries = writtenEntries()
    expect(entries.at(-1)?.name).toBe('database.risudat')
    return entries.at(-1)!.data
}

function inflated(entryData: Uint8Array): Buffer {
    return Buffer.from(decompressSync(entryData.subarray(HEADER_LENGTH)))
}

function databaseWith(fields: Record<string, unknown>): Database {
    return { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
}

function makeLiveCharacter(chaId: string, name: string): Database['characters'][number] {
    return { chaId, name, type: 'character', chatPage: 0, chats: [] } as unknown as Database['characters'][number]
}

/** A tree whose compressed form spans several 1 MiB blocks: the padding is incompressible. */
function largeDatabase(): Database {
    return databaseWith({
        characters: [makeLiveCharacter('a', 'A'), makeLiveCharacter('b', 'B')],
        characterOrder: ['a', 'b'],
        padding: [noise(1400000, 3), noise(1400000, 4), noise(900000, 5)],
    })
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    unitMem.clear()
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    alertConfirmMock.mockClear()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    injectAppStore(createForageBackedStore({
        getItem: async (key) => (isUnitKey(key) ? (unitMem.get(key) ?? null) : forageGetItemMock(key)),
        setItem: async (key, value) => {
            if (isUnitKey(key)) {
                unitMem.set(key, value)
                return
            }
            await forageSetItemMock(key, value)
        },
        keys: async () => [...(await forageKeysMock()), ...unitMem.keys()],
        removeItem: async (key) => { unitMem.delete(key) },
    }))
    getDatabaseMock.mockImplementation(() => databaseWith({}))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe.each([
    ['SaveLocalBackup', SaveLocalBackup],
    ['SavePartialLocalBackup', SavePartialLocalBackup],
])('%s writes the database entry from streamed pieces', (_name, run) => {
    // Mutants: header not counted in `length` (the length field disagrees with the bytes); length written without the
    // header call; the block being filled is emitted itself (a later write changes an earlier reference).
    test('guard: the length field equals the bytes that follow and the inflated bytes equal the legacy encoding\'s', async () => {
        const db = largeDatabase()
        getDatabaseMock.mockImplementation(() => db)
        const headerSpy = vi.spyOn(LocalWriter.prototype, 'writeBackupHeader')
        const wholeSpy = vi.spyOn(LocalWriter.prototype, 'writeBackup')

        await run()

        const entry = databaseEntry()
        expect(Array.from(entry.subarray(0, HEADER_LENGTH))).toEqual([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8])
        const control = encodeRisuSaveLegacy({ ...db, account: undefined }, 'compression')
        expect(inflated(entry).equals(inflated(control))).toBe(true)
        // The entry came in as a header and pieces, and more than one compressed block was written.
        expect(headerSpy.mock.calls.filter((c) => c[0] === 'database.risudat').length).toBe(1)
        expect(wholeSpy.mock.calls.some((c) => c[0] === 'database.risudat')).toBe(false)
        expect(backupSink.writes.filter((chunk) => chunk.length >= 1024 * 1024).length).toBeGreaterThanOrEqual(2)
    })

    test('guard: a small database is one header and one gzip member', async () => {
        const db = databaseWith({ characters: [makeLiveCharacter('a', 'A')], characterOrder: ['a'] })
        getDatabaseMock.mockImplementation(() => db)

        await run()

        const entry = databaseEntry()
        const control = encodeRisuSaveLegacy({ ...db, account: undefined }, 'compression')
        expect(inflated(entry).equals(inflated(control))).toBe(true)
    })

    // Compatibility guard: passes before and after; the kv-block profile keeps writing one buffer through writeBackup.
    test('guard: the V0 kv-block profile still goes through writeBackup with today\'s bytes', async () => {
        const kv = { 'kv:bar': { version: 1, entries: [] } }
        const db = databaseWith({ characters: [makeLiveCharacter('a', 'A')], characterOrder: ['a'], upstreamKvBlocks: kv })
        getDatabaseMock.mockImplementation(() => db)
        const headerSpy = vi.spyOn(LocalWriter.prototype, 'writeBackupHeader')
        const wholeSpy = vi.spyOn(LocalWriter.prototype, 'writeBackup')

        await run()

        const { upstreamKvBlocks: _field, ...withoutKv } = db as unknown as Record<string, unknown>
        const expected = writeRisuSaveV0({ ...withoutKv, account: undefined }, kv)
        expect(Buffer.from(databaseEntry()).equals(Buffer.from(expected))).toBe(true)
        expect(wholeSpy.mock.calls.filter((c) => c[0] === 'database.risudat').length).toBe(1)
        expect(headerSpy.mock.calls.some((c) => c[0] === 'database.risudat')).toBe(false)
    })
})

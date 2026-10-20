/**
 * A `.bin` export of a legacy-page database that still carries upstream's plugin storage index pointer
 * (`pluginCustomStorage._coldpluginIndex`, the shared-folder and same-origin case) never writes the pointer without its
 * units: the index unit and every large-value unit it names are carried with the database, or the units that could not
 * be carried are reported through the incomplete-backup question first. The real `SaveLocalBackup`, collector,
 * cold-storage reader and writer and `encodeRisuSaveLegacy` run; the page's byte store is an in-memory map, the download
 * sink captures the bytes and dialogs are mocks. A pass says nothing about the Tauri or Node backends.
 *
 * Tests whose title starts with `guard:` hold before and after the change; every other test fails without it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))

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
                    write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
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
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
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

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

// No legacy OPFS unit file exists: every read falls through to "not found".
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: async () => ({
            async getFileHandle(name: string) {
                throw new MockNotFoundError('not found: ' + name)
            },
            async removeEntry() { },
            entries() {
                return {
                    [Symbol.asyncIterator]() {
                        return { async next() { return { done: true as const, value: undefined } } }
                    },
                }
            },
        }),
    },
})

//#endregion

import { SaveLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { setColdStorageItem } from 'src/ts/process/coldstorage.svelte'
import { listColdBackupRoots } from 'src/ts/process/coldstorageData'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'

//#region helpers

const ID = {
    index: '00000000-0000-4000-8000-0000000000c1',
    large: '00000000-0000-4000-8000-0000000000c2',
    otherLarge: '00000000-0000-4000-8000-0000000000c3',
    fork: '00000000-0000-4000-8000-0000000000c4',
} as const

// `otherLarge` is named by an entry a later entry for the same key replaces: it is still carried, as upstream's backup does.
const INDEX_UNIT = {
    type: 'risu-plugin-storage-index',
    version: 1,
    entries: [
        { k: 'small', s: '{"a":1}' },
        { k: 'big', l: ID.large },
        { k: 'replaced', l: ID.otherLarge },
        { k: 'replaced', s: '2' },
    ],
    trash: [],
}
const LARGE_VALUE = { big: ['a', 'b'] }
const OTHER_LARGE_VALUE = ['replaced later']

function databaseWith(pluginCustomStorage: Record<string, unknown>): Database {
    return {
        characters: [],
        personas: [],
        characterOrder: [],
        botPresets: [],
        modules: [],
        pluginCustomStorage,
    } as unknown as Database
}

const decoder = new TextDecoder()

interface ContainerEntry {
    name: string
    data: Uint8Array
}

/** The `[nameLength u32 LE][name][dataLength u32 LE][data]` entries of the exported file. */
function parseContainer(bytes: Uint8Array): ContainerEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: ContainerEntry[] = []
    let offset = 0
    while (offset < bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        entries.push({ name, data: bytes.subarray(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
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

const unitMem = new Map<string, Uint8Array>()
const assetMem = new Map<string, Uint8Array>()

async function exportOf(db: Database) {
    getDatabaseMock.mockImplementation(() => db)
    backupSink.writes.length = 0
    const outcome = await SaveLocalBackup()
    const entries = parseContainer(concat(backupSink.writes))
    return { outcome, entries }
}

function unitEntryNames(entries: ContainerEntry[]): string[] {
    return entries.map((entry) => entry.name).filter((name) => name.startsWith('coldstorage_')).sort()
}

function jsonOf(entries: ContainerEntry[], key: string): unknown {
    const entry = entries.find((candidate) => candidate.name === `coldstorage_${key}.json`)
    return entry ? JSON.parse(decoder.decode(entry.data)) : undefined
}

function incompleteBackupPrompts(): string[] {
    return alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('Cold storage data') && t.includes('incomplete backup'))
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    unitMem.clear()
    assetMem.clear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    injectAppStore(createForageBackedStore({
        getItem: async (key) => key.startsWith('coldstorage/') ? (unitMem.get(key) ?? null) : (assetMem.get(key) ?? null),
        setItem: async (key, value) => {
            if (key.startsWith('coldstorage/')) {
                unitMem.set(key, value)
            } else {
                assetMem.set(key, value)
            }
        },
        keys: async () => [...assetMem.keys(), ...unitMem.keys()].sort(),
        removeItem: async (key) => { unitMem.delete(key); assetMem.delete(key) },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('listColdBackupRoots', () => {
    test('names the pointer as a plugin root that carries the units its index names', () => {
        const roots = listColdBackupRoots(databaseWith({ _coldpluginIndex: ID.index, _coldplugin: { forkKey: ID.fork } }))

        expect(roots).toEqual([
            { key: ID.fork, kind: 'plugin' },
            { key: ID.index, kind: 'plugin', pluginIndex: true },
        ])
    })

    test.each([['a pointer that is not a string', { _coldpluginIndex: 5 }], ['no pointer', { _coldplugin: { forkKey: ID.fork } }]])('guard: %s adds no index root', (_label, storage) => {
        expect(listColdBackupRoots(databaseWith(storage)).some((root) => root.pluginIndex)).toBe(false)
    })
})

describe('SaveLocalBackup of a database that carries the plugin storage index pointer', () => {
    test('writes the index unit and every large-value unit it names with the database that holds the pointer', async () => {
        expect(await setColdStorageItem(ID.index, INDEX_UNIT)).toBe(true)
        expect(await setColdStorageItem(ID.large, LARGE_VALUE)).toBe(true)
        expect(await setColdStorageItem(ID.otherLarge, OTHER_LARGE_VALUE)).toBe(true)

        const { entries } = await exportOf(databaseWith({ _coldpluginIndex: ID.index }))

        expect(unitEntryNames(entries)).toEqual([ID.index, ID.large, ID.otherLarge].map((id) => `coldstorage_${id}.json`).sort())
        expect(jsonOf(entries, ID.index)).toEqual(INDEX_UNIT)
        expect(jsonOf(entries, ID.large)).toEqual(LARGE_VALUE)
        expect(jsonOf(entries, ID.otherLarge)).toEqual(OTHER_LARGE_VALUE)
        const database = entries.find((entry) => entry.name === 'database.risudat')
        expect(database).toBeDefined()
        const decoded = await decodeRisuSave(database!.data) as { pluginCustomStorage: Record<string, unknown> }
        expect(decoded.pluginCustomStorage._coldpluginIndex).toBe(ID.index)
        expect(incompleteBackupPrompts()).toEqual([])
    })

    test('carries the fork-style _coldplugin units beside the index units', async () => {
        expect(await setColdStorageItem(ID.index, INDEX_UNIT)).toBe(true)
        expect(await setColdStorageItem(ID.large, LARGE_VALUE)).toBe(true)
        expect(await setColdStorageItem(ID.otherLarge, OTHER_LARGE_VALUE)).toBe(true)
        expect(await setColdStorageItem(ID.fork, { forkValue: true })).toBe(true)

        const { entries } = await exportOf(databaseWith({ _coldpluginIndex: ID.index, _coldplugin: { forkKey: ID.fork } }))

        expect(unitEntryNames(entries)).toEqual([ID.index, ID.large, ID.otherLarge, ID.fork].map((id) => `coldstorage_${id}.json`).sort())
    })

    test('a large-value unit that is absent is reported through the incomplete-backup question', async () => {
        expect(await setColdStorageItem(ID.index, INDEX_UNIT)).toBe(true)
        expect(await setColdStorageItem(ID.large, LARGE_VALUE)).toBe(true)

        const { outcome } = await exportOf(databaseWith({ _coldpluginIndex: ID.index }))

        expect(outcome.status).not.toBe('declined')
        const prompts = incompleteBackupPrompts()
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('missing 1 cold storage item(s)')
    })

    test('an index unit that is absent is reported, and declining the question writes no file', async () => {
        alertConfirmMock.mockImplementation(async () => false)

        const { outcome, entries } = await exportOf(databaseWith({ _coldpluginIndex: ID.index }))

        expect(outcome.status).toBe('declined')
        expect(entries).toEqual([])
        const prompts = incompleteBackupPrompts()
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('missing 1 cold storage item(s)')
    })

    test('a unit under the pointer that is not an index is reported and not carried', async () => {
        expect(await setColdStorageItem(ID.index, { type: 'something else', entries: [] })).toBe(true)

        const { entries } = await exportOf(databaseWith({ _coldpluginIndex: ID.index }))

        expect(unitEntryNames(entries)).toEqual([])
        expect(incompleteBackupPrompts()).toHaveLength(1)
    })

    test('guard: a database without the pointer writes no index units and asks nothing', async () => {
        expect(await setColdStorageItem(ID.fork, { forkValue: true })).toBe(true)

        const { entries } = await exportOf(databaseWith({ _coldplugin: { forkKey: ID.fork } }))

        expect(unitEntryNames(entries)).toEqual([`coldstorage_${ID.fork}.json`])
        expect(incompleteBackupPrompts()).toEqual([])
    })
})

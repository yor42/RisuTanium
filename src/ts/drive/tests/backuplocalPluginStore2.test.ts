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

//#endregion

//#region units and the legacy OPFS stand-in

/** The page store's units (coldstorage/<key>), kept apart from the assets, and every unit key read from it. */
const unitMem = new Map<string, Uint8Array>()
const unitReadLog: string[] = []

function isUnitKey(key: string): boolean {
    return key.startsWith('coldstorage/')
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
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { setDatabase } from 'src/ts/storage/database.svelte'
import { alertWait } from 'src/ts/alert'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { createMemoryBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry, type UnitSource } from 'src/ts/storage/store2/codec'
import type { ShardEntry } from 'src/ts/storage/store2/format'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

//#region helpers

const decoder = new TextDecoder()
const NOW = 1_700_000_000_000

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

/** The entries the real `LocalWriter` emitted into the sink, in write order. */
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

function backupPrompts(): string[] {
    return alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('Cold storage data') && t.includes('Create the incomplete backup anyway?'))
}

let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

/**
 * The value with every string cut to 50 characters. msgpackr 1.10.1 passes a length past the buffer's end to
 * `Buffer.prototype.utf8Write` for a string of 64 or more characters, which the Node used here rejects (the goldens
 * README records it; the browser build uses the `buffer` polyfill, which has no `utf8Write`, so production is unaffected).
 * The goldens harness clamps that length in a file outside this suite, so the fixture keeps its strings short instead.
 */
function shortened(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.slice(0, 50)
    }
    if (Array.isArray(value)) {
        return value.map(shortened)
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shortened(inner)]))
    }
    return value
}

interface Page {
    memory: MemoryBackend
    db: Database
    /** The entries of the booted tree: the first is resident, the others are stubs. */
    entries: ShardEntry[]
    source: UnitSource
}

/** A store2 page: the first character resident, the others stubs of their entities, the residency registered. */
async function pageOf(options: { backend?: (memory: MemoryBackend) => Store2Backend, group?: boolean } = {}): Promise<Page> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(3)) as Obj), archiveCharacters: true } as unknown as Database
    if (options.group === true) {
        // A group of the first two characters. The boot policy opens a group with a usable id as a stub, like any character.
        const characters = fixture.characters as unknown as Obj[]
        characters.push({ ...JSON.parse(JSON.stringify(characters[2])) as Obj, type: 'group', chaId: 'group-one', name: 'Group One', characters: [characters[0].chaId, characters[1].chaId], characterTalks: [0.5, 0.5], characterActive: [true, true] })
        ;(fixture as unknown as Obj).characterOrder = characters.map(slot => slot.chaId)
    }
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(fixture)) as Database, env, fakeLists)
    const residentId = (fixture.characters[0] as unknown as Obj).chaId
    const read = await readTreeBytes(memory, seeded.manifestKey, {
        resident: (input) => new Set(input.entries.filter((entry) => entry.chaId === residentId).map((entry) => entry.u)),
    })
    if (read.status !== 'ok') {
        throw new Error(`The seeded tree read ${read.status}.`)
    }
    const db = assembleDatabase(read.tree.manifest, read.tree.source, {
        character: (entry, units) => (entry.chaId === residentId ? assembleCharacter(entry, units) : stubFromEntry(entry)),
    })
    const previous = previousOfTree(read.tree)
    const all = (previous.objects?.shards ?? []).flatMap((shard) => shard.entries)
    const entries = [residentId, ...fixture.characters.slice(1).map((slot) => (slot as unknown as Obj).chaId)]
        .map((chaId) => all.find((entry) => entry.chaId === chaId) as ShardEntry)
    const context = { lists: fakeLists, env: seededEnv(77), encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW }) }
    registerResidency(createResidency({ backend: options.backend?.(memory) ?? memory, context }))
    const full = await readTreeBytes(memory, seeded.manifestKey)
    if (full.status !== 'ok') {
        throw new Error('The full read failed.')
    }
    getDatabaseMock.mockImplementation(() => db)
    return { memory, db, entries, source: full.tree.source }
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    unitMem.clear()
    unitReadLog.length = 0
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    forageSetItemMock.mockClear()
    alertConfirmMock.mockClear()
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    vi.mocked(setDatabase).mockClear()
    resetResidencyForTest()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    forageSetItemMock.mockImplementation(async () => { })
    injectAppStore(createForageBackedStore({
        getItem: async (key) => {
            if (isUnitKey(key)) {
                unitReadLog.push(key)
                return unitMem.get(key) ?? null
            }
            return forageGetItemMock(key)
        },
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
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })

    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })

})

afterEach(() => {
    resetResidencyForTest()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

import { setColdStorageItem } from 'src/ts/process/coldstorage.svelte'

const PID = '0b6f3f3e-1d2c-4a5b-9c8d-7e6f5a4b3c2d'

function payloadOf(name: string): unknown {
    const entry = writtenEntries().find((e) => e.name === name)
    return entry === undefined ? undefined : JSON.parse(decoder.decode(entry.data))
}

async function exportedPluginStorage(): Promise<Record<string, unknown>> {
    const entry = writtenEntries().find((e) => e.name === 'database.risudat')
    if (!entry) {
        throw new Error('the export wrote no database entry')
    }
    return ((await decodeRisuSave(entry.data)) as unknown as { pluginCustomStorage: Record<string, unknown> }).pluginCustomStorage
}

const writers = [
    { label: 'SaveLocalBackup', run: SaveLocalBackup },
    { label: 'SavePartialLocalBackup', run: SavePartialLocalBackup },
]

const PID2 = '1c7a4a4e-2e3d-4b6c-8d9e-8f7a6b5c4d3e'

function entriesNamed(name: string): number {
    return writtenEntries().filter((e) => e.name === name).length
}

/**
 * A V3 plugin slot's value in a .bin export: the export writes each mapped value as the `coldstorage_<id>` payload the
 * legacy collector would write, so the fork's re-import restores it.
 */
describe.each(writers)('plugin storage in the .bin of $label', ({ run }) => {
    test('reproducer: a converted store2 page exports the tree value, not the stale legacy unit, with no prompt and no plain key', async () => {
        expect(await setColdStorageItem(PID, { v: 'stale' })).toBe(true)
        const page = await pageOf()
        page.db.pluginCustomStorage = { _coldplugin: { prefs: PID }, [PID]: { v: 'fresh' } } as never

        await run()

        expect(payloadOf(`coldstorage_${PID}.json`)).toEqual({ v: 'fresh' })
        expect(entriesNamed(`coldstorage_${PID}.json`)).toBe(1)
        expect(backupPrompts()).toEqual([])
        expect(await exportedPluginStorage()).toEqual({ _coldplugin: { prefs: PID } })
        // The page itself keeps its value: only the exported copy leaves the plain key out.
        expect(page.db.pluginCustomStorage[PID]).toEqual({ v: 'fresh' })
    })

    test('reproducer: a seeded store2 page, with no legacy unit, exports the tree value', async () => {
        const page = await pageOf()
        page.db.pluginCustomStorage = { _coldplugin: { prefs: PID }, [PID]: { v: 'fresh' } } as never

        await run()

        expect(payloadOf(`coldstorage_${PID}.json`)).toEqual({ v: 'fresh' })
        expect(backupPrompts()).toEqual([])
        expect(await exportedPluginStorage()).toEqual({ _coldplugin: { prefs: PID } })
    })

    test('reproducer: a mapped id with no value is named as plugin storage in the incomplete-data prompt', async () => {
        const page = await pageOf()
        page.db.pluginCustomStorage = { _coldplugin: { prefs: PID } } as never

        await run()

        const prompts = backupPrompts()
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('Plugin storage "prefs"')
        expect(prompts[0]).not.toContain('unknown characters')
        expect(payloadOf(`coldstorage_${PID}.json`)).toBeUndefined()
    })

    test('reproducer: a slot first mapped while the export runs is written once, and the page keeps its value', async () => {
        const page = await pageOf()
        page.db.pluginCustomStorage = { _coldplugin: { prefs: PID }, [PID]: { v: 'fresh' } } as never
        // The first collection has settled and is writing its payloads: map a new slot before the late stage encodes.
        let mapped = false
        vi.mocked(alertWait).mockImplementation((message: string) => {
            if (!mapped && message.includes('Cold data')) {
                mapped = true
                const storage = page.db.pluginCustomStorage as Record<string, unknown> & { _coldplugin: Record<string, string> }
                storage._coldplugin.late = PID2
                storage[PID2] = { v: 'late' }
            }
            return { type: 'wait', msg: message }
        })

        await run()

        expect(entriesNamed(`coldstorage_${PID}.json`)).toBe(1)
        expect(entriesNamed(`coldstorage_${PID2}.json`)).toBe(1)
        expect(payloadOf(`coldstorage_${PID2}.json`)).toEqual({ v: 'late' })
        expect(backupPrompts()).toEqual([])
        expect(await exportedPluginStorage()).toEqual({ _coldplugin: { prefs: PID, late: PID2 } })
        expect(page.db.pluginCustomStorage[PID2]).toEqual({ v: 'late' })
        expect(page.db.pluginCustomStorage[PID]).toEqual({ v: 'fresh' })
    })

    test('guard: a legacy page exports the unit from the legacy store and keeps its plain keys', async () => {
        expect(await setColdStorageItem(PID, { v: 'legacy' })).toBe(true)
        getDatabaseMock.mockImplementation(() => ({
            characters: [],
            pluginCustomStorage: { _coldplugin: { prefs: PID }, plain: { kept: true } },
        }) as unknown as Database)

        await run()

        expect(payloadOf(`coldstorage_${PID}.json`)).toEqual({ v: 'legacy' })
        expect(backupPrompts()).toEqual([])
        expect(await exportedPluginStorage()).toEqual({ _coldplugin: { prefs: PID }, plain: { kept: true } })
    })
})


/**
 * `exportAsDataset` (`src/ts/storage/exportAsDataset.ts`) over a real store2 world: an archived character is a stub whose
 * `coldstorage` is a store2 entity id, and `readColdCharacterCopy` reaches its units through the real
 * `readColdStorageItem` and the registered residency. `exportAsDatasetCold.test.ts` mocks that reader; nothing here does.
 *
 * Every test is a guard (B5 G1 to G6): `exportAsDataset`, the manual clean-up and the backup listing work on a store2
 * page without store2-specific code, so these hold regardless of the backup export. Their failure modes are shown by
 * mutating the implementation, not by being red on an earlier base. The Settings button is in
 * `userSettingsStore2.svelte.test.ts`.
 *
 * The harness is the one `drive/tests/backuplocalStubInline.test.ts` documents, with the download captured instead of
 * written. A passing test is no evidence about the Tauri or Node backends or a phone's memory.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const downloads = vi.hoisted(() => ({ files: [] as Array<{ name: string, data: Buffer }> }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const markCharacterForSaveMock = vi.hoisted(() => vi.fn())

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
    save: vi.fn(async () => 'dataset-output.json'),
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

vi.mock(import('src/ts/storage/characterSaveMarks'), async (importOriginal) => ({
    ...await importOriginal(),
    markCharacterForSave: markCharacterForSaveMock,
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => ({
    ...await importOriginal(),
    downloadFile: async (name: string, data: Buffer) => { downloads.files.push({ name, data }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

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

import { exportAsDataset } from 'src/ts/storage/exportAsDataset'
import { cleanColdStorage } from 'src/ts/process/coldstorage.svelte'
import { getDbBackups } from 'src/ts/globalApi.svelte'
import * as manualCleanupModule from 'src/ts/storage/manualCleanup'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { language } from 'src/lang'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { forageOverMap } from 'src/ts/storage/tests/appStoreMock'
import { createMemoryBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry, type UnitSource } from 'src/ts/storage/store2/codec'
import { keyOfRef, type ShardEntry } from 'src/ts/storage/store2/format'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

//#region helpers

const NOW = 1_700_000_000_000

interface Row {
    name: string
    description?: string
    chats: Array<{ role: string, data: string }>
    lorebook: unknown[]
}

interface Page {
    memory: MemoryBackend
    db: Database
    /** The entries of the booted tree: the first is resident, the others are stubs. */
    entries: ShardEntry[]
    source: UnitSource
}

/** msgpackr 1.10.1 under Node rejects strings of 64 or more characters (the goldens README records it), so the fixture keeps them short. */
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

/** A store2 page: the first character resident, the others stubs of their entities, the residency registered. */
async function pageOf(options: { backend?: (memory: MemoryBackend) => Store2Backend, group?: boolean } = {}): Promise<Page> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(3)) as Obj), archiveCharacters: true } as unknown as Database
    if (options.group === true) {
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

const wholeOf = (page: Page, entry: ShardEntry) => assembleCharacter(entry, page.source) as unknown as Record<string, unknown>
const stubAt = (page: Page, index: number): Obj => page.db.characters[index] as unknown as Obj

/** The rows of the dataset the last export downloaded. */
function exportedRows(): Row[] {
    expect(downloads.files).toHaveLength(1)
    expect(downloads.files[0].name).toBe('dataset.json')
    return JSON.parse(downloads.files[0].data.toString('utf-8')) as Row[]
}

/** The notice the person was shown at the end. */
const notice = (): string => String(alertNormalMock.mock.calls.at(-1)?.[0])

/** The rows `exportAsDataset` writes for `characters`, with the page's characters temporarily replaced by them. */
async function rowsOf(page: Page, characters: unknown[]): Promise<Row[]> {
    const original = page.db.characters
    page.db.characters = characters as never
    try {
        downloads.files.length = 0
        await exportAsDataset()
        return exportedRows()
    } finally {
        page.db.characters = original
    }
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    downloads.files.length = 0
    alertNormalMock.mockClear()
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    markCharacterForSaveMock.mockClear()
    resetResidencyForTest()
    injectAppStore(createForageBackedStore(forageOverMap(new Map())))
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('exportAsDataset over a real store2 world', () => {
    test('guard (G1): the stubs give the rows of the same tree held whole, and their chats come from the units, not the placeholder', async () => {
        const page = await pageOf()
        const whole = page.entries.map((entry, index) => (index === 0 ? stubAt(page, 0) : wholeOf(page, entry)))
        const expected = await rowsOf(page, whole)
        expect(expected.length).toBeGreaterThan(0)

        downloads.files.length = 0
        await exportAsDataset()

        const rows = exportedRows()
        expect(rows).toEqual(expected)
        // The placeholder chat of a stub has an empty message; every row of a stub carries real text.
        const stubNames = page.entries.slice(1).map((entry) => entry.name)
        const stubRows = rows.filter((row) => stubNames.includes(row.name))
        expect(stubRows.length).toBeGreaterThan(0)
        for (const row of stubRows) {
            expect(row.chats.some((message) => message.data !== '')).toBe(true)
        }
        expect(notice()).toBe(language.successExport)
    })

    test('guard (G2): an entity that is not in the acknowledged tree, a damaged unit and a failing store each skip the character, name it, and keep the rest', async () => {
        for (const breakIt of ['absent', 'damaged', 'store-error'] as const) {
            downloads.files.length = 0
            alertNormalMock.mockClear()
            resetResidencyForTest()
            let failReads = false
            const page = await pageOf({
                backend: (memory) => ({
                    ...memory,
                    readUnits: async (keys) => {
                        if (failReads) {
                            throw new TypeError('the store is down')
                        }
                        return memory.readUnits(keys)
                    },
                }),
            })
            const victim = page.entries[2]
            if (breakIt === 'absent') {
                stubAt(page, 2).coldstorage = 'a'.repeat(26)
            } else if (breakIt === 'damaged') {
                page.memory.poke(keyOfRef(victim.chats[0].chunks[0]), null)
            } else {
                failReads = true
            }

            await exportAsDataset()

            const rows = exportedRows()
            const names = new Set(rows.map((row) => row.name))
            expect(names.has(page.entries[0].name), breakIt).toBe(true)
            expect(names.has(victim.name), breakIt).toBe(false)
            expect(notice(), breakIt).toContain(victim.name)
            expect(notice(), breakIt).toContain(language.successExport)
            if (breakIt !== 'store-error') {
                // One stub is read fine while the other fails; with the store down both are skipped.
                expect(names.has(page.entries[1].name), breakIt).toBe(true)
                expect(notice(), breakIt).not.toContain(page.entries[1].name)
            } else {
                expect(notice(), breakIt).toContain(page.entries[1].name)
            }
        }
    })

    test('guard (G3): a stub typed as a group gives no rows and is not named; a stub typed as a character whose unit holds a group likewise', async () => {
        const page = await pageOf({ group: true })
        const groupIndex = page.entries.length - 1
        expect(stubAt(page, groupIndex).type).toBe('group')

        await exportAsDataset()

        let rows = exportedRows()
        expect(rows.some((row) => row.name === 'Group One')).toBe(false)
        expect(rows.some((row) => row.name === page.entries[1].name)).toBe(true)
        expect(notice()).toBe(language.successExport)

        // The placeholder another build writes for an archived group: typed as a character, the unit says group.
        stubAt(page, groupIndex).type = 'character'
        downloads.files.length = 0
        alertNormalMock.mockClear()

        await exportAsDataset()

        rows = exportedRows()
        expect(rows.some((row) => row.name === 'Group One')).toBe(false)
        expect(notice()).toBe(language.successExport)
    })

    test('guard (G4): nothing is marked for save, the stubs stay in their slots, and reads go one entity at a time', async () => {
        let inFlight = 0
        let maxInFlight = 0
        const page = await pageOf({
            backend: (memory) => ({
                ...memory,
                readUnits: async (keys) => {
                    inFlight++
                    maxInFlight = Math.max(maxInFlight, inFlight)
                    try {
                        await new Promise((resolve) => setTimeout(resolve, 0))
                        return await memory.readUnits(keys)
                    } finally {
                        inFlight--
                    }
                },
            }),
        })
        const before = [...page.db.characters]
        const entities = [1, 2].map((index) => stubAt(page, index).coldstorage)

        await exportAsDataset()

        expect(maxInFlight).toBe(1)
        expect(markCharacterForSaveMock).not.toHaveBeenCalled()
        expect(page.db.characters.length).toBe(before.length)
        for (const [index, slot] of before.entries()) {
            expect(page.db.characters[index]).toBe(slot)
        }
        expect([1, 2].map((index) => stubAt(page, index).coldstorage)).toEqual(entities)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

/** An app store over `items` that records every operation, so a test can assert that an operation did not touch the store. */
function recordingStore(items: Map<string, Uint8Array>): { operations: string[] } {
    const operations: string[] = []
    injectAppStore(createForageBackedStore({
        getItem: async (key) => { operations.push(`read ${key}`); return items.get(key) ?? null },
        setItem: async (key, value) => { operations.push(`write ${key}`); items.set(key, value) },
        keys: async () => { operations.push('list'); return [...items.keys()].sort() },
        removeItem: async (key) => { operations.push(`delete ${key}`); items.delete(key) },
    }))
    return { operations }
}

describe('what stays closed on a store2 page', () => {
    afterEach(() => {
        resetPageStorageModeForTests()
    })

    test('guard (G5 backstops): the manual clean-up returns with a console warning before it reads or deletes anything, and shows no error', async () => {
        setPageStorageMode({ kind: 'store2' })
        const items = new Map<string, Uint8Array>([['coldstorage/00000000-0000-4000-8000-000000000001', new Uint8Array([1])], ['assets/a', new Uint8Array([2])]])
        const { operations } = recordingStore(items)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const manualCleanup = vi.spyOn(manualCleanupModule, 'runManualCleanup')

        // The settings entry point stops before it reaches the clean-up at all.
        await cleanColdStorage()
        expect(manualCleanup).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
        // The clean-up itself stops before any read when it is called directly.
        await manualCleanupModule.runManualCleanup()

        expect(operations).toEqual([])
        expect(items.size).toBe(2)
        expect(warn).toHaveBeenCalledTimes(2)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('guard (G6): the numbered database backups of a store2 page are all listed and none is deleted', async () => {
        setPageStorageMode({ kind: 'store2' })
        const items = new Map<string, Uint8Array>()
        for (let time = 1; time <= 25; time++) {
            items.set(`database/dbbackup-${time}.bin`, new Uint8Array([time]))
        }
        const { operations } = recordingStore(items)

        const times = await getDbBackups()

        expect(times).toHaveLength(25)
        expect(times[0]).toBe(25)
        expect(operations.filter((operation) => operation.startsWith('delete'))).toEqual([])
        expect(items.size).toBe(25)
    })

    test('guard (G6 control): a legacy page prunes to its twenty newest, so the store2 result is the mode and not an empty prune', async () => {
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        const items = new Map<string, Uint8Array>()
        for (let time = 1; time <= 25; time++) {
            items.set(`database/dbbackup-${time}.bin`, new Uint8Array([time]))
        }
        recordingStore(items)

        const times = await getDbBackups()

        expect(times).toHaveLength(20)
        expect(items.size).toBe(20)
    })
})

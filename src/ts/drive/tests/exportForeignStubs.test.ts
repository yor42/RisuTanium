/**
 * The export's live-list marker check (`assertNoForeignModuleStubs`, `src/ts/drive/exportModules.ts`) refuses only a
 * foreign module stub: no residency, no acknowledged entry for the id, an edited marker or a stub that cannot be read as
 * JSON. A recorded stub is not foreign. The encoder checks and the snapshot-list (tree) checks stay on the total
 * `assertNoModuleStubs`, so a recorded stub still never reaches an encoder.
 *
 * Row labels: M = new symbol (red at the base because the symbol does not exist), M/rig = a through-export row that is
 * also red at the base on the refusal's `where`, G = guard (passes before and after; it pins the total checks the
 * narrowing must not touch: the helper, the six encoder checks). The narrowing is inert for a real store2 page, whose snapshot
 * installs every stub before the live check, so no row here is an R. A passing test is not evidence about a real page.
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

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[], opened: 0 }))
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

//#region the legacy OPFS stand-in

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
import { assertNoForeignModuleStubs } from 'src/ts/drive/exportModules'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { assertNoModuleStubs, ModuleStubRefusal, MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import { encodeRisuSaveCompressionStream, encodeRisuSaveLegacy, encodeRisuSaveParts, RisuSaveEncoder } from 'src/ts/storage/risuSave'
import { writeRisuSaveV0 } from 'src/ts/storage/risuSaveV0'
import type { ModuleEntry } from 'src/ts/storage/store2/format'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import type { Residency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'

//#region helpers

const MODULE_ID = 'stub-id-1'
const MODULE_NAME = 'Stub Module Name'

function entryOf(over: Partial<ModuleEntry> = {}): ModuleEntry {
    return {
        id: MODULE_ID,
        name: MODULE_NAME,
        description: 'about the stub',
        unit: ['u-stub', 10, 1, 1],
        al: ['a-stub', 5, 2, 3],
        il: null,
        hasToggle: false,
        dsp: false,
        ...over,
    }
}

/** A residency that answers only the acknowledged-entry lookup, by `<id>#0`; nothing else of it is reachable from the check. */
function registerEntries(entries: ModuleEntry[]): void {
    const double = {
        moduleEntryOf: (handle: string) => entries.find((one) => `${one.id}#0` === handle) ?? null,
    } satisfies Pick<Residency, 'moduleEntryOf'>
    registerResidency(double as unknown as Residency)
}

/** A minimal database tree for the block encoders, holding the given module list. */
function encoderTree(modules: unknown): Database {
    return {
        formatversion: 5,
        botPresets: [{ name: 'preset one' }],
        modules,
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [{ chaId: 'cha-a', type: 'character', name: 'A', chats: [{ message: [{ role: 'char', data: 'hi' }] }] }],
    } as unknown as Database
}

/** The stub minted from the recorded entry: a recorded stub. */
function recordedStub(): Record<string, unknown> {
    return { ...moduleStubOf(entryOf()) }
}

function refusalOf(run: () => void): ModuleStubRefusal {
    try {
        run()
    } catch (error) {
        expect(error).toBeInstanceOf(ModuleStubRefusal)
        return error as ModuleStubRefusal
    }
    throw new Error('the check did not throw')
}

/** Makes `db` the live database for both readers: `getDatabase()` and the `DBState.db` that `acquireModule` reads. */
function installDatabase(db: Database): void {
    getDatabaseMock.mockImplementation(() => db)
    DBState.db = db
}

/**
 * A live database whose module list is read twice by the export: the snapshot sees `atCall` with no residency, and every
 * later read (the live check) sees `afterSnapshot` once a residency holds the recorded entry.
 */
function installDatabaseSeenTwice(atCall: Record<string, unknown>, afterSnapshot: Record<string, unknown>): void {
    const db = databaseWith(null)
    let reads = 0
    Object.defineProperty(db, 'modules', {
        get: () => {
            if (reads++ === 0) {
                return [atCall]
            }
            registerEntries([entryOf()])
            return [afterSnapshot]
        },
        configurable: true,
    })
    installDatabase(db)
}

function databaseWith(stub: Record<string, unknown> | null): Database {
    const modules: Array<Record<string, unknown>> = [{ id: 'full-id-1', name: 'Full Module', lorebook: [] }]
    if (stub !== null) {
        modules.push(stub)
    }
    return {
        characters: [{ chaId: 'a', name: 'A', type: 'character', chatPage: 0, chats: [], image: '' }],
        personas: [],
        characterOrder: ['a'],
        botPresets: [],
        modules,
    } as unknown as Database
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    backupSink.opened = 0
    forageKeysMock.mockReset()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockReset()
    forageGetItemMock.mockImplementation(async () => null)
    alertErrorMock.mockClear()
    const unitMem = new Map<string, Uint8Array>()
    injectAppStore(createForageBackedStore({
        getItem: async (key) => (key.startsWith('coldstorage/') ? (unitMem.get(key) ?? null) : forageGetItemMock(key)),
        setItem: async (key, value) => {
            if (key.startsWith('coldstorage/')) {
                unitMem.set(key, value)
                return
            }
            await forageSetItemMock(key, value)
        },
        keys: async () => [...(await forageKeysMock()), ...unitMem.keys()],
        removeItem: async (key) => { unitMem.delete(key) },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
    resetResidencyForTest()
})

afterEach(() => {
    vi.restoreAllMocks()
    resetResidencyForTest()
})

describe('assertNoForeignModuleStubs (M: the symbol does not exist at the base)', () => {
    test('M: a recorded stub passes', () => {
        registerEntries([entryOf()])
        expect(() => assertNoForeignModuleStubs([recordedStub()], 'where')).not.toThrow()
    })

    test('M: a list with no stub, a resident module and a non-list pass', () => {
        registerEntries([entryOf()])
        expect(() => assertNoForeignModuleStubs([{ id: 'x', name: 'X', lorebook: [] }], 'where')).not.toThrow()
        expect(() => assertNoForeignModuleStubs(undefined, 'where')).not.toThrow()
        expect(() => assertNoForeignModuleStubs('modules', 'where')).not.toThrow()
    })

    test('M: a recorded stub passes in an object of modules too (scanned by values)', () => {
        registerEntries([entryOf()])
        expect(() => assertNoForeignModuleStubs({ one: recordedStub() }, 'where')).not.toThrow()
        registerEntries([])
        expect(refusalOf(() => assertNoForeignModuleStubs({ one: recordedStub() }, 'where')).moduleId).toBe(MODULE_ID)
    })

    test('M: a marker that is not the recorded one is refused, naming the module and the call site', () => {
        registerEntries([entryOf()])
        const edited = { ...recordedStub(), name: 'Renamed' }
        const refusal = refusalOf(() => assertNoForeignModuleStubs([edited], 'writeLocalBackup'))
        expect(refusal.moduleId).toBe(MODULE_ID)
        expect(refusal.moduleName).toBe('Renamed')
        expect(refusal.where).toBe('writeLocalBackup')
        const grown = { ...recordedStub(), lorebook: [] }
        refusalOf(() => assertNoForeignModuleStubs([grown], 'where'))
    })

    test('M: a bare marker with no recorded fields is refused', () => {
        registerEntries([entryOf()])
        refusalOf(() => assertNoForeignModuleStubs([{ id: MODULE_ID, name: MODULE_NAME, [MODULE_STUB_KEY]: MODULE_STUB_VALUE }], 'where'))
    })

    test('M: a stub with no acknowledged entry for its id is refused', () => {
        registerEntries([entryOf({ id: 'another-id' })])
        refusalOf(() => assertNoForeignModuleStubs([recordedStub()], 'where'))
    })

    test('M: a stub with no residency is refused', () => {
        resetResidencyForTest()
        refusalOf(() => assertNoForeignModuleStubs([recordedStub()], 'where'))
    })

    test('M: a marker whose value is not 1 is not a stub and passes (as for assertNoModuleStubs)', () => {
        registerEntries([])
        expect(() => assertNoForeignModuleStubs([{ id: 'x', [MODULE_STUB_KEY]: 2 }], 'where')).not.toThrow()
    })

    test('M: a stub that cannot be read as JSON is refused as ModuleStubRefusal, not as a codec error', () => {
        registerEntries([entryOf()])
        const nonJson = { ...recordedStub(), big: 10n }
        refusalOf(() => assertNoForeignModuleStubs([nonJson], 'where'))
    })
})

describe('the total checks keep refusing a recorded stub (G: pass before and after)', () => {
    test('G: assertNoModuleStubs, the encoder and tree check, refuses a recorded stub', () => {
        registerEntries([entryOf()])
        const refusal = refusalOf(() => assertNoModuleStubs([recordedStub()], 'tree'))
        expect(refusal.where).toBe('tree')
    })

    // Each of the six encoder checks keeps the total check while a residency holds the stub's entry: a check switched
    // to the foreign-only sibling, or skipped once a residency exists, lets a recorded stub be written as a module body.
    const encoderRuns: Array<[string, (stub: Record<string, unknown>) => Promise<unknown>]> = [
        ['encodeRisuSaveLegacy', async (stub) => encodeRisuSaveLegacy({ modules: [stub] })],
        ['encodeRisuSaveCompressionStream', async (stub) => encodeRisuSaveCompressionStream({ modules: [stub] })],
        ['encodeRisuSaveParts', async (stub) => encodeRisuSaveParts({ modules: [stub] })],
        ['RisuSaveEncoder.init', async (stub) => {
            await new RisuSaveEncoder().init(encoderTree([stub]), { compression: false })
        }],
        ['RisuSaveEncoder.set', async (stub) => {
            const modules: unknown[] = [{ id: 'full-id-1', name: 'Full Module', lorebook: [] }]
            const db = encoderTree(modules)
            const encoder = new RisuSaveEncoder()
            await encoder.init(db, { compression: false })
            modules.push(stub)
            await encoder.set(db, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
        }],
        ['writeRisuSaveV0', async (stub) => writeRisuSaveV0(encoderTree([stub]), {})],
    ]

    test.each(encoderRuns)('G: %s refuses a recorded stub while a residency holds its entry', async (_name, run) => {
        registerEntries([entryOf()])
        let caught: unknown
        try {
            await run(recordedStub())
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(Error)
        expect((caught as Error).message).toContain(MODULE_ID)
        expect((caught as Error).message).toContain(MODULE_NAME)
    })
})

describe.each([
    ['writeLocalBackup', SaveLocalBackup],
    ['writePartialLocalBackup', SavePartialLocalBackup],
])('%s through the export', (functionName, run) => {
    // The page has no residency when the snapshot reads the list, so the snapshot keeps the stub as it was at the call;
    // the residency holding the stub's entry exists when the live check reads the list again, and the list then holds
    // the stub the row names. That is how a marker written after the snapshot reaches the live check. The foreign-stub
    // rows below pass at the base apart from the import of the new symbol: the total live check refuses them there
    // with the same `where`. They discriminate through the scratch mutants (sibling accepting everything, no
    // CodecInputError catch), not through a base failure.
    test('M: a non-JSON stub fails the export with ModuleStubRefusal and the generic text, writing nothing', async () => {
        installDatabaseSeenTwice(recordedStub(), { ...recordedStub(), big: 10n })

        const outcome = await run()

        expect(outcome.status).toBe('failed')
        if (outcome.status !== 'failed') {
            throw new Error('unreachable')
        }
        expect(outcome.cause).toBeInstanceOf(ModuleStubRefusal)
        expect((outcome.cause as ModuleStubRefusal).where).toBe(functionName)
        expect(outcome.file).toBe('untouched')
        expect(String(alertErrorMock.mock.calls[0][0])).toBe(language.backupFailedNothingWritten())
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
    })

    test('M: an edited marker fails the export at the live check, writing nothing', async () => {
        installDatabaseSeenTwice(recordedStub(), { ...recordedStub(), name: 'Renamed' })

        const outcome = await run()

        expect(outcome.status).toBe('failed')
        if (outcome.status !== 'failed') {
            throw new Error('unreachable')
        }
        expect((outcome.cause as ModuleStubRefusal).where).toBe(functionName)
        expect(backupSink.opened).toBe(0)
    })

    test('M/rig: the narrowed live check lets a recorded stub through and the snapshot-list tree check refuses it, writing nothing', async () => {
        // The snapshot kept the stub (no residency at the call). The `where` of the refusal names the snapshot-list
        // check; with the total check restored at the live site the refusal names the live site and this row is red.
        installDatabaseSeenTwice(recordedStub(), recordedStub())

        const outcome = await run()

        expect(outcome.status).toBe('failed')
        if (outcome.status !== 'failed') {
            throw new Error('unreachable')
        }
        expect(outcome.cause).toBeInstanceOf(ModuleStubRefusal)
        expect((outcome.cause as ModuleStubRefusal).where).toBe(`${functionName} snapshot`)
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
    })
})

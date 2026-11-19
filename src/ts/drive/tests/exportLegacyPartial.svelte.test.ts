/**
 * A `.bin` export from a read-only legacy page that holds a partly decoded tree or a numbered backup asks before it writes:
 * `SaveLocalBackup`, `SavePartialLocalBackup` and `exportThisTabBackup` run for real over a store2 page whose
 * characters are the fixture, with the page's legacy-partial fact set the way the boot sets it. The prompt comes first, so
 * the writer is not opened (no stream is created on the web, no save dialog is shown on Tauri) while it is on screen or after
 * a decline. The browser writer stand-in and the dialog are mocks; a passing test says nothing about a native writer.
 *
 * Titles: `new contract` rows fail on a build whose export does not ask; `guard` rows pass before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SalvageOmittedBlock } from 'src/ts/storage/risuSave'
import { language } from 'src/lang'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

/** What the writer stand-in is handed, kept by reference. */
const sink = vi.hoisted(() => ({
    chunks: [] as Uint8Array[],
    closedFile: null as Uint8Array | null,
}))

/** What the wrapped `exportInline` returned to `backuplocal`, and the count of web streams opened. */
const captured = vi.hoisted(() => ({
    cold: null as unknown,
    opens: 0,
}))

const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertWaitMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const saveDialogMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'backup-output.bin'))

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
    save: saveDialogMock,
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => {
            captured.opens++
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => {
                            sink.chunks.push(chunk)
                        },
                        close: async () => {
                            const file = new Uint8Array(sink.chunks.reduce((n, chunk) => n + chunk.length, 0))
                            let offset = 0
                            for (const chunk of sink.chunks) {
                                file.set(chunk, offset)
                                offset += chunk.length
                            }
                            sink.closedFile = file
                        },
                    }),
                },
            }
        },
    },
}))

vi.mock(import('src/ts/drive/exportInline'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        collectBackupColdStorage: async (...args: Parameters<typeof actual.collectBackupColdStorage>) => {
            const cold = await actual.collectBackupColdStorage(...args)
            captured.cold = cold
            return cold
        },
    }
})

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
    alertWait: alertWaitMock,
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

import { SaveLocalBackup, SavePartialLocalBackup, exportThisTabBackup, type BackupExportOptions, type ExportOutcome } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry } from 'src/ts/storage/store2/codec'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { resetLegacyPartialSaveForTests, setLegacyPartialSave, type LegacyPartialSave } from 'src/ts/storage/legacyPartialSave'

//#region helpers

const NOW = 1_700_000_000_000
const BACKUP_TIME = 1_700_000_001_000
const FULL_WAIT = 'Saving local backup...'
const PARTIAL_WAIT = 'Saving partial local backup...'

/** A string value of 64 or more characters is rejected by the msgpack decoder under Node, so the fixture keeps them short. */
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

/** A store2 page of four characters, the first resident and the other three stubs, with the store2 residency registered. */
async function pageOf(): Promise<void> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(4)) as Obj), archiveCharacters: true } as unknown as Database
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
    const context = { lists: fakeLists, env: seededEnv(77), encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW }) }
    registerResidency(createResidency({ backend: memory, context }))
    getDatabaseMock.mockImplementation(() => db)
}

function omittedOf(kind: SalvageOmittedBlock['kind']): ReadonlyMap<string, SalvageOmittedBlock> {
    return new Map([['b', { kind, reason: 'synthetic' }]])
}

const partialFact = (): LegacyPartialSave => ({ backupTime: null, omitted: omittedOf('character') })
const backupFact = (): LegacyPartialSave => ({ backupTime: BACKUP_TIME, omitted: new Map() })

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>
const STUB: BackupExportOptions = { mode: 'stub' }

const askedWith = (marker: string): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((message) => message.includes(marker))

/** The closing sentence of the export prompt, a literal of the text. */
const PROMPT_END = 'Save the backup anyway?'

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    sink.chunks.length = 0
    sink.closedFile = null
    captured.cold = null
    captured.opens = 0
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    forageSetItemMock.mockClear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertWaitMock.mockClear()
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    saveDialogMock.mockReset()
    saveDialogMock.mockImplementation(async () => 'backup-output.bin')
    resetResidencyForTest()
    resetLegacyPartialSaveForTests()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    forageSetItemMock.mockImplementation(async () => { })
    injectAppStore(createForageBackedStore({
        getItem: async (key) => forageGetItemMock(key),
        setItem: async (key, value) => { await forageSetItemMock(key, value) },
        keys: async () => await forageKeysMock(),
        removeItem: async () => { },
    }))
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetResidencyForTest()
    resetLegacyPartialSaveForTests()
    vi.restoreAllMocks()
})

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner, FULL_WAIT],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner, PARTIAL_WAIT],
    ['exportThisTabBackup', exportThisTabBackup as Runner, PARTIAL_WAIT],
])('%s of a page that holds a legacy partial fact', (_name, run, waitText) => {
    test('new contract: the prompt names what is missing, is asked before the writer opens, and a decline writes and opens nothing (web)', async () => {
        await pageOf()
        setLegacyPartialSave(partialFact())
        const prompt = language.legacyPartialExportConfirm(null, ['1 character'])
        const atPrompt = { opens: -1, chunks: -1, cold: undefined as unknown, dialogs: -1 }
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message === prompt) {
                atPrompt.opens = captured.opens
                atPrompt.chunks = sink.chunks.length
                atPrompt.cold = captured.cold
                atPrompt.dialogs = saveDialogMock.mock.calls.length
                return false
            }
            return true
        })

        const outcome = await run(STUB)

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(askedWith(PROMPT_END)).toEqual([prompt])
        // The prompt is the first of the export: before the writer's stream, any chunk and the cold-storage collection.
        expect(atPrompt).toEqual({ opens: 0, chunks: 0, cold: null, dialogs: 0 })
        expect(captured.opens).toBe(0)
        expect(sink.chunks).toEqual([])
        expect(sink.closedFile).toBeNull()
        expect(alertErrorMock).not.toHaveBeenCalled()
    }, 120_000)

    test('new contract: a decline opens no save dialog on Tauri either', async () => {
        platformBox.isTauri = true
        await pageOf()
        setLegacyPartialSave(partialFact())
        const prompt = language.legacyPartialExportConfirm(null, ['1 character'])
        let dialogsAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message === prompt) {
                dialogsAtPrompt = saveDialogMock.mock.calls.length
                return false
            }
            return true
        })

        const outcome = await run(STUB)

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(askedWith(PROMPT_END)).toEqual([prompt])
        expect(dialogsAtPrompt).toBe(0)
        expect(saveDialogMock).not.toHaveBeenCalled()
        expect(captured.opens).toBe(0)
    }, 120_000)

    test('new contract: a page opened from a backup names its date, and accepting saves and shows the export wait again', async () => {
        await pageOf()
        setLegacyPartialSave(backupFact())

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved' })
        const prompts = askedWith(PROMPT_END)
        expect(prompts).toEqual([language.legacyPartialExportConfirm(new Date(BACKUP_TIME * 100).toLocaleString(), [])])
        expect(prompts[0]).toContain(new Date(BACKUP_TIME * 100).toLocaleString())
        expect(sink.closedFile).not.toBeNull()
        // The writer's own wait is on screen again after the prompt, before the file opens.
        const waits = alertWaitMock.mock.calls.map((call) => call[0]).filter((text) => text === waitText)
        expect(waits).toHaveLength(2)
    }, 120_000)

    test('guard: with no fact the export asks nothing of the kind and shows its wait once', async () => {
        await pageOf()

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(askedWith(PROMPT_END)).toEqual([])
        expect(alertWaitMock.mock.calls.map((call) => call[0]).filter((text) => text === waitText)).toHaveLength(1)
        expect(sink.closedFile).not.toBeNull()
    }, 120_000)
})

/**
 * UI-S4 stage E1: a `.bin` export (full and partial) carries `trashOrigins` in the database root with no prompt that
 * names it. It is profile data an upstream build ignores or carries, and the maintainer decision of 2026-11-09 ships
 * it in the root. A restore over the exported root puts the character back where it left.
 *
 * `SaveLocalBackup` and `SavePartialLocalBackup` run for real over a store2 page that holds the field; the browser
 * writer stand-in keeps every chunk and the database entry is decoded from them through `decodeRisuSave`. The restore
 * leg runs the real `restoreCharacterFromTrash` over that decoded root. It does not run `LoadLocalBackup`: the import
 * repairs and block-set steps keep unknown root keys by reading (the legacy `set()` copies every root key but six), and
 * are not exercised here. A passing test says nothing about a native writer or a real store.
 *
 * Titles: `guard` passes with and without the `Database` interface field and the restore change; `reproducer` fails on
 * the code before the change for the named assertion.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

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

const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
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
        createWriteStream: () => ({
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
    CharEmotion: writable({}),
    MobileGUIStack: writable([]),
    OpenRealmStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
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
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
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
    parseMarkdownSafe: vi.fn(),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    importCharacter: vi.fn(),
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

// The export only needs `updateLorebooks`; the restore leg loads the real module through `vi.importActual`.
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

import { SaveLocalBackup, SavePartialLocalBackup, type BackupExportOptions, type ExportOutcome } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

//#region helpers

const decoder = new TextDecoder()
const NOW = 1_700_000_000_000

interface WrittenEntry {
    name: string
    data: Uint8Array
}

/** The entries of a container, in order: a name length, the name, a data length and the data, each length 32 bits little-endian. */
function entriesOf(bytes: Uint8Array): WrittenEntry[] {
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
        entries.push({ name, data: bytes.subarray(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

/** msgpackr under Node rejects strings of 64 or more characters, so the fixture keeps them short. */
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

/** A store2 page of `count` resident characters; `edit` changes the fixture before it is seeded. */
async function pageOf(count: number, edit: (fixture: Obj) => void): Promise<Database> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const shaped = shortened(buildSmall(count)) as Obj
    edit(shaped)
    const fixture = shaped as unknown as Database
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(fixture)) as Database, env, fakeLists)
    const read = await readTreeBytes(memory, seeded.manifestKey)
    if (read.status !== 'ok') {
        throw new Error(`The seeded tree read ${read.status}.`)
    }
    const db = assembleDatabase(read.tree.manifest, read.tree.source)
    const previous = previousOfTree(read.tree)
    const context = { lists: fakeLists, env: seededEnv(77), encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW }) }
    registerResidency(createResidency({ backend: memory, context }))
    getDatabaseMock.mockImplementation(() => db)
    return db
}

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>

/** The database entry of the written file, decoded. */
async function exportedRoot(): Promise<Record<string, unknown>> {
    const entry = entriesOf(sink.closedFile as Uint8Array).find((candidate) => candidate.name === 'database.risudat')
    if (!entry) {
        throw new Error('the export wrote no database entry')
    }
    return await decodeRisuSave(entry.data) as unknown as Record<string, unknown>
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    sink.chunks.length = 0
    sink.closedFile = null
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    forageSetItemMock.mockClear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertErrorMock.mockClear()
    saveDialogMock.mockReset()
    saveDialogMock.mockImplementation(async () => 'backup-output.bin')
    resetResidencyForTest()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    forageSetItemMock.mockImplementation(async () => { })
    injectAppStore(createForageBackedStore({
        getItem: async (key) => forageGetItemMock(key),
        setItem: async (key, value) => { await forageSetItemMock(key, value) },
        keys: async () => [...(await forageKeysMock())],
        removeItem: async () => { },
    }))
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

const TRASHED_AT = 1_700_000_000_000

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a store2 page that holds a trashed character and its origin', (_name, run) => {
    /** a, the trashed C and b; the order holds the folder as the trash left it, without C. */
    async function trashedPage(): Promise<{ a: string, c: string, b: string }> {
        let ids = { a: '', c: '', b: '' }
        await pageOf(3, (fixture) => {
            const characters = fixture.characters as Obj[]
            const [a, c, b] = characters.map((slot) => String(slot.chaId))
            ids = { a, c, b }
            characters[1].trashTime = TRASHED_AT
            fixture.characterOrder = [{ id: 'f1', name: 'F', color: '', data: [a, b] }]
            fixture.trashOrigins = [{ chaId: c, t: TRASHED_AT, folder: 'f1', after: { char: a } }]
        })
        return ids
    }

    test('guard: the array is in the decoded database root and no prompt names it', async () => {
        const { a, c } = await trashedPage()

        const outcome = await run({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved' })
        const root = await exportedRoot()
        expect(root.trashOrigins).toEqual([{ chaId: c, t: TRASHED_AT, folder: 'f1', after: { char: a } }])
        const prompts = alertConfirmMock.mock.calls.map((call) => String(call[0]))
        expect(prompts.some((message) => /trashOrigins/.test(message))).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
    }, 120_000)

    test('reproducer T11: a restore over the exported root lands in the folder, after the same neighbour', async () => {
        const { a, c, b } = await trashedPage()

        await run({ mode: 'inline' })
        const root = await exportedRoot()
        DBState.db = root as unknown as Database
        // Modules the restore never touches, mocked before the real module's import graph loads.
        vi.doMock('src/ts/process/coldCharacterRestore', () => ({ findChaIdHolders: vi.fn(() => []), restoreColdCharacter: vi.fn() }))
        vi.doMock('src/ts/plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: writable({}), loadV3Plugins: vi.fn() }))
        vi.doMock('src/ts/translator/translator', () => ({ translateHTML: vi.fn() }))
        const actual = await vi.importActual<typeof import('src/ts/characters')>('src/ts/characters')
        const trashed = DBState.db.characters.find((slot) => slot.chaId === c)!
        expect(trashed.trashTime).toBe(TRASHED_AT)
        actual.restoreCharacterFromTrash(trashed)

        expect(DBState.db.characterOrder).toEqual([{ id: 'f1', name: 'F', color: '', data: [a, c, b] }])
        expect(DBState.db.trashOrigins).toEqual([])
    }, 120_000)

    test('guard: a page without the field exports a root without it', async () => {
        await pageOf(2, () => { })

        await run({ mode: 'inline' })

        const root = await exportedRoot()
        expect('trashOrigins' in root).toBe(false)
    }, 120_000)
})

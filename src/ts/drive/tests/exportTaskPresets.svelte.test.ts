/**
 * CHORE-616 S2a: a `.bin` export (full and partial) leaves out the page's task presets, behind a prompt that names them
 * before the writer opens; declining writes nothing; a page without any gets no prompt.
 *
 * `SaveLocalBackup` and `SavePartialLocalBackup` run for real over a store2 page that holds task presets; the browser
 * writer stand-in keeps every chunk and the database entry is decoded from them through `decodeRisuSave`. A passing test
 * says nothing about a native writer or a real store.
 *
 * Titles: `reproducer` fails when the omission is absent (the presets reach the file, or no prompt names them);
 * `guard` passes before and after.
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

import { SaveLocalBackup, SavePartialLocalBackup, type BackupExportOptions, type ExportOutcome } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
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
const MARK = 'TASKPRESETMARK'
const PROMPT = 'task preset(s)'

const PRESETS = [
    { id: 'task-0', name: 'Summarize notes', instructions: `${MARK} one`, model: 'm' },
    { id: 'task-1', name: 'Translate', instructions: `${MARK} two`, model: 'm' },
]

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

/** A store2 page of two resident characters that holds `presets` (none when empty). */
async function pageOf(presets: readonly Obj[]): Promise<Database> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(2)) as Obj), ...(presets.length > 0 ? { taskPresets: presets } : {}) } as unknown as Database
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

const taskPrompts = (): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((message) => message.includes(PROMPT))

/** Everything the file holds as text: unit entries as JSON, the database entry decoded and serialized. */
async function fileText(): Promise<string> {
    const parts: string[] = []
    for (const entry of entriesOf(sink.closedFile as Uint8Array)) {
        parts.push(entry.name === 'database.risudat' ? JSON.stringify(await decodeRisuSave(entry.data)) : decoder.decode(entry.data))
    }
    return parts.join('\n')
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

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a store2 page that holds task presets', (_name, run) => {
    test('reproducer: one prompt names every preset before the writer opens, the file holds none, and the page keeps them', async () => {
        const db = await pageOf(PRESETS)
        let chunksAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(PROMPT)) {
                chunksAtPrompt = sink.chunks.length
            }
            return true
        })

        const outcome = await run({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(taskPrompts()).toHaveLength(1)
        expect(chunksAtPrompt).toBe(0)
        expect(taskPrompts()[0]).toContain('Summarize notes')
        expect(taskPrompts()[0]).toContain('Translate')
        const text = await fileText()
        expect(text).not.toContain(MARK)
        expect(text).not.toContain('taskPresets')
        expect((db as unknown as { taskPresets: Obj[] }).taskPresets.map(preset => preset.id)).toEqual(['task-0', 'task-1'])
    }, 120_000)

    test('reproducer: declining the prompt ends the export as declined, with nothing written', async () => {
        await pageOf(PRESETS)
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(PROMPT))

        const outcome = await run({ mode: 'inline' })

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(sink.chunks).toEqual([])
        expect(sink.closedFile).toBeNull()
        expect(alertErrorMock).not.toHaveBeenCalled()
    }, 120_000)

    test('guard: a page without task presets gets no such prompt and no such key in the file', async () => {
        await pageOf([])

        const outcome = await run({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(taskPrompts()).toEqual([])
        expect(await fileText()).not.toContain('taskPresets')
    }, 120_000)
})

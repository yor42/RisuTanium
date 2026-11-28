/**
 * #929 S1b: a `.bin` export translates the per-task parameter modes for upstream, which has no such mode. With the flag on,
 * every task that reads as `same` gets a block that is a copy of the record's main values, in the root and in every preset
 * slot; with the flag off nothing is synthesized. The page is never changed. The export names what the copy cannot carry
 * before the file is written, and declining writes no file.
 *
 * `SaveLocalBackup` runs for real over a store2 page; the browser writer stand-in keeps every chunk and the database entry is
 * decoded through `decodeRisuSave`. A passing test says nothing about a native writer or a real store.
 *
 * Titles: `reproducer` fails on the pre-change base (it keeps the dormant blocks and names nothing); `guard` passes before
 * and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, StoredDatabase } from 'src/ts/storage/database.svelte'
import type { BinLeaveOutEntry } from 'src/ts/drive/binLeaveOut'

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

import { SaveLocalBackup, type BackupExportOptions, type ExportOutcome } from 'src/ts/drive/backuplocal'
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
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'

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

/** A store2 page of two resident characters that holds `fields` in its config root. */
async function pageOf(fields: Obj): Promise<Database> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(2)) as Obj), ...fields } as unknown as Database
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

const run: Runner = (options) => (SaveLocalBackup as Runner)({ mode: 'inline', ...options })

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

//#region fixtures

/** Main values the working settings hold; every one is representable, so a copy of them warns about nothing. */
const ROOT_MAIN = { temperature: 80, top_k: 40, repetition_penalty: 1.1, min_p: 0.1, top_a: 0.2, top_p: 0.9, frequencyPenalty: 30, PresensePenalty: 30, reasoningEffort: 2, thinkingTokens: 2048, verbosity: 2 }
const ROOT_COPY = { temperature: 80, top_k: 40, repetition_penalty: 1.1, min_p: 0.1, top_a: 0.2, top_p: 0.9, frequency_penalty: 30, presence_penalty: 30, reasoning_effort: 2, thinking_tokens: 2048, verbosity: 2 }
/** The same values as a preset slot stores them: its reasoning field is `reasonEffort`. */
const SLOT_MAIN = { temperature: 70, top_k: 30, repetition_penalty: 1.2, min_p: 0.3, top_a: 0.4, top_p: 0.8, frequencyPenalty: 20, PresensePenalty: 25, reasonEffort: 1, thinkingTokens: 1024, verbosity: 0 }
const SLOT_COPY = { temperature: 70, top_k: 30, repetition_penalty: 1.2, min_p: 0.3, top_a: 0.4, top_p: 0.8, frequency_penalty: 20, presence_penalty: 25, reasoning_effort: 1, thinking_tokens: 1024, verbosity: 0 }

const MIX = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }
const ALL_SAME = { memory: 'same', emotion: 'same', translate: 'same', otherAx: 'same' }

function container(extra: Obj = {}): Obj {
    return { memory: { temperature: 11 }, emotion: { temperature: 12 }, translate: {}, otherAx: { top_k: 3 }, overrides: { 'model-x': { temperature: 5 } }, ...extra }
}

function slot(name: string, extra: Obj = {}): Obj {
    return { name, ...SLOT_MAIN, seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MIX } }), ...extra }
}

function rootFields(extra: Obj = {}): Obj {
    return { ...ROOT_MAIN, botPresetsId: 0, seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MIX } }), ...extra }
}

function containerOf(record: unknown): Record<string, unknown> {
    return (record as { seperateParameters: Record<string, unknown> }).seperateParameters
}

function leaveOutOf(summary: readonly BinLeaveOutEntry[]): { presets: readonly string[], lines: readonly string[] } | null {
    const entry = summary.find((candidate) => candidate.kind === 'taskParameters')
    return entry && entry.kind === 'taskParameters' ? entry : null
}

async function askedSummary(options: Partial<BackupExportOptions> = {}): Promise<readonly BinLeaveOutEntry[]> {
    let summary: readonly BinLeaveOutEntry[] = []
    await run({ ...options, askLeaveOut: async (given) => { summary = given; return true } })
    return summary
}

//#endregion

describe('T-R8 a flag-on mix: the same tasks become copies of the main values', () => {
    test('reproducer: root and slot, other tasks and overrides untouched', async () => {
        await pageOf(rootFields({ botPresets: [slot('Mix')] }))

        const outcome = await run()

        expect(outcome).toMatchObject({ status: 'saved' })
        const root = await exportedRoot()
        expect(root.seperateParametersEnabled).toBe(true)
        expect(containerOf(root)).toEqual({ memory: { temperature: 11 }, emotion: ROOT_COPY, translate: ROOT_COPY, otherAx: ROOT_COPY, overrides: { 'model-x': { temperature: 5 } } })
        const slots = root.botPresets as Obj[]
        expect(slots[0].seperateParametersEnabled).toBe(true)
        expect(containerOf(slots[0])).toEqual({ memory: { temperature: 11 }, emotion: SLOT_COPY, translate: SLOT_COPY, otherAx: SLOT_COPY, overrides: { 'model-x': { temperature: 5 } } })
    }, 120_000)

    test('reproducer: a slot that lacks the constant-fallback fields is copied as setPreset loads it', async () => {
        const bare = { name: 'Bare', temperature: 70, frequencyPenalty: 20, PresensePenalty: 25, top_k: 30, seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MIX } }) }
        await pageOf(rootFields({ botPresets: [bare] }))

        await run()

        const copy = containerOf(((await exportedRoot()).botPresets as Obj[])[0]).emotion as Record<string, unknown>
        expect(copy).toEqual({ temperature: 70, top_k: 30, frequency_penalty: 20, presence_penalty: 25, top_p: 1, reasoning_effort: 0, thinking_tokens: null, verbosity: 1 })
    }, 120_000)

    test('reproducer: the same tasks carry equal copies of the main values', async () => {
        await pageOf(rootFields({ botPresets: [slot('Mix')] }))

        await run()

        const written = containerOf(await exportedRoot())
        expect(written.emotion).toEqual(written.translate)
    }, 120_000)
})

describe('T-R15 a flag-off record is never translated', () => {
    test('guard: root and slot keep every block, the key is gone', async () => {
        const off = container({ taskModes: { ...ALL_SAME } })
        await pageOf(rootFields({ seperateParametersEnabled: false, seperateParameters: off, botPresets: [slot('Off', { seperateParametersEnabled: false, seperateParameters: container({ taskModes: { ...ALL_SAME } }) })] }))

        await run()

        const root = await exportedRoot()
        expect(root.seperateParametersEnabled).toBe(false)
        expect(containerOf(root)).toEqual(container())
        expect(containerOf((root.botPresets as Obj[])[0])).toEqual(container())
    }, 120_000)

    test('guard: a flag-on record whose key reads all own synthesizes nothing', async () => {
        const own = { memory: 'own', emotion: 'own', translate: 'own', otherAx: 'own' }
        await pageOf(rootFields({ seperateParameters: container({ taskModes: own }), botPresets: [slot('Own', { seperateParameters: container({ taskModes: own }) })] }))

        await run()

        const root = await exportedRoot()
        expect(containerOf(root)).toEqual(container())
        expect(containerOf((root.botPresets as Obj[])[0])).toEqual(container())
    }, 120_000)

    test('guard: a flag-on record with a raw all-same key and no readable own task reads all own and synthesizes nothing', async () => {
        await pageOf(rootFields({ seperateParameters: container({ taskModes: { ...ALL_SAME } }), botPresets: [] }))

        await run()

        expect(containerOf(await exportedRoot())).toEqual(container())
    }, 120_000)
})

describe('T-C2 an upstream-made flag-off database exports unchanged', () => {
    test('guard: the mirror-made database keeps flag, blocks and overrides byte for byte', async () => {
        const blocks = { memory: { temperature: 11 }, emotion: { top_k: 5 }, translate: {}, otherAx: { top_p: 0.5 }, overrides: { 'model-x': { temperature: 5 } } }
        const upstream = { ...ROOT_MAIN, botPresetsId: 0, botPresets: [{ name: 'Up' }], seperateParametersEnabled: false, seperateParameters: structuredClone(blocks), reasoningEffort: 1 }
        upstreamSaveCurrentPreset(upstream as unknown as StoredDatabase)
        await pageOf(upstream)

        await run()

        const root = await exportedRoot()
        expect(root.seperateParametersEnabled).toBe(false)
        expect(containerOf(root)).toEqual(blocks)
        expect(containerOf((root.botPresets as Obj[])[0])).toEqual(blocks)
    }, 120_000)
})

describe('T-C3 an upstream-made flag-on database round trips unchanged', () => {
    test('guard: without the key every record reads all own, so flag, blocks and overrides survive the export and an upstream save', async () => {
        const blocks = { memory: { temperature: 11 }, emotion: { top_k: 5 }, translate: {}, otherAx: { top_p: 0.5 }, overrides: { 'model-x': { temperature: 5 } } }
        const upstream = { ...ROOT_MAIN, botPresetsId: 0, botPresets: [{ name: 'Up' }], seperateParametersEnabled: true, seperateParameters: structuredClone(blocks) }
        upstreamSaveCurrentPreset(upstream as unknown as StoredDatabase)
        await pageOf(upstream)

        await run()

        const root = await exportedRoot()
        expect(root.seperateParametersEnabled).toBe(true)
        expect(containerOf(root)).toEqual(blocks)
        expect(containerOf((root.botPresets as Obj[])[0])).toEqual(blocks)
        upstreamSaveCurrentPreset(root as unknown as StoredDatabase)
        const resaved = (root.botPresets as Obj[])[0]
        expect(resaved.seperateParametersEnabled).toBe(true)
        expect(containerOf(resaved)).toEqual(blocks)
    }, 120_000)
})

describe('T-R9 and T-R16 the export names what the copy cannot carry', () => {
    test('reproducer: an unrepresentable main value is named per same task, with the preset and the parameter', async () => {
        await pageOf(rootFields({ thinkingTokens: null, botPresets: [slot('Mix', { thinkingTokens: null })] }))

        const summary = await askedSummary()

        const entry = leaveOutOf(summary)
        expect(entry).not.toBeNull()
        expect(entry?.presets).toEqual(['Mix'])
        expect(entry?.lines).toEqual(expect.arrayContaining(['Mix / emotion / thinking_tokens', 'Mix / translate / thinking_tokens', 'Mix / otherAx / thinking_tokens']))
        expect(entry?.lines.some((line) => line.includes('memory'))).toBe(false)
    }, 120_000)

    test('reproducer: a stored block that differs from the copy is named as a replaced block', async () => {
        await pageOf(rootFields({ botPresets: [slot('Mix')] }))

        const entry = leaveOutOf(await askedSummary())

        expect(entry?.lines).toEqual(expect.arrayContaining(['Mix / emotion / replaced block', 'Mix / otherAx / replaced block']))
        expect(entry?.lines.some((line) => line.startsWith('Mix / translate'))).toBe(false)
    }, 120_000)

    test('reproducer: a block equal to its copy and an empty block give no entry, a different one gives one', async () => {
        const equal = container({ emotion: { ...SLOT_COPY }, otherAx: { top_k: 3 }, translate: {}, taskModes: { ...MIX } })
        await pageOf({ botPresetsId: -1, seperateParametersEnabled: false, botPresets: [slot('Mix', { seperateParameters: equal })] })

        const entry = leaveOutOf(await askedSummary())

        expect(entry?.lines).toEqual(['Mix / otherAx / replaced block'])
    }, 120_000)

    test('guard: a flag-off record and a record with every task own name nothing', async () => {
        await pageOf(rootFields({ thinkingTokens: null, seperateParametersEnabled: false, seperateParameters: container({ taskModes: { ...ALL_SAME } }), botPresets: [slot('Off', { thinkingTokens: null, seperateParametersEnabled: false })] }))

        expect(leaveOutOf(await askedSummary())).toBeNull()
    }, 120_000)

    test('reproducer: a mix only in the working settings is named after the selected saved preset', async () => {
        const savedModes = { memory: 'same', emotion: 'same', translate: 'same', otherAx: 'same' }
        await pageOf(rootFields({ thinkingTokens: null, botPresets: [slot('Saved', { seperateParametersEnabled: false, seperateParameters: container({ taskModes: savedModes }) })] }))

        const entry = leaveOutOf(await askedSummary())

        expect(entry?.lines).toEqual(expect.arrayContaining(['Saved / emotion / thinking_tokens', 'Saved / emotion / replaced block']))
        expect(entry?.presets).toEqual(['Saved'])
    }, 120_000)

    test('reproducer: cancelling the sheet writes no file', async () => {
        await pageOf(rootFields({ thinkingTokens: null, botPresets: [slot('Mix', { thinkingTokens: null })] }))

        const outcome = await run({ askLeaveOut: async () => false })

        expect(outcome).toMatchObject({ status: 'declined' })
        expect(sink.closedFile).toBeNull()
        expect(sink.chunks).toEqual([])
    }, 120_000)

    test('reproducer: an unanswered sheet falls back to one prompt that names the lines, and declining writes no file', async () => {
        await pageOf(rootFields({ thinkingTokens: null, botPresets: [slot('Mix', { thinkingTokens: null })] }))
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes('Mix / emotion / thinking_tokens'))

        const outcome = await run({ askLeaveOut: async () => null })

        const prompts = alertConfirmMock.mock.calls.map((call) => call[0]).filter((message) => message.includes('Mix / emotion / thinking_tokens'))
        expect(prompts).toHaveLength(1)
        expect(outcome).toMatchObject({ status: 'declined' })
        expect(sink.closedFile).toBeNull()
    }, 120_000)

    test('guard: with every value representable and no stored block, nothing is asked', async () => {
        await pageOf(rootFields({ seperateParameters: container({ emotion: {}, otherAx: {}, taskModes: { ...MIX } }), botPresets: [slot('Mix', { seperateParameters: container({ emotion: {}, otherAx: {}, taskModes: { ...MIX } }) })] }))
        const askLeaveOut = vi.fn(async () => true)

        await run({ askLeaveOut })

        expect(askLeaveOut).not.toHaveBeenCalled()
        expect(alertConfirmMock).not.toHaveBeenCalled()
    }, 120_000)
})

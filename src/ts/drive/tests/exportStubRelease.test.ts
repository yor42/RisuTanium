/**
 * `writeStubPayloadsAndRelease` in `drive/backuplocal.ts`: a stub's unit entry is let go of once it is written, in the
 * full export and in the partial export.
 *
 * Observed through references, not memory: `exportInline` is wrapped by a passthrough mock that captures what the real
 * `collectBackupColdStorage` and `stubEntriesInTree` return, and the writer stand-in looks at those objects at the moment
 * each stub's entry starts. The writer keeps the very chunks it is handed until `close` and decodes the file there, so an
 * export that zeroed or reused a body after writing it would show in the decoded entries. A passing test says nothing
 * about the garbage collector or about a native writer.
 *
 * Labels in the titles:
 * - `reproducer`: fails against the export path before this change (the stub entries stay referenced from `cold` and the
 *   `stubPayloads` array until the export returns). The array holds the minted entries, which are unpacked one at a time
 *   at their write (`exportStubPacked.test.ts` covers the packing).
 * - `guard`: holds before and after the change.
 *
 * The harness is the one `exportStubForm.test.ts` documents, with the writer and `exportInline` replaced as above.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BackupColdStorage } from 'src/ts/drive/exportInline'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

/** What the writer stand-in is handed, kept by reference, and the hooks the tests set. */
const sink = vi.hoisted(() => ({
    chunks: [] as Uint8Array[],
    onWrite: null as null | ((chunk: Uint8Array) => void),
    closedFile: null as Uint8Array | null,
}))

/** What the wrapped `exportInline` returned to `backuplocal`. */
const captured = vi.hoisted(() => ({
    cold: null as BackupColdStorage | null,
    stubPayloads: null as Array<{ backupName: string }> | null,
    /** The names of the stub entries when the array was returned, in the order they are written. */
    names: [] as string[],
}))

const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
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
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => {
                        sink.onWrite?.(chunk)
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

vi.mock(import('src/ts/drive/exportInline'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        collectBackupColdStorage: async (...args: Parameters<typeof actual.collectBackupColdStorage>) => {
            const cold = await actual.collectBackupColdStorage(...args)
            captured.cold = cold
            return cold
        },
        stubEntriesInTree: (...args: Parameters<typeof actual.stubEntriesInTree>) => {
            const entries = actual.stubEntriesInTree(...args)
            captured.stubPayloads = entries
            captured.names = entries.map((entry) => entry.backupName)
            return entries
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

const unitMem = new Map<string, Uint8Array>()

function isUnitKey(key: string): boolean {
    return key.startsWith('coldstorage/')
}

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
import { coldUnitCharacter } from 'src/ts/process/coldCharacter'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry, type UnitSource } from 'src/ts/storage/store2/codec'
import { type ShardEntry } from 'src/ts/storage/store2/format'
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
const MIB = 1024 * 1024
const UNIT_ENTRY_NAME = /^coldstorage_[0-9a-f-]{36}\.json$/

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

/** The name of the unit entry a chunk starts, or `null` for a chunk that is not the start of one (a body chunk, the database). */
function unitEntryStartedBy(chunk: Uint8Array): string | null {
    if (chunk.length < 8) {
        return null
    }
    const nameLength = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(0, true)
    if (nameLength > 128 || 4 + nameLength > chunk.length) {
        return null
    }
    const name = decoder.decode(chunk.subarray(4, 4 + nameLength))
    return UNIT_ENTRY_NAME.test(name) ? name : null
}

const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

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

interface Page {
    memory: MemoryBackend
    db: Database
    entries: ShardEntry[]
    source: UnitSource
}

/**
 * A store2 page of four characters: the first resident, the other three stubs of their entities. `grow` makes the
 * first chat of a character at least that many bytes of JSON by repeating its first message (short strings only).
 */
async function pageOf(grow: Record<number, number> = {}): Promise<Page> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(4)) as Obj), archiveCharacters: true } as unknown as Database
    for (const [index, bytes] of Object.entries(grow)) {
        const firstChat = ((fixture.characters[Number(index)] as unknown as Obj).chats as Obj[])[0]
        const messages = firstChat.message as Obj[]
        const template = JSON.stringify(messages[0])
        const extra = Math.ceil(bytes / template.length)
        for (let i = 0; i < extra; i++) {
            messages.push(JSON.parse(template) as Obj)
        }
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
    registerResidency(createResidency({ backend: memory, context }))
    const full = await readTreeBytes(memory, seeded.manifestKey)
    if (full.status !== 'ok') {
        throw new Error('The full read failed.')
    }
    getDatabaseMock.mockImplementation(() => db)
    return { memory, db, entries, source: full.tree.source }
}

const wholeOf = (page: Page, entry: ShardEntry) => assembleCharacter(entry, page.source) as unknown as Parameters<typeof coldUnitCharacter>[0]

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>
const STUB: BackupExportOptions = { mode: 'stub' }

/** What the writer stand-in saw at the moment each stub's entry started. */
interface StartSeen {
    name: string
    /** Entries `cold.stubEntries` still held. */
    heldByCold: number
    /** The names the returned `stubPayloads` array still held. */
    heldByArray: string[]
}

function watchStubStarts(): StartSeen[] {
    const seen: StartSeen[] = []
    sink.onWrite = (chunk) => {
        const name = unitEntryStartedBy(chunk)
        if (name !== null && captured.names.includes(name)) {
            seen.push({
                name,
                heldByCold: captured.cold?.stubEntries.size ?? -1,
                heldByArray: (captured.stubPayloads ?? []).map((entry) => entry.backupName),
            })
        }
    }
    return seen
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    sink.chunks.length = 0
    sink.onWrite = null
    sink.closedFile = null
    captured.cold = null
    captured.stubPayloads = null
    captured.names = []
    unitMem.clear()
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    forageSetItemMock.mockClear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    saveDialogMock.mockReset()
    saveDialogMock.mockImplementation(async () => 'backup-output.bin')
    resetResidencyForTest()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    forageSetItemMock.mockImplementation(async () => { })
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
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

// One small stub, one of 1 MiB or more (written as its own chunk after the header) and one over 4 MiB.
const GROWN = { 2: 1.2 * MIB, 3: 4.6 * MIB }

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a store2 page, stub entries released once written', (_name, run) => {
    test('reproducer: when a stub entry starts, the entries before it are gone from cold.stubEntries and from the stubPayloads array, and the file holds every body intact', async () => {
        const page = await pageOf(GROWN)
        const seen = watchStubStarts()

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(captured.names).toHaveLength(3)
        expect(seen.map((s) => s.name)).toEqual(captured.names)
        seen.forEach((s, index) => {
            // Nothing reads the map after the encode, so it is empty from the first write on.
            expect(s.heldByCold, `${s.name} map`).toBe(0)
            // The entries before this one are released; this one is still held while it is written.
            expect(s.heldByArray, `${s.name} array`).toEqual(captured.names.slice(index))
        })
        expect(captured.stubPayloads).toEqual([])

        // The writer kept every chunk until close and decoded here: no body was changed after it was written.
        const file = sink.closedFile as Uint8Array
        const units = entriesOf(file).filter((entry) => captured.names.includes(entry.name))
        expect(units.map((entry) => entry.name)).toEqual(captured.names)
        const sizes = units.map((entry) => entry.data.length)
        expect(sizes[1]).toBeGreaterThanOrEqual(MIB)
        expect(sizes[2]).toBeGreaterThan(4 * MIB)
        for (const [position, index] of [1, 2, 3].entries()) {
            const expected = asJson({ character: coldUnitCharacter(wholeOf(page, page.entries[index])) })
            expect(JSON.parse(decoder.decode(units[position].data)), page.entries[index].name).toEqual(expected)
        }
    }, 120_000)

    test('reproducer: a write that fails on the second stub entry rejects the export, writes nothing more, and keeps the unwritten entries', async () => {
        await pageOf(GROWN)
        let started = 0
        sink.onWrite = (chunk) => {
            const name = unitEntryStartedBy(chunk)
            if (name !== null && captured.names.includes(name) && ++started === 2) {
                throw new Error('the output stream is down')
            }
        }

        const outcome = await run(STUB)

        expect(outcome.status).toBe('failed')
        expect(outcome.status === 'failed' ? String(outcome.cause) : '').toContain('the output stream is down')
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(sink.closedFile).toBeNull()
        const written = entriesOf(sink.chunks.reduce((all, chunk) => {
            const next = new Uint8Array(all.length + chunk.length)
            next.set(all, 0)
            next.set(chunk, all.length)
            return next
        }, new Uint8Array(0))).map((entry) => entry.name)
        // The first entry went out whole; the failed write and everything after it did not.
        expect(written).not.toContain('database.risudat')
        expect(written.filter((name) => captured.names.includes(name))).toEqual([captured.names[0]])
        // Only the entry written before the failure is released.
        expect((captured.stubPayloads ?? []).map((entry) => entry.backupName)).toEqual(captured.names.slice(1))
    }, 120_000)

    test('guard: the failed export of a write that throws is the same without any large stub', async () => {
        await pageOf()
        sink.onWrite = () => { throw new Error('the output stream is down') }

        const outcome = await run(STUB)

        expect(outcome.status).toBe('failed')
        expect(sink.closedFile).toBeNull()
    }, 120_000)
})

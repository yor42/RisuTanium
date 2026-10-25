/**
 * The stub unit entries a `.bin` export holds between their read and their write are held packed, and unpacked one at a
 * time just before each write (`stubUnitEntry`, `unpackStubEntry`, `inlinedFromMinted` in `drive/exportInline.ts`;
 * `writeStubPayloadsAndRelease` in `drive/backuplocal.ts`). The file's bytes stay the mint-time bytes.
 *
 * Held bytes are measured by walking every typed array reachable from the entries (own enumerable properties and arrays,
 * with cycle protection) and counting each distinct `ArrayBuffer` once, so an entry that keeps a raw copy, or a packed
 * view over an oversized backing buffer, counts in full. The walk starts from `cold.stubEntries` right after the first
 * collection and from the array `stubEntriesInTree` returned at the first stub write (`cold.stubEntries` is already
 * empty then). A passing test says nothing about the garbage collector or about a native writer.
 *
 * Labels in the titles:
 * - `reproducer`: fails on the held-bytes assertion against the export path before this change, where each entry holds
 *   its raw bytes.
 * - `guard`: failure paths and `unpackStubEntry`, which have nothing to fail on before this change.
 *
 * The harness is the one `exportStubRelease.test.ts` documents, with a Tauri-shaped file system added for the writers
 * whose failed file is deleted.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { deflateSync } from 'fflate'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BackupColdStorage, MintedStubEntry } from 'src/ts/drive/exportInline'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

/** What the browser writer stand-in is handed, kept by reference, and the hook the tests set. */
const sink = vi.hoisted(() => ({
    chunks: [] as Uint8Array[],
    onWrite: null as null | ((chunk: Uint8Array) => void),
    closedFile: null as Uint8Array | null,
}))

/** Every `writeFile` call the Tauri writer made, copied at call time, and the removal of a failed file. */
const fsBox = vi.hoisted(() => ({
    calls: [] as Array<{ append: boolean, data: Uint8Array }>,
    removed: [] as string[],
    removeFails: false,
}))

/** What the wrapped `exportInline` returned to `backuplocal`, and the hooks the tests set to change it. */
const captured = vi.hoisted(() => ({
    /** Run on the collection right after it returns, before the export goes on. */
    afterCollect: null as null | ((cold: BackupColdStorage) => void),
    /** The entries held by `cold.stubEntries` right after the collection, as they were then. */
    atCollect: [] as unknown[],
    /** Run on the entries `stubEntriesInTree` returns. */
    onEntries: null as null | ((entries: MintedStubEntry[]) => void),
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
    writeFile: vi.fn(async (_path: string, data: Uint8Array, options?: { append?: boolean }) => {
        fsBox.calls.push({ append: options?.append === true, data: data.slice() })
    }),
    readFile: vi.fn(async () => {
        throw new Error('the Tauri backend is not under test')
    }),
    readDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    remove: vi.fn(async (path: string) => {
        if (fsBox.removeFails) {
            throw new Error('the file cannot be removed')
        }
        fsBox.removed.push(path)
    }),
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
            captured.atCollect = [...cold.stubEntries.values()]
            captured.afterCollect?.(cold)
            return cold
        },
        stubEntriesInTree: (...args: Parameters<typeof actual.stubEntriesInTree>) => {
            const entries = actual.stubEntriesInTree(...args)
            captured.onEntries?.(entries)
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
import { StubEntryUnpackError, unpackStubEntry } from 'src/ts/drive/exportInline'
import { language } from 'src/lang'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { coldUnitCharacter } from 'src/ts/process/coldCharacter'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
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
const encoder = new TextEncoder()
const NOW = 1_700_000_000_000
const MIB = 1024 * 1024
const UNIT_ENTRY_NAME = /^coldstorage_[0-9a-f-]{36}\.json$/
/** An entry that holds its bytes packed holds well under this share of them; one that holds them raw holds all. */
const HELD_SHARE_BOUND = 0.7

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

/**
 * The bytes the `roots` hold: the sum of `byteLength` over every distinct `ArrayBuffer` some typed array reachable from
 * them is a view of. Typed arrays are not walked into; objects and arrays are, once each.
 */
function heldBytes(roots: readonly unknown[]): number {
    const seen = new Set<object>()
    const buffers = new Set<ArrayBufferLike>()
    const visit = (value: unknown): void => {
        if (typeof value !== 'object' || value === null || seen.has(value)) {
            return
        }
        seen.add(value)
        if (ArrayBuffer.isView(value)) {
            buffers.add(value.buffer)
            return
        }
        if (value instanceof ArrayBuffer) {
            buffers.add(value)
            return
        }
        for (const inner of Array.isArray(value) ? value : Object.values(value)) {
            visit(inner)
        }
    }
    roots.forEach(visit)
    let total = 0
    for (const buffer of buffers) {
        total += buffer.byteLength
    }
    return total
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

interface Page {
    memory: MemoryBackend
    db: Database
    entries: ShardEntry[]
    source: UnitSource
}

/**
 * A store2 page of four characters: the first resident, the other three stubs of their entities. `grow` makes the
 * first chat of a character at least that many bytes of JSON by repeating its first message, which packs well.
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

/** The bytes the export mints for the stub of `entry`: the character's unit body. */
const mintedBytesOf = (page: Page, entry: ShardEntry): Uint8Array => encoder.encode(JSON.stringify({ character: coldUnitCharacter(wholeOf(page, entry)) }))

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>
const STUB: BackupExportOptions = { mode: 'stub' }

/** The file the Tauri writer produced: every call's bytes in order. */
function fileOfCalls(): Uint8Array {
    const out = new Uint8Array(fsBox.calls.reduce((n, call) => n + call.data.length, 0))
    let offset = 0
    for (const call of fsBox.calls) {
        out.set(call.data, offset)
        offset += call.data.length
    }
    return out
}

/** The held bytes seen by the stand-in writer at the moment the first stub entry starts. */
function watchFirstStubStart(): { heldAtFirst: number | null } {
    const seen: { heldAtFirst: number | null } = { heldAtFirst: null }
    sink.onWrite = (chunk) => {
        const name = unitEntryStartedBy(chunk)
        if (seen.heldAtFirst === null && name !== null && captured.names.includes(name)) {
            seen.heldAtFirst = heldBytes(captured.stubPayloads ?? [])
        }
    }
    return seen
}

/** A mutable view of an entry minted by the export, for the tests that damage it. */
const entryAt = (cold: BackupColdStorage, index: number): MintedStubEntry => [...cold.stubEntries.values()][index]

/** `body` (JSON text) packed the way `stubUnitEntry` packs, with the raw length it is paired with. */
function packedJson(body: string): Pick<MintedStubEntry, 'packed' | 'rawLength'> {
    const raw = encoder.encode(body)
    return { packed: deflateSync(raw, { level: 1 }), rawLength: raw.length }
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    sink.chunks.length = 0
    sink.onWrite = null
    sink.closedFile = null
    fsBox.calls.length = 0
    fsBox.removed.length = 0
    fsBox.removeFails = false
    captured.afterCollect = null
    captured.atCollect = []
    captured.onEntries = null
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

const RUNNERS: Array<[string, Runner]> = [
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
]

describe.each(RUNNERS)('%s of a store2 page, stub entries held packed', (_name, run) => {
    test('reproducer: right after the collection the entries hold under 0.7x the bytes of their bodies', async () => {
        await pageOf(GROWN)

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const units = entriesOf(sink.closedFile as Uint8Array).filter((entry) => UNIT_ENTRY_NAME.test(entry.name))
        expect(units).toHaveLength(3)
        const rawTotal = units.reduce((n, entry) => n + entry.data.length, 0)
        expect(rawTotal).toBeGreaterThan(5 * MIB)
        expect(captured.atCollect).toHaveLength(3)
        const held = heldBytes(captured.atCollect)
        expect(held, `held ${held} of ${rawTotal} body bytes`).toBeLessThan(HELD_SHARE_BOUND * rawTotal)
    }, 120_000)

    test('reproducer: at the first stub write the entries still to write hold under 0.7x the bytes of their bodies, and every body written is the mint-time bytes', async () => {
        const page = await pageOf(GROWN)
        const first = watchFirstStubStart()

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const entries = entriesOf(sink.closedFile as Uint8Array)
        const units = entries.filter((entry) => UNIT_ENTRY_NAME.test(entry.name))
        expect(units).toHaveLength(3)
        const rawTotal = units.reduce((n, entry) => n + entry.data.length, 0)
        expect(first.heldAtFirst, 'the first stub write was seen').not.toBeNull()
        expect(first.heldAtFirst as number, `held ${first.heldAtFirst} of ${rawTotal} body bytes`).toBeLessThan(HELD_SHARE_BOUND * rawTotal)

        // The uuids are fresh in every export, so each stub of the database entry names its body.
        const database = entries.find((entry) => entry.name === 'database.risudat')
        expect(database).toBeDefined()
        const stubs = ((await decodeRisuSave((database as WrittenEntry).data)) as unknown as { characters: Array<Record<string, unknown>> }).characters
            .filter((slot) => typeof slot.coldstorage === 'string' && units.some((unit) => unit.name === `coldstorage_${slot.coldstorage}.json`))
        expect(stubs).toHaveLength(3)
        const largeBodies: number[] = []
        for (const stub of stubs) {
            const entry = page.entries.find((candidate) => candidate.chaId === stub.chaId) as ShardEntry
            const body = (units.find((unit) => unit.name === `coldstorage_${stub.coldstorage}.json`) as WrittenEntry).data
            const expected = mintedBytesOf(page, entry)
            expect(body.length, `${entry.name} length`).toBe(expected.length)
            expect(Buffer.from(body).equals(Buffer.from(expected)), `${entry.name} bytes`).toBe(true)
            if (body.length >= MIB) {
                largeBodies.push(body.length)
            }
        }
        expect(largeBodies.length).toBeGreaterThanOrEqual(2)
    }, 120_000)
})

describe('unpackStubEntry', () => {
    /** Text that does not repeat, so a cut or a mismatched length shows. */
    function varied(length: number, seed: number): Uint8Array {
        const out = new Uint8Array(length)
        let state = seed
        for (let i = 0; i < length; i++) {
            state = (Math.imul(state, 1103515245) + 12345) >>> 0
            out[i] = 97 + ((state >>> 16) % 26)
        }
        return out
    }

    const pack = (raw: Uint8Array): Pick<MintedStubEntry, 'packed' | 'rawLength'> => ({ packed: deflateSync(raw, { level: 1 }), rawLength: raw.length })
    const asEntry = (parts: Pick<MintedStubEntry, 'packed' | 'rawLength'>): MintedStubEntry => ({ uuid: 'u', name: 'n', backupName: 'coldstorage_u.json', ...parts })
    const longer = varied(5000, 1)
    const shorter = varied(3000, 2)

    test('guard: an entry unpacks to the bytes it was packed from, in a body of its own each time', () => {
        const entry = asEntry(pack(longer))

        const first = unpackStubEntry(entry)
        const second = unpackStubEntry(entry)

        expect(Buffer.from(first).equals(Buffer.from(longer))).toBe(true)
        expect(Buffer.from(second).equals(Buffer.from(longer))).toBe(true)
        expect(first.buffer).not.toBe(second.buffer)
        first.fill(0)
        expect(Buffer.from(second).equals(Buffer.from(longer))).toBe(true)
    })

    test.each([
        ['a rawLength that is too small', () => ({ packed: pack(longer).packed, rawLength: longer.length - 1 })],
        ['a rawLength that is too large', () => ({ packed: pack(longer).packed, rawLength: longer.length + 1 })],
        ['an empty packed', () => ({ packed: new Uint8Array(0), rawLength: longer.length })],
        ['a truncated packed', () => ({ packed: pack(longer).packed.slice(0, 600), rawLength: longer.length })],
        ['a longer entry with the shorter one\'s rawLength', () => ({ packed: pack(longer).packed, rawLength: shorter.length })],
        ['a shorter entry with the longer one\'s rawLength', () => ({ packed: pack(shorter).packed, rawLength: longer.length })],
    ])('guard: %s throws StubEntryUnpackError', (_label, parts) => {
        expect(() => unpackStubEntry(asEntry(parts()))).toThrow(StubEntryUnpackError)
    })
})

describe.each(RUNNERS)('%s of a store2 page, a stub entry that does not unpack', (_name, run) => {
    /** Damages the second stub entry when `stubEntriesInTree` returns it, so the first has been written when the second fails. */
    const damageSecondWrite = (damage: (entry: MintedStubEntry) => void) => {
        captured.onEntries = (entries) => damage(entries[1])
    }

    const truncated = (entry: MintedStubEntry) => { entry.packed = entry.packed.slice(0, 4) }
    const wrongLength = (entry: MintedStubEntry) => { entry.rawLength += 1 }

    test.each([
        ['a truncated packed', truncated],
        ['a rawLength that is not the body\'s', wrongLength],
    ])('guard: %s fails the export on a browser stream, which keeps its file and says so', async (_label, damage) => {
        await pageOf()
        damageSecondWrite(damage)

        const outcome = await run(STUB)

        expect(outcome.status).toBe('failed')
        expect(outcome.status === 'failed' ? outcome.cause : null).toBeInstanceOf(StubEntryUnpackError)
        expect(outcome.status === 'failed' ? outcome.file : null).toBe('kept')
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileKept(null))
        expect(sink.closedFile).toBeNull()
        expect(alertNormalMock).not.toHaveBeenCalled()
    }, 120_000)

    test.each([
        ['a truncated packed', truncated],
        ['a rawLength that is not the body\'s', wrongLength],
    ])('guard: %s fails the export on a desktop file, which is deleted', async (_label, damage) => {
        platformBox.isTauri = true
        // The first stub entry is over the writer's chunk size, so the file exists when the second entry fails.
        await pageOf({ 1: 4.6 * MIB })
        damageSecondWrite(damage)

        const outcome = await run(STUB)

        expect(outcome.status).toBe('failed')
        expect(outcome.status === 'failed' ? outcome.cause : null).toBeInstanceOf(StubEntryUnpackError)
        expect(outcome.status === 'failed' ? outcome.file : null).toBe('deleted')
        expect(fsBox.removed).toEqual(['backup-output.bin'])
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileDeleted(null))
        // The first stub entry reached the file before the second failed.
        expect(fsBox.calls.length).toBeGreaterThan(0)
    }, 120_000)

    test('guard: a desktop file that cannot be removed is kept, and the export still fails', async () => {
        platformBox.isTauri = true
        fsBox.removeFails = true
        await pageOf({ 1: 4.6 * MIB })
        damageSecondWrite(truncated)

        const outcome = await run(STUB)

        expect(outcome.status).toBe('failed')
        expect(outcome.status === 'failed' ? outcome.file : null).toBe('kept')
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFailedFileKept(null))
    }, 120_000)
})

describe('SaveLocalBackup, the fallback that reads a minted entry back whole', () => {
    // The first `exportCopyOf` map reaches the fallback for a stub that is trashed when the tree is built; the repair map
    // reaches it for every minted stub when the list needs the id repair. Both start after the entries were minted.
    const REACHES = [
        ['a stub trashed after its entry was minted', (page: Page) => { (page.db.characters[1] as unknown as Obj).trashTime = NOW }],
        ['a list that needs the id repair after the entries were minted', (page: Page) => { (page.db.characters[0] as unknown as Obj).chaId = '' }],
    ] as const

    const DAMAGES = [
        ['a corrupted packed', (entry: MintedStubEntry) => { entry.packed = entry.packed.slice(0, 4) }],
        ['bytes that unpack but hold no character', (entry: MintedStubEntry) => { Object.assign(entry, packedJson('{"other":1}')) }],
        ['bytes that unpack but are not JSON', (entry: MintedStubEntry) => { Object.assign(entry, packedJson('not json at all')) }],
    ] as const

    describe.each(REACHES)('%s', (_reach, arrange) => {
        test.each(DAMAGES)('guard: %s fails the export instead of leaving the stub in place', async (_damage, damage) => {
            const page = await pageOf()
            captured.afterCollect = (cold) => {
                arrange(page)
                damage(entryAt(cold, 0))
            }

            const outcome = await SaveLocalBackup(STUB)

            expect(outcome.status).toBe('failed')
            expect(alertErrorMock).toHaveBeenCalledTimes(1)
            expect(sink.closedFile).toBeNull()
        }, 120_000)
    })
})

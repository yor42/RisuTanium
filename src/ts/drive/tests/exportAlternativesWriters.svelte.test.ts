/**
 * CHORE-478 S1c: a `.bin` export (full and partial) leaves out the alternatives of every chat, behind a prompt that names
 * the chats before the writer opens, and reports afterwards the chats it found only after the prompt.
 *
 * `SaveLocalBackup` and `SavePartialLocalBackup` run for real over a store2 page whose characters (the resident one and
 * three stubs) all carry chat alternatives; the browser writer stand-in keeps every chunk and the file is decoded
 * from them: unit entries as JSON, the database entry through `decodeRisuSave`. A passing test says nothing about a
 * native writer or a real store.
 *
 * Titles: `reproducer` fails when the omission is absent (the alternatives reach the file, or no prompt names them);
 * `guard` passes before and after.
 */
import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat, Database, Message } from 'src/ts/storage/database.svelte'
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
    onOpen: null as null | (() => void),
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
        createWriteStream: () => {
            captured.onOpen?.()
            return {
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
 * `shape` runs on every character before the tree is seeded, after the keys above, so it may replace the first chat.
 */
async function pageOf(grow: Record<number, number> = {}, withAlt = false, fork: 'none' | 'valid' | 'inert' = 'none', unseenReply = false, shape?: (slot: Obj, index: number) => void): Promise<Page> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(4)) as Obj), archiveCharacters: true } as unknown as Database
    if (withAlt) {
        for (const slot of fixture.characters) {
            const firstChat = (slot as unknown as Obj).chats as Obj[]
            firstChat[0].alt = [{ m: { time: 5, data: 'ALTMARK', role: 'char' }, p: null, a: 1 }]
        }
    }
    if (fork !== 'none') {
        for (const slot of fixture.characters) {
            forkKeysOn(((slot as unknown as Obj).chats as Obj[])[0], fork === 'valid')
        }
    }
    if (unseenReply) {
        for (const slot of fixture.characters) {
            ;((slot as unknown as Obj).chats as Obj[])[0].unseenReply = 'reply'
        }
    }
    for (const [index, bytes] of Object.entries(grow)) {
        const firstChat = ((fixture.characters[Number(index)] as unknown as Obj).chats as Obj[])[0]
        const messages = firstChat.message as Obj[]
        const template = JSON.stringify(messages[0])
        const extra = Math.ceil(bytes / template.length)
        for (let i = 0; i < extra; i++) {
            messages.push(JSON.parse(template) as Obj)
        }
    }
    if (shape !== undefined) {
        fixture.characters.forEach((slot, index) => shape(slot as unknown as Obj, index))
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

import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { setColdStorageItem } from 'src/ts/process/coldstorage.svelte'
import { forkOnlyChatLabels, withoutForkOnlyChatData } from 'src/ts/drive/exportAlternatives'
import { exportForkOnlyLabels } from 'src/ts/drive/exportInline'

//#region alternatives fixtures

const ALT_MARK = 'ALTMARK'
const ALT_PROMPT = 'alternative replies'
const ALT_NOTICE = 'found while the backup ran'

function altRecord(): Obj {
    return { m: { time: 5, data: ALT_MARK, role: 'char' }, p: null, a: 1 }
}

/** The labels the prompt lists, one per line after the blank line. */
function promptLabels(): string[] {
    const text = alertConfirmMock.mock.calls.map((call) => String(call[0])).find((message) => message.includes(ALT_PROMPT)) ?? ''
    return text.split('\n\n').slice(1).join('\n\n').split('\n').filter((line) => line.length > 0)
}

const altPrompts = (): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((message) => message.includes(ALT_PROMPT))

// The fork-only chat keys (MC-774): matched as literals of the prompt text, never through `language`.
const FORK_PROMPT = 'data that only this app uses'
const FORK_NOTICE = 'had data that only this app uses'
const COVERED_LINE = 'MEMLINE-ONE'
const INTERRUPTED_KIND = 'interrupted-reply note'
const COVERAGE_KIND = 'memory summary position'

/** Puts the fork-only chat keys on `chat`: a coverage pointer and an interrupted reply, valid or inert. */
function forkKeysOn(chat: Obj, valid: boolean): void {
    chat.supaMemoryData = `${COVERED_LINE}\nsummary text`
    chat.supaMemoryCoveredId = valid ? COVERED_LINE : 'SOMEOTHERID'
    ;(chat.message as Obj[])[0].interrupted = valid
}

function chatHoldsForkKeys(chat: Obj): boolean {
    return typeof chat.supaMemoryCoveredId === 'string' && (chat.message as Obj[]).some((message) => 'interrupted' in message)
}

/** A run that cannot see the keys on the page proves nothing about the file, so the fixture asserts them first. */
function expectPageHoldsForkKeys(page: Page): void {
    expect(chatHoldsForkKeys(((page.db.characters[0] as unknown as Obj).chats as Obj[])[0]), 'resident character').toBe(true)
    for (const entry of page.entries.slice(1)) {
        expect(chatHoldsForkKeys((wholeOf(page, entry) as unknown as { chats: Obj[] }).chats[0]), 'stub entity').toBe(true)
    }
}

const forkPrompts = (): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((message) => message.includes(FORK_PROMPT))

/** The lines the fork-data prompt lists, one per line after the blank line. */
function forkPromptLines(): string[] {
    const text = forkPrompts()[0] ?? ''
    return text.split('\n\n').slice(1).join('\n\n').split('\n').filter((line) => line.length > 0)
}

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
    sink.onWrite = null
    sink.closedFile = null
    captured.cold = null
    captured.onOpen = null
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

describe('exportForkOnlyLabels', () => {
    // T80 regression reproducer: the list counts chats, not texts
    test('reproducer: two characters with the same chat text give two labels, and one chat read through two sources gives one', () => {
        const alice = (chaId: string) => ({ chaId, name: 'Alice', chats: [{ id: `${chaId}-chat`, name: 'Chat 1', alt: [altRecord()] }] })
        const cold = { collected: { omittedChatData: forkOnlyChatLabels(alice('one')) }, inlined: new Map([['k', alice('one')]]), stubEntries: new Map() } as unknown as BackupColdStorage
        const labels = exportForkOnlyLabels({ characters: [alice('one'), alice('two')] } as unknown as Pick<Database, 'characters'>, cold)
        expect(labels).toHaveLength(2)
        expect(new Set(labels.map((label) => label.key)).size).toBe(2)
        expect(labels.map((label) => label.text)).toEqual(['Alice / Chat 1', 'Alice / Chat 1'])
    })

    test('guard (D1): one chat read through two sources holds the kinds of both, each once', () => {
        const withKinds = (extra: Obj) => ({ chaId: 'one', name: 'Alice', chats: [{ id: 'one-chat', name: 'Chat 1', message: [{ data: 'x', interrupted: true }], ...extra }] })
        const resident = withKinds({ alt: [altRecord()] })
        const read = withKinds({ supaMemoryData: 'L\nrest', supaMemoryCoveredId: 'L' })
        const cold = { collected: {}, inlined: new Map([['k', read]]), stubEntries: new Map() } as unknown as BackupColdStorage
        const labels = exportForkOnlyLabels({ characters: [resident] } as unknown as Pick<Database, 'characters'>, cold)
        expect(labels).toHaveLength(1)
        expect([...labels[0].kinds].sort()).toEqual(['alternatives', 'interruptedNote', 'memoryCoverage'])
    })

    test('guard: one chat read through two sources takes the branch count from a later source when the first had none', () => {
        const grown = growTree({ chats: [{ id: 'one-chat', name: 'Chat 1', message: [] }] }, 'g')
        const resident = { chaId: 'one', name: 'Alice', chats: [{ id: 'one-chat', name: 'Chat 1', message: [{ data: 'x', interrupted: true }] }] }
        const read = { chaId: 'one', name: 'Alice', chats: [grown] }
        const cold = { collected: {}, inlined: new Map([['k', read]]), stubEntries: new Map() } as unknown as BackupColdStorage
        const labels = exportForkOnlyLabels({ characters: [resident] } as unknown as Pick<Database, 'characters'>, cold)
        expect(labels).toHaveLength(1)
        expect(labels[0].branches).toMatchObject({ chats: 1, omitted: 1 })
    })
})

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a store2 page whose chats hold alternatives', (_name, run) => {
    test.each([['stub', STUB], ['inline', { mode: 'inline' } as BackupExportOptions]])('reproducer: in %s mode one prompt names every chat before the writer opens, and the file holds no alternative', async (_mode, options) => {
        const page = await pageOf({}, true)
        let chunksAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(ALT_PROMPT)) {
                chunksAtPrompt = sink.chunks.length
            }
            return true
        })

        const outcome = await run(options)

        // Every chat was named in the prompt, so nothing is reported again afterwards.
        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(altPrompts()).toHaveLength(1)
        expect(chunksAtPrompt).toBe(0)
        expect(promptLabels()).toHaveLength(4)
        for (const slot of page.db.characters) {
            const name = String((slot as unknown as Obj).name)
            expect(promptLabels().some((label) => label.startsWith(`${name} / `)), name).toBe(true)
        }
        const text = await fileText()
        expect(text).not.toContain(ALT_MARK)
        expect(text).toContain('"chats"')
        // The resident character on the page keeps its alternatives.
        const resident = page.db.characters[0] as unknown as { chats: Array<{ alt?: unknown[] }> }
        expect(resident.chats[0].alt).toEqual([altRecord()])
    }, 120_000)

    test('reproducer: declining the prompt ends the export as declined, with no writer opened and nothing written', async () => {
        await pageOf({}, true)
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(ALT_PROMPT))

        const outcome = await run(STUB)

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(sink.chunks).toEqual([])
        expect(sink.closedFile).toBeNull()
        expect(alertErrorMock).not.toHaveBeenCalled()
    }, 120_000)

    test('guard: a page with no alternatives gets no such prompt and no such notice', async () => {
        await pageOf({}, false)

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(altPrompts()).toEqual([])
        expect((await fileText())).not.toContain(ALT_MARK)
    }, 120_000)

    test('reproducer: a resident character that gains alternatives after the prompt is stripped and reported after the export', async () => {
        const page = await pageOf({}, false)
        captured.onOpen = () => {
            const late = JSON.parse(JSON.stringify(page.db.characters[0])) as Obj
            late.chaId = 'late-character'
            late.name = 'Latecomer'
            ;(late.chats as Obj[])[0].alt = [altRecord()]
            ;(page.db.characters as unknown[]).push(late)
        }

        const outcome = await run(STUB)

        expect(altPrompts()).toEqual([])
        expect(outcome).toMatchObject({ status: 'saved' })
        const notice = (outcome as { notices: string[] }).notices.join('\n')
        expect(notice).toContain(ALT_NOTICE)
        expect(notice).toContain('Latecomer / ')
        expect(await fileText()).not.toContain(ALT_MARK)
    }, 120_000)

    // T81 regression reproducer: the text alone cannot tell a latecomer from a chat the prompt named
    test('reproducer: a latecomer whose chat text equals a confirmed chat, with another character id, is still reported', async () => {
        const page = await pageOf({}, true)
        const twin = JSON.parse(JSON.stringify(page.db.characters[0])) as Obj
        captured.onOpen = () => {
            twin.chaId = 'late-twin'
            ;(page.db.characters as unknown[]).push(twin)
        }

        const outcome = await run(STUB)

        expect(altPrompts()).toHaveLength(1)
        expect(outcome).toMatchObject({ status: 'saved' })
        const notice = (outcome as { notices: string[] }).notices.join('\n')
        expect(notice).toContain(ALT_NOTICE)
        expect(notice).toContain(`${String(twin.name)} / `)
        expect(await fileText()).not.toContain(ALT_MARK)
    }, 120_000)

    test('reproducer: a legacy cold unit known before the prompt is named in it and carried without alternatives, with nothing reported afterwards', async () => {
        const KEY = '00000000-0000-4000-8000-0000000000bb'
        await setColdStorageItem(KEY, { character: { chaId: 'cold-early', name: 'ColdEarly', type: 'character', chatPage: 0, chats: [{ id: 'k1', name: 'Kept', message: [{ time: 1, data: 'hello', role: 'char' }], note: '', localLore: [], alt: [altRecord()] }] } })
        const page = await pageOf({}, false)
        ;(page.db.characters as unknown[]).push({ chaId: 'cold-early', name: 'ColdEarly', type: 'character', chatPage: 0, coldstorage: KEY, chats: [] })

        const outcome = await run(STUB)

        expect(altPrompts()).toHaveLength(1)
        expect(promptLabels()).toEqual(['ColdEarly / Kept (alternative replies left out)'])
        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(entriesOf(sink.closedFile as Uint8Array).map((entry) => entry.name)).toContain(`coldstorage_${KEY}.json`)
        expect(await fileText()).not.toContain(ALT_MARK)
    }, 120_000)

    test('reproducer: a cold unit first referenced after the prompt is carried without alternatives and its chats are reported', async () => {
        // The unit is stored before the page registers its residency, which would route a new write to its own tree.
        const KEY = '00000000-0000-4000-8000-0000000000aa'
        await setColdStorageItem(KEY, { character: { chaId: 'cold-late', name: 'ColdLate', type: 'character', chatPage: 0, chats: [{ id: 'k1', name: 'Kept', message: [{ time: 1, data: 'hello', role: 'char' }], note: '', localLore: [], alt: [altRecord()] }] } })
        const page = await pageOf({}, false)
        captured.onOpen = () => {
            ;(page.db.characters as unknown[]).push({ chaId: 'cold-late', name: 'ColdLate', type: 'character', chatPage: 0, coldstorage: KEY, chats: [] })
        }

        const outcome = await run(STUB)

        expect(altPrompts()).toEqual([])
        expect(outcome).toMatchObject({ status: 'saved' })
        const notice = (outcome as { notices: string[] }).notices.join('\n')
        expect(notice).toContain(ALT_NOTICE)
        expect(notice).toContain('ColdLate / Kept')
        expect(entriesOf(sink.closedFile as Uint8Array).map((entry) => entry.name)).toContain(`coldstorage_${KEY}.json`)
        expect(await fileText()).not.toContain(ALT_MARK)
    }, 120_000)
})

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a store2 page whose chats hold fork-only keys', (_name, run) => {
    test.each([['stub', STUB], ['inline', { mode: 'inline' } as BackupExportOptions]])('reproducer (R1): in fork-only %s mode the file holds neither key, the summary text travels, and the live characters keep both keys', async (_mode, options) => {
        const page = await pageOf({}, false, 'valid')
        expectPageHoldsForkKeys(page)

        const outcome = await run(options)

        expect(outcome).toMatchObject({ status: 'saved' })
        const text = await fileText()
        expect(text).not.toContain('"interrupted"')
        expect(text).not.toContain('"supaMemoryCoveredId"')
        expect(text).toContain('"supaMemoryData"')
        expect(text).toContain(COVERED_LINE)
        expectPageHoldsForkKeys(page)
        // The alternatives prompt is for chats with alternatives; these chats have none.
        expect(altPrompts()).toEqual([])
    }, 120_000)

    test.each([['stub', STUB], ['inline', { mode: 'inline' } as BackupExportOptions]])('reproducer (R2): in fork-only %s mode one prompt names each chat with its kinds before the writer opens, and the alternatives prompt names alternatives only', async (_mode, options) => {
        const page = await pageOf({}, true, 'valid')
        let chunksAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(FORK_PROMPT)) {
                chunksAtPrompt = sink.chunks.length
            }
            return true
        })

        const outcome = await run(options)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(forkPrompts()).toHaveLength(1)
        expect(chunksAtPrompt).toBe(0)
        expect(forkPromptLines()).toHaveLength(4)
        for (const slot of page.db.characters) {
            const name = String((slot as unknown as Obj).name)
            const line = forkPromptLines().find((entry) => entry.startsWith(`${name} / `)) ?? ''
            expect(line, name).toContain(INTERRUPTED_KIND)
            expect(line, name).toContain(COVERAGE_KIND)
        }
        // The alternatives prompt keeps its own wording and its own chats.
        expect(altPrompts()).toHaveLength(1)
        expect(promptLabels()).toHaveLength(4)
        for (const line of promptLabels()) {
            expect(line).not.toContain(INTERRUPTED_KIND)
            expect(line).not.toContain(COVERAGE_KIND)
        }
        const order = alertConfirmMock.mock.calls.map((call) => String(call[0]))
        expect(order.findIndex((message) => message.includes(ALT_PROMPT))).toBeLessThan(order.findIndex((message) => message.includes(FORK_PROMPT)))
    }, 120_000)

    test('reproducer (R3): declining the fork-only prompt ends the export as declined, with nothing written', async () => {
        await pageOf({}, false, 'valid')
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(FORK_PROMPT))

        const outcome = await run(STUB)

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(sink.chunks).toEqual([])
        expect(sink.closedFile).toBeNull()
        expect(alertErrorMock).not.toHaveBeenCalled()
    }, 120_000)

    test('guard (S7): a page with no fork-only keys gets no fork-only prompt and no such notice', async () => {
        await pageOf({}, false, 'none')

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(forkPrompts()).toEqual([])
    }, 120_000)

    test('reproducer (R4): a legacy cold character unit known before the prompt is carried without the keys and named with its kinds', async () => {
        const KEY = '00000000-0000-4000-8000-0000000000cc'
        await setColdStorageItem(KEY, { character: { chaId: 'cold-fork', name: 'ColdFork', type: 'character', chatPage: 0, chats: [{ id: 'k1', name: 'Kept', message: [{ time: 1, data: 'hello', role: 'char', interrupted: true }], note: '', localLore: [], supaMemoryData: `${COVERED_LINE}\nsummary`, supaMemoryCoveredId: COVERED_LINE }] } })
        const page = await pageOf({}, false)
        ;(page.db.characters as unknown[]).push({ chaId: 'cold-fork', name: 'ColdFork', type: 'character', chatPage: 0, coldstorage: KEY, chats: [] })

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(forkPromptLines()).toHaveLength(1)
        expect(forkPromptLines()[0]).toContain('ColdFork / Kept')
        const unit = entriesOf(sink.closedFile as Uint8Array).find((entry) => entry.name === `coldstorage_${KEY}.json`)
        expect(unit).toBeDefined()
        const unitText = decoder.decode((unit as { data: Uint8Array }).data)
        expect(unitText).toContain(COVERED_LINE)
        expect(unitText).not.toContain('"interrupted"')
        expect(unitText).not.toContain('"supaMemoryCoveredId"')
    }, 120_000)

    test('reproducer (R5): a character that gains the keys after the prompt is stripped and named in the notice', async () => {
        const page = await pageOf({}, false)
        captured.onOpen = () => {
            const late = JSON.parse(JSON.stringify(page.db.characters[0])) as Obj
            late.chaId = 'late-fork'
            late.name = 'ForkLatecomer'
            forkKeysOn((late.chats as Obj[])[0], true)
            ;(page.db.characters as unknown[]).push(late)
        }

        const outcome = await run(STUB)

        expect(forkPrompts()).toEqual([])
        expect(outcome).toMatchObject({ status: 'saved' })
        const notice = (outcome as { notices: string[] }).notices.join('\n')
        expect(notice).toContain(FORK_NOTICE)
        expect(notice).toContain('ForkLatecomer / ')
        const text = await fileText()
        expect(text).not.toContain('"interrupted"')
        expect(text).not.toContain('"supaMemoryCoveredId"')
    }, 120_000)

    test('reproducer (R5): a chat the alternatives prompt named that gains an interrupted reply afterwards is still named in the notice', async () => {
        const page = await pageOf({}, true)
        captured.onOpen = () => {
            ;(((page.db.characters[0] as unknown as Obj).chats as Obj[])[0].message as Obj[])[0].interrupted = true
        }

        const outcome = await run(STUB)

        expect(altPrompts()).toHaveLength(1)
        expect(forkPrompts()).toEqual([])
        const notice = (outcome as { notices: string[] }).notices.join('\n')
        expect(notice).toContain(FORK_NOTICE)
        expect(notice).toContain(INTERRUPTED_KIND)
        expect(await fileText()).not.toContain('"interrupted"')
    }, 120_000)

    test('reproducer (R6): keys that mean nothing are stripped and not named', async () => {
        const page = await pageOf({}, false, 'inert')
        // The coverage pointer is not the first line of the summary and the reply is not interrupted.
        expect(((page.db.characters[0] as unknown as Obj).chats as Obj[])[0].supaMemoryCoveredId).toBe('SOMEOTHERID')

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const text = await fileText()
        expect(text).not.toContain('"supaMemoryCoveredId"')
        expect(text).not.toContain('"interrupted"')
        // guard: nothing was worth naming
        expect(forkPrompts()).toEqual([])
    }, 120_000)

    test.each([['stub', STUB], ['inline', { mode: 'inline' } as BackupExportOptions]])('reproducer (P3): in %s mode the new-reply mark never reaches the file, nothing names it, and the live chats keep it', async (_mode, options) => {
        const page = await pageOf({}, false, 'none', true)
        expect(((page.db.characters[0] as unknown as Obj).chats as Obj[])[0].unseenReply, 'resident character').toBe('reply')
        for (const entry of page.entries.slice(1)) {
            expect((wholeOf(page, entry) as unknown as { chats: Obj[] }).chats[0].unseenReply, 'stub entity').toBe('reply')
        }

        const outcome = await run(options)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(await fileText()).not.toContain('"unseenReply"')
        expect(forkPrompts()).toEqual([])
        expect(altPrompts()).toEqual([])
        expect(((page.db.characters[0] as unknown as Obj).chats as Obj[])[0].unseenReply).toBe('reply')
    }, 120_000)
})

//#region continued alternatives: fixtures

import { detachTail } from 'src/ts/process/chatTree'

// The branch marker is a string of 64 or more characters. msgpackr 1.10.1 passes such a string a length past the
// buffer's end to `utf8Write`, which the Node running the tests rejects (the browser's Buffer polyfill has no `utf8Write`,
// so msgpackr encodes with `TextEncoder` there; the clamp changes no byte written). It is scoped to this file.
const utf8Proto = Buffer.prototype as unknown as { utf8Write(this: Uint8Array, text: string, position: number, length: number): number }
const nativeUtf8Write = utf8Proto.utf8Write
beforeAll(() => {
    utf8Proto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
})
afterAll(() => {
    utf8Proto.utf8Write = nativeUtf8Write
})

interface TreeOptions {
    /** Messages in front of the tree, so the shared prefix of the branch chat grows with them. */
    fillers?: number
    /** Runs on the chat before the tail is cut: `message` holds the whole path then. */
    marks?: (chat: Chat) => void
    /** Group chats name the speaker of each message. */
    saying?: string
}

function treeMessage(chatId: string, role: 'user' | 'char', saying?: string): Message {
    return { role, data: `text ${chatId}`, chatId, ...(saying !== undefined ? { saying } : {}) }
}

/**
 * The first chat of `slot` as the engine writes a continued Branch: `u1 c2 u3 c4` is cut at `u3` and continued with
 * `u5 c6`, and `c6` is then rerolled. The chat holds one continued alternative (`u3 c4`, hanging from `c2`) and one
 * reroll (`c6`, a lone reply), with the memory parked as the engine parks it. Message ids are `<tag>u1` and so on.
 */
function growTree(slot: Obj, tag: string, options: TreeOptions = {}): Chat {
    const chat = (slot.chats as Obj[])[0] as unknown as Chat
    const fillers = Array.from({ length: options.fillers ?? 0 }, (_, index) => treeMessage(`${tag}f${index}`, index % 2 === 0 ? 'user' : 'char', options.saying))
    chat.message = [
        ...fillers,
        treeMessage(`${tag}u1`, 'user', options.saying),
        treeMessage(`${tag}c2`, 'char', options.saying),
        treeMessage(`${tag}u3`, 'user', options.saying),
        treeMessage(`${tag}c4`, 'char', options.saying),
    ]
    options.marks?.(chat)
    const cut = fillers.length + 2
    expect(detachTail(chat, cut)).toBe(true)
    chat.message.push(treeMessage(`${tag}u5`, 'user', options.saying), treeMessage(`${tag}c6`, 'char', options.saying))
    expect(detachTail(chat, cut + 1)).toBe(true)
    chat.message.push(treeMessage(`${tag}c6b`, 'char', options.saying))
    return chat
}

/** The tree on every character, with message ids `t0`, `t1` and so on. */
const treeOnAll = (slot: Obj, index: number): void => { growTree(slot, `t${index}`) }

/** The characters of the written file's database entry, decoded. */
async function exportedCharacters(): Promise<Obj[]> {
    const entry = entriesOf(sink.closedFile as Uint8Array).find((candidate) => candidate.name === 'database.risudat')
    if (entry === undefined) {
        throw new Error('the export wrote no database entry')
    }
    return ((await decodeRisuSave(entry.data)) as unknown as { characters: Obj[] }).characters
}

/** The characters the written unit entries carry, in file order. */
function unitCharacters(): Obj[] {
    return entriesOf(sink.closedFile as Uint8Array)
        .filter((entry) => UNIT_ENTRY_NAME.test(entry.name))
        .map((entry) => (JSON.parse(decoder.decode(entry.data)) as { character: Obj }).character)
}

function hasKeyDeep(value: unknown, key: string): boolean {
    if (Array.isArray(value)) {
        return value.some((inner) => hasKeyDeep(inner, key))
    }
    if (typeof value === 'object' && value !== null) {
        return key in value || Object.values(value).some((inner) => hasKeyDeep(inner, key))
    }
    return false
}

const chatsOfCharacter = (character: Obj): Obj[] => character.chats as Obj[]
const messagesOf = (chat: Obj): Obj[] => chat.message as Obj[]

/** The marker of a branch chat split as upstream's renderer splits it. */
function markerParts(chat: Obj): string[] {
    const messages = messagesOf(chat)
    return String(messages[messages.length - 1].data).split('::')
}

const idsOfMessages = (chat: Obj): unknown[] => messagesOf(chat).map((message) => message.chatId)
const MARKER_HEAD = '{{specialcomment'

/** The line of the alternatives prompt that belongs to the chat text `text`. */
const promptLineOf = (text: string): string => promptLabels().find((line) => line.startsWith(text)) ?? ''

/** A record that continues the main path from `pointId`: a user message, then (optionally) an interrupted reply. */
function lateLeaf(pointId: string, withInterrupted: boolean): Obj[] {
    const user = treeMessage('late-u', 'user')
    const records: Obj[] = [{ m: user, p: pointId, a: 99 }]
    if (withInterrupted) {
        records.push({ m: { ...treeMessage('late-c', 'char'), interrupted: true }, p: 'late-u', a: 99 })
    }
    return records
}

//#endregion

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a store2 page whose chats continue from an alternative', (_name, run) => {
    // W1: the file holds the continued alternative as an extra chat; the count is the fixture's chat count plus one
    test('reproducer (W1): a resident chat that was continued from an alternative is written with one extra branch chat, and the live page is unchanged', async () => {
        const page = await pageOf({}, false, 'none', false, treeOnAll)
        const live = page.db.characters[0] as unknown as { chats: Chat[], chatPage?: number }
        const chatsBefore = live.chats.length
        const liveJson = JSON.stringify(page.db.characters[0])
        // u3 c4 and c6: the page really holds the tree the engine wrote
        expect(live.chats[0].alt).toHaveLength(3)

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const exported = (await exportedCharacters())[0]
        const chats = chatsOfCharacter(exported)
        expect(chats).toHaveLength(chatsBefore + 1)
        const branch = chats[chatsBefore]
        expect(idsOfMessages(branch).slice(0, 4)).toEqual(['t0u1', 't0c2', 't0u3', 't0c4'])
        expect(messagesOf(branch)).toHaveLength(5)
        const parts = markerParts(branch)
        expect(parts[0]).toBe(MARKER_HEAD)
        expect(parts).toEqual([MARKER_HEAD, 'branchedfrom', live.chats[0].id, live.chats[0].name, 't0c2', '}}'])
        expect(branch.name).toBe(`${String(live.chats[0].name)} (Branch)`)
        expect(exported.chatPage).toBe(live.chatPage)
        expect(chats[0]).not.toHaveProperty('alt')
        expect(hasKeyDeep(exported, 'alt')).toBe(false)
        expect(hasKeyDeep(exported, 'mem')).toBe(false)
        // The page keeps its alternatives, its parked memory and its chat order.
        expect(JSON.stringify(page.db.characters[0])).toBe(liveJson)
    }, 120_000)

    test('reproducer (W2): in stub mode the unit body of every archived character holds its branch chat, and no alt or mem', async () => {
        const page = await pageOf({}, false, 'none', false, treeOnAll)
        const chatsBefore = page.entries.slice(1).map((entry) => (wholeOf(page, entry) as unknown as { chats: Obj[] }).chats.length)

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        // The stubs' prompt lines come from the labels minted with their bodies, and name the branch chats like any other.
        expect(promptLabels()).toHaveLength(4)
        for (const line of promptLabels()) {
            expect(line, line).toMatch(/ \(1 branch chat\(s\), (about [0-9.]+|under 0\.1) MiB; 1 reply\(s\) left out\)$/)
        }
        const units = unitCharacters()
        expect(units).toHaveLength(3)
        for (const unit of units) {
            const index = page.entries.findIndex((entry) => entry.chaId === unit.chaId)
            expect(index, String(unit.name)).toBeGreaterThan(0)
            const chats = chatsOfCharacter(unit)
            expect(chats, String(unit.name)).toHaveLength(chatsBefore[index - 1] + 1)
            expect(idsOfMessages(chats[chats.length - 1]).slice(0, 4)).toEqual([`t${index}u1`, `t${index}c2`, `t${index}u3`, `t${index}c4`])
            expect(hasKeyDeep(unit, 'alt'), String(unit.name)).toBe(false)
            expect(hasKeyDeep(unit, 'mem'), String(unit.name)).toBe(false)
        }
    }, 120_000)

    test('reproducer (W3): in inline mode the archived characters in the database entry hold their branch chat', async () => {
        const page = await pageOf({}, false, 'none', false, treeOnAll)
        const chatsBefore = page.entries.map((entry) => (wholeOf(page, entry) as unknown as { chats: Obj[] }).chats.length)

        const outcome = await run({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        // The archived characters were read whole before the prompt, and their lines name the branch chats too.
        expect(promptLabels()).toHaveLength(4)
        for (const line of promptLabels()) {
            expect(line, line).toMatch(/ \(1 branch chat\(s\), (about [0-9.]+|under 0\.1) MiB; 1 reply\(s\) left out\)$/)
        }
        const exported = await exportedCharacters()
        expect(exported).toHaveLength(4)
        exported.forEach((character, index) => {
            expect(chatsOfCharacter(character), String(character.name)).toHaveLength(chatsBefore[index] + 1)
            expect(idsOfMessages(chatsOfCharacter(character)[chatsBefore[index]]).slice(0, 4)).toEqual([`t${index}u1`, `t${index}c2`, `t${index}u3`, `t${index}c4`])
        })
        expect(hasKeyDeep(exported, 'alt')).toBe(false)
        expect(unitCharacters()).toEqual([])
    }, 120_000)

    test('reproducer (W4): the prompt line says how many branch chats the chat becomes, how big they are and how many replies are left out; a long name is cut before the suffix', async () => {
        const longCharacter = 'C'.repeat(56)
        const longChat = 'N'.repeat(54)
        const page = await pageOf({}, false, 'none', false, (slot, index) => {
            if (index === 0) {
                slot.name = longCharacter
                growTree(slot, 't0', { fillers: 6000 }).name = longChat
            }
        })
        expect(page.db.characters[0].name).toBe(longCharacter)

        const outcome = await run({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const text = `${longCharacter} / ${longChat}`
        expect(text.length).toBeGreaterThan(100)
        const line = promptLabels().find((entry) => entry.startsWith(text.slice(0, 100))) ?? ''
        expect(line.startsWith(`${text.slice(0, 100)}... (1 branch chat(s), about `)).toBe(true)
        expect(line.endsWith('MiB; 1 reply(s) left out)')).toBe(true)
        const shown = Number(/about ([0-9.]+) MiB/.exec(line)?.[1])
        const chats = chatsOfCharacter((await exportedCharacters())[0])
        const measured = new TextEncoder().encode(JSON.stringify(chats[chats.length - 1])).length / MIB
        expect(Math.abs(shown - measured)).toBeLessThanOrEqual(0.1)
        expect(measured).toBeGreaterThan(0.2)
    }, 120_000)

    // W5: the existing decline contract holds for the new prompt
    test('guard (W5): declining the prompt of a continued alternative ends the export as declined, with nothing written', async () => {
        await pageOf({}, false, 'none', false, treeOnAll)
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(ALT_PROMPT))

        const outcome = await run(STUB)

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(sink.chunks).toEqual([])
        expect(sink.closedFile).toBeNull()
        expect(altPrompts()).toHaveLength(1)
    }, 120_000)

    test('reproducer (W6): a stub whose expanded body reaches the limit is named in the leave-out prompt and is not written, while its stripped body would have fitted', async () => {
        const page = await pageOf({}, false, 'none', false, (slot, index) => {
            if (index === 1) {
                growTree(slot, 't1', { fillers: 400 })
            }
        })
        const stripped = new TextEncoder().encode(JSON.stringify({ character: withoutForkOnlyChatData(coldUnitCharacter(wholeOf(page, page.entries[1]))) })).length
        // Between the stripped body and the body that holds the branch chat as well (about twice the shared prefix more).
        const limitBytes = Math.round(stripped * 1.5)
        const small = [2, 3].map((index) => new TextEncoder().encode(JSON.stringify({ character: coldUnitCharacter(wholeOf(page, page.entries[index])) })).length)
        expect(Math.max(...small)).toBeLessThan(limitBytes)

        const outcome = await run({ mode: 'stub', limitBytes })

        expect(outcome).toMatchObject({ status: 'saved' })
        const named = alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('4 GiB or more'))
        expect(named).toHaveLength(1)
        expect(named[0]).toContain(page.entries[1].name)
        expect(named[0]).not.toContain(page.entries[2].name)
        expect((await exportedCharacters())[1].coldstorage).toBe(page.entries[1].u)
        expect(entriesOf(sink.closedFile as Uint8Array).map((entry) => entry.name)).not.toContain(`coldstorage_${page.entries[1].u}.json`)
    }, 120_000)

    test('reproducer (W7): a confirmed chat that gains a continued alternative after the prompt is expanded with it, and nothing is reported', async () => {
        const page = await pageOf({}, false, 'none', false, treeOnAll)
        const live = page.db.characters[0] as unknown as { chats: Chat[] }
        const chatsBefore = live.chats.length
        captured.onOpen = () => {
            // hand-built: a later continuation from c2, as a chat that kept being used would hold
            ;(live.chats[0].alt as unknown as Obj[]).push(...lateLeaf('t0c2', false))
        }

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const chats = chatsOfCharacter((await exportedCharacters())[0])
        expect(chats).toHaveLength(chatsBefore + 2)
        expect(chats.slice(chatsBefore).map((chat) => idsOfMessages(chat).slice(0, 3))).toEqual([['t0u1', 't0c2', 't0u3'], ['t0u1', 't0c2', 'late-u']])
        expect(chats.slice(chatsBefore).map((chat) => chat.name)).toEqual([`${String(live.chats[0].name)} (Branch)`, `${String(live.chats[0].name)} (Branch 2)`])
    }, 120_000)

    // W8: the existing latecomer rule holds: a chat that was not named is stripped, never expanded
    test('guard (W8): a chat that gains a continued alternative with an interrupted reply after the prompt is stripped, named in the alternatives notice only, and gets no branch chat', async () => {
        const page = await pageOf({}, false)
        captured.onOpen = () => {
            const late = JSON.parse(JSON.stringify(page.db.characters[0])) as Obj
            late.chaId = 'late-character'
            late.name = 'Latecomer'
            const chat = chatsOfCharacter(late)[0]
            chat.alt = lateLeaf('', true)
            ;(page.db.characters as unknown[]).push(late)
        }
        const chatsBefore = (page.db.characters[0] as unknown as { chats: unknown[] }).chats.length

        const outcome = await run(STUB)

        expect(altPrompts()).toEqual([])
        expect(outcome).toMatchObject({ status: 'saved' })
        const notice = (outcome as { notices: string[] }).notices.join('\n')
        expect(notice).toContain(ALT_NOTICE)
        expect(notice).toContain('Latecomer / ')
        expect(notice).not.toContain(FORK_NOTICE)
        expect(notice).not.toContain(INTERRUPTED_KIND)
        const written = (await exportedCharacters()).find((character) => character.chaId === 'late-character') as Obj
        expect(chatsOfCharacter(written)).toHaveLength(chatsBefore)
        expect(await fileText()).not.toContain('late-u')
    }, 120_000)

    test('guard (W8b): a chat named only for another kind that gains a continued alternative after the prompt is stripped, named in the alternatives notice, and gets no branch chat', async () => {
        const page = await pageOf({}, false, 'none', false, (slot) => {
            ;(slot.chats as Obj[])[0].hideNames = true
        })
        const live = page.db.characters[0] as unknown as { chats: Chat[] }
        const chatsBefore = live.chats.length
        expect(live.chats[0].alt).toBeUndefined()
        const liveId = String(live.chats[0].id)
        captured.onOpen = () => {
            live.chats[0].alt = lateLeaf(String(live.chats[0].message[0].chatId), false) as unknown as Chat['alt']
        }

        const outcome = await run(STUB)

        expect(altPrompts()).toEqual([])
        expect(outcome).toMatchObject({ status: 'saved' })
        const notice = (outcome as { notices: string[] }).notices.join('\n')
        expect(notice).toContain(ALT_NOTICE)
        expect(notice).toContain(`${String(page.db.characters[0].name)} / ${String(live.chats[0].name)}`)
        const chats = chatsOfCharacter((await exportedCharacters())[0])
        expect(chats).toHaveLength(chatsBefore)
        expect(chats[0].id).toBe(liveId)
        expect(await fileText()).not.toContain('late-u')
    }, 120_000)

    test.each([
        ['without trees', undefined],
        ['with trees', treeOnAll],
    ])('reproducer (null entry): a null entry among the characters does not fail the export %s', async (_label, shape) => {
        const page = await pageOf({}, false, 'none', false, shape)
        ;(page.db.characters as unknown[]).push(null)

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved' })
    }, 120_000)

    test('reproducer (W9): a chat without an id gets one on its export copy only, and the marker names it', async () => {
        const page = await pageOf({}, false, 'none', false, (slot, index) => {
            const chat = growTree(slot, `t${index}`)
            if (index === 0) {
                delete chat.id
            }
        })
        const live = page.db.characters[0] as unknown as { chats: Chat[] }
        expect(live.chats[0].id).toBeUndefined()
        const chatsBefore = live.chats.length

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const chats = chatsOfCharacter((await exportedCharacters())[0])
        expect(chats).toHaveLength(chatsBefore + 1)
        expect(typeof chats[0].id).toBe('string')
        expect(chats[0].id).not.toBe('')
        expect(markerParts(chats[chatsBefore])[2]).toBe(chats[0].id)
        expect(live.chats[0].id).toBeUndefined()
    }, 120_000)

    test('guard (W10): a chat with a chat-only switch and hidden names that continued from an alternative is named once with those kinds, and nothing is reported afterwards', async () => {
        const page = await pageOf({}, false, 'none', false, (slot, index) => {
            growTree(slot, `t${index}`, {
                marks: (chat) => {
                    chat.hideNames = true
                    chat.useLocallySetGlobalVariables = true
                    chat.scopedJailbreak = true
                },
            })
        })
        const name = String(page.db.characters[0].name)
        const chatsBefore = (page.db.characters[0] as unknown as { chats: unknown[] }).chats.length

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const lines = forkPromptLines().filter((line) => line.startsWith(`${name} / `))
        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain('hidden names')
        expect(lines[0]).toContain('chat-only jailbreak setting')
        expect(chatsOfCharacter((await exportedCharacters())[0])).toHaveLength(chatsBefore + 1)
    }, 120_000)

    // W11 is the existing 'a page with no alternatives' test; W12 and W14 below
    test('guard (W12): chats that only hold rerolls write no extra chat and no alternative, and the prompt says how many replies are left out', async () => {
        const page = await pageOf({}, true)
        const chatsBefore = (page.db.characters[0] as unknown as { chats: unknown[] }).chats.length

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(promptLabels()).toHaveLength(4)
        for (const line of promptLabels()) {
            expect(line.endsWith(' / Chat 1 (1 reply(s) left out)'), line).toBe(true)
        }
        expect(chatsOfCharacter((await exportedCharacters())[0])).toHaveLength(chatsBefore)
        expect(await fileText()).not.toContain(ALT_MARK)
    }, 120_000)

    test('guard (W13): a chat that already holds an old branch marker and no alternatives is written exactly as it is', async () => {
        // the string the removed Branch handler wrote, in the shape upstream's handler still writes
        const old: Message = { role: 'char', data: '{{specialcomment::branchedfrom::old-parent::Old chat::old-point::}}', isComment: true, disabled: true, chatId: 'old-marker' }
        const source = [treeMessage('o1', 'user'), treeMessage('o2', 'char'), old]
        const page = await pageOf({}, false, 'none', false, (slot, index) => {
            if (index === 0) {
                ;((slot.chats as Obj[])[0]).message = JSON.parse(JSON.stringify(source)) as Obj[]
            }
        })

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(altPrompts()).toEqual([])
        const chats = chatsOfCharacter((await exportedCharacters())[0])
        expect(chats).toHaveLength((page.db.characters[0] as unknown as { chats: unknown[] }).chats.length)
        expect(messagesOf(chats[0])).toEqual(JSON.parse(JSON.stringify(source)))
    }, 120_000)

    test('guard (W14): a chat whose alternatives cannot be read is named as left out, stripped, and gets no extra chat', async () => {
        const page = await pageOf({}, false, 'none', false, treeOnAll)
        const live = page.db.characters[0] as unknown as { chats: Obj[] }
        live.chats[0].alt = 'ALTTEXT'
        const chatsBefore = live.chats.length

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(promptLineOf(`${String(page.db.characters[0].name)} / `)).toBe(`${String(page.db.characters[0].name)} / ${String(live.chats[0].name)} (alternative replies left out)`)
        const chats = chatsOfCharacter((await exportedCharacters())[0])
        expect(chats).toHaveLength(chatsBefore)
        expect(await fileText()).not.toContain('ALTTEXT')
    }, 120_000)

    test('reproducer (W15): a group character continued from an alternative keeps the speaker of every message in its branch chat', async () => {
        const page = await pageOf({}, false, 'none', false, (slot, index) => {
            if (index === 0) {
                slot.type = 'group'
                slot.characters = []
                slot.characterTalks = []
                slot.characterActive = []
                growTree(slot, 't0', { saying: 'speaker-1' })
            }
        })
        const chatsBefore = (page.db.characters[0] as unknown as { chats: unknown[] }).chats.length

        const outcome = await run({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const chats = chatsOfCharacter((await exportedCharacters())[0])
        expect(chats).toHaveLength(chatsBefore + 1)
        const messages = messagesOf(chats[chatsBefore])
        expect(messages).toHaveLength(5)
        for (const message of messages.slice(0, 4)) {
            expect(message.saying).toBe('speaker-1')
        }
        expect(messages[4].role).toBe('char')
    }, 120_000)

    test('reproducer (W16): a chat name and a user name that hold tokens the parser acts on give a marker that parses back to itself', async () => {
        const page = await pageOf({}, false, 'none', false, (slot, index) => {
            const chat = growTree(slot, `t${index}`)
            if (index === 0) {
                chat.name = 'Plan #} <user> ::'
            }
        })
        page.db.username = 'Us::er'

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const live = page.db.characters[0] as unknown as { chats: Chat[] }
        const chats = chatsOfCharacter((await exportedCharacters())[0])
        const branch = chats[live.chats.length]
        expect(branch).toBeDefined()
        // The expected text is written out, not computed: the name loses `<user>`, `#}` and the trailing `::`.
        const marker = messagesOf(branch)[4].data
        expect(marker).toBe(`{{specialcomment::branchedfrom::${String(live.chats[0].id)}::Plan } user ::t0c2::}}`)
        const parts = String(marker).split('::')
        expect(parts).toHaveLength(6)
        expect(parts[3]).not.toMatch(/\{\{|\{#|\}\}|#\}|:|<(user|char|bot)>/i)
    }, 120_000)

    test('guard (W17): a legacy unit known before the prompt is named as left out, stripped, and gets no extra chat', async () => {
        const KEY = '00000000-0000-4000-8000-0000000000dd'
        const records = [{ m: treeMessage('cold-u', 'user'), p: null, a: 1 }, { m: treeMessage('cold-c', 'char'), p: 'cold-u', a: 1 }]
        await setColdStorageItem(KEY, { character: { chaId: 'cold-branch', name: 'ColdEarly', type: 'character', chatPage: 0, chats: [{ id: 'k1', name: 'Kept', message: [{ time: 1, data: 'hello', role: 'char', chatId: 'cold-p' }], note: '', localLore: [], alt: records }] } })
        const page = await pageOf({}, false)
        ;(page.db.characters as unknown[]).push({ chaId: 'cold-branch', name: 'ColdEarly', type: 'character', chatPage: 0, coldstorage: KEY, chats: [] })

        const outcome = await run(STUB)

        expect(altPrompts()).toHaveLength(1)
        expect(promptLabels()).toEqual(['ColdEarly / Kept (alternative replies left out)'])
        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const unit = entriesOf(sink.closedFile as Uint8Array).find((entry) => entry.name === `coldstorage_${KEY}.json`)
        expect(unit).toBeDefined()
        const body = JSON.parse(decoder.decode((unit as WrittenEntry).data)) as { character: Obj }
        expect(chatsOfCharacter(body.character)).toHaveLength(1)
        expect(JSON.stringify(body)).not.toContain('cold-u')
    }, 120_000)

    test('guard (W18): an interrupted reply that only a branch chat carries is named on its chat in the fork-data prompt, before the writer opens, and the written chat has no such mark', async () => {
        const page = await pageOf({}, false, 'none', false, (slot, index) => {
            growTree(slot, `t${index}`, { marks: (chat) => { chat.message[chat.message.length - 1].interrupted = true } })
        })
        const name = String(page.db.characters[0].name)
        const chatsBefore = (page.db.characters[0] as unknown as { chats: unknown[] }).chats.length
        let chunksAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(FORK_PROMPT)) {
                chunksAtPrompt = sink.chunks.length
            }
            return true
        })

        const outcome = await run(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(chunksAtPrompt).toBe(0)
        const lines = forkPromptLines().filter((line) => line.startsWith(`${name} / `))
        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain(INTERRUPTED_KIND)
        const exported = await exportedCharacters()
        expect(hasKeyDeep(exported, 'interrupted')).toBe(false)
        expect(chatsOfCharacter(exported[0])).toHaveLength(chatsBefore + 1)
    }, 120_000)

    test('guard (W19): an interrupted reply that only a late branch carries is named in the notice, and its branch chat is written', async () => {
        const page = await pageOf({}, false, 'none', false, treeOnAll)
        const live = page.db.characters[0] as unknown as { chats: Chat[] }
        const chatsBefore = live.chats.length
        captured.onOpen = () => {
            ;(live.chats[0].alt as unknown as Obj[]).push(...lateLeaf('t0c2', true))
        }

        const outcome = await run(STUB)

        expect(forkPrompts()).toEqual([])
        expect(outcome).toMatchObject({ status: 'saved' })
        const notice = (outcome as { notices: string[] }).notices.join('\n')
        expect(notice).toContain(FORK_NOTICE)
        expect(notice).toContain(`${String(page.db.characters[0].name)} / ${String(live.chats[0].name)} (${INTERRUPTED_KIND})`)
        const exported = await exportedCharacters()
        expect(chatsOfCharacter(exported[0])).toHaveLength(chatsBefore + 2)
        expect(hasKeyDeep(exported, 'interrupted')).toBe(false)
    }, 120_000)
})

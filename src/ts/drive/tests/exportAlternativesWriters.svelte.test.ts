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
 */
async function pageOf(grow: Record<number, number> = {}, withAlt = false): Promise<Page> {
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

import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { setColdStorageItem } from 'src/ts/process/coldstorage.svelte'
import { alternativeChatLabels } from 'src/ts/drive/exportAlternatives'
import { exportAlternativeLabels } from 'src/ts/drive/exportInline'

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

describe('exportAlternativeLabels', () => {
    // T80 regression reproducer: the list counts chats, not texts
    test('reproducer: two characters with the same chat text give two labels, and one chat read through two sources gives one', () => {
        const alice = (chaId: string) => ({ chaId, name: 'Alice', chats: [{ id: `${chaId}-chat`, name: 'Chat 1', alt: [altRecord()] }] })
        const cold = { collected: { omittedAlternatives: alternativeChatLabels(alice('one')) }, inlined: new Map([['k', alice('one')]]), stubEntries: new Map() } as unknown as BackupColdStorage
        const labels = exportAlternativeLabels({ characters: [alice('one'), alice('two')] } as unknown as Pick<Database, 'characters'>, cold)
        expect(labels).toHaveLength(2)
        expect(new Set(labels.map((label) => label.key)).size).toBe(2)
        expect(labels.map((label) => label.text)).toEqual(['Alice / Chat 1', 'Alice / Chat 1'])
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
        expect(promptLabels()).toEqual(['ColdEarly / Kept'])
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

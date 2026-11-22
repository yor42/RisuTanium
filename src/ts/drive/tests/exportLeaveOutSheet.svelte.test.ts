/**
 * S2: a `.bin` export (full and partial) can answer its five fork-only prompts with one leave-out question
 * (`askLeaveOut`). `true` continues, `false` declines with nothing written, `null` falls back to the five prompts, and an
 * export without the option keeps them. The file is the same whichever way the consent is given.
 *
 * `SaveLocalBackup` and `SavePartialLocalBackup` run for real over a store2 page that holds all five kinds: two task
 * presets, an installed theme pack, usage keys as `recordUsage` writes them, and a chat that was continued from an
 * alternative and holds an interrupted reply. The browser writer stand-in keeps every chunk, and the database entry is
 * decoded through `decodeRisuSave`. A passing test says nothing about a native writer or a real store.
 *
 * Titles: `reproducer` fails when the hook is absent (the base ignores the option and asks the five prompts);
 * `guard` passes before and after unless it says it needs the hook.
 */
import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat, Database, Message } from 'src/ts/storage/database.svelte'
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

/** Counter behind the mocked `v4`, reset before every export so two exports of the same data name entries alike. */
const uuidBox = vi.hoisted(() => ({ next: 0 }))

const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const saveDialogMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'backup-output.bin'))

vi.mock('uuid', async (importOriginal) => {
    const actual = await importOriginal<typeof import('uuid')>()
    return {
        ...actual,
        v4: () => `00000000-0000-4000-8000-${String(++uuidBox.next).padStart(12, '0')}`,
    }
})

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
import type { BinLeaveOutEntry } from 'src/ts/drive/binLeaveOut'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { detachTail } from 'src/ts/process/chatTree'
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

// The branch marker is a string of 64 or more characters. msgpackr under the Node running the tests passes such a
// string a length past the buffer's end to `utf8Write`, which Node rejects; the clamp changes no byte written. It is
// scoped to this file.
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

//#region helpers

const decoder = new TextDecoder()
const NOW = 1_700_000_000_000

type Kind = 'alternatives' | 'interrupted' | 'presets' | 'packs' | 'usage' | 'chroMemory' | 'workspaces'
// ChroMemory is not in this list: the five-kind rows below pin the original kinds, and the ChroMemory rows add it on top.
const ALL_KINDS: readonly Kind[] = ['alternatives', 'interrupted', 'presets', 'packs', 'usage']

const PRESETS = [
    { id: 'task-0', name: 'Summarize notes', instructions: 'PRESETMARK one', model: 'm' },
    { id: 'task-1', name: 'Translate', instructions: 'PRESETMARK two', model: 'm' },
]

const WORKSPACES = [
    { id: 'w1', name: 'Notes space', createdAt: 1, files: [{ id: 'f1', path: 'AGENTS.md', text: 'rules', size: 5, mtime: 5 }] },
    { id: 'w2', name: 'Second space', createdAt: 2, files: [] },
]

/** A stored theme pack's shape, with a short archive string (msgpackr under Node refuses a longer one). */
const PACK = {
    v: 1, id: 'pack-1', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
    modes: ['light', 'dark'], fonts: [], archive: 'assets/tp-one.risutheme', bytes: 64, installedAt: 1_700_000_000_000,
}

/** The keys `recordUsage` writes into `db.statics`: `u1|<month>|<purpose>|<counter>|<model>`. */
const USAGE_STATICS = { 'u1|2026-11|chat|n|model-a': 3, 'u1|2026-11|chat|i|model-a': 120, 'u1|2026-11|chat|o|model-a': 45 }

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

function treeMessage(chatId: string, role: 'user' | 'char'): Message {
    return { role, data: `text ${chatId}`, chatId }
}

/**
 * The first chat of `slot` as the engine writes a continued Branch: `u1 c2 u3 c4` is cut at `u3` and continued with
 * `u5 c6`, so the chat holds one continued alternative the export writes as an extra chat.
 */
function growTree(slot: Obj): void {
    const chat = (slot.chats as Obj[])[0] as unknown as Chat
    chat.message = [treeMessage('t0u1', 'user'), treeMessage('t0c2', 'char'), treeMessage('t0u3', 'user'), treeMessage('t0c4', 'char')]
    expect(detachTail(chat, 2)).toBe(true)
    chat.message.push(treeMessage('t0u5', 'user'), treeMessage('t0c6', 'char'))
}

/** A store2 page of two resident characters that holds the named kinds of fork-only data. */
async function pageOf(kinds: readonly Kind[]): Promise<Database> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const base = shortened(buildSmall(2)) as Obj
    const characters = base.characters as Obj[]
    if (kinds.includes('alternatives')) {
        growTree(characters[0])
    }
    if (kinds.includes('interrupted')) {
        const messages = ((characters[0].chats as Obj[])[0].message as Obj[])
        messages[0].interrupted = true
    }
    const extras: Obj = {
        ...(kinds.includes('presets') ? { taskPresets: PRESETS } : {}),
        ...(kinds.includes('packs') ? { themePacks: [PACK], activeThemePack: PACK.id } : {}),
        ...(kinds.includes('usage') ? { statics: { ...(base.statics as Obj | undefined), ...USAGE_STATICS } } : {}),
        ...(kinds.includes('chroMemory') ? { ltmEngine: true, ltmSettings: { budgetTokens: 1800, future: 1 } } : {}),
        ...(kinds.includes('workspaces') ? { utilityWorkspaces: WORKSPACES } : {}),
    }
    const fixture = { ...base, ...extras } as unknown as Database
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

type Runner = (options?: BackupExportOptions, entry?: { assetsExplained?: boolean }) => Promise<ExportOutcome>
const full: Runner = (options) => SaveLocalBackup({ mode: 'inline', ...options })
const partial: Runner = (options, entry) => SavePartialLocalBackup({ mode: 'inline', ...options }, entry)

type Fork = 'branches' | 'forkChat' | 'presets' | 'packs' | 'usage' | 'chroMemory'

/** Which of the six per-kind prompts a confirm text is, or null. */
function forkPromptOf(message: string): Fork | null {
    if (message === language.backupChroMemoryConfirm) return 'chroMemory'
    if (message === language.backupUsageStatsConfirm) return 'usage'
    if (message.includes('task preset(s)')) return 'presets'
    if (message.includes('theme pack(s)')) return 'packs'
    if (message.includes('data that only this app uses')) return 'forkChat'
    if (message.includes('alternative replies')) return 'branches'
    return null
}

/** The per-kind prompts `alertConfirm` was asked, in order. */
const forkPrompts = (): Fork[] => alertConfirmMock.mock.calls
    .map((call) => forkPromptOf(String(call[0])))
    .filter((prompt): prompt is Fork => prompt !== null)

const FIVE: Fork[] = ['branches', 'forkChat', 'presets', 'packs', 'usage']

const asked = (message: string): boolean => alertConfirmMock.mock.calls.some((call) => String(call[0]) === message)

/** Every confirm but the two partial-backup explanations says no, so a prompt that is asked declines the export. */
function declineForkPrompts(): void {
    alertConfirmMock.mockImplementation(async (message: string) => forkPromptOf(message) === null)
}

function resetRun(): void {
    sink.chunks.length = 0
    sink.closedFile = null
    uuidBox.next = 0
    alertConfirmMock.mockClear()
}

async function databaseOf(file: Uint8Array): Promise<Obj> {
    const entry = entriesOf(file).find((candidate) => candidate.name === 'database.risudat')
    if (entry === undefined) {
        throw new Error('the export wrote no database entry')
    }
    return await decodeRisuSave(entry.data) as unknown as Obj
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    resetRun()
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
    ['SaveLocalBackup', full],
    ['SavePartialLocalBackup', partial],
])('%s with askLeaveOut over a page that holds all five kinds', (_name, run) => {
    test('S2-R1/R4 reproducer: answering true saves, asks once, and none of the five per-kind prompts is asked', async () => {
        await pageOf(ALL_KINDS)
        declineForkPrompts()
        const askLeaveOut = vi.fn(async () => true)

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect((sink.closedFile as Uint8Array).length).toBeGreaterThan(0)
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(forkPrompts()).toEqual([])
    }, 120_000)

    test('S2-R2 reproducer: the summary names every kind in prompt order with its count, names and chat-data kinds', async () => {
        await pageOf(ALL_KINDS)
        let summary: readonly BinLeaveOutEntry[] = []
        const askLeaveOut = vi.fn(async (given: readonly BinLeaveOutEntry[]) => {
            summary = given
            return true
        })

        await run({ askLeaveOut }, { assetsExplained: true })

        expect(summary.map((entry) => entry.kind)).toEqual(['alternatives', 'forkChatData', 'taskPresets', 'themePacks', 'usageStats'])
        expect(summary.map((entry) => entry.count)).toEqual([1, 1, 2, 1, 1])
        const [alternatives, forkChat, presets, packs] = summary
        expect(alternatives.kind === 'alternatives' && alternatives.branchChats).toBeGreaterThan(0)
        expect(forkChat.kind === 'forkChatData' && forkChat.kinds).toEqual(['interruptedNote'])
        expect(presets.kind === 'taskPresets' && presets.names).toEqual(['Summarize notes', 'Translate'])
        expect(packs.kind === 'themePacks' && packs.names).toEqual(['Origin Navy'])
    }, 120_000)

    test('S2-R3 reproducer: answering false declines with nothing written', async () => {
        await pageOf(ALL_KINDS)
        alertConfirmMock.mockImplementation(async () => true)
        const askLeaveOut = vi.fn(async () => false)

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(sink.chunks).toEqual([])
        expect(sink.closedFile).toBeNull()
        expect(saveDialogMock).not.toHaveBeenCalled()
        expect(alertErrorMock).not.toHaveBeenCalled()
    }, 120_000)

    test('S2-G6 guard (needs the hook for the call count): answering null asks the five prompts in order and goes on when they are yes', async () => {
        await pageOf(ALL_KINDS)
        const askLeaveOut = vi.fn(async () => null)

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(forkPrompts()).toEqual(FIVE)
        expect(outcome).toMatchObject({ status: 'saved' })
    }, 120_000)

    test('S2-G6 guard: answering null and declining the first prompt declines, and no later prompt is asked', async () => {
        await pageOf(ALL_KINDS)
        declineForkPrompts()
        const askLeaveOut = vi.fn(async () => null)

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(forkPrompts()).toEqual(['branches'])
        expect(sink.chunks).toEqual([])
    }, 120_000)

    test('S2-G2 guard: without the option the five prompts are asked in order, and declining one stops the rest', async () => {
        await pageOf(ALL_KINDS)

        const outcome = await run({}, { assetsExplained: true })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(forkPrompts()).toEqual(FIVE)

        resetRun()
        alertConfirmMock.mockImplementation(async (message: string) => forkPromptOf(message) !== 'forkChat')
        const declined = await run({}, { assetsExplained: true })

        expect(declined).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(forkPrompts()).toEqual(['branches', 'forkChat'])
        expect(sink.chunks).toEqual([])
    }, 120_000)

    test('S2-G3 guard: a page with no fork-only data asks no leave-out question and saves', async () => {
        await pageOf([])
        const askLeaveOut = vi.fn(async () => true)

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(askLeaveOut).not.toHaveBeenCalled()
        expect(forkPrompts()).toEqual([])
    }, 120_000)

    // Compatibility guard: passes before and after, because the base ignores the option and every prompt answers yes.
    test('S2-G1 guard: the file is byte-identical with the leave-out question, without it, and on a repeat run', async () => {
        await pageOf(ALL_KINDS)
        const entry = { assetsExplained: true }

        resetRun()
        const a = await run({}, entry)
        const fileA = sink.closedFile as Uint8Array

        resetRun()
        const b = await run({ askLeaveOut: async () => true }, entry)
        const fileB = sink.closedFile as Uint8Array

        resetRun()
        const c = await run({}, entry)
        const fileC = sink.closedFile as Uint8Array

        expect([a.status, b.status, c.status]).toEqual(['saved', 'saved', 'saved'])
        expect(fileA.length).toBeGreaterThan(1000)
        expect(Buffer.from(fileB).equals(Buffer.from(fileA))).toBe(true)
        expect(Buffer.from(fileC).equals(Buffer.from(fileA))).toBe(true)
    }, 180_000)

    // Fails on a base without the hook only because the hook is never called; not a reproducer. It shows that the
    // bytes compared above came from the hook path, and that the file holds exactly what the sheet said it would leave out.
    test('S2-G1 guard (needs the hook): the compared file came from the hook path and holds none of the named data', async () => {
        await pageOf(ALL_KINDS)
        const askLeaveOut = vi.fn(async () => true)

        resetRun()
        const outcome = await run({ askLeaveOut }, { assetsExplained: true })
        const fileB = sink.closedFile as Uint8Array

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(forkPrompts()).toEqual([])
        const database = await databaseOf(fileB)
        const text = JSON.stringify(database)
        expect(database).not.toHaveProperty('taskPresets')
        expect(database).not.toHaveProperty('themePacks')
        expect(text).not.toContain('PRESETMARK')
        expect(text).not.toContain('"interrupted"')
        const chatNames = (database.characters as Obj[]).flatMap((character) => (character.chats as Obj[]).map((chat) => String(chat.name)))
        expect(chatNames.some((name) => name.endsWith('(Branch)'))).toBe(true)
    }, 180_000)
})

describe.each([
    ['SaveLocalBackup', full],
    ['SavePartialLocalBackup', partial],
])('%s with askLeaveOut over a page with ChroMemory selected', (_name, run) => {
    test('B7 reproducer: the summary names ChroMemory, and answering true writes a file without the keys and asks no per-kind prompt', async () => {
        await pageOf(['chroMemory'])
        let summary: readonly BinLeaveOutEntry[] = []
        const askLeaveOut = vi.fn(async (given: readonly BinLeaveOutEntry[]) => {
            summary = given
            return true
        })

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(summary).toEqual([{ kind: 'chroMemory', count: 1 }])
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(forkPrompts()).toEqual([])
        const database = await databaseOf(sink.closedFile as Uint8Array)
        expect(Object.hasOwn(database, 'ltmEngine')).toBe(false)
        expect(Object.hasOwn(database, 'ltmSettings')).toBe(false)
    }, 180_000)

    test('B7 reproducer: an unanswered sheet (null) falls back to the per-kind chain, which asks the ChroMemory prompt', async () => {
        await pageOf(['chroMemory'])
        const askLeaveOut = vi.fn(async () => null)

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(forkPrompts()).toEqual(['chroMemory'])
    }, 180_000)
})

describe.each([
    ['SaveLocalBackup', full],
    ['SavePartialLocalBackup', partial],
])('%s with askLeaveOut over a page that holds utility workspaces only', (_name, run) => {
    test('T21 reproducer: the sheet summary names every workspace before any writer opens, and answering true writes a file without them', async () => {
        await pageOf(['workspaces'])
        let summary: readonly BinLeaveOutEntry[] = []
        let chunksAtAsk = -1
        const askLeaveOut = vi.fn(async (given: readonly BinLeaveOutEntry[]) => {
            summary = given
            chunksAtAsk = sink.chunks.length
            return true
        })

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(summary).toEqual([{ kind: 'workspaces', count: 2, names: ['Notes space', 'Second space'] }])
        expect(chunksAtAsk).toBe(0)
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(forkPrompts()).toEqual([])
        const database = await databaseOf(sink.closedFile as Uint8Array)
        expect(Object.hasOwn(database, 'utilityWorkspaces')).toBe(false)
    }, 180_000)

    test('T21 reproducer: declining the sheet writes nothing', async () => {
        await pageOf(['workspaces'])
        const askLeaveOut = vi.fn(async () => false)

        const outcome = await run({ askLeaveOut }, { assetsExplained: true })

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(sink.chunks).toEqual([])
        expect(sink.closedFile).toBeNull()
        expect(saveDialogMock).not.toHaveBeenCalled()
    }, 180_000)
})

describe('SavePartialLocalBackup entry facts', () => {
    test('S2-R5 reproducer: assetsExplained skips both explanation confirms', async () => {
        await pageOf([])

        const outcome = await SavePartialLocalBackup({ mode: 'inline' }, { assetsExplained: true })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(asked(language.partialBackupFirstConfirm)).toBe(false)
        expect(asked(language.partialBackupSecondConfirm)).toBe(false)
    }, 120_000)

    test('S2-R5 guard: without the entry both explanations are asked, first then second', async () => {
        await pageOf([])

        const outcome = await SavePartialLocalBackup({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved' })
        const explanations = alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((message) => message === language.partialBackupFirstConfirm || message === language.partialBackupSecondConfirm)
        expect(explanations).toEqual([language.partialBackupFirstConfirm, language.partialBackupSecondConfirm])
    }, 120_000)

    // Compatibility guard: passes before and after. The pre-S2 call shape (no options, no entry, both explanations
    // confirmed) produces the same file as the hook path that skips the explanations and leaves nothing out.
    test('S2-G1 baseline guard: the no-entry partial export is byte-identical to the hook path with assetsExplained', async () => {
        await pageOf(ALL_KINDS)

        resetRun()
        const baseline = await SavePartialLocalBackup({ mode: 'inline' })
        const fileBaseline = sink.closedFile as Uint8Array

        resetRun()
        const hooked = await SavePartialLocalBackup({ mode: 'inline', askLeaveOut: async () => true }, { assetsExplained: true })
        const fileHooked = sink.closedFile as Uint8Array

        expect([baseline.status, hooked.status]).toEqual(['saved', 'saved'])
        expect(fileBaseline.length).toBeGreaterThan(1000)
        expect(Buffer.from(fileHooked).equals(Buffer.from(fileBaseline))).toBe(true)
    }, 180_000)

    test('S2-R5 guard: assetsExplained false still asks both explanations and a decline ends the export', async () => {
        await pageOf([])
        alertConfirmMock.mockImplementation(async (message: string) => message !== language.partialBackupSecondConfirm)

        const outcome = await SavePartialLocalBackup({ mode: 'inline' }, { assetsExplained: false })

        expect(outcome).toEqual({ status: 'declined', cause: 'partial-explanation-declined' })
        expect(asked(language.partialBackupFirstConfirm)).toBe(true)
        expect(sink.chunks).toEqual([])
    }, 120_000)
})

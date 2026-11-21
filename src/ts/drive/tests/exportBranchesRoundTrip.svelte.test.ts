/**
 * CHORE-478 S5 (RT1, RT2): a chat that was continued from an alternative leaves the fork as a plain `.bin` chat and comes
 * back as one. `SaveLocalBackup` runs for real over a store2 page whose chats were written by the engine (`detachTail`);
 * the file is read the way an upstream reader reads it (the database entry through `decodeRisuSave`, each unit entry as
 * JSON, no entity-named payload, no unit left dangling), and the same bytes then go through the real `LoadLocalBackup`
 * into a fresh store2 page, whose commit is the shell stub (`store2ShellStub.ts`): the import half asserts on the database
 * the stub's `request.decode()` produced, not on what a real store2 commit lands. The reader is this repository's
 * decoder plus structural checks, not upstream's code. A passing test says nothing about a native writer or a real store.
 *
 * Titles: `reproducer` fails when the branch chats are absent from the file; `guard` passes before and after.
 */
import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat, Database, Message } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation: without it restore takes its no-Web-Locks
    // branch and never waits on another tab, which is outside what this file exercises.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertWaitMock = vi.hoisted(() => vi.fn())

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
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
                    close: async () => { },
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

// A clean page: the restore's save-first step returns at its clean check instead of waiting out its bound.
vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/globalApi.svelte')>(),
    isSaveClean: () => true,
}))

const shell = vi.hoisted((): Store2ShellBox => ({ commits: [], events: [] }))
vi.mock(import('src/ts/drive/storeImport'), (importOriginal) => store2ShellMock(shell)(importOriginal))

//#endregion

//#region units and the legacy OPFS stand-in

/** The page store's units (coldstorage/<key>), kept apart from the assets. */
const unitMem = new Map<string, Uint8Array>()

function isUnitKey(key: string): boolean {
    return key.startsWith('coldstorage/')
}

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

import { resetStore2ShellBox, store2ShellMock, useStore2RestorePage, type Store2ShellBox } from './store2ShellStub'
import { SaveLocalBackup, LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { detachTail } from 'src/ts/process/chatTree'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { forageOverMap } from 'src/ts/storage/tests/appStoreMock'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry } from 'src/ts/storage/store2/codec'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

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

//#region helpers

const decoder = new TextDecoder()
const NOW = 1_700_000_000_000
const UNIT_ENTRY_NAME = /^coldstorage_[0-9a-f-]{36}\.json$/
const MARKER_HEAD = '{{specialcomment'

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

interface WrittenEntry {
    name: string
    data: Uint8Array
}

/** The entries the real `LocalWriter` emitted into the sink, in write order. */
function writtenEntries(): WrittenEntry[] {
    const bytes = concat(backupSink.writes)
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
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

/** What the upstream-shaped reader sees: the decoded characters of the database entry and every unit entry as JSON. */
async function upstreamRead(): Promise<{ characters: Obj[], units: Map<string, Obj>, names: string[] }> {
    const entries = writtenEntries()
    const database = entries.find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error('the export wrote no database entry')
    }
    const characters = ((await decodeRisuSave(database.data)) as unknown as { characters: Obj[] }).characters
    const units = new Map<string, Obj>()
    for (const entry of entries.filter((candidate) => UNIT_ENTRY_NAME.test(candidate.name))) {
        units.set(entry.name, (JSON.parse(decoder.decode(entry.data)) as { character: Obj }).character)
    }
    return { characters, units, names: entries.map((entry) => entry.name) }
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

const chatsOf = (character: Obj): Obj[] => character.chats as Obj[]
const messagesOf = (chat: Obj): Obj[] => chat.message as Obj[]
const lastMessageOf = (chat: Obj): Obj => messagesOf(chat)[messagesOf(chat).length - 1]

/** Drives LoadLocalBackup() with `bytes` as the selected file's content, and awaits its onchange handler. */
let capturedInput: HTMLInputElement | null = null
async function loadBackupBytes(bytes: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    const file = new File([asBlobPart(bytes)], 'backup.bin')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

/** The value with every string cut to 50 characters, as the other store2 export suites keep their fixtures (msgpackr, Node). */
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
 * `u5 c6`, and `c6` is then rerolled. One continued alternative (`u3 c4`, from `c2`) and one reroll (`c6`).
 */
function growTree(slot: Obj, tag: string): void {
    const chat = (slot.chats as Obj[])[0] as unknown as Chat
    chat.message = [treeMessage(`${tag}u1`, 'user'), treeMessage(`${tag}c2`, 'char'), treeMessage(`${tag}u3`, 'user'), treeMessage(`${tag}c4`, 'char')]
    expect(detachTail(chat, 2)).toBe(true)
    chat.message.push(treeMessage(`${tag}u5`, 'user'), treeMessage(`${tag}c6`, 'char'))
    expect(detachTail(chat, 3)).toBe(true)
    chat.message.push(treeMessage(`${tag}c6b`, 'char'))
}

/** A store2 page of three characters, the first resident and the others stubs of their entities, each with the tree when asked. */
async function pageOf(withTree: boolean): Promise<Database> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(3)) as Obj), archiveCharacters: true } as unknown as Database
    if (withTree) {
        fixture.characters.forEach((slot, index) => growTree(slot as unknown as Obj, `t${index}`))
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
    const context = { lists: fakeLists, env: seededEnv(77), encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW }) }
    registerResidency(createResidency({ backend: memory, context }))
    getDatabaseMock.mockImplementation(() => db)
    return db
}

//#endregion

let createElementSpy: ReturnType<typeof vi.spyOn>
let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    unitMem.clear()
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    forageSetItemMock.mockClear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    alertWaitMock.mockClear()
    resetStore2ShellBox(shell)
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
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })

    capturedInput = null
    const realCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
})

afterEach(() => {
    resetResidencyForTest()
    createElementSpy.mockRestore()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

/** The branch chat of `chats` that follows its parent's own chats: the chats beyond the fixture's two. */
const FIXTURE_CHATS = 2

describe('fork export, upstream-shaped read, fork import of a chat continued from an alternative', () => {
    test('reproducer (RT1, stub mode): the file holds plain branch chats whose markers name an exported chat and one of its messages; units and database carry no alt or mem', async () => {
        const db = await pageOf(true)

        const outcome = await SaveLocalBackup({ mode: 'stub' })

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const read = await upstreamRead()
        expect(read.characters).toHaveLength(db.characters.length)
        // The resident character is in the database entry; each stub keeps a placeholder there and its chats in its unit.
        const exported = [read.characters[0], ...read.units.values()]
        expect(read.units.size).toBe(2)
        expect(exported).toHaveLength(db.characters.length)
        for (const character of exported) {
            const chats = chatsOf(character)
            expect(chats, String(character.name)).toHaveLength(FIXTURE_CHATS + 1)
            const branch = chats[FIXTURE_CHATS]
            const parts = String(lastMessageOf(branch).data).split('::')
            expect(parts[0]).toBe(MARKER_HEAD)
            expect(parts[1]).toBe('branchedfrom')
            const parent = chats.find((chat) => chat.id === parts[2])
            expect(parent, `[2] names an exported chat of ${String(character.name)}`).toBeDefined()
            expect(messagesOf(branch).some((message) => message.chatId === parts[4]), `[4] names a message of the branch chat`).toBe(true)
            expect(messagesOf(parent as Obj).some((message) => message.chatId === parts[4]), `[4] names a message of the parent chat`).toBe(true)
            expect(lastMessageOf(branch)).toMatchObject({ role: 'char', isComment: true, disabled: true })
        }
        expect(hasKeyDeep(read.characters, 'alt')).toBe(false)
        expect(hasKeyDeep(read.characters, 'mem')).toBe(false)
        expect(hasKeyDeep([...read.units.values()], 'alt')).toBe(false)
        expect(hasKeyDeep([...read.units.values()], 'mem')).toBe(false)
        // every stub's unit is present under a unit-id name, and no entity-named payload is carried
        const dangling = read.characters.filter((character) => typeof character.coldstorage === 'string' && !read.names.includes(`coldstorage_${String(character.coldstorage)}.json`))
        expect(dangling).toEqual([])
        expect(read.names.filter((name) => /^coldstorage_[0-9a-v]{26}\.json$/.test(name))).toEqual([])
    }, 120_000)

    test('reproducer (RT1, inline mode): the same bytes import into a fresh page as plain chats, with no alt, the markers byte-equal and nothing rebuilt', async () => {
        await pageOf(true)

        const outcome = await SaveLocalBackup({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        const read = await upstreamRead()
        expect(read.units.size).toBe(0)
        expect(read.characters.map((character) => chatsOf(character).length)).toEqual([FIXTURE_CHATS + 1, FIXTURE_CHATS + 1, FIXTURE_CHATS + 1])
        expect(hasKeyDeep(read.characters, 'alt')).toBe(false)

        // Another profile imports the file: the residency of the exporting page is not there.
        resetResidencyForTest()
        useStore2RestorePage(createForageBackedStore(forageOverMap(new Map())), 'tauri')
        await loadBackupBytes(concat(backupSink.writes))

        expect(shell.commits).toHaveLength(1)
        expect(alertWaitMock.mock.calls.some((call) => call[0] === language.store2RestoreSaving)).toBe(false)
        const installed = shell.commits[0].decoded as unknown as { characters: Obj[] }
        expect(installed.characters.map((character) => character.name)).toEqual(read.characters.map((character) => character.name))
        installed.characters.forEach((character, index) => {
            const chats = chatsOf(character)
            expect(chats, String(character.name)).toHaveLength(FIXTURE_CHATS + 1)
            expect(hasKeyDeep(chats, 'alt'), String(character.name)).toBe(false)
            expect(lastMessageOf(chats[FIXTURE_CHATS]).data).toBe(lastMessageOf(chatsOf(read.characters[index])[FIXTURE_CHATS]).data)
            expect(messagesOf(chats[FIXTURE_CHATS]).map((message) => message.chatId).slice(0, 4)).toEqual([`t${index}u1`, `t${index}c2`, `t${index}u3`, `t${index}c4`])
        })
    }, 120_000)

    test('guard (RT2): a page without alternatives round-trips with its chats unchanged', async () => {
        await pageOf(false)

        const outcome = await SaveLocalBackup({ mode: 'inline' })

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((text) => text.includes('alternative replies'))).toEqual([])
        const read = await upstreamRead()
        expect(read.characters.map((character) => chatsOf(character).length)).toEqual([FIXTURE_CHATS, FIXTURE_CHATS, FIXTURE_CHATS])
        resetResidencyForTest()
        useStore2RestorePage(createForageBackedStore(forageOverMap(new Map())), 'tauri')
        await loadBackupBytes(concat(backupSink.writes))
        expect(shell.commits).toHaveLength(1)
        expect(alertWaitMock.mock.calls.some((call) => call[0] === language.store2RestoreSaving)).toBe(false)
        const installed = shell.commits[0].decoded as unknown as { characters: Obj[] }
        expect(installed.characters.map((character) => chatsOf(character))).toEqual(read.characters.map((character) => chatsOf(character)))
    }, 120_000)
})

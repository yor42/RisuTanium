/**
 * Memory stage 1 step 4: a local backup carries every cold-storage unit the
 * database it writes needs, and a restore puts every such unit back
 * (Agents/Reports/49-memory-stage-1-plan.md, D13; MC-147).
 *
 * `SaveLocalBackup`, `SavePartialLocalBackup` and `LoadLocalBackup`
 * (`src/ts/drive/backuplocal.ts`) run for real together with the REAL
 * collector, the real `setColdStorageItem` / `readColdStorageItem` and the
 * real `LocalWriter`. The storage and output sinks are replaced:
 * `streamsaver` captures the bytes the writer emits, an OPFS stand-in is the
 * cold-storage backend, and the key/value store behind `forageStorage` is a
 * mock. Every dialog is a mock, `getDatabase` returns each test's own
 * database, `dbWriteLock.acquire` is spied, and the
 * modules loaded transitively for unrelated work (stores, plugins, parser,
 * platform and the Tauri APIs) are stubbed. A
 * passing test here is not evidence about the Tauri or Node backends, or
 * about a real browser's storage.
 *
 * Tests whose title starts with `guard:` hold both before and after the
 * change; every other test fails without it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation:
    // without it restore takes its no-Web-Locks branch and never waits on
    // another tab, which is outside what this file exercises.
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

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
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

vi.mock('streamsaver', () => ({
    default: {
        createWriteStream: () => ({
            getWriter: () => ({
                write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
                close: async () => { },
            }),
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

//#region OPFS backend stand-in (navigator.storage)

const opfsStore = new Map<string, Uint8Array>()
const opfsReadLog: string[] = []

function opfsFilename(key: string): string {
    return 'coldstorage_' + key + '.json'
}

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

const mockDirectoryHandle = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
        if (opts?.create) {
            return {
                async createWritable() {
                    return {
                        async write(data: Uint8Array) {
                            opfsStore.set(name, data)
                        },
                        async close() { },
                    }
                },
            }
        }
        opfsReadLog.push(name)
        if (!opfsStore.has(name)) {
            throw new MockNotFoundError(`not found: ${name}`)
        }
        return {
            async getFile() {
                const bytes = opfsStore.get(name)!
                return {
                    async arrayBuffer() {
                        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
                    },
                }
            },
        }
    },
    async removeEntry(name: string) {
        opfsStore.delete(name)
    },
    entries() {
        const iter = opfsStore.keys()
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        const r = iter.next()
                        if (r.done) {
                            return { done: true as const, value: undefined }
                        }
                        return { done: false as const, value: [r.value, {}] as [string, unknown] }
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

import { SaveLocalBackup, SavePartialLocalBackup, LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { setColdStorageItem, readColdStorageItem, coldStorageHeader } from 'src/ts/process/coldstorage.svelte'
import { formatColdStorageLoadError } from 'src/ts/process/coldstorageData'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'

//#region helpers

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Deterministic version-4-shaped ids; the restore only places `<uuid>.json` names. */
function uid(n: number): string {
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

/** One `[nameLength][name][dataLength][data]` chunk, matching LoadLocalBackup's reader. */
function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = encoder.encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    let offset = 0
    out.set(u32le(nameBuf.length), offset); offset += 4
    out.set(nameBuf, offset); offset += nameBuf.length
    out.set(u32le(data.length), offset); offset += 4
    out.set(data, offset)
    return out
}

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

function entryNames(): string[] {
    return writtenEntries().map((e) => e.name)
}

function entryText(name: string): string | null {
    const entry = writtenEntries().find((e) => e.name === name)
    return entry ? decoder.decode(entry.data) : null
}

function unitName(key: string): string {
    return `coldstorage_${key}.json`
}

/** Runs a save and returns what it threw, or `null` when it completed. */
async function outcomeOf(run: () => Promise<void>): Promise<unknown> {
    return run().then(() => null, (error: unknown) => error)
}

type ColdPlugin = Record<string, string>
type CharacterFixture = Database['characters'][number]

function databaseWith(fields: Record<string, unknown>): Database {
    return { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
}

function pluginMapping(db: Database): ColdPlugin {
    return (db.pluginCustomStorage as Record<string, ColdPlugin>)._coldplugin
}

function makeChat(id: string, firstMessageData: unknown) {
    return { id, message: [{ time: 1, data: firstMessageData, role: 'char' }], note: '', name: '', localLore: [] }
}

function pointerChat(id: string, key: string) {
    return makeChat(id, coldStorageHeader + key)
}

function errorTextChat(id: string, key: string) {
    return makeChat(id, formatColdStorageLoadError(key))
}

function makeLiveCharacter(chaId: string, name: string, chats: unknown[]): CharacterFixture {
    return { chaId, name, type: 'character', chatPage: 0, chats } as unknown as CharacterFixture
}

function makeStub(chaId: string, name: string, blobKey: string, coldStoragedChats: string[] = []): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        coldstorage: blobKey,
        coldStoragedChats,
        chats: [{ id: `${chaId}-stub-chat`, message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

async function putBlob(key: string, chaId: string, chats: unknown[]): Promise<void> {
    expect(await setColdStorageItem(key, {
        character: { chaId, name: 'Archived', type: 'character', chatPage: 0, chats },
    })).toBe(true)
}

async function putChatUnit(key: string, firstMessageData: unknown = 'archived'): Promise<void> {
    expect(await setColdStorageItem(key, {
        message: [{ time: 1, data: firstMessageData, role: 'user' }],
        hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
        hypaV3Data: { summaries: [] },
        scriptstate: {},
        localLore: [],
    })).toBe(true)
}

/** The incomplete-backup prompts raised so far (the partial backup's two explanatory confirms are not among them). */
function backupPrompts(): string[] {
    return alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('Cold storage data') && t.includes('Create the incomplete backup anyway?'))
}

function restorePrompts(): string[] {
    return alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('Cold storage data') && t.includes('incomplete restore'))
}

function completionReports(): string {
    return alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
}

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

/** Drives LoadLocalBackup() with `bytes` as the selected file's content, and awaits its onchange handler. */
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

/** A hand-built backup: `entries` first, then a database entry holding `db`. */
function buildBackup(entries: [string, Uint8Array][], db: Database): Uint8Array {
    const parts = entries.map(([name, data]) => buildChunk(name, data))
    parts.push(buildChunk('database.risudat', encodeRisuSaveLegacy(db, 'noCompression')))
    return concat(parts)
}

async function unitStatus(key: string): Promise<string> {
    return (await readColdStorageItem(key)).status
}

async function unitValue(key: string): Promise<unknown> {
    const result = await readColdStorageItem(key)
    return result.status === 'ok' ? result.value : `unit is ${result.status}`
}

/** Plugin values whose JSON is not a chat or character shape, plus one array. */
const PLUGIN_VALUES: [string, unknown][] = [
    ['an object', { a: 1 }],
    ['a string', 's'],
    ['the number zero', 0],
    ['null', null],
    ['an array', [1]],
]

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    opfsStore.clear()
    opfsReadLog.length = 0
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    forageSetItemMock.mockClear()
    alertConfirmMock.mockClear()
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    forageSetItemMock.mockImplementation(async () => { })
    // The assets are listed and read through the page's byte store, here over the key/value mock above.
    injectAppStore(createForageBackedStore({
        getItem: forageGetItemMock,
        setItem: forageSetItemMock,
        keys: forageKeysMock,
        removeItem: async () => { },
    }))
    getDatabaseMock.mockImplementation(() => databaseWith({}))
    vi.spyOn(console, 'log').mockImplementation(() => { })

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
    createElementSpy.mockRestore()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

describe('SaveLocalBackup carries the units a blob and its archives refer to', () => {
    test('a legacy error-text chat inside a blob writes the unit it names as coldstorage_<key>.json', async () => {
        const BLOB = uid(1)
        const X = uid(2)
        await putChatUnit(X)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', X)])
        getDatabaseMock.mockImplementation(() => databaseWith({ characters: [makeStub('c1', 'Alice', BLOB)] }))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(entryNames()).toContain(unitName(BLOB))
        expect(entryNames()).toContain(unitName(X))
        expect(backupPrompts()).toEqual([])
    })

    test('guard: an error-text key whose unit is absent is left out, the backup is written and no prompt is raised', async () => {
        const BLOB = uid(3)
        const X = uid(4)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', X)])
        getDatabaseMock.mockImplementation(() => databaseWith({ characters: [makeStub('c1', 'Alice', BLOB)] }))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(entryNames()).toContain(unitName(BLOB))
        expect(entryNames()).not.toContain(unitName(X))
        expect(entryNames()).toContain('database.risudat')
        expect(backupPrompts()).toEqual([])
    })

    test('an error-text key whose unit cannot be read is reported in the prompt, naming the character', async () => {
        const BLOB = uid(5)
        const X = uid(6)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', X)])
        opfsStore.set(opfsFilename(X), encoder.encode('bytes that are not a compressed unit'))
        expect(await unitStatus(X)).toBe('error')
        getDatabaseMock.mockImplementation(() => databaseWith({ characters: [makeStub('c1', 'Alice', BLOB)] }))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const prompts = backupPrompts()
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('Alice')
        expect(prompts[0]).not.toContain('could not be linked to a character')
    })

    test('a pointer to an absent unit inside a blob is reported in the prompt, naming the character', async () => {
        const BLOB = uid(7)
        const P = uid(8)
        await putBlob(BLOB, 'c1', [pointerChat('inner-1', P)])
        getDatabaseMock.mockImplementation(() => databaseWith({ characters: [makeStub('c1', 'Alice', BLOB)] }))

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const prompts = backupPrompts()
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('Alice')
        expect(prompts[0]).not.toContain('could not be linked to a character')
    })

    test('a live chat whose first message data is a number does not stop the backup and the pointer chat beside it is carried', async () => {
        const P = uid(9)
        await putChatUnit(P)
        const db = databaseWith({
            characters: [makeLiveCharacter('c1', 'Alice', [makeChat('numeric', 5), pointerChat('pointer', P)])],
        })
        getDatabaseMock.mockImplementation(() => db)
        expect(() => encodeRisuSaveLegacy(db, 'compression')).not.toThrow()

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(entryNames()).toContain(unitName(P))
        expect(entryNames()).toContain('database.risudat')
    })
})

describe('SavePartialLocalBackup carries the same units', () => {
    test('inner pointer units, error-text units and plugin units of every value shape are written', async () => {
        const BLOB = uid(10)
        const P = uid(11)
        const X = uid(12)
        await putChatUnit(P)
        await putChatUnit(X)
        await putBlob(BLOB, 'c1', [pointerChat('inner-1', P), errorTextChat('inner-2', X)])
        const mapping: ColdPlugin = {}
        for (const [i, [, value]] of PLUGIN_VALUES.entries()) {
            mapping[`plugin${i}`] = uid(100 + i)
            expect(await setColdStorageItem(uid(100 + i), value)).toBe(true)
        }
        getDatabaseMock.mockImplementation(() => databaseWith({
            characters: [makeStub('c1', 'Alice', BLOB)],
            pluginCustomStorage: { _coldplugin: mapping },
        }))

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        const names = entryNames()
        for (const key of [BLOB, P, X, ...Object.values(mapping)]) {
            expect(names, `unit ${key}`).toContain(unitName(key))
        }
        expect(backupPrompts()).toEqual([])
    })

    test('a plugin storage key created while the assets are copied is carried', async () => {
        const NEW = uid(13)
        const db = databaseWith({ customBackground: 'assets/bg.png', pluginCustomStorage: { _coldplugin: {} as ColdPlugin } })
        getDatabaseMock.mockImplementation(() => db)
        let created = false
        forageGetItemMock.mockImplementation(async () => {
            if (!created) {
                created = true
                // The unit is written first and the mapping second, as plugin storage does.
                await setColdStorageItem(NEW, { late: true })
                pluginMapping(db).late = NEW
            }
            return encoder.encode('bg-bytes')
        })

        expect(await outcomeOf(SavePartialLocalBackup)).toBeNull()

        expect(entryText(unitName(NEW))).toBe(JSON.stringify({ late: true }))
    })
})

describe('a plugin storage key created while the assets are copied reaches the backup', () => {
    const NEW = uid(14)

    function arrangeLateKey(unitExists: boolean): Database {
        const db = databaseWith({ pluginCustomStorage: { _coldplugin: {} as ColdPlugin } })
        getDatabaseMock.mockImplementation(() => db)
        forageKeysMock.mockImplementation(async () => ['assets/a.png', 'assets/gone.png'])
        let created = false
        forageGetItemMock.mockImplementation(async (key) => {
            if (!created) {
                created = true
                if (unitExists) {
                    // The unit is written first and the mapping second, as plugin storage does.
                    await setColdStorageItem(NEW, { a: 1 })
                }
                pluginMapping(db).late = NEW
            }
            return key === 'assets/gone.png' ? null : encoder.encode(`content-of:${key}`)
        })
        return db
    }

    test('the new unit is written beside the assets', async () => {
        arrangeLateKey(true)

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        expect(entryText(unitName(NEW))).toBe(JSON.stringify({ a: 1 }))
    })

    test('guard: the database entry is the last entry written', async () => {
        arrangeLateKey(true)

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const names = entryNames()
        expect(names[names.length - 1]).toBe('database.risudat')
    })

    test('a new unit that cannot be read is reported in the same completion message as the missing assets', async () => {
        arrangeLateKey(false)

        expect(await outcomeOf(SaveLocalBackup)).toBeNull()

        const reports = alertMdMock.mock.calls.map((c) => String(c[0]))
        const reportWithAsset = reports.filter((r) => r.includes('gone.png'))
        expect(reportWithAsset).toHaveLength(1)
        expect(reportWithAsset[0]).toContain(NEW)
        expect(alertNormalMock).not.toHaveBeenCalledWith('Success')
    })
})

describe('restoring plugin storage units of every value shape', () => {
    test.each(PLUGIN_VALUES.filter(([label]) => label !== 'an array'))('a coldstorage_<uuid>.json entry whose body is %s is stored and nothing is prompted', async (_label, value) => {
        const KEY = uid(20)
        const db = databaseWith({ pluginCustomStorage: { _coldplugin: { stored: KEY } } })

        await loadBackupBytes(buildBackup([[unitName(KEY), encoder.encode(JSON.stringify(value))]], db))

        expect(await unitValue(KEY)).toEqual(value)
        expect(restorePrompts()).toEqual([])
    })

    test('guard: a coldstorage_<uuid>.json entry whose body is an array is stored and nothing is prompted', async () => {
        const KEY = uid(21)
        const db = databaseWith({ pluginCustomStorage: { _coldplugin: { stored: KEY } } })

        await loadBackupBytes(buildBackup([[unitName(KEY), encoder.encode(JSON.stringify([1]))]], db))

        expect(await unitValue(KEY)).toEqual([1])
        expect(restorePrompts()).toEqual([])
    })

    test('a backup written from plugin storage units restores each of them', async () => {
        const mapping: ColdPlugin = {}
        for (const [i, [, value]] of PLUGIN_VALUES.entries()) {
            mapping[`plugin${i}`] = uid(30 + i)
            expect(await setColdStorageItem(uid(30 + i), value)).toBe(true)
        }
        getDatabaseMock.mockImplementation(() => databaseWith({ pluginCustomStorage: { _coldplugin: mapping } }))
        expect(await outcomeOf(SaveLocalBackup)).toBeNull()
        const backupBytes = concat(backupSink.writes)
        opfsStore.clear()
        alertConfirmMock.mockClear()

        await loadBackupBytes(backupBytes)

        for (const [i, [label, value]] of PLUGIN_VALUES.entries()) {
            expect(await unitValue(uid(30 + i)), label).toEqual(value)
        }
        expect(restorePrompts()).toEqual([])
    })

    test.each(PLUGIN_VALUES.filter(([label]) => label !== 'an array'))(
        'a plugin unit already on the device holding %s is not reported missing when the backup has no entry for it',
        async (_label, value) => {
            const KEY = uid(40)
            expect(await setColdStorageItem(KEY, value)).toBe(true)
            const db = databaseWith({ pluginCustomStorage: { _coldplugin: { stored: KEY } } })

            await loadBackupBytes(buildBackup([], db))

            expect(restorePrompts()).toEqual([])
        },
    )

    test('guard: a plugin mapping whose unit is absent on the device and in the backup is reported', async () => {
        const KEY = uid(41)
        const db = databaseWith({ pluginCustomStorage: { _coldplugin: { stored: KEY } } })

        await loadBackupBytes(buildBackup([], db))

        expect(restorePrompts()).toHaveLength(1)
    })

    test('guard: a character blob whose unit on the device is not chat or character shaped is still reported', async () => {
        const BLOB = uid(42)
        expect(await setColdStorageItem(BLOB, { a: 1 })).toBe(true)
        const db = databaseWith({ characters: [makeStub('c1', 'Alice', BLOB)] })

        await loadBackupBytes(buildBackup([], db))

        const prompts = restorePrompts()
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('Alice')
    })

    test('a character blob whose unit on the device reads as damaged is still reported as missing after the restore', async () => {
        const BLOB = uid(43)
        vi.spyOn(console, 'error').mockImplementation(() => { })
        opfsStore.set(opfsFilename(BLOB), new Uint8Array([1, 2, 3, 4]))
        const read = await readColdStorageItem(BLOB)
        expect(read).toMatchObject({ status: 'error', kind: 'damaged' })
        const db = databaseWith({ characters: [makeStub('c1', 'Alice', BLOB)] })

        await loadBackupBytes(buildBackup([], db))

        const prompts = restorePrompts()
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('Alice')
    })
})

describe('restore acceptance of entries that are not written under the backup writer\'s name', () => {
    const KEY = uid(50)
    const UNSHAPED = encoder.encode(JSON.stringify({ a: 1 }))

    test.each([
        ['a bare <uuid>.json entry', `${KEY}.json`],
        ['a coldstorage/<uuid>.json entry', `coldstorage/${KEY}.json`],
    ])('guard: %s with a body that is not chat or character shaped is skipped with a warning and written nowhere', async (_label, name) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })

        await loadBackupBytes(buildBackup([[name, UNSHAPED]], databaseWith({})))

        expect(await unitStatus(KEY)).toBe('missing')
        expect(forageSetItemMock.mock.calls.map((c) => c[0]).filter((k) => k.startsWith('assets/'))).toEqual([])
        expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain(name)
    })

    test.each([
        ['a bare <uuid>.json entry', `${KEY}.json`],
        ['a coldstorage/<uuid>.json entry', `coldstorage/${KEY}.json`],
        ['a coldstorage_<uuid>.json entry', `coldstorage_${KEY}.json`],
    ])('guard: %s with a chat shaped body is stored as a unit', async (_label, name) => {
        const shaped = { message: [{ time: 1, data: 'hello', role: 'user' }] }

        await loadBackupBytes(buildBackup([[name, encoder.encode(JSON.stringify(shaped))]], databaseWith({})))

        expect(await unitValue(KEY)).toEqual(shaped)
    })

    test('guard: a coldstorage_<uuid>.json entry that is not JSON is neither stored as a unit nor as an asset', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })

        await loadBackupBytes(buildBackup([[unitName(KEY), encoder.encode('not json {')]], databaseWith({})))

        expect(await unitStatus(KEY)).toBe('missing')
        expect(forageSetItemMock.mock.calls.map((c) => c[0]).filter((k) => k.startsWith('assets/'))).toEqual([])
    })
})

const SAVES: [string, () => Promise<void>][] = [
    ['SaveLocalBackup', SaveLocalBackup],
    ['SavePartialLocalBackup', SavePartialLocalBackup],
]

function readCount(key: string): number {
    return opfsReadLog.filter((n) => n === opfsFilename(key)).length
}

function entryCount(name: string): number {
    return entryNames().filter((n) => n === name).length
}

describe.each(SAVES)('%s with a character whose name is not a string', (_save, save) => {
    const NON_STRING_NAMES: [string, unknown][] = [
        ['a number', 5],
        ['an object', { a: 1 }],
    ]

    function namedLive(name: unknown, chats: unknown[]): CharacterFixture {
        return { ...makeLiveCharacter('c1', 'unused', chats), name } as unknown as CharacterFixture
    }

    test.each(NON_STRING_NAMES)('guard: completes and carries the unit its pointer chat names when the name is %s', async (_label, name) => {
        const P = uid(200)
        await putChatUnit(P)
        getDatabaseMock.mockImplementation(() => databaseWith({ characters: [namedLive(name, [pointerChat('chat-1', P)])] }))

        expect(await outcomeOf(save)).toBeNull()

        expect(entryNames()).toContain(unitName(P))
        expect(entryNames()).toContain('database.risudat')
        expect(backupPrompts()).toEqual([])
    })

    test.each(NON_STRING_NAMES)('shows the incomplete-backup prompt and completes when the name is %s and its unit is absent', async (_label, name) => {
        const P = uid(201)
        getDatabaseMock.mockImplementation(() => databaseWith({ characters: [namedLive(name, [pointerChat('chat-1', P)])] }))

        expect(await outcomeOf(save)).toBeNull()

        expect(backupPrompts()).toHaveLength(1)
        expect(entryNames()).toContain('database.risudat')
    })
})

describe.each(SAVES)('%s reports an error-text key whose unit is not chat or character shaped', (_save, save) => {
    test('the prompt names the character and the unit is not written', async () => {
        const BLOB = uid(210)
        const X = uid(211)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', X)])
        expect(await setColdStorageItem(X, { a: 1 })).toBe(true)
        getDatabaseMock.mockImplementation(() => databaseWith({ characters: [makeStub('c1', 'Alice', BLOB)] }))

        expect(await outcomeOf(save)).toBeNull()

        const prompts = backupPrompts()
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('Alice')
        expect(entryNames()).not.toContain(unitName(X))
    })
})

describe.each(SAVES)('%s writes each unit exactly once', (_save, save) => {
    const BLOB = uid(220)
    const P = uid(221)
    const X = uid(222)
    const PLUGIN = uid(223)
    const NEW = uid(224)

    async function seedFirstPassUnits(): Promise<ColdPlugin> {
        await putChatUnit(P)
        await putChatUnit(X)
        await putBlob(BLOB, 'c1', [pointerChat('inner-1', P), errorTextChat('inner-2', X)])
        expect(await setColdStorageItem(PLUGIN, { a: 1 })).toBe(true)
        return { first: PLUGIN }
    }

    test('a backup with nothing created during the copy writes and reads every unit once', async () => {
        const mapping = await seedFirstPassUnits()
        getDatabaseMock.mockImplementation(() => databaseWith({
            characters: [makeStub('c1', 'Alice', BLOB)],
            pluginCustomStorage: { _coldplugin: mapping },
        }))

        expect(await outcomeOf(save)).toBeNull()

        for (const key of [BLOB, P, X, PLUGIN]) {
            expect(entryCount(unitName(key)), `entries for ${key}`).toBe(1)
            expect(readCount(key), `reads of ${key}`).toBe(1)
        }
    })

    test('a unit created during the copy is written once and the units of the first pass are not written or read again', async () => {
        const mapping = await seedFirstPassUnits()
        const db = databaseWith({
            characters: [makeStub('c1', 'Alice', BLOB)],
            customBackground: 'assets/bg.png',
            pluginCustomStorage: { _coldplugin: mapping },
        })
        getDatabaseMock.mockImplementation(() => db)
        forageKeysMock.mockImplementation(async () => ['assets/bg.png'])
        let created = false
        forageGetItemMock.mockImplementation(async () => {
            if (!created) {
                created = true
                await setColdStorageItem(NEW, { late: true })
                pluginMapping(db).late = NEW
            }
            return encoder.encode('bg-bytes')
        })

        expect(await outcomeOf(save)).toBeNull()

        for (const key of [BLOB, P, X, PLUGIN, NEW]) {
            expect(entryCount(unitName(key)), `entries for ${key}`).toBe(1)
            expect(readCount(key), `reads of ${key}`).toBe(1)
        }
    })

    test('guard: a key reported in the first pass is not reported again and the completion is the plain success alert', async () => {
        const ABSENT = uid(225)
        getDatabaseMock.mockImplementation(() => databaseWith({ pluginCustomStorage: { _coldplugin: { gone: ABSENT } } }))

        expect(await outcomeOf(save)).toBeNull()

        expect(backupPrompts()).toHaveLength(1)
        expect(readCount(ABSENT)).toBe(1)
        expect(alertMdMock).not.toHaveBeenCalled()
        expect(alertNormalMock).toHaveBeenCalledWith('Success')
    })
})

describe('a legacy bare-array unit reached by a pointer is searched for references', () => {
    test.each(SAVES)('%s carries the unit that the legacy error text in the array\'s first message names', async (_name, save) => {
        const LEGACY = uid(230)
        const Y = uid(231)
        await putChatUnit(Y)
        expect(await setColdStorageItem(LEGACY, [
            { time: 1, data: formatColdStorageLoadError(Y), role: 'char' },
            { time: 2, data: 'a later message', role: 'user' },
        ])).toBe(true)
        getDatabaseMock.mockImplementation(() => databaseWith({ characters: [makeLiveCharacter('c1', 'Alice', [pointerChat('chat-1', LEGACY)])] }))

        expect(await outcomeOf(save)).toBeNull()

        expect(entryNames()).toContain(unitName(LEGACY))
        expect(entryNames()).toContain(unitName(Y))
        expect(backupPrompts()).toEqual([])
    })
})

describe.each(SAVES)('%s completion message when only a unit created during the copy fails', (_save, save) => {
    const NEW = uid(240)

    test('names the unit in the completion message and does not show the plain success alert', async () => {
        const db = databaseWith({ customBackground: 'assets/bg.png', pluginCustomStorage: { _coldplugin: {} as ColdPlugin } })
        getDatabaseMock.mockImplementation(() => db)
        forageKeysMock.mockImplementation(async () => ['assets/bg.png'])
        let created = false
        forageGetItemMock.mockImplementation(async () => {
            if (!created) {
                created = true
                // The mapping names a unit that was never written.
                pluginMapping(db).late = NEW
            }
            return encoder.encode('bg-bytes')
        })

        expect(await outcomeOf(save)).toBeNull()

        const reports = alertMdMock.mock.calls.map((c) => String(c[0]))
        expect(reports).toHaveLength(1)
        expect(reports[0]).toContain(NEW)
        expect(reports[0]).not.toMatch(/were missing/)
        expect(alertNormalMock).not.toHaveBeenCalledWith('Success')
        expect(entryNames()).toContain('database.risudat')
    })
})

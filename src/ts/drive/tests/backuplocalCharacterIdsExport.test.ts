/**
 * The character list a local backup exports (`SaveLocalBackup` and
 * `SavePartialLocalBackup`, `src/ts/drive/backuplocal.ts`): a list with nothing
 * wrong is exported byte for byte; otherwise the export is made from a copy,
 * never from the page's own objects. Entries that are not characters are left
 * out, an id that cannot be saved is replaced with the lists that named it
 * following, and an archived character takes back the id its unit records or,
 * when the unit cannot name one, a new id, said in the final message. The
 * export is never refused.
 *
 * The harness is the one `backuplocalUnitClosure.test.ts` documents: the real
 * writer, collector and unit store with every dialog mocked. A passing test
 * here is not evidence about the Tauri or Node backends.
 *
 * Title labels: (R) marks a reproducer that fails against an export that
 * encodes the page's list as it is; (G) marks a guard that passes with or
 * without the repair.
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

/** The page store's units (coldstorage/<key>), kept apart from the assets, and every unit key read from it. */
const unitMem = new Map<string, Uint8Array>()
const unitReadLog: string[] = []

function isUnitKey(key: string): boolean {
    return key.startsWith('coldstorage/')
}

/** Places raw bytes as the page store's unit key. */
function putRawUnit(key: string, bytes: Uint8Array): void {
    unitMem.set('coldstorage/' + key, bytes)
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

import { SaveLocalBackup, SavePartialLocalBackup, LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { decodeRisuSave, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
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
    unitMem.clear()
    unitReadLog.length = 0
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
    // The assets are listed and read through the page's byte store, here over the key/value mock above; the units are kept apart in memory.
    injectAppStore(createForageBackedStore({
        getItem: async (key) => {
            if (isUnitKey(key)) {
                unitReadLog.push(key)
                return unitMem.get(key) ?? null
            }
            return forageGetItemMock(key)
        },
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

function exportedDatabase(): Promise<{ characters: Array<Record<string, unknown>> } & Record<string, unknown>> {
    const entry = writtenEntries().find((e) => e.name === 'database.risudat')
    if (!entry) {
        throw new Error('the export wrote no database entry')
    }
    return decodeRisuSave(entry.data) as never
}

const heldCharacter = (chaId: unknown, name: string): CharacterFixture =>
    makeLiveCharacter(chaId as string, name, [{ id: 'h1', message: [{ time: 1, data: 'hi', role: 'char', saying: chaId }, { time: 2, data: 'yo', role: 'user', saying: chaId }], note: '', name: '', localLore: [] }])

describe.each([
    ['SaveLocalBackup', SaveLocalBackup],
    ['SavePartialLocalBackup', SavePartialLocalBackup],
])('%s exports a character list a reader can load', (_name, run) => {
    test('(G) a list with nothing wrong is exported byte for byte', async () => {
        const db = databaseWith({ characters: [makeLiveCharacter('a', 'A', []), makeLiveCharacter('b', 'B', [])], characterOrder: ['a', 'b'] })
        getDatabaseMock.mockImplementation(() => db)

        expect(await outcomeOf(run)).toBeNull()

        const entry = writtenEntries().find((e) => e.name === 'database.risudat')!
        expect(Buffer.from(entry.data).equals(Buffer.from(encodeRisuSaveLegacy({ ...db, account: undefined }, 'compression')))).toBe(true)
    })

    test('(R) a character whose id cannot be saved is exported with a new id and the lists follow; the page keeps its own objects (S14)', async () => {
        const held = heldCharacter('config', 'Held')
        const db = databaseWith({
            characters: [makeLiveCharacter('a', 'A', []), held, 5],
            characterOrder: ['a', { id: 'F', name: 'F', data: ['config'] }],
            loadouts: [{ characterIds: ['config'] }],
        })
        getDatabaseMock.mockImplementation(() => db)
        const before = JSON.stringify(db)

        expect(await outcomeOf(run)).toBeNull()

        expect(JSON.stringify(db)).toBe(before)
        expect(db.characters[1]).toBe(held)
        const exported = await exportedDatabase()
        const fresh = exported.characters[1].chaId as string
        expect(exported.characters.map((c) => c.chaId)).toEqual(['a', fresh])
        expect(fresh).not.toBe('config')
        expect(exported.characterOrder).toEqual(['a', { id: 'F', name: 'F', data: [fresh] }])
        expect((exported.loadouts as Array<{ characterIds: string[] }>)[0].characterIds).toEqual([fresh])
        const messages = (exported.characters[1].chats as Array<{ message: Array<{ saying: string }> }>)[0].message
        expect(messages[0].saying).toBe(fresh)
        expect(messages[1].saying).toBe('config')
        expect(completionReports()).toContain('an id that cannot be saved and was exported with a new one')
    })

    test('(R) an archived character whose unit is bundled carries the unit\'s id (S14)', async () => {
        const BLOB = uid(11)
        await putBlob(BLOB, 'real-id', [makeChat('c', 'archived')])
        const db = databaseWith({ characters: [makeLiveCharacter('a', 'A', []), makeStub('preset', 'Stub', BLOB)], characterOrder: ['a', 'preset'] })
        getDatabaseMock.mockImplementation(() => db)

        expect(await outcomeOf(run)).toBeNull()

        const exported = await exportedDatabase()
        expect(exported.characters.map((c) => c.chaId)).toEqual(['a', 'real-id'])
        expect(exported.characterOrder).toEqual(['a', 'real-id'])
        expect(entryNames()).toContain(unitName(BLOB))
        expect(db.characters[1].chaId).toBe('preset')
        expect(completionReports()).toContain('exported with the id its archived data records')
    })

    test('(R) an archived character with a missing id takes the unit\'s id too', async () => {
        const BLOB = uid(12)
        await putBlob(BLOB, 'real-id', [makeChat('c', 'archived')])
        const missingId = makeStub('x', 'Stub', BLOB) as unknown as Record<string, unknown>
        delete missingId.chaId
        const db = databaseWith({ characters: [makeLiveCharacter('a', 'A', []), missingId] })
        getDatabaseMock.mockImplementation(() => db)

        expect(await outcomeOf(run)).toBeNull()

        expect((await exportedDatabase()).characters.map((c) => c.chaId)).toEqual(['a', 'real-id'])
    })

    test('(R) an archived character whose unit is missing is exported under a new id, said in the message, and the export succeeds (S23)', async () => {
        const db = databaseWith({ characters: [makeLiveCharacter('a', 'A', []), makeStub('preset', 'Lost Stub', uid(13))], characterOrder: ['a', 'preset'] })
        getDatabaseMock.mockImplementation(() => db)

        expect(await outcomeOf(run)).toBeNull()

        const exported = await exportedDatabase()
        const fresh = exported.characters[1].chaId as string
        expect(fresh).toMatch(/^[0-9a-f-]{36}$/)
        expect(exported.characterOrder).toEqual(['a', fresh])
        expect(completionReports()).toContain('"Lost Stub"')
        expect(completionReports()).toContain('cannot be restored from this export')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})
/**
 * A `.bin` export of a store2 page that holds characters as stubs of store2 entities (`drive/exportInline.ts`,
 * `SaveLocalBackup` and `SavePartialLocalBackup` in `backuplocal.ts`). A stub of an entity is no unit file an importer
 * places: in `inline` mode the export reads the entity and carries the whole character in the database entry; in `stub`
 * mode (the production default) it mints a unit entry for a stub, except a trashed one, one whose chats name a
 * cold-storage root, and every stub of a list that needs the id repair, which are whole in both. One that cannot be read is named in the incomplete-data
 * prompt, stays a stub in the export, and is not read again by the late collection.
 *
 * The harness is the one `backuplocalCharacterIdsExport.test.ts` documents: the real writer, collector and unit store with
 * every dialog mocked, over a residency on an in-memory store2 backend. A passing test here is not evidence about the Tauri
 * or Node backends, or about a real store2 tree's size.
 *
 * Titles starting `guard:` hold before and after the change; every other test fails without it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { gunzipSync } from 'node:zlib'
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

import { SaveLocalBackup, SavePartialLocalBackup, LoadLocalBackup, type BackupExportOptions, type ExportOutcome } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { setDatabase } from 'src/ts/storage/database.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { forageOverMap } from 'src/ts/storage/tests/appStoreMock'
import { injectRestoreStore } from './restoreSupport'
import { createMemoryBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry, type UnitSource } from 'src/ts/storage/store2/codec'
import { keyOfRef, type ShardEntry } from 'src/ts/storage/store2/format'
import { createLegacyStoreReader } from 'src/ts/storage/store2/legacy/storeReader'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
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

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
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

const entryNames = (): string[] => writtenEntries().map((entry) => entry.name)

async function exportedCharacters(): Promise<Array<Record<string, unknown>>> {
    const entry = writtenEntries().find((e) => e.name === 'database.risudat')
    if (!entry) {
        throw new Error('the export wrote no database entry')
    }
    return ((await decodeRisuSave(entry.data)) as unknown as { characters: Array<Record<string, unknown>> }).characters
}

function backupPrompts(): string[] {
    return alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('Cold storage data') && t.includes('Create the incomplete backup anyway?'))
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

/**
 * The value with every string cut to 50 characters. msgpackr 1.10.1 passes a length past the buffer's end to
 * `Buffer.prototype.utf8Write` for a string of 64 or more characters, which the Node used here rejects (the goldens
 * README records it; the browser build uses the `buffer` polyfill, which has no `utf8Write`, so production is unaffected).
 * The goldens harness clamps that length in a file outside this suite, so the fixture keeps its strings short instead.
 */
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
    /** The entries of the booted tree: the first is resident, the others are stubs. */
    entries: ShardEntry[]
    source: UnitSource
}

/** A store2 page: the first character resident, the others stubs of their entities, the residency registered. */
async function pageOf(options: { backend?: (memory: MemoryBackend) => Store2Backend, group?: boolean } = {}): Promise<Page> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(3)) as Obj), archiveCharacters: true } as unknown as Database
    if (options.group === true) {
        // A group of the first two characters. The boot policy opens a group with a usable id as a stub, like any character.
        const characters = fixture.characters as unknown as Obj[]
        characters.push({ ...JSON.parse(JSON.stringify(characters[2])) as Obj, type: 'group', chaId: 'group-one', name: 'Group One', characters: [characters[0].chaId, characters[1].chaId], characterTalks: [0.5, 0.5], characterActive: [true, true] })
        ;(fixture as unknown as Obj).characterOrder = characters.map(slot => slot.chaId)
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
    registerResidency(createResidency({ backend: options.backend?.(memory) ?? memory, context }))
    const full = await readTreeBytes(memory, seeded.manifestKey)
    if (full.status !== 'ok') {
        throw new Error('The full read failed.')
    }
    getDatabaseMock.mockImplementation(() => db)
    return { memory, db, entries, source: full.tree.source }
}

const wholeOf = (page: Page, entry: ShardEntry) => assembleCharacter(entry, page.source) as unknown as Record<string, unknown>

/** What an upstream reader needs from the file: no entity-named payload, and every stub's unit present under a unit-id name. */
async function upstreamReadable(): Promise<{ entityPayloads: string[], danglingStubs: string[] }> {
    const names = new Set(entryNames())
    const entityPayloads = [...names].filter((name) => /^coldstorage_[0-9a-v]{26}\.json$/.test(name))
    const danglingStubs = (await exportedCharacters())
        .filter((character) => typeof character.coldstorage === 'string' && !names.has(`coldstorage_${character.coldstorage}.json`))
        .map((character) => String(character.name))
    return { entityPayloads, danglingStubs }
}

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
    vi.mocked(setDatabase).mockClear()
    resetResidencyForTest()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    forageSetItemMock.mockImplementation(async () => { })
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

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>

// These pin the `inline` mode and test the bounded retry of an unreadable unit (`readRetry`); the stub form has its own
// file, and the mid-export guards that hold in both modes are in the second describe of this file.
describe.each([
    ['SaveLocalBackup', ((options) => SaveLocalBackup({ ...options, mode: 'inline' })) as Runner],
    ['SavePartialLocalBackup', ((options) => SavePartialLocalBackup({ ...options, mode: 'inline' })) as Runner],
])('%s of a store2 page that holds stubs, inline form', (_name, run) => {
    test('every character is exported whole, no entity is named as a unit, and the file imports whole into another profile', async () => {
        const page = await pageOf()

        await run()

        expect(backupPrompts()).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        const exported = await exportedCharacters()
        expect(exported.map((character) => character.chaId)).toEqual(page.entries.map((entry) => entry.chaId))
        for (const [index, entry] of page.entries.entries()) {
            const whole = wholeOf(page, entry)
            expect(exported[index].coldstorage, entry.name).toBeUndefined()
            expect(exported[index].name).toBe(whole.name)
            expect((exported[index].chats as unknown[]).length).toBe(entry.chats.length)
            expect((exported[index].chats as Obj[]).map((chat) => chat.message)).toEqual((whole.chats as Obj[]).map((chat) => chat.message))
        }
        expect(await upstreamReadable()).toEqual({ entityPayloads: [], danglingStubs: [] })

        // Another profile imports the file: the residency of the exporting page is not there.
        resetResidencyForTest()
        injectRestoreStore(createForageBackedStore(forageOverMap(new Map())))
        await loadBackupBytes(concat(backupSink.writes))
        expect(vi.mocked(setDatabase)).toHaveBeenCalledTimes(1)
        const installed = vi.mocked(setDatabase).mock.calls[0][0] as unknown as { characters: Array<Record<string, unknown>> }
        expect(installed.characters.map((character) => character.name)).toEqual(exported.map((character) => character.name))
        expect(installed.characters.every((character) => character.coldstorage === undefined)).toBe(true)
        expect((installed.characters[1].chats as Obj[]).map((chat) => chat.message)).toEqual((exported[1].chats as Obj[]).map((chat) => chat.message))
    })

    test('an entity that cannot be read is named in the prompt, stays a stub that imports as a placeholder, and the rest is whole', async () => {
        const page = await pageOf()
        const damaged = page.entries[2]
        page.memory.poke(keyOfRef(damaged.chats[0].chunks[0]), null)

        await run()

        expect(backupPrompts()).toHaveLength(1)
        expect(backupPrompts()[0]).toContain(damaged.name)
        const exported = await exportedCharacters()
        expect(exported[1].coldstorage).toBeUndefined()
        expect(exported[2].coldstorage).toBe(damaged.u)
        expect(entryNames()).not.toContain(`coldstorage_${damaged.u}.json`)
        expect((await upstreamReadable()).entityPayloads).toEqual([])
        // The key is reported once, by the prompt, and not again as a unit the backup lost while it ran.
        expect(completionReports()).not.toContain(damaged.u)

        // A store2 profile imports the file through the converter: the unit is not there, so it becomes a placeholder.
        const resolved = await resolveLegacyTree({ characters: exported } as unknown as Database, createLegacyStoreReader(async () => ({ status: 'missing' })), { newId: () => 'placeholder-chat', now: () => NOW })
        expect(resolved.incomplete).toEqual([{ kind: 'character', chaId: damaged.chaId, name: damaged.name, key: damaged.u, reason: 'missing' }])
        const characters = resolved.database.characters as unknown as Array<Record<string, unknown>>
        expect(characters[2].coldstorage).toBeUndefined()
        expect((characters[1].chats as unknown[]).length).toBe(page.entries[1].chats.length)
    })

    test('new behaviour: the pauses of one export together never pass the budget, however many characters fail', async () => {
        const page = await pageOf({
            backend: (memory) => ({
                ...memory,
                readUnits: async () => {
                    throw new TypeError('the store is down')
                },
            }),
        })
        const pauses: number[] = []

        await run({ readRetry: { pausesMs: [100, 100], budgetMs: 250, pause: async (ms) => { pauses.push(ms) } } })

        expect(pauses.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(250)
        expect(pauses.length).toBeGreaterThan(0)
        // Every stub failed; each is named in the one prompt.
        expect(backupPrompts()).toHaveLength(1)
        for (const entry of page.entries.slice(1)) {
            expect(backupPrompts()[0]).toContain(entry.name)
        }
    })

    test('new behaviour: the retry reads of one export never pass the cap, however many characters fail', async () => {
        await pageOf({
            backend: (memory) => ({
                ...memory,
                readUnits: async () => {
                    throw new TypeError('the store is down')
                },
            }),
        })
        const pauses: number[] = []

        await run({ readRetry: { pausesMs: [10, 10], budgetMs: 100000, maxRetries: 3, pause: async (ms) => { pauses.push(ms) } } })

        // Two failing stubs would retry twice each; the cap leaves three retries.
        expect(pauses).toHaveLength(3)
    })

    test('new behaviour: a damaged unit is read once and never retried', async () => {
        const page = await pageOf()
        page.memory.poke(keyOfRef(page.entries[2].chats[0].chunks[0]), null)
        const pauses: number[] = []

        await run({ readRetry: { pause: async (ms) => { pauses.push(ms) } } })

        expect(pauses).toEqual([])
        expect(backupPrompts()).toHaveLength(1)
        expect(backupPrompts()[0]).toContain(page.entries[2].name)
    })

    test('a group that is a stub is exported whole, with its members, chats and talk lists, and imports whole into another profile', async () => {
        const page = await pageOf({ group: true })
        const groupIndex = page.entries.length - 1
        expect(page.entries[groupIndex].chaId).toBe('group-one')
        expect((page.db.characters[groupIndex] as unknown as Obj).coldstorage).toBe(page.entries[groupIndex].u)

        await run()

        expect(backupPrompts()).toEqual([])
        const exported = await exportedCharacters()
        expect(exported.map((character) => character.chaId)).toEqual(page.entries.map((entry) => entry.chaId))
        const group = exported[groupIndex]
        const whole = wholeOf(page, page.entries[groupIndex])
        expect(group.coldstorage).toBeUndefined()
        expect(group.type).toBe('group')
        expect(group.characters).toEqual(whole.characters)
        expect(group.characterTalks).toEqual(whole.characterTalks)
        expect((group.chats as Obj[]).map((chat) => chat.message)).toEqual((whole.chats as Obj[]).map((chat) => chat.message))
        expect(await upstreamReadable()).toEqual({ entityPayloads: [], danglingStubs: [] })

        resetResidencyForTest()
        injectRestoreStore(createForageBackedStore(forageOverMap(new Map())))
        await loadBackupBytes(concat(backupSink.writes))
        const installed = vi.mocked(setDatabase).mock.calls[0][0] as unknown as { characters: Array<Record<string, unknown>> }
        expect(installed.characters[groupIndex]).toMatchObject({ type: 'group', chaId: 'group-one', name: 'Group One', characters: whole.characters })
        expect(installed.characters.every((character) => character.coldstorage === undefined)).toBe(true)
    })

    test('guard: a page with no stub exports every character as it is, with no entity payload', async () => {
        const page = await pageOf()
        page.db.characters = page.db.characters.map((slot, index) => (index === 0 ? slot : wholeOf(page, page.entries[index]) as never))

        await run()

        expect(await upstreamReadable()).toEqual({ entityPayloads: [], danglingStubs: [] })
        expect((await exportedCharacters()).map((character) => character.name)).toEqual(page.entries.map((entry) => entry.name))
    })
})

const DASHED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const unitEntryNames = (): string[] => entryNames().filter((name) => name.startsWith('coldstorage_'))

/** The minted uuid each exported character names as a stub, in order; `null` for a character that is not such a stub. */
async function mintedUuids(): Promise<Array<string | null>> {
    return (await exportedCharacters()).map((character) => typeof character.coldstorage === 'string' && DASHED_UUID.test(character.coldstorage) ? character.coldstorage : null)
}

// What happens to a stub while the export runs, and what a failing read leaves: each holds in both modes, with the
// mode-specific assertions spelled out.
describe.each([
    ['inline', 'SaveLocalBackup', SaveLocalBackup as Runner],
    ['inline', 'SavePartialLocalBackup', SavePartialLocalBackup as Runner],
    ['stub', 'SaveLocalBackup', SaveLocalBackup as Runner],
    ['stub', 'SavePartialLocalBackup', SavePartialLocalBackup as Runner],
] as const)('%s form, %s of a store2 page: mid-export changes and failing reads', (mode, _name, runWith) => {
    const run = (options: BackupExportOptions = {}) => runWith({ ...options, mode })

    test('a stub trashed while the export copies assets is exported whole and trashed, with no unit entry of its own', async () => {
        const page = await pageOf()
        const stub = page.db.characters[1] as unknown as Obj
        expect(stub.coldstorage).toBeDefined()
        // The full export lists the assets and the partial one reads the profile images: either is time the page may use to trash the stub.
        page.db.userIcon = 'assets/icon'
        const trash = () => { stub.trashTime = 1_700_000_123_456 }
        forageKeysMock.mockImplementation(async () => {
            trash()
            return []
        })
        forageGetItemMock.mockImplementation(async () => {
            trash()
            return null
        })

        await run()

        const exported = await exportedCharacters()
        expect(exported[1].trashTime).toBe(1_700_000_123_456)
        expect(exported[1].coldstorage).toBeUndefined()
        expect((exported[1].chats as unknown[]).length).toBe(page.entries[1].chats.length)
        if (mode === 'stub') {
            // No orphan: the entry minted for the character before it was trashed is not written; the other stub keeps its own.
            const uuids = await mintedUuids()
            expect(uuids[1]).toBeNull()
            expect(uuids[2]).not.toBeNull()
            expect(unitEntryNames()).toEqual([`coldstorage_${uuids[2]}.json`])
        } else {
            expect(unitEntryNames()).toEqual([])
        }
    })

    test('a stub trashed at collection and restored while the export copies assets is exported whole and not trashed', async () => {
        const page = await pageOf()
        const stub = page.db.characters[1] as unknown as Obj
        stub.trashTime = 1_700_000_123_456
        page.db.userIcon = 'assets/icon'
        const restore = () => { delete stub.trashTime }
        forageKeysMock.mockImplementation(async () => { restore(); return [] })
        forageGetItemMock.mockImplementation(async () => { restore(); return null })

        await run()

        const exported = await exportedCharacters()
        expect(exported[1].trashTime).toBeUndefined()
        expect(exported[1].coldstorage).toBeUndefined()
        expect((exported[1].chats as unknown[]).length).toBe(page.entries[1].chats.length)
        const uuids = await mintedUuids()
        expect(unitEntryNames()).toEqual(mode === 'stub' ? [`coldstorage_${uuids[2]}.json`] : [])
    })

    // F4: a stub is identified by its entity and its `chaId`, not by the object, which the page may replace while the export runs.
    test('a stub replaced by an equal copy while the export copies assets is exported as the mode says: whole, or a stub with its entry once', async () => {
        const page = await pageOf()
        const index = 1
        const replace = () => { page.db.characters[index] = { ...(page.db.characters[index] as unknown as Obj) } as never }
        forageKeysMock.mockImplementation(async () => { replace(); return [] })
        forageGetItemMock.mockImplementation(async () => { replace(); return null })
        page.db.userIcon = 'assets/icon'

        await run()

        const exported = await exportedCharacters()
        const uuids = await mintedUuids()
        if (mode === 'stub') {
            expect(uuids[index]).not.toBeNull()
            expect(unitEntryNames().filter((name) => name === `coldstorage_${uuids[index]}.json`)).toHaveLength(1)
        } else {
            expect(exported[index].coldstorage).toBeUndefined()
            expect(exported[index].name).toBe(page.entries[index].name)
            expect((exported[index].chats as unknown[]).length).toBe(page.entries[index].chats.length)
            expect(unitEntryNames()).toEqual([])
        }
    })

    test('a slot that now holds another character under the same entity is not given the first stub\'s character', async () => {
        const page = await pageOf()
        const stub = page.db.characters[1] as unknown as Obj
        const u = stub.coldstorage as string
        const swap = () => { page.db.characters[1] = { ...stub, chaId: 'someone-else' } as never }
        forageKeysMock.mockImplementation(async () => { swap(); return [] })
        forageGetItemMock.mockImplementation(async () => { swap(); return null })
        page.db.userIcon = 'assets/icon'

        await run()

        const exported = await exportedCharacters()
        expect(exported[1].chaId).toBe('someone-else')
        expect(exported[1].coldstorage).toBe(u)
        expect((await upstreamReadable()).entityPayloads).toEqual([])
        if (mode === 'stub') {
            // The entry minted for the first character is not in the tree, so it is not written.
            const uuids = await mintedUuids()
            expect(uuids[1]).toBeNull()
            expect(unitEntryNames()).toEqual([`coldstorage_${uuids[2]}.json`])
        }
    })

    test('new behaviour: a read that fails once without a kind is retried, and the character is carried without a prompt', async () => {
        let remainingFailures = 0
        const page = await pageOf({
            backend: (memory) => ({
                ...memory,
                readUnits: async (keys) => {
                    if (remainingFailures > 0) {
                        remainingFailures--
                        throw new TypeError('one failed read')
                    }
                    return memory.readUnits(keys)
                },
            }),
        })
        remainingFailures = 1
        const pauses: number[] = []

        // This fake counts failures by call index, and a read made ahead that fails is read again at its own turn without
        // a pause, so the retry counted here is that of the serial read.
        await run({ readAhead: 0, readRetry: { pause: async (ms) => { pauses.push(ms) } } })

        expect(pauses).toHaveLength(1)
        expect(backupPrompts()).toEqual([])
        const exported = await exportedCharacters()
        expect(exported[1].name).toBe(page.entries[1].name)
        if (mode === 'stub') {
            const uuids = await mintedUuids()
            expect(uuids[1]).not.toBeNull()
            expect(uuids[2]).not.toBeNull()
            expect(unitEntryNames()).toEqual([`coldstorage_${uuids[1]}.json`, `coldstorage_${uuids[2]}.json`])
        } else {
            expect(exported[1].coldstorage).toBeUndefined()
            expect(exported[2].coldstorage).toBeUndefined()
        }
        expect((await upstreamReadable()).entityPayloads).toEqual([])
    })

    test('new behaviour: a read that keeps failing is retried within its bound, then the character stays the page\'s stub, is named, and is not carried by the late collection', async () => {
        let remainingFailures = 0
        const page = await pageOf({
            backend: (memory) => ({
                ...memory,
                readUnits: async (keys) => {
                    if (remainingFailures > 0) {
                        remainingFailures--
                        throw new TypeError('a failed read')
                    }
                    return memory.readUnits(keys)
                },
            }),
        })
        // The first read of the first stub and every retry of it fail; the second stub reads at once.
        remainingFailures = 3
        const pauses: number[] = []

        // This fake counts failures by call index, and a read made ahead that fails is read again at its own turn without
        // a pause, so the retries counted here are those of the serial read.
        await run({ readAhead: 0, readRetry: { pausesMs: [10, 20], budgetMs: 1000, pause: async (ms) => { pauses.push(ms) } } })

        const failedKey = page.entries[1].u
        expect(pauses).toEqual([10, 20])
        expect(backupPrompts()).toHaveLength(1)
        expect(backupPrompts()[0]).toContain(page.entries[1].name)
        expect((await exportedCharacters())[1].coldstorage).toBe(failedKey)
        expect(entryNames()).not.toContain(`coldstorage_${failedKey}.json`)
        expect((await upstreamReadable()).entityPayloads).toEqual([])
        expect(completionReports()).not.toContain(failedKey)
        if (mode === 'stub') {
            const uuids = await mintedUuids()
            expect(uuids[1]).toBeNull()
            expect(uuids[2]).not.toBeNull()
            expect(unitEntryNames()).toEqual([`coldstorage_${uuids[2]}.json`])
        } else {
            expect((await exportedCharacters())[2].coldstorage).toBeUndefined()
        }
    })
})

// The legacy/block-page branch of `LoadLocalBackup` (the page is not a store2 page) installs a default export's stubs
// as they are and stores each unit entry under its own uuid.
describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s default (stub-form) export imported by a legacy page', (_name, run) => {
    test('guard: the stubs keep their minted uuids, each stored unit holds the whole character with all its chats, and no alert appears', async () => {
        const page = await pageOf()
        await run()
        const uuids = await mintedUuids()
        expect(uuids[1]).not.toBeNull()
        expect(uuids[2]).not.toBeNull()

        resetResidencyForTest()
        const stored = new Map<string, Uint8Array>()
        injectRestoreStore(createForageBackedStore(forageOverMap(stored)))
        await loadBackupBytes(concat(backupSink.writes))

        expect(alertErrorMock).not.toHaveBeenCalled()
        const installed = vi.mocked(setDatabase).mock.calls.at(-1)?.[0] as unknown as { characters: Array<Record<string, unknown>> }
        expect(installed.characters.map((character) => character.coldstorage ?? null)).toEqual(uuids)
        for (const index of [1, 2]) {
            const unit = stored.get(`coldstorage/${uuids[index]}`)
            expect(unit, page.entries[index].name).toBeInstanceOf(Uint8Array)
            const payload = JSON.parse(decoder.decode(gunzipSync(unit!))) as { character: { name: string, chats: Array<{ message: unknown }> } }
            const whole = wholeOf(page, page.entries[index])
            expect(payload.character.name).toBe(whole.name)
            expect(payload.character.chats).toHaveLength(page.entries[index].chats.length)
            expect(payload.character.chats.map((chat) => chat.message)).toEqual((whole.chats as Obj[]).map((chat) => chat.message))
        }
    })
})

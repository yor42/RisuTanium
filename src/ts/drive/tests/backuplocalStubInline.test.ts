/**
 * A `.bin` export of a store2 page that holds characters as stubs of store2 entities (`drive/exportInline.ts`,
 * `SaveLocalBackup` and `SavePartialLocalBackup` in `backuplocal.ts`). A stub of an entity is no unit file an importer
 * places: the export reads the entity and carries the whole character in the database entry. One that cannot be read is
 * named in the incomplete-data prompt, stays a stub in the export, and is not read again by the late collection.
 *
 * The harness is the one `backuplocalCharacterIdsExport.test.ts` documents: the real writer, collector and unit store with
 * every dialog mocked, over a residency on an in-memory store2 backend. A passing test here is not evidence about the Tauri
 * or Node backends, or about a real store2 tree's size.
 *
 * Titles starting `guard:` hold before and after the change; every other test fails without it.
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

describe.each([
    ['SaveLocalBackup', SaveLocalBackup],
    ['SavePartialLocalBackup', SavePartialLocalBackup],
])('%s of a store2 page that holds stubs', (_name, run) => {
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

    test('a read that fails once and would succeed later is neither inlined nor carried by the late collection', async () => {
        let armed = false
        const page = await pageOf({
            backend: (memory) => ({
                ...memory,
                readUnits: async (keys) => {
                    if (armed) {
                        armed = false
                        throw new TypeError('one failed read')
                    }
                    return memory.readUnits(keys)
                },
            }),
        })
        armed = true

        await run()

        // The first stub read is the first character's: it fails once, later reads would succeed.
        const failedKey = page.entries[1].u
        expect(backupPrompts()).toHaveLength(1)
        expect(backupPrompts()[0]).toContain(page.entries[1].name)
        expect((await exportedCharacters())[1].coldstorage).toBe(failedKey)
        expect(entryNames()).not.toContain(`coldstorage_${failedKey}.json`)
        expect((await upstreamReadable()).entityPayloads).toEqual([])
        expect(completionReports()).not.toContain(failedKey)
        expect((await exportedCharacters())[2].coldstorage).toBeUndefined()
    })

    test('a stub trashed while the export copies assets is exported trashed', async () => {
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

        expect((await exportedCharacters())[1].trashTime).toBe(1_700_000_123_456)
        expect((await exportedCharacters())[1].coldstorage).toBeUndefined()
    })

    // F4: a stub is identified by its entity and its `chaId`, not by the object, which the page may replace while the export runs.
    test('a stub replaced by an equal copy while the export copies assets is still exported whole', async () => {
        const page = await pageOf()
        const index = 1
        const replace = () => { page.db.characters[index] = { ...(page.db.characters[index] as unknown as Obj) } as never }
        forageKeysMock.mockImplementation(async () => { replace(); return [] })
        forageGetItemMock.mockImplementation(async () => { replace(); return null })
        page.db.userIcon = 'assets/icon'

        await run()

        const exported = await exportedCharacters()
        expect(exported[index].coldstorage).toBeUndefined()
        expect(exported[index].name).toBe(page.entries[index].name)
        expect((exported[index].chats as unknown[]).length).toBe(page.entries[index].chats.length)
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

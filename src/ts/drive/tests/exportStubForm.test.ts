/**
 * The stub form of a `.bin` export of a store2 page (`drive/exportInline.ts`, `SaveLocalBackup` and
 * `SavePartialLocalBackup` in `backuplocal.ts`), and the typed outcome both writers return.
 *
 * In `stub` mode a character the page holds as a stub of a store2 entity stays a stub in the file: its `coldstorage` is
 * a uuid minted for this export and the character is the unit entry `coldstorage_<uuid>.json`, as an upstream build
 * writes an archived character. The page's own stub is never changed. The production default is `inline`
 * (`EXPORT_UNLOADED_CHARACTERS`), which these tests do not change: they pass the mode as an option.
 *
 * Labels in the titles, by purpose:
 * - `new behaviour`: exercises code that exists only behind the new `stub` mode or the retry; its failure modes are shown
 *   by mutating the implementation, not by being red on an earlier base (the option does not exist there).
 * - `reproducer`: asserts an outcome or id invariant that fails when the implementation lacks it (writers returning
 *   nothing; a stub unit body whose ids the export tree no longer has).
 * - `guard`: holds with and without the stub form.
 *
 * The harness is the one `backuplocalStubInline.test.ts` documents: the real writer, collector and unit store with every
 * dialog mocked, over a residency on an in-memory store2 backend. A passing test is no evidence about the Tauri or Node
 * backends, a real browser download, or whether an upstream build opens these stubs (the A4 hand check settles that).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[], failWrites: false }))
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
                        if (backupSink.failWrites) {
                            throw new Error('the output stream is down')
                        }
                        backupSink.writes.push(chunk.slice())
                    },
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
import { getColdStorageBackupKey, isAcceptedColdStorageBackupEntry, isColdStorageBackupData } from 'src/ts/process/coldstorageData'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
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
const DASHED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

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
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

/** The entries the real `LocalWriter` emitted into the sink, in write order. */
const writtenEntries = (): WrittenEntry[] => entriesOf(concat(backupSink.writes))
const entryNames = (): string[] => writtenEntries().map((entry) => entry.name)
const unitEntryNames = (): string[] => entryNames().filter((name) => name.startsWith('coldstorage_'))

async function decodedDatabase(entries: WrittenEntry[] = writtenEntries()): Promise<{ characters: Array<Record<string, unknown>> }> {
    const entry = entries.find((e) => e.name === 'database.risudat')
    if (!entry) {
        throw new Error('the export wrote no database entry')
    }
    return (await decodeRisuSave(entry.data)) as unknown as { characters: Array<Record<string, unknown>> }
}

const exportedCharacters = async (): Promise<Array<Record<string, unknown>>> => (await decodedDatabase()).characters

function unitBody(uuid: string): { character: Record<string, unknown> } {
    const entry = writtenEntries().find((e) => e.name === `coldstorage_${uuid}.json`)
    if (!entry) {
        throw new Error(`the export wrote no unit entry for ${uuid}`)
    }
    return JSON.parse(decoder.decode(entry.data)) as { character: Record<string, unknown> }
}

function backupPrompts(): string[] {
    return alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('Cold storage data') && t.includes('Create the incomplete backup anyway?'))
}

function completionReports(): string {
    return alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')
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
    /** The entries of the booted tree: the first is resident, the others are stubs. */
    entries: ShardEntry[]
    source: UnitSource
}

/** A store2 page: the first character resident, the others stubs of their entities, the residency registered. */
async function pageOf(options: { backend?: (memory: MemoryBackend) => Store2Backend, group?: boolean, chaIds?: Record<number, string>, speaker?: boolean } = {}): Promise<Page> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(3)) as Obj), archiveCharacters: true } as unknown as Database
    for (const [index, chaId] of Object.entries(options.chaIds ?? {})) {
        ;(fixture.characters[Number(index)] as unknown as Obj).chaId = chaId
    }
    if (options.group === true) {
        const characters = fixture.characters as unknown as Obj[]
        const group: Obj = { ...JSON.parse(JSON.stringify(characters[2])) as Obj, type: 'group', chaId: 'group-one', name: 'Group One', characters: [characters[0].chaId, characters[1].chaId], characterTalks: [0.5, 0.5], characterActive: [true, true] }
        if (options.speaker === true) {
            // A group chat message names the member who spoke it.
            const firstChat = (group.chats as Obj[])[0]
            const message = (firstChat.message as Obj[])[0]
            message.role = 'char'
            message.saying = characters[1].chaId
        }
        characters.push(group)
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
const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** The stub slot `index` of the page, as the page holds it. */
const pageStub = (page: Page, index: number): Obj => page.db.characters[index] as unknown as Obj

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>
const STUB: BackupExportOptions = { mode: 'stub' }

/** The unit entry name each exported stub names, in character order; `null` for a character that is not a stub with an entry. */
async function mintedUuids(): Promise<Array<string | null>> {
    return (await exportedCharacters()).map((character) => typeof character.coldstorage === 'string' && DASHED_UUID.test(character.coldstorage) ? character.coldstorage : null)
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    backupSink.failWrites = false
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

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a store2 page, stub form', (_name, run) => {
    test('new behaviour: every stub stays a stub with its own minted uuid and has exactly one unit entry; the page keeps its own entity ids', async () => {
        const page = await pageOf()

        const outcome = await run(STUB)

        expect(outcome).toEqual({ status: 'saved', notices: [] })
        expect(backupPrompts()).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        const exported = await exportedCharacters()
        expect(exported.map((character) => character.chaId)).toEqual(page.entries.map((entry) => entry.chaId))
        // The resident character is written as it is; each stub names a uuid, never its entity id.
        expect(exported[0].coldstorage).toBeUndefined()
        const uuids = await mintedUuids()
        expect(uuids[0]).toBeNull()
        expect(uuids[1]).not.toBeNull()
        expect(uuids[2]).not.toBeNull()
        expect(uuids[1]).not.toBe(uuids[2])
        expect(unitEntryNames()).toEqual([`coldstorage_${uuids[1]}.json`, `coldstorage_${uuids[2]}.json`])
        for (const index of [1, 2]) {
            expect(getColdStorageBackupKey(`coldstorage_${uuids[index]}.json`)).toBe(uuids[index])
            expect(exported[index].coldStoragedChats).toEqual([])
            expect(unitBody(uuids[index] as string)).toEqual(asJson({ character: coldUnitCharacter(wholeOf(page, page.entries[index]) as unknown as Parameters<typeof coldUnitCharacter>[0]) }))
            // The page's stub is the page's own: the exported copy is a different object with a different key.
            expect(pageStub(page, index).coldstorage).toBe(page.entries[index].u)
        }
        // The entity id never reaches the file: not in an entry name, a unit body or the database entry.
        for (const index of [1, 2]) {
            const entity = page.entries[index].u
            expect(entryNames().some((name) => name.includes(entity))).toBe(false)
            expect(writtenEntries().some((entry) => entry.name !== 'database.risudat' && decoder.decode(entry.data).includes(entity))).toBe(false)
            expect(JSON.stringify(exported)).not.toContain(entity)
        }
    })

    test('new behaviour: the file is readable by the upstream rule: every unit entry is stored and opens its stub (same chaId)', async () => {
        const page = await pageOf()

        await run(STUB)

        const exported = await exportedCharacters()
        const entries = writtenEntries()
        const stubs = exported.filter((character) => typeof character.coldstorage === 'string')
        expect(stubs).toHaveLength(2)
        for (const stub of stubs) {
            const entry = entries.find((e) => e.name === `coldstorage_${stub.coldstorage}.json`)
            expect(entry, String(stub.name)).toBeDefined()
            const body = JSON.parse(decoder.decode((entry as WrittenEntry).data)) as { character: Record<string, unknown> }
            expect(isAcceptedColdStorageBackupEntry((entry as WrittenEntry).name, body)).toBe(true)
            expect(isColdStorageBackupData(body)).toBe(true)
            expect(body.character.chaId).toBe(stub.chaId)
        }
        // The stub carries the placeholder shape an archived character has: one empty chat, no chat units.
        for (const index of [1, 2]) {
            expect((exported[index].chats as unknown[]).length).toBe(1)
            expect(exported[index].name).toBe(page.entries[index].name)
        }
    })

    test('new behaviour: the legacy decoder and the converter give back the characters the page held, chats included', async () => {
        const page = await pageOf()

        await run(STUB)

        const entries = writtenEntries()
        const database = await decodedDatabase(entries)
        const reader = createLegacyStoreReader(async (key) => {
            const entry = entries.find((e) => e.name === `coldstorage_${key}.json`)
            return entry === undefined ? { status: 'missing' } : { status: 'ok', value: JSON.parse(decoder.decode(entry.data)) as unknown }
        })
        const resolved = await resolveLegacyTree(database as unknown as Database, reader, { newId: () => 'placeholder-chat', now: () => NOW })
        expect(resolved.incomplete).toEqual([])
        const characters = resolved.database.characters as unknown as Array<Record<string, unknown>>
        expect(characters.map((character) => character.name)).toEqual(page.entries.map((entry) => entry.name))
        for (const index of [1, 2]) {
            const whole = wholeOf(page, page.entries[index])
            expect((characters[index].chats as Obj[]).map((chat) => chat.message)).toEqual((whole.chats as Obj[]).map((chat) => chat.message))
            expect(characters[index].coldstorage).toBeUndefined()
        }
    })

    test('new behaviour: a group stub keeps its members and talk lists in its unit, and the converter gives the group back', async () => {
        const page = await pageOf({ group: true })
        const groupIndex = page.entries.length - 1

        await run(STUB)

        const uuids = await mintedUuids()
        expect(uuids.slice(1)).toSatisfy((list: Array<string | null>) => list.every((uuid) => uuid !== null))
        const body = unitBody(uuids[groupIndex] as string)
        const whole = wholeOf(page, page.entries[groupIndex])
        expect(body.character.type).toBe('group')
        expect(body.character.characters).toEqual(whole.characters)
        expect(body.character.characterTalks).toEqual(whole.characterTalks)
        const entries = writtenEntries()
        const reader = createLegacyStoreReader(async (key) => {
            const entry = entries.find((e) => e.name === `coldstorage_${key}.json`)
            return entry === undefined ? { status: 'missing' } : { status: 'ok', value: JSON.parse(decoder.decode(entry.data)) as unknown }
        })
        const resolved = await resolveLegacyTree(await decodedDatabase(entries) as unknown as Database, reader, { newId: () => 'placeholder-chat', now: () => NOW })
        expect(resolved.incomplete).toEqual([])
        expect(resolved.database.characters[groupIndex]).toMatchObject({ type: 'group', chaId: 'group-one', characters: whole.characters })
    })

    test('new behaviour: a trashed stub keeps its trash time on the stub, and its unit has none', async () => {
        const page = await pageOf()
        pageStub(page, 1).trashTime = 1_700_000_123_456

        await run(STUB)

        const exported = await exportedCharacters()
        expect(exported[1].trashTime).toBe(1_700_000_123_456)
        const uuid = (await mintedUuids())[1] as string
        expect(Object.keys(unitBody(uuid).character)).not.toContain('trashTime')
        expect(exported[2].trashTime).toBeUndefined()
    })

    test('new behaviour: a stub loaded while the export copies assets is written whole, has no unit entry, and the others keep theirs', async () => {
        const page = await pageOf()
        page.db.userIcon = 'assets/icon'
        const load = () => { page.db.characters[1] = wholeOf(page, page.entries[1]) as never }
        forageKeysMock.mockImplementation(async () => { load(); return [] })
        forageGetItemMock.mockImplementation(async () => { load(); return null })

        await run(STUB)

        const exported = await exportedCharacters()
        expect(exported[1].coldstorage).toBeUndefined()
        expect(exported[1].name).toBe(page.entries[1].name)
        const uuids = await mintedUuids()
        expect(uuids[2]).not.toBeNull()
        expect(unitEntryNames()).toEqual([`coldstorage_${uuids[2]}.json`])
    })

    test('new behaviour: an entity that cannot be read gets no unit entry, stays as it is, and is named once', async () => {
        const page = await pageOf()
        const damaged = page.entries[2]
        page.memory.poke(keyOfRef(damaged.chats[0].chunks[0]), null)

        const outcome = await run(STUB)

        expect(outcome.status).toBe('saved')
        expect(backupPrompts()).toHaveLength(1)
        expect(backupPrompts()[0]).toContain(damaged.name)
        const exported = await exportedCharacters()
        const uuids = await mintedUuids()
        expect(uuids[1]).not.toBeNull()
        expect(exported[2].coldstorage).toBe(damaged.u)
        expect(unitEntryNames()).toEqual([`coldstorage_${uuids[1]}.json`])
    })

    test('new behaviour: the minted uuids are settled, so the late collection reports no missing unit and asks nothing after the writes', async () => {
        await pageOf()

        const outcome = await run(STUB)

        expect(outcome).toEqual({ status: 'saved', notices: [] })
        expect(backupPrompts()).toEqual([])
        for (const uuid of await mintedUuids()) {
            if (uuid !== null) {
                expect(completionReports()).not.toContain(uuid)
            }
        }
        expect(alertMdMock).not.toHaveBeenCalled()
    })

    test('new behaviour: the uuid is minted for each export and is not derived from the entity id', async () => {
        const page = await pageOf()

        await run(STUB)
        const first = await mintedUuids()
        backupSink.writes.length = 0
        await run(STUB)
        const second = await mintedUuids()

        expect(first[1]).not.toBe(second[1])
        expect(first[2]).not.toBe(second[2])
        for (const index of [1, 2]) {
            expect(first[index]).not.toBe(page.entries[index].u)
            expect(String(first[index])).not.toContain(page.entries[index].u)
        }
    })

    test('new behaviour: a list that needs the id repair is exported with every stub whole, and no unit entry is minted', async () => {
        const page = await pageOf({ chaIds: { 1: 'root' } })
        expect(page.entries[1].chaId).toBe('root')

        await run(STUB)

        const exported = await exportedCharacters()
        expect(exported[1].coldstorage).toBeUndefined()
        expect(exported[1].name).toBe(page.entries[1].name)
        expect((exported[1].chats as unknown[]).length).toBe(page.entries[1].chats.length)
        expect(exported[2].coldstorage).toBeUndefined()
        expect((exported[2].chats as unknown[]).length).toBe(page.entries[2].chats.length)
        expect(unitEntryNames()).toEqual([])
    })

    test('reproducer: a group stub next to a character whose id the repair replaces names the replaced id, in its members and in a chat speaker', async () => {
        const page = await pageOf({ group: true, chaIds: { 1: 'root' }, speaker: true })
        const groupIndex = page.entries.length - 1

        await run(STUB)

        const entries = writtenEntries()
        const reader = createLegacyStoreReader(async (key) => {
            const entry = entries.find((e) => e.name === `coldstorage_${key}.json`)
            return entry === undefined ? { status: 'missing' } : { status: 'ok', value: JSON.parse(decoder.decode(entry.data)) as unknown }
        })
        const resolved = await resolveLegacyTree(await decodedDatabase(entries) as unknown as Database, reader, { newId: () => 'placeholder-chat', now: () => NOW })
        const characters = resolved.database.characters as unknown as Array<Record<string, unknown>>
        const repairedId = characters[1].chaId
        expect(repairedId).not.toBe('root')
        const group = characters[groupIndex]
        expect(group.characters).toContain(repairedId)
        expect(group.characters).not.toContain('root')
        const firstMessage = ((group.chats as Obj[])[0].message as Obj[])[0]
        expect(firstMessage.saying).toBe(repairedId)
    })

    test('new behaviour: a list that comes to need the id repair while the export runs is carried whole, with no unit entry and no stale id', async () => {
        const page = await pageOf({ group: true, speaker: true })
        const groupIndex = page.entries.length - 1
        expect(pageStub(page, groupIndex).coldstorage).toBeDefined()
        page.db.userIcon = 'assets/icon'
        let added = false
        const addUnusable = () => {
            if (!added) {
                added = true
                page.db.characters.push({ ...wholeOf(page, page.entries[0]), chaId: 'root', name: 'Added Later' } as never)
            }
        }
        forageKeysMock.mockImplementation(async () => { addUnusable(); return [] })
        forageGetItemMock.mockImplementation(async () => { addUnusable(); return null })

        await run(STUB)

        expect(added).toBe(true)
        expect(unitEntryNames()).toEqual([])
        const exported = await exportedCharacters()
        expect(exported.every((character) => character.coldstorage === undefined)).toBe(true)
        expect(exported[groupIndex].type).toBe('group')
        expect((exported[groupIndex].chats as unknown[]).length).toBe(page.entries[groupIndex].chats.length)
    })

    test('guard: the production default writes the unloaded characters whole and mints no unit entry', async () => {
        const page = await pageOf()

        const outcome = await run()

        expect(outcome.status).toBe('saved')
        expect(unitEntryNames()).toEqual([])
        const exported = await exportedCharacters()
        for (const [index, entry] of page.entries.entries()) {
            expect(exported[index].coldstorage, entry.name).toBeUndefined()
            expect((exported[index].chats as unknown[]).length).toBe(entry.chats.length)
        }
    })

    test('guard: the inline mode named as a parameter is the same as the default', async () => {
        const page = await pageOf()

        await run({ mode: 'inline' })

        expect(unitEntryNames()).toEqual([])
        expect((await exportedCharacters()).every((character) => character.coldstorage === undefined)).toBe(true)
        expect(pageStub(page, 1).coldstorage).toBe(page.entries[1].u)
    })
})

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s typed outcome', (_name, run) => {
    test('reproducer: a plain success resolves saved with no notice', async () => {
        await pageOf()

        expect(await run()).toEqual({ status: 'saved', notices: [] })
    })

    test('reproducer: the incomplete-data prompt answered Cancel resolves declined and writes nothing', async () => {
        const page = await pageOf()
        page.memory.poke(keyOfRef(page.entries[2].chats[0].chunks[0]), null)
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes('Create the incomplete backup anyway?'))

        const outcome = await run(STUB)

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(backupSink.writes).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('reproducer: a cancelled Tauri save dialog resolves declined, keeps the alert, and writes nothing', async () => {
        await pageOf()
        platformBox.isTauri = true
        saveDialogMock.mockImplementation(async () => null)

        const outcome = await run()

        expect(outcome).toEqual({ status: 'declined', cause: 'save-dialog-cancelled' })
        expect(alertErrorMock).toHaveBeenCalledWith('Failed')
        expect(backupSink.writes).toEqual([])
    })

    test('reproducer: a write that throws resolves failed with the cause, and the person is told', async () => {
        await pageOf()
        backupSink.failWrites = true

        const outcome = await run()

        expect(outcome.status).toBe('failed')
        expect(outcome.status === 'failed' ? String(outcome.cause) : '').toContain('the output stream is down')
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
    })

    test('reproducer: a report the person must read is carried as a notice', async () => {
        const page = await pageOf()
        // The partial export reads the icon; the full one reads what the store lists. Either key is listed but cannot be read.
        page.db.userIcon = 'assets/missing'
        forageKeysMock.mockImplementation(async () => ['assets/missing'])

        const outcome = await run()

        expect(outcome.status).toBe('saved')
        expect(outcome.status === 'saved' ? outcome.notices : []).toHaveLength(1)
        expect(completionReports()).toContain('assets/missing')
    })
})

describe('the partial and the full backup carry the same characters', () => {
    /** The characters of the file the sink holds, with each stub's unit entry resolved through the converter. */
    async function resolvedCharacters(): Promise<Array<Record<string, unknown>>> {
        const entries = writtenEntries()
        const reader = createLegacyStoreReader(async (key) => {
            const entry = entries.find((e) => e.name === `coldstorage_${key}.json`)
            return entry === undefined ? { status: 'missing' } : { status: 'ok', value: JSON.parse(decoder.decode(entry.data)) as unknown }
        })
        const resolved = await resolveLegacyTree(await decodedDatabase(entries) as unknown as Database, reader, { newId: () => 'placeholder-chat', now: () => NOW })
        expect(resolved.incomplete).toEqual([])
        return resolved.database.characters as unknown as Array<Record<string, unknown>>
    }

    test.each([['inline', { mode: 'inline' }], ['stub', { mode: 'stub' }]] as const)('guard (G7): in %s form, both writers give the same resolved characters, and in inline form the same database characters', async (_mode, options) => {
        await pageOf()

        await SaveLocalBackup(options)
        const fullDatabase = await exportedCharacters()
        const full = await resolvedCharacters()
        backupSink.writes.length = 0
        await SavePartialLocalBackup(options)
        const partialDatabase = await exportedCharacters()
        const partial = await resolvedCharacters()

        expect(partial).toEqual(full)
        if (options.mode === 'inline') {
            expect(partialDatabase).toEqual(fullDatabase)
        }
    })
})

describe('SavePartialLocalBackup explanations', () => {
    test('reproducer: declining either explanation resolves declined before anything is collected', async () => {
        await pageOf()
        alertConfirmMock.mockImplementation(async () => false)

        const outcome = await SavePartialLocalBackup()

        expect(outcome).toEqual({ status: 'declined', cause: 'partial-explanation-declined' })
        expect(backupSink.writes).toEqual([])
    })
})

describe('the stub form against the goldens', () => {
    const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

    async function goldenStub(file: string): Promise<Record<string, unknown>> {
        const entries = entriesOf(new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, file))))
        const stub = (await decodedDatabase(entries)).characters.find((character) => character.chaId === 'cha-stub')
        if (stub === undefined) {
            throw new Error(`${file} has no stub`)
        }
        return stub
    }

    // The goldens record what the old and the upstream writers leave behind; equality with their bytes is not claimed.
    test.each(['fork-full.bin', 'upstream-full.bin'])('guard: the stub of the stub form carries the fields of the stub in %s that an upstream reader uses', async (file) => {
        const page = await pageOf()
        const golden = await goldenStub(file)
        expect(typeof golden.coldstorage).toBe('string')

        await SaveLocalBackup(STUB)

        const stub = (await exportedCharacters())[1]
        for (const field of ['type', 'chaId', 'name', 'coldstorage', 'coldStoragedChats', 'chats'] as const) {
            expect(Object.keys(stub), `${field} of ${page.entries[1].name}`).toContain(field)
            expect(Object.keys(golden)).toContain(field)
        }
        expect(typeof stub.coldstorage).toBe(typeof golden.coldstorage)
        expect(DASHED_UUID.test(String(stub.coldstorage))).toBe(DASHED_UUID.test(String(golden.coldstorage)))
        expect(stub.coldStoragedChats).toEqual([])
        expect((stub.chats as unknown[]).length).toBe((golden.chats as unknown[]).length)
    })
})

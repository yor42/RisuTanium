/**
 * The composed round trip of a store2 page (X1): each `.bin` golden goes through the real `LoadLocalBackup` into a store2
 * page, a fresh boot over what that committed (the page reloads after an import), the real `SaveLocalBackup`, and the legacy
 * decoder (`decodeRisuSave`); the exported database must equal the original's whole resolved database (every character,
 * chat and message field with pointers and stubs resolved, all presets, modules and the top-level fields) and the
 * referenced asset must be in the file byte for byte. The recorded differences are named in `afterTrip`.
 *
 * Labels: this suite is a compatibility guard on both halves. The base reproducer of record for the import half is the
 * "regression:" test in `storeImport.svelte.test.ts`; here the import half is red only on an approximation (the store2
 * import branch of `LoadLocalBackup` never taken), not on a run of the base.
 * Harness: the save-loop world of `storeImport.svelte.test.ts` over an in-memory store2 backend and a fake Web Locks manager;
 * the legacy unit store is a double that answers `missing` except for a store2 entity key, which reads through the page's
 * residency as the real reader does, and the legacy unit collection is empty because a store2 page keeps no legacy unit.
 * A pass says nothing about the Tauri or Node backends, a real browser's download, or an upstream build opening the file.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { ALL_GOLDENS, FULL_GOLDENS } from 'src/ts/storage/tests/store2/legacyFixtures'
import { language } from 'src/lang'

vi.setConfig({ testTimeout: 60_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

// msgpackr 1.10.1 passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a string of 64 or more
// characters, which the Node running the tests rejects; the browser build has no `Buffer`, so production is unaffected.
// Clamping the length to the room left changes no byte written: it lets the real encoder run on a long placeholder text.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

afterAll(() => {
    utf8WriterProto.utf8Write = nativeUtf8Write
})

beforeEach(() => {
    vi.clearAllMocks()
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Record<string, unknown> }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(''),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        // The real reader's two branches: an entity key reads the store2 character through the residency, any other key is a legacy unit, and there are none.
        readColdStorageItem: async (key: string) => {
            const { getResidency, isEntityUnitKey } = await import('src/ts/storage/store2/residencyActive')
            const residency = getResidency()
            if (!isEntityUnitKey(key) || residency === null) {
                return { status: 'missing' }
            }
            const read = await residency.readCharacter(key)
            return read.status === 'error' ? { status: 'error', error: read.error, kind: read.kind } : { status: 'ok', value: read.value }
        },
        setColdStorageItem: vi.fn(async () => false),
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        isColdStorageBackupData: vi.fn(() => false),
        listColdDataKeys: vi.fn(async () => []),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

type Obj = Record<string, unknown>

/** What the export's `LocalWriter` put in the file, in write order. */
interface WrittenEntry {
    name: string
    data: Uint8Array
}

function parseEntries(bytes: Uint8Array): WrittenEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: WrittenEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
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

/**
 * The whole resolved database, copied so a later step cannot alias it. Nothing is dropped here: what the importer or
 * exporter mints is named in `afterTrip`, and every other field takes part in the comparison.
 */
function project(db: Obj): Obj {
    return structuredClone(db)
}

interface Trip {
    /** The original file's database with every pointer and stub resolved against the file's own units. */
    original: Obj
    /** The exported file's database, resolved the same way. */
    exported: Obj
    /** The exported file's raw database entry, as decoded. */
    exportedRaw: Obj
    exportedNames: string[]
    /** The file entries that are neither the database nor a unit: the assets, by name. */
    assets: Map<string, Uint8Array>
    errors: unknown[]
    confirms: string[]
    notices: string[]
}

/**
 * One composed round trip on a store2 page: the real `LoadLocalBackup` of `file`, a fresh boot over what it committed
 * (the page reloads after an import), the real `SaveLocalBackup`, then the legacy decoder over the file it wrote.
 */
async function roundTrip(file: string): Promise<Trip> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha'])
    const k: Store2Kit = await startStore2({ db: h.db as unknown as Database })
    const w: World = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Obj
    const bootActive = await import('src/ts/storage/store2/bootActive')
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    const alert = await import('src/ts/alert')
    vi.mocked(alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)

    const { LoadLocalBackup, SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const bytes = new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, file)))
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    LoadLocalBackup()
    const chosen = input as unknown as HTMLInputElement | null
    if (chosen === null) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
    createElementSpy.mockRestore()
    const importErrors = vi.mocked(alert.alertError).mock.calls.map((call) => call[0])

    // Imported after the world started, so the boot registers its residency in the graph `SaveLocalBackup` runs in.
    const { bootThroughDispatch } = await import('src/ts/storage/tests/store2SaveKit')
    const boot = await bootThroughDispatch(k.counted.backend)
    if (boot.result.kind !== 'store2') {
        throw new Error(`the boot after the import came to ${boot.result.kind}`)
    }
    h.db = boot.result.database as unknown as Obj
    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    const outcome = await SaveLocalBackup() as { status: string, notices?: string[] }
    const entries = parseEntries(concat(written))

    const { loadGolden, readerOver } = await import('src/ts/storage/tests/store2/legacyFixtures')
    const { resolveLegacyTree } = await import('src/ts/storage/store2/legacy/resolve')
    const { decodeRisuSave } = await import('src/ts/storage/risuSave')
    const { getColdStorageBackupKey } = await import('src/ts/process/coldstorageData')
    const options = { newId: () => 'placeholder-chat', now: () => 1 }
    const golden = await loadGolden(file)
    const original = await resolveLegacyTree(golden.tree, readerOver(golden.units), options)

    const database = entries.find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error(`the export wrote no database entry: outcome ${JSON.stringify(outcome)}, import errors ${JSON.stringify(importErrors)}, errors ${JSON.stringify(vi.mocked(alert.alertError).mock.calls.map((call) => call[0]))}, confirms ${JSON.stringify(vi.mocked(alert.alertConfirm).mock.calls.map((call) => call[0]))}`)
    }
    const exportedRaw = await decodeRisuSave(database.data) as unknown as Obj
    const exportedUnits = new Map<string, { status: 'ok', value: unknown }>()
    for (const entry of entries) {
        const key = getColdStorageBackupKey(entry.name)
        if (key !== null) {
            exportedUnits.set(key, { status: 'ok', value: JSON.parse(new TextDecoder().decode(entry.data)) })
        }
    }
    const exported = await resolveLegacyTree(exportedRaw as never, readerOver(exportedUnits), options)
    return {
        original: project(original.database as unknown as Obj),
        exported: project(exported.database as unknown as Obj),
        exportedRaw,
        exportedNames: entries.map((entry) => entry.name),
        assets: new Map(entries.filter((entry) => entry.name !== 'database.risudat' && getColdStorageBackupKey(entry.name) === null).map((entry) => [entry.name, entry.data])),
        errors: [...importErrors, ...vi.mocked(alert.alertError).mock.calls.map((call) => call[0])],
        confirms: vi.mocked(alert.alertConfirm).mock.calls.map((call) => String(call[0])),
        notices: outcome.notices ?? [],
    }
}

const ASSET_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x47, 0x4f, 0x4c, 0x44])

/** The goldens whose import asks the incomplete-restore question: a unit, a blob or a plugin unit is absent from the file. */
const INCOMPLETE = new Set<string>(ALL_GOLDENS.filter((name) => !(FULL_GOLDENS as readonly string[]).includes(name)))

/** The chat id and message time the test's `resolveLegacyTree` options give a chat or message the file left without one. */
const PLACEHOLDER_CHAT_ID = 'placeholder-chat'
const PLACEHOLDER_TIME = 1

/** Top-level fields a file may lack, which the store2 tree always holds with the database default. */
const TREE_DEFAULTS: Obj = { pluginCustomStorage: {}, archiveCharacters: true, loadouts: [], pluginV2: [], plugins: [] }

/**
 * The recorded differences between the logical content of a file and the file a store2 page exports from it. Everything
 * else (every character, chat and message field, all presets, modules and every other top-level field) must be equal.
 * - A top-level field named in `TREE_DEFAULTS` that the file lacks comes back with the database default: the store2 tree
 *   always holds those records (`pluginCustomStorage`, `archiveCharacters`, `loadouts`, `pluginV2`, `plugins`).
 * - A chat the file gave no `id` (or the placeholder the resolver mints) is given one by the importer: the exported id must be a nonempty string, not the placeholder.
 * - A message the file gave no `time` is stamped by the importer: the exported time must be a number past the placeholder.
 * - `account` is `undefined` after the trip where the file has none; `toEqual` treats a missing and an undefined key alike.
 * Object plugin values (MC-176) are not a difference here: `fork-full.bin` carries one and the export writes it again.
 */
function afterTrip(original: Obj, exported: Obj): Obj {
    const expected = structuredClone(original)
    for (const [key, value] of Object.entries(TREE_DEFAULTS)) {
        expected[key] ??= structuredClone(value)
    }
    const exportedCharacters = (exported.characters ?? []) as Obj[]
    ;(expected.characters as Obj[]).forEach((character, characterIndex) => {
        const exportedChats = ((exportedCharacters[characterIndex]?.chats ?? []) as Obj[])
        ;((character.chats ?? []) as Obj[]).forEach((chat, chatIndex) => {
            const exportedChat = exportedChats[chatIndex]
            if (chat.id === undefined || chat.id === PLACEHOLDER_CHAT_ID) {
                chat.id = typeof exportedChat?.id === 'string' && exportedChat.id !== '' && exportedChat.id !== PLACEHOLDER_CHAT_ID ? exportedChat.id : 'a minted chat id'
            }
            ;((chat.message ?? []) as Obj[]).forEach((message, messageIndex) => {
                const exportedTime = ((exportedChat?.message ?? []) as Obj[])[messageIndex]?.time
                if (message.time === PLACEHOLDER_TIME) {
                    message.time = typeof exportedTime === 'number' && exportedTime > PLACEHOLDER_TIME ? exportedTime : 'a stamped message time'
                }
            })
        })
    })
    return expected
}

describe('composed round trip on a store2 page: LoadLocalBackup, a fresh boot, SaveLocalBackup, then decodeRisuSave', () => {
    // Compatibility guard on both halves. The import half's base reproducer is the "regression:" test in
    // `storeImport.svelte.test.ts`; here it is red only on the approximation that takes the store2 import branch away.
    test.each([...ALL_GOLDENS])('%s exports the logical content it imported', async (file) => {
        const trip = await roundTrip(file)

        expect(trip.errors).toEqual([])
        expect(trip.exported).toEqual(afterTrip(trip.original, trip.exported))
        // Inline form: no stub is left, and no entity-named unit entry leaks into the container.
        expect((trip.exportedRaw.characters as Obj[]).filter((character) => character.coldstorage !== undefined && character.coldstorage !== '')).toEqual([])
        expect(trip.exportedNames.filter((name) => /^coldstorage_[0-9a-v]{26}\.json$/.test(name))).toEqual([])
        expect(trip.confirms).toHaveLength(INCOMPLETE.has(file) ? 1 : 0)
        expect(trip.notices).toEqual([language.backupInlaysOldStoreUnlisted].map((text) => expect.stringContaining(text)))
    })

    test.each([...FULL_GOLDENS])('%s: the asset the characters reference is in the exported file byte for byte', async (file) => {
        const trip = await roundTrip(file)

        expect([...trip.assets.keys()]).toEqual(['golden-avatar.png'])
        expect(trip.assets.get('golden-avatar.png')).toEqual(ASSET_BYTES)
        const inline = (trip.exported.characters as Obj[]).find((character) => character.chaId === 'cha-inline')
        expect(inline?.image).toBe('assets/golden-avatar.png')
    })

    test.each([...FULL_GOLDENS])('%s: every chat, pointer chat and stub chat arrives with its messages', async (file) => {
        const trip = await roundTrip(file)
        const messages = (trip.exported.characters as Obj[]).map((character) => ({
            chaId: character.chaId,
            chats: (character.chats as Obj[]).flatMap((chat) => (chat.message as Obj[]).map((message) => message.data)),
        }))

        const inline = messages.find((entry) => entry.chaId === 'cha-inline')?.chats as string[]
        expect(inline.slice(0, 2)).toEqual(['inline hello', 'archived inline chat'])
        expect(messages.find((entry) => entry.chaId === 'cha-stub')?.chats).toEqual(['blob hello', 'archived blob chat'])
    })
})


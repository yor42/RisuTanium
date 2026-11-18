/**
 * Restore behaviours of the `.bin` import that outlive the block-era restore tail, asserted on the committed tree of a
 * store2 page: the busy refusal at the commit flip, a database holding a module stub, the keys a landed import never
 * writes, the repair of character ids, plugin units of every value shape, a stub-form export imported into another
 * profile, and the router (`loadBackupFromPicker`) restoring exactly as the picker does, with the marker refusal on that
 * route.
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`),
 * against an in-memory store2 backend and a fake Web Locks manager, with the harness of `storeImport.svelte.test.ts`.
 * The legacy unit store is a double (`coldUnits`). A mocked success here is not evidence of native backend behaviour.
 *
 * Labels: every row is a compatibility guard of behaviour the store2 route already has; none has a pre-fix base. The
 * module-stub row also records which end the import comes to (a diagnostic).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import * as kitCommit from 'src/ts/storage/store2/commit'
import { toPlainJson } from 'src/ts/storage/store2/codec/normalize'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { LocalBackupEnd } from 'src/ts/drive/backuplocal'
import { BACKUP_ENCRYPTION_MARKER_NAME } from 'src/ts/drive/backupContainer'
import { writeBackupEntry } from 'src/ts/exportWriters'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'

vi.setConfig({ testTimeout: 60_000 })

const platformBox = vi.hoisted(() => ({ isNodeServer: false }))

type ImportStreamModule = typeof import('src/ts/storage/store2/legacy/importStream')

/** The arm the running test is in: the streamed prepare is held off (whole) or always taken when the file allows (stream). */
const armBox = vi.hoisted(() => ({ arm: 'whole' as 'whole' | 'stream' }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platformBox.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 1024 * 1024,
}) as unknown as typeof import('src/ts/storage/nodeBodyLimit'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

/** The page's legacy cold units, by unit id; what `readColdStorageItem` answers. */
const coldUnits = new Map<string, unknown>()
const setColdStorageItemMock = vi.fn(async () => false)

// msgpackr 1.10.1 passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a string of 64 or more
// characters, which the Node running the tests rejects; the browser build has no `Buffer`, so production is unaffected.
// Clamping the length to the room left changes no byte written: it lets the real encoder run on a long placeholder text.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

afterAll(() => {
    utf8WriterProto.utf8Write = nativeUtf8Write
})

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

beforeEach(() => {
    vi.clearAllMocks()
    coldUnits.clear()
    platformBox.isNodeServer = false
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Entry }),
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
    // The unit store of the page is a double. An entity key reads the store2 character through the residency, as the real
    // reader does (the export of a page that holds stubs needs it); any other key is a legacy unit from `coldUnits`, and the
    // export's own collection of legacy units is empty because a store2 page keeps none.
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async (key: string) => {
            const { getResidency, isEntityUnitKey } = await import('src/ts/storage/store2/residencyActive')
            const residency = getResidency()
            if (isEntityUnitKey(key) && residency !== null) {
                const read = await residency.readCharacter(key)
                return read.status === 'error' ? { status: 'error', error: read.error, kind: read.kind } : { status: 'ok', value: read.value }
            }
            return coldUnits.has(key) ? { status: 'ok', value: coldUnits.get(key) } : { status: 'missing' }
        },
        setColdStorageItem: setColdStorageItemMock,
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        isColdStorageBackupData: vi.fn(() => false),
        listColdDataKeys: vi.fn(async () => []),
    }))
    // The shared world mock of the database module has no `presetFromWorkingSettings`, which the botPresetsId repair of an
    // import calls; the stand-in keeps the working prompt so the appended preset is recognisable.
    vi.doMock('src/ts/storage/database.svelte', () => ({
        getDatabase: vi.fn(() => h.db),
        setDatabase: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        defaultSdDataFunc: vi.fn(() => ({})),
        appVer: 'test',
        appSubVer: 'test',
        getCurrentCharacter: vi.fn(),
        presetFromWorkingSettings: (db: Entry, name: string) => ({ name, mainPrompt: db.mainPrompt }),
    }))
    // The arm seam: production never passes `minUnits`, so the streamed prepare is steered here, through the module the
    // page's import loads. The whole arm never reaches the threshold; the stream arm always does.
    vi.doMock('src/ts/storage/store2/legacy/importStream', async () => {
        const actual = await vi.importActual<ImportStreamModule>('src/ts/storage/store2/legacy/importStream')
        return {
            ...actual,
            prepareImportStream: (request: Parameters<ImportStreamModule['prepareImportStream']>[0], hooks: Parameters<ImportStreamModule['prepareImportStream']>[1]) => actual.prepareImportStream({
                ...request,
                stream: { ...request.stream, minUnits: armBox.arm === 'stream' ? 0 : Number.POSITIVE_INFINITY },
            }, hooks),
        }
    })
    // The committer of the page is built by the kit in this file's module graph, the import code runs in the world's: a
    // streamed commit always runs under a bulk marker and fails with the kit's `Store2BulkAbortError`, which the import
    // must recognise by class as it does in the one graph of the app.
    vi.doMock('src/ts/storage/store2/commit', async () => ({
        ...await vi.importActual<typeof import('src/ts/storage/store2/commit')>('src/ts/storage/store2/commit'),
        Store2BulkAbortError: kitCommit.Store2BulkAbortError,
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(async () => {
    const { overrideBackupWindowBytes } = await import('src/ts/drive/backupContainer')
    overrideBackupWindowBytes(null)
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, get isNodeServer() { return platformBox.isNodeServer }, isIOS: () => false }))
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Page {
    w: World
    k: Store2Kit
    db: Entry
    flush(): void
    alert: typeof import('src/ts/alert')
    busy: typeof import('src/ts/process/memory/busyActions')
    /** What the page's reload did: how many times. */
    reloads: { count: number }
}

async function openPage(options: { webLocks?: boolean, characters?: readonly string[] } = {}): Promise<Page> {
    const locks = new FakeLockManagerCore()
    const manager = options.webLocks === false ? undefined : new FakeTabLockManagerView(locks, 'this')
    Object.defineProperty(window.navigator, 'locks', { value: manager, configurable: true })
    h.db = makeDb('base', options.characters ?? ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const reloads = { count: 0 }
    const page: Page = {
        w,
        k,
        db: h.db,
        flush: flushSync,
        alert: await import('src/ts/alert'),
        busy: await import('src/ts/process/memory/busyActions'),
        reloads,
    }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { reloads.count++ })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

async function currentKey(page: Page): Promise<string | undefined> {
    return (await page.k.commitKey()).current?.key
}

/** Whether `dbWriteLock` can be taken within a moment: false while an import keeps it closed. */
async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])
const confirmTexts = (page: Page): string[] => vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => String(call[0]))
const noticeTexts = (page: Page): string[] => vi.mocked(page.alert.alertNormalWait).mock.calls.map((call) => String(call[0]))

/** The keys the store2 backend of the page holds: the commit and every unit, as a write there would change them. */
const store2Keys = (page: Page): string[] => [...page.k.memory.snapshot().keys()].sort()

// ---- .bin construction ----

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

function binEntry(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, nameBytes.length, true)
    out.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, data.length, true)
    out.set(data, 8 + nameBytes.length)
    return out
}

function binOf(...entries: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(entries.reduce((total, entry) => total + entry.length, 0))
    let offset = 0
    for (const entry of entries) {
        out.set(entry, offset)
        offset += entry.length
    }
    return out
}

const AVATAR = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

const encoder = new TextEncoder()

/** Deterministic version-4-shaped unit ids. */
function uid(n: number): string {
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

const unitName = (key: string): string => `coldstorage_${key}.json`
const unitEntry = (key: string, value: unknown): Uint8Array => binEntry(unitName(key), encoder.encode(JSON.stringify(value)))

/** A `.bin` whose database entry is upstream's legacy msgpack of `db`, as the real producer writes it, after `leading` entries. */
async function legacyBin(page: Page, db: Entry, ...leading: Uint8Array[]): Promise<Uint8Array> {
    return binOf(...leading, binEntry('database.risudat', await page.w.risuSave.encodeRisuSaveLegacy(db, 'compression')))
}

function file(bytes: Uint8Array, name = 'backup.bin'): File {
    return new File([bytes as unknown as Uint8Array<ArrayBuffer>], name)
}

/**
 * Starts a restore (`start` calls the entry point, which creates its file input at once), hands the input `chosen` and
 * awaits the change handler, then the end the restore came to. `before` runs after the pick and before the change.
 */
async function pick<End extends { outcome: string }>(start: () => Promise<End>, chosen: File, before: () => void = () => { }): Promise<End> {
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    try {
        const pending = start()
        const created = input as HTMLInputElement | null
        if (created === null) {
            throw new Error('the restore did not create a file input')
        }
        Object.defineProperty(created, 'files', { value: [chosen], configurable: true })
        before()
        await (created.onchange as unknown as (event: Event) => Promise<void>).call(created, new Event('change'))
        return await pending
    } finally {
        spy.mockRestore()
    }
}

/** The real `LoadLocalBackup()` over `chosen`, as the Settings picker runs it. */
async function loadFile(chosen: File): Promise<LocalBackupEnd> {
    const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
    return await pick(() => LoadLocalBackup(), chosen)
}

const loadBin = (bytes: Uint8Array): Promise<LocalBackupEnd> => loadFile(file(bytes))

async function databaseOf(page: Page, manifestKey: string): Promise<Database> {
    const read = await readTreeBytes(page.k.memory, manifestKey)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return assembleDatabase(read.tree.manifest, read.tree.source)
}

/** The committed current tree. */
async function committed(page: Page): Promise<Database> {
    return await databaseOf(page, await currentKey(page) as string)
}

type Row = Record<string, unknown>

const charactersOf = (db: Database): Row[] => db.characters as unknown as Row[]
const idsOf = (db: Database): unknown[] => charactersOf(db).map((character) => character.chaId)
const namesOf = (db: Database): string[] => charactersOf(db).map((character) => String(character.name))

/** The page's app byte store operations that wrote or deleted anything. */
const mutations = (page: Page) => page.w.store.mutating()

/** The whole and the stream arm: the same rows run once with the streamed prepare held off and once with it always taken. */
function armed(name: string, body: () => void): void {
    for (const arm of ['whole', 'stream'] as const) {
        describe(`${name} (${arm} arm)`, () => {
            beforeEach(() => { armBox.arm = arm })
            body()
        })
    }
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** The committed tree as plain JSON with each uuid replaced by its order of first appearance. */
function normalized(db: Database): string {
    const seen = new Map<string, string>()
    return JSON.stringify(toPlainJson(db)).replace(UUID_PATTERN, (uuid) => {
        if (!seen.has(uuid)) {
            seen.set(uuid, `<uuid${seen.size}>`)
        }
        return seen.get(uuid) as string
    })
}

// ---- T4-P1 ----

armed('T4-P1: work that starts during the read of the file', () => {
    // Guard: the busy check at the commit flip refuses an import that began while another action started during the walk.
    test('guard: busy work started by the first read of the file refuses the import at the flip, with nothing replaced', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        let handle: { end(): void } | null = null
        let started = false
        const real = file(golden('upstream-full.bin'))
        const watched = new Proxy(real, {
            get(target, property) {
                const value = Reflect.get(target, property, target)
                if (typeof value !== 'function') {
                    return value
                }
                if (property === 'slice') {
                    return (...args: Parameters<File['slice']>) => {
                        if (!started) {
                            started = true
                            handle = page.busy.beginBusy('import')
                        }
                        return target.slice(...args)
                    }
                }
                return value.bind(target)
            },
        })

        const end = await loadFile(watched)

        expect(started, 'the file was read').toBe(true)
        expect(end.outcome).toBe('nothing-replaced')
        expect(end.cause).toBe('busy')
        expect(alertErrorTexts(page)).toContain(language.backupLoadWorkInProgress)
        expect(await currentKey(page)).toBe(before)
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
        ;(handle as { end(): void } | null)?.end()
    })
})

// ---- T4-P5 ----

/** The first-message-free module a `.bin` stub row carries; the marker's value is patched to the stub value at the msgpack level. */
function patchStubMarker(bytes: Uint8Array): Uint8Array {
    const key = encoder.encode(MODULE_STUB_KEY)
    for (let at = 0; at + key.length + 1 < bytes.length; at++) {
        if (key.every((byte, index) => bytes[at + index] === byte)) {
            const out = bytes.slice()
            // The marker is written with the value 2 (the encoder refuses the stub value 1); the msgpack positive fixint of 1 is the byte 0x01.
            expect(bytes[at + key.length]).toBe(2)
            out[at + key.length] = 1
            return out
        }
    }
    throw new Error('the marker key is not in the encoded database')
}

armed('T4-P5: a database that holds a module stub', () => {
    // The only hand-built piece is the stub marker value inside the msgpack; the producer refuses to encode a stub itself.
    test('guard: a stub module is never committed (diagnostic: the end it comes to is recorded)', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        const keysBefore = store2Keys(page)
        const source = makeDb('with a stub', ['alpha'])
        source.modules = [{ id: 'stub-id-1', name: 'Stub Module Name', description: '', [MODULE_STUB_KEY]: 2 }]
        const encoded = await page.w.risuSave.encodeRisuSaveLegacy(source, 'noCompression')
        const bytes = binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', patchStubMarker(encoded)))

        const end = await loadBin(bytes)

        expect(end.outcome, `recorded end: ${end.outcome} / ${String(end.cause)}`).not.toBe('committed')
        expect(['nothing-replaced', 'unknown']).toContain(end.outcome)
        expect(await currentKey(page)).toBe(before)
        expect(store2Keys(page)).toEqual(keysBefore)
        expect(page.reloads.count).toBe(0)
    })
})

// ---- T4-P6 ----

/** Keys an import never writes: the block store's and the legacy main file's, a numbered backup, the database and a cold entry as assets. */
function isForbiddenImportKey(key: string): boolean {
    return key === 'database/database.bin'
        || key.startsWith('database/dbbackup-')
        || key.startsWith('blocks/')
        || key === 'assets/database.risudat'
        || key.startsWith('assets/coldstorage_')
}

armed('T4-P6: the keys a landed import writes', () => {
    test('guard: upstream-full.bin lands with its asset and writes no main file, numbered backup, block, database asset or cold-entry asset', async () => {
        const page = await openPage()
        page.w.store.ops.length = 0

        const end = await loadBin(golden('upstream-full.bin'))

        expect(end.outcome).toBe('committed')
        const keys = mutations(page).map((op) => op.key)
        expect(keys, 'the import wrote its asset').toContain('assets/golden-avatar.png')
        expect(keys.filter(isForbiddenImportKey)).toEqual([])
        expect(keys.filter((key) => key.startsWith('coldstorage/'))).toEqual([])
    })
})

// ---- T4-P7 ----

type Character = Row

function character(chaId: unknown, name: string, extra: Row = {}): Character {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${String(chaId)}-chat-0`, message: [{ role: 'char', data: 'hello', time: 1 }], note: '', name: '', localLore: [] }],
        ...extra,
    }
}

function archivedStub(chaId: unknown, name: string, unit: string): Character {
    return { chaId, name, type: 'character', coldstorage: unit, coldStoragedChats: [], chatPage: 0, chats: [{ id: 'stub-chat', message: [{ role: 'char', data: '', time: 1 }], note: '', name: '', localLore: [] }] }
}

function treeOf(characters: unknown[], extra: Row = {}): Entry {
    return { ...makeDb('backup', []), characters, ...extra }
}

armed('T4-P7: the repair of character ids on the committed tree', () => {
    test('guard: an entry that is not a character is left out of the committed tree, and the repair is announced once after the commit', async () => {
        const page = await openPage()

        const end = await loadBin(await legacyBin(page, treeOf([character('a', 'A'), 5, character('b', 'B')])))

        expect(end.outcome).toBe('committed')
        expect(idsOf(await committed(page))).toEqual(['a', 'b'])
        expect(noticeTexts(page)).toEqual([language.restoreRepairedNotice(1, 0, 0)])
        expect(alertErrorTexts(page)).toEqual([])
    })

    test('guard: a character whose id cannot key a unit takes a new id, and the folder, group, loadout and its speaker lines follow', async () => {
        const page = await openPage()
        const held = character('preset', 'Held', { chats: [{ id: 'c1', message: [{ role: 'char', data: 'hi', saying: 'preset', time: 1 }, { role: 'user', data: 'yo', saying: 'preset', time: 2 }], note: '', name: '', localLore: [] }] })
        const group = { chaId: 'g', name: 'Group', type: 'group', characters: ['a', 'preset'], chats: [] }

        const end = await loadBin(await legacyBin(page, treeOf([character('a', 'A'), held, group], {
            characterOrder: ['a', { id: 'F', name: 'F', data: ['preset'] }, 'g'],
            loadouts: [{ characterIds: ['preset'] }],
        })))

        expect(end.outcome).toBe('committed')
        const db = await committed(page)
        const characters = charactersOf(db)
        const fresh = characters[1].chaId as string
        expect(fresh).not.toBe('preset')
        expect(characters[2].characters).toEqual(['a', fresh])
        expect(db.characterOrder).toEqual(['a', { id: 'F', name: 'F', data: [fresh] }, 'g'])
        expect((db.loadouts as unknown as Array<{ characterIds: string[] }>)[0].characterIds).toEqual([fresh])
        const messages = (characters[1].chats as Array<{ message: Array<{ saying: string }> }>)[0].message
        expect(messages[0].saying).toBe(fresh)
        expect(messages[1].saying).toBe('preset')
        expect(noticeTexts(page)).toEqual([language.restoreRepairedNotice(0, 1, 0)])
    })

    test('guard: two characters with one id commit with distinct ids', async () => {
        const page = await openPage()

        const end = await loadBin(await legacyBin(page, treeOf([character('dup-id', 'A'), character('dup-id', 'B')])))

        expect(end.outcome).toBe('committed')
        const ids = idsOf(await committed(page))
        expect(ids).toHaveLength(2)
        expect(new Set(ids).size).toBe(2)
    })

    test('guard: a clean restore commits and shows no repair notice, and a landed import ends committed with no cause', async () => {
        const page = await openPage()

        const end = await loadBin(await legacyBin(page, treeOf([character('a', 'A'), character('b', 'B')])))

        expect(end).toMatchObject({ operation: 'import', outcome: 'committed', cause: null })
        expect(idsOf(await committed(page))).toEqual(['a', 'b'])
        expect(noticeTexts(page)).toEqual([])
    })

    test('guard: an archived character whose id cannot key a unit takes back the id its unit records', async () => {
        const page = await openPage()
        const unit = uid(1)
        const bytes = await legacyBin(page, treeOf([character('a', 'A'), archivedStub('preset', 'Archived', unit)], { characterOrder: ['a', 'preset'] }),
            unitEntry(unit, { character: character('b', 'Real') }))

        const end = await loadBin(bytes)

        expect(end.outcome).toBe('committed')
        const db = await committed(page)
        expect(idsOf(db)).toEqual(['a', 'b'])
        expect(db.characterOrder).toEqual(['a', 'b'])
    })

    test('guard: an archived character with an unusable id and no readable unit is refused by name, with nothing committed', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        const keysBefore = store2Keys(page)

        const end = await loadBin(await legacyBin(page, treeOf([character('a', 'A'), archivedStub('preset', 'The Archived One', uid(2))])))

        expect(end.outcome).toBe('nothing-replaced')
        expect(end.cause).toBe('archived-id')
        expect(alertErrorTexts(page)).toEqual([language.restoreRefusedArchivedId('The Archived One')])
        expect(await currentKey(page)).toBe(before)
        expect(store2Keys(page)).toEqual(keysBefore)
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })
})

// ---- T4-P8 ----

const PLUGIN_VALUES: Array<[string, unknown]> = [
    ['an object', { a: 1 }],
    ['a string', 's'],
    ['the number zero', 0],
    ['null', null],
    ['an array', [1]],
]

const storageOf = (db: Database): Row => db.pluginCustomStorage as unknown as Row

armed('T4-P8: plugin storage units and the entries that are not units', () => {
    test.each(PLUGIN_VALUES)('guard: a coldstorage_<uuid>.json entry whose body is %s lands under its unit id and nothing is asked', async (_label, value) => {
        const page = await openPage()
        const key = uid(20)
        const bytes = await legacyBin(page, treeOf([], { pluginCustomStorage: { _coldplugin: { stored: key } } }), unitEntry(key, value))

        const end = await loadBin(bytes)

        expect(end.outcome).toBe('committed')
        expect(storageOf(await committed(page))[key]).toEqual(value)
        expect(confirmTexts(page)).toEqual([])
    })

    test.each(PLUGIN_VALUES)('guard: a plugin unit already on the device holding %s satisfies a mapping the file has no entry for', async (_label, value) => {
        const page = await openPage()
        const key = uid(40)
        coldUnits.set(key, value)
        const bytes = await legacyBin(page, treeOf([], { pluginCustomStorage: { _coldplugin: { stored: key } } }))

        const end = await loadBin(bytes)

        expect(end.outcome).toBe('committed')
        expect(storageOf(await committed(page))[key]).toEqual(value)
        expect(confirmTexts(page)).toEqual([])
    })

    test('guard: a plugin mapping whose unit is absent on the device and in the file is named once by the incomplete question', async () => {
        const page = await openPage()
        const key = uid(41)

        const end = await loadBin(await legacyBin(page, treeOf([], { pluginCustomStorage: { _coldplugin: { stored: key } } })))

        expect(end.outcome).toBe('committed')
        expect(confirmTexts(page)).toHaveLength(1)
        expect(confirmTexts(page)[0]).toContain(language.store2Boot.incompletePluginLine('stored', language.store2Boot.reasonMissing))
        expect(storageOf(await committed(page))[key]).toBeUndefined()
    })

    test('guard: a coldstorage_<uuid>.json entry that is not JSON is neither an asset nor a unit', async () => {
        const page = await openPage()
        const key = uid(50)
        page.w.store.ops.length = 0

        const end = await loadBin(await legacyBin(page, treeOf([character('a', 'A')]), binEntry(unitName(key), encoder.encode('not json {'))))

        expect(end.outcome).toBe('committed')
        expect(mutations(page).map((op) => op.key).filter((name) => name.includes(key))).toEqual([])
        expect(storageOf(await committed(page))[key]).toBeUndefined()
    })

    test.each([
        ['a bare <uuid>.json entry', (key: string) => `${key}.json`],
        ['a coldstorage/<uuid>.json entry', (key: string) => `coldstorage/${key}.json`],
    ])('guard: %s is not used as the unit of a mapping', async (_label, nameOf) => {
        const page = await openPage()
        const key = uid(51)
        const bytes = await legacyBin(page, treeOf([], { pluginCustomStorage: { _coldplugin: { stored: key } } }),
            binEntry(nameOf(key), encoder.encode(JSON.stringify({ a: 1 }))))

        const end = await loadBin(bytes)

        expect(end.outcome).toBe('committed')
        expect(storageOf(await committed(page))[key]).toBeUndefined()
        expect(confirmTexts(page)).toHaveLength(1)
    })
})

// ---- T4-P9 ----

/** The file the real `SaveLocalBackup` writes from the page's booted tree: the page's reload is a fresh boot over what it committed. */
async function exportOf(page: Page, mode: 'inline' | 'stub'): Promise<{ bytes: Uint8Array, stubs: number }> {
    const { SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    // Imported after the world started, so the boot registers its residency in the graph `SaveLocalBackup` runs in.
    const { bootThroughDispatch } = await import('src/ts/storage/tests/store2SaveKit')
    const boot = await bootThroughDispatch(page.k.counted.backend)
    if (boot.result.kind !== 'store2') {
        throw new Error(`the boot after the import came to ${boot.result.kind}`)
    }
    h.db = boot.result.database as unknown as Entry
    const stubs = (h.db.characters as Row[]).filter((entry) => entry.coldstorage).length
    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    await SaveLocalBackup({ mode })
    return { bytes: binOf(...written), stubs }
}

/** The chats' message lists of every character, which a whole import must carry. */
function messagesOf(db: Database): unknown[] {
    return charactersOf(db).map((entry) => (entry.chats as Array<{ message: unknown }>).map((chat) => chat.message))
}

describe.each(['inline', 'stub'] as const)('T4-P9: a %s-form export of a store2 page imports whole into another store2 profile', (mode) => {
    beforeEach(() => { armBox.arm = 'whole' })

    test('guard: every character comes back whole, with its chats, and none is a stub', async () => {
        const source = await openPage()
        expect((await loadBin(golden('upstream-full.bin'))).outcome).toBe('committed')
        const original = await committed(source)
        const exported = await exportOf(source, mode)
        expect(exported.stubs, 'the exporting page holds stubs').toBeGreaterThan(0)
        worlds.parkAll()

        const target = await openPage()
        const end = await loadBin(exported.bytes)

        expect(end.outcome).toBe('committed')
        const imported = await committed(target)
        expect(namesOf(imported)).toEqual(namesOf(original))
        expect(charactersOf(imported).every((entry) => !entry.coldstorage)).toBe(true)
        expect(messagesOf(imported)).toEqual(messagesOf(original))
        expect(alertErrorTexts(target)).toEqual([])
    })

    test('guard: a group that is a stub is exported whole with its members and talk lists and imports whole', async () => {
        const source = await openPage()
        const group = { chaId: 'group-one', name: 'Group One', type: 'group', characters: ['a', 'b'], characterTalks: [0.5, 0.5], characterActive: [true, true], chats: [{ id: 'g-chat', message: [{ role: 'char', data: 'group hello', time: 1 }], note: '', name: '', localLore: [] }] }
        const tree = treeOf([character('a', 'A'), character('b', 'B'), group], { characterOrder: ['a', 'b', 'group-one'] })
        expect((await loadBin(await legacyBin(source, tree))).outcome).toBe('committed')
        const original = await committed(source)
        const exported = await exportOf(source, mode)
        expect(exported.stubs, 'the exporting page holds stubs').toBeGreaterThan(0)
        worlds.parkAll()

        const target = await openPage()
        const end = await loadBin(exported.bytes)

        expect(end.outcome).toBe('committed')
        const imported = await committed(target)
        const restored = charactersOf(imported).find((entry) => entry.chaId === 'group-one')
        expect(restored).toMatchObject({ type: 'group', name: 'Group One', characters: ['a', 'b'], characterTalks: [0.5, 0.5] })
        expect(charactersOf(imported).every((entry) => !entry.coldstorage)).toBe(true)
        expect(messagesOf(imported)).toEqual(messagesOf(original))
    })
})

// ---- T4-P10 ----

armed('T4-P10: the router restores exactly as the picker does', () => {
    test.each(['fork-full.bin', 'upstream-kv.bin'])('guard: %s gives the same committed tree, alerts and outcome through loadBackupFromPicker', async (name) => {
        const direct = await openPage()
        const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
        const directEnd = await pick(() => LoadLocalBackup(), file(golden(name), name))
        const directTree = normalized(await committed(direct))
        const directAlerts = [alertErrorTexts(direct), confirmTexts(direct)]
        expect(directEnd.outcome).toBe('committed')
        worlds.parkAll()

        const routedPage = await openPage()
        const { loadBackupFromPicker } = await import('src/ts/drive/backupRouter')
        const routedEnd = await pick(() => loadBackupFromPicker(), file(golden(name), name))

        expect(normalized(await committed(routedPage))).toBe(directTree)
        expect([alertErrorTexts(routedPage), confirmTexts(routedPage)]).toEqual(directAlerts)
        expect(routedEnd.outcome).toBe(directEnd.outcome)
    })

    test('guard: a busy entry opened between the pick and the restore is refused with backupLoadWorkInProgress on both paths', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
        const { loadBackupFromPicker } = await import('src/ts/drive/backupRouter')
        for (const start of [() => LoadLocalBackup(), () => loadBackupFromPicker()]) {
            vi.mocked(page.alert.alertError).mockClear()
            let other = { end: () => { } }
            const end = await pick(start, file(golden('fork-full.bin')), () => { other = page.busy.beginBusy('backupLoad') })
            other.end()
            expect(end.outcome).toBe('nothing-replaced')
            expect(alertErrorTexts(page)).toContain(language.backupLoadWorkInProgress)
            expect(await currentKey(page)).toBe(before)
        }
        expect(page.reloads.count).toBe(0)
    })

    // MC-477 on the router route: the walk stops at the marker and no entry survives it, so the no-database refusal would
    // show another message; only the exact alert list tells the refusal from that.
    test('guard: an encrypted account .bin routed through loadBackupFromPicker is refused with exactly the encrypted-backup message, before any write', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        const keysBefore = store2Keys(page)
        const parts: Uint8Array[] = []
        const sink = { write: async (piece: Uint8Array) => { parts.push(piece.slice()) } }
        await writeBackupEntry(sink, encoder.encode(BACKUP_ENCRYPTION_MARKER_NAME), encoder.encode('{"time":1,"type":"account"}'))
        await writeBackupEntry(sink, encoder.encode('database.risudat'), new Uint8Array(64).fill(7))
        page.w.store.ops.length = 0
        const { loadBackupFromPicker } = await import('src/ts/drive/backupRouter')

        const end = await pick(() => loadBackupFromPicker(), file(binOf(...parts), 'risuai-account.bin'))

        expect(end.outcome).toBe('nothing-replaced')
        expect(alertErrorTexts(page)).toEqual([language.encryptedBackupRefused])
        expect(mutations(page)).toEqual([])
        expect(store2Keys(page)).toEqual(keysBefore)
        expect(await currentKey(page)).toBe(before)
        expect(page.reloads.count).toBe(0)
    })
})

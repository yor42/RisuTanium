/**
 * Compatibility guard: the `.bin` golden fixtures under `binGoldens/` restore through the real `LoadLocalBackup`
 * (`src/ts/drive/backuplocal.ts`) into the real store2 commit of a store2 page, to the logical content they were built
 * from. It holds before and after any change to how a backup is imported or exported, so a later rewrite can show that
 * the same files still import to the same characters, plugin values, upstream key-value blocks, module, preset and asset.
 *
 * `fork-*.bin` were written by the real `SaveLocalBackup` and `upstream-*.bin` were assembled from the shapes upstream's
 * `makeColdDataForCharacter` and `makeColdDataForChat` leave behind (`Agents/Tools/save-gen/binGoldens.harness.ts`,
 * `binGoldens/README.md`). Every one of the files has a row in `GOLDEN_TABLE` (T4-P3), and `T4-P3d` fails when a file
 * exists that the table does not name. The three upstream shapes the store2 route adapts (a plugin storage index, an
 * index unit that is in no entry, an unreadable key-value block) have their own rows in both arms (T4-P3a to T4-P3c).
 *
 * Harness: the save-loop world of `storeImport.svelte.test.ts` (`saveLoopWorld.ts`, `store2SaveKit.ts`) over an in-memory
 * store2 backend and a fake Web Locks manager; the legacy unit store is a double that answers `missing`. A pass says
 * nothing about the Tauri or Node backends or a real browser's storage.
 *
 * The missing-unit goldens hold a chat pointer whose unit is in no entry: the import asks the incomplete-restore
 * question naming the character, and the chat keeps the load-error text the resolve leaves for that unit.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { gzipSync } from 'fflate'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { ID, loadGolden, readerOver, unitValueOf } from 'src/ts/storage/tests/store2/legacyFixtures'
import { language } from 'src/lang'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import * as kitCommit from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { LocalBackupEnd } from 'src/ts/drive/backuplocal'
import { formatColdStorageLoadError } from 'src/ts/process/coldstorageData'
import { createHypaV3Preset, normalizeHypaV3Presets } from 'src/ts/process/memory/hypaV3Presets'

vi.setConfig({ testTimeout: 60_000 })

//#region harness

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
type Row = Record<string, unknown>

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

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
    platformBox.isNodeServer = false
    armBox.arm = 'whole'
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
    // The page's unit store is a double. An entity key reads the store2 character through the residency, as the real reader
    // does (the export of a page that holds stubs needs it); any other key is a legacy unit, and there is none. The export's
    // own collection of legacy units is empty because a store2 page keeps none.
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
            return { status: 'missing' }
        },
        setColdStorageItem: vi.fn(async () => false),
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        isColdStorageBackupData: vi.fn(() => false),
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
    flush(): void
    alert: typeof import('src/ts/alert')
    /** What the page's reload did: how many times. */
    reloads: { count: number }
}

async function openPage(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const reloads = { count: 0 }
    const page: Page = { w, k, flush: flushSync, alert: await import('src/ts/alert'), reloads }
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

/** The app byte store operations that wrote or deleted anything. */
const mutations = (page: Page) => page.w.store.mutating()

/** The keys the store2 backend holds: the commit and every unit, as a write there would change them. */
const store2Keys = (page: Page): string[] => [...page.k.memory.snapshot().keys()].sort()

// The run command's working directory is the repo root; BIN_GOLDENS_DIR points the guard at another directory of the same file names.
const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

const GOLDEN_FILES = (): string[] => fs.readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.bin')).sort()

/** The goldens run at the default windows and again at windows so small that every golden crosses window edges in both passes. */
const GOLDEN_WINDOWS: readonly (number | undefined)[] = [undefined, 4, 64]

/** Set after `openPage()`: the world re-imports the app's modules, and the seam must be the one the world's `backuplocal` reads. */
async function useGoldenWindows(windowBytes: number | undefined): Promise<void> {
    const { overrideBackupWindowBytes } = await import('src/ts/drive/backupContainer')
    overrideBackupWindowBytes(windowBytes === undefined ? null : { walk: windowBytes, copy: windowBytes })
}

/** Drives the real `LoadLocalBackup()` with `bytes` as the chosen file and awaits its change handler and its end. */
async function loadBin(bytes: Uint8Array): Promise<LocalBackupEnd> {
    const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
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
        const pending = LoadLocalBackup()
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('LoadLocalBackup did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        return await pending
    } finally {
        spy.mockRestore()
    }
}

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

/** The whole and the stream arm: the same rows run once with the streamed prepare held off and once with it always taken. */
function armed(name: string, body: () => void): void {
    for (const arm of ['whole', 'stream'] as const) {
        describe(`${name} (${arm} arm)`, () => {
            beforeEach(() => { armBox.arm = arm })
            body()
        })
    }
}

/** One restore on a fresh page: the page after the import, and the committed tree. */
async function restoredOnFreshPage(bytes: Uint8Array): Promise<{ page: Page, db: Database, end: LocalBackupEnd }> {
    worlds.parkAll()
    const page = await openPage()
    const end = await loadBin(bytes)
    return { page, db: await committed(page), end }
}

/**
 * The real `SaveLocalBackup` over `db`, as the page the import landed on exports it, and the file it wrote. The page's
 * reload is a fresh boot over what it committed, which registers the residency the export reads in the world's graph.
 */
async function exportOf(page: Page, db: Database): Promise<Uint8Array> {
    const { SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const { bootThroughDispatch } = await import('src/ts/storage/tests/store2SaveKit')
    const boot = await bootThroughDispatch(page.k.counted.backend)
    if (boot.result.kind !== 'store2') {
        throw new Error(`the boot after the import came to ${boot.result.kind}`)
    }
    h.db = db as unknown as Entry
    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    await SaveLocalBackup()
    return concatBytes(written)
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** The `database.risudat` entry of a written backup: entries are `[u32 nameLength][name][u32 dataLength][data]`. */
function databaseEntryOf(container: Uint8Array): Uint8Array {
    const view = new DataView(container.buffer, container.byteOffset, container.byteLength)
    let offset = 0
    while (offset < container.length) {
        const nameLength = view.getUint32(offset, true)
        const name = new TextDecoder().decode(container.subarray(offset + 4, offset + 4 + nameLength))
        const dataLength = view.getUint32(offset + 4 + nameLength, true)
        const start = offset + 8 + nameLength
        if (name === 'database.risudat') {
            return container.slice(start, start + dataLength)
        }
        offset = start + dataLength
    }
    throw new Error('the backup has no database entry')
}

const charactersOf = (db: Database): Row[] => db.characters as unknown as Row[]
const idsOf = (db: Database): unknown[] => charactersOf(db).map((entry) => entry.chaId)
const namesOf = (db: Database): string[] => charactersOf(db).map((entry) => String(entry.name))
const firstMessages = (entry: Row): string[] => (entry.chats as Array<{ message: Array<{ data: string }> }>).map((chat) => chat.message[0].data)
const storageOf = (db: Database): Row => (db.pluginCustomStorage ?? {}) as unknown as Row
const slotsOf = (db: Database): Record<string, string> => (storageOf(db)._coldplugin ?? {}) as Record<string, string>

function characterNamed(db: Database, chaId: string): Row {
    const found = charactersOf(db).find((entry) => entry.chaId === chaId)
    if (found === undefined) {
        throw new Error(`the committed database has no character ${chaId}`)
    }
    return found
}

//#endregion

//#region the logical view

const UNIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

interface LogicalView {
    characters: Array<{ chaId: unknown, name: unknown, firstMessages: string[] }>
    /** Plugin values by slot key, and every plain plugin storage key that is not a unit id. */
    plugins: Record<string, unknown>
    plain: Record<string, unknown>
    upstreamKvBlocks: unknown
    presets: unknown[]
}

/** The appended working-settings preset a dangling `botPresetsId` gets on an import (`storeImport.svelte.test.ts`). */
const WORKING_PRESET = 'New Preset'

/**
 * What a restore must keep of a tree, compared between the import's commit and a plain `resolveLegacyTree` of the same
 * golden: characters as id, name and the first message of each chat, plugin values by slot (so minted unit ids are not
 * compared), upstream key-value blocks, and presets by name. Modules are compared by `toMatchObject` beside this view.
 */
function logicalView(db: Database): LogicalView {
    const storage = storageOf(db)
    const slots = slotsOf(db)
    const unitIds = new Set(Object.values(slots))
    const plugins: Record<string, unknown> = {}
    for (const [key, id] of Object.entries(slots)) {
        plugins[key] = storage[id]
    }
    const plain: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(storage)) {
        if (key !== '_coldplugin' && key !== '_coldpluginIndex' && !unitIds.has(key)) {
            plain[key] = value
        }
    }
    return {
        characters: charactersOf(db).map((entry) => ({ chaId: entry.chaId, name: entry.name, firstMessages: firstMessages(entry) })),
        plugins,
        plain,
        upstreamKvBlocks: (db as unknown as Row).upstreamKvBlocks,
        presets: (db.botPresets as unknown as Array<{ name: string }>).filter((preset) => preset.name !== WORKING_PRESET).map((preset) => preset.name),
    }
}

//#endregion

//#region the T4-P3 table

const ASSET_KEY = 'assets/golden-avatar.png'
const ASSET_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x47, 0x4f, 0x4c, 0x44])

/** The full module and preset records every full golden carries. */
const GOLDEN_MODULE = {
    id: 'module-golden',
    name: 'Golden Module',
    description: 'golden module',
    lorebook: [{ key: 'golden-key', comment: 'golden entry', content: 'golden lore', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false }],
    regex: [{ comment: 'golden regex', in: 'gold', out: 'GOLD', type: 'editdisplay' }],
    trigger: [],
}
const GOLDEN_PRESET = { name: 'Golden Preset', id: 'preset-golden', temperature: 80, maxContext: 4000, maxResponse: 300 }

/** The unit ids of the plugin-index goldens (`Agents/Tools/save-gen/binGoldens.harness.ts`). */
const INDEX_ID = {
    index: '00000000-0000-4000-8000-0000000000b1',
    large: '00000000-0000-4000-8000-0000000000b2',
    shadowed: '00000000-0000-4000-8000-0000000000b3',
    kept: '00000000-0000-4000-8000-0000000000b4',
} as const

/** Upstream's SaveKV namespaces of `upstream-kv.bin` (type 12 `kv:<namespace>` blocks of the database entry). */
const KV_A_CONTENT = {
    version: 1,
    entries: [
        { k: 'zeta', v: 1 },
        { k: '0', v: 'zero' },
        { k: 'alpha', v: { list: [1, { deep: true }, null], text: 'x' } },
        { k: '한글🙂', v: 'unicode value' },
        { k: 'nothing', v: null },
    ],
}
const KV_B_CONTENT = { version: 1, entries: [{ k: 'second', v: [false, 'b'] }, { k: 'first', v: 0 }] }

interface GoldenCase {
    file: string
    /** How many `alertConfirm` calls the import makes when every answer is yes. */
    questions: number
    /** What this golden's store2 commit must hold, beyond the logical view every golden is compared on. */
    check(db: Database, page: Page, confirms: string[]): void | Promise<void>
}

const FULL_CASES = [
    { file: 'fork-full.bin', pluginUnit: { theme: 'dark', count: 3 } },
    { file: 'upstream-full.bin', pluginUnit: ['dark', 3] },
] as const

function fullCase(file: string, pluginUnit: unknown): GoldenCase {
    return {
        file,
        questions: 0,
        check(db, page) {
            expect(namesOf(db)).toEqual(['Inline Alice', 'Stub Bob'])
            const inline = characterNamed(db, 'cha-inline')
            expect(inline.image).toBe(ASSET_KEY)
            // The pointer chat takes the archived chat's messages; the chat the file left unreadable keeps the load-error text.
            expect(firstMessages(inline).slice(0, 2)).toEqual(['inline hello', 'archived inline chat'])
            const stub = characterNamed(db, 'cha-stub')
            expect(stub.coldstorage).toBeFalsy()
            expect(firstMessages(stub)[0]).toBe('blob hello')
            expect(db.modules).toHaveLength(1)
            expect(db.modules[0]).toMatchObject(GOLDEN_MODULE)
            expect((db.botPresets as unknown as Row[]).find((preset) => preset.name === 'Golden Preset')).toMatchObject(GOLDEN_PRESET)
            expect(Object.keys(slotsOf(db))).toEqual(['prefs'])
            expect(storageOf(db)[slotsOf(db).prefs]).toEqual(pluginUnit)
            expect(Array.from(page.w.store.peek(ASSET_KEY) as Uint8Array)).toEqual(Array.from(ASSET_BYTES))
        },
    }
}

function missingUnitCase(file: string): GoldenCase {
    return {
        file,
        questions: 1,
        check(db, _page, confirms) {
            expect(db.characters).toHaveLength(1)
            expect(confirms[0]).toContain('Inline Alice')
            expect(firstMessages(characterNamed(db, 'cha-inline'))).toEqual(['inline hello', formatColdStorageLoadError(ID.missingChatUnit)])
        },
    }
}

function stubCase(file: string): GoldenCase {
    return {
        file,
        questions: 1,
        check(db, _page, confirms) {
            // The unit the stub names is unusable, so the character stays a placeholder and the question names it.
            expect(db.characters).toHaveLength(1)
            const stub = characterNamed(db, 'cha-stub')
            expect(stub.name).toBe('Stub Bob')
            expect(stub.coldstorage).toBeFalsy()
            expect(confirms[0]).toContain('Stub Bob')
        },
    }
}

const GOLDEN_TABLE: readonly GoldenCase[] = [
    ...FULL_CASES.map(({ file, pluginUnit }) => fullCase(file, pluginUnit)),
    missingUnitCase('fork-missing-unit.bin'),
    missingUnitCase('upstream-missing-unit.bin'),
    {
        file: 'upstream-plugin-object-no-entry.bin',
        questions: 1,
        check(db, _page, confirms) {
            expect(slotsOf(db)).toEqual({ prefs: ID.pluginUnit })
            expect(storageOf(db)[ID.pluginUnit]).toBeUndefined()
            expect(idsOf(db)).toEqual(['cha-inline'])
            expect(confirms[0]).toContain(language.store2Boot.incompletePluginLine('prefs', language.store2Boot.reasonMissing))
        },
    },
    stubCase('fork-stub-missing-entry.bin'),
    stubCase('fork-stub-bad-json.bin'),
    stubCase('fork-stub-wrong-shape.bin'),
    stubCase('upstream-stub-missing-entry.bin'),
    stubCase('upstream-stub-bad-json.bin'),
    stubCase('upstream-stub-wrong-shape.bin'),
    {
        file: 'upstream-kv.bin',
        questions: 0,
        check(db) {
            const kv = (db as unknown as Row).upstreamKvBlocks
            expect(kv).toEqual({ 'ns-a': KV_A_CONTENT, 'ns-b': KV_B_CONTENT })
            expect(Object.keys(kv as Row)).toEqual(['ns-a', 'ns-b'])
            expect(idsOf(db)).toEqual(['cha-inline'])
        },
    },
    {
        file: 'upstream-kv-unreadable.bin',
        questions: 1,
        check(db, _page, confirms) {
            expect((db as unknown as Row).upstreamKvBlocks).toEqual({ 'ns-b': KV_B_CONTENT })
            expect(confirms[0]).toContain('- 1 part(s) of the backup this version cannot read')
        },
    },
    {
        file: 'upstream-plugin-index.bin',
        questions: 0,
        check(db) {
            expect(Object.hasOwn(storageOf(db), '_coldpluginIndex')).toBe(false)
            expect(Object.keys(slotsOf(db)).length).toBeGreaterThan(0)
        },
    },
    {
        file: 'upstream-plugin-index-missing.bin',
        questions: 1,
        check(db, _page, confirms) {
            expect(slotsOf(db)).toEqual({ kept: INDEX_ID.kept })
            expect(confirms[0]).toContain(language.store2Boot.incompletePluginLine('_coldpluginIndex', language.store2Boot.reasonMissing))
        },
    },
]

//#endregion

describe.each(GOLDEN_WINDOWS)('T4-P3: every golden restores on a store2 page through the real commit (windows: %s)', (windowBytes) => {
    test.each(GOLDEN_TABLE.map((entry) => [entry.file, entry] as const))('guard: %s lands, asks the table\'s questions, holds the table\'s content and the logical view of its own resolve', async (_file, entry) => {
        const page = await openPage()
        await useGoldenWindows(windowBytes)
        const before = await currentKey(page)

        const end = await loadBin(golden(entry.file))

        expect(end.outcome).toBe('committed')
        expect(alertErrorTexts(page)).toEqual([])
        expect(await currentKey(page)).not.toBe(before)
        expect(page.reloads.count).toBe(1)
        expect(confirmTexts(page)).toHaveLength(entry.questions)
        const db = await committed(page)
        await entry.check(db, page, confirmTexts(page))

        // The projection row: the logical view of the commit equals the one of a plain resolve of the same file, for all 15.
        const fixture = await loadGolden(entry.file)
        const { resolveLegacyTree } = await import('src/ts/storage/store2/legacy/resolve')
        const resolved = (await resolveLegacyTree(fixture.tree, readerOver(fixture.units))).database
        expect(logicalView(db)).toEqual(logicalView(resolved))
        const expectedModules = (resolved.modules ?? []) as unknown as Row[]
        expect(db.modules).toHaveLength(expectedModules.length)
        expectedModules.forEach((expected, index) => expect(db.modules[index]).toMatchObject(expected))
    })
})

// T4-P3d: a golden added later fails here until the table gives it a real-commit row.
describe('T4-P3d: the table names every golden file', () => {
    test('guard: the .bin files of binGoldens/ are exactly the files of GOLDEN_TABLE', () => {
        expect(GOLDEN_TABLE.map((entry) => entry.file).sort()).toEqual(GOLDEN_FILES())
        expect(new Set(GOLDEN_TABLE.map((entry) => entry.file)).size).toBe(GOLDEN_TABLE.length)
    })
})

// T4-P3a: upstream's plugin storage index becomes `_coldplugin` slots, never a pointer.
describe.each(GOLDEN_WINDOWS)('T4-P3a: upstream-plugin-index.bin (windows: %s)', (windowBytes) => {
    armed('upstream-plugin-index.bin converts the plugin storage index on a store2 page', () => {
        test('guard: the committed tree holds slots equal to the index values, the index wins over the fork map, and there is no pointer', async () => {
            const page = await openPage()
            await useGoldenWindows(windowBytes)
            const before = await currentKey(page)
            page.w.store.ops.length = 0

            const end = await loadBin(golden('upstream-plugin-index.bin'))

            expect(end.outcome).toBe('committed')
            expect(await currentKey(page)).not.toBe(before)
            const db = await committed(page)
            const storage = storageOf(db)
            const slots = slotsOf(db)
            const values: Record<string, unknown> = {}
            for (const [key, id] of Object.entries(slots)) {
                values[key] = storage[id]
            }
            expect(values).toEqual({
                objKey: { theme: 'dark', nested: { list: [1, 2, null], flag: false } },
                nullKey: null,
                numKey: 42,
                textKey: 'hello',
                falseKey: false,
                emptyTextKey: '',
                bigKey: { big: ['a', 'b', 'c'] },
                shared: { from: 'index' },
                kept: ['kept'],
            })
            expect(slots.bigKey).toBe(INDEX_ID.large)
            expect(slots.kept).toBe(INDEX_ID.kept)
            expect(slots.shared).not.toBe(INDEX_ID.shadowed)
            for (const id of Object.values(slots)) {
                expect(id).toMatch(UNIT_ID)
            }
            expect(Object.hasOwn(storage, '_coldpluginIndex')).toBe(false)
            expect(Object.keys(storage).sort()).toEqual(['_coldplugin', ...new Set(Object.values(slots))].sort())
            expect(idsOf(db)).toEqual(['cha-inline'])
            expect(confirmTexts(page)).toEqual([])
            expect(mutations(page).filter((op) => op.key.startsWith('coldstorage/'))).toEqual([])
            expect(page.reloads.count).toBe(1)
        })
    })
})

// T4-P3b: an index unit that is in no entry asks the incomplete-restore question and leaves no pointer.
describe.each(GOLDEN_WINDOWS)('T4-P3b: upstream-plugin-index-missing.bin (windows: %s)', (windowBytes) => {
    armed('upstream-plugin-index-missing.bin lists the missing index unit', () => {
        test('guard: one question names the index, and the default yes lands the kept unit with no pointer', async () => {
            const page = await openPage()
            await useGoldenWindows(windowBytes)
            const before = await currentKey(page)

            const end = await loadBin(golden('upstream-plugin-index-missing.bin'))

            expect(end.outcome).toBe('committed')
            expect(await currentKey(page)).not.toBe(before)
            expect(page.reloads.count).toBe(1)
            expect(confirmTexts(page)).toHaveLength(1)
            expect(confirmTexts(page)[0]).toContain(language.store2Boot.incompletePluginLine('_coldpluginIndex', language.store2Boot.reasonMissing))
            const db = await committed(page)
            const fixture = await loadGolden('upstream-plugin-index-missing.bin')
            expect(slotsOf(db)).toEqual({ kept: INDEX_ID.kept })
            expect(storageOf(db)[INDEX_ID.kept]).toEqual(unitValueOf(fixture, INDEX_ID.kept))
            expect(Object.hasOwn(storageOf(db), '_coldpluginIndex')).toBe(false)
        })

        test('guard: answering no leaves the commit key and the store2 keys unchanged, with no reload and the write lock free', async () => {
            const page = await openPage()
            await useGoldenWindows(windowBytes)
            vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
            const before = await currentKey(page)
            const keysBefore = store2Keys(page)

            const end = await loadBin(golden('upstream-plugin-index-missing.bin'))

            expect(end.outcome).toBe('nothing-replaced')
            expect(confirmTexts(page)).toHaveLength(1)
            expect(await currentKey(page)).toBe(before)
            expect(store2Keys(page)).toEqual(keysBefore)
            expect(page.reloads.count).toBe(0)
            expect(await writeLockIsFree(page)).toBe(true)
        })
    })
})

// T4-P3c: a key-value block that is not JSON is the one thing left out, after one question.
describe.each(GOLDEN_WINDOWS)('T4-P3c: upstream-kv-unreadable.bin (windows: %s)', (windowBytes) => {
    armed('upstream-kv-unreadable.bin leaves out the unreadable block', () => {
        test('guard: one question names the part left out, and the valid namespace lands', async () => {
            const page = await openPage()
            await useGoldenWindows(windowBytes)
            const before = await currentKey(page)

            const end = await loadBin(golden('upstream-kv-unreadable.bin'))

            expect(end.outcome).toBe('committed')
            expect(await currentKey(page)).not.toBe(before)
            const db = await committed(page)
            expect((db as unknown as Row).upstreamKvBlocks).toEqual({ 'ns-b': KV_B_CONTENT })
            expect(idsOf(db)).toEqual(['cha-inline'])
            expect(confirmTexts(page)).toHaveLength(1)
            expect(confirmTexts(page)[0]).toContain('- 1 part(s) of the backup this version cannot read')
            expect(page.reloads.count).toBe(1)
        })
    })
})

// Upstream's SaveKV export: the committed namespaces come back out as `kv:` blocks in upstream's block format.
describe('upstream-kv.bin carries upstream SaveKV namespaces through an export', () => {
    async function decodeEntry(entry: Uint8Array, strict: boolean): Promise<Row> {
        const { decodeRisuSave } = await import('src/ts/storage/risuSave')
        return await decodeRisuSave(entry, strict ? { strict: true } : undefined) as unknown as Row
    }

    test('reproducer: an export of the committed tree is upstream block format that decodes to the same namespaces', async () => {
        const { page, db } = await restoredOnFreshPage(golden('upstream-kv.bin'))
        const restoredKv = structuredClone((db as unknown as Row).upstreamKvBlocks)

        const entry = databaseEntryOf(await exportOf(page, db))

        const { isBlockFormatSave } = await import('src/ts/storage/risuSave')
        expect(isBlockFormatSave(entry)).toBe(true)
        const decoded = await decodeEntry(entry, true)
        expect(decoded.upstreamKvBlocks).toEqual(restoredKv)
        expect(Object.keys(decoded.upstreamKvBlocks as Row)).toEqual(['ns-a', 'ns-b'])
        expect((decoded.characters as Row[]).map((entry) => entry.chaId)).toEqual(['cha-inline'])
        // The root block is the only uncompressed one: it names the directory and does not hold the field.
        const text = new TextDecoder().decode(entry)
        expect(text).toContain('"__directory"')
        expect(text).not.toContain('upstreamKvBlocks')
        // The live tree the page holds is not changed by the export.
        expect((db as unknown as Row).upstreamKvBlocks).toEqual(restoredKv)
    })

    test('reproducer: a character with a numeric id and kv namespaces exports, and the number survives', async () => {
        const { page, db } = await restoredOnFreshPage(golden('upstream-kv.bin'))
        const restoredKv = structuredClone((db as unknown as Row).upstreamKvBlocks)
        ;(charactersOf(db)[0] as unknown as { chaId: number }).chaId = 5

        const entry = databaseEntryOf(await exportOf(page, db))

        expect(alertErrorTexts(page)).toEqual([])
        const { isBlockFormatSave } = await import('src/ts/storage/risuSave')
        expect(isBlockFormatSave(entry)).toBe(true)
        const decoded = await decodeEntry(entry, true)
        expect((decoded.characters as Row[]).map((character) => character.chaId)).toEqual([5])
        expect(decoded.upstreamKvBlocks).toEqual(restoredKv)
    })

    test('reproducer: a tree whose field is empty or undefined exports the same msgpack entry as a tree without the field', async () => {
        const { page, db: restored } = await restoredOnFreshPage(golden('upstream-kv.bin'))
        const { upstreamKvBlocks: _field, ...withoutField } = restored as unknown as Row

        async function exportedEntry(variant: Row): Promise<Uint8Array> {
            return databaseEntryOf(await exportOf(page, variant as unknown as Database))
        }
        const plain = await exportedEntry(withoutField)
        const emptyField = await exportedEntry({ ...withoutField, upstreamKvBlocks: {} })
        const undefinedField = await exportedEntry({ ...withoutField, upstreamKvBlocks: undefined })

        const { isBlockFormatSave } = await import('src/ts/storage/risuSave')
        expect(isBlockFormatSave(plain)).toBe(false)
        expect(Array.from(emptyField)).toEqual(Array.from(plain))
        expect(Array.from(undefinedField)).toEqual(Array.from(plain))
        expect('upstreamKvBlocks' in await decodeEntry(plain, false)).toBe(false)
    })
})

/**
 * HypaV3 presets across the `.bin` round trip. The container is hand-built in the test, upstream-shaped and synthetic
 * (not upstream writer output): the block framing is written out below and shares no code with a production writer, and
 * no golden file is read or changed. Upstream's block writer keeps every database key except `characters`,
 * `botPresets` and `modules` in the root block, so the preset list, the active index and the five engine fields sit
 * there, and its `setDatabase` writes presets back as `{name, settings}` without an id.
 *
 * Leg 1 (the commit keeps the fields) is a compatibility guard. `normalizeHypaV3Presets` is the function `setDatabase`
 * calls on every load, called here on the committed tree; the load itself is proven by
 * `databaseHypaV3Presets.test.ts`. The last leg models upstream's load: no upstream code runs.
 */
describe('HypaV3 presets through the upstream-shaped .bin round trip', () => {
    const framing = new TextEncoder()

    function u32(n: number): Uint8Array {
        const buf = new Uint8Array(4)
        new DataView(buf.buffer).setUint32(0, n, true)
        return buf
    }

    /** One block as upstream frames it: `[type u8][compression u8][nameLength u8][name][dataLength u32 LE][data]`; gzip has a zero header time. */
    function block(type: number, name: string, value: unknown, gzip: boolean): Uint8Array {
        const nameBuf = framing.encode(name)
        const raw = framing.encode(JSON.stringify(value))
        const data = gzip ? gzipSync(raw, { mtime: 0 }) : raw
        return concatBytes([Uint8Array.of(type, gzip ? 1 : 0, nameBuf.length), nameBuf, u32(data.length), data])
    }

    const TYPE = { config: 0, root: 1, preset: 4, modules: 5, character: 7, plugins: 9, loadouts: 10, pluginStorage: 11 } as const

    function presetOf(name: string, recent: number, similar: number) {
        return {
            name,
            settings: {
                summarizationModel: 'subModel',
                summarizationPrompt: `prompt of ${name}`,
                reSummarizationPrompt: '',
                memoryTokensRatio: 0.2,
                extraSummarizationRatio: 0,
                maxChatsPerSummary: 6,
                recentMemoryRatio: recent,
                similarMemoryRatio: similar,
                enableSimilarityCorrection: false,
                preserveOrphanedMemory: false,
                processRegexScript: false,
                doNotSummarizeUserMessage: false,
                summaryChunkSeparator: '\\n\\n',
                useExperimentalImpl: false,
                summarizationRequestsPerMinute: 20,
                summarizationMaxConcurrent: 1,
                embeddingRequestsPerMinute: 100,
                embeddingMaxConcurrent: 1,
                alwaysToggleOn: false,
                queryChatCount: 3,
            },
        }
    }

    const BUILT_PRESETS = [presetOf('Zeta', 0.4, 0.4), presetOf('Alpha', 0.4, 0.4), presetOf('Mid', 0.3, 0.5)]
    /** What the fork holds for the same presets: it adds its two recency settings on every load. */
    const RECENCY_DEFAULTS = { enableRecencyWeighting: false, recencyHalfLifeDays: 30 }
    const BUILT_PRESETS_FORK = BUILT_PRESETS.map((p) => ({ name: p.name, settings: { ...p.settings, ...RECENCY_DEFAULTS } }))

    /**
     * The 20 default settings of upstream's `createHypaV3Preset` (upstream/main 7be37f64f, hypav3.ts). Refresh this
     * model if upstream's defaults change.
     */
    const UPSTREAM_HYPAV3_DEFAULTS: Record<string, string | number | boolean> = {
        summarizationModel: 'subModel',
        summarizationPrompt: '',
        reSummarizationPrompt: '',
        memoryTokensRatio: 0.2,
        extraSummarizationRatio: 0,
        maxChatsPerSummary: 6,
        recentMemoryRatio: 0.4,
        similarMemoryRatio: 0.4,
        enableSimilarityCorrection: false,
        preserveOrphanedMemory: false,
        processRegexScript: false,
        doNotSummarizeUserMessage: false,
        summaryChunkSeparator: '\\n\\n',
        useExperimentalImpl: false,
        summarizationRequestsPerMinute: 20,
        summarizationMaxConcurrent: 1,
        embeddingRequestsPerMinute: 100,
        embeddingMaxConcurrent: 1,
        alwaysToggleOn: false,
        queryChatCount: 3,
    }

    /**
     * Models upstream's load of every preset (`setDatabase` calling `createHypaV3Preset`): start from the defaults, copy a
     * stored value only when its key is a default and the type matches, and keep `{name, settings}` with no id.
     */
    function upstreamLoad(presets: { name?: string, settings?: object }[]) {
        return presets.map((p, i) => {
            const settings = { ...UPSTREAM_HYPAV3_DEFAULTS }
            for (const [key, value] of Object.entries(p.settings || {})) {
                if (key in settings && typeof value === typeof settings[key]) {
                    settings[key] = value
                }
            }
            return { name: p.name || `Preset ${i + 1}`, settings }
        })
    }
    const BUILT_FIELDS = { hypav2: true, hanuraiEnable: false, hypaV3: false, supaModelType: 'subModel', memoryAlgorithmType: 'hypaMemoryV2' }
    const BUILT_ROOT = { ...BUILT_FIELDS, hypaV3Presets: BUILT_PRESETS, hypaV3PresetId: 2, characterOrder: [], personas: [] }

    function upstreamContainer(chatExtras: object = {}): Uint8Array {
        const blocks = [
            { type: TYPE.character, name: 'cha-inline', value: { type: 'character', chaId: 'cha-inline', name: 'Inline Alice', chatPage: 0, chats: [{ id: 'chat-1', message: [{ time: 1, data: 'hello', role: 'char' }], note: '', name: '', localLore: [], ...chatExtras }] } },
            { type: TYPE.preset, name: 'preset', value: [{ name: 'Golden Preset', id: 'preset-golden', temperature: 80, maxContext: 4000, maxResponse: 300 }] },
            { type: TYPE.modules, name: 'modules', value: [] },
            { type: TYPE.loadouts, name: 'loadouts', value: [] },
            { type: TYPE.plugins, name: 'plugins', value: [] },
            { type: TYPE.pluginStorage, name: 'pluginStorage', value: {} },
            { type: TYPE.config, name: 'config', value: { version: 1 } },
        ]
        const database = concatBytes([
            framing.encode('RISUSAVE\0'),
            ...blocks.map((b) => block(b.type, b.name, b.value, true)),
            block(TYPE.root, 'root', { ...BUILT_ROOT, __directory: blocks.map((b) => b.name) }, false),
        ])
        const nameBuf = framing.encode('database.risudat')
        return concatBytes([u32(nameBuf.length), nameBuf, u32(database.length), database])
    }

    type PresetRoot = Database & {
        hypav2: boolean, hanuraiEnable: boolean, hypaV3: boolean, supaModelType: string, memoryAlgorithmType: string,
        hypaV3Presets: { id?: string, name: string, settings: object }[], hypaV3PresetId: number,
    }

    function fieldsOf(root: PresetRoot) {
        return {
            hypav2: root.hypav2, hanuraiEnable: root.hanuraiEnable, hypaV3: root.hypaV3,
            supaModelType: root.supaModelType, memoryAlgorithmType: root.memoryAlgorithmType,
        }
    }

    function nameAndSettings(root: PresetRoot) {
        return root.hypaV3Presets.map((p) => ({ name: p.name, settings: p.settings }))
    }

    async function decodeStrict(entry: Uint8Array): Promise<PresetRoot> {
        const { decodeRisuSave } = await import('src/ts/storage/risuSave')
        return await decodeRisuSave(entry, { strict: true }) as unknown as PresetRoot
    }

    test('the commit keeps the five fields, the preset order, {name, settings} and the index; normalize, export and decode keep them and the ids', async () => {
        // Leg 1: the commit of the real LoadLocalBackup.
        const { page, db } = await restoredOnFreshPage(upstreamContainer())
        const root = db as PresetRoot
        expect(fieldsOf(root)).toEqual(BUILT_FIELDS)
        expect(root.hypaV3Presets).toEqual(BUILT_PRESETS)
        expect(root.hypaV3PresetId).toBe(2)

        // Leg 2: the function setDatabase calls on every load.
        normalizeHypaV3Presets(root as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        expect(nameAndSettings(root)).toEqual(BUILT_PRESETS_FORK)
        expect(root.hypaV3PresetId).toBe(2)
        const ids = root.hypaV3Presets.map((p) => p.id)
        expect(new Set(ids).size).toBe(3)
        for (const id of ids) {
            expect(typeof id).toBe('string')
            expect(id).not.toBe('')
        }

        // Leg 3: export through the real SaveLocalBackup, then decode.
        const decoded = await decodeStrict(databaseEntryOf(await exportOf(page, root)))
        expect(alertErrorTexts(page)).toEqual([])
        expect(fieldsOf(decoded)).toEqual(BUILT_FIELDS)
        expect(decoded.hypaV3Presets.map((p) => Object.keys(p).sort())).toEqual([['id', 'name', 'settings'], ['id', 'name', 'settings'], ['id', 'name', 'settings']])
        expect(nameAndSettings(decoded)).toEqual(BUILT_PRESETS_FORK)
        expect(decoded.hypaV3Presets.map((p) => p.id)).toEqual(ids)
        expect(decoded.hypaV3PresetId).toBe(2)

        // Leg 4: a second normalize keeps the ids.
        normalizeHypaV3Presets(decoded as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        expect(decoded.hypaV3Presets.map((p) => p.id)).toEqual(ids)

        // Modelled upstream leg: upstream's load turns the exported presets back into exactly the upstream-shaped ones.
        expect(Object.keys(UPSTREAM_HYPAV3_DEFAULTS).sort()).toEqual(Object.keys(presetOf('x', 0.4, 0.4).settings).sort())
        const upstreamLoaded = upstreamLoad(decoded.hypaV3Presets)
        expect(upstreamLoaded).toEqual(BUILT_PRESETS)
        expect(decoded.hypaV3PresetId).toBe(2)

        // Fork return: the fork mints the ids again and reads the two recency settings as off/30.
        const forkReturn = {
            hypaV3Presets: upstreamLoaded,
            hypaV3PresetId: decoded.hypaV3PresetId,
            hypaV3Settings: {},
            supaMemoryPrompt: '',
        }
        normalizeHypaV3Presets(forkReturn as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        const returned = forkReturn.hypaV3Presets as unknown as { id: string, name: string, settings: object }[]
        expect(returned.map((p) => ({ name: p.name, settings: p.settings }))).toEqual(BUILT_PRESETS_FORK)
        expect(forkReturn.hypaV3PresetId).toBe(2)
        expect(new Set(returned.map((p) => p.id)).size).toBe(3)
        for (const p of returned) {
            expect(typeof p.id).toBe('string')
            expect(p.id).not.toBe('')
        }
    })

    // compatibility guard: the summary time is opaque chat data, so it passes before and after
    test('B2: a summary time on a chat survives the commit, export and decode', async () => {
        const T = 1_763_424_000_000
        const summaries = [
            { text: 'legacy', chatMemos: ['m0'], isImportant: false, tags: [] },
            { text: 'dated', chatMemos: ['m1'], isImportant: false, tags: [], createdAt: T },
        ]
        const { page, db } = await restoredOnFreshPage(upstreamContainer({ hypaV3Data: { summaries } }))

        const decoded = await decodeStrict(databaseEntryOf(await exportOf(page, db)))

        expect(alertErrorTexts(page)).toEqual([])
        const chat = (decoded.characters[0] as unknown as { chats: Array<{ hypaV3Data: { summaries: object[] } }> }).chats[0]
        expect(chat.hypaV3Data.summaries).toEqual(summaries)
    })

    // regression reproducer: base normalize drops the two recency keys, so the option resets to off on load
    test('B3: a fork .bin keeps the recency settings through the commit, normalize, export and decode; upstream drops them', async () => {
        const forkPreset = {
            id: 'preset-fork',
            name: 'Fork',
            settings: { ...presetOf('Fork', 0.4, 0.4).settings, enableRecencyWeighting: true, recencyHalfLifeDays: 14 },
        }

        // B3-0: the fork .bin is written by the real exporter.
        const { page: first, db: firstDb } = await restoredOnFreshPage(upstreamContainer())
        const firstRoot = firstDb as PresetRoot
        firstRoot.hypaV3Presets = [forkPreset]
        firstRoot.hypaV3PresetId = 0
        const forkBin = await exportOf(first, firstRoot)
        expect(alertErrorTexts(first)).toEqual([])

        // B3-1: the commit of the fork .bin.
        const { page, db } = await restoredOnFreshPage(forkBin)
        const root = db as PresetRoot
        expect(root.hypaV3Presets).toEqual([forkPreset])

        // B3-2: the function setDatabase calls on every load.
        normalizeHypaV3Presets(root as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        const settingsOf = (value: PresetRoot) => value.hypaV3Presets[0].settings as { enableRecencyWeighting?: boolean, recencyHalfLifeDays?: number }
        expect(settingsOf(root).enableRecencyWeighting).toBe(true)
        expect(settingsOf(root).recencyHalfLifeDays).toBe(14)

        // B3-3: export and decode keep both keys.
        const decoded = await decodeStrict(databaseEntryOf(await exportOf(page, root)))
        expect(decoded.hypaV3Presets.map((p) => Object.keys(p).sort())).toEqual([['id', 'name', 'settings']])
        expect(settingsOf(decoded)).toEqual(forkPreset.settings)

        // B3-4: upstream's load drops the two keys and the id, and every other value is equal.
        const upstreamLoaded = upstreamLoad(decoded.hypaV3Presets)
        expect(upstreamLoaded).toEqual([{ name: 'Fork', settings: presetOf('Fork', 0.4, 0.4).settings }])

        // B3-5: fork return: the option is off again (fork -> upstream -> fork resets it).
        const forkReturn = { hypaV3Presets: upstreamLoaded, hypaV3PresetId: 0, hypaV3Settings: {}, supaMemoryPrompt: '' }
        normalizeHypaV3Presets(forkReturn as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        const returned = forkReturn.hypaV3Presets[0] as unknown as { settings: object }
        expect(returned.settings).toEqual({ ...presetOf('Fork', 0.4, 0.4).settings, ...RECENCY_DEFAULTS })

        // B3-6: the fixture equals what the fork's own preset constructor produces for the same input.
        expect(createHypaV3Preset('Fork', forkPreset.settings).settings).toEqual(forkPreset.settings)
    })
})

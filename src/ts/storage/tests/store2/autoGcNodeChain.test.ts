// @vitest-environment node
/**
 * The aged clean-up chain on a Node server, end to end: a `.bin` goes in through the app's own import path, real saves
 * make orphans between three maintenance steps a day apart (the real `server/node/server.cjs` restarted on the same
 * save directory, both clocks moved by the production 24 h rule with no `minAgeMs` override), and after the deleting
 * step every character and chat reads back through the app's read path and a full `.bin` exports with nothing missing.
 *
 * What is real: the server process, `createNodeHttpStore`, the boot dispatch with the production wiring of
 * `src/main.ts` (`loadBackupAtBoot` as the import), `commitStore2Import` for the page import, the encoder and committer
 * core of the save loop, `startStore2Maintenance` (old-data deletion, then the clean-up pass, then the asset sweep,
 * which ends before it reads the store, in the production order), the residency, `SaveLocalBackup`. Fork-format `blocks/` files sit on the store before
 * the first boot, so the boot import plants a deletion snapshot that the first step really deletes.
 *
 * What is a stand-in: the quiet trigger is a double the test fires; the clean-up facts name the test's own base because
 * the save loop is not run (each save is the loop's per-pass core: `encoder.plan`, `committer.commit`, `acknowledge`);
 * the deletion seam is a pass-through recorder around the real `runOldDataDeletion`; the file picker is a fake `input`
 * that hands the golden to the real `LoadLocalBackup`; the download sink and dialogs are replaced; the server clock
 * shift is the test-only preload `nodeServerClockShift.cjs`. One process stands in for several page loads: `pageLoad`
 * clears the module state a reload clears and boots again over a fresh byte store. The boot does not pass a
 * `markerOwnerProbe`: it is read only over a standing foreign marker, which never stands here. The export goes through
 * the page's own sink (`serverExportAvailable` is false); the server-streamed sink is covered by `backupStreamNode.test.ts`.
 *
 * The run is a development build, so the metered committer and clean-up backend and the `gcMarkMs` suffix of the result
 * line are in play; they are pass-through. Hydrating a stub (`restoreColdCharacter`, the module loader) writes nothing
 * under `store2/`.
 *
 * Labels: this file is a functional guard of the chain and a compatibility guard for the read and export clauses (they
 * hold trivially on a store that deletes nothing). Its effectiveness is shown by mutants that break one rule each: a
 * mark that drops a reference kind, an age rule that retires an unseen unit, and a swapped step order. It is not a
 * reproducer of a pre-fix failure. A pass says nothing about a browser, a proxy or the Tauri store.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, character } from 'src/ts/storage/database.svelte'

vi.hoisted(() => {
    const memory = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => { memory.set(key, String(value)) },
            removeItem: (key: string) => { memory.delete(key) },
            clear: () => memory.clear(),
            key: (index: number) => Array.from(memory.keys())[index] ?? null,
            get length() { return memory.size },
        },
    })
})

const h = vi.hoisted(() => ({
    permissive: (): Record<string, unknown> => new Proxy({} as Record<string, unknown>, {
        get: (_target, key) => (key === 'then' ? undefined : vi.fn()),
        has: () => true,
    }),
}))

/** What the download sink received, and whether the stream was closed. */
const sink = vi.hoisted(() => ({ writes: [] as Uint8Array[], closed: false }))
const alerts = vi.hoisted(() => ({ error: [] as string[] }))
/** The page's live database: `getDatabase()` and `DBState.db` both read it, and a boot replaces it. */
const dbBox = vi.hoisted(() => ({ db: { characters: [], personas: [], characterOrder: [], botPresets: [] } as Record<string, unknown> }))

//#region module mocks

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
    isTauri: false,
    isNodeServer: true,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: {
        get db() { return dbBox.db },
        set db(value: Record<string, unknown>) { dbBox.db = value },
    },
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

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((message: string) => { alerts.error.push(message) }),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/util')>()),
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => h.permissive())
vi.mock('@tauri-apps/api/path', () => h.permissive())
vi.mock('@tauri-apps/plugin-fs', () => h.permissive())
vi.mock('@tauri-apps/plugin-os', () => h.permissive())
vi.mock('@tauri-apps/plugin-shell', () => h.permissive())
vi.mock('@tauri-apps/plugin-http', () => h.permissive())
vi.mock('@tauri-apps/plugin-dialog', () => h.permissive())
vi.mock('@tauri-apps/plugin-process', () => h.permissive())
vi.mock('@tauri-apps/api/event', () => h.permissive())
vi.mock('@tauri-apps/api/webviewWindow', () => h.permissive())
vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => { sink.writes.push(chunk.slice()) },
                    close: async () => { sink.closed = true },
                    abort: async () => { },
                }),
            },
        }),
    },
}))

// The export goes through the page's own sink; the server-streamed sink is another test's subject.
vi.mock(import('src/ts/storage/nodeStorage'), async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/storage/nodeStorage')>(),
    serverExportAvailable: async () => false,
}))

// The real quiet trigger drags in the whole save loop; every step here fires its own.
vi.mock(import('src/ts/process/memory/putBackQuiet'), () => ({
    startQuietTrigger: () => { throw new Error('The real quiet trigger is not used in this test.') },
}) as unknown as typeof import('src/ts/process/memory/putBackQuiet'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { },
    isAppInitiatedReload: () => false,
}) as unknown as typeof import('src/ts/reloadGuard'))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))

//#endregion

import { SaveLocalBackup, loadBackupAtBoot } from 'src/ts/drive/backuplocal'
import { listBackupTimes } from 'src/ts/drive/backupList'
import { indexBackupEntries } from 'src/ts/drive/backupContainer'
import {
    checkStore2Import, commitStore2Import, createBinImportReader, readBinDatabaseOmitted, readBinDatabaseTree, scanBinForImport,
} from 'src/ts/drive/storeImport'
import { decodeRisuSave, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { getColdStorageBackupKey } from 'src/ts/process/coldstorageData'
import { HEAD_KEY, LEGACY_MAIN_FILE_KEY } from 'src/ts/storage/blockKeys'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { resetStartupCleanupForTests, getStartupCleanup } from 'src/ts/storage/startupCleanupState'
import { getAppStore, injectAppStore } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { resetStore2BootForTest, type Store2BootEnv, type Store2BootNotice } from 'src/ts/storage/store2/bootActive'
import { dispatchStore2Boot, type Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import { createNodeBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { unitDigest } from 'src/ts/storage/store2/codec'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { keyOfRef, parseStore2Key, readUnit, UNIT_TYPE, type CommitKey, type Manifest, type SweepRecord } from 'src/ts/storage/store2/format'
import type { AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import { GC_AGE_KEY, readUnitAgeRecord } from 'src/ts/storage/store2/gc/unitAge'
import type { FlaggedItem } from 'src/ts/storage/store2/leafFallback'
import { resetMaintenanceForTests, startStore2Maintenance } from 'src/ts/storage/store2/maintenance'
import { runOldDataDeletion, type OldDataDeletionResult } from 'src/ts/storage/store2/oldData/delete'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { getResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import type { SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import { SEEN_BEFORE } from 'src/ts/storage/store2/sweep/ageRecord'
import { createBackendClosureReader } from 'src/ts/storage/store2/sweep/backendReader'
import { buildClosureAssetKeepSet } from 'src/ts/storage/store2/sweep/keepSet'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import { loadModuleStubsOf } from 'src/ts/process/moduleLoader'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import type { BusyHandle } from 'src/ts/process/memory/busyActions'
import { createPeerDouble } from 'src/ts/storage/tests/store2SaveKit'
import { loadGolden, readerOver } from 'src/ts/storage/tests/store2/legacyFixtures'
import { injectRestoreStore } from 'src/ts/drive/tests/restoreSupport'
import { hexOfKey, startNodeServer, type NodeServerFixture } from '../nodeServerFixture'

vi.setConfig({ testTimeout: 240_000, hookTimeout: 60_000 })

// msgpackr 1.10.1 passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a string of 64 or more
// characters, which the Node running the tests rejects; the browser build has no `Buffer`, so production is unaffected.
// Clamping the length to the room left changes no byte written.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

const CLOCK_SHIFT_PRELOAD = fileURLToPath(new URL('../nodeServerClockShift.cjs', import.meta.url))
const SHIFT_ENV = 'RISU_TEST_SERVER_CLOCK_SHIFT_MS'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** The numbered backup's time: 13 digits, the shape `listBackupTimes` reads. */
const BACKUP_TIME = 1_700_000_000_000
const BACKUP_KEY = `database/dbbackup-${BACKUP_TIME}.bin`
const ASSET_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x47, 0x4f, 0x4c, 0x44])

type Obj = Record<string, unknown>

const realNow = Date.now.bind(Date)

//#region world

interface World {
    fixture: NodeServerFixture
    store: ByteStore
    backend: Store2Backend
    /** The manifest the page's own saves last acknowledged: the clean-up facts' own base. */
    ownBase: string | null
}

let world: World
/** The shift of the server clock and of the page clock; they always move together. */
let clockShift = 0
let infoLines: string[] = []
let errorCalls: unknown[][] = []

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
})

afterAll(() => {
    utf8WriterProto.utf8Write = nativeUtf8Write
})

beforeEach(() => {
    clockShift = 0
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockShift)
    infoLines = []
    errorCalls = []
    sink.writes.length = 0
    sink.closed = false
    alerts.error.length = 0
    dbBox.db = { characters: [], personas: [], characterOrder: [], botPresets: [] }
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => { infoLines.push(args.map(String).join(' ')) })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errorCalls.push(args) })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

/** Clears the module state a page reload clears. */
function resetPageGlobals(): void {
    resetResidencyForTest()
    resetStore2SaveForTest()
    resetPageStorageModeForTests()
    resetStore2BootForTest()
    resetMaintenanceForTests()
    resetStartupCleanupForTests()
}

afterEach(async () => {
    vi.unstubAllGlobals()
    resetPageGlobals()
    injectAppStore(null)
    vi.restoreAllMocks()
    await world?.fixture.stop()
})

async function goldenBytes(name: string): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await readFile(join(process.cwd(), 'src/ts/drive/tests/binGoldens', name)))
}

/** The page's cold-unit reader, loaded when a conversion first reads a unit, as `bootstrap.ts` does. */
async function readColdUnitForConversion(key: string) {
    const { readColdStorageItem } = await import('src/ts/process/coldstorage.svelte')
    return readColdStorageItem(key)
}

function bootEnv(store: ByteStore): Store2BootEnv {
    return { store, upstreamMainFile: () => store.has(LEGACY_MAIN_FILE_KEY), listBackupTimes, readColdStorageItem: readColdUnitForConversion }
}

interface RecordedUi {
    ui: Store2BootUi
    offered: (readonly number[])[]
    flaggedAsked: (readonly FlaggedItem[])[]
    blockedWith: string[]
    notices: Store2BootNotice[]
}

/** The boot's questions, answered as the person importing a backup answers them; every one is recorded. */
function recordingUi(): RecordedUi {
    const recorded: RecordedUi = {
        offered: [], flaggedAsked: [], blockedWith: [], notices: [],
        ui: {
            notice: (notice) => { recorded.notices.push(notice) },
            blocked: async (blocked) => { recorded.blockedWith.push(blocked.reason) },
            offerRestoreOrImport: async (backups) => {
                recorded.offered.push(backups)
                return 'import'
            },
            confirmConvert: async () => false,
            declined: async () => 'import',
            confirmConvertWithout: async () => 'decline',
            confirmFromBackup: async () => 'decline',
            confirmIncomplete: async () => false,
            confirmFlaggedOpen: async (items) => {
                recorded.flaggedAsked.push(items)
                return 'decline'
            },
            foreignMarker: async () => 'wait',
            recovery: async () => { },
            peer: createPeerDouble(),
        },
    }
    return recorded
}

interface PickerInput {
    type: string
    accept: string
    files: File[]
    onchange: (() => Promise<void>) | null
    remove(): void
    addEventListener(): void
    click(): void
}

/** Runs `run` while `document.createElement('input')` answers a picker that hands `file` to the real restore flow. */
async function withPicker<T>(file: File, run: () => Promise<T>): Promise<T> {
    const input: PickerInput = {
        type: '', accept: '', files: [file], onchange: null,
        remove: () => { },
        addEventListener: () => { },
        click: () => { setTimeout(() => { void input.onchange?.() }, 0) },
    }
    vi.stubGlobal('document', {
        createElement: (tag: string) => {
            if (tag !== 'input') {
                throw new Error(`The restore flow created a ${tag} element.`)
            }
            return input
        },
    })
    try {
        return await run()
    } finally {
        vi.unstubAllGlobals()
    }
}

function newStore(): ByteStore {
    return createNodeHttpStore({ baseUrl: world.fixture.baseUrl, authHeader: () => world.fixture.authHeader() })
}

interface Booted {
    database: Obj
    ui: RecordedUi
    ownBase: string
}

function ownBaseOfActiveSave(): string {
    const encoder = getActiveStore2Save()?.encoder
    expect(encoder).toBeDefined()
    if (encoder === undefined) {
        throw new Error('The boot activated no encoder.')
    }
    return encoder.manifestKey
}

/** A page reload: the page state is cleared, the byte store is built afresh and the boot runs over what the server holds. */
async function pageLoad(): Promise<Booted> {
    resetPageGlobals()
    world.store = newStore()
    world.backend = createNodeBackend(world.store)
    injectRestoreStore(world.store, 'node')
    const ui = recordingUi()
    const result = await dispatchStore2Boot(bootEnv(world.store), { ui: ui.ui, importBackup: (target) => loadBackupAtBoot(target) })
    expect(result.kind).toBe('store2')
    if (result.kind !== 'store2') {
        throw new Error(`The boot came to ${result.kind}.`)
    }
    dbBox.db = result.database as unknown as Obj
    world.ownBase = ownBaseOfActiveSave()
    expect(ui.flaggedAsked).toEqual([])
    expect(ui.blockedWith).toEqual([])
    return { database: dbBox.db, ui, ownBase: world.ownBase }
}

/** The server restarted with both clocks moved to `shift`; the page clock follows with no request in between. */
async function restartAt(shift: number): Promise<void> {
    const before = await world.store.read(GC_AGE_KEY)
    const fileBefore = await readFile(join(world.fixture.saveDir, hexOfKey(GC_AGE_KEY)))
    const recordBefore = await readUnitAgeRecord(world.store)
    await world.fixture.restart({ env: { [SHIFT_ENV]: String(shift) } })
    clockShift = shift

    // The age record is read back from the new process unchanged.
    expect(world.fixture.output().split('HTTP server is running').length - 1).toBe(1)
    const fileAfter = await readFile(join(world.fixture.saveDir, hexOfKey(GC_AGE_KEY)))
    expect(Buffer.compare(fileAfter, fileBefore)).toBe(0)
    const after = await world.store.read(GC_AGE_KEY)
    expect(after.version).toBe(before.version)
    expect(Buffer.compare(Buffer.from(after.bytes ?? new Uint8Array()), Buffer.from(before.bytes ?? new Uint8Array()))).toBe(0)
    expect(await readUnitAgeRecord(world.store)).toEqual(recordBefore)

    // Both clocks stand at the shift: the server's by its own answer, the page's by the spy.
    const guarded = world.store.guarded
    if (guarded?.serverNow === undefined) {
        throw new Error('The store has no server clock.')
    }
    expect(Math.abs(await guarded.serverNow() - (realNow() + shift))).toBeLessThan(MINUTE)
    expect(Math.abs(Date.now() - realNow() - shift)).toBeLessThan(MINUTE)
}

//#endregion

//#region edits and commits

const INLINE = 'cha-inline'
const STUB = 'cha-stub'
const EDIT_TIME = 1_800_000_000_000

function characterOf(db: Obj, chaId: string): Obj {
    const found = (db.characters as Obj[]).find((slot) => slot.chaId === chaId)
    if (found === undefined) {
        throw new Error(`The database holds no ${chaId}.`)
    }
    return found
}

function chatsOf(db: Obj): Obj[] {
    return characterOf(db, INLINE).chats as Obj[]
}

function messagesOf(chat: Obj): Obj[] {
    return chat.message as Obj[]
}

function lorebookOf(db: Obj): Obj[] {
    const holder = (db.modules as Obj[]).find((slot) => Array.isArray(slot.lorebook) && slot.lorebook.length > 0)
    if (holder === undefined) {
        throw new Error('The database holds no module with a lorebook entry.')
    }
    return holder.lorebook as Obj[]
}

function userMessage(data: string, time: number): Obj {
    return { role: 'user', data, time }
}

/** Each edit changes one thing the store keeps in its own unit, so the unit it replaces becomes an orphan. */
const EDITS = {
    E1: (db: Obj) => { messagesOf(chatsOf(db)[0]).push(userMessage('E1 appended message', EDIT_TIME + 1)) },
    E2: (db: Obj) => { characterOf(db, INLINE).desc = 'E2 description' },
    E3a: (db: Obj) => { chatsOf(db).push({ id: 'e3a-chat', message: [userMessage('E3a chat message', EDIT_TIME + 3)], note: '', name: 'E3a chat', localLore: [] }) },
    E3b: (db: Obj) => {
        const chats = chatsOf(db)
        const at = chats.findIndex((chat) => chat.id === 'e3a-chat')
        if (at < 0) {
            throw new Error('The E3a chat is gone.')
        }
        chats.splice(at, 1)
    },
    E4: (db: Obj) => { lorebookOf(db)[0].content = 'E4 lorebook text' },
    E4b: (db: Obj) => { lorebookOf(db)[0].content = 'E4b lorebook text' },
    E5: (db: Obj) => { db.mainPrompt = 'E5 main prompt' },
    E6: (db: Obj) => { messagesOf(chatsOf(db)[0]).push(userMessage('E6 appended message', EDIT_TIME + 6)) },
    E6b: (db: Obj) => {
        const messages = messagesOf(chatsOf(db)[0])
        messages[messages.length - 1].data = 'E6b changed message'
    },
    E7: (db: Obj) => { characterOf(db, INLINE).desc = 'E7 description' },
    E8: (db: Obj) => { lorebookOf(db)[0].content = 'E8 lorebook text' },
    E8b: (db: Obj) => { lorebookOf(db)[0].content = 'E8b lorebook text' },
}

/** The edits in the order the chain makes them, for the expected database. */
function applyAllEdits(db: Obj): void {
    for (const edit of Object.values(EDITS)) {
        edit(db)
    }
}

const MARK_INLINE: SavePassRequest = { marked: new Set([INLINE]), modules: false, whole: false }
const MARK_MODULES: SavePassRequest = { marked: new Set(), modules: true, whole: false }
const MARK_NOTHING: SavePassRequest = { marked: new Set(), modules: false, whole: false }

/** Brings the archived character and every module stub in, as the person's first edit would. Writes nothing under `store2/`. */
async function hydrate(): Promise<void> {
    const stub = (dbBox.db.characters as Obj[]).find((slot) => slot.chaId === INLINE)
    if (stub === undefined || !stub.coldstorage) {
        throw new Error('The archived character is not a stub on this page load.')
    }
    const outcome = await restoreColdCharacter(stub as unknown as character, { quiet: true })
    expect(outcome.status).toBe('restored')
    expect(characterOf(dbBox.db, INLINE).coldstorage).toBeFalsy()
    for (const slot of (dbBox.db.modules as Obj[])) {
        if (isModuleStub(slot)) {
            expect((await loadModuleStubsOf(String(slot.id))).kind).toBe('loaded')
        }
    }
    expect((dbBox.db.modules as Obj[]).some((slot) => isModuleStub(slot))).toBe(false)
}

async function readCommitKey(): Promise<CommitKey> {
    const parsed = classifyCommitRead(await world.backend.readCommit())
    if (parsed.status !== 'parsed') {
        throw new Error(`The commit key is ${parsed.status}.`)
    }
    return parsed.value
}

function currentOf(key: CommitKey): string {
    if (key.current === null) {
        throw new Error('The commit key names no current manifest.')
    }
    return key.current.key
}

/** `{current} ∪ retained ∪ pins`: every manifest a commit key keeps. */
function manifestNamesOf(key: CommitKey): Set<string> {
    return new Set([...(key.current === null ? [] : [key.current.key]), ...key.retained.map((entry) => entry.key), ...key.pins.map((entry) => entry.key)])
}

async function listing(): Promise<Set<string>> {
    return new Set(await world.backend.listStore2())
}

async function readManifest(key: string): Promise<Manifest> {
    const bytes = (await world.backend.readUnits([key])).get(key)
    if (bytes === null || bytes === undefined) {
        throw new Error(`The manifest ${key} is not stored.`)
    }
    const unit = readUnit(bytes, UNIT_TYPE.manifest)
    if (unit.status !== 'ok') {
        throw new Error(`The manifest ${key} reads as ${unit.status}.`)
    }
    return unit.value.body as Manifest
}

/** A window is the run of saves between two maintenance steps. */
interface SaveWindow {
    /** The manifest that was current when the window opened. */
    start: string
    before: Set<string>
    /** The current manifest of each of the window's commits, in order. */
    commits: string[]
}

async function openWindow(): Promise<SaveWindow> {
    return { start: currentOf(await readCommitKey()), before: await listing(), commits: [] }
}

/** One save of the loop's per-pass core: plan, commit over a fresh commit-key read, acknowledge. */
async function edit(window: SaveWindow, change: (db: Obj) => void, request: SavePassRequest): Promise<void> {
    change(dbBox.db)
    const context = getActiveStore2Save()
    const committer = context?.session.committer
    if (context?.encoder === undefined || committer === null || committer === undefined) {
        throw new Error('The page has no save context.')
    }
    const plan = await context.encoder.plan(dbBox.db as unknown as Database, request)
    expect(plan.unchanged).toBe(false)
    const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') {
        throw new Error(`The save came to ${result.status}.`)
    }
    plan.acknowledge()
    const key = currentOf(result.value)
    world.ownBase = key
    window.commits.push(key)
}

interface ClosedWindow {
    /** The manifests the window dropped from the commit key: not in its final `current`, `retained` or `pins`. */
    dropped: Set<string>
    /** The keys the window added to the listing. */
    added: Set<string>
    after: Set<string>
    final: CommitKey
}

/**
 * Closes the window and proves from the commit results and the commit key alone (no collector code) that its saves left
 * orphans: at least `minDrops` manifests the final key does not name, each still stored.
 */
async function closeWindow(window: SaveWindow, minDrops: number): Promise<ClosedWindow> {
    const final = await readCommitKey()
    const after = await listing()
    const names = manifestNamesOf(final)
    const dropped = new Set([window.start, ...window.commits].filter((key) => !names.has(key)))
    expect(dropped.size).toBeGreaterThanOrEqual(minDrops)
    for (const key of dropped) {
        expect(after.has(key)).toBe(true)
    }
    return { dropped, added: new Set([...after].filter((key) => !window.before.has(key))), after, final }
}

function expectSubset(label: string, subset: ReadonlySet<string>, superset: ReadonlySet<string>): void {
    expect([...subset].filter((key) => !superset.has(key)), label).toEqual([])
}

//#endregion

//#region the maintenance step

interface DeletionCall {
    paced: boolean
    result: OldDataDeletionResult
}

interface GcLine {
    deleted: number
    batches: number
    stopped: string | undefined
    phase: 'young' | 'recorded' | 'swept'
    candidates: number
    recordedItems: number
    record: string
    conflict: string | undefined
    clockGap: number
}

const GC_LINE = /^store2 clean-up: status=done deleted=(\d+) batches=(\d+)(?: stopped=(\S+))? phase=(young|recorded|swept) candidates=(\d+) recorded-items=(\d+) record=(none|written|conflict|unknown)(?: conflict=(\S+))? clock-gap=(-?\d+)(?: gcMarkMs=\S+)?$/

function parseGcLine(line: string): GcLine {
    const match = GC_LINE.exec(line)
    if (match === null) {
        throw new Error(`The clean-up line is not an aged result: ${line}`)
    }
    return {
        deleted: Number(match[1]), batches: Number(match[2]), stopped: match[3], phase: match[4] as GcLine['phase'],
        candidates: Number(match[5]), recordedItems: Number(match[6]), record: match[7], conflict: match[8], clockGap: Number(match[9]),
    }
}

interface StepResult {
    deletions: DeletionCall[]
    gc: GcLine
}

/**
 * One page load's maintenance step through the real `startStore2Maintenance`: the old-data deletion, then the clean-up
 * pass, then the asset sweep, which ends before it reads the store. The trigger is a double the test fires, the deletion is a pass-through recorder, and
 * the clean-up facts name the test's own base.
 */
async function runStep(): Promise<StepResult> {
    const deletions: DeletionCall[] = []
    const facts: AutoGcFacts = {
        isBusy: () => false,
        saveLoopParked: () => false,
        isSaveClean: () => true,
        restoreInProgress: () => false,
        peers: async () => 'unsupported',
        ownBase: () => world.ownBase,
    }
    const fake: { fire: (() => void) | null } = { fire: null }
    const trigger = startStore2Maintenance(
        { store: getAppStore, listBackupTimes },
        {
            startTrigger: (run) => {
                fake.fire = run
                return { arm: () => { }, stop: () => { } }
            },
            deletion: async (session, deps) => {
                const result = await runOldDataDeletion(session, deps)
                deletions.push({ paced: deps.pace !== undefined, result })
                return result
            },
            gcPageFacts: facts,
        },
    )
    expect(trigger).not.toBeNull()
    infoLines.length = 0
    errorCalls.length = 0
    if (fake.fire === null) {
        throw new Error('No trigger was started.')
    }
    fake.fire()
    await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
    await getStartupCleanup()
    // The step logs and swallows each deleter's failure; none may have failed.
    expect(errorCalls).toEqual([])
    const lines = infoLines.filter((line) => line.startsWith('store2 clean-up:'))
    expect(lines).toHaveLength(1)
    return { deletions, gc: parseGcLine(lines[0]) }
}

interface AgeRecord {
    value: SweepRecord
    version: number
}

async function readRecord(): Promise<AgeRecord> {
    const read = await readUnitAgeRecord(world.store)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok') {
        throw new Error(`The age record reads as ${read.status}.`)
    }
    return { value: read.value, version: read.version }
}

function namesIn(record: AgeRecord): Set<string> {
    return new Set(record.value.items.map((item) => item[0]))
}

function seenBeforeIn(record: AgeRecord): Set<string> {
    return new Set(record.value.items.filter((item) => item[2] === SEEN_BEFORE).map((item) => item[0]))
}

function unmarkedIn(record: AgeRecord): Set<string> {
    return new Set(record.value.items.filter((item) => item[2] !== SEEN_BEFORE).map((item) => item[0]))
}

//#endregion

//#region imports and exports

/** The page import of `file`: the same steps as the Settings restore's page branch, over the real streamed commit. */
async function pageImport(file: File): Promise<{ landed: boolean, verdicts: string[] }> {
    const checked = await checkStore2Import()
    expect(checked.kind).toBe('ready')
    if (checked.kind !== 'ready') {
        throw new Error(`The import check refused: ${checked.cause}.`)
    }
    const walk = await indexBackupEntries(file)
    expect(walk.hasMarker).toBe(false)
    expect(walk.truncatedTail).toBe(false)
    const scan = scanBinForImport(walk.entries, walk.names)
    if (scan.database === null) {
        throw new Error('The golden holds no database entry.')
    }
    const database = scan.database
    const omitted = await readBinDatabaseOmitted(file, database)
    expect(omitted.size).toBe(0)
    const verdicts: string[] = []
    // `minUnits: 1` takes the streamed path production takes for any import over `BULK_UNIT_THRESHOLD` units: the goldens are small.
    const end = await commitStore2Import({
        target: checked.target,
        busy: {} as BusyHandle,
        decode: () => readBinDatabaseTree(file, database, omitted),
        stream: { file, entry: database, omitted, minUnits: 1, onPrepared: (verdict: string) => { verdicts.push(verdict) } },
        reader: createBinImportReader(file, scan.index),
    })
    return { landed: end.kind === 'landed', verdicts }
}

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

const RESOLVE_OPTIONS = { newId: () => 'placeholder-chat', now: () => 1 }

interface Exported {
    names: string[]
    /** The exported database with every pointer and stub resolved against the file's own units. */
    database: Obj
    assets: Map<string, Uint8Array>
}

/** A full `.bin` through the real `SaveLocalBackup` into the page's sink, decoded by the legacy decoder. */
async function exportBackup(): Promise<Exported> {
    sink.writes.length = 0
    sink.closed = false
    alerts.error.length = 0
    const outcome = await SaveLocalBackup({ mode: 'inline' })
    expect(outcome.status).toBe('saved')
    expect(sink.closed).toBe(true)
    expect(alerts.error).toEqual([])
    const entries = parseEntries(Buffer.concat(sink.writes))
    const database = entries.find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error('The export wrote no database entry.')
    }
    const raw = await decodeRisuSave(database.data) as unknown as Database
    const units = new Map<string, { status: 'ok', value: unknown }>()
    for (const entry of entries) {
        const key = getColdStorageBackupKey(entry.name)
        if (key !== null) {
            units.set(key, { status: 'ok', value: JSON.parse(new TextDecoder().decode(entry.data)) })
        }
    }
    const resolved = await resolveLegacyTree(raw, readerOver(units), RESOLVE_OPTIONS)
    return {
        names: entries.map((entry) => entry.name),
        database: structuredClone(resolved.database) as unknown as Obj,
        assets: new Map(entries.filter((entry) => entry.name !== 'database.risudat' && getColdStorageBackupKey(entry.name) === null).map((entry) => [entry.name, entry.data])),
    }
}

/** Top-level fields a file may lack, which the store2 tree always holds with the database default. */
const TREE_DEFAULTS: Obj = { pluginCustomStorage: {}, archiveCharacters: true, loadouts: [], pluginV2: [], plugins: [] }

/**
 * The logical content of a file after a store2 page re-exports it: the recorded differences are the tree defaults, the
 * chat id the importer mints for a chat the file gave none, and the time it stamps on a message the file gave none.
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
            if (chat.id === undefined || chat.id === 'placeholder-chat') {
                chat.id = typeof exportedChat?.id === 'string' && exportedChat.id !== '' && exportedChat.id !== 'placeholder-chat' ? exportedChat.id : 'a minted chat id'
            }
            ;((chat.message ?? []) as Obj[]).forEach((message, messageIndex) => {
                const exportedTime = ((exportedChat?.message ?? []) as Obj[])[messageIndex]?.time
                if (message.time === 1) {
                    message.time = typeof exportedTime === 'number' && exportedTime > 1 ? exportedTime : 'a stamped message time'
                }
            })
        })
    })
    return expected
}

interface ChatView {
    id: unknown
    messages: { data: unknown, role: unknown, time: unknown }[]
}

function chatViewOf(character: Obj): ChatView[] {
    return (character.chats as Obj[]).map((chat) => ({
        id: chat.id,
        messages: messagesOf(chat).map((message) => ({ data: message.data, role: message.role, time: message.time })),
    }))
}

function messageTexts(chats: ChatView[]): unknown[] {
    return chats.flatMap((chat) => chat.messages.map((message) => message.data))
}

//#endregion

//#region the chain

interface Planted {
    blockKeys: string[]
}

/**
 * Fork-format block files the boot import finds on the store. Only their keys matter: the old-data plan lists `blocks/`
 * and snapshots every key it finds, and no current reader opens their bytes.
 */
const FORK_BLOCK_KEYS: readonly string[] = [HEAD_KEY, 'blocks/000000000001-aaaaaaaa/root', 'blocks/000000000001-aaaaaaaa/preset']

/** The server at shift 0 with the preload, the page's store, the fork-format block files and a numbered backup. */
async function plantWorld(pageFile: string): Promise<Planted> {
    const fixture = await startNodeServer({ nodeArgs: ['--require', CLOCK_SHIFT_PRELOAD], env: { [SHIFT_ENV]: '0' } })
    const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
    world = { fixture, store, backend: createNodeBackend(store), ownBase: null }
    injectRestoreStore(store, 'node')
    // The boot import plans a deletion snapshot from these keys; the first pass deletes them.
    for (const key of FORK_BLOCK_KEYS) {
        await store.write(key, new Uint8Array([1]), 'unconditional')
    }
    const blockKeys = await store.list('blocks/')
    expect([...blockKeys].sort()).toEqual([...FORK_BLOCK_KEYS].sort())
    const golden = await loadGolden(pageFile)
    await store.write(BACKUP_KEY, encodeRisuSaveLegacy(golden.tree, 'compression'), 'unconditional')
    return { blockKeys }
}

describe.each([
    ['upstream-full.bin', 'fork-full.bin'],
    ['fork-full.bin', 'upstream-full.bin'],
])('the Node aged clean-up chain: boot import of %s, page import of %s', (bootFile, pageFile) => {
    test('three passes a day apart delete the orphans and every character and chat still reads and exports', async () => {
        const planted = await plantWorld(pageFile)

        // PL0: the first-life boot imports bootFile through the real file flow, then the page imports pageFile.
        const first = await withPicker(new File([await goldenBytes(bootFile)], bootFile), () => pageLoad())
        expect(first.ui.offered).toHaveLength(1)
        const bootManifest = first.ownBase
        const imported = await pageImport(new File([await goldenBytes(pageFile)], pageFile))
        expect(imported.landed).toBe(true)
        expect(imported.verdicts).toEqual(['stream'])

        // PL1: the reload after the import (the boot's normal row).
        const pl1 = await pageLoad()
        expect(pl1.ui.offered).toEqual([])
        const keyAtPl1 = await readCommitKey()
        expect(keyAtPl1.staging).toBeNull()
        expect(keyAtPl1.retained[0]?.key).toBe(bootManifest)
        expect(keyAtPl1.snapshot).toBeDefined()
        const pointer = keyAtPl1.snapshot
        if (pointer === undefined) {
            throw new Error('The import wrote no deletion snapshot.')
        }
        expect(pointer.count).toBe(planted.blockKeys.length)
        const snapshotBytes = (await world.backend.readUnits([pointer.key])).get(pointer.key)
        expect(snapshotBytes).toBeDefined()
        expect(snapshotBytes === null || snapshotBytes === undefined ? null : unitDigest(snapshotBytes)).toBe(pointer.digest)
        const manifestAtPl1 = await readManifest(currentOf(keyAtPl1))
        expect(manifestAtPl1.fixed.legacyKeep?.files).toEqual(expect.arrayContaining([{ key: BACKUP_KEY, status: 'unreadable' }]))
        expect(manifestAtPl1.shards.some((ref) => parseStore2Key(keyOfRef(ref))?.shape === 'staged-unit')).toBe(true)
        expect((pl1.database.characters as Obj[]).filter((slot) => slot.coldstorage).map((slot) => slot.chaId).sort()).toEqual([INLINE, STUB])

        // W0 (shift 0): three saves inside one admission interval drop three manifests.
        await hydrate()
        const w0 = await openWindow()
        await edit(w0, EDITS.E1, MARK_INLINE)
        await edit(w0, EDITS.E2, MARK_INLINE)
        await edit(w0, EDITS.E3a, MARK_INLINE)
        const c0 = await closeWindow(w0, 3)
        expect((await readCommitKey()).snapshot).toEqual(pointer)

        // Step 1: the deletion completes, then the pass records.
        const step1 = await runStep()
        expect(step1.deletions).toHaveLength(1)
        expect(step1.deletions[0].paced).toBe(true)
        expect(step1.deletions[0].result).toMatchObject({ status: 'completed', deleted: pointer.count, abandoned: 0 })
        expect(await world.store.list('blocks/')).toEqual([])
        expect(await world.store.has(BACKUP_KEY)).toBe(true)
        const keyAfter1 = await readCommitKey()
        expect(keyAfter1.snapshot).toBeUndefined()
        expect(currentOf(keyAfter1)).toBe(world.ownBase)
        expect(step1.gc).toMatchObject({ deleted: 0, phase: 'recorded', record: 'written' })
        expect(step1.gc.stopped).toBeUndefined()
        expect(step1.gc.candidates).toBeGreaterThan(0)
        expect(Math.abs(step1.gc.clockGap)).toBeLessThan(MINUTE)
        const r1 = await readRecord()
        expect(seenBeforeIn(r1).size).toBe(0)
        expectSubset('R1 names D0', c0.dropped, namesIn(r1))
        expectSubset('R1 names the snapshot unit', new Set([pointer.key]), namesIn(r1))

        // R1: restart 10 minutes short of a day; window 1a and the young control.
        await restartAt(DAY - 10 * MINUTE)
        await pageLoad()
        await hydrate()
        const w1a = await openWindow()
        await edit(w1a, EDITS.E3b, MARK_INLINE)
        await edit(w1a, EDITS.E4, MARK_MODULES)
        await edit(w1a, EDITS.E4b, MARK_MODULES)
        const c1a = await closeWindow(w1a, 1)
        const recordBeforeY = await world.store.read(GC_AGE_KEY)
        const stepY = await runStep()
        expect(stepY.deletions.map((call) => call.result)).toEqual([{ status: 'no-pointer' }])
        expect(stepY.gc).toMatchObject({ deleted: 0, batches: 0, phase: 'young', candidates: 0, recordedItems: 0, record: 'none' })
        const recordAfterY = await world.store.read(GC_AGE_KEY)
        expect(recordAfterY.version).toBe(recordBeforeY.version)
        expect(Buffer.compare(Buffer.from(recordAfterY.bytes ?? new Uint8Array()), Buffer.from(recordBeforeY.bytes ?? new Uint8Array()))).toBe(0)
        expect(await listing()).toEqual(c1a.after)

        // R2: a day and ten minutes; window 1b and pass 2 marks.
        await restartAt(DAY + 10 * MINUTE)
        await pageLoad()
        await hydrate()
        const w1b = await openWindow()
        await edit(w1b, EDITS.E5, MARK_NOTHING)
        await edit(w1b, EDITS.E6, MARK_INLINE)
        await edit(w1b, EDITS.E6b, MARK_INLINE)
        const c1b = await closeWindow(w1b, 1)
        const step2 = await runStep()
        expect(step2.deletions.map((call) => call.result)).toEqual([{ status: 'no-pointer' }])
        expect(step2.gc).toMatchObject({ deleted: 0, phase: 'swept', record: 'written' })
        expect(Math.abs(step2.gc.clockGap)).toBeLessThan(MINUTE)
        const r2 = await readRecord()
        expectSubset('R2 marks only what R1 named', seenBeforeIn(r2), namesIn(r1))
        expectSubset('R2 marks D0', c0.dropped, seenBeforeIn(r2))
        expectSubset('R2 marks the snapshot unit', new Set([pointer.key]), seenBeforeIn(r2))

        // A5': the orphans of windows 1a and 1b were first seen at pass 2.
        const u1 = unmarkedIn(r2)
        expectSubset('U1 names the 1a drops', c1a.dropped, u1)
        expectSubset('U1 names the 1b drops', c1b.dropped, u1)
        expectSubset('U1 was written in window 1', u1, new Set([...c1a.added, ...c1b.added]))
        expect([...u1].filter((key) => namesIn(r1).has(key))).toEqual([])
        expect([...u1].some((key) => { const shape = parseStore2Key(key)?.shape; return shape === 'unit' || shape === 'staged-unit' })).toBe(true)

        // R3: two days and twenty minutes; window 2, a cold page load, the export before the delete, then pass 3.
        await restartAt(2 * DAY + 20 * MINUTE)
        await pageLoad()
        await hydrate()
        const w2 = await openWindow()
        await edit(w2, EDITS.E7, MARK_INLINE)
        await edit(w2, EDITS.E8, MARK_MODULES)
        await edit(w2, EDITS.E8b, MARK_MODULES)
        const c2 = await closeWindow(w2, 1)
        await pageLoad()
        const exportedBefore = await exportBackup()
        const l0 = await listing()
        const step3 = await runStep()
        const l1 = await listing()
        expect(step3.deletions.map((call) => call.result)).toEqual([{ status: 'no-pointer' }])
        const r3 = await readRecord()

        // A6': the late orphans survive the deleting pass.
        expectSubset('U1 survives pass 3', u1, l1)
        expectSubset('D2 survives pass 3', c2.dropped, l1)
        expectSubset('U1 is marked in R3', u1, seenBeforeIn(r3))
        expectSubset('D2 is unmarked in R3', c2.dropped, unmarkedIn(r3))
        expectSubset('R3 unmarked came from window 2', unmarkedIn(r3), c2.added)

        // A6: step 3 swept exactly what R2 had marked.
        expect(step3.gc).toMatchObject({ phase: 'swept', record: 'written' })
        expect(step3.gc.deleted).toBeGreaterThan(0)
        expect(step3.gc.stopped).toBeUndefined()
        expect(Math.abs(step3.gc.clockGap)).toBeLessThan(MINUTE)
        const removed = new Set([...l0].filter((key) => !l1.has(key)))
        expect(removed.size).toBe(step3.gc.deleted)
        expectSubset('removed keys were marked in R2', removed, seenBeforeIn(r2))
        expectSubset('D0 and the snapshot unit are retired', new Set([...c0.dropped, pointer.key]), removed)

        // R4: a restart on the same clocks, then the read after the delete.
        await restartAt(2 * DAY + 20 * MINUTE)
        const pl5 = await pageLoad()
        const stubs = (pl5.database.characters as Obj[]).filter((slot) => slot.coldstorage)
        expect(stubs.map((slot) => slot.chaId).sort()).toEqual([INLINE, STUB])
        const residency = getResidency()
        if (residency === null) {
            throw new Error('The boot registered no residency.')
        }
        const resolvedAfter = new Map<string, Obj>()
        for (const stub of stubs) {
            const read = await residency.readCharacter(String(stub.coldstorage))
            expect(read.status).toBe('ok')
            if (read.status === 'ok') {
                expect(read.droppedAlt).toEqual([])
                resolvedAfter.set(String(stub.chaId), read.value.character)
            }
        }
        for (const character of exportedBefore.database.characters as Obj[]) {
            const after = resolvedAfter.get(String(character.chaId))
            expect(after, String(character.chaId)).toBeDefined()
            if (after !== undefined) {
                expect(chatViewOf(after), String(character.chaId)).toEqual(chatViewOf(character))
            }
        }
        const inline = resolvedAfter.get(INLINE)
        const stubbed = resolvedAfter.get(STUB)
        expect(inline).toBeDefined()
        expect(stubbed).toBeDefined()
        if (inline !== undefined && stubbed !== undefined) {
            const inlineChats = chatViewOf(inline)
            expect(inline.desc).toBe('E7 description')
            expect(messageTexts(inlineChats)).toContain('E1 appended message')
            expect(messageTexts(inlineChats)).toContain('E6b changed message')
            expect(messageTexts(inlineChats)).not.toContain('E6 appended message')
            expect(inlineChats.map((chat) => chat.id)).not.toContain('e3a-chat')
            expect(messageTexts(chatViewOf(stubbed))).toEqual(['blob hello', 'archived blob chat'])
        }
        expect(pl5.database.mainPrompt).toBe('E5 main prompt')
        for (const slot of (pl5.database.modules as Obj[])) {
            if (isModuleStub(slot)) {
                expect((await loadModuleStubsOf(String(slot.id))).kind).toBe('loaded')
            }
        }
        expect(lorebookOf(pl5.database)[0].content).toBe('E8b lorebook text')

        // A8: the closure and every tree read whole.
        const finalKey = await readCommitKey()
        const closure = await buildClosureAssetKeepSet({ commitKey: finalKey, reader: createBackendClosureReader(world.backend) })
        if (closure.status === 'incomplete') {
            for (const reason of closure.reasons) {
                expect(['node-missing', 'node-crc-failed', 'node-damaged']).not.toContain(reason.code)
                expect(reason.code).toBe('legacy-file-unreadable')
                expect(reason.detail).toContain(BACKUP_KEY)
            }
        }
        expect(await world.store.has(BACKUP_KEY)).toBe(true)
        for (const key of manifestNamesOf(finalKey)) {
            const read = await readTreeBytes(world.backend, key)
            expect(read.status, key).toBe('ok')
            if (read.status === 'ok') {
                expect(read.flagged, key).toEqual([])
            }
        }

        // A9: the export after the delete is whole and equals what the edits made.
        const exportedAfter = await exportBackup()
        expect(exportedAfter.database).toEqual(exportedBefore.database)
        expect(exportedAfter.names).toEqual(exportedBefore.names)
        expect([...exportedAfter.assets.keys()]).toEqual(['golden-avatar.png'])
        expect(Uint8Array.from(exportedAfter.assets.get('golden-avatar.png') ?? [])).toEqual(ASSET_BYTES)
        expect([...exportedBefore.assets.keys()]).toEqual(['golden-avatar.png'])
        const golden = await loadGolden(pageFile)
        const original = await resolveLegacyTree(golden.tree, readerOver(golden.units), RESOLVE_OPTIONS)
        const edited = structuredClone(original.database) as unknown as Obj
        applyAllEdits(edited)
        expect(exportedAfter.database).toEqual(afterTrip(edited, exportedAfter.database))
    })
})

//#endregion


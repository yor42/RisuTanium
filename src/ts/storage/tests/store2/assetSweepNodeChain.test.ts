// @vitest-environment node
/**
 * The Node asset sweep, end to end: an upstream Node profile is converted in place, a `.bin` goes in through the real
 * `LoadLocalBackup()`, real saves make asset orphans between three sweep passes a day apart (the real
 * `server/node/server.cjs` restarted on the same save directory, both clocks moved by the production 24 h rule with no
 * `minAgeMs` override), and after the deleting pass every character and chat reads back through the app's read path, a full
 * `.bin` exports with every referenced asset present, and the sweep deleted something.
 *
 * Why the profile is converted instead of boot-imported: a boot import lists every old upstream file `unreadable`, so the
 * closure keep-set is incomplete and the sweep refuses `keep-incomplete` for good. Only the in-place conversion lists the
 * old files `ok` with their references, so only it leaves a profile the asset sweep can ever delete from.
 *
 * What is real: the server process, `createNodeHttpStore`, the boot dispatch (row 1 conversion over `database/database.bin`
 * and a numbered backup written by `encodeRisuSaveLegacy`), `LoadLocalBackup()` with its asset copy and `commitStore2Import`,
 * `saveAsset`, the encoder and committer core of the save loop, `startStore2Maintenance` (old-data deletion, the aged unit
 * pass, then the asset sweep, in the production order), the residency, `SaveLocalBackup`, and `getUncleanablesSync` as the
 * resident reference set.
 *
 * What is a stand-in: the quiet trigger is a double the test fires; the clean-up facts name the test's own base because the
 * save loop is not run (each save is the loop's per-pass core: `encoder.plan`, `committer.commit`, `acknowledge`); the sweep
 * facts are `peers: 'alone'` (the sole-tab proof of a localhost page) and `shouldStop: false` (no save loop), with the
 * written-set counts taken past a baseline set at each page load, because the set is module-global and only a reload clears
 * it; the deletion seam is a pass-through recorder; the file picker is a fake `input` that hands the golden to the real
 * restore, whose save-first wait and reload are replaced (no loop runs and no page reloads) and whose write lock is a
 * no-op (the restore holds it forever, in a page that is then reloaded); the unsaved-edits question is answered by the
 * mocked confirm; the download sink and dialogs are replaced; the server clock shift is the test-only preload
 * `nodeServerClockShift.cjs`. One process stands in for several page loads: `pageLoad` clears the module state a reload
 * clears and boots again over a fresh byte store. The export goes through the page's own sink.
 *
 * Expected sets. `E1 = {O_up, X0} ∪ G` is what the deleting pass removes: the upstream leftover and the asset an admitted
 * edit referenced and a later edit removed (`G` is any orphan the conversion or the golden import leaves; it is empty).
 * `O_t` is not in `E1`: it is marked at step 2, its revision moves before step 3, so step 3 records it unmarked again and
 * deletes nothing of it. `U1 = {X1, X2}` is first seen at step 2 and so is still listed after step 3.
 *
 * Labels: this file is a functional guard of the sweep's age rule and a compatibility guard for the keep, read and export
 * clauses (they hold trivially on a store that deletes nothing). Its effectiveness is shown by mutants that break one rule
 * each: a keep-set sink that drops a reference class, an age rule that retires an unseen asset, a record that is not honoured.
 * It is not a reproducer of a pre-fix failure. A pass says nothing about a browser, a proxy or the Tauri store.
 */
import { createHash } from 'node:crypto'
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

// No save loop runs here, so the restore's wait for the loop's next commit could only run out its bound.
vi.mock(import('src/ts/drive/storeRestore'), async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/drive/storeRestore')>(),
    saveFirst: async () => { },
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

import { SaveLocalBackup, LoadLocalBackup, loadBackupAtBoot } from 'src/ts/drive/backuplocal'
import { listBackupTimes } from 'src/ts/drive/backupList'
import {
    assetsWrittenThisPageCount, dbWriteLock, getUncleanablesSync, listAssetsWrittenThisPage, releaseAssetObjectUrl, saveAsset,
} from 'src/ts/globalApi.svelte'
import { decodeRisuSave, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { getColdStorageBackupKey } from 'src/ts/process/coldstorageData'
import { LEGACY_MAIN_FILE_KEY } from 'src/ts/storage/blockKeys'
import { holdAssetDeletion } from 'src/ts/storage/assetDeleteHold'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { resetStartupCleanupForTests, getStartupCleanup } from 'src/ts/storage/startupCleanupState'
import { ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { getAppStore, injectAppStore } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { resetStore2BootForTest, type Store2BootEnv, type Store2BootNotice } from 'src/ts/storage/store2/bootActive'
import { dispatchStore2Boot, type Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import { createNodeBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { parseStore2Key, readUnit, SWEEP_KEY, UNIT_TYPE, type CommitKey, type Manifest, type SweepRecord } from 'src/ts/storage/store2/format'
import type { AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import { GC_AGE_KEY, readUnitAgeRecord } from 'src/ts/storage/store2/gc/unitAge'
import type { FlaggedItem } from 'src/ts/storage/store2/leafFallback'
import { resetMaintenanceForTests, startStore2Maintenance, type SweepPageFacts } from 'src/ts/storage/store2/maintenance'
import { runOldDataDeletion, type OldDataDeletionResult } from 'src/ts/storage/store2/oldData/delete'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { getResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import type { SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import { SEEN_BEFORE } from 'src/ts/storage/store2/sweep/ageRecord'
import { AssetKeySet } from 'src/ts/storage/store2/sweep/assetKey'
import { createBackendClosureReader } from 'src/ts/storage/store2/sweep/backendReader'
import { buildClosureAssetKeepSet } from 'src/ts/storage/store2/sweep/keepSet'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import { loadModuleStubsOf } from 'src/ts/process/moduleLoader'
import { writeAppInlay, type InlayAsset } from 'src/ts/process/files/inlayStore'
import { isModuleStub } from 'src/ts/storage/moduleStub'
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
/** The clock shift of each restart, in minutes past the plant. Each is chosen against the admission and age tables below. */
const SHIFT_R0 = 10 * MINUTE
const SHIFT_R1 = DAY - 10 * MINUTE
const SHIFT_R2 = DAY + 20 * MINUTE
const SHIFT_R3 = 2 * DAY + 40 * MINUTE
/** The numbered backup's time: 13 digits, the shape `listBackupTimes` reads. */
const BACKUP_TIME = 1_700_000_000_000
const BACKUP_KEY = `database/dbbackup-${BACKUP_TIME}.bin`
const GOLDEN_AVATAR_KEY = 'assets/golden-avatar.png'
const ASSET_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x47, 0x4f, 0x4c, 0x44])

type Obj = Record<string, unknown>

const realNow = Date.now.bind(Date)

//#region assets

/**
 * Every asset the chain stores, by role. Each has its own bytes and is saved once, except `O_t`, which W2 saves again.
 * - Keep witnesses held only through a keep-set class, never resident on a step page (NR): `K_cold` (a character list),
 *   `K_lit` (a literal name, in a character list), `K_mod` (a module list), `K_ret` (a retained manifest only), `K_bak` (the
 *   legacy list only: a numbered backup names it), `K_cfgL` (a loadout icon, in the config list only).
 * - Keep witnesses held by residency (RH): `K_gold` (a stub keeps its `image`), `K_cfg` (`userIcon`).
 * - `A_main`: named by the converted main file, so by the legacy list and a retained manifest.
 * - Orphans: `O_up` (an upstream leftover), `O_t` (an upstream leftover W2 touches), `X0`-`X3` (referenced by a manifest
 *   an edit made and a later edit dropped).
 */
type Witness =
    | 'A_main' | 'K_bak' | 'O_up' | 'O_t' | 'K_cold' | 'K_lit' | 'K_mod' | 'K_cfg' | 'K_cfgL' | 'K_ret'
    | 'X0' | 'X1' | 'X2' | 'X3' | 'K_gold'

const SEED: Record<Exclude<Witness, 'K_gold'>, number> = {
    A_main: 1, K_bak: 2, O_up: 3, O_t: 4, K_cold: 5, K_lit: 6, K_mod: 7, K_cfg: 8, K_cfgL: 9, K_ret: 10,
    X0: 11, X1: 12, X2: 13, X3: 14,
}

const NR: readonly Witness[] = ['K_cold', 'K_lit', 'K_mod', 'K_ret', 'K_bak', 'K_cfgL']
const RH: readonly Witness[] = ['K_gold', 'K_cfg']
const KW: readonly Witness[] = [...NR, ...RH, 'A_main']

/** Distinct synthetic bytes per witness. */
function bytesOf(witness: Exclude<Witness, 'K_gold'>): Uint8Array<ArrayBuffer> {
    const seed = SEED[witness]
    const bytes = new Uint8Array(16 + (seed % 7))
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    for (let at = 8; at < bytes.length; at++) {
        bytes[at] = (seed * 37 + at * 11) & 0xff
    }
    bytes[8] = seed
    return bytes
}

function expectedBytes(witness: Witness): Uint8Array {
    return witness === 'K_gold' ? ASSET_BYTES : bytesOf(witness)
}

/** The store key of each witness, filled as the chain creates it. */
let keys: Partial<Record<Witness, string>> = {}

function keyOf(witness: Witness): string {
    const key = keys[witness]
    if (key === undefined) {
        throw new Error(`The witness ${witness} has no key yet.`)
    }
    return key
}

function nameOf(witness: Witness): string {
    return keyOf(witness).slice('assets/'.length)
}

function sortedNames(witnesses: readonly Witness[]): string[] {
    return witnesses.map(nameOf).sort()
}

function sorted(values: Iterable<string>): string[] {
    return [...values].sort()
}

//#endregion

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
/** The size of the module-global written set when this page load began: a reload clears the set, this baseline emulates it. */
let writtenBase = 0
let infoLines: string[] = []
let errorCalls: unknown[][] = []
let reloads = 0

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
    keys = {}
    reloads = 0
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
    convertAsked: number
}

/** The boot's questions, answered as the person converting an upstream profile answers them; every one is recorded. */
function recordingUi(): RecordedUi {
    const recorded: RecordedUi = {
        offered: [], flaggedAsked: [], blockedWith: [], notices: [], convertAsked: 0,
        ui: {
            notice: (notice) => { recorded.notices.push(notice) },
            blocked: async (blocked) => { recorded.blockedWith.push(blocked.reason) },
            offerRestoreOrImport: async (backups) => {
                recorded.offered.push(backups)
                return 'import'
            },
            confirmConvert: async () => {
                recorded.convertAsked++
                return true
            },
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

/**
 * Runs `run` while `document.createElement('input')` answers a picker that hands `file` to the real restore flow, and the
 * reload the restore ends with has a `history` and a `location` to call.
 */
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
    vi.stubGlobal('history', { replaceState: () => { } })
    vi.stubGlobal('location', { pathname: '/', hash: '', reload: () => { reloads++ } })
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
    writtenBase = assetsWrittenThisPageCount()
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

/** The store's `assets/` keys with the revision each is at. */
async function assetVersions(): Promise<Map<string, number | null>> {
    const versions = new Map<string, number | null>()
    for (const key of await world.store.list('assets/')) {
        versions.set(key, (await world.store.read(key)).version)
    }
    return versions
}

interface RecordSnapshot {
    file: Buffer
    version: number | null
    bytes: Buffer
}

async function snapshotOf(key: string): Promise<RecordSnapshot> {
    const read = await world.store.read(key)
    return {
        file: await readFile(join(world.fixture.saveDir, hexOfKey(key))),
        version: read.version,
        bytes: Buffer.from(read.bytes ?? new Uint8Array()),
    }
}

function expectSameSnapshot(label: string, after: RecordSnapshot, before: RecordSnapshot): void {
    expect(Buffer.compare(after.file, before.file), `${label} file`).toBe(0)
    expect(after.version, `${label} version`).toBe(before.version)
    expect(Buffer.compare(after.bytes, before.bytes), `${label} bytes`).toBe(0)
}

/**
 * The server restarted with both clocks moved to `shift`; the page clock follows with no request in between. Both age
 * records (the unit pass's and the sweep's) and every asset's revision are read back from the new process unchanged. With
 * `records: false` (before any pass ran) neither record exists before or after.
 */
async function restartAt(shift: number, options: { records: boolean }): Promise<void> {
    const assetsBefore = await assetVersions()
    const gcBefore = options.records ? await snapshotOf(GC_AGE_KEY) : null
    const sweepBefore = options.records ? await snapshotOf(SWEEP_KEY) : null
    const gcRecordBefore = options.records ? await readUnitAgeRecord(world.store) : null
    const sweepRecordBefore = options.records ? await readUnitAgeRecord(world.store, SWEEP_KEY) : null
    if (!options.records) {
        expect(await world.store.has(GC_AGE_KEY)).toBe(false)
        expect(await world.store.has(SWEEP_KEY)).toBe(false)
    }
    await world.fixture.restart({ env: { [SHIFT_ENV]: String(shift) } })
    clockShift = shift

    expect(world.fixture.output().split('HTTP server is running').length - 1).toBe(1)
    if (gcBefore !== null && sweepBefore !== null) {
        expectSameSnapshot('the unit age record', await snapshotOf(GC_AGE_KEY), gcBefore)
        expectSameSnapshot('the sweep record', await snapshotOf(SWEEP_KEY), sweepBefore)
        expect(await readUnitAgeRecord(world.store)).toEqual(gcRecordBefore)
        expect(await readUnitAgeRecord(world.store, SWEEP_KEY)).toEqual(sweepRecordBefore)
    } else {
        expect(await world.store.has(GC_AGE_KEY)).toBe(false)
        expect(await world.store.has(SWEEP_KEY)).toBe(false)
    }
    // Every asset keeps its revision across the restart: the sweep's deletes carry the revision a record named.
    expect(await assetVersions()).toEqual(assetsBefore)

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
const MODULE_ID = 'm-asset'

function characterOf(db: Obj, chaId: string): Obj {
    const found = (db.characters as Obj[]).find((slot) => slot.chaId === chaId)
    if (found === undefined) {
        throw new Error(`The database holds no ${chaId}.`)
    }
    return found
}

function chatsOf(db: Obj, chaId: string = INLINE): Obj[] {
    return characterOf(db, chaId).chats as Obj[]
}

function messagesOf(chat: Obj): Obj[] {
    return chat.message as Obj[]
}

function rowsOf(character: Obj): unknown[] {
    const rows = (character.additionalAssets ?? []) as unknown[]
    character.additionalAssets = rows
    return rows
}

/** Each edit changes one thing the store keeps in its own unit or list, so the unit it replaces becomes an orphan. */
const EDITS = {
    /** The orphan-to-be `X0` is referenced by an admitted manifest and then removed. */
    addRow: (chaId: string, label: string, witness: Witness) => (db: Obj) => { rowsOf(characterOf(db, chaId)).push([label, keyOf(witness)]) },
    removeRow: (chaId: string, label: string) => (db: Obj) => {
        const character = characterOf(db, chaId)
        character.additionalAssets = rowsOf(character).filter((row) => !(Array.isArray(row) && row[0] === label))
    },
    desc: (text: string) => (db: Obj) => { characterOf(db, INLINE).desc = text },
    mainPrompt: (text: string) => (db: Obj) => { db.mainPrompt = text },
    userIcon: (db: Obj) => { db.userIcon = keyOf('K_cfg') },
    loadoutIcon: (db: Obj) => {
        db.loadouts = [{
            name: 'asset loadout', id: 'loadout-asset', lastUsed: 0, favorite: false, characterIds: [], modules: [],
            globalVariables: {}, presetName: '', personaId: '', icons: [keyOf('K_cfgL')],
        }]
    },
    assetModule: (db: Obj) => {
        (db.modules as Obj[]).push({
            id: MODULE_ID, name: 'Asset Module', description: 'holds one asset', lorebook: [], regex: [], trigger: [],
            assets: [['k-mod', keyOf('K_mod'), 'png']],
        })
    },
}

const MARK_INLINE: SavePassRequest = { marked: new Set([INLINE]), modules: false, whole: false }
const MARK_STUB: SavePassRequest = { marked: new Set([STUB]), modules: false, whole: false }
const MARK_MODULES: SavePassRequest = { marked: new Set(), modules: true, whole: false }
const MARK_NOTHING: SavePassRequest = { marked: new Set(), modules: false, whole: false }

/** Brings the archived characters and every module stub in, as the person's first edit would. Writes nothing under `store2/`. */
async function hydrate(options: { stub: boolean }): Promise<void> {
    for (const chaId of options.stub ? [INLINE, STUB] : [INLINE]) {
        const slot = (dbBox.db.characters as Obj[]).find((candidate) => candidate.chaId === chaId)
        if (slot === undefined || !slot.coldstorage) {
            throw new Error(`The archived character ${chaId} is not a stub on this page load.`)
        }
        const outcome = await restoreColdCharacter(slot as unknown as character, { quiet: true })
        expect(outcome.status).toBe('restored')
        expect(characterOf(dbBox.db, chaId).coldstorage).toBeFalsy()
    }
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

async function assetListing(): Promise<Set<string>> {
    return new Set(await world.store.list('assets/'))
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
    /** The current manifest of each of the window's commits, in order. */
    commits: string[]
}

async function openWindow(): Promise<SaveWindow> {
    return { start: currentOf(await readCommitKey()), commits: [] }
}

/** One save of the loop's per-pass core: plan, commit over a fresh commit-key read, acknowledge. Returns the commit's manifest. */
async function edit(window: SaveWindow, change: (db: Obj) => void, request: SavePassRequest): Promise<string> {
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
    return key
}

/**
 * Closes the window and proves from the commit results and the commit key alone (no collector code) that its saves left
 * orphans: at least `minDrops` manifests the final key does not name, each still stored. Returns the dropped set.
 */
async function closeWindow(window: SaveWindow, minDrops: number): Promise<Set<string>> {
    const final = await readCommitKey()
    const after = await listing()
    const names = manifestNamesOf(final)
    const dropped = new Set([window.start, ...window.commits].filter((key) => !names.has(key)))
    expect(dropped.size).toBeGreaterThanOrEqual(minDrops)
    for (const key of dropped) {
        expect(after.has(key)).toBe(true)
    }
    return dropped
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
    record: string
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
        candidates: Number(match[5]), record: match[7], clockGap: Number(match[9]),
    }
}

interface SweepLine {
    phase: 'young' | 'recorded' | 'swept'
    candidates: number
    deleted: number
    failed: number
    keptLive: number
    batches: number
    recorded: boolean
    stopped: string | undefined
}

/** Matches `formatSweepResult` exactly for a finished pass: a refusal or a skip does not match and fails the test. */
const SWEEP_LINE = /^store2 asset sweep: status=done phase=(young|recorded|swept) candidates=(\d+) deleted=(\d+) failed=(\d+) kept-live=(\d+) batches=(\d+) recorded=(true|false)(?: stopped=(\S+))?$/

function parseSweepLine(line: string): SweepLine {
    const match = SWEEP_LINE.exec(line)
    if (match === null) {
        throw new Error(`The asset sweep line is not a finished result: ${line}`)
    }
    return {
        phase: match[1] as SweepLine['phase'], candidates: Number(match[2]), deleted: Number(match[3]), failed: Number(match[4]),
        keptLive: Number(match[5]), batches: Number(match[6]), recorded: match[7] === 'true', stopped: match[8],
    }
}

interface StepResult {
    deletions: DeletionCall[]
    gc: GcLine
    sweep: SweepLine
}

/** The page's own facts for the sweep, except the two stand-ins named in the header. */
function sweepFacts(): SweepPageFacts {
    return {
        residentRefs: () => getUncleanablesSync(dbBox.db as unknown as Database),
        writtenCount: () => assetsWrittenThisPageCount() - writtenBase,
        writtenThisPage: () => listAssetsWrittenThisPage().slice(writtenBase),
        peers: async () => 'alone',
        shouldStop: () => false,
        release: (removed) => releaseAssetObjectUrl(removed),
        hold: (remove) => holdAssetDeletion(remove),
    }
}

/**
 * One page load's maintenance step through the real `startStore2Maintenance`: the old-data deletion, then the clean-up
 * pass, then the asset sweep. The trigger is a double the test fires, the deletion is a pass-through recorder, and the
 * clean-up facts name the test's own base.
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
            sweepFacts: sweepFacts(),
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
    const gcLines = infoLines.filter((line) => line.startsWith('store2 clean-up:'))
    const sweepLines = infoLines.filter((line) => line.startsWith('store2 asset sweep:'))
    expect(gcLines).toHaveLength(1)
    expect(sweepLines).toHaveLength(1)
    return { deletions, gc: parseGcLine(gcLines[0]), sweep: parseSweepLine(sweepLines[0]) }
}

interface AgeRecord {
    value: SweepRecord
    version: number
}

/** The sweep record decoded here, independently of the sweep's own reader. */
async function readSweepRecord(): Promise<AgeRecord> {
    const read = await world.store.read(SWEEP_KEY)
    expect(read.bytes).not.toBeNull()
    if (read.bytes === null || read.version === null) {
        throw new Error('The sweep record is not stored.')
    }
    const unit = readUnit(read.bytes, UNIT_TYPE.sweepRecord)
    expect(unit.status).toBe('ok')
    if (unit.status !== 'ok') {
        throw new Error(`The sweep record reads as ${unit.status}.`)
    }
    return { value: unit.value.body as SweepRecord, version: read.version }
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

function revisionIn(record: AgeRecord, name: string): number | null | undefined {
    return record.value.items.find((item) => item[0] === name)?.[1]
}

function residentSet(): AssetKeySet {
    const resident = new AssetKeySet()
    for (const name of getUncleanablesSync(dbBox.db as unknown as Database)) {
        resident.addName(name)
    }
    return resident
}

/**
 * The exposure precondition, on a step page before the step runs: every killer witness is stored, non-resident (RH:
 * resident) and at the same revision on each of the step pages, and the retained manifest `Ca` that alone holds `K_ret` is
 * retained. A world mistake fails here on correct code instead of making a mutant's kill vacuous.
 */
async function exposure(label: string, ca: string, revisions: Map<string, number | null>): Promise<void> {
    const key = await readCommitKey()
    expect(key.retained.map((entry) => entry.key), `${label}: Ca is retained`).toContain(ca)
    expect(currentOf(key), `${label}: Ca is not current`).not.toBe(ca)
    expect((dbBox.db.characters as Obj[]).every((slot) => Boolean(slot.coldstorage)), `${label}: every character is a stub`).toBe(true)
    expect((dbBox.db.modules as Obj[]).every((slot) => isModuleStub(slot)), `${label}: every module is a stub`).toBe(true)
    const resident = residentSet()
    for (const witness of NR) {
        expect(resident.holds(keyOf(witness)), `${label}: ${witness} is not resident`).toBe(false)
    }
    for (const witness of RH) {
        expect(resident.holds(keyOf(witness)), `${label}: ${witness} is resident`).toBe(true)
    }
    expect(assetsWrittenThisPageCount() - writtenBase, `${label}: this page wrote no asset`).toBe(0)
    for (const witness of NR) {
        const read = await world.store.read(keyOf(witness))
        expect(read.bytes, `${label}: ${witness} is stored`).not.toBeNull()
        const known = revisions.get(witness)
        if (known === undefined) {
            revisions.set(witness, read.version)
        } else {
            expect(read.version, `${label}: ${witness} keeps its revision`).toBe(known)
        }
    }
}

//#endregion

//#region imports and exports

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

//#endregion

//#region the chain

function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

function plainChat(id: string, text: string): Obj {
    return { id, message: [{ time: 1_700_000_000_000, data: text, role: 'char' }], note: '', name: '', localLore: [] }
}

/** An upstream-shaped database: what an upstream build's save loop wrote for a profile with one character. */
function upstreamDatabase(chaId: string, name: string, extra: Obj): Obj {
    return {
        characters: [{ chaId, name, type: 'character', chatPage: 0, ...extra, chats: [plainChat(`${chaId}-chat`, `${name} says hello`)] }],
        personas: [],
        characterOrder: [],
        modules: [],
        botPresets: [{ name: 'Upstream Preset', id: 'preset-upstream', temperature: 80, maxContext: 4000, maxResponse: 300 }],
    }
}

/**
 * The server at shift 0 with the preload, the page's store, and an upstream Node profile as an upstream build leaves it:
 * `database/database.bin` and a numbered backup written by the legacy encoder, and assets stored under their hash (the
 * upstream route for an asset write). The backup alone names `K_bak`; the main file names `A_main`; `O_up` and `O_t` are
 * named by nothing.
 */
async function plantUpstreamProfile(): Promise<void> {
    const fixture = await startNodeServer({ nodeArgs: ['--require', CLOCK_SHIFT_PRELOAD], env: { [SHIFT_ENV]: '0' } })
    const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
    world = { fixture, store, backend: createNodeBackend(store), ownBase: null }
    injectRestoreStore(store, 'node')
    for (const witness of ['A_main', 'K_bak', 'O_up', 'O_t'] as const) {
        const bytes = bytesOf(witness)
        const key = `assets/${sha256Hex(bytes)}.png`
        await store.write(key, bytes, 'unconditional')
        keys[witness] = key
    }
    const main = upstreamDatabase('up-main', 'Upstream Main', { image: keyOf('A_main') })
    const backup = upstreamDatabase('up-bak', 'Upstream Backup', { additionalAssets: [['bak', keyOf('K_bak')]] })
    await store.write(LEGACY_MAIN_FILE_KEY, encodeRisuSaveLegacy(main, 'compression'), 'unconditional')
    await store.write(BACKUP_KEY, encodeRisuSaveLegacy(backup, 'compression'), 'unconditional')
}

/** Saves `witness` through the app's `saveAsset`, as an edit's picker would; `customId` names a literal. */
async function saveWitness(witness: Exclude<Witness, 'K_gold'>, customId: string = ''): Promise<string> {
    const key = await saveAsset(bytesOf(witness), customId)
    keys[witness] = key
    return key
}

describe.each(['upstream-full.bin', 'fork-full.bin'])('the Node asset sweep chain: converted upstream profile, page import of %s', (pageFile) => {
    test('three passes a day apart delete the orphans and keep every witness, and every character and chat still reads and exports', async () => {
        await plantUpstreamProfile()
        keys.K_gold = GOLDEN_AVATAR_KEY

        // PL0: the boot converts the upstream profile in place, then the real `LoadLocalBackup()` imports the golden.
        const first = await pageLoad()
        expect(first.ui.convertAsked).toBe(1)
        expect(first.ui.offered).toEqual([])
        const convManifest = first.ownBase
        vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
        const imported = await withPicker(new File([await goldenBytes(pageFile)], pageFile), () => LoadLocalBackup())
        expect(imported.outcome).toBe('committed')
        expect(imported.detail.assets?.written).toBe(1)
        expect(imported.detail.assets?.skipped).toEqual([])
        expect(reloads).toBe(1)
        expect(errorCalls).toEqual([])
        expect(await world.store.has(GOLDEN_AVATAR_KEY)).toBe(true)

        // PL1: the reload after the import (the boot's normal row).
        const pl1 = await pageLoad()
        expect(pl1.ui.offered).toEqual([])
        expect(pl1.ui.convertAsked).toBe(0)
        const keyAtPl1 = await readCommitKey()
        expect(keyAtPl1.staging).toBeNull()
        expect(keyAtPl1.retained.map((entry) => entry.key)).toEqual([convManifest])
        expect((pl1.database.characters as Obj[]).filter((slot) => slot.coldstorage).map((slot) => slot.chaId).sort()).toEqual([INLINE, STUB])

        // C1: the conversion's old files are listed readable, the import carried them, and the closure is complete.
        const manifestAtPl1 = await readManifest(currentOf(keyAtPl1))
        expect(manifestAtPl1.fixed.legacyKeep?.files).toEqual([
            { key: LEGACY_MAIN_FILE_KEY, status: 'ok' },
            { key: BACKUP_KEY, status: 'ok' },
        ])
        const closureAtPl1 = await buildClosureAssetKeepSet({ commitKey: keyAtPl1, reader: createBackendClosureReader(world.backend) })
        expect(closureAtPl1.status).toBe('complete')
        if (closureAtPl1.status === 'complete') {
            // Soft: a keep-set drop must still reach the final C8 clause that owns it.
            expect.soft(closureAtPl1.keep.holds(keyOf('A_main'))).toBe(true)
            expect.soft(closureAtPl1.keep.holds(keyOf('K_bak'))).toBe(true)
            expect.soft(closureAtPl1.keep.holds(keyOf('K_gold'))).toBe(true)
            expect(closureAtPl1.keep.holds(keyOf('O_up'))).toBe(false)
            expect(closureAtPl1.keep.holds(keyOf('O_t'))).toBe(false)
        }

        // W0 (shift 0, everything inside one admission interval, so nothing is admitted): every keep witness is formed.
        await hydrate({ stub: true })
        await saveWitness('K_cold')
        await saveWitness('K_lit', 'k-lit-witness')
        await saveWitness('K_mod')
        await saveWitness('K_cfg')
        await saveWitness('K_cfgL')
        await saveWitness('X0')
        const inlayBytes = Uint8Array.from([7, 7, 7, 7, 9, 9, 9, 9, 1, 2, 3])
        const inlay: InlayAsset = { data: new Blob([inlayBytes], { type: 'video/mp4' }), ext: 'mp4', name: 'clip.mp4', type: 'video' }
        await writeAppInlay(world.store, 'sweep-inlay', inlay)
        const inlayKeys = await world.store.list('inlays/')
        expect(inlayKeys.length).toBeGreaterThan(0)
        const inlayBefore = new Map<string, Uint8Array>()
        for (const key of inlayKeys) {
            inlayBefore.set(key, (await world.store.read(key)).bytes ?? new Uint8Array())
        }
        const w0 = await openWindow()
        await edit(w0, EDITS.addRow(STUB, 'cold', 'K_cold'), MARK_STUB)
        await edit(w0, EDITS.addRow(STUB, 'lit', 'K_lit'), MARK_STUB)
        await edit(w0, EDITS.assetModule, MARK_MODULES)
        await edit(w0, EDITS.userIcon, MARK_NOTHING)
        await edit(w0, EDITS.loadoutIcon, MARK_NOTHING)
        const x0a = await edit(w0, EDITS.addRow(INLINE, 'x0', 'X0'), MARK_INLINE)
        await edit(w0, EDITS.removeRow(INLINE, 'x0'), MARK_INLINE)
        const w0f = await edit(w0, EDITS.desc('W0 description'), MARK_INLINE)
        const dropped0 = await closeWindow(w0, 3)
        // P-A1: the orphan-forming manifest of W0 was dropped, and the W0 window admitted nothing.
        expect(dropped0.has(x0a)).toBe(true)
        expect((await readCommitKey()).retained.map((entry) => entry.key)).toEqual([convManifest])

        // R0: ten minutes on, no record exists yet. W0r makes `K_ret` retained-only before pass 1: Ca names it, Cb removes
        // it, and Cb's commit admits Ca. The edits write no `risutanium_asset_retained` key.
        await restartAt(SHIFT_R0, { records: false })
        await pageLoad()
        await hydrate({ stub: false })
        const w0r = await openWindow()
        await saveWitness('K_ret')
        const ca = await edit(w0r, EDITS.addRow(INLINE, 'ret', 'K_ret'), MARK_INLINE)
        const cb = await edit(w0r, EDITS.removeRow(INLINE, 'ret'), MARK_INLINE)
        const afterW0r = await readCommitKey()
        expect(currentOf(afterW0r)).toBe(cb)
        expect(afterW0r.retained.map((entry) => entry.key)).toEqual(expect.arrayContaining([ca, w0f]))
        expect(Reflect.get(characterOf(dbBox.db, INLINE), ASSET_RETAINED_KEY)).toBeUndefined()
        const storeKeysBeforeStep1 = await assetListing()
        for (const witness of [...NR, ...RH, 'A_main', 'O_up', 'O_t', 'X0'] as const) {
            expect(storeKeysBeforeStep1.has(keyOf(witness)), `${witness} is stored before pass 1`).toBe(true)
        }

        // Step 1: records.
        await pageLoad()
        const revisions = new Map<string, number | null>()
        await exposure('step 1', ca, revisions)
        // P-A2 (single holder): without Ca the closure over this page's commit key does not hold `K_ret`.
        const keyAtStep1 = await readCommitKey()
        const reader = createBackendClosureReader(world.backend)
        const withCa = await buildClosureAssetKeepSet({ commitKey: keyAtStep1, reader })
        const withoutCa = await buildClosureAssetKeepSet({ commitKey: { ...keyAtStep1, retained: keyAtStep1.retained.filter((entry) => entry.key !== ca) }, reader })
        expect(withCa.status).toBe('complete')
        expect(withoutCa.status).toBe('complete')
        if (withCa.status === 'complete' && withoutCa.status === 'complete') {
            // Only the second is a hard precondition (`K_ret` has no other holder); the first is the keep rule under test.
            expect.soft(withCa.keep.holds(keyOf('K_ret'))).toBe(true)
            expect(withoutCa.keep.holds(keyOf('K_ret'))).toBe(false)
        }
        const step1 = await runStep()
        // C2a: the in-place conversion plans no old-data keys, so the deletion has no pointer at every step.
        expect(step1.deletions.map((call) => call.result)).toEqual([{ status: 'no-pointer' }])
        expect(await world.store.has(LEGACY_MAIN_FILE_KEY)).toBe(true)
        expect(await world.store.has(BACKUP_KEY)).toBe(true)
        // C2: the sweep record is stored and every candidate is recorded unmarked at the revision the store holds.
        expect(await world.store.has(SWEEP_KEY), 'C2: the sweep record is stored').toBe(true)
        expect(step1.sweep, 'C2: pass 1 records').toMatchObject({ phase: 'recorded', deleted: 0, recorded: true, failed: 0 })
        expect(step1.sweep.stopped).toBeUndefined()
        expect(step1.gc).toMatchObject({ phase: 'recorded', record: 'written' })
        const r1 = await readSweepRecord()
        expect(seenBeforeIn(r1).size).toBe(0)
        const e1 = [...sortedNames(['O_up', 'X0'])]
        expect.soft(sorted(namesIn(r1)), 'R1 names E1 and O_t').toEqual([...e1, nameOf('O_t')].sort())
        for (const item of r1.value.items) {
            expect((await world.store.read(`assets/${item[0]}`)).version, `R1 revision of ${item[0]}`).toBe(item[1])
        }

        // R1: restart 10 minutes short of a day; window 1a and the young control.
        await restartAt(SHIFT_R1, { records: true })
        await pageLoad()
        await hydrate({ stub: false })
        const w1a = await openWindow()
        await edit(w1a, EDITS.desc('W1a description'), MARK_INLINE)
        await saveWitness('X1')
        const x1Add = await edit(w1a, EDITS.addRow(INLINE, 'x1', 'X1'), MARK_INLINE)
        await edit(w1a, EDITS.removeRow(INLINE, 'x1'), MARK_INLINE)
        const dropped1a = await closeWindow(w1a, 1)
        expect(dropped1a.has(x1Add)).toBe(true)
        await pageLoad()
        await exposure('step Y', ca, revisions)
        const recordBeforeY = await snapshotOf(SWEEP_KEY)
        const assetsBeforeY = await assetVersions()
        const stepY = await runStep()
        expect(stepY.deletions.map((call) => call.result)).toEqual([{ status: 'no-pointer' }])
        // C4: a record younger than a day ends the pass before any gate, listing or closure read.
        expect(stepY.sweep, 'C4: the young control ends before any read').toMatchObject({ phase: 'young', candidates: 0, deleted: 0, batches: 0, recorded: false })
        expect(stepY.gc).toMatchObject({ phase: 'young', deleted: 0, batches: 0 })
        expectSameSnapshot('the sweep record after the young step', await snapshotOf(SWEEP_KEY), recordBeforeY)
        expect(await assetVersions()).toEqual(assetsBeforeY)

        // R2: a day and twenty minutes; window 1b and pass 2 marks.
        await restartAt(SHIFT_R2, { records: true })
        await pageLoad()
        await hydrate({ stub: false })
        const w1b = await openWindow()
        await edit(w1b, EDITS.mainPrompt('W1b main prompt'), MARK_NOTHING)
        await saveWitness('X2')
        const x2Add = await edit(w1b, EDITS.addRow(INLINE, 'x2', 'X2'), MARK_INLINE)
        await edit(w1b, EDITS.removeRow(INLINE, 'x2'), MARK_INLINE)
        const dropped1b = await closeWindow(w1b, 1)
        expect(dropped1b.has(x2Add)).toBe(true)
        await pageLoad()
        await exposure('step 2', ca, revisions)
        const step2 = await runStep()
        expect(step2.deletions.map((call) => call.result)).toEqual([{ status: 'no-pointer' }])
        // C5: pass 2 marks and deletes nothing: every candidate was seen once, so none is seen twice.
        expect(step2.sweep, 'C5: pass 2 marks and deletes nothing').toMatchObject({ phase: 'swept', deleted: 0, recorded: true, failed: 0 })
        expect(step2.sweep.stopped).toBeUndefined()
        expect(step2.gc).toMatchObject({ phase: 'swept', record: 'written' })
        const r2 = await readSweepRecord()
        const u1 = [nameOf('X1'), nameOf('X2')].sort()
        expect.soft(sorted(seenBeforeIn(r2)), 'R2 marks E1 and O_t').toEqual([...e1, nameOf('O_t')].sort())
        for (const name of seenBeforeIn(r2)) {
            expect.soft(revisionIn(r2, name), `R2 holds ${name} at R1's revision`).toBe(revisionIn(r1, name))
        }
        // C5': the orphans of windows 1a and 1b were first seen at pass 2.
        expect.soft(sorted(unmarkedIn(r2)), 'R2 unmarked is U1').toEqual(u1)
        expect(u1.filter((name) => namesIn(r1).has(name))).toEqual([])

        // R3: two days and forty minutes; window 2 touches O_t, then a cold page load, the export before the delete, pass 3.
        await restartAt(SHIFT_R3, { records: true })
        await pageLoad()
        await hydrate({ stub: false })
        const w2 = await openWindow()
        const touchBefore = (await world.store.read(keyOf('O_t'))).version
        await saveAsset(bytesOf('O_t'))
        const touchAfter = (await world.store.read(keyOf('O_t'))).version
        expect.soft(touchAfter, 'saving the same bytes again moves the asset revision').not.toBe(touchBefore)
        await edit(w2, EDITS.desc('W2 description'), MARK_INLINE)
        await saveWitness('X3')
        const x3Add = await edit(w2, EDITS.addRow(INLINE, 'x3', 'X3'), MARK_INLINE)
        await edit(w2, EDITS.removeRow(INLINE, 'x3'), MARK_INLINE)
        const dropped2 = await closeWindow(w2, 1)
        expect(dropped2.has(x3Add)).toBe(true)
        await pageLoad()
        await exposure('step 3', ca, revisions)
        const exportedBefore = await exportBackup()
        const l0 = await assetListing()
        const step3 = await runStep()
        const l1 = await assetListing()
        expect(step3.deletions.map((call) => call.result)).toEqual([{ status: 'no-pointer' }])
        expect(await world.store.has(LEGACY_MAIN_FILE_KEY)).toBe(true)
        expect(await world.store.has(BACKUP_KEY)).toBe(true)
        const r3 = await readSweepRecord()
        const removed = sorted([...l0].filter((key) => !l1.has(key)).map((key) => key.slice('assets/'.length)))

        // C6: step 3 swept exactly what R2 had marked and R3 still has at that revision.
        expect(step3.sweep, 'C6: pass 3 deletes and nothing is kept live').toMatchObject({ phase: 'swept', failed: 0, keptLive: 0, recorded: true })
        expect(step3.sweep.deleted).toBeGreaterThan(0)
        expect(step3.sweep.stopped).toBeUndefined()
        expect(step3.gc).toMatchObject({ phase: 'swept', record: 'written' })
        expect(removed).toHaveLength(step3.sweep.deleted)
        expect.soft(removed, 'step 3 removed E1').toEqual(e1.sort())
        // C6': the late orphans and the touched asset survive the deleting pass.
        for (const name of u1) {
            expect(l1.has(`assets/${name}`), `${name} is still listed`).toBe(true)
            expect(seenBeforeIn(r3).has(name), `${name} is marked in R3`).toBe(true)
        }
        const touched = nameOf('O_t')
        expect(l1.has(keyOf('O_t')), 'O_t is still listed').toBe(true)
        expect(unmarkedIn(r3).has(touched), 'O_t is unmarked in R3').toBe(true)
        expect(Number(revisionIn(r3, touched)), 'O_t is recorded at a revision above R2').toBeGreaterThan(Number(revisionIn(r2, touched)))
        expect.soft(sorted(unmarkedIn(r3)), 'R3 unmarked is X3 and O_t').toEqual([nameOf('X3'), touched].sort())

        // R4: a restart on the same clocks, then the read after the delete.
        await restartAt(SHIFT_R3, { records: true })
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
        // C7: every character reads back with the chats the export before the delete held.
        for (const character of exportedBefore.database.characters as Obj[]) {
            const after = resolvedAfter.get(String(character.chaId))
            expect(after, String(character.chaId)).toBeDefined()
            if (after !== undefined) {
                expect(chatViewOf(after), String(character.chaId)).toEqual(chatViewOf(character))
            }
        }
        const stubbed = resolvedAfter.get(STUB)
        expect(stubbed?.additionalAssets).toEqual([['cold', keyOf('K_cold')], ['lit', keyOf('K_lit')]])
        for (const slot of (pl5.database.modules as Obj[])) {
            if (isModuleStub(slot)) {
                expect((await loadModuleStubsOf(String(slot.id))).kind).toBe('loaded')
            }
        }

        // C8: every keep witness is present and byte-equal, the inlay too, and the final closure holds them all.
        for (const witness of [...KW, 'O_t'] as const) {
            const read = await world.store.read(keyOf(witness))
            expect(read.bytes, `${witness} is stored`).not.toBeNull()
            expect(Uint8Array.from(read.bytes ?? []), `${witness} is byte-equal`).toEqual(Uint8Array.from(expectedBytes(witness)))
        }
        expect(await world.store.list('inlays/')).toEqual(inlayKeys)
        for (const [key, bytes] of inlayBefore) {
            expect(Uint8Array.from((await world.store.read(key)).bytes ?? []), `the inlay ${key} is byte-equal`).toEqual(Uint8Array.from(bytes))
        }
        const finalKey = await readCommitKey()
        const closure = await buildClosureAssetKeepSet({ commitKey: finalKey, reader: createBackendClosureReader(world.backend) })
        expect(closure.status).toBe('complete')
        if (closure.status === 'complete') {
            for (const witness of KW) {
                expect(closure.keep.holds(keyOf(witness)), `the closure holds ${witness}`).toBe(true)
            }
        }
        for (const key of manifestNamesOf(finalKey)) {
            const read = await readTreeBytes(world.backend, key)
            expect(read.status, key).toBe('ok')
            if (read.status === 'ok') {
                expect(read.flagged, key).toEqual([])
            }
        }

        // C9: the export after the delete is whole, and every asset its database names is an entry equal to the earlier one.
        const exportedAfter = await exportBackup()
        expect(exportedAfter.database).toEqual(exportedBefore.database)
        expect(exportedBefore.database.userIcon).toBe(keyOf('K_cfg'))
        expect(characterOf(exportedBefore.database, STUB).additionalAssets).toEqual([['cold', keyOf('K_cold')], ['lit', keyOf('K_lit')]])
        const named = getUncleanablesSync(exportedAfter.database as unknown as Database)
        for (const witness of ['K_cold', 'K_lit', 'K_gold', 'K_cfg'] as const) {
            expect(named, `the exported database names ${witness}`).toContain(nameOf(witness))
        }
        for (const name of named) {
            const entry = exportedAfter.assets.get(name)
            expect(entry, `the export holds ${name}`).toBeDefined()
            expect(Uint8Array.from(entry ?? []), `the export holds ${name} byte-equal`).toEqual(Uint8Array.from(exportedBefore.assets.get(name) ?? []))
        }
        expect(sorted(exportedAfter.names)).toEqual(exportedBefore.names.filter((name) => !removed.includes(name)).sort())

        // C10 (soft): no record named a keep witness.
        for (const record of [r1, r2, r3]) {
            expect.soft(sortedNames(KW).filter((name) => namesIn(record).has(name)), 'a record names a keep witness').toEqual([])
        }

        // E-T2: an edit that references the touched asset lands, and its bytes are unchanged.
        await hydrate({ stub: false })
        const wTail = await openWindow()
        await edit(wTail, EDITS.addRow(INLINE, 't', 'O_t'), MARK_INLINE)
        expect(Uint8Array.from((await world.store.read(keyOf('O_t'))).bytes ?? [])).toEqual(Uint8Array.from(bytesOf('O_t')))
        expect(parseStore2Key(currentOf(await readCommitKey()))).not.toBeNull()
    })
})

//#endregion

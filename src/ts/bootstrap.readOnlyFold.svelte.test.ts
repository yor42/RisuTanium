/**
 * `loadData()` (`src/ts/bootstrap.ts`) on a page whose store2 dispatch answers `legacy-readonly`: the real `loadData()`
 * and the real dispatch over a recording page store that holds the legacy main file and numbered backups. The legacy
 * profile is only read: the page writes nothing, deletes no backup, runs no archive pass, and keeps the Tauri and web
 * read routes' own asymmetries (which errors take the backup route, the empty-profile arm, the error texts).
 *
 * Most rows are compatibility guards of the read-only fold: they pass on the code that preceded the fold and on the
 * fold. The "partial notice" rows that expect one more queued notice (a partly decoded main file or a numbered backup)
 * are the exception: they are regression reproducers of the legacy partial notice and fail on a build without it. The
 * "partial notice" row whose damaged block the block cache answers expects no extra notice and is a compatibility guard;
 * the rows that check only the kept fact are guards of the new contract and have no meaning on a build without it. `T2-P4` also pins that a main file that is absent is installed as an empty profile
 * and never written.
 * The main files and backups are producer-built (the real encoder, `composeSave` block files), so the decodes are the
 * real ones.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import { BLOCK, composeSave, corruptBlockPayload, type ComposedSave } from 'src/ts/storage/tests/manualCleanupHarness'
import { registerRealDispatch, stopAcknowledgingAlerts } from 'src/ts/tests/realDispatchBoot.test-helpers'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

/** What the decoder's block cache holds, by `risuSaveBlock_<name>`. */
const blockCache = vi.hoisted(() => new Map<string, unknown>())

const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))
const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const sleepForeverMock = vi.hoisted(() => vi.fn(async () => { }))

//#endregion

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(() => ({
            getItem: vi.fn(async (key: string) => blockCache.get(key) ?? null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
            clear: vi.fn(async () => { }),
            dropInstance: vi.fn(async () => { }),
        })),
        dropInstance: vi.fn(async () => { }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformState.isTauri },
    get isNodeServer() { return platformState.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(async () => { }),
    checkNullish: (v: unknown) => v === null || v === undefined,
    sleep: vi.fn(async () => { }),
    sleepForever: sleepForeverMock,
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: vi.fn(),
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: setDatabaseMock,
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/update'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return dbState.current } },
    LoadingStatusState: { text: '' },
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    handlePendingRealmLink: vi.fn(async () => { }),
    hubURL: 'https://realm.risuai.net',
}) as unknown as typeof import('src/ts/characterCards'))

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

vi.mock(import('src/ts/process/memory/characterPutBack'), () => ({
    startCharacterPutBack: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/characterPutBack'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    startAvatarThumbSweep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/model/modellist'), () => ({
    registerModelDynamic: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        maximize: vi.fn(async () => { }),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async (path: string) => { throw new Error(`ENOENT (mock): ${path}`) }),
    writeFile: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        staleAccountProfile: false,
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => { }),
        keys: vi.fn(async (): Promise<string[]> => []),
        removeItem: vi.fn(async () => { }),
    },
    saveDb: saveDbMock,
    getDbBackups: getDbBackupsMock,
    buildAssetKeepSet: vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })),
    getBasename: (p: string) => p.split('/').pop(),
    setUsingSw: vi.fn(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: vi.fn((): string[] => []),
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

//#endregion

const { encodeRisuSaveLegacy, RisuSaveEncoder, decodeRisuSave } = await import('src/ts/storage/risuSave')

const MAIN_KEY = 'database/database.bin'
const SKIPPED_KEY = 'archivePassSkipped'
const TOO_LARGE_KEY = 'archivePassTooLarge'
const STRIKES_KEY = 'archivePassStrikes'
const TOLD_KEY = 'archivePassPausedTold'
const ENRICH_KEY = 'stubEnrichStrikes'
const NEWEST = 1_700_000_002_000
const MIDDLE = 1_700_000_001_000
const OLDEST = 1_700_000_000_000

function backupKey(time: number): string {
    return `database/dbbackup-${time}.bin`
}

function baseDb(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        formatversion: 999,
        characters: [],
        modules: [],
        personas: [],
        characterOrder: [],
        mainPrompt: 'fixture-main-prompt',
        loreBookToken: 8000,
        hotkeys: [],
        botPresets: [],
        coldstorage: false,
        checkCorruption: false,
        botSettingAtStart: false,
        betaMobileGUI: false,
        didFirstSetup: false,
        heightMode: 'auto',
        ...extra,
    }
}
dbState.baseline = () => baseDb()

/** A block-format file with characters `a` (inline) and `b` (a remote pointer or inline), built block by block so a test can damage exactly one. */
async function composeBlockFile(options: { b?: 'remote' | 'inline', plugins?: Record<string, unknown>[], rootExtra?: Record<string, unknown> } = {}): Promise<ComposedSave> {
    const encoder = new RisuSaveEncoder()
    const character = (chaId: string) => JSON.stringify({ chaId, name: chaId.toUpperCase(), type: 'character', chats: [] })
    const remotePointer = JSON.stringify({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash: '0123456789abcdef' })
    const root = { ...baseDb(options.rootExtra), characters: undefined, __directory: ['preset', 'plugins', 'a', 'b', 'config'] }
    return composeSave(encoder, [
        { name: 'root', type: BLOCK.ROOT, data: JSON.stringify(root) },
        { name: 'preset', type: BLOCK.BOTPRESET, data: JSON.stringify([{ name: 'p' }]) },
        { name: 'plugins', type: BLOCK.PLUGINS, data: JSON.stringify(options.plugins ?? []) },
        { name: 'a', type: BLOCK.CHARACTER_WITH_CHAT, data: character('a') },
        options.b === 'inline'
            ? { name: 'b', type: BLOCK.CHARACTER_WITH_CHAT, data: character('b') }
            : { name: 'b', type: BLOCK.REMOTE, data: remotePointer },
        { name: 'config', type: BLOCK.CONFIG, data: '{"version":1}' },
    ])
}

/** The page store of a legacy profile: the main file (unless `main` is null) and the numbered backups given. */
function legacyStore(options: { main?: Uint8Array | null, backups?: [number, Uint8Array][] } = {}): MemoryByteStore {
    const store = createMemoryByteStore()
    const main = options.main === undefined ? encodeRisuSaveLegacy(baseDb({ mainPrompt: 'from-main' })) : options.main
    if (main !== null) {
        store.files.set(MAIN_KEY, main)
    }
    for (const [time, bytes] of options.backups ?? []) {
        store.files.set(backupKey(time), bytes)
    }
    return store
}

/** Two backups: the newest is damaged, the one under it decodes, and the oldest decodes too. */
function backupsOneDamaged(): [number, Uint8Array][] {
    return [
        [NEWEST, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
        [MIDDLE, encodeRisuSaveLegacy(baseDb({ mainPrompt: 'from-middle-backup' }))],
        [OLDEST, encodeRisuSaveLegacy(baseDb({ mainPrompt: 'from-oldest-backup' }))],
    ]
}

function damagedBackups(): [number, Uint8Array][] {
    return [
        [NEWEST, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
        [OLDEST, new Uint8Array([9, 9, 9])],
    ]
}

type AlertValue = { type: string, msg: string }

interface Run {
    loadData: () => Promise<void>
    loadedStore: ReturnType<typeof writable<boolean>>
    /** Every non-`none` alert the boot wrote, in order. */
    alerts: AlertValue[]
    /** The `normal` notices the boot posted (the dispatch acknowledged each). */
    notices: string[]
    store: MemoryByteStore
}

type ReadOnlyKind = 'node' | 'tauri'

/** Injects `store` as the page store of `kind`, registers the real dispatch and imports a fresh `loadData`. */
async function boot(kind: ReadOnlyKind, store: MemoryByteStore): Promise<Run> {
    platformState.isTauri = kind === 'tauri'
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    injectAppStore(store, kind satisfies AppStoreKind)
    const dispatch = await registerRealDispatch({ kind, acknowledgeAlerts: true, injectBackend: false })
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<AlertValue>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    const alerts: AlertValue[] = []
    alertStore.subscribe((value) => {
        if (value.type !== 'none') {
            alerts.push({ type: value.type, msg: value.msg })
        }
    })
    return { loadData, loadedStore, alerts, notices: dispatch.shownAlerts, store }
}

async function settle(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
}

/** Everything the boot wrote or deleted in the page store, the Tauri owner id excepted. */
function storeEffects(store: MemoryByteStore): { writes: string[], deletes: string[] } {
    return { writes: store.writes.filter(key => key !== 'store2-owner'), deletes: [...store.deletes] }
}

function installedPrompt(): unknown {
    return setDatabaseMock.mock.calls[0]?.[0].mainPrompt
}

function errors(run: Run): string[] {
    return run.alerts.filter(alert => alert.type === 'error').map(alert => alert.msg)
}

/**
 * The page-life fact the boot keeps for the export. Imported by a name Vite cannot resolve ahead of the run, so the rows
 * that only check the notices load and fail on their own assertion on a build that has no such module.
 */
async function legacyPartialModule(): Promise<typeof import('src/ts/storage/legacyPartialSave')> {
    const specifier = 'src/ts/storage/legacyPartialSave'
    return await import(/* @vite-ignore */ specifier)
}

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
beforeEach(expectBootstrapTransformed)
beforeEach(() => {
    localStorage.clear()
    blockCache.clear()
    platformState.isTauri = false
    platformState.isNodeServer = true
    getDbBackupsMock.mockReset().mockResolvedValue([])
    saveDbMock.mockReset().mockResolvedValue(undefined)
    sleepForeverMock.mockReset().mockResolvedValue(undefined)
    dbState.current = baseDb()
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    getDatabaseMock.mockReset().mockImplementation(() => dbState.current)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    stopAcknowledgingAlerts()
    vi.unstubAllGlobals()
})

describe('loadData(): the Tauri read-only boot reads the legacy profile and writes nothing (T2-P1, T2-P2)', () => {
    const unreadable = (store: MemoryByteStore) => {
        store.failRead = (key) => (key === MAIN_KEY ? new Error('read refused') : null)
    }
    const variants: [string, (store: MemoryByteStore) => void][] = [
        ['an unreadable main file', unreadable],
        ['a zero-length main file', (store) => { store.files.set(MAIN_KEY, new Uint8Array(0)) }],
        ['a main file that does not decode', (store) => { store.files.set(MAIN_KEY, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) }],
    ]

    test.each(variants)('T2-P1 partial notice: %s leads to the first decodable backup, nothing is written or deleted, the main bytes stand, and the backup date is told', async (_label, damage) => {
        const store = legacyStore({ backups: backupsOneDamaged() })
        damage(store)
        const heldMain = store.files.get(MAIN_KEY)?.slice()
        const run = await boot('tauri', store)
        const { language } = await import('src/lang')

        await run.loadData()
        await settle()

        expect(get(run.loadedStore)).toBe(true)
        expect(installedPrompt()).toBe('from-middle-backup')
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(heldMain).toBeDefined()
        expect(store.files.get(MAIN_KEY)).toEqual(heldMain)
        expect(errors(run)).toEqual([])
        expect(run.notices).toHaveLength(2)
        expect(run.notices[0]).toBe(language.store2Boot.noticeBackendUnavailable)
        // The date is computed here the way the boot's date helper does, not by calling it.
        expect(run.notices[1]).toContain(new Date(MIDDLE * 100).toLocaleString())
        expect(run.notices[1]).toBe(language.legacyBackupNotice(new Date(MIDDLE * 100).toLocaleString(), []))
        const { getLegacyPartialSave } = await legacyPartialModule()
        expect(getLegacyPartialSave()).toEqual({ backupTime: MIDDLE, omitted: new Map() })
        expect(getDbBackupsMock).not.toHaveBeenCalled()
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'read-only', reason: 'backend-unavailable' })
    })

    test('T2-P2 guard: with no decodable backup the boot ends with "Your save file is corrupted" and writes nothing', async () => {
        const store = legacyStore({ backups: damagedBackups() })
        unreadable(store)
        const run = await boot('tauri', store)

        await run.loadData()
        await settle()

        expect(errors(run)).toEqual(['Your save file is corrupted'])
        expect(get(run.loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })
})

describe('loadData(): the web read-only boot reads the legacy profile and writes nothing (T2-P3, T2-P4)', () => {
    const kinds: ReadOnlyKind[] = ['node']
    const variants: [string, (store: MemoryByteStore) => Promise<void>][] = [
        ['a stored value that is not bytes', async (store) => {
            // The class of the boot's own module graph, so the boot's `instanceof` test sees it.
            const { StoreNotBinaryError } = await import('src/ts/storage/store/errors')
            store.failRead = (key) => (key === MAIN_KEY ? new StoreNotBinaryError(key) : null)
        }],
        ['a zero-length main file', async (store) => { store.files.set(MAIN_KEY, new Uint8Array(0)) }],
        ['a main file that does not decode', async (store) => { store.files.set(MAIN_KEY, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) }],
    ]

    describe.each(kinds)('on a %s page', (kind) => {
        test.each(variants)('T2-P3 guard: %s leads to the first decodable backup; nothing is written or deleted', async (_label, damage) => {
            const store = legacyStore({ backups: backupsOneDamaged() })
            await damage(store)
            const run = await boot(kind, store)

            await run.loadData()
            await settle()

            expect(get(run.loadedStore)).toBe(true)
            expect(installedPrompt()).toBe('from-middle-backup')
            expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
            expect(errors(run)).toEqual([])
            expect(getDbBackupsMock).not.toHaveBeenCalled()
        })

        test('T2-P3 partial notice: a main file that does not decode posts the backup notice after the page-level notices', async () => {
            const store = legacyStore({ main: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), backups: backupsOneDamaged() })
            const run = await boot(kind, store)
            const { language } = await import('src/lang')

            await run.loadData()
            await settle()

            expect(get(run.loadedStore)).toBe(true)
            expect(run.notices).toHaveLength(2)
            expect(run.notices[0]).toBe(language.store2Boot.noticeBackendUnavailable)
            expect(run.notices[1]).toBe(language.legacyBackupNotice(new Date(MIDDLE * 100).toLocaleString(), []))
            expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        })

        test('T2-P3 guard: another read error is rethrown and alerted, the backups are not consulted and nothing is installed', async () => {
            const store = legacyStore({ backups: backupsOneDamaged() })
            store.failRead = (key) => (key === MAIN_KEY ? new Error('disk gone') : null)
            const run = await boot(kind, store)

            await run.loadData()
            await settle()

            expect(errors(run)).toEqual(['disk gone'])
            expect(get(run.loadedStore)).toBe(false)
            expect(setDatabaseMock).not.toHaveBeenCalled()
            expect(store.reads.filter(key => key.startsWith('database/dbbackup-'))).toEqual([])
            expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        })

        test('T2-P3 guard: with no decodable backup the boot ends with "Forage: Your save file is corrupted" and writes nothing', async () => {
            const store = legacyStore({ main: new Uint8Array(0), backups: damagedBackups() })
            const run = await boot(kind, store)

            await run.loadData()
            await settle()

            expect(errors(run)).toEqual(['Forage: Your save file is corrupted'])
            expect(get(run.loadedStore)).toBe(false)
            expect(setDatabaseMock).not.toHaveBeenCalled()
            expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        })
    })
})

describe('loadData(): the read-only boot applies the boot repairs (T2-P5)', () => {
    test.each([[false], [true]])('T2-P5 guard: a character with no id gets one and the person is told (Tauri: %s)', async (tauri) => {
        const noId = { chaId: '', name: 'No id', type: 'character', chats: [] }
        const store = legacyStore({ main: encodeRisuSaveLegacy(baseDb({ characters: [noId] })) })
        const run = await boot(tauri ? 'tauri' : 'node', store)
        const { language } = await import('src/lang')

        await run.loadData()
        await settle()

        const installed = setDatabaseMock.mock.calls[0][0].characters as { chaId: string }[]
        expect(installed).toHaveLength(1)
        expect(installed[0].chaId).toMatch(/^[0-9a-f-]{36}$/)
        expect(run.alerts).toContainEqual({ type: 'toast', msg: language.saveRepairedEntriesNotice(0, 1) })
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })
})

describe('loadData(): the read-only boot and the archive memo (T2-P6)', () => {
    /** The notice memo (skipped characters, too-large), the strike count and the told record, plus a key that is none of them. */
    function seedMemo(): void {
        localStorage.setItem(SKIPPED_KEY, JSON.stringify(['b', 'c']))
        localStorage.setItem(TOO_LARGE_KEY, '1')
        localStorage.setItem(STRIKES_KEY, '2')
        localStorage.setItem(TOLD_KEY, '1')
        localStorage.setItem('unrelated-key', 'kept')
    }

    const decodes: [string, (extra: Record<string, unknown>) => Promise<Uint8Array>][] = [
        ['a strict decode', async (extra) => encodeRisuSaveLegacy(baseDb(extra))],
        ['a decode that is only non-strict', async (extra) => corruptBlockPayload(await composeBlockFile({ b: 'inline', plugins: [{ name: 'p', version: '2.1', enabled: true }], rootExtra: extra }), 'plugins')],
    ]

    describe.each(decodes)('%s', (_label, build) => {
        test.each([[false], [true]])('T2-P6 guard: the setting off clears both memos, the strike count and the told record and leaves other keys (Tauri: %s)', async (tauri) => {
            const store = legacyStore({ main: await build({ archiveCharacters: false }) })
            seedMemo()
            const run = await boot(tauri ? 'tauri' : 'node', store)

            await run.loadData()
            await settle()

            expect(get(run.loadedStore)).toBe(true)
            expect(localStorage.getItem(SKIPPED_KEY)).toBeNull()
            expect(localStorage.getItem(TOO_LARGE_KEY)).toBeNull()
            expect(localStorage.getItem(STRIKES_KEY)).toBeNull()
            expect(localStorage.getItem(TOLD_KEY)).toBeNull()
            expect(localStorage.getItem('unrelated-key')).toBe('kept')
        })

        test.each([
            ['absent', {}],
            ['on', { archiveCharacters: true }],
        ] as const)('T2-P6 guard: a boot that reads the setting %s leaves both memos, the strike count and the told record alone', async (_state, extra) => {
            const store = legacyStore({ main: await build(extra) })
            seedMemo()
            const run = await boot('node', store)

            await run.loadData()
            await settle()

            expect(get(run.loadedStore)).toBe(true)
            expect(localStorage.getItem(SKIPPED_KEY)).toBe(JSON.stringify(['b', 'c']))
            expect(localStorage.getItem(TOO_LARGE_KEY)).toBe('1')
            expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
            expect(localStorage.getItem(TOLD_KEY)).toBe('1')
        })
    })

    test('T2-P6 guard: two boots that read the setting off in a row keep the stub-enrichment count', async () => {
        localStorage.setItem(ENRICH_KEY, '1')
        for (let round = 0; round < 2; round++) {
            vi.resetModules()
            setDatabaseMock.mockClear()
            const store = legacyStore({ main: encodeRisuSaveLegacy(baseDb({ archiveCharacters: false })) })
            const run = await boot('node', store)

            await run.loadData()
            await settle()

            expect(get(run.loadedStore)).toBe(true)
            expect(localStorage.getItem(ENRICH_KEY)).toBe('1')
        }
    })
})

describe('loadData(): a main file that decodes only non-strictly is installed as its partial tree (T2-P7)', () => {
    /** What the page tells about the partial tree: the items of the notice, or null when it must stay silent. */
    type Told = (language: typeof import('src/lang').language) => string[] | null
    const incomplete: [string, () => Promise<Uint8Array>, (ids: string[], tree: Record<string, unknown>) => void, Told][] = [
        ['a missing remote file', async () => (await composeBlockFile()).bytes, (ids) => expect(ids).toEqual(['a']), () => ['1 character']],
        ['a block with a bad checksum that the block cache answers', async () => {
            const save = await composeBlockFile({ b: 'inline' })
            blockCache.set('risuSaveBlock_b', { type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', data: JSON.stringify({ chaId: 'b', name: 'Cached B', type: 'character', chats: [] }) })
            return corruptBlockPayload(save, 'b')
        }, (ids, tree) => {
            expect(ids).toEqual(['a', 'b'])
            expect((tree.characters as { name: string }[]).map(character => character.name)).toEqual(['A', 'Cached B'])
        }, () => null],
        ['a damaged PLUGINS block', async () => corruptBlockPayload(await composeBlockFile({ b: 'inline', plugins: [{ name: 'p', version: '2.1', enabled: true }] }), 'plugins'), (ids, tree) => {
            expect(ids).toEqual(['a', 'b'])
            expect(tree.plugins).toBeUndefined()
        }, (language) => [language.internalBackupLeftOutPlugins]],
    ]

    test.each(incomplete.flatMap(([label, arm, check, told]) => [[label, false, arm, check, told] as const, [label, true, arm, check, told] as const]))('T2-P7 partial notice: %s installs the partial tree, writes nothing, shows no error and tells what is missing, if anything (Tauri: %s)', async (_label, tauri, arm, check, told) => {
        const bytes = await arm()
        const store = legacyStore({ main: bytes })
        const run = await boot(tauri ? 'tauri' : 'node', store)
        const { language } = await import('src/lang')

        await run.loadData()
        await settle()

        expect(get(run.loadedStore)).toBe(true)
        const tree = setDatabaseMock.mock.calls[0][0]
        check((tree.characters as { chaId: string }[]).map(character => character.chaId), tree)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(errors(run)).toEqual([])
        const items = told(language)
        expect(run.notices).toHaveLength(items === null ? 1 : 2)
        expect(run.notices[0]).toBe(language.store2Boot.noticeBackendUnavailable)
        if (items !== null) {
            const { getLegacyPartialSave } = await legacyPartialModule()
            expect(run.notices[1]).toBe(language.legacyPartialNotice(items))
            expect(getLegacyPartialSave()?.backupTime).toBeNull()
            expect([...(getLegacyPartialSave()?.omitted.values() ?? [])].map(block => block.kind)).toEqual([items[0] === '1 character' ? 'character' : 'plugins'])
        }
    })

    test.each([[false], [true]])('T2-P7 partial notice: a block the block cache stands in for keeps no fact for the export (Tauri: %s)', async (tauri) => {
        const save = await composeBlockFile({ b: 'inline' })
        blockCache.set('risuSaveBlock_b', { type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', data: JSON.stringify({ chaId: 'b', name: 'Cached B', type: 'character', chats: [] }) })
        const run = await boot(tauri ? 'tauri' : 'node', legacyStore({ main: corruptBlockPayload(save, 'b') }))

        await run.loadData()
        await settle()

        const { getLegacyPartialSave } = await legacyPartialModule()
        expect(getLegacyPartialSave()).toBeNull()
    })

    test('T2-P7 partial notice: a strictly decoded main file keeps no fact for the export', async () => {
        const run = await boot('node', legacyStore())

        await run.loadData()
        await settle()

        const { getLegacyPartialSave } = await legacyPartialModule()
        expect(getLegacyPartialSave()).toBeNull()
    })

    test('T2-P7 partial notice: a remote file gone and a PLUGINS block damaged are told together, characters first', async () => {
        const bytes = corruptBlockPayload(await composeBlockFile({ plugins: [{ name: 'p', version: '2.1', enabled: true }] }), 'plugins')
        const store = legacyStore({ main: bytes })
        const run = await boot('node', store)
        const { language } = await import('src/lang')

        await run.loadData()
        await settle()

        expect(run.notices).toHaveLength(2)
        expect(run.notices[1]).toBe(language.legacyPartialNotice(['1 character', language.internalBackupLeftOutPlugins]))
    })

    test('T2-P7 partial notice: a backup that is itself partial names what it lacks next to its date (Tauri: both)', async () => {
        const damagedPlugins = corruptBlockPayload(await composeBlockFile({ b: 'inline', plugins: [{ name: 'p', version: '2.1', enabled: true }] }), 'plugins')
        for (const tauri of [true, false]) {
            vi.resetModules()
            setDatabaseMock.mockClear()
            const store = legacyStore({ main: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), backups: [[NEWEST, new Uint8Array([1, 2, 3])], [MIDDLE, damagedPlugins]] })
            const run = await boot(tauri ? 'tauri' : 'node', store)
            const { language } = await import('src/lang')

            await run.loadData()
            await settle()

            expect(run.notices).toHaveLength(2)
            expect(run.notices[1]).toBe(language.legacyBackupNotice(new Date(MIDDLE * 100).toLocaleString(), [language.internalBackupLeftOutPlugins]))
            expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        }
    })

    test.each([[false], [true]])('T2-P7 guard: a damaged config block alone leaves no notice and no fact (Tauri: %s)', async (tauri) => {
        const bytes = corruptBlockPayload(await composeBlockFile({ b: 'inline' }), 'config')
        const store = legacyStore({ main: bytes })
        const run = await boot(tauri ? 'tauri' : 'node', store)
        const { language } = await import('src/lang')

        await run.loadData()
        await settle()

        expect(get(run.loadedStore)).toBe(true)
        expect(run.notices).toEqual([language.store2Boot.noticeBackendUnavailable])
    })

    test('T2-P7 guard: a page that fails the live gate after a partial install posts no notice', async () => {
        vi.doMock('src/ts/storage/pageStorageMode', async (importOriginal) => ({
            ...await importOriginal<typeof import('src/ts/storage/pageStorageMode')>(),
            pageMayGoLive: () => false,
        }))
        try {
            for (const tauri of [true, false]) {
                vi.resetModules()
                const bytes = corruptBlockPayload(await composeBlockFile({ b: 'inline', plugins: [{ name: 'p', version: '2.1', enabled: true }] }), 'plugins')
                const run = await boot(tauri ? 'tauri' : 'node', legacyStore({ main: bytes }))

                await run.loadData()
                await settle()

                expect(get(run.loadedStore)).toBe(false)
                expect(errors(run)).toHaveLength(1)
                expect(run.alerts.filter(alert => alert.type === 'normal')).toEqual([])
            }
        } finally {
            vi.doUnmock('src/ts/storage/pageStorageMode')
        }
    })

    test('T2-P7 is not vacuous: the damaged PLUGINS block fails a strict decode, the lenient decode reads it', async () => {
        const bytes = corruptBlockPayload(await composeBlockFile({ b: 'inline', plugins: [{ name: 'p', version: '2.1', enabled: true }] }), 'plugins')

        await expect(decodeRisuSave(bytes, { strict: true })).rejects.toBeDefined()
        await expect(decodeRisuSave(bytes)).resolves.toBeDefined()
    })
})

describe('loadData(): a legacy profile boots read-only whichever way its main file decodes (T2-G2)', () => {
    test.each([
        ['a main file that decodes strictly', async () => encodeRisuSaveLegacy(baseDb())],
        ['a main file that decodes only non-strictly', async () => corruptBlockPayload(await composeBlockFile({ b: 'inline', plugins: [{ name: 'p', version: '2.1', enabled: true }] }), 'plugins')],
        ['a main file that does not decode (the backup route)', async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
    ] as const)('T2-G2 guard: %s: the profile installs and nothing is written', async (_label, build) => {
        const store = legacyStore({ main: await build(), backups: [[OLDEST, encodeRisuSaveLegacy(baseDb({ mainPrompt: 'from-oldest-backup' }))]] })
        const run = await boot('node', store)

        await run.loadData()
        await settle()

        expect(get(run.loadedStore)).toBe(true)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('T2-G2 guard: the read-only notice is posted once, after the install', async () => {
        const store = legacyStore()
        const run = await boot('node', store)
        const { language } = await import('src/lang')

        await run.loadData()
        await settle()

        expect(run.notices).toEqual([language.store2Boot.noticeBackendUnavailable])
    })
})

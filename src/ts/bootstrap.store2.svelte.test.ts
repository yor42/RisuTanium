/**
 * `loadData()` (`src/ts/bootstrap.ts`) with the store2 boot dispatch registered, driven the way the sibling bootstrap
 * test files drive it: the real `loadData()`, the real dispatch, the real block-owner and read-only seams, and a
 * recording page store that holds the legacy files (the main file and a numbered backup set of 21, so a listing that
 * prunes has something to delete). The pass of the boot archive session is replaced by a session that writes a key if
 * it is ever opened and run, so a boot that opens it fails the "no store write" assertions.
 *
 * Reproducers: the capability and unavailable rows on a Node and a Tauri page fail against a seam that hands the legacy
 * profile back without the no-write switch (the disabled archive session, the disabled block owner, the non-pruning
 * backup listing); each is named with its mutant in the hand-back. Guards: the unregistered page runs the legacy boot.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import type { GuardedOperations } from 'src/ts/storage/store/contract'
import { StoreNotBinaryError } from 'src/ts/storage/store/errors'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import type { Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import type { Store2BootEnv, Store2BootNotice } from 'src/ts/storage/store2/bootActive'
import { checkUnit, unitMapSource } from 'src/ts/storage/store2/codec'
import { FRAME_HEADER_BYTES, keyOfRef, UNIT_TYPE, type Shard } from 'src/ts/storage/store2/format'
import type { FlaggedItem } from 'src/ts/storage/store2/leafFallback'
import { buildSmall, fakeLists } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, seedTree, testEnv, createPeerDouble } from 'src/ts/storage/tests/store2SaveKit'
import type { Database } from 'src/ts/storage/database.svelte'

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const archive = vi.hoisted(() => ({
    opened: 0,
    disabled: 0,
    ran: 0,
    store: null as null | { write(key: string, bytes: Uint8Array, condition: 'unconditional'): Promise<unknown> },
}))

const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const buildAssetKeepSetMock = vi.hoisted(() => vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })))
const getUncleanablesSyncMock = vi.hoisted(() => vi.fn((): string[] => []))
const verifyAssetCacheEntryMock = vi.hoisted(() => vi.fn(async () => ({ status: 'ok' as const })))
const loadPluginsMock = vi.hoisted(() => vi.fn(async () => { }))
const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const moduleUpdateMock = vi.hoisted(() => vi.fn(async () => { }))
const setUsingSwMock = vi.hoisted(() => vi.fn())
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))
const sleepForeverMock = vi.hoisted(() => vi.fn(async () => { }))
const putBackMock = vi.hoisted(() => vi.fn())
const recordCleanupMock = vi.hoisted(() => vi.fn())
const readColdStorageItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<{ status: 'missing' }> => ({ status: 'missing' })))

//#endregion

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(() => ({
            getItem: vi.fn(async () => null),
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
    // The database the boot installed, so the id repair of the boot tail acts on the installed characters.
    DBState: { get db() { return dbState.current } },
    LoadingStatusState: { text: '' },
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: loadPluginsMock,
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
    moduleUpdate: moduleUpdateMock,
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/memory/characterPutBack'), () => ({
    startCharacterPutBack: putBackMock,
}) as unknown as typeof import('src/ts/process/memory/characterPutBack'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/storage/startupCleanupState'), async (importOriginal) => ({
    ...await importOriginal(),
    recordStartupCleanup: recordCleanupMock,
}))

vi.mock(import('src/ts/storage/bootArchivePass'), () => {
    const install = async (input: { tree: unknown }) => {
        archive.ran += 1
        // What the pass does on a capable page: it writes. A boot that opens it on a page that must write nothing is caught here.
        await archive.store?.write('blocks/archive-pass-wrote', new Uint8Array([1]), 'unconditional')
        return { kind: 'install', tree: input.tree, noteBytes: null, notices: [] }
    }
    return {
        openBootArchiveSession: vi.fn(async () => {
            archive.opened += 1
            return { canArchive: true, run: install, release: vi.fn(async () => { }) }
        }),
        disabledBootArchiveSession: vi.fn(() => {
            archive.disabled += 1
            return {
                canArchive: false,
                run: async (input: { tree: unknown }) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] }),
                release: vi.fn(async () => { }),
            }
        }),
        checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
    } as unknown as typeof import('src/ts/storage/bootArchivePass')
})

vi.mock(import('src/ts/storage/assetIntegrity'), () => ({
    verifyAssetCacheEntry: verifyAssetCacheEntryMock,
}) as unknown as typeof import('src/ts/storage/assetIntegrity'))

vi.mock(import('src/ts/storage/remoteSaveCleanup'), () => ({
    getRemoteSaveCleanupAction: vi.fn(() => 'create-meta'),
    getRemoteSavePayloadName: vi.fn(() => null),
}) as unknown as typeof import('src/ts/storage/remoteSaveCleanup'))

vi.mock(import('src/ts/storage/assetSweep'), () => ({
    sweepTauriAssets: vi.fn(async () => { }),
    sweepForageAssetKey: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/storage/assetSweep'))

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

vi.mock(import('src/ts/storage/store/appStore'), async (importOriginal) => ({
    ...await importOriginal(),
    cleanUpCopiedBackOpfs: vi.fn(async () => { }),
    takeStorageFallbackNotice: () => null,
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
    buildAssetKeepSet: buildAssetKeepSetMock,
    getBasename: (p: string) => p.split('/').pop(),
    setUsingSw: setUsingSwMock,
    checkCharOrder: vi.fn(),
    getUncleanablesSync: getUncleanablesSyncMock,
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

//#endregion

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

const BACKUP_TIMES = Array.from({ length: 21 }, (_, i) => 1_700_000_000_000 + i * 1000)

function baseDb(): Record<string, unknown> {
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
    }
}
dbState.baseline = baseDb

interface UiDouble extends Store2BootUi {
    notices: Store2BootNotice[]
    blockedWith: { reason: string, detail: string }[]
    offered: (readonly number[])[]
    flaggedAsked: (readonly FlaggedItem[])[]
    flaggedAnswer: 'continue' | 'decline' | 'earlier'
    recoveries: number
    convertAsked: number
    convertAnswer: boolean
    declinedAsked: number
    incompleteAsked: number
    fromBackupAsked: number
}

function uiDouble(): UiDouble {
    const ui: UiDouble = {
        notices: [],
        blockedWith: [],
        offered: [],
        flaggedAsked: [],
        flaggedAnswer: 'continue',
        recoveries: 0,
        convertAsked: 0,
        convertAnswer: true,
        declinedAsked: 0,
        incompleteAsked: 0,
        fromBackupAsked: 0,
        peer: createPeerDouble(),
        notice(notice) { ui.notices.push(notice) },
        async blocked(blocked) { ui.blockedWith.push(blocked) },
        async offerRestoreOrImport(backups) { ui.offered.push(backups) },
        async confirmConvert() {
            ui.convertAsked += 1
            return ui.convertAnswer
        },
        async declined() {
            ui.declinedAsked += 1
            return 'import'
        },
        async confirmConvertWithout() {
            return 'decline'
        },
        async confirmFromBackup() {
            ui.fromBackupAsked += 1
            return 'convert'
        },
        async confirmIncomplete() {
            ui.incompleteAsked += 1
            return true
        },
        async confirmFlaggedOpen(items) {
            ui.flaggedAsked.push(items)
            return ui.flaggedAnswer
        },
        async foreignMarker() { return 'wait' },
        async recovery() { ui.recoveries += 1 },
    }
    return ui
}

/** The numbered backups the page holds, and the main file: a legacy profile the boot can decode. */
function legacyStore(options: { mainFile?: boolean } = {}): MemoryByteStore {
    const store = createMemoryByteStore()
    for (const time of BACKUP_TIMES) {
        store.files.set(`database/dbbackup-${time}.bin`, encodeRisuSaveLegacy(baseDb()))
    }
    if (options.mainFile !== false) {
        store.files.set('database/database.bin', encodeRisuSaveLegacy(baseDb()))
    }
    return store
}

function backupTimesOf(store: MemoryByteStore): number[] {
    return [...store.files.keys()]
        .map(key => /^database\/dbbackup-(\d+)\.bin$/.exec(key))
        .filter((match): match is RegExpExecArray => match !== null)
        .map(match => Number(match[1]))
        .sort((a, b) => b - a)
}

/** A `getDbBackups` that really prunes: it keeps the newest 20 and deletes the rest through the page store. */
function pruningBackups(store: MemoryByteStore): void {
    getDbBackupsMock.mockImplementation(async () => {
        const times = backupTimesOf(store)
        for (const old of times.slice(20)) {
            await store.delete(`database/dbbackup-${old}.bin`, 'unconditional')
        }
        return times.slice(0, 20)
    })
}

function guardedOps(capable: boolean): GuardedOperations {
    const unused = async () => { throw new Error('not used') }
    return {
        probe: async () => ({ checkOnly: capable, retire: capable, pieces: false }),
        writeChecked: unused,
        removeChecked: unused,
        retireChecked: unused,
    }
}

interface Boot {
    loadData: () => Promise<void>
    loadedStore: ReturnType<typeof writable<boolean>>
    alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
    ui: UiDouble
    store: MemoryByteStore
    backend: MemoryBackend
}

interface BootOptions {
    kind: AppStoreKind
    store?: MemoryByteStore
    /** Register the real dispatch with a memory backend injected in place of the one the store kind builds. */
    injectBackend?: boolean
    /** Register no dispatch at all. */
    unregistered?: boolean
    tauri?: boolean
}

/** Imports a fresh `loadData` and the matching module pair, injects the page store, and registers the dispatch. */
async function boot(options: BootOptions): Promise<Boot> {
    platformState.isTauri = options.tauri === true
    const store = options.store ?? legacyStore()
    archive.store = store
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    injectAppStore(store, options.kind)
    const backend = createMemoryBackend()
    const ui = uiDouble()
    if (options.unregistered !== true) {
        const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
        const { dispatchStore2Boot } = await import('src/ts/storage/store2/bootDispatch')
        registerStore2Boot((env) => dispatchStore2Boot(env, {
            ui,
            kind: options.kind,
            backend: options.injectBackend === true ? async () => backend : undefined,
            keyEnv: testEnv(createClock(), 9001),
            lists: fakeLists,
        }))
    }
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, loadedStore, alertStore, ui, store, backend }
}

/** Acknowledges every notice the boot posts and returns their texts, in order. */
function acknowledgeNotices(alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>): string[] {
    const seen: string[] = []
    alertStore.subscribe((value) => {
        if (value.type === 'normal') {
            seen.push(value.msg)
            queueMicrotask(() => alertStore.set({ type: 'none', msg: '' }))
        }
    })
    return seen
}

async function settle(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
    localStorage.clear()
    platformState.isTauri = false
    platformState.isNodeServer = false
    archive.opened = 0
    archive.disabled = 0
    archive.ran = 0
    archive.store = null
    getDbBackupsMock.mockReset().mockResolvedValue([])
    buildAssetKeepSetMock.mockReset().mockResolvedValue({ uncleanable: new Set(), complete: true })
    getUncleanablesSyncMock.mockReset().mockReturnValue([])
    verifyAssetCacheEntryMock.mockReset().mockResolvedValue({ status: 'ok' })
    loadPluginsMock.mockReset().mockResolvedValue(undefined)
    saveDbMock.mockReset().mockResolvedValue(undefined)
    moduleUpdateMock.mockReset().mockResolvedValue(undefined)
    setUsingSwMock.mockReset()
    sleepForeverMock.mockReset().mockResolvedValue(undefined)
    putBackMock.mockReset()
    recordCleanupMock.mockReset()
    readColdStorageItemMock.mockClear()
    dbState.current = baseDb()
    setDatabaseMock.mockClear()
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => { dbState.current = { ...dbState.baseline(), ...data } })
    getDatabaseMock.mockClear()
    getDatabaseMock.mockImplementation(() => dbState.current)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

/** Everything the boot wrote or deleted in the page store, the Tauri owner id excepted. */
function storeEffects(store: MemoryByteStore): { writes: string[], deletes: string[] } {
    return { writes: store.writes.filter(key => key !== 'store2-owner'), deletes: [...store.deletes] }
}

describe('loadData(): a legacy profile on a page whose store2 backend is not available is opened read-only (reproducers)', () => {
    const notBinary = (store: MemoryByteStore) => store

    test('a Node server without the check-only route: the legacy profile loads, with no archive pass, no block owner, no write and no delete', async () => {
        const store = notBinary(legacyStore())
        store.guarded = guardedOps(false)
        const { loadData, alertStore, loadedStore, ui } = await boot({ kind: 'node', store })
        const { language } = await import('src/lang')
        const shown = acknowledgeNotices(alertStore)

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalled()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(store.files.has('blocks/archive-pass-wrote')).toBe(false)
        expect(archive.opened).toBe(0)
        expect(archive.disabled).toBe(1)
        expect(ui.notices).toEqual([expect.objectContaining({ name: 'server-capability' })])
        expect(shown).not.toContain(language.opfsReadOnlyNotice)
        const { canBootArchive } = await import('src/ts/process/memory/bootArchiveState')
        expect(canBootArchive()).toBe(false)
        const { getPageBlockOwner } = await import('src/ts/storage/pageBlockOwner')
        expect(await getPageBlockOwner()).toBeNull()
        const { refuseOnReadOnlyPage } = await import('src/ts/storage/readOnlyPage')
        expect(await refuseOnReadOnlyPage()).toBe(true)
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'read-only' })
        expect(saveDbMock).not.toHaveBeenCalled()
        expect(getDbBackupsMock).not.toHaveBeenCalled()
    })

    test('a Node page with no guarded operations at all: the same, with the other named notice', async () => {
        const store = legacyStore()
        const { loadData, alertStore, loadedStore, ui } = await boot({ kind: 'node', store })
        acknowledgeNotices(alertStore)

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(archive.opened).toBe(0)
        expect(ui.notices).toEqual([expect.objectContaining({ name: 'backend-unavailable' })])
        const { getPageBlockOwner } = await import('src/ts/storage/pageBlockOwner')
        expect(await getPageBlockOwner()).toBeNull()
    })

    test('a Tauri page whose store2 backend is unavailable: the legacy profile loads, the 21 numbered backups all stand, and nothing is written but the owner id', async () => {
        const store = legacyStore()
        pruningBackups(store)
        const { loadData, loadedStore, ui } = await boot({ kind: 'tauri', store, tauri: true })

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(true)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(store.writes).toContain('store2-owner')
        expect(backupTimesOf(store)).toEqual([...BACKUP_TIMES].reverse())
        expect(getDbBackupsMock, 'the pruning listing is not used').not.toHaveBeenCalled()
        expect(archive.opened).toBe(0)
        expect(archive.disabled).toBe(1)
        expect(ui.notices).toEqual([expect.objectContaining({ name: 'backend-unavailable' })])
        const { getPageBlockOwner } = await import('src/ts/storage/pageBlockOwner')
        expect(await getPageBlockOwner()).toBeNull()
    })

    test('a store2 profile on a store this page cannot write is never replaced by the legacy profile', async () => {
        const store = legacyStore()
        store.guarded = guardedOps(false)
        store.files.set('store2-commit', new Uint8Array([1]))
        const { loadData, loadedStore, ui } = await boot({ kind: 'node', store })

        await loadData()

        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(sleepForeverMock).toHaveBeenCalled()
        expect(ui.blockedWith).toEqual([expect.objectContaining({ reason: 'store2-profile-unwritable' })])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(archive.opened).toBe(0)
    })
})

describe('loadData(): the transitional OPFS page is read-only legacy (guard on the old behaviour, through the dispatch)', () => {
    test('it loads the legacy profile, posts the OPFS notice and the dispatch says nothing, and writes nothing', async () => {
        const store = legacyStore()
        const { loadData, alertStore, loadedStore, ui } = await boot({ kind: 'opfs-transitional', store })
        const { language } = await import('src/lang')
        const shown = acknowledgeNotices(alertStore)

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(shown).toEqual([language.opfsReadOnlyNotice])
        expect(ui.notices).toEqual([])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(archive.opened).toBe(0)
    })
})

describe('loadData(): a normal store2 profile', () => {
    async function storeTwoRig(tauri: boolean) {
        const store = legacyStore()
        const run = await boot({ kind: tauri ? 'tauri' : 'indexeddb', store, injectBackend: true, tauri })
        await seedTree(run.backend, JSON.parse(JSON.stringify(buildSmall(2))) as Database, testEnv(createClock(), 4242), fakeLists)
        return run
    }

    test.each([[false], [true]])('opens: the database is installed, the save context is active, and no legacy writer runs (Tauri: %s)', async (tauri) => {
        const { loadData, alertStore, loadedStore, store } = await storeTwoRig(tauri)
        pruningBackups(store)
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalled()
        const installed = setDatabaseMock.mock.calls[0][0] as { characters: { name: string }[] }
        expect(installed.characters.map(character => character.name)).toEqual(['Small 0', 'Small 1'])
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).not.toBeNull()
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        expect(archive.opened).toBe(0)
        expect(archive.disabled).toBe(0)
        const { canBootArchive } = await import('src/ts/process/memory/bootArchiveState')
        expect(canBootArchive()).toBe(false)
        expect(putBackMock, 'no cold-storage put-back').not.toHaveBeenCalled()
        expect(recordCleanupMock, 'no legacy clean-up').not.toHaveBeenCalled()
        expect(getDbBackupsMock, 'no backup pruning').not.toHaveBeenCalled()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(backupTimesOf(store)).toHaveLength(21)
        const { getPageBlockOwner } = await import('src/ts/storage/pageBlockOwner')
        expect(await getPageBlockOwner()).toBeNull()
        expect(saveDbMock, 'the save loop starts through saveDb after the install').toHaveBeenCalled()
    })
})

describe('loadData(): a store2 profile whose chats have damaged cores', () => {
    function flipPayload(bytes: Uint8Array): Uint8Array {
        const out = new Uint8Array(bytes)
        out[FRAME_HEADER_BYTES + 1] ^= 0xff
        return out
    }

    /** One character with a stable-id chat and a chat with no id (positional handle), both cores damaged. */
    async function damagedRig(answer: 'continue' | 'decline' | 'earlier') {
        const store = legacyStore()
        const run = await boot({ kind: 'indexeddb', store, injectBackend: true })
        run.ui.flaggedAnswer = answer
        const db = JSON.parse(JSON.stringify(buildSmall(1))) as { characters: { chats: { id: string }[] }[] }
        const stableId = db.characters[0].chats[0].id
        db.characters[0].chats[1].id = ''
        const seeded = await seedTree(run.backend, db as unknown as Database, testEnv(createClock(), 4242), fakeLists)
        const source = unitMapSource(seeded.tree.units)
        const entries = seeded.tree.manifest.shards.flatMap((ref) => {
            const checked = checkUnit(source, ref, UNIT_TYPE.shard)
            return checked.status === 'ok' ? (checked.body as Shard).entries : []
        })
        const entry = entries[0]
        expect(entry.chats.map(chat => chat.cid)).toEqual([stableId, '~1'])
        for (const chat of entry.chats) {
            const key = keyOfRef(chat.core)
            run.backend.poke(key, flipPayload(run.backend.snapshot().get(key) as Uint8Array))
        }
        return { ...run, store, stableId }
    }

    test('continue: the profile opens, the stable chat keeps its id, and the positional chat is given a fresh one', async () => {
        const { loadData, alertStore, loadedStore, ui, store, stableId } = await damagedRig('continue')
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(true)
        expect(ui.flaggedAsked).toHaveLength(1)
        expect(ui.flaggedAsked[0].map(item => item.name)).toEqual(['Small 0', 'Small 0'])
        const installed = setDatabaseMock.mock.calls[0][0] as { characters: { chats: { id: string, message: { data: string }[] }[] }[] }
        const [stable, positional] = installed.characters[0].chats
        expect(stable.id).toBe(stableId)
        expect(positional.id).toEqual(expect.any(String))
        expect(positional.id).not.toBe('')
        expect(positional.id.startsWith('~')).toBe(false)
        expect(stable.message[0].data.startsWith('[Cold storage data could not be loaded. Key: ')).toBe(true)
        expect(positional.message[0].data.startsWith('[Cold storage data could not be loaded. Key: ')).toBe(true)
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).not.toBeNull()
        expect(saveDbMock).toHaveBeenCalled()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('decline: the page waits, nothing is installed, nothing is written and the save loop never starts', async () => {
        const { loadData, loadedStore, ui, store } = await damagedRig('decline')

        await loadData()
        await settle()

        expect(ui.flaggedAsked).toHaveLength(1)
        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(saveDbMock).not.toHaveBeenCalled()
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).toBeNull()
    })

    test('earlier: the recovery screen is shown, the page waits, and nothing is installed or written', async () => {
        const { loadData, loadedStore, ui, store } = await damagedRig('earlier')

        await loadData()
        await settle()

        expect(ui.recoveries).toBe(1)
        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(saveDbMock).not.toHaveBeenCalled()
    })
})
describe('loadData(): a boot the dispatch stops', () => {
    test.each([[false], [true]])('the profile is not installed, loadedStore stays unset, the page waits, and nothing is written (Tauri: %s)', async (tauri) => {
        // A legacy main file with no store2 profile whose conversion the user declines: the dispatch stops.
        const store = legacyStore()
        pruningBackups(store)
        const { loadData, loadedStore, ui } = await boot({ kind: tauri ? 'tauri' : 'indexeddb', store, injectBackend: true, tauri })
        ui.convertAnswer = false

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(ui.convertAsked).toBe(1)
        expect(ui.declinedAsked).toBe(1)
        expect(ui.notices).toEqual([])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(archive.opened).toBe(0)
        expect(getDbBackupsMock).not.toHaveBeenCalled()
        expect(backupTimesOf(store)).toHaveLength(21)
        expect(saveDbMock).not.toHaveBeenCalled()
    })
})

describe('loadData(): the main file predicate the dispatch is given', () => {
    test('a main file that exists is a legacy profile to convert, never a store to seed', async () => {
        const { loadData, ui, backend } = await boot({ kind: 'indexeddb', injectBackend: true })
        ui.convertAnswer = false
        await loadData()
        expect(ui.convertAsked).toBe(1)
        expect(ui.notices).toEqual([])
        expect((await backend.readCommit()).bytes).toBeNull()
    })

    test('a main file the store holds but cannot hand out as bytes is still a legacy profile: it is never seeded over', async () => {
        const store = legacyStore()
        const read = store.read.bind(store)
        store.read = async (key) => {
            if (key === 'database/database.bin') {
                throw new StoreNotBinaryError(key)
            }
            return read(key)
        }
        const { loadData, ui, backend } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        ui.convertAnswer = false
        await loadData()
        expect(ui.convertAsked).toBe(1)
        expect(ui.notices).toEqual([])
        expect(ui.blockedWith).toEqual([])
        expect((await backend.readCommit()).bytes).toBeNull()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('no main file and no numbered backup seeds an empty store2 profile and opens it', async () => {
        const store = createMemoryByteStore()
        const { loadData, alertStore, loadedStore, ui, backend } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        acknowledgeNotices(alertStore)
        await loadData()
        expect(ui.notices).toEqual([{ name: 'seeded' }])
        expect(get(loadedStore)).toBe(true)
        expect((await backend.readCommit()).bytes).not.toBeNull()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('numbered backups and no main file are offered, never seeded over, and listing them prunes nothing (21 stand)', async () => {
        const store = legacyStore({ mainFile: false })
        pruningBackups(store)
        const { loadData, ui, backend, loadedStore } = await boot({ kind: 'indexeddb', store, injectBackend: true })

        await loadData()
        await settle()

        expect(ui.offered).toEqual([[...BACKUP_TIMES].reverse()])
        expect(get(loadedStore)).toBe(false)
        expect((await backend.readCommit()).bytes).toBeNull()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(backupTimesOf(store)).toHaveLength(21)
        expect(getDbBackupsMock, 'the pruning listing is not used').not.toHaveBeenCalled()
    })

    test('a main file check that fails stops the boot with a named block, never read as absent', async () => {
        const store = legacyStore()
        store.has = async () => { throw new Error('cannot tell') }
        const { loadData, ui, backend, loadedStore } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        await loadData()
        expect(ui.blockedWith).toEqual([expect.objectContaining({ reason: 'main-file-unknown' })])
        expect(get(loadedStore)).toBe(false)
        expect((await backend.readCommit()).bytes).toBeNull()
    })
})

describe('loadData(): a legacy profile is converted through the real decoders', () => {
    test.each([[false], [true]])('the strict decode of the main file converts it: the profile opens as store2, the old files and 21 backups stand untouched (Tauri: %s)', async (tauri) => {
        const store = legacyStore()
        pruningBackups(store)
        const before = new Map(store.files)
        const { loadData, alertStore, loadedStore, ui, backend } = await boot({ kind: tauri ? 'tauri' : 'indexeddb', store, injectBackend: true, tauri })
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        expect(ui.convertAsked).toBe(1)
        expect(ui.incompleteAsked).toBe(0)
        expect(get(loadedStore)).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalled()
        expect((await backend.readCommit()).bytes).not.toBeNull()
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).not.toBeNull()
        // The memory backend never confirms a flush, so a Tauri page's re-flush is unconfirmed here; that is the only notice.
        expect(ui.notices).toEqual(tauri ? [{ name: 'flush-unconfirmed' }] : [])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(new Map(store.files).size).toBe(before.size + (tauri ? 1 : 0))
        for (const [key, bytes] of before) {
            expect(store.files.get(key)).toEqual(bytes)
        }
        expect(getDbBackupsMock, 'no backup pruning').not.toHaveBeenCalled()
        expect(archive.opened).toBe(0)
        expect(putBackMock).not.toHaveBeenCalled()
    })

    test('a main file that does not decode is converted from the newest numbered backup that does, and the notice names it', async () => {
        const store = legacyStore()
        store.files.set('database/database.bin', new Uint8Array([0, 1, 2, 3, 4, 5]))
        const { loadData, alertStore, loadedStore, ui } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(true)
        expect(ui.notices).toEqual([{ name: 'converted-from-backup', backup: BACKUP_TIMES[BACKUP_TIMES.length - 1] }])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(store.files.get('database/database.bin')).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5]))
    })

    test('the environment hands the dispatch the page\'s own cold-unit reader', async () => {
        const store = legacyStore()
        const unit = '00000000-0000-4000-8000-0000000000d1'
        const { loadData } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
        const handed: { env: Store2BootEnv | null } = { env: null }
        registerStore2Boot(async (env) => {
            handed.env = env
            return { kind: 'stopped' }
        })

        await loadData()

        expect(handed.env).not.toBeNull()
        expect(await handed.env?.readColdStorageItem(unit)).toEqual({ status: 'missing' })
        expect(readColdStorageItemMock).toHaveBeenCalledWith(unit)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('when nothing decodes the page stops with a named block and nothing is written', async () => {
        const store = createMemoryByteStore()
        store.files.set('database/database.bin', new Uint8Array([0, 1, 2, 3, 4, 5]))
        store.files.set('database/dbbackup-1700000000000.bin', new Uint8Array([9, 9, 9]))
        const { loadData, loadedStore, ui, backend } = await boot({ kind: 'indexeddb', store, injectBackend: true })

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(false)
        expect(ui.blockedWith).toEqual([expect.objectContaining({ reason: 'convert-lenient-failed' })])
        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect((await backend.readCommit()).bytes).toBeNull()
    })
})

describe('loadData(): a page that registered no dispatch boots the legacy profile as it always has (guard, passes before and after)', () => {
    test('the archive session is opened and run, and the profile loads', async () => {
        const store = legacyStore()
        const { loadData, loadedStore } = await boot({ kind: 'tauri', store, unregistered: true })

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(archive.opened).toBe(1)
        expect(archive.disabled).toBe(0)
        expect(setDatabaseMock).toHaveBeenCalled()
        expect(sleepForeverMock).not.toHaveBeenCalled()
        expect(putBackMock).toHaveBeenCalled()
        expect(recordCleanupMock).toHaveBeenCalled()
    })
})

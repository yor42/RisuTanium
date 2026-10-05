/**
 * New-behaviour tests (the notice and its reasons are new) and a compatibility
 * guard (no notice, no alert). A page that runs from OPFS because the copy back
 * into IndexedDB could not run must not boot silently: `loadData()` in
 * `src/ts/bootstrap.ts`, non-Tauri branch, posts one notice and pauses until it
 * is acknowledged. Drives the REAL `loadData()` the same way
 * `bootstrap.staleAccountProfile.svelte.test.ts` does.
 *
 * The decision behind the notice (`resolveWebStore`, `appStore.ts`) is covered by
 * `storage/tests/opfsCopyBack.test.ts` and `storage/tests/appStore.copyBack.test.ts`;
 * this file only drives `bootstrap.ts`'s own reaction to
 * `takeStorageFallbackNotice()`, which is overridden below to hand out a notice
 * a test sets directly.
 *
 * `alert.ts` is real (a thin wrapper), so this file observes `alertStore`
 * (from the mocked `stores.svelte` below) as the effect of whichever prompt
 * function `loadData()` calls: a notice is posted, boot pauses until it is
 * acknowledged, the "error" reason's text carries its detail, and different
 * reasons carry different text. Acknowledgement is simulated the way
 * `AlertComp.svelte`'s own OK button resolves a `'normal'` alert: writing
 * `{ type: 'none', msg: '' }` back onto the shared store.
 *
 * Everything else `bootstrap.ts` imports is mocked, mirroring the sibling
 * bootstrap test files.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { FallbackNotice } from 'src/ts/storage/opfsCopyBack'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

type FallbackReason = FallbackNotice['reason']

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const forageState = vi.hoisted(() => ({
    staleAccountProfile: false,
    fallbackNotice: null as FallbackNotice | null,
    items: new Map<string, Uint8Array | (() => Uint8Array)>(),
}))

const cleanUpMock = vi.hoisted(() => vi.fn(async () => { }))
const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const buildAssetKeepSetMock = vi.hoisted(() => vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })))
const getUncleanablesSyncMock = vi.hoisted(() => vi.fn((): string[] => []))
const verifyAssetCacheEntryMock = vi.hoisted(() => vi.fn(async () => ({ status: 'ok' as const })))
const loadPluginsMock = vi.hoisted(() => vi.fn(async () => { }))
const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const moduleUpdateMock = vi.hoisted(() => vi.fn(async () => { }))
const markAppInitiatedReloadMock = vi.hoisted(() => vi.fn())
const setUsingSwMock = vi.hoisted(() => vi.fn())
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))

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
    sleepForever: vi.fn(async () => { }),
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: markAppInitiatedReloadMock,
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
    DBState: { db: {} as Record<string, unknown> },
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

vi.mock(import('src/ts/storage/bootArchivePass'), () => ({
    openBootArchiveSession: vi.fn(async () => ({
        canArchive: false,
        run: vi.fn(async (input: { tree: unknown }) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] })),
        release: vi.fn(async () => { }),
    })),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

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

const fsStore = new Map<string, Uint8Array>()

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async (path: string) => fsStore.has(path)),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async (path: string) => {
        if (!fsStore.has(path)) {
            throw new Error(`ENOENT (mock): ${path}`)
        }
        return fsStore.get(path)!
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => { fsStore.set(path, data) }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async (path: string) => { fsStore.delete(path) }),
}))

vi.mock(import('src/ts/storage/store/appStore'), async (importOriginal) => ({
    ...await importOriginal(),
    cleanUpCopiedBackOpfs: cleanUpMock,
    takeStorageFallbackNotice: () => {
        const notice = forageState.fallbackNotice
        forageState.fallbackNotice = null
        return notice
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        get staleAccountProfile() { return forageState.staleAccountProfile },
        set staleAccountProfile(v: boolean) { forageState.staleAccountProfile = v },
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async (key: string) => {
            const entry = forageState.items.get(key)
            if (entry === undefined) {
                return null
            }
            return typeof entry === 'function' ? entry() : entry
        }),
        // A boot that finds no save creates the first profile in the block store, which reads back what it wrote.
        setItem: vi.fn(async (key: string, value: Uint8Array) => { forageState.items.set(key, value) }),
        keys: vi.fn(async (): Promise<string[]> => Array.from(forageState.items.keys())),
        removeItem: vi.fn(async (key: string) => { forageState.items.delete(key) }),
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

// Real and stable across every reset below (a pure, dependency-light module
// this file never mocks).
const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

/** Base database fixture: enough fields for `checkNewFormat()` to run without throwing, and no format-migration branch to trigger. */
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

/** Arms the non-Tauri database read so `loadData()` installs `db` on its ordinary decode path. */
function armDecode(db: Record<string, unknown>) {
    forageState.items.set('database/database.bin', encodeRisuSaveLegacy(db))
}

/** Imports a fresh `loadData` and the matching `stores.svelte` pair, after `vi.resetModules()`. */
async function freshLoadData() {
    // The boot reads through the page's byte store; here it is the storage-object model above.
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'tauri')
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    // The mocked stores.svelte module survives vi.resetModules(), so a value
    // left by an earlier test survives into the next import -- reset it
    // explicitly rather than relying on a fresh instance.
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore }
}

beforeEach(() => {
    localStorage.clear()
    fsStore.clear()
    forageState.staleAccountProfile = false
    forageState.fallbackNotice = null
    forageState.items.clear()
    dbState.current = baseDb()
    platformState.isTauri = false
    platformState.isNodeServer = false
    cleanUpMock.mockClear()
    getDbBackupsMock.mockReset().mockResolvedValue([])
    buildAssetKeepSetMock.mockReset().mockResolvedValue({ uncleanable: new Set(), complete: true })
    getUncleanablesSyncMock.mockReset().mockReturnValue([])
    verifyAssetCacheEntryMock.mockReset().mockResolvedValue({ status: 'ok' })
    loadPluginsMock.mockReset().mockResolvedValue(undefined)
    saveDbMock.mockReset().mockResolvedValue(undefined)
    moduleUpdateMock.mockReset().mockResolvedValue(undefined)
    markAppInitiatedReloadMock.mockReset()
    setUsingSwMock.mockReset()
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

describe('loadData(): no storage fallback notice recorded (compatibility guard)', () => {
    test('boots straight through to loadedStore true, posting no alert at all, when no fallback notice is recorded', async () => {
        armDecode(baseDb())
        forageState.fallbackNotice = null
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const seenTypes: string[] = []
        const unsubscribe = alertStore.subscribe((v) => seenTypes.push(v.type))

        await loadData()
        unsubscribe()

        expect(get(loadedStore)).toBe(true)
        expect(setUsingSwMock).toHaveBeenCalled()
        expect(seenTypes.filter((t) => t !== 'none')).toEqual([])
    })
})

describe('loadData(): a storage fallback notice pauses boot until acknowledged (new-behaviour test)', () => {
    const reasons: FallbackReason[] = ['space', 'tab', 'noIndexedDb', 'error']

    for (const reason of reasons) {
        test(`reason "${reason}": an alert is posted, boot does not continue past it, and continues once acknowledged`, async () => {
            armDecode(baseDb())
            forageState.fallbackNotice = { reason, detail: reason === 'error' ? 'notice-detail-marker' : undefined }
            const { loadData, alertStore, loadedStore } = await freshLoadData()

            const loadPromise = loadData()
            try {
                await vi.waitFor(() => {
                    if (get(alertStore).type === 'none') {
                        throw new Error(`expected a fallback notice for reason "${reason}" to be showing`)
                    }
                }, { timeout: 500, interval: 5 })

                // Boot must not have reached the steps that follow the
                // notice's place in loadData() while it is still pending.
                expect(get(loadedStore)).toBe(false)
                expect(setUsingSwMock).not.toHaveBeenCalled()

                // Acknowledges the notice the way AlertComp's OK button does:
                // it writes `{ type: 'none', msg: '' }` to the alert store.
                alertStore.set({ type: 'none', msg: '' })

                await loadPromise
                expect(get(loadedStore)).toBe(true)
                expect(setUsingSwMock).toHaveBeenCalled()
            } finally {
                alertStore.set({ type: 'none', msg: '' })
                await loadPromise.catch(() => { })
            }
        })
    }
})

describe('loadData(): the storage fallback notice text is reason-specific (new-behaviour test)', () => {
    test('the "error" reason\'s text carries the detail, and differs from the "space" reason\'s text', async () => {
        armDecode(baseDb())
        forageState.fallbackNotice = { reason: 'error', detail: 'notice-detail-marker' }
        const errorRun = await freshLoadData()
        const errorLoadPromise = errorRun.loadData()
        let errorMsg: string
        try {
            await vi.waitFor(() => {
                if (get(errorRun.alertStore).type === 'none') {
                    throw new Error('expected the "error" reason notice to be showing')
                }
            }, { timeout: 500, interval: 5 })
            errorMsg = get(errorRun.alertStore).msg
        } finally {
            errorRun.alertStore.set({ type: 'none', msg: '' })
            await errorLoadPromise.catch(() => { })
        }

        vi.resetModules()
        armDecode(baseDb())
        forageState.fallbackNotice = { reason: 'space' }
        const spaceRun = await freshLoadData()
        const spaceLoadPromise = spaceRun.loadData()
        let spaceMsg: string
        try {
            await vi.waitFor(() => {
                if (get(spaceRun.alertStore).type === 'none') {
                    throw new Error('expected the "space" reason notice to be showing')
                }
            }, { timeout: 500, interval: 5 })
            spaceMsg = get(spaceRun.alertStore).msg
        } finally {
            spaceRun.alertStore.set({ type: 'none', msg: '' })
            await spaceLoadPromise.catch(() => { })
        }

        expect(errorMsg).toContain('notice-detail-marker')
        expect(spaceMsg).not.toBe(errorMsg)
    })
})

describe('loadData(): the storage fallback notice is posted only after setDatabase() runs (new-behaviour test)', () => {
    test('setDatabase() is called strictly before the notice reaches alertStore, so the notice shows in the language setDatabase() selects', async () => {
        armDecode(baseDb())
        forageState.fallbackNotice = { reason: 'space' }
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alertSetSpy = vi.spyOn(alertStore, 'set')

        const loadPromise = loadData()
        try {
            await vi.waitFor(() => {
                const hasNotice = alertSetSpy.mock.calls.some(([v]) => v.type !== 'none')
                if (!hasNotice) {
                    throw new Error('expected a fallback notice call on alertStore.set')
                }
            }, { timeout: 500, interval: 5 })

            const noticeCallIndex = alertSetSpy.mock.calls.findIndex(([v]) => v.type !== 'none')
            expect(setDatabaseMock.mock.invocationCallOrder.length).toBeGreaterThan(0)
            expect(alertSetSpy.mock.invocationCallOrder[noticeCallIndex])
                .toBeGreaterThan(setDatabaseMock.mock.invocationCallOrder[0])

            alertStore.set({ type: 'none', msg: '' })
            await loadPromise
            expect(get(loadedStore)).toBe(true)
        } finally {
            alertSetSpy.mockRestore()
            alertStore.set({ type: 'none', msg: '' })
            await loadPromise.catch(() => { })
        }
    })
})

describe('loadData(): the OPFS leftovers clean-up is started only after the main file decoded (new-behaviour test)', () => {
    test('a boot that decoded the main file starts the clean-up once, without waiting for it', async () => {
        armDecode(baseDb())
        let finishCleanUp: () => void = () => { }
        cleanUpMock.mockImplementation(() => new Promise<void>((resolve) => { finishCleanUp = resolve }))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(cleanUpMock).toHaveBeenCalledTimes(1)
        finishCleanUp()
    })

    test('a boot that fell back to a numbered backup because the main file would not decode does not start the clean-up', async () => {
        forageState.items.set('database/database.bin', new Uint8Array([1, 2, 3]))
        forageState.items.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb()))
        getDbBackupsMock.mockResolvedValue([1])
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(cleanUpMock).not.toHaveBeenCalled()
    })

    test('new behaviour: a boot that found no main file and seeded an empty one does not start the clean-up', async () => {
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(cleanUpMock).not.toHaveBeenCalled()
    })
})

describe('loadData(): a page that runs from OPFS this time is read-only (new-behaviour test)', () => {
    /** The page's store becomes the transitional OPFS store, whatever it was injected as. */
    async function asOpfsPage(): Promise<{ writes: ReturnType<typeof vi.fn> }> {
        const { injectAppStore } = await import('src/ts/storage/store/appStore')
        const { forageStorage } = await import('src/ts/globalApi.svelte')
        injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'opfs-transitional')
        return { writes: forageStorage.setItem as unknown as ReturnType<typeof vi.fn> }
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

    test('an existing main file boots as it did, shows the read-only notice after the fallback notice, and writes nothing', async () => {
        const { language } = await import('src/lang')
        armDecode(baseDb())
        forageState.fallbackNotice = { reason: 'tab' }
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const { writes } = await asOpfsPage()
        const seen = acknowledgeNotices(alertStore)
        writes.mockClear()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(seen).toEqual([language.opfsFallbackNoticeTab, language.opfsReadOnlyNotice])
        expect(writes).not.toHaveBeenCalled()
    })

    test('a missing main file installs an empty profile without writing it', async () => {
        forageState.fallbackNotice = { reason: 'tab' }
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const { writes } = await asOpfsPage()
        acknowledgeNotices(alertStore)
        writes.mockClear()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalled()
        expect(writes, 'no seed is written into OPFS').not.toHaveBeenCalled()
        expect(forageState.items.has('database/database.bin')).toBe(false)
        expect(forageState.items.has('blocks/head')).toBe(false)
    })

    test('the whole boot, with its startup clean-up, the first save and the backup fallback, performs no store write or delete', async () => {
        const { forageStorage } = await import('src/ts/globalApi.svelte')
        forageState.items.set('database/database.bin', new Uint8Array([9, 9, 9]))
        forageState.items.set('database/dbbackup-100.bin', encodeRisuSaveLegacy(baseDb()))
        forageState.items.set('assets/orphan.png', new Uint8Array([1]))
        forageState.items.set('remotes/gone.local.bin', new Uint8Array([1]))
        forageState.fallbackNotice = { reason: 'tab' }
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        await asOpfsPage()
        acknowledgeNotices(alertStore)
        const removes = forageStorage.removeItem as unknown as ReturnType<typeof vi.fn>
        const sets = forageStorage.setItem as unknown as ReturnType<typeof vi.fn>
        removes.mockClear()
        sets.mockClear()

        await loadData()
        const { getStartupCleanup } = await import('src/ts/storage/startupCleanupState')
        await (getStartupCleanup() ?? Promise.resolve())

        expect(get(loadedStore)).toBe(true)
        expect(sets, 'no write').not.toHaveBeenCalled()
        expect(removes, 'no delete').not.toHaveBeenCalled()
        expect(buildAssetKeepSetMock, 'no asset sweep').not.toHaveBeenCalled()
        expect(saveDbMock, 'no first save').not.toHaveBeenCalled()
        expect(getDbBackupsMock, 'the pruning backup listing is not used').not.toHaveBeenCalled()
        expect(forageState.items.has('database/dbbackup-100.bin')).toBe(true)
    })

    test('the boot never builds a block-store owner for the page', async () => {
        armDecode(baseDb())
        forageState.fallbackNotice = { reason: 'space' }
        const { loadData, alertStore } = await freshLoadData()
        await asOpfsPage()
        acknowledgeNotices(alertStore)

        await loadData()

        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'read-only' })
    })
})
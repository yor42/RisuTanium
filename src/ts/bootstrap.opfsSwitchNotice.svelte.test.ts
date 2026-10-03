/**
 * CHORE-39, O1 (Agents/Reports/30-chore39-opfs-migration-plan.md): a boot that
 * could not complete the OPFS switch must not boot silently on LocalForage.
 * Drives the REAL `loadData()` from `src/ts/bootstrap.ts`, non-Tauri branch,
 * the same way `bootstrap.staleAccountProfile.svelte.test.ts` does.
 *
 * `AutoStorage` itself (the real detection logic behind `opfsSwitchNotice`)
 * is out of scope here and covered by `storage/tests/autoStorage.opfsMigration.test.ts`;
 * this file only drives `bootstrap.ts`'s own reaction to the field, so
 * `forageStorage.opfsSwitchNotice` is set directly on the mock below, exactly
 * as `bootstrap.staleAccountProfile.svelte.test.ts` sets
 * `forageStorage.staleAccountProfile` directly rather than through a real
 * `Init()` call.
 *
 * `alert.ts` is real (a thin wrapper), so this file observes `alertStore`
 * (from the mocked `stores.svelte` below) as the effect of whichever prompt
 * function `loadData()` calls, instead of spying on that function by name --
 * the exact alert type and copy are not fixed by the plan, only the
 * behaviour: a notice is posted, boot pauses until it is acknowledged, the
 * "error" reason's text carries its detail, and different reasons carry
 * different text. Acknowledgement is simulated the way `AlertComp.svelte`'s
 * own OK button resolves an `'error'`/`'normal'`/`'markdown'` alert: writing
 * `{ type: 'none', msg: '' }` back onto the shared store.
 *
 * Everything else `bootstrap.ts` imports is mocked, mirroring the sibling
 * bootstrap test files: `globalApi.svelte`, `storage/database.svelte`,
 * `platform`, `util`, `reloadGuard`, `update`, `stores.svelte`,
 * `plugins/plugins.svelte`, `characterCards`, `gui/*`,
 * `observer.svelte`, `characters`, `hotkey`, `process/modules`,
 * `storage/assetIntegrity`,
 * `storage/remoteSaveCleanup`, `storage/assetSweep`, `media/avatarThumb`,
 * `model/modellist`, and every `@tauri-apps/*` package `bootstrap.ts` touches.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { OpfsSwitchNotice } from 'src/ts/storage/autoStorage'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

type OpfsSwitchNoticeReason = OpfsSwitchNotice['reason']

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const forageState = vi.hoisted(() => ({
    staleAccountProfile: false,
    opfsSwitchNotice: null as OpfsSwitchNotice | null,
    items: new Map<string, Uint8Array | (() => Uint8Array)>(),
}))

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

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        get staleAccountProfile() { return forageState.staleAccountProfile },
        set staleAccountProfile(v: boolean) { forageState.staleAccountProfile = v },
        get opfsSwitchNotice() { return forageState.opfsSwitchNotice },
        set opfsSwitchNotice(v: OpfsSwitchNotice | null) { forageState.opfsSwitchNotice = v },
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async (key: string) => {
            const entry = forageState.items.get(key)
            if (entry === undefined) {
                return null
            }
            return typeof entry === 'function' ? entry() : entry
        }),
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
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike))
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
    forageState.opfsSwitchNotice = null
    forageState.items.clear()
    dbState.current = baseDb()
    platformState.isTauri = false
    platformState.isNodeServer = false
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

describe('loadData(): no opfs switch notice recorded (guard)', () => {
    test('boots straight through to loadedStore true, posting no alert at all, when opfsSwitchNotice is null', async () => {
        armDecode(baseDb())
        forageState.opfsSwitchNotice = null
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

describe('loadData(): an opfs switch notice pauses boot until acknowledged (O1)', () => {
    const reasons: OpfsSwitchNoticeReason[] = ['quota', 'error', 'interrupted', 'unsupported']

    for (const reason of reasons) {
        test(`reason "${reason}": an alert is posted, boot does not continue past it, and continues once acknowledged`, async () => {
            armDecode(baseDb())
            forageState.opfsSwitchNotice = { reason, detail: reason === 'error' ? 'notice-detail-marker' : undefined }
            const { loadData, alertStore, loadedStore } = await freshLoadData()

            const loadPromise = loadData()
            try {
                await vi.waitFor(() => {
                    if (get(alertStore).type === 'none') {
                        throw new Error(`expected an opfs switch notice for reason "${reason}" to be showing`)
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

describe('loadData(): the opfs switch notice text is reason-specific', () => {
    test('the "error" reason\'s text carries the detail, and differs from the "quota" reason\'s text', async () => {
        armDecode(baseDb())
        forageState.opfsSwitchNotice = { reason: 'error', detail: 'notice-detail-marker' }
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
        forageState.opfsSwitchNotice = { reason: 'quota' }
        const quotaRun = await freshLoadData()
        const quotaLoadPromise = quotaRun.loadData()
        let quotaMsg: string
        try {
            await vi.waitFor(() => {
                if (get(quotaRun.alertStore).type === 'none') {
                    throw new Error('expected the "quota" reason notice to be showing')
                }
            }, { timeout: 500, interval: 5 })
            quotaMsg = get(quotaRun.alertStore).msg
        } finally {
            quotaRun.alertStore.set({ type: 'none', msg: '' })
            await quotaLoadPromise.catch(() => { })
        }

        expect(errorMsg).toContain('notice-detail-marker')
        expect(quotaMsg).not.toBe(errorMsg)
    })
})

describe('loadData(): the opfs switch notice is posted only after setDatabase() runs (N1)', () => {
    test('setDatabase() is called strictly before the notice reaches alertStore, so the notice shows in the language setDatabase() selects', async () => {
        armDecode(baseDb())
        forageState.opfsSwitchNotice = { reason: 'quota' }
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alertSetSpy = vi.spyOn(alertStore, 'set')

        const loadPromise = loadData()
        try {
            await vi.waitFor(() => {
                const hasNotice = alertSetSpy.mock.calls.some(([v]) => v.type !== 'none')
                if (!hasNotice) {
                    throw new Error('expected an opfs switch notice call on alertStore.set')
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

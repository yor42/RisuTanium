/**
 * T-C6, T-C8, T-C10 (boot half) and T-C13 (Agents/Reports/28-risuaccount-removal-plan.md).
 *
 * Drives the REAL `loadData()` from `src/ts/bootstrap.ts`, non-Tauri branch, the same way
 * `bootstrap.staleAccountProfile.svelte.test.ts` does. Unlike that file, `src/ts/characterCards`
 * is left REAL here too: the `?realm=` chokepoint this file covers lives inside
 * `characterURLImport`/`getRealmInfo` itself, so mocking that module away would only prove
 * something about a stand-in, not about whether a request actually reaches an upstream host
 * before consent. A `?code=`/`?state=` URL is not a callback for anything `bootstrap.ts`
 * reaches (I3): the scenario below just confirms boot ignores the pair and proceeds normally.
 * Everything `characterCards` imports, beyond what `bootstrap.ts` already needs mocked, is
 * mocked purely for import satisfaction: none of it runs in any scenario below (no
 * character/preset/module import).
 *
 * `alert.ts` is real (a thin wrapper), exactly as in the sibling suite, so this file can observe
 * `alertStore` as the effect of any prompt boot posts, whichever module ends up posting it.
 *
 * `setDatabase`/`getDatabase` are HOISTED spies, referenced directly by the `database.svelte` mock
 * factory, so every dynamically re-imported module instance (`vi.resetModules()` runs before each
 * test) shares one spy identity.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { STALE_ACCOUNT_NOTICE_ACK } from './alert'
// The exact literal answer values `AlertComp`'s own buttons write for this prompt.
import { UPSTREAM_AGREEMENT_ACCEPT, UPSTREAM_AGREEMENT_DECLINE } from 'src/ts/upstreamAgreement'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const forageState = vi.hoisted(() => ({
    staleAccountProfile: false,
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

// `characterCards.ts` needs `decryptBuffer`/`isKnownUri`/`selectFileByDom` beyond what
// `bootstrap.ts` itself uses; none of the three run in any scenario below.
vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(async () => { }),
    checkNullish: (v: unknown) => v === null || v === undefined,
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
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
    importPreset: vi.fn(async () => { }),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
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
    SettingsMenuIndex: writable(0),
    ShowRealmFrameStore: writable(''),
    settingsOpen: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: loadPluginsMock,
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

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

// `characterCards.ts` needs `changeChar`/`characterFormatUpdate` beyond `bootstrap.ts`'s own
// `updateLorebooks`; neither runs in any scenario below.
vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

// `characterCards.ts` needs `exportModuleLegacy`/`readModule` beyond `bootstrap.ts`'s own
// `moduleUpdate`; neither runs in any scenario below.
vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: moduleUpdateMock,
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
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

// `characterCards.ts` needs `compressImage`/`getImageType`; neither runs in any scenario below.
vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class { },
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class { },
    CharXWriter: class { },
}) as unknown as typeof import('src/ts/process/processzip'))

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

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
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
    setUsingSw: vi.fn(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: getUncleanablesSyncMock,
    AppendableBuffer: class { },
    BlankWriter: class { },
    LocalWriter: class { },
    VirtualWriter: class { },
    downloadFile: vi.fn(async () => { }),
    loadAsset: vi.fn(async () => new Uint8Array()),
    readImage: vi.fn(async (d: unknown) => d),
    saveAsset: vi.fn(async () => ''),
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

//#endregion

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

const { forageStorage: sharedForageStorage } = await import('src/ts/globalApi.svelte') as unknown as {
    forageStorage: { setItem: ReturnType<typeof vi.fn>, removeItem: ReturnType<typeof vi.fn>, getItem: ReturnType<typeof vi.fn> }
}
const { alertStore: sharedAlertStore, ShowRealmFrameStore: sharedShowRealmFrameStore, loadedStore: sharedLoadedStore } = await import('src/ts/stores.svelte') as unknown as {
    alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
    ShowRealmFrameStore: ReturnType<typeof writable<string>>
    loadedStore: ReturnType<typeof writable<boolean>>
}

/** Enough fields for `checkNewFormat()` to run without throwing, and no format-migration branch to trigger. */
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

/** Every `fetch` call this file's stub has recorded, as plain URL strings, oldest first. */
function fetchCalls(): string[] {
    return vi.mocked(fetch).mock.calls.map(([input]) => String(input))
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
    // The mocked `stores.svelte` module is not torn down by `vi.resetModules()`, so this store
    // instance, and whatever value an earlier test left in it, survives into the next import of
    // `loadData()` -- reset it explicitly here rather than relying on a fresh instance.
    // `loadData()` itself no-ops once loadedStore is true.
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore }
}

/** Arms the non-Tauri database read so `loadData()` installs `db` on its ordinary decode path. */
function arm(db: Record<string, unknown>) {
    forageState.items.set('database/database.bin', encodeRisuSaveLegacy(db))
}

beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    fsStore.clear()
    forageState.staleAccountProfile = false
    forageState.items.clear()
    sharedForageStorage.setItem.mockClear()
    sharedForageStorage.removeItem.mockClear()
    sharedForageStorage.getItem.mockClear()
    sharedShowRealmFrameStore.set('')
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
    setDatabaseMock.mockClear()
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => { dbState.current = { ...dbState.baseline(), ...data } })
    getDatabaseMock.mockClear()
    getDatabaseMock.mockImplementation(() => dbState.current)
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    // Settles any notice or prompt this test posted but never answered: its subscription is
    // still live on the shared, mock-persisted `alertStore` and would otherwise react to a later
    // test's own writes.
    sharedAlertStore.set({ type: 'none', msg: STALE_ACCOUNT_NOTICE_ACK })
    sharedAlertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('T-C6: a normal boot', () => {
    test('posts no upstream agreement prompt, and still reaches loadedStore true', async () => {
        arm(baseDb())
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        try {
            await loadData()
            expect(get(loadedStore)).toBe(true)
            expect(get(alertStore).type).not.toBe('tos')
        } finally {
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })
})

describe('T-C8: a ?realm= link with no acceptance', () => {
    test('the parameter is stripped via replaceState, so history length does not grow', async () => {
        window.history.replaceState(null, '', '/?realm=some/path')
        const startingLength = window.history.length
        arm({ ...baseDb(), didFirstSetup: true })
        const { loadData, alertStore } = await freshLoadData()
        try {
            await loadData()
            expect(new URLSearchParams(location.search).has('realm')).toBe(false)
            expect(window.history.length).toBe(startingLength)
        } finally {
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })

    test('no request reaches the realm info endpoint before an upstream-service agreement is granted', async () => {
        window.history.replaceState(null, '', '/?realm=some/path')
        arm({ ...baseDb(), didFirstSetup: true })
        const { loadData, alertStore } = await freshLoadData()
        try {
            await loadData()
            expect(fetchCalls().filter((u) => u.includes('/hub/info/')).length).toBe(0)
        } finally {
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })

    // Guards an invariant that already holds regardless of consent: with no realm parameter to
    // act on, boot must never fetch the realm info endpoint.
    test('a boot with the parameter already stripped fetches nothing from the realm info endpoint', async () => {
        window.history.replaceState(null, '', '/?other=1')
        arm({ ...baseDb(), didFirstSetup: true })
        const { loadData, alertStore } = await freshLoadData()
        try {
            await loadData()
            expect(fetchCalls().filter((u) => u.includes('/hub/info/')).length).toBe(0)
        } finally {
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })

    // A pin: with acceptance already recorded, the realm info request carries the pending path
    // without waiting on any prompt.
    test('with acceptance already recorded, the realm info request carries the pending path', async () => {
        window.history.replaceState(null, '', '/?realm=some/known/path')
        localStorage.setItem('upstreamServicesAgreement', 'accepted')
        arm({ ...baseDb(), didFirstSetup: true })
        const { loadData, alertStore } = await freshLoadData()
        try {
            await loadData()
            const hubInfoCalls = fetchCalls().filter((u) => u.includes('/hub/info/'))
            expect(hubInfoCalls.length).toBeGreaterThan(0)
            expect(hubInfoCalls[0]).toContain('some/known/path')
        } finally {
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })

    // Guard: a pending realm-link prompt never shows before boot's own loadedStore flips true, so
    // a UI that gates its own render on loadedStore never has the prompt appear behind it.
    test('the first agreement prompt of this boot is not shown before loadedStore is true', async () => {
        window.history.replaceState(null, '', '/?realm=some/path')
        arm({ ...baseDb(), didFirstSetup: true })
        // Subscribed on the shared store before the fresh module graph is even imported, and
        // gated on `bootStarted`, so nothing this boot's own setup does (or anything left over
        // from an earlier boot) can be mistaken for this boot's first prompt.
        let bootStarted = false
        let loadedWhenFirstShown: boolean | undefined
        const unsubscribe = sharedAlertStore.subscribe((v) => {
            if (bootStarted && v.type === 'tos' && loadedWhenFirstShown === undefined) {
                loadedWhenFirstShown = get(sharedLoadedStore)
            }
        })
        try {
            const { loadData } = await freshLoadData()
            bootStarted = true
            await loadData()
            expect(loadedWhenFirstShown).toBe(true)
        } finally {
            unsubscribe()
            sharedAlertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })

    // Declining must never let the pending path's info request reach the network, and a later
    // boot that starts from the resulting (already-stripped) URL must not request it either.
    test('declining the agreement prompt leaves the pending realm info request unsent, including on a later boot', async () => {
        window.history.replaceState(null, '', '/?realm=some/declined/path')
        arm({ ...baseDb(), didFirstSetup: true })
        const { loadData, alertStore } = await freshLoadData()
        try {
            await loadData()
            await vi.waitFor(() => {
                if (get(alertStore).type !== 'tos') {
                    throw new Error('expected the boot agreement prompt to be showing')
                }
            }, { timeout: 1000, interval: 5 })
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
            await vi.waitFor(() => {
                if (get(alertStore).type === 'tos') {
                    throw new Error('expected declining to resolve the boot agreement prompt')
                }
            }, { timeout: 1000, interval: 5 })
            expect(fetchCalls().filter((u) => u.includes('/hub/info/')).length).toBe(0)
        } finally {
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }

        vi.resetModules()
        const second = await freshLoadData()
        const secondBootTypes: string[] = []
        const unsubscribeSecond = second.alertStore.subscribe((v) => secondBootTypes.push(v.type))
        try {
            await second.loadData()
            // The `realm` parameter was already stripped by the first boot, so this boot has
            // nothing pending to prompt for: give any stray prompt a bounded window to appear,
            // then assert it never did.
            await new Promise((resolve) => setTimeout(resolve, 200))
            expect(secondBootTypes).not.toContain('tos')
            expect(fetchCalls().filter((u) => u.includes('/hub/info/')).length).toBe(0)
        } finally {
            unsubscribeSecond()
            second.alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })

    // The pending path's realm info request waits on this prompt's own Accept: it never fires
    // before the answer, and fires exactly once, for that path, once Accept resolves it.
    test('accepting the agreement prompt is consistent with exactly one realm info request for the pending path', async () => {
        window.history.replaceState(null, '', '/?realm=some/accepted/path')
        arm({ ...baseDb(), didFirstSetup: true })
        const { loadData, alertStore } = await freshLoadData()
        try {
            await loadData()
            await vi.waitFor(() => {
                if (get(alertStore).type !== 'tos') {
                    throw new Error('expected the boot agreement prompt to be showing')
                }
            }, { timeout: 1000, interval: 5 })
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_ACCEPT })
            await vi.waitFor(() => {
                const hubInfoCalls = fetchCalls().filter((u) => u.includes('/hub/info/'))
                if (hubInfoCalls.length !== 1 || !hubInfoCalls[0].includes('some/accepted/path')) {
                    throw new Error('expected exactly one realm info request for the accepted path')
                }
            }, { timeout: 1000, interval: 5 })
        } finally {
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })
})

describe('T-C10 (boot half): a ?code=&state= link', () => {
    // I3: with the agreement already accepted and a recognized state value ('load'), a
    // request must still never reach an upstream host, and boot must still reach loadedStore
    // true -- acceptance must never turn this parameter pair into a live token exchange.
    test('with the agreement accepted, no request reaches an upstream host, and boot reaches loadedStore true', async () => {
        localStorage.setItem('upstreamServicesAgreement', 'accepted')
        window.history.replaceState(null, '', '/?code=some-code&state=load')
        arm(baseDb())
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        try {
            await loadData()
            expect(fetchCalls()).toEqual([])
            expect(get(loadedStore)).toBe(true)
        } finally {
            alertStore.set({ type: 'none', msg: UPSTREAM_AGREEMENT_DECLINE })
        }
    })
})

describe('T-C13 (R6): a stale account profile opened with ?realm=', () => {
    // Guard: the stale-profile notice and the agreement prompt never show together, so the two
    // never ping-pong against each other across reloads.
    test('shows the stale-profile notice and never posts the agreement prompt', async () => {
        localStorage.setItem('accountst', 'able')
        localStorage.setItem('dosync', 'sync')
        localStorage.setItem('fallbackRisuToken', JSON.stringify({ token: 'stale' }))
        forageState.staleAccountProfile = true
        window.history.replaceState(null, '', '/?realm=some/path')
        arm({ ...baseDb(), didFirstSetup: true })

        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const seenTypes: string[] = []
        const unsubscribe = alertStore.subscribe((v) => seenTypes.push(v.type))

        await loadData()
        unsubscribe()

        expect(seenTypes).toContain('staleAccountNotice')
        expect(seenTypes).not.toContain('tos')
        expect(get(loadedStore)).toBe(false)
        expect(fetchCalls().filter((u) => u.includes('/hub/info/')).length).toBe(0)

        alertStore.set({ type: 'none', msg: STALE_ACCOUNT_NOTICE_ACK })
    })
})

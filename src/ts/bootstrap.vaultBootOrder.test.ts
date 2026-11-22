/**
 * Where the real `bootstrap.ts` starts the connection-key vault. The real `loadData` runs its production
 * `checkNewFormat`; `vaultBoot` and `whenVaultReady` are replaced by recorders so the order is observable
 * (the vault itself is covered by `vaultBoot.test.ts`). The harness is that of
 * `bootstrap.connectionsBootWrite.test.ts`.
 * Regression guard for the boot order: `vaultBoot` runs after the final `setDatabase` of `checkNewFormat`,
 * `loadedStore` is set only after `whenVaultReady` settles, and `afterLoad` runs after `loadedStore`.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { BLOCK, composeSave, corruptBlockPayload } from 'src/ts/storage/tests/manualCleanupHarness'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'
import { registerRealDispatch } from 'src/ts/tests/realDispatchBoot.test-helpers'

const MAIN_KEY = 'database/database.bin'

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const world = vi.hoisted(() => ({
    events: [] as string[],
    staleAccountProfile: false,
    items: new Map<string, Uint8Array>(),
    failingKeys: new Set<string>(),
    blockCache: new Map<string, unknown>(),
    readKeys: [] as string[],
    setItemKeys: [] as string[],
}))

const sleepForeverMock = vi.hoisted(() => vi.fn(async (): Promise<void> => { }))
const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const characterURLImportMock = vi.hoisted(() => vi.fn((): void => { }))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const saveDbMock = vi.hoisted(() => vi.fn(async (): Promise<void> => { }))
const requestSaveNowMock = vi.hoisted(() => vi.fn((): void => { }))
const markBootWriteMock = vi.hoisted(() => vi.fn((): void => { }))

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(() => ({
            getItem: vi.fn(async (key: string) => world.blockCache.get(key) ?? null),
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
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
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
    getDatabase: vi.fn(() => dbState.current),
    setDatabase: setDatabaseMock,
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
    presetFromWorkingSettings: vi.fn((_db: unknown, name: string, image: string) => ({ name, image })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/update'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as Record<string, unknown> },
    selIdState: { selId: -1 },
    LoadingStatusState: { text: '' },
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/bootWindow'), async (importOriginal) => ({
    ...(await importOriginal()),
    markBootWrite: markBootWriteMock,
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: characterURLImportMock,
    handlePendingRealmLink: vi.fn(async () => { }),
    hubURL: 'https://realm.risuai.net',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), async (importOriginal) => ({
    ...(await importOriginal()),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({ startAvatarThumbSweep: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/model/modellist'), async (importOriginal) => ({
    ...(await importOriginal()),
    registerModelDynamic: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p) }))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ maximize: vi.fn(async () => { }) })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => { throw new Error('ENOENT (mock)') }),
    writeFile: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    saveAsset: vi.fn(async () => ''),
    downloadFile: vi.fn(async () => { }),
    forageStorage: {
        get staleAccountProfile() { return world.staleAccountProfile },
        set staleAccountProfile(v: boolean) { world.staleAccountProfile = v },
        Init: vi.fn(async () => { world.events.push('init') }),
        getItem: vi.fn(async (key: string) => {
            world.readKeys.push(key)
            if (key === MAIN_KEY) {
                world.events.push('read-main')
            }
            if (world.failingKeys.has(key)) {
                throw 'getItem Error'
            }
            return world.items.get(key) ?? null
        }),
        setItem: vi.fn(async (key: string) => { world.setItemKeys.push(key) }),
        keys: vi.fn(async (): Promise<string[]> => []),
        removeItem: vi.fn(async () => { }),
    },
    saveDb: saveDbMock,
    requestSaveNow: requestSaveNowMock,
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

const vaultOrder = vi.hoisted(() => ({
    gate: null as null | Promise<void>,
}))

vi.mock(import('src/ts/connections/vaultBoot'), () => ({
    vaultBoot: vi.fn(() => {
        world.events.push('vaultBoot')
        return { afterLoad: vi.fn(async () => { world.events.push('afterLoad') }) }
    }),
}) as unknown as typeof import('src/ts/connections/vaultBoot'))

vi.mock(import('src/ts/connections/keyVaultStore.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    whenVaultReady: vi.fn(async () => {
        world.events.push('whenVaultReady')
        await vaultOrder.gate
        world.events.push('vaultReady')
    }),
}) as unknown as typeof import('src/ts/connections/keyVaultStore.svelte'))
const { encodeRisuSaveLegacy, decodeRisuSave } = await import('src/ts/storage/risuSave')
const { RisuSaveEncoder } = await import('src/ts/storage/tests/risuSaveEncoder')

function baseDb(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        formatversion: 999,
        characters: [{ chaId: 'a', name: 'A', type: 'character', chats: [] }],
        modules: [],
        personas: [{ name: 'User', personaPrompt: '', icon: '', note: '', largePortrait: false, id: 'p0' }],
        selectedPersona: 0,
        characterOrder: [],
        mainPrompt: 'fixture-main-prompt',
        loreBookToken: 8000,
        hotkeys: [],
        botPresets: [],
        coldstorage: false,
        checkCorruption: false,
        botSettingAtStart: false,
        betaMobileGUI: false,
        didFirstSetup: true,
        heightMode: 'auto',
        ...extra,
    }
}
dbState.baseline = () => baseDb({ characters: [] })

function armLegacy(db: Record<string, unknown> = baseDb()): Uint8Array {
    const bytes = encodeRisuSaveLegacy(db)
    world.items.set(MAIN_KEY, bytes)
    return bytes
}

/** A block-format file with characters `a` (inline) and `b` (a remote pointer), built block by block so a test can damage exactly one. */
async function composeBlockFile(options: { b?: 'remote' | 'inline', plugins?: Record<string, unknown>[] } = {}) {
    const encoder = new RisuSaveEncoder()
    const character = (chaId: string) => JSON.stringify({ chaId, name: chaId.toUpperCase(), type: 'character', chats: [] })
    const remotePointer = JSON.stringify({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash: '0123456789abcdef' })
    const root = { ...baseDb(), characters: undefined, __directory: ['preset', 'plugins', 'a', 'b', 'config'] }
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

/**
 * Imports a fresh `loadData` and the matching `stores.svelte` pair, after `vi.resetModules()`. The real dispatch is
 * registered, so the legacy main file is converted to a store2 profile as on a production page; the person agrees to
 * leave out the entries a lenient conversion names.
 */
async function freshLoadData() {
    // The boot reads through the page's byte store; here it is the storage-object model above.
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'tauri')
    const dispatch = await registerRealDispatch({ kind: 'tauri', acknowledgeAlerts: true, convertWithoutAnswer: 'convert' })
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore, dispatch }
}

/** Records every non-`none` alert, in order, and notes it in the shared event list. */
function recordAlerts(alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>) {
    const seen: { type: string, msg: string }[] = []
    const unsubscribe = alertStore.subscribe((value) => {
        if (value.type !== 'none') {
            seen.push(value)
            world.events.push(`alert:${seen.length}`)
        }
    })
    return { seen, stop: unsubscribe }
}

function installedTrees(): Record<string, unknown>[] {
    return setDatabaseMock.mock.calls.map((call) => call[0])
}

function characterIds(tree: Record<string, unknown>): string[] {
    return (tree.characters as { chaId: string }[]).map((c) => c.chaId)
}

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
// A toast the test posted must not outlive it: the host is a singleton whose timers outlast the test.
afterEach(async () => {
    const { resetToastHostForTests } = await import('src/ts/toast/toastHost.svelte')
    resetToastHostForTests()
})

beforeEach(expectBootstrapTransformed)
beforeEach(() => {
    localStorage.clear()
    world.events.length = 0
    world.staleAccountProfile = false
    world.items.clear()
    world.failingKeys.clear()
    world.blockCache.clear()
    world.readKeys.length = 0
    world.setItemKeys.length = 0
    sleepForeverMock.mockReset().mockResolvedValue(undefined)
    platformState.isTauri = false
    platformState.isNodeServer = true
    dbState.current = baseDb({ characters: [] })
    getDbBackupsMock.mockReset().mockResolvedValue([])
    saveDbMock.mockClear()
    requestSaveNowMock.mockClear()
    markBootWriteMock.mockReset()
    characterURLImportMock.mockReset().mockImplementation(() => { world.events.push('characterURLImport') })
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        world.events.push('setDatabase')
        dbState.current = { ...dbState.baseline(), ...data }
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

function lastInstalled(): Record<string, unknown> {
    const trees = installedTrees()
    return trees[trees.length - 1]
}

/** Boots a legacy profile with the real `setDatabase`, as the production load path installs it. */
async function bootWithRealSetDatabase(db: Record<string, unknown>) {
    armLegacy(db)
    const booted = await freshLoadData()
    const actual = await vi.importActual<typeof import('src/ts/storage/database.svelte')>('src/ts/storage/database.svelte')
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => {
        actual.setDatabase(data as unknown as Parameters<typeof actual.setDatabase>[0])
        world.events.push('setDatabase')
        dbState.current = { ...dbState.baseline(), ...data }
    })
    await booted.loadData()
    return lastInstalled()
}

describe('loadData() and the vault boot order', () => {
    beforeAll(async () => {
        await vi.importActual('src/ts/storage/database.svelte')
    }, COLD_TRANSFORM_HOOK_MS)

    test('vaultBoot runs after checkNewFormat, loadedStore waits for whenVaultReady, afterLoad follows loadedStore', async () => {
        let release: () => void = () => { }
        vaultOrder.gate = new Promise<void>((resolve) => { release = resolve })
        armLegacy(baseDb())
        const booted = await freshLoadData()
        booted.loadedStore.subscribe((value) => { if (value) { world.events.push('loadedStore') } })

        const running = booted.loadData()
        await vi.waitFor(() => expect(world.events).toContain('whenVaultReady'))

        expect(get(booted.loadedStore)).toBe(false)
        expect(world.events).not.toContain('loadedStore')
        expect(world.events).not.toContain('afterLoad')

        release()
        await running

        const at = (name: string) => world.events.lastIndexOf(name)
        expect(world.events.filter((name) => name === 'vaultBoot')).toHaveLength(1)
        expect(at('vaultBoot')).toBeGreaterThan(at('setDatabase'))
        expect(at('whenVaultReady')).toBeGreaterThan(at('vaultBoot'))
        expect(at('loadedStore')).toBeGreaterThan(at('vaultReady'))
        expect(at('afterLoad')).toBeGreaterThan(at('loadedStore'))
    })
})
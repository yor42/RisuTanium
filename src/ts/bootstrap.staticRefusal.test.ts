/**
 * `loadData()` on a page that is neither Tauri nor served by the Node server (a static or Hono page): the boot
 * refuses with a message and opens, reads and writes nothing. The real `bootstrap.ts` runs; the LocalForage module
 * and the storage object are in-memory models that record any use. Everything else `bootstrap.ts` imports is mocked,
 * as in the sibling bootstrap test files. The store2 dispatch is the real one over a memory backend, so a dispatch
 * entry is observable. The only store kind it names is `'node'`, which is never entered here.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { language } from 'src/lang'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'
import { registerRealDispatch } from 'src/ts/tests/realDispatchBoot.test-helpers'

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const world = vi.hoisted(() => ({
    indexedDbUsable: true,
    /** What a call to the fallback storage object wrote. */
    fallbackWrites: [] as string[],
    /** What the pinned IndexedDB instance holds. */
    indexedDb: new Map<string, unknown>(),
    indexedDbWrites: [] as string[],
    /** What `getDbBackups` lists. */
    backups: [] as number[],
}))

const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))

vi.mock('localforage', () => ({
    default: {
        INDEXEDDB: 'asyncStorage',
        supports: vi.fn(() => world.indexedDbUsable),
        createInstance: vi.fn(() => ({
            ready: vi.fn(async () => {
                if (!world.indexedDbUsable) {
                    throw new Error('No available storage method found.')
                }
            }),
            getItem: vi.fn(async (key: string) => world.indexedDb.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: Uint8Array) => {
                world.indexedDbWrites.push(key)
                world.indexedDb.set(key, value)
            }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => Array.from(world.indexedDb.keys())),
            dropInstance: vi.fn(async () => { }),
        })),
        dropInstance: vi.fn(async () => { }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
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
    markAppInitiatedReload: vi.fn(),
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbState.current),
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
    SafeModeStore: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    handlePendingRealmLink: vi.fn(async () => { }),
    hubURL: 'https://realm.risuai.net',
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

vi.mock(import('src/ts/media/avatarThumb'), () => ({ startAvatarThumbSweep: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/model/modellist'), () => ({ registerModelDynamic: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))

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

// The storage object a LocalForage profile boots on: whatever driver LocalForage
// picked, here an in-memory model that records every write.
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        staleAccountProfile: false,
        realStorage: {},
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async (key: string) => { world.fallbackWrites.push(key) }),
        keys: vi.fn(async (): Promise<string[]> => []),
        removeItem: vi.fn(async () => { }),
    },
    saveDb: vi.fn(async () => { }),
    getDbBackups: async (): Promise<number[]> => world.backups,
    buildAssetKeepSet: vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })),
    getBasename: (p: string) => p.split('/').pop(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: vi.fn((): string[] => []),
    wasAssetWrittenThisPage: vi.fn(() => false),
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

function baseDb(): Record<string, unknown> {
    return { formatversion: 999, characters: [], modules: [], personas: [], botPresets: [] }
}
dbState.baseline = () => baseDb()

/** How many times the registered dispatch was entered in this test. */
const dispatchEntered = { count: 0 }

async function freshLoadData() {
    // The real dispatch over a memory store2 backend: the page serves neither Tauri nor the Node server, so it has no store of its own.
    const dispatch = await registerRealDispatch({ kind: 'node', acknowledgeAlerts: true, onEnter: () => { dispatchEntered.count += 1 } })
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore, dispatch }
}

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
beforeEach(expectBootstrapTransformed)
beforeEach(() => {
    localStorage.clear()
    world.fallbackWrites.length = 0
    world.indexedDbWrites.length = 0
    dispatchEntered.count = 0
    dbState.current = baseDb()
    setDatabaseMock.mockReset()
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('loadData() on a page that is neither Tauri nor Node-served', () => {
    test('regression reproducer: it refuses in English and opens, reads and writes nothing', async () => {
        const { loadData, loadedStore, alertStore } = await freshLoadData()
        const { forageStorage } = await import('src/ts/globalApi.svelte')
        const localforage = (await import('localforage')).default
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem')

        await loadData()

        expect(get(alertStore).type).toBe('error')
        expect(get(alertStore).msg).toBe('RisuTanium no longer runs from a plain web host. Use the Android or desktop app, or the page the RisuTanium Node server serves.')
        expect(get(alertStore).msg).toBe(language.staticBuildUnsupported)
        expect(forageStorage.Init).not.toHaveBeenCalled()
        expect(localforage.createInstance).not.toHaveBeenCalledWith({ name: 'risuai' })
        expect(setItemSpy).not.toHaveBeenCalled()
        expect(removeItemSpy).not.toHaveBeenCalled()
        expect(world.fallbackWrites).toEqual([])
        expect(world.indexedDbWrites).toEqual([])
        expect(dispatchEntered.count).toBe(0)
        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })
})

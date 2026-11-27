/**
 * `loadData()` starts the saved-vector sweep on a writable page, once, with the profile's own character slots, after the
 * boot save has started, and never on a read-only page (which must write and delete nothing). The sweep itself (engine off
 * drops readable and damaged folders, engine on keeps the stub, trashed and cold-body rule, foreign folders stay) is pinned
 * by `vectorLifecycleHooks.test.ts`; this file pins the wiring through the real boot. The mocked/real split mirrors
 * `bootstrap.lastCharacter.test.ts`; the sweep is wrapped, not replaced, so the real one runs on the mocked file system.
 * A mocked file system is not evidence of native behavior.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'
import { registerRealDispatch } from 'src/ts/tests/realDispatchBoot.test-helpers'

const world = vi.hoisted(() => ({
    events: [] as string[],
    readOnly: false,
}))

const holder = await vi.hoisted(async () => {
    const { writable } = await import('svelte/store')
    const make = () => ({
        botMakerMode: writable(false),
        selectedCharID: writable(-1),
        loadedStore: writable(false),
        alertStore: writable({ type: 'none', msg: 'n' }),
        settingsOpen: writable(false),
        CustomGUISettingMenuStore: writable(false),
        PlaygroundStore: writable(0),
        OpenRealmStore: writable(false),
    })
    return { make, current: make() }
})
const stores = new Proxy({} as ReturnType<typeof holder.make>, {
    get: (_target, name: string) => holder.current[name as keyof typeof holder.current],
})

const sweepSpy = vi.hoisted(() => vi.fn())

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(() => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
            dropInstance: vi.fn(async () => { }),
        })),
        dropInstance: vi.fn(async () => { }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
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

const dbState = { current: {} as Record<string, unknown> }

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbState.current),
    setDatabase: vi.fn((data: Record<string, unknown>) => { dbState.current = data }),
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/update'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    LoadingStatusState: { text: '' },
    MobileGUI: { subscribe: vi.fn() },
    get botMakerMode() { return stores.botMakerMode },
    get selectedCharID() { return stores.selectedCharID },
    get loadedStore() { return stores.loadedStore },
    get alertStore() { return stores.alertStore },
    get settingsOpen() { return stores.settingsOpen },
    get CustomGUISettingMenuStore() { return stores.CustomGUISettingMenuStore },
    get PlaygroundStore() { return stores.PlaygroundStore },
    get OpenRealmStore() { return stores.OpenRealmStore },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    handlePendingRealmLink: vi.fn(async () => { }),
    hubURL: 'https://realm.risuai.net',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/desktopLaunch'), () => ({
    desktopLaunchImport: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/desktopLaunch'))

vi.mock(import('src/ts/android/openedFiles'), () => ({
    androidOpenedFilesImport: vi.fn(() => { }),
}) as unknown as typeof import('src/ts/android/openedFiles'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/gui/colorschemeCore'), async (importOriginal) => ({
    ...(await importOriginal()),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorschemeCore'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
    changeCharGeneration: vi.fn(() => 0),
    supersedeChangeChar: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/characterPick'), () => ({
    changeCharOrAlert: vi.fn(async () => 'selected'),
}) as unknown as typeof import('src/ts/characterPick'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/storage/store2/maintenance'), async (importOriginal) => ({
    ...await importOriginal(),
    startStore2Maintenance: vi.fn(),
}))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    startAvatarThumbSweep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/model/modellist'), () => ({
    registerModelDynamic: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

// The real sweep runs; the spy records the call and what it was given.
vi.mock(import('src/ts/process/memory/chroMemory/vectorPersist'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        sweepVectorsAtBoot: (...args: Parameters<typeof original.sweepVectorsAtBoot>) => {
            world.events.push('sweep')
            sweepSpy(...args)
            return original.sweepVectorsAtBoot(...args)
        },
    }
})

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

/** A path relative to AppData: the byte store addresses every key with a leading `./`. */
const bare = (path: string): string => path.replace(/^\.\//, '')

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async (path: string) => fsStore.has(bare(path))),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async (path: string) => {
        if (!fsStore.has(bare(path))) {
            throw new Error(`ENOENT (mock): ${path} (os error 2)`)
        }
        return fsStore.get(bare(path))!
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => { fsStore.set(bare(path), data) }),
    rename: vi.fn(async (from: string, to: string) => {
        const found = fsStore.get(bare(from))
        if (!found) {
            throw `no such file ${from} (os error 2)`
        }
        fsStore.set(bare(to), found)
        fsStore.delete(bare(from))
    }),
    readDir: vi.fn(async (path: string) => {
        if ((fsStore.get(bare(path))?.length ?? 0) > 0) {
            throw new Error(`Not a directory (mock): ${path} (os error 20)`)
        }
        return []
    }),
    remove: vi.fn(async (path: string) => { fsStore.delete(bare(path)) }),
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
    saveDb: vi.fn(async () => { world.events.push('saveDb') }),
    getDbBackups: vi.fn(async (): Promise<number[]> => []),
    buildAssetKeepSet: vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })),
    getBasename: (p: string) => p.split('/').pop(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: vi.fn((): string[] => []),
    wasAssetWrittenThisPage: vi.fn(() => false),
    listAssetsWrittenThisPage: vi.fn((): string[] => []),
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

function armTauriBoot() {
    fsStore.set('', new Uint8Array())
    fsStore.set('database', new Uint8Array())
    fsStore.set('assets', new Uint8Array())
    fsStore.set('database/database.bin', encodeRisuSaveLegacy({
        formatversion: 999,
        characters: [
            { chaId: 'c1', name: 'One', type: 'character', chats: [] },
            { chaId: 'c2', name: 'Two', type: 'character', chats: [] },
        ],
        modules: [],
        personas: [],
        characterOrder: [],
        mainPrompt: 'vector-sweep-fixture',
        loreBookToken: 8000,
        coldstorage: false,
        didFirstSetup: true,
    }))
}

async function bootOnce(): Promise<void> {
    armTauriBoot()
    await registerRealDispatch({ kind: 'tauri', injectBackend: !world.readOnly, acknowledgeAlerts: true })
    const { loadData } = await import('src/ts/bootstrap')
    await loadData()
    const { flushVectorPersist } = await import('src/ts/process/memory/chroMemory/vectorPersist')
    await flushVectorPersist()
}

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
afterEach(async () => {
    const { resetToastHostForTests } = await import('src/ts/toast/toastHost.svelte')
    resetToastHostForTests()
})

beforeEach(expectBootstrapTransformed)
beforeEach(() => {
    holder.current = holder.make()
    localStorage.clear()
    fsStore.clear()
    dbState.current = {}
    world.events.length = 0
    world.readOnly = false
    sweepSpy.mockReset()
    vi.stubGlobal('open', vi.fn())
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
})

describe('loadData(): the saved-vector sweep', () => {
    test('R1: a writable page starts the sweep once, with the profile character slots, after the boot save started', async () => {
        await bootOnce()

        expect(sweepSpy).toHaveBeenCalledTimes(1)
        const slots = sweepSpy.mock.calls[0][0] as { chaId: string }[]
        expect(slots).toBe((dbState.current as { characters: unknown }).characters)
        expect(slots.map((c) => c.chaId)).toEqual(['c1', 'c2'])
        expect(world.events.indexOf('saveDb')).toBeGreaterThanOrEqual(0)
        expect(world.events.indexOf('saveDb')).toBeLessThan(world.events.indexOf('sweep'))
    })

    test('G16: a read-only page does not start the sweep', async () => {
        world.readOnly = true

        await bootOnce()

        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode().kind).toBe('read-only')
        expect(sweepSpy).not.toHaveBeenCalled()
    })
})

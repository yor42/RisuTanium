/**
 * I6 (Agents/Reports/28-risuaccount-removal-plan.md) and I5 (Agents/Reports/
 * 31-removal-stage-plan.md): a Tauri boot never reads or removes `accountst`,
 * `dosync` or `fallbackRisuToken` -- the code that reads and removes those
 * keys (`AutoStorage.Init()`'s detection, and `loadData()`'s own
 * non-Tauri-branch cleanup in `src/ts/bootstrap.ts`) never runs from the
 * Tauri branch. The orphaned-LocalForage-instance and `risu_lastsaved`
 * cleanup (I5) is different: it runs on the Tauri boot branch too, since
 * nothing in this app reads or writes either on any platform.
 *
 * Split out from `bootstrap.staleAccountProfile.svelte.test.ts` (which covers
 * every non-Tauri scenario) because `bootstrap.ts` reads `isTauri` once, at
 * its own module top level, to build `appWindow` (`isTauri ?
 * getCurrentWebviewWindow() : null`). Exercising the Tauri branch needs a
 * module instance imported with `isTauri` already `true` at that moment.
 * This file keeps a single, fixed `isTauri: true` throughout, and (like the
 * sibling file) gives every test its own module graph via `vi.resetModules()`
 * and a fresh dynamic `import('src/ts/bootstrap')` in `beforeEach`, so no
 * test depends on another's held state.
 *
 * Mocked/real split mirrors the sibling file's: `risuSave.ts` and
 * `process/chatIds.ts` are real; everything else `bootstrap.ts` imports is
 * mocked, including the Tauri-specific `@tauri-apps/plugin-fs` calls this
 * branch makes that the sibling file's mock never exercises
 * (`exists`/`mkdir`/`writeFile`/`readFile`/`rename`) and `@tauri-apps/api/path`'s
 * `appDataDir`/`join`. The boot reads the database through the plugin's
 * `readFile`, so a flat map of files is all the model it needs.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'
import { registerRealDispatch } from 'src/ts/tests/realDispatchBoot.test-helpers'

const loadPluginsMock = vi.hoisted(() => vi.fn(async (): Promise<void> => { }))
const readDirMock = vi.hoisted(() => vi.fn(async (_path: string, _options?: unknown): Promise<Array<{ name: string, isFile?: boolean, isDirectory?: boolean }>> => []))

/** Every instance `localforage.createInstance()` has ever handed back, by the name it was created with -- so a test can inspect which instances were cleared or dropped, and by what name. */
const localforageInstances = vi.hoisted(() => [] as Array<{ name: string, dropInstance: () => Promise<void> }>)
const localforageDropInstanceMock = vi.hoisted(() => vi.fn(async (_opts?: { name?: string }) => { }))

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn((opts: { name: string }) => {
            const dropInstance = vi.fn(async () => { })
            localforageInstances.push({ name: opts?.name, dropInstance })
            return {
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => { }),
                removeItem: vi.fn(async () => { }),
                keys: vi.fn(async () => []),
                dropInstance,
            }
        }),
        dropInstance: localforageDropInstanceMock,
    },
}))

/** Total drop calls targeting `name`, whichever mechanism performed them: a module-level `localforage.dropInstance({ name })` call, or `createInstance({ name }).dropInstance()` on the per-instance handle it returned. */
function dropsNamed(name: string): number {
    const moduleLevel = localforageDropInstanceMock.mock.calls.filter(
        ([opts]) => opts?.name === name
    ).length
    const perInstance = localforageInstances
        .filter((inst) => inst.name === name)
        .reduce((sum, inst) => sum + (inst.dropInstance as ReturnType<typeof vi.fn>).mock.calls.length, 0)
    return moduleLevel + perInstance
}

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
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: loadPluginsMock,
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/desktopLaunch'), () => ({
    desktopLaunchImport: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/desktopLaunch'))

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
    readDir: readDirMock,
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
    saveDb: vi.fn(async () => { }),
    getDbBackups: vi.fn(async (): Promise<number[]> => []),
    getBasename: (p: string) => p.split('/').pop(),
    setUsingSw: vi.fn(),
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

/** A database fixture with enough fields for `checkNewFormat()` to run without throwing. */
function baseDbBytes(mainPrompt: string) {
    return encodeRisuSaveLegacy({
        formatversion: 999,
        characters: [],
        modules: [],
        personas: [],
        characterOrder: [],
        mainPrompt,
        loreBookToken: 8000,
    })
}

/**
 * Imports a fresh `loadData` and the matching `stores.svelte` pair, after `vi.resetModules()`. The real dispatch is
 * registered, so the legacy main file is converted to a store2 profile as on a production page.
 */
async function freshLoadData() {
    await registerRealDispatch({ kind: 'tauri', acknowledgeAlerts: true })
    const { loadData } = await import('src/ts/bootstrap')
    const { loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    return { loadData, loadedStore }
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
    fsStore.clear()
    localforageInstances.length = 0
    localforageDropInstanceMock.mockClear()
    dbState.current = {}
    loadPluginsMock.mockReset().mockResolvedValue(undefined)
    // A held file is not a directory: the store's `has` lists the path to tell the two apart, so a file must refuse the listing.
    readDirMock.mockReset().mockImplementation(async (path: string) => {
        if ((fsStore.get(bare(path))?.length ?? 0) > 0) {
            throw new Error(`Not a directory (mock): ${path} (os error 20)`)
        }
        return []
    })
    vi.stubGlobal('open', vi.fn())
    vi.resetModules()
})

describe('loadData(): Tauri boot pins (I6, I5)', () => {
    test('a Tauri boot never reads or removes accountst, dosync or fallbackRisuToken', async () => {
        localStorage.setItem('accountst', 'able')
        localStorage.setItem('dosync', 'sync')
        localStorage.setItem('fallbackRisuToken', JSON.stringify({ token: 'x' }))
        fsStore.set('', new Uint8Array()) // exists('', ...) -> true, skips the mkdir branches
        fsStore.set('database', new Uint8Array())
        fsStore.set('assets', new Uint8Array())
        const dbBytes = baseDbBytes('tauri-fixture')
        fsStore.set('database/database.bin', dbBytes)

        const { loadData, loadedStore } = await freshLoadData()

        // On the `localStorage` instance: once any code has called `getItem` on
        // it, a spy on `Storage.prototype` no longer sees its calls.
        const getItemSpy = vi.spyOn(localStorage, 'getItem')
        let readKeys: unknown[]
        try {
            await loadData()
            readKeys = getItemSpy.mock.calls.map((call) => call[0])
        } finally {
            getItemSpy.mockRestore()
        }

        // The title's "never reads" half: none of the three keys is ever read,
        // not just left unremoved. The boot does read other keys, so an empty
        // list would mean the spy is not in the call path.
        expect(readKeys.length).toBeGreaterThan(0)
        expect(readKeys).not.toContain('accountst')
        expect(readKeys).not.toContain('dosync')
        expect(readKeys).not.toContain('fallbackRisuToken')

        expect(localStorage.getItem('accountst')).toBe('able')
        expect(localStorage.getItem('dosync')).toBe('sync')
        expect(localStorage.getItem('fallbackRisuToken')).not.toBeNull()
        expect(get(loadedStore)).toBe(true)
    })

    test('an ordinary Tauri boot drops risuaiAccountCached exactly once, removes risu_lastsaved and the Drive backup flag, and leaves accountst, dosync and fallbackRisuToken untouched', async () => {
        localStorage.setItem('risu_lastsaved', '123456')
        localStorage.setItem('backup', 'save')
        // Present but irrelevant to a Tauri boot (I6): these three keys are
        // only ever read or removed by the non-Tauri stale-profile machinery,
        // so this shared cleanup must leave them exactly as it found them.
        localStorage.setItem('accountst', 'able')
        localStorage.setItem('dosync', 'sync')
        localStorage.setItem('fallbackRisuToken', JSON.stringify({ token: 'unrelated' }))
        fsStore.set('', new Uint8Array())
        fsStore.set('database', new Uint8Array())
        fsStore.set('assets', new Uint8Array())
        const dbBytes = baseDbBytes('tauri-ordinary-boot')
        fsStore.set('database/database.bin', dbBytes)

        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(dropsNamed('risuaiAccountCached')).toBe(1)
        // The default `localforage` database must not be created: the drop
        // is only ever valid through the named per-instance handle, never
        // the module-level `localforage.dropInstance(...)` form.
        expect(localforageDropInstanceMock).not.toHaveBeenCalled()
        expect(localStorage.getItem('risu_lastsaved')).toBeNull()
        expect(localStorage.getItem('backup')).toBeNull()
        expect(localStorage.getItem('accountst')).toBe('able')
        expect(localStorage.getItem('dosync')).toBe('sync')
        expect(localStorage.getItem('fallbackRisuToken')).not.toBeNull()
        expect(get(loadedStore)).toBe(true)
    })

    test('the per-instance dropInstance() call names risuaiAccountCached and carries no storeName (guard)', async () => {
        fsStore.set('', new Uint8Array())
        fsStore.set('database', new Uint8Array())
        fsStore.set('assets', new Uint8Array())
        const dbBytes = baseDbBytes('tauri-dropinstance-args')
        fsStore.set('database/database.bin', dbBytes)

        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        // localforage 1.10.0's IndexedDB driver deletes the whole named
        // database only when dropInstance() is given a name with no
        // storeName. Called with no options, it fills in storeName from the
        // instance's config, and any storeName makes it delete just that
        // object store, leaving an empty database behind (localforage
        // 1.10.0, dist/localforage.js, the IndexedDB dropInstance()).
        const instance = localforageInstances.find((inst) => inst.name === 'risuaiAccountCached')
        expect(instance).toBeDefined()
        const dropCalls = (instance!.dropInstance as ReturnType<typeof vi.fn>).mock.calls
        expect(dropCalls.length).toBe(1)
        expect(dropCalls[0][0]).toEqual({ name: 'risuaiAccountCached' })
        expect(get(loadedStore)).toBe(true)
    })
})


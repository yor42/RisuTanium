/**
 * `loadData()` restores the character this device was last left in, as the last step of the boot, and
 * remembers where the user goes afterwards. The pick is mocked at its boundary (`characterPick`); what is
 * checked is when the boot calls it, what it passes, which starting conditions stop it and what the memory
 * holds after. The stored literal is the shape `writeLastChaId` produces (`lastCharacterMemory.test.ts`).
 *
 * `bootstrap.ts` reads `isTauri` at its module top level, so this file keeps a fixed `isTauri: true` and
 * gives every test a fresh module graph. The mocked/real split mirrors `bootstrap.desktopLaunch.test.ts`.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get } from 'svelte/store'
import type { ChangeCharOutcome } from 'src/ts/characters'

const world = vi.hoisted(() => ({
    events: [] as string[],
    readOnly: false,
    realmDrain: (): void => { },
}))

// The mocked stores module is evaluated once per file, so it reads the current set through getters; every
// test replaces the set, so a recorder armed by an earlier test never hears this test's selections.
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

const pickMock = vi.hoisted(() => vi.fn())

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
    handlePendingRealmLink: vi.fn(async () => {
        world.events.push('realm')
        world.realmDrain()
    }),
    hubURL: 'https://realm.risuai.net',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/desktopLaunch'), () => ({
    desktopLaunchImport: vi.fn(async () => { world.events.push('desktop') }),
}) as unknown as typeof import('src/ts/desktopLaunch'))

vi.mock(import('src/ts/android/openedFiles'), () => ({
    androidOpenedFilesImport: vi.fn(() => { world.events.push('android') }),
}) as unknown as typeof import('src/ts/android/openedFiles'))

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
    changeCharGeneration: vi.fn(() => 0),
    supersedeChangeChar: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/characterPick'), () => ({
    changeCharOrAlert: pickMock,
}) as unknown as typeof import('src/ts/characterPick'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
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
    verifyAssetCacheEntry: vi.fn(async () => ({ status: 'ok' as const, expectedHash: '', actualHash: '' })),
}) as unknown as typeof import('src/ts/storage/assetIntegrity'))

vi.mock(import('src/ts/storage/remoteSaveCleanup'), () => ({
    getRemoteSaveCleanupAction: vi.fn(() => 'create-meta'),
    getRemoteSavePayloadName: vi.fn(() => null),
}) as unknown as typeof import('src/ts/storage/remoteSaveCleanup'))

vi.mock(import('src/ts/storage/loadTimeListing'), () => ({
    recordLoadTimeListing: vi.fn(async () => { }),
    resetLoadTimeListingForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/loadTimeListing'))

vi.mock(import('src/ts/storage/assetSweep'), () => ({
    sweepTauriAssets: vi.fn(async () => { }),
    sweepForageAssetKey: vi.fn(async () => { }),
    ASSET_SWEEP_BATCH_SIZE: 100,
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
    readDir: vi.fn(async () => []),
    remove: vi.fn(async (path: string) => { fsStore.delete(bare(path)) }),
}))

// Forces the page mode the restore reads; every other reader of the page mode keeps the real module.
vi.mock(import('src/ts/storage/pageStorageMode'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getPageStorageMode: () => world.readOnly ? { kind: 'read-only', reason: 'opfs-transitional' } as const : actual.getPageStorageMode(),
    }
})

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
const { LAST_CHARACTER_KEY } = await import('src/ts/lastCharacterMemory')

/** The memory exactly as `writeLastChaId` stores it; the producer is pinned in `lastCharacterMemory.test.ts`. */
const REMEMBERED_C2 = '{"chaId":"c2"}'

function armTauriBoot(extra: Record<string, unknown> = {}) {
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
        mainPrompt: 'last-character-fixture',
        loreBookToken: 8000,
        coldstorage: false,
        didFirstSetup: true,
        ...extra,
    }))
}

async function bootOnce(extra: Record<string, unknown> = {}): Promise<void> {
    armTauriBoot(extra)
    const { loadData } = await import('src/ts/bootstrap')
    await loadData()
}

/** A pick that selects at once, like a warm `changeChar`. */
function selectingPick(): void {
    pickMock.mockImplementation(async (_site: string, index: number): Promise<ChangeCharOutcome> => {
        world.events.push('restore')
        stores.selectedCharID.set(index)
        return 'selected'
    })
}

beforeEach(() => {
    holder.current = holder.make()
    localStorage.clear()
    fsStore.clear()
    dbState.current = {}
    world.events.length = 0
    world.readOnly = false
    world.realmDrain = () => { }
    pickMock.mockReset()
    selectingPick()
    vi.stubGlobal('open', vi.fn())
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
})

describe('loadData(): restoring the last character', () => {
    test('R1: a remembered character is picked once, as a quiet pick that keeps its last interaction, and ends selected', async () => {
        localStorage.setItem(LAST_CHARACTER_KEY, REMEMBERED_C2)

        await bootOnce()

        expect(pickMock).toHaveBeenCalledTimes(1)
        expect(pickMock).toHaveBeenCalledWith('boot.restoreLast', 1, { keepInteraction: true, quiet: true })
        expect(get(stores.selectedCharID)).toBe(1)
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe(REMEMBERED_C2)
    })

    test('R2: the restore is the last step: after saveDb and every launch drain', async () => {
        localStorage.setItem(LAST_CHARACTER_KEY, REMEMBERED_C2)

        await bootOnce()

        expect(world.events).toContain('saveDb')
        expect(world.events.slice(-4)).toEqual(['realm', 'desktop', 'android', 'restore'])
        expect(world.events.indexOf('saveDb')).toBeLessThan(world.events.indexOf('realm'))
    })

    test('nothing remembered, an unreadable value or an unknown id picks nothing and leaves the memory alone', async () => {
        for (const stored of [null, 'not json', '{"chaId":7}', '{"chaId":"nobody"}']) {
            pickMock.mockClear()
            localStorage.clear()
            if (stored !== null) {
                localStorage.setItem(LAST_CHARACTER_KEY, stored)
            }
            vi.resetModules()
            holder.current = holder.make()

            await bootOnce()

            expect(pickMock, String(stored)).not.toHaveBeenCalled()
            expect(localStorage.getItem(LAST_CHARACTER_KEY), String(stored)).toBe(stored)
        }
    })

    test('R3: after the boot, a selection is remembered by chaId and Home forgets it', async () => {
        await bootOnce()

        stores.selectedCharID.set(1)
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe(REMEMBERED_C2)

        stores.selectedCharID.set(-1)
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBeNull()
    })

    test('G1: the boot\'s own Home never clears the memory, even when the restore fails', async () => {
        localStorage.setItem(LAST_CHARACTER_KEY, REMEMBERED_C2)
        pickMock.mockImplementation(async (): Promise<ChangeCharOutcome> => ({ failed: 'missing' } as unknown as ChangeCharOutcome))

        await bootOnce()

        expect(pickMock).toHaveBeenCalledTimes(1)
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe(REMEMBERED_C2)
        expect(get(stores.selectedCharID)).toBe(-1)
    })

    test('a restore that never settles does not hold the boot', async () => {
        localStorage.setItem(LAST_CHARACTER_KEY, REMEMBERED_C2)
        pickMock.mockImplementation(() => new Promise(() => { }))

        await bootOnce()

        expect(pickMock).toHaveBeenCalledTimes(1)
    })

    test('a pick that throws does not reach the boot\'s error alert', async () => {
        localStorage.setItem(LAST_CHARACTER_KEY, REMEMBERED_C2)
        pickMock.mockImplementation(() => { throw new Error('boom') })
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

        await bootOnce()

        // The boot may post its own notices (a repaired persona toast); none of them is the error alert.
        expect(get(stores.alertStore).type).not.toBe('error')
        errorSpy.mockRestore()
    })

    test('G2: a read-only page neither restores nor remembers', async () => {
        localStorage.setItem(LAST_CHARACTER_KEY, REMEMBERED_C2)
        world.readOnly = true

        await bootOnce()
        stores.selectedCharID.set(0)
        stores.selectedCharID.set(-1)

        expect(pickMock).not.toHaveBeenCalled()
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe(REMEMBERED_C2)
    })

    const startingConditions: Array<[string, () => Promise<void>]> = [
        ['first setup not done', () => bootOnce({ didFirstSetup: false })],
        ['bot setting at start', () => bootOnce({ botSettingAtStart: true })],
        ['a realm link in the address', async () => {
            window.history.replaceState({}, '', '/?realm=x')
            await bootOnce()
        }],
        ['a waiting alert left by a launch drain', async () => {
            world.realmDrain = () => { stores.alertStore.set({ type: 'wait', msg: 'importing' }) }
            await bootOnce()
        }],
    ]

    test.each(startingConditions)('G3: %s: no restore, memory kept', async (_name, boot) => {
        localStorage.setItem(LAST_CHARACTER_KEY, REMEMBERED_C2)

        await boot()

        expect(pickMock).not.toHaveBeenCalled()
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe(REMEMBERED_C2)
    })
})


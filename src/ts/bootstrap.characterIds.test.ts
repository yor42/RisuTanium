/**
 * The character list `loadData()` installs: entries that are not characters
 * are left out, a missing id is filled, an id that cannot key a block is
 * replaced with the lists that named it following, and an archived character
 * with an id that cannot be saved is installed as it is (the save loop waits
 * on it). The persona list is repaired before the boot's own pass runs over it.
 *
 * The real `bootstrap.ts` and `characterTreeRepair.ts` with the pass module
 * mocked at its boundary, as in `bootstrap.archivePass.test.ts` (whose module
 * mocks are copied below). What each repair does in isolation is covered by
 * `storage/tests/characterTreeRepair.test.ts`.
 *
 * Title labels: (R) marks a reproducer that fails against a boot with no
 * repair before the install; (G) marks a guard that passes with or without it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { FallbackNotice } from 'src/ts/storage/opfsCopyBack'
import { BLOCK, composeSave, corruptBlockPayload } from 'src/ts/storage/tests/manualCleanupHarness'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

const MAIN_KEY = 'database/database.bin'

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const world = vi.hoisted(() => ({
    events: [] as string[],
    staleAccountProfile: false,
    fallbackNotice: null as FallbackNotice | null,
    items: new Map<string, Uint8Array>(),
    failingKeys: new Set<string>(),
    blockCache: new Map<string, unknown>(),
    readKeys: [] as string[],
    setItemKeys: [] as string[],
}))

interface RunInput { tree: Record<string, unknown> }

const pass = vi.hoisted(() => ({
    opened: [] as string[],
    runInputs: [] as unknown[],
    releaseCalls: 0,
    reloading: false,
    run: null as null | ((input: unknown) => Promise<unknown>),
}))

const sleepForeverMock = vi.hoisted(() => vi.fn(async (): Promise<void> => { }))
const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const noteMainFileBytesMock = vi.hoisted(() => vi.fn((_bytes: Uint8Array): void => { }))
const characterURLImportMock = vi.hoisted(() => vi.fn((): void => { }))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))

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
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: characterURLImportMock,
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

vi.mock(import('src/ts/storage/assetIntegrity'), () => ({
    verifyAssetCacheEntry: vi.fn(async () => ({ status: 'ok' as const })),
}) as unknown as typeof import('src/ts/storage/assetIntegrity'))

vi.mock(import('src/ts/storage/remoteSaveCleanup'), () => ({
    getRemoteSaveCleanupAction: vi.fn(() => 'create-meta'),
    getRemoteSavePayloadName: vi.fn(() => null),
}) as unknown as typeof import('src/ts/storage/remoteSaveCleanup'))

vi.mock(import('src/ts/storage/assetSweep'), () => ({
    sweepTauriAssets: vi.fn(async () => { }),
    sweepForageAssetKey: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/storage/assetSweep'))

vi.mock(import('src/ts/storage/mainFileRecord'), () => ({
    noteMainFileBytes: noteMainFileBytesMock,
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

vi.mock(import('src/ts/storage/loadTimeListing'), () => ({
    recordLoadTimeListing: vi.fn(async () => { }),
    resetLoadTimeListingForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/loadTimeListing'))

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

vi.mock(import('src/ts/storage/store/appStore'), async (importOriginal) => ({
    ...await importOriginal(),
    takeStorageFallbackNotice: () => {
        const notice = world.fallbackNotice
        world.fallbackNotice = null
        return notice
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
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
    saveDb: vi.fn(async () => { }),
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

vi.mock(import('src/ts/storage/bootArchivePass'), () => ({
    openBootArchiveSession: vi.fn(async (host: string) => {
        world.events.push(`open:${host}`)
        pass.opened.push(host)
        return {
            canArchive: !pass.reloading,
            reloading: pass.reloading,
            run: vi.fn(async (input: RunInput) => {
                world.events.push('run')
                pass.runInputs.push(input)
                if (pass.run) {
                    return pass.run(input)
                }
                return { kind: 'install', tree: input.tree, noteBytes: null, notices: [] }
            }),
            release: vi.fn(async () => {
                pass.releaseCalls++
                world.events.push('release')
            }),
        }
    }),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

const { encodeRisuSaveLegacy, RisuSaveEncoder, decodeRisuSave } = await import('src/ts/storage/risuSave')

function baseDb(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        formatversion: 999,
        characters: [{ chaId: 'a', name: 'A', type: 'character', chats: [] }],
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
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore }
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

beforeEach(() => {
    localStorage.clear()
    world.events.length = 0
    world.staleAccountProfile = false
    world.fallbackNotice = null
    world.items.clear()
    world.failingKeys.clear()
    world.blockCache.clear()
    world.readKeys.length = 0
    world.setItemKeys.length = 0
    pass.opened.length = 0
    pass.runInputs.length = 0
    pass.releaseCalls = 0
    pass.run = null
    pass.reloading = false
    sleepForeverMock.mockReset().mockResolvedValue(undefined)
    platformState.isTauri = false
    platformState.isNodeServer = false
    dbState.current = baseDb({ characters: [] })
    getDbBackupsMock.mockReset().mockResolvedValue([])
    noteMainFileBytesMock.mockClear()
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

describe('loadData() installs a character list the save can hold (S10)', () => {
    test('(R) an upstream main file with a number in characters boots without it', async () => {
        armLegacy(baseDb({ characters: [{ chaId: 'a', name: 'A', type: 'character', chats: [] }, 5, null, { chaId: 'b', name: 'B', type: 'character', chats: [] }] }))
        const { loadData } = await freshLoadData()

        await loadData()

        expect(characterIds(installedTrees()[0])).toEqual(['a', 'b'])
    })

    test('(R) a character whose id is a block name is installed with a new id and every list that named it follows', async () => {
        armLegacy(baseDb({
            characters: [
                { chaId: 'a', name: 'A', type: 'character', chats: [] },
                { chaId: 'preset', name: 'P', type: 'character', chats: [{ message: [{ role: 'char', data: 'hi', saying: 'preset' }, { role: 'user', data: 'yo', saying: 'preset' }] }] },
            ],
            characterOrder: ['a', { id: 'F', name: 'F', data: ['preset'] }],
            loadouts: [{ characterIds: ['preset'] }],
        }))
        const { loadData } = await freshLoadData()

        await loadData()

        const tree = installedTrees()[0]
        const [, replaced] = tree.characters as Array<{ chaId: string, chats: Array<{ message: Array<{ saying: string }> }> }>
        expect(replaced.chaId).not.toBe('preset')
        expect(tree.characterOrder).toEqual(['a', { id: 'F', name: 'F', data: [replaced.chaId] }])
        expect((tree.loadouts as Array<{ characterIds: string[] }>)[0].characterIds).toEqual([replaced.chaId])
        expect(replaced.chats[0].message[0].saying).toBe(replaced.chaId)
        expect(replaced.chats[0].message[1].saying).toBe('preset')
    })

    test('(G) an archived character with an id that cannot be saved is installed as it is', async () => {
        armLegacy(baseDb({
            characters: [
                { chaId: 'a', name: 'A', type: 'character', chats: [] },
                { chaId: 'config', name: 'Stub', type: 'character', coldstorage: 'unit-1', chats: [] },
            ],
        }))
        const { loadData } = await freshLoadData()

        await loadData()

        expect(characterIds(installedTrees()[0])).toEqual(['a', 'config'])
    })

    test('(G) a well-formed main file is installed unchanged and nothing is announced', async () => {
        armLegacy()
        const { loadData } = await freshLoadData()
        const alerts = await import('src/ts/alert')
        const toast = vi.spyOn(alerts, 'alertToast')

        await loadData()

        expect(characterIds(installedTrees()[0])).toEqual(['a'])
        expect(toast).not.toHaveBeenCalled()
    })

    test('(R) the person is told once, after the install, that the list was repaired', async () => {
        armLegacy(baseDb({ characters: [{ chaId: 'a', name: 'A', type: 'character', chats: [] }, 5] }))
        const { loadData } = await freshLoadData()
        const alerts = await import('src/ts/alert')
        const toast = vi.spyOn(alerts, 'alertToast')

        await loadData()

        expect(toast).toHaveBeenCalledTimes(1)
    })
})

describe('loadData() repairs the persona list before the boot pass reads it (S13)', () => {
    test('(R) personas with null and a number ahead of the selected persona keep that persona selected', async () => {
        armLegacy(baseDb({ personas: [null, 5, { name: 'chosen' }], selectedPersona: 2 }))
        const { loadData } = await freshLoadData()

        await loadData()

        const tree = lastInstalled()
        expect((tree.personas as Array<{ name: string }>).map((p) => p.name)).toEqual(['chosen'])
        expect(tree.selectedPersona).toBe(0)
    })

    test('(R) a personas value that is not a list becomes an empty list and the boot completes', async () => {
        armLegacy(baseDb({ personas: {} }))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(lastInstalled().personas).toEqual([])
    })

    test('(G) a clean persona list keeps its entries and ids', async () => {
        armLegacy(baseDb({ personas: [{ name: 'one', id: 'p1' }, { name: 'two', id: 'p2' }], selectedPersona: 1 }))
        const { loadData } = await freshLoadData()

        await loadData()

        const tree = lastInstalled()
        expect((tree.personas as Array<{ id: string }>).map((p) => p.id)).toEqual(['p1', 'p2'])
        expect(tree.selectedPersona).toBe(1)
    })
})
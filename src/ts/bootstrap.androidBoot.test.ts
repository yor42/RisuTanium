/**
 * `loadData()` on Android: the boot sends no synchronous plugin command that
 * waits for the UI thread. The real `bootstrap.ts` and the real Tauri
 * JavaScript APIs run over the in-memory IPC boundary of
 * `storage/tests/tauriWireFake.ts` (no module mock of `@tauri-apps/plugin-fs`,
 * `@tauri-apps/api/path` or `@tauri-apps/api/core`); the assertions are on the
 * recorded commands. A pass proves which commands the covered boots send, not
 * that the native shell no longer hangs.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { baseTree, fullCharacter } from 'src/ts/storage/tests/bootArchivePassHarness'
import { installTauriWire, WAITING_PLUGIN_COMMANDS, type TauriWire } from 'src/ts/storage/tests/tauriWireFake'

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const dbBackups = vi.hoisted(() => ({ list: async (): Promise<number[]> => [] }))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))

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

vi.mock(import('src/ts/desktopLaunch'), () => ({
    desktopLaunchImport: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/desktopLaunch'))

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
    noteMainFileBytes: vi.fn(),
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

vi.mock(import('src/ts/storage/loadTimeListing'), () => ({
    recordLoadTimeListing: vi.fn(async () => { }),
    resetLoadTimeListingForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/loadTimeListing'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({ startAvatarThumbSweep: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/model/modellist'), () => ({ registerModelDynamic: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))

// The window object is a stand-in only; nothing here is a Tauri API module.
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ maximize: vi.fn(async () => { }) })),
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
    getDbBackups: () => dbBackups.list(),
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

vi.mock(import('src/ts/storage/bootArchivePass'), () => ({
    openBootArchiveSession: vi.fn(async () => ({
        canArchive: true,
        run: vi.fn(async (input: { tree: Record<string, unknown> }) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] })),
        release: vi.fn(async () => { }),
    })),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

let wire: TauriWire

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

async function freshLoadData() {
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, loadedStore }
}

beforeEach(() => {
    localStorage.clear()
    dbState.current = baseDb({ characters: [] })
    dbBackups.list = async () => []
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    wire = installTauriWire({ os: 'android' })
    vi.resetModules()
})

afterEach(() => {
    // The boot leaves background tasks that still send commands after loadData resolves, so the wire stays installed until the file ends.
    vi.unstubAllGlobals()
})

function pluginFsCommands(): string[] {
    return wire.plugin().filter((cmd) => cmd.startsWith('plugin:fs|'))
}

function expectBootOrderAndNoWaiting(): void {
    const used = wire.plugin()
    expect(used.filter((cmd) => WAITING_PLUGIN_COMMANDS.includes(cmd))).toEqual([])
    const fsCommands = pluginFsCommands()
    expect(fsCommands.length, 'the boot sweeps the write temps with read_dir').toBeGreaterThan(0)
    expect(fsCommands[0]).toBe('plugin:fs|read_dir')
    expect(new Set(fsCommands)).toEqual(new Set(['plugin:fs|read_dir']))
}

describe('loadData() on Android sends no waiting plugin command', () => {
    test('a fresh profile (data directories missing) is created and booted', async () => {
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expectBootOrderAndNoWaiting()
        expect(get(loadedStore)).toBe(true)
        expect(wire.callsOf('app_fs_mkdir_all').map((call) => (call.args as { key: string }).key)).toEqual(['', 'database', 'assets'])
        expect(wire.fs.directories.has('database')).toBe(true)
        expect(wire.fs.directories.has('assets')).toBe(true)
    })

    test('an existing block profile boots as the tree it holds', async () => {
        wire.fs.directories.add('database')
        wire.fs.directories.add('assets')
        // A real block-store save of two characters over the wire, as an earlier page left it.
        const { getPageBlockOwner, resetPageBlockOwnerForTests } = await import('src/ts/storage/pageBlockOwner')
        const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
        const owner = await getPageBlockOwner()
        const saved = await owner?.replaceWholeState(
            await treeToBlockSet(baseTree([fullCharacter('x', 'Xavier'), fullCharacter('y', 'Yara')])),
            { requireAbsentHead: true },
        )
        expect(saved?.kind).toBe('won')
        resetPageBlockOwnerForTests()
        wire.clearCalls()
        setDatabaseMock.mockClear()
        vi.resetModules()
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expectBootOrderAndNoWaiting()
        expect(get(loadedStore)).toBe(true)
        const installed = setDatabaseMock.mock.calls.at(-1)?.[0] as { characters: Array<{ chaId: string, name: string, desc: string }> }
        expect(installed.characters.map((c) => [c.chaId, c.name, c.desc])).toEqual([
            ['x', 'Xavier', 'Xavier description'],
            ['y', 'Yara', 'Yara description'],
        ])
    })
    test('a stored legacy main file boots as the tree it holds', async () => {
        wire.fs.directories.add('assets')
        wire.fs.plant('database/database.bin', encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'stored', name: 'S', type: 'character', chats: [] }] })))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expectBootOrderAndNoWaiting()
        expect(get(loadedStore)).toBe(true)
        expect((setDatabaseMock.mock.calls[0][0].characters as { chaId: string }[]).map((c) => c.chaId)).toEqual(['stored'])
    })
})

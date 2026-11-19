/**
 * `loadData()` on Android: the boot sends no synchronous plugin command that
 * waits for the UI thread. The real `bootstrap.ts` and the real Tauri
 * JavaScript APIs run over the in-memory IPC boundary of
 * `storage/tests/tauriWireFake.ts` (no module mock of `@tauri-apps/plugin-fs`,
 * `@tauri-apps/api/path` or `@tauri-apps/api/core`); the assertions are on the
 * recorded commands. The store2 boot dispatch is the real one, over a memory
 * store2 backend (the wire does not model the store2 page registration), so the
 * Tauri order is pinned on the production path: the native write-temp sweep is
 * sent once, before the dispatch is entered and before any write-class command,
 * and the legacy main file and backups are only read. A pass proves which
 * commands the covered boots send, not that the native shell no longer hangs.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { installTauriWire, WAITING_PLUGIN_COMMANDS, type TauriWire, type WireCall } from 'src/ts/storage/tests/tauriWireFake'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'
import { registerRealDispatch } from 'src/ts/tests/realDispatchBoot.test-helpers'

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
    SafeModeStore: writable(false),
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

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

const MAIN_KEY = 'database/database.bin'

let wire: TauriWire

/** How many wire commands had been sent when the registered dispatch was entered; null while it has not been. */
let dispatchEntryIndex: number | null = null

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
    // The real dispatch over a memory store2 backend (the wire does not model the store2 page registration); the page's
    // own store stays the real Tauri store over the wire, so the sweep, the reads and any write are real wire commands.
    dispatchEntryIndex = null
    const dispatch = await registerRealDispatch({
        kind: 'tauri',
        acknowledgeAlerts: true,
        onEnter: () => { dispatchEntryIndex = wire.calls.length },
    })
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, loadedStore, dispatch }
}

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
beforeEach(expectBootstrapTransformed)
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

/**
 * The write commands an app_fs page sends. `loadData()` sends none of them before
 * the write-temp sweep resolves. The check covers `loadData()`'s own command order
 * only: not listeners installed by main.ts, App's drop handler or component mount
 * code, which the startup walk's cutoff keeps safe; on a reload, a pre-slot temp
 * older than the call's arrival minus the margin is still stage 1's exposure (Q1).
 */
const WRITE_CLASS_COMMANDS = [
    'write_durable', 'write_chunk', 'write_chunk_raw', 'put_assets_batch', 'put_assets_batch_b64',
    'abort_chunked', 'store2_write_top_raw', 'store2_write_top_chunk', 'store2_write_top_chunk_raw',
    'store2_remove', 'app_fs_remove', 'export_append_b64',
    'plugin:fs|write_file', 'plugin:fs|write_text_file', 'plugin:fs|rename', 'plugin:fs|remove', 'plugin:fs|truncate',
]

function expectBootOrderAndNoWaiting(): void {
    const used = wire.plugin()
    expect(used.filter((cmd) => WAITING_PLUGIN_COMMANDS.includes(cmd))).toEqual([])
    expect(wire.callsOf('app_fs_sweep_write_temps').length, 'the boot sends the native write-temp sweep exactly once').toBe(1)
    const commands = wire.calls.map((call) => call.cmd)
    const sweepAt = commands.indexOf('app_fs_sweep_write_temps')
    expect(dispatchEntryIndex, 'the registered dispatch was entered').not.toBeNull()
    expect(sweepAt, 'the native sweep is sent before the dispatch is entered').toBeLessThan(dispatchEntryIndex as number)
    // A store read is a per-key `read_range` or, for a multi-key unit read, the batched `read_store2_units`.
    const firstRead = commands.findIndex((cmd) => cmd === 'read_range' || cmd === 'read_store2_units')
    if (firstRead >= 0) {
        expect(sweepAt, 'the native sweep runs before the first store read').toBeLessThan(firstRead)
    }
    expect(commands.slice(0, sweepAt).filter((cmd) => WRITE_CLASS_COMMANDS.includes(cmd)), 'no write-class command is sent before the native sweep').toEqual([])
    expect(pluginFsCommands().filter((cmd) => cmd !== 'plugin:fs|read_dir'), 'the only file-plugin command is the listing').toEqual([])
}

/** The strings a wire command names as its target: a store key or a file path. */
function targetsOf(call: WireCall): string[] {
    const args = call.args as Record<string, unknown> | undefined
    if (args === undefined || args === null || typeof args !== 'object') {
        return []
    }
    return ['key', 'path', 'oldPath', 'newPath'].map((name) => args[name]).filter((value): value is string => typeof value === 'string')
}

/** The wire commands that write, rename or remove something under `database/`. */
function writesNamingDatabaseDirectory(): WireCall[] {
    return wire.calls.filter((call) => WRITE_CLASS_COMMANDS.includes(call.cmd) && targetsOf(call).some((target) => target.includes('database/')))
}

/** The `read_range` commands that name `key`. */
function readsOf(key: string): WireCall[] {
    return wire.callsOf('read_range').filter((call) => targetsOf(call).includes(key))
}

function bytesOf(key: string): string | undefined {
    const held = wire.fs.files.get(key)
    return held === undefined ? undefined : Buffer.from(held).toString('hex')
}

/** No stubbed `fetch` call named a `database/` URL: the main file and the backups reach the decoder through the app command. */
function expectNoAssetProtocolUrl(): void {
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    expect(urls.filter((url) => url.includes('database/'))).toEqual([])
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

    test('a stored legacy main file is converted and boots as the tree it holds, and the file is not touched', async () => {
        wire.fs.directories.add('assets')
        wire.fs.plant(MAIN_KEY, encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'stored', name: 'S', type: 'character', chats: [] }] })))
        const before = bytesOf(MAIN_KEY)
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expectBootOrderAndNoWaiting()
        expect(get(loadedStore)).toBe(true)
        expect((setDatabaseMock.mock.calls[0][0].characters as { chaId: string }[]).map((c) => c.chaId)).toEqual(['stored'])
        expect(bytesOf(MAIN_KEY)).toBe(before)
        expect(wire.callsOf('plugin:fs|rename')).toEqual([])
        expect(writesNamingDatabaseDirectory()).toEqual([])
        expect(readsOf(MAIN_KEY).length, 'the main file reached the decoder through the app command').toBeGreaterThan(0)
        expectNoAssetProtocolUrl()
    })

    test('an undecodable main file is never written over: the profile is converted from the numbered backup, read through the app command', async () => {
        wire.fs.directories.add('assets')
        wire.fs.plant(MAIN_KEY, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
        wire.fs.plant('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'old', name: 'O', type: 'character', chats: [] }] })))
        const before = bytesOf(MAIN_KEY)
        const { loadData, loadedStore, dispatch } = await freshLoadData()

        await loadData()

        expectBootOrderAndNoWaiting()
        expect(get(loadedStore)).toBe(true)
        // The route the real dispatch takes: the page converts from the numbered backup after the person agrees.
        expect(dispatch.ui.fromBackupAsked).toBe(1)
        expect((setDatabaseMock.mock.calls[0][0].characters as { chaId: string }[]).map((c) => c.chaId)).toEqual(['old'])
        expect(bytesOf(MAIN_KEY)).toBe(before)
        expect(wire.callsOf('plugin:fs|rename')).toEqual([])
        expect(writesNamingDatabaseDirectory()).toEqual([])
        expect(readsOf('database/dbbackup-1.bin').length, 'the backup reached the decoder through the app command').toBeGreaterThan(0)
        expectNoAssetProtocolUrl()
    })
})

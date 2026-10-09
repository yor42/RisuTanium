/**
 * `loadData()` on Android with the boot archive pass on: a block profile of
 * several full characters is archived, the commit lands, the old own blocks are
 * removed through the app's `app_fs_remove` command, and no synchronous plugin
 * command that waits for the UI thread is sent. The real `bootstrap.ts`, boot
 * archive pass, block store and cold-storage units run over the in-memory IPC
 * boundary of `storage/tests/tauriWireFake.ts`. A pass says nothing about the
 * phone's memory, speed or process kills, or the native shell.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { installTauriWire, WAITING_PLUGIN_COMMANDS, ANDROID_ALLOWED_PLUGIN_COMMANDS, type TauriWire } from 'src/ts/storage/tests/tauriWireFake'
import { baseTree, charactersOf, fullCharacter } from 'src/ts/storage/tests/bootArchivePassHarness'
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
    listStoredUnitNames: vi.fn(async () => []),
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
    locksSupported: true,
    acquireExclusiveStorageMigrationLock: vi.fn(async () => null),
    listAssetsWrittenThisPage: vi.fn((): string[] => []),
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))


vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

let wire: TauriWire

/** The bytes of the live generation's root, or an empty list when there is none. */
function rootBytes(): number[] {
    const key = Array.from(wire.fs.files.keys()).find((name) => /^blocks\/[^/]+\/root$/.test(name))
    return key === undefined ? [] : Array.from(wire.fs.files.get(key) ?? [])
}

async function seedBlockProfile(ids: string[]): Promise<void> {
    const { getPageBlockOwner, resetPageBlockOwnerForTests } = await import('src/ts/storage/pageBlockOwner')
    const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
    const owner = await getPageBlockOwner()
    if (owner === null) {
        throw new Error('no block owner on this page')
    }
    const tree = baseTree(ids.map((id) => fullCharacter(id, id.toUpperCase())), { archiveCharacters: true })
    const result = await owner.replaceWholeState(await treeToBlockSet(tree), { requireAbsentHead: true })
    if (result.kind !== 'won') {
        throw new Error('the block profile could not be seeded: ' + result.kind)
    }
    // The boot builds its own owner, as a fresh page does.
    resetPageBlockOwnerForTests()
}

beforeEach(async () => {
    localStorage.clear()
    dbState.current = { ...baseTree([]), coldstorage: false }
    dbBackups.list = async () => []
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    wire = installTauriWire({ os: 'android' })
    wire.fs.directories.add('database')
    wire.fs.directories.add('assets')
    vi.resetModules()
})

afterEach(() => {
    // The boot leaves background tasks that still send commands after loadData resolves, so the wire stays installed until the file ends.
    vi.unstubAllGlobals()
})

async function bootOnAndroid() {
    const { loadData } = await import('src/ts/bootstrap')
    const { loadedStore } = await import('src/ts/stores.svelte') as unknown as { loadedStore: ReturnType<typeof writable<boolean>> }
    loadedStore.set(false)
    await loadData()
    return { loaded: get(loadedStore) }
}

describe('the boot archive pass on Android', () => {
    test('archives full characters, commits, removes the old blocks through the app command and sends no waiting plugin command', async () => {
        await seedBlockProfile(['a', 'b', 'c'])
        const rootBefore = rootBytes()
        wire.clearCalls()

        const { loaded } = await bootOnAndroid()

        expect(loaded).toBe(true)
        const installed = setDatabaseMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
        const characters = charactersOf(installed as never) as Array<{ chaId: string, coldstorage?: string }>
        expect(characters.map((c) => c.chaId)).toEqual(['a', 'b', 'c'])
        expect(characters.every((c) => typeof c.coldstorage === 'string')).toBe(true)
        const units = Array.from(wire.fs.files.keys()).filter((key) => key.startsWith('coldstorage/'))
        expect(units).toHaveLength(3)
        expect(rootBytes()).not.toEqual(rootBefore)
        const removed = wire.callsOf('app_fs_remove').map((call) => String((call.args as { key: string }).key))
        expect(removed.some((key) => key.startsWith('blocks/'))).toBe(true)
        const used = wire.plugin()
        expect(used.filter((cmd) => WAITING_PLUGIN_COMMANDS.includes(cmd))).toEqual([])
        expect(used.filter((cmd) => !ANDROID_ALLOWED_PLUGIN_COMMANDS.includes(cmd))).toEqual([])
    })

    test('a commit whose root write fails keeps the old root and archives nothing; the next boot archives', async () => {
        await seedBlockProfile(['a', 'b'])
        const rootBefore = rootBytes()
        let failures = 0
        wire.desktop.chunk.failWrites(({ key }) => {
            if (/^blocks\/[^/]+\/root$/.test(key) && failures === 0) {
                failures++
                return 'No space left on device (os error 28)'
            }
            return undefined
        })

        const first = await bootOnAndroid()

        expect(first.loaded).toBe(true)
        expect(failures).toBe(1)
        expect(rootBytes()).toEqual(rootBefore)
        const firstInstalled = setDatabaseMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect((charactersOf(firstInstalled as never) as Array<{ coldstorage?: string }>).some((c) => typeof c.coldstorage === 'string')).toBe(false)

        setDatabaseMock.mockClear()
        vi.resetModules()
        await bootOnAndroid()

        expect(rootBytes()).not.toEqual(rootBefore)
        const secondInstalled = setDatabaseMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect((charactersOf(secondInstalled as never) as Array<{ coldstorage?: string }>).every((c) => typeof c.coldstorage === 'string')).toBe(true)
    })
})
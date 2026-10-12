/**
 * `loadData()` with trashed characters: the real boot order, the boot archive
 * pass and then the startup purge in `checkNewFormat`, over the in-memory IPC
 * boundary of `storage/tests/tauriWireFake.ts` with a block profile. A
 * recently trashed character is archived as a stub that keeps its `trashTime`;
 * one whose purge is due is purged with no unit; a trashed stub purged on a
 * later boot leaves its unit on disk. These say nothing about a device's
 * file system or the native shell.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { decompressSync } from 'fflate'
import { installTauriWire, WAITING_PLUGIN_COMMANDS, ANDROID_ALLOWED_PLUGIN_COMMANDS, type TauriWire } from 'src/ts/storage/tests/tauriWireFake'
import { baseTree, charactersOf, fullCharacter, type Json } from 'src/ts/storage/tests/bootArchivePassHarness'
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
const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000

/** The bytes of the live generation's root, or an empty list when there is none. */
function rootBytes(): number[] {
    const key = Array.from(wire.fs.files.keys()).find((name) => /^blocks\/[^/]+\/root$/.test(name))
    return key === undefined ? [] : Array.from(wire.fs.files.get(key) ?? [])
}

async function seedBlockProfile(characters: Json[]): Promise<void> {
    const { getPageBlockOwner, resetPageBlockOwnerForTests } = await import('src/ts/storage/pageBlockOwner')
    const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
    const owner = await getPageBlockOwner()
    if (owner === null) {
        throw new Error('no block owner on this page')
    }
    const tree = baseTree(characters, { archiveCharacters: true })
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
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    wire = installTauriWire({ os: 'android' })
    wire.fs.directories.add('database')
    wire.fs.directories.add('assets')
    vi.resetModules()
})

afterEach(() => {
    // The boot leaves background tasks that still send commands after loadData resolves, so the wire stays installed until the file ends.
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

async function bootOnAndroid() {
    const { loadData } = await import('src/ts/bootstrap')
    const { loadedStore } = await import('src/ts/stores.svelte') as unknown as { loadedStore: ReturnType<typeof writable<boolean>> }
    loadedStore.set(false)
    await loadData()
    return { loaded: get(loadedStore) }
}

function lastInstalled(): Array<{ chaId: string, coldstorage?: string, trashTime?: number }> {
    const installed = setDatabaseMock.mock.calls.at(-1)?.[0] as Record<string, unknown>
    return charactersOf(installed as never) as Array<{ chaId: string, coldstorage?: string, trashTime?: number }>
}

function unitFiles(): string[] {
    return Array.from(wire.fs.files.keys()).filter((key) => key.startsWith('coldstorage/'))
}

function unitText(key: string): string {
    return new TextDecoder().decode(decompressSync(wire.fs.files.get(key) as Uint8Array))
}

describe('trashed characters at boot', () => {
    test('new behaviour: a recently trashed character is archived and keeps its trashTime; a character whose purge is due is purged with no unit', async () => {
        const recent = NOW - 60_000
        await seedBlockProfile([
            fullCharacter('a', 'A'),
            fullCharacter('r', 'R', { trashTime: recent }),
            fullCharacter('p', 'P', { trashTime: 1 }),
        ])

        await bootOnAndroid()

        const characters = lastInstalled()
        expect(characters.map((c) => c.chaId)).toEqual(['a', 'r'])
        expect(characters.every((c) => typeof c.coldstorage === 'string')).toBe(true)
        expect(characters[1].trashTime).toBe(recent)
        expect(unitFiles()).toHaveLength(2)
        expect(unitFiles().some((key) => unitText(key).includes('"chaId":"r"'))).toBe(true)
        expect(unitFiles().some((key) => unitText(key).includes('"chaId":"p"'))).toBe(false)
        expect(unitFiles().some((key) => unitText(key).includes('trashTime'))).toBe(false)
    })

    test('new behaviour and mutation-checked guard: the purged character left no unit; archiving every trashed character fails this', async () => {
        await seedBlockProfile([
            fullCharacter('r', 'R', { trashTime: NOW - 60_000 }),
            fullCharacter('p', 'P', { trashTime: 1 }),
        ])

        await bootOnAndroid()

        expect(lastInstalled().map((c) => c.chaId)).toEqual(['r'])
        expect(unitFiles()).toHaveLength(1)
    })

    test('guard (MC-304; needs the archive of a trashed character first): a trashed stub purged on a later boot leaves its unit on disk', async () => {
        await seedBlockProfile([fullCharacter('r', 'R', { trashTime: NOW - 60_000 })])
        await bootOnAndroid()
        const units = unitFiles()
        expect(units).toHaveLength(1)

        vi.setSystemTime(NOW + 4 * DAY)
        setDatabaseMock.mockClear()
        vi.resetModules()
        await bootOnAndroid()

        expect(lastInstalled()).toEqual([])
        expect(unitFiles()).toEqual(units)
    })
})

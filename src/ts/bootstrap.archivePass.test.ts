/**
 * `loadData()`'s wiring of the boot archive pass, non-Tauri branch: the real
 * `bootstrap.ts` with the pass module mocked at its boundary
 * (`src/ts/storage/bootArchivePass.ts`: `openBootArchiveSession` and the
 * session it returns). What the pass itself does is covered by
 * `storage/tests/bootArchivePass.*.test.ts`; this file covers only where
 * `loadData()` opens the session, which decode it hands the pass, what it
 * installs for each outcome, which paths release the session, and where the
 * pass's notices are posted.
 *
 * `risuSave.ts` is real, so the strict and non-strict decodes of the fixtures
 * below are the real ones. `alert.ts` is real; acknowledgement is simulated
 * the way `AlertComp.svelte`'s OK button does it, by writing
 * `{ type: 'none', msg: '' }` to the shared alert store. Everything else
 * `bootstrap.ts` imports is mocked, as in the sibling bootstrap test files.
 * The Tauri branch has its own file (`bootstrap.archivePassTauri.test.ts`):
 * `bootstrap.ts` reads `isTauri` once at module load.
 *
 * Tests titled `guard:` assert that something does not happen; they pass with
 * and without the wiring and protect behaviour the wiring must keep. The
 * others assert behaviour only the wiring has.
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

describe('loadData() web: the pass runs on a strictly decoded main file', () => {
    test('G1: opens the session before the main file is read, then runs the pass on the decoded tree before installing it', async () => {
        armLegacy()
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(pass.runInputs.length).toBe(1)
        const input = pass.runInputs[0] as RunInput
        expect(characterIds(input.tree)).toEqual(['a'])
        const order = world.events.filter((e) => ['init', 'open:web', 'read-main', 'run', 'setDatabase'].includes(e))
        // Up to and including the first install; the boot re-installs the live database later, which is not constrained here.
        expect(order.slice(0, order.indexOf('setDatabase') + 1)).toEqual(['init', 'open:web', 'read-main', 'run', 'setDatabase'])
    })

    test('G1: a pass that rejects leaves the boot installing the main file content, not a backup', async () => {
        armLegacy()
        world.items.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'old', name: 'Old', type: 'character', chats: [] }] })))
        getDbBackupsMock.mockResolvedValue([1])
        pass.run = async () => { throw new Error('pass failed') }
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(get(loadedStore)).toBe(true)
        expect(characterIds(installedTrees()[0])).toEqual(['a'])
        expect(getDbBackupsMock).not.toHaveBeenCalled()
        expect(world.readKeys.some((k) => k.startsWith('database/dbbackup-'))).toBe(false)
    })

    test('installs the tree the pass returns and notes the bytes it names', async () => {
        armLegacy()
        const committed = new Uint8Array([1, 2, 3])
        pass.run = async (input) => ({
            kind: 'install',
            tree: { ...(input as RunInput).tree, characters: [{ chaId: 'from-pass', name: 'P', type: 'character', chats: [] }] },
            noteBytes: committed,
            notices: [],
        })
        const { loadData } = await freshLoadData()

        await loadData()

        expect(characterIds(installedTrees()[0])).toEqual(['from-pass'])
        expect(noteMainFileBytesMock.mock.calls.at(-1)?.[0]).toBe(committed)
    })

    test('guard: an install outcome with no bytes to note leaves the boot read as the record', async () => {
        const bytes = armLegacy()
        const { loadData } = await freshLoadData()

        await loadData()

        expect(noteMainFileBytesMock.mock.calls.map((c) => c[0])).toEqual([bytes])
    })

    test('a backup-fallback outcome takes the existing backup path', async () => {
        armLegacy()
        world.items.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'old', name: 'Old', type: 'character', chats: [] }] })))
        getDbBackupsMock.mockResolvedValue([1])
        pass.run = async () => ({ kind: 'backup-fallback' })
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(get(loadedStore)).toBe(true)
        expect(characterIds(installedTrees()[0])).toEqual(['old'])
    })

    test('a stop outcome ends the boot with the error shown, installing nothing', async () => {
        armLegacy()
        pass.run = async () => ({ kind: 'stop', error: 'getItem Error' })
        const { loadData, alertStore, loadedStore } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(get(loadedStore)).toBe(false)
        expect(get(alertStore).type).toBe('error')
        expect(installedTrees()).toEqual([])
        expect(getDbBackupsMock).not.toHaveBeenCalled()
    })
})

describe('loadData() web: the session is released when the boot cannot go on', () => {
    test('guard: a main-file read that throws releases the session, shows the error and installs nothing', async () => {
        armLegacy()
        world.failingKeys.add(MAIN_KEY)
        const { loadData, alertStore, loadedStore } = await freshLoadData()

        await loadData()

        expect(pass.opened).toEqual(['web'])
        expect(pass.runInputs.length).toBe(0)
        expect(pass.releaseCalls).toBeGreaterThan(0)
        expect(get(alertStore).type).toBe('error')
        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    test('guard: a boot that is reloading waits without reading the main file or installing anything', async () => {
        armLegacy()
        pass.reloading = true
        sleepForeverMock.mockImplementation(() => new Promise<void>(() => { }))
        const { loadData, loadedStore } = await freshLoadData()

        void loadData()
        await new Promise((resolve) => setTimeout(resolve, 150))

        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(world.readKeys).not.toContain(MAIN_KEY)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(pass.runInputs.length).toBe(0)
        expect(get(loadedStore)).toBe(false)
    })

    test('guard: an ordinary boot never waits on the reloading branch', async () => {
        armLegacy()
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(sleepForeverMock).not.toHaveBeenCalled()
        expect(get(loadedStore)).toBe(true)
    })
})

describe('loadData() web: a main file that does not decode, or does not decode completely, never reaches the pass', () => {
    test('G2: guard: an undecodable main file takes the backup path and the pass is never run', async () => {
        world.items.set(MAIN_KEY, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
        world.items.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'old', name: 'Old', type: 'character', chats: [] }] })))
        getDbBackupsMock.mockResolvedValue([1])
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(0)
        expect(get(loadedStore)).toBe(true)
        expect(characterIds(installedTrees()[0])).toEqual(['old'])
    })

    test('releases the session on the backup path', async () => {
        world.items.set(MAIN_KEY, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
        world.items.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb()))
        getDbBackupsMock.mockResolvedValue([1])
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.opened).toEqual(['web'])
        expect(pass.releaseCalls).toBeGreaterThan(0)
    })

    const incomplete: [string, () => Promise<Uint8Array>, (ids: string[], tree: Record<string, unknown>) => void][] = [
        ['F1: a character whose remote file cannot be read', async () => {
            world.failingKeys.add('remotes/b.0123456789abcdef.bin')
            return (await composeBlockFile()).bytes
        }, (ids) => expect(ids).toEqual(['a'])],
        ['F2: a block with a bad checksum that the block cache would answer', async () => {
            const save = await composeBlockFile({ b: 'inline' })
            world.blockCache.set('risuSaveBlock_b', { type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', data: JSON.stringify({ chaId: 'b', name: 'Stale B', type: 'character', chats: [] }) })
            return corruptBlockPayload(save, 'b')
        }, (ids) => expect(ids).toEqual(['a', 'b'])],
        ['F3: a damaged PLUGINS block', async () => {
            const save = await composeBlockFile({ b: 'inline', plugins: [{ name: 'p', version: '2.1', enabled: true }] })
            return corruptBlockPayload(save, 'plugins')
        }, (ids, tree) => {
            expect(ids).toEqual(['a', 'b'])
            expect(tree.plugins).toBeUndefined()
        }],
    ]

    test.each(incomplete)('%s: guard: the pass is not run, the partial tree is installed as it always was and nothing is written or shown', async (_label, arm, check) => {
        const bytes = await arm()
        world.items.set(MAIN_KEY, bytes)
        await expect(decodeRisuSave(bytes, { strict: true })).rejects.toBeDefined()
        await expect(decodeRisuSave(bytes)).resolves.toBeDefined()
        const { loadData, alertStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        await loadData()
        alerts.stop()

        expect(pass.runInputs.length).toBe(0)
        const trees = installedTrees()
        expect(trees.length).toBeGreaterThan(0)
        check(characterIds(trees[0]), trees[0])
        expect(world.setItemKeys).toEqual([])
        expect(alerts.seen).toEqual([])
        expect(getDbBackupsMock).not.toHaveBeenCalled()
    })

    test.each(incomplete)('%s: releases the session without running the pass', async (_label, arm) => {
        world.items.set(MAIN_KEY, await arm())
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.opened).toEqual(['web'])
        expect(pass.releaseCalls).toBeGreaterThan(0)
    })
})

describe('loadData() web: the pass notices are posted after the install and awaited in order', () => {
    const space: FallbackNotice = { reason: 'space' }

    /** Waits until `count` alerts have been recorded. */
    async function waitForAlerts(seen: unknown[], count: number) {
        await vi.waitFor(() => { expect(seen.length).toBeGreaterThanOrEqual(count) }, { timeout: 1000, interval: 5 })
    }

    test('G3 / D4: the archive notice and then the stopped-pass notice follow the storage fallback notice, each awaited before characterURLImport', async () => {
        armLegacy()
        world.fallbackNotice = space
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-enabled' }, { kind: 'archive-stopped', characterName: 'Zed Marker' }],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        const loading = loadData()
        try {
            await waitForAlerts(alerts.seen, 1)
            expect(characterURLImportMock).not.toHaveBeenCalled()
            alertStore.set({ type: 'none', msg: '' })

            await waitForAlerts(alerts.seen, 2)
            expect(characterURLImportMock).not.toHaveBeenCalled()
            expect(alerts.seen[1].msg).not.toContain('Zed Marker')
            alertStore.set({ type: 'none', msg: '' })

            await waitForAlerts(alerts.seen, 3)
            expect(characterURLImportMock).not.toHaveBeenCalled()
            expect(alerts.seen[2].msg).toContain('Zed Marker')
            alertStore.set({ type: 'none', msg: '' })

            await loading
            expect(get(loadedStore)).toBe(true)
            expect(characterURLImportMock).toHaveBeenCalledTimes(1)
            expect(new Set(alerts.seen.map((a) => a.msg)).size).toBe(3)
            expect(world.events.indexOf('setDatabase')).toBeLessThan(world.events.indexOf('alert:1'))
            expect(world.events.indexOf('alert:3')).toBeLessThan(world.events.indexOf('characterURLImport'))
        } finally {
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('guard: an outcome with no notices posts no alert', async () => {
        armLegacy()
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        await loadData()
        alerts.stop()

        expect(get(loadedStore)).toBe(true)
        expect(alerts.seen).toEqual([])
    })
})

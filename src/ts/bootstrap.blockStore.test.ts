/**
 * `loadData()` on the self-hosted Node server with a block profile
 * (`src/ts/bootstrap.ts` over the real Node store, owner and
 * `bootBlockLoad.ts`): the profile loads from the block store, a damaged one
 * goes to the prompt and nothing is written or deleted before the choice, a
 * chosen backup keeps the damaged generation and holds the startup asset sweep
 * off for the same boot, and a kept generation holds the sweep off on a clean
 * load.
 *
 * The real `NodeStorage` and Node HTTP store run against the `FakeNodeServer`
 * stand-in at the `fetch` boundary; `risuSave.ts` is real, the alert prompts are
 * recorded stand-ins, and everything else `bootstrap.ts` imports is mocked as in
 * `bootstrap.mainFileRead.node.test.ts`. The boot archive pass is mocked at its
 * boundary. A passing test here says nothing about the real server.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { FakeNodeServer } from 'src/ts/storage/tests/manualCleanupHarness'
import { createFakeStore, makeOwner } from 'src/ts/storage/tests/blockStoreHarness'
import { BLOCK_TYPE_CHARACTER_WITH_CHAT, frameBlock } from 'src/ts/storage/blockFrame'
import { keptKey, ownBlockKey } from 'src/ts/storage/blockKeys'
import { preBlocksKey } from 'src/ts/storage/mainFileFingerprint'

const HEAD_KEY = 'blocks/head'

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const world = vi.hoisted(() => ({
    storage: null as unknown,
}))

/** What the prompts were asked, in order, and what they answer. */
const prompts = vi.hoisted(() => ({
    log: [] as string[],
    /** Index answers of `alertSelect`, in order; the last repeats. */
    selects: [0] as number[],
    /** What the server had been asked to change when each prompt was shown. */
    atPrompt: [] as number[],
    /** How often the pruning backup listing had run when each prompt was shown. */
    listingsAtPrompt: [] as number[],
    errors: [] as string[],
    countChanges: (): number => 0,
}))

const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const buildAssetKeepSetMock = vi.hoisted(() => vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })))

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
    isTauri: false,
    isNodeServer: true,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(async () => { }),
    checkNullish: (v: unknown) => v === null || v === undefined,
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    getKeypairStore: vi.fn(async () => {
        keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
}) as unknown as typeof import('src/ts/util'))

let keyPair: CryptoKeyPair | null = null

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: vi.fn(),
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbState.current),
    setDatabase: setDatabaseMock,
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
    presetFromWorkingSettings: (db: { mainPrompt?: string }, name: string, image: string) => ({ name, image, mainPrompt: db.mainPrompt }),
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

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn((message: unknown) => { prompts.errors.push(String(message)) }),
    alertMd: vi.fn(),
    alertStaleAccountNotice: vi.fn(async () => { }),
    alertNormal: vi.fn((message: string) => { prompts.log.push(`normal:${message}`) }),
    alertNormalWait: vi.fn(async (message: string) => {
        prompts.atPrompt.push(prompts.countChanges())
        prompts.listingsAtPrompt.push(getDbBackupsMock.mock.calls.length)
        prompts.log.push(`notify:${message}`)
    }),
    alertSelect: vi.fn(async (options: string[], title?: string) => {
        prompts.atPrompt.push(prompts.countChanges())
        prompts.listingsAtPrompt.push(getDbBackupsMock.mock.calls.length)
        prompts.log.push(`select:${title ?? ''}:${options.join('|')}`)
        return String(prompts.selects.length > 1 ? prompts.selects.shift() : prompts.selects[0])
    }),
    waitAlert: vi.fn(async () => { }),
    alertConfirm: vi.fn(async (message: string) => { prompts.log.push(`confirm:${message}`); return true }),
    alertInput: vi.fn(async () => ''),
    alertToast: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

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

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const storage = () => world.storage as {
        getItem(key: string): Promise<Uint8Array | null>
        setItem(key: string, value: Uint8Array): Promise<void>
        keys(): Promise<string[]>
        removeItem(key: string): Promise<void>
    }
    return {
        forageStorage: {
            staleAccountProfile: false,
            get realStorage() { return world.storage },
            Init: vi.fn(async () => { }),
            getItem: (key: string) => storage().getItem(key),
            setItem: (key: string, value: Uint8Array) => storage().setItem(key, value),
            keys: () => storage().keys(),
            removeItem: (key: string) => storage().removeItem(key),
        },
        saveDb: vi.fn(async () => { }),
        getDbBackups: getDbBackupsMock,
        buildAssetKeepSet: buildAssetKeepSetMock,
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
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/bootArchivePass'), () => ({
    openBootArchiveSession: vi.fn(async () => ({
        canArchive: true,
        reloading: false,
        run: vi.fn(async (input: { tree: Record<string, unknown> }) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] })),
        release: vi.fn(async () => { }),
        acquireReplaceHold: vi.fn(async () => ({ kind: 'held', release: async () => { } })),
    })),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

function baseDb(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        formatversion: 999,
        characters: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        personas: [],
        characterOrder: [],
        mainPrompt: 'fixture-main-prompt',
        loreBookToken: 8000,
        hotkeys: [],
        botPresets: [{ name: 'p' }],
        botPresetsId: 0,
        coldstorage: false,
        checkCorruption: false,
        botSettingAtStart: false,
        betaMobileGUI: false,
        didFirstSetup: true,
        heightMode: 'auto',
        ...extra,
    }
}
dbState.baseline = () => baseDb()

function dbWith(...chaIds: string[]): Record<string, unknown> {
    return baseDb({ characters: chaIds.map((chaId) => ({ chaId, name: chaId.toUpperCase(), type: 'character', chats: [] })) })
}

let server: FakeNodeServer

/** Puts a complete block profile of `value` on the server and returns its generation. */
async function putProfile(value: Record<string, unknown>): Promise<string> {
    const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
    const scratch = createFakeStore({ versioned: false })
    const seeded = await makeOwner(scratch).owner.replaceWholeState(await treeToBlockSet(value as never), { requireAbsentHead: true })
    if (seeded.kind !== 'won') {
        throw new Error(`seeding failed: ${seeded.kind}`)
    }
    for (const key of scratch.keys('blocks/')) {
        server.seed(key, scratch.peek(key) as Uint8Array)
    }
    return seeded.generation
}

async function putBackup(time: number, value: Record<string, unknown>): Promise<void> {
    const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
    const { layoutFileBytes } = await import('src/ts/storage/bootBlockLoad')
    server.seed(`database/dbbackup-${time}.bin`, layoutFileBytes((await treeToBlockSet(value as never)).layout))
}

function breakContent(generation: string, chaId: string): void {
    server.seed(ownBlockKey(generation, chaId), frameBlock(BLOCK_TYPE_CHARACTER_WITH_CHAT, chaId, new TextEncoder().encode('{not json')))
}


function changesSoFar(): number {
    return server.requestsTo('/api/write').length + server.requestsTo('/api/remove').length
}

async function freshLoadData() {
    const { loadData } = await import('src/ts/bootstrap')
    const { getStartupCleanup } = await import('src/ts/storage/startupCleanupState')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return {
        async boot() {
            await loadData()
            await (getStartupCleanup() ?? Promise.resolve())
            return { loaded: get(loadedStore) }
        },
    }
}

function installedCharacterIds(): string[][] {
    return setDatabaseMock.mock.calls.map((call) => ((call[0].characters ?? []) as { chaId: string }[]).map((c) => c.chaId))
}

/** A new page load: fresh modules and a fresh Node client over the same server. */
async function restartPage(): Promise<void> {
    vi.resetModules()
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    world.storage = new NodeStorage()
}

beforeEach(async () => {
    localStorage.clear()
    keyPair = null
    dbState.current = baseDb()
    prompts.log.length = 0
    prompts.atPrompt.length = 0
    prompts.listingsAtPrompt.length = 0
    prompts.errors.length = 0
    prompts.selects = [0]
    prompts.countChanges = changesSoFar
    getDbBackupsMock.mockReset().mockResolvedValue([])
    buildAssetKeepSetMock.mockClear()
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    server = new FakeNodeServer()
    vi.stubGlobal('fetch', server.fetch)
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    await restartPage()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('loadData() on the Node server with a block profile', () => {
    test('a stored block profile boots as the tree it holds, and a clean boot writes nothing', async () => {
        await putProfile(dbWith('stored'))
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['stored'])
        expect(server.requestsTo('/api/write')).toEqual([])
        expect(server.requestsTo('/api/remove')).toEqual([])
    })

    test('a stored profile whose preset id is past the end of the list boots with the working settings appended as a new preset the id points at, and no stored preset is changed', async () => {
        await putProfile(baseDb({ botPresets: [{ name: 'Stored one', mainPrompt: 'stored prompt' }], botPresetsId: 4 }))
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        const booted = dbState.current as { botPresets: Array<{ name: string, mainPrompt?: string }>, botPresetsId: number }
        expect(booted.botPresets).toHaveLength(2)
        expect(booted.botPresets[0]).toMatchObject({ name: 'Stored one', mainPrompt: 'stored prompt' })
        expect(booted.botPresets[1]).toMatchObject({ name: 'New Preset', mainPrompt: 'fixture-main-prompt' })
        expect(booted.botPresetsId).toBe(1)
    })

    test('guard: a stored profile whose preset id is -1 boots with the presets and the id as they were', async () => {
        await putProfile(baseDb({ botPresets: [{ name: 'Stored one' }], botPresetsId: -1 }))
        const { boot } = await freshLoadData()

        await boot()

        const booted = dbState.current as { botPresets: unknown[], botPresetsId: number }
        expect(booted.botPresets).toHaveLength(1)
        expect(booted.botPresetsId).toBe(-1)
    })

    test('a kept generation on disk holds the startup asset sweep off, and an ordinary profile does not', async () => {
        const generation = await putProfile(dbWith('stored'))
        server.seed('blocks/000000000001-00000001/root', new Uint8Array([1]))
        server.seed(keptKey('000000000001-00000001'), new TextEncoder().encode('{"kept":true}'))
        server.seed('assets/orphan.png', new Uint8Array([1]))
        const held = await freshLoadData()

        await held.boot()

        expect(buildAssetKeepSetMock, 'no keep-set is built: the asset sweep did not run').not.toHaveBeenCalled()
        expect(server.files.has('assets/orphan.png')).toBe(true)
        expect(server.files.has(`blocks/${generation}/root`)).toBe(true)
    })

    test('the legacy block cache database is dropped after a block boot, and left alone by a legacy boot', async () => {
        async function cacheDrops(): Promise<number> {
            const localforage = (await import('localforage')).default
            let drops = 0
            for (const result of vi.mocked(localforage.createInstance).mock.results) {
                const drop = (result.value as { dropInstance: ReturnType<typeof vi.fn> }).dropInstance
                drops += drop.mock.calls.filter(([options]) => (options as { name?: string }).name === 'risuSaveCache').length
            }
            return drops
        }
        await putProfile(dbWith('stored'))
        const block = await freshLoadData()
        await block.boot()
        const afterBlockBoot = await cacheDrops()
        expect(afterBlockBoot).toBeGreaterThan(0)

        server.files.clear()
        await restartPage()
        server.seed('database/database.bin', (await import('src/ts/storage/risuSave')).encodeRisuSaveLegacy(dbWith('legacy')))
        const legacy = await freshLoadData()
        await legacy.boot()
        expect(await cacheDrops(), 'a boot that stayed on the legacy main file keeps its cache').toBe(afterBlockBoot)
    })

    test('a pre-conversion copy of the main file holds the startup asset sweep off for as long as it exists, and the next boot after it is deleted sweeps', async () => {
        await putProfile(dbWith('stored'))
        server.seed(preBlocksKey(0), new Uint8Array([1, 2, 3]))
        server.seed('assets/orphan.png', new Uint8Array([1]))
        const held = await freshLoadData()

        await held.boot()

        expect(buildAssetKeepSetMock, 'no keep-set is built while the copy exists').not.toHaveBeenCalled()
        expect(server.files.has('assets/orphan.png')).toBe(true)

        server.files.delete(preBlocksKey(0))
        await restartPage()
        const resumed = await freshLoadData()
        await resumed.boot()

        expect(buildAssetKeepSetMock, 'the sweep resumes once the copy is gone').toHaveBeenCalled()
    })

    test('a legacy main file left beside a block profile holds the startup asset sweep off for as long as it exists, and the next boot after it is deleted sweeps', async () => {
        await putProfile(dbWith('stored'))
        server.seed('database/database.bin', new Uint8Array([9, 9, 9]))
        server.seed('assets/orphan.png', new Uint8Array([1]))
        const held = await freshLoadData()

        await held.boot()

        expect(buildAssetKeepSetMock, 'no keep-set is built while the legacy main file exists').not.toHaveBeenCalled()
        expect(server.files.has('assets/orphan.png')).toBe(true)

        server.files.delete('database/database.bin')
        await restartPage()
        const resumed = await freshLoadData()
        await resumed.boot()

        expect(buildAssetKeepSetMock, 'the sweep resumes once the legacy main file is gone').toHaveBeenCalled()
    })

    test('guard: a legacy profile is not held off by its own main file', async () => {
        server.seed('database/database.bin', (await import('src/ts/storage/risuSave')).encodeRisuSaveLegacy(dbWith('legacy')))
        const { boot } = await freshLoadData()

        await boot()

        expect(buildAssetKeepSetMock).toHaveBeenCalled()
    })

    test('guard: with no kept generation the startup asset sweep builds its keep-set', async () => {
        await putProfile(dbWith('stored'))
        const { boot } = await freshLoadData()

        await boot()

        expect(buildAssetKeepSetMock).toHaveBeenCalled()
    })
})

describe('loadData() on the Node server with a damaged block profile', () => {
    test('a block that does not decode is offered a backup: nothing is written or deleted before the choice, the choice loads the backup and keeps the damaged save, and the same boot does not sweep assets', async () => {
        const generation = await putProfile(dbWith('good', 'bad'))
        breakContent(generation, 'bad')
        await putBackup(100, dbWith('from-backup'))
        // More backups than the listing keeps: the prompt must not prune them.
        for (let time = 1; time <= 21; time++) {
            server.seed(`database/dbbackup-${time}.bin`, new Uint8Array([1]))
        }
        server.seed('assets/orphan.png', new Uint8Array([1]))
        const { boot } = await freshLoadData()
        const changesBefore = changesSoFar()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['from-backup'])
        expect(prompts.log[0]).toContain('"bad"')
        expect(prompts.log.some((entry) => entry.startsWith('select:'))).toBe(true)
        expect(prompts.atPrompt.every((count) => count === changesBefore), 'no write or delete before the choice').toBe(true)
        expect(prompts.listingsAtPrompt.every((count) => count === 0), 'the pruning listing has not run before the choice').toBe(true)
        expect(server.files.has(keptKey(generation)), 'the damaged generation is kept').toBe(true)
        expect(server.files.has(`blocks/${generation}/root`)).toBe(true)
        expect(buildAssetKeepSetMock, 'the same boot does not sweep assets').not.toHaveBeenCalled()
        expect(server.files.has('assets/orphan.png')).toBe(true)
        for (let time = 1; time <= 21; time++) {
            expect(server.files.has(`database/dbbackup-${time}.bin`), `backup ${time} is not pruned`).toBe(true)
        }
    })

    test('stop: the boot ends with the damage named on the stop screen, nothing is written and the next start asks again', async () => {
        const generation = await putProfile(dbWith('good', 'bad'))
        breakContent(generation, 'bad')
        await putBackup(100, dbWith('from-backup'))
        prompts.selects = [1]
        const { boot } = await freshLoadData()
        const changesBefore = changesSoFar()

        const { loaded } = await boot()

        expect(loaded).toBe(false)
        expect(prompts.errors.length).toBe(1)
        expect(prompts.errors[0]).toContain('"bad"')
        expect(changesSoFar()).toBe(changesBefore)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        // The next start asks again.
        prompts.selects = [1]
        prompts.log.length = 0
        await restartPage()
        const again = await freshLoadData()
        await again.boot()
        expect(prompts.log.some((entry) => entry.startsWith('select:'))).toBe(true)
    })

    test('a head that is not a head offers the backup too, and the older generation is kept', async () => {
        const generation = await putProfile(dbWith('good'))
        server.seed(HEAD_KEY, new TextEncoder().encode('this is not a head'))
        await putBackup(100, dbWith('from-backup'))
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['from-backup'])
        expect(server.files.has(keptKey(generation))).toBe(true)
        expect(Array.from(server.files.get(HEAD_KEY)?.bytes ?? []), 'the head now names the restored profile').not.toEqual(Array.from(new TextEncoder().encode('this is not a head')))
        expect(buildAssetKeepSetMock).not.toHaveBeenCalled()
    })
})

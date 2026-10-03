/**
 * `loadData()`'s handling of the boot archive pass's device memo, non-Tauri
 * branch: the real `bootstrap.ts` with the pass module mocked at its boundary
 * (`src/ts/storage/bootArchivePass.ts`). What the pass does with the memo is
 * covered by `storage/tests/bootArchivePass.*.test.ts`; this file covers the
 * two things bootstrap does with it: write it after it has posted the notice
 * that carries it, and clear it on a boot that reads the setting off.
 *
 * `risuSave.ts` and `bootArchiveMemo.ts` are real, and `localStorage` is the
 * happy-dom one. `alert.ts` is real; acknowledgement is simulated the way
 * `AlertComp.svelte`'s OK button does it, by writing `{ type: 'none', msg: '' }`
 * to the shared alert store. Everything else `bootstrap.ts` imports is mocked,
 * as in `bootstrap.archivePass.test.ts`. The memo module is loaded inside the
 * tests that need it, so a test that does not need it is not affected by it.
 *
 * Tests titled `guard:` assert behaviour that must not change; they pass with
 * and without the memo. The others assert the memo being written after its
 * notice and cleared on a boot that reads the setting off.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
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
    items: new Map<string, Uint8Array>(),
}))

interface RunInput { tree: Record<string, unknown>, prePassBytes?: Uint8Array }

const pass = vi.hoisted(() => ({
    runInputs: [] as unknown[],
    canArchive: true,
    run: null as null | ((input: unknown) => Promise<unknown>),
}))

const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const noteMainFileBytesMock = vi.hoisted(() => vi.fn((_bytes: Uint8Array): void => { }))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(() => ({
            getItem: vi.fn(async () => null),
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

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        get staleAccountProfile() { return world.staleAccountProfile },
        set staleAccountProfile(v: boolean) { world.staleAccountProfile = v },
        Init: vi.fn(async () => { world.events.push('init') }),
        getItem: vi.fn(async (key: string) => world.items.get(key) ?? null),
        setItem: vi.fn(async () => { }),
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
    openBootArchiveSession: vi.fn(async () => ({
        canArchive: pass.canArchive,
        reloading: false,
        run: vi.fn(async (input: RunInput) => {
            world.events.push('run')
            pass.runInputs.push(input)
            if (pass.run) {
                return pass.run(input)
            }
            return { kind: 'install', tree: input.tree, noteBytes: null, notices: [] }
        }),
        release: vi.fn(async () => { world.events.push('release') }),
    })),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

const { encodeRisuSaveLegacy, RisuSaveEncoder, decodeRisuSave } = await import('src/ts/storage/risuSave')

type MemoModule = typeof import('src/ts/storage/bootArchiveMemo')

async function memoModule(): Promise<MemoModule> {
    const path = '/src/ts/storage/bootArchiveMemo'
    return await import(/* @vite-ignore */ path) as MemoModule
}

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

/** A block-format file with an inline character `a` and a plugins block a test can damage, whose root holds `rootExtra`. */
async function composeBlockFile(rootExtra: Record<string, unknown>) {
    const encoder = new RisuSaveEncoder()
    const root = { ...baseDb(), ...rootExtra, characters: undefined, __directory: ['preset', 'plugins', 'a', 'config'] }
    return composeSave(encoder, [
        { name: 'root', type: BLOCK.ROOT, data: JSON.stringify(root) },
        { name: 'preset', type: BLOCK.BOTPRESET, data: JSON.stringify([{ name: 'p' }]) },
        { name: 'plugins', type: BLOCK.PLUGINS, data: JSON.stringify([{ name: 'p', version: '2.1', enabled: true }]) },
        { name: 'a', type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify({ chaId: 'a', name: 'A', type: 'character', chats: [] }) },
        { name: 'config', type: BLOCK.CONFIG, data: '{"version":1}' },
    ])
}

async function freshLoadData() {
    // The boot reads through the page's byte store; here it is the storage-object model above.
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike))
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore }
}

type AlertStore = Awaited<ReturnType<typeof freshLoadData>>['alertStore']

/** Records every non-`none` alert in order; `onAlert` runs inside the store write that posts it, before `alertNormal` returns. */
function recordAlerts(alertStore: AlertStore, onAlert?: (index: number) => void) {
    const seen: { type: string, msg: string }[] = []
    const unsubscribe = alertStore.subscribe((value) => {
        if (value.type !== 'none') {
            seen.push(value)
            onAlert?.(seen.length)
        }
    })
    return { seen, stop: unsubscribe }
}

/** Acknowledges each of `count` alerts as it is posted, then waits for the boot to finish. */
async function acknowledgeAll(alertStore: AlertStore, seen: unknown[], count: number, loading: Promise<void>) {
    for (let n = 1; n <= count; n++) {
        await vi.waitFor(() => { expect(seen.length).toBeGreaterThanOrEqual(n) }, { timeout: 1000, interval: 5 })
        alertStore.set({ type: 'none', msg: '' })
    }
    await loading
}

function storageSnapshot(): Record<string, string | null> {
    const snapshot: Record<string, string | null> = {}
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) as string
        snapshot[key] = localStorage.getItem(key)
    }
    return snapshot
}

beforeEach(() => {
    localStorage.clear()
    world.events.length = 0
    world.staleAccountProfile = false
    world.items.clear()
    pass.runInputs.length = 0
    pass.canArchive = true
    pass.run = null
    dbState.current = baseDb({ characters: [] })
    getDbBackupsMock.mockReset().mockResolvedValue([])
    noteMainFileBytesMock.mockClear()
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
    vi.restoreAllMocks()
})

describe('loadData() web: the memo a notice carries is written after the notice is posted', () => {
    test('a skip notice names the characters, and writes their memo after it was posted and not before', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'Beta Marker' }, { chaId: 'c', name: 'Gamma Marker' }] }],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const before = storageSnapshot()
        let storageWhenPosted: Record<string, string | null> | null = null
        const alerts = recordAlerts(alertStore, (index) => {
            if (index === 1) {
                storageWhenPosted = storageSnapshot()
            }
        })

        const loading = loadData()
        try {
            await acknowledgeAll(alertStore, alerts.seen, 1, loading)

            expect(get(loadedStore)).toBe(true)
            expect(alerts.seen.length).toBe(1)
            expect(alerts.seen[0].msg).toContain('Beta Marker')
            expect(storageWhenPosted).toEqual(before)
            const memo = await memoModule()
            expect([...memo.readArchiveMemo().skipped].sort()).toEqual(['b', 'c'])
            expect(memo.readArchiveMemo().tooLarge).toBe(false)
        } finally {
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('a too-large notice is a message of its own, and writes the too-large memo after it was posted and not before', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-too-large' }],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const before = storageSnapshot()
        let storageWhenPosted: Record<string, string | null> | null = null
        const alerts = recordAlerts(alertStore, (index) => {
            if (index === 1) {
                storageWhenPosted = storageSnapshot()
            }
        })

        const loading = loadData()
        try {
            await acknowledgeAll(alertStore, alerts.seen, 1, loading)

            expect(get(loadedStore)).toBe(true)
            expect(alerts.seen.length).toBe(1)
            expect(alerts.seen[0].msg).not.toContain('undefined')
            expect(storageWhenPosted).toEqual(before)
            const memo = await memoModule()
            expect(memo.readArchiveMemo().tooLarge).toBe(true)
            expect(memo.readArchiveMemo().skipped.size).toBe(0)
        } finally {
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('several notices in one boot are posted in order, each awaited: enabled, skipped, stopped, too large', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [
                { kind: 'archive-enabled' },
                { kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'Skip Marker' }] },
                { kind: 'archive-stopped', characterName: 'Stop Marker' },
                { kind: 'archive-too-large' },
            ],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        const loading = loadData()
        try {
            await acknowledgeAll(alertStore, alerts.seen, 4, loading)

            expect(get(loadedStore)).toBe(true)
            const messages = alerts.seen.map((a) => a.msg)
            expect(messages.length).toBe(4)
            expect(new Set(messages).size).toBe(4)
            expect(messages[0]).not.toMatch(/Skip Marker|Stop Marker/)
            expect(messages[1]).toContain('Skip Marker')
            expect(messages[1]).not.toContain('Stop Marker')
            expect(messages[2]).toContain('Stop Marker')
            expect(messages[2]).not.toContain('Skip Marker')
            expect(messages[3]).not.toMatch(/Skip Marker|Stop Marker/)
            const memo = await memoModule()
            expect([...memo.readArchiveMemo().skipped]).toEqual(['b'])
            expect(memo.readArchiveMemo().tooLarge).toBe(true)
        } finally {
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('guard: a notice whose boot ends before it is posted writes no memo', async () => {
        armLegacy()
        world.items.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'old', name: 'Old', type: 'character', chats: [] }] })))
        getDbBackupsMock.mockResolvedValue([1])
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'Beta Marker' }] }, { kind: 'archive-too-large' }],
        })
        setDatabaseMock.mockImplementationOnce(() => { throw new Error('install failed') })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)
        const before = storageSnapshot()

        await loadData()
        alerts.stop()

        expect(get(loadedStore)).toBe(true)
        expect(alerts.seen).toEqual([])
        expect(storageSnapshot()).toEqual(before)
    })

    test('guard: a localStorage that throws on write does not stop the boot or the notice', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'Beta Marker' }] }],
        })
        // The spy sits on the `localStorage` instance: once any code has called
        // `setItem` on it, a spy on `Storage.prototype` is no longer in the call path.
        const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        const loading = loadData()
        try {
            await acknowledgeAll(alertStore, alerts.seen, 1, loading)

            expect(get(loadedStore)).toBe(true)
            expect(alerts.seen.length).toBe(1)
            const memoWrites = setItemSpy.mock.results.filter((r, i) => setItemSpy.mock.calls[i][0] === 'archivePassSkipped')
            expect(memoWrites.length).toBe(1)
            expect(memoWrites[0].type).toBe('throw')
        } finally {
            // `restoreAllMocks` leaves an instance spy on `localStorage` in place, so it is restored here.
            setItemSpy.mockRestore()
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })
})

describe('loadData() web: the memo is cleared on a boot that reads the setting off', () => {
    async function seedMemo(): Promise<MemoModule> {
        const memo = await memoModule()
        memo.rememberSkipped(['b', 'c'])
        memo.rememberTooLarge()
        return memo
    }

    test('a strict decode with the setting off clears both memos before the pass runs', async () => {
        armLegacy(baseDb({ archiveCharacters: false }))
        const memo = await seedMemo()
        let memoAtRun: { skipped: number, tooLarge: boolean } | null = null
        pass.run = async (input) => {
            const read = memo.readArchiveMemo()
            memoAtRun = { skipped: read.skipped.size, tooLarge: read.tooLarge }
            return { kind: 'install', tree: (input as RunInput).tree, noteBytes: null, notices: [] }
        }
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(memoAtRun).toEqual({ skipped: 0, tooLarge: false })
        expect(memo.readArchiveMemo().skipped.size).toBe(0)
        expect(memo.readArchiveMemo().tooLarge).toBe(false)
    })

    test('a boot whose session cannot archive still clears both memos', async () => {
        armLegacy(baseDb({ archiveCharacters: false }))
        pass.canArchive = false
        const memo = await seedMemo()
        const { loadData } = await freshLoadData()

        await loadData()

        expect(memo.readArchiveMemo().skipped.size).toBe(0)
        expect(memo.readArchiveMemo().tooLarge).toBe(false)
    })

    test('a main file that decodes only non-strictly, with the setting off, still clears both memos and never runs the pass', async () => {
        const save = await composeBlockFile({ archiveCharacters: false })
        const damaged = corruptBlockPayload(save, 'plugins')
        world.items.set(MAIN_KEY, damaged)
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toBeDefined()
        const memo = await seedMemo()
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(0)
        expect(memo.readArchiveMemo().skipped.size).toBe(0)
        expect(memo.readArchiveMemo().tooLarge).toBe(false)
    })

    test.each([
        ['absent', {}],
        ['on', { archiveCharacters: true }],
    ] as const)('guard: a boot that reads the setting %s leaves both memos alone', async (_label, extra) => {
        armLegacy(baseDb(extra))
        const memo = await seedMemo()
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect([...memo.readArchiveMemo().skipped].sort()).toEqual(['b', 'c'])
        expect(memo.readArchiveMemo().tooLarge).toBe(true)
    })
})

describe('loadData() web: the paused notice and its told record', () => {
    const TOLD_KEY = 'archivePassPausedTold'

    test('the paused notice is a message of its own, and the told record is written after it was posted and not before', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-paused' }],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const { language } = await import('src/lang')
        const before = storageSnapshot()
        let storageWhenPosted: Record<string, string | null> | null = null
        const alerts = recordAlerts(alertStore, (index) => {
            if (index === 1) {
                storageWhenPosted = storageSnapshot()
            }
        })

        const loading = loadData()
        try {
            await acknowledgeAll(alertStore, alerts.seen, 1, loading)

            expect(get(loadedStore)).toBe(true)
            expect(alerts.seen.length).toBe(1)
            const message = alerts.seen[0].msg
            expect(typeof message).toBe('string')
            expect(message).toMatch(/paused/i)
            expect(message).toContain('this device')
            expect(message).toContain(language.settings)
            expect(message).toContain(language.advancedSettings)
            expect(message).toContain(language.coldStorage)
            expect(message).not.toContain('undefined')
            expect(message).not.toMatch(/automatically|will retry/i)
            expect(storageWhenPosted).toEqual(before)
            expect(localStorage.getItem(TOLD_KEY)).not.toBeNull()
            const memo = await memoModule()
            expect(memo.readArchiveMemo().pausedTold).toBe(true)
            expect(memo.readArchiveMemo().skipped.size).toBe(0)
            expect(memo.readArchiveMemo().tooLarge).toBe(false)
        } finally {
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('the paused notice follows the stopped notice, each is acknowledged in turn, and the told record waits for the paused one', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-stopped', characterName: 'Stop Marker' }, { kind: 'archive-paused' }],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const before = storageSnapshot()
        const storageAtAlert: Record<number, Record<string, string | null>> = {}
        const alerts = recordAlerts(alertStore, (index) => {
            storageAtAlert[index] = storageSnapshot()
        })

        const loading = loadData()
        try {
            await acknowledgeAll(alertStore, alerts.seen, 2, loading)

            expect(get(loadedStore)).toBe(true)
            const messages = alerts.seen.map((a) => a.msg)
            expect(messages.length).toBe(2)
            expect(messages[0]).toContain('Stop Marker')
            expect(typeof messages[1]).toBe('string')
            expect(messages[1]).not.toContain('Stop Marker')
            expect(messages[1]).toMatch(/paused/i)
            expect(storageAtAlert[1]).toEqual(before)
            expect(storageAtAlert[2]).toEqual(before)
            expect(localStorage.getItem(TOLD_KEY)).not.toBeNull()
        } finally {
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('guard: a paused notice whose boot ends before it is posted writes no told record', async () => {
        armLegacy()
        world.items.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'old', name: 'Old', type: 'character', chats: [] }] })))
        getDbBackupsMock.mockResolvedValue([1])
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-paused' }],
        })
        setDatabaseMock.mockImplementationOnce(() => { throw new Error('install failed') })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)
        const before = storageSnapshot()

        await loadData()
        alerts.stop()

        expect(get(loadedStore)).toBe(true)
        expect(alerts.seen).toEqual([])
        expect(storageSnapshot()).toEqual(before)
    })

    test('a told record that cannot be written is attempted and does not stop the boot or the notice', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-paused' }],
        })
        const real = localStorage
        const writeAttempts: string[] = []
        vi.stubGlobal('localStorage', {
            get length() { return real.length },
            key: (index: number) => real.key(index),
            getItem: (key: string) => real.getItem(key),
            setItem: (key: string) => { writeAttempts.push(key); throw new Error('quota exceeded') },
            removeItem: (key: string) => real.removeItem(key),
            clear: () => real.clear(),
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        const loading = loadData()
        try {
            await acknowledgeAll(alertStore, alerts.seen, 1, loading)

            expect(get(loadedStore)).toBe(true)
            expect(alerts.seen.length).toBe(1)
            expect(writeAttempts).toContain('archivePassPausedTold')
        } finally {
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('guard: a boot with no pass notices leaves the strike count and the told record alone, because only the pass writes the count', async () => {
        armLegacy()
        localStorage.setItem('archivePassStrikes', '1')
        const { loadData } = await freshLoadData()

        await loadData()

        expect(localStorage.getItem('archivePassStrikes')).toBe('1')
        expect(localStorage.getItem(TOLD_KEY)).toBeNull()
    })
})

describe('loadData() web: the strike count and the told record are cleared on a boot that reads the setting off', () => {
    const STRIKES_KEY = 'archivePassStrikes'
    const TOLD_KEY = 'archivePassPausedTold'

    function seedBreaker(): void {
        localStorage.setItem(STRIKES_KEY, '2')
        localStorage.setItem(TOLD_KEY, '1')
        localStorage.setItem('unrelated-key', 'kept')
    }

    test('a strict decode with the setting off clears both before the pass runs', async () => {
        armLegacy(baseDb({ archiveCharacters: false }))
        seedBreaker()
        let strikesAtRun: string | null = 'not run'
        let toldAtRun: string | null = 'not run'
        pass.run = async (input) => {
            strikesAtRun = localStorage.getItem(STRIKES_KEY)
            toldAtRun = localStorage.getItem(TOLD_KEY)
            return { kind: 'install', tree: (input as RunInput).tree, noteBytes: null, notices: [] }
        }
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(strikesAtRun).toBeNull()
        expect(toldAtRun).toBeNull()
        expect(localStorage.getItem(STRIKES_KEY)).toBeNull()
        expect(localStorage.getItem(TOLD_KEY)).toBeNull()
        expect(localStorage.getItem('unrelated-key')).toBe('kept')
    })

    test('a boot whose session cannot archive still clears both', async () => {
        armLegacy(baseDb({ archiveCharacters: false }))
        pass.canArchive = false
        seedBreaker()
        const { loadData } = await freshLoadData()

        await loadData()

        expect(localStorage.getItem(STRIKES_KEY)).toBeNull()
        expect(localStorage.getItem(TOLD_KEY)).toBeNull()
    })

    test('a main file that decodes only non-strictly, with the setting off, still clears both and never runs the pass', async () => {
        const save = await composeBlockFile({ archiveCharacters: false })
        const damaged = corruptBlockPayload(save, 'plugins')
        world.items.set(MAIN_KEY, damaged)
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toBeDefined()
        seedBreaker()
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(0)
        expect(localStorage.getItem(STRIKES_KEY)).toBeNull()
        expect(localStorage.getItem(TOLD_KEY)).toBeNull()
    })

    test.each([
        ['absent', {}],
        ['on', { archiveCharacters: true }],
    ] as const)('guard: a boot that reads the setting %s leaves the strike count and the told record alone', async (_label, extra) => {
        armLegacy(baseDb(extra))
        seedBreaker()
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
        expect(localStorage.getItem(TOLD_KEY)).toBe('1')
    })

    // The stub-enrichment count bounds enrichment on a profile whose archiving is off, so the clear that runs on
    // every boot reading the setting off must leave it: a completed enrichment attempt and a change of the setting
    // in Settings (either direction) remove it; the boot-time clear does not.
    const ENRICH_KEY = 'stubEnrichStrikes'

    test('guard: a strict decode with the setting off leaves the stub-enrichment count alone, before the pass runs and after it', async () => {
        armLegacy(baseDb({ archiveCharacters: false }))
        seedBreaker()
        localStorage.setItem(ENRICH_KEY, '1')
        let countAtRun: string | null = 'not run'
        pass.run = async (input) => {
            countAtRun = localStorage.getItem(ENRICH_KEY)
            return { kind: 'install', tree: (input as RunInput).tree, noteBytes: null, notices: [] }
        }
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(localStorage.getItem(STRIKES_KEY)).toBeNull()
        expect(countAtRun).toBe('1')
        expect(localStorage.getItem(ENRICH_KEY)).toBe('1')
    })

    test('guard: a boot whose session cannot archive, with the setting off, leaves the stub-enrichment count alone', async () => {
        armLegacy(baseDb({ archiveCharacters: false }))
        pass.canArchive = false
        localStorage.setItem(ENRICH_KEY, '2')
        const { loadData } = await freshLoadData()

        await loadData()

        expect(localStorage.getItem(ENRICH_KEY)).toBe('2')
    })

    test('guard: two boots that read the setting off in a row keep the stub-enrichment count', async () => {
        localStorage.setItem(ENRICH_KEY, '1')
        for (let boot = 0; boot < 2; boot++) {
            armLegacy(baseDb({ archiveCharacters: false }))
            const { loadData } = await freshLoadData()

            await loadData()

            expect(localStorage.getItem(ENRICH_KEY)).toBe('1')
        }
    })
})

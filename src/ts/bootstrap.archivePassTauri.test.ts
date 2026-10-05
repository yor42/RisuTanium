/**
 * `loadData()`'s wiring of the boot archive pass, Tauri branch: the real
 * `bootstrap.ts` with the pass module mocked at its boundary
 * (`src/ts/storage/bootArchivePass.ts`). Split from
 * `bootstrap.archivePass.test.ts` because `bootstrap.ts` reads `isTauri` once
 * at module load, so this file keeps `isTauri: true` throughout.
 *
 * The Tauri file system is an in-memory model (a `Map` of files behind the
 * plugin's functions); nothing here says anything about the native Tauri file
 * API. `risuSave.ts` is real. `alert.ts` is real;
 * acknowledgement is simulated by writing `{ type: 'none', msg: '' }` to the
 * shared alert store. Everything else `bootstrap.ts` imports is mocked, as in
 * the sibling bootstrap test files.
 *
 * Tests titled `guard:` assert that something does not happen; they pass with
 * and without the wiring and protect behaviour the wiring must keep. The
 * others assert behaviour only the wiring has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { BLOCK, composeSave } from 'src/ts/storage/tests/manualCleanupHarness'

const MAIN_PATH = 'database/database.bin'

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs())

const world = vi.hoisted(() => ({
    events: [] as string[],
    files: fakeFs.files,
    /** The path of every file read through the file system plugin, as given. */
    reads: [] as string[],
}))

interface RunInput { tree: Record<string, unknown> }

const pass = vi.hoisted(() => ({
    opened: [] as string[],
    runInputs: [] as unknown[],
    releaseCalls: 0,
    run: null as null | ((input: unknown) => Promise<unknown>),
}))

const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const noteMainFileBytesMock = vi.hoisted(() => vi.fn((_bytes: Uint8Array): void => { }))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const checkRisuUpdateMock = vi.hoisted(() => vi.fn(async (): Promise<void> => { }))

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
    checkRisuUpdate: checkRisuUpdateMock,
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
    noteMainFileBytes: noteMainFileBytesMock,
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

vi.mock(import('src/ts/storage/loadTimeListing'), () => ({
    recordLoadTimeListing: vi.fn(async () => { }),
    resetLoadTimeListingForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/loadTimeListing'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({ startAvatarThumbSweep: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/model/modellist'), () => ({ registerModelDynamic: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    // The block store's durable writes: a boot that creates the first profile writes through this.
    invoke: vi.fn(async (command: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
        if (command === 'write_durable') {
            world.events.push(`durable:${decodeURIComponent(options?.headers?.['x-risu-key'] ?? '')}`)
        }
        return fakeFs.invoke(command, args, options)
    }),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ maximize: vi.fn(async () => { }) })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    ...fakeFs.module,
    readFile: vi.fn(async (path: string, _options?: { baseDir?: number }) => {
        world.reads.push(path)
        if (path.replace(/^\.\//, '') === MAIN_PATH) {
            world.events.push('read-main')
        }
        return await fakeFs.module.readFile(path)
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array, options?: { createNew?: boolean, baseDir?: number }) => {
        world.events.push(`write:${path}`)
        await fakeFs.module.writeFile(path, data, options)
    }),
    remove: vi.fn(async (path: string) => {
        world.events.push(`remove:${path}`)
        await fakeFs.module.remove(path)
    }),
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
            canArchive: true,
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

/** Arms the Tauri main-file read with `bytes` and the directories the boot checks. */
function armMain(bytes: Uint8Array): Uint8Array {
    world.files.set('', new Uint8Array())
    world.files.set('database', new Uint8Array())
    world.files.set('assets', new Uint8Array())
    world.files.set('database/database.bin', bytes)
    return bytes
}

function armLegacy(db: Record<string, unknown> = baseDb()): Uint8Array {
    return armMain(encodeRisuSaveLegacy(db))
}

function armBackup(db: Record<string, unknown>): void {
    world.files.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(db))
    getDbBackupsMock.mockResolvedValue([1])
}

async function freshLoadData() {
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore }
}

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
    fakeFs.reset()
    world.reads.length = 0
    pass.opened.length = 0
    pass.runInputs.length = 0
    pass.releaseCalls = 0
    pass.run = null
    dbState.current = baseDb({ characters: [] })
    getDbBackupsMock.mockReset().mockResolvedValue([])
    noteMainFileBytesMock.mockClear()
    checkRisuUpdateMock.mockReset().mockImplementation(async () => { world.events.push('checkRisuUpdate') })
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        world.events.push('setDatabase')
        dbState.current = { ...dbState.baseline(), ...data }
    })
    vi.stubGlobal('open', vi.fn())
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('loadData() Tauri: the pass runs on a strictly decoded main file', () => {
    test('G1: opens the session before the main file is read, then runs the pass on the decoded tree before installing it', async () => {
        armLegacy()
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(pass.runInputs.length).toBe(1)
        const input = pass.runInputs[0] as RunInput
        expect(characterIds(input.tree)).toEqual(['a'])
        const order = world.events.filter((e) => ['open:tauri', 'read-main', 'run', 'setDatabase'].includes(e))
        // Up to and including the first install; the boot re-installs the live database later, which is not constrained here.
        expect(order.slice(0, order.indexOf('setDatabase') + 1)).toEqual(['open:tauri', 'read-main', 'run', 'setDatabase'])
    })

    test('G1: a pass that rejects leaves the boot installing the main file content, not a backup', async () => {
        armLegacy()
        armBackup(baseDb({ characters: [{ chaId: 'old', name: 'Old', type: 'character', chats: [] }] }))
        pass.run = async () => { throw new Error('pass failed') }
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(get(loadedStore)).toBe(true)
        expect(characterIds(installedTrees()[0])).toEqual(['a'])
        expect(world.reads.some((u) => u.includes('dbbackup-'))).toBe(false)
    })

    test('installs the tree the pass returns and notes the bytes it names', async () => {
        armLegacy()
        const committed = new Uint8Array([4, 5, 6])
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

    test('a backup-fallback outcome takes the existing backup path', async () => {
        armLegacy()
        armBackup(baseDb({ characters: [{ chaId: 'old', name: 'Old', type: 'character', chats: [] }] }))
        pass.run = async () => ({ kind: 'backup-fallback' })
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(get(loadedStore)).toBe(true)
        expect(characterIds(installedTrees()[0])).toEqual(['old'])
    })
})

describe('loadData() Tauri: a main file that does not decode, or does not decode completely, never reaches the pass', () => {
    test('G2: guard: an undecodable main file takes the backup path and the pass is never run', async () => {
        armMain(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
        armBackup(baseDb({ characters: [{ chaId: 'old', name: 'Old', type: 'character', chats: [] }] }))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(0)
        expect(get(loadedStore)).toBe(true)
        expect(characterIds(installedTrees()[0])).toEqual(['old'])
    })

    test('releases the session on the backup path', async () => {
        armMain(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
        armBackup(baseDb())
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.opened).toEqual(['tauri'])
        expect(pass.releaseCalls).toBeGreaterThan(0)
    })

    async function remoteMissingFile(): Promise<Uint8Array> {
        const encoder = new RisuSaveEncoder()
        const root = { ...baseDb(), characters: undefined, __directory: ['preset', 'plugins', 'a', 'b', 'config'] }
        const save = await composeSave(encoder, [
            { name: 'root', type: BLOCK.ROOT, data: JSON.stringify(root) },
            { name: 'preset', type: BLOCK.BOTPRESET, data: JSON.stringify([{ name: 'p' }]) },
            { name: 'plugins', type: BLOCK.PLUGINS, data: '[]' },
            { name: 'a', type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify({ chaId: 'a', name: 'A', type: 'character', chats: [] }) },
            { name: 'b', type: BLOCK.REMOTE, data: JSON.stringify({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name: 'b', hash: '0123456789abcdef' }) },
            { name: 'config', type: BLOCK.CONFIG, data: '{"version":1}' },
        ])
        return save.bytes
    }

    test('F1: guard: a character whose remote file is missing is not archived over: the pass is not run and the partial tree is installed as it always was', async () => {
        const bytes = await remoteMissingFile()
        armMain(bytes)
        await expect(decodeRisuSave(bytes, { strict: true })).rejects.toBeDefined()
        await expect(decodeRisuSave(bytes)).resolves.toBeDefined()
        const { loadData, alertStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        await loadData()
        alerts.stop()

        expect(pass.runInputs.length).toBe(0)
        expect(characterIds(installedTrees()[0])).toEqual(['a'])
        expect(alerts.seen).toEqual([])
        expect(world.reads.some((u) => u.includes('dbbackup-'))).toBe(false)
    })

    test('releases the session when the decode is incomplete', async () => {
        armMain(await remoteMissingFile())
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.opened).toEqual(['tauri'])
        expect(pass.releaseCalls).toBeGreaterThan(0)
    })
})

describe('loadData() Tauri: the pass notices are posted after the install and awaited before the update check', () => {
    test('G3 / D4: the archive notice and then the stopped-pass notice are each acknowledged before the update check runs', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-enabled' }, { kind: 'archive-stopped', characterName: 'Zed Marker' }],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)
        const waitForAlerts = (count: number) => vi.waitFor(() => { expect(alerts.seen.length).toBeGreaterThanOrEqual(count) }, { timeout: 1000, interval: 5 })

        const loading = loadData()
        try {
            await waitForAlerts(1)
            expect(checkRisuUpdateMock).not.toHaveBeenCalled()
            alertStore.set({ type: 'none', msg: '' })

            await waitForAlerts(2)
            expect(checkRisuUpdateMock).not.toHaveBeenCalled()
            expect(alerts.seen[1].msg).toContain('Zed Marker')
            expect(alerts.seen[0].msg).not.toContain('Zed Marker')
            alertStore.set({ type: 'none', msg: '' })

            await loading
            expect(get(loadedStore)).toBe(true)
            expect(checkRisuUpdateMock).toHaveBeenCalledTimes(1)
            expect(new Set(alerts.seen.map((a) => a.msg)).size).toBe(2)
            expect(world.events.indexOf('setDatabase')).toBeLessThan(world.events.indexOf('alert:1'))
            expect(world.events.indexOf('alert:2')).toBeLessThan(world.events.indexOf('checkRisuUpdate'))
        } finally {
            alerts.stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('guard: an outcome with no notices posts no alert before the update check', async () => {
        armLegacy()
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        await loadData()
        alerts.stop()

        expect(get(loadedStore)).toBe(true)
        expect(alerts.seen).toEqual([])
        expect(checkRisuUpdateMock).toHaveBeenCalledTimes(1)
    })
})

describe('loadData() Tauri: the pass\'s device memo (new behaviour of the skip and size rules)', () => {
    type MemoModule = typeof import('src/ts/storage/bootArchiveMemo')

    async function memoModule(): Promise<MemoModule> {
        const path = '/src/ts/storage/bootArchiveMemo'
        return await import(/* @vite-ignore */ path) as MemoModule
    }

    function storageSnapshot(): Record<string, string | null> {
        const snapshot: Record<string, string | null> = {}
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i) as string
            snapshot[key] = localStorage.getItem(key)
        }
        return snapshot
    }

    test('a skip notice names the character and writes its memo after the notice was posted, not before', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-skipped', characters: [{ chaId: 'b', name: 'Beta Marker' }] }],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const before = storageSnapshot()
        let storageWhenPosted: Record<string, string | null> | null = null
        const seen: { type: string, msg: string }[] = []
        const stop = alertStore.subscribe((value) => {
            if (value.type !== 'none') {
                seen.push(value)
                storageWhenPosted ??= storageSnapshot()
            }
        })

        const loading = loadData()
        try {
            await vi.waitFor(() => { expect(seen.length).toBeGreaterThanOrEqual(1) }, { timeout: 1000, interval: 5 })
            alertStore.set({ type: 'none', msg: '' })
            await loading

            expect(get(loadedStore)).toBe(true)
            expect(seen[0].msg).toContain('Beta Marker')
            expect(storageWhenPosted).toEqual(before)
            const memo = await memoModule()
            expect([...memo.readArchiveMemo().skipped]).toEqual(['b'])
        } finally {
            stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('a strict decode with the setting off clears both memos before the pass runs', async () => {
        armLegacy(baseDb({ archiveCharacters: false }))
        const memo = await memoModule()
        memo.rememberSkipped(['b'])
        memo.rememberTooLarge()
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

    test('a paused notice is posted, and the told record is written after it was posted and not before', async () => {
        armLegacy()
        pass.run = async (input) => ({
            kind: 'install',
            tree: (input as RunInput).tree,
            noteBytes: null,
            notices: [{ kind: 'archive-paused' }],
        })
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const before = storageSnapshot()
        let storageWhenPosted: Record<string, string | null> | null = null
        const seen: { type: string, msg: string }[] = []
        const stop = alertStore.subscribe((value) => {
            if (value.type !== 'none') {
                seen.push(value)
                storageWhenPosted ??= storageSnapshot()
            }
        })

        const loading = loadData()
        try {
            await vi.waitFor(() => { expect(seen.length).toBeGreaterThanOrEqual(1) }, { timeout: 1000, interval: 5 })
            alertStore.set({ type: 'none', msg: '' })
            await loading

            expect(get(loadedStore)).toBe(true)
            expect(seen.length).toBe(1)
            expect(typeof seen[0].msg).toBe('string')
            expect(seen[0].msg).toMatch(/paused/i)
            expect(seen[0].msg).not.toContain('undefined')
            expect(storageWhenPosted).toEqual(before)
            expect(localStorage.getItem('archivePassPausedTold')).not.toBeNull()
            expect((await memoModule()).readArchiveMemo().pausedTold).toBe(true)
        } finally {
            stop()
            alertStore.set({ type: 'none', msg: '' })
            await loading.catch(() => { })
        }
    })

    test('a strict decode with the setting off clears the strike count and the told record before the pass runs', async () => {
        armLegacy(baseDb({ archiveCharacters: false }))
        localStorage.setItem('archivePassStrikes', '2')
        localStorage.setItem('archivePassPausedTold', '1')
        let strikesAtRun: string | null = 'not run'
        pass.run = async (input) => {
            strikesAtRun = localStorage.getItem('archivePassStrikes')
            return { kind: 'install', tree: (input as RunInput).tree, noteBytes: null, notices: [] }
        }
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(strikesAtRun).toBeNull()
        expect(localStorage.getItem('archivePassStrikes')).toBeNull()
        expect(localStorage.getItem('archivePassPausedTold')).toBeNull()
    })

    test('guard: a boot that reads the setting on leaves the strike count and the told record alone', async () => {
        armLegacy(baseDb({ archiveCharacters: true }))
        localStorage.setItem('archivePassStrikes', '2')
        localStorage.setItem('archivePassPausedTold', '1')
        const { loadData } = await freshLoadData()

        await loadData()

        expect(pass.runInputs.length).toBe(1)
        expect(localStorage.getItem('archivePassStrikes')).toBe('2')
        expect(localStorage.getItem('archivePassPausedTold')).toBe('1')
    })
})

describe('loadData() Tauri: the first launch seeds the block store', () => {
    const MAIN = 'database/database.bin'
    const HEAD = 'blocks/head'

    /** The directories the boot checks, and no main file. */
    function armFirstLaunch(): void {
        world.files.set('', new Uint8Array())
        world.files.set('database', new Uint8Array())
        world.files.set('assets', new Uint8Array())
    }

    test('a first-launch seed whose first write fails leaves no head and no main file, stops the boot and shows the error', async () => {
        armFirstLaunch()
        const fault = fakeFs.failDurableWrites('disk full')
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const alerts = recordAlerts(alertStore)

        await loadData()
        alerts.stop()

        expect(fault.fired).toBeGreaterThan(0)
        expect(world.files.has(HEAD)).toBe(false)
        expect(world.files.has(MAIN)).toBe(false)
        expect(fakeFs.listing('database')).toEqual([])
        expect(alerts.seen.map((a) => a.type)).toEqual(['error'])
        expect(pass.releaseCalls).toBe(pass.opened.length)
        expect(get(loadedStore)).toBe(false)
    })

    test('a successful first-launch seed writes the head last, creates no main file, leaves no temp file, and never opens the main path for writing', async () => {
        armFirstLaunch()
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(world.files.has(HEAD)).toBe(true)
        expect(world.files.has(MAIN)).toBe(false)
        expect(fakeFs.durableLog.at(-1)).toBe(HEAD)
        expect(fakeFs.listing('database')).toEqual([])
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
        expect(installedTrees().length).toBeGreaterThan(0)
    })
})

describe('loadData() Tauri: the boot removes the leftover temp files of interrupted atomic writes', () => {
    const MAIN = 'database/database.bin'
    const LEFTOVER = 'database/risu-write-0123456789abcdef.tmp'
    const OTHER_LEFTOVER = 'database/risu-write-fedcba9876543210.tmp'

    function armWithLeftovers(): { main: Uint8Array } {
        const main = armLegacy()
        world.files.set(LEFTOVER, new Uint8Array([1, 2, 3]))
        world.files.set(OTHER_LEFTOVER, new Uint8Array([4, 5, 6]))
        world.files.set('database/dbbackup-1.bin', new Uint8Array([7]))
        world.files.set('database/notes.txt', new Uint8Array([8]))
        world.files.set('database/risu-write-not-a-temp.tmp', new Uint8Array([9]))
        world.files.set('database/.risu-write-0123456789abcdef.tmp', new Uint8Array([10]))
        return { main }
    }

    test('removes only the files whose name is a temp name, before the pass session opens', async () => {
        const { main } = armWithLeftovers()
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(fakeFs.listing('database')).toEqual([
            '.risu-write-0123456789abcdef.tmp',
            'database.bin',
            'dbbackup-1.bin',
            'notes.txt',
            'risu-write-not-a-temp.tmp',
        ])
        expect(Array.from(world.files.get(MAIN) ?? [])).toEqual(Array.from(main))
        const removes = world.events.filter((e) => e.startsWith('remove:'))
        expect(removes).toEqual([`remove:${LEFTOVER}`, `remove:${OTHER_LEFTOVER}`])
        expect(world.events.indexOf(removes[1])).toBeLessThan(world.events.indexOf('open:tauri'))
    })

    test('removes a leftover before the first-launch seed when the main file is absent', async () => {
        world.files.set('', new Uint8Array())
        world.files.set('database', new Uint8Array())
        world.files.set('assets', new Uint8Array())
        world.files.set(LEFTOVER, new Uint8Array([1, 2, 3]))
        const { loadData } = await freshLoadData()

        await loadData()

        const firstWrite = world.events.findIndex((e) => e.startsWith('durable:'))
        expect(firstWrite).toBeGreaterThan(-1)
        expect(world.events.indexOf(`remove:${LEFTOVER}`)).toBeGreaterThan(-1)
        expect(world.events.indexOf(`remove:${LEFTOVER}`)).toBeLessThan(firstWrite)
        expect(fakeFs.listing('database')).toEqual([])
    })

    test('a directory listing that fails does not stop the boot', async () => {
        armWithLeftovers()
        const fault = fakeFs.failReadDirs('Access is denied. (os error 5)')
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(fault.fired).toBeGreaterThan(0)
        expect(get(loadedStore)).toBe(true)
        expect(world.files.has(LEFTOVER)).toBe(true)
    })

    test('a removal that fails does not stop the boot', async () => {
        armWithLeftovers()
        const fault = fakeFs.failRemoves('Access is denied. (os error 5)')
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(fault.fired).toBeGreaterThan(0)
        expect(get(loadedStore)).toBe(true)
        expect(world.files.has(LEFTOVER)).toBe(true)
    })
})

describe('loadData() Tauri: the boot removes the leftover temp files of interrupted asset writes', () => {
    const ASSET_LEFTOVER = 'assets/risu-write-0123456789abcdef.tmp'

    test('reproducer: removes only the temp-named files of assets, before the pass session opens', async () => {
        armLegacy()
        world.files.set(ASSET_LEFTOVER, new Uint8Array([1, 2, 3]))
        world.files.set('assets/risu-write-fedcba9876543210.tmp', new Uint8Array([4]))
        world.files.set('assets/0123.png', new Uint8Array([5]))
        world.files.set('assets/risu-write-not-a-temp.tmp', new Uint8Array([6]))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(fakeFs.listing('assets')).toEqual(['0123.png', 'risu-write-not-a-temp.tmp'])
        const removes = world.events.filter((e) => e.startsWith('remove:assets/'))
        expect(removes).toHaveLength(2)
        expect(world.events.indexOf(removes[1])).toBeLessThan(world.events.indexOf('open:tauri'))
    })

    test('guard: with no assets directory the boot creates it and removes nothing', async () => {
        armLegacy()
        world.files.delete('assets')
        const { loadData } = await freshLoadData()

        await loadData()

        expect(world.events.filter((e) => e.startsWith('remove:assets/'))).toEqual([])
        expect(fakeFs.directories.has('assets')).toBe(true)
    })

    test('guard: a listing of assets that fails does not stop the boot', async () => {
        armLegacy()
        world.files.set(ASSET_LEFTOVER, new Uint8Array([1, 2, 3]))
        const fault = fakeFs.failReadDirs('Access is denied. (os error 5)')
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(fault.fired).toBeGreaterThan(0)
        expect(get(loadedStore)).toBe(true)
        expect(world.files.has(ASSET_LEFTOVER)).toBe(true)
    })
})
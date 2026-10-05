/**
 * `loadData()`'s wiring of the idle reload: what it reads before the archive
 * pass (the hand-off an idle reload left), what it gives the pass, what it
 * applies after the install, and what it learns from the pass's outcome. The
 * pass module is mocked at its boundary as in `bootstrap.archivePass.test.ts`;
 * the hand-off storage (`sessionStorage`) and the draft stores are real.
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

interface RunInput { tree: Record<string, unknown>, keepInline?: ReadonlySet<string> }

const pass = vi.hoisted(() => ({
    opened: [] as string[],
    runInputs: [] as unknown[],
    releaseCalls: 0,
    reloading: false,
    run: null as null | ((input: unknown) => Promise<unknown>),
}))

const commits = vi.hoisted(() => ({ waiters: [] as (() => void)[] }))
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

const selectMock = vi.hoisted(() => vi.fn(async (_chaId: string): Promise<boolean> => true))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
    selectCharacterByChaId: selectMock,
}) as unknown as typeof import('src/ts/characters'))

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
    afterNextSaveCommit: vi.fn((callback: () => void) => { commits.waiters.push(callback) }),
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


const SELECTION_KEY = 'risu-idle-handoff:selection'
const DRAFTS_KEY = 'risu-idle-handoff:drafts'

function leaveSelection(chaId: string | null, keepInline: string[], at: number = Date.now()): void {
    sessionStorage.setItem(SELECTION_KEY, JSON.stringify({ v: 1, reason: 'idle', at, chaId, keepInline }))
}

function leaveDrafts(composer: { key: string, messageInput: string }[], at: number = Date.now()): void {
    sessionStorage.setItem(DRAFTS_KEY, JSON.stringify({
        v: 1,
        at,
        composer: composer.map((record) => ({ ...record, messageInputTranslate: '', fileInput: [] })),
        durable: [],
    }))
}

async function composerText(chaId: string, chatId: string): Promise<string> {
    const { peek } = await import('src/ts/process/composerDrafts.svelte')
    return peek({ chaId, chatId }).messageInput
}

beforeEach(() => {
    sessionStorage.clear()
    commits.waiters.length = 0
    selectMock.mockReset().mockResolvedValue(true)
})

describe('loadData() after an idle reload: the selection part', () => {
    test('passes its keep-inline set to the pass, reselects by id once the database is installed and deletes the part', async () => {
        armLegacy()
        leaveSelection('a', ['a', 'member'])
        const { loadData } = await freshLoadData()

        await loadData()

        const input = pass.runInputs[0] as RunInput
        expect(input.keepInline).toEqual(new Set(['a', 'member']))
        expect(selectMock).toHaveBeenCalledWith('a')
        expect(sessionStorage.getItem(SELECTION_KEY)).toBeNull()
        expect(world.events.indexOf('setDatabase')).toBeLessThan(selectMock.mock.invocationCallOrder[0])
    })

    test('guard: an ordinary boot passes no keep-inline set and selects nothing', async () => {
        armLegacy()
        const { loadData } = await freshLoadData()

        await loadData()

        expect((pass.runInputs[0] as RunInput).keepInline).toBeUndefined()
        expect(selectMock).not.toHaveBeenCalled()
    })

    test('a selection part older than the interval is deleted and ignored', async () => {
        armLegacy()
        leaveSelection('a', ['a'], Date.now() - 11 * 60_000)
        const { loadData } = await freshLoadData()

        await loadData()

        expect((pass.runInputs[0] as RunInput).keepInline).toBeUndefined()
        expect(selectMock).not.toHaveBeenCalled()
        expect(sessionStorage.getItem(SELECTION_KEY)).toBeNull()
        const { wasBootedByIdleReload } = await import('src/ts/process/memory/idleReloadBootState')
        expect(wasBootedByIdleReload()).toBe(false)
    })

    test('a selection that names no character keeps nothing inline beyond its own list and selects nothing', async () => {
        armLegacy()
        leaveSelection(null, [])
        const { loadData } = await freshLoadData()

        await loadData()

        expect((pass.runInputs[0] as RunInput).keepInline).toEqual(new Set())
        expect(selectMock).not.toHaveBeenCalled()
    })

    test('marks the boot as started by an idle reload', async () => {
        armLegacy()
        leaveSelection('a', ['a'])
        const { loadData } = await freshLoadData()

        await loadData()

        const { wasBootedByIdleReload } = await import('src/ts/process/memory/idleReloadBootState')
        expect(wasBootedByIdleReload()).toBe(true)
    })
})

describe('loadData() after an idle reload: the carried drafts', () => {
    test('puts the drafts back once the database is installed and deletes their part when the first save has committed', async () => {
        armLegacy()
        leaveDrafts([{ key: 'gone::chat', messageInput: 'carried text' }])
        const { loadData } = await freshLoadData()

        await loadData()

        expect(await composerText('gone', 'chat')).toBe('carried text')
        expect(sessionStorage.getItem(DRAFTS_KEY)).not.toBeNull()
        for (const callback of commits.waiters.splice(0)) {
            callback()
        }
        expect(sessionStorage.getItem(DRAFTS_KEY)).toBeNull()
    })

    test('a boot that dies after the put-back but before its first save commits leaves the part, and the next boot restores the same text once', async () => {
        armLegacy()
        leaveDrafts([{ key: 'gone::chat', messageInput: 'carried text' }])
        const first = await freshLoadData()
        await first.loadData()
        expect(await composerText('gone', 'chat')).toBe('carried text')
        commits.waiters.length = 0

        vi.resetModules()
        const next = await freshLoadData()
        await next.loadData()

        expect(await composerText('gone', 'chat')).toBe('carried text')
        expect(sessionStorage.getItem(DRAFTS_KEY)).not.toBeNull()
        for (const callback of commits.waiters.splice(0)) {
            callback()
        }
        expect(sessionStorage.getItem(DRAFTS_KEY)).toBeNull()
    })

    test('puts back drafts older than the interval, with no selection part present', async () => {
        armLegacy()
        leaveDrafts([{ key: 'gone::chat', messageInput: 'old text' }], Date.now() - 3 * 60 * 60_000)
        const { loadData } = await freshLoadData()

        await loadData()

        expect(await composerText('gone', 'chat')).toBe('old text')
    })

    test('a boot that fails before the database is installed leaves the drafts part, and the next boot puts the drafts back', async () => {
        armLegacy()
        leaveDrafts([{ key: 'gone::chat', messageInput: 'carried text' }])
        world.failingKeys.add(MAIN_KEY)
        const failing = await freshLoadData()

        await failing.loadData()

        expect(get(failing.loadedStore)).toBe(false)
        expect(sessionStorage.getItem(DRAFTS_KEY)).not.toBeNull()
        expect(await composerText('gone', 'chat')).toBe('')

        world.failingKeys.clear()
        vi.resetModules()
        const next = await freshLoadData()
        await next.loadData()

        expect(await composerText('gone', 'chat')).toBe('carried text')
        expect(sessionStorage.getItem(DRAFTS_KEY)).not.toBeNull()
    })

    test('an unreadable drafts part is left in place and the boot carries on', async () => {
        armLegacy()
        sessionStorage.setItem(DRAFTS_KEY, '{"v":1,')
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(sessionStorage.getItem(DRAFTS_KEY)).toBe('{"v":1,')
    })
})

describe('loadData(): what the idle reload learns from the pass', () => {
    test('records that the pass wrote the main file when its outcome says it committed', async () => {
        armLegacy()
        pass.run = async (input) => ({ kind: 'install', tree: (input as RunInput).tree, noteBytes: new Uint8Array([1]), notices: [], committed: true })
        const { loadData } = await freshLoadData()

        await loadData()

        const state = await import('src/ts/process/memory/idleReloadBootState')
        expect(state.didBootPassCommit()).toBe(true)
        expect(state.canBootArchive()).toBe(true)
    })

    test('does not record a commit for a pass that wrote nothing', async () => {
        armLegacy()
        const { loadData } = await freshLoadData()

        await loadData()

        const state = await import('src/ts/process/memory/idleReloadBootState')
        expect(state.didBootPassCommit()).toBe(false)
        expect(state.canBootArchive()).toBe(true)
    })

    async function armedAfterBoot(commits: boolean): Promise<boolean> {
        armLegacy()
        leaveSelection('a', ['a'])
        pass.run = async (input) => ({
            kind: 'install', tree: (input as RunInput).tree, noteBytes: commits ? new Uint8Array([1]) : null, notices: [],
            ...(commits ? { committed: true as const } : {}),
        })
        const listeners = vi.spyOn(window, 'addEventListener')
        listeners.mockClear()
        vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>)
        const { loadData } = await freshLoadData()
        await loadData()
        const { noteRestoredBytes } = await import('src/ts/process/memory/restoredBytes')
        noteRestoredBytes('someone-else', 60 * 1024 * 1024)
        return listeners.mock.calls.some((call) => call[0] === 'keydown')
    }

    test('arms the idle reload on a boot that an idle reload started and whose pass committed', async () => {
        expect(await armedAfterBoot(true)).toBe(true)
    })

    test('never arms the idle reload on a boot that an idle reload started and whose pass did not commit', async () => {
        expect(await armedAfterBoot(false)).toBe(false)
    })
})

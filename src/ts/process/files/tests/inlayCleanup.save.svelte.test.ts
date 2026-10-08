/**
 * Deleting a chat or a character deletes the inlays nothing else can still show
 * (`inlayCleanup.ts`), against the REAL delete functions of `characters.ts`, the
 * REAL save loop (`saveDb()`), the real cold-unit reader and the real inlay
 * module, over an in-memory byte store (see `storage/tests/saveLoopWorld.ts`).
 * Web Locks, the platform, the alert dialogs and everything else the modules
 * import are replaced. Synthetic data only.
 *
 * A test that claims an inlay stays pairs it with an inlay that must go in the
 * same batch, so "stays" is only claimed once the batch has run; titles that
 * begin "guard:" pass without the cleanup. A mocked success here is not evidence
 * of native backend behaviour.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import { isRootKey, makeDb, rootWrites } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import type { HeldStore } from 'src/ts/storage/tests/saveLoopSupport'
import type { Database } from 'src/ts/storage/database.svelte'
import { coldStorageHeader, formatColdStorageLoadError } from 'src/ts/process/coldstorageData'
import { CHUNK_CHARS } from 'src/ts/process/files/inlayCleanup'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'

// Every reproducer waits at most 8 s for its inlay to go, so under a base without the cleanup it fails on that assertion, not on the runner's default test timeout.
vi.setConfig({ testTimeout: 30_000 })

//#region module mocks

const h = vi.hoisted(() => ({
    worldCount: 0,
    parked: new Set<number>(),
    db: undefined as undefined | Record<string, unknown>,
    legacy: new Map<string, unknown>(),
    /** Tabs besides this one that hold the shared presence lock. */
    otherTabs: 0,
    /** Exclusive requests that are waiting for the presence lock. */
    exclusiveWaiting: 0,
    holdRoot: null as null | Promise<void>,
    rootHeld: false,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => h.legacy.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { h.legacy.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { h.legacy.delete(key) }),
            keys: vi.fn(async () => [...h.legacy.keys()]),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => stores.DBState.db),
        setDatabase: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        defaultSdDataFunc: vi.fn(() => ({})),
        saveImage: vi.fn(),
        getCharacterByIndex: vi.fn(),
        setCharacterByIndex: vi.fn(),
        appVer: 'test',
        appSubVer: 'test',
        getCurrentCharacter: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
        frozenSaveKeysStore: writable([]),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: { getWriter: () => ({ write: async () => { }, close: async () => { } }) },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    parseMarkdownSafe: vi.fn(),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    importCharacter: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        async getItem(_key: string) { return null }
        async setItem(_key: string, _value: Uint8Array) {}
        async keys() { return [] as string[] }
        async removeItem(_key: string) {}
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
    LLMFlags: {},
    LLMFormat: {},
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

//#endregion

/** A Web Locks manager that answers `query()` from the suite's own counters. */
function installLocks(supported: boolean): void {
    const manager = {
        request: (name: string, options: { mode?: string }, callback: (lock: { name: string, mode: string }) => Promise<unknown>) =>
            Promise.resolve(callback({ name, mode: options.mode ?? 'exclusive' })),
        query: async () => ({
            held: [
                { name: STORAGE_TAB_LOCK_NAME, mode: 'shared', clientId: 'this' },
                ...Array.from({ length: h.otherTabs }, (_, i) => ({ name: STORAGE_TAB_LOCK_NAME, mode: 'shared', clientId: `other-${i}` })),
            ],
            pending: Array.from({ length: h.exclusiveWaiting }, () => ({ name: STORAGE_TAB_LOCK_NAME, mode: 'exclusive', clientId: 'waiting' })),
        }),
    }
    Object.defineProperty(navigator, 'locks', { value: supported ? manager : undefined, configurable: true })
}

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

//#region fixtures

const U1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const U3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const U4 = 'aaaaaaaa-0000-4000-8000-000000000004'
const K1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const K2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const K3 = 'bbbbbbbb-0000-4000-8000-000000000003'
const K4 = 'bbbbbbbb-0000-4000-8000-000000000004'
const UNUSED = 'cccccccc-0000-4000-8000-000000000009'

const token = (id: string) => `{{inlayed::${id}}}`

type Fixture = Record<string, unknown>

function chat(id: string, texts: string[], extra: Fixture = {}): Fixture {
    return {
        id,
        message: texts.map((data) => ({ role: 'user', data, time: 1 })),
        note: '',
        name: id,
        localLore: [],
        ...extra,
    }
}

function char(chaId: string, chats: Fixture[], extra: Fixture = {}): Fixture {
    return { chaId, name: chaId, type: 'character', chatPage: 0, chats, ...extra }
}

const unitValue = (texts: string[]): Fixture => ({
    message: texts.map((data) => ({ role: 'user', data, time: 1 })),
    note: '',
    name: '',
    localLore: [],
})

const pointerChat = (id: string, key: string): Fixture => chat(id, [coldStorageHeader + key])

interface Ctx {
    w: World
    store: HeldStore
    stores: typeof import('src/ts/stores.svelte')
    characters: typeof import('src/ts/characters')
    inlays: typeof import('src/ts/process/files/inlays')
    cold: typeof import('src/ts/process/coldstorage.svelte')
    busy: typeof import('src/ts/process/memory/busyActions')
    /** The live character list; elements are the objects the delete functions receive. */
    chars(): Fixture[]
    exists(id: string): Promise<boolean>
}

interface BootOptions {
    locks?: boolean
    kind?: 'tauri' | 'opfs-transitional'
    /** Units written before the loop starts. */
    units?: Record<string, unknown>
    /** Ids whose inlays exist. */
    inlays?: string[]
}

let logs: Array<Record<string, unknown>> = []
let infoSpy: ReturnType<typeof vi.spyOn>
let ctx: Ctx

async function boot(characters: Fixture[], options: BootOptions = {}): Promise<Ctx> {
    installLocks(options.locks ?? true)
    h.db = { ...makeDb('p'), characters, characterOrder: characters.map((c) => c.chaId) }
    const w = await kit.startWorld({ startLoop: false, kind: options.kind })
    const stores = await import('src/ts/stores.svelte')
    stores.DBState.db = h.db as unknown as Database
    stores.selIdState.selId = 0
    stores.selectedCharID.set(0)
    const cold = await import('src/ts/process/coldstorage.svelte')
    for (const [key, value] of Object.entries(options.units ?? {})) {
        expect(await cold.setColdStorageItem(key, value)).toBe(true)
    }
    const inlays = await import('src/ts/process/files/inlays')
    for (const id of options.inlays ?? []) {
        await inlays.setInlayAsset(id, { name: `${id}.txt`, ext: 'txt', type: 'signature', data: `body of ${id}` })
    }
    if (options.kind !== 'opfs-transitional') {
        w.start()
        await sleepReal(100)
        w.marks.markCharacterForSave(characters[0].chaId)
        await vi.waitFor(() => { expect(w.api.isSaveClean()).toBe(true) }, { timeout: 8000, interval: 10 })
    }
    ctx = {
        w,
        store: w.store,
        stores,
        characters: await import('src/ts/characters'),
        inlays,
        cold,
        busy: await import('src/ts/process/memory/busyActions'),
        chars: () => stores.DBState.db.characters as unknown as Fixture[],
        exists: async (id) => (await inlays.getInlayAsset(id)) !== null,
    }
    return ctx
}

/** Resolved at run time: the module is the one under test, and a suite that cannot import it must still load. */
async function getCleanupState(): Promise<{ pending: number, running: boolean }> {
    const modulePath = 'src/ts/process/files/inlayCleanup'
    const cleanup = await import(/* @vite-ignore */ modulePath) as typeof import('src/ts/process/files/inlayCleanup')
    return cleanup.getInlayCleanupState()
}

async function waitGone(id: string, timeout = 8000): Promise<void> {
    await vi.waitFor(async () => { expect(await ctx.exists(id)).toBe(false) }, { timeout, interval: 25 })
}

async function waitBatches(count: number): Promise<void> {
    await vi.waitFor(() => { expect(logs.length).toBeGreaterThanOrEqual(count) }, { timeout: 8000, interval: 25 })
}

const isInlayDelete = (op: HeldStore['ops'][number]) =>
    (op.kind === 'delete' && op.key.startsWith('inlays/')) || (op.kind === 'deleteMany' && op.keys.some((key) => key.startsWith('inlays/')))

const inlayDeleteIndexes = (store: HeldStore) => store.ops.flatMap((op, i) => (isInlayDelete(op) ? [i] : []))

/** The root writes (commits) that happened before op number `index`. */
const commitsBefore = (store: HeldStore, index: number) => store.ops.slice(0, index).filter((op) => op.kind === 'write' && isRootKey(op.key)).length

/** Replaces reads of the keys `match` accepts with reads that wait for `release()`. */
function holdReads(store: HeldStore, match: (key: string) => boolean) {
    const original = store.read.bind(store)
    let release!: () => void
    const released = new Promise<void>((resolve) => { release = resolve })
    const state = { reached: false }
    store.read = async (key) => {
        if (match(key)) {
            state.reached = true
            await released
        }
        return original(key)
    }
    return {
        /** Resolves once a read of a held key is waiting; fails after 5 s. */
        waitReached: () => vi.waitFor(() => { expect(state.reached).toBe(true) }, { timeout: 5000, interval: 10 }),
        release,
    }
}

beforeEach(() => {
    logs = []
    h.otherTabs = 0
    h.exclusiveWaiting = 0
    h.holdRoot = null
    h.rootHeld = false
    h.legacy.clear()
    infoSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
        if (args[0] === 'inlay cleanup') {
            logs.push({ ...(args[1] as Record<string, unknown>), deleteOpsSoFar: ctx ? inlayDeleteIndexes(ctx.store).length : 0 })
        }
    })
})

afterEach(() => {
    infoSpy.mockRestore()
    kit.parkAll()
})

//#endregion

describe('the delete paths delete the inlays of the deleted data', () => {
    test('a deleted chat loses the inlay of its message once the removal is in the store, and not before', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`hello ${token(U1)}`]), chat('a2', ['plain'])]), char('B', [chat('b1', ['x'])])],
            { inlays: [U1] },
        )
        const owner = c.chars()[0]
        const victim = (owner.chats as Fixture[])[0]
        expect(await c.characters.removeChatConfirmed(owner as never, victim as never)).toBe(true)
        const opsAtRemoval = c.store.ops.length
        await waitGone(U1)

        const deletes = inlayDeleteIndexes(c.store)
        expect(deletes.length).toBeGreaterThan(0)
        expect(commitsBefore(c.store, deletes[0])).toBeGreaterThan(commitsBefore(c.store, opsAtRemoval))
        expect(logs[0]).toMatchObject({ candidates: 1, deleted: 1 })
    })

    test('a permanently deleted character loses the inlays of every one of its chats and of its first message', async () => {
        const c = await boot(
            [
                char('A', [chat('a1', [`one ${token(U1)}`]), chat('a2', [`two ${token(U2)}`])], { firstMessage: `first ${token(U3)}` }),
                char('B', [chat('b1', ['x'])]),
            ],
            { inlays: [U1, U2, U3] },
        )
        await c.characters.removeChar(c.chars()[0] as never, 'A', 'permanent')
        await waitGone(U1)
        await waitGone(U2)
        await waitGone(U3)
    })

    test('Empty trash deletes the inlays of every character it removes', async () => {
        const c = await boot(
            [
                char('A', [chat('a1', ['x'])]),
                char('T1', [chat('t1', [`one ${token(U1)}`])], { trashTime: 1_700_000_000_000 }),
                char('T2', [chat('t2', [`two ${token(U2)}`])], { trashTime: 1_700_000_000_000 }),
            ],
            { inlays: [U1, U2] },
        )
        const trashed = c.chars().filter((x) => x.trashTime)
        await c.characters.removeTrashedCharacters(trashed as never, { matching: false })
        await waitGone(U1)
        await waitGone(U2)
    })

    test('a chat of a character that is not the selected one is deleted only after its removal is committed', async () => {
        const c = await boot(
            [char('A', [chat('a1', ['x']), chat('a2', ['y'])]), char('B', [chat('b1', [`hello ${token(U1)}`]), chat('b2', ['y'])])],
            { inlays: [U1] },
        )
        const owner = c.chars()[1]
        const victim = (owner.chats as Fixture[])[0]
        await c.characters.removeChatConfirmed(owner as never, victim as never)
        const opsAtRemoval = c.store.ops.length
        await waitGone(U1)
        const deletes = inlayDeleteIndexes(c.store)
        expect(commitsBefore(c.store, deletes[0])).toBeGreaterThan(commitsBefore(c.store, opsAtRemoval))
    })

    test('acceptance: a chat deleted while a save iteration is in flight is not deleted by that iteration\'s commit', async () => {
        const c = await boot([char('A', [chat('a1', [`hello ${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1] })
        c.store.gate = async (key) => {
            if (isRootKey(key) && h.holdRoot) {
                h.rootHeld = true
                await h.holdRoot
            }
        }
        let release: () => void = () => {}
        h.holdRoot = new Promise<void>((resolve) => { release = resolve })
        const committedBefore = rootWrites(c.store).length
        ;(c.chars()[0].chats as Fixture[])[1].note = 'edited'
        c.w.marks.markCharacterForSave('A')
        await vi.waitFor(() => { expect(h.rootHeld).toBe(true) }, { timeout: 4000, interval: 5 })

        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        h.holdRoot = null
        release()
        await waitGone(U1)

        const deletes = inlayDeleteIndexes(c.store)
        expect(commitsBefore(c.store, deletes[0]) - committedBefore).toBeGreaterThanOrEqual(2)
    })

    test('acceptance: nothing is deleted while the save loop is stopped, and the pending batch deletes once it is clean again', async () => {
        const c = await boot([char('A', [chat('a1', [`hello ${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1] })
        c.stores.savingStoppedReason.set('stay')
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await sleepReal(1500)
        expect(await c.exists(U1)).toBe(true)
        expect(c.store.ops.some(isInlayDelete)).toBe(false)

        c.stores.savingStoppedReason.set(null)
        c.w.marks.markCharacterForSave('A')
        await waitGone(U1)
    })

    test('acceptance: nothing is deleted while a chaId is frozen', async () => {
        const c = await boot([char('A', [chat('a1', [`hello ${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1] })
        c.stores.frozenSaveKeysStore.set([{ chaId: 'A' } as never])
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await sleepReal(1500)
        expect(await c.exists(U1)).toBe(true)
        expect(get(c.stores.frozenSaveKeysStore).length).toBe(1)

        c.stores.frozenSaveKeysStore.set([])
        c.w.marks.markCharacterForSave('A')
        await waitGone(U1)
    })

    test('guard: a read-only page deletes nothing', async () => {
        const c = await boot([char('A', [chat('a1', [`hello ${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1], kind: 'opfs-transitional' })
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await sleepReal(1500)
        expect(await c.exists(U1)).toBe(true)
        expect(logs).toEqual([])
    })
})

describe('what the remaining profile still shows is kept', () => {
    async function deleteFirstChatOfA(c: Ctx): Promise<void> {
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U2)
        expect(logs.at(-1)).toMatchObject({ deleted: 1 })
    }

    test('a token that a Chat Copy of the same chat still holds keeps its inlay', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)} ${token(U2)}`]), chat('a2', [`copy ${token(U1)}`])])],
            { inlays: [U1, U2] },
        )
        await deleteFirstChatOfA(c)
        expect(await c.exists(U1)).toBe(true)
    })

    test('an id that only a branch\'s saved variables hold keeps its inlay', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)} ${token(U2)}`]), chat('a2', ['branch'], { scriptstate: { '$pic': U1 } })])],
            { inlays: [U1, U2] },
        )
        await deleteFirstChatOfA(c)
        expect(await c.exists(U1)).toBe(true)
    })

    test('an id that only an object key of the remaining profile holds keeps its inlay', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)} ${token(U2)}`]), chat('a2', ['branch'], { scriptstate: { [U1]: '1' } })])],
            { inlays: [U1, U2] },
        )
        await deleteFirstChatOfA(c)
        expect(await c.exists(U1)).toBe(true)
    })
    test('a token of a trashed character keeps its inlay, also after the trashed character is restored', async () => {
        const c = await boot(
            [
                char('A', [chat('a1', [`${token(U1)} ${token(U2)}`]), chat('a2', ['plain'])]),
                char('T', [chat('t1', [`kept ${token(U1)}`])]),
            ],
            { inlays: [U1, U2] },
        )
        await c.characters.removeChar(c.chars()[1] as never, 'T', 'normal')
        expect(c.chars()[1].trashTime).toBeTruthy()
        await deleteFirstChatOfA(c)
        expect(await c.exists(U1)).toBe(true)
        c.characters.restoreCharacterFromTrash(c.chars()[1] as never)
        await sleepReal(300)
        expect(await c.exists(U1)).toBe(true)
    })

    test('acceptance: trashing a character queues nothing', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)}`])]), char('B', [chat('b1', ['x'])])],
            { inlays: [U1] },
        )
        await c.characters.removeChar(c.chars()[0] as never, 'A', 'normal')
        expect((await getCleanupState()).pending).toBe(0)
        await sleepReal(800)
        expect(await c.exists(U1)).toBe(true)
        expect(logs).toEqual([])
    })

    test('a character\'s own image path keeps a scripted inlay id for as long as the character exists', async () => {
        const scripted = 'assets/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png'
        const c = await boot(
            [
                char('A', [chat('a1', [`${token(scripted)} ${token(U2)}`]), chat('a2', ['plain'])], { image: scripted }),
            ],
            { inlays: [U2] },
        )
        await deleteFirstChatOfA(c)
        expect(logs.at(-1)).toMatchObject({ candidates: 2, kept: 1 })
    })

    test('an id with quote and backslash characters that only a cold unit holds is kept', async () => {
        const odd = 'odd"id\\with-chars'
        const c = await boot(
            [char('A', [chat('a1', [`${token(odd)} ${token(U2)}`]), chat('a2', ['plain']), pointerChat('a3', K1)])],
            { inlays: [odd, U2], units: { [K1]: unitValue([`cold ${token(odd)}`]) } },
        )
        await deleteFirstChatOfA(c)
        expect(await c.exists(odd)).toBe(true)
    })

    test('a pointer chat, a nested pointer, an archive unit and a load-error root each keep the inlay they hold', async () => {
        const archive = { character: { chats: [{ message: [{ role: 'char', data: coldStorageHeader + K3 }] }] } }
        const c = await boot(
            [char('A', [
                chat('a1', [`${token(U1)} ${token(U2)} ${token(U3)} ${token(U4)} ${token(UNUSED)}`]),
                chat('a2', ['plain']),
                pointerChat('direct', K1),
                chat('errored', [formatColdStorageLoadError(K4)]),
            ])],
            {
                inlays: [U1, U2, U3, U4, UNUSED],
                units: {
                    [K1]: { ...unitValue([coldStorageHeader + K2]) },
                    [K2]: archive,
                    [K3]: unitValue([`deep ${token(U3)}`]),
                    [K4]: unitValue([`recoverable ${token(U4)}`]),
                },
            },
        )
        // U1 is held only by the deleted chat itself and goes, together with the id no unit mentions.
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U1)
        await waitGone(U2)
        await waitGone(UNUSED)
        expect(await c.exists(U3)).toBe(true)
        expect(await c.exists(U4)).toBe(true)
    })

    test('a cold unit that does not exist contributes nothing, so the inlays only it could have held are deleted', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)} ${token(U2)}`]), chat('a2', ['plain']), pointerChat('gone', K1)])],
            { inlays: [U1, U2] },
        )
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U1)
        await waitGone(U2)
    })

    test('a deleted pointer chat yields the inlays its cold unit holds as candidates', async () => {
        const c = await boot(
            [char('A', [pointerChat('cold', K1), chat('a2', ['plain'])])],
            { inlays: [U1], units: { [K1]: unitValue([`cold ${token(U1)}`]) } },
        )
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U1)
    })
})

describe('an incomplete picture of the profile deletes nothing', () => {
    test.each([
        ['does not decode', (c: Ctx) => { c.store.plant(`coldstorage/${K1}`, new Uint8Array([1, 2, 3, 4, 5])) }],
        ['cannot be read', (c: Ctx) => { c.store.faults.push({ match: (op) => op.kind === 'read' && op.key === `coldstorage/${K1}`, mode: 'before', times: 100 }) }],
        ['belongs to a page with no archive storage', (c: Ctx) => {
            c.store.faults.push({
                match: (op) => op.kind === 'read' && op.key === `coldstorage/${K1}`,
                mode: 'before',
                times: 100,
                error: Object.assign(new Error('no archive storage'), { name: 'AppStoreUnavailableError' }),
            })
        }],
    ])('acceptance: a reachable cold unit that %s stops the batch before anything is deleted', async (_name, spoil) => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain']), pointerChat('cold', K1)])],
            { inlays: [U1], units: { [K1]: unitValue(['x']) } },
        )
        spoil(c)
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitBatches(1)
        expect(logs[0]).toMatchObject({ deleted: 0, skipped: 'a cold unit could not be read' })
        expect(await c.exists(U1)).toBe(true)
    })

    test('acceptance: a cold unit that appears while the others are being read stops the batch', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain']), pointerChat('first', K1)])],
            { inlays: [U1], units: { [K1]: unitValue(['x']), [K2]: unitValue([`late ${token(U1)}`]) } },
        )
        const hold = holdReads(c.store, (key) => key === `coldstorage/${K1}`)
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await hold.waitReached()
        // A chat that points at a new unit arrives without any save being requested.
        ;(c.chars()[0].chats as Fixture[]).push(pointerChat('late', K2))
        hold.release()
        await waitBatches(1)
        expect(logs[0]).toMatchObject({ deleted: 0, skipped: 'a cold unit appeared during the walk' })
        expect(await c.exists(U1)).toBe(true)
    })

    test('acceptance: a save requested during the walk stops that batch, and the next batch walks again before deleting', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain']), pointerChat('first', K1)])],
            { inlays: [U1], units: { [K1]: unitValue(['x']) } },
        )
        const hold = holdReads(c.store, (key) => key === `coldstorage/${K1}`)
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await hold.waitReached()
        c.w.marks.markCharacterForSave('A')
        hold.release()
        await waitGone(U1)
        expect(logs[0]).toMatchObject({ deleted: 0, skipped: 'the profile changed during the walk', deleteOpsSoFar: 0 })
        expect(logs.at(-1)).toMatchObject({ deleted: 1 })
    })

    test('acceptance: a walk that throws is logged, deletes nothing and leaves no unhandled rejection', async () => {
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandled)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const c = await boot([char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1] })
            const owner = c.chars()[0]
            const victim = (owner.chats as Fixture[])[0]
            let armed = false
            const hostile = new Proxy(victim, {
                ownKeys(target) {
                    if (armed) {
                        throw new Error('hostile chat')
                    }
                    return Reflect.ownKeys(target)
                },
            })
            ;(owner.chats as Fixture[])[0] = hostile
            await c.characters.removeChatConfirmed(owner as never, hostile as never)
            armed = true
            await waitBatches(1)
            expect(logs[0]).toMatchObject({ deleted: 0, skipped: 'the walk failed' })
            expect(warn).toHaveBeenCalled()
            expect(await c.exists(U1)).toBe(true)
            await sleepReal(100)
            expect(unhandled).toEqual([])
        } finally {
            process.off('unhandledRejection', onUnhandled)
            warn.mockRestore()
        }
    })
})

describe('other tabs, backups and replaced databases', () => {
    test('acceptance: nothing is deleted while another tab is open, and the batch deletes after the next save once it has closed', async () => {
        const c = await boot([char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1] })
        h.otherTabs = 1
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await sleepReal(1500)
        expect(await c.exists(U1)).toBe(true)
        expect(logs).toEqual([])

        h.otherTabs = 0
        c.w.marks.markCharacterForSave('A')
        await waitGone(U1)
    })

    test('acceptance: a pending request for the exclusive storage lock stops the deletion', async () => {
        const c = await boot([char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1] })
        h.exclusiveWaiting = 1
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await sleepReal(1500)
        expect(await c.exists(U1)).toBe(true)

        h.exclusiveWaiting = 0
        c.w.marks.markCharacterForSave('A')
        await waitGone(U1)
    })

    test('acceptance: a page without Web Locks deletes nothing and says why', async () => {
        const c = await boot([char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1], locks: false })
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitBatches(1)
        expect(logs[0]).toMatchObject({ deleted: 0 })
        expect(logs[0].skipped).toEqual(expect.stringContaining('Web Locks'))
        expect(await c.exists(U1)).toBe(true)
    })

    test('acceptance: a backup load that is running holds the deletion back until it ends', async () => {
        const c = await boot([char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain'])])], { inlays: [U1] })
        const busy = c.busy.beginBusy('backupLoad')
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await sleepReal(1500)
        expect(await c.exists(U1)).toBe(true)
        busy.end()
        c.w.marks.markCharacterForSave('A')
        await waitGone(U1)
    })

    test('acceptance: a database replaced while the batch is pending drops the batch, and later removals in the new database are still cleaned up', async () => {
        const c = await boot(
            [char('A', [chat('a1', [`${token(U1)}`]), chat('a2', ['plain']), chat('a3', [`${token(U2)}`])])],
            { inlays: [U1, U2] },
        )
        c.store.gate = async (key) => {
            if (isRootKey(key) && h.holdRoot) {
                h.rootHeld = true
                await h.holdRoot
            }
        }
        let release: () => void = () => {}
        h.holdRoot = new Promise<void>((resolve) => { release = resolve })
        ;(c.chars()[0].chats as Fixture[])[1].note = 'edited'
        c.w.marks.markCharacterForSave('A')
        await vi.waitFor(() => { expect(h.rootHeld).toBe(true) }, { timeout: 4000, interval: 5 })
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        // A restore installs another database object, built after the removal, that does not hold the removed chat or its token.
        const replacement = $state.snapshot(c.stores.DBState.db) as unknown as Database
        expect(JSON.stringify(replacement)).not.toContain(U1)
        c.stores.DBState.db = replacement
        h.holdRoot = null
        release()
        await sleepReal(1500)
        // Nothing in the new database mentions U1, so only the replacement of the database kept it.
        expect(await c.exists(U1)).toBe(true)
        expect(logs).toEqual([])
        expect((await getCleanupState()).pending).toBe(0)

        const next = c.chars()[0]
        await c.characters.removeChatConfirmed(next as never, (next.chats as Fixture[]).find((x) => x.id === 'a3') as never)
        await waitGone(U2)
        expect(await c.exists(U1)).toBe(true)
    })
})

describe('units that have not changed are not read again', () => {
    const unitReads = (c: Ctx, from: number) => c.store.ops.slice(from).filter((op) => op.kind === 'read' && op.key.startsWith('coldstorage/'))

    async function firstDeletion(c: Ctx): Promise<number> {
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U1)
        await waitBatches(1)
        return c.store.ops.length
    }

    test('a second deletion right after the first reads no cold unit, and still keeps what a unit holds', async () => {
        const c = await boot(
            [char('A', [chat('a1', [token(U1)]), chat('a2', [`${token(U2)} ${token(U3)}`]), pointerChat('p', K1)])],
            { inlays: [U1, U2, U3], units: { [K1]: unitValue([coldStorageHeader + K2]), [K2]: unitValue([`deep ${token(U3)}`]) } },
        )
        const afterFirst = await firstDeletion(c)
        expect(unitReads(c, 0).length).toBeGreaterThanOrEqual(2)

        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U2)
        await waitBatches(2)
        expect(unitReads(c, afterFirst)).toEqual([])
        expect(await c.exists(U3)).toBe(true)
        expect(logs[1]).toMatchObject({ candidates: 2, kept: 1, deleted: 1 })
    })

    test('a unit rewritten after it was remembered is read again, so an id it now holds is kept', async () => {
        const c = await boot(
            [char('A', [chat('a1', [token(U1)]), chat('a2', [`${token(U2)} ${token(U4)}`]), pointerChat('p', K1)])],
            { inlays: [U1, U2, U4], units: { [K1]: unitValue(['nothing here']) } },
        )
        const afterFirst = await firstDeletion(c)
        expect(await c.cold.setColdStorageItem(K1, unitValue([`now ${token(U2)}`]))).toBe(true)

        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U4)
        expect(await c.exists(U2)).toBe(true)
        expect(unitReads(c, afterFirst).length).toBe(1)
    })

    test.each([
        ['deleted by the page', async (c: Ctx) => { expect(await c.cold.deleteColdStorageUnits([K1])).toEqual([]) }],
        ['removed from the store behind the page', async (c: Ctx) => { c.store.unplant(`coldstorage/${K1}`) }],
    ])('a unit %s after it was remembered contributes nothing', async (_name, remove) => {
        const c = await boot(
            [char('A', [chat('a1', [token(U1)]), chat('a2', [`${token(U3)}`]), pointerChat('p', K1)])],
            { inlays: [U1, U3], units: { [K1]: unitValue([`held ${token(U3)}`]) } },
        )
        await firstDeletion(c)
        await remove(c)

        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U3)
    })
    test('a remembered unit whose rewrite failed and that cannot be read afterwards stops the batch', async () => {
        const c = await boot(
            [char('A', [chat('a1', [token(U1)]), chat('a2', [`${token(U2)}`]), pointerChat('p', K1)])],
            { inlays: [U1, U2], units: { [K1]: unitValue(['nothing here']) } },
        )
        await firstDeletion(c)
        c.store.faults.push({ match: (op) => op.kind === 'write' && op.key === `coldstorage/${K1}`, mode: 'before', times: 1 })
        expect(await c.cold.setColdStorageItem(K1, unitValue([token(U2)]))).toBe(false)
        c.store.faults.push({ match: (op) => op.kind === 'read' && op.key === `coldstorage/${K1}`, mode: 'before', times: 100 })

        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitBatches(2)
        expect(logs[1]).toMatchObject({ deleted: 0, skipped: 'a cold unit could not be read' })
        expect(await c.exists(U2)).toBe(true)
    })

    test('an asset path that straddles a piece boundary of a long string in a unit is kept after the unit was remembered under uuid-only candidates', async () => {
        const asset = `assets/${'0123456789abcdef'.repeat(4)}.png`
        // The path starts 70 characters before the first piece ends, so it fits whole only in a piece that overlaps the previous one by at least 80 characters.
        const text = 'x'.repeat(CHUNK_CHARS - 70) + asset + 'y'.repeat(CHUNK_CHARS)
        const c = await boot(
            [char('A', [chat('a1', [token(U1)]), chat('a2', [`${token(asset)} ${token(U4)}`]), pointerChat('p', K1)])],
            { inlays: [U1, asset, U4], units: { [K1]: unitValue([text]) } },
        )
        const afterFirst = await firstDeletion(c)
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U4)
        expect(await c.exists(asset)).toBe(true)
        expect(unitReads(c, afterFirst)).toEqual([])
    })
    test('an id that a summary cannot answer for is searched for in the unit itself', async () => {
        const odd = 'odd"id\\with-chars'
        const c = await boot(
            [char('A', [chat('a1', [token(U1)]), chat('a2', [`${token(odd)} ${token(U4)}`]), pointerChat('p', K1)])],
            { inlays: [U1, odd, U4], units: { [K1]: unitValue([`held ${token(odd)}`]) } },
        )
        const afterFirst = await firstDeletion(c)
        const owner = c.chars()[0]
        await c.characters.removeChatConfirmed(owner as never, (owner.chats as Fixture[])[0] as never)
        await waitGone(U4)
        expect(await c.exists(odd)).toBe(true)
        expect(unitReads(c, afterFirst).length).toBe(1)
    })
})
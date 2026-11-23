/**
 * What a plugin's module write-back does to module stubs on the real store2 boot: the page is booted through the real
 * dispatch over a memory backend with the real list derivation, chosen modules become their recorded stubs, and a copy
 * the plugin holds is the stored body read back through the residency. A written module that the save would reuse
 * whole (module unit and both lists) stays the live stub; anything the save could not reuse installs as the plugin
 * wrote it, and a stub is never a carry target for the retained-paths field.
 * Labels: reproducer (fails on the pre-change base), guard (passes before and after).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                // A stored recent 'db' grant keeps the character and database APIs
                // from prompting; every other key is absent.
                if (options?.name === 'plugin_permissions') {
                    if (key.endsWith('_db_lastGrantTime')) return Date.now()
                    if (key.endsWith('_db')) return true
                    if (key.endsWith('_dbWrite_lastGrantTime')) return Date.now()
                    if (key.endsWith('_dbWrite')) return true
                }
                return null
            }),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('katex'), () => ({}))
vi.mock(import('src/ts/lite'), () => ({}))

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../../pluginSafeClass'))

vi.mock(import('../transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../transpiler'))

vi.mock(import('../../../stores.svelte'), () => {
    const state = $state({ db: { characters: [], modules: [], enabledModules: [] } as unknown })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
        hotReloading: writable(false),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../../stores.svelte')
})

// The page's own defaulting pass over a written database is not what these cases look at; the plugin's key writes
// have already landed in the live list when it runs.
vi.mock(import('../../../storage/database.svelte'), async (importOriginal) => ({
    ...await importOriginal(),
    setDatabase: vi.fn(),
}))

vi.mock(import('../../../util'), async (importOriginal) => ({
    ...await importOriginal(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertPluginConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertErrorWait: vi.fn(async () => {}),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertMd: vi.fn(),
    alertToast: vi.fn(),
    alertWait: vi.fn(() => ({})),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../characters'), () => ({
    updateLorebooks: vi.fn((book: unknown) => book),
}) as unknown as typeof import('../../../characters'))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    getFetchLogs: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../../globalApi.svelte'))

vi.mock(import('../../../gui/colorscheme'), async (importOriginal) => ({
    ...await importOriginal(),
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../../gui/colorscheme'))

vi.mock(import('../../../platform'), () => ({
    isNodeServer: false,
    isTauri: false,
    isIOS: () => false,
}) as unknown as typeof import('../../../platform'))

vi.mock(import('../../../storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('../../../storage/store/appStore'))

vi.mock(import('../../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../../process/mcp/pluginmcp'))

vi.mock(import('../../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: vi.fn(async () => 'hash'),
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../../parser/parser.svelte'))

vi.mock(import('../../../model/types'), async (importOriginal) => ({
    ...await importOriginal(),
}) as unknown as typeof import('../../../model/types'))

vi.mock(import('../../../process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('../../../process/index.svelte'))

vi.mock(import('../../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../../process/scripts'))

vi.mock(import('../../../model/modellist'), async (importOriginal) => ({
    ...await importOriginal(),
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('../../../model/modellist'))

vi.mock(import('../../../process/request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../../../process/request/request'))

vi.mock(import('../../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../../process/ttsHooks'))

vi.mock(import('../../../process/modules'), () => ({
    refreshModules: vi.fn(),
    bumpModuleGui: vi.fn(),
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../../process/modules'))

type RepairModuleLorebook = typeof import('../../../process/moduleLorebookRepair').repairModuleLorebook

// A case that holds the migration repair installs its gate here; every other case reaches the real repair.
const repairHook = vi.hoisted(() => ({ current: null as null | ((...args: Parameters<RepairModuleLorebook>) => ReturnType<RepairModuleLorebook>) }))

vi.mock(import('../../../process/moduleLorebookRepair'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        repairModuleLorebook: (...args: Parameters<RepairModuleLorebook>) => repairHook.current === null ? actual.repairModuleLorebook(...args) : repairHook.current(...args),
    }
})

//#endregion

import { Sha256 } from '../../../assetHash'
import { makeRisuaiAPIV3 } from '../v3.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { alertConfirm, alertError } from '../../../alert'
import { updateLorebooks } from '../../../characters'
import { bumpModuleGui, getModuleLorebooks } from '../../../process/modules'
import { moduleListOf, moduleRefIdsOf } from '../../../process/moduleRefList'
import { risuChatParser } from '../../../parser/parser.svelte'
// Registers the displayed origin's real reference read with the loader, as the page's import does.
import '../../../process/moduleEnsure'
import { getV2PluginAPIs, type RisuPlugin } from '../../plugins.svelte'
import { noteStoredRetained, retainedSourceOfStub } from '../../moduleStubWrite'
import { setDatabase as pageSetDatabase } from '../../../storage/database.svelte'
import type { Database } from '../../../storage/database.svelte'
import type { RisuModule } from '../../../process/modules'
import { isModuleStub } from '../../../storage/moduleStub'
import { resetPageStorageModeForTests } from '../../../storage/pageStorageMode'
import { createMemoryBackend, type MemoryBackend } from '../../../storage/store2/backend'
import { resetStore2BootForTest } from '../../../storage/store2/bootActive'
import { IDENTITY, moduleHandles } from '../../../storage/store2/codec'
import { keyOfRef } from '../../../storage/store2/format'
import { acquireModule, unregisterModuleLoader } from '../../../storage/store2/moduleAcquire'
import { moduleStubOf, slotIsRecordedStub } from '../../../storage/store2/moduleStubMatch'
import { getResidency, registerResidency, resetResidencyForTest } from '../../../storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from '../../../storage/store2/saveActive'
import { createListDerivation } from '../../../storage/store2/lists/derive'
import { ASSET_RETAINED_KEY } from '../../../studio/assets/assetOwnerKeys'
import { bootThroughDispatch, createClock, seedTree, testEnv } from '../../../storage/tests/store2SaveKit'
import { buildSmall, type Obj } from '../../../storage/tests/store2/codecFixtures'

const PLUGIN_NAME = 'write-back-plugin'
const STORED_RETAINED = [['old', 'kept-b.png']]

function makePlugin(): RisuPlugin {
    return { name: PLUGIN_NAME, script: 'write-back-script', arguments: {}, realArg: {}, customLink: [], argMeta: {} }
}

function moduleBody(name: string, retained?: unknown): Obj {
    return {
        id: `id-${name}`, name, description: `about ${name}`, regex: [], trigger: [], assets: [], rank: 0,
        lorebook: [{ comment: 'c', content: `text of ${name}`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 2 }],
        ...(retained === undefined ? {} : { [ASSET_RETAINED_KEY]: retained }),
    }
}

const api = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())
const liveModules = () => (DBState.db as unknown as { modules: RisuModule[] }).modules
const liveShape = () => liveModules().map((slot) => isModuleStub(slot))

function residencyOrThrow() {
    const residency = getResidency()
    if (residency === null) {
        throw new Error('The boot registered no residency.')
    }
    return residency
}

function encoderOrThrow() {
    const encoder = getActiveStore2Save()?.encoder
    if (encoder === undefined) {
        throw new Error('The boot registered no encoder.')
    }
    return encoder
}

/**
 * Boots a tree of three modules (the second holds a retained-paths field) and turns each index of `stubbed` into its
 * recorded stub, its three stored units left undigested as a real boot leaves them; the database becomes the live one.
 */
async function bootWithStubs(stubbed: number[], modules: Obj[] = [moduleBody('a'), moduleBody('b', STORED_RETAINED), moduleBody('c')]): Promise<MemoryBackend> {
    const memory = createMemoryBackend()
    const lists = createListDerivation()
    const source = { ...(buildSmall(2) as unknown as Obj), archiveCharacters: false, modules } as unknown as Database
    await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), lists)
    const booted = await bootThroughDispatch(memory, { lists })
    if (booted.result.kind !== 'store2') {
        throw new Error(`The boot answered ${booted.result.kind}.`)
    }
    const residency = residencyOrThrow()
    const encoder = encoderOrThrow()
    const index = encoder.acknowledged().objects?.moduleIndex
    if (index === undefined) {
        throw new Error('The boot registered no module index.')
    }
    const database = booted.result.database as unknown as { modules: unknown[], enabledModules: string[], plugins: unknown[] }
    for (const at of stubbed) {
        const handle = moduleHandles(index.entries)[at]
        const entry = residency.moduleEntryOf(handle)
        if (entry === null) {
            throw new Error('No entry for the module.')
        }
        for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
            const unit = encoder.acknowledged().units.get(`${prefix}${handle}`)
            if (unit !== undefined) {
                delete unit.digest
            }
        }
        database.modules[at] = moduleStubOf(entry)
    }
    database.enabledModules = []
    database.plugins = [{ name: PLUGIN_NAME, script: '' }]
    DBState.db = database as unknown as Database
    return memory
}

/** The stored body of module `id` as a plugin's own copy; hydrated, so a save would reuse its units by digest. */
async function storedCopy(id: string, options: { hydrate?: boolean } = {}): Promise<RisuModule> {
    const residency = residencyOrThrow()
    const read = await residency.readModule(`${id}#0`)
    if (read.status !== 'ok') {
        throw new Error(`The read of ${id} came to ${read.status}: ${String(read.error)}.`)
    }
    if (options.hydrate !== false) {
        residency.hydrateModule(read)
    }
    return structuredClone(read.value) as unknown as RisuModule
}

async function storedCopies(ids: string[]): Promise<RisuModule[]> {
    return Promise.all(ids.map((id) => storedCopy(id)))
}

function planLive() {
    return encoderOrThrow().plan(DBState.db as unknown as Database, { marked: new Set<string>(), modules: true, whole: false })
}

/** The identities of the module and list units a plan would write; the fixture's own edits of the plugin list and settings are not among them. */
function moduleUnitsWritten(plan: Awaited<ReturnType<typeof planLive>>): string[] {
    const prefixes: string[] = [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]
    return [...plan.written.keys()].filter((identity) => prefixes.some((prefix) => identity.startsWith(prefix)))
}

/** One pass over the live modules, committed and acknowledged: what the next save writes. */
async function commitLive(): Promise<void> {
    const committer = getActiveStore2Save()?.session.committer
    if (committer === null || committer === undefined) {
        throw new Error('No committer.')
    }
    const plan = await planLive()
    const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
    if (result.status !== 'committed') {
        throw new Error(`The pass came to ${result.status}.`)
    }
    plan.acknowledge()
}

function savedIds(): string[] {
    return (encoderOrThrow().acknowledged().objects?.moduleIndex?.entries ?? []).map((entry) => entry.id)
}

function savedEntry(id: string) {
    const entry = residencyOrThrow().moduleEntryOf(`${id}#0`)
    if (entry === null) {
        throw new Error(`No saved entry for ${id}.`)
    }
    return entry
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

/** Releases of whatever a case holds open (reads, questions, the repair); they run first so no case leaves a pass waiting for the next. */
const cleanups: (() => void)[] = []

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup()
    }
    await turns(5)
    vi.restoreAllMocks()
    unregisterModuleLoader()
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageStorageModeForTests()
    DBState.db = { characters: [], modules: [], enabledModules: [] } as unknown as Database
    selectedCharID.set(-1)
    vi.mocked(alertConfirm).mockImplementation(async () => true)
    vi.mocked(updateLorebooks).mockImplementation((book) => book)
    vi.mocked(getModuleLorebooks).mockReset()
    vi.mocked(risuChatParser).mockReset()
})

describe('a round trip of stored modules through the plugin setters keeps the stubs', () => {
    test('guard: an untouched boot with stubs plans no change', async () => {
        await bootWithStubs([0, 1, 2])

        expect(liveShape()).toEqual([true, true, true])
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })

    test('W1 reproducer: a stored copy written through setDatabase leaves the live slot the recorded stub', async () => {
        await bootWithStubs([1])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])

        await api().setDatabase({ modules: copies })

        expect(liveShape()).toEqual([false, true, false])
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })

    test('T5: the same through setDatabaseLite over stubs returns a promise, and the stubs are kept after it settles', async () => {
        await bootWithStubs([1])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])

        const pending = getV2PluginAPIs().setDatabaseLite({ modules: copies }, PLUGIN_NAME)

        expect(pending).toBeInstanceOf(Promise)
        await pending
        expect(liveShape()).toEqual([false, true, false])
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })

    test('W3 reproducer: key order, an undefined field and negative zero do not make a stored copy an edit', async () => {
        await bootWithStubs([1])
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        const reordered = Object.fromEntries(Object.entries(b).reverse()) as Record<string, unknown>
        reordered.neverSet = undefined
        reordered.rank = -0

        await api().setDatabase({ modules: [a, reordered, c] })

        expect(liveShape()).toEqual([false, true, false])
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })
})

describe('an edit, a reorder, a deletion and an addition install only what changed', () => {
    test('W4 reproducer: of three stubs the edited and the added module are full, the rest stay stubs, and the order and the edit are saved', async () => {
        await bootWithStubs([0, 1, 2])
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        b.lorebook![0].content = 'edited by plugin'
        const added = { ...await storedCopy('id-a'), id: 'id-d', name: 'd' } as RisuModule

        await api().setDatabase({ modules: [c, b, a, added] })

        expect(liveShape()).toEqual([true, false, true, false])
        expect(liveModules().map((slot) => slot.id)).toEqual(['id-c', 'id-b', 'id-a', 'id-d'])
        await commitLive()
        expect(savedIds()).toEqual(['id-c', 'id-b', 'id-a', 'id-d'])
        const saved = await residencyOrThrow().readModule('id-b#0')
        expect(saved.status === 'ok' && (saved.value as unknown as RisuModule).lorebook?.[0].content).toBe('edited by plugin')
    })

    test('W5 reproducer: a module left out of the list is dropped from the saved index and the other two stay stubs', async () => {
        await bootWithStubs([0, 1, 2])
        const [a, , c] = await storedCopies(['id-a', 'id-b', 'id-c'])

        await api().setDatabase({ modules: [a, c] })

        expect(liveShape()).toEqual([true, true])
        await commitLive()
        expect(savedIds()).toEqual(['id-a', 'id-c'])
    })
})

describe('what cannot be proved to be the stored module installs as written', () => {
    test('W6 guard: a copy whose units were never hydrated installs', async () => {
        await bootWithStubs([1])
        const [a, c] = await storedCopies(['id-a', 'id-c'])
        const b = await storedCopy('id-b', { hydrate: false })

        await api().setDatabase({ modules: [a, b, c] })

        expect(liveShape()).toEqual([false, false, false])
    })

    test('W7 guard: a duplicate id in the incoming list installs and the plan succeeds', async () => {
        await bootWithStubs([1])
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])

        await api().setDatabase({ modules: [a, b, c, structuredClone(b)] })

        expect(liveShape()).toEqual([false, false, false, false])
        await expect(planLive()).resolves.toBeDefined()
    })

    test('W7 guard: a live list holding the id as a recorded stub and then as a resident module installs and the plan succeeds', async () => {
        await bootWithStubs([1])
        const live = DBState.db as unknown as { modules: unknown[] }
        live.modules = [live.modules[0], live.modules[1], live.modules[2], await storedCopy('id-b')]
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])

        await api().setDatabase({ modules: [a, b, c, await storedCopy('id-b')] })

        expect(liveShape()).toEqual([false, false, false, false])
        await expect(planLive()).resolves.toBeDefined()
    })

    test('W7 guard: a live list holding the id as a recorded stub and then as an edited resident module installs the incoming copy as a full module', async () => {
        await bootWithStubs([1])
        const edited = await storedCopy('id-b')
        edited.description = 'edited resident'
        const live = DBState.db as unknown as { modules: unknown[] }
        live.modules = [live.modules[0], live.modules[1], live.modules[2], edited]
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])

        await api().setDatabase({ modules: [a, b, c] })

        expect(liveShape()).toEqual([false, false, false])
        expect(liveModules().map((slot) => slot.id)).toEqual(['id-a', 'id-b', 'id-c'])
        expect(liveModules()[1].description).toBe('about b')
    })

    test('W8 guard: a stub edited after the copy was hydrated is replaced by the copy', async () => {
        await bootWithStubs([1])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        ;(liveModules()[1] as unknown as Record<string, unknown>).name = 'renamed after hydration'

        await api().setDatabase({ modules: copies })

        expect(liveShape()).toEqual([false, false, false])
        expect(liveModules()[1].name).toBe('b')
    })

    test('W9 guard: a resident module edited after the copy was taken is replaced by the stale copy as a resident module', async () => {
        await bootWithStubs([])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        liveModules()[1].lorebook![0].content = 'edited live'

        await api().setDatabase({ modules: copies })

        expect(liveShape()).toEqual([false, false, false])
        expect(liveModules()[1].lorebook?.[0].content).toBe('text of b')
    })

    test('W10 guard: a module holding a BigInt installs without a throw and the other keys are applied', async () => {
        await bootWithStubs([1])
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        ;(b as unknown as Record<string, unknown>).big = 10n

        await api().setDatabase({ modules: [a, b, c], zzNote: 'applied' })

        expect(liveShape()).toEqual([false, false, false])
        expect((DBState.db as unknown as { pluginCustomStorage: Record<string, unknown> }).pluginCustomStorage.zzNote).toBe('applied')
    })
})

describe('a stub that is swapped in is never a carry target', () => {
    test('W20 reproducer: live [recorded stub, resident with the retained field], written [other, stub]: the stub stays exactly the recorded stub and the plan succeeds', async () => {
        await bootWithStubs([1])
        const residency = residencyOrThrow()
        const entry = savedEntry('id-b')
        const resident = await storedCopy('id-b')
        const live = DBState.db as unknown as { modules: unknown[] }
        live.modules = [live.modules[1], resident, live.modules[0]]
        const other = await storedCopy('id-a')

        await api().setDatabase({ modules: [other, moduleStubOf(entry)] })

        expect(Object.hasOwn(liveModules()[1], ASSET_RETAINED_KEY)).toBe(false)
        expect(slotIsRecordedStub(liveModules()[1], residency.moduleEntryOf('id-b#0') ?? entry)).toBe(true)
        await expect(planLive()).resolves.toBeDefined()
    })
})

describe('a list unit that cannot be digested installs and the pass derives the list', () => {
    test.each([
        ['W17', 'al'],
        ['W18', 'il'],
    ] as const)('%s guard: a withheld %s unit lets the round trip install the module and the next save writes a new list', async (_id, field) => {
        const memory = await bootWithStubs([1])
        const before = savedEntry('id-b')
        const listRef = before[field]
        if (listRef === null) {
            throw new Error(`The fixture module holds no ${field} list.`)
        }
        memory.poke(keyOfRef(listRef), null)
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])

        await api().setDatabase({ modules: copies })

        expect(liveShape()).toEqual([false, false, false])
        await commitLive()
        const after = savedEntry('id-b')[field]
        expect(after === null ? null : keyOfRef(after)).not.toBe(keyOfRef(listRef))
    })
})

describe('a plugin-list prompt held open does not decide the module', () => {
    const NEW_PLUGIN = {
        name: 'prompted-plugin', script: '//@name prompted-plugin\n//@api 3.0\n//@version 1.0.0\n// body', arguments: {}, realArg: {},
        version: '3.0', customLink: [], argMeta: {}, versionOfPlugin: '1.0.0', updateURL: '', allowedIPC: [],
    }

    test.each(['setDatabase', 'setDatabaseLite'] as const)('W16 guard: %s, a stub loaded and edited while the prompt is held, then an equal copy: the copy installs and is never a stub', async (setter) => {
        await bootWithStubs([1])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        let answer: (value: boolean) => void = () => {}
        vi.mocked(alertConfirm).mockClear()
        vi.mocked(alertConfirm).mockImplementationOnce(() => new Promise<boolean>((resolve) => { answer = resolve }))

        const call = setter === 'setDatabase'
            ? api().setDatabase({ plugins: [{ name: PLUGIN_NAME, script: '' }, NEW_PLUGIN], modules: copies })
            : api().setDatabaseLite({ plugins: [{ name: PLUGIN_NAME, script: '' }, NEW_PLUGIN], modules: copies })
        cleanups.push(() => answer(true))
        await vi.waitFor(() => expect(vi.mocked(alertConfirm)).toHaveBeenCalled())
        const loaded = await storedCopy('id-b')
        loaded.lorebook![0].content = 'edited while held'
        liveModules()[1] = loaded
        answer(true)
        await within(call, setter)

        expect(liveShape()).toEqual([false, false, false])
        expect(liveModules()[1].lorebook?.[0].content).toBe('text of b')
    })
})

/** Records the stored retained-paths value of module `id` the way the loader does when it reads the module. */
async function noteStored(id: string): Promise<void> {
    const residency = residencyOrThrow()
    const read = await residency.readModule(`${id}#0`)
    if (read.status !== 'ok') {
        throw new Error(`The read of ${id} came to ${read.status}.`)
    }
    noteStoredRetained(residency, id, read.entry, read.value)
}

function withoutRetained(module: RisuModule): RisuModule {
    const copy = { ...module } as unknown as Record<string, unknown>
    delete copy[ASSET_RETAINED_KEY]
    return copy as unknown as RisuModule
}

describe('a recorded stored value is what a stub carries through a plugin write', () => {
    test('W12 guard, new surface: a copy that lost the field and was edited installs with the stored value, and the next save lists its path', async () => {
        await bootWithStubs([1])
        await noteStored('id-b')
        const before = savedEntry('id-b')
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        const edited = { ...withoutRetained(b), name: 'edited b' } as RisuModule

        await api().setDatabase({ modules: [a, edited, c] })

        expect(liveShape()).toEqual([false, false, false])
        expect((liveModules()[1] as unknown as Record<string, unknown>)[ASSET_RETAINED_KEY]).toEqual(STORED_RETAINED)
        await commitLive()
        const after = savedEntry('id-b')
        const read = await residencyOrThrow().readModule('id-b#0')
        expect(read.status).toBe('ok')
        expect(keyOfRef(after.al)).toBe(keyOfRef(before.al))
        expect(read.status === 'ok' && (read.value as Record<string, unknown>)[ASSET_RETAINED_KEY]).toEqual(STORED_RETAINED)
    })

    test('W13 guard, new surface: a copy that only lost the field stays a stub', async () => {
        await bootWithStubs([1])
        await noteStored('id-b')
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])

        await api().setDatabase({ modules: [a, withoutRetained(b), c] })

        expect(liveShape()).toEqual([false, true, false])
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })

    test('W13 guard, new surface: a stored body without the field deletes the value an edited copy brings', async () => {
        await bootWithStubs([0])
        await noteStored('id-a')
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        const edited = { ...a, name: 'edited a', [ASSET_RETAINED_KEY]: [['x', 'y.png']] } as unknown as RisuModule

        await api().setDatabase({ modules: [edited, b, c] })

        expect(Object.hasOwn(liveModules()[0], ASSET_RETAINED_KEY)).toBe(false)
        expect(liveModules()[0].name).toBe('edited a')
    })

    test('W13 guard, new surface: the record and the value a source hands out are copies', async () => {
        await bootWithStubs([1])
        const residency = residencyOrThrow()
        const read = await residency.readModule('id-b#0')
        if (read.status !== 'ok') {
            throw new Error('The read failed.')
        }
        noteStoredRetained(residency, 'id-b', read.entry, read.value)
        ;(read.value[ASSET_RETAINED_KEY] as unknown[][])[0][1] = 'mutated-after-note'
        const stub = liveModules()[1]

        const first = retainedSourceOfStub(stub) as Record<string, unknown>
        expect(first[ASSET_RETAINED_KEY]).toEqual(STORED_RETAINED)
        ;(first[ASSET_RETAINED_KEY] as unknown[][])[0][1] = 'mutated-after-write'
        const second = retainedSourceOfStub(stub) as Record<string, unknown>

        expect(second[ASSET_RETAINED_KEY]).toEqual(STORED_RETAINED)
        expect(second).not.toBe(first)
    })

    test.each(['never read', 'unit moved'] as const)('W14 guard, new surface: a stub whose stored value is %s carries nothing and the incoming value stays', async (situation) => {
        await bootWithStubs([1])
        if (situation === 'unit moved') {
            await noteStored('id-b')
            const residency = residencyOrThrow()
            const entry = savedEntry('id-b')
            const other = savedEntry('id-c').unit
            const original = residency.moduleEntryOf.bind(residency)
            vi.spyOn(residency, 'moduleEntryOf').mockImplementation((handle) => handle === 'id-b#0' ? { ...entry, unit: other } : original(handle))
        }
        expect(retainedSourceOfStub(liveModules()[1])).toBeNull()
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        const edited = { ...b, name: 'edited b', [ASSET_RETAINED_KEY]: [['z', 'w.png']] } as unknown as RisuModule

        await api().setDatabase({ modules: [a, edited, c] })

        expect((liveModules()[1] as unknown as Record<string, unknown>)[ASSET_RETAINED_KEY]).toEqual([['z', 'w.png']])
    })

    test('W15 guard, new surface: through the page\'s own setDatabase the stored copy still leaves the stub', async () => {
        await bootWithStubs([1])
        await noteStored('id-b')
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        vi.mocked(pageSetDatabase).mockImplementation((await vi.importActual<typeof import('../../../storage/database.svelte')>('../../../storage/database.svelte')).setDatabase)
        try {
            await api().setDatabase({ modules: copies })
        } finally {
            vi.mocked(pageSetDatabase).mockImplementation(() => {})
        }

        expect(liveShape()).toEqual([false, true, false])
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })
})

//#region stage 2: the read pass and the waits

interface ReadSpy {
    calls: string[]
    inFlight: number
    maxInFlight: number
    /** Lets the reads of this module id (now and later) through. */
    open(id: string): void
    openAll(): void
    /** Lets the oldest waiting read through once. */
    step(): void
}

/**
 * Wraps the residency's `readModule`: counts calls, holds each read until opened, and does not answer after `neverAfter`
 * calls (a pending read, not a throw, so a call that waits on it fails the case's bound). The case's cleanup opens every
 * held read and fails every read that does not answer.
 */
function spyReads(options: { hold?: boolean, neverAfter?: number } = {}): ReadSpy {
    const residency = residencyOrThrow()
    const original = residency.readModule.bind(residency)
    const waiting: { handle: string, resolve: () => void }[] = []
    const stuck: ((error: Error) => void)[] = []
    const opened = new Set<string>()
    let all = options.hold !== true
    const spy: ReadSpy = {
        calls: [],
        inFlight: 0,
        maxInFlight: 0,
        open(id) {
            opened.add(`${id}#0`)
            waiting.filter((entry) => entry.handle === `${id}#0`).forEach((entry) => entry.resolve())
        },
        openAll() {
            all = true
            waiting.splice(0).forEach((entry) => entry.resolve())
        },
        step() {
            waiting.shift()?.resolve()
        },
    }
    vi.spyOn(residency, 'readModule').mockImplementation(async (handle: string) => {
        spy.calls.push(handle)
        if (options.neverAfter !== undefined && spy.calls.length > options.neverAfter) {
            return new Promise<never>((_, reject) => { stuck.push(reject) })
        }
        spy.inFlight++
        spy.maxInFlight = Math.max(spy.maxInFlight, spy.inFlight)
        try {
            if (!all && !opened.has(handle)) {
                await new Promise<void>((resolve) => { waiting.push({ handle, resolve }) })
            }
            return await original(handle)
        } finally {
            spy.inFlight--
        }
    })
    cleanups.push(() => {
        spy.openAll()
        stuck.splice(0).forEach((reject) => reject(new Error('The case ended while the read was still pending.')))
    })
    return spy
}

const turn =() => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function turns(count = 15): Promise<void> {
    for (let i = 0; i < count; i++) {
        await turn()
    }
}

async function until(check: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 300; i++) {
        if (check()) {
            return
        }
        await turn()
    }
    throw new Error(`${label} never happened.`)
}

/** Lets a call that waits reach its first held read; a call that does not wait simply runs on. */
async function started(spy: ReadSpy): Promise<void> {
    for (let i = 0; i < 40 && spy.calls.length === 0; i++) {
        await turn()
    }
}

/** Races a promise against a real timer, so a call that never settles fails the test instead of hanging it. */
function within<T>(promise: Promise<T>, label: string, ms = 1500): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms.`)), ms) })
    return Promise.race([promise, bound]).finally(() => clearTimeout(timer))
}

interface Tracked {
    status: 'pending' | 'resolved' | 'rejected'
    error: unknown
}

function track(value: unknown): Tracked {
    const state: Tracked = { status: 'pending', error: undefined }
    Promise.resolve(value).then(() => { state.status = 'resolved' }, (error: unknown) => { state.status = 'rejected'; state.error = error })
    return state
}

/** The first question of the corrupted-lorebook flow waits for `release`; each question is answered from `answers`. */
function holdQuestions(answers: boolean[]) {
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let asked = 0
    cleanups.push(release)
    vi.mocked(alertConfirm).mockImplementation(async () => {
        const at = asked++
        if (at === 0) {
            await gate
        }
        return answers[at] ?? true
    })
    return { release, asked: () => asked }
}

/** Holds the migration repair of the next module that needs one until `open`; the case's cleanup opens it and restores the real repair. */
async function holdRepair() {
    const actual = await vi.importActual<typeof import('../../../process/moduleLorebookRepair')>('../../../process/moduleLorebookRepair')
    let open = () => {}
    const gate = new Promise<void>((resolve) => { open = resolve })
    let entered = false
    repairHook.current = async (...args) => {
        entered = true
        await gate
        return actual.repairModuleLorebook(...args)
    }
    cleanups.push(() => {
        open()
        repairHook.current = null
    })
    return { open, entered: () => entered }
}

/** A migration that does what the page's does to a list (the entries reach book version 2), and the real module lore getter. */
function faithfulModuleHooks(): void {
    vi.mocked(updateLorebooks).mockImplementation((book) => book.map((entry) => ({ ...entry, bookVersion: 2 })))
    vi.mocked(getModuleLorebooks).mockImplementation(() => moduleListOf(moduleRefIdsOf()).filter((slot) => !isModuleStub(slot)).flatMap((slot) => slot.lorebook ?? []))
}

interface LiveChat {
    id: string
    modules?: string[]
    message: unknown[]
    scriptstate?: Record<string, string>
}

interface LiveCharacter {
    chaId: string
    chatPage: number
    chats: LiveChat[]
}

const liveCharacters = () => (DBState.db as unknown as { characters: LiveCharacter[] }).characters
const modulesOf = (copy: unknown) => (copy as { modules: RisuModule[] }).modules

/** The open chat of character `index` references `ids`; the character becomes the selected one. */
function openChat(index: number, ids: string[], select = true): void {
    const character = liveCharacters()[index]
    character.chats[character.chatPage].modules = ids
    if (select) {
        selectedCharID.set(index)
    }
}

const corruptedB = () => ({ ...moduleBody('b'), lorebook: 'broken' })
const oldVersionB = () => {
    const body = moduleBody('b')
    body.lorebook = (body.lorebook as Obj[]).map((entry) => ({ ...entry, bookVersion: 1 }))
    return body
}
const unitKeyOf = (id: string) => keyOfRef(savedEntry(id).unit)
const digestOf = (prefix: string, id: string) => encoderOrThrow().acknowledged().units.get(`${prefix}${id}#0`)?.digest

function storedLoreOf(id: string): Promise<unknown> {
    return residencyOrThrow().readModule(`${id}#0`).then((read) => read.status === 'ok' ? (read.value as { lorebook?: unknown }).lorebook : read.status)
}

describe('getDatabase copies stubs through one read pass', () => {
    beforeEach(() => {
        faithfulModuleHooks()
        vi.mocked(bumpModuleGui).mockClear()
        vi.mocked(alertError).mockClear()
    })

    test('C3 reproducer: after a get the stub remains, its three digests are set and the plan writes nothing', async () => {
        await bootWithStubs([1])

        const copy = await within(api().getDatabase(['modules']), 'getDatabase')

        expect(modulesOf(copy)[1].lorebook?.[0].content).toBe('text of b')
        expect(liveShape()).toEqual([false, true, false])
        for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
            expect(digestOf(prefix, 'id-b')).toBeDefined()
        }
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })

    test('C4 reproducer: a get, a changed key and a set keep every stub and the save carries all three', async () => {
        await bootWithStubs([0, 1, 2])
        const before = ['id-a', 'id-b', 'id-c'].map(unitKeyOf)

        const copy = await within(api().getDatabase(['modules', 'maxContext']), 'getDatabase') as { modules: RisuModule[] }
        await api().setDatabase({ modules: copy.modules, maxContext: 4321 })
        await commitLive()

        expect(liveShape()).toEqual([true, true, true])
        expect(['id-a', 'id-b', 'id-c'].map(unitKeyOf)).toEqual(before)
    })

    test('C5 reproducer: editing one of three in the copy installs only that module and stores the edit', async () => {
        await bootWithStubs([0, 1, 2])
        const before = ['id-a', 'id-b', 'id-c'].map(unitKeyOf)
        const listBefore = savedEntry('id-b').al

        const copy = await within(api().getDatabase(['modules']), 'getDatabase')
        modulesOf(copy)[1].lorebook![0].content = 'edited by plugin'
        await api().setDatabase(copy)
        await commitLive()

        expect(liveShape()).toEqual([true, false, true])
        expect(unitKeyOf('id-a')).toBe(before[0])
        expect(unitKeyOf('id-c')).toBe(before[2])
        expect(unitKeyOf('id-b')).not.toBe(before[1])
        expect(listBefore).not.toBeNull()
        expect(keyOfRef(savedEntry('id-b').al)).toBe(keyOfRef(listBefore))
        expect(await storedLoreOf('id-b')).toMatchObject([{ content: 'edited by plugin' }])
    })

    test('C6 guard: a copy that lost its retained field keeps the stored value after the save', async () => {
        await bootWithStubs([0, 1, 2])

        const copy = await within(api().getDatabase(['modules']), 'getDatabase')
        delete (modulesOf(copy)[1] as unknown as Record<string, unknown>)[ASSET_RETAINED_KEY]
        modulesOf(copy)[1].description = 'edited by plugin'
        await api().setDatabase(copy)
        await commitLive()

        const read = await residencyOrThrow().readModule('id-b#0')
        expect(read.status === 'ok' ? Reflect.get(read.value, ASSET_RETAINED_KEY) : read.status).toEqual(STORED_RETAINED)
    })

    test('C7 reproducer: a corrupted lorebook between two stubs asks once; the answer is in the copy and the store; the others stay stubs', async () => {
        await bootWithStubs([0, 1, 2], [moduleBody('a'), corruptedB(), moduleBody('c')])
        const questions = holdQuestions([false, true])

        const pending = api().getDatabase(['modules'])
        await turns()
        questions.release()
        const copy = await within(pending, 'getDatabase')

        expect(questions.asked()).toBe(2)
        expect(modulesOf(copy)[1].lorebook).toEqual([])
        expect(liveShape()).toEqual([true, false, true])
        await commitLive()
        expect(await storedLoreOf('id-b')).toEqual([])
    })

    test('C8 guard: two gets and an acquire of the corrupted module share one question; keeping returns the raw value', async () => {
        await bootWithStubs([1], [moduleBody('a'), corruptedB(), moduleBody('c')])
        const questions = holdQuestions([false, false])

        const first = api().getDatabase(['modules'])
        const second = api().getDatabase(['modules'])
        const acquired = acquireModule('id-b')
        await turns()
        questions.release()
        const [one, two, held] = await within(Promise.all([first, second, acquired]), 'the three calls')
        held?.release()

        expect(questions.asked()).toBe(2)
        expect(modulesOf(one)[1].lorebook).toBe('broken')
        expect(modulesOf(two)[1].lorebook).toBe('broken')
    })

    test('C9 reproducer: a lorebook below version 2 is migrated in the copy; the stub stays and nothing is stored', async () => {
        const memory = await bootWithStubs([1], [moduleBody('a'), oldVersionB(), moduleBody('c')])
        const keys = [...memory.snapshot().keys()].sort()

        const copy = await within(api().getDatabase(['modules']), 'getDatabase')

        expect(modulesOf(copy)[1].lorebook?.[0].bookVersion).toBe(2)
        expect(liveShape()).toEqual([false, true, false])
        expect([...memory.snapshot().keys()].sort()).toEqual(keys)
    })

    test('C10 reproducer: after a migrate the list digest is set and the module digest is not; writing back stores the migrated body', async () => {
        await bootWithStubs([1], [moduleBody('a'), oldVersionB(), moduleBody('c')])

        const copy = await within(api().getDatabase(['modules']), 'getDatabase')

        expect(liveShape()).toEqual([false, true, false])
        expect(digestOf(IDENTITY.alModule, 'id-b')).toBeDefined()
        expect(digestOf(IDENTITY.module, 'id-b')).toBeUndefined()
        await api().setDatabase(copy)
        await commitLive()
        expect(await storedLoreOf('id-b')).toMatchObject([{ bookVersion: 2 }])
    })

    test('C12 reproducer: (a) a module deleted during the read leaves the call resolving without it', async () => {
        await bootWithStubs([1])
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        await until(() => spy.calls.length === 1, 'the read')
        liveModules().splice(1, 1)
        spy.openAll()
        const copy = await within(pending, 'getDatabase')

        expect(modulesOf(copy).map((slot) => slot.id)).toEqual(['id-a', 'id-c'])
    })

    test('C12 guard: (b) a stub edited during the read rejects as edited', async () => {
        await bootWithStubs([1])
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        await until(() => spy.calls.length === 1, 'the read')
        liveModules()[1].name = 'renamed'
        spy.openAll()

        await expect(within(pending, 'getDatabase')).rejects.toThrow(/edited/)
    })

    test('C12 guard: (c) a second stub of the id during the read rejects as ambiguous', async () => {
        await bootWithStubs([1])
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        await until(() => spy.calls.length === 1, 'the read')
        liveModules().push({ ...liveModules()[1] })
        spy.openAll()

        await expect(within(pending, 'getDatabase')).rejects.toThrow(/ambiguous/)
    })

    test('C12 reproducer: (d) an entry that moved during the read rejects as stale and its new units get no digest', async () => {
        await bootWithStubs([0, 1])
        const body = await storedCopy('id-a', { hydrate: false }) as RisuModule
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        spy.open('id-a')
        await until(() => spy.calls.includes('id-b#0'), 'the second read')
        body.description = 'moved'
        liveModules()[0] = body
        await commitLive()
        for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
            const unit = encoderOrThrow().acknowledged().units.get(`${prefix}id-a#0`)
            if (unit !== undefined) {
                delete unit.digest
            }
        }
        liveModules()[0] = moduleStubOf(savedEntry('id-a')) as unknown as RisuModule
        spy.openAll()

        await expect(within(pending, 'getDatabase')).rejects.toThrow(/stale/)
        expect(digestOf(IDENTITY.module, 'id-a')).toBeUndefined()
    })

    test('C11 new surface: a slot that became resident during the read and is edited after the last read is copied as the edit', async () => {
        await bootWithStubs([1])
        const resident = await storedCopy('id-b', { hydrate: false })
        const spy = spyReads({ hold: true })
        const residency = residencyOrThrow()
        const hydrate = residency.hydrateModule.bind(residency)
        // The edit lands in the pass's last step for the module, after the read it was held on and before the caller's copy.
        vi.spyOn(residency, 'hydrateModule').mockImplementation((read) => {
            hydrate(read)
            liveModules()[1].description = 'edited after the last read'
        })

        const pending = api().getDatabase(['modules'])
        await until(() => spy.calls.length === 1, 'the read')
        liveModules()[1] = resident
        spy.openAll()
        const copy = await within(pending, 'getDatabase')

        expect(modulesOf(copy)[1].description).toBe('edited after the last read')
        expect(modulesOf(copy)[1].lorebook?.[0].content).toBe('text of b')
    })

    test('C13 reproducer: a resident module of the same id that appears during the read is copied as its own slot and the stub gets the stored body', async () => {
        await bootWithStubs([1])
        const resident = await storedCopy('id-b', { hydrate: false })
        resident.description = 'the resident duplicate'
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        await until(() => spy.calls.length === 1, 'the read')
        liveModules().push(resident)
        spy.openAll()
        const copy = await within(pending, 'getDatabase')

        expect(modulesOf(copy).map((slot) => slot.id)).toEqual(['id-a', 'id-b', 'id-c', 'id-b'])
        expect(modulesOf(copy)[1].description).toBe('about b')
        expect(modulesOf(copy)[1].lorebook?.[0].content).toBe('text of b')
        expect(modulesOf(copy)[3].description).toBe('the resident duplicate')
        expect(liveShape()).toEqual([false, true, false, false])
    })

    test.each(['C11', 'C12 (b)', 'C12 (c)', 'C12 (d)'] as const)('C14 guard: %s while the migration repair is held', async (change) => {
        await bootWithStubs([1], [moduleBody('a'), oldVersionB(), moduleBody('c')])
        const repair = await holdRepair()

        const pending = api().getDatabase(['modules'])
        await until(repair.entered, 'the repair')
        if (change === 'C11') {
            const resident = await storedCopy('id-b', { hydrate: false })
            resident.description = 'edited during the repair'
            liveModules()[1] = resident
        } else if (change === 'C12 (b)') {
            liveModules()[1].name = 'renamed'
        } else if (change === 'C12 (c)') {
            liveModules().push({ ...liveModules()[1] })
        } else {
            const moved = await storedCopy('id-b', { hydrate: false })
            moved.description = 'moved'
            liveModules()[1] = moved
            await commitLive()
            for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
                const unit = encoderOrThrow().acknowledged().units.get(`${prefix}id-b#0`)
                if (unit !== undefined) {
                    delete unit.digest
                }
            }
            liveModules()[1] = moduleStubOf(savedEntry('id-b')) as unknown as RisuModule
        }
        repair.open()

        if (change === 'C11') {
            expect(modulesOf(await within(pending, 'getDatabase'))[1].description).toBe('edited during the repair')
            return
        }
        await expect(within(pending, 'getDatabase')).rejects.toThrow(change === 'C12 (b)' ? /edited/ : change === 'C12 (c)' ? /ambiguous/ : /stale/)
        if (change === 'C12 (d)') {
            expect(digestOf(IDENTITY.module, 'id-b')).toBeUndefined()
        }
    })

    test('C15 guard: three overlapping gets read each stub at most once and never two reads at the same time', async () => {
        await bootWithStubs([0, 1, 2])
        const spy = spyReads({ hold: true })

        const all = [api().getDatabase(['modules']), api().getDatabase(['modules']), api().getDatabase(['modules'])]
        await turns()
        spy.openAll()
        await within(Promise.all(all), 'the three gets')

        expect(spy.calls.length).toBeLessThanOrEqual(3)
        expect(spy.maxInFlight).toBeLessThanOrEqual(1)
    })

    test('C16 guard: a stub enabled after a get is loaded before the lore and the parse see the chat', async () => {
        await bootWithStubs([1])
        openChat(0, [])
        vi.mocked(risuChatParser).mockReturnValue('parsed')
        await within(api().getDatabase(['modules']), 'getDatabase')
        openChat(0, ['id-b'])

        const lore = await within(api().getCurrentLorebookEntries(), 'getCurrentLorebookEntries')
        const parsed = await within(api().parseRisuChat('x'), 'parseRisuChat')

        expect(lore.map((entry) => entry.content)).toContain('text of b')
        expect(parsed).toBe('parsed')
        expect(liveShape()).toEqual([false, false, false])
    })

    test('C18 reproducer: a slot that became resident wins over a read that then fails', async () => {
        const memory = await bootWithStubs([1])
        const key = unitKeyOf('id-b')
        const body = await storedCopy('id-b', { hydrate: false })
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        await until(() => spy.calls.length === 1, 'the read')
        body.description = 'resident edit'
        liveModules()[1] = body
        memory.poke(key, null)
        spy.openAll()
        const copy = await within(pending, 'getDatabase')

        expect(modulesOf(copy)[1].description).toBe('resident edit')
    })

    test('C19 reproducer: a residency replaced during the read rejects as stale', async () => {
        await bootWithStubs([1])
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        await until(() => spy.calls.length === 1, 'the read')
        resetResidencyForTest()
        spy.openAll()

        await expect(within(pending, 'getDatabase')).rejects.toThrow(/stale/)
    })

    test('C19 guard, new surface: a residency replaced during the read by another one that names the same units rejects as stale', async () => {
        await bootWithStubs([1])
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        await until(() => spy.calls.length === 1, 'the read')
        const replacement = { ...residencyOrThrow() }
        registerResidency(replacement)
        expect(getResidency()).toBe(replacement)
        expect(replacement.moduleEntryOf('id-b#0')).not.toBeNull()
        spy.openAll()

        await expect(within(pending, 'getDatabase')).rejects.toThrow(/stale/)
    })

    test('C22 reproducer: a message and a theme change made during the first reads are in the copy and survive its write-back', async () => {
        await bootWithStubs([0, 1, 2])
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase()
        await until(() => spy.calls.length === 1, 'the read')
        const character = liveCharacters()[0]
        const messages = character.chats[character.chatPage].message.length
        character.chats[character.chatPage].message.push({ role: 'user', data: 'added during the wait', time: 1 })
        ;(DBState.db as unknown as { temperature: number }).temperature = 77
        spy.openAll()
        const copy = await within(pending, 'getDatabase') as { characters: LiveCharacter[], temperature: number }
        await api().setDatabase({ maxContext: 4321, temperature: copy.temperature })

        expect(copy.temperature).toBe(77)
        expect(copy.characters[0].chats[character.chatPage].message.length).toBe(messages + 1)
        expect((DBState.db as unknown as { temperature: number }).temperature).toBe(77)
        expect((DBState.db as unknown as { maxContext: number }).maxContext).toBe(4321)
        expect(character.chats[character.chatPage].message.length).toBe(messages + 1)
    })

    test('C23 reproducer: a module loaded and edited while a later read is held keeps the edit through the copy and its write-back', async () => {
        await bootWithStubs([0, 1])
        const body = await storedCopy('id-a', { hydrate: false })
        const spy = spyReads({ hold: true })

        const pending = api().getDatabase(['modules'])
        spy.open('id-a')
        await until(() => spy.calls.includes('id-b#0'), 'the second read')
        body.description = 'edited by the person'
        liveModules()[0] = body
        spy.openAll()
        const copy = await within(pending, 'getDatabase')
        await api().setDatabase({ modules: modulesOf(copy) })

        expect(modulesOf(copy)[0].description).toBe('edited by the person')
        expect(liveModules()[0].description).toBe('edited by the person')
    })

    test('C24 guard, new surface: two plugins reading while a question is open both wait, read each stub once, and resolve after the answer', async () => {
        await bootWithStubs([1, 2], [moduleBody('a'), corruptedB(), moduleBody('c')])
        const spy = spyReads()
        const questions = holdQuestions([false, true])
        const other = makeRisuaiAPIV3({} as HTMLIFrameElement, { ...makePlugin(), name: 'other-plugin' })

        const first = api().getDatabase(['modules'])
        const second = other.getDatabase(['modules'])
        await turns()
        const states = [track(first), track(second)]
        await turns()
        expect(states.map((state) => state.status)).toEqual(['pending', 'pending'])
        questions.release()
        await within(Promise.all([first, second]), 'both gets')

        expect(spy.calls.filter((handle) => handle === 'id-b#0')).toHaveLength(2)
        expect(spy.calls.filter((handle) => handle === 'id-c#0')).toHaveLength(1)
    })

    test('C25 guard, new surface: the copies of two joined gets share nothing with each other or the live list', async () => {
        await bootWithStubs([1])
        const spy = spyReads({ hold: true })

        const first = api().getDatabase(['modules'])
        const second = api().getDatabase(['modules'])
        await turns()
        spy.openAll()
        const [one, two] = await within(Promise.all([first, second]), 'both gets')
        modulesOf(one)[1].lorebook![0].content = 'changed in the first copy'

        expect(modulesOf(two)[1].lorebook![0].content).toBe('text of b')
        expect(isModuleStub(liveModules()[1])).toBe(true)
    })

    test('C26 guard, new surface: (a) a pass that rejects leaves nothing behind; the next get reads again and resolves', async () => {
        const memory = await bootWithStubs([1])
        const key = unitKeyOf('id-b')
        const bytes = memory.snapshot().get(key)

        memory.poke(key, null)
        await expect(within(api().getDatabase(['modules']), 'the failing get')).rejects.toThrow(/damaged/)
        memory.poke(key, bytes ?? null)
        const copy = await within(api().getDatabase(['modules']), 'the next get')

        expect(modulesOf(copy)[1].lorebook?.[0].content).toBe('text of b')
    })

    test('C26 guard, new surface: (b) a pass that fails at its first planned id leaves nothing behind once the duplicate is removed', async () => {
        await bootWithStubs([0, 1])
        const duplicate = await storedCopy('id-a', { hydrate: false })
        liveModules().push(duplicate)

        await expect(within(api().getDatabase(['modules']), 'the failing get')).rejects.toThrow(/id-a/)
        liveModules().pop()
        const copy = await within(api().getDatabase(['modules']), 'the next get')

        expect(modulesOf(copy)[0].lorebook?.[0].content).toBe('text of a')
    })

    test('C27 guard, new surface: two sequential gets read every stub both times', async () => {
        await bootWithStubs([0, 1, 2])
        const spy = spyReads()

        await within(api().getDatabase(['modules']), 'the first get')
        await within(api().getDatabase(['modules']), 'the second get')

        expect(spy.calls).toHaveLength(6)
    })

    test('C31 guard: a read of another key resolves at once while a pass waits on a question', async () => {
        await bootWithStubs([1], [moduleBody('a'), corruptedB(), moduleBody('c')])
        const spy = spyReads()
        const questions = holdQuestions([false, true])

        const pending = api().getDatabase(['modules'])
        await until(() => questions.asked() === 1, 'the question')
        const callsBefore = spy.calls.length
        const other = await within(api().getDatabase(['temperature']), 'getDatabase of another key')
        const callsAfter = spy.calls.length
        questions.release()
        await within(pending, 'the held get')

        expect(Object.keys(other as object)).toEqual(['temperature'])
        expect(callsAfter).toBe(callsBefore)
    })
})

describe('the plugin API waits for the modules of the open chat', () => {
    beforeEach(() => {
        faithfulModuleHooks()
        vi.mocked(alertError).mockClear()
        vi.mocked(risuChatParser).mockReturnValue('parsed')
    })

    test('C20 guard: a resident module and an unreadable stub in the open chat let every call resolve with the resident content and no alert', async () => {
        const memory = await bootWithStubs([1])
        memory.poke(unitKeyOf('id-b'), null)
        openChat(0, ['id-a', 'id-b'])
        const spy = spyReads({ neverAfter: 4 })

        for (let call = 0; call < 2; call++) {
            const lore = await within(api().getCurrentLorebookEntries(), 'getCurrentLorebookEntries')
            expect(lore.map((entry) => entry.content)).toContain('text of a')
            expect(await within(api().parseRisuChat('x'), 'parseRisuChat')).toBe('parsed')
        }

        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(spy.calls.filter((handle) => handle === 'id-b#0').length).toBeLessThanOrEqual(4)
    })

    test('C21 reproducer: both calls wait for the answer about a corrupted referenced module, ask once and never read the unreferenced stub', async () => {
        await bootWithStubs([1, 2], [moduleBody('a'), corruptedB(), moduleBody('c')])
        openChat(0, ['id-b'])
        const spy = spyReads()
        const questions = holdQuestions([false, true])

        const lore = api().getCurrentLorebookEntries()
        const parsed = api().parseRisuChat('x')
        const states = [track(lore), track(parsed)]
        await turns()
        expect(states.map((state) => state.status)).toEqual(['pending', 'pending'])
        questions.release()
        await within(Promise.all([lore, parsed]), 'both calls')

        expect(questions.asked()).toBe(2)
        expect(liveShape()).toEqual([false, false, true])
        expect(liveModules()[1].lorebook).toEqual([])
        expect(spy.calls).not.toContain('id-c#0')
    })

    test('C28 reproducer: (a) a parse whose chat is switched away during the wait rejects and writes nothing', async () => {
        await bootWithStubs([1])
        openChat(0, ['id-b'])
        const spy = spyReads({ hold: true })
        const before = JSON.stringify(liveCharacters().map((character) => character.chats.map((chat) => chat.scriptstate)))

        const pending = api().parseRisuChat('{{setvar::x::1}}', { runVar: true })
        const state = track(pending)
        await started(spy)
        selectedCharID.set(1)
        spy.openAll()
        await expect(within(pending, 'parseRisuChat')).rejects.toThrow(/chat changed/)

        expect(state.status).toBe('rejected')
        expect(vi.mocked(risuChatParser)).not.toHaveBeenCalled()
        expect(JSON.stringify(liveCharacters().map((character) => character.chats.map((chat) => chat.scriptstate)))).toBe(before)
    })

    test('C28 guard: (b) a write that replaces the selected character during the wait does not change the chat', async () => {
        await bootWithStubs([1])
        openChat(0, ['id-b'])
        const spy = spyReads({ hold: true })

        const pending = api().parseRisuChat('x')
        await started(spy)
        const replaced = liveCharacters()[0]
        const edited = JSON.parse(JSON.stringify($state.snapshot(replaced))) as LiveCharacter & { name: string }
        edited.name = 'edited during the wait'
        const characters = liveCharacters().map((character, index) => index === 0 ? edited : JSON.parse(JSON.stringify($state.snapshot(character))))
        await api().setDatabase({ characters })
        expect(liveCharacters()[0]).not.toBe(replaced)
        spy.openAll()

        expect(await within(pending, 'parseRisuChat')).toBe('parsed')
        expect(vi.mocked(risuChatParser)).toHaveBeenCalledTimes(1)
    })

    test('C29 reproducer: a lore call whose chat is switched during the wait answers for the new chat', async () => {
        await bootWithStubs([0, 2])
        openChat(0, ['id-a'], false)
        openChat(1, ['id-c'], false)
        selectedCharID.set(0)
        const spy = spyReads({ hold: true })

        const pending = api().getCurrentLorebookEntries()
        await started(spy)
        selectedCharID.set(1)
        spy.openAll()
        const lore = await within(pending, 'getCurrentLorebookEntries')

        expect(lore.map((entry) => entry.content)).toContain('text of c')
        expect(lore.map((entry) => entry.content)).not.toContain('text of a')
        expect(spy.calls.filter((handle) => handle === 'id-c#0')).toHaveLength(1)
    })

    test('C29 guard, new surface: a lore call whose chat is switched to another chat of the same character during the wait waits for that chat\'s modules', async () => {
        await bootWithStubs([0, 2])
        const character = liveCharacters()[0]
        const first = character.chats[character.chatPage]
        const second = JSON.parse(JSON.stringify($state.snapshot(first))) as LiveChat
        second.id = `${first.id}-second`
        first.modules = ['id-a']
        second.modules = ['id-c']
        character.chats.push(second)
        selectedCharID.set(0)
        const spy = spyReads({ hold: true })

        const pending = api().getCurrentLorebookEntries()
        await started(spy)
        character.chatPage = character.chats.length - 1
        spy.openAll()
        const lore = await within(pending, 'getCurrentLorebookEntries')

        expect(lore.map((entry) => entry.content)).toContain('text of c')
        expect(lore.map((entry) => entry.content)).not.toContain('text of a')
        expect(spy.calls.filter((handle) => handle === 'id-c#0')).toHaveLength(1)
    })

    test('C30 guard, new surface: switching A to B to A during the waits waits for each chat once and answers with the resident lore of A', async () => {
        const memory = await bootWithStubs([1])
        memory.poke(unitKeyOf('id-b'), null)
        openChat(0, ['id-a', 'id-b'], false)
        openChat(1, ['id-b'], false)
        selectedCharID.set(0)
        const spy = spyReads({ hold: true, neverAfter: 2 })

        const pending = api().getCurrentLorebookEntries()
        await until(() => spy.calls.length === 1, 'the first read')
        selectedCharID.set(1)
        spy.step()
        await until(() => spy.calls.length === 2, 'the second read')
        selectedCharID.set(0)
        spy.step()
        const lore = await within(pending, 'getCurrentLorebookEntries')

        expect(lore.map((entry) => entry.content)).toContain('text of a')
        expect(spy.calls).toHaveLength(2)
    })

    describe('the chat a parse continues in is the one the wait resolves', () => {
        async function twinChats(): Promise<ReadSpy> {
            await bootWithStubs([1])
            const character = liveCharacters()[0]
            const first = character.chats[character.chatPage]
            const twin = JSON.parse(JSON.stringify($state.snapshot(first))) as LiveChat
            twin.id = first.id
            character.chats.push(twin)
            first.modules = ['id-b']
            twin.modules = ['id-b']
            selectedCharID.set(0)
            return spyReads({ hold: true })
        }

        test('E5 guard: a duplicated chat id with an unmoved selection parses as on the base', async () => {
            const spy = await twinChats()

            const pending = api().parseRisuChat('x')
            await started(spy)
            spy.openAll()

            expect(await within(pending, 'parseRisuChat')).toBe('parsed')
        })

        test('E5 reproducer: a switch to the twin chat of the same id refuses', async () => {
            const spy = await twinChats()

            const pending = api().parseRisuChat('x')
            await started(spy)
            liveCharacters()[0].chatPage = liveCharacters()[0].chats.length - 1
            spy.openAll()

            await expect(within(pending, 'parseRisuChat')).rejects.toThrow(/chat changed/)
            expect(vi.mocked(risuChatParser)).not.toHaveBeenCalled()
        })

        test('E5 guard: objects replaced by copies with a single holder are not a change', async () => {
            const spy = await twinChats()
            liveCharacters()[0].chats.pop()

            const pending = api().parseRisuChat('x')
            await started(spy)
            const copy = JSON.parse(JSON.stringify($state.snapshot(liveCharacters()[0]))) as LiveCharacter
            liveCharacters()[0] = copy
            spy.openAll()

            expect(await within(pending, 'parseRisuChat')).toBe('parsed')
        })
    })
})

//#endregion

describe('the proof that a written copy is the stored module is made from the read-time print', () => {
    test('W21 reproducer: writing three stored copies over their stubs computes no SHA-256 from the call to the awaited setDatabase', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const update = vi.spyOn(Sha256.prototype, 'update')

        await api().setDatabase({ modules: copies })

        expect(liveShape()).toEqual([true, true, true])
        expect(update).not.toHaveBeenCalled()
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })

    test('W22 guard: a same-length edit of one stub installs that module, saves the edit, and keeps the others stubs', async () => {
        await bootWithStubs([0, 1, 2])
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        b.lorebook![0].content = 'text of x'

        await api().setDatabase({ modules: [a, b, c] })

        expect(liveShape()).toEqual([true, false, true])
        await commitLive()
        const saved = await residencyOrThrow().readModule('id-b#0')
        expect(saved.status === 'ok' && (saved.value as unknown as RisuModule).lorebook?.[0].content).toBe('text of x')
    })

    test('RS4 guard, new surface: a copy of a unit that has moved installs, and a copy of the new unit keeps the stub', async () => {
        await bootWithStubs([0, 2])
        const [a, , c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        const old = await storedCopy('id-b')
        const oldKey = keyOfRef(savedEntry('id-b').unit)
        liveModules()[1].description = 'edited and saved'
        await commitLive()
        expect(keyOfRef(savedEntry('id-b').unit)).not.toBe(oldKey)
        liveModules()[1] = moduleStubOf(savedEntry('id-b')) as unknown as RisuModule

        await api().setDatabase({ modules: [a, old, c] })

        expect(liveShape()).toEqual([true, false, true])

        liveModules()[1] = moduleStubOf(savedEntry('id-b')) as unknown as RisuModule
        const current = await storedCopy('id-b')
        await api().setDatabase({ modules: [a, current, c] })

        expect(liveShape()).toEqual([true, true, true])
    })
})

describe('the plugin write keeps the page responsive and settles at once where it has nothing to prove', () => {
    const marker = () => (DBState.db as unknown as { pluginCustomStorage?: Record<string, unknown> }).pluginCustomStorage?.zzMarker

    test('T1 reproducer: no encode runs in the microtask chain of a write over three stored copies, and all stubs are kept after it', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const p3 = api()
        // The first write of an instance pays the permission lookups; they are not what is measured.
        await p3.setDatabase({ zzWarm: 'x' })
        const encode = vi.spyOn(TextEncoder.prototype, 'encode')

        const pending = p3.setDatabase({ modules: copies })
        for (let i = 0; i < 100; i++) {
            await Promise.resolve()
        }

        expect(encode).not.toHaveBeenCalled()
        await pending
        expect(liveShape()).toEqual([true, true, true])
        expect(moduleUnitsWritten(await planLive())).toEqual([])
    })

    test('T6 reproducer: an unchanged copy of a module with a recorded retained value is proved without cloning that value', async () => {
        await bootWithStubs([0, 1, 2])
        await noteStored('id-b')
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const clone = vi.spyOn(globalThis, 'structuredClone')

        await api().setDatabase({ modules: copies })

        expect(clone.mock.calls.filter(([value]) => JSON.stringify(value) === JSON.stringify(STORED_RETAINED))).toEqual([])
        expect(liveShape()).toEqual([true, true, true])
    })

    test('L1 guard: a Lite write with no modules and nothing queued lands before it returns', async () => {
        await bootWithStubs([0, 1, 2])

        const result = getV2PluginAPIs().setDatabaseLite({ zzMarker: 'x' }, PLUGIN_NAME)

        expect(result).toBeUndefined()
        expect(marker()).toBe('x')
    })

    test('L2 guard: a Lite write right after a landed proved write still lands before it returns', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        await api().setDatabase({ modules: copies })

        const result = getV2PluginAPIs().setDatabaseLite({ zzMarker: 'y' }, PLUGIN_NAME)

        expect(result).toBeUndefined()
        expect(marker()).toBe('y')
    })
})

//#region the write turns and the proof slices, through the test seam

type TurnsModule = typeof import('../../pluginWriteTurns')
type StubWriteModule = typeof import('../../moduleStubWrite')

describe('the proof is cut into slices and lands against the state it was proved against', () => {
    let turnsModule: TurnsModule
    let stubWrite: StubWriteModule
    let heldStep: (() => void) | null = null

    beforeEach(async () => {
        turnsModule = await import('../../pluginWriteTurns')
        stubWrite = await import('../../moduleStubWrite')
    })

    // A held step is released first and the page is let to finish, so the reset never lands under a write in flight.
    afterEach(async () => {
        heldStep?.()
        heldStep = null
        await turns(10)
        turnsModule.resetPluginWriteTurnsForTest()
        turnsModule.setPluginWriteYieldForTest(null)
    })

    const marker = () => (DBState.db as unknown as { pluginCustomStorage?: Record<string, unknown> }).pluginCustomStorage?.zzMarker
    const spyEncode = () => vi.spyOn(TextEncoder.prototype, 'encode')
    type EncodeSpy = ReturnType<typeof spyEncode>
    const TWENTY = Array.from({ length: 20 }, (_, i) => i)
    const twentyBodies = () => TWENTY.map((i) => moduleBody(`m${i}`))
    const twentyIds = TWENTY.map((i) => `id-m${i}`)
    const bootTwenty = () => bootWithStubs(TWENTY, twentyBodies())

    interface YieldRig {
        calls: number
        encodesAt: number[]
        release: () => void
    }

    /** Counts the yields of the plugin write with the encodes seen at each, and holds the `holdAt`-th until released. */
    function installYieldRig(encode: EncodeSpy, options: { holdAt?: number, skip?: () => boolean } = {}): YieldRig {
        const rig: YieldRig = { calls: 0, encodesAt: [], release: () => {} }
        turnsModule.setPluginWriteYieldForTest({
            yieldFn: async () => {
                rig.calls += 1
                rig.encodesAt.push(encode.mock.calls.length)
                if (rig.calls === options.holdAt) {
                    await new Promise<void>((resolve) => {
                        heldStep = resolve
                        rig.release = () => {
                            heldStep = null
                            resolve()
                        }
                    })
                    return
                }
                await turn()
            },
            skip: options.skip ?? (() => false),
        })
        return rig
    }

    const isHeld = () => heldStep !== null

    function moduleUnit(id: string) {
        const unit = encoderOrThrow().acknowledged().units.get(`${IDENTITY.module}${id}#0`)
        if (unit === undefined) {
            throw new Error(`No acknowledged unit for ${id}.`)
        }
        return unit
    }

    /**
     * Writes the stored copies of 20 stubs with the third yield held, which is after the first slice proved `id-m1`, runs
     * `change` while it is held, releases it and returns the settled write.
     */
    async function writeHeldAfterFirstSlice(change: () => Promise<void> | void, extra: Record<string, unknown> = {}): Promise<void> {
        await bootTwenty()
        const copies = await storedCopies(twentyIds)
        const encode = spyEncode()
        const rig = installYieldRig(encode, { holdAt: 2 })
        const pending = api().setDatabase({ modules: copies, ...extra })
        await until(isHeld, 'the held yield')
        await change()
        rig.release()
        await pending
    }

    function keptStubs(): number[] {
        return liveShape().flatMap((stub, index) => stub ? [index] : [])
    }

    test('T2 guard, new surface: 20 stubs are proved in slices of at most 8 encodes, none before the first yield, and all are kept', async () => {
        await bootTwenty()
        const copies = await storedCopies(twentyIds)
        const writer = api()
        await writer.setDatabase({ zzWarm: 'x' })
        const encode = spyEncode()
        const rig = installYieldRig(encode)

        await writer.setDatabase({ modules: copies })

        expect(rig.encodesAt[0]).toBe(0)
        const between = rig.encodesAt.map((count, i) => (rig.encodesAt[i + 1] ?? encode.mock.calls.length) - count)
        expect(Math.max(...between)).toBeLessThanOrEqual(8)
        expect(encode.mock.calls.length).toBe(20)
        expect(keptStubs()).toEqual(TWENTY)
    })

    test('R1a guard, new surface: a unit digest that changes while the write waits makes that module install', async () => {
        await writeHeldAfterFirstSlice(() => { moduleUnit('id-m1').digest = 'changed-digest' })

        expect(liveShape()[1]).toBe(false)
        expect(keptStubs()).toEqual(TWENTY.filter((i) => i !== 1))
        await expect(commitLive()).resolves.toBeUndefined()
    })

    test('R1b guard, new surface: a unit key that changes while the write waits makes that module install', async () => {
        await writeHeldAfterFirstSlice(() => { moduleUnit('id-m1').key = 'changed-key' })

        expect(liveShape()[1]).toBe(false)
        expect(keptStubs()).toEqual(TWENTY.filter((i) => i !== 1))
    })

    test('R1c guard, new surface: a module loaded, edited, saved and stubbed again while the write waits installs the plugin copy', async () => {
        await writeHeldAfterFirstSlice(async () => {
            liveModules()[1] = await storedCopy('id-m1')
            liveModules()[1].description = 'edited and saved'
            await commitLive()
            liveModules()[1] = moduleStubOf(savedEntry('id-m1')) as unknown as RisuModule
        })

        expect(liveShape()[1]).toBe(false)
        await commitLive()
        const read = await residencyOrThrow().readModule('id-m1#0')
        expect(read.status === 'ok' && (read.value as unknown as RisuModule).description).toBe('about m1')
    })

    test('R2 guard, new surface: a module that becomes resident while the write waits holds the plugin copy, never a stub', async () => {
        await writeHeldAfterFirstSlice(async () => { liveModules()[1] = await storedCopy('id-m1') })

        expect(liveShape()[1]).toBe(false)
        expect(liveModules()[1].name).toBe('m1')
        expect(keptStubs()).toEqual(TWENTY.filter((i) => i !== 1))
    })

    test('R3 guard, new surface: a live slot replaced by an equal fresh stub while the write waits makes that module install', async () => {
        await writeHeldAfterFirstSlice(() => { liveModules()[1] = moduleStubOf(savedEntry('id-m1')) as unknown as RisuModule })

        expect(liveShape()[1]).toBe(false)
        expect(keptStubs()).toEqual(TWENTY.filter((i) => i !== 1))
    })

    test('R4 guard, new surface: two proved modules whose live slots swap while the write waits install, and the rest stay stubs', async () => {
        await writeHeldAfterFirstSlice(() => {
            const live = liveModules()
            const first = live[0]
            live[0] = live[1]
            live[1] = first
        })

        expect(liveShape().slice(0, 2)).toEqual([false, false])
        expect(keptStubs()).toEqual(TWENTY.slice(2))
        await expect(commitLive()).resolves.toBeUndefined()
    })

    test('R5 guard, new surface: a different residency registered while the write waits makes every verdict void, so all modules install and the write resolves', async () => {
        // A copy of the residency answers every question as the first does and is another object, as a re-booted page's is.
        await writeHeldAfterFirstSlice(() => { registerResidency({ ...residencyOrThrow() }) })

        expect(keptStubs()).toEqual([])
        expect(liveModules()).toHaveLength(20)
    })

    test('R6 guard (passes before and after): a copy of the unit a stub had before it moved installs, a copy of the current unit keeps the stub', async () => {
        await bootWithStubs([0, 2])
        await noteStored('id-b')
        const [a, , c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        liveModules()[1].description = 'edited and saved'
        await commitLive()
        liveModules()[1] = moduleStubOf(savedEntry('id-b')) as unknown as RisuModule
        const current = await storedCopy('id-b')

        await api().setDatabase({ modules: [a, current, c] })

        expect(liveShape()).toEqual([true, true, true])
    })

    test('R13 guard, new surface: a live list that gains a second holder of the id before its stub while the write waits installs that module', async () => {
        await writeHeldAfterFirstSlice(async () => { liveModules()[0] = await storedCopy('id-m1') })

        expect(liveShape()[1]).toBe(false)
        expect(keptStubs()).toEqual(TWENTY.filter((i) => i > 1))
    })

    test('R7 guard, new surface: a second plugin write that arrives while the first waits lands after it', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const rig = installYieldRig(spyEncode(), { holdAt: 1 })
        const settled: string[] = []
        const first = api().setDatabase({ modules: copies, zzMarker: 'first' }).then(() => { settled.push('first') })
        await until(isHeld, 'the held yield')

        const second = makeRisuaiAPIV3({} as HTMLIFrameElement, { ...makePlugin(), name: 'other-plugin' }).setDatabase({ zzMarker: 'second' }).then(() => { settled.push('second') })
        await turns(10)
        expect(marker()).not.toBe('second')
        rig.release()
        await Promise.all([first, second])

        expect(marker()).toBe('second')
        expect(settled).toEqual(['first', 'second'])
    })

    test('R7-Lite guard, new surface: a Lite write that arrives while a write waits queues behind it and returns a promise', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const rig = installYieldRig(spyEncode(), { holdAt: 1 })
        const first = api().setDatabase({ modules: copies, zzMarker: 'first' })
        await until(isHeld, 'the held yield')

        const second = getV2PluginAPIs().setDatabaseLite({ zzMarker: 'second' }, 'other-plugin')

        expect(second).toBeInstanceOf(Promise)
        expect(marker()).not.toBe('second')
        rig.release()
        await Promise.all([first, second])
        expect(marker()).toBe('second')
    })

    test('R12 guard, new surface: the landing of the plugin is open from the arrival task until the write lands', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const rig = installYieldRig(spyEncode(), { holdAt: 1 })
        const pending = api().setDatabase({ modules: copies })
        await until(isHeld, 'the held yield')
        for (let i = 0; i < 100; i++) {
            await Promise.resolve()
        }

        const landing = turnsModule.pluginWriteLanding(PLUGIN_NAME)
        expect(landing).not.toBeNull()
        expect(track(landing).status).toBe('pending')
        expect(turnsModule.pluginWriteLanding('other')).toBeNull()
        rig.release()
        await pending
        await turns(3)
        expect(turnsModule.pluginWriteLanding(PLUGIN_NAME)).toBeNull()
    })

    test('R10 guard, new surface: a write refused after its wait writes nothing and does not stop the next write', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const rig = installYieldRig(spyEncode(), { holdAt: 1 })
        const payload: Record<string, unknown> = { modules: copies, zzMarker: 'refused' }
        const pending = api().setDatabase(payload)
        const outcome = track(pending)
        await until(isHeld, 'the held yield')
        payload.modules = 'broken'
        rig.release()
        await turns(5)

        expect(outcome.status).toBe('rejected')
        expect(marker()).not.toBe('refused')
        await within(api().setDatabase({ zzMarker: 'next' }), 'the next write', 600)
        expect(marker()).toBe('next')
    })

    test('R11 guard, new surface: on a hidden page the write posts no yield and keeps every stub', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const rig = installYieldRig(spyEncode(), { skip: () => true })

        await api().setDatabase({ modules: copies })

        expect(rig.calls).toBe(0)
        expect(liveShape()).toEqual([true, true, true])
    })

    test('R11b guard, new surface: a page that hides during the write posts no further yield and the rest is proved in one run', async () => {
        await bootTwenty()
        const copies = await storedCopies(twentyIds)
        const writer = api()
        await writer.setDatabase({ zzWarm: 'x' })
        const encode = spyEncode()
        let hidden = false
        let calls = 0
        turnsModule.setPluginWriteYieldForTest({
            yieldFn: async () => {
                calls += 1
                await turn()
                hidden = true
            },
            skip: () => hidden,
        })

        await writer.setDatabase({ modules: copies })

        expect(calls).toBe(1)
        expect(encode.mock.calls.length).toBe(20)
        expect(keptStubs()).toEqual(TWENTY)
    })

    test('R9 diagnostic of the stated semantics: a write lands over what the page set while it waited', async () => {
        await bootWithStubs([0, 1, 2])
        const copies = await storedCopies(['id-a', 'id-b', 'id-c'])
        const rig = installYieldRig(spyEncode(), { holdAt: 1 })
        const pending = api().setDatabase({ modules: copies, zzMarker: 'plugin' })
        await until(isHeld, 'the held yield')
        const db = DBState.db as unknown as { pluginCustomStorage?: Record<string, unknown> }
        db.pluginCustomStorage = { ...(db.pluginCustomStorage ?? {}), zzMarker: 'page' }
        rig.release()
        await pending

        expect(marker()).toBe('plugin')
    })

    test('U1 guard, new surface: the count cap cuts 20 proofs into slices of 8, 8 and 4 with a yield before each', async () => {
        await bootTwenty()
        const copies = await storedCopies(twentyIds)
        const encode = spyEncode()
        const rig = installYieldRig(encode)

        const verdicts = await stubWrite.proveRecordedStubCopies(liveModules(), copies, { now: () => 0, budgetMs: 12, maxPerSlice: 8 })

        expect(rig.encodesAt).toEqual([0, 8, 16])
        expect(verdicts.byModule.size).toBe(20)
    })

    test('U2 guard, new surface: a proof that ends a budget after its slice began ends the slice, so every proof is followed by a yield', async () => {
        await bootTwenty()
        const copies = await storedCopies(twentyIds)
        const encode = spyEncode()
        const rig = installYieldRig(encode)

        const verdicts = await stubWrite.proveRecordedStubCopies(liveModules(), copies, { now: () => encode.mock.calls.length * 12, budgetMs: 12, maxPerSlice: 8 })

        expect(rig.encodesAt).toEqual(TWENTY)
        expect(verdicts.byModule.size).toBe(20)
    })

    test('U3 guard, new surface: an edited copy and a BigInt copy get no verdict and nothing throws; the candidate predicate follows the same cases', async () => {
        await bootWithStubs([0, 1, 2])
        const [a, b, c] = await storedCopies(['id-a', 'id-b', 'id-c'])
        const edited = structuredClone(b)
        edited.lorebook![0].content = 'text of x'
        const big = { ...structuredClone(c), big: 10n } as unknown as RisuModule
        installYieldRig(spyEncode())
        const live = liveModules()

        const verdicts = await stubWrite.proveRecordedStubCopies(live, [a, edited, big])

        expect([...verdicts.byModule.keys()]).toEqual([a])
        expect(stubWrite.hasRecordedStubCandidate(live, [a, b, c])).toBe(true)
        expect(stubWrite.hasRecordedStubCandidate(live, live)).toBe(false)
        expect(stubWrite.hasRecordedStubCandidate(live, 'not a list')).toBe(false)
        expect(stubWrite.hasRecordedStubCandidate(live, [b, structuredClone(b)])).toBe(false)
        expect(stubWrite.hasRecordedStubCandidate([a, b, c], [a, b, c])).toBe(false)
        expect(stubWrite.hasRecordedStubCandidate([], [a, b, c])).toBe(false)
    })
})

//#endregion
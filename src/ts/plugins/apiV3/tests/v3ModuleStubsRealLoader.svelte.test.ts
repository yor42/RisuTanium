/**
 * The V3 host API's `getDatabase` and `setDatabase` over module stubs on the real module loader: the page is booted
 * through the real dispatch over a memory backend (which registers the residency and the loader), a chosen module is turned
 * into its recorded stub, and the plugin reads and writes `modules` through `makeRisuaiAPIV3`. The sibling file with
 * a fake loader pins the plugin-side rules; what only a real load shows is that the copy a plugin gets holds the stored
 * body while the live slot stays the stub, and a plugin's edit of the copy installs in its slot when written back.
 * Labels: reproducer (fails when the named mutant is applied: the loader leaves the stub in the slot), guard (passes
 * before and after).
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

vi.mock(import('../../../gui/colorscheme'), () => ({
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

vi.mock(import('../../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../../model/types'))

vi.mock(import('../../../process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('../../../process/index.svelte'))

vi.mock(import('../../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../../process/scripts'))

vi.mock(import('../../../model/modellist'), () => ({
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

//#endregion

import { makeRisuaiAPIV3 } from '../v3.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { alertConfirm } from '../../../alert'
import { updateLorebooks } from '../../../characters'
import { bumpModuleGui, getModuleLorebooks } from '../../../process/modules'
import { moduleListOf, moduleRefIdsOf } from '../../../process/moduleRefList'
// Registers the displayed origin's real reference read with the loader, as the page's import does.
import '../../../process/moduleEnsure'
import type { RisuPlugin } from '../../plugins.svelte'
import type { Database } from '../../../storage/database.svelte'
import type { RisuModule } from '../../../process/modules'
import { isModuleStub } from '../../../storage/moduleStub'
import { resetPageStorageModeForTests } from '../../../storage/pageStorageMode'
import { createMemoryBackend, type MemoryBackend } from '../../../storage/store2/backend'
import { resetStore2BootForTest } from '../../../storage/store2/bootActive'
import { IDENTITY, moduleHandles } from '../../../storage/store2/codec'
import { keyOfRef } from '../../../storage/store2/format'
import { unregisterModuleLoader } from '../../../storage/store2/moduleAcquire'
import { moduleStubOf } from '../../../storage/store2/moduleStubMatch'
import { getResidency, resetResidencyForTest } from '../../../storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from '../../../storage/store2/saveActive'
import { bootThroughDispatch, createClock, seedTree, testEnv } from '../../../storage/tests/store2SaveKit'
import { buildSmall, fakeLists, type Obj } from '../../../storage/tests/store2/codecFixtures'

const PLUGIN_NAME = 'real-loader-plugin'

function makePlugin(): RisuPlugin {
    return { name: PLUGIN_NAME, script: 'real-loader-script', arguments: {}, realArg: {}, customLink: [], argMeta: {} }
}

function moduleBody(name: string): Obj {
    return {
        id: `id-${name}`, name, description: `about ${name}`, regex: [], trigger: [], assets: [],
        lorebook: [{ comment: 'c', content: `text of ${name}`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 2 }],
    }
}

interface World {
    memory: MemoryBackend
    /** The key of the stored unit of the stubbed module. */
    unitKey: string
}

/** Races a promise against a real timer, so a call that never settles fails the case instead of hanging the file. */
function within<T>(promise: Promise<T>, label: string, ms = 1500): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms.`)), ms) })
    return Promise.race([promise, bound]).finally(() => clearTimeout(timer))
}

const api = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())
const liveModules = () => (DBState.db as unknown as { modules: RisuModule[] }).modules
const modulesOf = (copy: unknown) => (copy as { modules: RisuModule[] }).modules

/** Boots a tree of three modules and turns the second into its recorded stub; the database becomes the live one. */
async function bootWithStub(): Promise<World> {
    return bootWithStubs([1])
}

/** Boots a tree of three modules and turns each index of `stubbed` into its recorded stub; the world names the first one's unit. */
async function bootWithStubs(stubbed: number[], modules: Obj[] = [moduleBody('a'), moduleBody('b'), moduleBody('c')]): Promise<World> {
    const memory = createMemoryBackend()
    const source = { ...(buildSmall(2) as unknown as Obj), archiveCharacters: false, modules } as unknown as Database
    await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), fakeLists)
    const booted = await bootThroughDispatch(memory)
    if (booted.result.kind !== 'store2') {
        throw new Error(`The boot answered ${booted.result.kind}.`)
    }
    const context = getActiveStore2Save()
    const residency = getResidency()
    const index = context?.encoder?.acknowledged().objects?.moduleIndex
    if (context?.encoder === undefined || residency === null || index === undefined) {
        throw new Error('The boot registered no residency.')
    }
    const database = booted.result.database as unknown as { modules: unknown[], enabledModules: string[], plugins: unknown[] }
    let unitKey = ''
    for (const at of stubbed) {
        const handle = moduleHandles(index.entries)[at]
        const entry = residency.moduleEntryOf(handle)
        if (entry === null) {
            throw new Error('No entry for the module.')
        }
        for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
            const unit = context.encoder.acknowledged().units.get(`${prefix}${handle}`)
            if (unit !== undefined) {
                delete unit.digest
            }
        }
        database.modules[at] = moduleStubOf(entry)
        unitKey ||= keyOfRef(entry.unit)
    }
    database.enabledModules = []
    database.plugins = [{ name: PLUGIN_NAME, script: '' }]
    DBState.db = database as unknown as Database
    return { memory, unitKey }
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    unregisterModuleLoader()
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageStorageModeForTests()
    DBState.db = { characters: [], modules: [], enabledModules: [] } as unknown as Database
})

describe('a plugin reads and writes modules through the real loader', () => {
    test('C1 reproducer: getDatabase gives the stored body of a stub in the copy, and the live slot stays the stub', async () => {
        await bootWithStub()
        expect(isModuleStub(liveModules()[1])).toBe(true)

        const copy = await within(api().getDatabase(['modules']), 'getDatabase')

        expect(modulesOf(copy).map((slot) => isModuleStub(slot))).toEqual([false, false, false])
        expect(modulesOf(copy)[1].name).toBe('b')
        expect(modulesOf(copy)[1].lorebook?.[0].content).toBe('text of b')
        expect(isModuleStub(liveModules()[1])).toBe(true)
    })

    test('reproducer: plugin-getDatabase-default-read-returns-every-module', async () => {
        await bootWithStub()
        expect(isModuleStub(liveModules()[1])).toBe(true)

        const copy = await within(api().getDatabase(), 'getDatabase')

        expect(modulesOf(copy).map((slot) => isModuleStub(slot))).toEqual([false, false, false])
        expect(modulesOf(copy)[1].lorebook?.[0].content).toBe('text of b')
        expect(isModuleStub(liveModules()[1])).toBe(true)
    })

    test('C17 guard: a default read with one damaged unit rejects naming the module and the slot stays the stub', async () => {
        const world = await bootWithStub()
        world.memory.poke(world.unitKey, null)

        const result = within(api().getDatabase(), 'getDatabase')

        await expect(result).rejects.toThrow(/"b" \(id-b\)/)
        await expect(result).rejects.toThrow(/damaged/)
        expect(isModuleStub(liveModules()[1])).toBe(true)
    })

    test('a plugin edit of the copy written back installs the edited module in its live slot', async () => {
        await bootWithStub()
        const copy = await within(api().getDatabase(['modules']), 'getDatabase')
        modulesOf(copy)[1].lorebook![0].content = 'edited by plugin'

        await api().setDatabase(copy)

        expect(isModuleStub(liveModules()[1])).toBe(false)
        expect(liveModules()[1].lorebook?.[0].content).toBe('edited by plugin')
        expect(liveModules()[0].lorebook?.[0].content).toBe('text of a')
        expect(liveModules()[2].lorebook?.[0].content).toBe('text of c')
    })

    test('C17 guard: a stored unit that is damaged rejects naming the module and the loader\'s reason, and the slot stays the stub', async () => {
        const world = await bootWithStub()
        world.memory.poke(world.unitKey, null)

        const result = within(api().getDatabase(['modules']), 'getDatabase')

        await expect(result).rejects.toThrow(/"b" \(id-b\)/)
        await expect(result).rejects.toThrow(/damaged/)
        expect(isModuleStub(liveModules()[1])).toBe(true)
    })
})

describe('getDatabase reloads the chat only for modules the chat references', () => {
    type Live = { characters: { chatPage: number, chats: { modules?: string[] }[] }[] }

    test('C2 reproducer: a library-wide read installs nothing, so the GUI is not bumped and every slot stays a stub', async () => {
        await bootWithStubs([0, 1, 2])
        const live = DBState.db as unknown as Live
        live.characters[0].chats[live.characters[0].chatPage].modules = ['id-b']
        selectedCharID.set(0)
        vi.mocked(bumpModuleGui).mockClear()
        try {
            const copy = await within(api().getDatabase(['modules']), 'getDatabase')

            expect(modulesOf(copy).map((slot) => isModuleStub(slot))).toEqual([false, false, false])
            expect(vi.mocked(bumpModuleGui)).not.toHaveBeenCalled()
            expect(liveModules().map((slot) => isModuleStub(slot))).toEqual([true, true, true])
        } finally {
            selectedCharID.set(-1)
        }
    })

    describe.each([
        ['referenced', ['id-b'], 1],
        ['unreferenced', [], 0],
    ] as const)('an ask stub that is %s by the displayed chat', (_label, referenced, bumps) => {
        beforeEach(() => {
            vi.mocked(updateLorebooks).mockImplementation((book) => book.map((entry) => ({ ...entry, bookVersion: 2 })))
            vi.mocked(getModuleLorebooks).mockImplementation(() => moduleListOf(moduleRefIdsOf()).filter((slot) => !isModuleStub(slot)).flatMap((slot) => slot.lorebook ?? []))
        })

        afterEach(() => {
            selectedCharID.set(-1)
            vi.mocked(alertConfirm).mockImplementation(async () => true)
            vi.mocked(updateLorebooks).mockImplementation((book) => book)
            vi.mocked(getModuleLorebooks).mockReset()
        })

        test(`MC-3594 reproducer: a read that asks and installs it bumps the module GUI ${bumps === 1 ? 'once' : 'never'}`, async () => {
            await bootWithStubs([0, 1, 2], [moduleBody('a'), { ...moduleBody('b'), lorebook: 'broken' }, moduleBody('c')])
            const live = DBState.db as unknown as Live
            live.characters[0].chats[live.characters[0].chatPage].modules = [...referenced]
            selectedCharID.set(0)
            vi.mocked(bumpModuleGui).mockClear()

            const copy = await within(api().getDatabase(['modules']), 'getDatabase')

            expect(modulesOf(copy)[1].lorebook).toEqual([])
            expect(liveModules().map((slot) => isModuleStub(slot))).toEqual([true, false, true])
            expect(vi.mocked(bumpModuleGui)).toHaveBeenCalledTimes(bumps)
        })
    })

    test('a read over stubs nothing displayed references sets no GUI pointer', async () => {
        await bootWithStubs([0, 1, 2])
        vi.mocked(bumpModuleGui).mockClear()

        const copy = await within(api().getDatabase(['modules']), 'getDatabase')

        expect(modulesOf(copy).map((slot) => isModuleStub(slot))).toEqual([false, false, false])
        expect(liveModules().map((slot) => isModuleStub(slot))).toEqual([true, true, true])
        expect(vi.mocked(bumpModuleGui)).not.toHaveBeenCalled()
    })
})

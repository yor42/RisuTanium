/**
 * Plugin access to modules while module stubs (stand-ins for modules whose body
 * is not resident) can sit in the module list: `getDatabase` of the V3 host API
 * (`v3.svelte.ts`) hands out full modules, and the plugin setters
 * (`writeSetterKeys` in `plugins.svelte.ts`, guarded by `moduleStubGuard.ts`)
 * refuse a stub as a replacement for a module. The loader is a test double that
 * installs a body into the stub's slot.
 *
 * Titles beginning "guard:" pin behaviour that may pass before and after the
 * change; every other test is a regression reproducer for the behaviour it names.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const acquireCount = vi.hoisted(() => ({ acquired: 0, released: 0 }))
const readColdStorageItemMock = vi.hoisted(() => vi.fn())
/** Every text shown to the user, except progress notices. */
const notices = vi.hoisted(() => ({ texts: [] as string[] }))

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                // A stored recent 'db' grant keeps the character and database APIs
                // from prompting; every other key is absent.
                if (options?.name === 'plugin_permissions') {
                    if (key.endsWith('_db_lastGrantTime')) return Date.now()
                    if (key.endsWith('_db')) return true
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

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../../stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../../storage/database.svelte')
})

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
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        hotReloading: writable(false),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../../stores.svelte')
})

vi.mock(import('../../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => {
    const show = (msg: string | Error) => { notices.texts.push(msg instanceof Error ? msg.message : String(msg)) }
    return {
        alertConfirm: alertConfirmMock,
        alertPluginConfirm: alertConfirmMock,
        alertError: vi.fn(show),
        alertErrorWait: vi.fn(async (msg: string) => { show(msg) }),
        alertNormal: vi.fn(show),
        alertNormalWait: vi.fn(async (msg: string) => { show(msg) }),
        alertMd: vi.fn(show),
        alertToast: vi.fn(show),
        alertWait: vi.fn(() => ({})),
        alertClear: vi.fn(),
        waitAlert: vi.fn(async () => {}),
    } as unknown as typeof import('../../../alert')
})

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
}) as unknown as typeof import('../../../platform'))

vi.mock(import('../../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../../process/mcp/pluginmcp'))

vi.mock(import('../../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: hasherMock,
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

vi.mock(import('../../../process/modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../../process/modules'))

vi.mock(import('../../../storage/store2/moduleAcquire'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        acquireModule: async (id: string, signal?: AbortSignal) => {
            const acquired = await actual.acquireModule(id, signal)
            if (acquired === null) {
                return null
            }
            acquireCount.acquired++
            return { module: acquired.module, release: () => { acquireCount.released++; acquired.release() } }
        },
    } as typeof actual
})

vi.mock(import('../../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../../process/ttsHooks'))

//#endregion

import { makeRisuaiAPIV3 } from '../v3.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE, isModuleStub } from '../../../storage/moduleStub'
import { registerModuleLoader, unregisterModuleLoader } from '../../../storage/store2/moduleAcquire'
import { allowedDbKeys } from '../../plugins.svelte'
import type { RisuModule } from '../../../process/modules'

//#region fixtures

const PLUGIN_NAME = 'module-stub-plugin'

function makePlugin(): RisuPlugin {
    return { name: PLUGIN_NAME, script: 'module-stub-script', arguments: {}, realArg: {}, customLink: [], argMeta: {} }
}

function lore(comment: string, content: string) {
    return { comment, content, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' as const }
}

function fullModule(id: string, name = `${id} name`): RisuModule {
    return { id, name, description: `${id} description`, lorebook: [lore(`${id} lore`, `${id} content`)], regex: [], trigger: [] }
}

/** The index fields plus the marker, and none of the body arrays. */
function stubModule(id: string, name = `${id} name`): RisuModule {
    return {
        id, name, description: `${id} description`, hasToggle: false, dsp: false, unit: [`unit-${id}`], al: [], il: [],
        [MODULE_STUB_KEY]: MODULE_STUB_VALUE,
    } as unknown as RisuModule
}

const loads: string[] = []
const bodies = new Map<string, RisuModule>()
const returnedSlots: RisuModule[] = []

/** Installs the body for the stub of the handle's id into the slot and returns the slot read back. */
function installLoader(failFor: string[] = []): void {
    registerModuleLoader(async (handle) => {
        loads.push(handle)
        const id = handle.slice(0, handle.lastIndexOf('#'))
        if (failFor.includes(id)) {
            throw new Error(`unit for ${id} unreadable`)
        }
        const index = DBState.db.modules.findIndex((m: RisuModule) => m.id === id)
        DBState.db.modules[index] = structuredClone(bodies.get(id) ?? fullModule(id))
        returnedSlots.push(DBState.db.modules[index])
        return DBState.db.modules[index]
    })
}

function installDb(modules: RisuModule[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules,
        loadouts: [],
        plugins: [{ name: PLUGIN_NAME, script: '' }],
        pluginCustomStorage: {},
        characterOrder: [],
        characters: [],
    } as unknown as Database
}

const liveModules = () => DBState.db.modules as RisuModule[]
const api = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())
const modulesOf = (copy: unknown) => (copy as { modules: RisuModule[] }).modules

let warnSpy: MockInstance<typeof console.warn>

beforeEach(() => {
    loads.length = 0
    returnedSlots.length = 0
    bodies.clear()
    acquireCount.acquired = 0
    acquireCount.released = 0
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    selectedCharID.set(-1)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    unregisterModuleLoader()
    vi.restoreAllMocks()
})

//#endregion

describe('getDatabase hands plugins full modules', () => {
    test('getdatabase-materialises-stub: a stub slot is a full module in the copy, the live slot is not written by the call', async () => {
        installDb([fullModule('A'), stubModule('B')])
        installLoader()

        const copy = await api().getDatabase(['modules'])

        expect(modulesOf(copy).map((m) => isModuleStub(m))).toEqual([false, false])
        expect(modulesOf(copy)[1].lorebook?.[0].content).toBe('B content')
        expect(modulesOf(copy)[0]).toEqual(fullModule('A'))
        expect(loads).toEqual(['B#0'])
        expect(acquireCount.released).toBe(acquireCount.acquired)
        expect(returnedSlots).toHaveLength(1)
        expect(liveModules()[1]).toBe(returnedSlots[0])
    })

    test('getdatabase-ambiguous-stub-refused: a stub whose id another slot holds is refused for both orders, without a load', async () => {
        for (const modules of [[stubModule('X'), fullModule('X')], [fullModule('X'), stubModule('X')]]) {
            installDb(modules)
            installLoader()

            await expect(api().getDatabase(['modules'])).rejects.toThrow(/X name.*\(X\)|\(X\).*X name/)

            expect(loads).toEqual([])
        }
    })

    test('getdatabase-load-failure-names-module: a loader failure rejects with id and name, returns nothing and releases the earlier loads', async () => {
        installDb([stubModule('A', 'Alpha'), stubModule('B', 'Beta')])
        installLoader(['B'])

        const result = api().getDatabase(['modules'])

        await expect(result).rejects.toThrow(/Beta/)
        await expect(result).rejects.toThrow(/\(B\)/)
        expect(acquireCount.acquired).toBe(1)
        expect(acquireCount.released).toBe(acquireCount.acquired)
    })

    test('getdatabase-load-failure-names-module: a missing loader and a vanished module reject naming the module', async () => {
        installDb([stubModule('A', 'Alpha')])

        await expect(api().getDatabase('all')).rejects.toThrow(/Alpha.*\(A\)/)

        registerModuleLoader(async () => null)
        await expect(api().getDatabase('all')).rejects.toThrow(/Alpha.*\(A\)/)
        expect(acquireCount.released).toBe(acquireCount.acquired)
    })

    test('guard: getdatabase-no-stub-unchanged: without a stub the copy is the plain snapshot of each allowed key', async () => {
        installDb([fullModule('A'), fullModule('B')])
        installLoader()

        const copy = await api().getDatabase('all') as Record<string, unknown>

        const expected: Record<string, unknown> = {}
        for (const key of allowedDbKeys) {
            expected[key] = $state.snapshot((DBState.db as unknown as Record<string, unknown>)[key])
        }
        expect(Object.keys(copy)).toEqual(Object.keys(expected))
        expect(copy).toEqual(expected)
        expect(acquireCount.acquired).toBe(0)
        expect(loads).toEqual([])
    })

    test('guard: getdatabase-includeonly-skips-loader: a read without modules never calls the loader', async () => {
        installDb([stubModule('A')])
        installLoader()

        const copy = await api().getDatabase(['plugins']) as Record<string, unknown>

        expect(Object.keys(copy)).toEqual(['plugins'])
        expect(loads).toEqual([])
        expect(acquireCount.acquired).toBe(0)
    })
})

describe('setDatabase refuses a module stub as a replacement for a module', () => {
    test('plugin-write-persists-full: a plugin edits a stub module in the copy and writes it back; the live slot is full and holds the edit', async () => {
        installDb([fullModule('A'), stubModule('B')])
        installLoader()
        const copy = await api().getDatabase(['modules'])
        expect(isModuleStub(modulesOf(copy)[1])).toBe(false)
        expect(modulesOf(copy)[1].lorebook).toHaveLength(1)
        modulesOf(copy)[1].lorebook![0].content = 'edited by plugin'

        await api().setDatabase(copy)

        expect(isModuleStub(liveModules()[1])).toBe(false)
        expect(liveModules()[1].lorebook?.[0].content).toBe('edited by plugin')
        expect($state.snapshot(liveModules()[0])).toEqual(fullModule('A'))
    })

    test('plugin-write-persists-full: writing the stub object of a full module back keeps the live module', async () => {
        installDb([fullModule('A'), fullModule('B')])

        await api().setDatabase({ modules: [stubModule('A'), fullModule('B')] })

        expect(isModuleStub(liveModules()[0])).toBe(false)
        expect(liveModules()[0].lorebook?.[0].content).toBe('A content')
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes(PLUGIN_NAME) && String(args[0]).includes('A'))).toBe(true)
    })

    test('setdatabase-stub-without-holder-dropped: a stub whose id no live module has is left out and warned about once', async () => {
        installDb([fullModule('A')])

        await api().setDatabase({ modules: [fullModule('A'), stubModule('ghost')] })

        expect(liveModules().map((m) => m.id)).toEqual(['A'])
        const warned = warnSpy.mock.calls.filter((args) => String(args[0]).includes('ghost'))
        expect(warned).toHaveLength(1)
        expect(String(warned[0][0])).toContain(PLUGIN_NAME)
    })

    test('setdatabase-stub-for-live-stub-keeps-live: a stub for a module that is itself a live stub keeps the live stub', async () => {
        installDb([stubModule('A'), fullModule('B')])

        await api().setDatabase({ modules: [stubModule('A', 'forged name'), fullModule('B')] })

        expect(isModuleStub(liveModules()[0])).toBe(true)
        expect(liveModules()[0].name).toBe('A name')
        expect((liveModules()[0] as unknown as { unit: string[] }).unit).toEqual(['unit-A'])
    })

    test('guard: setdatabase-bodyless-module-is-ordinary-write: a module without the marker replaces its slot even when the live holder is a stub', async () => {
        installDb([stubModule('A')])
        const bodyless = { id: 'A', name: 'plain', description: 'plain description' } as RisuModule

        await api().setDatabase({ modules: [bodyless] })

        expect(isModuleStub(liveModules()[0])).toBe(false)
        expect(liveModules()[0].name).toBe('plain')
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('stub'))).toBe(false)
    })
})

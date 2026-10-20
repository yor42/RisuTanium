/**
 * V3 `pluginStorage` on a store2 page (a residency is registered): the values live in
 * `DBState.db.pluginCustomStorage[<unit id>]` with `_coldplugin[<key>]` naming the unit id, no legacy
 * cold unit is read or written, and every change is seen by the real change effects that mark the
 * plugin storage for the save loop. On a legacy page (no residency) the cold-unit path is unchanged.
 *
 * Drives the REAL `src/ts/plugins/apiV3/v3.svelte.ts` and the REAL `registerDbChangeEffects`; the
 * module-mock set is the one `v3SaveMarks.svelte.test.ts` uses to load that module. The store2 save
 * loop's own persistence of one key is covered by `stage4Reproducers.test.ts`.
 *
 * Labels: the store2 tests are regression reproducers (they fail on the wiring that always called
 * `readColdStorageItem`/`setColdStorageItem`), except 'key, keys and length read only the slot map',
 * which is a compatibility guard (it passes on that wiring as well); the legacy-page tests are
 * compatibility guards that pass before and after.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
import type { Residency } from '../../storage/store2/residency'

//#region module mocks -- the set of v3SaveMarks.svelte.test.ts, paths adjusted for src/ts/plugins/tests/.

const coldMock = vi.hoisted(() => ({
    setColdStorageItem: vi.fn(async () => true),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' }) as unknown),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
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

vi.mock(import('../plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: { providers: new Map() },
    getV2PluginAPIs: () => ({
        safeLocalStorage: {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            keys: vi.fn(),
        },
    }),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: { providers: new Map(), chatOutput: new Set() },
}) as unknown as typeof import('../plugins.svelte'))

vi.mock(import('../apiV3/factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../apiV3/factory'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../pluginSafeClass'), () => ({
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    getFetchLogs: vi.fn(),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../gui/colorscheme'))

vi.mock(import('../../platform'), () => ({
    isNodeServer: false,
    isTauri: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../process/mcp/pluginmcp'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: coldMock.setColdStorageItem,
    readColdStorageItem: coldMock.readColdStorageItem,
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../process/files/inlays'))

vi.mock(import('../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn(async () => 'hash'),
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../model/types'))

vi.mock(import('../../process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('../../process/index.svelte'))

vi.mock(import('../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../process/scripts'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../../process/request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../../process/request/request'))

vi.mock(import('../../process/modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../process/modules'))

vi.mock(import('../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../process/ttsHooks'))

//#endregion

import { makeRisuaiAPIV3 } from '../apiV3/v3.svelte'
import { DBState } from '../../stores.svelte'
import { getDatabase } from '../../storage/database.svelte'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import { registerResidency, resetResidencyForTest } from '../../storage/store2/residencyActive'

type Storage = Record<string, unknown> & { _coldplugin?: Record<string, string> }

const storage = (): Storage => DBState.db.pluginCustomStorage as Storage

function installDb(pluginCustomStorage: Storage): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage,
        characterOrder: [],
        characters: [],
    } as unknown as Database
}

function pageIsStore2(): void {
    registerResidency({} as unknown as Residency)
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

function makeApi() {
    return makeRisuaiAPIV3({} as HTMLIFrameElement, { name: 'test-plugin' } as never)
}

beforeEach(() => {
    coldMock.setColdStorageItem.mockClear()
    coldMock.readColdStorageItem.mockClear()
    vi.mocked(getDatabase).mockImplementation(() => DBState.db)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('V3 pluginStorage on a store2 page', () => {
    test('setItem keeps the value in pluginCustomStorage under its unit id and writes no cold unit', async () => {
        installDb({})
        pageIsStore2()
        const api = makeApi()

        await api._setPluginStorage('k', { a: 1, list: [1, 2] })

        const unitId = storage()._coldplugin?.k
        expect(typeof unitId).toBe('string')
        expect(storage()[unitId as string]).toEqual({ a: 1, list: [1, 2] })
        expect(coldMock.setColdStorageItem).not.toHaveBeenCalled()
        expect(coldMock.readColdStorageItem).not.toHaveBeenCalled()
    })

    test('getItem answers from pluginCustomStorage and never reads a stale legacy unit', async () => {
        installDb({ _coldplugin: { k: 'unit-1' }, 'unit-1': { fresh: true } })
        pageIsStore2()
        coldMock.readColdStorageItem.mockResolvedValue({ status: 'ok', value: { stale: true } })
        const api = makeApi()

        const value = await api._getPluginStorage('k')

        expect(value).toEqual({ fresh: true })
        expect(coldMock.readColdStorageItem).not.toHaveBeenCalled()
    })

    test('a value read or written is a copy: the plugin never holds a reference into the database', async () => {
        installDb({})
        pageIsStore2()
        const api = makeApi()
        const given = { a: { b: 1 } }

        await api._setPluginStorage('k', given)
        given.a.b = 2
        const read = await api._getPluginStorage('k') as { a: { b: number } }
        read.a.b = 3

        const unitId = storage()._coldplugin?.k as string
        expect(storage()[unitId]).toEqual({ a: { b: 1 } })
    })

    test('a mapped key whose value is absent answers null, and an unmapped key answers null', async () => {
        installDb({ _coldplugin: { gone: 'unit-gone' } })
        pageIsStore2()
        const api = makeApi()

        expect(await api._getPluginStorage('gone')).toBeNull()
        expect(await api._getPluginStorage('never')).toBeNull()
    })

    test('a value that is not JSON fails the write and leaves no mapping', async () => {
        installDb({})
        pageIsStore2()
        const api = makeApi()

        await expect(api._setPluginStorage('k', { n: 1n })).rejects.toThrow('Failed to write plugin storage for key: k')

        expect(storage()._coldplugin).toEqual({})
        expect(Object.keys(storage())).toEqual(['_coldplugin'])
    })

    test('removeItem drops the slot and its value; the value of a unit another slot still names stays', async () => {
        installDb({ _coldplugin: { a: 'unit-a', b: 'unit-b', c: 'unit-b' }, 'unit-a': 1, 'unit-b': 2 })
        pageIsStore2()
        const api = makeApi()

        await api._removePluginStorage('a')
        expect(storage()).toEqual({ _coldplugin: { b: 'unit-b', c: 'unit-b' }, 'unit-b': 2 })

        await api._removePluginStorage('b')
        expect(storage()).toEqual({ _coldplugin: { c: 'unit-b' }, 'unit-b': 2 })
        expect(await api._getPluginStorage('c')).toBe(2)
    })

    test('clear drops every slot and every value, and a plain plugin storage key stays', async () => {
        installDb({ _coldplugin: { a: 'unit-a', b: 'unit-b' }, 'unit-a': 1, 'unit-b': 2, plain: 'kept' })
        pageIsStore2()
        const api = makeApi()

        await api._clearPluginStorage()

        expect(storage()).toEqual({ _coldplugin: {}, plain: 'kept' })
        expect(await api._lengthPluginStorage()).toBe(0)
    })

    test('key, keys and length read only the slot map', async () => {
        installDb({ _coldplugin: { a: 'unit-a', b: 'unit-b' }, 'unit-a': 1, 'unit-b': 2 })
        pageIsStore2()
        const api = makeApi()

        expect(await api._keysPluginStorage()).toEqual(['a', 'b'])
        expect(await api._keyPluginStorage(1)).toBe('b')
        expect(await api._lengthPluginStorage()).toBe(2)
        expect(coldMock.readColdStorageItem).not.toHaveBeenCalled()
    })

    test('every change reaches the change effects that mark the plugin storage for the save loop', async () => {
        installDb({ _coldplugin: { r: 'unit-r', c: 'unit-c' }, 'unit-r': 1, 'unit-c': 2 })
        pageIsStore2()
        const tracker = makeTracker()
        const markChanged = vi.fn()
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        const api = makeApi()
        const marked = async (change: () => Promise<void>): Promise<boolean> => {
            tracker.pluginCustomStorage = false
            markChanged.mockClear()
            await change()
            flushSync()
            return tracker.pluginCustomStorage && markChanged.mock.calls.some(([changed]) => changed === true)
        }

        expect(await marked(() => api._setPluginStorage('n', { x: 1 }))).toBe(true)
        expect(await marked(() => api._setPluginStorage('n', { x: 2 }))).toBe(true)
        expect(await marked(() => api._removePluginStorage('r'))).toBe(true)
        expect(await marked(() => api._clearPluginStorage())).toBe(true)

        cleanup()
    })
})

describe('V3 pluginStorage on a legacy page', () => {
    // Compatibility guard: passes before and after the store2 branch.
    test('setItem writes a cold unit and keeps only the key map in pluginCustomStorage', async () => {
        installDb({})
        const api = makeApi()

        await api._setPluginStorage('k', { a: 1 })

        const unitId = storage()._coldplugin?.k as string
        expect(coldMock.setColdStorageItem).toHaveBeenCalledWith(unitId, { a: 1 })
        expect(Object.keys(storage())).toEqual(['_coldplugin'])
    })

    // Compatibility guard.
    test('getItem reads the cold unit', async () => {
        installDb({ _coldplugin: { k: 'unit-1' } })
        coldMock.readColdStorageItem.mockResolvedValue({ status: 'ok', value: { legacy: true } })
        const api = makeApi()

        expect(await api._getPluginStorage('k')).toEqual({ legacy: true })
        expect(coldMock.readColdStorageItem).toHaveBeenCalledWith('unit-1')
    })

    // Compatibility guard: remove and clear drop the slots only; a legacy page has no value in the database to drop.
    test('removeItem and clear drop the slots only', async () => {
        installDb({ _coldplugin: { a: 'unit-a', b: 'unit-b' }, 'unit-a': 'not touched' })
        const api = makeApi()

        await api._removePluginStorage('b')
        expect(storage()).toEqual({ _coldplugin: { a: 'unit-a' }, 'unit-a': 'not touched' })

        await api._clearPluginStorage()
        expect(storage()).toEqual({ _coldplugin: {}, 'unit-a': 'not touched' })
    })
})

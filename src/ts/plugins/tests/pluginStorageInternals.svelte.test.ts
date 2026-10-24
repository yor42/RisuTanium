/**
 * V2 plugin storage internals (`_coldplugin`, `_coldpluginIndex`) in
 * `getV2PluginAPIs()` (`src/ts/plugins/plugins.svelte.ts`).
 *
 * Regression reproducers: a plugin writing `pluginCustomStorage` through
 * `setDatabase` / `setDatabaseLite`, or calling `pluginStorage.clear()`, must not
 * replace, roll back or introduce the storage-layer internals, nor, on a store2
 * page, the value entries at the unit ids the current `_coldplugin` map names.
 * Compatibility guards (pass before and after): `pluginStorage.getItem` return
 * values and the dirty mark of a plugin storage write.
 *
 * The modules that need a browser, the platform or the live save path are
 * mocked so `plugins.svelte.ts` loads; pure modules load for real. The mocks
 * mirror pluginSetDatabaseSaveMarks.svelte.test.ts.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'

//#region module mocks

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

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn((db: Database) => {
        ;(globalThis as unknown as { __testDB: Database }).__testDB = db
        const state = (globalThis as unknown as { __testDBState: { db: Database } }).__testDBState
        state.db = db
    }),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertPluginConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    ;(globalThis as unknown as { __testDBState: { db: Database } }).__testDBState = state
    return {
        DBState: state,
        hotReloading: writable(false),
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../pluginSafeClass'), () => ({
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
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock(import('../apiV3/v3.svelte'), () => ({
    loadV3Plugins: vi.fn(async () => {}),
}) as unknown as typeof import('../apiV3/v3.svelte'))

vi.mock(import('../apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../apiV3/transpiler'))

//#endregion

import { getV2PluginAPIs } from '../plugins.svelte'
import { DBState } from '../../stores.svelte'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import { PLUGIN_STORAGE_INDEX_KEY, PLUGIN_STORAGE_LEGACY_MAP_KEY } from '../../process/pluginStorageIndex'
import {
    readPluginStorageValue,
    readPluginUnitFromDb,
    writePluginStorageValue,
    writePluginUnitToDb,
    type PluginColdStorageDb,
} from '../apiV3/pluginColdStorage'

//#region fixtures

const LIVE_MAP = { alpha: 'unit-alpha', beta: 'unit-beta' }
const STALE_MAP = { alpha: 'unit-old' }
const LIVE_INDEX = 'index-pointer-live'

function installDb(storage: Record<string, unknown>): void {
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: storage,
        characterOrder: [],
        characters: [],
    } as unknown as Database
    DBState.db = db
    // Read back after assignment so getDatabase() returns the live reactive proxy.
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

function liveStorage(): Record<string, unknown> {
    return $state.snapshot(DBState.db.pluginCustomStorage) as Record<string, unknown>
}

function installWithInternals(): void {
    installDb({
        [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { ...LIVE_MAP },
        [PLUGIN_STORAGE_INDEX_KEY]: LIVE_INDEX,
        existing: 'old-value',
    })
}

//#endregion

describe('setDatabase keeps plugin storage internals', () => {
    test('(a1) an incoming pluginCustomStorage lacking _coldplugin keeps the live map and applies plugin keys', async () => {
        installWithInternals()
        const api = getV2PluginAPIs()
        await api.setDatabase({ pluginCustomStorage: { fresh: 'new-value' } })
        const stored = liveStorage()
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual(LIVE_MAP)
        expect(stored[PLUGIN_STORAGE_INDEX_KEY]).toBe(LIVE_INDEX)
        expect(stored.fresh).toBe('new-value')
        expect(stored.existing).toBeUndefined()
    })

    test('(a2) a stale _coldplugin in the incoming object does not overwrite the live one', async () => {
        installWithInternals()
        const api = getV2PluginAPIs()
        await api.setDatabase({
            pluginCustomStorage: {
                [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { ...STALE_MAP },
                [PLUGIN_STORAGE_INDEX_KEY]: 'index-pointer-stale',
                fresh: 'v',
            },
        })
        const stored = liveStorage()
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual(LIVE_MAP)
        expect(stored[PLUGIN_STORAGE_INDEX_KEY]).toBe(LIVE_INDEX)
        expect(stored.fresh).toBe('v')
    })

    test('(c1) an incoming _coldpluginIndex is not introduced when the live object has none', async () => {
        installDb({ [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { ...LIVE_MAP } })
        const api = getV2PluginAPIs()
        await api.setDatabase({
            pluginCustomStorage: { [PLUGIN_STORAGE_INDEX_KEY]: 'forged', fresh: 'v' },
        })
        const stored = liveStorage()
        expect(PLUGIN_STORAGE_INDEX_KEY in stored).toBe(false)
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual(LIVE_MAP)
        expect(stored.fresh).toBe('v')
    })

    test('a non-object pluginCustomStorage still keeps the internals', async () => {
        installWithInternals()
        const api = getV2PluginAPIs()
        await api.setDatabase({ pluginCustomStorage: 'not an object' })
        const stored = liveStorage()
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual(LIVE_MAP)
        expect(stored[PLUGIN_STORAGE_INDEX_KEY]).toBe(LIVE_INDEX)
        expect(stored.existing).toBeUndefined()
    })
})

describe('setDatabaseLite keeps plugin storage internals', () => {
    test('(b1) an incoming pluginCustomStorage lacking _coldplugin keeps the live map and applies plugin keys', () => {
        installWithInternals()
        const api = getV2PluginAPIs()
        api.setDatabaseLite({ pluginCustomStorage: { fresh: 'new-value' } })
        const stored = liveStorage()
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual(LIVE_MAP)
        expect(stored[PLUGIN_STORAGE_INDEX_KEY]).toBe(LIVE_INDEX)
        expect(stored.fresh).toBe('new-value')
        expect(stored.existing).toBeUndefined()
    })

    test('(b2) a stale _coldplugin in the incoming object does not overwrite the live one', () => {
        installWithInternals()
        const api = getV2PluginAPIs()
        api.setDatabaseLite({
            pluginCustomStorage: {
                [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { ...STALE_MAP },
                [PLUGIN_STORAGE_INDEX_KEY]: 'index-pointer-stale',
                fresh: 'v',
            },
        })
        const stored = liveStorage()
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual(LIVE_MAP)
        expect(stored[PLUGIN_STORAGE_INDEX_KEY]).toBe(LIVE_INDEX)
        expect(stored.fresh).toBe('v')
    })

    test('(c2) an incoming _coldpluginIndex is not introduced when the live object has none', () => {
        installDb({ [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { ...LIVE_MAP } })
        const api = getV2PluginAPIs()
        api.setDatabaseLite({
            pluginCustomStorage: { [PLUGIN_STORAGE_INDEX_KEY]: 'forged', fresh: 'v' },
        })
        const stored = liveStorage()
        expect(PLUGIN_STORAGE_INDEX_KEY in stored).toBe(false)
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual(LIVE_MAP)
    })
})

describe('pluginStorage.clear', () => {
    test('(d) removes plugin keys but keeps _coldplugin and _coldpluginIndex', () => {
        installWithInternals()
        const api = getV2PluginAPIs()
        api.pluginStorage.clear()
        const stored = liveStorage()
        expect(stored.existing).toBeUndefined()
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual(LIVE_MAP)
        expect(stored[PLUGIN_STORAGE_INDEX_KEY]).toBe(LIVE_INDEX)
    })

    test('(d2) with no internals present, clear leaves an empty object', () => {
        installDb({ existing: 'x' })
        const api = getV2PluginAPIs()
        api.pluginStorage.clear()
        expect(liveStorage()).toEqual({})
    })
})

describe('getItem snapshots the requested value (pin of the new getItem)', () => {
    // The getDatabase mock ignores a snapshot option, so this is not a
    // before/after guard: it pins that getItem snapshots the value itself.
    test('getItem returns a detached copy, not the live object', () => {
        installDb({ obj: { a: 1 } })
        const api = getV2PluginAPIs()
        const got = api.pluginStorage.getItem('obj') as { a: number }
        got.a = 99
        expect((liveStorage().obj as { a: number }).a).toBe(1)
    })
})

describe('store2 layout: values live at pluginCustomStorage[<unit id>] next to _coldplugin', () => {
    const getLive = () => DBState.db as unknown as PluginColdStorageDb
    let unitCounter = 0
    const v3Get = (key: string) => readPluginStorageValue(getLive(), key, readPluginUnitFromDb(getLive))
    const v3Set = (key: string, value: unknown) =>
        writePluginStorageValue(getLive(), getLive, key, value, writePluginUnitToDb(getLive), () => `new-unit-${++unitCounter}`)

    test('V2 pluginStorage.clear keeps a V3 value readable', async () => {
        installDb({ [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { k: 'u1' }, u1: { v: 'value' }, v2key: 'x' })
        getV2PluginAPIs().pluginStorage.clear()
        expect(await v3Get('k')).toEqual({ v: 'value' })
        expect(liveStorage().v2key).toBeUndefined()
    })

    test('a stale snapshot written back with setDatabase keeps a newly written key and the newer value of an existing key', async () => {
        installDb({ [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { k: 'u1' }, u1: { v: 'old' } })
        const snap = $state.snapshot(DBState.db.pluginCustomStorage)
        await v3Set('fresh', { v: 'fresh' })
        await v3Set('k', { v: 'new' })
        await getV2PluginAPIs().setDatabase({ pluginCustomStorage: snap }, 'p')
        expect(await v3Get('fresh')).toEqual({ v: 'fresh' })
        expect(await v3Get('k')).toEqual({ v: 'new' })
    })

    test('a JSON copy written back with setDatabaseLite keeps a V3 value written meanwhile', async () => {
        installDb({ [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { k: 'u1' }, u1: { v: 'old' } })
        const api = getV2PluginAPIs()
        const copy = { pluginCustomStorage: JSON.parse(JSON.stringify(liveStorage())) }
        await v3Set('fresh', { v: 'fresh' })
        await v3Set('k', { v: 'new' })
        api.setDatabaseLite(copy, 'p')
        expect(await v3Get('fresh')).toEqual({ v: 'fresh' })
        expect(await v3Get('k')).toEqual({ v: 'new' })
    })

    test('a value entry at an id only the incoming map names is not resurrected', async () => {
        installDb({ [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { k: 'u1' }, u1: { v: 'old' } })
        await getV2PluginAPIs().setDatabase({
            pluginCustomStorage: {
                [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { k: 'u1', gone: 'u2' },
                u1: { v: 'stale' },
                u2: { v: 'zombie' },
                plain: 'kept',
            },
        })
        const stored = liveStorage()
        expect('u2' in stored).toBe(false)
        expect(stored[PLUGIN_STORAGE_LEGACY_MAP_KEY]).toEqual({ k: 'u1' })
        expect(stored.u1).toEqual({ v: 'old' })
        expect(stored.plain).toBe('kept')
    })

    test('resetting pluginCustomStorage through the V2 getDatabase proxy keeps the internals and mapped values', async () => {
        installDb({ [PLUGIN_STORAGE_LEGACY_MAP_KEY]: { k: 'u1' }, [PLUGIN_STORAGE_INDEX_KEY]: LIVE_INDEX, u1: { v: 'old' }, v2key: 'x' })
        const proxy = getV2PluginAPIs().getDatabase() as unknown as { pluginCustomStorage: Record<string, unknown> }
        proxy.pluginCustomStorage = {}
        const stored = liveStorage()
        expect(stored[PLUGIN_STORAGE_INDEX_KEY]).toBe(LIVE_INDEX)
        expect(await v3Get('k')).toEqual({ v: 'old' })
        expect(stored.v2key).toBeUndefined()
    })
})

describe('guards (pass before and after the change)', () => {
    test('getItem returns stored values unchanged and null for falsy or missing', () => {
        installDb({ obj: { a: [1, 2], b: { c: 'd' } }, str: 'hello', zero: 0, empty: '', no: false })
        const api = getV2PluginAPIs()
        expect(api.pluginStorage.getItem('obj')).toEqual({ a: [1, 2], b: { c: 'd' } })
        expect(api.pluginStorage.getItem('str')).toBe('hello')
        expect(api.pluginStorage.getItem('zero')).toBeNull()
        expect(api.pluginStorage.getItem('empty')).toBeNull()
        expect(api.pluginStorage.getItem('no')).toBeNull()
        expect(api.pluginStorage.getItem('missing')).toBeNull()
    })

    test('getItem works when pluginCustomStorage is absent', () => {
        installDb({})
        delete (DBState.db as unknown as { pluginCustomStorage?: unknown }).pluginCustomStorage
        const api = getV2PluginAPIs()
        expect(api.pluginStorage.getItem('x')).toBeNull()
    })

    test('writing pluginCustomStorage through setDatabase, setDatabaseLite and clear marks it dirty', async () => {
        installWithInternals()
        const tracker: toSaveType = {
            character: [],
            chat: [],
            botPreset: false,
            modules: false,
            loadouts: false,
            plugins: false,
            pluginCustomStorage: false,
        }
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged: vi.fn() })
        })
        flushSync()
        const api = getV2PluginAPIs()

        tracker.pluginCustomStorage = false
        await api.setDatabase({ pluginCustomStorage: { fresh: 'one' } })
        flushSync()
        expect(tracker.pluginCustomStorage).toBe(true)

        tracker.pluginCustomStorage = false
        api.setDatabaseLite({ pluginCustomStorage: { fresh: 'two' } })
        flushSync()
        expect(tracker.pluginCustomStorage).toBe(true)

        tracker.pluginCustomStorage = false
        api.pluginStorage.clear()
        flushSync()
        expect(tracker.pluginCustomStorage).toBe(true)

        cleanup()
    })
})

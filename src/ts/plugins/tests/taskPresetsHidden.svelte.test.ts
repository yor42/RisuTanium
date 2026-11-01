/**
 * `taskPresets` holds the user's Utility task presets and is not plugin-visible (CHORE-616 I4b):
 *   - it is not an `allowedDbKeys` entry, which is the only key source of the V3 `getDatabase` (it snapshots exactly
 *     those keys) and of the plugin writers;
 *   - the V2 `getDatabase` proxy answers an unlisted key from plugin storage, so the field is neither readable nor
 *     listed through it;
 *   - a V2 `setDatabase` / `setDatabaseLite` of that key lands in plugin storage and never reaches the field;
 *   - the generic dirty-tracking effect marks a change to the field, nested edits included.
 *
 * Drives the real `getV2PluginAPIs()` and the real `registerDbChangeEffects`. Every other module `plugins.svelte.ts`
 * imports is mocked so the module loads; the mock set is the one of `upstreamKvHidden.svelte.test.ts`. Tests titled
 * `guard:` pin behaviour that passes before and after the S2 change.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'

//#region module mocks

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
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
    setDatabase: vi.fn(),
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

import { allowedDbKeys, getV2PluginAPIs } from '../plugins.svelte'
import { DBState } from '../../stores.svelte'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'

const FIELD = 'taskPresets'

const PRESETS = [{ id: 'a', name: 'one', instructions: 'i', model: 'm' }]

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [],
        taskPresets: structuredClone(PRESETS),
    } as unknown as Database
    // Read back after assignment: Svelte re-proxies on assign, and the plugin APIs read the live proxy.
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

describe('plugin exposure of the task presets field', () => {
    test('guard: the field is not an allowed plugin database key', () => {
        expect(allowedDbKeys).not.toContain(FIELD)
    })

    test('guard: the V2 getDatabase proxy neither answers nor lists the field', () => {
        installDb()
        const pluginDb = getV2PluginAPIs().getDatabase() as unknown as Record<string, unknown>

        expect(pluginDb[FIELD]).toBeUndefined()
        expect(Object.keys(pluginDb)).not.toContain(FIELD)
        expect(Object.getOwnPropertyNames(pluginDb)).not.toContain(FIELD)
    })

    test('guard: a V2 proxy write of the field lands in plugin storage and leaves the field untouched', () => {
        installDb()
        const pluginDb = getV2PluginAPIs().getDatabase() as unknown as Record<string, unknown>

        pluginDb[FIELD] = [{ id: 'evil' }]

        expect($state.snapshot(DBState.db.taskPresets)).toEqual(PRESETS)
        expect(DBState.db.pluginCustomStorage[FIELD]).toEqual([{ id: 'evil' }])
    })

    test('guard: V2 setDatabase and setDatabaseLite of the field land in plugin storage and leave the field untouched', async () => {
        installDb()
        const api = getV2PluginAPIs()

        await api.setDatabase({ [FIELD]: [{ id: 'evil-2' }] })
        expect($state.snapshot(DBState.db.taskPresets)).toEqual(PRESETS)
        expect(DBState.db.pluginCustomStorage[FIELD]).toEqual([{ id: 'evil-2' }])

        await api.setDatabaseLite({ [FIELD]: [{ id: 'evil-3' }] })
        expect($state.snapshot(DBState.db.taskPresets)).toEqual(PRESETS)
        expect(DBState.db.pluginCustomStorage[FIELD]).toEqual([{ id: 'evil-3' }])
    })
})

describe('dirty tracking of the task presets field', () => {
    function wire() {
        const tracker: toSaveType = {
            character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false,
        }
        const markChanged = vi.fn()
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        markChanged.mockClear()
        return { markChanged, cleanup }
    }

    test('guard: creating the field, editing inside a preset and removing the field each mark the database changed', () => {
        installDb()
        delete DBState.db.taskPresets
        const { markChanged, cleanup } = wire()

        DBState.db.taskPresets = [{ id: 'a', name: 'one', instructions: 'i', model: 'm' }]
        flushSync()
        expect(markChanged).toHaveBeenCalledTimes(1)

        ;(DBState.db.taskPresets as { name: string }[])[0].name = 'renamed'
        flushSync()
        expect(markChanged).toHaveBeenCalledTimes(2)

        DBState.db.taskPresets?.push({ id: 'b', name: 'two', instructions: 'j', model: 'm' })
        flushSync()
        expect(markChanged).toHaveBeenCalledTimes(3)

        delete DBState.db.taskPresets
        flushSync()
        expect(markChanged).toHaveBeenCalledTimes(4)

        cleanup()
    })
})

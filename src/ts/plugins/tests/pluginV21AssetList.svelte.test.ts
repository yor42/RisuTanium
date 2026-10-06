// @vitest-environment happy-dom

/**
 * `loadPlugins` (`plugins.svelte.ts`) when an enabled V2.1 plugin is present:
 * no module's asset list is an `AssetList` by the time V2.1 code runs, so a
 * V2.1 plugin's in-place edit of a live list is tracked and saved like any
 * other change. An `AssetList` is not reactive, so an in-place edit of one
 * would be lost.
 *
 * `loadPlugins`, `loadV2Plugin` and `registerDbChangeEffects` are real, and the
 * plugin script really runs. The restore of archived characters is a mock that
 * throws, standing in for a unit that cannot be read. Titles beginning "guard:"
 * pin behaviour that must be preserved; every other test is a regression
 * reproducer for the behaviour it names.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database, character } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'
import type { toSaveType } from '../../storage/risuSave'

//#region module mocks

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: true,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../../alert'), () => ({
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
    requiresFullEncoderReload: { state: false },
    forageStorage: { realStorage: { setItem: vi.fn(), getItem: vi.fn(async () => null), keys: vi.fn(async () => []) } },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async (code: string) => ({ modifiedCode: code })),
}) as unknown as typeof import('../pluginSafety'))

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

vi.mock(import('../../process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../../process/index.svelte'))

vi.mock(import('../../process/coldRestoreAll'), () => ({
    restoreAllColdCharacters: vi.fn(async () => {
        throw new Error('restoring the archived characters failed')
    }),
}) as unknown as typeof import('../../process/coldRestoreAll'))

//#endregion

import { loadPlugins } from '../plugins.svelte'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import { buildColdStub } from '../../process/coldCharacter'
import { AssetList, toAssetList, type AssetTuple } from '../../storage/assetList'
import { DBState } from '../../stores.svelte'
import type { RisuModule } from '../../process/modules'

//#region fixtures

interface Probe {
    /** Per module: whether its asset list was a plain array when the plugin ran. */
    plainAtRun: boolean[]
    runs: number
}

const seenBy = globalThis as unknown as { __v21Probe?: () => void }

const V21_PLUGIN: RisuPlugin = {
    name: 'legacy',
    script: 'globalThis.__v21Probe()',
    version: '2.1',
    enabled: true,
    arguments: {},
    realArg: {},
    customLink: [],
    argMeta: {},
}

function tuples(seed: string): AssetTuple[] {
    return [[`name-${seed}-0`, `path-${seed}-0`, 'png'], [`name-${seed}-1`, `path-${seed}-1`, 'png']]
}

function installedModule(seed: string): RisuModule {
    return { name: `Module ${seed}`, description: '', id: `id-${seed}`, assets: toAssetList(tuples(seed)) }
}

function fullCharacter(chaId: string, name: string): Database['characters'][number] {
    return { type: 'character', name, chaId, chatPage: 0, chats: [], lastInteraction: 5000 } as unknown as Database['characters'][number]
}

function stubOf(chaId: string, name: string): Database['characters'][number] {
    return buildColdStub(fullCharacter(chaId, name) as unknown as character, `unit-${chaId}`, []) as unknown as Database['characters'][number]
}

function installDb(plugins: RisuPlugin[], characters: Database['characters'] = []): void {
    DBState.db = {
        botPresetsId: 0,
        botPresets: [],
        modules: [installedModule('a'), installedModule('b')],
        loadouts: [],
        plugins,
        pluginCustomStorage: {},
        characters,
    } as unknown as Database
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

const probe: Probe = { plainAtRun: [], runs: 0 }
let tracker: toSaveType
let cleanup: (() => void) | undefined

beforeEach(() => {
    localStorage.clear()
    probe.plainAtRun = []
    probe.runs = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The plugin code of a V2.1 plugin: record what it finds, then edit a list in place.
    seenBy.__v21Probe = () => {
        probe.runs += 1
        probe.plainAtRun = DBState.db.modules.map((m) => Object.getPrototypeOf(m.assets) === Array.prototype)
        flushSync()
        tracker.modules = false
        DBState.db.modules[0].assets!.push(['pushed-name', 'pushed-path', 'png'])
    }
    tracker = makeTracker()
})

afterEach(() => {
    cleanup?.()
    cleanup = undefined
    delete seenBy.__v21Probe
    vi.restoreAllMocks()
})

function registerEffects(): void {
    cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged: vi.fn() })
    })
    flushSync()
}

//#endregion

describe('loadPlugins with an enabled V2.1 plugin and installed AssetLists', () => {
    test('every module asset list is a plain array when the plugin runs, and its in-place push is tracked', async () => {
        installDb([V21_PLUGIN])
        registerEffects()
        expect(DBState.db.modules[0].assets instanceof AssetList).toBe(true)

        await loadPlugins()
        flushSync()

        expect(probe.runs).toBe(1)
        expect(probe.plainAtRun).toEqual([true, true])
        expect(tracker.modules).toBe(true)
        expect(DBState.db.modules[0].assets).toHaveLength(3)
    })

    test('the lists are plain when the plugin runs even though restoring the archived characters throws', async () => {
        installDb([V21_PLUGIN], [fullCharacter('alpha', 'Alpha Hero'), stubOf('beta', 'Beta Hero')])
        registerEffects()

        await loadPlugins()
        flushSync()

        const { restoreAllColdCharacters } = await import('../../process/coldRestoreAll')
        expect(restoreAllColdCharacters).toHaveBeenCalled()
        expect(probe.runs).toBe(1)
        expect(probe.plainAtRun).toEqual([true, true])
        expect(tracker.modules).toBe(true)
    })

    test('guard: the conversion keeps every asset tuple', async () => {
        installDb([V21_PLUGIN])

        await loadPlugins()

        expect(DBState.db.modules[1].assets).toEqual(tuples('b'))
        expect(DBState.db.modules[0].assets).toEqual([...tuples('a'), ['pushed-name', 'pushed-path', 'png']])
    })

    test('guard: with no V2.1 plugin the lists stay AssetLists', async () => {
        installDb([{ ...V21_PLUGIN, enabled: false }])

        await loadPlugins()

        expect(probe.runs).toBe(0)
        expect(DBState.db.modules.every((m) => m.assets instanceof AssetList)).toBe(true)
    })

    test('guard: when the V2.1 plugins are switched off after repeated unfinished restores, no V2.1 code runs and the lists stay AssetLists', async () => {
        localStorage.setItem('v21RestoreAllStrikes', '2')
        installDb([V21_PLUGIN], [stubOf('beta', 'Beta Hero')])

        await loadPlugins()

        expect(DBState.db.plugins[0].enabled).toBe(false)
        expect(probe.runs).toBe(0)
        expect(DBState.db.modules.every((m) => m.assets instanceof AssetList)).toBe(true)
    })
})

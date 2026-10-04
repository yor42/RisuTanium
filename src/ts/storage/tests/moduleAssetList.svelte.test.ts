// @vitest-environment happy-dom

/**
 * A module's `assets` is held as an `AssetList` once the module is installed
 * into the reactive database, so the list and its tuples stay out of Svelte's
 * reactive graph (memory only). This drives the REAL `setDatabase` /
 * `setDatabaseLite` (`database.svelte.ts`), the real `registerDbChangeEffects`
 * and the real `RisuSaveEncoder` over a `$state` stand-in for `DBState`.
 *
 * Titles beginning "guard:" pin behaviour that must be preserved; every other
 * test is a regression reproducer for the behaviour it names.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(async () => {}),
    saveAsset: vi.fn(async () => ''),
    forageStorage: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    defaultColorScheme: { bgcolor: '#000000' },
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

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
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

// The database must be genuinely reactive: the save effects under test re-run
// on a write to it.
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/model/modellist'), async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
    }
})

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { setDatabase, setDatabaseLite, getDatabase, type Database } from 'src/ts/storage/database.svelte'
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, decodeRisuSave, encodeRisuSaveLegacy, listEncodedBlocks, RisuSaveType, type toSaveType } from 'src/ts/storage/risuSave'
import { AssetList, toAssetList, type AssetTuple } from 'src/ts/storage/assetList'
import type { RisuModule } from 'src/ts/process/modules'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'

//#region fixtures

function makeTuples(seed: string, count: number): AssetTuple[] {
    const out: AssetTuple[] = []
    for (let i = 0; i < count; i++) {
        out.push([`name-${seed}-${i}`, `assets/path-${seed}-${i}`, 'png'])
    }
    return out
}

function makeModule(seed: string, count = 3): RisuModule {
    return {
        name: `Module ${seed}`,
        description: `Description ${seed}`,
        id: `id-${seed}`,
        lorebook: [],
        regex: [],
        trigger: [],
        assets: makeTuples(seed, count),
    }
}

const V21_PLUGIN = { name: 'legacy', script: '', version: '2.1', enabled: true, arguments: {}, realArg: {}, customLink: [], argMeta: {} } as RisuPlugin

/** A module whose list is an `AssetList` already, whatever the install does. */
function makeListed(seed: string, count = 3): RisuModule {
    const mod = makeModule(seed, count)
    mod.assets = toAssetList(mod.assets!)
    return mod
}

function makeDb(modules: RisuModule[], plugins: RisuPlugin[] = []): Database {
    return { modules, plugins, pluginCustomStorage: {} } as unknown as Database
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

const isPlainArray = (value: unknown) => Object.getPrototypeOf(value) === Array.prototype

let cleanup: (() => void) | undefined

function registerEffects(): toSaveType {
    const tracker = makeTracker()
    cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged: vi.fn() })
    })
    flushSync()
    return tracker
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    cleanup?.()
    cleanup = undefined
})

//#endregion

describe('installing a database holds module asset lists as AssetList', () => {
    test('after setDatabase every module asset list is not a plain Array', () => {
        setDatabase(makeDb([makeModule('a'), makeModule('b')]))

        for (const mod of DBState.db.modules as RisuModule[]) {
            expect(Object.getPrototypeOf(mod.assets)).not.toBe(Array.prototype)
        }
    })

    test('a module without assets is left without assets, and an empty list stays an empty list', () => {
        const bare = { name: 'bare', description: '', id: 'id-bare' } as RisuModule
        const empty = { ...makeModule('e'), assets: [] as AssetTuple[] }
        setDatabase(makeDb([bare, empty]))

        expect(DBState.db.modules[0].assets).toBeUndefined()
        expect(DBState.db.modules[1].assets).toHaveLength(0)
        expect(DBState.db.modules[1].assets instanceof AssetList).toBe(true)
    })

    test('guard: reading through DBState.db returns the raw list and raw tuples, not Svelte proxies', () => {
        const module = makeListed('a')
        const rawTuple = module.assets![0]
        DBState.db = makeDb([module])

        const assets = DBState.db.modules[0].assets
        expect(assets instanceof AssetList).toBe(true)
        expect(assets![0]).toBe(rawTuple)
    })

    test('guard: derived lists (map, filter, slice, concat) are plain arrays', () => {
        const assets = makeListed('a').assets!

        expect(isPlainArray(assets.map((a) => a))).toBe(true)
        expect(isPlainArray(assets.filter(() => true))).toBe(true)
        expect(isPlainArray(assets.slice())).toBe(true)
        expect(isPlainArray([].concat(assets as never))).toBe(true)
    })

    test('guard: installing the live, already converted database writes nothing to modules', () => {
        setDatabase(makeDb([makeModule('a'), makeModule('b')]))
        const tracker = registerEffects()
        tracker.modules = false

        setDatabase(getDatabase())
        flushSync()

        expect(tracker.modules).toBe(false)
    })

    test('a plain list in the live database is converted at the next install, from a snapshot with no proxied tuples', () => {
        setDatabase(makeDb([makeModule('a')]))
        // A module added to the live database later is a plain list read through proxies.
        DBState.db.modules.push(makeModule('late'))
        expect(isPlainArray(DBState.db.modules[1].assets)).toBe(true)

        setDatabase(getDatabase())

        expect(DBState.db.modules[1].assets instanceof AssetList).toBe(true)
        // A Svelte proxy cannot be structured-cloned; a raw tuple can.
        expect(() => structuredClone(DBState.db.modules[1].assets)).not.toThrow()
        expect(DBState.db.modules[1].assets![0]).toEqual(['name-late-0', 'assets/path-late-0', 'png'])
    })

    test('setDatabaseLite installs the same way', () => {
        setDatabaseLite(makeDb([makeModule('a')]))

        expect(DBState.db.modules[0].assets instanceof AssetList).toBe(true)
    })

    test('with an enabled V2.1 plugin the install leaves plain arrays', () => {
        setDatabase(makeDb([makeModule('a')], [V21_PLUGIN]))

        expect(isPlainArray(DBState.db.modules[0].assets)).toBe(true)
    })

    test('a disabled V2.1 plugin or an enabled V3 plugin does not stop the conversion', () => {
        setDatabase(makeDb([makeModule('a')], [{ ...V21_PLUGIN, enabled: false }, { ...V21_PLUGIN, version: '3.0' }]))

        expect(DBState.db.modules[0].assets instanceof AssetList).toBe(true)
    })
})

describe('serialisation of installed module asset lists', () => {
    test('guard: the modules block holds the same bytes as the plain list encodes to', async () => {
        const plainModules = [makeModule('a', 5), makeModule('b', 2)]
        const expectedJson = JSON.stringify(plainModules)
        setDatabase(makeDb([makeListed('a', 5), makeListed('b', 2)]))
        expect(DBState.db.modules[0].assets instanceof AssetList).toBe(true)

        const blockOf = async (modules: unknown) => {
            const encoder = new RisuSaveEncoder()
            await encoder.init({ ...getDatabase({ snapshot: true }), modules } as Database, { compression: false })
            const blocks = listEncodedBlocks(new Uint8Array(encoder.encode()!))
            return blocks.find((b) => b.type === RisuSaveType.MODULES)!.data
        }

        const installedBlock = await blockOf(getDatabase().modules)
        const plainBlock = await blockOf(JSON.parse(expectedJson))
        expect(JSON.stringify(getDatabase().modules)).toBe(expectedJson)
        expect(Buffer.from(installedBlock).equals(Buffer.from(plainBlock))).toBe(true)
    })

    test('guard: a .bin written from the installed database decodes to plain arrays with the same tuples', async () => {
        const plainModules = [makeModule('a', 4)]
        setDatabase(makeDb([makeListed('a', 4)]))

        const encoder = new RisuSaveEncoder()
        await encoder.init(getDatabase({ snapshot: true }), { compression: false })
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))

        expect(isPlainArray(decoded.modules[0].assets)).toBe(true)
        expect(decoded.modules[0].assets).toEqual(plainModules[0].assets)
    })

    test('guard: the legacy msgpack encoding of a raw installed list decodes to a plain array', async () => {
        const plainModules = [makeModule('a', 4)]
        setDatabase(makeDb([makeListed('a', 4)]))

        const bytes = encodeRisuSaveLegacy({ modules: [{ assets: DBState.db.modules[0].assets }] })
        const decoded = await decodeRisuSave(bytes)

        expect(isPlainArray(decoded.modules[0].assets)).toBe(true)
        expect(decoded.modules[0].assets).toEqual(plainModules[0].assets)
    })

    test('guard: the V3 snapshot and structuredClone give plain arrays', () => {
        setDatabase(makeDb([makeListed('a', 4)]))

        const snapshot = getDatabase({ snapshot: true })
        expect(isPlainArray(snapshot.modules[0].assets)).toBe(true)
        expect(isPlainArray(structuredClone(DBState.db.modules[0].assets))).toBe(true)
        expect(snapshot.modules[0].assets).toEqual(makeTuples('a', 4))
    })
})

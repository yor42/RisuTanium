// @vitest-environment happy-dom

/**
 * A plugin's write-back of `modules` (`writeSetterKeys` in `plugins.svelte.ts`,
 * reached through the V2 `setDatabase` and `setDatabaseLite`) installs each
 * module's asset list as an `AssetList` built from the plugin's own tuples, so
 * the list never enters the reactive graph and the live database does not
 * share a tuple with the plugin. The real `plugins.svelte.ts`, the real
 * `database.svelte.ts` and the real `registerDbChangeEffects` run over a
 * `$state` stand-in for `DBState`; cold storage, alerts and the V3 loader are
 * mocks.
 *
 * Titles beginning "guard:" pin behaviour that must be preserved and may pass
 * before and after the change; every other test is a regression reproducer for
 * the behaviour it names. Where a behaviour is tested for each setter, the
 * `setDatabase` case can already pass before the change, because its
 * installing pass wrapped the lists afterwards, at the cost the symbol-probe
 * test counts; the `setDatabaseLite` case is the reproducer.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

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
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        hotReloading: writable(false),
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
    } as unknown as typeof import('../../stores.svelte')
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
    alertAddCharacter: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    selectMultipleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(async () => {}),
    fetchNative: vi.fn(),
    getFileSrc: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    requiresFullEncoderReload: { state: false },
    saveAsset: vi.fn(async () => ''),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

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

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
    setColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('../../media'))

vi.mock(import('../../media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('../../media/avatarThumb'))

vi.mock(import('../../process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((cha: unknown) => cha),
}) as unknown as typeof import('../../process/inlayScreen'))

vi.mock(import('../../parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../../process/index.svelte'))

vi.mock(import('../../characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('../../characterCards'))

vi.mock(import('../../pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('../../pngChunk'))

vi.mock(import('../../gui/colorscheme'), () => ({
    defaultColorScheme: { bgcolor: '#000000' },
}) as unknown as typeof import('../../gui/colorscheme'))

vi.mock(import('../../process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('../../process/memory/hypav3'))

vi.mock(import('../../translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('../../translator/presets'))

vi.mock(import('../../polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('../../polyfill'))

vi.mock(import('../../model/modellist'), async () => {
    const types = await import('../../model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
    }
})

vi.mock('../../rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

//#endregion

import { getV2PluginAPIs } from '../plugins.svelte'
import type { RisuPlugin } from '../plugins.svelte'
import { DBState } from '../../stores.svelte'
import { setDatabase, getDatabase, type Database } from '../../storage/database.svelte'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, listEncodedBlocks, RisuSaveType, type toSaveType } from '../../storage/risuSave'
import { AssetList, toAssetList, type AssetTuple } from '../../storage/assetList'
import type { RisuModule } from '../../process/modules'

//#region fixtures

type Setter = 'setDatabase' | 'setDatabaseLite'
const SETTERS: Setter[] = ['setDatabase', 'setDatabaseLite']

function makeTuples(seed: string, count = 3): AssetTuple[] {
    const out: AssetTuple[] = []
    for (let i = 0; i < count; i++) {
        out.push([`name-${seed}-${i}`, `assets/path-${seed}-${i}`, 'png'])
    }
    return out
}

function makeModule(seed: string, count = 3): RisuModule {
    return { name: `Module ${seed}`, description: `Description ${seed}`, id: `id-${seed}`, lorebook: [], regex: [], trigger: [], assets: makeTuples(seed, count) }
}

function v3Plugin(name: string): RisuPlugin {
    return {
        name,
        script: `//@name ${name}\n//@api 3.0\n//@version 1.0.0\n// body`,
        arguments: {},
        realArg: {},
        version: '3.0',
        customLink: [],
        argMeta: {},
        versionOfPlugin: '1.0.0',
        updateURL: '',
        allowedIPC: [],
        enabled: true,
    } as RisuPlugin
}

function installDb(modules: RisuModule[], plugins: RisuPlugin[] = []): void {
    setDatabase({ modules, plugins, pluginCustomStorage: {}, characters: [], characterOrder: [] } as unknown as Database)
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

/** Calls the plugin-facing setter the way a plugin does, and waits for it. */
async function write(setter: Setter, newDb: Record<string, unknown>): Promise<void> {
    const api = getV2PluginAPIs()
    await api[setter](newDb as never)
    flushSync()
}

beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    cleanup?.()
    cleanup = undefined
    vi.restoreAllMocks()
})

const liveModules = () => DBState.db.modules as RisuModule[]

//#endregion

describe('a plugin write-back of modules installs AssetLists', () => {
    test('setDatabase leaves every module asset list an AssetList', async () => {
        installDb([makeModule('old')])
        await write('setDatabase', { modules: [makeModule('a'), makeModule('b')] })

        expect(liveModules()).toHaveLength(2)
        for (const mod of liveModules()) {
            expect(mod.assets instanceof AssetList).toBe(true)
        }
        expect(liveModules()[1].assets).toEqual(makeTuples('b'))
    })

    test('setDatabaseLite with no plugin-list change leaves every module asset list an AssetList', async () => {
        installDb([makeModule('old')])
        await write('setDatabaseLite', { modules: [makeModule('a'), makeModule('b')] })

        for (const mod of liveModules()) {
            expect(mod.assets instanceof AssetList).toBe(true)
        }
        expect(liveModules()[0].assets).toEqual(makeTuples('a'))
    })

    test('setDatabaseLite with a plugin-list change confirmed through the prompt leaves every module asset list an AssetList', async () => {
        installDb([makeModule('old')])
        await write('setDatabaseLite', { modules: [makeModule('a'), makeModule('b')], plugins: [v3Plugin('plug-new')] })

        expect(DBState.db.plugins.map((p: RisuPlugin) => p.name)).toEqual(['plug-new'])
        for (const mod of liveModules()) {
            expect(mod.assets instanceof AssetList).toBe(true)
        }
    })
})

describe('the live database does not share the plugin tuples', () => {
    test.each(SETTERS)('%s: editing the plugin tuples after the call leaves the live lists unchanged', async (setter) => {
        installDb([makeModule('old')])
        const incoming = [makeModule('a'), makeModule('b')]
        await write(setter, { modules: incoming })

        incoming[0].assets![0][0] = 'edited-by-plugin'
        incoming[0].assets!.push(['late', 'late-path', 'png'])
        incoming[1].assets!.splice(0, 1)

        expect(liveModules()[0].assets).toEqual(makeTuples('a'))
        expect(liveModules()[1].assets).toEqual(makeTuples('b'))
    })

    test.each(SETTERS)('%s: no incoming tuple is asked for the reactive marker symbol', async (setter) => {
        // Svelte checks a value for its state marker before wrapping it, and
        // that check reaches a `has` trap. Wrapping a list therefore costs one
        // such probe per tuple; an installed AssetList costs none.
        installDb([makeModule('old')])
        let symbolProbes = 0
        const watched = (tuple: AssetTuple): AssetTuple => new Proxy(tuple, {
            has(target, key) {
                if (typeof key === 'symbol') {
                    symbolProbes += 1
                }
                return key in target
            },
        })
        const incoming = [makeModule('a'), makeModule('b')]
        for (const mod of incoming) {
            mod.assets = mod.assets!.map(watched)
        }
        const tracker = registerEffects()
        tracker.modules = false

        await write(setter, { modules: incoming })

        expect(tracker.modules).toBe(true)
        expect(symbolProbes).toBe(0)
    })
})

describe('the conversion rule', () => {
    test('guard: V3-shaped structuredClone input converts and the plugin input is left as it was', async () => {
        installDb([makeModule('old')])
        const incoming = structuredClone([makeModule('a'), makeModule('b')])
        const before = structuredClone(incoming)

        await write('setDatabase', { modules: incoming })

        expect(incoming).toEqual(before)
        expect(isPlainArray(incoming[0].assets)).toBe(true)
        expect(liveModules().every((mod) => mod.assets instanceof AssetList)).toBe(true)
    })

    test.each(SETTERS)('%s passes a module with no assets and a module with a non-array assets through', async (setter) => {
        installDb([makeModule('old')])
        const bare = { name: 'bare', description: '', id: 'id-bare' } as RisuModule
        const odd = { name: 'odd', description: '', id: 'id-odd', assets: 'not a list' } as unknown as RisuModule

        await write(setter, { modules: [bare, odd, makeModule('a')] })

        expect(liveModules()[0].assets).toBeUndefined()
        expect(liveModules()[1].assets).toBe('not a list')
        expect(liveModules()[2].assets instanceof AssetList).toBe(true)
    })

    test.each(SETTERS)('%s passes a module that is not a plain object through', async (setter) => {
        installDb([makeModule('old')])
        class ModuleLike {
            name = 'like'
            assets = makeTuples('like')
        }
        const like = new ModuleLike()

        await write(setter, { modules: [null, 'text', like, makeModule('a')] })

        expect(liveModules()[0]).toBeNull()
        expect(liveModules()[1]).toBe('text')
        expect(liveModules()[2]).toBe(like)
        expect(liveModules()[3].assets instanceof AssetList).toBe(true)
    })

    test.each(SETTERS)('%s keeps a non-array entry as it is and turns a hole into undefined', async (setter) => {
        installDb([makeModule('old')])
        const sparse = makeModule('a')
        const entries: unknown[] = ['plain-entry', ['n', 'p', 'png']]
        entries.length = 4
        sparse.assets = entries as AssetTuple[]

        await write(setter, { modules: [sparse] })

        const assets = liveModules()[0].assets as unknown as unknown[]
        expect(assets instanceof AssetList).toBe(true)
        expect(assets).toHaveLength(4)
        expect(assets[0]).toBe('plain-entry')
        expect(assets[1]).toEqual(['n', 'p', 'png'])
        expect(assets[2]).toBeUndefined()
        expect(assets[3]).toBeUndefined()
        expect(2 in assets).toBe(true)
    })

    test.each(SETTERS)('guard: %s with the live modules array assigns it as it is', async (setter) => {
        installDb([makeModule('a')])
        const liveBefore = getDatabase().modules
        const listBefore = liveModules()[0].assets

        await write(setter, { modules: getDatabase().modules })

        expect(getDatabase().modules).toBe(liveBefore)
        expect(liveModules()[0].assets).toBe(listBefore)
    })

    test.each(SETTERS)('%s passes a live module and a spread of a live module through', async (setter) => {
        installDb([makeModule('a'), makeModule('b')])
        const liveA = liveModules()[0]
        const listB = liveModules()[1].assets
        const spreadOfB = { ...liveModules()[1], name: 'renamed' }

        await write(setter, { modules: [liveA, spreadOfB, makeModule('c')] })

        // Identity, not equality: a copy of a live list would be a second installation of its tuples.
        expect(liveModules()[0].assets).toBe(liveA.assets)
        expect(liveModules()[1].assets).toBe(listB)
        expect(liveModules()[1].name).toBe('renamed')
        expect(liveModules()[2].assets instanceof AssetList).toBe(true)
    })

    // Only `setDatabaseLite`: the `setDatabase` install wraps a plain list afterwards whatever came in.
    test('guard: setDatabaseLite passes a live module and a spread of a live module through when their lists are plain arrays', async () => {
        installDb([makeModule('a')])
        // A module added to the live database after the install holds a plain list.
        liveModules().push(makeModule('late'))
        const liveLate = liveModules()[1]
        const plainList = liveLate.assets
        expect(isPlainArray(plainList)).toBe(true)
        const spreadOfLate = { ...liveLate, name: 'renamed' }

        await write('setDatabaseLite', { modules: [liveLate, spreadOfLate] })

        // Identity, not equality: converting would copy tuples that are already installed.
        expect(liveModules()[0].assets).toBe(plainList)
        expect(liveModules()[1].assets).toBe(plainList)
        expect(liveModules()[1].name).toBe('renamed')
    })

    test.each(SETTERS)('guard: %s keeps an incoming AssetList as it is', async (setter) => {
        installDb([makeModule('old')])
        const listed = { ...makeModule('a'), assets: toAssetList(makeTuples('a')) }

        await write(setter, { modules: [listed] })

        expect(liveModules()[0].assets).toBe(listed.assets)
    })

    test.each(SETTERS)('guard: %s marks the modules block dirty', async (setter) => {
        installDb([makeModule('old')])
        const tracker = registerEffects()
        tracker.modules = false

        await write(setter, { modules: [makeModule('a')] })

        expect(tracker.modules).toBe(true)
    })

    test.each(SETTERS)('guard: %s writes the same modules block as the plain list encodes to', async (setter) => {
        installDb([makeModule('old')])
        const plain = [makeModule('a', 5), makeModule('b', 2)]
        const expectedJson = JSON.stringify(plain)

        await write(setter, { modules: [makeModule('a', 5), makeModule('b', 2)] })

        const blockOf = async (modules: unknown) => {
            const encoder = new RisuSaveEncoder()
            await encoder.init({ ...getDatabase({ snapshot: true }), modules } as Database, { compression: false })
            const blocks = listEncodedBlocks(new Uint8Array(encoder.encode()!))
            return blocks.find((b) => b.type === RisuSaveType.MODULES)!.data
        }
        expect(JSON.stringify(getDatabase().modules)).toBe(expectedJson)
        expect(Buffer.from(await blockOf(getDatabase().modules)).equals(Buffer.from(await blockOf(JSON.parse(expectedJson))))).toBe(true)
    })
})

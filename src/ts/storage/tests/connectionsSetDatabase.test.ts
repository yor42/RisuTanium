// @vitest-environment happy-dom

/**
 * The load migration of the chat keys, driven through the REAL `setDatabase` (`src/ts/storage/database.svelte.ts`) with the
 * module mocks of `databaseHypaModelDefault.test.ts`. Producer-built presets come from `upstreamSaveCurrentPreset`.
 *
 * Compat file: it imports no module that is new with connections (type-only imports aside), so it also runs against the
 * tree before connections existed. Reproducers (T1-T4d, T23, T24, T26, T26b) fail there because no connection is created;
 * the guards (T5, T5r, T-none) pass before and after. Every assertion is on a field the migration owns or on a value the
 * defaults do not rewrite, so no preset or database is compared whole across `setDatabase`. Keys are synthetic.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

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
    safeStructuredClone: vi.fn((v: unknown) => structuredClone(v)),
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

// A plain mutable object is enough for `setDatabaseLite`'s `DBState.db = data` and `getDatabase()`'s read.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    selectedCharID: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

// The enums come from the light `model/types.ts`; the provider list behind `model/modellist.ts` is not needed here.
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

import { changeToPreset, setDatabase, presetTemplate, type StoredDatabase } from 'src/ts/storage/database.svelte'
import { leaseRequestKey } from 'src/ts/process/request/secretKey'
import { prebuiltPresets } from 'src/ts/process/templates/templates'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'

type Conn = { id: string, name: string, provider: string, key: string, url?: string }
type Preset = { name?: string, id?: string, slot?: number, proxyKey?: string, forceReplaceUrl?: string, openAIKey?: string, proxyConnectionId?: string }
type Model = { id: string, name?: string, key?: string, url?: string, connectionId?: string }
type Loaded = {
    connections?: Conn[]
    proxyConnectionId?: string
    openAIKey?: string
    proxyKey?: string
    forceReplaceUrl?: string
    botPresets: Preset[]
    customModels: Model[]
} & Record<string, unknown>
type Tree = Record<string, unknown>

/** Loads a tree through the real `setDatabase` and returns the same object, which the load mutates in place. */
function load(tree: Tree): Loaded {
    const data = { pluginCustomStorage: {}, characters: [], personas: [], characterOrder: [], modules: [], ...tree }
    setDatabase(data as unknown as StoredDatabase)
    return data as unknown as Loaded
}

const connectionNamed = (db: Loaded, id: string | undefined): Conn | undefined => (db.connections ?? []).find((conn) => conn.id === id)

/**
 * A database whose presets carry the pairs upstream's own `saveCurrentPreset` stores: each entry of `pairs` is the
 * working pair while that preset is saved; the working pair is left as the active preset's.
 */
function producerBuilt(pairs: Array<[string, string]>, active = 0): Tree {
    const db: Tree = { botPresets: pairs.map((_, index) => ({ name: `P${index}` })), botPresetsId: 0, forceReplaceUrl: '', proxyKey: '' }
    pairs.forEach(([url, key], index) => {
        db.botPresetsId = index
        db.forceReplaceUrl = url
        db.proxyKey = key
        upstreamSaveCurrentPreset(db as unknown as StoredDatabase)
    })
    db.botPresetsId = active
    db.forceReplaceUrl = pairs[active][0]
    db.proxyKey = pairs[active][1]
    return db
}

const legacyKeys = (): Tree => ({
    openAIKey: 'sk-a\nsk-b',
    mistralKey: '${MISTRAL}',
    claudeAPIKey: 'sk-ant',
})

const migrationOwned = (db: Loaded) => ({
    connections: db.connections,
    proxyConnectionId: db.proxyConnectionId,
    openAIKey: db.openAIKey,
    mistralKey: db.mistralKey,
    claudeAPIKey: db.claudeAPIKey,
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a legacy database is absorbed into connections by setDatabase', () => {
    // regression reproducer: T1
    test('T1: each non-empty legacy key becomes one connection and the legacy fields are cleared', () => {
        const db = load(legacyKeys())

        expect(db.connections).toContainEqual(expect.objectContaining({ provider: 'openai', key: 'sk-a\nsk-b' }))
        expect(db.connections).toContainEqual(expect.objectContaining({ provider: 'mistral', key: '${MISTRAL}' }))
        expect(db.connections).toContainEqual(expect.objectContaining({ provider: 'anthropic', key: 'sk-ant' }))
        expect(db.openAIKey).toBe('')
        expect(db.mistralKey).toBe('')
        expect(db.claudeAPIKey).toBe('')
    })

    // regression reproducer: T2
    test('T2: the live working pair wins and the active preset keeps its own stale pair as a separate connection', () => {
        const tree = producerBuilt([['https://stale.invalid/v1', 'K-stale'], ['https://other.invalid/v1', 'K-other']])
        tree.forceReplaceUrl = 'https://p.invalid/v1'
        tree.proxyKey = 'K-live'

        const db = load(tree)

        expect(connectionNamed(db, db.proxyConnectionId)).toMatchObject({ provider: 'reverse_proxy', key: 'K-live', url: 'https://p.invalid/v1' })
        expect(connectionNamed(db, db.botPresets[0].proxyConnectionId)).toMatchObject({ key: 'K-stale', url: 'https://stale.invalid/v1' })
    })

    // regression reproducer: T3
    test('T3: equal pairs share one connection and a different key gives a second, named after the host', () => {
        const db = load(producerBuilt([['https://p.invalid/v1', 'K1'], ['https://p.invalid/v1', 'K1'], ['https://p.invalid/v1', 'K2']]))

        const proxies = (db.connections ?? []).filter((conn) => conn.provider === 'reverse_proxy')
        expect(proxies.map((conn) => conn.name).sort()).toEqual(['p.invalid', 'p.invalid 2'])
        expect(db.botPresets[0].proxyConnectionId).toBe(db.botPresets[1].proxyConnectionId)
        expect(db.botPresets[2].proxyConnectionId).not.toBe(db.botPresets[0].proxyConnectionId)
    })

    // regression reproducer: T4
    test('T4: loading twice gives the result of loading once', () => {
        const db = load(legacyKeys())
        expect(db.connections).toHaveLength(3)
        const once = structuredClone(migrationOwned(db))

        setDatabase(db as unknown as StoredDatabase)

        expect(migrationOwned(db)).toEqual(once)
    })

    // regression reproducer: T4d
    test('T4d: two clones of one legacy database load to the same connections and references', () => {
        const tree = producerBuilt([['https://p.invalid/v1', 'K1'], ['https://p.invalid/v1', 'K1'], ['https://p.invalid/v1', 'K2']])
        const first = load(structuredClone(tree))
        expect(first.connections).toHaveLength(2)
        const second = load(structuredClone(tree))

        const references = (db: Loaded) => ({ proxyConnectionId: db.proxyConnectionId, presets: db.botPresets.map((preset) => preset.proxyConnectionId) })
        expect(second.connections).toEqual(first.connections)
        expect(references(second)).toEqual(references(first))
    })
})

describe('a stored database the migration cannot take is kept', () => {
    // compatibility guard (passes before and after): T5
    test('T5: a malformed connections store and the legacy key are kept as they were', () => {
        const db = load({ connections: 'garbage', openAIKey: 'sk-a' })

        expect(db.connections).toBe('garbage')
        expect(db.openAIKey).toBe('sk-a')
    })

    // compatibility guard (passes before and after): T5r. Pre-normalized, so `setDatabase` writes none of the fields it defaults.
    test('T5r: a write that throws part-way leaves no connection, no reference and every legacy value', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const tree = producerBuilt([['https://a.invalid/v1', 'K-a'], ['https://b.invalid/v1', 'K-b'], ['', '']], 0)
        const presets = tree.botPresets as Array<Record<string, unknown>>
        presets.forEach((preset, index) => {
            preset.id = `preset-${index}`
            preset.slot = index + 1
            preset.localNetworkMode = false
            preset.localNetworkTimeoutSec = 600
            delete preset.promptTemplate
            delete preset.openrouterProvider
        })
        Object.freeze(presets[1])
        const original = presets.map((preset) => ({ proxyKey: preset.proxyKey, forceReplaceUrl: preset.forceReplaceUrl }))

        const db = load(tree)

        expect(db.connections).toBeUndefined()
        expect(Object.hasOwn(db, 'proxyConnectionId')).toBe(false)
        db.botPresets.forEach((preset, index) => {
            expect(Object.hasOwn(preset, 'proxyConnectionId')).toBe(false)
            expect({ proxyKey: preset.proxyKey, forceReplaceUrl: preset.forceReplaceUrl }).toEqual(original[index])
        })
        expect(db.proxyKey).toBe('K-a')
        expect(db.forceReplaceUrl).toBe('https://a.invalid/v1')
    })

    // compatibility guard (passes before and after): T-none. Field-level only; the minted ids and slots are not compared.
    test('T-none: a database with nothing to absorb gains no reference and no connection field', () => {
        const rootEmpty: Tree = {
            openAIKey: '', claudeAPIKey: '', openrouterKey: '', nanogptKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '',
            novellistAPI: '', mancerHeader: '', vertexPrivateKey: '', forceReplaceUrl: '', proxyKey: '',
            google: { accessToken: '' }, novelai: { token: '' }, hordeConfig: { apiKey: '' }, OaiCompAPIKeys: {},
        }
        const presets = [structuredClone(presetTemplate), ...Object.values(prebuiltPresets).map((preset) => structuredClone(preset))] as unknown as Preset[]
        const tree: Tree = {
            ...rootEmpty,
            connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '' }],
            botPresets: presets,
            botPresetsId: 0,
            customModels: [{ id: 'm1', name: 'M1', key: '', url: '' }, { id: 'm2', name: 'M2' }],
        }
        const pairOf = (preset: Preset) => ({
            proxyKey: Object.hasOwn(preset, 'proxyKey') ? preset.proxyKey : 'absent',
            forceReplaceUrl: Object.hasOwn(preset, 'forceReplaceUrl') ? preset.forceReplaceUrl : 'absent',
            openAIKey: Object.hasOwn(preset, 'openAIKey') ? preset.openAIKey : 'absent',
        })
        const before = presets.map(pairOf)

        const db = load(tree)

        expect(Object.hasOwn(db, 'proxyConnectionId')).toBe(false)
        db.botPresets.forEach((preset, index) => {
            expect(Object.hasOwn(preset, 'proxyConnectionId')).toBe(false)
            expect(pairOf(preset)).toEqual(before[index])
        })
        for (const field of Object.keys(rootEmpty)) {
            if (typeof rootEmpty[field] === 'string') {
                expect(db[field]).toBe('')
            }
        }
        expect(db.customModels[0]).toMatchObject({ key: '', url: '' })
        expect(Object.hasOwn(db.customModels[1], 'key')).toBe(false)
        expect(Object.hasOwn(db.customModels[1], 'url')).toBe(false)
        db.customModels.forEach((model) => expect(Object.hasOwn(model, 'connectionId')).toBe(false))
        expect(db.connections).toEqual([{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '' }])
    })
})

describe('the working proxy reference follows the live working pair', () => {
    // regression reproducer: T23
    test('T23: a half pair edits its owner connection: the URL stays, the new key is stored', () => {
        const db = load({
            connections: [{ id: 'conn-1', name: 'p', provider: 'reverse_proxy', key: 'K1', url: 'https://u1.invalid/v1' }],
            proxyConnectionId: 'conn-1',
            proxyKey: 'K2',
        })

        expect(connectionNamed(db, db.proxyConnectionId)).toMatchObject({ provider: 'reverse_proxy', url: 'https://u1.invalid/v1', key: 'K2' })
    })

    // regression reproducer: T24
    test('T24: with an empty working pair the active preset keeps its stored pair as a connection it references', () => {
        const tree = producerBuilt([['https://us.invalid/v1', 'Ks'], ['https://o.invalid/v1', 'Ko']], 0)
        tree.forceReplaceUrl = ''
        tree.proxyKey = ''

        const db = load(tree)

        expect(connectionNamed(db, db.botPresets[0].proxyConnectionId)).toMatchObject({ provider: 'reverse_proxy', url: 'https://us.invalid/v1', key: 'Ks' })
        expect(db.proxyConnectionId === undefined || db.proxyConnectionId === '').toBe(true)
    })
})

describe('custom models never share one connection after a pending write', () => {
    const shared = (): Conn => ({ id: 'conn-1', name: 'c', provider: 'custom', key: 'K0', url: 'https://c.invalid' })

    // regression reproducer: T26
    test('T26: two models that name one connection each keep their own pending key', () => {
        const db = load({
            connections: [shared()],
            customModels: [
                { id: 'ma', name: 'A', key: 'kA', url: '', connectionId: 'conn-1' },
                { id: 'mb', name: 'B', key: 'kB', url: '', connectionId: 'conn-1' },
            ],
        })

        const [a, b] = db.customModels
        expect(a.connectionId).not.toBe(b.connectionId)
        expect(connectionNamed(db, a.connectionId)).toMatchObject({ provider: 'custom', key: 'kA', url: 'https://c.invalid' })
        expect(connectionNamed(db, b.connectionId)).toMatchObject({ provider: 'custom', key: 'kB', url: 'https://c.invalid' })
    })

    // regression reproducer: T26b
    test('T26b: only the model with a pending key leaves the shared connection, which keeps the other model its key', () => {
        const db = load({
            connections: [shared()],
            customModels: [
                { id: 'ma', name: 'A', key: 'kA', url: '', connectionId: 'conn-1' },
                { id: 'mb', name: 'B', key: '', url: '', connectionId: 'conn-1' },
            ],
        })

        const [a, b] = db.customModels
        expect(connectionNamed(db, a.connectionId)).toMatchObject({ key: 'kA' })
        expect(connectionNamed(db, b.connectionId)).toMatchObject({ key: 'K0' })
    })
})

describe('selecting a preset gives the working settings its own proxy', () => {
    // compatibility guard (passes before and after): T9b
    test('T9b: after a load, switching to a preset with its own pair makes that pair the one a request would use', async () => {
        load(producerBuilt([['https://u0.invalid/v1', 'K0'], ['https://u1.invalid/v1', 'K1']]))

        changeToPreset(1)

        expect(await leaseRequestKey({}, 'proxyKey')).toBe('K1')
    })
})

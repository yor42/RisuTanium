// @vitest-environment happy-dom

/**
 * The boot-write flag the load migration sets (`takeConnectionsMigrated`), read after the REAL `setDatabase`.
 *
 * Post-fix file: it imports the connections migration by value, so it makes no claim against the tree before connections
 * existed. The fixtures are those of `connectionsSetDatabase.test.ts` (T5r, T-none); the flag assertions live here so
 * that file stays runnable on the base tree.
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

import { setDatabase, presetTemplate, type StoredDatabase } from 'src/ts/storage/database.svelte'
import { takeConnectionsMigrated } from 'src/ts/connections/migrate'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'

type Tree = Record<string, unknown>

function load(tree: Tree): void {
    setDatabase({ pluginCustomStorage: {}, characters: [], personas: [], characterOrder: [], modules: [], ...tree } as unknown as StoredDatabase)
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the boot-write flag of the load migration', () => {
    test('a load that absorbed a key sets the flag once', () => {
        takeConnectionsMigrated()

        load({ openAIKey: 'sk-a' })

        expect(takeConnectionsMigrated()).toBe(true)
        expect(takeConnectionsMigrated()).toBe(false)
    })

    // T5rF: the same fixture as T5r in connectionsSetDatabase.test.ts. Kills a migration that sets the flag before its writes succeed.
    test('T5rF: a write that throws part-way does not set the flag', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const db: Tree = { botPresets: [{ name: 'P0' }, { name: 'P1' }], botPresetsId: 0, forceReplaceUrl: '', proxyKey: '' }
        const presets = db.botPresets as Array<Record<string, unknown>>
        ;[['https://a.invalid/v1', 'K-a'], ['https://b.invalid/v1', 'K-b']].forEach(([url, key], index) => {
            db.botPresetsId = index
            db.forceReplaceUrl = url
            db.proxyKey = key
            upstreamSaveCurrentPreset(db as unknown as StoredDatabase)
        })
        db.botPresetsId = 0
        db.forceReplaceUrl = 'https://a.invalid/v1'
        db.proxyKey = 'K-a'
        presets.forEach((preset, index) => {
            preset.id = `preset-${index}`
            preset.slot = index + 1
            preset.localNetworkMode = false
            preset.localNetworkTimeoutSec = 600
            delete preset.promptTemplate
            delete preset.openrouterProvider
        })
        Object.freeze(presets[1])
        takeConnectionsMigrated()

        load(db)

        expect(takeConnectionsMigrated()).toBe(false)
    })

    // T-noneF: the T-none fixture. Kills a migration that sets the flag when it planned nothing.
    test('T-noneF: a database with nothing to absorb does not set the flag', () => {
        const presets = [structuredClone(presetTemplate)]
        takeConnectionsMigrated()

        load({
            openAIKey: '', forceReplaceUrl: '', proxyKey: '', google: { accessToken: '' }, novelai: { token: '' }, hordeConfig: { apiKey: '' }, OaiCompAPIKeys: {},
            connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: '' }],
            botPresets: presets, botPresetsId: 0,
        })

        expect(takeConnectionsMigrated()).toBe(false)
    })
})

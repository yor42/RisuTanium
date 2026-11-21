// @vitest-environment happy-dom

/**
 * T5p: the load migration through the REAL `setDatabase`, over generated well-typed databases. Every reference field is
 * a string drawn mostly from the generated connection ids, so custom models often share a connection.
 *
 * Compat file: it imports only fast-check, vitest and database.svelte. Properties: the load never throws; every non-empty
 * string a legacy key-bearing position held (a preset `openAIKey` is cleared, never absorbed) is the key or URL of some
 * connection afterwards; and no two custom models that held a pending key or URL name one connection. The positions
 * `setDatabase` defaults are never generated absent or null. Odd, null and garbage values are covered by the planner
 * property in `connections/tests/migratePlannerProperty.test.ts`.
 */
import { describe, expect, test, vi } from 'vitest'
import fc from 'fast-check'

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

import { setDatabase, type StoredDatabase } from 'src/ts/storage/database.svelte'

type Conn = { id: string, name: string, provider: string, key: string, url?: string }
type Preset = { name: string, proxyKey: string, forceReplaceUrl: string, openAIKey: string, proxyConnectionId: string }
type Model = { id: string, name: string, key: string, url: string, connectionId: string }
type Tree = {
    connections?: Conn[]
    proxyConnectionId: string
    proxyKey: string
    forceReplaceUrl: string
    botPresets: Preset[]
    botPresetsId: number
    customModels: Model[]
    google: { accessToken: string }
    novelai: { token: string }
    hordeConfig: { apiKey: string }
    OaiCompAPIKeys: Record<string, string>
} & Record<string, string | number | boolean | object | undefined>

const ROOT_KEY_FIELDS = ['openAIKey', 'claudeAPIKey', 'openrouterKey', 'nanogptKey', 'mistralKey', 'cohereAPIKey', 'ollamaApiKey', 'novellistAPI', 'mancerHeader', 'vertexPrivateKey'] as const

const text = fc.constantFrom('', '', 'k1', 'k2', 'L1\nL2', '${NAME}', 'https://u.invalid/v1', 'https://w.invalid')
const ids = ['conn-1', 'conn-2', 'conn-3', 'conn-4']
const reference = fc.oneof({ weight: 6, arbitrary: fc.constantFrom(...ids) }, { weight: 1, arbitrary: fc.constantFrom('', 'conn-99') })

const connection = (index: number) => fc.record({
    id: fc.constant(ids[index]),
    name: fc.constant(`c${index}`),
    provider: fc.constantFrom('custom', 'reverse_proxy', 'openai', 'anthropic'),
    key: text,
    url: text,
})

const tree = fc.record({
    connections: fc.option(fc.integer({ min: 0, max: 4 }).chain((count) => fc.tuple(...Array.from({ length: count }, (_, index) => connection(index)))), { nil: undefined }),
    proxyConnectionId: reference,
    proxyKey: text,
    forceReplaceUrl: text,
    botPresets: fc.array(fc.record({ name: fc.constant('p'), proxyKey: text, forceReplaceUrl: text, openAIKey: text, proxyConnectionId: reference }), { maxLength: 3 }),
    botPresetsId: fc.constant(0),
    customModels: fc.array(fc.record({ id: fc.constant(''), name: fc.constant('m'), key: text, url: text, connectionId: reference }), { minLength: 2, maxLength: 4 }).map((models) => models.map((model, index) => ({ ...model, id: `m${index}` }))),
    google: fc.record({ accessToken: text }),
    novelai: fc.record({ token: text }),
    hordeConfig: fc.record({ apiKey: text }),
    OaiCompAPIKeys: fc.dictionary(fc.constantFrom('deepinfra', 'deepseek'), text),
    openAIKey: text, claudeAPIKey: text, openrouterKey: text, nanogptKey: text, mistralKey: text,
    cohereAPIKey: text, ollamaApiKey: text, novellistAPI: text, mancerHeader: text, vertexPrivateKey: text,
}) as unknown as fc.Arbitrary<Tree>

/** Every non-empty string a legacy key-bearing position holds, a preset `openAIKey` excepted. */
function pendingStrings(db: Tree): string[] {
    const out: string[] = []
    const take = (value: unknown) => {
        if (typeof value === 'string' && value !== '') {
            out.push(value)
        }
    }
    for (const field of ROOT_KEY_FIELDS) {
        take(db[field])
    }
    take(db.proxyKey)
    take(db.forceReplaceUrl)
    take(db.google.accessToken)
    take(db.novelai.token)
    take(db.hordeConfig.apiKey)
    Object.values(db.OaiCompAPIKeys).forEach(take)
    db.botPresets.forEach((preset) => { take(preset.proxyKey); take(preset.forceReplaceUrl) })
    db.customModels.forEach((model) => { take(model.key); take(model.url) })
    return out
}

describe('the load migration over generated databases', () => {
    test('T5p: it never throws, loses no legacy string and gives pending custom models their own connections', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        fc.assert(fc.property(tree, (generated) => {
            const data = { pluginCustomStorage: {}, characters: [], personas: [], characterOrder: [], modules: [], ...structuredClone(generated) }
            const pending = pendingStrings(generated)
            const holders = generated.customModels.map((model) => model.key !== '' || model.url !== '')

            expect(() => setDatabase(data as unknown as StoredDatabase)).not.toThrow()

            const stored = new Set((data.connections ?? []).flatMap((conn) => [conn.key, conn.url ?? '']))
            for (const value of pending) {
                expect(stored.has(value)).toBe(true)
            }
            const named = data.customModels.filter((_, index) => holders[index]).map((model) => model.connectionId)
            expect(new Set(named).size).toBe(named.length)
        }), { numRuns: 200 })
    })
})

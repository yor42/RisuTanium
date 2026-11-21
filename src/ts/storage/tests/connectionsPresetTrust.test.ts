// @vitest-environment happy-dom

/**
 * A preset that leaves the machine (shared) or comes in from elsewhere (imported) never carries or chooses a local
 * connection, nor the URL for a local key. Drives the REAL `downloadPreset` and `importPreset`
 * (`src/ts/storage/database.svelte.ts`) with the module mocks of `databaseHypaModelDefault.test.ts`.
 *
 * Compat file: it imports no module that is new with connections (type-only imports aside), so it also runs against the
 * tree before connections existed. T12 and T17 are reproducers: before connections existed no field named
 * `proxyConnectionId` was removed, so a preset holding one kept it. T17b-T17d pin the rest of the import rule.
 * Keys are synthetic.
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

// The vault answers every unwrap with the synthetic plain of the T40 fixture.
vi.mock('src/ts/android/keyVault', () => ({
    unwrapKey: vi.fn(async () => ({ ok: true, value: 'K-wrapped-plain' })),
    wrapKey: vi.fn(() => new Promise(() => {})),
    watchdogFired: () => false,
}))

//#endregion

import { installVaultHost, resetVaultStoreForTest, unwrapAllForBoot } from 'src/ts/connections/keyVaultStore.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { downloadPreset, importPreset, type StoredDatabase } from 'src/ts/storage/database.svelte'

type Preset = { name?: string, openAIKey?: string, proxyKey?: string, forceReplaceUrl?: string, proxyConnectionId?: string, id?: string }
type Conn = { id: string, name: string, provider: string, key: string, url?: string }
type Page = { connections?: Conn[] | string, botPresets: Preset[], botPresetsId: number } & Record<string, unknown>

function installPage(extra: Record<string, unknown>): Page {
    const page = { characters: [], botPresets: [], botPresetsId: -1, ...extra } as unknown as Page
    ;(DBState as unknown as { db: StoredDatabase }).db = page as unknown as StoredDatabase
    return page
}

function importJson(preset: Record<string, unknown>): Promise<unknown> {
    return importPreset({ name: 'shared.json', data: new TextEncoder().encode(JSON.stringify(preset)) })
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a shared preset carries no local connection', () => {
    // regression reproducer: T12
    test('T12: a downloaded preset that holds a connection reference leaves it out', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        installPage({
            connections: [{ id: 'conn-1', name: 'p', provider: 'reverse_proxy', key: 'K1', url: 'https://p.invalid/v1' }],
            botPresets: [{ name: 'P0' }, { name: 'P1', proxyConnectionId: 'conn-1', proxyKey: 'K1', forceReplaceUrl: 'https://p.invalid/v1' }],
        })

        const shared = await downloadPreset(1, 'return')

        const data = shared.data as Preset
        expect(Object.hasOwn(data, 'proxyConnectionId')).toBe(false)
        expect(data.proxyKey ?? '').toBe('')
        expect(data.forceReplaceUrl ?? '').toBe('')
    })
})

describe('an imported preset never chooses a local connection', () => {
    // regression reproducer: T17
    test('T17: a reference the file carries is dropped', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const page = installPage({ connections: [{ id: 'conn-1', name: 'p', provider: 'reverse_proxy', key: 'K1', url: 'https://p.invalid/v1' }] })

        await importJson({ name: 'Foreign', proxyConnectionId: 'conn-1' })

        expect(page.botPresets).toHaveLength(1)
        expect(Object.hasOwn(page.botPresets[0], 'proxyConnectionId')).toBe(false)
    })

    // regression reproducer: T17b
    test('T17b: a proxy key the file carries moves into the store with an empty URL, and the preset keeps no key', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const page = installPage({ connections: [] })

        await importJson({ name: 'Foreign', proxyKey: 'K-share', forceReplaceUrl: 'https://attacker.invalid/v1' })

        const preset = page.botPresets[0]
        const store = page.connections as Conn[]
        expect(preset.proxyKey).toBe('')
        expect(preset.forceReplaceUrl).toBe('')
        expect(store).toHaveLength(1)
        expect(store[0]).toMatchObject({ provider: 'reverse_proxy', key: 'K-share', url: '' })
        expect(preset.proxyConnectionId).toBe(store[0].id)
    })

    // regression reproducer: T17c
    test('T17c: the OpenAI key a file carries is cleared', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const page = installPage({})

        await importJson({ name: 'Foreign', openAIKey: 'sk-foreign' })

        expect(page.botPresets[0].openAIKey).toBe('')
    })

    // guard (new rule): T40. The duplicate check compares the readable key, not the raw key field.
    test('T40: a proxy key equal to a wrapped proxy readable plain reuses that connection', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const wrapped = { id: 'conn-1', name: 'p', provider: 'reverse_proxy', key: '', keyWrapped: 'ENVELOPE', url: '' }
        const page = installPage({ connections: [wrapped] })
        const list = () => page.connections as Conn[]
        installVaultHost({
            platform: 'vault',
            findConnection: (id) => (list() as unknown as import('src/ts/connections/connections').Connection[]).find((conn) => conn.id === id),
            listConnections: () => list() as unknown as import('src/ts/connections/connections').Connection[],
            requestSaveNow: () => {},
            markBootWrite: () => {},
            isReadOnlyPage: () => false,
            notify: { keepPlain: () => {}, wrapped: () => {}, reentry: () => {} },
            messages: { keyUnavailable: () => 'unavailable' },
        })
        await unwrapAllForBoot()

        await importJson({ name: 'Foreign', proxyKey: 'K-wrapped-plain', forceReplaceUrl: 'https://attacker.invalid/v1' })

        expect(list()).toHaveLength(1)
        expect(page.botPresets[0].proxyConnectionId).toBe('conn-1')
        expect(page.botPresets[0].proxyKey).toBe('')
        resetVaultStoreForTest()
    })

    // compatibility guard (passes before and after): T17d. A store the migration cannot read is kept as it was.
    test('T17d: a malformed store is left alone', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const page = installPage({ connections: 'garbage' })

        await importJson({ name: 'Foreign', proxyKey: 'K-share' })

        expect(page.connections).toBe('garbage')
    })
})

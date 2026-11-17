// @vitest-environment happy-dom

/**
 * HypaV3 preset list at load. Every preset carries a persisted `id`; a list or
 * active index the runtime cannot use is repaired, and anything it can use is
 * left in place. The REAL `setDatabase`/`getDatabase`
 * (`src/ts/storage/database.svelte.ts`) run with the module mocks of
 * `databaseSupaModelType.test.ts`; the preset module is not mocked.
 */

import { describe, expect, test, vi } from 'vitest'

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

// A plain mutable object is enough for `setDatabase`'s `DBState.db = data`.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    selectedCharID: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

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

import { setDatabase, getDatabase, type Database } from 'src/ts/storage/database.svelte'

type PresetRoot = Pick<Database, 'hypaV3Presets' | 'hypaV3PresetId'>

// Shaped like the producer: a preset as the settings page and upstream write
// it, `{name, settings}` with a full settings object, plus an optional id.
function presetOf(name: string, id?: string, memoryTokensRatio = 0.2) {
    return {
        ...(id === undefined ? {} : { id }),
        name,
        settings: {
            summarizationModel: 'subModel',
            summarizationPrompt: '',
            reSummarizationPrompt: '',
            memoryTokensRatio,
            extraSummarizationRatio: 0,
            maxChatsPerSummary: 6,
            recentMemoryRatio: 0.4,
            similarMemoryRatio: 0.4,
            enableSimilarityCorrection: false,
            preserveOrphanedMemory: false,
            processRegexScript: false,
            doNotSummarizeUserMessage: false,
            summaryChunkSeparator: '\\n\\n',
            useExperimentalImpl: false,
            summarizationRequestsPerMinute: 20,
            summarizationMaxConcurrent: 1,
            embeddingRequestsPerMinute: 100,
            embeddingMaxConcurrent: 1,
            alwaysToggleOn: false,
            queryChatCount: 3,
        },
    }
}

function loadWith(presets: object[] | undefined, index: unknown): PresetRoot {
    setDatabase({ hypaV3Presets: presets, hypaV3PresetId: index, pluginCustomStorage: {} } as unknown as Database)
    const db = getDatabase()
    return { hypaV3Presets: db.hypaV3Presets, hypaV3PresetId: db.hypaV3PresetId }
}

describe('setDatabase preset ids', () => {
    test('regression: a saved preset id survives load', () => {
        const loaded = loadWith([presetOf('A', 'p1'), presetOf('B', 'p2')], 1)
        expect(loaded.hypaV3Presets.map((p) => p.id)).toEqual(['p1', 'p2'])
    })

    test('regression: id-less presets load with unique ids, which a second load keeps', () => {
        const loaded = loadWith([presetOf('A'), presetOf('B'), presetOf('C')], 0)
        const ids = loaded.hypaV3Presets.map((p) => p.id)
        expect(new Set(ids).size).toBe(3)
        for (const id of ids) {
            expect(typeof id).toBe('string')
            expect(id).not.toBe('')
        }
        const again = loadWith(loaded.hypaV3Presets, 0)
        expect(again.hypaV3Presets.map((p) => p.id)).toEqual(ids)
    })

    test('guard: presets keep their order, names and settings', () => {
        const source = [presetOf('Zeta'), presetOf('Alpha', undefined, 0.3), presetOf('Mid')]
        const loaded = loadWith(source, 2)
        expect(loaded.hypaV3Presets.map((p) => p.name)).toEqual(['Zeta', 'Alpha', 'Mid'])
        expect(loaded.hypaV3Presets[1].settings.memoryTokensRatio).toBe(0.3)
        expect(loaded.hypaV3PresetId).toBe(2)
    })

    test('new rule: duplicate and blank ids are re-minted, the first holder keeps its id', () => {
        const loaded = loadWith([presetOf('A', 'same'), presetOf('B', 'same'), presetOf('C', '')], 0)
        const ids = loaded.hypaV3Presets.map((p) => p.id)
        expect(ids[0]).toBe('same')
        expect(new Set(ids).size).toBe(3)
        expect(ids[2]).not.toBe('')
    })
})

describe('setDatabase preset list and active index', () => {
    test('regression: an empty list gets one Default preset at index 0', () => {
        const loaded = loadWith([], 0)
        expect(loaded.hypaV3Presets).toHaveLength(1)
        expect(loaded.hypaV3Presets[0].name).toBe('Default')
        expect(loaded.hypaV3PresetId).toBe(0)
    })

    test.each([5, -1, 1.5, '01', 'length'])('regression: an index %j that names no preset goes to 0', (index) => {
        const loaded = loadWith([presetOf('A'), presetOf('B'), presetOf('C')], index)
        expect(loaded.hypaV3PresetId).toBe(0)
    })

    test.each([null, undefined])('guard: a %s index loads as 0 (as before)', (index) => {
        const loaded = loadWith([presetOf('A'), presetOf('B')], index)
        expect(loaded.hypaV3PresetId).toBe(0)
    })

    test('guard: the string "1" already resolves to preset 1 before and after', () => {
        const source = [presetOf('A', 'a'), presetOf('B', 'b'), presetOf('C', 'c')]
        const loaded = loadWith(source, '1')
        expect(loaded.hypaV3Presets[loaded.hypaV3PresetId].name).toBe('B')
    })

    test('new rule: the string "1" becomes the number 1', () => {
        const loaded = loadWith([presetOf('A'), presetOf('B'), presetOf('C')], '1')
        expect(loaded.hypaV3PresetId).toBe(1)
    })

    test('guard: an index that names a preset is kept', () => {
        const loaded = loadWith([presetOf('A'), presetOf('B'), presetOf('C')], 2)
        expect(loaded.hypaV3PresetId).toBe(2)
    })
})

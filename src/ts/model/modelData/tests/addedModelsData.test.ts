/**
 * Pure layer of the added models: the id and name sanitisers, predicate R (a
 * saved id can still be built into a runnable entry) and predicate L (an entry
 * may be offered in the picker or created from the dataset alone),
 * `reconcileAdded`, the builder and `resolveAddedModel`.
 *
 * Labels: (F) feature test that fails against a missing or wrong implementation
 * on its own assertion; (G) guard that passes with any implementation of the
 * same contract (compatibility with today's behaviour); the named mutants are
 * the falsification of the guards.
 */
import { describe, test, expect } from 'vitest'
import {
    GPT5XHighParameters,
    ClaudeParameters,
    LLMFlags,
    LLMFormat,
    LLMProvider,
    LLMTokenizer,
    type LLMModel,
} from '../../types'
import {
    addedSpecKey,
    buildAddedModel,
    buildCatalogIndex,
    classifyAddedId,
    cleanDisplayName,
    emptyAddedState,
    isDatasetEligible,
    isDenied,
    isValidAddedId,
    openAITwins,
    predicateR,
    reconcileAdded,
    resolveAddedModel,
    type AddedFamily,
    type AddedLists,
    type AddedState,
    type CatalogIndex,
    type CatalogModel,
} from '../addedModelsData'
import { parseLiteLLMDataset, type LiteLLMData, type LiteLLMRow } from '../litellmData'
import fixture from './litellm.fixture.json'

const NOW = 1_800_000_000_000

/** A small catalog in the shapes the built-ins use: `internalID`-only matches (gpt-4o), id matches (gpt-4o-mini) and a retired entry. */
const CATALOG: CatalogModel[] = [
    { id: 'gpt4o', internalID: 'gpt-4o', provider: LLMProvider.OpenAI },
    { id: 'gpt4', internalID: 'gpt-4', provider: LLMProvider.OpenAI },
    { id: 'gpt-4o-mini', internalID: 'gpt-4o-mini', provider: LLMProvider.OpenAI },
    { id: 'gpt-4.1', internalID: 'gpt-4.1', provider: LLMProvider.OpenAI },
    { id: 'gpt-5.1', internalID: 'gpt-5.1', provider: LLMProvider.OpenAI },
    { id: 'gpt-3.5-turbo-0301', internalID: 'gpt-3.5-turbo-0301', provider: LLMProvider.OpenAI },
    { id: 'claude-opus-4-6', internalID: 'claude-opus-4-6', provider: LLMProvider.Anthropic },
    { id: 'claude-sonnet-4-5-20250929', internalID: 'claude-sonnet-4-5-20250929', provider: LLMProvider.Anthropic },
    { id: 'gemini-2.5-pro', internalID: 'models/gemini-2.5-pro', provider: LLMProvider.GoogleCloud },
    { id: 'gemini-pro', internalID: 'gemini-pro', provider: LLMProvider.GoogleCloud },
    { id: 'gem-x', internalID: 'models/gemini-q', provider: LLMProvider.GoogleCloud },
    { id: 'anthropic.claude-opus-4-6-v1', provider: LLMProvider.AWS },
]

function catalogIndex(): CatalogIndex {
    const index = buildCatalogIndex(CATALOG)
    if (index === null) {
        throw new Error('the catalog must index')
    }
    return index
}

function fixtureData(): LiteLLMData {
    const data = parseLiteLLMDataset(fixture, NOW)
    if (data === null) {
        throw new Error('the fixture must parse')
    }
    return data
}

/** Hand-made dataset rows for the cases the fixture does not hold; every row has a context unless it says otherwise. */
function datasetOf(rows: Record<string, Partial<LiteLLMRow>>): LiteLLMData {
    const out: Record<string, LiteLLMRow> = Object.create(null) as Record<string, LiteLLMRow>
    for (const [key, row] of Object.entries(rows)) {
        out[key] = { p: 'openai', m: 'chat', ctx: 1000, ...row }
    }
    return { v: 1, fetchedAt: NOW, rows: out }
}

function stateOf(lists: AddedLists, dataset: LiteLLMData | null = null): AddedState {
    return reconcileAdded(CATALOG, dataset, lists)
}

function names(ids: string[]): AddedLists {
    return { openai: ids.map(id => ({ id })) }
}

function shown(state: AddedState, family: AddedFamily): string[] {
    return state.specs.filter(spec => spec.family === family && spec.hidden === undefined).map(spec => spec.rawId).sort()
}

function hiddenOf(state: AddedState, family: AddedFamily, id: string): string | undefined {
    return state.index.get(addedSpecKey(family, id))?.hidden
}

function must(model: LLMModel | null): LLMModel {
    if (model === null) {
        throw new Error('expected the id to resolve')
    }
    return model
}

const OPENAI_FLAGS = [LLMFlags.hasStreaming, LLMFlags.OAICompletionTokens, LLMFlags.hasFullSystemPrompt, LLMFlags.hasImageInput, LLMFlags.DeveloperRole]

describe('isValidAddedId and cleanDisplayName', () => {
    test('(G) accepts plain model ids up to 200 characters', () => {
        for (const id of ['a', 'gpt-4.1', 'claude-opus-4-6-20260205', 'gemini-2.5-flash', 'A1.b-c', 'a_b', 'gpt-__proto__', 'a'.repeat(200)]) {
            expect(isValidAddedId(id), id).toBe(true)
        }
    })

    test('(F) rejects reserved prefixes, path segments, markup, separators and non-strings', () => {
        const bad: unknown[] = [
            'pluginmodel:::x', 'xcustom:::x', 'hf:::x', 'horde:::x', 'a/../../x', 'a/b', 'a:b', 'a..b', '..', '../x', '.hidden', 'tunedModels/x',
            '<img onerror=alert(1)>', 'a||b', '__proto__', 'gpt-4\n', 'gpt 4', 'gpt-é', '', '-x', 'a'.repeat(201), 'a'.repeat(10 * 1024),
            5, null, undefined, {}, [],
        ]
        for (const id of bad) {
            expect(isValidAddedId(id), String(id).slice(0, 40)).toBe(false)
        }
    })

    test('(F) names lose control characters, are trimmed and capped; non-strings and empty results are undefined', () => {
        expect(cleanDisplayName('Cl\u0000au\u0007de\n x')).toBe('Claude x')
        expect(cleanDisplayName('  padded  ')).toBe('padded')
        expect(cleanDisplayName('n'.repeat(500))).toBe('n'.repeat(100))
        expect(cleanDisplayName('\u0000\u001f')).toBeUndefined()
        expect(cleanDisplayName(7)).toBeUndefined()
        expect(cleanDisplayName(null)).toBeUndefined()
    })
})

describe('catalog index', () => {
    test('(F) no catalog, or an empty one, is no index', () => {
        expect(buildCatalogIndex(null)).toBeNull()
        expect(buildCatalogIndex([])).toBeNull()
    })

    test('(F) the exact set holds every id and internalID of the whole catalog, models/ stripped', () => {
        const { exact } = catalogIndex()
        for (const id of ['gpt4o', 'gpt-4o', 'gpt4', 'gpt-4', 'gpt-4o-mini', 'gpt-3.5-turbo-0301', 'gemini-2.5-pro', 'models/gemini-2.5-pro', 'gem-x', 'models/gemini-q', 'gemini-q', 'anthropic.claude-opus-4-6-v1']) {
            expect(exact.has(id), id).toBe(true)
        }
        expect(exact.has('gpt-9')).toBe(false)
    })
})

describe('predicate R: today\'s rule, nothing more', () => {
    const catalog = catalogIndex()

    test('(G) admits a plain id that is not an exact catalog id or internalID', () => {
        expect(predicateR('openai', 'gpt-9', catalog)).toBe(true)
        expect(predicateR('anthropic', 'claude-opus-5-5', catalog)).toBe(true)
        expect(predicateR('google', 'gemini-3.1-flash-lite', catalog)).toBe(true)
    })

    test('(F) refuses an exact catalog id, an internalID and a Google list name of a built-in', () => {
        expect(predicateR('openai', 'gpt-4o-mini', catalog)).toBe(false)
        expect(predicateR('openai', 'gpt-4o', catalog)).toBe(false)
        expect(predicateR('openai', 'gpt-4', catalog)).toBe(false)
        expect(predicateR('openai', 'gpt-3.5-turbo-0301', catalog)).toBe(false)
        expect(predicateR('google', 'gemini-2.5-pro', catalog)).toBe(false)
        expect(predicateR('anthropic', 'claude-opus-4-6', catalog)).toBe(false)
    })

    test('(F) tests the base id of a -response-api twin against the catalog', () => {
        expect(predicateR('openai', 'gpt-4o-response-api', catalog)).toBe(false)
        expect(predicateR('openai', 'gpt-4-response-api', catalog)).toBe(false)
        expect(predicateR('openai', 'gpt-9-response-api', catalog)).toBe(true)
    })

    test('(F) keeps today\'s family filter: OpenAI ids start with gpt-', () => {
        expect(predicateR('openai', 'o3', catalog)).toBe(false)
        expect(predicateR('openai', 'chat-latest', catalog)).toBe(false)
        expect(predicateR('anthropic', 'o3', catalog)).toBe(true)
    })

    test('(F) refuses an id the id rule refuses', () => {
        expect(predicateR('openai', 'gpt-a/../x', catalog)).toBe(false)
        expect(predicateR('google', 'tunedModels/x', catalog)).toBe(false)
        expect(predicateR('anthropic', 'x:::y', catalog)).toBe(false)
    })

    // (G) R has no canonical step and no deny list: compatibility with the ids today's code admits.
    test('(G) admits canonical near-duplicates and non-chat ids, which only predicate L hides', () => {
        expect(predicateR('openai', 'gpt-4.1-2025-04-14', catalog)).toBe(true)
        expect(predicateR('openai', 'gpt-5.1-2025-11-13', catalog)).toBe(true)
        expect(predicateR('anthropic', 'claude-opus-4-6-20260205', catalog)).toBe(true)
        expect(predicateR('openai', 'gpt-4o-search-preview', catalog)).toBe(true)
        expect(predicateR('openai', 'gpt-realtime', catalog)).toBe(true)
        expect(predicateR('openai', 'gpt-5-search-api', catalog)).toBe(true)
    })
})

describe('predicate L: classification of an admitted id', () => {
    const catalog = catalogIndex()

    test('(G) a new chat id is listable', () => {
        expect(classifyAddedId('openai', 'gpt-9', catalog)).toBe('listable')
        expect(classifyAddedId('openai', 'gpt-5-pro', catalog)).toBe('listable')
        expect(classifyAddedId('google', 'gemini-3.1-flash-lite', catalog)).toBe('listable')
    })

    test('(F) an id R refuses is rejected', () => {
        expect(classifyAddedId('openai', 'gpt-4o', catalog)).toBe('rejected')
        expect(classifyAddedId('openai', 'gpt-a/b', catalog)).toBe('rejected')
    })

    test('(F) a canonical near-duplicate of a built-in of the same provider is a duplicate', () => {
        expect(classifyAddedId('openai', 'gpt-4.1-2025-04-14', catalog)).toBe('duplicate')
        expect(classifyAddedId('openai', 'gpt-5.1-2025-11-13', catalog)).toBe('duplicate')
        expect(classifyAddedId('anthropic', 'claude-opus-4-6-20260205', catalog)).toBe('duplicate')
        expect(classifyAddedId('anthropic', 'claude-sonnet-4-5', catalog)).toBe('duplicate')
        expect(classifyAddedId('google', 'gemini-pro-latest', catalog)).toBe('duplicate')
    })

    test('(G) coverage is per provider: another provider\'s built-in does not cover the id', () => {
        expect(classifyAddedId('anthropic', 'gpt-4.1-2025-04-14', catalog)).toBe('listable')
        expect(classifyAddedId('google', 'claude-opus-4-6-20260205', catalog)).toBe('listable')
    })

    test('(F) non-chat ids are on the deny list, including the amended entries', () => {
        const nonChat: [AddedFamily, string][] = [
            ['openai', 'gpt-4o-mini-tts'], ['openai', 'gpt-4o-transcribe'], ['openai', 'gpt-realtime'], ['openai', 'gpt-audio'],
            ['openai', 'gpt-4o-search-preview'], ['openai', 'gpt-5-search-api'], ['openai', 'gpt-rosalind-research'], ['openai', 'gpt-5.5-cyber'],
            ['openai', 'gpt-3.5-turbo-instruct'], ['openai', 'gpt-image-1'], ['openai', 'gpt-5-deep-research'], ['openai', 'gpt-embedding-x'],
            ['openai', 'gpt-moderation-x'], ['anthropic', 'claude-computer-use-x'], ['google', 'gemini-live-2.5-flash'],
            ['google', 'gemini-2.5-flash-image'], ['google', 'lyria-3.5'], ['google', 'gemini-robotics-er-1.5-preview'],
            ['google', 'text-embedding-004'],
        ]
        for (const [family, id] of nonChat) {
            expect(isDenied(id), id).toBe(true)
            expect(classifyAddedId(family, id, catalog), id).toBe('nonchat')
        }
    })

    test('(F) the deny list matches whatever the case and treats underscores as separators', () => {
        expect(isDenied('gpt_audio')).toBe(true)
        expect(isDenied('GPT-Audio')).toBe(true)
    })

    test('(G) the deny list matches whole words: chat ids that merely contain a token stay listable', () => {
        for (const id of ['daybreak-red-latest', 'gpt-5-pro', 'gemini-2.5-flash', 'claude-opus-5-5', 'gpt-delivery', 'gpt-alive-x', 'gpt-imagery']) {
            expect(isDenied(id), id).toBe(false)
        }
    })
})

describe('dataset eligibility and the OpenAI twin policy', () => {
    const chat: LiteLLMRow = { p: 'openai', m: 'chat', ctx: 1 }

    test('(G) a chat or responses row with text output and a plain id is eligible', () => {
        expect(isDatasetEligible('openai', 'gpt-9', chat)).toBe(true)
        expect(isDatasetEligible('openai', 'gpt-9', { ...chat, m: 'responses' })).toBe(true)
        expect(isDatasetEligible('openai', 'gpt-9', { ...chat, om: ['text', 'image'] })).toBe(true)
        expect(isDatasetEligible('anthropic', 'claude-x', { ...chat, p: 'anthropic' })).toBe(true)
    })

    test('(F) output without text, an id the id rule refuses, and a non-gpt OpenAI id are not eligible', () => {
        expect(isDatasetEligible('openai', 'gpt-9', { ...chat, om: ['audio'] })).toBe(false)
        expect(isDatasetEligible('openai', 'gpt-9', { ...chat, om: [] })).toBe(false)
        expect(isDatasetEligible('openai', 'ft:gpt-3.5-turbo', chat)).toBe(false)
        expect(isDatasetEligible('openai', 'openai/container', chat)).toBe(false)
        expect(isDatasetEligible('openai', 'chat-latest', chat)).toBe(false)
        expect(isDatasetEligible('openai', 'daybreak-red-latest', chat)).toBe(false)
    })

    test('(F) the twin policy follows supported_endpoints, then the mode', () => {
        expect(openAITwins(undefined)).toEqual({ bare: true, responseApi: true })
        expect(openAITwins({ ...chat })).toEqual({ bare: true, responseApi: true })
        expect(openAITwins({ ...chat, m: 'responses' })).toEqual({ bare: false, responseApi: true })
        expect(openAITwins({ ...chat, ep: ['responses'] })).toEqual({ bare: false, responseApi: true })
        expect(openAITwins({ ...chat, ep: ['chat'] })).toEqual({ bare: true, responseApi: false })
        expect(openAITwins({ ...chat, ep: ['chat', 'responses'] })).toEqual({ bare: true, responseApi: true })
        expect(openAITwins({ ...chat, m: 'responses', ep: ['chat'] })).toEqual({ bare: true, responseApi: false })
    })
})

describe('reconcileAdded: sources', () => {
    test('(F) an id in the list and in the dataset is one entry with both sources', () => {
        const state = stateOf({ google: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }] }, fixtureData())
        const matches = state.specs.filter(spec => spec.rawId === 'gemini-2.5-flash')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({ family: 'google', displayName: 'Gemini 2.5 Flash', inList: true, inDataset: true })
        expect(matches[0].row?.p).toBe('gemini')
        expect(state.lists.google.has('gemini-2.5-flash')).toBe(true)
    })

    test('(F) the dataset alone creates the entries nothing else covers', () => {
        const state = stateOf({}, fixtureData())
        expect(shown(state, 'openai')).toEqual(['gpt-5-pro'])
        expect(shown(state, 'google')).toEqual(['gemini-2.5-flash'])
        expect(shown(state, 'anthropic')).toEqual([])
        expect(state.index.get(addedSpecKey('google', 'gemini-2.5-flash'))).toMatchObject({ inList: false, inDataset: true, displayName: 'gemini-2.5-flash' })
        expect(state.lists.openai.size).toBe(0)
    })

    test('(F) the list alone creates an entry named by the list, or by its id', () => {
        const state = stateOf({ anthropic: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }, { id: 'claude-haiku-9' }] })
        expect(state.index.get(addedSpecKey('anthropic', 'claude-opus-5-5'))).toMatchObject({ inList: true, inDataset: false, displayName: 'Claude Opus 5.5' })
        expect(state.index.get(addedSpecKey('anthropic', 'claude-haiku-9'))?.displayName).toBe('claude-haiku-9')
    })

    test('(F) the dataset deprecation date comes from the exact row only', () => {
        const dataset = datasetOf({
            'claude-x-1': { p: 'anthropic', dep: '2020-01-01' },
            'claude-x-1-20250101': { p: 'anthropic', dep: '2021-01-01' },
            'claude-x-2': { p: 'anthropic', dep: '2022-02-02' },
            'claude-only': { p: 'anthropic', dep: '2023-03-03' },
        })
        const state = stateOf({ anthropic: [{ id: 'claude-x-1' }, { id: 'claude-x-2-20250505' }] }, dataset)
        expect(state.index.get(addedSpecKey('anthropic', 'claude-x-1'))?.datasetDeprecated).toBe('2020-01-01')
        const canonicalOnly = state.index.get(addedSpecKey('anthropic', 'claude-x-2-20250505'))
        expect(canonicalOnly).toMatchObject({ inList: true, inDataset: true })
        expect(canonicalOnly?.datasetDeprecated).toBeUndefined()
        expect(state.index.get(addedSpecKey('anthropic', 'claude-only'))?.datasetDeprecated).toBe('2023-03-03')
    })

    test('(F) a dataset key canonical-equal to a listed id is covered by it, not added separately', () => {
        const dataset = datasetOf({ 'claude-q-1': { p: 'anthropic' }, 'claude-q-1-20241231': { p: 'anthropic' } })
        const state = stateOf({ anthropic: [{ id: 'claude-q-1-20250101' }] }, dataset)
        expect(shown(state, 'anthropic')).toEqual(['claude-q-1-20250101'])
        expect(state.specs[0].inDataset).toBe(true)
    })

    test('(F) canonical rows that disagree leave that field unknown for the listed id', () => {
        const dataset = datasetOf({
            'claude-z-1': { p: 'anthropic', ctx: 100, price: { input: '1', output: '2' } },
            'claude-z-1-20250101': { p: 'anthropic', ctx: 200, price: { input: '1', output: '3' } },
        })
        const spec = stateOf({ anthropic: [{ id: 'claude-z-1-20250202' }] }, dataset).specs[0]
        expect(spec.row?.ctx).toBeUndefined()
        expect(spec.row?.price).toEqual({ input: '1' })
    })

    test('(F) the exact row wins over a canonical one', () => {
        const dataset = datasetOf({
            'claude-e-1': { p: 'anthropic', ctx: 100 },
            'claude-e-1-20250101': { p: 'anthropic', ctx: 200 },
        })
        const spec = stateOf({ anthropic: [{ id: 'claude-e-1' }] }, dataset).specs[0]
        expect(spec.row?.ctx).toBe(100)
    })

    test('(F) several dataset keys of one canonical group with no list stay separate entries', () => {
        const dataset = datasetOf({ 'claude-y-1': { p: 'anthropic' }, 'claude-y-1-20250101': { p: 'anthropic' } })
        expect(shown(stateOf({}, dataset), 'anthropic')).toEqual(['claude-y-1', 'claude-y-1-20250101'])
    })

    test('(F) rows of another family never match, and a repeated list id is one entry', () => {
        const dataset = datasetOf({ 'gpt-x': { p: 'cohere_chat' } })
        const state = stateOf({ openai: [{ id: 'gpt-x' }, { id: 'gpt-x' }] }, dataset)
        expect(state.specs.filter(spec => spec.rawId === 'gpt-x')).toHaveLength(1)
        expect(state.specs.find(spec => spec.rawId === 'gpt-x')?.inDataset).toBe(false)
    })

    test('(G) specs are indexed by family and id', () => {
        const state = stateOf({ google: [{ id: 'gemini-x' }] })
        expect(state.index.get(addedSpecKey('google', 'gemini-x'))).toBe(state.specs[0])
        expect(state.index.get(addedSpecKey('openai', 'gemini-x'))).toBeUndefined()
    })
})

describe('reconcileAdded: what is hidden and what is never added', () => {
    test('(F) listed near-duplicates of a built-in are hidden as duplicates and stay resolvable', () => {
        const state = reconcileAdded(CATALOG, null, {
            openai: [{ id: 'gpt-4.1-2025-04-14' }, { id: 'gpt-5.1-2025-11-13' }],
            anthropic: [{ id: 'claude-opus-4-6-20260205' }],
            google: [{ id: 'gemini-pro-latest' }],
        })
        expect(hiddenOf(state, 'openai', 'gpt-4.1-2025-04-14')).toBe('duplicate')
        expect(hiddenOf(state, 'openai', 'gpt-5.1-2025-11-13')).toBe('duplicate')
        expect(hiddenOf(state, 'anthropic', 'claude-opus-4-6-20260205')).toBe('duplicate')
        expect(hiddenOf(state, 'google', 'gemini-pro-latest')).toBe('duplicate')
        expect(state.lists.openai.has('gpt-4.1-2025-04-14')).toBe(true)
        expect(state.lists.anthropic.has('claude-opus-4-6-20260205')).toBe(true)
        expect(state.lists.google.has('gemini-pro-latest')).toBe(true)
    })

    test('(F) listed non-chat ids are hidden as nonchat and stay resolvable', () => {
        const ids = ['gpt-4o-search-preview', 'gpt-audio', 'gpt-realtime', 'gpt-4o-mini-tts', 'gpt-5-search-api', 'gpt-5.5-cyber', 'gpt-rosalind-research']
        const state = stateOf(names(ids))
        for (const id of ids) {
            expect(hiddenOf(state, 'openai', id), id).toBe('nonchat')
            expect(state.lists.openai.has(id), id).toBe(true)
        }
        expect(shown(state, 'openai')).toEqual([])
    })

    test('(G) an exact catalog id or internalID is never added or resolved, and a retired built-in is not resurrected', () => {
        const dataset = datasetOf({ 'gpt-3.5-turbo-0301': {}, 'gpt-4': {}, 'gpt-4o': {} })
        const ids = ['gpt-4o', 'gpt-4', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4o-response-api', 'gpt-3.5-turbo-0301']
        const state = stateOf(names(ids), dataset)
        expect(state.specs).toEqual([])
        for (const id of ids) {
            expect(state.lists.openai.has(id), id).toBe(false)
        }
    })

    test('(F) the listed OpenAI ids keep today\'s gpt- filter and the id rule', () => {
        const state = stateOf(names(['o3', 'gpt-9', 'gpt-a/b', 'gpt-a..b', 'chat-latest']))
        expect([...state.lists.openai]).toEqual(['gpt-9'])
    })

    test('(F) a hostile list id never becomes an entry in any family', () => {
        const bad = ['pluginmodel:::x', 'xcustom:::x', 'hf:::x', 'horde:::x', 'a/../../x', 'a..b', '../x', 'tunedModels/x', '<img onerror=alert(1)>', 'a||b', 'a'.repeat(10 * 1024)]
        const lists: AddedLists = {
            anthropic: [...bad, 'claude-ok'].map(id => ({ id })),
            google: [...bad, 'gemini-ok'].map(id => ({ id })),
            openai: [...bad.map(id => 'gpt-' + id), 'gpt-ok'].map(id => ({ id })),
        }
        const state = stateOf(lists)
        expect(shown(state, 'anthropic')).toEqual(['claude-ok'])
        expect(shown(state, 'google')).toEqual(['gemini-ok'])
        expect(shown(state, 'openai')).toEqual(['gpt-ok'])
        expect(state.specs).toHaveLength(3)
    })

    test('(F) a hostile list name is cleaned into the display name', () => {
        const state = stateOf({ anthropic: [{ id: 'claude-ok', name: 'C\u0000laude' + 'x'.repeat(300) }] })
        expect(state.specs[0].displayName).toBe('Claude' + 'x'.repeat(94))
    })

    test('(F) the dataset never creates the ids the picker must not offer', () => {
        const dataset = datasetOf({
            'gpt-audio': { om: ['text', 'audio'] },
            'gpt-4o-search-preview': {},
            'gpt-5-search-api': {},
            'gpt-5.5-cyber': {},
            'gpt-rosalind-research': {},
            'gpt-4o-mini-transcribe': {},
            'gpt-image-1': { om: ['image'] },
            'gpt-audio-text': { om: ['audio'] },
            'computer-use-preview': {},
            'chat-latest': {},
            'daybreak-red-latest': {},
            'ft:gpt-3.5-turbo': {},
            'openai/container': {},
            'gpt-4.1-2025-04-14': {},
            'gpt-5.1-2025-11-13': {},
            'gpt-4o': {},
            'gpt-ok': {},
        })
        expect(shown(stateOf({}, dataset), 'openai')).toEqual(['gpt-ok'])
        expect(shown(stateOf({}, fixtureData()), 'openai')).toEqual(['gpt-5-pro'])
    })

    test('(F) dataset-only rows that are aliases of a built-in or exact built-ins are not created in any family', () => {
        const dataset = datasetOf({
            'claude-opus-4-6-20260205': { p: 'anthropic' },
            'claude-sonnet-4-5': { p: 'anthropic' },
            'claude-opus-5-5': { p: 'anthropic' },
            'gemini/gemini-pro-latest': { p: 'gemini' },
            'gemini-pro-latest': { p: 'gemini' },
            'gemini/gemini-2.5-pro': { p: 'gemini' },
            'gemini/lyria-3.5': { p: 'gemini', om: ['audio'] },
            'gemini/gemini-3.1-flash-lite': { p: 'gemini' },
            'gemini-9-vertex': { p: 'vertex_ai-language-models' },
        })
        const state = stateOf({}, dataset)
        expect(shown(state, 'anthropic')).toEqual(['claude-opus-5-5'])
        expect(shown(state, 'google')).toEqual(['gemini-3.1-flash-lite'])
    })

    test('(F) the twin policy is recorded on each OpenAI entry for listing', () => {
        const dataset = datasetOf({ 'gpt-5-pro': { m: 'responses', ep: ['responses'] }, 'gpt-7': { ep: ['chat', 'responses'] }, 'gpt-8': { ep: ['chat'] } })
        const state = stateOf({ openai: [{ id: 'gpt-5-pro' }, { id: 'gpt-listed-only' }] }, dataset)
        expect(state.index.get(addedSpecKey('openai', 'gpt-5-pro'))?.twins).toEqual({ bare: false, responseApi: true })
        expect(state.index.get(addedSpecKey('openai', 'gpt-listed-only'))?.twins).toEqual({ bare: true, responseApi: true })
        expect(state.index.get(addedSpecKey('openai', 'gpt-7'))?.twins).toEqual({ bare: true, responseApi: true })
        expect(state.index.get(addedSpecKey('openai', 'gpt-8'))?.twins).toEqual({ bare: true, responseApi: false })
    })

    test('(G) with no catalog nothing is created or admitted, whatever the lists and the dataset hold', () => {
        const lists: AddedLists = { openai: [{ id: 'gpt-9' }], anthropic: [{ id: 'claude-x' }], google: [{ id: 'gemini-x' }] }
        for (const none of [null, []]) {
            const state = reconcileAdded(none, fixtureData(), lists)
            expect(state.specs).toEqual([])
            expect(state.catalog).toBeNull()
            expect(state.lists.openai.size + state.lists.anthropic.size + state.lists.google.size).toBe(0)
            expect(resolveAddedModel('dynamic_google_gemini-x', state)).toBeNull()
            expect(resolveAddedModel('gpt-9', state)).toBeNull()
        }
        expect(emptyAddedState().specs).toEqual([])
    })
})

describe('resolveAddedModel: a saved id builds an entry by predicate R, not L', () => {
    const richState = () => stateOf({
        openai: [
            { id: 'gpt-5.1-2025-11-13' },
            { id: 'gpt-4.1-2025-04-14' },
            { id: 'gpt-4o-search-preview' },
            { id: 'gpt-5-pro' },
            { id: 'gpt-4o' },
            { id: 'gpt-4' },
            { id: 'gpt-4o-mini' },
        ],
    }, fixtureData())

    // (G) compatibility guards: today's code resolves these listed ids; mutants (canonical coverage
    // or the deny list applied inside R) are the falsification.
    test('(G) a listed canonical near-duplicate resolves with today\'s OpenAI entry and its Response API twin', () => {
        const entry = must(resolveAddedModel('gpt-5.1-2025-11-13', richState()))
        expect(entry).toMatchObject({
            id: 'gpt-5.1-2025-11-13',
            internalID: 'gpt-5.1-2025-11-13',
            provider: LLMProvider.OpenAI,
            format: LLMFormat.OpenAICompatible,
            flags: OPENAI_FLAGS,
            parameters: GPT5XHighParameters,
            tokenizer: LLMTokenizer.tiktokenO200Base,
        })
        const twin = must(resolveAddedModel('gpt-5.1-2025-11-13-response-api', richState()))
        expect(twin).toMatchObject({
            id: 'gpt-5.1-2025-11-13-response-api',
            internalID: 'gpt-5.1-2025-11-13',
            provider: LLMProvider.OpenAI,
            format: LLMFormat.OpenAIResponseAPI,
            flags: [...OPENAI_FLAGS, LLMFlags.hasPrefill],
        })
    })

    test('(G) a listed non-chat id and a hidden duplicate still resolve', () => {
        const state = richState()
        expect(hiddenOf(state, 'openai', 'gpt-4o-search-preview')).toBe('nonchat')
        expect(must(resolveAddedModel('gpt-4o-search-preview', state)).provider).toBe(LLMProvider.OpenAI)
        expect(hiddenOf(state, 'openai', 'gpt-4.1-2025-04-14')).toBe('duplicate')
        expect(must(resolveAddedModel('gpt-4.1-2025-04-14', state)).format).toBe(LLMFormat.OpenAICompatible)
    })

    test('(G) a saved dynamic_anthropic_ id builds today\'s Anthropic entry from the id alone', () => {
        const entry = must(resolveAddedModel('dynamic_anthropic_claude-opus-4-6-20260205', emptyStateWithCatalog()))
        expect(entry).toMatchObject({
            id: 'dynamic_anthropic_claude-opus-4-6-20260205',
            internalID: 'claude-opus-4-6-20260205',
            provider: LLMProvider.Anthropic,
            format: LLMFormat.Anthropic,
            flags: [LLMFlags.hasImageInput, LLMFlags.hasFirstSystemPrompt, LLMFlags.hasStreaming, LLMFlags.claudeThinking, LLMFlags.claudeAdaptiveThinking],
            parameters: [...ClaudeParameters, 'thinking_tokens'],
            tokenizer: LLMTokenizer.Claude,
        })
    })

    test('(G) built-in ids stay unresolved: exact ids, internalID-only matches and their twins', () => {
        const state = richState()
        for (const id of ['gpt-4o', 'gpt-4', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4o-response-api', 'gpt-4-response-api', 'gpt-4o-mini-response-api']) {
            expect(resolveAddedModel(id, state), id).toBeNull()
        }
    })

    test('(G) a bare OpenAI id resolves from the list with no dataset at all', () => {
        const state = stateOf(names(['gpt-9']))
        expect(must(resolveAddedModel('gpt-9', state)).format).toBe(LLMFormat.OpenAICompatible)
        expect(must(resolveAddedModel('gpt-9-response-api', state)).format).toBe(LLMFormat.OpenAIResponseAPI)
        expect(resolveAddedModel('gpt-10', state)).toBeNull()
    })

    // (G) N1: the twin policy is a listing rule. A listed gpt- id gets both entries whatever the row says.
    test('(G) a listed responses-only model resolves as the bare OpenAI entry too', () => {
        const state = richState()
        expect(state.index.get(addedSpecKey('openai', 'gpt-5-pro'))?.twins).toEqual({ bare: false, responseApi: true })
        const bare = must(resolveAddedModel('gpt-5-pro', state))
        expect(bare.provider).toBe(LLMProvider.OpenAI)
        expect(bare.format).toBe(LLMFormat.OpenAICompatible)
        expect(must(resolveAddedModel('gpt-5-pro-response-api', state)).format).toBe(LLMFormat.OpenAIResponseAPI)
    })

    test('(F) a dataset-only OpenAI id resolves by the creation rules: the twin policy applies, the date does not', () => {
        const dataset = datasetOf({
            'gpt-5-pro': { m: 'responses', ep: ['responses'] },
            'gpt-7': { ep: ['chat', 'responses'], dep: '2020-01-01' },
            'gpt-8': { ep: ['chat'] },
            'gpt-4.1-2025-04-14': {},
            'gpt-5-search-api': {},
            'daybreak-red-latest': {},
            'ft:gpt-3.5-turbo': {},
        })
        const state = stateOf({}, dataset)
        expect(resolveAddedModel('gpt-5-pro', state)).toBeNull()
        expect(must(resolveAddedModel('gpt-5-pro-response-api', state)).format).toBe(LLMFormat.OpenAIResponseAPI)
        expect(must(resolveAddedModel('gpt-7', state)).format).toBe(LLMFormat.OpenAICompatible)
        expect(must(resolveAddedModel('gpt-7-response-api', state)).format).toBe(LLMFormat.OpenAIResponseAPI)
        expect(must(resolveAddedModel('gpt-8', state)).format).toBe(LLMFormat.OpenAICompatible)
        expect(resolveAddedModel('gpt-8-response-api', state)).toBeNull()
        for (const id of ['gpt-4.1-2025-04-14', 'gpt-5-search-api', 'daybreak-red-latest', 'ft:gpt-3.5-turbo']) {
            expect(resolveAddedModel(id, state), id).toBeNull()
        }
    })

    test('(F) dynamic_google_ and dynamic_anthropic_ ids resolve with an empty registry', () => {
        const state = emptyStateWithCatalog()
        const google = must(resolveAddedModel('dynamic_google_gemini-3.1-flash-lite', state))
        expect(google).toMatchObject({ id: 'dynamic_google_gemini-3.1-flash-lite', internalID: 'gemini-3.1-flash-lite', provider: LLMProvider.GoogleCloud, format: LLMFormat.GoogleCloud })
        expect(must(resolveAddedModel('dynamic_anthropic_claude-opus-5-5', state)).provider).toBe(LLMProvider.Anthropic)
    })

    test('(F) the entry takes its display name from the registry when it has one', () => {
        const state = stateOf({ google: [{ id: 'gemini-x', name: 'Gemini X' }] })
        expect(must(resolveAddedModel('dynamic_google_gemini-x', state)).name).toBe('Gemini X')
        expect(must(resolveAddedModel('dynamic_google_gemini-y', state)).name).toBe('gemini-y')
    })

    test('(G) a dynamic id with a refused suffix, or whose suffix is a built-in, is not resolved', () => {
        const state = emptyStateWithCatalog()
        for (const id of [
            'dynamic_google_a/b', 'dynamic_google_../x', 'dynamic_anthropic_x:::y', 'dynamic_google_a..b', 'dynamic_google_', 'dynamic_anthropic_',
            'dynamic_google_tunedModels/x', 'dynamic_google_models/gemini-x', 'dynamic_google_gemini-2.5-pro', 'dynamic_anthropic_claude-opus-4-6',
            'dynamic_google_<img onerror=alert(1)>', 'dynamic_anthropic_' + 'a'.repeat(201),
        ]) {
            expect(resolveAddedModel(id, state), id.slice(0, 50)).toBeNull()
        }
    })

    test('(G) reserved prefixes and ids of no family are not resolved', () => {
        const state = richState()
        for (const id of ['pluginmodel:::x', 'xcustom:::x', 'hf:::x', 'horde:::x', 'gpt-a/b', 'gpt-a..b', '', 'unknown-model']) {
            expect(resolveAddedModel(id, state), id).toBeNull()
        }
    })

    // (G) R2: only the saved dynamic_ forms resolve for Google and Anthropic; bare ids stay AsIs even when registered.
    test('(G) bare claude- and gemini- ids are not resolved even when the registry holds them', () => {
        const state = stateOf({ anthropic: [{ id: 'claude-opus-5-5' }], google: [{ id: 'gemini-3.1-flash-lite' }] })
        expect(state.specs).toHaveLength(2)
        expect(resolveAddedModel('claude-opus-5-5', state)).toBeNull()
        expect(resolveAddedModel('gemini-3.1-flash-lite', state)).toBeNull()
        expect(must(resolveAddedModel('dynamic_anthropic_claude-opus-5-5', state)).provider).toBe(LLMProvider.Anthropic)
        expect(must(resolveAddedModel('dynamic_google_gemini-3.1-flash-lite', state)).provider).toBe(LLMProvider.GoogleCloud)
    })

    test('(G) a plugin or custom model id cannot be admitted', () => {
        const state = stateOf({ openai: [{ id: 'gpt-x' }] })
        expect(resolveAddedModel('pluginmodel:::gpt-x', state)).toBeNull()
        expect(resolveAddedModel('xcustom:::gpt-x', state)).toBeNull()
    })
})

describe('buildAddedModel', () => {
    // (G) the literals are today's, per provider.
    test('(G) the Anthropic entry equals today\'s literals', () => {
        expect(buildAddedModel('anthropic', 'claude-x', 'Claude X')).toEqual({
            id: 'dynamic_anthropic_claude-x',
            name: 'Claude X',
            shortName: 'Claude X',
            fullName: 'Claude X',
            internalID: 'claude-x',
            provider: LLMProvider.Anthropic,
            format: LLMFormat.Anthropic,
            flags: [LLMFlags.hasImageInput, LLMFlags.hasFirstSystemPrompt, LLMFlags.hasStreaming, LLMFlags.claudeThinking, LLMFlags.claudeAdaptiveThinking],
            parameters: [...ClaudeParameters, 'thinking_tokens'],
            tokenizer: LLMTokenizer.Claude,
        })
    })

    test('(G) the OpenAI entry and its Response API twin equal today\'s literals', () => {
        expect(buildAddedModel('openai', 'gpt-9')).toEqual({
            id: 'gpt-9',
            internalID: 'gpt-9',
            name: 'gpt-9',
            shortName: 'gpt-9',
            fullName: 'gpt-9',
            provider: LLMProvider.OpenAI,
            format: LLMFormat.OpenAICompatible,
            flags: OPENAI_FLAGS,
            parameters: GPT5XHighParameters,
            tokenizer: LLMTokenizer.tiktokenO200Base,
        })
        expect(buildAddedModel('openai', 'gpt-9', undefined, 'response-api')).toEqual({
            id: 'gpt-9-response-api',
            internalID: 'gpt-9',
            name: 'gpt-9 (Response API)',
            shortName: 'gpt-9',
            fullName: 'gpt-9 (Response API)',
            provider: LLMProvider.OpenAI,
            format: LLMFormat.OpenAIResponseAPI,
            flags: [...OPENAI_FLAGS, LLMFlags.hasPrefill],
            parameters: GPT5XHighParameters,
            tokenizer: LLMTokenizer.tiktokenO200Base,
        })
    })

    test('(F) the Google entry keeps the saved id form and its internalID is the bare id', () => {
        const entry = buildAddedModel('google', 'gemini-x', 'Gemini X')
        expect(entry).toEqual({
            id: 'dynamic_google_gemini-x',
            name: 'Gemini X',
            shortName: 'Gemini X',
            fullName: 'Gemini X',
            internalID: 'gemini-x',
            provider: LLMProvider.GoogleCloud,
            format: LLMFormat.GoogleCloud,
            flags: [LLMFlags.hasImageInput, LLMFlags.poolSupported, LLMFlags.hasAudioInput, LLMFlags.hasVideoInput, LLMFlags.hasStreaming, LLMFlags.requiresAlternateRole, LLMFlags.geminiThinking],
            parameters: ['thinking_tokens', 'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'],
            tokenizer: LLMTokenizer.GoogleCloud,
        })
        expect(entry.internalID?.startsWith('models/')).toBe(false)
    })

    test('(F) the entry carries no recommended flag and shares no array with the next one', () => {
        const sharedBefore = [...GPT5XHighParameters]
        const first = buildAddedModel('openai', 'gpt-9')
        expect('recommended' in first).toBe(false)
        first.flags.push(LLMFlags.hasCache)
        first.parameters.push('top_k')
        expect(buildAddedModel('openai', 'gpt-9').flags).toEqual(OPENAI_FLAGS)
        expect(buildAddedModel('openai', 'gpt-9').parameters).toEqual(GPT5XHighParameters)
        expect(GPT5XHighParameters).toEqual(sharedBefore)
    })

    test('(F) the display name is cleaned and the internalID is only the id', () => {
        const entry = buildAddedModel('anthropic', 'claude-x', 'Cl\u0000aude <img src=x onerror=alert(1)>')
        expect(entry.name).toBe('Claude <img src=x onerror=alert(1)>')
        expect(entry.fullName).toBe(entry.name)
        expect(entry.internalID).toBe('claude-x')
        expect(buildAddedModel('anthropic', 'claude-x', '\u0000').name).toBe('claude-x')
    })
})

/** A state that has a catalog but no list and no dataset, as before any fetch. */
function emptyStateWithCatalog(): AddedState {
    return reconcileAdded(CATALOG, null, {})
}

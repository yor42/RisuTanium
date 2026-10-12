/**
 * Pure layer of the OpenRouter model data: parsing the listing, the stored
 * file, the lookup rule, staleness and the max-context comparison. The
 * fixture is a trimmed subset of a real listing in the raw response shape
 * (see README.md next to it).
 *
 * Labels: (F) feature test that fails against a missing or wrong
 * implementation on its own assertion; (G) guard that passes with any
 * implementation of the same contract.
 */
import { describe, test, expect } from 'vitest'
import { LLMProvider } from '../../types'
import {
    buildIndex,
    canonicalModelId,
    contextLimitFor,
    decodeOpenRouterData,
    encodeOpenRouterData,
    exceedsActualMax,
    formatTokenCount,
    isStale,
    parseOpenRouterModels,
    pricingFor,
    resolveRows,
    type ModelDataLookupModel,
    type OpenRouterData,
} from '../openrouterData'
import fixture from './openrouterRows.fixture.json'

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function parsedFixture(): OpenRouterData {
    const data = parseOpenRouterModels(fixture, NOW)
    if (data === null) {
        throw new Error('the fixture must parse')
    }
    return data
}

/** A hand-made snapshot for the cases the fixture does not hold. */
function snapshotOf(rows: Record<string, { context?: number, input?: string, output?: string }>): OpenRouterData {
    const limits: OpenRouterData['limits'] = {}
    const pricing: OpenRouterData['pricing'] = {}
    for (const [id, row] of Object.entries(rows)) {
        if (row.context !== undefined) {
            limits[id] = { context: row.context }
        }
        if (row.input !== undefined || row.output !== undefined) {
            pricing[id] = { input: row.input, output: row.output }
        }
    }
    return { v: 1, priceUnit: 'usd-per-token', fetchedAt: NOW, limits, pricing }
}

function model(provider: LLMProvider, id: string, internalID?: string): ModelDataLookupModel {
    return internalID === undefined ? { id, provider } : { id, provider, internalID }
}

const openai = (id: string, internalID?: string) => model(LLMProvider.OpenAI, id, internalID)
const anthropic = (id: string, internalID?: string) => model(LLMProvider.Anthropic, id, internalID)
const google = (id: string, internalID?: string) => model(LLMProvider.GoogleCloud, id, internalID)
const routed = model(LLMProvider.AsIs, 'openrouter')

describe('parseOpenRouterModels', () => {
    test('(F) keeps a context window and prices per raw id, prices as the source strings', () => {
        const data = parsedFixture()
        expect(data.fetchedAt).toBe(NOW)
        expect(data.limits['openai/gpt-4o']).toEqual({ context: 128000 })
        expect(data.pricing['openai/gpt-4o']).toEqual({
            input: '0.0000025',
            output: '0.00001',
            cacheRead: '0.00000125',
        })
        expect(typeof data.pricing['openai/gpt-4o'].input).toBe('string')
    })

    test('(F) uses the top-level context_length, not top_provider.context_length', () => {
        expect(parsedFixture().limits['google/gemini-3-pro-image']).toEqual({ context: 131072 })
    })

    test('(F) keys rows by the raw id: dated twins and variants stay separate rows', () => {
        const data = parsedFixture()
        expect(data.pricing['openai/gpt-4o-2024-05-13']).toEqual({ input: '0.000005', output: '0.000015' })
        expect(data.pricing['openai/gpt-4o']?.input).toBe('0.0000025')
        expect(data.limits['openai/gpt-4o:batch']).toBeDefined()
        expect(data.pricing['anthropic/claude-sonnet-4.6:batch']).toBeDefined()
    })

    test('(F) a negative prompt or completion price drops the pricing row and keeps the limit', () => {
        const data = parsedFixture()
        for (const id of ['openrouter/auto', 'openrouter/auto-beta', 'openrouter/fusion', 'openrouter/pareto-code', 'openrouter/bodybuilder', 'typesafe/jev-router', 'nvidia/switchyard']) {
            expect(data.pricing[id], id).toBeUndefined()
            expect(data.limits[id], id).toBeDefined()
        }
        expect(data.limits['openrouter/auto']).toEqual({ context: 2000000 })
        expect(Object.keys(data.pricing)).toHaveLength(Object.keys(data.limits).length - 7)
    })

    test('(F) a negative completion price alone also drops the row', () => {
        const data = parseOpenRouterModels({ data: [
            { id: 'a/b', context_length: 10, pricing: { prompt: '0.1', completion: '-1' } },
        ] })
        expect(data?.pricing['a/b']).toBeUndefined()
        expect(data?.limits['a/b']).toEqual({ context: 10 })
    })

    test('(F) a free row keeps its "0" prices', () => {
        expect(parsedFixture().pricing['apodex/apodex-1.1-mini:free']).toEqual({ input: '0', output: '0' })
    })

    test('(F) only the five known price fields are kept', () => {
        expect(Object.keys(parsedFixture().pricing['google/gemini-3-pro-image']).sort())
            .toEqual(['cacheRead', 'cacheWrite', 'input', 'output', 'reasoning'])
    })

    test('(F) invalid price strings are left out and the row survives on its input or output', () => {
        const data = parseOpenRouterModels({ data: [
            { id: 'a/b', context_length: 10, pricing: { prompt: '0.1', completion: 'abc', input_cache_read: ' ', internal_reasoning: 7 } },
            { id: 'a/c', context_length: 10, pricing: { prompt: 5, completion: null } },
        ] })
        expect(data?.pricing['a/b']).toEqual({ input: '0.1' })
        expect(data?.pricing['a/c']).toBeUndefined()
    })

    test('(F) a context that is not a positive integer gives no limit', () => {
        const data = parseOpenRouterModels({ data: [
            { id: 'a/zero', context_length: 0, pricing: { prompt: '1', completion: '1' } },
            { id: 'a/float', context_length: 1.5, pricing: { prompt: '1', completion: '1' } },
            { id: 'a/text', context_length: '100', pricing: { prompt: '1', completion: '1' } },
            { id: 'a/ok', context_length: 100 },
        ] })
        expect(Object.keys(data?.limits ?? {})).toEqual(['a/ok'])
    })

    test('(F) a body that is not a listing, or holds no usable row, is null', () => {
        expect(parseOpenRouterModels(null)).toBeNull()
        expect(parseOpenRouterModels('x')).toBeNull()
        expect(parseOpenRouterModels([])).toBeNull()
        expect(parseOpenRouterModels({})).toBeNull()
        expect(parseOpenRouterModels({ data: {} })).toBeNull()
        expect(parseOpenRouterModels({ data: [] })).toBeNull()
        expect(parseOpenRouterModels({ data: [null, 3, { name: 'no id', context_length: 5 }, { id: 'a/b' }, { id: '' , context_length: 5 }] })).toBeNull()
    })

    test('(F) an id like __proto__ is an ordinary key and does not touch Object.prototype', () => {
        const data = parseOpenRouterModels(JSON.parse('{"data":[{"id":"__proto__","context_length":5}]}'))
        expect(Object.keys(data?.limits ?? {})).toEqual(['__proto__'])
        expect(({} as { context?: number }).context).toBeUndefined()
        const back = decodeOpenRouterData(encodeOpenRouterData(data as OpenRouterData))
        expect(Object.keys(back?.limits ?? {})).toEqual(['__proto__'])
    })
})

describe('encodeOpenRouterData / decodeOpenRouterData', () => {
    test('(F) round trips the parsed fixture', () => {
        const data = parsedFixture()
        expect(decodeOpenRouterData(encodeOpenRouterData(data))).toEqual(data)
    })

    test('(F) the stored file has the documented top-level shape', () => {
        const stored = JSON.parse(new TextDecoder().decode(encodeOpenRouterData(parsedFixture())))
        expect(Object.keys(stored).sort()).toEqual(['fetchedAt', 'limits', 'priceUnit', 'pricing', 'v'])
        expect(stored.v).toBe(1)
        expect(stored.priceUnit).toBe('usd-per-token')
    })

    function bytesOf(value: unknown): Uint8Array {
        return new TextEncoder().encode(JSON.stringify(value))
    }
    const valid = () => ({ v: 1, priceUnit: 'usd-per-token', fetchedAt: NOW, limits: { 'a/b': { context: 5 } }, pricing: { 'a/b': { input: '1', output: '2' } } })

    test('(F) a wrong version, wrong unit, wrong shape or damaged file is null', () => {
        expect(decodeOpenRouterData(bytesOf({ ...valid(), v: 2 }))).toBeNull()
        expect(decodeOpenRouterData(bytesOf({ ...valid(), priceUnit: 'usd-per-1m' }))).toBeNull()
        expect(decodeOpenRouterData(bytesOf([valid()]))).toBeNull()
        expect(decodeOpenRouterData(bytesOf({ ...valid(), fetchedAt: 'x' }))).toBeNull()
        expect(decodeOpenRouterData(bytesOf({ ...valid(), limits: [] }))).toBeNull()
        expect(decodeOpenRouterData(bytesOf({ ...valid(), pricing: null }))).toBeNull()
        const whole = encodeOpenRouterData(parsedFixture())
        expect(decodeOpenRouterData(whole.slice(0, whole.length - 10))).toBeNull()
        expect(decodeOpenRouterData(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull()
        expect(decodeOpenRouterData(new Uint8Array(0))).toBeNull()
    })

    test('(G) unknown fields in a row are ignored, so a later version can add one without a new v', () => {
        const decoded = decodeOpenRouterData(bytesOf({
            ...valid(),
            limits: { 'a/b': { context: 5, maxOutput: 9 } },
            pricing: { 'a/b': { input: '1', output: '2', future: 'x' } },
        }))
        expect(decoded?.limits['a/b']).toEqual({ context: 5 })
        expect(decoded?.pricing['a/b']).toEqual({ input: '1', output: '2' })
    })

    test('(F) rows that do not validate are skipped, the rest is kept', () => {
        const decoded = decodeOpenRouterData(bytesOf({
            ...valid(),
            limits: { 'a/ok': { context: 5 }, 'a/bad': { context: -1 }, 'a/text': 'x' },
            pricing: { 'a/ok': { input: '1' }, 'a/neg': { input: '-1', output: '-1' }, 'a/empty': {} },
        }))
        expect(Object.keys(decoded?.limits ?? {})).toEqual(['a/ok'])
        expect(Object.keys(decoded?.pricing ?? {})).toEqual(['a/ok'])
    })
})

describe('isStale', () => {
    test('(F) fresh up to and including the TTL, stale one millisecond later', () => {
        expect(isStale(NOW - DAY, NOW)).toBe(false)
        expect(isStale(NOW - DAY - 1, NOW)).toBe(true)
        expect(isStale(NOW - HOUR, NOW)).toBe(false)
        expect(isStale(NOW, NOW)).toBe(false)
    })

    test('(F) never fetched or dated in the future is stale', () => {
        expect(isStale(NaN, NOW)).toBe(true)
        expect(isStale(Infinity, NOW)).toBe(true)
        expect(isStale(NOW + 1, NOW)).toBe(true)
        expect(isStale(NOW + HOUR, NOW)).toBe(true)
    })

    test('(F) honours a different TTL', () => {
        expect(isStale(NOW - 1000, NOW, 1000)).toBe(false)
        expect(isStale(NOW - 1001, NOW, 1000)).toBe(true)
    })
})

describe('exceedsActualMax', () => {
    test('(F) strictly above the limit only', () => {
        expect(exceedsActualMax(200000, 200000)).toBe(false)
        expect(exceedsActualMax(200001, 200000)).toBe(true)
        expect(exceedsActualMax(8000, 200000)).toBe(false)
    })

    test('(F) an unknown or non-positive limit, or a value that is not a number, never warns', () => {
        expect(exceedsActualMax(5, 0)).toBe(false)
        expect(exceedsActualMax(5, -3)).toBe(false)
        expect(exceedsActualMax(5, NaN)).toBe(false)
        expect(exceedsActualMax(Infinity, 100)).toBe(false)
        expect(exceedsActualMax(NaN, 100)).toBe(false)
        expect(exceedsActualMax(5, Infinity)).toBe(false)
        expect(exceedsActualMax(5, undefined)).toBe(false)
        expect(exceedsActualMax(undefined, 100)).toBe(false)
        expect(exceedsActualMax(null, 100)).toBe(false)
    })
})

describe('formatTokenCount', () => {
    test('(F) groups thousands the English way whatever the host locale', () => {
        expect(formatTokenCount(8000)).toBe('8,000')
        expect(formatTokenCount(1048576)).toBe('1,048,576')
        expect(formatTokenCount(0)).toBe('0')
    })
})

describe('canonicalModelId', () => {
    test('(F) lowercases, drops -latest and a trailing date, turns dots into dashes', () => {
        expect(canonicalModelId('Claude-Sonnet-4-20250514')).toBe('claude-sonnet-4')
        expect(canonicalModelId('gpt-4o-2024-08-06')).toBe('gpt-4o')
        expect(canonicalModelId('gemini-2.5-pro-latest')).toBe('gemini-2-5-pro')
        expect(canonicalModelId('claude-sonnet-4.5')).toBe('claude-sonnet-4-5')
        expect(canonicalModelId('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5')
    })

    test('(F) leaves a date that is not trailing, and a variant suffix, alone', () => {
        expect(canonicalModelId('model-20250101-pro')).toBe('model-20250101-pro')
        expect(canonicalModelId('gpt-4o:batch')).toBe('gpt-4o:batch')
    })
})

describe('contextLimitFor / pricingFor', () => {
    const limit = (m: ModelDataLookupModel, routedId?: string) => contextLimitFor(buildIndex(parsedFixture()), m, routedId)
    const price = (m: ModelDataLookupModel, routedId?: string) => pricingFor(buildIndex(parsedFixture()), m, routedId)

    test('(F) an exact id matches its own row', () => {
        expect(limit(openai('gpt-4o'))).toBe(128000)
        expect(price(openai('gpt-4o'))?.input).toBe('0.0000025')
        expect(limit(google('gemini-2.5-pro'))).toBe(1048576)
        expect(price(google('gemini-2.5-pro'))?.output).toBe('0.00001')
    })

    test('(F) the exact row wins over the canonical spelling', () => {
        const own = snapshotOf({
            'openai/zeta': { context: 10, input: '1', output: '1' },
            'openai/zeta-2025-01-01': { context: 99, input: '9', output: '9' },
        })
        expect(contextLimitFor(buildIndex(own), openai('zeta'))).toBe(10)
    })

    test('(F) dated twins keep their own price: only the pricing tells them apart', () => {
        expect(limit(openai('gpt-4o-2024-05-13'))).toBe(limit(openai('gpt-4o')))
        expect(price(openai('gpt-4o-2024-05-13'))).toMatchObject({ input: '0.000005', output: '0.000015' })
        expect(price(openai('gpt-4o'))).toMatchObject({ input: '0.0000025', output: '0.00001' })
        expect(price(openai('gpt-4o-2024-08-06'))).toMatchObject({ input: '0.0000025', output: '0.00001' })
    })

    test('(F) the canonical spelling is used when no exact row exists: dates, dots, -latest', () => {
        expect(price(anthropic('claude-sonnet-4-20250514'))?.input).toBe('0.000003')
        expect(price(anthropic('claude-sonnet-4-5-20250929'))?.input).toBe('0.000003')
        expect(price(anthropic('claude-sonnet-4-6'))?.output).toBe('0.000015')
        expect(price(anthropic('claude-haiku-4-5-20251001'))).toMatchObject({ input: '0.000001', output: '0.000005' })
        const latest = buildIndex(snapshotOf({ 'openai/chatgpt-4o': { context: 128000, input: '1', output: '2' } }))
        expect(contextLimitFor(latest, openai('chatgpt-4o-latest'))).toBe(128000)
        const dated = buildIndex(snapshotOf({ 'openai/zeta-2025-01-01': { context: 7 } }))
        expect(contextLimitFor(dated, openai('zeta'))).toBe(7)
        const dotted = buildIndex(snapshotOf({ 'google/gemini-9.1-pro': { context: 8 } }))
        expect(contextLimitFor(dotted, google('gemini-9-1-pro'))).toBe(8)
    })

    test('(F) no prefix matching: a shorter or longer name than a row is unknown', () => {
        expect(limit(openai('gpt-4'))).toBeUndefined()
        expect(limit(openai('gpt-4o-2024'))).toBeUndefined()
        expect(price(anthropic('claude-sonnet'))).toBeUndefined()
        expect(limit(openai('gpt-4o-mini-high'))).toBeUndefined()
    })

    test('(F) variants never match a first-party model', () => {
        expect(limit(openai('gpt-4o', 'gpt-4o:batch'))).toBeUndefined()
        expect(price(openai('gpt-4o', 'gpt-4o:batch'))).toBeUndefined()
        const freeOnly = buildIndex(snapshotOf({ 'google/zeta:free': { context: 5, input: '0', output: '0' } }))
        expect(contextLimitFor(freeOnly, google('zeta'))).toBeUndefined()
        expect(pricingFor(freeOnly, google('zeta'))).toBeUndefined()
    })

    test('(F) internalID is the name looked up, not id', () => {
        expect(limit(openai('gpt4o', 'gpt-4o'))).toBe(128000)
        expect(limit(openai('gpt-4o', 'unlisted-name'))).toBeUndefined()
    })

    test('(F) our generated suffixes are stripped only when internalID is absent', () => {
        expect(limit(model(LLMProvider.VertexAI, 'gemini-2.5-pro-vertex'))).toBe(1048576)
        expect(limit(openai('gpt-4o-response-api'))).toBe(128000)
        expect(limit(model(LLMProvider.VertexAI, 'gemini-2.5-pro-vertex', 'gemini-2.5-pro-vertex'))).toBeUndefined()
    })

    test('(F) a models/ prefix is removed from the reference', () => {
        expect(limit(google('anything', 'models/gemini-2.5-pro'))).toBe(1048576)
    })

    test('(F) Vertex and Google Cloud models use the google vendor', () => {
        expect(limit(model(LLMProvider.VertexAI, 'gemini-2.5-pro'))).toBe(1048576)
        expect(limit(openai('gemini-2.5-pro'))).toBeUndefined()
    })

    test('(F) only openai, anthropic and google are matched: other providers are unknown', () => {
        expect(limit(model(LLMProvider.DeepSeek, 'deepseek-chat'))).toBeUndefined()
        expect(price(model(LLMProvider.DeepSeek, 'deepseek-chat'))).toBeUndefined()
        expect(price(model(LLMProvider.OpenAI, 'deepseek-chat'))).toBeUndefined()
        expect(limit(model(LLMProvider.AWS, 'claude-sonnet-4'))).toBeUndefined()
        expect(price(model(LLMProvider.AWS, 'claude-sonnet-4'))).toBeUndefined()
        expect(limit(model(LLMProvider.Mistral, 'gpt-4o'))).toBeUndefined()
        expect(limit(model(LLMProvider.AsIs, 'gpt-4o'))).toBeUndefined()
        expect(limit(model(LLMProvider.NanoGPT, 'gpt-4o'))).toBeUndefined()
    })

    test('(F) Anthropic-provider entries have no limit but do have a price', () => {
        expect(limit(anthropic('claude-sonnet-4-6'))).toBeUndefined()
        expect(limit(anthropic('claude-sonnet-4-5-20250929'))).toBeUndefined()
        expect(limit(anthropic('claude-sonnet-4', 'claude-sonnet-4'))).toBeUndefined()
        expect(price(anthropic('claude-sonnet-4-6'))?.input).toBe('0.000003')
    })

    test('(F) a routed model uses the exact row of the routed id, any vendor, variants allowed', () => {
        expect(limit(routed, 'anthropic/claude-sonnet-4.6')).toBe(1000000)
        expect(price(routed, 'anthropic/claude-sonnet-4.6')).toMatchObject({ input: '0.000003', output: '0.000015' })
        expect(limit(routed, 'anthropic/claude-sonnet-4.6:batch')).toBe(1000000)
        expect(limit(routed, 'openrouter/auto')).toBe(2000000)
        expect(limit(routed, 'apodex/apodex-1.1-mini:free')).toBe(262144)
    })

    test('(F) a routed id without a row, risu/free or no routed id is unknown', () => {
        expect(limit(routed, 'risu/free')).toBeUndefined()
        expect(limit(routed, 'vendor/unlisted')).toBeUndefined()
        expect(limit(routed, undefined)).toBeUndefined()
        expect(limit(routed, '')).toBeUndefined()
        expect(price(routed, 'risu/free')).toBeUndefined()
    })

    test('(F) a routed id is looked up exactly: no canonical matching', () => {
        expect(limit(routed, 'anthropic/claude-sonnet-4-6')).toBeUndefined()
    })

    test('(G) the routed entry ignores its provider and a first-party model ignores the routed id', () => {
        expect(limit(openai('gpt-4o'), 'anthropic/claude-sonnet-4.6')).toBe(128000)
    })

    test('(F) canonical candidates contribute a field only when all of them agree', () => {
        const agree = buildIndex(snapshotOf({
            'openai/zeta-2025-01-01': { context: 100, input: '1', output: '2' },
            'openai/zeta-2025-02-02': { context: 100, input: '1', output: '3' },
        }))
        expect(contextLimitFor(agree, openai('zeta'))).toBe(100)
        expect(pricingFor(agree, openai('zeta'))).toEqual({ input: '1' })

        const differ = buildIndex(snapshotOf({
            'openai/zeta-2025-01-01': { context: 100, input: '1', output: '2' },
            'openai/zeta-2025-02-02': { context: 200, input: '1', output: '2' },
        }))
        expect(contextLimitFor(differ, openai('zeta'))).toBeUndefined()
        expect(pricingFor(differ, openai('zeta'))).toEqual({ input: '1', output: '2' })
    })

    test('(F) a field one canonical candidate lacks is unknown', () => {
        const partial = buildIndex(snapshotOf({
            'openai/zeta-2025-01-01': { context: 100 },
            'openai/zeta-2025-02-02': { input: '1', output: '2' },
        }))
        expect(contextLimitFor(partial, openai('zeta'))).toBeUndefined()
        expect(pricingFor(partial, openai('zeta'))).toBeUndefined()
    })

    test('(F) resolveRows returns an empty row when nothing matches and never throws', () => {
        const index = buildIndex(parsedFixture())
        expect(resolveRows(index, openai('no-such-model'))).toEqual({})
        expect(resolveRows(index, { id: '', provider: LLMProvider.OpenAI })).toEqual({})
        expect(resolveRows(index, { id: 'gpt-4o', provider: LLMProvider.OpenAI, internalID: '' })).toEqual({})
    })
})

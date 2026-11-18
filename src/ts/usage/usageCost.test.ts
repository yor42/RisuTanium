/**
 * Exact decimal cost. Catalog prices come from the real LiteLLM parser on a
 * synthetic dataset, so the price strings have the producer's real shape
 * (JSON numbers written back with String(), including exponent notation).
 *
 * Labels: (G) compatibility guard over a new module; backed by scratch mutants.
 */
import { describe, test, expect } from 'vitest'
import { parseLiteLLMDataset } from '../model/modelData/litellmData'
import { costOf } from './usageCost'
import type { PriceOverride } from './usageTypes'

const dataset = parseLiteLLMDataset({
    'synthetic-full': {
        litellm_provider: 'openai',
        mode: 'chat',
        max_input_tokens: 1000,
        input_cost_per_token: 3e-7,
        output_cost_per_token: 0.0000012,
        cache_read_input_token_cost: 7.5e-8,
        cache_creation_input_token_cost: 3.75e-7,
    },
    'synthetic-no-cache': {
        litellm_provider: 'openai',
        mode: 'chat',
        max_input_tokens: 1000,
        input_cost_per_token: 0.000001,
        output_cost_per_token: 0.000002,
    },
})
const catalogFull = dataset?.rows['synthetic-full']?.price as PriceOverride
const catalogNoCache = dataset?.rows['synthetic-no-cache']?.price as PriceOverride

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

describe('costOf catalog prices (G)', () => {
    test('the synthetic producer rows exist and use exponent notation', () => {
        expect(catalogFull).toBeDefined()
        expect(catalogFull.input).toBe('3e-7')
        expect(catalogNoCache).toBeDefined()
    })

    test('exact sum over all four kinds', () => {
        // 1000*3e-7 + 500*1.2e-6 + 2000*7.5e-8 + 400*3.75e-7 = 0.0003 + 0.0006 + 0.00015 + 0.00015
        const cost = costOf({ input: 1000, output: 500, cacheRead: 2000, cacheWrite: 400 }, catalogFull, 'catalog')
        expect(cost).toEqual({ status: 'priced', usd: '0.0012' })
    })

    test('no float drift: 0.1 + 0.2 style sums stay exact', () => {
        const price: PriceOverride = { input: '0.1', output: '0.2' }
        expect(costOf({ ...zero, input: 1, output: 1 }, price, 'catalog')).toEqual({ status: 'priced', usd: '0.3' })
    })

    test('very small prices times large counts stay exact', () => {
        const price: PriceOverride = { input: '1e-9', output: '1e-9' }
        expect(costOf({ ...zero, input: 123456789, output: 1 }, price, 'catalog'))
            .toEqual({ status: 'priced', usd: '0.12345679' })
    })

    test('a result with no fractional part has no decimal point', () => {
        expect(costOf({ ...zero, input: 3 }, { input: '2' }, 'catalog')).toEqual({ status: 'priced', usd: '6' })
    })

    test('a free model is priced at 0, not unpriced', () => {
        expect(costOf({ ...zero, input: 10, output: 10 }, { input: '0', output: '0' }, 'catalog'))
            .toEqual({ status: 'priced', usd: '0' })
    })

    test('no price at all is unpriced and carries no amount', () => {
        const cost = costOf({ ...zero, input: 10 }, undefined, 'catalog')
        expect(cost).toEqual({ status: 'unpriced' })
        expect('usd' in cost).toBe(false)
    })

    test('an empty price object is unpriced', () => {
        expect(costOf({ ...zero, input: 10 }, {}, 'catalog')).toEqual({ status: 'unpriced' })
    })

    test('an unreadable price string counts as missing', () => {
        expect(costOf({ ...zero, input: 10 }, { input: 'free' }, 'catalog')).toEqual({ status: 'unpriced' })
        expect(costOf({ ...zero, input: 10 }, { input: '-1' }, 'catalog')).toEqual({ status: 'unpriced' })
    })

    test('zero tokens with no price is unpriced, never $0', () => {
        expect(costOf(zero, undefined, 'catalog')).toEqual({ status: 'unpriced' })
    })
})

describe('costOf partial pricing, OI-2 B (G)', () => {
    test('cache tokens with no cache price make the result partial and cost only the priced kinds', () => {
        const cost = costOf({ input: 1000, output: 1000, cacheRead: 5000, cacheWrite: 0 }, catalogNoCache, 'catalog')
        // 1000*1e-6 + 1000*2e-6 = 0.003
        expect(cost).toEqual({ status: 'partial', usd: '0.003' })
    })

    test('cache tokens that are zero do not make the result partial', () => {
        expect(costOf({ input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 }, catalogNoCache, 'catalog'))
            .toEqual({ status: 'priced', usd: '0.003' })
    })

    test('a missing output price with output tokens is partial', () => {
        expect(costOf({ ...zero, input: 1000, output: 5 }, { input: '0.000001' }, 'catalog'))
            .toEqual({ status: 'partial', usd: '0.001' })
    })

    test('only unpriced kinds present gives unpriced, not partial', () => {
        expect(costOf({ ...zero, cacheRead: 100 }, catalogNoCache, 'catalog')).toEqual({ status: 'unpriced' })
    })
})

describe('costOf overrides (G)', () => {
    test('override values are USD per 1M tokens and converted exactly', () => {
        const override: PriceOverride = { input: '3', output: '15', cacheRead: '0.3', cacheWrite: '3.75' }
        // 1_000_000 input at $3/M = 3 ; 100_000 output at $15/M = 1.5 ; 10 cacheRead at 0.3/M = 0.000003 ; 1 cacheWrite = 0.00000375
        expect(costOf({ input: 1_000_000, output: 100_000, cacheRead: 10, cacheWrite: 1 }, override, 'override'))
            .toEqual({ status: 'priced', usd: '4.50000675' })
    })

    test('an override is used whole: fields it lacks are not completed from anything else', () => {
        const cost = costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 }, { input: '2' }, 'override')
        expect(cost).toEqual({ status: 'partial', usd: '2' })
    })

    test('the same numbers mean different things per source', () => {
        const price: PriceOverride = { input: '2' }
        expect(costOf({ ...zero, input: 1_000_000 }, price, 'override')).toEqual({ status: 'priced', usd: '2' })
        expect(costOf({ ...zero, input: 1_000_000 }, price, 'catalog')).toEqual({ status: 'priced', usd: '2000000' })
    })

    test('an override of 0 per 1M is a real free price', () => {
        expect(costOf({ ...zero, input: 500 }, { input: '0' }, 'override')).toEqual({ status: 'priced', usd: '0' })
    })

    test('an override with extreme exponent is treated as unreadable, not expanded', () => {
        expect(costOf({ ...zero, input: 1 }, { input: '1e400' }, 'override')).toEqual({ status: 'unpriced' })
    })
})

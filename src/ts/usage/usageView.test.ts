/**
 * The read model behind the Statistics page. Ledger statics come from the real `recordUsage`; catalog prices come from the
 * real LiteLLM and OpenRouter parsers on synthetic JSON, seeded through the model data service, so the price strings have
 * the producers' shape. The model-list lookup is injected as a minimal OpenAI-provider entry for any id.
 *
 * Labels: (G) compatibility guard over a new module, backed by scratch mutants (M6, M7).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { LLMProvider } from '../model/types'
import { parseLiteLLMDataset } from '../model/modelData/litellmData'
import { parseOpenRouterModels } from '../model/modelData/openrouterData'
import { resetModelDataForTests, seedLiteLLMForTests, seedModelDataForTests } from '../model/modelData/modelDataService.svelte'
import { recordUsage } from './usageLedger'
import type { PriceOverride, UsageEntry } from './usageTypes'
import { addDecimals, buildUsageView, formatUsd, purposeLabelKey, type UsageViewContext } from './usageView'

const JUNE = new Date(2026, 5, 15)
const JULY = new Date(2026, 6, 2)

function reported(modelKey: string, purpose: UsageEntry['purpose'], input: number, output: number, cacheRead = 0, cacheWrite = 0): UsageEntry {
    return { modelKey, purpose, reported: { input, output, cacheRead, cacheWrite }, estimated: null }
}

function estimated(modelKey: string, purpose: UsageEntry['purpose'], input: number, output: number): UsageEntry {
    return { modelKey, purpose, reported: null, estimated: { input, output } }
}

function ledger(...records: [UsageEntry, Date][]): Record<string, number> {
    const statics: Record<string, number> = { messages: 4, imports: 1 }
    for (const [entry, when] of records) {
        recordUsage(statics, entry, when)
    }
    return statics
}

function ctx(overrides?: Record<string, PriceOverride>, customModels?: { id: string, name: string }[]): UsageViewContext {
    return { overrides, customModels, modelInfo: (id) => ({ id, internalID: id, provider: LLMProvider.OpenAI }) }
}

const NO_CONTEXT = ctx()

beforeEach(() => {
    resetModelDataForTests()
    seedLiteLLMForTests(parseLiteLLMDataset({
        'gpt-priced': { litellm_provider: 'openai', mode: 'chat', max_input_tokens: 1000, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002, cache_read_input_token_cost: 5e-7 },
        'gpt-nocache': { litellm_provider: 'openai', mode: 'chat', max_input_tokens: 1000, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
    }, 1))
    seedModelDataForTests(parseOpenRouterModels({
        data: [{ id: 'vendor/routed-model', context_length: 1000, pricing: { prompt: '0.000003', completion: '0.000004' } }],
    }, 1))
})

afterEach(() => {
    resetModelDataForTests()
})

describe('usage view totals (G)', () => {
    test('months are newest first and sum every bucket of the month', () => {
        const view = buildUsageView(ledger(
            [reported('gpt-priced', 'chat', 100, 50), JUNE],
            [reported('gpt-priced', 'utility', 10, 5), JUNE],
            [reported('gpt-priced', 'chat', 7, 3), JULY],
        ), NO_CONTEXT)
        expect(view.months.map((row) => row.month)).toEqual(['2026-07', '2026-06'])
        const june = view.months[1]
        expect(june).toMatchObject({ requests: 2, input: 110, output: 55, cacheRead: 0, cacheWrite: 0, estimated: false })
    })

    test('estimated counters flag the row and count as tokens; reported ones do not flag it', () => {
        const view = buildUsageView(ledger(
            [estimated('gpt-priced', 'chat', 40, 20), JUNE],
            [reported('gpt-priced', 'utility', 10, 5), JULY],
        ), NO_CONTEXT)
        expect(view.months.find((row) => row.month === '2026-06')).toMatchObject({ input: 40, output: 20, estimated: true })
        expect(view.months.find((row) => row.month === '2026-07')).toMatchObject({ estimated: false })
    })

    test('model and purpose rows cover the chosen month only, and the total equals the month row', () => {
        const view = buildUsageView(ledger(
            [reported('gpt-priced', 'chat', 100, 50), JUNE],
            [reported('gpt-nocache', 'utility', 30, 10), JUNE],
            [reported('gpt-priced', 'chat', 999, 999), JULY],
        ), NO_CONTEXT)
        expect(view.modelsOf('2026-06').map((row) => row.modelKey).sort()).toEqual(['gpt-nocache', 'gpt-priced'])
        expect(view.purposesOf('2026-06').map((row) => row.purpose).sort()).toEqual(['chat', 'utility'])
        const month = view.months.find((row) => row.month === '2026-06')
        expect(view.totalOf('2026-06')).toEqual({ requests: 2, input: 130, output: 60, cacheRead: 0, cacheWrite: 0, estimated: false, cost: month?.cost })
    })

    test('the overflow counters are reported apart from the months, and absent when empty', () => {
        expect(buildUsageView(ledger(), NO_CONTEXT).overflow.present).toBe(false)
        const statics = ledger([reported('gpt-priced', 'chat', 1, 1), JUNE])
        statics['u1|ovf|n'] = 3
        statics['u1|ovf|i'] = 90
        const view = buildUsageView(statics, NO_CONTEXT)
        expect(view.overflow).toMatchObject({ present: true, requests: 3, input: 90 })
        expect(view.months).toHaveLength(1)
    })

    test('unknown versions, malformed keys and non-numbers add no row', () => {
        const statics = ledger()
        statics['u2|2026-06|chat|n|x'] = 5
        statics['u1|bad'] = 5
        ;(statics as Record<string, unknown>)['u1|2026-06|chat|n|y'] = 'seven'
        expect(buildUsageView(statics, NO_CONTEXT).months).toEqual([])
    })
})

describe('usage view prices (G)', () => {
    test('a catalog price gives an exact cost', () => {
        const view = buildUsageView(ledger([reported('gpt-priced', 'chat', 1000, 500), JUNE]), NO_CONTEXT)
        // 1000 * 0.000001 + 500 * 0.000002
        expect(view.months[0].cost).toEqual({ status: 'priced', usd: '0.002' })
        expect(view.modelsOf('2026-06')[0].priceSource).toBe('catalog')
    })

    test('a model with no price is unpriced and carries no amount', () => {
        const view = buildUsageView(ledger([reported('gpt-unknown', 'chat', 1000, 500), JUNE]), NO_CONTEXT)
        expect(view.months[0].cost).toEqual({ status: 'unpriced' })
        expect(view.modelsOf('2026-06')[0].priceSource).toBe('none')
    })

    test('cache tokens without a cache price make the row partly unpriced (maintainer decision OI-2 B)', () => {
        const withCache = buildUsageView(ledger([reported('gpt-nocache', 'chat', 1000, 500, 2000), JUNE]), NO_CONTEXT)
        expect(withCache.months[0].cost).toEqual({ status: 'partial', usd: '0.002' })
    })

    test('an override replaces the catalog price as a whole object, never field by field', () => {
        // The catalog has a cache-read price; the override does not, so the cache tokens stay unpriced.
        const overrides: Record<string, PriceOverride> = { 'gpt-priced': { input: '10', output: '20' } }
        const view = buildUsageView(ledger([reported('gpt-priced', 'chat', 1000, 500, 2000), JUNE]), ctx(overrides))
        // per 1M tokens: 1000 * 10e-6 + 500 * 20e-6
        expect(view.months[0].cost).toEqual({ status: 'partial', usd: '0.02' })
        const row = view.modelsOf('2026-06')[0]
        expect(row.priceSource).toBe('override')
        expect(row.override).toEqual({ input: '10', output: '20' })
    })

    test('an override beats a different catalog price for the same tokens', () => {
        const entry = reported('gpt-priced', 'chat', 1000, 500)
        const catalog = buildUsageView(ledger([entry, JUNE]), NO_CONTEXT).months[0].cost
        const overridden = buildUsageView(ledger([entry, JUNE]), ctx({ 'gpt-priced': { input: '5', output: '5' } })).months[0].cost
        expect(catalog.usd).toBe('0.002')
        expect(overridden).toEqual({ status: 'priced', usd: '0.0075' })
    })

    test('a routed openrouter key reads the OpenRouter row of the routed model', () => {
        const view = buildUsageView(ledger([reported('openrouter>vendor/routed-model', 'chat', 1000, 1000), JUNE]), NO_CONTEXT)
        expect(view.months[0].cost).toEqual({ status: 'priced', usd: '0.007' })
    })

    test('reverse_proxy, nanogpt and ollama keys are unpriced unless overridden', () => {
        const keys = ['reverse_proxy>gpt-priced', 'nanogpt>gpt-priced', 'ollama>gpt-priced']
        for (const key of keys) {
            const records: [UsageEntry, Date][] = [[reported(key, 'chat', 1000, 500), JUNE]]
            expect(buildUsageView(ledger(...records), NO_CONTEXT).months[0].cost, key).toEqual({ status: 'unpriced' })
            const overridden = buildUsageView(ledger(...records), ctx({ [key]: { input: '1', output: '1' } }))
            expect(overridden.months[0].cost, key).toEqual({ status: 'priced', usd: '0.0015' })
        }
    })

    test('a month mixing a priced and an unpriced model sums the priced part and is partial', () => {
        const view = buildUsageView(ledger(
            [reported('gpt-priced', 'chat', 1000, 500), JUNE],
            [reported('gpt-unknown', 'chat', 1000, 500), JUNE],
        ), NO_CONTEXT)
        expect(view.months[0].cost).toEqual({ status: 'partial', usd: '0.002' })
        expect(view.totalOf('2026-06').cost).toEqual({ status: 'partial', usd: '0.002' })
    })

    test('a custom model shows its own name while it exists, and its id when it was removed', () => {
        const statics = ledger([reported('xcustom:::abc', 'chat', 1, 1), JUNE])
        const named = buildUsageView(statics, ctx(undefined, [{ id: 'xcustom:::abc', name: 'My model' }]))
        expect(named.modelsOf('2026-06')[0]).toMatchObject({ modelKey: 'xcustom:::abc', label: 'My model' })
        const removed = buildUsageView(statics, ctx(undefined, []))
        expect(removed.modelsOf('2026-06')[0].label).toBe('xcustom:::abc')
    })
})

describe('usage view helpers (G)', () => {
    test('formatUsd rounds half up to 4 decimals, keeps 2 minimum, and marks tiny positive amounts', () => {
        expect(formatUsd('0')).toBe('$0.00')
        expect(formatUsd('1.5')).toBe('$1.50')
        expect(formatUsd('0.002')).toBe('$0.002')
        expect(formatUsd('0.00015')).toBe('$0.0002')
        expect(formatUsd('0.000149')).toBe('$0.0001')
        expect(formatUsd('0.00009')).toBe('< $0.0001')
        expect(formatUsd('12.99995')).toBe('$13.00')
    })

    test('addDecimals is exact', () => {
        expect(addDecimals('0.1', '0.2')).toBe('0.3')
        expect(addDecimals('1', '0.0000001')).toBe('1.0000001')
        expect(addDecimals('0', '0')).toBe('0')
    })

    test('purpose codes map to their label keys and an unknown code to the fallback', () => {
        expect(purposeLabelKey('chat')).toBe('purposeChat')
        expect(purposeLabelKey('otherAx')).toBe('purposeOtherAx')
        expect(purposeLabelKey('toString')).toBe('purposeUnknown')
        expect(purposeLabelKey('zzz')).toBe('purposeUnknown')
    })
})

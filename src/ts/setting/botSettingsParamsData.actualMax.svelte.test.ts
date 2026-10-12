/**
 * Wiring of the real `params.maxContext` item to the OpenRouter model data: its `actualMax`
 * reads the real getter over the real holder, seeded through the test seam with the committed
 * fixture subset, and its warning text comes from the English language table. Catalog entries
 * are the real `OpenAIModels` and `AnthropicModels` arrays, not `modellist.ts`.
 *
 * Labels: (F) feature test that fails before the change on its own assertion; (G) guard that
 * passes before and after.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { LLMModel } from 'src/ts/model/types'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'
import { AnthropicModels } from 'src/ts/model/providers/anthropic'
import { OpenAIModels } from 'src/ts/model/providers/openai'
import { LLMProvider } from 'src/ts/model/types'
import { parseLiteLLMDataset } from 'src/ts/model/modelData/litellmData'
import { parseOpenRouterModels } from 'src/ts/model/modelData/openrouterData'
import {
    getModelPricing,
    resetModelDataForTests,
    seedLiteLLMForTests,
    seedModelDataForTests,
} from 'src/ts/model/modelData/modelDataService.svelte'
import { language } from 'src/lang'
import { basicParameterItems } from './botSettingsParamsData'
import fixture from 'src/ts/model/modelData/tests/openrouterRows.fixture.json'

const T = 1_800_000_000_000

const item: SettingItem | undefined = basicParameterItems.find((i) => i.id === 'params.maxContext')

function catalog(models: LLMModel[], internalID: string): LLMModel {
    const found = models.find((m) => (m.internalID ?? m.id) === internalID)
    if (!found) throw new Error('catalog entry missing: ' + internalID)
    return found
}

function figure(modelInfo: Pick<LLMModel, 'id' | 'internalID' | 'provider'>, routed?: string): number | undefined {
    if (!item?.options?.actualMax) {
        throw new Error('params.maxContext has no actualMax')
    }
    const db = { openrouterRequestModel: routed } as unknown as Database
    return item.options.actualMax({ db, modelInfo, subModelInfo: modelInfo } as unknown as SettingContext)
}

beforeEach(() => {
    resetModelDataForTests()
})

afterEach(() => {
    resetModelDataForTests()
})

describe('params.maxContext actualMax wiring', () => {
    test('(F) W1 a first-party OpenAI entry gets the listed context', () => {
        seedModelDataForTests(parseOpenRouterModels(fixture, T))
        expect(figure(catalog(OpenAIModels, 'gpt-4o'))).toBe(128000)
    })

    test('(F) W2 an Anthropic entry gets no figure even when its row exists', () => {
        seedModelDataForTests(parseOpenRouterModels(fixture, T))
        const modelInfo = catalog(AnthropicModels, 'claude-sonnet-4-6')
        expect(modelInfo.provider).toBe(LLMProvider.Anthropic)
        expect(figure(modelInfo)).toBeUndefined()
        // Anthropic is priced from LiteLLM only: OpenRouter's row does not answer for it.
        expect(getModelPricing(modelInfo, { openrouterRequestModel: undefined })).toBeUndefined()
    })

    test('(F) W2b an Anthropic entry gets its figure and price from the LiteLLM row, ahead of OpenRouter', () => {
        seedModelDataForTests(parseOpenRouterModels(fixture, T))
        const dataset = parseLiteLLMDataset({ 'claude-sonnet-4-6': { litellm_provider: 'anthropic', mode: 'chat', max_input_tokens: 200000, input_cost_per_token: 0.000003 } }, T)
        if (dataset === null) throw new Error('dataset must parse')
        seedLiteLLMForTests(dataset)
        const modelInfo = catalog(AnthropicModels, 'claude-sonnet-4-6')
        expect(figure(modelInfo)).toBe(200000)
        expect(getModelPricing(modelInfo, { openrouterRequestModel: undefined })).toEqual({ input: '0.000003' })
    })

    test('(F) W3 the routed openrouter entry reads the exact row of the requested model', () => {
        seedModelDataForTests(parseOpenRouterModels(fixture, T))
        const routed = { id: 'openrouter', provider: LLMProvider.AsIs }
        expect(figure(routed, 'anthropic/claude-sonnet-4.6')).toBe(1000000)
    })

    test('(G) W4 a routed model without a row has no figure', () => {
        seedModelDataForTests(parseOpenRouterModels(fixture, T))
        const routed = { id: 'openrouter', provider: LLMProvider.AsIs }
        expect(figure(routed, 'risu/free')).toBeUndefined()
        expect(figure(routed, 'nosuch/model-xyz')).toBeUndefined()
    })

    test('(G) W5 before the data is loaded the figure is undefined and nothing throws', () => {
        expect(figure(catalog(OpenAIModels, 'gpt-4o'))).toBeUndefined()
    })

    test('(F) W6 the dated twin keeps its own row: only its price tells it from the base entry', () => {
        seedModelDataForTests(parseOpenRouterModels(fixture, T))
        const twin = catalog(OpenAIModels, 'gpt-4o-2024-05-13')
        const base = catalog(OpenAIModels, 'gpt-4o')
        const db = { openrouterRequestModel: undefined }
        expect(figure(twin)).toBe(128000)
        expect(getModelPricing(twin, db)).toMatchObject({ input: '0.000005', output: '0.000015' })
        expect(getModelPricing(base, db)).toMatchObject({ input: '0.0000025', output: '0.00001' })
    })

    test('(F) the item keeps min 0 and warns through the English language table', () => {
        expect(item?.options?.min).toBe(0)
        const warn = item?.options?.actualMaxWarning
        expect(warn).toBeTypeOf('function')
        expect(warn?.('128,000')).toBe(language.maxContextAboveModelMax('128,000'))
        expect(warn?.('128,000')).toContain('128,000')
    })
})

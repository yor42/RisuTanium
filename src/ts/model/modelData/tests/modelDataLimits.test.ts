/**
 * The limit and price choice between the LiteLLM dataset and OpenRouter. Per
 * field: a routed `openrouter` entry reads OpenRouter's exact row only; a
 * direct entry reads its LiteLLM row first and OpenAI and Google fall back to
 * OpenRouter's first-party row; Anthropic never falls back. One field never
 * mixes two sources. The pure functions are tested directly and through the
 * service getters over seeded snapshots.
 *
 * Labels: (F) feature test that fails against a missing or wrong
 * implementation on its own assertion; (G) guard.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { LLMProvider } from '../../types'
import {
    buildIndex,
    parseOpenRouterModels,
    type OpenRouterIndex,
} from '../openrouterData'
import {
    buildLiteLLMIndex,
    chooseContextLimit,
    choosePricing,
    parseLiteLLMDataset,
    type LiteLLMIndex,
} from '../litellmData'
import {
    getModelContextLimit,
    getModelPricing,
    resetModelDataForTests,
    seedLiteLLMForTests,
    seedModelDataForTests,
} from '../modelDataService.svelte'
import openrouterFixture from './openrouterRows.fixture.json'

const T = 1_800_000_000_000

function openrouter(): OpenRouterIndex {
    const data = parseOpenRouterModels(openrouterFixture, T)
    if (data === null) {
        throw new Error('fixture must parse')
    }
    return buildIndex(data)
}

function litellmData(rows: Record<string, Record<string, unknown>>) {
    const data = parseLiteLLMDataset(rows, T)
    if (data === null) {
        throw new Error('rows must parse')
    }
    return data
}

function litellm(rows: Record<string, Record<string, unknown>>): LiteLLMIndex {
    return buildLiteLLMIndex(litellmData(rows))
}

const row = (extra: Record<string, unknown>) => ({ litellm_provider: 'openai', mode: 'chat', ...extra })
const anthropicRow = (extra: Record<string, unknown>) => ({ litellm_provider: 'anthropic', mode: 'chat', ...extra })

const gpt4o = { id: 'gpt-4o', provider: LLMProvider.OpenAI }
const sonnet45 = { id: 'claude-sonnet-4-5', internalID: 'claude-sonnet-4-5', provider: LLMProvider.Anthropic }
const gemini25Pro = { id: 'gemini-2.5-pro', internalID: 'models/gemini-2.5-pro', provider: LLMProvider.GoogleCloud }
const routed = { id: 'openrouter', provider: LLMProvider.AsIs }

describe('chooseContextLimit', () => {
    test('(F) a direct model takes the LiteLLM figure even when OpenRouter lists another', () => {
        const lit = litellm({ 'claude-sonnet-4-5': anthropicRow({ max_input_tokens: 200000 }) })
        expect(chooseContextLimit(openrouter(), lit, sonnet45)).toBe(200000)
        const openai = litellm({ 'gpt-4o': row({ max_input_tokens: 4321 }) })
        expect(chooseContextLimit(openrouter(), openai, gpt4o)).toBe(4321)
    })

    test('(F) OpenAI and Google fall back to the OpenRouter first-party row when LiteLLM has no row', () => {
        const empty = litellm({ 'unrelated-model': row({ max_input_tokens: 1 }) })
        expect(chooseContextLimit(openrouter(), empty, gpt4o)).toBe(128000)
        expect(chooseContextLimit(openrouter(), null, gpt4o)).toBe(128000)
        expect(chooseContextLimit(openrouter(), empty, gemini25Pro)).toBe(1048576)
    })

    test('(F) the fallback is per field: a LiteLLM row without a context still lets OpenRouter answer', () => {
        const priceOnly = litellm({ 'gpt-4o': row({ input_cost_per_token: 1 }) })
        expect(chooseContextLimit(openrouter(), priceOnly, gpt4o)).toBe(128000)
    })

    test('(F) Anthropic never falls back to OpenRouter', () => {
        expect(chooseContextLimit(openrouter(), null, sonnet45)).toBeUndefined()
        const empty = litellm({ 'unrelated-model': row({ max_input_tokens: 1 }) })
        expect(chooseContextLimit(openrouter(), empty, sonnet45)).toBeUndefined()
        const priceOnly = litellm({ 'claude-sonnet-4-5': anthropicRow({ input_cost_per_token: 1 }) })
        expect(chooseContextLimit(openrouter(), priceOnly, sonnet45)).toBeUndefined()
    })

    test('(F) a routed openrouter entry reads OpenRouter only, never a LiteLLM row', () => {
        const lit = litellm({ 'claude-sonnet-4-5': anthropicRow({ max_input_tokens: 5 }), 'anthropic/claude-sonnet-4.6': row({ max_input_tokens: 6 }) })
        expect(chooseContextLimit(openrouter(), lit, routed, 'anthropic/claude-sonnet-4.6')).toBe(1000000)
        expect(chooseContextLimit(openrouter(), lit, routed, 'risu/free')).toBeUndefined()
        expect(chooseContextLimit(openrouter(), lit, routed, undefined)).toBeUndefined()
        expect(chooseContextLimit(null, lit, routed, 'anthropic/claude-sonnet-4.6')).toBeUndefined()
    })

    test('(G) with neither source there is no figure, and LiteLLM alone answers without OpenRouter', () => {
        expect(chooseContextLimit(null, null, gpt4o)).toBeUndefined()
        expect(chooseContextLimit(null, litellm({ 'gpt-4o': row({ max_input_tokens: 77 }) }), gpt4o)).toBe(77)
        expect(chooseContextLimit(null, litellm({ 'claude-sonnet-4-5': anthropicRow({ max_input_tokens: 78 }) }), sonnet45)).toBe(78)
    })
})

describe('choosePricing', () => {
    test('(F) a direct model takes the LiteLLM price, Anthropic included', () => {
        const lit = litellm({
            'claude-sonnet-4-5': anthropicRow({ input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5 }),
            'gpt-4o': row({ input_cost_per_token: 9e-6, output_cost_per_token: 9e-5 }),
        })
        expect(choosePricing(openrouter(), lit, sonnet45)).toEqual({ input: '0.000003', output: '0.000015' })
        expect(choosePricing(openrouter(), lit, gpt4o)).toEqual({ input: '0.000009', output: '0.00009' })
    })

    test('(F) OpenAI and Google fall back to OpenRouter when LiteLLM has no row or no price', () => {
        expect(choosePricing(openrouter(), null, gpt4o)).toMatchObject({ input: '0.0000025', output: '0.00001' })
        const ctxOnly = litellm({ 'gpt-4o': row({ max_input_tokens: 1 }) })
        expect(choosePricing(openrouter(), ctxOnly, gpt4o)).toMatchObject({ input: '0.0000025', output: '0.00001' })
        expect(choosePricing(openrouter(), null, gemini25Pro)).toMatchObject({ input: '0.00000125' })
    })

    test('(F) Anthropic pricing is LiteLLM only: with no LiteLLM price it is unknown', () => {
        expect(choosePricing(openrouter(), null, sonnet45)).toBeUndefined()
        const ctxOnly = litellm({ 'claude-sonnet-4-5': anthropicRow({ max_input_tokens: 1 }) })
        expect(choosePricing(openrouter(), ctxOnly, sonnet45)).toBeUndefined()
    })

    test('(F) one field never mixes sources: the LiteLLM price object is used whole', () => {
        const partial = litellm({ 'gpt-4o': row({ input_cost_per_token: 9e-6 }) })
        const chosen = choosePricing(openrouter(), partial, gpt4o)
        expect(chosen).toEqual({ input: '0.000009' })
        expect(chosen?.output).toBeUndefined()
        expect(chosen?.cacheRead).toBeUndefined()
    })

    test('(F) a routed openrouter entry prices from OpenRouter only', () => {
        const lit = litellm({ 'gpt-4o': row({ input_cost_per_token: 9e-6 }) })
        expect(choosePricing(openrouter(), lit, routed, 'anthropic/claude-sonnet-4.6')).toMatchObject({ input: '0.000003', output: '0.000015' })
        expect(choosePricing(openrouter(), lit, routed, 'risu/free')).toBeUndefined()
    })

    test('(G) the chosen price is a copy: changing it leaves the dataset row intact', () => {
        const lit = litellm({ 'gpt-4o': row({ input_cost_per_token: 9e-6 }) })
        const chosen = choosePricing(null, lit, gpt4o)
        if (chosen) {
            chosen.input = 'changed'
        }
        expect(choosePricing(null, lit, gpt4o)).toEqual({ input: '0.000009' })
    })
})

describe('the service getters keep their signatures and read both snapshots', () => {
    const db = { openrouterRequestModel: undefined as string | undefined }

    beforeEach(() => {
        resetModelDataForTests()
    })

    afterEach(() => {
        resetModelDataForTests()
    })

    test('(F) LiteLLM wins where the sources differ (claude-sonnet-4-5: 200,000 against 1,000,000)', () => {
        seedModelDataForTests(parseOpenRouterModels(openrouterFixture, T))
        seedLiteLLMForTests(litellmData({ 'claude-sonnet-4-5': anthropicRow({ max_input_tokens: 200000, input_cost_per_token: 3e-6 }) }))
        expect(getModelContextLimit(sonnet45, db)).toBe(200000)
        expect(getModelPricing(sonnet45, db)).toEqual({ input: '0.000003' })
    })

    test('(F) Anthropic with only OpenRouter data has no figure and no price', () => {
        seedModelDataForTests(parseOpenRouterModels(openrouterFixture, T))
        expect(getModelContextLimit(sonnet45, db)).toBeUndefined()
        expect(getModelPricing(sonnet45, db)).toBeUndefined()
    })

    test('(F) OpenAI with only OpenRouter data still has both, and LiteLLM alone is enough', () => {
        seedModelDataForTests(parseOpenRouterModels(openrouterFixture, T))
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(getModelPricing(gpt4o, db)).toMatchObject({ input: '0.0000025' })
        resetModelDataForTests()
        seedLiteLLMForTests(litellmData({ 'gpt-4o': row({ max_input_tokens: 4321, input_cost_per_token: 9e-6 }) }))
        expect(getModelContextLimit(gpt4o, db)).toBe(4321)
        expect(getModelPricing(gpt4o, db)).toEqual({ input: '0.000009' })
    })

    test('(F) a routed model reads OpenRouter only, from db.openrouterRequestModel', () => {
        seedModelDataForTests(parseOpenRouterModels(openrouterFixture, T))
        seedLiteLLMForTests(litellmData({ 'gpt-4o': row({ max_input_tokens: 4321 }) }))
        expect(getModelContextLimit(routed, { openrouterRequestModel: 'anthropic/claude-sonnet-4.6' })).toBe(1000000)
        expect(getModelContextLimit(routed, { openrouterRequestModel: 'gpt-4o' })).toBeUndefined()
    })

    test('(G) before any data the getters answer undefined, and a throwing lookup answers undefined', () => {
        expect(getModelContextLimit(gpt4o, db)).toBeUndefined()
        expect(getModelPricing(gpt4o, db)).toBeUndefined()
        seedLiteLLMForTests(litellmData({ 'gpt-4o': row({ max_input_tokens: 1 }) }))
        const broken = { id: undefined as unknown as string, provider: LLMProvider.OpenAI }
        expect(getModelContextLimit(broken, db)).toBeUndefined()
        expect(getModelPricing(broken, db)).toBeUndefined()
    })
})

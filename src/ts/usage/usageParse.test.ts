/**
 * Provider usage payloads to normalised usage. Fixtures are synthetic payloads
 * shaped like each provider's documented usage object.
 *
 * Labels: (G) compatibility guard over a new module; backed by scratch mutants.
 */
import { describe, test, expect } from 'vitest'
import {
    mergeAnthropicStreamUsage,
    parseAnthropicUsage,
    parseGoogleUsage,
    parseOpenAIChatUsage,
    parseResponsesUsage,
} from './usageParse'

describe('parseOpenAIChatUsage (G)', () => {
    test('plain usage', () => {
        expect(parseOpenAIChatUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }))
            .toEqual({ input: 120, output: 30, cacheRead: 0, cacheWrite: 0 })
    })

    test('cached tokens are subtracted from input and reported as cacheRead', () => {
        expect(parseOpenAIChatUsage({
            prompt_tokens: 100,
            completion_tokens: 7,
            prompt_tokens_details: { cached_tokens: 40 },
        })).toEqual({ input: 60, output: 7, cacheRead: 40, cacheWrite: 0 })
    })

    test('cached larger than prompt never gives a negative input', () => {
        expect(parseOpenAIChatUsage({ prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 12 } }))
            .toEqual({ input: 0, output: 1, cacheRead: 12, cacheWrite: 0 })
    })

    test('null, non-objects and garbage give null, not zeros', () => {
        expect(parseOpenAIChatUsage(null)).toBeNull()
        expect(parseOpenAIChatUsage(undefined)).toBeNull()
        expect(parseOpenAIChatUsage('usage')).toBeNull()
        expect(parseOpenAIChatUsage(42)).toBeNull()
        expect(parseOpenAIChatUsage([])).toBeNull()
        expect(parseOpenAIChatUsage({})).toBeNull()
        expect(parseOpenAIChatUsage({ prompt_tokens: 'x', completion_tokens: -1 })).toBeNull()
        expect(parseOpenAIChatUsage({ prompt_tokens: 1.5, completion_tokens: NaN })).toBeNull()
    })

    test('one valid core count is enough; the other counts as 0', () => {
        expect(parseOpenAIChatUsage({ prompt_tokens: 5 })).toEqual({ input: 5, output: 0, cacheRead: 0, cacheWrite: 0 })
    })
})

describe('parseResponsesUsage (G)', () => {
    test('input excludes cached tokens and output is taken as reported', () => {
        expect(parseResponsesUsage({
            input_tokens: 200,
            output_tokens: 90,
            input_tokens_details: { cached_tokens: 150 },
            output_tokens_details: { reasoning_tokens: 60 },
        })).toEqual({ input: 50, output: 90, cacheRead: 150, cacheWrite: 0 })
    })

    test('no details', () => {
        expect(parseResponsesUsage({ input_tokens: 8, output_tokens: 2 }))
            .toEqual({ input: 8, output: 2, cacheRead: 0, cacheWrite: 0 })
    })

    test('null and garbage give null', () => {
        expect(parseResponsesUsage(null)).toBeNull()
        expect(parseResponsesUsage({ prompt_tokens: 3 })).toBeNull()
    })
})

describe('parseAnthropicUsage (G)', () => {
    test('all four fields map one to one', () => {
        expect(parseAnthropicUsage({
            input_tokens: 11,
            output_tokens: 22,
            cache_read_input_tokens: 33,
            cache_creation_input_tokens: 44,
        })).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 })
    })

    test('null and garbage give null', () => {
        expect(parseAnthropicUsage(null)).toBeNull()
        expect(parseAnthropicUsage({ input_tokens: -2, output_tokens: 'a' })).toBeNull()
    })
})

describe('mergeAnthropicStreamUsage (G)', () => {
    const start = { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 }

    test('a delta with only output_tokens replaces output and keeps the start values', () => {
        expect(mergeAnthropicStreamUsage(start, { output_tokens: 80 }))
            .toEqual({ input: 100, output: 80, cacheRead: 20, cacheWrite: 5 })
    })

    test('every field the delta carries replaces the start value', () => {
        expect(mergeAnthropicStreamUsage(start, {
            input_tokens: 90,
            output_tokens: 70,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 0,
        })).toEqual({ input: 90, output: 70, cacheRead: 10, cacheWrite: 0 })
    })

    test('a field the delta carries invalidly keeps the start value', () => {
        expect(mergeAnthropicStreamUsage(start, { output_tokens: 'many', input_tokens: -1 }))
            .toEqual({ input: 100, output: 1, cacheRead: 20, cacheWrite: 5 })
    })

    test('a null start with a usable delta gives the delta alone', () => {
        expect(mergeAnthropicStreamUsage(null, { output_tokens: 9 }))
            .toEqual({ input: 0, output: 9, cacheRead: 0, cacheWrite: 0 })
    })

    test('a start with no usable delta gives the start', () => {
        expect(mergeAnthropicStreamUsage(start, null)).toEqual({ input: 100, output: 1, cacheRead: 20, cacheWrite: 5 })
    })

    test('nothing usable gives null', () => {
        expect(mergeAnthropicStreamUsage(null, null)).toBeNull()
        expect(mergeAnthropicStreamUsage('x', {})).toBeNull()
    })
})

describe('parseGoogleUsage (G)', () => {
    test('thought tokens add to output, tool-use prompt tokens add to input', () => {
        expect(parseGoogleUsage({
            promptTokenCount: 300,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 25,
            toolUsePromptTokenCount: 6,
            cachedContentTokenCount: 100,
            totalTokenCount: 371,
        })).toEqual({ input: 206, output: 65, cacheRead: 100, cacheWrite: 0 })
    })

    test('plain usage', () => {
        expect(parseGoogleUsage({ promptTokenCount: 10, candidatesTokenCount: 4 }))
            .toEqual({ input: 10, output: 4, cacheRead: 0, cacheWrite: 0 })
    })

    test('cached larger than prompt never gives a negative input', () => {
        expect(parseGoogleUsage({ promptTokenCount: 5, candidatesTokenCount: 1, cachedContentTokenCount: 9 }))
            .toEqual({ input: 0, output: 1, cacheRead: 9, cacheWrite: 0 })
    })

    test('null and garbage give null', () => {
        expect(parseGoogleUsage(null)).toBeNull()
        expect(parseGoogleUsage({ totalTokenCount: 5 })).toBeNull()
        expect(parseGoogleUsage({ promptTokenCount: '5', candidatesTokenCount: 1.2 })).toBeNull()
    })
})

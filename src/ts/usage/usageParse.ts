import type { TokenUsage } from './usageTypes'

/**
 * Provider payloads enter as `unknown` and are narrowed here. Every parser
 * returns null for a non-object or when no core count is a finite non-negative
 * integer, so a missing usage is never read as zero usage. A missing optional
 * field counts as 0.
 */

type Raw = Record<string, unknown>

function isRaw(value: unknown): value is Raw {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function countOr0(value: unknown): number {
    return count(value) ?? 0
}

function detail(raw: Raw, key: string, field: string): number {
    const group = raw[key]
    return isRaw(group) ? countOr0(group[field]) : 0
}

function hasCore(raw: Raw, keys: readonly string[]): boolean {
    return keys.some(key => count(raw[key]) !== null)
}

export function parseOpenAIChatUsage(u: unknown): TokenUsage | null {
    if (!isRaw(u) || !hasCore(u, ['prompt_tokens', 'completion_tokens'])) {
        return null
    }
    const prompt = countOr0(u.prompt_tokens)
    const cached = detail(u, 'prompt_tokens_details', 'cached_tokens')
    return {
        input: Math.max(0, prompt - cached),
        output: countOr0(u.completion_tokens),
        cacheRead: cached,
        cacheWrite: 0,
    }
}

/** `output_tokens` already includes the reasoning tokens. */
export function parseResponsesUsage(u: unknown): TokenUsage | null {
    if (!isRaw(u) || !hasCore(u, ['input_tokens', 'output_tokens'])) {
        return null
    }
    const input = countOr0(u.input_tokens)
    const cached = detail(u, 'input_tokens_details', 'cached_tokens')
    return {
        input: Math.max(0, input - cached),
        output: countOr0(u.output_tokens),
        cacheRead: cached,
        cacheWrite: 0,
    }
}

export function parseAnthropicUsage(u: unknown): TokenUsage | null {
    if (!isRaw(u) || !hasCore(u, ['input_tokens', 'output_tokens'])) {
        return null
    }
    return {
        input: countOr0(u.input_tokens),
        output: countOr0(u.output_tokens),
        cacheRead: countOr0(u.cache_read_input_tokens),
        cacheWrite: countOr0(u.cache_creation_input_tokens),
    }
}

const ANTHROPIC_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const

/**
 * Anthropic stream usage is cumulative: each raw field the `message_delta`
 * usage carries as a valid count replaces the `message_start` value, and a
 * field it does not carry keeps the start value. Both arguments are raw
 * provider usage objects.
 */
export function mergeAnthropicStreamUsage(start: unknown, delta: unknown): TokenUsage | null {
    const merged: Raw = {}
    for (const field of ANTHROPIC_FIELDS) {
        const fromDelta = isRaw(delta) ? count(delta[field]) : null
        const fromStart = isRaw(start) ? count(start[field]) : null
        const value = fromDelta ?? fromStart
        if (value !== null) {
            merged[field] = value
        }
    }
    return parseAnthropicUsage(merged)
}

/** Thought tokens are output; tool-use prompt tokens are input; cached content is a cache read. */
export function parseGoogleUsage(u: unknown): TokenUsage | null {
    if (!isRaw(u) || !hasCore(u, ['promptTokenCount', 'candidatesTokenCount'])) {
        return null
    }
    const cached = countOr0(u.cachedContentTokenCount)
    return {
        input: Math.max(0, countOr0(u.promptTokenCount) - cached) + countOr0(u.toolUsePromptTokenCount),
        output: countOr0(u.candidatesTokenCount) + countOr0(u.thoughtsTokenCount),
        cacheRead: cached,
        cacheWrite: 0,
    }
}

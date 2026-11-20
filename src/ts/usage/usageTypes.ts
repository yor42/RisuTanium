/**
 * Normalised token usage of one provider response.
 * All fields are non-negative integers. `input` excludes cache reads and writes;
 * `output` includes reasoning and thought tokens.
 */
export interface TokenUsage {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
}

/** The request modes a usage purpose can fall back to. Mirrors `ModelModeExtended`. */
export type UsageMode = 'model' | 'submodel' | 'memory' | 'emotion' | 'otherAx' | 'translate'

/** Persisted in ledger keys: the codes are never respelled. */
export type UsagePurpose = 'chat' | 'utility' | 'plugin' | UsageMode

/** One settled request attempt. `reported` and `estimated` are never both set. */
export interface UsageEntry {
    modelKey: string
    purpose: UsagePurpose
    reported: TokenUsage | null
    estimated: { input: number, output: number } | null
}

/** What a provider call site sees: it reports each response's usage and flags a failed attempt. */
export interface UsageMeter {
    report(usage: TokenUsage): void
    markFailed(): void
}

/** What the settling side sees: the sum of every report and the failed flag. */
export interface UsageMeterState extends UsageMeter {
    reported(): TokenUsage | null
    failed(): boolean
}

/**
 * Prices as decimal strings. A catalog price is USD per token; a user override
 * (`usagePriceOverrides`) is USD per 1M tokens. A missing field means unpriced.
 */
export interface PriceOverride {
    input?: string
    output?: string
    cacheRead?: string
    cacheWrite?: string
}

export type PriceSource = 'catalog' | 'override'

export type DecimalString = string

/** Months of usage statistics kept by the retention setting; an absent setting keeps every month. */
export type UsageRetentionMonths = 3 | 6 | 12 | 24

export interface CostResult {
    status: 'priced' | 'partial' | 'unpriced'
    /** Exact USD amount; absent when unpriced. For `partial` it covers only the priced kinds. */
    usd?: DecimalString
}

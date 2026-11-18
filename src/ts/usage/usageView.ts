import type { LLMModel } from '../model/types'
import { getModelPricing } from '../model/modelData/modelDataService.svelte'
import { costOf } from './usageCost'
import { readUsage, type UsageCounter, type UsageOverflow, type UsageRow } from './usageLedger'
import type { CostResult, PriceOverride, PriceSource, TokenUsage } from './usageTypes'

/**
 * Pure read model of the usage ledger for the Statistics page. Nothing here changes `statics`.
 *
 * Invariants:
 *  - Cost is computed per (month, purpose, model) bucket and summed exactly, so an override or a missing price
 *    applies to the model it belongs to and never leaks into another bucket.
 *  - An override for the model key replaces the catalog price as a whole; routed `reverse_proxy>`, `nanogpt>` and
 *    `ollama>` keys have no catalog price, so they are unpriced unless overridden.
 *  - An unpriced result never carries an amount, so the page cannot show it as $0.
 */

export interface UsageTotals {
    requests: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    /** True when any counted token is a local estimate (`ei`/`eo`); the token columns then include it. */
    estimated: boolean
}

export interface UsageSummary extends UsageTotals {
    cost: CostResult
}

export interface MonthRow extends UsageSummary {
    month: string
}

export interface ModelRow extends UsageSummary {
    modelKey: string
    /** The name shown: a custom model's own name while it exists, else the ledger label. */
    label: string
    /** Where the price came from; `none` when the model has no price at all. */
    priceSource: PriceSource | 'none'
    override: PriceOverride | undefined
}

export interface PurposeRow extends UsageSummary {
    purpose: string
}

export interface UsageView {
    /** Months newest first. */
    months: MonthRow[]
    overflow: (UsageTotals & { present: boolean })
    modelsOf(month: string): ModelRow[]
    purposesOf(month: string): PurposeRow[]
    totalOf(month: string): UsageSummary
}

export interface UsageViewContext {
    overrides: Record<string, PriceOverride> | undefined
    customModels: readonly { id: string, name: string }[] | undefined
    /**
     * The model-list lookup (`getModelInfo`), injected so this module does not pull the whole model list and its
     * runtime into every page that can show it.
     */
    modelInfo: (id: string) => Pick<LLMModel, 'id' | 'internalID' | 'provider'>
}

type ModelInfoOf = UsageViewContext['modelInfo']

/** Persisted purpose codes mapped to the `usageStats` string that names them. */
export const PURPOSE_LABEL_KEYS = {
    chat: 'purposeChat',
    utility: 'purposeUtility',
    plugin: 'purposePlugin',
    model: 'purposeModel',
    submodel: 'purposeSubmodel',
    memory: 'purposeMemory',
    emotion: 'purposeEmotion',
    otherAx: 'purposeOtherAx',
    translate: 'purposeTranslate',
} as const

export type PurposeLabelKey = typeof PURPOSE_LABEL_KEYS[keyof typeof PURPOSE_LABEL_KEYS] | 'purposeUnknown'

export function purposeLabelKey(purpose: string): PurposeLabelKey {
    return Object.hasOwn(PURPOSE_LABEL_KEYS, purpose) ? PURPOSE_LABEL_KEYS[purpose as keyof typeof PURPOSE_LABEL_KEYS] : 'purposeUnknown'
}

interface Bucket {
    month: string
    purpose: string
    model: string
    counts: Partial<Record<UsageCounter, number>>
}

function emptyTotals(): UsageTotals {
    return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estimated: false }
}

function totalsOf(counts: Partial<Record<UsageCounter, number>>): UsageTotals {
    const n = (counter: UsageCounter): number => counts[counter] ?? 0
    return {
        requests: n('n'),
        input: n('i') + n('ei'),
        output: n('o') + n('eo'),
        cacheRead: n('cr'),
        cacheWrite: n('cw'),
        estimated: n('ei') > 0 || n('eo') > 0,
    }
}

function addTotals(into: UsageTotals, other: UsageTotals): void {
    into.requests += other.requests
    into.input += other.input
    into.output += other.output
    into.cacheRead += other.cacheRead
    into.cacheWrite += other.cacheWrite
    into.estimated = into.estimated || other.estimated
}

function tokensOf(totals: UsageTotals): TokenUsage {
    return { input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheWrite: totals.cacheWrite }
}

/** The routed id after the first `>`, or null for a key without one. */
function splitRouted(modelKey: string): { prefix: string, routed: string } | null {
    const at = modelKey.indexOf('>')
    return at < 0 ? null : { prefix: modelKey.slice(0, at), routed: modelKey.slice(at + 1) }
}

/** The catalog price of a ledger model key, or undefined when it has none. Never throws. */
function catalogPriceOf(modelKey: string, modelInfo: ModelInfoOf): PriceOverride | undefined {
    try {
        const routed = splitRouted(modelKey)
        if (routed === null) {
            return getModelPricing(modelInfo(modelKey), { openrouterRequestModel: undefined })
        }
        if (routed.prefix === 'openrouter') {
            return getModelPricing(modelInfo('openrouter'), { openrouterRequestModel: routed.routed })
        }
        return undefined
    } catch {
        return undefined
    }
}

function resolvePrice(modelKey: string, overrides: UsageViewContext['overrides'], modelInfo: ModelInfoOf): { price: PriceOverride | undefined, source: PriceSource | 'none' } {
    if (overrides !== undefined && overrides !== null && Object.hasOwn(overrides, modelKey)) {
        return { price: overrides[modelKey], source: 'override' }
    }
    const price = catalogPriceOf(modelKey, modelInfo)
    return { price, source: price === undefined ? 'none' : 'catalog' }
}

/** Adds two non-negative plain decimal strings exactly (no exponent), as `costOf` formats them. */
export function addDecimals(a: string, b: string): string {
    const split = (text: string): [bigint, number] => {
        const [whole, fraction = ''] = text.split('.')
        return [BigInt(whole + fraction), fraction.length]
    }
    const [left, leftScale] = split(a)
    const [right, rightScale] = split(b)
    const scale = Math.max(leftScale, rightScale)
    const sum = left * 10n ** BigInt(scale - leftScale) + right * 10n ** BigInt(scale - rightScale)
    const text = sum.toString().padStart(scale + 1, '0')
    const whole = text.slice(0, text.length - scale)
    const fraction = text.slice(text.length - scale).replace(/0+$/, '')
    return fraction === '' ? whole : `${whole}.${fraction}`
}

/**
 * Combines bucket costs. All unpriced gives unpriced; every bucket fully priced gives priced; anything else gives
 * partial with the sum of the amounts that exist.
 */
function combineCosts(costs: CostResult[]): CostResult {
    let usd: string | undefined
    let allPriced = true
    for (const cost of costs) {
        if (cost.status !== 'priced') {
            allPriced = false
        }
        if (cost.usd !== undefined) {
            usd = usd === undefined ? cost.usd : addDecimals(usd, cost.usd)
        }
    }
    if (usd === undefined) {
        return { status: 'unpriced' }
    }
    return { status: allPriced ? 'priced' : 'partial', usd }
}

/**
 * `$` plus the amount rounded half up to at most 4 decimals, at least 2 (trailing zeros beyond that dropped); a positive
 * amount below 0.0001 reads `< $0.0001`. The input is an exact decimal string from `costOf`.
 */
export function formatUsd(usd: string): string {
    const [whole, fraction = ''] = usd.split('.')
    const padded = fraction.padEnd(5, '0')
    const scaled = BigInt(whole + padded.slice(0, 4))
    const rest = padded.slice(4)
    const positive = BigInt(whole + fraction) > 0n
    if (positive && scaled === 0n) {
        return '< $0.0001'
    }
    const rounded = rest.length > 0 && rest[0] >= '5' ? scaled + 1n : scaled
    const digits = rounded.toString().padStart(5, '0')
    const decimals = digits.slice(-4).replace(/0+$/, '').padEnd(2, '0')
    return `$${digits.slice(0, -4)}.${decimals}`
}

function costOfBucket(totals: UsageTotals, modelKey: string, context: UsageViewContext): CostResult {
    const { price, source } = resolvePrice(modelKey, context.overrides, context.modelInfo)
    return costOf(tokensOf(totals), price, source === 'override' ? 'override' : 'catalog')
}

function groupBuckets(rows: UsageRow[]): Bucket[] {
    const buckets = new Map<string, Bucket>()
    for (const row of rows) {
        const id = JSON.stringify([row.month, row.purpose, row.model])
        let bucket = buckets.get(id)
        if (bucket === undefined) {
            bucket = { month: row.month, purpose: row.purpose, model: row.model, counts: {} }
            buckets.set(id, bucket)
        }
        bucket.counts[row.counter] = (bucket.counts[row.counter] ?? 0) + row.value
    }
    return [...buckets.values()]
}

function summarise(items: { totals: UsageTotals, cost: CostResult }[]): UsageSummary {
    const totals = emptyTotals()
    for (const item of items) {
        addTotals(totals, item.totals)
    }
    return { ...totals, cost: combineCosts(items.map((item) => item.cost)) }
}

function overflowTotals(overflow: UsageOverflow): UsageTotals & { present: boolean } {
    return { ...totalsOf(overflow), present: Object.values(overflow).some((value) => value !== undefined && value > 0) }
}

/** Builds the page's read model from `db.statics`; malformed and unknown-version keys are ignored by `readUsage`. */
export function buildUsageView(statics: unknown, context: UsageViewContext): UsageView {
    const { rows, overflow } = readUsage(statics)
    const priced = groupBuckets(rows).map((bucket) => {
        const totals = totalsOf(bucket.counts)
        return { bucket, totals, cost: costOfBucket(totals, bucket.model, context) }
    })
    const months = [...new Set(priced.map((item) => item.bucket.month))].sort().reverse()
    const labelOf = (modelKey: string): string => {
        if (modelKey.startsWith('xcustom:::')) {
            const found = context.customModels?.find((model) => model.id === modelKey)
            if (found !== undefined) {
                return found.name
            }
        }
        return modelKey
    }
    const inMonth = (month: string) => priced.filter((item) => item.bucket.month === month)
    return {
        months: months.map((month) => ({ month, ...summarise(inMonth(month)) })),
        overflow: overflowTotals(overflow),
        modelsOf(month: string): ModelRow[] {
            const keys = [...new Set(inMonth(month).map((item) => item.bucket.model))]
            return keys.map((modelKey) => {
                const { price, source } = resolvePrice(modelKey, context.overrides, context.modelInfo)
                return {
                    modelKey,
                    label: labelOf(modelKey),
                    priceSource: source,
                    override: source === 'override' ? price : undefined,
                    ...summarise(inMonth(month).filter((item) => item.bucket.model === modelKey)),
                }
            }).sort((a, b) => b.requests - a.requests || a.modelKey.localeCompare(b.modelKey))
        },
        purposesOf(month: string): PurposeRow[] {
            const keys = [...new Set(inMonth(month).map((item) => item.bucket.purpose))]
            return keys.map((purpose) => ({
                purpose,
                ...summarise(inMonth(month).filter((item) => item.bucket.purpose === purpose)),
            })).sort((a, b) => b.requests - a.requests || a.purpose.localeCompare(b.purpose))
        },
        totalOf(month: string): UsageSummary {
            return summarise(inMonth(month))
        },
    }
}

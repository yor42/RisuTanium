import { LLMProvider } from '../types'

/**
 * Pure data layer for the OpenRouter model listing: what is kept from the
 * response, how it is stored, and how a catalog model finds its row. Nothing
 * here touches the network, the store or a rune.
 *
 * Rows are keyed by the RAW OpenRouter id exactly as listed. Normalisation
 * happens only when a catalog model looks its row up, so a change to the
 * matching rule never invalidates stored data.
 */

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
export const OPENROUTER_DATA_KEY = 'modeldata/openrouter.json'
export const OPENROUTER_TTL_MS = 24 * 60 * 60 * 1000

/** Prices are decimal strings in USD per token, kept as the source wrote them. */
export interface OpenRouterPricing {
    input?: string
    output?: string
    cacheRead?: string
    cacheWrite?: string
    reasoning?: string
}

export interface OpenRouterLimits {
    context: number
}

export interface OpenRouterData {
    v: 1
    priceUnit: 'usd-per-token'
    fetchedAt: number
    limits: Record<string, OpenRouterLimits>
    pricing: Record<string, OpenRouterPricing>
}

export interface OpenRouterRow {
    context?: number
    pricing?: OpenRouterPricing
}

/** Lookup structure derived from the data. Built once per snapshot, never inside a getter. */
export interface OpenRouterIndex {
    /** Every listed row by raw id. */
    rows: Map<string, OpenRouterRow>
    /** Variant-free rows of the first-party vendors, by `<vendor>/<canonical slug>`; the values are raw ids. */
    canonical: Map<string, string[]>
}

export interface ModelDataLookupModel {
    id: string
    internalID?: string
    provider: LLMProvider
}

const PRICE_FIELDS = [
    ['prompt', 'input'],
    ['completion', 'output'],
    ['input_cache_read', 'cacheRead'],
    ['input_cache_write', 'cacheWrite'],
    ['internal_reasoning', 'reasoning'],
] as const

type PriceKey = (typeof PRICE_FIELDS)[number][1]

const PRICE_KEYS: readonly PriceKey[] = PRICE_FIELDS.map(([, key]) => key)

const SOURCE_FIELD = Object.fromEntries(PRICE_FIELDS.map(([source, key]) => [key, source])) as Record<PriceKey, string>

/** First-party providers a catalog model may be matched to, and the OpenRouter vendor that serves them. */
const VENDOR_BY_PROVIDER = new Map<LLMProvider, string>([
    [LLMProvider.OpenAI, 'openai'],
    [LLMProvider.GoogleCloud, 'google'],
    [LLMProvider.VertexAI, 'google'],
    [LLMProvider.Anthropic, 'anthropic'],
])

const INDEXED_VENDORS = new Set(VENDOR_BY_PROVIDER.values())

/** Ids come from a remote listing: a null-prototype object keeps an id like `__proto__` an ordinary key. */
function dictionary<T>(): Record<string, T> {
    return Object.create(null) as Record<string, T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A price is a trimmed non-empty string that reads as a finite number of at least zero. */
function cleanPrice(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    if (trimmed === '') {
        return null
    }
    const number = Number(trimmed)
    return Number.isFinite(number) && number >= 0 ? trimmed : null
}

function isNegativeNumber(value: unknown): boolean {
    return typeof value === 'string' && value.trim() !== '' && Number(value) < 0
}

function positiveInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** A pricing row needs at least an input or an output price; other prices are optional. */
function pricingRowFrom(read: (key: PriceKey) => unknown): OpenRouterPricing | null {
    const row: OpenRouterPricing = {}
    for (const key of PRICE_KEYS) {
        const price = cleanPrice(read(key))
        if (price !== null) {
            row[key] = price
        }
    }
    return row.input === undefined && row.output === undefined ? null : row
}

/**
 * Keeps the context window (top-level `context_length`, the largest window any
 * provider of the model offers) and the prices of each listed model. Returns
 * null when the body is not a listing or no row holds usable data, so an empty
 * or malformed response never replaces good data. A row whose prompt or
 * completion price is negative (the routers' "variable price") loses its
 * pricing and keeps its limit. `fetchedAt` is the time the caller saves; the
 * default of 0 reads as stale.
 */
export function parseOpenRouterModels(json: unknown, fetchedAt = 0): OpenRouterData | null {
    if (!isRecord(json) || !Array.isArray(json.data)) {
        return null
    }
    const limits = dictionary<OpenRouterLimits>()
    const pricing = dictionary<OpenRouterPricing>()
    let usable = 0
    for (const entry of json.data as unknown[]) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') {
            continue
        }
        let kept = false
        const context = positiveInteger(entry.context_length)
        if (context !== null) {
            limits[entry.id] = { context }
            kept = true
        }
        const prices = entry.pricing
        if (isRecord(prices) && !isNegativeNumber(prices.prompt) && !isNegativeNumber(prices.completion)) {
            const row = pricingRowFrom(key => prices[SOURCE_FIELD[key]])
            if (row !== null) {
                pricing[entry.id] = row
                kept = true
            }
        }
        if (kept) {
            usable++
        }
    }
    if (usable === 0) {
        return null
    }
    return { v: 1, priceUnit: 'usd-per-token', fetchedAt, limits, pricing }
}

export function encodeOpenRouterData(data: OpenRouterData): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({
        v: data.v,
        priceUnit: data.priceUnit,
        fetchedAt: data.fetchedAt,
        limits: data.limits,
        pricing: data.pricing,
    }))
}

/**
 * Reads a stored snapshot. Anything that is not a version-1 USD-per-token file
 * of the expected shape is null (the next successful refresh rewrites it). A row
 * that does not validate is skipped and unknown fields in a row are ignored, so
 * a later version can add a field without bumping `v`.
 */
export function decodeOpenRouterData(bytes: Uint8Array): OpenRouterData | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
        return null
    }
    if (!isRecord(parsed) || parsed.v !== 1 || parsed.priceUnit !== 'usd-per-token') {
        return null
    }
    if (typeof parsed.fetchedAt !== 'number' || !Number.isFinite(parsed.fetchedAt)) {
        return null
    }
    if (!isRecord(parsed.limits) || !isRecord(parsed.pricing)) {
        return null
    }
    const limits = dictionary<OpenRouterLimits>()
    for (const [id, row] of Object.entries(parsed.limits)) {
        const context = isRecord(row) ? positiveInteger(row.context) : null
        if (context !== null) {
            limits[id] = { context }
        }
    }
    const pricing = dictionary<OpenRouterPricing>()
    for (const [id, row] of Object.entries(parsed.pricing)) {
        const clean = isRecord(row) ? pricingRowFrom(key => row[key]) : null
        if (clean !== null) {
            pricing[id] = clean
        }
    }
    return { v: 1, priceUnit: 'usd-per-token', fetchedAt: parsed.fetchedAt, limits, pricing }
}

/** Stale when never fetched, dated in the future, or older than the TTL (exactly the TTL is still fresh). */
export function isStale(fetchedAt: number, now: number, ttlMs = OPENROUTER_TTL_MS): boolean {
    if (!Number.isFinite(fetchedAt) || !Number.isFinite(now)) {
        return true
    }
    if (fetchedAt > now) {
        return true
    }
    return now - fetchedAt > ttlMs
}

/**
 * The form two spellings of one model share: lowercase, no trailing `-latest`,
 * no trailing date (`-YYYYMMDD` or `-YYYY-MM-DD`), dots as dashes.
 */
export function canonicalModelId(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/-latest$/, '')
        .replace(/-\d{8}$/, '')
        .replace(/-\d{4}-\d{2}-\d{2}$/, '')
        .replace(/\./g, '-')
}

export function buildIndex(data: OpenRouterData): OpenRouterIndex {
    const rows = new Map<string, OpenRouterRow>()
    for (const [id, limit] of Object.entries(data.limits)) {
        rows.set(id, { context: limit.context })
    }
    for (const [id, price] of Object.entries(data.pricing)) {
        const row = rows.get(id)
        if (row) {
            row.pricing = price
        } else {
            rows.set(id, { pricing: price })
        }
    }
    const canonical = new Map<string, string[]>()
    for (const id of rows.keys()) {
        const slash = id.indexOf('/')
        if (slash <= 0 || id.includes(':') || !INDEXED_VENDORS.has(id.slice(0, slash))) {
            continue
        }
        const key = id.slice(0, slash) + '/' + canonicalModelId(id.slice(slash + 1))
        const bucket = canonical.get(key)
        if (bucket) {
            bucket.push(id)
        } else {
            canonical.set(key, [id])
        }
    }
    return { rows, canonical }
}

/** The name OpenRouter would list for a catalog model: `internalID ?? id`, without `models/` and our generated suffixes. */
function referenceId(model: ModelDataLookupModel): string {
    let ref = model.internalID ?? model.id
    if (ref.startsWith('models/')) {
        ref = ref.slice('models/'.length)
    }
    if (model.internalID === undefined) {
        ref = ref.replace(/-(vertex|response-api)$/, '')
    }
    return ref
}

/** A field is used only when every candidate has it and all agree. */
function agreeingField<T>(candidates: OpenRouterRow[], read: (row: OpenRouterRow) => T | undefined): T | undefined {
    let found: T | undefined
    for (const row of candidates) {
        const value = read(row)
        if (value === undefined || (found !== undefined && value !== found)) {
            return undefined
        }
        found = value
    }
    return found
}

function mergeCandidates(candidates: OpenRouterRow[]): OpenRouterRow {
    if (candidates.length === 1) {
        return candidates[0]
    }
    const merged: OpenRouterRow = {}
    const context = agreeingField(candidates, row => row.context)
    if (context !== undefined) {
        merged.context = context
    }
    const pricing: OpenRouterPricing = {}
    for (const key of PRICE_KEYS) {
        const price = agreeingField(candidates, row => row.pricing?.[key])
        if (price !== undefined) {
            pricing[key] = price
        }
    }
    if (Object.keys(pricing).length > 0) {
        merged.pricing = pricing
    }
    return merged
}

/**
 * The listed row of a catalog model, or an empty row. Never throws.
 *
 * A model routed through the `openrouter` entry uses the exact row of the
 * routed id (OpenRouter is the serving provider; variants allowed). Otherwise
 * only first-party providers match, against variant-free rows of their own
 * vendor: the exact id first, then the one canonical spelling. Several
 * canonical candidates contribute a field only when they all agree on it.
 */
export function resolveRows(index: OpenRouterIndex, model: ModelDataLookupModel, routedId?: string): OpenRouterRow {
    try {
        if (model.id === 'openrouter') {
            return (routedId ? index.rows.get(routedId) : undefined) ?? {}
        }
        const vendor = VENDOR_BY_PROVIDER.get(model.provider)
        if (vendor === undefined) {
            return {}
        }
        const ref = referenceId(model)
        if (ref === '' || ref.includes(':')) {
            return {}
        }
        const exact = index.rows.get(vendor + '/' + ref)
        if (exact) {
            return exact
        }
        const ids = index.canonical.get(vendor + '/' + canonicalModelId(ref))
        if (!ids) {
            return {}
        }
        const candidates: OpenRouterRow[] = []
        for (const id of ids) {
            const row = index.rows.get(id)
            if (row) {
                candidates.push(row)
            }
        }
        return candidates.length === 0 ? {} : mergeCandidates(candidates)
    } catch {
        return {}
    }
}

/**
 * The context window to compare a user setting against. Anthropic-provider
 * entries have none: only the provider's own figure would be authoritative for
 * them. A routed model keeps its exact row's figure whatever the vendor.
 */
export function contextLimitFor(index: OpenRouterIndex, model: ModelDataLookupModel, routedId?: string): number | undefined {
    if (model.id !== 'openrouter' && model.provider === LLMProvider.Anthropic) {
        return undefined
    }
    return resolveRows(index, model, routedId).context
}

export function pricingFor(index: OpenRouterIndex, model: ModelDataLookupModel, routedId?: string): OpenRouterPricing | undefined {
    return resolveRows(index, model, routedId).pricing
}

/** True only when both figures are finite, the limit is positive and the value is strictly above it. */
export function exceedsActualMax(value: number | null | undefined, actual: number | null | undefined): boolean {
    if (typeof value !== 'number' || typeof actual !== 'number') {
        return false
    }
    if (!Number.isFinite(value) || !Number.isFinite(actual) || actual <= 0) {
        return false
    }
    return value > actual
}

/** Fixed locale so the settings text and the tests agree. */
export function formatTokenCount(n: number): string {
    return n.toLocaleString('en-US')
}

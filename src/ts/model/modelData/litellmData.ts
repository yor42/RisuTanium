import { LLMProvider } from '../types'
import { canonicalModelId, type ModelDataLookupModel } from './openrouterData'

/**
 * Pure data layer for the LiteLLM price and context-window dataset: what is
 * kept from the download, how it is stored, and how a catalog model finds its
 * row. Nothing here touches the network, the store or a rune.
 *
 * The download is untrusted: every value is type-checked, ids and numbers are
 * range-checked, dictionaries have no prototype, and size caps are applied
 * before parsing wherever a byte length is available. Rows are keyed by the RAW
 * dataset key; normalisation happens only at lookup, so a change to the matching
 * rule never invalidates stored data.
 */

export const LITELLM_DATA_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
export const LITELLM_DATA_KEY = 'modeldata/litellm.json'
export const LITELLM_MAX_BODY_BYTES = 8 * 1024 * 1024
export const LITELLM_MAX_FILE_BYTES = 1024 * 1024
export const LITELLM_MAX_ROWS = 5000

/** Prices are decimal strings in USD per token. */
export interface LiteLLMPricing {
    input?: string
    output?: string
    cacheRead?: string
    cacheWrite?: string
}

export type LiteLLMEndpoint = 'chat' | 'responses'

export interface LiteLLMRow {
    /** The dataset's `litellm_provider`. */
    p: string
    /** The dataset's `mode`. */
    m: 'chat' | 'responses'
    /** Input context window (`max_input_tokens`). */
    ctx?: number
    /** Output limit (`max_output_tokens`). */
    out?: number
    price?: LiteLLMPricing
    /** `deprecation_date`, `YYYY-MM-DD`. */
    dep?: string
    vis?: boolean
    /** Endpoint kinds from `supported_endpoints`, in the fixed order chat, responses. */
    ep?: LiteLLMEndpoint[]
    /** Output modalities from `supported_output_modalities`. */
    om?: string[]
}

export interface LiteLLMData {
    v: 1
    fetchedAt: number
    rows: Record<string, LiteLLMRow>
}

/** Lookup structure derived from the data. Built once per snapshot, never inside a getter. */
export interface LiteLLMIndex {
    rows: Map<string, LiteLLMRow>
    /** Raw keys by `<provider>|<canonical form of the key without its provider prefix>`. */
    canonical: Map<string, string[]>
}

/** Rows of other providers are never read: only these feed limits, prices or added entries. */
const KEPT_PROVIDERS = new Set([
    'openai',
    'anthropic',
    'gemini',
    'vertex_ai-language-models',
    'mistral',
    'deepseek',
    'cohere_chat',
    'bedrock',
    'bedrock_converse',
])

/** Looser than the added-id rule: a row key is only stored for exact lookups, it can never become an added entry by itself. */
const ROW_KEY_RULE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const DATE_RULE = /^\d{4}-\d{2}-\d{2}$/
const MODALITY_RULE = /^[a-z]{1,20}$/
const MAX_MODALITIES = 10

const PRICE_FIELDS = [
    ['input_cost_per_token', 'input'],
    ['output_cost_per_token', 'output'],
    ['cache_read_input_token_cost', 'cacheRead'],
    ['cache_creation_input_token_cost', 'cacheWrite'],
] as const

type PriceKey = (typeof PRICE_FIELDS)[number][1]

const PRICE_KEYS: readonly PriceKey[] = PRICE_FIELDS.map(([, key]) => key)

const SOURCE_FIELD = Object.fromEntries(PRICE_FIELDS.map(([source, key]) => [key, source])) as Record<PriceKey, string>

const ENDPOINT_BY_PATH = new Map<string, LiteLLMEndpoint>([
    ['/v1/chat/completions', 'chat'],
    ['/v1/responses', 'responses'],
])

const ENDPOINT_ORDER: readonly LiteLLMEndpoint[] = ['chat', 'responses']

/** Keys come from a remote file: a null-prototype object keeps a key like `constructor` an ordinary key. */
function dictionary<T>(): Record<string, T> {
    return Object.create(null) as Record<string, T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isRowKey(key: unknown): key is string {
    return typeof key === 'string' && ROW_KEY_RULE.test(key)
}

function positiveInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** The dataset writes prices as JSON numbers per token; they are kept as decimal strings. */
function priceFromNumber(value: unknown): string | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : null
}

/** A stored price is a trimmed non-empty string that reads as a finite number of at least zero. */
function priceFromString(value: unknown): string | null {
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

function pricingFrom(read: (key: PriceKey) => string | null): LiteLLMPricing | undefined {
    const price: LiteLLMPricing = {}
    let any = false
    for (const key of PRICE_KEYS) {
        const value = read(key)
        if (value !== null) {
            price[key] = value
            any = true
        }
    }
    return any ? price : undefined
}

function modalitiesFrom(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined
    }
    return (value as unknown[])
        .filter((word): word is string => typeof word === 'string' && MODALITY_RULE.test(word))
        .slice(0, MAX_MODALITIES)
}

function endpointsFromKinds(kinds: Set<LiteLLMEndpoint>): LiteLLMEndpoint[] | undefined {
    const ordered = ENDPOINT_ORDER.filter(kind => kinds.has(kind))
    return ordered.length > 0 ? ordered : undefined
}

function endpointsFromPaths(value: unknown): LiteLLMEndpoint[] | undefined {
    if (!Array.isArray(value)) {
        return undefined
    }
    const kinds = new Set<LiteLLMEndpoint>()
    for (const path of value as unknown[]) {
        const kind = typeof path === 'string' ? ENDPOINT_BY_PATH.get(path) : undefined
        if (kind !== undefined) {
            kinds.add(kind)
        }
    }
    return endpointsFromKinds(kinds)
}

function endpointsFromStored(value: unknown): LiteLLMEndpoint[] | undefined {
    if (!Array.isArray(value)) {
        return undefined
    }
    const kinds = new Set<LiteLLMEndpoint>()
    for (const kind of value as unknown[]) {
        if (kind === 'chat' || kind === 'responses') {
            kinds.add(kind)
        }
    }
    return endpointsFromKinds(kinds)
}

interface RowFields {
    provider: unknown
    mode: unknown
    ctx: unknown
    out: unknown
    price: LiteLLMPricing | undefined
    dep: unknown
    vis: unknown
    ep: LiteLLMEndpoint[] | undefined
    om: string[] | undefined
}

/** Shared by the download parser and the stored-file reader so both apply one rule set. */
function buildRow(fields: RowFields): LiteLLMRow | null {
    if (typeof fields.provider !== 'string' || !KEPT_PROVIDERS.has(fields.provider)) {
        return null
    }
    if (fields.mode !== 'chat' && fields.mode !== 'responses') {
        return null
    }
    const row: LiteLLMRow = { p: fields.provider, m: fields.mode }
    const ctx = positiveInteger(fields.ctx)
    if (ctx !== null) {
        row.ctx = ctx
    }
    const out = positiveInteger(fields.out)
    if (out !== null) {
        row.out = out
    }
    if (fields.price !== undefined) {
        row.price = fields.price
    }
    if (typeof fields.dep === 'string' && DATE_RULE.test(fields.dep)) {
        row.dep = fields.dep
    }
    if (typeof fields.vis === 'boolean') {
        row.vis = fields.vis
    }
    if (fields.ep !== undefined) {
        row.ep = fields.ep
    }
    if (fields.om !== undefined) {
        row.om = fields.om
    }
    return row.ctx === undefined && row.price === undefined ? null : row
}

function rowFromDownload(entry: Record<string, unknown>): LiteLLMRow | null {
    return buildRow({
        provider: entry.litellm_provider,
        mode: entry.mode,
        ctx: entry.max_input_tokens,
        out: entry.max_output_tokens,
        price: pricingFrom(key => priceFromNumber(entry[SOURCE_FIELD[key]])),
        dep: entry.deprecation_date,
        vis: entry.supports_vision,
        ep: endpointsFromPaths(entry.supported_endpoints),
        om: modalitiesFrom(entry.supported_output_modalities),
    })
}

function rowFromStored(entry: Record<string, unknown>): LiteLLMRow | null {
    const stored = entry.price
    return buildRow({
        provider: entry.p,
        mode: entry.m,
        ctx: entry.ctx,
        out: entry.out,
        price: isRecord(stored) ? pricingFrom(key => priceFromString(stored[key])) : undefined,
        dep: entry.dep,
        vis: entry.vis,
        ep: endpointsFromStored(entry.ep),
        om: modalitiesFrom(entry.om),
    })
}

function serialise(data: LiteLLMData): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ v: data.v, fetchedAt: data.fetchedAt, rows: data.rows }))
}

/**
 * Keeps the chat and responses rows of the allowed providers with their limits,
 * prices and the few flags the picker uses. Returns null when the body is not a
 * dataset, no row holds usable data, there are more rows than the cap, or the
 * result would not fit the stored-file cap, so a bad download never replaces
 * good data. `fetchedAt` is the time the caller saves; the default of 0 reads
 * as stale.
 */
export function parseLiteLLMDataset(json: unknown, fetchedAt = 0): LiteLLMData | null {
    if (!isRecord(json)) {
        return null
    }
    const rows = dictionary<LiteLLMRow>()
    let count = 0
    for (const [key, entry] of Object.entries(json)) {
        if (!isRowKey(key) || !isRecord(entry)) {
            continue
        }
        const row = rowFromDownload(entry)
        if (row === null) {
            continue
        }
        count++
        if (count > LITELLM_MAX_ROWS) {
            return null
        }
        rows[key] = row
    }
    if (count === 0) {
        return null
    }
    const data: LiteLLMData = { v: 1, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0, rows }
    return serialise(data).length > LITELLM_MAX_FILE_BYTES ? null : data
}

function utf8Length(text: string): number {
    return new TextEncoder().encode(text).length
}

/**
 * The download body as text. A body above 8 MB (counted in bytes) is rejected
 * before JSON.parse, so a hostile or runaway response cannot cost a parse. The
 * cap bounds parsing and memory use, not the download itself.
 */
export function parseLiteLLMText(text: string, fetchedAt = 0): LiteLLMData | null {
    if (text.length > LITELLM_MAX_BODY_BYTES) {
        return null
    }
    if (text.length * 3 > LITELLM_MAX_BODY_BYTES && utf8Length(text) > LITELLM_MAX_BODY_BYTES) {
        return null
    }
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        return null
    }
    return parseLiteLLMDataset(json, fetchedAt)
}

/** Null when the encoded file would exceed the cap: the caller skips the write. */
export function encodeLiteLLMData(data: LiteLLMData): Uint8Array | null {
    const bytes = serialise(data)
    return bytes.length > LITELLM_MAX_FILE_BYTES ? null : bytes
}

/**
 * Reads a stored snapshot. The byte length is checked before JSON.parse.
 * Anything that is not a version-1 file of the expected shape is null (the next
 * successful refresh rewrites it). A row that does not validate is skipped and
 * unknown fields are ignored, so a later version can add a field without
 * bumping `v`.
 */
export function decodeLiteLLMData(bytes: Uint8Array): LiteLLMData | null {
    if (bytes.length > LITELLM_MAX_FILE_BYTES) {
        return null
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
        return null
    }
    if (!isRecord(parsed) || parsed.v !== 1) {
        return null
    }
    if (typeof parsed.fetchedAt !== 'number' || !Number.isFinite(parsed.fetchedAt)) {
        return null
    }
    if (!isRecord(parsed.rows)) {
        return null
    }
    const entries = Object.entries(parsed.rows)
    if (entries.length > LITELLM_MAX_ROWS) {
        return null
    }
    const rows = dictionary<LiteLLMRow>()
    for (const [key, entry] of entries) {
        if (!isRowKey(key) || !isRecord(entry)) {
            continue
        }
        const row = rowFromStored(entry)
        if (row !== null) {
            rows[key] = row
        }
    }
    return { v: 1, fetchedAt: parsed.fetchedAt, rows }
}

/** A field is used only when every candidate has it and all agree. */
function agreeingField<T>(candidates: readonly LiteLLMRow[], read: (row: LiteLLMRow) => T | undefined, same: (a: T, b: T) => boolean = (a, b) => a === b): T | undefined {
    let found: T | undefined
    for (const row of candidates) {
        const value = read(row)
        if (value === undefined || (found !== undefined && !same(value, found))) {
            return undefined
        }
        found = value
    }
    return found
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((item, i) => item === b[i])
}

/**
 * One row standing for several that name the same model. Every field is kept
 * only when all rows have it and agree; disagreement leaves it unknown, never
 * picks one. `rows` is never empty.
 */
export function mergeLiteLLMRows(rows: readonly LiteLLMRow[]): LiteLLMRow {
    if (rows.length === 1) {
        return rows[0]
    }
    const merged: LiteLLMRow = { p: rows[0].p, m: agreeingField(rows, row => row.m) ?? 'chat' }
    const ctx = agreeingField(rows, row => row.ctx)
    if (ctx !== undefined) {
        merged.ctx = ctx
    }
    const out = agreeingField(rows, row => row.out)
    if (out !== undefined) {
        merged.out = out
    }
    const price: LiteLLMPricing = {}
    for (const key of PRICE_KEYS) {
        const value = agreeingField(rows, row => row.price?.[key])
        if (value !== undefined) {
            price[key] = value
        }
    }
    if (Object.keys(price).length > 0) {
        merged.price = price
    }
    const dep = agreeingField(rows, row => row.dep)
    if (dep !== undefined) {
        merged.dep = dep
    }
    const vis = agreeingField(rows, row => row.vis)
    if (vis !== undefined) {
        merged.vis = vis
    }
    const ep = agreeingField<LiteLLMEndpoint[]>(rows, row => row.ep, sameList)
    if (ep !== undefined) {
        merged.ep = ep
    }
    const om = agreeingField<string[]>(rows, row => row.om, sameList)
    if (om !== undefined) {
        merged.om = om
    }
    return merged
}

/** The prefix a provider's rows carry in their key, removed before canonical matching. */
const KEY_PREFIX_BY_PROVIDER: Record<string, string> = {
    'gemini': 'gemini/',
    'vertex_ai-language-models': 'vertex_ai/',
    'mistral': 'mistral/',
    'deepseek': 'deepseek/',
    'bedrock': 'bedrock/',
}

function withoutProviderPrefix(provider: string, key: string): string {
    const prefix = KEY_PREFIX_BY_PROVIDER[provider]
    return prefix !== undefined && key.startsWith(prefix) ? key.slice(prefix.length) : key
}

export function buildLiteLLMIndex(data: LiteLLMData): LiteLLMIndex {
    const rows = new Map<string, LiteLLMRow>()
    const canonical = new Map<string, string[]>()
    for (const [key, row] of Object.entries(data.rows)) {
        rows.set(key, row)
        const bucketKey = row.p + '|' + canonicalModelId(withoutProviderPrefix(row.p, key))
        const bucket = canonical.get(bucketKey)
        if (bucket) {
            bucket.push(key)
        } else {
            canonical.set(bucketKey, [key])
        }
    }
    return { rows, canonical }
}

interface FamilyLookup {
    /** `litellm_provider` values whose rows may answer for the provider. */
    providers: readonly string[]
    /** Key prefixes tried in order for the exact lookup. */
    prefixes: readonly string[]
}

const LOOKUP_BY_PROVIDER = new Map<LLMProvider, FamilyLookup>([
    [LLMProvider.OpenAI, { providers: ['openai'], prefixes: [''] }],
    [LLMProvider.Anthropic, { providers: ['anthropic'], prefixes: [''] }],
    [LLMProvider.GoogleCloud, { providers: ['gemini'], prefixes: ['gemini/', ''] }],
    [LLMProvider.VertexAI, { providers: ['vertex_ai-language-models'], prefixes: ['', 'vertex_ai/'] }],
    [LLMProvider.Mistral, { providers: ['mistral'], prefixes: ['mistral/', ''] }],
    [LLMProvider.DeepSeek, { providers: ['deepseek'], prefixes: ['deepseek/', ''] }],
    [LLMProvider.Cohere, { providers: ['cohere_chat'], prefixes: [''] }],
    [LLMProvider.AWS, { providers: ['bedrock', 'bedrock_converse'], prefixes: ['', 'bedrock/'] }],
])

/** The name the dataset would list for a catalog model: `internalID ?? id`, without `models/` and our generated suffixes. */
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

/**
 * The row of a catalog model, or undefined. Never throws. Only rows of the
 * model's own provider family answer: the exact key first (with the provider
 * prefixes the dataset uses), then the one canonical spelling; several
 * canonical candidates contribute a field only when they all agree on it.
 */
export function resolveLiteLLMRow(index: LiteLLMIndex, model: ModelDataLookupModel): LiteLLMRow | undefined {
    try {
        const lookup = LOOKUP_BY_PROVIDER.get(model.provider)
        if (lookup === undefined) {
            return undefined
        }
        const ref = referenceId(model)
        if (ref === '') {
            return undefined
        }
        for (const prefix of lookup.prefixes) {
            const row = index.rows.get(prefix + ref)
            if (row !== undefined && lookup.providers.includes(row.p)) {
                return row
            }
        }
        const canonical = canonicalModelId(ref)
        const candidates: LiteLLMRow[] = []
        for (const provider of lookup.providers) {
            for (const key of index.canonical.get(provider + '|' + canonical) ?? []) {
                const row = index.rows.get(key)
                if (row !== undefined) {
                    candidates.push(row)
                }
            }
        }
        return candidates.length === 0 ? undefined : mergeLiteLLMRows(candidates)
    } catch {
        return undefined
    }
}

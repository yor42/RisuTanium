import {
    ClaudeParameters,
    GPT5XHighParameters,
    LLMFlags,
    LLMFormat,
    LLMProvider,
    LLMTokenizer,
    type LLMModel,
} from '../types'
import { mergeLiteLLMRows, type LiteLLMData, type LiteLLMRow } from './litellmData'
import { canonicalModelId } from './openrouterData'
import type { ProviderListItem } from './providerListData'

/**
 * Pure layer for models the app adds beyond the built-in catalog, from the
 * provider's own model list and from the LiteLLM dataset.
 *
 * Two predicates are kept apart on purpose:
 *  - R (resolve): can a saved id still be built into a runnable entry? The
 *    provider-list rule and nothing more: the id rule, the family filter and "not an exact
 *    catalog id or internalID". No canonical step, no deny list, no dataset.
 *  - L (list): is the entry offered in the picker, and may the dataset alone
 *    create it? R plus canonical coverage by a built-in of the same provider,
 *    the deny list, and for dataset-only creation the dataset eligibility
 *    rules.
 * A saved id therefore keeps resolving under the provider-list rule, while the picker
 * stays free of near-duplicates and non-chat ids.
 *
 * The catalog is an argument, never imported, so this module has no cycle with
 * the catalog's own module. Everything here is untrusted-input safe: ids pass
 * the strict id rule, names are cleaned and capped, and nothing is rendered or
 * interpreted here.
 */

export type AddedFamily = 'openai' | 'anthropic' | 'google'

export const ADDED_FAMILIES: readonly AddedFamily[] = ['openai', 'anthropic', 'google']
export const RESPONSE_API_SUFFIX = '-response-api'

const DYNAMIC_PREFIX: Readonly<Record<'google' | 'anthropic', string>> = {
    google: 'dynamic_google_',
    anthropic: 'dynamic_anthropic_',
}

/** The part of a catalog entry the predicates read. */
export interface CatalogModel {
    id: string
    internalID?: string
    provider: LLMProvider
}

export interface CatalogIndex {
    /** Every id and internalID of the whole catalog (retired entries included), with and without a `models/` prefix. */
    exact: ReadonlySet<string>
    /** Canonical forms of the built-ins of each family's provider. */
    canonical: Readonly<Record<AddedFamily, ReadonlySet<string>>>
}

export type AddedIdClass = 'rejected' | 'listable' | 'duplicate' | 'nonchat'

/** Which entries an OpenAI model gets: the plain one, its Response API twin, or both. */
export interface AddedTwins {
    bare: boolean
    responseApi: boolean
}

export interface AddedSpec {
    family: AddedFamily
    rawId: string
    displayName: string
    inList: boolean
    inDataset: boolean
    /** The exact dataset row, else the agreed row of its canonical group. */
    row?: LiteLLMRow
    /** The exact row's `deprecation_date`; a canonical match never supplies one. */
    datasetDeprecated?: string
    /** Admitted by R but not offered: a near-duplicate of a built-in, or a non-chat id. Still resolvable. */
    hidden?: 'duplicate' | 'nonchat'
    /** A listing rule only. Resolution of a listed id ignores it. */
    twins: AddedTwins
}

export interface AddedState {
    /** Null when there was no catalog: nothing is created or admitted. */
    catalog: CatalogIndex | null
    /** Listed ids that pass R, per family. */
    lists: Readonly<Record<AddedFamily, ReadonlySet<string>>>
    specs: readonly AddedSpec[]
    /** Specs by `addedSpecKey`. */
    index: ReadonlyMap<string, AddedSpec>
}

export type AddedLists = Partial<Record<AddedFamily, readonly ProviderListItem[] | null>>

/** The id rule: a plain model id, so no reserved prefix, path segment, dot-segment or markup can pass. */
const ID_RULE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const NAME_MAX_CHARS = 100
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

export function isValidAddedId(id: unknown): id is string {
    return typeof id === 'string' && ID_RULE.test(id) && !id.includes('..')
}

/** A display name is shown as text only. Control characters are removed and the length is capped. */
export function cleanDisplayName(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined
    }
    const cleaned = value.replace(CONTROL_CHARS, '').trim()
    if (cleaned === '') {
        return undefined
    }
    return Array.from(cleaned).slice(0, NAME_MAX_CHARS).join('').trim()
}

/** The provider-list family filter: OpenAI's list is read for `gpt-` ids only. */
export function passesFamilyFilter(family: AddedFamily, id: string): boolean {
    return family !== 'openai' || id.startsWith('gpt-')
}

function withoutModelsPrefix(id: string): string {
    return id.startsWith('models/') ? id.slice('models/'.length) : id
}

const FAMILY_BY_PROVIDER = new Map<LLMProvider, AddedFamily>([
    [LLMProvider.OpenAI, 'openai'],
    [LLMProvider.Anthropic, 'anthropic'],
    [LLMProvider.GoogleCloud, 'google'],
])

/** Null with no catalog: callers then fail closed rather than treat every id as new. */
export function buildCatalogIndex(catalog: readonly CatalogModel[] | null): CatalogIndex | null {
    if (!catalog || catalog.length === 0) {
        return null
    }
    const exact = new Set<string>()
    const canonical: Record<AddedFamily, Set<string>> = { openai: new Set(), anthropic: new Set(), google: new Set() }
    for (const model of catalog) {
        const family = FAMILY_BY_PROVIDER.get(model.provider)
        for (const name of [model.id, model.internalID]) {
            if (typeof name !== 'string') {
                continue
            }
            const stripped = withoutModelsPrefix(name)
            exact.add(name)
            exact.add(stripped)
            if (family !== undefined) {
                canonical[family].add(canonicalModelId(stripped))
            }
        }
    }
    return { exact, canonical }
}

/** Models that are not for chat, or are access-restricted. Whole hyphen/dot-separated words, so `delivery` is not `live`. */
const DENY_WORDS = [
    'embedding',
    'tts',
    'transcribe',
    'realtime',
    'audio',
    'live',
    'image',
    'lyria',
    'robotics',
    'computer-use',
    'deep-research',
    'search-preview',
    'moderation',
    'instruct',
    'search-api',
    'rosalind',
    'cyber',
]

const DENY_RULE = new RegExp('(^|[-._])(' + DENY_WORDS.join('|') + ')($|[-._])', 'i')

export function isDenied(id: string): boolean {
    return DENY_RULE.test(id)
}

function baseOfTwin(id: string): string {
    return id.endsWith(RESPONSE_API_SUFFIX) ? id.slice(0, -RESPONSE_API_SUFFIX.length) : id
}

/**
 * Predicate R. The exact-catalog test covers the id and, for OpenAI, the base id
 * of a `-response-api` twin, so a twin of a built-in is never admitted.
 */
export function predicateR(family: AddedFamily, id: string, catalog: CatalogIndex): boolean {
    if (!isValidAddedId(id) || !passesFamilyFilter(family, id)) {
        return false
    }
    if (catalog.exact.has(id)) {
        return false
    }
    if (family === 'openai' && catalog.exact.has(baseOfTwin(id))) {
        return false
    }
    return true
}

/** Predicate L on an id R admits: non-chat first, then near-duplicates of a built-in of the same provider. */
export function classifyAddedId(family: AddedFamily, id: string, catalog: CatalogIndex): AddedIdClass {
    if (!predicateR(family, id, catalog)) {
        return 'rejected'
    }
    if (isDenied(id)) {
        return 'nonchat'
    }
    if (catalog.canonical[family].has(canonicalModelId(id))) {
        return 'duplicate'
    }
    return 'listable'
}

/** The dataset rules for creating an entry from a row alone (the catalog rules come from `classifyAddedId`). */
export function isDatasetEligible(family: AddedFamily, id: string, row: LiteLLMRow): boolean {
    if (row.m !== 'chat' && row.m !== 'responses') {
        return false
    }
    if (row.om !== undefined && !row.om.includes('text')) {
        return false
    }
    return isValidAddedId(id) && passesFamilyFilter(family, id)
}

const BARE_ONLY: AddedTwins = { bare: true, responseApi: false }

/**
 * Which OpenAI entries a model is listed with. Endpoints win when the row names
 * chat or responses; otherwise a responses-mode row gets the twin only. No row
 * gets both entries, as the provider-list rule does. A listing rule: resolution of a listed id
 * never reads it.
 */
export function openAITwins(row?: LiteLLMRow): AddedTwins {
    if (row === undefined) {
        return { bare: true, responseApi: true }
    }
    const endpoints = row.ep
    if (endpoints !== undefined && (endpoints.includes('chat') || endpoints.includes('responses'))) {
        return { bare: endpoints.includes('chat'), responseApi: endpoints.includes('responses') }
    }
    return row.m === 'responses' ? { bare: false, responseApi: true } : { bare: true, responseApi: true }
}

export function addedSpecKey(family: AddedFamily, rawId: string): string {
    return family + ':' + rawId
}

export function emptyAddedState(): AddedState {
    return {
        catalog: null,
        lists: { openai: new Set(), anthropic: new Set(), google: new Set() },
        specs: [],
        index: new Map(),
    }
}

const DATASET_PROVIDER: Readonly<Record<AddedFamily, string>> = {
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'gemini',
}

interface FamilyDataset {
    /** Rows by normalised id (`gemini/` stripped for Google). */
    byId: Map<string, LiteLLMRow[]>
    /** Normalised ids by canonical form. */
    byCanonical: Map<string, string[]>
}

function familyDataset(family: AddedFamily, dataset: LiteLLMData | null): FamilyDataset {
    const byId = new Map<string, LiteLLMRow[]>()
    const byCanonical = new Map<string, string[]>()
    if (dataset === null) {
        return { byId, byCanonical }
    }
    const provider = DATASET_PROVIDER[family]
    for (const [key, row] of Object.entries(dataset.rows)) {
        if (row.p !== provider) {
            continue
        }
        const id = family === 'google' && key.startsWith('gemini/') ? key.slice('gemini/'.length) : key
        const rows = byId.get(id)
        if (rows) {
            rows.push(row)
            continue
        }
        byId.set(id, [row])
        const canonical = canonicalModelId(id)
        const ids = byCanonical.get(canonical)
        if (ids) {
            ids.push(id)
        } else {
            byCanonical.set(canonical, [id])
        }
    }
    return { byId, byCanonical }
}

/**
 * Reconciles the catalog, the dataset and the provider lists into the added
 * entries. Pure: the caller replaces its state with the result.
 *
 * With no catalog nothing is created and no list id is admitted (fail closed).
 * A listed id that passes R stays in `lists` and so stays resolvable; if it
 * fails L it carries `hidden` and is not offered. A dataset key that is
 * canonical-equal to any listed id is covered by it rather than added again.
 */
export function reconcileAdded(catalog: readonly CatalogModel[] | null, dataset: LiteLLMData | null, lists: AddedLists): AddedState {
    const index = buildCatalogIndex(catalog)
    if (index === null) {
        return emptyAddedState()
    }
    const admitted: Record<AddedFamily, Set<string>> = { openai: new Set(), anthropic: new Set(), google: new Set() }
    const specs: AddedSpec[] = []
    for (const family of ADDED_FAMILIES) {
        const data = familyDataset(family, dataset)
        const covered = new Set<string>()
        for (const item of lists[family] ?? []) {
            const id = item.id
            if (admitted[family].has(id) || !predicateR(family, id, index)) {
                continue
            }
            admitted[family].add(id)
            const canonical = canonicalModelId(id)
            covered.add(canonical)
            const exactRows = data.byId.get(id)
            const groupRows = exactRows === undefined ? rowsOfGroup(data, canonical) : []
            const rows = exactRows ?? groupRows
            const row = rows.length > 0 ? mergeLiteLLMRows(rows) : undefined
            const kind = classifyAddedId(family, id, index)
            specs.push({
                family,
                rawId: id,
                displayName: cleanDisplayName(item.name) ?? id,
                inList: true,
                inDataset: row !== undefined,
                row,
                datasetDeprecated: exactRows === undefined ? undefined : row?.dep,
                hidden: kind === 'nonchat' || kind === 'duplicate' ? kind : undefined,
                twins: family === 'openai' ? openAITwins(row) : BARE_ONLY,
            })
        }
        for (const [id, rows] of data.byId) {
            if (admitted[family].has(id) || covered.has(canonicalModelId(id))) {
                continue
            }
            const row = mergeLiteLLMRows(rows)
            if (!isDatasetEligible(family, id, row) || classifyAddedId(family, id, index) !== 'listable') {
                continue
            }
            specs.push({
                family,
                rawId: id,
                displayName: id,
                inList: false,
                inDataset: true,
                row,
                datasetDeprecated: row.dep,
                twins: family === 'openai' ? openAITwins(row) : BARE_ONLY,
            })
        }
    }
    const bySpecKey = new Map<string, AddedSpec>()
    for (const spec of specs) {
        bySpecKey.set(addedSpecKey(spec.family, spec.rawId), spec)
    }
    return { catalog: index, lists: admitted, specs, index: bySpecKey }
}

function rowsOfGroup(data: FamilyDataset, canonical: string): LiteLLMRow[] {
    const rows: LiteLLMRow[] = []
    for (const id of data.byCanonical.get(canonical) ?? []) {
        rows.push(...(data.byId.get(id) ?? []))
    }
    return rows
}

/**
 * Builds the entry for an added model with fixed per-provider literals. The id
 * is validated by the caller; `internalID` is the bare id and nothing else
 * (Google's is never `models/`-prefixed). No `recommended` flag: the picker
 * sets it at read time from the entry's source. The twin applies to OpenAI
 * only.
 */
export function buildAddedModel(family: AddedFamily, id: string, displayName?: string, variant: 'bare' | 'response-api' = 'bare'): LLMModel {
    const name = cleanDisplayName(displayName) ?? id
    if (family === 'google') {
        return {
            id: DYNAMIC_PREFIX.google + id,
            name,
            shortName: name,
            fullName: name,
            internalID: id,
            provider: LLMProvider.GoogleCloud,
            format: LLMFormat.GoogleCloud,
            flags: [LLMFlags.hasImageInput, LLMFlags.poolSupported, LLMFlags.hasAudioInput, LLMFlags.hasVideoInput, LLMFlags.hasStreaming, LLMFlags.requiresAlternateRole, LLMFlags.geminiThinking],
            parameters: ['thinking_tokens', 'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'],
            tokenizer: LLMTokenizer.GoogleCloud,
        }
    }
    if (family === 'anthropic') {
        return {
            id: DYNAMIC_PREFIX.anthropic + id,
            name,
            shortName: name,
            fullName: name,
            internalID: id,
            provider: LLMProvider.Anthropic,
            format: LLMFormat.Anthropic,
            flags: [LLMFlags.hasImageInput, LLMFlags.hasFirstSystemPrompt, LLMFlags.hasStreaming, LLMFlags.claudeThinking, LLMFlags.claudeAdaptiveThinking],
            parameters: [...ClaudeParameters, 'thinking_tokens'],
            tokenizer: LLMTokenizer.Claude,
        }
    }
    const flags = [LLMFlags.hasStreaming, LLMFlags.OAICompletionTokens, LLMFlags.hasFullSystemPrompt, LLMFlags.hasImageInput, LLMFlags.DeveloperRole]
    if (variant === 'response-api') {
        return {
            id: id + RESPONSE_API_SUFFIX,
            internalID: id,
            name: `${name} (Response API)`,
            shortName: name,
            fullName: `${name} (Response API)`,
            provider: LLMProvider.OpenAI,
            format: LLMFormat.OpenAIResponseAPI,
            flags: [...flags, LLMFlags.hasPrefill],
            parameters: [...GPT5XHighParameters],
            tokenizer: LLMTokenizer.tiktokenO200Base,
        }
    }
    return {
        id,
        internalID: id,
        name,
        shortName: name,
        fullName: name,
        provider: LLMProvider.OpenAI,
        format: LLMFormat.OpenAICompatible,
        flags,
        parameters: [...GPT5XHighParameters],
        tokenizer: LLMTokenizer.tiktokenO200Base,
    }
}

/**
 * Builds the entry a saved id names, or null when the id is not an added model
 * (the caller then falls back to the as-is entry). Predicate R decides; the
 * option, a key and the network are never consulted.
 *
 *  - `dynamic_google_<id>` / `dynamic_anthropic_<id>`: from the id alone, no list
 *    or dataset needed. Bare `claude-*` / `gemini-*` ids are never resolved.
 *  - a bare OpenAI id or its `-response-api` twin: when the id is on the live or
 *    saved list (both entries, whatever the dataset says), or when the dataset
 *    alone would create it (the twin policy applies, the picker's date rule
 *    does not).
 *
 * The caller clones the result and applies any user flag override.
 */
export function resolveAddedModel(id: string, state: AddedState): LLMModel | null {
    const catalog = state.catalog
    if (catalog === null || typeof id !== 'string') {
        return null
    }
    for (const family of ['google', 'anthropic'] as const) {
        const prefix = DYNAMIC_PREFIX[family]
        if (id.startsWith(prefix)) {
            const suffix = id.slice(prefix.length)
            if (!predicateR(family, suffix, catalog)) {
                return null
            }
            return buildAddedModel(family, suffix, state.index.get(addedSpecKey(family, suffix))?.displayName)
        }
    }
    if (!predicateR('openai', id, catalog)) {
        return null
    }
    const listed = state.lists.openai
    if (listed.has(id)) {
        return buildAddedModel('openai', id, state.index.get(addedSpecKey('openai', id))?.displayName)
    }
    const base = baseOfTwin(id)
    if (base !== id && listed.has(base)) {
        return buildAddedModel('openai', base, state.index.get(addedSpecKey('openai', base))?.displayName, 'response-api')
    }
    const bareSpec = state.index.get(addedSpecKey('openai', id))
    if (bareSpec !== undefined && bareSpec.hidden === undefined && bareSpec.inDataset && bareSpec.twins.bare) {
        return buildAddedModel('openai', id, bareSpec.displayName)
    }
    const twinSpec = base !== id ? state.index.get(addedSpecKey('openai', base)) : undefined
    if (twinSpec !== undefined && twinSpec.hidden === undefined && twinSpec.inDataset && twinSpec.twins.responseApi) {
        return buildAddedModel('openai', base, twinSpec.displayName, 'response-api')
    }
    return null
}

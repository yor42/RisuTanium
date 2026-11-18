/**
 * The embedding model keys a database can hold in `hypaModel`, split by who can read them.
 *
 * - `UPSTREAM_HYPA_MODELS` are the keys upstream's own `HypaModel` union lists. A `.bin` database entry carries them.
 * - `FORK_ONLY_HYPA_MODELS` are keys the fork adds that upstream cannot read. A `.bin` database entry never carries
 *   one: the export copy leaves the setting out, and upstream then picks its own default.
 *
 * Invariants:
 * - A key the fork adds that upstream cannot read goes in the fork-only list, so the compiler forces the
 *   classification: `HypaModel` is exactly the union of the two lists.
 * - A fork-only key is never removed from the list, even when it is retired, because a stored value may still hold it.
 * - Only a reviewed change moves a key to the upstream list, and only after upstream ships the same key for the same
 *   model.
 * - Adding a fork-only key, or changing `DEFAULT_HYPA_MODEL`, needs a review of the `.bin` restore result: a stripped
 *   value comes back as the default when the file is restored into the fork.
 *
 * A leaf module: it has no runtime imports, so the database module can use the default without loading the embedding
 * processors.
 */

export const UPSTREAM_HYPA_MODELS = [
    'custom', 'ada', 'openai3small', 'openai3large', 'MiniLM', 'MiniLMGPU', 'nomic', 'nomicGPU', 'bgeSmallEn',
    'bgeSmallEnGPU', 'bgem3', 'bgem3GPU', 'multiMiniLM', 'multiMiniLMGPU', 'bgeM3Ko', 'bgeM3KoGPU', 'voyageContext3',
] as const

export const FORK_ONLY_HYPA_MODELS = ['multiE5Small'] as const

export type UpstreamHypaModel = (typeof UPSTREAM_HYPA_MODELS)[number]
export type ForkOnlyHypaModel = (typeof FORK_ONLY_HYPA_MODELS)[number]
export type HypaModel = UpstreamHypaModel | ForkOnlyHypaModel

export const DEFAULT_HYPA_MODEL: HypaModel = 'multiE5Small'

/** True only for a string that is in the fork-only list; anything else, including a key neither list holds, is false. */
export function isForkOnlyHypaModel(value: unknown): value is ForkOnlyHypaModel {
    return typeof value === 'string' && (FORK_ONLY_HYPA_MODELS as readonly string[]).includes(value)
}

export type EmbeddingPooling = 'mean' | 'cls'

/** A `null` pooling marks a remote model: the provider decides the vector, so no pooling or prefix applies. */
export interface EmbeddingRecipe {
    pooling: EmbeddingPooling | null
    queryPrefix: string
    documentPrefix: string
    cacheTag: string
}

const UNCHANGED: EmbeddingRecipe = { pooling: 'mean', queryPrefix: '', documentPrefix: '', cacheTag: '' }
const NOMIC: EmbeddingRecipe = { pooling: 'mean', queryPrefix: 'search_query: ', documentPrefix: 'search_document: ', cacheTag: 'r1' }
const CLS: EmbeddingRecipe = { pooling: 'cls', queryPrefix: '', documentPrefix: '', cacheTag: 'r1' }
const E5: EmbeddingRecipe = { pooling: 'mean', queryPrefix: 'query: ', documentPrefix: 'passage: ', cacheTag: 'r1' }
const REMOTE: EmbeddingRecipe = { pooling: null, queryPrefix: '', documentPrefix: '', cacheTag: '' }

/**
 * How each model embeds: its pooling and the prefix of a query and of a document.
 *
 * Invariants:
 * - For a local transformers.js model (non-null pooling), a cached vector's key identifies the recipe in this table:
 *   the pooling and the prefix, plus the role when the two prefixes differ.
 * - Changing such a model's recipe requires a new `cacheTag` (`r2`, ...). A tag is never reused.
 * - An empty tag is allowed only for a recipe identical to the one that ran before tags existed.
 * - A remote model (null pooling) carries no tag and is outside this invariant, because the provider decides its
 *   vectors. voyageContext3 is remote and has no table tag; V2 keys its role (see `HypaProcessorV2.getCacheKey`),
 *   and V1 caches only documents.
 *
 * `Record` makes the compiler require a row for every future model key. A GPU key has the recipe of its wasm key.
 */
export const EMBEDDING_RECIPES: Record<HypaModel, EmbeddingRecipe> = {
    MiniLM: UNCHANGED,
    MiniLMGPU: UNCHANGED,
    multiMiniLM: UNCHANGED,
    multiMiniLMGPU: UNCHANGED,
    bgeSmallEn: UNCHANGED,
    bgeSmallEnGPU: UNCHANGED,
    nomic: NOMIC,
    nomicGPU: NOMIC,
    bgem3: CLS,
    bgem3GPU: CLS,
    bgeM3Ko: CLS,
    bgeM3KoGPU: CLS,
    multiE5Small: E5,
    custom: REMOTE,
    ada: REMOTE,
    openai3small: REMOTE,
    openai3large: REMOTE,
    voyageContext3: REMOTE,
}

/** The text a processor puts before an input of this role for this model. */
export function recipePrefix(model: HypaModel, role: 'query' | 'document'): string {
    const recipe = EMBEDDING_RECIPES[model]
    return role === 'query' ? recipe.queryPrefix : recipe.documentPrefix
}

/**
 * The cache-key tail of this model's recipe: empty for an unchanged recipe, `|<tag>` otherwise, plus a role marker
 * (`:q` or `:d`) only when the query and document prefixes differ.
 */
export function recipeCacheTag(model: HypaModel, role: 'query' | 'document'): string {
    const recipe = EMBEDDING_RECIPES[model]
    if (!recipe.cacheTag) {
        return ''
    }
    const roleMarker = recipe.queryPrefix === recipe.documentPrefix ? '' : role === 'query' ? ':q' : ':d'
    return `|${recipe.cacheTag}${roleMarker}`
}

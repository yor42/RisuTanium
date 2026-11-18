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

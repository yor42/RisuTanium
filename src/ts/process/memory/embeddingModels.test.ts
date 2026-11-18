/**
 * The embedding model key lists: the upstream list is the upstream union, the fork-only list is what a `.bin`
 * database entry must not carry, and `HypaModel` is exactly their union. The type-level assertions are checked by
 * `pnpm check`; vitest does not type-check.
 */
import { describe, expect, test } from 'vitest'
import {
    DEFAULT_HYPA_MODEL,
    EMBEDDING_RECIPES,
    FORK_ONLY_HYPA_MODELS,
    UPSTREAM_HYPA_MODELS,
    isForkOnlyHypaModel,
    recipeCacheTag,
    recipePrefix,
    type ForkOnlyHypaModel,
    type HypaModel,
    type UpstreamHypaModel,
} from './embeddingModels'
import type { HypaModel as ConsumerHypaModel } from './hypamemory'

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// An unlisted key is not a `HypaModel`.
// @ts-expect-error 'futureUpstreamModel' is in neither list
const unlisted: HypaModel = 'futureUpstreamModel'
void unlisted

// The two lists do not overlap.
const disjoint: [Extract<ForkOnlyHypaModel, UpstreamHypaModel>] extends [never] ? true : false = true
void disjoint

// The type the consumers use is exactly the union of the two lists.
const consumerExact: Exact<ConsumerHypaModel, UpstreamHypaModel | ForkOnlyHypaModel> = true
void consumerExact

const UPSTREAM_LITERALS = [
    'custom', 'ada', 'openai3small', 'openai3large', 'MiniLM', 'MiniLMGPU', 'nomic', 'nomicGPU', 'bgeSmallEn',
    'bgeSmallEnGPU', 'bgem3', 'bgem3GPU', 'multiMiniLM', 'multiMiniLMGPU', 'bgeM3Ko', 'bgeM3KoGPU', 'voyageContext3',
]

describe('embedding model key lists', () => {
    // compatibility guard: the lists do not exist before the change
    test('the upstream list is the 17 upstream values, in order', () => {
        expect([...UPSTREAM_HYPA_MODELS]).toEqual(UPSTREAM_LITERALS)
    })

    test('the fork-only list holds multiE5Small', () => {
        expect([...FORK_ONLY_HYPA_MODELS]).toEqual(['multiE5Small'])
    })

    test('the lists do not overlap', () => {
        const upstream: readonly string[] = UPSTREAM_HYPA_MODELS
        for (const value of FORK_ONLY_HYPA_MODELS) {
            expect(upstream).not.toContain(value)
        }
    })

    // Tripwire: a changed default or an added fork-only key changes what a `.bin` restore gives back, so the
    // restore result needs review before this assertion is changed.
    test('the default is in the fork-only list', () => {
        const forkOnly: readonly string[] = FORK_ONLY_HYPA_MODELS
        expect(DEFAULT_HYPA_MODEL).toBe('multiE5Small')
        expect(forkOnly).toContain(DEFAULT_HYPA_MODEL)
    })

    test('isForkOnlyHypaModel is true only for a fork-only key', () => {
        expect(isForkOnlyHypaModel('multiE5Small')).toBe(true)
        for (const value of UPSTREAM_LITERALS) {
            expect(isForkOnlyHypaModel(value), value).toBe(false)
        }
        for (const value of ['futureUpstreamModel', '', null, undefined, 0, {}, ['multiE5Small']]) {
            expect(isForkOnlyHypaModel(value)).toBe(false)
        }
    })
})

describe('embedding recipe table', () => {
    const allModels: HypaModel[] = [...UPSTREAM_HYPA_MODELS, ...FORK_ONLY_HYPA_MODELS]
    const REMOTE_MODELS: HypaModel[] = ['custom', 'ada', 'openai3small', 'openai3large', 'voyageContext3']
    const GPU_PAIRS: [HypaModel, HypaModel][] = [
        ['MiniLMGPU', 'MiniLM'], ['nomicGPU', 'nomic'], ['bgeSmallEnGPU', 'bgeSmallEn'], ['bgem3GPU', 'bgem3'],
        ['multiMiniLMGPU', 'multiMiniLM'], ['bgeM3KoGPU', 'bgeM3Ko'],
    ]

    // new-rule test (the table does not exist before): every model has a row
    test('every model key has a recipe row', () => {
        expect(Object.keys(EMBEDDING_RECIPES).sort()).toEqual([...allModels].sort())
    })

    test('remote models have no pooling, no prefix and no cache tag', () => {
        for (const model of REMOTE_MODELS) {
            expect(EMBEDDING_RECIPES[model], model).toEqual({ pooling: null, queryPrefix: '', documentPrefix: '', cacheTag: '' })
        }
    })

    test('every other model is local and has a pooling', () => {
        for (const model of allModels.filter((key) => !REMOTE_MODELS.includes(key))) {
            expect(['mean', 'cls'], model).toContain(EMBEDDING_RECIPES[model].pooling)
        }
    })

    test('a GPU row equals its wasm row', () => {
        for (const [gpu, wasm] of GPU_PAIRS) {
            expect(EMBEDDING_RECIPES[gpu], gpu).toEqual(EMBEDDING_RECIPES[wasm])
        }
    })

    test('a model with a prefix or CLS pooling has a cache tag, and an unchanged model has none', () => {
        for (const model of allModels) {
            const recipe = EMBEDDING_RECIPES[model]
            const changed = recipe.pooling === 'cls' || recipe.queryPrefix !== '' || recipe.documentPrefix !== ''
            expect(recipe.cacheTag !== '', model).toBe(changed)
        }
    })

    test('the helpers give the prefix per role and a role marker only when the prefixes differ', () => {
        expect(recipePrefix('nomic', 'document')).toBe('search_document: ')
        expect(recipePrefix('nomic', 'query')).toBe('search_query: ')
        expect(recipePrefix('multiE5Small', 'document')).toBe('passage: ')
        expect(recipePrefix('multiE5Small', 'query')).toBe('query: ')
        expect(recipePrefix('MiniLM', 'query')).toBe('')
        expect(recipeCacheTag('nomic', 'document')).toBe('|r1:d')
        expect(recipeCacheTag('nomic', 'query')).toBe('|r1:q')
        expect(recipeCacheTag('bgem3', 'document')).toBe('|r1')
        expect(recipeCacheTag('bgem3', 'query')).toBe('|r1')
        expect(recipeCacheTag('MiniLM', 'document')).toBe('')
        expect(recipeCacheTag('voyageContext3', 'query')).toBe('')
    })
})

/**
 * The embedding model key lists: the upstream list is the upstream union, the fork-only list is what a `.bin`
 * database entry must not carry, and `HypaModel` is exactly their union. The type-level assertions are checked by
 * `pnpm check`; vitest does not type-check.
 */
import { describe, expect, test } from 'vitest'
import {
    DEFAULT_HYPA_MODEL,
    FORK_ONLY_HYPA_MODELS,
    UPSTREAM_HYPA_MODELS,
    isForkOnlyHypaModel,
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

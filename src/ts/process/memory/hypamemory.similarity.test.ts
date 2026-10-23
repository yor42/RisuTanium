/**
 * HypaProcesser ranking through the real `similaritySearchScored` path with a
 * fake embedding table (text to vector), so vector length is controlled.
 */
import { describe, expect, it, vi } from 'vitest'

const vectors = vi.hoisted(() => new Map<string, number[]>())

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => ({ hypaModel: 'MiniLM', hypaCustomSettings: {} }),
}))
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/secretRef', () => ({ resolveSecret: async (secret: string) => secret }))
// ts/util's import graph cycles back into the memory modules.
vi.mock('src/ts/util', () => ({ appendLastPath: (a: string, b: string) => `${a}/${b}` }))
vi.mock('src/ts/process/transformers', () => ({
    runEmbedding: async (inputs: string[]) => inputs.map((text) => vectors.get(text) ?? [0, 0]),
}))
vi.mock('src/ts/process/inFlightWork', () => ({
    withInFlight: <T>(_key: string, work: () => Promise<T>) => work(),
}))
vi.mock('localforage', () => {
    const store = new Map<string, unknown>()
    return {
        default: {
            createInstance: () => ({
                getItem: async (key: string) => store.get(key) ?? null,
                setItem: async (key: string, value: unknown) => { store.set(key, value) },
            }),
        },
    }
})

import { HypaProcesser, similarity } from './hypamemory'

async function ranking(tag: string, documentVectors: Record<string, number[]>) {
    vectors.clear()
    vectors.set('query', [1, 0])
    // The stubbed vector store keeps embeddings per text, so each test uses its own texts.
    const texts = new Map(Object.entries(documentVectors).map(([name, vector]) => [`${tag} ${name}`, vector]))
    for (const [text, vector] of texts) vectors.set(text, vector)
    const processer = new HypaProcesser('MiniLM')
    await processer.addText([...texts.keys()])
    return (await processer.similaritySearchScored('query')).map(([text]) => text.slice(tag.length + 1))
}

// cosine 0.9 against the query, and cosine 0.5
const close = [0.9, Math.sqrt(1 - 0.81)]
const far = [0.5, Math.sqrt(1 - 0.25)]

describe('HypaProcesser ranking', () => {
    it('guard: unit-length documents rank by closeness to the query', async () => {
        expect(await ranking('unit', { far, close })).toEqual(['close', 'far'])
    })

    // compatibility guard: CHORE-10 SHARED-1. A mis-sorting comparator does not fail on V8, so this passes before and after the fix.
    it('guard: results are ordered by descending score and tied documents keep insertion order', async () => {
        const mid = [0.7, Math.sqrt(1 - 0.49)]
        const order = await ranking('order', { low: far, tieA: mid, high: close, tieB: mid })
        expect(order).toEqual(['high', 'tieA', 'tieB', 'low'])
    })

    // regression reproducer: CHORE-10 SHARED-2, MC-713 6
    it('ranks a document the same when its vector is scaled by 10 (cosine)', async () => {
        const scaledFar = far.map((x) => x * 10)
        expect(await ranking('scaled', { far: scaledFar, close })).toEqual(['close', 'far'])
    })

    // zero-vector reproducer: a naive cosine yields NaN, which makes the sort comparator inconsistent
    it('scores a zero-vector document 0 and keeps the other documents in order', async () => {
        const zeroed = await ranking('zero', { zeroA: [0, 0], far, zeroB: [0, 0], close })
        expect(zeroed).toEqual(['close', 'far', 'zeroA', 'zeroB'])
        vectors.clear()
        vectors.set('query', [1, 0])
        vectors.set('zs zero', [0, 0])
        const processer = new HypaProcesser('MiniLM')
        await processer.addText(['zs zero'])
        const [[, score]] = await processer.similaritySearchScored('query')
        expect(score).toBe(0)
    })

    // compatibility guard: hypav3 similaritySearchScoredEx imports this raw dot product and stays on it (MC-719 1)
    it('guard: the exported similarity stays a raw dot product', () => {
        expect(similarity([3, 4], [3, 4])).toBe(25)
        expect(similarity([10, 0], [2, 5])).toBe(20)
    })
})

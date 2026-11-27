import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    mobile: false,
    db: { hypaModel: 'openai3small', hypaCustomSettings: undefined as undefined | { url?: string, key?: string, model?: string }, supaMemoryKey: '', voyageApiKey: '', connections: [{ id: 'conn-1', name: 'Memory (OpenAI)', provider: 'memory_openai', key: 'k' }, { id: 'conn-2', name: 'Voyage AI', provider: 'voyage', key: 'vk' }] },
    fetch: vi.fn(),
    forage: { getItem: vi.fn(), setItem: vi.fn() },
}))

vi.mock('src/ts/platform', () => ({
    get isMobile() {
        return h.mobile
    },
}))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db }))
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: (...a: unknown[]) => h.fetch(...a) }))
vi.mock('src/ts/secretRef', () => ({ resolveSecret: async (s: string) => s }))
vi.mock('src/ts/util', () => ({ appendLastPath: (a: string, b: string) => `${a}/${b}` }))
vi.mock('src/ts/storage/saveYield', () => ({ yieldByMessage: async () => {} }))
vi.mock('../../transformers', () => ({ runEmbedding: async () => { throw new Error('no local model in tests') } }))
vi.mock('localforage', () => ({ default: { createInstance: () => h.forage } }))

import { inFlightKinds, resetInFlightForTest } from '../../../inFlightWork'
import { HypaProcesser } from '../../hypamemory'
import { rawHash } from '../records'
import { chroMemoryEmbedder, isEnglishOnlyHypaModel, resetDenseEmbedderForTests, type DenseProcessor } from '../denseEmbedder'

beforeEach(() => {
    resetDenseEmbedderForTests()
    resetInFlightForTest()
    h.mobile = false
    h.db.hypaModel = 'openai3small'
    h.db.hypaCustomSettings = undefined
    h.fetch.mockReset()
    h.fetch.mockImplementation(async () => {
        throw new Error('no network in tests')
    })
    h.forage.getItem.mockReset()
    h.forage.setItem.mockReset()
})
afterEach(() => {
    vi.useRealTimers()
})

function fakeProcessor() {
    const proc = {
        getEmbeds: vi.fn(async (_i: string | string[], _t?: 'query' | 'document') => [[1, 2, 3]]),
        embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 0]))),
        addText: vi.fn(),
        testText: vi.fn(),
    }
    return proc
}

describe('G-adapter the production adapter', () => {
    test('guard: query goes through getEmbeds as a query, documents through embedDocuments, as Float32Array; addText, testText and forage are never reached', async () => {
        const proc = fakeProcessor()
        const { embedder, reason } = chroMemoryEmbedder(() => proc as unknown as DenseProcessor)
        expect(reason).toBeNull()
        const q = await embedder!.embedQuery('hello')
        expect(q).toBeInstanceOf(Float32Array)
        expect(Array.from(q)).toEqual([1, 2, 3])
        expect(proc.getEmbeds).toHaveBeenCalledWith('hello', 'query')
        const docs = await embedder!.embedDocuments(['a', 'b'])
        expect(docs).toHaveLength(2)
        expect(docs[0]).toBeInstanceOf(Float32Array)
        expect(proc.embedDocuments).toHaveBeenCalledWith(['a', 'b'])
        expect(proc.addText).not.toHaveBeenCalled()
        expect(proc.testText).not.toHaveBeenCalled()
        expect(h.forage.setItem).not.toHaveBeenCalled()
        expect(h.fetch).not.toHaveBeenCalled()
    })

    test('guard: a local model on a phone is refused, and a remote one is allowed there', () => {
        h.mobile = true
        h.db.hypaModel = 'multiE5Small'
        expect(chroMemoryEmbedder(() => fakeProcessor() as unknown as DenseProcessor)).toEqual({ embedder: null, reason: 'local-model-on-phone' })
        h.db.hypaModel = 'openai3small'
        expect(chroMemoryEmbedder(() => fakeProcessor() as unknown as DenseProcessor).embedder).not.toBeNull()
    })

    test('guard: a local model on a desktop is allowed', () => {
        h.db.hypaModel = 'multiE5Small'
        expect(chroMemoryEmbedder(() => fakeProcessor() as unknown as DenseProcessor).embedder).not.toBeNull()
    })

    test('guard: the model key varies with the model, the custom model and URL, and one processor is built per key', () => {
        const make = vi.fn(() => fakeProcessor() as unknown as DenseProcessor)
        const key = () => chroMemoryEmbedder(make).embedder!.modelKey
        const a = key()
        expect(key()).toBe(a)
        expect(make).toHaveBeenCalledTimes(1)
        h.db.hypaModel = 'custom'
        h.db.hypaCustomSettings = { url: 'http://x/v1', model: 'm1' }
        const c1 = key()
        h.db.hypaCustomSettings = { url: 'http://x/v1', model: 'm2' }
        const c2 = key()
        h.db.hypaCustomSettings = { url: 'http://y/v1', model: 'm2' }
        const c3 = key()
        expect(new Set([a, c1, c2, c3]).size).toBe(4)
        h.db.hypaModel = 'multiE5Small'
        expect(key()).toContain('|r1')
    })

    test('guard: the model key and the head model derived from it are pinned for fixed settings (persisted vectors are keyed by them)', () => {
        const make = () => fakeProcessor() as unknown as DenseProcessor
        const key = () => chroMemoryEmbedder(make).embedder!.modelKey
        h.db.hypaModel = 'openai3small'
        const plain = key()
        h.db.hypaModel = 'custom'
        h.db.hypaCustomSettings = { url: ' http://x/v1 ', model: ' m1 ' }
        const custom = key()
        h.db.hypaModel = 'multiE5Small'
        const local = key()
        expect({ plain, custom, local, headModel: [plain, custom, local].map((k) => rawHash(k)) }).toEqual({
            plain: 'openai3small|||',
            custom: 'custom|http://x/v1|m1|',
            local: 'multiE5Small||||r1:d',
            headModel: ['15:50ee0ae1:1b6601a4', '22:817c6de8:db1eaa5b', '20:d66ac81c:2951367c'],
        })
    })

    test('guard: voyageContext3 goes through the real HypaProcesser: documents as single-chunk groups, the query as a query', async () => {
        h.db.hypaModel = 'voyageContext3'
        const bodies: Array<{ inputs: string[][], input_type?: string }> = []
        h.fetch.mockImplementation(async (_url: string, args: { body: { inputs: string[][], input_type?: string } }) => {
            bodies.push(args.body)
            return { ok: true, data: { data: args.body.inputs.map((g) => ({ data: g.map(() => ({ embedding: [1, 0, 0] })) })) } }
        })
        const { embedder } = chroMemoryEmbedder()
        expect(embedder).not.toBeNull()
        const docs = await embedder!.embedDocuments(['one', 'two'])
        expect(docs).toHaveLength(2)
        const q = await embedder!.embedQuery('ask')
        expect(q).toBeInstanceOf(Float32Array)
        const docCall = bodies.find((b) => b.input_type === 'document')
        const queryCall = bodies.find((b) => b.input_type === 'query')
        expect(docCall?.inputs).toEqual([['one'], ['two']])
        expect(queryCall).toBeDefined()
        expect(h.forage.setItem).not.toHaveBeenCalled()
    })

    test('guard: the English-only list names the English-only models and no multilingual one', () => {
        for (const m of ['MiniLM', 'MiniLMGPU', 'bgeSmallEn', 'bgeSmallEnGPU', 'nomic', 'nomicGPU']) expect(isEnglishOnlyHypaModel(m), m).toBe(true)
        for (const m of ['openai3small', 'multiE5Small', 'bgem3', 'multiMiniLM', 'voyageContext3', undefined]) expect(isEnglishOnlyHypaModel(m), String(m)).toBe(false)
    })
})

describe('D2 diagnostic: a timed-out embedding fetch keeps its inner token', () => {
    test('diagnostic: with the real HypaProcesser and a never-settling fetch, embed stays live (base behavior, not changed by S3)', async () => {
        h.fetch.mockImplementation(() => new Promise(() => {}))
        const proc = new HypaProcesser('openai3small')
        void proc.embedDocuments(['x']).catch(() => {})
        await Promise.resolve()
        await Promise.resolve()
        expect(inFlightKinds()).toContain('embed')
    })
})

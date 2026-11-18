// @vitest-environment happy-dom

/**
 * The default embedding model of `HypaProcesser` ('auto') and `HypaProcessorV2`, and the multilingual E5 model's
 * pipeline call, through the REAL `runEmbedding` over a fake `@huggingface/transformers` pipeline. A passing test says
 * nothing about the real model files or the native runtime.
 *
 * The comment above each case marks it: a regression reproducer fails against the base where the default is MiniLM and
 * `multiE5Small` is unsupported; a compatibility guard passes before and after, unless the comment says post-fix only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

//#region module mocks

const dbBox = vi.hoisted(() => ({
    hypaModel: undefined as string | undefined,
}))

const store = vi.hoisted(() => ({
    items: new Map<string, unknown>(),
    setKeys: [] as string[],
}))

const pipelineBox = vi.hoisted(() => ({
    extractor: vi.fn(async (texts: string[], _options: unknown) => ({ data: new Float32Array(texts.length * 384).fill(0.5) })),
    pipeline: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => ({ hypaModel: dbBox.hypaModel, hypaCustomSettings: {}, supaMemoryKey: '' }),
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    globalFetch: vi.fn(),
    loadAsset: async () => new Uint8Array(4),
    saveAsset: async () => '',
}))
vi.mock('src/ts/secretRef', () => ({ resolveSecret: async (secret: string) => secret }))
// ts/util's import graph cycles back into the memory modules.
vi.mock('src/ts/util', () => ({
    appendLastPath: (a: string, b: string) => `${a}/${b}`,
    selectSingleFile: vi.fn(),
    asBuffer: (data: Uint8Array) => data,
}))
vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: async (key: string) => store.items.get(key) ?? null,
            setItem: async (key: string, value: unknown) => {
                store.items.set(key, value)
                store.setKeys.push(key)
            },
        }),
    },
}))
vi.mock('@huggingface/transformers', () => ({
    env: {},
    pipeline: (...args: unknown[]) => pipelineBox.pipeline(...args),
}))

//#endregion

/** Loads the code under test fresh, so the module-level extractor of `runEmbedding` is not shared between cases. */
async function load() {
    vi.resetModules()
    const hypamemory = await import('../memory/hypamemory')
    const hypamemoryv2 = await import('../memory/hypamemoryv2')
    return { ...hypamemory, ...hypamemoryv2 }
}

beforeEach(() => {
    dbBox.hypaModel = undefined
    store.items.clear()
    store.setKeys.length = 0
    pipelineBox.extractor.mockClear()
    pipelineBox.pipeline.mockReset().mockImplementation(async () => Object.assign(pipelineBox.extractor, { dispose: async () => {} }))
    vi.stubGlobal('caches', { open: async () => ({ put: async () => {}, match: async () => undefined }) })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

const pipelineCall = () => pipelineBox.pipeline.mock.calls[0] as [string, string, { dtype: string, device: string }]

describe('the default embedding model', () => {
    // regression reproducer: T3a
    it('HypaProcesser with no stored model embeds with multilingual E5 on wasm, with the E5 query prefix', async () => {
        const { HypaProcesser } = await load()
        await new HypaProcesser().getEmbeds(['first text', 'second text'])
        const [task, model, options] = pipelineCall()
        expect(task).toBe('feature-extraction')
        expect(model).toBe('Xenova/multilingual-e5-small')
        expect(options).toMatchObject({ dtype: 'q8', device: 'wasm' })
        expect(pipelineBox.extractor).toHaveBeenCalledWith(['query: first text', 'query: second text'], { pooling: 'mean', normalize: true })
    })

    // regression reproducer: T3b
    it('HypaProcessorV2 with no stored model embeds with multilingual E5 on wasm, with the E5 passage prefix', async () => {
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2().addTexts([{ id: 'a', content: 'first text' }])
        const [task, model, options] = pipelineCall()
        expect(task).toBe('feature-extraction')
        expect(model).toBe('Xenova/multilingual-e5-small')
        expect(options).toMatchObject({ dtype: 'q8', device: 'wasm' })
        expect(pipelineBox.extractor).toHaveBeenCalledWith(['passage: first text'], { pooling: 'mean', normalize: true })
    })

    // regression reproducer: T4 (V1 rejects with a TypeError and V2 with "Unsupported model" on the base)
    it('an explicit multiE5Small loads multilingual E5 on wasm with the query prefix in V1 and the passage prefix in V2', async () => {
        const { HypaProcesser, HypaProcessorV2 } = await load()
        await new HypaProcesser('multiE5Small').getEmbeds(['plain'])
        await new HypaProcessorV2({ model: 'multiE5Small' }).addTexts([{ id: 'a', content: 'plain v2' }])
        expect(pipelineBox.pipeline).toHaveBeenCalledTimes(1)
        const [, model, options] = pipelineCall()
        expect(model).toBe('Xenova/multilingual-e5-small')
        expect(options).toMatchObject({ dtype: 'q8', device: 'wasm' })
        expect(pipelineBox.extractor.mock.calls.map((call) => call[0])).toEqual([['query: plain'], ['passage: plain v2']])
    })

    // compatibility guard: T5, passes before and after
    it('guard: MiniLM still loads Xenova/all-MiniLM-L6-v2, in V1 and V2', async () => {
        const { HypaProcesser } = await load()
        await new HypaProcesser('MiniLM').getEmbeds(['plain'])
        expect(pipelineCall()[1]).toBe('Xenova/all-MiniLM-L6-v2')
        pipelineBox.pipeline.mockClear()
        const second = await load()
        await new second.HypaProcessorV2({ model: 'MiniLM' }).addTexts([{ id: 'a', content: 'plain v2' }])
        expect(pipelineCall()[1]).toBe('Xenova/all-MiniLM-L6-v2')
    })

    // compatibility guard, meaningful post-fix only (pre-fix it fails like the explicit multiE5Small case): T6
    it('post-fix-only guard: a vector cached under MiniLM is not read for multiE5Small, which stores its own key', async () => {
        store.items.set('shared text|MiniLM', { content: 'shared text', embedding: [9, 9, 9] })
        const { HypaProcesser } = await load()
        const processer = new HypaProcesser('multiE5Small')
        await processer.addText(['shared text'])
        expect(pipelineBox.extractor).toHaveBeenCalledTimes(1)
        expect(store.setKeys).toEqual(['shared text|multiE5Small|r1:d'])
        expect(store.items.get('shared text|MiniLM')).toEqual({ content: 'shared text', embedding: [9, 9, 9] })
    })

    // compatibility guard, meaningful post-fix only: T6 for HypaProcessorV2, whose cache key must carry the model
    it('post-fix-only guard: V2 does not read a vector cached under MiniLM for multiE5Small and stores its own key', async () => {
        store.items.set('shared text|MiniLM', { content: 'shared text', embedding: [9, 9, 9] })
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2({ model: 'multiE5Small' }).addTexts([{ id: 'a', content: 'shared text' }])
        expect(pipelineBox.extractor).toHaveBeenCalledTimes(1)
        expect(store.setKeys).toHaveLength(1)
        expect(store.setKeys[0].endsWith('|multiE5Small|r1:d')).toBe(true)
        expect(store.items.get('shared text|MiniLM')).toEqual({ content: 'shared text', embedding: [9, 9, 9] })
    })

    // compatibility guard (post-fix only: the lists do not exist before): every local model key is classified
    it('guard: every local model key is a classified HypaModel key', async () => {
        const { localModels } = await load()
        const { UPSTREAM_HYPA_MODELS, FORK_ONLY_HYPA_MODELS } = await import('../memory/embeddingModels')
        const classified: readonly string[] = [...UPSTREAM_HYPA_MODELS, ...FORK_ONLY_HYPA_MODELS]
        for (const key of Object.keys(localModels.models)) {
            expect(classified, key).toContain(key)
        }
        expect(localModels.gpuModels).not.toContain('multiE5Small')
    })
})

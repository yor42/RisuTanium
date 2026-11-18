// @vitest-environment happy-dom

/**
 * The per-model embedding recipe (pooling, query/document prefix, cache-key tag) of `HypaProcesser` (V1) and
 * `HypaProcessorV2`, through the REAL `runEmbedding` over a fake `@huggingface/transformers` pipeline and a shared
 * recording store. A passing test says nothing about real model files, real vector quality or the native runtime.
 *
 * Models are string literals on purpose: the file does not statically import the recipe table (only the new-rule table
 * case loads it dynamically), so each other case also runs against a base that has none. The comment above each case marks it: a regression reproducer fails against the base that mean-pools
 * every model, sends raw text and keys every local vector as `text|model`; a compatibility guard passes before and after;
 * a new-rule test checks a rule that has no base counterpart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddingPooling, HypaModel } from '../memory/embeddingModels'

//#region module mocks

const dbBox = vi.hoisted(() => ({
    customModel: '',
}))

const store = vi.hoisted(() => ({
    items: new Map<string, unknown>(),
    setKeys: [] as string[],
}))

const pipelineBox = vi.hoisted(() => ({
    extractor: vi.fn(async (texts: string[], _options: unknown) => ({ data: new Float32Array(texts.length * 384).fill(0.5) })),
    pipeline: vi.fn(),
}))

const fetchBox = vi.hoisted(() => ({
    globalFetch: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => ({ hypaModel: undefined, hypaCustomSettings: { model: dbBox.customModel }, supaMemoryKey: '' }),
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    globalFetch: (...args: unknown[]) => fetchBox.globalFetch(...args),
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
    const transformers = await import('../transformers')
    return { ...hypamemory, ...hypamemoryv2, runEmbedding: transformers.runEmbedding }
}

beforeEach(() => {
    dbBox.customModel = ''
    store.items.clear()
    store.setKeys.length = 0
    pipelineBox.extractor.mockClear()
    pipelineBox.pipeline.mockReset().mockImplementation(async () => Object.assign(pipelineBox.extractor, { dispose: async () => {} }))
    fetchBox.globalFetch.mockReset().mockResolvedValue({ ok: true, data: { data: [{ embedding: [1] }] } })
    vi.stubGlobal('caches', { open: async () => ({ put: async () => {}, match: async () => undefined }) })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

/** The texts of every extractor call, in order. */
const extractorInputs = () => pipelineBox.extractor.mock.calls.map((call) => call[0])
/** The options of every extractor call, in order. */
const extractorOptions = () => pipelineBox.extractor.mock.calls.map((call) => call[1])
/** The `input` of every remote embedding request, in order; V1 sends a single query as a plain string. */
const fetchInputs = () => fetchBox.globalFetch.mock.calls.map((call) => [(call[1] as { body: { input: string | string[] } }).body.input].flat())
/** The value the real producers write: `{content, embedding}`. */
const seed = () => ({ content: 'X', embedding: [9, 9, 9] })

const CLS_MODELS: HypaModel[] = ['bgem3', 'bgem3GPU', 'bgeM3Ko', 'bgeM3KoGPU']
const MEAN_MODELS: HypaModel[] = ['MiniLM', 'multiMiniLM', 'bgeSmallEn', 'nomic', 'multiE5Small']
const VERBATIM_MODELS: HypaModel[] = ['MiniLM', 'bgem3', 'bgeSmallEn', 'multiMiniLM']
const PREFIXED_MODELS: [HypaModel, string, string, string][] = [
    ['nomic', 'search_document: ', 'search_query: ', 'r1:d'],
    ['multiE5Small', 'passage: ', 'query: ', 'r1:d'],
]

describe('recipe table', () => {
    // new-rule test: the models with a pooling are exactly the models the local runtime loads
    it('the models with a pooling are exactly the local models', async () => {
        const { localModels } = await load()
        const { EMBEDDING_RECIPES } = await import('../memory/embeddingModels')
        const withPooling = Object.entries(EMBEDDING_RECIPES).filter(([, recipe]) => recipe.pooling !== null).map(([model]) => model)
        expect(withPooling.sort()).toEqual(Object.keys(localModels.models).sort())
    })
})

describe('pooling per model', () => {
    // regression reproducer: P1 (the base mean-pools every model)
    it.each(CLS_MODELS)('V1 %s embeds with CLS pooling', async (model) => {
        const { HypaProcesser } = await load()
        await new HypaProcesser(model).getEmbeds(['x'])
        expect(extractorOptions()).toEqual([{ pooling: 'cls', normalize: true }])
    })

    // regression reproducer: P2
    it.each(CLS_MODELS)('V2 %s embeds with CLS pooling', async (model) => {
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2({ model }).addTexts([{ id: 'a', content: 'x' }])
        expect(extractorOptions()).toEqual([{ pooling: 'cls', normalize: true }])
    })

    // compatibility guard: P3, passes before and after
    it.each(MEAN_MODELS)('guard: %s keeps mean pooling in V1 and V2', async (model) => {
        const { HypaProcesser, HypaProcessorV2 } = await load()
        await new HypaProcesser(model).getEmbeds(['x'])
        await new HypaProcessorV2({ model }).addTexts([{ id: 'a', content: 'y' }])
        expect(extractorOptions()).toEqual([{ pooling: 'mean', normalize: true }, { pooling: 'mean', normalize: true }])
    })

    // new-rule test: P4 (before the change the fourth argument is ignored and the call resolves with mean pooling)
    it.each([
        ['undefined', undefined],
        ['an unknown value', 'max'],
    ])('runEmbedding rejects %s as pooling without loading a pipeline', async (_label, pooling) => {
        const { runEmbedding } = await load()
        await expect(runEmbedding(['x'], 'Xenova/all-MiniLM-L6-v2', 'wasm', pooling as unknown as EmbeddingPooling)).rejects.toThrow(/pooling/)
        expect(pipelineBox.pipeline).not.toHaveBeenCalled()
        expect(pipelineBox.extractor).not.toHaveBeenCalled()
    })
})

describe('query and document prefix', () => {
    // regression reproducer: X1
    it.each(PREFIXED_MODELS)('V1 %s sends the document prefix for addText and the query prefix for a search', async (model, documentPrefix, queryPrefix) => {
        const { HypaProcesser } = await load()
        const processor = new HypaProcesser(model)
        await processor.addText(['X'])
        await processor.similaritySearch('q')
        expect(extractorInputs()).toEqual([[documentPrefix + 'X'], [queryPrefix + 'q']])
    })

    // regression reproducer: X2
    it.each(PREFIXED_MODELS)('V2 %s sends the document prefix for addTexts and the query prefix for a search', async (model, documentPrefix, queryPrefix) => {
        const { HypaProcessorV2 } = await load()
        const processor = new HypaProcessorV2<undefined>({ model })
        await processor.addTexts([{ id: 'a', content: 'doc one' }])
        await processor.similaritySearchScored('query two')
        expect(extractorInputs()).toEqual([[documentPrefix + 'doc one'], [queryPrefix + 'query two']])
    })

    // compatibility guard: X3, passes before and after
    it.each(VERBATIM_MODELS)('guard: %s sends verbatim text in V1 and V2', async (model) => {
        const { HypaProcesser, HypaProcessorV2 } = await load()
        const v1 = new HypaProcesser(model)
        await v1.addText(['doc one'])
        await v1.similaritySearch('query one')
        const v2 = new HypaProcessorV2<undefined>({ model })
        await v2.addTexts([{ id: 'a', content: 'doc two' }])
        await v2.similaritySearchScored('query two')
        expect(extractorInputs()).toEqual([['doc one'], ['query one'], ['doc two'], ['query two']])
    })

    // compatibility guard: X4, passes before and after
    it('guard: custom and ada send raw input in the request body, in V1 and V2', async () => {
        const { HypaProcesser, HypaProcessorV2 } = await load()
        const custom = new HypaProcesser('custom', 'http://embeddings.invalid/v1')
        await custom.addText(['custom doc'])
        await custom.similaritySearch('custom query')
        const ada = new HypaProcesser('ada')
        await ada.addText(['ada doc'])
        await ada.similaritySearch('ada query')
        const customV2 = new HypaProcessorV2<undefined>({ model: 'custom', customEmbeddingUrl: 'http://embeddings.invalid/v1' })
        await customV2.addTexts([{ id: 'a', content: 'custom doc v2' }])
        await customV2.similaritySearchScored('custom query v2')
        const adaV2 = new HypaProcessorV2<undefined>({ model: 'ada' })
        await adaV2.addTexts([{ id: 'a', content: 'ada doc v2' }])
        await adaV2.similaritySearchScored('ada query v2')
        expect(fetchInputs()).toEqual([
            ['custom doc'], ['custom query'], ['ada doc'], ['ada query'],
            ['custom doc v2'], ['custom query v2'], ['ada doc v2'], ['ada query v2'],
        ])
        expect(pipelineBox.extractor).not.toHaveBeenCalled()
    })
})

describe('content stays raw', () => {
    // compatibility guard: C1, passes before and after
    it('guard: V1 nomic returns and stores the text without the prefix', async () => {
        const { HypaProcesser } = await load()
        const processor = new HypaProcesser('nomic')
        await processor.addText(['X'])
        expect(processor.vectors[0].content).toBe('X')
        expect(await processor.similaritySearch('q')).toEqual(['X'])
        const stored = [...store.items.values()] as { content: string }[]
        expect(stored.map((item) => item.content)).toEqual(['X'])
    })

    // compatibility guard: C1 for V2
    it('guard: V2 nomic returns and stores the text without the prefix', async () => {
        const { HypaProcessorV2 } = await load()
        const processor = new HypaProcessorV2<undefined>({ model: 'nomic' })
        await processor.addTexts([{ id: 'a', content: 'X' }])
        expect(processor.vectors.get('a')?.content).toBe('X')
        const scored = await processor.similaritySearchScored('q')
        expect(scored.map(([result]) => result.content)).toEqual(['X'])
        // V2 caches the query vector as well, so the store holds the document text and the query text.
        const stored = [...store.items.values()] as { content: string }[]
        expect(stored.map((item) => item.content).sort()).toEqual(['X', 'q'])
    })
})

describe('cache keys follow the recipe', () => {
    const CHANGED: [HypaModel, string][] = [
        ['bgem3', 'X|bgem3|r1'],
        ['nomic', 'X|nomic|r1:d'],
        ['multiE5Small', 'X|multiE5Small|r1:d'],
    ]

    // regression reproducer: K1 (the base reads the old untagged key as a hit)
    it.each(CHANGED)('V1 %s misses the old untagged key and writes the tagged one', async (model, newKey) => {
        store.items.set(`X|${model}`, seed())
        const { HypaProcesser } = await load()
        await new HypaProcesser(model).addText(['X'])
        expect(pipelineBox.extractor).toHaveBeenCalledTimes(1)
        expect(store.setKeys).toEqual([newKey])
        expect(store.items.get(`X|${model}`)).toEqual(seed())
    })

    // regression reproducer: K2
    it.each(CHANGED)('V2 %s misses the old untagged key and writes the tagged one', async (model, newKey) => {
        store.items.set(`X|${model}`, seed())
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2<undefined>({ model }).addTexts([{ id: 'a', content: 'X' }])
        expect(pipelineBox.extractor).toHaveBeenCalledTimes(1)
        expect(store.setKeys).toEqual([newKey])
        expect(store.items.get(`X|${model}`)).toEqual(seed())
    })

    // regression reproducer: K3 (the base serves the query vector for the document lookup)
    it('V2 nomic caches a query and a document of the same text separately: query first', async () => {
        const { HypaProcessorV2 } = await load()
        const processor = new HypaProcessorV2<undefined>({ model: 'nomic' })
        await processor.similaritySearchScored('X')
        await processor.addTexts([{ id: 'a', content: 'X' }])
        expect(extractorInputs()).toEqual([['search_query: X'], ['search_document: X']])
        expect(store.setKeys).toContain('X|nomic|r1:q')
        expect(store.setKeys).toContain('X|nomic|r1:d')
    })

    // regression reproducer: K3b (the search id is not 'a', so only the store can serve the query)
    it.each(PREFIXED_MODELS)('V2 %s caches a query and a document of the same text separately: document first', async (model, _documentPrefix, queryPrefix) => {
        const { HypaProcessorV2 } = await load()
        const processor = new HypaProcessorV2<undefined>({ model })
        await processor.addTexts([{ id: 'a', content: 'X' }])
        await processor.similaritySearchScored('X')
        expect(pipelineBox.extractor).toHaveBeenCalledTimes(2)
        expect(extractorInputs()[1]).toEqual([queryPrefix + 'X'])
        expect(store.setKeys.at(-1)).toBe(`X|${model}|r1:q`)
    })

    // compatibility guard: K4, passes before and after
    it.each(['MiniLM', 'bgeSmallEn', 'multiMiniLM'] as HypaModel[])('guard: %s still hits its old key, in V1 and V2', async (model) => {
        store.items.set(`X|${model}`, seed())
        const { HypaProcesser, HypaProcessorV2 } = await load()
        await new HypaProcesser(model).addText(['X'])
        await new HypaProcessorV2<undefined>({ model }).addTexts([{ id: 'a', content: 'X' }])
        expect(pipelineBox.extractor).not.toHaveBeenCalled()
        expect(store.setKeys).toEqual([])
    })

    // compatibility guard: K4 for a remote model
    it('guard: ada still hits its old key, in V1 and V2', async () => {
        store.items.set('X|ada', seed())
        const { HypaProcesser, HypaProcessorV2 } = await load()
        await new HypaProcesser('ada').addText(['X'])
        await new HypaProcessorV2<undefined>({ model: 'ada' }).addTexts([{ id: 'a', content: 'X' }])
        expect(fetchBox.globalFetch).not.toHaveBeenCalled()
        expect(store.setKeys).toEqual([])
    })

    // compatibility guard: K5, passes before and after
    it('guard: V1 and V2 share the document key of nomic', async () => {
        const { HypaProcesser, HypaProcessorV2 } = await load()
        await new HypaProcesser('nomic').addText(['X'])
        await new HypaProcessorV2<undefined>({ model: 'nomic' }).addTexts([{ id: 'a', content: 'X' }])
        expect(pipelineBox.extractor).toHaveBeenCalledTimes(1)
    })

    // compatibility guard: K6, passes before and after
    it('guard: a second processor of bgem3 reads the key the first one wrote', async () => {
        const { HypaProcesser } = await load()
        await new HypaProcesser('bgem3').addText(['X'])
        await new HypaProcesser('bgem3').addText(['X'])
        expect(pipelineBox.extractor).toHaveBeenCalledTimes(1)
    })
})

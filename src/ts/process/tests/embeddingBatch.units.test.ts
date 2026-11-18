// @vitest-environment happy-dom

/**
 * Batch size and task boundaries of local embedding calls in `HypaProcesser` (V1) and `HypaProcessorV2`, through the REAL
 * `runEmbedding` over a fake `@huggingface/transformers` pipeline. One local call blocks the main thread for its whole
 * duration, so a passing test says nothing about real paint gaps or the native runtime; the yield is a recording mock.
 *
 * The comment above each case marks it: a regression reproducer fails against the base that batches local models by 50 (V1)
 * or by `navigator` features (V2) and never yields between local calls; a compatibility guard passes before and after.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

//#region module mocks

const box = vi.hoisted(() => ({
    mobile: false,
    events: [] as ({ embed: number } | { yield: string[] })[],
    fetchInputs: [] as string[][],
}))

const pipelineBox = vi.hoisted(() => ({
    // The first value of each vector is the number in its text plus one, so a vector identifies its own text.
    extractor: vi.fn(async (texts: string[], _options: unknown) => {
        box.events.push({ embed: texts.length })
        const data = new Float32Array(texts.length * 4)
        texts.forEach((text, i) => {
            data[i * 4] = Number(/\d+/.exec(text)?.[0] ?? '0') + 1
        })
        return { data }
    }),
    pipeline: vi.fn(),
}))

const store = vi.hoisted(() => ({ items: new Map<string, unknown>() }))

vi.mock('src/ts/platform', () => ({
    get isMobile() {
        return box.mobile
    },
}))
vi.mock('src/ts/storage/saveYield', () => ({
    yieldByMessage: async () => {
        const { inFlightKinds } = await import('../inFlightWork')
        box.events.push({ yield: inFlightKinds() })
    },
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => ({ hypaModel: undefined, hypaCustomSettings: {}, supaMemoryKey: '' }),
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    globalFetch: async (_url: string, args: { body: { input: string[] } }) => {
        box.fetchInputs.push(args.body.input)
        return { ok: true, data: { data: args.body.input.map((text) => ({ embedding: [Number(/\d+/.exec(text)?.[0] ?? '0') + 1] })) } }
    },
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
    box.mobile = false
    box.events.length = 0
    box.fetchInputs.length = 0
    store.items.clear()
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

const makeTexts = (count: number) => Array.from({ length: count }, (_, i) => `text ${i}`)
const embedSizes = () => box.events.flatMap((event) => ('embed' in event ? [event.embed] : []))
const eventKinds = () => box.events.map((event) => ('embed' in event ? 'embed' : 'yield'))
const yields = () => box.events.flatMap((event) => ('yield' in event ? [event.yield] : []))
const repeat = (value: number, count: number) => Array.from({ length: count }, () => value)

describe('local embedding batches in HypaProcesser (V1)', () => {
    // regression reproducer: B1 (one batch of 10 on the base)
    it('B1: MiniLM on desktop sends batches of 4', async () => {
        const { HypaProcesser } = await load()
        await new HypaProcesser('MiniLM').addText(makeTexts(10))
        expect(embedSizes()).toEqual([4, 4, 2])
    })

    // regression reproducer: B2
    it('B2: MiniLM on mobile sends batches of 1', async () => {
        box.mobile = true
        const { HypaProcesser } = await load()
        await new HypaProcesser('MiniLM').addText(makeTexts(10))
        expect(embedSizes()).toEqual(repeat(1, 10))
    })

    // regression reproducer: B3 (no yield on the base)
    it('B3: one task yield between consecutive calls, with the embed token held during each yield', async () => {
        const { HypaProcesser } = await load()
        await new HypaProcesser('MiniLM').addText(makeTexts(10))
        expect(eventKinds()).toEqual(['embed', 'yield', 'embed', 'yield', 'embed'])
        for (const kinds of yields()) {
            expect(kinds).toContain('embed')
        }
    })

    // regression reproducer: B7 (one batch of 12 on the base)
    it('B7: a WebGPU model sends batches of 10 on desktop', async () => {
        const { HypaProcesser } = await load()
        await new HypaProcesser('MiniLMGPU').addText(makeTexts(12))
        expect(embedSizes()).toEqual([10, 2])
    })

    // compatibility guard: B9, passes before and after
    it('guard B9: a custom model keeps batches of 50 and takes no yield', async () => {
        const { HypaProcesser } = await load()
        await new HypaProcesser('custom', 'http://embed.invalid').addText(makeTexts(120))
        expect(box.fetchInputs.map((input) => input.length)).toEqual([50, 50, 20])
        expect(yields()).toEqual([])
    })

    // compatibility guard: B10, passes before and after
    it('guard B10: each stored vector belongs to its own text, in input order', async () => {
        box.mobile = true
        const { HypaProcesser } = await load()
        const processer = new HypaProcesser('MiniLM')
        const texts = makeTexts(7)
        await processer.addText(texts)
        expect(processer.vectors.map((vector) => vector.content)).toEqual(texts)
        expect(processer.vectors.map((vector) => vector.embedding[0])).toEqual([1, 2, 3, 4, 5, 6, 7])
    })
})

describe('local embedding batches in HypaProcessorV2', () => {
    const items = (count: number) => makeTexts(count).map((content, i) => ({ id: `id${i}`, content }))

    // regression reproducer: B4 (the base picks 5 for any browser that exposes navigator.gpu)
    it('B4: a wasm model on mobile sends batches of 1 even when navigator.gpu exists', async () => {
        box.mobile = true
        vi.stubGlobal('navigator', { gpu: {}, hardwareConcurrency: 8 })
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2({ model: 'multiE5Small' }).addTexts(items(10))
        expect(embedSizes()).toEqual(repeat(1, 10))
    })

    // regression reproducer: B5 (the base uses min(hardwareConcurrency, 10))
    it('B5: a wasm model on desktop sends batches of 4 regardless of hardwareConcurrency', async () => {
        vi.stubGlobal('navigator', { hardwareConcurrency: 16 })
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2({ model: 'multiE5Small' }).addTexts(items(10))
        expect(embedSizes()).toEqual([4, 4, 2])
    })

    // regression reproducer: B6 (no yield on the base)
    it('B6: one task yield between consecutive calls, none before the first or after the last', async () => {
        vi.stubGlobal('navigator', { hardwareConcurrency: 16 })
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2({ model: 'multiE5Small' }).addTexts(items(10))
        expect(eventKinds()).toEqual(['embed', 'yield', 'embed', 'yield', 'embed'])
    })

    // compatibility guard: B8, passes before and after
    it('guard B8: a WebGPU model sends batches of 10 on desktop and 5 on mobile', async () => {
        vi.stubGlobal('navigator', { gpu: {}, hardwareConcurrency: 8 })
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2({ model: 'MiniLMGPU' }).addTexts(items(12))
        expect(embedSizes()).toEqual([10, 2])
        box.events.length = 0
        store.items.clear()
        box.mobile = true
        const second = await load()
        await new second.HypaProcessorV2({ model: 'MiniLMGPU' }).addTexts(items(12))
        expect(embedSizes()).toEqual([5, 5, 2])
    })

    // compatibility guard: B9, passes before and after
    it('guard B9: a custom model keeps batches of 50 and takes no yield', async () => {
        const { HypaProcessorV2 } = await load()
        await new HypaProcessorV2({ model: 'custom', customEmbeddingUrl: 'http://embed.invalid' }).addTexts(items(120))
        expect(box.fetchInputs.map((input) => input.length).sort((a, b) => b - a)).toEqual([50, 50, 20])
        expect(yields()).toEqual([])
    })

    // compatibility guard: B10, passes before and after
    it('guard B10: each stored vector belongs to its own text', async () => {
        box.mobile = true
        const { HypaProcessorV2 } = await load()
        const processor = new HypaProcessorV2({ model: 'multiE5Small' })
        await processor.addTexts(items(7))
        for (let i = 0; i < 7; i++) {
            expect(processor.vectors.get(`id${i}`)?.embedding[0]).toBe(i + 1)
        }
    })
})

describe('embeddingBatchSize', () => {
    // compatibility guard, post-fix only: the helper does not exist on the base
    it('U1: returns the documented size for every runtime and platform', async () => {
        // The specifier is not a literal so a missing module fails this case at run time, not the whole file at transform time.
        const specifier = '../memory/embeddingBatch'
        const { embeddingBatchSize } = await import(/* @vite-ignore */ specifier)
        expect(embeddingBatchSize('remote', false)).toBe(50)
        expect(embeddingBatchSize('remote', true)).toBe(50)
        expect(embeddingBatchSize('wasm', false)).toBe(4)
        expect(embeddingBatchSize('wasm', true)).toBe(1)
        expect(embeddingBatchSize('webgpu', false)).toBe(10)
        expect(embeddingBatchSize('webgpu', true)).toBe(5)
    })
})

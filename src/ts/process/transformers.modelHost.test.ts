// @vitest-environment happy-dom
/**
 * Models come from huggingface.co only: the app never requests anything from sv.risuai.xyz. Imported VITS
 * models (the `tfMap` keys) and cache entries written while sv.risuai.xyz answered (the `tfCache` keys) keep
 * serving with no request, because the cache is consulted before any host.
 *
 * Drives the REAL `initTransformers` and the REAL `@huggingface/transformers` model-file loader
 * (`AutoConfig.from_pretrained`); only `pipeline` is replaced, by a stub that loads the config the way a real
 * pipeline's first step does. MOCKED: `fetch` (a recording stub), the Cache API (a Map), the asset store.
 * Nothing here says anything about the ONNX runtime or a real download.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be
 * preserved; every other test is a regression reproducer for the behaviour it names.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    loadAsset: vi.fn(),
    store: new Map<string, ArrayBuffer>(),
    fetchCalls: [] as string[],
}))

vi.mock(import('../globalApi.svelte'), () => ({
    loadAsset: h.loadAsset,
    saveAsset: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('../util'), () => ({
    asBuffer: (buffer: ArrayBuffer) => buffer,
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('../util'))

vi.mock('wavefile', () => ({
    WaveFile: class {
        fromScratch() {}
        toBuffer() {
            return { buffer: new ArrayBuffer(8) }
        }
    },
}))

vi.mock('@huggingface/transformers', async (importOriginal) => {
    const real = await importOriginal<typeof import('@huggingface/transformers')>()
    return {
        ...real,
        pipeline: vi.fn(async (_task: string, model: string) => {
            await real.AutoConfig.from_pretrained(model)
            return async () => [{ summary_text: '' }]
        }),
    }
})

const CONFIG = '{"model_type":"bart"}'
const SV_CONFIG = 'https://sv.risuai.xyz/transformers/Xenova/distilbart-cnn-6-6/config.json'
const HF_CONFIG = 'https://huggingface.co/Xenova/distilbart-cnn-6-6/resolve/main/config.json'

async function freshModule() {
    vi.resetModules()
    return await import('./transformers')
}

beforeEach(() => {
    h.store.clear()
    h.fetchCalls.length = 0
    h.loadAsset.mockReset()
    h.loadAsset.mockImplementation(async () => new TextEncoder().encode(CONFIG))
    vi.stubGlobal('caches', {
        open: async () => ({
            put: async (url: string | URL, response: Response) => { h.store.set(String(url), await response.arrayBuffer()) },
            match: async (url: string | URL) => {
                const bytes = h.store.get(String(url))
                return bytes ? new Response(bytes.slice(0)) : undefined
            },
        }),
    })
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        h.fetchCalls.push(url)
        return url === HF_CONFIG ? new Response(CONFIG, { status: 200 }) : new Response('', { status: 404 })
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('model files come from huggingface.co only', () => {
    test('an uncached model file is requested from huggingface.co and never from sv.risuai.xyz', async () => {
        const { runSummarizer } = await freshModule()

        await runSummarizer('text')

        expect(h.fetchCalls.length).toBeGreaterThan(0)
        expect(h.fetchCalls.filter((url) => url.includes('sv.risuai.xyz'))).toEqual([])
        expect(h.fetchCalls[0]).toBe(HF_CONFIG)
    })

    test('guard: an imported VITS model loads from the asset store with no request', async () => {
        const { runVITS } = await freshModule()
        const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

        await runVITS('hi', { id, files: { 'config.json': 'asset-cfg' } }, AbortSignal.abort())

        expect(h.loadAsset).toHaveBeenCalledWith('asset-cfg')
        expect(h.fetchCalls).toEqual([])
    })

    test('guard: an entry cached under the sv.risuai.xyz key serves with no request', async () => {
        const cache = await (globalThis.caches as CacheStorage).open('tfCache')
        await cache.put(SV_CONFIG, new Response(CONFIG))
        const { runSummarizer } = await freshModule()

        await runSummarizer('text')

        expect(h.fetchCalls).toEqual([])
    })
})

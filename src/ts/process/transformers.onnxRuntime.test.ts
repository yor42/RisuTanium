// @vitest-environment happy-dom
/**
 * The ONNX runtime comes from the app's own bundle: after `initTransformers`, `env.backends.onnx.wasm.wasmPaths`
 * must be unset, because any prefix makes onnxruntime-web skip its embedded glue and fetch the runtime from that
 * prefix (the library's own default is a jsDelivr URL).
 *
 * Drives the REAL `initTransformers` and the REAL `@huggingface/transformers` env; only `pipeline` is replaced.
 * MOCKED: `fetch`, the Cache API, the asset store. This says nothing about a real runtime load.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../globalApi.svelte'), () => ({
    loadAsset: vi.fn(),
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
        pipeline: vi.fn(async () => async () => [{ summary_text: '' }]),
    }
})

beforeEach(() => {
    vi.stubGlobal('caches', {
        open: async () => ({
            put: async () => {},
            match: async () => undefined,
        }),
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('bundled ONNX runtime', () => {
    test('initTransformers leaves wasmPaths unset so the runtime loads from the app bundle', async () => {
        vi.resetModules()
        const { runSummarizer } = await import('./transformers')
        const { env } = await import('@huggingface/transformers')
        expect(String(env.backends.onnx.wasm.wasmPaths)).toContain('cdn.jsdelivr.net')

        await runSummarizer('text')

        expect(env.backends.onnx.wasm.wasmPaths).toBeUndefined()
    })
})

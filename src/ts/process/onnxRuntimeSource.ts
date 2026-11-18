import type { env as TransformersEnvValue } from '@huggingface/transformers';

export type TransformersEnv = typeof TransformersEnvValue

/**
 * Makes onnxruntime-web load its runtime from the app's own bundle. Any `wasmPaths` prefix (the library
 * defaults to a jsDelivr URL at module load) or `mjs` override makes onnxruntime-web skip the glue embedded
 * in its bundle and fetch the runtime from that prefix. With neither set, the embedded glue finds the
 * `.wasm` the build emitted beside it. `wasmBinary` is left untouched.
 * Call after the transformers module is imported and before any pipeline is created.
 */
export function useBundledOnnxRuntime(env: TransformersEnv | undefined): void {
    const wasm = env?.backends?.onnx?.wasm
    if (wasm) {
        wasm.wasmPaths = undefined
    }
}

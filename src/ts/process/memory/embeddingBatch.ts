export type EmbeddingRuntime = 'remote' | 'wasm' | 'webgpu'

/**
 * Texts per embedding call. A local call runs on the main thread and blocks it for its whole duration, so the batch size
 * bounds the longest gap between paints; the total time for a fixed set of texts does not depend on it. Remote calls do not
 * block the main thread, so they keep the larger batch.
 */
export function embeddingBatchSize(runtime: EmbeddingRuntime, mobile: boolean): number {
    switch (runtime) {
        case 'wasm':
            return mobile ? 1 : 4
        case 'webgpu':
            return mobile ? 5 : 10
        case 'remote':
            return 50
    }
}

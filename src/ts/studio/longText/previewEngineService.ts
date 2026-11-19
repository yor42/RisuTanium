/**
 * The long-text surfaces' one way to the preview engine. The engine imports the parser, which registers global
 * DOMPurify hooks at import, so it is loaded on the first request only. A failed import rejects; the next request
 * tries again. No module outside `previewEngine.ts` imports the sandbox, the sanitiser or the parser statically.
 */
export type PreviewEngine = typeof import('./previewEngine')
export type PreviewEngineLoader = () => Promise<PreviewEngine>

const realLoader: PreviewEngineLoader = () => import('./previewEngine')

let loader: PreviewEngineLoader = realLoader
let loaded: Promise<PreviewEngine> | null = null

export function loadPreviewEngine(): Promise<PreviewEngine> {
    if (loaded === null) {
        loaded = loader().catch((error: unknown) => {
            loaded = null
            throw error
        })
    }
    return loaded
}

/** Replaces the engine (or a loader that may reject), or restores the real one with `null`. The loaded engine is forgotten. */
export function setPreviewEngineForTests(engine: PreviewEngine | PreviewEngineLoader | null): void {
    loader = engine === null ? realLoader : typeof engine === 'function' ? engine : () => Promise.resolve(engine)
    loaded = null
}

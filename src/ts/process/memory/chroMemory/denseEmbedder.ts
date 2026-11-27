import { isMobile } from 'src/ts/platform'
import { getDatabase } from 'src/ts/storage/database.svelte'
import { HypaProcesser, localModels } from '../hypamemory'
import { DEFAULT_HYPA_MODEL, recipeCacheTag, type HypaModel } from '../embeddingModels'
import type { DenseEmbedder, DenseEmbedderResult } from './dense'

export { ENGLISH_ONLY_HYPA_MODELS, isEnglishOnlyHypaModel } from './dense'

/** The part of HypaProcesser the adapter uses: embedding only, never its vector list or forage cache. */
export type DenseProcessor = Pick<HypaProcesser, 'getEmbeds' | 'embedDocuments'>

const processors = new Map<string, DenseProcessor>()

function toFloat32(v: ArrayLike<number> | undefined): Float32Array {
    if (!v) throw new Error('embedding result is empty')
    return v instanceof Float32Array ? v : Float32Array.from(v)
}

/**
 * The embedding model of the current settings as a DenseEmbedder, or why there
 * is none. It reads the settings at call time, caches one processor per model
 * key, and never uses the processor's text cache or forage: vectors stay in memory.
 * A local model is refused on a phone, where loading it would stall the app.
 */
export function chroMemoryEmbedder(make: () => DenseProcessor = () => new HypaProcesser('auto')): DenseEmbedderResult {
    const db = getDatabase()
    const model: HypaModel = db.hypaModel || DEFAULT_HYPA_MODEL
    if (isMobile && Object.keys(localModels.models).includes(model)) {
        return { embedder: null, reason: 'local-model-on-phone' }
    }
    const url = model === 'custom' ? db.hypaCustomSettings?.url?.trim() ?? '' : ''
    const custom = model === 'custom' ? db.hypaCustomSettings?.model?.trim() ?? '' : ''
    const modelKey = [model, url, custom, recipeCacheTag(model, 'document')].join('|')
    let processor = processors.get(modelKey)
    if (!processor) {
        processor = make()
        processors.set(modelKey, processor)
    }
    const proc = processor
    const embedder: DenseEmbedder = {
        modelKey,
        embedQuery: async (text) => toFloat32((await proc.getEmbeds(text, 'query'))[0]),
        embedDocuments: async (texts) => (await proc.embedDocuments(texts)).map((v) => toFloat32(v)),
    }
    return { embedder, reason: null }
}

export function resetDenseEmbedderForTests(): void {
    processors.clear()
}

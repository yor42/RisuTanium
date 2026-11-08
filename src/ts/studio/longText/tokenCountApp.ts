/**
 * Wires the token counter to the app's own `encode`. Heavy: it pulls the
 * tokenizer, database and plugin modules, so callers load it lazily.
 *
 * `resolveTokenRoute` mirrors the branch tree of `encode`; the differential
 * test in tokenRoute.encodeDiff.test.ts detects drift. Nothing here writes
 * settings.
 */
import { encode } from '../../tokenizer'
import { getDatabase } from '../../storage/database.svelte'
import { pluginV2 } from '../../plugins/plugins.svelte'
import { getModelInfo } from '../../model/modellist'
import { LLMTokenizer } from '../../model/types'
import { createTokenCounter, type TokenResult, type TokenRoute, type TokenizerId } from './tokenCount'

export type TokenRouteInput = {
    aiModel: string
    customTokenizer: string
    pluginTokenizer: string | undefined
    hasPluginTokenizerFunc: boolean
    modelTokenizer: LLMTokenizer
    googleClaudeTokenizing: boolean
}

/** The tokenizer ids shared by the proxy and plugin selectors; `llama3` runs the llama tokenizer. */
function sharedSelectorTokenizer(selected: string): TokenizerId | null {
    switch (selected) {
        case 'mistral':
        case 'llama':
        case 'novelai':
        case 'claude':
        case 'novellist':
        case 'gemma':
        case 'cohere':
        case 'deepseek':
        case 'deepseek-v4':
        case 'glm4':
        case 'glm5':
            return selected
        case 'llama3':
            return 'llama'
        default:
            return null
    }
}

function modelRoute(tokenizer: LLMTokenizer, googleClaudeTokenizing: boolean): TokenRoute {
    switch (tokenizer) {
        case LLMTokenizer.NovelList: return { kind: 'local', tokenizer: 'novellist' }
        case LLMTokenizer.Claude: return { kind: 'local', tokenizer: 'claude' }
        case LLMTokenizer.NovelAI: return { kind: 'local', tokenizer: 'novelai' }
        case LLMTokenizer.Mistral: return { kind: 'local', tokenizer: 'mistral' }
        case LLMTokenizer.Llama: return { kind: 'local', tokenizer: 'llama' }
        case LLMTokenizer.Local: return { kind: 'local', tokenizer: 'gguf' }
        case LLMTokenizer.tiktokenO200Base: return { kind: 'local', tokenizer: 'o200k_base' }
        case LLMTokenizer.GoogleCloud:
            return googleClaudeTokenizing ? { kind: 'online-only' } : { kind: 'local', tokenizer: 'gemma' }
        case LLMTokenizer.Gemma: return { kind: 'local', tokenizer: 'gemma' }
        case LLMTokenizer.DeepSeek: return { kind: 'local', tokenizer: 'deepseek' }
        case LLMTokenizer.DeepSeekV4: return { kind: 'local', tokenizer: 'deepseek-v4' }
        case LLMTokenizer.GLM4: return { kind: 'local', tokenizer: 'glm4' }
        case LLMTokenizer.GLM5: return { kind: 'local', tokenizer: 'glm5' }
        case LLMTokenizer.Cohere: return { kind: 'local', tokenizer: 'cohere' }
        default: return { kind: 'local', tokenizer: 'cl100k_base' }
    }
}

export function resolveTokenRoute(i: TokenRouteInput): TokenRoute {
    const pluginTokenizer = i.pluginTokenizer ?? 'none'
    if (i.aiModel === 'openrouter' || i.aiModel === 'reverse_proxy') {
        return { kind: 'local', tokenizer: sharedSelectorTokenizer(i.customTokenizer) ?? 'o200k_base' }
    }
    if (i.aiModel === 'custom' && pluginTokenizer) {
        if (pluginTokenizer === 'o200k_base' || pluginTokenizer === 'cl100k_base') {
            return { kind: 'local', tokenizer: pluginTokenizer }
        }
        if (pluginTokenizer === 'custom') {
            return i.hasPluginTokenizerFunc
                ? { kind: 'local', tokenizer: 'plugin' }
                : { kind: 'unavailable', reason: 'plugin-tokenizer-missing' }
        }
        return { kind: 'local', tokenizer: sharedSelectorTokenizer(pluginTokenizer) ?? 'o200k_base' }
    }
    return modelRoute(i.modelTokenizer, i.googleClaudeTokenizing)
}

/** Counts with the tokenizer of the currently selected model. Reads settings; writes none. */
export function createAppTokenCounter(): { count(text: string): Promise<TokenResult> } {
    return createTokenCounter({
        encode: (text) => encode(text),
        modelName: () => getModelInfo(getDatabase().aiModel).name,
        route: () => {
            const db = getDatabase()
            const provider = pluginV2.providerOptions.get(db.currentPluginProvider)
            return resolveTokenRoute({
                aiModel: db.aiModel,
                customTokenizer: db.customTokenizer,
                pluginTokenizer: provider?.tokenizer,
                hasPluginTokenizerFunc: typeof provider?.tokenizerFunc === 'function',
                modelTokenizer: getModelInfo(db.aiModel).tokenizer,
                googleClaudeTokenizing: db.googleClaudeTokenizing,
            })
        },
    })
}

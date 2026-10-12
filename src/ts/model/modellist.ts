import { getDatabase } from "../storage/database.svelte"
import {
    LLMFlags,
    LLMProvider,
    LLMFormat,
    LLMTokenizer,
    ProviderNames,
    OpenAIParameters,
    ClaudeParameters,
    type LLMModel,
    GPT5XHighParameters
} from './types'
import { OpenAIModels } from './providers/openai'
import { AnthropicModels } from './providers/anthropic'
import { GoogleModels } from './providers/google'
import { fetchNative } from "../globalApi.svelte"
import { resolveSecret } from "../secretRef"
import { DBState } from "../stores.svelte"
import { customProviderStore, pluginV2 } from "../plugins/plugins.svelte"
import { get } from "svelte/store"
import { customV3ProviderMetaStore } from "../plugins/apiV3/v3.svelte"
import { isHiddenFromPicker, modelIdStatus } from "./modelStatus"
import { getListedAddedModels, registerCatalog, resolveAdded, seedProviderLists, setProviderList } from "./modelData/addedModels.svelte"
import type { AddedFamily } from "./modelData/addedModelsData"
import type { TaskOutcome } from "./modelData/modelDataService.svelte"
import { PROVIDER_LIST_MAX_PAGES, appendListPage, parseProviderListPage, type ProviderListItem } from "./modelData/providerListData"

// Re-export types for backwards compatibility
export { LLMFlags, LLMProvider, LLMFormat, LLMTokenizer, ProviderNames, OpenAIParameters, ClaudeParameters }
export type { LLMModel }

function makeDeepInfraModels(id:string[]):LLMModel[]{
    return id.map((id) => {
        return {
            id: 'deepinfra_' + id,
            name: id,
            internalID: id,
            provider: LLMProvider.DeepInfra,
            format: LLMFormat.OpenAICompatible,
            parameters: ['frequency_penalty', 'presence_penalty', 'temperature', 'top_p'],
            flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput, LLMFlags.hasPrefill, LLMFlags.deepSeekThinkingOutput, LLMFlags.hasStreaming],
            tokenizer: LLMTokenizer.DeepSeek,
            endpoint: 'https://api.deepinfra.com/v1/openai/chat/completions',
            keyIdentifier: 'deepinfra',
            recommended: true
        } as LLMModel
    })
}

export const LLMModels: LLMModel[] = [
    ...OpenAIModels,
    ...AnthropicModels,
    // AWS Bedrock Claude models
    {
        name: "Claude 4.6 Opus v1",
        id: 'anthropic.claude-opus-4-6-v1',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [
            LLMFlags.hasPrefill, // actually it doesn't, but leaving it for compatibility
            LLMFlags.hasImageInput,
            LLMFlags.hasFirstSystemPrompt,
            LLMFlags.claudeThinking
        ],
        parameters: [...ClaudeParameters, 'thinking_tokens'],
        tokenizer: LLMTokenizer.Claude,
    },
    {
        name: "Claude 4.5 Opus (20251101) v1",
        id: 'anthropic.claude-opus-4-5-20251101-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [
            LLMFlags.hasPrefill,
            LLMFlags.hasImageInput,
            LLMFlags.hasFirstSystemPrompt,
            LLMFlags.claudeThinking
        ],
        parameters: [...ClaudeParameters, 'thinking_tokens'],
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 4.5 Sonnet (20250929) v1',
        id: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [
            LLMFlags.hasPrefill,
            LLMFlags.hasImageInput,
            LLMFlags.hasFirstSystemPrompt,
            LLMFlags.claudeThinking
        ],
        parameters: [...ClaudeParameters, 'thinking_tokens'],
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 4.1 Opus (20250805) v1',
        id: 'anthropic.claude-opus-4-1-20250805-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [
            LLMFlags.hasPrefill,
            LLMFlags.hasImageInput,
            LLMFlags.hasFirstSystemPrompt,
            LLMFlags.claudeThinking
        ],
        parameters: [...ClaudeParameters, 'thinking_tokens'],
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 4 Opus (20250514) v1',
        id: 'anthropic.claude-opus-4-20250514-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [
            LLMFlags.hasPrefill,
            LLMFlags.hasImageInput,
            LLMFlags.hasFirstSystemPrompt,
            LLMFlags.claudeThinking
        ],
        parameters: [...ClaudeParameters, 'thinking_tokens'],
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 4 Sonnet (20250514) v1',
        id: 'anthropic.claude-sonnet-4-20250514-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [
            LLMFlags.hasPrefill,
            LLMFlags.hasImageInput,
            LLMFlags.hasFirstSystemPrompt,
            LLMFlags.claudeThinking
        ],
        parameters: [...ClaudeParameters, 'thinking_tokens'],
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 3.7 Sonnet (20250219) v1',
        id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [
            LLMFlags.hasPrefill,
            LLMFlags.hasImageInput,
            LLMFlags.hasFirstSystemPrompt,
            LLMFlags.claudeThinking
        ],
        parameters: [...ClaudeParameters, 'thinking_tokens'],
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 3.5 Sonnet (20241022) v2',
        id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [LLMFlags.hasPrefill, LLMFlags.hasImageInput, LLMFlags.hasFirstSystemPrompt],
        parameters: ClaudeParameters,
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 3.5 Sonnet (20240620) v1',
        id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [LLMFlags.hasPrefill, LLMFlags.hasImageInput, LLMFlags.hasFirstSystemPrompt],
        parameters: ClaudeParameters,
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 3 Opus (20240229) v1',
        id: 'anthropic.claude-3-opus-20240229-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [LLMFlags.hasPrefill, LLMFlags.hasImageInput, LLMFlags.hasFirstSystemPrompt],
        parameters: ClaudeParameters,
        tokenizer: LLMTokenizer.Claude
    },
    {
        name: 'Claude 3 Sonnet (20240229) v1',
        id: 'anthropic.claude-3-sonnet-20240229-v1:0',
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: [
            LLMFlags.hasPrefill,
            LLMFlags.hasImageInput,
            LLMFlags.hasFirstSystemPrompt
        ],
        parameters: ClaudeParameters,
        tokenizer: LLMTokenizer.Claude
    },
    // Other providers
    {
        name: 'Ooba',
        id: 'ooba',
        provider: LLMProvider.AsIs,
        format: LLMFormat.Ooba,
        flags: [LLMFlags.hasFirstSystemPrompt],
        recommended: true,
        parameters: [],
        tokenizer: LLMTokenizer.Llama
    },
    {
        name: 'Mancer',
        id: 'mancer',
        provider: LLMProvider.AsIs,
        format: LLMFormat.OobaLegacy,
        flags: [LLMFlags.hasFirstSystemPrompt],
        parameters: [],
        tokenizer: LLMTokenizer.Llama
    },
    {
        name: 'OpenRouter',
        id: 'openrouter',
        provider: LLMProvider.AsIs,
        format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasFullSystemPrompt, LLMFlags.hasImageInput, LLMFlags.hasStreaming],
        parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'min_p', 'top_a', 'top_k'],
        recommended: true,
        tokenizer: LLMTokenizer.Unknown
    },
    // Mistral models
    {
        name: 'Mistral Small Latest',
        id: 'mistral-small-latest',
        shortName: 'Mistral S',
        provider: LLMProvider.Mistral,
        format: LLMFormat.Mistral,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.mustStartWithUserInput, LLMFlags.requiresAlternateRole],
        recommended: true,
        parameters: ['temperature', 'presence_penalty', 'frequency_penalty', 'top_p'],
        tokenizer: LLMTokenizer.Mistral
    },
    {
        name: 'Mistral Medium Latest',
        id: 'mistral-medium-latest',
        shortName: 'Mistral M',
        provider: LLMProvider.Mistral,
        format: LLMFormat.Mistral,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.mustStartWithUserInput, LLMFlags.requiresAlternateRole],
        recommended: true,
        parameters: ['temperature', 'presence_penalty', 'frequency_penalty', 'top_p'],
        tokenizer: LLMTokenizer.Mistral
    },
    {
        name: 'Mistral Large 2411',
        id: 'mistral-large-2411',
        shortName: 'Mistral L 2411',
        provider: LLMProvider.Mistral,
        format: LLMFormat.Mistral,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.mustStartWithUserInput, LLMFlags.requiresAlternateRole],
        parameters: ['temperature', 'presence_penalty', 'frequency_penalty', 'top_p'],
        tokenizer: LLMTokenizer.Mistral
    },
    {
        name: 'Mistral Nemo',
        id: 'open-mistral-nemo',
        shortName: 'Mistral Nemo',
        provider: LLMProvider.Mistral,
        format: LLMFormat.Mistral,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.mustStartWithUserInput, LLMFlags.requiresAlternateRole],
        parameters: ['temperature', 'presence_penalty', 'frequency_penalty', 'top_p'],
        tokenizer: LLMTokenizer.Mistral
    },
    {
        name: 'Mistral Large Latest',
        id: 'mistral-large-latest',
        shortName: 'Mistral L',
        provider: LLMProvider.Mistral,
        format: LLMFormat.Mistral,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.mustStartWithUserInput, LLMFlags.requiresAlternateRole],
        parameters: ['temperature', 'presence_penalty', 'frequency_penalty', 'top_p'],
        recommended: true,
        tokenizer: LLMTokenizer.Mistral
    },
    // Google models
    ...GoogleModels,
    // Kobold
    {
        name: 'Kobold',
        id: 'kobold',
        provider: LLMProvider.AsIs,
        format: LLMFormat.Kobold,
        flags: [LLMFlags.hasFirstSystemPrompt],
        recommended: true,
        parameters: [
            'temperature',
            'top_p',
            'repetition_penalty',
            'top_k',
            'top_a'
        ],
        tokenizer: LLMTokenizer.Unknown
    },
    // NovelList
    {
        name: "SuperTrin",
        id: 'novellist',
        provider: LLMProvider.NovelList,
        format: LLMFormat.NovelList,
        flags: [],
        parameters: [],
        tokenizer: LLMTokenizer.NovelList
    },
    {
        name: "Damsel",
        id: 'novellist_damsel',
        provider: LLMProvider.NovelList,
        format: LLMFormat.NovelList,
        flags: [],
        parameters: [],
        tokenizer: LLMTokenizer.NovelList
    },
    // Cohere
    {
        name: "Command R",
        id: 'cohere-command-r',
        internalID: 'command-r',
        provider: LLMProvider.Cohere,
        format: LLMFormat.Cohere,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput],
        recommended: true,
        parameters: [
            'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
        ],
        tokenizer: LLMTokenizer.Cohere
    },
    {
        name: "Command R Plus",
        id: 'cohere-command-r-plus',
        internalID: 'command-r-plus',
        provider: LLMProvider.Cohere,
        format: LLMFormat.Cohere,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput],
        recommended: true,
        parameters: [
            'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
        ],
        tokenizer: LLMTokenizer.Cohere
    },
    {
        name: "Command R 08-2024",
        id: 'cohere-command-r-08-2024',
        internalID: 'command-r-08-2024',
        provider: LLMProvider.Cohere,
        format: LLMFormat.Cohere,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput],
        parameters: [
            'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
        ],
        tokenizer: LLMTokenizer.Cohere
    },
    {
        name: "Command R 03-2024",
        id: 'cohere-command-r-03-2024',
        internalID: 'command-r-03-2024',
        provider: LLMProvider.Cohere,
        format: LLMFormat.Cohere,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput],
        parameters: [
            'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
        ],
        tokenizer: LLMTokenizer.Cohere
    },
    {
        name: "Command R Plus 08-2024",
        id: 'cohere-command-r-plus-08-2024',
        internalID: 'command-r-plus-08-2024',
        provider: LLMProvider.Cohere,
        format: LLMFormat.Cohere,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput],
        parameters: [
            'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
        ],
        tokenizer: LLMTokenizer.Cohere
    },
    {
        name: "Command R Plus 04-2024",
        id: 'cohere-command-r-plus-04-2024',
        internalID: 'command-r-plus-04-2024',
        provider: LLMProvider.Cohere,
        format: LLMFormat.Cohere,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput],
        parameters: [
            'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
        ],
        tokenizer: LLMTokenizer.Cohere
    },
    // NovelAI
    {
        name: "Clio",
        id: 'novelai',
        provider: LLMProvider.NovelAI,
        format: LLMFormat.NovelAI,
        flags: [LLMFlags.hasFullSystemPrompt],
        recommended: true,
        parameters: [
            'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
        ],
        tokenizer: LLMTokenizer.NovelAI
    },
    {
        name: "Kayra",
        id: 'novelai_kayra',
        provider: LLMProvider.NovelAI,
        format: LLMFormat.NovelAI,
        flags: [LLMFlags.hasFullSystemPrompt],
        recommended: true,
        parameters: [
            'temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'
        ],
        tokenizer: LLMTokenizer.NovelAI
    },
    // Ollama
    {
        id: 'ollama-hosted',
        name: 'Local',
        fullName: 'Ollama Local',
        provider: LLMProvider.Ollama,
        format: LLMFormat.Ollama,
        flags: [LLMFlags.hasFullSystemPrompt, LLMFlags.hasStreaming],
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Unknown,
        recommended: true
    },
    {
        id: 'ollama-cloud',
        name: 'Cloud',
        fullName: 'Ollama Cloud',
        provider: LLMProvider.Ollama,
        format: LLMFormat.Ollama,
        flags: [LLMFlags.hasFullSystemPrompt, LLMFlags.hasStreaming],
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Unknown,
        recommended: true
    },
    // WebLLM
    {
        id: 'hf:::Xenova/opt-350m',
        name: 'opt-350m',
        provider: LLMProvider.WebLLM,
        format: LLMFormat.WebLLM,
        flags: [LLMFlags.hasFullSystemPrompt],
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Local
    },
    {
        id: 'hf:::Xenova/tiny-random-mistral',
        name: 'tiny-random-mistral',
        provider: LLMProvider.WebLLM,
        format: LLMFormat.WebLLM,
        flags: [LLMFlags.hasFullSystemPrompt],
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Local
    },
    {
        id: 'hf:::Xenova/gpt2-large-conversational',
        name: 'gpt2-large-conversational',
        provider: LLMProvider.WebLLM,
        format: LLMFormat.WebLLM,
        flags: [LLMFlags.hasFullSystemPrompt],
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Local
    },
    // DeepSeek
    {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        provider: LLMProvider.DeepSeek,
        format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput, LLMFlags.hasPrefill, LLMFlags.deepSeekPrefix, LLMFlags.deepSeekThinkingInput, LLMFlags.deepSeekThinkingOutput, LLMFlags.deepSeekThinkingToggle, LLMFlags.hasStreaming],
        parameters: ['frequency_penalty', 'presence_penalty', 'temperature', 'top_p'],
        tokenizer: LLMTokenizer.DeepSeekV4,
        endpoint: 'https://api.deepseek.com/beta/chat/completions',
        keyIdentifier: 'deepseek',
        recommended: true
    },
    {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        provider: LLMProvider.DeepSeek,
        format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput, LLMFlags.hasPrefill, LLMFlags.deepSeekPrefix, LLMFlags.deepSeekThinkingInput, LLMFlags.deepSeekThinkingOutput, LLMFlags.deepSeekThinkingToggle, LLMFlags.hasStreaming],
        parameters: ['frequency_penalty', 'presence_penalty', 'temperature', 'top_p'],
        tokenizer: LLMTokenizer.DeepSeekV4,
        endpoint: 'https://api.deepseek.com/beta/chat/completions',
        keyIdentifier: 'deepseek',
        recommended: true
    },
    {
        id: 'deepseek-reasoner',
        name: 'Deepseek Reasoner',
        provider: LLMProvider.DeepSeek,
        format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput, LLMFlags.hasPrefill, LLMFlags.deepSeekPrefix, LLMFlags.deepSeekThinkingInput, LLMFlags.deepSeekThinkingOutput, LLMFlags.hasStreaming],
        parameters: [],
        tokenizer: LLMTokenizer.DeepSeek,
        endpoint: 'https://api.deepseek.com/beta/chat/completions',
        keyIdentifier: 'deepseek'
    },
    {
        id: 'deepseek-chat',
        name: 'Deepseek Chat',
        provider: LLMProvider.DeepSeek,
        format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput, LLMFlags.hasPrefill, LLMFlags.deepSeekPrefix, LLMFlags.hasStreaming],
        parameters: ['frequency_penalty', 'presence_penalty', 'temperature', 'top_p'],
        tokenizer: LLMTokenizer.DeepSeek,
        endpoint: 'https://api.deepseek.com/beta/chat/completions',
        keyIdentifier: 'deepseek'
    },
    // DeepInfra
    ...makeDeepInfraModels([
        'deepseek-ai/DeepSeek-R1',
        'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
        'deepseek-ai/DeepSeek-V3',
        'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        'meta-llama/Llama-3.3-70B-Instruct',
        'microsoft/phi-4',
        'meta-llama/Meta-Llama-3.1-70B-Instruct',
        'meta-llama/Meta-Llama-3.1-8B-Instruct',
        'meta-llama/Meta-Llama-3.1-405B-Instruct',
        'Qwen/QwQ-32B-Preview',
        'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
        'Qwen/Qwen2.5-Coder-32B-Instruct',
        'nvidia/Llama-3.1-Nemotron-70B-Instruct',
        'Qwen/Qwen2.5-72B-Instruct',
        'meta-llama/Llama-3.2-90B-Vision-Instruct',
        'meta-llama/Llama-3.2-11B-Vision-Instruct',
        'microsoft/WizardLM-2-8x22B',
        '01-ai/Yi-34B-Chat',
        'Austism/chronos-hermes-13b-v2',
        'Gryphe/MythoMax-L2-13b',
        'Gryphe/MythoMax-L2-13b-turbo',
        'Sao10K/L3.3-70B-Euryale-v2.3',
        'Sao10K/L3.1-70B-Euryale-v2.2',
        'Sao10K/L3-70B-Euryale-v2.1',
        'google/gemma-2-27b-it',
        'google/gemma-2-9b-it'
    ]),
    // NanoGPT — single provider entry; model list fetched on demand via getNanoGPTModels()
    {
        id: 'nanogpt',
        name: 'NanoGPT',
        fullName: 'NanoGPT',
        provider: LLMProvider.NanoGPT,
        format: LLMFormat.NanoGPT,
        flags: [LLMFlags.hasFullSystemPrompt, LLMFlags.hasImageInput, LLMFlags.hasStreaming, LLMFlags.OAICompletionTokens],
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Unknown,
        recommended: true,
    },
    // Plugin and Custom API
    {
        id: 'custom',
        name: "Plugin Legacy",
        provider: LLMProvider.AsIs,
        format: LLMFormat.Plugin,
        flags: [LLMFlags.hasFullSystemPrompt],
        parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'min_p', 'top_a', 'top_k', 'thinking_tokens'],
        tokenizer: LLMTokenizer.Unknown
    },
    {
        id: 'reverse_proxy',
        name: "Custom API",
        provider: LLMProvider.AsIs,
        format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasFullSystemPrompt, LLMFlags.hasStreaming],
        recommended: true,
        parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'min_p', 'top_a', 'top_k', 'thinking_tokens'],
        tokenizer: LLMTokenizer.Unknown
    },
    {
        id: 'echo_model',
        name: "Echo",
        provider: LLMProvider.Echo,
        format: LLMFormat.Echo,
        flags: [LLMFlags.hasFullSystemPrompt],
        recommended: false,
        parameters: [],
        tokenizer: LLMTokenizer.Unknown
    },
]

for(let model of LLMModels){
    model.shortName ??= model.name
    model.internalID ??= model.id
    model.fullName ??= model.provider !== LLMProvider.AsIs ? `${ProviderNames.get(model.provider) ?? ''} ${model.name}`.trim() : model.name
}

for(let i=0; i<LLMModels.length; i++){
    if(LLMModels[i].provider === LLMProvider.OpenAI && LLMModels[i].format === LLMFormat.OpenAICompatible){
        LLMModels.push({
            ...LLMModels[i],
            format: LLMFormat.OpenAIResponseAPI,
            flags: [...LLMModels[i].flags, LLMFlags.hasPrefill],
            id: `${LLMModels[i].id}-response-api`,
            name: `${LLMModels[i].name} (Response API)`,
            fullName: `${LLMModels[i].fullName ?? LLMModels[i].name} (Response API)`,
            recommended: false

        })
    }
    if(LLMModels[i].provider === LLMProvider.GoogleCloud){
        LLMModels.push({
            ...LLMModels[i],
            id: `${LLMModels[i].id}-vertex`,
            name: `${LLMModels[i].name} Vertex`,
            fullName: `${LLMModels[i].fullName ?? LLMModels[i].name} Vertex`,
            flags: [...LLMModels[i].flags],
            recommended: !!LLMModels[i].recommended,
            provider: LLMProvider.VertexAI,
            format: LLMFormat.VertexAIGemini
        })
    }
}

registerCatalog(() => LLMModels)

/**
 * Hands the registry option and the registry's saved-list seed to the model data service.
 * The service loads its saved files whatever the option says and fetches only when it is on.
 * The dynamic import keeps the page store out of every module graph that loads this file
 * without calling registerModelDynamic. Nothing here can throw or reject, and nothing awaits
 * it, so the provider fetches below are neither delayed nor ordered by it.
 */
function startModelData(autoRefresh:boolean){
    void import('./modelData/modelDataStore')
        .then(m => m.startModelData(autoRefresh, seedProviderLists))
        .catch(error => console.error('Model data', error))
}

const LIST_FAMILIES: readonly AddedFamily[] = ['google', 'anthropic', 'openai']

const LIST_LABELS: Readonly<Record<AddedFamily, { log: string, failure: string }>> = {
    google: { log: 'Google models response', failure: 'Error fetching Google models' },
    anthropic: { log: 'Anthropic models response', failure: 'Error fetching Anthropic models' },
    openai: { log: 'OpenAI models response', failure: 'Error fetching OpenAI models' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read when the family's turn comes, so a key changed mid-pass is the one used. */
function listKeyOf(family: AddedFamily): string {
    switch(family){
        case 'google':
            return DBState.db.google.accessToken
        case 'anthropic':
            return DBState.db.claudeAPIKey
        case 'openai':
            return DBState.db.openAIKey
    }
}

async function fetchListPage(family: AddedFamily, key: string, cursor: string | undefined): Promise<unknown> {
    let res: Response
    if(family === 'google'){
        const paging = cursor === undefined ? '' : `&pageToken=${encodeURIComponent(cursor)}`
        res = await fetchNative(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1000${paging}`, {
            method: 'GET',
        })
    }
    else if(family === 'anthropic'){
        const paging = cursor === undefined ? '' : `&after_id=${encodeURIComponent(cursor)}`
        res = await fetchNative(`https://api.anthropic.com/v1/models?limit=1000${paging}`, {
            method: 'GET',
            headers: {
                'anthropic-version': '2023-06-01',
                "x-api-key": key,
            }
        })
    }
    else{
        res = await fetchNative(`https://api.openai.com/v1/models`, {
            method: 'GET',
            headers: {
                "Authorization": 'Bearer ' + key
            }
        })
    }
    if(!res.ok){
        throw new Error(`The ${family} model list request failed with status ${res.status}`)
    }
    const json = await res.json()
    console.log(LIST_LABELS[family].log, json)
    return json
}

/** The cursor of the next page, or undefined on the last one. Field names are from the providers' API docs. */
function nextListCursor(family: AddedFamily, json: unknown): string | undefined {
    if(!isRecord(json)){
        return undefined
    }
    if(family === 'google'){
        return typeof json.nextPageToken === 'string' && json.nextPageToken !== '' ? json.nextPageToken : undefined
    }
    if(family === 'anthropic' && json.has_more === true){
        if(typeof json.last_id === 'string' && json.last_id !== ''){
            return json.last_id
        }
        throw new Error('The anthropic model list has more pages but names no last_id')
    }
    return undefined
}

/**
 * Every page of one family's list: at most PROVIDER_LIST_MAX_PAGES pages and the cumulative
 * item cap. A failing page, the page cap or the item cap throws, so nothing of an earlier
 * page is applied. Null when the option went off before a request; the option is checked
 * before every page.
 */
async function fetchFamilyList(family: AddedFamily, key: string, isRegistryOn: () => boolean): Promise<ProviderListItem[] | null> {
    let items: ProviderListItem[] = []
    let cursor: string | undefined
    for(let page = 0; page < PROVIDER_LIST_MAX_PAGES; page++){
        if(!isRegistryOn()){
            return null
        }
        const json = await fetchListPage(family, key, cursor)
        const parsed = parseProviderListPage(family, json)
        if(parsed === null){
            throw new Error(`The ${family} model list response is invalid or holds too many models`)
        }
        const merged = appendListPage(items, parsed)
        if(merged === null){
            throw new Error(`The ${family} model list holds too many models`)
        }
        items = merged
        cursor = nextListCursor(family, json)
        if(cursor === undefined){
            return items
        }
    }
    throw new Error(`The ${family} model list has more than ${PROVIDER_LIST_MAX_PAGES} pages`)
}

/**
 * Saving is fire-and-forget and runs after the live list reached the registry, so a store
 * that cannot be imported or written costs the saved copy only. An empty list is never saved.
 */
function persistProviderList(family: AddedFamily, items: ProviderListItem[]){
    if(items.length === 0){
        return
    }
    void import('./modelData/modelDataStore')
        .then(m => m.saveProviderLists(family, { fetchedAt: Date.now(), items }))
        .catch(error => console.error('Model data', error))
}

async function refreshFamilyList(family: AddedFamily, isRegistryOn: () => boolean): Promise<TaskOutcome> {
    try {
        if(!isRegistryOn()){
            return 'skipped'
        }
        const keyValue = listKeyOf(family)
        if(!keyValue){
            return 'skipped'
        }
        const items = await fetchFamilyList(family, await resolveSecret(keyValue), isRegistryOn)
        if(items === null){
            return 'skipped'
        }
        // A request that succeeded with nothing usable never empties the family: its current list stays.
        if(items.length > 0){
            setProviderList(family, items)
            persistProviderList(family, items)
        }
        return 'ok'
    } catch (error) {
        console.error(LIST_LABELS[family].failure, error)
        return 'failed'
    }
}

async function runListPass(isRegistryOn: () => boolean): Promise<TaskOutcome> {
    const outcomes: TaskOutcome[] = []
    for(const family of LIST_FAMILIES){
        outcomes.push(await refreshFamilyList(family, isRegistryOn))
    }
    const attempted = outcomes.filter(outcome => outcome !== 'skipped')
    if(attempted.length === 0){
        return 'skipped'
    }
    return attempted.every(outcome => outcome === 'ok') ? 'ok' : 'failed'
}

let listPassInFlight: Promise<TaskOutcome> | null = null

/**
 * Fetches the model lists of Google, Anthropic and OpenAI for the families that have a key,
 * one family after another, and hands each successful list to the registry. `isRegistryOn`
 * is checked before each family and before each page. A missing key skips its family (no
 * request, nothing written); a failed family keeps its current live or saved list. The
 * outcome is `ok` when every attempted family succeeded, `failed` when any failed and
 * `skipped` when none was attempted. One pass runs at a time: a caller arriving while it
 * runs shares it, so boot and the Refresh button never double the requests.
 */
export function refreshProviderLists(isRegistryOn: () => boolean): Promise<TaskOutcome> {
    if(listPassInFlight === null){
        listPassInFlight = runListPass(isRegistryOn).finally(() => { listPassInFlight = null })
    }
    return listPassInFlight
}

export async function registerModelDynamic(){

    startModelData(!!DBState.db.dynamicModelRegistry)
    if(!DBState.db.dynamicModelRegistry){
        return
    }
    await refreshProviderLists(() => !!DBState.db.dynamicModelRegistry)
}
//testing purpose only, not used in production
globalThis.registerModelDynamic = registerModelDynamic

/** A resolved entry is a copy, because callers change it, and takes the user's custom flags when that override is on. */
function withUserFlags(model: LLMModel, db: ReturnType<typeof getDatabase>): LLMModel{
    const copy:LLMModel = safeStructuredClone(model)
    if(db.enableCustomFlags){
        copy.flags = db.customFlags
    }
    return copy
}

export function getModelInfo(id?: string | null): LLMModel{

    const db = getDatabase()
    if(!id){
        return {
            id: '',
            name: 'Unknown',
            shortName: 'Unknown',
            fullName: 'Unknown',
            internalID: '',
            provider: LLMProvider.AsIs,
            format: LLMFormat.OpenAICompatible,
            flags: [],
            parameters: OpenAIParameters,
            tokenizer: LLMTokenizer.Unknown
        }
    }
    const catalogEntry = LLMModels.find(model => model.id === id)

    if(catalogEntry){
        return withUserFlags(catalogEntry, db)
    }

    if(id.startsWith('hf:::')){
        const withoutPrefix = id.replace('hf:::', '')
        return {
            id,
            name: withoutPrefix,
            shortName: withoutPrefix,
            fullName: withoutPrefix,
            internalID: withoutPrefix,
            provider: LLMProvider.WebLLM,
            format: LLMFormat.WebLLM,
            flags: [],
            parameters: OpenAIParameters,
            tokenizer: LLMTokenizer.Local
        }
    }
    if(id.startsWith('horde:::')){
        const withoutPrefix = id.replace('horde:::', '')
        return {
            id,
            name: withoutPrefix,
            shortName: withoutPrefix,
            fullName: withoutPrefix,
            internalID: withoutPrefix,
            provider: LLMProvider.Horde,
            format: LLMFormat.Horde,
            flags: [],
            parameters: OpenAIParameters,
            tokenizer: LLMTokenizer.Unknown
        }
    }
    if(id.startsWith('xcustom:::')){
        const customModels = db?.customModels || []
        const found = customModels.find((model) => model.id === id)
        if(found){
            return {
                id: found.id,
                name: found.name,
                shortName: found.name,
                fullName: found.name,
                internalID: found.internalId,
                provider: LLMProvider.AsIs,
                format: found.format,
                flags: found.flags,
                parameters: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'min_p', 'top_a', 'top_k', 'thinking_tokens'],
                tokenizer: found.tokenizer
            }
        }
    }

    if(id.startsWith('pluginmodel:::')){
        const pluginModel = customV3ProviderMetaStore.find(model => model.id === id)
        if(pluginModel){
            return pluginModel
        }
    }

    const added = resolveAdded(id)
    if(added){
        return withUserFlags(added, db)
    }

    return {
        id,
        name: id,
        shortName: id,
        fullName: id,
        internalID: id,
        provider: LLMProvider.AsIs,
        format: LLMFormat.OpenAICompatible,
        flags: [],
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Unknown
    }
}

interface GetModelListGroup {
    providerName: string
    models: LLMModel[]
}

export function getModelList<T extends boolean>(arg:{
    recommendedOnly?:boolean,
    groupedByProvider?:T,
    includeHidden?:boolean
} = {}): T extends true ? GetModelListGroup[] : LLMModel[]{
    let models = [...LLMModels, ...getListedAddedModels()].filter(model => arg.includeHidden || !isHiddenFromPicker(modelIdStatus(model.id)))
    if(arg.recommendedOnly){
         models = models.filter(model => model.recommended)
    }
    const pluginGroup: GetModelListGroup = {
        providerName: 'Plugins',
        models: customV3ProviderMetaStore
    }

    if(arg.groupedByProvider){
        let group: GetModelListGroup[] = []
        for(let model of models){
            if(model.provider === LLMProvider.AsIs || model.provider === LLMProvider.NanoGPT){
                group.push({
                    providerName: '@as-is',
                    models: [model]
                })
                continue
            }

            let providerName = ProviderNames.get(model.provider) || 'Unknown'
            let groupIndex = group.findIndex(g => g.providerName === providerName)
            if(groupIndex === -1){
                group.push({
                    providerName,
                    models: [model]
                })
            }else{
                group[groupIndex].models.push(model)
            }
        }

        if(pluginGroup.models.length > 0){
            group.push(pluginGroup)
        }
        return group as any
    }
    else{
        for(const model of pluginGroup.models){
            models.push(model)
        }
    }

    return models as any
}

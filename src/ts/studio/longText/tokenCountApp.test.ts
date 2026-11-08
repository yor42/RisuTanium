// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LLMTokenizer } from '../../model/types'
import type { TokenRoute } from './tokenCount'

const state = vi.hoisted(() => ({
    db: {
        aiModel: 'gpt',
        customTokenizer: 'tik',
        currentPluginProvider: '',
        googleClaudeTokenizing: false,
    },
    modelTokenizer: 0 as number,
    modelName: 'Model X',
    providers: new Map<string, { tokenizer?: string; tokenizerFunc?: (content: string) => number[] }>(),
    encode: vi.fn<(text: string) => Promise<number[]>>(),
    writes: vi.fn(),
}))

vi.mock('../../tokenizer', () => ({ encode: (text: string) => state.encode(text) }))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => state.db,
    setDatabase: state.writes,
}))
vi.mock('../../plugins/plugins.svelte', () => ({ pluginV2: { providerOptions: state.providers } }))
vi.mock('../../model/modellist', () => ({
    getModelInfo: () => ({ name: state.modelName, tokenizer: state.modelTokenizer }),
}))

import { createAppTokenCounter, resolveTokenRoute, type TokenRouteInput } from './tokenCountApp'

function input(overrides: Partial<TokenRouteInput>): TokenRouteInput {
    return {
        aiModel: 'gpt',
        customTokenizer: 'tik',
        pluginTokenizer: undefined,
        hasPluginTokenizerFunc: false,
        modelTokenizer: LLMTokenizer.Unknown,
        googleClaudeTokenizing: false,
        ...overrides,
    }
}
const local = (tokenizer: Extract<TokenRoute, { kind: 'local' }>['tokenizer']): TokenRoute => ({ kind: 'local', tokenizer })

describe('A2-u4 resolveTokenRoute', () => {
    test('proxy models map customTokenizer', () => {
        for (const aiModel of ['openrouter', 'reverse_proxy']) {
            const expected: Record<string, TokenRoute> = {
                mistral: local('mistral'), llama: local('llama'), novelai: local('novelai'), claude: local('claude'),
                novellist: local('novellist'), gemma: local('gemma'), cohere: local('cohere'), deepseek: local('deepseek'),
                'deepseek-v4': local('deepseek-v4'), glm4: local('glm4'), glm5: local('glm5'),
                llama3: local('llama'), tik: local('o200k_base'), '': local('o200k_base'), unknown: local('o200k_base'),
            }
            for (const [customTokenizer, route] of Object.entries(expected)) {
                expect(resolveTokenRoute(input({ aiModel, customTokenizer, modelTokenizer: LLMTokenizer.Claude }))).toEqual(route)
            }
        }
    })

    test('custom plugin models map the plugin tokenizer', () => {
        const expected: Record<string, TokenRoute> = {
            mistral: local('mistral'), llama: local('llama'), novelai: local('novelai'), claude: local('claude'),
            novellist: local('novellist'), gemma: local('gemma'), cohere: local('cohere'), deepseek: local('deepseek'),
            'deepseek-v4': local('deepseek-v4'), glm4: local('glm4'), glm5: local('glm5'),
            llama3: local('llama'), o200k_base: local('o200k_base'), cl100k_base: local('cl100k_base'),
            none: local('o200k_base'), whatever: local('o200k_base'),
        }
        for (const [pluginTokenizer, route] of Object.entries(expected)) {
            expect(resolveTokenRoute(input({ aiModel: 'custom', pluginTokenizer, modelTokenizer: LLMTokenizer.Gemma }))).toEqual(route)
        }
    })

    test('plugin custom depends on the tokenizer function', () => {
        expect(resolveTokenRoute(input({ aiModel: 'custom', pluginTokenizer: 'custom', hasPluginTokenizerFunc: true })))
            .toEqual(local('plugin'))
        expect(resolveTokenRoute(input({ aiModel: 'custom', pluginTokenizer: 'custom', hasPluginTokenizerFunc: false })))
            .toEqual({ kind: 'unavailable', reason: 'plugin-tokenizer-missing' })
    })

    test('an absent provider counts as none, an empty plugin tokenizer falls through to the model', () => {
        expect(resolveTokenRoute(input({ aiModel: 'custom', pluginTokenizer: undefined, modelTokenizer: LLMTokenizer.Claude })))
            .toEqual(local('o200k_base'))
        expect(resolveTokenRoute(input({ aiModel: 'custom', pluginTokenizer: '', modelTokenizer: LLMTokenizer.Claude })))
            .toEqual(local('claude'))
    })

    test('every model tokenizer value, with the Google flag on and off', () => {
        const table: Array<[LLMTokenizer, TokenRoute, TokenRoute]> = [
            [LLMTokenizer.Unknown, local('cl100k_base'), local('cl100k_base')],
            [LLMTokenizer.tiktokenCl100kBase, local('cl100k_base'), local('cl100k_base')],
            [LLMTokenizer.tiktokenO200Base, local('o200k_base'), local('o200k_base')],
            [LLMTokenizer.Mistral, local('mistral'), local('mistral')],
            [LLMTokenizer.Llama, local('llama'), local('llama')],
            [LLMTokenizer.NovelAI, local('novelai'), local('novelai')],
            [LLMTokenizer.Claude, local('claude'), local('claude')],
            [LLMTokenizer.NovelList, local('novellist'), local('novellist')],
            [LLMTokenizer.Llama3, local('cl100k_base'), local('cl100k_base')],
            [LLMTokenizer.Gemma, local('gemma'), local('gemma')],
            [LLMTokenizer.GoogleCloud, local('gemma'), { kind: 'online-only' }],
            [LLMTokenizer.Cohere, local('cohere'), local('cohere')],
            [LLMTokenizer.Local, local('gguf'), local('gguf')],
            [LLMTokenizer.DeepSeek, local('deepseek'), local('deepseek')],
            [LLMTokenizer.DeepSeekV4, local('deepseek-v4'), local('deepseek-v4')],
            [LLMTokenizer.GLM4, local('glm4'), local('glm4')],
            [LLMTokenizer.GLM5, local('glm5'), local('glm5')],
        ]
        expect(table.length).toBe(Object.keys(LLMTokenizer).length)
        for (const [modelTokenizer, flagOff, flagOn] of table) {
            expect(resolveTokenRoute(input({ modelTokenizer, googleClaudeTokenizing: false }))).toEqual(flagOff)
            expect(resolveTokenRoute(input({ modelTokenizer, googleClaudeTokenizing: true }))).toEqual(flagOn)
        }
    })
})

describe('A2-u6 createAppTokenCounter wiring', () => {
    beforeEach(() => {
        state.db.aiModel = 'gpt'
        state.db.customTokenizer = 'tik'
        state.db.currentPluginProvider = ''
        state.db.googleClaudeTokenizing = false
        state.modelTokenizer = LLMTokenizer.Claude
        state.modelName = 'Model X'
        state.providers.clear()
        state.encode.mockReset()
        state.writes.mockReset()
    })

    test('a local route counts with the mocked encode and names the model', async () => {
        state.encode.mockResolvedValue([1, 2, 3])
        const result = await createAppTokenCounter().count('hello')
        expect(result).toEqual({ kind: 'app-count', count: 3, tokenizer: 'claude', model: 'Model X' })
        expect(state.encode).toHaveBeenCalledWith('hello')
        expect(state.writes).not.toHaveBeenCalled()
    })

    test('route inputs come from the database and the provider map', async () => {
        state.encode.mockResolvedValue([1])
        state.db.aiModel = 'custom'
        state.db.currentPluginProvider = 'prov'
        state.providers.set('prov', { tokenizer: 'custom', tokenizerFunc: () => [1] })
        expect(await createAppTokenCounter().count('x')).toMatchObject({ kind: 'app-count', tokenizer: 'plugin' })

        state.providers.set('prov', { tokenizer: 'custom' })
        state.encode.mockClear()
        expect(await createAppTokenCounter().count('x')).toMatchObject({ kind: 'estimate', reason: 'unavailable' })
        expect(state.encode).not.toHaveBeenCalled()
    })

    test('Google Cloud with the network flag is an estimate and encode is not called', async () => {
        state.modelTokenizer = LLMTokenizer.GoogleCloud
        state.db.googleClaudeTokenizing = true
        const result = await createAppTokenCounter().count('hello')
        expect(result).toMatchObject({ kind: 'estimate', reason: 'online-only' })
        expect(state.encode).not.toHaveBeenCalled()
    })

    test('a throwing encode gives an error estimate, not a count', async () => {
        state.encode.mockRejectedValue(new Error('boom'))
        const result = await createAppTokenCounter().count('hello')
        expect(result).toMatchObject({ kind: 'estimate', reason: 'error', model: 'Model X' })
    })
})

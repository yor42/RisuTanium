// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { LLMTokenizer } from '../../model/types'
import type { TokenRoute } from './tokenCount'

// Differential harness: the real `encode` runs against mocked tokenizer
// libraries that stamp their source at construction, and the source that
// actually ran is compared with `resolveTokenRoute`. No request leaves the
// process: every fetch is answered by a stub, and unknown URLs reject.
const state = vi.hoisted(() => ({
    db: {
        aiModel: 'gpt',
        customTokenizer: 'tik',
        currentPluginProvider: 'prov',
        googleClaudeTokenizing: false,
        useTokenizerCaching: false,
        google: { accessToken: 'synthetic' },
    },
    modelTokenizer: 0 as number,
    providers: new Map<string, { tokenizer?: string; tokenizerFunc?: (content: string) => number[] }>(),
    recorded: [] as string[],
    urls: [] as string[],
}))

vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => state.db,
    getCurrentCharacter: () => undefined,
}))
vi.mock('../../process/files/inlays', () => ({ supportsInlayImage: () => false }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../process/models/local', () => ({
    tokenizeGGUFModel: async () => {
        state.recorded.push('gguf')
        return [1]
    },
}))
vi.mock('../../globalApi.svelte', () => ({
    globalFetch: async () => {
        throw new Error('globalFetch must not be reached')
    },
}))
vi.mock('../../model/modellist', async () => {
    const actual = await vi.importActual<typeof import('../../model/types')>('../../model/types')
    return {
        LLMTokenizer: actual.LLMTokenizer,
        getModelInfo: () => ({ name: 'Model X', internalID: 'model-x', tokenizer: state.modelTokenizer }),
    }
})
vi.mock('../../plugins/plugins.svelte', () => ({ pluginV2: { providerOptions: state.providers } }))
vi.mock('../../secretRef', () => ({ resolveSecret: async (value: string) => value }))
vi.mock('@mlc-ai/web-tokenizers', () => {
    class StampedTokenizer {
        constructor(public source: string) { }
        encode() {
            state.recorded.push(this.source)
            return [1]
        }
    }
    const fromBuffer = async (buffer: ArrayBuffer) => new StampedTokenizer(new TextDecoder().decode(buffer))
    return { Tokenizer: { fromJSON: fromBuffer, fromSentencePiece: fromBuffer } }
})
vi.mock('@dqbd/tiktoken', () => ({
    Tiktoken: class {
        source: string
        constructor(ranks: string) { this.source = ranks }
        free() { }
        encode() {
            state.recorded.push(this.source)
            return [1]
        }
    },
}))
vi.mock('@dqbd/tiktoken/encoders/cl100k_base.json', () => ({ bpe_ranks: 'cl100k_base', special_tokens: {}, pat_str: '' }))
vi.mock('src/etc/o200k_base.json', () => ({ bpe_ranks: 'o200k_base', special_tokens: {}, pat_str: '' }))
vi.mock('@huggingface/transformers', () => ({
    GemmaTokenizer: class {
        encode() {
            state.recorded.push('gemma')
            return [1]
        }
    },
}))

import { encode } from '../../tokenizer'
import { resolveTokenRoute } from './tokenCountApp'

// Each asset body is its tokenizer id, so a web tokenizer built from it stamps that id.
const sourceByAsset: Record<string, string> = {
    '/token/trin/spiece.model': 'novellist',
    '/token/claude/claude.json': 'claude',
    '/token/cohere/tokenizer.json': 'cohere',
    '/token/nai/nerdstash_v2.model': 'novelai',
    '/token/llama/llama.model': 'llama',
    '/token/mistral/tokenizer.model': 'mistral',
    '/token/gemma/tokenizer.model': 'gemma',
    '/token/deepseek/tokenizer.json': 'deepseek',
    '/token/deepseek/v4/tokenizer.json': 'deepseek-v4',
    '/token/glm4/tokenizer.json': 'glm4',
    '/token/glm5/tokenizer.json': 'glm5',
    '/token/llama/llama3.json': 'llama3',
}

function stubFetch(input: string | URL | Request): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    state.urls.push(url)
    const asset = sourceByAsset[url]
    if (asset !== undefined) {
        const body = new TextEncoder().encode(asset)
        return Promise.resolve({
            status: 200,
            json: async () => ({ asset }),
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        } as unknown as Response)
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        state.recorded.push('online-only')
        return Promise.resolve({ status: 200, json: async () => ({ totalTokens: 3 }) } as unknown as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
}

beforeAll(() => { vi.stubGlobal('fetch', stubFetch) })
afterAll(() => { vi.unstubAllGlobals() })

let caseNumber = 0
async function observedRoute(): Promise<string> {
    state.recorded.length = 0
    state.urls.length = 0
    const result = await encode(`differential case ${++caseNumber}`)
    if (state.recorded.includes('online-only')) return 'online-only'
    if (state.recorded.length === 0) {
        if (result.length === 1 && result[0] === 0) return 'unavailable'
        throw new Error('harness error: nothing recorded and no [0] result (cache hit?)')
    }
    return state.recorded[state.recorded.length - 1]
}

function expectedRoute(route: TokenRoute): string {
    return route.kind === 'local' ? route.tokenizer : route.kind
}

type Case = {
    label: string
    aiModel: string
    customTokenizer: string
    pluginTokenizer: string | undefined
    withFunc: boolean
    modelTokenizer: number
    flag: boolean
}

const sharedIds = ['mistral', 'llama', 'novelai', 'claude', 'novellist', 'gemma', 'cohere', 'deepseek', 'deepseek-v4', 'glm4', 'glm5', 'llama3']
const modelTokenizers = Object.values(LLMTokenizer) as number[]

function buildCases(): Case[] {
    const cases: Case[] = []
    const base = { customTokenizer: 'tik', pluginTokenizer: undefined, withFunc: false, modelTokenizer: LLMTokenizer.Claude as number, flag: false }
    for (const aiModel of ['openrouter', 'reverse_proxy']) {
        for (const customTokenizer of [...sharedIds, 'tik', '', 'other']) {
            cases.push({ ...base, label: `${aiModel}/${customTokenizer}`, aiModel, customTokenizer })
        }
    }
    const pluginValues: Array<[string | undefined, boolean]> = [
        [undefined, false], ['none', false], ['bogus', false], ['o200k_base', false], ['cl100k_base', false],
        ...sharedIds.map((id): [string, boolean] => [id, false]),
        ['custom', true], ['custom', false],
    ]
    for (const [pluginTokenizer, withFunc] of pluginValues) {
        cases.push({ ...base, label: `custom/plugin=${pluginTokenizer}/func=${withFunc}`, aiModel: 'custom', pluginTokenizer, withFunc, modelTokenizer: LLMTokenizer.Gemma })
    }
    for (const aiModel of ['custom', 'gpt']) {
        for (const modelTokenizer of modelTokenizers) {
            for (const flag of [false, true]) {
                cases.push({
                    ...base,
                    label: `${aiModel}/model=${modelTokenizer}/flag=${flag}`,
                    aiModel,
                    pluginTokenizer: aiModel === 'custom' ? '' : undefined,
                    modelTokenizer,
                    flag,
                })
            }
        }
    }
    return cases
}

function applyCase(c: Case) {
    state.db.aiModel = c.aiModel
    state.db.customTokenizer = c.customTokenizer
    state.db.googleClaudeTokenizing = c.flag
    state.modelTokenizer = c.modelTokenizer
    state.providers.clear()
    if (c.pluginTokenizer !== undefined) {
        state.providers.set('prov', {
            tokenizer: c.pluginTokenizer,
            tokenizerFunc: c.withFunc ? () => { state.recorded.push('plugin'); return [1, 2] } : undefined,
        })
    }
}

describe('A2-d1 resolveTokenRoute equals what encode runs', () => {
    const cases = buildCases()
    const seen = new Set<string>()

    async function runCase(c: Case): Promise<{ route: TokenRoute; observed: string }> {
        applyCase(c)
        const route = resolveTokenRoute({
            aiModel: state.db.aiModel,
            customTokenizer: state.db.customTokenizer,
            pluginTokenizer: state.providers.get('prov')?.tokenizer,
            hasPluginTokenizerFunc: typeof state.providers.get('prov')?.tokenizerFunc === 'function',
            modelTokenizer: state.modelTokenizer as typeof LLMTokenizer[keyof typeof LLMTokenizer],
            googleClaudeTokenizing: state.db.googleClaudeTokenizing,
        })
        return { route, observed: await observedRoute() }
    }

    // The coverage set is built over every case here, so it does not depend on test order.
    beforeAll(async () => {
        for (const c of cases) seen.add((await runCase(c)).observed)
    })

    test.each(cases.map((c) => [c.label, c] as const))('%s', async (_label, c) => {
        const { route, observed } = await runCase(c)
        expect(observed).toBe(expectedRoute(route))
        for (const url of state.urls) {
            const allowed = url.startsWith('/token/') || url.includes('localhost:10026')
                || url.startsWith('https://generativelanguage.googleapis.com/')
            expect(allowed, url).toBe(true)
        }
    })

    test('the harness observed every kind of route', () => {
        for (const id of ['o200k_base', 'cl100k_base', 'mistral', 'llama', 'novelai', 'claude', 'novellist', 'gemma', 'cohere',
            'deepseek', 'deepseek-v4', 'glm4', 'glm5', 'gguf', 'plugin', 'online-only', 'unavailable']) {
            expect(seen.has(id), id).toBe(true)
        }
    })
})

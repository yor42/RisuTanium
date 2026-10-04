/**
 * A memory or embedding key that is a whole `${NAME}` reference is resolved when the request is
 * built: the resolved value lands in the Authorization header, the literal reference is never
 * sent, and nothing resolved is written to the database or to the memory data a path returns. A
 * reference that cannot be resolved sends no request and ends through that path's own failure
 * route. A value that is not a reference is sent exactly as typed.
 *
 * Drives the real SupaMemory summarizer, the HypaMemory V2 summarizer, `HypaProcesser`,
 * `HypaProcessorV2` and the Voyage contextual embedding provider. Mocked: the resolver
 * (`resolveSecret`), the transport (`globalFetch`), the database, the local embedding runtime and
 * the collaborators these paths import but the tests do not exercise. Nothing here says anything
 * about the native or server environment lookup.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that
 * must be preserved.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    calls: [] as Array<{ url: string, headers: Record<string, string>, body: string }>,
    resolved: 'SENTINEL-resolved-value',
    failResolve: false,
    completionOk: true,
    resolveCalls: [] as string[],
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) }) },
}))

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db }))

vi.mock('src/ts/globalApi.svelte', () => ({
    globalFetch: vi.fn(async (url: string, opts: { headers?: Record<string, string>, body?: { input?: unknown[], inputs?: unknown[] } }) => {
        h.calls.push({ url, headers: { ...(opts.headers ?? {}) }, body: JSON.stringify(opts.body ?? {}) })
        if (url.endsWith('/completions')) {
            if (!h.completionOk) { return { ok: false, data: { error: 'upstream refused' } } }
            return { ok: true, data: { choices: [{ text: 'a short summary' }] } }
        }
        if (url.includes('voyageai')) {
            return { ok: true, data: { data: [{ data: [{ embedding: [1, 0] }] }] } }
        }
        const input = Array.isArray(opts.body?.input) ? opts.body.input : [opts.body?.input]
        return { ok: true, data: { data: input.map(() => ({ embedding: [1, 0] })) } }
    }),
}))

vi.mock('src/ts/secretRef', async () => {
    const actual = await vi.importActual<typeof import('src/ts/secretRef')>('src/ts/secretRef')
    return {
        ...actual,
        resolveSecret: vi.fn(async (value: string) => {
            const name = actual.secretRefName(value)
            if (name === null) { return value }
            h.resolveCalls.push(name)
            if (h.failResolve) { throw new actual.SecretRefError(name, 'unavailable') }
            return h.resolved
        }),
    }
})

vi.mock('src/ts/process/transformers', () => ({ runEmbedding: vi.fn(async () => []), runSummarizer: vi.fn(async () => '') }))
vi.mock('../transformers', () => ({ runEmbedding: vi.fn(async () => []), runSummarizer: vi.fn(async () => '') }))
vi.mock('../request/request', () => ({ requestChatData: vi.fn(async () => ({ type: 'fail', result: 'unused' })) }))
vi.mock('src/ts/parser/chatML', () => ({ parseChatML: vi.fn(() => null) }))
vi.mock('src/ts/tokenizer', () => ({ tokenize: vi.fn(async (s: string) => s.length) }))
vi.mock('src/ts/platform', () => ({ isMobile: false, isTauri: false, isNodeServer: false }))
vi.mock('src/ts/util', () => ({
    appendLastPath: (url: string, path: string) => url.replace(/\/$/, '') + '/' + path,
    getUserName: () => 'User',
}))

import { supaMemory } from '../memory/supaMemory'
import { hypaMemoryV2 } from '../memory/hypav2'
import { HypaProcesser } from '../memory/hypamemory'
import { HypaProcessorV2 } from '../memory/hypamemoryv2'
import { getContextProvider } from '../memory/contextualEmbedding'
import type { OpenAIChat } from '../index.svelte'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { Chat, character } from 'src/ts/storage/database.svelte'

const REF = '${RISU_TEST_KEY}'

const tokenizer = { tokenizeChat: async () => 10 } as unknown as ChatTokenizer
const room = { supaMemoryData: '', hypaV2Data: undefined } as unknown as Chat
const char = { name: 'Char', type: 'character' } as unknown as character

function chats(count: number): OpenAIChat[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
        memo: `memo-${i}`,
    })) as OpenAIChat[]
}

function runSupa() {
    return supaMemory(chats(4), 250, 200, room, char, tokenizer)
}

function runHypaV2() {
    return hypaMemoryV2(chats(8), 80, 60, room, char, tokenizer)
}

function noReferenceSent() {
    for (const call of h.calls) {
        expect(call.url).not.toContain('${')
        expect(call.body).not.toContain('${')
        for (const value of Object.values(call.headers)) {
            expect(value).not.toContain('${')
        }
    }
}

beforeEach(() => {
    h.calls.length = 0
    h.resolveCalls.length = 0
    h.failResolve = false
    h.completionOk = true
    h.db = {
        supaMemoryKey: REF,
        supaModelType: 'instruct35',
        supaMemoryPrompt: '',
        maxSupaChunkSize: 100,
        maxResponse: 0,
        hypaAllocatedTokens: 0,
        hypaChunkSize: 100,
        hypaModel: 'ada',
        hypaCustomSettings: { url: 'https://embed.example.test/v1', key: '', model: '' },
        voyageApiKey: '',
        removePunctuationHypa: false,
    }
})

describe('SupaMemory summarizer key (supaMemoryKey)', () => {
    test('sends the resolved key and never the reference', async () => {
        await runSupa()
        const call = h.calls.find((c) => c.url.endsWith('/completions'))
        expect(call?.headers.Authorization).toBe('Bearer ' + h.resolved)
        noReferenceSent()
    })

    test('guard: a plain key is sent byte-identical and the resolver is not consulted', async () => {
        h.db.supaMemoryKey = 'sk-plain-key-123'
        await runSupa()
        const call = h.calls.find((c) => c.url.endsWith('/completions'))
        expect(call?.headers.Authorization).toBe('Bearer sk-plain-key-123')
        expect(h.resolveCalls).toEqual([])
    })

    test('a failed resolution sends no request and returns the error message', async () => {
        h.failResolve = true
        const result = await runSupa()
        expect(h.calls).toEqual([])
        expect(result.error).toContain('RISU_TEST_KEY')
        expect(result.error).not.toContain(h.resolved)
    })

    test('guard: writes no resolved value to the database or the returned memory', async () => {
        const result = await runSupa()
        expect(h.db.supaMemoryKey).toBe(REF)
        expect(JSON.stringify(result)).not.toContain(h.resolved)
        expect(JSON.stringify(h.db)).not.toContain(h.resolved)
    })
})

describe('HypaMemory V2 summarizer and embedding key (supaMemoryKey)', () => {
    test('sends the resolved key for the summary and for the embeddings, never the reference', async () => {
        const result = await runHypaV2()
        expect(result.error).toBeUndefined()
        const summary = h.calls.find((c) => c.url.endsWith('/completions'))
        const embedding = h.calls.find((c) => c.url.endsWith('/embeddings'))
        expect(summary?.headers.Authorization).toBe('Bearer ' + h.resolved)
        expect(embedding?.headers.Authorization).toBe('Bearer ' + h.resolved)
        noReferenceSent()
    })

    test('a failed resolution sends no request and returns the error message', async () => {
        h.failResolve = true
        const result = await runHypaV2()
        expect(h.calls).toEqual([])
        expect(result.error).toContain('RISU_TEST_KEY')
    })

    test('a failed resolution leaks the would-be secret into neither the error text nor the console', async () => {
        h.failResolve = true
        const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error')]
        try {
            const result = await runHypaV2()
            expect(result.error).toContain('RISU_TEST_KEY')
            expect(result.error).not.toContain(h.resolved)
            for (const spy of spies) {
                expect(JSON.stringify(spy.mock.calls)).not.toContain(h.resolved)
            }
        }
        finally {
            spies.forEach((spy) => spy.mockRestore())
        }
    })

    test('a successful summary with a resolved key logs the resolved value to neither console.log nor console.error', async () => {
        const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error')]
        try {
            const result = await runHypaV2()
            expect(result.error).toBeUndefined()
            expect(h.resolveCalls.length).toBeGreaterThan(0)
            for (const spy of spies) {
                expect(JSON.stringify(spy.mock.calls)).not.toContain(h.resolved)
            }
        }
        finally {
            spies.forEach((spy) => spy.mockRestore())
        }
    })

    test('guard: a summary failure that is not a reference failure is retried and ends with the aborting error', async () => {
        h.db.supaMemoryKey = 'sk-plain-key-123'
        h.db.hypaChunkSize = 30
        h.completionOk = false
        const result = await hypaMemoryV2(chats(16), 500, 60, room, char, tokenizer)
        const summaryCalls = h.calls.filter((c) => c.url.endsWith('/completions'))
        expect(summaryCalls).toHaveLength(3)
        expect(result.error).toBe('[HypaV2] Summarization failed multiple times. Aborting to prevent infinite loop.')
        expect(result.memory).toBeUndefined()
    })

    test('a failed resolution returns no memory, the same as the aborting error', async () => {
        h.failResolve = true
        const result = await runHypaV2()
        expect(result.memory).toBeUndefined()
    })

    test('guard: writes no resolved value to the database or the returned memory', async () => {
        const result = await runHypaV2()
        expect(h.db.supaMemoryKey).toBe(REF)
        expect(JSON.stringify(result.memory)).not.toContain(h.resolved)
        expect(JSON.stringify(h.db)).not.toContain(h.resolved)
    })
})

describe('HypaProcesser (hypamemory.ts) embedding keys', () => {
    test('the OpenAI embedding key chosen from the processor is resolved, never sent as the reference', async () => {
        const processor = new HypaProcesser('ada')
        processor.oaikey = REF
        await processor.addText(['hello world'])
        expect(h.calls[0].headers.Authorization).toBe('Bearer ' + h.resolved)
        noReferenceSent()
    })

    test('the OpenAI embedding key falls back to supaMemoryKey, then resolves', async () => {
        const processor = new HypaProcesser('ada')
        processor.oaikey = ''
        await processor.addText(['hello world'])
        expect(h.calls[0].headers.Authorization).toBe('Bearer ' + h.resolved)
        noReferenceSent()
    })

    test('guard: a plain processor key wins over a reference in supaMemoryKey and is not resolved', async () => {
        const processor = new HypaProcesser('ada')
        processor.oaikey = 'sk-plain-key-123'
        await processor.addText(['hello world'])
        expect(h.calls[0].headers.Authorization).toBe('Bearer sk-plain-key-123')
        expect(h.resolveCalls).toEqual([])
    })

    test('the custom server key is resolved, never sent as the reference', async () => {
        h.db.hypaCustomSettings = { url: 'https://embed.example.test/v1', key: ` ${REF} `, model: '' }
        const processor = new HypaProcesser('custom')
        await processor.addText(['hello world'])
        expect(h.calls[0].url).toBe('https://embed.example.test/v1/embeddings')
        expect(h.calls[0].headers.Authorization).toBe('Bearer ' + h.resolved)
        noReferenceSent()
    })

    test('guard: a plain custom key is sent byte-identical', async () => {
        h.db.hypaCustomSettings = { url: 'https://embed.example.test/v1', key: ' plain-custom-key ', model: '' }
        const processor = new HypaProcesser('custom')
        await processor.addText(['hello world'])
        expect(h.calls[0].headers.Authorization).toBe('Bearer plain-custom-key')
        expect(h.resolveCalls).toEqual([])
    })

    test('a failed resolution sends no request and rejects with the error message', async () => {
        h.failResolve = true
        const processor = new HypaProcesser('ada')
        processor.oaikey = REF
        await expect(processor.addText(['hello world'])).rejects.toThrow('RISU_TEST_KEY')
        h.db.hypaCustomSettings = { url: 'https://embed.example.test/v1', key: REF, model: '' }
        const custom = new HypaProcesser('custom')
        await expect(custom.addText(['hello world'])).rejects.toThrow('RISU_TEST_KEY')
        expect(h.calls).toEqual([])
    })
})

describe('HypaProcessorV2 (hypamemoryv2.ts) embedding keys', () => {
    const texts = [{ id: 'a', content: 'hello world' }]

    test('the OpenAI embedding key is resolved, never sent as the reference', async () => {
        const processor = new HypaProcessorV2<string>({ model: 'ada' })
        await processor.addTexts(texts)
        expect(h.calls[0].headers.Authorization).toBe('Bearer ' + h.resolved)
        noReferenceSent()
    })

    test('the custom server key is resolved, never sent as the reference', async () => {
        h.db.hypaCustomSettings = { url: 'https://embed.example.test/v1', key: REF, model: '' }
        const processor = new HypaProcessorV2<string>({ model: 'custom', customEmbeddingUrl: 'https://embed.example.test/v1' })
        await processor.addTexts(texts)
        expect(h.calls[0].headers.Authorization).toBe('Bearer ' + h.resolved)
        noReferenceSent()
    })

    test('guard: a plain OpenAI key is sent byte-identical', async () => {
        h.db.supaMemoryKey = 'sk-plain-key-123'
        const processor = new HypaProcessorV2<string>({ model: 'ada' })
        await processor.addTexts(texts)
        expect(h.calls[0].headers.Authorization).toBe('Bearer sk-plain-key-123')
        expect(h.resolveCalls).toEqual([])
    })

    test('a failed resolution sends no request and rejects with the error message', async () => {
        h.failResolve = true
        const processor = new HypaProcessorV2<string>({ model: 'ada' })
        await expect(processor.addTexts(texts)).rejects.toThrow('RISU_TEST_KEY')
        expect(h.calls).toEqual([])
    })
})

describe('Voyage contextual embedding key (voyageApiKey)', () => {
    test('sends the resolved key for queries and documents, never the reference', async () => {
        h.db.voyageApiKey = REF
        const provider = getContextProvider('voyageContext3')
        await provider.embedQueries(['hello'])
        await provider.embedDocumentGroups([['hello']])
        expect(h.calls).toHaveLength(2)
        for (const call of h.calls) {
            expect(call.headers.Authorization).toBe('Bearer ' + h.resolved)
        }
        noReferenceSent()
    })

    test('guard: a plain key is sent byte-identical', async () => {
        h.db.voyageApiKey = ' pa-plain-key '
        await getContextProvider('voyageContext3').embedQueries(['hello'])
        expect(h.calls[0].headers.Authorization).toBe('Bearer pa-plain-key')
        expect(h.resolveCalls).toEqual([])
    })

    test('a failed resolution sends no request and rejects with the error message', async () => {
        h.db.voyageApiKey = REF
        h.failResolve = true
        const provider = getContextProvider('voyageContext3')
        await expect(provider.embedQueries(['hello'])).rejects.toThrow('RISU_TEST_KEY')
        await expect(provider.embedDocumentGroups([['hello']])).rejects.toThrow('RISU_TEST_KEY')
        expect(h.calls).toEqual([])
    })

    test('guard: an empty key still fails with the missing-key error and never consults the resolver', async () => {
        const provider = getContextProvider('voyageContext3')
        await expect(provider.embedQueries(['hello'])).rejects.toThrow('Voyage API Key')
        expect(h.resolveCalls).toEqual([])
    })
})

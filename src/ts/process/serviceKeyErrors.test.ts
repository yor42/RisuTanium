/**
 * A service key whose stored value cannot be read right now (a wrapped key before the vault
 * answers) must stop the request. Three readers send a request without an Authorization header
 * when the stored value is blank: the OpenAI-compatible image provider, the custom embedding
 * endpoint (both embedding classes). A rejected read must never degrade to a blank key there:
 * no request goes out and the failure is reported or propagated.
 *
 * Drives the real `generateAIImage`, `HypaProcesser` and `HypaProcessorV2`. Mocked: the transport
 * (`globalFetch`), the database, the alert and the collaborators these paths import. The rejecting
 * read is simulated at the key seam (`serviceKey`); nothing here says anything about the real vault.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    rejectRead: false,
    seamValue: null as string | null,
    fetchCalls: [] as Array<{ url: string, headers: Record<string, string> }>,
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) }) },
}))
vi.mock('../connections/serviceKeys', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../connections/serviceKeys')>()
    const { VaultKeyUnavailableError } = await import('../connections/keyVaultStore.svelte')
    return {
        ...actual,
        serviceKey: vi.fn(async (...args: Parameters<typeof actual.serviceKey>) => {
            if (h.rejectRead) {
                throw new VaultKeyUnavailableError('the saved key cannot be read yet')
            }
            return h.seamValue ?? await actual.serviceKey(...args)
        }),
    }
})
vi.mock('../alert', () => ({ alertError: vi.fn() }))
vi.mock('../globalApi.svelte', () => ({
    globalFetch: vi.fn(async (url: string, opts?: { headers?: Record<string, string> }) => {
        h.fetchCalls.push({ url, headers: { ...(opts?.headers ?? {}) } })
        return { ok: true, data: { data: [{ b64_json: 'AAAA', embedding: [1, 0], data: [{ embedding: [1, 0] }] }] } }
    }),
    readImage: vi.fn(),
}))
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => h.db }))
vi.mock('../stores.svelte', () => ({ CharEmotion: { set: vi.fn() } }))
vi.mock('./processzip', () => ({ processZip: vi.fn() }))
vi.mock('./request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('./transformers', () => ({ runEmbedding: vi.fn(async () => []), runSummarizer: vi.fn(async () => '') }))
vi.mock('../platform', () => ({ isMobile: false, isTauri: false, isNodeServer: false }))
vi.mock('../util', () => ({
    appendLastPath: (url: string, path: string) => url.replace(/\/$/, '') + '/' + path,
    getUserName: () => 'User',
}))

import { generateAIImage } from './stableDiff'
import { HypaProcesser } from './memory/hypamemory'
import { HypaProcessorV2 } from './memory/hypamemoryv2'
import { getContextProvider } from './memory/contextualEmbedding'
import { alertError } from '../alert'
import type { character } from '../storage/database.svelte'

beforeEach(() => {
    h.rejectRead = false
    h.seamValue = null
    h.fetchCalls = []
    vi.mocked(alertError).mockClear()
    for (const key of Object.keys(h.db)) { delete h.db[key] }
})

describe('the OpenAI-compatible image provider with a stored key that cannot be read', () => {
    function seed() {
        Object.assign(h.db, {
            sdProvider: 'openai-compat',
            openaiCompatImage: { url: 'https://img.example.invalid/v1/images', key: '', model: '', size: '', quality: '' },
            connections: [{ id: 'conn-1', name: 'OpenAI-compatible image', provider: 'openai_image', key: 'SYN-openai-image' }],
        })
    }

    test('guard: a readable key is sent as the Authorization header', async () => {
        seed()
        await generateAIImage('a prompt', { chaId: 'cha' } as unknown as character, '', 'inlay')
        expect(h.fetchCalls).toHaveLength(1)
        expect(h.fetchCalls[0].headers.Authorization).toBe('Bearer SYN-openai-image')
    })

    test('sends no request, not even an unauthenticated one, and reports the failure', async () => {
        seed()
        h.rejectRead = true

        const image = await generateAIImage('a prompt', { chaId: 'cha' } as unknown as character, '', 'inlay')

        expect(image).toBe('')
        expect(h.fetchCalls).toHaveLength(0)
        expect(alertError).toHaveBeenCalledWith('the saved key cannot be read yet')
    })
})

describe('the WaveSpeed image provider with a stored key that cannot be read', () => {
    test('sends no request and reports the failure instead of asking for a key', async () => {
        Object.assign(h.db, { sdProvider: 'wavespeed', wavespeedImage: { key: '', reference_mode: '' }, connections: [{ id: 'conn-1', name: 'WaveSpeed', provider: 'wavespeed', key: 'SYN-wavespeed' }] })
        h.rejectRead = true

        const image = await generateAIImage('a prompt', { chaId: 'cha' } as unknown as character, '', 'inlay')

        expect(image).toBe('')
        expect(h.fetchCalls).toHaveLength(0)
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith('the saved key cannot be read yet')
    })
})

describe('the custom embedding endpoint with a stored key that cannot be read', () => {
    function seed() {
        Object.assign(h.db, {
            hypaModel: 'custom',
            hypaCustomSettings: { url: 'https://embed.example.invalid/v1', key: '', model: '' },
            connections: [{ id: 'conn-1', name: 'Custom embedding', provider: 'embedding_custom', key: 'SYN-embed' }],
        })
    }

    test('guard: HypaProcesser sends a readable key as the Authorization header', async () => {
        seed()
        await new HypaProcesser('custom').getEmbeds(['text'])
        expect(h.fetchCalls[0].headers.Authorization).toBe('Bearer SYN-embed')
    })

    test('HypaProcesser sends no request and the failure propagates', async () => {
        seed()
        h.rejectRead = true
        await expect(new HypaProcesser('custom').getEmbeds(['text'])).rejects.toThrow('the saved key cannot be read yet')
        expect(h.fetchCalls).toHaveLength(0)
    })

    test('guard: HypaProcessorV2 sends a readable key as the Authorization header', async () => {
        seed()
        const processor = new HypaProcessorV2({ model: 'custom', customEmbeddingUrl: 'https://embed.example.invalid/v1' })
        await processor.addTexts([{ id: 't1', content: 'text' }])
        expect(h.fetchCalls.length).toBeGreaterThan(0)
        expect(h.fetchCalls[0].headers.Authorization).toBe('Bearer SYN-embed')
    })

    test('HypaProcessorV2 sends no request and the failure propagates', async () => {
        seed()
        h.rejectRead = true
        const processor = new HypaProcessorV2({ model: 'custom', customEmbeddingUrl: 'https://embed.example.invalid/v1' })
        await expect(processor.addTexts([{ id: 't1', content: 'text' }])).rejects.toThrow('the saved key cannot be read yet')
        expect(h.fetchCalls).toHaveLength(0)
    })
})

describe('every reader here takes its key from the seam, not from the database field', () => {
    test('the OpenAI-compatible image provider', async () => {
        Object.assign(h.db, { sdProvider: 'openai-compat', openaiCompatImage: { url: 'https://img.example.invalid/v1/images', key: 'legacy-field', model: '', size: '', quality: '' } })
        h.seamValue = 'SYN-seam'
        await generateAIImage('a prompt', { chaId: 'cha' } as unknown as character, '', 'inlay')
        expect(h.fetchCalls[0].headers.Authorization).toBe('Bearer SYN-seam')
    })

    test('the custom embedding endpoint, in both embedding classes', async () => {
        Object.assign(h.db, { hypaCustomSettings: { url: 'https://embed.example.invalid/v1', key: 'legacy-field', model: '' } })
        h.seamValue = 'SYN-seam'
        await new HypaProcesser('custom').getEmbeds(['text'])
        await new HypaProcessorV2({ model: 'custom', customEmbeddingUrl: 'https://embed.example.invalid/v1' }).addTexts([{ id: 't1', content: 'text' }])
        expect(h.fetchCalls.length).toBeGreaterThanOrEqual(2)
        for (const call of h.fetchCalls) {
            expect(call.headers.Authorization).toBe('Bearer SYN-seam')
        }
    })

    test('the OpenAI embedding fallback, in both embedding classes', async () => {
        Object.assign(h.db, { supaMemoryKey: 'legacy-field' })
        h.seamValue = 'SYN-seam'
        await new HypaProcesser('ada').getEmbeds(['text'])
        await new HypaProcessorV2({ model: 'ada' }).addTexts([{ id: 't1', content: 'text' }])
        expect(h.fetchCalls.length).toBeGreaterThanOrEqual(2)
        for (const call of h.fetchCalls) {
            expect(call.headers.Authorization).toBe('Bearer SYN-seam')
        }
    })

    test('the Voyage contextual embedding provider', async () => {
        Object.assign(h.db, { voyageApiKey: 'legacy-field' })
        h.seamValue = 'SYN-seam'
        await getContextProvider('voyageContext3')?.embedQueries(['text'])
        expect(h.fetchCalls[0].headers.Authorization).toBe('Bearer SYN-seam')
    })
})
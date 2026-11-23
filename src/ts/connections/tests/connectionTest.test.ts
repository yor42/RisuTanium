import { describe, expect, it, vi } from 'vitest'
import { canTestConnection, testConnection, type TestFetcher } from '../connectionTest'
import type { Connection } from '../connections'

const conn = (over: Partial<Connection>): Connection => ({ id: 'c1', name: 'n', provider: 'openai', key: '', ...over })
const signal = () => new AbortController().signal

describe('testConnection', () => {
    it('sends one GET with the first key and reports the model count', async () => {
        const fetcher = vi.fn<TestFetcher>(async () => ({ status: 200, data: { data: [{}, {}, {}] } }))
        let t = 0
        const out = await testConnection(conn({}), 'sk-first\nsk-second', fetcher, signal(), () => (t += 40))
        expect(out).toEqual({ kind: 'ok', models: 3, ms: 40 })
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
        expect(fetcher.mock.calls[0][1]).toEqual({ Authorization: 'Bearer sk-first' })
    })

    it('uses the provider header style', async () => {
        const fetcher = vi.fn<TestFetcher>(async () => ({ status: 200, data: { models: [{}] } }))
        await testConnection(conn({ provider: 'anthropic' }), 'k', fetcher, signal())
        expect(fetcher.mock.calls[0][1]['x-api-key']).toBe('k')
        await testConnection(conn({ provider: 'google' }), 'g', fetcher, signal())
        expect(fetcher.mock.calls[1][1]).toEqual({ 'x-goog-api-key': 'g' })
    })

    it.each([[401, 'badKey'], [403, 'badKey'], [429, 'rateLimited'], [500, 'unreachable']])('maps status %i to %s', async (status, kind) => {
        const out = await testConnection(conn({}), 'k', async () => ({ status, data: null }), signal())
        expect(out.kind).toBe(kind)
    })

    it('reports an unreachable host and a cancelled test apart', async () => {
        const down: TestFetcher = async () => { throw new Error('network') }
        expect((await testConnection(conn({}), 'k', down, signal())).kind).toBe('unreachable')
        const controller = new AbortController()
        const slow: TestFetcher = async () => { controller.abort(); throw new Error('aborted') }
        expect((await testConnection(conn({}), 'k', slow, controller.signal)).kind).toBe('cancelled')
    })

    it('appends /models to a proxy URL and refuses a missing one or a ${NAME} reference without a request', async () => {
        const fetcher = vi.fn<TestFetcher>(async () => ({ status: 200, data: {} }))
        const proxy = conn({ provider: 'reverse_proxy', url: 'https://p.invalid/v1/' })
        const out = await testConnection(proxy, 'k', fetcher, signal())
        expect(out).toMatchObject({ kind: 'ok', models: null })
        expect(fetcher.mock.calls[0][0]).toBe('https://p.invalid/v1/models')
        expect((await testConnection(conn({ provider: 'reverse_proxy' }), 'k', fetcher, signal())).kind).toBe('unsupported')
        expect((await testConnection(conn({}), '${OPENAI_KEY}', fetcher, signal())).kind).toBe('unsupported')
        expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('knows which providers can be tested', () => {
        expect(canTestConnection(conn({ provider: 'mistral' }))).toBe(true)
        expect(canTestConnection(conn({ provider: 'novelai' }))).toBe(false)
        expect(canTestConnection(conn({ provider: 'custom', url: 'http://localhost:1234/v1' }))).toBe(true)
    })
})

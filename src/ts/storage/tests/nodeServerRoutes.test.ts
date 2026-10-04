// @vitest-environment node
/**
 * Response headers and rate-limit buckets of the real `server/node/server.cjs`
 * (run as a child process) that the browser-side callers depend on: a proxied
 * GET is never cacheable, and the storage routes draw on their own limiter.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture
let target: Server
let targetUrl: string

beforeAll(async () => {
    target = createServer((request, response) => {
        const headers: Record<string, string> = {
            'content-type': request.url === '/stream' ? 'text/event-stream' : 'text/plain',
            'last-modified': 'Wed, 01 Jan 2020 00:00:00 GMT',
            'expires': 'Wed, 01 Jan 2099 00:00:00 GMT',
            'etag': '"v1"',
        }
        response.writeHead(200, headers)
        response.end('data: hi\n\n')
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
    await new Promise<void>((resolve) => target?.close(() => resolve()))
}, 30_000)

async function proxyGet(route: string, path: string): Promise<Response> {
    return await fetch(`${fixture.baseUrl}${route}`, {
        headers: { 'risu-auth': await fixture.authHeader(), 'risu-url': encodeURIComponent(`${targetUrl}${path}`) },
    })
}

async function storageRead(): Promise<Response> {
    return await fetch(`${fixture.baseUrl}/api/read`, {
        headers: { 'risu-auth': await fixture.authHeader(), 'file-path': hexOfKey('limit/probe') },
    })
}

function remaining(response: Response): number {
    return Number(response.headers.get('ratelimit-remaining'))
}

describe('proxied GET responses', () => {
    test.each(['/proxy', '/proxy2'])('%s answers with no-store although the target sends Last-Modified and Expires', async (route) => {
        const response = await proxyGet(route, '/page')
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('data: hi\n\n')
        expect(response.headers.get('cache-control')).toMatch(/\bno-store\b/)
    })

    test('a streamed event-stream response is no-store and still reaches the caller', async () => {
        const response = await proxyGet('/proxy', '/stream')
        expect(response.headers.get('cache-control')).toMatch(/\bno-store\b/)
        expect(await response.text()).toBe('data: hi\n\n')
    })

    test('a POST through the proxy is no-store too', async () => {
        const response = await fetch(`${fixture.baseUrl}/proxy`, {
            method: 'POST',
            headers: { 'risu-auth': await fixture.authHeader(), 'risu-url': encodeURIComponent(`${targetUrl}/page`), 'content-type': 'application/json' },
            body: '{}',
        })
        expect(response.headers.get('cache-control')).toMatch(/\bno-store\b/)
        await response.text()
    })
})

describe('rate-limit buckets', () => {
    test('storage routes allow far more requests per window than the proxy', async () => {
        const storage = await storageRead()
        const proxied = await proxyGet('/proxy', '/page')
        await storage.arrayBuffer()
        await proxied.arrayBuffer()
        expect(Number(storage.headers.get('ratelimit-limit'))).toBe(20000)
        expect(Number(proxied.headers.get('ratelimit-limit'))).toBe(2000)
    })

    test('a storage request does not consume the proxy bucket and a proxy request does not consume the storage bucket', async () => {
        const proxyBefore = await proxyGet('/proxy', '/page')
        await proxyBefore.arrayBuffer()
        const storageBefore = await storageRead()
        await storageBefore.arrayBuffer()

        for (let i = 0; i < 5; i++) {
            await (await storageRead()).arrayBuffer()
        }
        const proxyAfter = await proxyGet('/proxy', '/page')
        await proxyAfter.arrayBuffer()
        expect(remaining(proxyAfter)).toBe(remaining(proxyBefore) - 1)

        for (let i = 0; i < 5; i++) {
            await (await proxyGet('/proxy', '/page')).arrayBuffer()
        }
        const storageAfter = await storageRead()
        await storageAfter.arrayBuffer()
        expect(remaining(storageAfter)).toBe(remaining(storageBefore) - 6)
    })

    test('list, write and remove share the storage bucket with read', async () => {
        const read = await storageRead()
        await read.arrayBuffer()
        const auth = await fixture.authHeader()
        const list = await fetch(`${fixture.baseUrl}/api/list`, { headers: { 'risu-auth': auth } })
        await list.arrayBuffer()
        const write = await fetch(`${fixture.baseUrl}/api/write`, {
            method: 'POST',
            headers: { 'risu-auth': auth, 'file-path': hexOfKey('limit/w'), 'content-type': 'application/octet-stream' },
            body: new Uint8Array([1]),
        })
        await write.arrayBuffer()
        const remove = await fetch(`${fixture.baseUrl}/api/remove`, { headers: { 'risu-auth': auth, 'file-path': hexOfKey('limit/w'), 'if-match-revision': '' } })
        await remove.arrayBuffer()
        for (const response of [list, write, remove]) {
            expect(Number(response.headers.get('ratelimit-limit'))).toBe(20000)
        }
        expect(remaining(remove)).toBe(remaining(read) - 3)
    })
})

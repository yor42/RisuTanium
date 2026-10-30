// @vitest-environment node
/**
 * The outbound headers of the Node server's `/proxy` and `/proxy2` routes, on the
 * real `server/node/server.cjs` against a loopback target that records what it
 * receives. Without a `risu-header` map the browser's own headers are forwarded,
 * and the server's credentials (`risu-auth`, `risu-*`, the cookie) and the
 * connection's framing never reach the target. A client-supplied map is
 * forwarded as it is, minus the app's own `risu-*` names.
 */
import { request, createServer, type IncomingHttpHeaders, type OutgoingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

interface Hit {
    method: string | undefined
    headers: IncomingHttpHeaders
}

let fixture: NodeServerFixture
let target: Server
let targetUrl = ''
let hits: Hit[] = []

beforeAll(async () => {
    fixture = await startNodeServer()
    target = createServer((incoming, response) => {
        incoming.resume()
        incoming.on('end', () => {
            hits.push({ method: incoming.method, headers: incoming.headers })
            response.writeHead(200, { 'content-type': 'text/plain' })
            response.end('ok')
        })
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/t`
}, 60_000)

afterEach(() => {
    hits = []
})

afterAll(async () => {
    await fixture?.stop()
    await new Promise<void>((resolve) => {
        target?.closeAllConnections()
        target?.close(() => resolve())
    })
}, 30_000)

/** A request with exactly these headers (fetch cannot set a cookie or a connection header). */
function send(method: string, path: string, headers: OutgoingHttpHeaders, body?: string): Promise<{ status: number, text: string }> {
    const url = new URL(fixture.baseUrl)
    return new Promise((resolve, reject) => {
        const outgoing = request({ host: '127.0.0.1', port: Number(url.port), method, path, headers }, (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk: Buffer) => chunks.push(chunk))
            response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf-8') }))
        })
        outgoing.on('error', reject)
        outgoing.end(body)
    })
}

describe('without a risu-header map the browser headers are forwarded without credentials', { timeout: 30_000 }, () => {
    for (const [method, path] of [['POST', '/proxy'], ['POST', '/proxy2'], ['GET', '/proxy'], ['GET', '/proxy2']] as const) {
        test(`S4a-T1 ${method} ${path}`, async () => {
            const body = method === 'POST' ? '{"a":1}' : undefined
            const answer = await send(method, path, {
                'risu-auth': await fixture.authHeader(),
                'risu-url': encodeURIComponent(targetUrl),
                'risu-timeout-ms': '20000',
                cookie: 'session=secret',
                connection: 'keep-alive',
                'proxy-authorization': 'Basic abc',
                'x-keep-me': 'yes',
                accept: 'text/plain',
                ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
            }, body)
            expect(answer.status).toBe(200)
            expect(hits).toHaveLength(1)
            const seen = hits[0].headers
            expect(seen['risu-auth']).toBeUndefined()
            expect(seen['risu-url']).toBeUndefined()
            expect(seen['risu-timeout-ms']).toBeUndefined()
            expect(seen.cookie).toBeUndefined()
            expect(seen['proxy-authorization']).toBeUndefined()
            // The browser's other headers still travel.
            expect(seen['x-keep-me']).toBe('yes')
            expect(seen.accept).toBe('text/plain')
        })
    }
})

describe('a risu-header map is forwarded as the client sent it', { timeout: 30_000 }, () => {
    test('S4a-G1 the target gets the map entries and an x-forwarded-for; risu-* names in the map are dropped', async () => {
        const answer = await send('POST', '/proxy2', {
            'risu-auth': await fixture.authHeader(),
            'risu-url': encodeURIComponent(targetUrl),
            'risu-header': encodeURIComponent(JSON.stringify({ Authorization: 'Bearer x', 'content-type': 'application/json', 'risu-auth': 'leak' })),
        }, '{"a":1}')
        expect(answer.status).toBe(200)
        expect(hits).toHaveLength(1)
        expect(hits[0].headers.authorization).toBe('Bearer x')
        expect(hits[0].headers['x-forwarded-for']).toBeTruthy()
        expect(hits[0].headers['risu-auth']).toBeUndefined()
    })
})

// @vitest-environment node
/**
 * Redirects of `/proxy` and `/proxy2` on the real `server/node/server.cjs`.
 * The server follows them itself: every hop passes the destination policy and
 * the checked lookup, at most five are followed, a method change drops the
 * body, and a hop to another origin drops the credentials. The targets are two
 * loopback servers of this test (two origins), and the net guard preload
 * refuses and logs any connection beyond loopback.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'nodeNetGuard.cjs')

interface Hit {
    origin: 'A' | 'B'
    method: string | undefined
    url: string | undefined
    headers: IncomingHttpHeaders
    body: string
}

let hits: Hit[] = []
let servers: Server[] = []
let portA = 0
let portB = 0
let fixture: NodeServerFixture

/**
 * `/r?code=302&to=<url>` answers that redirect; `/loop` redirects to itself;
 * every other path answers 200 and is recorded.
 */
function startTarget(origin: 'A' | 'B'): Promise<number> {
    const server = createServer((incoming, response) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () => {
            hits.push({ origin, method: incoming.method, url: incoming.url, headers: incoming.headers, body: Buffer.concat(chunks).toString('utf-8') })
            const url = new URL(incoming.url ?? '/', 'http://x')
            if (url.pathname === '/r') {
                response.writeHead(Number(url.searchParams.get('code')), { location: url.searchParams.get('to') ?? '' })
                response.end('redirecting')
            } else if (url.pathname === '/loop') {
                response.writeHead(302, { location: '/loop' })
                response.end()
            } else {
                response.writeHead(200, { 'content-type': 'text/plain' })
                response.end('echo-ok')
            }
        })
    })
    servers.push(server)
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

function attempts(): Array<{ host: string, address: string }> {
    const file = join(fixture.saveDir, '..', 'connect-attempts.jsonl')
    return existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line)) : []
}

beforeAll(async () => {
    portA = await startTarget('A')
    portB = await startTarget('B')
    fixture = await startNodeServer({ nodeArgs: ['--require', GUARD] })
}, 60_000)

beforeEach(() => {
    hits = []
})

afterAll(async () => {
    await fixture?.stop()
    for (const server of servers) {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }
}, 30_000)

async function proxy(url: string, map: Record<string, string> = {}, body = '{"a":1}'): Promise<Response> {
    return fetch(`${fixture.baseUrl}/proxy2`, {
        method: 'POST',
        headers: {
            'risu-auth': await fixture.authHeader(),
            'risu-url': encodeURIComponent(url),
            'risu-header': encodeURIComponent(JSON.stringify({ 'content-type': 'application/json', ...map })),
            'content-type': 'application/json',
        },
        body,
    })
}

const redirectTo = (code: number, to: string): string => `http://127.0.0.1:${portA}/r?code=${code}&to=${encodeURIComponent(to)}`

describe('every hop passes the destination policy', { timeout: 30_000 }, () => {
    test('S4b-T2 a redirect from a loopback target to a private address is refused and not attempted', async () => {
        const before = attempts().length
        const response = await proxy(redirectTo(302, 'http://10.0.0.5/x'))
        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({ code: 'PROXY_DESTINATION_BLOCKED' })
        expect(attempts()).toHaveLength(before)
        expect(hits).toHaveLength(1)
    })

    test('S4b-T5 a redirect loop answers 502 after five followed hops', async () => {
        const response = await proxy(`http://127.0.0.1:${portA}/loop`)
        expect(response.status).toBe(502)
        expect(await response.json()).toMatchObject({ code: 'PROXY_TOO_MANY_REDIRECTS' })
        expect(hits).toHaveLength(6)
    })

    test('S4b-T10 an unusable Location answers 502 and never reaches the next target', async () => {
        for (const location of ['ftp://127.0.0.1/x', `http://u:p@127.0.0.1:${portB}/x`]) {
            hits = []
            const response = await proxy(redirectTo(302, location), { authorization: 'Basic abc' })
            expect(response.status, location).toBe(502)
            expect(await response.json(), location).toMatchObject({ code: 'PROXY_REDIRECT_INVALID' })
            expect(hits.filter((hit) => hit.origin === 'B')).toHaveLength(0)
        }
    })
})

describe('credentials and bodies across a redirect', { timeout: 30_000 }, () => {
    test('S4b-G6 another origin does not get authorization, proxy-authorization or the cookie; the same origin keeps them', async () => {
        const map = { authorization: 'Bearer secret', cookie: 'sid=1', 'proxy-authorization': 'P', 'x-api-key': 'k' }
        const cross = await proxy(redirectTo(302, `http://127.0.0.1:${portB}/next`), map)
        expect(cross.status).toBe(200)
        await cross.text()
        const arrivedAtB = hits.find((hit) => hit.origin === 'B')
        expect(arrivedAtB).toBeDefined()
        expect(arrivedAtB?.headers.authorization).toBeUndefined()
        expect(arrivedAtB?.headers.cookie).toBeUndefined()
        expect(arrivedAtB?.headers['proxy-authorization']).toBeUndefined()
        expect(arrivedAtB?.headers['x-api-key']).toBe('k')

        hits = []
        const same = await proxy(redirectTo(302, `http://127.0.0.1:${portA}/next`), map)
        expect(same.status).toBe(200)
        await same.text()
        const arrivedAgain = hits.filter((hit) => hit.url === '/next')
        expect(arrivedAgain).toHaveLength(1)
        expect(arrivedAgain[0].headers.authorization).toBe('Bearer secret')
        expect(arrivedAgain[0].headers.cookie).toBe('sid=1')
    })

    test('S4b-G7 a 302 and a 303 turn a POST into a GET without a body; a 307 and a 308 keep both', async () => {
        for (const code of [302, 303]) {
            hits = []
            await (await proxy(redirectTo(code, `http://127.0.0.1:${portA}/next`))).text()
            const next = hits.find((hit) => hit.url === '/next')
            expect(next?.method, String(code)).toBe('GET')
            expect(next?.body).toBe('')
            expect(next?.headers['content-type']).toBeUndefined()
            expect(next?.headers['content-length']).toBeUndefined()
        }
        for (const code of [307, 308]) {
            hits = []
            await (await proxy(redirectTo(code, `http://127.0.0.1:${portA}/next`))).text()
            const next = hits.find((hit) => hit.url === '/next')
            expect(next?.method, String(code)).toBe('POST')
            expect(next?.body).toBe('{"a":1}')
            expect(next?.headers['content-type']).toBe('application/json')
        }
    })
})

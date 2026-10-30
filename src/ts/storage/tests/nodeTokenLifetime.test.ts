// @vitest-environment node
/**
 * The lifetime cap on ordinary tokens of the real `server/node/server.cjs`: a
 * token whose `exp` is more than an hour after the server's clock is refused
 * (`Token Lifetime Too Long`), whatever its `iat`. The cap is measured against
 * the server's clock, not against `iat`, so a client whose clock is off by up to
 * about 55 minutes still works. Asset-read tokens (with an audience) are not
 * capped. Tokens are signed by the fixture's logged-in key pair.
 */
import { createServer, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture
let target: Server
let targetPort = 0

beforeAll(async () => {
    target = createServer((incoming, response) => {
        incoming.resume()
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: first\n\n')
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    targetPort = (target.address() as AddressInfo).port
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
    target?.closeAllConnections()
    await new Promise<void>((resolve) => target?.close(() => resolve()))
}, 30_000)

const now = () => Math.floor(Date.now() / 1000)

async function verdict(claims: Record<string, unknown>): Promise<{ status: string, list: number, listBody: string }> {
    const token = await fixture.signToken(claims)
    const headers = { 'risu-auth': token }
    const auth = await (await fetch(`${fixture.baseUrl}/api/test_auth`, { headers })).json() as { status: string }
    const list = await fetch(`${fixture.baseUrl}/api/list`, { headers })
    return { status: auth.status, list: list.status, listBody: await list.text() }
}

describe('the one-hour cap on an ordinary token', { timeout: 30_000 }, () => {
    test('S7-T1 exp two hours ahead is refused as too long', async () => {
        const result = await verdict({ iat: now(), exp: now() + 7200 })
        expect(result.status).toBe('incorrect')
        expect(result.list).toBe(400)
        expect(JSON.parse(result.listBody)).toEqual({ error: 'Token Lifetime Too Long' })
    })

    test('S7-T4 a token from a client two hours ahead of the server is refused and the log names the clock', async () => {
        const logged = fixture.output().length
        const result = await verdict({ iat: now() + 7200, exp: now() + 7500 })
        expect(result.list).toBe(400)
        expect(JSON.parse(result.listBody)).toEqual({ error: 'Token Lifetime Too Long' })
        for (let wait = 0; wait < 100 && !fixture.output().slice(logged).includes('server clock may be behind'); wait++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 20))
        }
        expect(fixture.output().slice(logged)).toContain('server clock may be behind')
    })

    test('S7-G2 a client up to 50 minutes ahead of the server still works', async () => {
        const result = await verdict({ iat: now() + 3000, exp: now() + 3300 })
        expect(result.status).toBe('success')
        expect(result.list).toBe(200)
    })

    test('S7-G3 exp within an hour is accepted whatever iat says, or without iat', async () => {
        for (const claims of [{ exp: now() + 300 }, { iat: now() + 600, exp: now() + 900 }, { iat: now() - 7000, exp: now() + 600 }]) {
            const result = await verdict(claims)
            expect(result.status, JSON.stringify(claims)).toBe('success')
            expect(result.list, JSON.stringify(claims)).toBe(200)
        }
    })

    test('S7-G1 exp 3500 s ahead is accepted', async () => {
        expect((await verdict({ iat: now(), exp: now() + 3500 })).status).toBe('success')
    })

    test('S7-G1b an expired token is still refused as expired', async () => {
        const result = await verdict({ iat: now() - 600, exp: now() - 10 })
        expect(JSON.parse(result.listBody)).toEqual({ error: 'Token Expired' })
    })
})

describe('the job-scoped WebSocket ticket', { timeout: 30_000 }, () => {
    async function createJob(): Promise<{ jobId: string, wsTicket: string }> {
        const response = await fetch(`${fixture.baseUrl}/proxy-stream-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'risu-auth': await fixture.authHeader() },
            body: JSON.stringify({ url: `http://127.0.0.1:${targetPort}/s`, method: 'POST', bodyBase64: '', headers: {} }),
        })
        expect(response.status).toBe(200)
        return await response.json() as { jobId: string, wsTicket: string }
    }

    /** The status line the server answers a WebSocket upgrade with. */
    function upgrade(path: string, query: string, headers: Record<string, string> = {}): Promise<string> {
        const url = new URL(fixture.baseUrl)
        return new Promise((resolve) => {
            const socket = connect(Number(url.port), '127.0.0.1')
            let received = ''
            socket.on('data', (chunk) => {
                received += chunk.toString('latin1')
                if (received.includes('\r\n')) {
                    socket.destroy()
                    resolve(received.split('\r\n')[0])
                }
            })
            socket.on('connect', () => {
                socket.write([
                    `GET ${path}?${query} HTTP/1.1`,
                    `Host: 127.0.0.1:${url.port}`,
                    'Connection: Upgrade',
                    'Upgrade: websocket',
                    'Sec-WebSocket-Version: 13',
                    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
                    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
                    '',
                    '',
                ].join('\r\n'))
            })
        })
    }

    test('S7-T2 the ticket from job creation opens its job; a wrong ticket or another job\'s ticket is refused', async () => {
        const first = await createJob()
        const second = await createJob()
        expect(first.wsTicket).toMatch(/^[0-9a-f]{64}$/)
        expect(first.wsTicket).not.toBe(second.wsTicket)
        const pathOf = (jobId: string) => `/proxy-stream-jobs/${jobId}/ws`
        expect(await upgrade(pathOf(first.jobId), `ticket=${first.wsTicket}`)).toBe('HTTP/1.1 101 Switching Protocols')
        expect(await upgrade(pathOf(first.jobId), 'ticket=wrong')).toBe('HTTP/1.1 401 Unauthorized')
        expect(await upgrade(pathOf(first.jobId), `ticket=${second.wsTicket}`)).toBe('HTTP/1.1 401 Unauthorized')
        expect(await upgrade(pathOf('no-such-job'), `ticket=${first.wsTicket}`)).toBe('HTTP/1.1 401 Unauthorized')
    })

    test('S7-G5 the general token still opens a job, now under the lifetime cap', async () => {
        const { jobId } = await createJob()
        const path = `/proxy-stream-jobs/${jobId}/ws`
        expect(await upgrade(path, `risu-auth=${encodeURIComponent(await fixture.authHeader())}`)).toBe('HTTP/1.1 101 Switching Protocols')
        const tooLong = await fixture.signToken({ iat: now(), exp: now() + 7200 })
        expect(await upgrade(path, `risu-auth=${encodeURIComponent(tooLong)}`)).toBe('HTTP/1.1 401 Unauthorized')
    })
})

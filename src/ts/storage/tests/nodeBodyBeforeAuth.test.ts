// @vitest-environment node
/**
 * Body parsing order on the real `server/node/server.cjs`: no request body is
 * read before the request is authorised, except under the small public limit.
 * A stalled unauthenticated body (declared 50 MiB, a few bytes sent, never
 * ended) must be answered at once; a body over the public limit on a public
 * route is refused with the JSON 413 and nothing is forwarded or stored.
 *
 * The stalled-request helper never half-closes: an `end()` makes the server see
 * an aborted request, which is how the pre-fix server answers, and would turn
 * the reproducers into false passes.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const HUB_STUB = join(dirname(fileURLToPath(import.meta.url)), 'nodeHubStub.cjs')
const MIB = 1024 * 1024
const STALL_WINDOW_MS = 3000
const DIGEST = createHash('sha256').update('fixture-password').digest('hex')

interface Stalled {
    statusLine: string | null
    headers: Record<string, string>
    ms: number
}

/** Declares a 50 MiB body, sends 1 KiB and waits for an answer; never ends the request. */
function stalledRequest(baseUrl: string, method: string, path: string, headers: Record<string, string>, declared = 50 * MIB): Promise<Stalled> {
    const url = new URL(baseUrl)
    return new Promise((resolve) => {
        const started = Date.now()
        const socket = connect(Number(url.port), '127.0.0.1')
        let received = ''
        let settled = false
        const finish = (value: Stalled) => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            socket.destroy()
            resolve(value)
        }
        const timer = setTimeout(() => finish({ statusLine: null, headers: {}, ms: Date.now() - started }), STALL_WINDOW_MS)
        socket.on('error', () => finish({ statusLine: null, headers: {}, ms: Date.now() - started }))
        socket.on('data', (chunk) => {
            received += chunk.toString('latin1')
            const end = received.indexOf('\r\n\r\n')
            if (end >= 0) {
                const lines = received.slice(0, end).split('\r\n')
                const parsed: Record<string, string> = {}
                for (const line of lines.slice(1)) {
                    const colon = line.indexOf(':')
                    parsed[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
                }
                finish({ statusLine: lines[0], headers: parsed, ms: Date.now() - started })
            }
        })
        const head = [`${method} ${path} HTTP/1.1`, `Host: 127.0.0.1:${url.port}`, `Content-Length: ${declared}`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), '', ''].join('\r\n')
        socket.on('connect', () => {
            socket.write(Buffer.from(head, 'latin1'))
            socket.write(Buffer.alloc(1024))
        })
    })
}

interface Hit {
    method: string | undefined
    url: string | undefined
    headers: IncomingHttpHeaders
    body: string
}

let echo: Server | undefined
let echoUrl = ''
let hits: Hit[] = []

async function startEcho(): Promise<void> {
    echo = createHttpServer((request, response) => {
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
            hits.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf-8') })
            response.writeHead(200, { 'content-type': 'text/plain' })
            response.end('echo-ok')
        })
    })
    await new Promise<void>((resolve) => echo!.listen(0, '127.0.0.1', resolve))
    echoUrl = `http://127.0.0.1:${(echo.address() as AddressInfo).port}/target`
}

function hubLog(fx: NodeServerFixture): Array<{ method: string, url: string, length: number }> {
    const file = join(fx.saveDir, '..', 'hub-requests.jsonl')
    if (!existsSync(file)) {
        return []
    }
    return readFileSync(file, 'utf-8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
}

let main: NodeServerFixture
let fresh: NodeServerFixture | undefined

beforeAll(async () => {
    await startEcho()
    main = await startNodeServer({ nodeArgs: ['--require', HUB_STUB], env: { RISU_BODY_TEST_KEY: 'secret-value' } })
}, 60_000)

afterAll(async () => {
    await main?.stop()
    await new Promise<void>((resolve) => {
        echo?.closeAllConnections()
        echo?.close(() => resolve())
    })
}, 30_000)

afterEach(async () => {
    await fresh?.stop()
    fresh = undefined
    hits = []
})

function jsonPost(baseUrl: string, path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

describe('a stalled unauthenticated body is answered without being read', { timeout: 15_000 }, () => {
    const cases: Array<[string, string, string, () => Record<string, string>]> = [
        ['S3-T1a /api/write', 'POST', '/api/write', () => ({ 'content-type': 'application/octet-stream', 'file-path': hexOfKey('k') })],
        ['S3-T1b /api/write-checked', 'POST', '/api/write-checked', () => ({ 'content-type': 'application/octet-stream', 'file-path': hexOfKey('k') })],
        ['S3-T1c /proxy', 'POST', '/proxy', () => ({ 'content-type': 'application/json', 'risu-url': encodeURIComponent(echoUrl) })],
        ['S3-T1d /proxy2', 'POST', '/proxy2', () => ({ 'content-type': 'application/json', 'risu-url': encodeURIComponent(echoUrl) })],
        ['S3-T1e /proxy-stream-jobs', 'POST', '/proxy-stream-jobs', () => ({ 'content-type': 'application/json' })],
        ['S3-T1f /api/env-secret', 'POST', '/api/env-secret', () => ({ 'content-type': 'application/json' })],
        ['S3-T1g GET /api/list with a json content type', 'GET', '/api/list', () => ({ 'content-type': 'application/json' })],
    ]
    test.each(cases)('%s', async (_name, method, path, headers) => {
        const answer = await stalledRequest(main.baseUrl, method, path, headers())
        expect(answer.statusLine).toBe('HTTP/1.1 400 Bad Request')
        expect(hits).toHaveLength(0)
        if (path === '/api/write-checked') {
            expect(answer.headers['risu-storage-guarded']).toBe('1')
        }
    })

    test('S3-T4 /api/upload/append, declared 4 MiB', async () => {
        const answer = await stalledRequest(main.baseUrl, 'POST', '/api/upload/append', { 'content-type': 'application/octet-stream', 'upload-id': 'x', 'upload-offset': '0' }, 4 * MIB)
        expect(answer.statusLine).toMatch(/^HTTP\/1\.1 4\d\d /)
    })

    test('S3-D1 a stalled /api/write WITH a token is still being read (the window measures the auth order)', async () => {
        const answer = await stalledRequest(main.baseUrl, 'POST', '/api/write', { 'content-type': 'application/octet-stream', 'file-path': hexOfKey('k'), 'risu-auth': await main.authHeader() })
        expect(answer.statusLine).toBeNull()
    })
})

describe('public routes carry a small body limit', { timeout: 30_000 }, () => {
    test('S3-T2 /api/crypto with a 2 MiB field is refused with the JSON 413', async () => {
        const response = await jsonPost(main.baseUrl, '/api/crypto', { data: 'x'.repeat(2 * MIB) })
        const text = await response.text()
        expect(response.status).toBe(413)
        expect(text).not.toMatch(/^[0-9a-f]{64}$/)
    })

    test('S3-T7 the 413 is JSON with the code and no stack or path', async () => {
        const crypto = await jsonPost(main.baseUrl, '/api/crypto', { data: 'x'.repeat(2 * MIB) })
        const hub = await fetch(`${main.baseUrl}/hub-proxy/hub/report`, { method: 'POST', body: JSON.stringify({ id: 'a', report: 'y'.repeat(2 * MIB) }) })
        for (const response of [crypto, hub]) {
            expect(response.status).toBe(413)
            expect(response.headers.get('content-type')).toContain('application/json')
            const text = await response.text()
            expect(JSON.parse(text)).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
            expect(text).not.toContain('node_modules')
            expect(text).not.toContain(' at ')
        }
    })

    test('S3-T5 an anonymous /hub-proxy report of 2 MiB is refused and not forwarded', async () => {
        const before = hubLog(main).length
        const response = await fetch(`${main.baseUrl}/hub-proxy/hub/report`, { method: 'POST', body: JSON.stringify({ id: 'a', report: 'y'.repeat(2 * MIB) }) })
        expect(response.status).toBe(413)
        expect(hubLog(main)).toHaveLength(before)
    })

    test('S3-G4 a 16 KiB report and a GET are forwarded once, with the exact length', async () => {
        const before = hubLog(main).length
        const body = JSON.stringify({ id: 'a', report: 'z'.repeat(16 * 1024 - 20) })
        const post = await fetch(`${main.baseUrl}/hub-proxy/hub/report`, { method: 'POST', body })
        expect(post.status).toBe(200)
        const get = await fetch(`${main.baseUrl}/hub-proxy/hub/info/x`)
        expect(get.status).toBe(200)
        const added = hubLog(main).slice(before)
        expect(added).toHaveLength(2)
        expect(added[0]).toMatchObject({ method: 'POST', length: Buffer.byteLength(body) })
        expect(added[1].method).toBe('GET')
    })

    test('S3-T3 password setup and login refuse a 2 MiB field', async () => {
        fresh = await startNodeServer({ provisioned: false })
        const set = await jsonPost(fresh.baseUrl, '/api/set_password', { password: DIGEST, pad: 'x'.repeat(2 * MIB) })
        expect(set.status).toBe(413)
        expect(existsSync(join(fresh.saveDir, '__password'))).toBe(false)

        const login = await jsonPost(main.baseUrl, '/api/login', { password: DIGEST, publicKey: { kty: 'EC' }, pad: 'x'.repeat(2 * MIB) })
        expect(login.status).toBe(413)
    })
})

describe('the digest helper has its own limiter', { timeout: 30_000 }, () => {
    test('S3-T6 / S3-G6 twelve calls hit the limiter, and a login still works afterwards', async () => {
        fresh = await startNodeServer()
        const statuses: number[] = []
        for (let index = 0; index < 12; index++) {
            statuses.push((await jsonPost(fresh.baseUrl, '/api/crypto', { data: 'a' })).status)
        }
        const firstLimited = statuses.indexOf(429)
        expect(firstLimited).toBeGreaterThan(0)
        expect(statuses.slice(0, firstLimited).every((status) => status === 200)).toBe(true)
        // The fixture's own provisioning used one call of the same bucket.
        expect(firstLimited).toBe(9)
        const login = await jsonPost(fresh.baseUrl, '/api/login', { password: DIGEST, publicKey: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' } })
        expect(login.status).toBe(200)
    })
})

describe('guards: the authenticated paths still work', { timeout: 60_000 }, () => {
    test('S3-G1 a signed-in write of the limit minus one byte is stored whole', async () => {
        const size = 104857600 - 1
        const key = hexOfKey('s3-g1')
        const response = await fetch(`${main.baseUrl}/api/write`, {
            method: 'POST',
            headers: { 'file-path': key, 'risu-auth': await main.authHeader(), 'content-type': 'application/octet-stream' },
            body: Buffer.alloc(size, 1),
        })
        expect(response.status).toBe(200)
        expect(statSync(join(main.saveDir, key)).size).toBe(size)
    })

    test('S3-G5 /proxy2 forwards a json body, a text body and no body as the target expects', async () => {
        const auth = await main.authHeader()
        const send = async (headers: Record<string, string>, body?: string) => {
            const response = await fetch(`${main.baseUrl}/proxy2`, {
                method: 'POST',
                headers: { 'risu-auth': auth, 'risu-url': encodeURIComponent(echoUrl), 'risu-header': encodeURIComponent(JSON.stringify({ 'content-type': 'application/json' })), ...headers },
                body,
            })
            expect(response.status).toBe(200)
            await response.text()
            return hits[hits.length - 1].body
        }
        expect(await send({ 'content-type': 'application/json' }, '{"a":1}')).toBe('{"a":1}')
        expect(await send({ 'content-type': 'text/plain' }, 'hello')).toBe('"hello"')
        expect(await send({})).toBe('{}')
    })

    test('S3-G6 env-secret answers a token and the direct digest; a job is created with a token', async () => {
        const ask = async (auth: string) => fetch(`${main.baseUrl}/api/env-secret`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'risu-auth': auth },
            body: JSON.stringify({ name: 'RISU_BODY_TEST_KEY' }),
        })
        const withToken = await ask(await main.authHeader())
        expect(withToken.status).toBe(200)
        expect(await withToken.json()).toEqual({ value: 'secret-value' })
        const withDigest = await ask(DIGEST)
        expect(withDigest.status).toBe(200)

        const job = await fetch(`${main.baseUrl}/proxy-stream-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'risu-auth': await main.authHeader() },
            body: JSON.stringify({ url: echoUrl, method: 'POST', bodyBase64: '', headers: {} }),
        })
        expect(job.status).toBe(200)
        expect(await job.json()).toMatchObject({ jobId: expect.any(String) })
    })

    test('S3-G7 an unauthenticated small write-checked is refused with the guarded marker', async () => {
        const response = await fetch(`${main.baseUrl}/api/write-checked`, {
            method: 'POST',
            headers: { 'file-path': hexOfKey('k'), 'content-type': 'application/octet-stream' },
            body: Buffer.alloc(8),
        })
        expect(response.status).toBe(400)
        expect(response.headers.get('risu-storage-guarded')).toBe('1')
    })
})

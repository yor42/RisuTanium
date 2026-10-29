// @vitest-environment node
/**
 * The Node server's direct-password check never authorizes before a password
 * exists, and no legacy storage route can address the server's own password
 * file. Run against the real `server/node/server.cjs` as a child process.
 *
 * The blank credential is the single byte 0xA0, which `String.prototype.trim`
 * removes. It is sent over a raw latin1 socket so the byte reaches the server
 * exactly as written.
 */
import { connect } from 'node:net'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeAll, afterAll, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const ENV_NAME = 'RISU_STAGE_ONE_KEY'
const ENV_VALUE = 'synthetic-stage-one-value'
const BLANK = '\u00a0'
const REQUEST_TIMEOUT_MS = 10_000

interface RawReply {
    /** 0 when the connection closed without a status line. */
    status: number
    statusLine: string
    headers: Record<string, string>
    body: string
}

/**
 * Writes one request as latin1 bytes and resolves when the server closes the
 * connection (`Connection: close` is sent unless the caller sets `connection`).
 * It never half-closes the socket: a half-closed socket can make the server drop
 * the reply of a handler still awaiting I/O when the client's end arrives.
 */
function rawRequest(baseUrl: string, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<RawReply> {
    const url = new URL(baseUrl)
    const lines = [`${method} ${path} HTTP/1.1`, `Host: ${url.host}`]
    const names = Object.keys(headers).map((name) => name.toLowerCase())
    if (!names.includes('connection')) {
        lines.push('Connection: close')
    }
    for (const [name, value] of Object.entries(headers)) {
        lines.push(`${name}: ${value}`)
    }
    const bodyBytes = body === undefined ? undefined : Buffer.from(body, 'latin1')
    if (bodyBytes !== undefined) {
        lines.push(`Content-Length: ${bodyBytes.length}`)
    }
    const head = Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1')
    return new Promise((resolve, reject) => {
        const socket = connect(Number(url.port), url.hostname)
        const chunks: Buffer[] = []
        const timer = setTimeout(() => {
            socket.destroy()
            reject(new Error(`No close within ${REQUEST_TIMEOUT_MS} ms for ${method} ${path}`))
        }, REQUEST_TIMEOUT_MS)
        socket.on('connect', () => socket.write(bodyBytes === undefined ? head : Buffer.concat([head, bodyBytes])))
        socket.on('data', (chunk) => chunks.push(chunk))
        socket.on('error', () => undefined)
        socket.on('close', () => {
            clearTimeout(timer)
            const text = Buffer.concat(chunks).toString('latin1')
            const split = text.indexOf('\r\n\r\n')
            const headText = split === -1 ? text : text.slice(0, split)
            const [statusLine = '', ...headerLines] = headText.split('\r\n')
            const parsed: Record<string, string> = {}
            for (const line of headerLines) {
                const colon = line.indexOf(':')
                if (colon > 0) {
                    parsed[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
                }
            }
            const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(statusLine)?.[1] ?? 0)
            resolve({ status, statusLine, headers: parsed, body: split === -1 ? '' : text.slice(split + 4) })
        })
    })
}

let fixture: NodeServerFixture | undefined
let target: Server
const hits = new Map<string, number>()

beforeAll(async () => {
    target = createServer((request, response) => {
        const path = (request.url ?? '').split('?')[0]
        hits.set(path, (hits.get(path) ?? 0) + 1)
        request.resume()
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('target-reached')
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
})

afterAll(async () => {
    await new Promise<void>((resolve) => target.close(() => resolve()))
})

afterEach(async () => {
    await fixture?.stop()
    fixture = undefined
    hits.clear()
}, 30_000)

const targetUrl = (path: string) => {
    const address = target.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    return `http://127.0.0.1:${port}${path}`
}

const startUnset = async () => {
    fixture = await startNodeServer({ provisioned: false, env: { [ENV_NAME]: ENV_VALUE } })
    return fixture
}

const startInitialized = async () => {
    fixture = await startNodeServer({ env: { [ENV_NAME]: ENV_VALUE } })
    return fixture
}

async function passwordDigest(fx: NodeServerFixture): Promise<string> {
    const response = await fetch(`${fx.baseUrl}/api/crypto`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 'fixture-password' }),
    })
    return response.text()
}

const passwordFile = (fx: NodeServerFixture) => join(fx.saveDir, '__password')
const jsonType = { 'content-type': 'application/json' }

async function waitForHits(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
}

describe('a blank direct credential on a server with no password', () => {
    test('env-secret refuses it and returns no value', async () => {
        const fx = await startUnset()
        const reply = await rawRequest(fx.baseUrl, 'POST', '/api/env-secret', { ...jsonType, 'risu-auth': BLANK }, JSON.stringify({ name: ENV_NAME }))
        expect(reply.status).toBeGreaterThanOrEqual(400)
        expect(reply.body).not.toContain(ENV_VALUE)
    }, 60_000)

    test.each(['/proxy', '/proxy2'])('%s GET refuses it and reaches no target', async (route) => {
        const fx = await startUnset()
        const reply = await rawRequest(fx.baseUrl, 'GET', route, { 'risu-auth': BLANK, 'risu-url': encodeURIComponent(targetUrl('/get-hit')) })
        await waitForHits()
        expect(reply.status).toBeGreaterThanOrEqual(400)
        expect(reply.body).not.toContain('target-reached')
        expect(hits.get('/get-hit') ?? 0).toBe(0)
    }, 60_000)

    test.each(['/proxy', '/proxy2'])('%s POST refuses it and reaches no target', async (route) => {
        const fx = await startUnset()
        const reply = await rawRequest(fx.baseUrl, 'POST', route, {
            ...jsonType,
            'risu-auth': BLANK,
            'risu-url': encodeURIComponent(targetUrl('/post-hit')),
            'risu-header': encodeURIComponent('{}'),
        }, '{}')
        await waitForHits()
        expect(reply.status).toBeGreaterThanOrEqual(400)
        expect(reply.body).not.toContain('target-reached')
        expect(hits.get('/post-hit') ?? 0).toBe(0)
    }, 60_000)

    test('stream job creation refuses it and makes no job', async () => {
        const fx = await startUnset()
        const reply = await rawRequest(fx.baseUrl, 'POST', '/proxy-stream-jobs', { ...jsonType, 'risu-auth': BLANK },
            JSON.stringify({ url: targetUrl('/job-hit'), method: 'GET', headers: {} }))
        await waitForHits()
        expect(reply.status).toBeGreaterThanOrEqual(400)
        expect(reply.body).not.toContain('jobId')
        expect(hits.get('/job-hit') ?? 0).toBe(0)
    }, 60_000)

    test('stream job deletion refuses it', async () => {
        const fx = await startUnset()
        const reply = await rawRequest(fx.baseUrl, 'DELETE', '/proxy-stream-jobs/nojob', { 'risu-auth': BLANK })
        expect(reply.status).toBeGreaterThanOrEqual(400)
        expect(reply.body).not.toContain('success')
    }, 60_000)

    const upgradeHeaders = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' }
    const upgradeCases: Array<{ name: string, path: string, headers: Record<string, string> }> = [
        { name: 'a query of one space', path: '/proxy-stream-jobs/nojob/ws?risu-auth=+', headers: {} },
        { name: 'a query of an encoded U+00A0', path: '/proxy-stream-jobs/nojob/ws?risu-auth=%C2%A0', headers: {} },
        { name: 'a header of 0xA0', path: '/proxy-stream-jobs/nojob/ws', headers: { 'risu-auth': BLANK } },
    ]

    test.each(upgradeCases)('the WebSocket upgrade with $name gets 401, not the job lookup', async ({ path, headers }) => {
        const fx = await startUnset()
        const reply = await rawRequest(fx.baseUrl, 'GET', path, { ...upgradeHeaders, ...headers })
        expect(reply.statusLine).toBe('HTTP/1.1 401 Unauthorized')
    }, 60_000)

    test('guard: a header of ASCII spaces is no credential at all and is refused', async () => {
        const fx = await startUnset()
        const response = await fetch(`${fx.baseUrl}/api/env-secret`, {
            method: 'POST',
            headers: { ...jsonType, 'risu-auth': '   ' },
            body: JSON.stringify({ name: ENV_NAME }),
        })
        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(await response.text()).not.toContain(ENV_VALUE)
    }, 60_000)

    test('guard: the first client can still set the password after refused attempts', async () => {
        const fx = await startUnset()
        await rawRequest(fx.baseUrl, 'POST', '/api/env-secret', { ...jsonType, 'risu-auth': BLANK }, JSON.stringify({ name: ENV_NAME }))
        const status = async () => ((await (await fetch(`${fx.baseUrl}/api/test_auth`)).json()) as { status: string }).status
        expect(await status()).toBe('unset')

        const digest = await passwordDigest(fx)
        const post = (path: string, body: unknown) => fetch(`${fx.baseUrl}${path}`, { method: 'POST', headers: jsonType, body: JSON.stringify(body) })
        expect((await post('/api/set_password', { password: digest })).status).toBe(200)
        expect((await post('/api/login', { password: digest, publicKey: { kty: 'EC', x: 'first-client' } })).status).toBe(200)
        expect(await status()).not.toBe('unset')
    }, 60_000)
})

describe('guard: authorization on an initialized server is unchanged', () => {
    test('a token and the direct password value both authorize env-secret and the WebSocket upgrade', async () => {
        const fx = await startInitialized()
        const digest = await passwordDigest(fx)
        const token = await fx.authHeader()
        const envBody = JSON.stringify({ name: ENV_NAME })

        for (const credential of [token, digest]) {
            const reply = await rawRequest(fx.baseUrl, 'POST', '/api/env-secret', { ...jsonType, 'risu-auth': credential }, envBody)
            expect(reply.status).toBe(200)
            expect(reply.body).toContain(ENV_VALUE)
        }

        const upgrade = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' }
        for (const credential of [token, digest]) {
            const reply = await rawRequest(fx.baseUrl, 'GET', '/proxy-stream-jobs/nojob/ws', { ...upgrade, 'risu-auth': credential })
            expect(reply.statusLine).toBe('HTTP/1.1 404 Not Found')
        }
    }, 60_000)
})

describe('legacy storage routes cannot address the password file', () => {
    const octet = { 'content-type': 'application/octet-stream' }

    async function expectPasswordUntouched(fx: NodeServerFixture, digest: string) {
        expect(await readFile(passwordFile(fx), 'utf-8')).toBe(digest)
        for (const name of ['__revisions.log', '__revisions.json']) {
            const path = join(fx.saveDir, name)
            if (existsSync(path)) {
                expect(await readFile(path, 'utf-8')).not.toContain('__password')
            }
        }
    }

    test('GET read of __password is refused and returns no digest', async () => {
        const fx = await startInitialized()
        const digest = await passwordDigest(fx)
        const reply = await rawRequest(fx.baseUrl, 'GET', '/api/read', { 'risu-auth': await fx.authHeader(), 'file-path': '__password' })
        expect(reply.status).toBe(400)
        expect(reply.body).not.toContain(digest)
    }, 60_000)

    test('HEAD read of __password is refused', async () => {
        const fx = await startInitialized()
        const reply = await rawRequest(fx.baseUrl, 'HEAD', '/api/read', { 'risu-auth': await fx.authHeader(), 'file-path': '__password' })
        expect(reply.status).toBe(400)
        expect(reply.headers['x-risu-exists']).toBeUndefined()
    }, 60_000)

    test('write of __password is refused and leaves the file and the revisions alone', async () => {
        const fx = await startInitialized()
        const digest = await passwordDigest(fx)
        const reply = await rawRequest(fx.baseUrl, 'POST', '/api/write', { 'risu-auth': await fx.authHeader(), 'file-path': '__password', ...octet }, 'attacker')
        expect(reply.status).toBe(400)
        await expectPasswordUntouched(fx, digest)
    }, 60_000)

    test.each(['__password', '__PASSWORD'])('remove of %s is refused and the file stays', async (name) => {
        const fx = await startInitialized()
        const digest = await passwordDigest(fx)
        const reply = await rawRequest(fx.baseUrl, 'GET', '/api/remove', { 'risu-auth': await fx.authHeader(), 'file-path': name })
        expect(reply.status).toBe(400)
        await expectPasswordUntouched(fx, digest)
    }, 60_000)

    test('a batch remove naming __password removes nothing, not even the valid key', async () => {
        const fx = await startInitialized()
        const digest = await passwordDigest(fx)
        const key = hexOfKey('k1')
        const written = await rawRequest(fx.baseUrl, 'POST', '/api/write', { 'risu-auth': await fx.authHeader(), 'file-path': key, ...octet }, 'one')
        expect(written.status).toBe(200)
        const logBefore = await readFile(join(fx.saveDir, '__revisions.log'), 'utf-8').catch(() => '')

        const reply = await rawRequest(fx.baseUrl, 'GET', '/api/remove', { 'risu-auth': await fx.authHeader(), 'file-path': `${key}$$__password` })
        expect(reply.status).toBe(400)
        expect(await readFile(join(fx.saveDir, key), 'utf-8')).toBe('one')
        expect(await readFile(join(fx.saveDir, '__revisions.log'), 'utf-8').catch(() => '')).toBe(logBefore)
        await expectPasswordUntouched(fx, digest)
    }, 60_000)

    test('guard: a valid key is still readable in upper-case hex', async () => {
        const fx = await startInitialized()
        const key = hexOfKey('k1')
        const written = await rawRequest(fx.baseUrl, 'POST', '/api/write', { 'risu-auth': await fx.authHeader(), 'file-path': key, ...octet }, 'one')
        expect(written.status).toBe(200)
        const reply = await rawRequest(fx.baseUrl, 'GET', '/api/read', { 'risu-auth': await fx.authHeader(), 'file-path': key.toUpperCase() })
        expect(reply.status).toBe(200)
        expect(reply.body).toBe('one')
    }, 60_000)
})

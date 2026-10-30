// @vitest-environment node
/**
 * The destination policy and the outbound request rules of `/proxy`, `/proxy2`
 * and `/api/caps` on the real `server/node/server.cjs`.
 *
 * Every server in this file loads the `nodeNetGuard.cjs` preload: synthetic
 * host names resolve locally, and a connection to an address other than
 * loopback fails before a socket opens and is logged to
 * `connect-attempts.jsonl`. A refused destination therefore shows as a 403 with
 * no logged attempt; an allowed non-loopback destination shows as a logged
 * attempt. The loopback targets are servers of this test.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'nodeNetGuard.cjs')
const NAMES = {
    'private.test': [['10.0.0.7']],
    'public.test': [['93.184.216.34']],
    'multi.test': [['93.184.216.34', '10.0.0.9']],
    'rebind.test': [['127.0.0.1'], ['10.0.0.8']],
    'pooled.test': [['127.0.0.1'], ['93.184.216.34']],
}

interface Hit {
    method: string | undefined
    url: string | undefined
    headers: IncomingHttpHeaders
    body: Buffer
}

let target: Server
let targetPort = 0
let hits: Hit[] = []
let main: NodeServerFixture
let privateEnabled: NodeServerFixture

function targetUrl(path = '/t'): string {
    return `http://127.0.0.1:${targetPort}${path}`
}

function attempts(fx: NodeServerFixture): Array<{ host: string, address: string }> {
    const file = join(fx.saveDir, '..', 'connect-attempts.jsonl')
    return existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line)) : []
}

async function startGuarded(env: Record<string, string> = {}): Promise<NodeServerFixture> {
    return startNodeServer({ nodeArgs: ['--require', GUARD], env: { RISU_NET_GUARD_NAMES: JSON.stringify(NAMES), ...env } })
}

beforeAll(async () => {
    target = createServer((incoming, response) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () => {
            hits.push({ method: incoming.method, url: incoming.url, headers: incoming.headers, body: Buffer.concat(chunks) })
            response.writeHead(200, { 'content-type': 'text/plain' })
            response.end('echo-ok')
        })
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    targetPort = (target.address() as AddressInfo).port
    main = await startGuarded()
    privateEnabled = await startGuarded({ RISU_PROXY_ALLOW_PRIVATE: '1' })
}, 90_000)

afterAll(async () => {
    await main?.stop()
    await privateEnabled?.stop()
    await new Promise<void>((resolve) => {
        target?.closeAllConnections()
        target?.close(() => resolve())
    })
}, 60_000)

interface ProxyOptions {
    method?: 'POST' | 'GET'
    map?: unknown
    body?: string
    via?: 'header' | 'query'
}

/** A request through `/proxy2` with the real client's shape: a token, the target and the header map in headers. */
async function proxy(fx: NodeServerFixture, url: string, options: ProxyOptions = {}): Promise<Response> {
    const method = options.method ?? 'POST'
    const headers: Record<string, string> = { 'risu-auth': await fx.authHeader() }
    if (options.map !== undefined) {
        headers['risu-header'] = encodeURIComponent(JSON.stringify(options.map))
    }
    let path = '/proxy2'
    if (options.via === 'query') {
        path += `?url=${encodeURIComponent(url)}`
    } else {
        headers['risu-url'] = encodeURIComponent(url)
    }
    if (method === 'POST') {
        headers['content-type'] = 'application/json'
    }
    return fetch(`${fx.baseUrl}${path}`, { method, headers, body: method === 'POST' ? (options.body ?? '{"a":1}') : undefined })
}

describe('the net guard itself', () => {
    test('S4b-D1 fetch and http.request to a private literal and to a private name fail with ECONNREFUSED and are logged', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'risu-guard-self-'))
        try {
            const script = [
                "const http = require('node:http')",
                'const attempt = (fn) => fn().then(() => "connected", (e) => String(e.code ?? e.cause?.code ?? e.message))',
                "const viaHttp = (url) => () => new Promise((resolve, reject) => { const r = http.get(url, resolve); r.on('error', reject) })",
                "const viaFetch = (url) => () => fetch(url)",
                'Promise.all([attempt(viaFetch("http://10.255.255.1/")), attempt(viaHttp("http://10.255.255.1/")), attempt(viaFetch("http://private.test/")), attempt(viaHttp("http://private.test/"))]).then((r) => console.log(JSON.stringify(r)))',
            ].join('\n')
            const output = await new Promise<string>((resolve, reject) => {
                execFile(process.execPath, ['--require', GUARD, '-e', script], { cwd: dir, env: { ...process.env, RISU_NET_GUARD_NAMES: JSON.stringify(NAMES) } }, (error, stdout) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve(stdout)
                    }
                })
            })
            expect(JSON.parse(output.trim())).toEqual(['ECONNREFUSED', 'ECONNREFUSED', 'ECONNREFUSED', 'ECONNREFUSED'])
            const logged = readFileSync(join(dir, 'connect-attempts.jsonl'), 'utf-8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
            expect(logged.filter((entry) => entry.address === '10.255.255.1')).toHaveLength(2)
            expect(logged.filter((entry) => entry.host === 'private.test' && entry.address === '10.0.0.7')).toHaveLength(2)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    }, 30_000)
})

describe('a destination the policy refuses', { timeout: 30_000 }, () => {
    test('S4b-T1 private, link-local and mapped literals answer 403 and no connection is attempted', async () => {
        const before = attempts(main).length
        for (const url of ['http://10.255.255.1/', 'http://[fd00::1]/', 'http://[::ffff:10.0.0.1]/', 'http://167772161/', 'http://169.254.169.254/', 'http://100.64.0.1/']) {
            const response = await proxy(main, url)
            expect(response.status, url).toBe(403)
            expect(await response.json(), url).toMatchObject({ code: 'PROXY_DESTINATION_BLOCKED', error: 'Proxy destination is not allowed' })
        }
        expect(attempts(main)).toHaveLength(before)
    })

    test('S4b-T1b the refusal of a private target names the toggle', async () => {
        const body = await (await proxy(main, 'http://10.255.255.1/')).json() as { hint?: string }
        expect(body.hint).toContain('RISU_PROXY_ALLOW_PRIVATE')
    })

    test('S4b-T3 a name that resolves to a private address is refused', async () => {
        const before = attempts(main).length
        const response = await proxy(main, 'http://private.test:8080/')
        expect(response.status).toBe(403)
        expect(attempts(main)).toHaveLength(before)
    })

    test('S4b-T9 a name with one private address among its answers is refused', async () => {
        const before = attempts(main).length
        const response = await proxy(main, 'http://multi.test:8080/')
        expect(response.status).toBe(403)
        expect(attempts(main)).toHaveLength(before)
    })

    test('S4b-T6 a stream job to a private address is refused at creation, as is a public one', async () => {
        for (const url of ['http://10.0.0.9/', 'http://93.184.216.34/']) {
            const response = await fetch(`${main.baseUrl}/proxy-stream-jobs`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'risu-auth': await main.authHeader() },
                body: JSON.stringify({ url, method: 'POST', bodyBase64: '', headers: {} }),
            })
            expect(response.status, url).toBe(403)
            expect(await response.json()).toMatchObject({ code: 'PROXY_DESTINATION_BLOCKED' })
        }
    })

    test('S4b-T6b a stream job to a name a /proxy request already connected to is still checked', async () => {
        hits = []
        const url = `http://pooled.test:${targetPort}/t`
        // The /proxy request resolves the name to loopback and leaves a keep-alive socket behind.
        const first = await proxy(main, url)
        expect(first.status).toBe(200)
        expect(await first.text()).toBe('echo-ok')
        expect(hits).toHaveLength(1)
        // The name now resolves to a public address, which a stream job must refuse; a reused socket would skip that check.
        const created = await fetch(`${main.baseUrl}/proxy-stream-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'risu-auth': await main.authHeader() },
            body: JSON.stringify({ url, method: 'POST', bodyBase64: '', headers: {} }),
        })
        expect(created.status).toBe(200)
        await new Promise((resolve) => setTimeout(resolve, 750))
        expect(hits).toHaveLength(1)
    })
})

describe('a destination the policy allows', { timeout: 30_000 }, () => {
    test('S4b-G1 loopback targets, by address, name and hex form, are allowed by default', async () => {
        for (const host of ['127.0.0.1', 'localhost', '0x7f000001']) {
            hits = []
            const response = await proxy(main, `http://${host}:${targetPort}/t`)
            expect(response.status, host).toBe(200)
            expect(await response.text()).toBe('echo-ok')
            expect(hits, host).toHaveLength(1)
        }
    })

    test('S4b-T4 rebinding: the address that was checked is the one connected to', async () => {
        hits = []
        const before = attempts(main).length
        const first = await proxy(main, `http://rebind.test:${targetPort}/t`)
        expect(first.status).toBe(200)
        expect(hits).toHaveLength(1)
        expect(attempts(main)).toHaveLength(before)
        // The name now resolves to a private address, which a request on a new connection is refused on.
        const second = await proxy(main, `http://rebind.test:${new URL(main.baseUrl).port}/t`)
        expect(second.status).toBe(403)
        expect(attempts(main)).toHaveLength(before)
    })

    test('S4b-G2 with the toggle on, a private target is attempted', async () => {
        const before = attempts(privateEnabled).length
        const response = await proxy(privateEnabled, 'http://10.0.0.5:8080/')
        expect(response.status).toBe(500)
        const added = attempts(privateEnabled).slice(before)
        expect(added.map((entry) => entry.address)).toContain('10.0.0.5')
    })

    test('S4b-G3 a public target is attempted by default', async () => {
        const before = attempts(main).length
        const response = await proxy(main, 'http://public.test:8080/')
        expect(response.status).toBe(500)
        expect(attempts(main).slice(before).map((entry) => entry.address)).toContain('93.184.216.34')
    })
})

describe('/api/caps reports the toggle', { timeout: 30_000 }, () => {
    test('S4b-T7 privateProxy is false by default and true with RISU_PROXY_ALLOW_PRIVATE=1', async () => {
        const read = async (fx: NodeServerFixture) => (await fetch(`${fx.baseUrl}/api/caps`, { headers: { 'risu-auth': await fx.authHeader() } })).json()
        expect(await read(main)).toMatchObject({ privateProxy: false })
        expect(await read(privateEnabled)).toMatchObject({ privateProxy: true })
    })
})

describe('the URL gate', { timeout: 30_000 }, () => {
    const urls = ['file:///x', 'data:text/plain,x', 'ftp://127.0.0.1/', 'http://u:p@127.0.0.1:1/', 'not a url']
    for (const via of ['header', 'query'] as const) {
        test(`S4b-T14 a non-http(s), credentialed or unparseable target answers 400 (${via})`, async () => {
            hits = []
            for (const url of urls) {
                const response = await proxy(main, url, via === 'query' ? { method: 'GET', via } : { via })
                expect(response.status, url).toBe(400)
                expect(await response.json(), url).toEqual({ error: 'Invalid risu-url' })
            }
            expect(hits).toHaveLength(0)
        })
    }

    test('S4b-T14b a credentialed loopback target never reaches the target', async () => {
        hits = []
        const response = await proxy(main, `http://u:p@127.0.0.1:${targetPort}/t`)
        expect(response.status).toBe(400)
        expect(hits).toHaveLength(0)
    })
})

describe('the outbound header rules', { timeout: 30_000 }, () => {
    test('S4b-G8 the headers fetch adds are added when absent, and a given one is kept', async () => {
        hits = []
        await (await proxy(main, targetUrl(), { map: { 'x-a': '1' } })).text()
        expect(hits[0].headers).toMatchObject({
            'user-agent': 'node',
            accept: '*/*',
            'accept-language': '*',
            'sec-fetch-mode': 'cors',
            'content-type': 'text/plain;charset=UTF-8',
            'accept-encoding': 'gzip, deflate',
        })
        hits = []
        await (await proxy(main, targetUrl(), { map: { 'user-agent': 'X', 'content-type': 'application/json' } })).text()
        expect(hits[0].headers['user-agent']).toBe('X')
        expect(hits[0].headers['content-type']).toBe('application/json')
    })

    test('S4b-G9 a host in the map never replaces the target host', async () => {
        hits = []
        await (await proxy(main, targetUrl(), { map: { host: 'evil.example' } })).text()
        expect(hits[0].headers.host).toBe(`127.0.0.1:${targetPort}`)
    })

    test('S4b-T11 a content-length or transfer-encoding in the map does not frame the request', async () => {
        for (const map of [{ 'content-length': '1' }, { 'transfer-encoding': 'chunked' }]) {
            hits = []
            const first = await proxy(main, targetUrl(), { map })
            expect(first.status).toBe(200)
            await first.text()
            expect(hits[0].body.toString()).toBe('{"a":1}')
            expect(hits[0].headers['content-length']).toBe('7')
            expect(hits[0].headers['transfer-encoding']).toBeUndefined()
            // The next request on the same connection pool is intact.
            const second = await proxy(main, targetUrl(), { map: {}, body: '{"b":22}' })
            await second.text()
            expect(hits[1].body.toString()).toBe('{"b":22}')
        }
    })

    test('S4b-T12 hop-by-hop, expect, proxy-authorization and risu-* names in the map never reach the target', async () => {
        hits = []
        const response = await proxy(main, targetUrl(), {
            map: { connection: 'upgrade', 'keep-alive': 'timeout=5', upgrade: 'websocket', expect: '100-continue', te: 'trailers', trailer: 'x-t', 'proxy-authorization': 'P', 'risu-x': 'y', 'x-keep': 'k' },
        })
        expect(response.status).toBe(200)
        await response.text()
        const seen = hits[0].headers
        expect(seen.connection).not.toBe('upgrade')
        for (const name of ['keep-alive', 'upgrade', 'expect', 'te', 'trailer', 'proxy-authorization', 'risu-x']) {
            expect(seen[name], name).toBeUndefined()
        }
        expect(seen['x-keep']).toBe('k')
    })

    test('S4b-T13 numbers reach the target as text; other values and names answer 400 and the server stays up', async () => {
        hits = []
        const accepted = await proxy(main, targetUrl(), { map: { 'x-n': 5 } })
        expect(accepted.status).toBe(200)
        await accepted.text()
        expect(hits[0].headers['x-n']).toBe('5')

        hits = []
        for (const map of [{ x: null }, { x: {} }, { x: ['a'] }, [1], 's', { 'bad name': 'v' }, { x: 'a\r\nb: c' }]) {
            const response = await proxy(main, targetUrl(), { map })
            expect(response.status, JSON.stringify(map)).toBe(400)
            expect(await response.json()).toEqual({ error: 'Invalid risu-header' })
        }
        expect(hits).toHaveLength(0)
        const alive = await fetch(`${main.baseUrl}/api/test_auth`, { headers: { 'risu-auth': await main.authHeader() } })
        expect(await alive.json()).toEqual({ status: 'success' })
    })

    test('S4b-G15 a ranged request asks for the identity encoding', async () => {
        hits = []
        await (await proxy(main, targetUrl(), { map: { range: 'bytes=0-3' } })).text()
        expect(hits[0].headers['accept-encoding']).toBe('identity')
        hits = []
        await (await proxy(main, targetUrl(), { map: { range: 'bytes=0-3', 'accept-encoding': 'gzip' } })).text()
        expect(hits[0].headers['accept-encoding']).toBe('gzip, identity')
    })

    test('S4b-G4 a gzip-encoded response passes through with its encoding and decodes in the client', async () => {
        const zlib = await import('node:zlib')
        const gzipServer = createServer((_incoming, response) => {
            response.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' })
            const gzip = zlib.createGzip()
            gzip.pipe(response)
            gzip.write('data: one\n\n')
            setTimeout(() => gzip.end('data: two\n\n'), 50)
        })
        await new Promise<void>((resolve) => gzipServer.listen(0, '127.0.0.1', resolve))
        try {
            const port = (gzipServer.address() as AddressInfo).port
            const response = await proxy(main, `http://127.0.0.1:${port}/s`, { map: {} })
            expect(response.status).toBe(200)
            expect(response.headers.get('content-encoding')).toBe('gzip')
            expect(await response.text()).toBe('data: one\n\ndata: two\n\n')
        } finally {
            gzipServer.closeAllConnections()
            await new Promise<void>((resolve) => gzipServer.close(() => resolve()))
        }
    })
})

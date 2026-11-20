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

    test('the prefix list route draws on the storage bucket, with and without count', async () => {
        const read = await storageRead()
        await read.arrayBuffer()
        const auth = await fixture.authHeader()
        const listed = await fetch(`${fixture.baseUrl}/api/list-prefix?prefix=`, { headers: { 'risu-auth': auth } })
        await listed.arrayBuffer()
        const counted = await fetch(`${fixture.baseUrl}/api/list-prefix?prefix=&count=1`, { headers: { 'risu-auth': auth } })
        await counted.arrayBuffer()
        for (const response of [listed, counted]) {
            expect(Number(response.headers.get('ratelimit-limit'))).toBe(20000)
        }
        expect(remaining(counted)).toBe(remaining(read) - 2)
    })

    test('the guarded routes and the capability route draw on the same storage bucket', async () => {
        const read = await storageRead()
        await read.arrayBuffer()
        const auth = await fixture.authHeader()
        const caps = await fetch(`${fixture.baseUrl}/api/caps`, { headers: { 'risu-auth': auth } })
        await caps.arrayBuffer()
        const write = await fetch(`${fixture.baseUrl}/api/write-checked`, {
            method: 'POST',
            headers: { 'risu-auth': auth, 'file-path': hexOfKey('limit/g'), 'check-only-count': '0', 'own-condition-count': '0', 'content-type': 'application/octet-stream' },
            body: new Uint8Array([1]),
        })
        await write.arrayBuffer()
        const remove = await fetch(`${fixture.baseUrl}/api/remove-checked`, {
            headers: { 'risu-auth': auth, 'file-path': hexOfKey('limit/g'), 'check-only-count': '0', 'retire-count': '0', 'own-condition-count': '0' },
        })
        await remove.arrayBuffer()
        for (const response of [caps, write, remove]) {
            expect(Number(response.headers.get('ratelimit-limit'))).toBe(20000)
        }
        expect(remaining(remove)).toBe(remaining(read) - 3)
    })
})

describe('POST /api/touch', () => {
    const SHA = 'a'.repeat(64)
    const assetKey = (label: string) => `assets/${label}-${SHA}.bin`

    async function write(key: string, bytes: Uint8Array): Promise<number> {
        const response = await fetch(`${fixture.baseUrl}/api/write`, {
            method: 'POST',
            headers: { 'risu-auth': await fixture.authHeader(), 'file-path': hexOfKey(key), 'content-type': 'application/octet-stream' },
            body: bytes as Uint8Array<ArrayBuffer>,
        })
        const body = await response.json() as { revision: number }
        return body.revision
    }

    async function touch(hex: string, auth: string | null = null): Promise<Response> {
        const headers: Record<string, string> = { 'file-path': hex }
        const token = auth ?? await fixture.authHeader()
        if (token !== '') {
            headers['risu-auth'] = token
        }
        return await fetch(`${fixture.baseUrl}/api/touch`, { method: 'POST', headers })
    }

    async function state(key: string): Promise<{ revision: string | null, exists: string | null, bytes: Uint8Array }> {
        const response = await fetch(`${fixture.baseUrl}/api/read`, { headers: { 'risu-auth': await fixture.authHeader(), 'file-path': hexOfKey(key) } })
        return { revision: response.headers.get('x-risu-revision'), exists: response.headers.get('x-risu-exists'), bytes: new Uint8Array(await response.arrayBuffer()) }
    }

    test('a stored asset answers 200 with the next revision, keeps its bytes and is no-store', async () => {
        const key = assetKey('present')
        const first = await write(key, new Uint8Array([1, 2, 3]))

        const response = await touch(hexOfKey(key))
        const body = await response.json() as { success: boolean, revision: number }

        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toMatch(/\bno-store\b/)
        expect(body).toEqual({ success: true, revision: first + 1 })
        const after = await state(key)
        expect(after.revision).toBe(String(first + 1))
        expect(Array.from(after.bytes)).toEqual([1, 2, 3])
    })

    test('an absent key answers 404 with code absent and nothing changes', async () => {
        const key = assetKey('absent')

        const response = await touch(hexOfKey(key))

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Not Found', code: 'absent' })
        expect((await state(key)).exists).toBe('0')
    })

    test('keys outside assets/ and unreadable paths answer 400 and change nothing', async () => {
        const store2Key = 'store2/current'
        const inlayKey = 'inlays/b-sample.0123456789abcdef'
        const store2Revision = await write(store2Key, new Uint8Array([9]))
        const inlayRevision = await write(inlayKey, new Uint8Array([8]))

        for (const hex of [hexOfKey(store2Key), hexOfKey(inlayKey), 'zz', '']) {
            const response = await touch(hex)
            expect(response.status).toBe(400)
            expect(await response.json()).toEqual({ error: 'Invaild Path' })
        }

        expect((await state(store2Key)).revision).toBe(String(store2Revision))
        expect((await state(inlayKey)).revision).toBe(String(inlayRevision))
    })

    test('a request without a token is refused and moves nothing', async () => {
        const key = assetKey('unauthorized')
        const first = await write(key, new Uint8Array([4]))

        const none = await touch(hexOfKey(key), '')
        const bad = await touch(hexOfKey(key), await fixture.signToken({ iat: 1, exp: 2 }))

        expect(none.status).toBe(400)
        expect(await none.json()).toEqual({ error: 'No auth header' })
        expect(bad.status).toBe(400)
        expect(await bad.json()).toEqual({ error: 'Token Expired' })
        expect((await state(key)).revision).toBe(String(first))
    })

    test('a touched revision survives a server restart', async () => {
        const key = assetKey('restart')
        const first = await write(key, new Uint8Array([5]))
        expect((await touch(hexOfKey(key))).status).toBe(200)

        await fixture.restart()

        const head = await fetch(`${fixture.baseUrl}/api/read`, { method: 'HEAD', headers: { 'risu-auth': await fixture.authHeader(), 'file-path': hexOfKey(key) } })
        expect(head.headers.get('x-risu-revision')).toBe(String(first + 1))
    })
})

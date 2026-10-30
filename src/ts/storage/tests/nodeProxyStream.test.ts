// @vitest-environment node
/**
 * Stream lifetimes on the real `server/node/server.cjs`: a proxied response is a
 * stream whose end the client must be able to trust, and no upstream request
 * outlives its client. Covers the total deadline, an upstream that resets, a
 * clean end, a client that goes away (before the headers and mid-stream), and
 * the stream jobs: their wire request, their abort and the creation answers.
 * After every cut the server must still answer.
 */
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createGzip } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

interface Seen {
    path: string
    headers: IncomingHttpHeaders
}

let target: Server
let port = 0
let fixture: NodeServerFixture
let seen: Seen[] = []
// Paths whose response ended before it was finished, with the time it happened.
let cutAt = new Map<string, number>()
let started = new Map<string, number>()

function track(path: string, response: ServerResponse): void {
    started.set(path, Date.now())
    response.on('close', () => {
        if (!response.writableFinished) {
            cutAt.set(path, Date.now())
        }
    })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function until(condition: () => boolean, ms: number, what: string): Promise<void> {
    const deadline = Date.now() + ms
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}.`)
        }
        await sleep(20)
    }
}

beforeAll(async () => {
    target = createServer((incoming, response) => {
        const path = new URL(incoming.url ?? '/', 'http://x').pathname
        incoming.resume()
        seen.push({ path, headers: incoming.headers })
        track(path, response)
        if (path === '/slow-headers') {
            setTimeout(() => {
                if (!response.destroyed) {
                    response.writeHead(200, { 'content-type': 'text/plain' })
                    response.end('late')
                }
            }, 1500)
        } else if (path === '/trickle') {
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            const timer = setInterval(() => response.write('data: tick\n\n'), 200)
            response.on('close', () => clearInterval(timer))
            response.write('data: first\n\n')
        } else if (path === '/reset') {
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.write('data: first\n\n')
            setTimeout(() => response.socket?.destroy(), 100)
        } else if (path === '/eof') {
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.write('data: one\n\n')
            setTimeout(() => response.end('data: two\n\n'), 50)
        } else if (path === '/length') {
            response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '5' })
            response.end('hello')
        } else if (path === '/stall') {
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.write('data: first\n\n')
        } else if (path === '/gzip') {
            const wantsGzip = String(incoming.headers['accept-encoding'] ?? '').includes('gzip')
            if (wantsGzip) {
                response.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' })
                const gzip = createGzip()
                gzip.pipe(response)
                gzip.end('data: plain\n\n')
            } else {
                response.writeHead(200, { 'content-type': 'text/event-stream' })
                response.end('data: plain\n\n')
            }
        } else {
            response.writeHead(200, { 'content-type': 'text/plain' })
            response.end('ok')
        }
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    port = (target.address() as AddressInfo).port
    fixture = await startNodeServer()
}, 60_000)

beforeEach(() => {
    seen = []
    cutAt = new Map()
    started = new Map()
})

afterAll(async () => {
    await fixture?.stop()
    target?.closeAllConnections()
    await new Promise<void>((resolve) => target?.close(() => resolve()))
}, 30_000)

async function proxyHeaders(path: string, extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return {
        'risu-auth': await fixture.authHeader(),
        'risu-url': encodeURIComponent(`http://127.0.0.1:${port}${path}`),
        'risu-header': encodeURIComponent('{}'),
        'content-type': 'application/json',
        ...extra,
    }
}

async function proxy(path: string, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
    return fetch(`${fixture.baseUrl}/proxy2`, { method: 'POST', headers: await proxyHeaders(path, extra), body: '{}', signal })
}

async function expectServerAlive(): Promise<void> {
    const begun = Date.now()
    const answer = await fetch(`${fixture.baseUrl}/api/test_auth`, { headers: { 'risu-auth': await fixture.authHeader() } })
    expect(await answer.json()).toEqual({ status: 'success' })
    expect(Date.now() - begun).toBeLessThan(1000)
}

/** Reads a body to its end; resolves `{ text }`, or `{ text, error }` when the stream is cut. */
async function drain(response: Response): Promise<{ text: string, error?: unknown, at: number }> {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (;;) {
        try {
            const { done, value } = await reader.read()
            if (done) {
                return { text, at: Date.now() }
            }
            text += decoder.decode(value, { stream: true })
        } catch (error) {
            return { text, error, at: Date.now() }
        }
    }
}

describe('the total deadline', { timeout: 30_000 }, () => {
    test('S4b-G10 a deadline before the headers answers 504 as JSON and the upstream request is closed', async () => {
        const begun = Date.now()
        const response = await proxy('/slow-headers', { 'risu-timeout-ms': '500' })
        expect(response.status).toBe(504)
        expect(await response.json()).toEqual({ error: 'Proxy request timed out after 500ms' })
        expect(Date.now() - begun).toBeLessThan(1200)
        await until(() => cutAt.has('/slow-headers'), 1000, 'the target to see the close')
        await expectServerAlive()
    })

    test('S4b-G11 a deadline mid-stream cuts the stream; it never looks complete', async () => {
        const begun = Date.now()
        const response = await proxy('/trickle', { 'risu-timeout-ms': '800' })
        expect(response.status).toBe(200)
        const result = await drain(response)
        expect(result.error).toBeDefined()
        expect(result.at - begun).toBeGreaterThanOrEqual(700)
        expect(result.at - begun).toBeLessThan(2000)
        await until(() => cutAt.has('/trickle'), 1000, 'the target to see the close')
        await expectServerAlive()
    })
})

describe('what ends a stream', { timeout: 30_000 }, () => {
    test('S4b-G12 an upstream that resets after one event cuts the stream after the partial body', async () => {
        const response = await proxy('/reset')
        expect(response.status).toBe(200)
        const result = await drain(response)
        expect(result.error).toBeDefined()
        expect(result.text).toContain('data: first')
        await expectServerAlive()
    })

    test('S4b-G13 a clean end of a chunked stream and of a length-framed body arrives complete', async () => {
        const chunked = await drain(await proxy('/eof'))
        expect(chunked.error).toBeUndefined()
        expect(chunked.text).toBe('data: one\n\ndata: two\n\n')
        const framed = await proxy('/length')
        expect(framed.headers.get('content-length')).toBe('5')
        const body = await drain(framed)
        expect(body.error).toBeUndefined()
        expect(body.text).toBe('hello')
    })
})

describe('a client that goes away', { timeout: 30_000 }, () => {
    test('S4b-T15 aborting after the first event closes the upstream response unfinished', async () => {
        const controller = new AbortController()
        const response = await proxy('/stall', {}, controller.signal)
        const reader = response.body!.getReader()
        await reader.read()
        controller.abort()
        await reader.read().catch(() => undefined)
        await until(() => cutAt.has('/stall'), 2000, 'the target to see the close')
    })

    test('S4b-T16 a client that disconnects before the headers closes the upstream request', async () => {
        const headers = await proxyHeaders('/slow-headers')
        const request = httpRequest(`${fixture.baseUrl}/proxy2`, { method: 'POST', headers })
        request.on('error', () => undefined)
        request.end('{}')
        await sleep(300)
        request.destroy()
        await until(() => cutAt.has('/slow-headers'), 2000, 'the target to see the close')
        await expectServerAlive()
    })
})

describe('stream jobs', { timeout: 30_000 }, () => {
    async function createJob(body: Record<string, unknown>): Promise<Response> {
        return fetch(`${fixture.baseUrl}/proxy-stream-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'risu-auth': await fixture.authHeader() },
            body: JSON.stringify(body),
        })
    }

    async function collectChunks(jobId: string): Promise<string> {
        const token = await fixture.authHeader()
        const socket = new WebSocket(`${fixture.baseUrl.replace('http', 'ws')}/proxy-stream-jobs/${jobId}/ws?risu-auth=${encodeURIComponent(token)}`)
        const chunks: Buffer[] = []
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('The job did not finish.')), 10_000)
            socket.onmessage = (event) => {
                const message = JSON.parse(String(event.data)) as { type: string, dataBase64?: string }
                if (message.type === 'chunk' && message.dataBase64 !== undefined) {
                    chunks.push(Buffer.from(message.dataBase64, 'base64'))
                } else if (message.type === 'done' || message.type === 'error') {
                    clearTimeout(timer)
                    resolve()
                }
            }
            socket.onerror = () => reject(new Error('WebSocket error'))
        })
        socket.close()
        return Buffer.concat(chunks).toString('utf-8')
    }

    test('S4b-G14 a job adds no request header of its own; a compressing target is read as the plain body', async () => {
        const created = await createJob({ url: `http://127.0.0.1:${port}/gzip`, method: 'POST', bodyBase64: '', headers: {} })
        expect(created.status).toBe(200)
        const { jobId } = await created.json() as { jobId: string }
        expect(await collectChunks(jobId)).toBe('data: plain\n\n')
        const wire = seen.find((entry) => entry.path === '/gzip')!.headers
        for (const name of ['accept-encoding', 'user-agent', 'accept', 'accept-language', 'sec-fetch-mode', 'content-type']) {
            expect(wire[name], name).toBeUndefined()
        }

        seen = []
        const withBr = await createJob({ url: `http://127.0.0.1:${port}/gzip`, method: 'POST', bodyBase64: '', headers: { 'accept-encoding': 'br' } })
        const brId = (await withBr.json() as { jobId: string }).jobId
        await collectChunks(brId)
        expect(seen.find((entry) => entry.path === '/gzip')!.headers['accept-encoding']).toBe('br')
    })

    test('S4b-T13j a job whose header map has a value that is not text answers 400 at creation', async () => {
        for (const headers of [{ x: null }, { x: {} }, { x: ['a'] }, { x: 'a\r\nb: c' }, { 'bad name': 'v' }, [1], 's']) {
            const response = await createJob({ url: `http://127.0.0.1:${port}/ok`, method: 'POST', bodyBase64: '', headers })
            expect(response.status, JSON.stringify(headers)).toBe(400)
            expect(await response.json()).toEqual({ error: 'Invalid risu-header' })
        }
        expect(seen).toHaveLength(0)
        await expectServerAlive()
    })

    test('S4b-T17 deleting a job whose target has sent a chunk and stalled closes the upstream request', async () => {
        const created = await createJob({ url: `http://127.0.0.1:${port}/stall`, method: 'POST', bodyBase64: '', headers: {} })
        const { jobId } = await created.json() as { jobId: string }
        await until(() => started.has('/stall'), 3000, 'the target to be reached')
        await sleep(200)
        const deleted = await fetch(`${fixture.baseUrl}/proxy-stream-jobs/${jobId}`, { method: 'DELETE', headers: { 'risu-auth': await fixture.authHeader() } })
        expect(deleted.status).toBe(200)
        await until(() => cutAt.has('/stall'), 2000, 'the target to see the close')
        await expectServerAlive()
    })
})

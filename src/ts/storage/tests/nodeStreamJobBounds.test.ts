// @vitest-environment node
/**
 * The bounds on a stream job of the real `server/node/server.cjs`: a finished job
 * is retired after its grace period even while sockets follow it, a job has at
 * most a few followers, and a follower that stops reading is cut off instead of
 * making the server queue the whole stream. The server runs with a short grace
 * period and GC interval, two active jobs at most and a 256 KiB follower buffer.
 */
import { createServer, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let target: Server
let port = 0
let fixture: NodeServerFixture
let releaseFlood: () => void = () => undefined
const floodGate = new Promise<void>((resolve) => {
    releaseFlood = resolve
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
    target = createServer((incoming, response) => {
        incoming.resume()
        const path = new URL(incoming.url ?? '/', 'http://x').pathname
        if (path === '/quick') {
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end('data: hi\n\n')
        } else if (path === '/stall') {
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.write('data: first\n\n')
        } else if (path === '/flood') {
            // Up to 64 MiB in 64 KiB writes, as fast as the job reads them, once the test has attached its follower.
            response.writeHead(200, { 'content-type': 'application/octet-stream' })
            const piece = Buffer.alloc(64 * 1024, 7)
            let remaining = 1024
            const pump = () => {
                while (remaining > 0) {
                    remaining--
                    if (!response.write(piece)) {
                        response.once('drain', pump)
                        return
                    }
                }
                response.end()
            }
            void floodGate.then(pump)
        } else {
            response.writeHead(404)
            response.end()
        }
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    port = (target.address() as AddressInfo).port
    fixture = await startNodeServer({
        env: {
            RISU_PROXY_STREAM_DONE_GRACE_MS: '200',
            RISU_PROXY_STREAM_GC_INTERVAL_MS: '50',
            RISU_PROXY_STREAM_MAX_ACTIVE_JOBS: '2',
            RISU_PROXY_STREAM_MAX_CLIENTS_PER_JOB: '4',
            RISU_PROXY_STREAM_MAX_CLIENT_BUFFER_BYTES: String(256 * 1024),
        },
    })
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
    target?.closeAllConnections()
    await new Promise<void>((resolve) => target?.close(() => resolve()))
}, 30_000)

async function createJob(path: string): Promise<Response> {
    return fetch(`${fixture.baseUrl}/proxy-stream-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'risu-auth': await fixture.authHeader() },
        body: JSON.stringify({ url: `http://127.0.0.1:${port}${path}`, method: 'POST', bodyBase64: '', headers: {} }),
    })
}

async function wsUrl(jobId: string): Promise<string> {
    return `${fixture.baseUrl.replace('http', 'ws')}/proxy-stream-jobs/${jobId}/ws?risu-auth=${encodeURIComponent(await fixture.authHeader())}`
}

/** Opens a WebSocket on a job; resolves with the socket and a promise of its close code. */
async function follow(jobId: string): Promise<{ socket: WebSocket, closed: Promise<number>, messages: string[] }> {
    const socket = new WebSocket(await wsUrl(jobId))
    const messages: string[] = []
    socket.onmessage = (event) => messages.push(String(event.data))
    const closed = new Promise<number>((resolve) => {
        socket.onclose = (event) => resolve(event.code)
    })
    await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error('The WebSocket did not open.'))
    })
    return { socket, closed, messages }
}

describe('a finished job is retired', { timeout: 30_000 }, () => {
    test('S5-T1 its followers are closed with 1000 after the grace period, which frees the job slot', async () => {
        const first = await (await createJob('/quick')).json() as { jobId: string }
        const second = await (await createJob('/quick')).json() as { jobId: string }
        const a = await follow(first.jobId)
        const b = await follow(second.jobId)
        const codes = await Promise.race([Promise.all([a.closed, b.closed]), sleep(3000).then(() => 'none' as const)])
        expect(codes).toEqual([1000, 1000])
        const third = await createJob('/quick')
        expect(third.status).toBe(200)
    })
})

describe('followers of a job are bounded', { timeout: 30_000 }, () => {
    test('S5-T4 a fifth follower of one job is refused with 429 before the handshake', async () => {
        const { jobId } = await (await createJob('/stall')).json() as { jobId: string }
        const followers = []
        for (let index = 0; index < 4; index++) {
            followers.push(await follow(jobId))
        }
        const url = new URL(await wsUrl(jobId))
        const answer = await new Promise<string>((resolve) => {
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
                    `GET ${url.pathname}${url.search} HTTP/1.1`,
                    `Host: 127.0.0.1:${url.port}`,
                    'Connection: Upgrade',
                    'Upgrade: websocket',
                    'Sec-WebSocket-Version: 13',
                    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
                    '',
                    '',
                ].join('\r\n'))
            })
        })
        expect(answer).toBe('HTTP/1.1 429 Too Many Requests')
        for (const follower of followers) {
            follower.socket.close()
        }
        await fetch(`${fixture.baseUrl}/proxy-stream-jobs/${jobId}`, { method: 'DELETE', headers: { 'risu-auth': await fixture.authHeader() } })
    })

    test('S5-T2 a follower that stops reading is cut off long before the stream ends', async () => {
        const { jobId } = await (await createJob('/flood')).json() as { jobId: string }
        const url = new URL(await wsUrl(jobId))
        const socket = connect(Number(url.port), '127.0.0.1')
        socket.pause()
        await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
        socket.write([
            `GET ${url.pathname}${url.search} HTTP/1.1`,
            `Host: 127.0.0.1:${url.port}`,
            'Connection: Upgrade',
            'Upgrade: websocket',
            'Sec-WebSocket-Version: 13',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            '',
            '',
        ].join('\r\n'))
        // The server attaches the follower on its own; then the target floods and the follower never reads.
        await sleep(500)
        releaseFlood()
        await sleep(3000)
        let bytes = 0
        const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
        socket.on('data', (chunk) => { bytes += chunk.length })
        socket.resume()
        await Promise.race([closed, sleep(10_000)])
        socket.destroy()
        // The whole stream is about 85 MiB once encoded; a follower that was cut keeps only what the kernel had buffered.
        expect(bytes).toBeLessThan(40 * 1024 * 1024)
        await fetch(`${fixture.baseUrl}/proxy-stream-jobs/${jobId}`, { method: 'DELETE', headers: { 'risu-auth': await fixture.authHeader() } })
        const alive = await fetch(`${fixture.baseUrl}/api/test_auth`, { headers: { 'risu-auth': await fixture.authHeader() } })
        expect(await alive.json()).toEqual({ status: 'success' })
    })
})

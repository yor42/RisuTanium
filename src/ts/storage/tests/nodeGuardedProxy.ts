/**
 * A small HTTP proxy in front of a running Node server fixture, for tests of the
 * guarded routes. It forwards every request and, per `mode`, answers the three
 * guarded paths the way an older server or a careless intermediary would, or
 * changes what the real server sees or says. It records every request it
 * forwarded, so a test can show which routes were reached. Import it only from
 * a test that runs in the Vitest `node` environment.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type ProxyMode =
    | 'pass'
    /** An older server: the guarded paths do not exist. */
    | 'old-404'
    /** A proxy with a single-page-app fallback. */
    | 'html-200'
    | 'method-405'
    /** The guarded answer without the marker header. */
    | 'strip-marker'
    /** The guarded answer without the numeric revision. */
    | 'strip-revision'
    /** A remove answer without the `revisions` map. */
    | 'marker-no-map'
    /** The request without its check-only path and revision headers; the count stays. */
    | 'strip-check-only'
    /** The request without the check-only headers and their count. */
    | 'strip-check-only-and-count'
    /** The request without `retire`; `retire-count` stays. */
    | 'strip-retire'
    /** The request without `retire` and `retire-count`. */
    | 'strip-retire-and-count'
    /** The answer echoes one check-only key too many. */
    | 'echo-wrong-check-only'
    /** The answer echoes one retired key too few. */
    | 'echo-wrong-retired'
    /** A 307 to the matching unguarded route. */
    | 'redirect-307'
    | 'status-431'
    /** The real server applies the request, then the connection is cut before the answer. */
    | 'reset-after-apply'
    /** The caps answer carries the marker but lacks two of the three flags. */
    | 'bad-caps'

export interface GuardedProxy {
    baseUrl: string
    setMode(mode: ProxyMode): void
    /** Requests forwarded to the real server, as `METHOD /path`. */
    forwarded: string[]
    stop(): Promise<void>
}

const GUARDED_PATHS = new Set(['/api/write-checked', '/api/remove-checked', '/api/caps'])
const MARKER = 'risu-storage-guarded'
const DROPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade'])
const DROPPED_RESPONSE_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'content-encoding'])

const UNGUARDED_ROUTE: Record<string, string> = {
    '/api/write-checked': '/api/write',
    '/api/remove-checked': '/api/remove',
    '/api/caps': '/api/list',
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
        chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
}

export async function startGuardedProxy(targetBaseUrl: string): Promise<GuardedProxy> {
    let mode: ProxyMode = 'pass'
    const forwarded: string[] = []

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const path = new URL(request.url ?? '/', 'http://proxy').pathname
        const method = request.method ?? 'GET'
        const body = await readBody(request)
        const guardedPath = GUARDED_PATHS.has(path)

        if (guardedPath) {
            if (mode === 'old-404') {
                response.writeHead(404, { 'content-type': 'text/html' })
                response.end('<pre>Cannot request</pre>')
                return
            }
            if (mode === 'html-200') {
                response.writeHead(200, { 'content-type': 'text/html' })
                response.end('<!doctype html><html><body>app</body></html>')
                return
            }
            if (mode === 'method-405') {
                response.writeHead(405, { 'content-type': 'text/plain' })
                response.end('Method Not Allowed')
                return
            }
            if (mode === 'redirect-307') {
                response.writeHead(307, { location: UNGUARDED_ROUTE[path] })
                response.end()
                return
            }
            if (mode === 'status-431') {
                response.writeHead(431, { 'content-type': 'text/plain' })
                response.end('Request Header Fields Too Large')
                return
            }
        }

        const headers: Record<string, string> = {}
        for (const [name, value] of Object.entries(request.headers)) {
            if (!DROPPED_REQUEST_HEADERS.has(name) && typeof value === 'string') {
                headers[name] = value
            }
        }
        if (guardedPath) {
            if (mode === 'strip-check-only' || mode === 'strip-check-only-and-count') {
                delete headers['check-only-path']
                delete headers['check-only-revision']
            }
            if (mode === 'strip-check-only-and-count') {
                delete headers['check-only-count']
            }
            if (mode === 'strip-retire' || mode === 'strip-retire-and-count') {
                delete headers.retire
            }
            if (mode === 'strip-retire-and-count') {
                delete headers['retire-count']
            }
        }

        forwarded.push(`${method} ${path}`)
        const upstream = await fetch(`${targetBaseUrl}${request.url ?? '/'}`, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
            redirect: 'manual',
        })
        let payload = Buffer.from(await upstream.arrayBuffer())
        const outHeaders: Record<string, string> = {}
        upstream.headers.forEach((value, name) => {
            if (!DROPPED_RESPONSE_HEADERS.has(name)) {
                outHeaders[name] = value
            }
        })
        const status = upstream.status

        if (guardedPath && mode === 'reset-after-apply') {
            request.socket.destroy()
            return
        }
        if (guardedPath && mode === 'bad-caps' && path === '/api/caps') {
            payload = Buffer.from(JSON.stringify({ checkOnly: true }))
        }
        if (guardedPath && (mode === 'strip-revision' || mode === 'marker-no-map' || mode === 'echo-wrong-check-only' || mode === 'echo-wrong-retired') && upstream.ok) {
            const json = JSON.parse(payload.toString('utf-8')) as Record<string, unknown>
            if (mode === 'strip-revision') {
                delete json.revision
            }
            if (mode === 'marker-no-map') {
                delete json.revisions
            }
            if (mode === 'echo-wrong-check-only' && typeof json.checkOnly === 'number') {
                json.checkOnly += 1
            }
            if (mode === 'echo-wrong-retired' && typeof json.retired === 'number') {
                json.retired = Math.max(0, json.retired - 1)
            }
            payload = Buffer.from(JSON.stringify(json))
        }
        if (guardedPath && mode === 'strip-marker') {
            delete outHeaders[MARKER]
        }
        response.writeHead(status, outHeaders)
        response.end(payload)
    }

    const server: Server = createServer((request, response) => {
        handle(request, response).catch((error: unknown) => {
            response.writeHead(502, { 'content-type': 'text/plain' })
            response.end(String(error))
        })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    return {
        baseUrl,
        setMode(next) {
            mode = next
        },
        forwarded,
        stop: () => new Promise<void>((resolve) => {
            server.closeAllConnections()
            server.close(() => resolve())
        }),
    }
}

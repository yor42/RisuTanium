import { isSecretRef } from 'src/ts/secretRefPattern'
import type { Connection } from './connections'

/** What one test request answered; `data` is the parsed body when there was one. */
export type TestReply = { status: number, data: unknown }

/** One GET with headers. Rejects when the host cannot be reached or the request is aborted. */
export type TestFetcher = (url: string, headers: { [name: string]: string }, signal: AbortSignal) => Promise<TestReply>

export type TestOutcome =
    | { kind: 'ok', models: number | null, ms: number }
    | { kind: 'badKey' }
    | { kind: 'rateLimited' }
    | { kind: 'unreachable' }
    /** The provider has no list endpoint to ask, or the key is a `${NAME}` reference that only a request resolves. */
    | { kind: 'unsupported' }
    | { kind: 'cancelled' }

type Endpoint = { url: string, auth: 'bearer' | 'anthropic' | 'google' }

const FIXED: Record<string, Endpoint> = {
    'openai': { url: 'https://api.openai.com/v1/models', auth: 'bearer' },
    'anthropic': { url: 'https://api.anthropic.com/v1/models', auth: 'anthropic' },
    'openrouter': { url: 'https://openrouter.ai/api/v1/models', auth: 'bearer' },
    'nanogpt': { url: 'https://nano-gpt.com/api/v1/models', auth: 'bearer' },
    'mistral': { url: 'https://api.mistral.ai/v1/models', auth: 'bearer' },
    'cohere': { url: 'https://api.cohere.com/v1/models', auth: 'bearer' },
    'google': { url: 'https://generativelanguage.googleapis.com/v1beta/models', auth: 'google' },
    'oaicomp:deepseek': { url: 'https://api.deepseek.com/models', auth: 'bearer' },
    'oaicomp:deepinfra': { url: 'https://api.deepinfra.com/v1/openai/models', auth: 'bearer' },
}

function endpointOf(conn: Connection): Endpoint | undefined {
    if (conn.provider === 'reverse_proxy' || conn.provider === 'custom') {
        const base = (conn.url ?? '').trim().replace(/\/+$/, '')
        return /^https?:\/\//i.test(base) ? { url: `${base}/models`, auth: 'bearer' } : undefined
    }
    return FIXED[conn.provider]
}

/** True when a test can run for this connection's provider. */
export function canTestConnection(conn: Connection): boolean {
    return endpointOf(conn) !== undefined
}

function countModels(data: unknown): number | null {
    if (typeof data !== 'object' || data === null) return null
    const record = data as { [k: string]: unknown }
    for (const field of ['data', 'models']) {
        const list = record[field]
        if (Array.isArray(list)) return list.length
    }
    return null
}

/**
 * Sends one model-list request with the connection's first key and classifies the answer. Nothing
 * here stores anything; a caller keeps the outcome for the session only.
 */
export async function testConnection(
    conn: Connection,
    key: string,
    fetcher: TestFetcher,
    signal: AbortSignal,
    now: () => number = Date.now,
): Promise<TestOutcome> {
    const endpoint = endpointOf(conn)
    const first = key.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? ''
    if (endpoint === undefined || isSecretRef(first)) return { kind: 'unsupported' }
    const headers: { [name: string]: string } = {}
    if (first !== '') {
        if (endpoint.auth === 'anthropic') {
            headers['x-api-key'] = first
            headers['anthropic-version'] = '2023-06-01'
            headers['anthropic-dangerous-direct-browser-access'] = 'true'
        } else if (endpoint.auth === 'google') {
            headers['x-goog-api-key'] = first
        } else {
            headers['Authorization'] = `Bearer ${first}`
        }
    }
    const started = now()
    let reply: TestReply
    try {
        reply = await fetcher(endpoint.url, headers, signal)
    } catch {
        return signal.aborted ? { kind: 'cancelled' } : { kind: 'unreachable' }
    }
    if (signal.aborted) return { kind: 'cancelled' }
    if (reply.status === 401 || reply.status === 403) return { kind: 'badKey' }
    if (reply.status === 429) return { kind: 'rateLimited' }
    if (reply.status >= 200 && reply.status < 300) return { kind: 'ok', models: countModels(reply.data), ms: Math.max(0, now() - started) }
    return { kind: 'unreachable' }
}

/** The fetcher the page uses: the app's own request path, so desktop and Android reach hosts a bare WebView fetch cannot. */
export const appTestFetcher: TestFetcher = async (url, headers, signal) => {
    const { globalFetch } = await import('src/ts/globalApi.svelte')
    const result = await globalFetch(url, { method: 'GET', headers, abortSignal: signal, requestTimeoutMs: 15000 })
    return { status: result.status, data: result.data }
}

import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from './contract'
import { StoreDeleteManyError, StoreError, StoreInvalidKeyError, StoreVersionConflictError, type DeleteReportEntry } from './errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys, versionOf } from './guards'
import { nodeAddressableViolation, nodeCreatableViolation } from './keyRules'

/**
 * The byte store on the self-hosted Node server (`server/node/server.cjs`). The
 * server keeps one file per key under a hex-encoded name and a revision counter
 * per key; this store relies on these endpoints and headers:
 *
 * - `/api/read` answers the value, `x-risu-revision`, and `x-risu-exists`
 *   (`1` when the key holds a value, also an empty one, `0` when it holds none).
 * - `/api/write` replaces the file through a temp file and a rename, and answers
 *   the new revision; `if-match-revision` makes it conditional.
 * - `/api/remove` takes `$$`-joined hex keys and positionally aligned revisions.
 * - `/api/list` answers the decoded names of the files whose names are whole,
 *   even-length hex (case-insensitive). Write temps, the revision file and the
 *   server's other files are not in it. Two files whose hex differs only in
 *   letter case decode to the same key, which `list` returns once.
 *
 * The version is the server's revision. The store holds no revision of its
 * own: `read` reports it, the caller keeps it and decides whether to pass it
 * back, so a read never moves what a later write compares against.
 *
 * Authentication and transport are injected: `authHeader` produces the value of
 * the `risu-auth` header for each request, `fetch` and `baseUrl` say where the
 * requests go.
 */

/**
 * The most bytes the hex keys and revisions of one remove request may carry
 * together. The same figure as the clean-up's own Node delete budget: well
 * under the server's 16 KB header limit, which all headers of a request share.
 */
const REQUEST_KEY_BYTES = 8000

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface NodeHttpStoreOptions {
    /** The value of the `risu-auth` header, produced fresh for each request. May reject; the request is then not sent. */
    authHeader: () => Promise<string>
    /** Defaults to the global `fetch`, looked up per call. */
    fetch?: FetchLike
    /** Prepended to every endpoint path; defaults to the page's own origin. */
    baseUrl?: string
    /** Budget for the keys and revisions of one remove request; defaults to the production figure. */
    requestKeyBytes?: number
    /** Waits `ms` between a rate-limited request and its retry; defaults to a timer. */
    sleep?: (ms: number) => Promise<void>
    /** The clock, in milliseconds, that bounds the total time one call spends on rate-limit retries; defaults to `Date.now`. */
    now?: () => number
}

/** Tries (the first included) one store call makes when the server answers 429. */
const RATE_LIMIT_MAX_TRIES = 5
/** The most time, in milliseconds, one store call spends waiting out 429 answers. */
const RATE_LIMIT_TOTAL_MS = 90_000
/** First backoff when a 429 names no delay; it doubles per try up to the cap. */
const RATE_LIMIT_BACKOFF_MS = 1000
const RATE_LIMIT_BACKOFF_CAP_MS = 16_000

/** The delay a 429 asks for through `Retry-After` (seconds or an HTTP date) or `RateLimit-Reset` (seconds), else a doubling backoff. */
function rateLimitWaitMs(response: Response, triesSoFar: number, nowMs: number): number {
    const retryAfter = response.headers.get('retry-after')?.trim() ?? null
    if (retryAfter !== null && /^\d+$/.test(retryAfter)) {
        return Number(retryAfter) * 1000
    }
    if (retryAfter !== null) {
        const date = Date.parse(retryAfter)
        if (Number.isFinite(date)) {
            return Math.max(0, date - nowMs)
        }
    }
    const reset = response.headers.get('ratelimit-reset')?.trim() ?? null
    if (reset !== null && /^\d+(\.\d+)?$/.test(reset)) {
        return Math.ceil(Number(reset) * 1000)
    }
    return Math.min(RATE_LIMIT_BACKOFF_MS * 2 ** (triesSoFar - 1), RATE_LIMIT_BACKOFF_CAP_MS)
}

/** The server answered with a status this store does not map to a typed error. */
export class NodeHttpError extends StoreError {
    constructor(public readonly status: number, public readonly operation: string) {
        super(`The Node server answered ${status} to ${operation}.`)
        this.name = 'NodeHttpError'
    }
}

function hexOf(key: string): string {
    let hex = ''
    for (const byte of new TextEncoder().encode(key)) {
        hex += byte.toString(16).padStart(2, '0')
    }
    return hex
}

function asRevision(text: string | null): number | null {
    if (text === null || !/^\d+$/.test(text)) {
        return null
    }
    const revision = Number(text)
    return Number.isSafeInteger(revision) ? revision : null
}

async function conflictVersion(response: Response): Promise<number | null> {
    try {
        const body: { currentRevision?: unknown } | null = await response.json()
        return typeof body?.currentRevision === 'number' ? body.currentRevision : null
    } catch {
        return null
    }
}

type ChunkOutcome =
    | { kind: 'removed' }
    | { kind: 'conflict', key: string | null, currentVersion: number | null }
    | { kind: 'rejected', error: unknown }
    | { kind: 'unknown', error: unknown }

interface RemoveItem {
    key: string
    hex: string
    version: number | null
}

export function createNodeHttpStore(options: NodeHttpStoreOptions): ByteStore {
    const baseUrl = options.baseUrl ?? ''
    const requestKeyBytes = options.requestKeyBytes ?? REQUEST_KEY_BYTES
    const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init))

    function checkAddressable(key: string): void {
        const reason = nodeAddressableViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    const rateLimitSleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const now = options.now ?? (() => Date.now())

    /**
     * Runs `attempt` again after a 429, waiting as long as the server asked,
     * for at most `RATE_LIMIT_MAX_TRIES` tries and `RATE_LIMIT_TOTAL_MS` in
     * all; past that the last 429 comes back as it is, for the caller to fail
     * on. The server's limiter answers before any handler runs, so a refused
     * request changed nothing and its retry may carry the same condition. Each
     * 429 body is cancelled before the retry so the connection is released.
     */
    async function retryOnRateLimit(attempt: () => Promise<Response>): Promise<Response> {
        const startedAt = now()
        for (let tries = 1; ; tries++) {
            const response = await attempt()
            if (response.status !== 429 || tries >= RATE_LIMIT_MAX_TRIES) {
                return response
            }
            const wait = rateLimitWaitMs(response, tries, now())
            if (now() - startedAt + wait > RATE_LIMIT_TOTAL_MS) {
                return response
            }
            try {
                await response.body?.cancel()
            } catch {
                // A body that cannot be cancelled is released when the response is collected.
            }
            await rateLimitSleep(wait)
        }
    }

    // Every request opts out of the browser HTTP cache: concurrent requests for
    // one URL (all reads share `/api/read`) are otherwise queued behind each
    // other, and the key lives in a header, not in the URL.
    async function send(path: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
        return await retryOnRateLimit(async () => {
            const auth = await options.authHeader()
            return await doFetch(`${baseUrl}${path}`, { ...init, cache: 'no-store', headers: { ...init.headers, 'risu-auth': auth } })
        })
    }

    /** The state `/api/read` reports for `key`; the body is read only for a GET. */
    async function readState(key: string, method: 'GET' | 'HEAD'): Promise<{ response: Response, exists: boolean, version: number }> {
        const response = await send('/api/read', { method, headers: { 'file-path': hexOf(key) } })
        if (!response.ok) {
            throw new NodeHttpError(response.status, 'read')
        }
        const version = asRevision(response.headers.get('x-risu-revision'))
        const existsHeader = response.headers.get('x-risu-exists')
        if (version === null || (existsHeader !== '1' && existsHeader !== '0')) {
            throw new StoreError('The Node server did not report the revision and existence of the key.')
        }
        return { response, exists: existsHeader === '1', version }
    }

    /** One `/api/remove` request. The server applies it all or not at all, so a 409 or any other 4xx removed nothing. */
    async function removeChunk(items: readonly RemoveItem[]): Promise<ChunkOutcome> {
        const headers = {
            'file-path': items.map((item) => item.hex).join('$$'),
            'if-match-revision': items.map((item) => item.version === null ? '' : String(item.version)).join('$$'),
        }
        let response: Response
        let requestSent = false
        try {
            response = await retryOnRateLimit(async () => {
                requestSent = false
                const auth = await options.authHeader()
                requestSent = true
                return await doFetch(`${baseUrl}/api/remove`, { method: 'GET', cache: 'no-store', headers: { ...headers, 'risu-auth': auth } })
            })
        } catch (error) {
            // A request that was sent may have reached the server before the connection failed;
            // one whose auth header could not be produced was never sent.
            return requestSent ? { kind: 'unknown', error } : { kind: 'rejected', error }
        }
        if (response.ok) {
            return { kind: 'removed' }
        }
        if (response.status === 409) {
            let conflictHex: string | null = null
            let currentVersion: number | null = null
            try {
                const body: { filePath?: unknown, currentRevision?: unknown } | null = await response.json()
                conflictHex = typeof body?.filePath === 'string' ? body.filePath.toLowerCase() : null
                currentVersion = typeof body?.currentRevision === 'number' ? body.currentRevision : null
            } catch {
                // A conflict without a readable body still removed nothing.
            }
            const item = items.find((candidate) => candidate.hex === conflictHex)
            return { kind: 'conflict', key: item?.key ?? null, currentVersion }
        }
        const error = new NodeHttpError(response.status, 'remove')
        // A server error can come after revisions were bumped and some files removed.
        return response.status >= 500 ? { kind: 'unknown', error } : { kind: 'rejected', error }
    }

    /** Splits `items` into requests whose hex keys and revisions together stay within the budget; a single oversized item still gets its own request. */
    function chunksOf(items: readonly RemoveItem[]): RemoveItem[][] {
        const chunks: RemoveItem[][] = []
        let current: RemoveItem[] = []
        let bytes = 0
        for (const item of items) {
            const cost = item.hex.length + 2 + (item.version === null ? 0 : String(item.version).length) + 2
            if (current.length > 0 && bytes + cost > requestKeyBytes) {
                chunks.push(current)
                current = []
                bytes = 0
            }
            current.push(item)
            bytes += cost
        }
        if (current.length > 0) {
            chunks.push(current)
        }
        return chunks
    }

    function removeItemOf(entry: DeleteEntry): RemoveItem {
        return { key: entry.key, hex: hexOf(entry.key), version: versionOf(entry.condition) }
    }

    return {
        capabilities: { conditionalWrites: true },

        async read(key: string): Promise<ReadResult> {
            checkAddressable(key)
            const { response, exists, version } = await readState(key, 'GET')
            const body = new Uint8Array(await response.arrayBuffer())
            return { bytes: exists ? body : null, version }
        },

        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            const reason = nodeAddressableViolation(key) ?? nodeCreatableViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, true)
            checkBytes(bytes)
            const headers: Record<string, string> = {
                'content-type': 'application/octet-stream',
                'file-path': hexOf(key),
            }
            const ifVersion = versionOf(condition)
            if (ifVersion !== null) {
                headers['if-match-revision'] = String(ifVersion)
            }
            const response = await send('/api/write', { method: 'POST', headers, body: bytes as Uint8Array<ArrayBuffer> })
            if (response.status === 409) {
                throw new StoreVersionConflictError(key, await conflictVersion(response))
            }
            if (!response.ok) {
                throw new NodeHttpError(response.status, 'write')
            }
            const body: { revision?: unknown } = await response.json()
            if (typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0) {
                throw new StoreError('The Node server did not report the new revision of the key.')
            }
            return { version: body.revision }
        },

        async delete(key: string, condition: StoreCondition): Promise<void> {
            checkAddressable(key)
            checkCondition(condition, true)
            const outcome = await removeChunk([removeItemOf({ key, condition })])
            if (outcome.kind === 'conflict') {
                throw new StoreVersionConflictError(key, outcome.currentVersion)
            }
            if (outcome.kind !== 'removed') {
                throw outcome.error
            }
        },

        async deleteMany(entries: readonly DeleteEntry[]): Promise<void> {
            for (const entry of entries) {
                checkAddressable(entry.key)
                checkCondition(entry.condition, true)
            }
            checkNoDuplicateKeys(entries)
            const report: DeleteReportEntry[] = entries.map((entry) => ({ key: entry.key, outcome: 'unchanged' }))
            const reportOf = new Map(report.map((entry) => [entry.key, entry]))
            // Requests run in order. After one fails the rest are not attempted, so
            // their keys stay `unchanged`.
            for (const chunk of chunksOf(entries.map(removeItemOf))) {
                const outcome = await removeChunk(chunk)
                if (outcome.kind === 'removed') {
                    for (const item of chunk) {
                        reportOf.get(item.key).outcome = 'removed'
                    }
                    continue
                }
                if (outcome.kind === 'conflict') {
                    const entry = outcome.key === null ? undefined : reportOf.get(outcome.key)
                    if (entry !== undefined) {
                        entry.outcome = 'conflict'
                        entry.currentVersion = outcome.currentVersion
                    }
                } else {
                    for (const item of chunk) {
                        const entry = reportOf.get(item.key)
                        entry.outcome = outcome.kind === 'unknown' ? 'unknown' : 'unchanged'
                        entry.error = outcome.error
                    }
                }
                break
            }
            if (report.some((entry) => entry.outcome !== 'removed')) {
                throw new StoreDeleteManyError(report)
            }
        },

        async list(prefix: string): Promise<string[]> {
            checkAddressable(prefix)
            const response = await send('/api/list', { method: 'GET', headers: {} })
            if (!response.ok) {
                throw new NodeHttpError(response.status, 'list')
            }
            const body: { content?: unknown } = await response.json()
            if (!Array.isArray(body.content)) {
                throw new StoreError('The Node server did not answer with a list of names.')
            }
            // The server decodes hex names case-insensitively, so two files whose
            // names differ only in hex letter case arrive as the same key.
            const keys = new Set<string>()
            for (const name of body.content) {
                if (typeof name === 'string' && name.startsWith(prefix)) {
                    keys.add(name)
                }
            }
            return Array.from(keys)
        },

        async has(key: string): Promise<boolean> {
            checkAddressable(key)
            return (await readState(key, 'HEAD')).exists
        },
    }
}

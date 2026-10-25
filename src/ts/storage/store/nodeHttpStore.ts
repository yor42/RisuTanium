import type { ByteStore, CheckOnlyEntry, DeleteEntry, GuardedCapabilities, GuardedOperations, PieceSource, PieceWriter, ReadResult, StoreCondition, WriteResult } from './contract'
import {
    ServerLacksCapabilityError,
    StoreCheckListTooLongError,
    StoreDeleteManyError,
    StoreError,
    StoreInvalidConditionError,
    StoreInvalidKeyError,
    StoreOutcomeUnknownError,
    StoreValueChangedError,
    StoreVersionConflictError,
    UploadCapacityError,
    UploadGoneError,
    type DeleteReportEntry,
} from './errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys, versionOf } from './guards'
import { STORE2_PREFIX, isStore2Key, nodeAddressableViolation, nodeAssetRouteViolation, nodeCreatableViolation } from './keyRules'

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
 * - `/api/write-checked`, `/api/remove-checked` and `/api/caps` are the guarded
 *   routes behind `guarded`: a write or removal that also compares other keys'
 *   revisions in the same step, a removal that can also retire the keys, and the
 *   server's capabilities. Every guarded answer carries `risu-storage-guarded: 1`,
 *   a numeric revision and an echo of the checks it enforced; the client counts
 *   what it sent in `check-only-count` and `retire-count`. Anything else (a 404
 *   from an older server, an HTML page or a 405 from a proxy, a redirect, an
 *   answer without the marker or with the wrong echo) is refused with
 *   `ServerLacksCapabilityError`, and the client never falls back to the
 *   original routes.
 * - `/api/asset/<hex>` serves an `assets/` key or an inlay body key to a web view that cannot send a
 *   header: the token rides in the query, so `urlFor` builds the whole URL from
 *   the key alone and reads nothing.
 * - `/api/upload/begin|append|commit|abort` and `/api/read-range` move an asset
 *   key or an inlay body key in pieces, so neither side holds a value of up to
 *   the asset limit whole in one request. The store uses them only while the
 *   server's `/api/caps` says `pieces` (recorded from every successful probe
 *   answer, cleared by a refused probe or by an upload route or the ranged read route answering 404);
 *   otherwise `openWriter` and `writeBlob` collect the value and send it in one
 *   `/api/write`, so an older or upstream server never sees an upload route. An
 *   append is sent at the offset the server acknowledged, which makes a re-send
 *   after a lost answer harmless; a commit is re-sent once and its outcome, when
 *   still unknown, is settled by `has` for a create-if-absent commit and is
 *   `StoreOutcomeUnknownError` for a replacing one.
 * - `/api/list` answers the decoded names of the files whose names are whole,
 *   even-length hex (case-insensitive). Write temps, the revision file and the
 *   server's other files are not in it. Two files whose hex differs only in
 *   letter case decode to the same key, which `list` returns once.
 * - `/api/list-prefix?prefix=<hex>` answers the same names restricted to a hex
 *   prefix; `list` uses it and filters every answer again by `startsWith`, so a
 *   server that ignores the prefix still yields the right keys. With `&count=1`
 *   it answers only `count`, which is what `countPrefix` reads. A 401, 403 or
 *   429 rejects. A 5xx or a 400 (the server's own answer to a refused token, so
 *   it says nothing about the route) falls back to `/api/list` for that call
 *   only and is not remembered. A server without the route (404, 405, a page or
 *   any other shape) is remembered for the store's lifetime: `list` then falls
 *   back to `/api/list`, and `countPrefix` answers `null` (cannot count cheaply,
 *   never zero) without listing.
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

/** The header the server's guarded routes answer with. */
const GUARDED_MARKER_HEADER = 'risu-storage-guarded'

/**
 * The most check-only keys one guarded request carries. The server's header
 * limit holds about 64 keys of the longest size; proxies hold fewer, so a list
 * that does not fit meets a 431 or a reset, which are typed errors.
 */
const CHECK_ONLY_MAX_KEYS = 60

/** The most bytes the key and revision headers of one guarded request carry together; the same budget as a remove request. */
const GUARDED_HEADER_BYTES = REQUEST_KEY_BYTES

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface NodeHttpStoreOptions {
    /** The value of the `risu-auth` header, produced fresh for each request. May reject; the request is then not sent. */
    authHeader: () => Promise<string>
    /**
     * The asset-read token that goes in the query of an asset URL. The store
     * offers `urlFor` only when this is given; without it a caller reads bytes.
     */
    assetToken?: () => Promise<string>
    /** Defaults to the global `fetch`, looked up per call. */
    fetch?: FetchLike
    /** Prepended to every endpoint path; defaults to the page's own origin. */
    baseUrl?: string
    /**
     * The bytes of one upload chunk and of one ranged read; defaults to
     * `NODE_PIECE_BYTES`. Never above the server's chunk limit.
     */
    pieceBytes?: number
    /** Budget for the keys and revisions of one remove request; defaults to the production figure. */
    requestKeyBytes?: number
    /** The most check-only keys one guarded request carries; defaults to the production figure. */
    maxCheckOnlyKeys?: number
    /** The most bytes the key and revision headers of one guarded request carry together; defaults to the production figure. */
    guardedHeaderBytes?: number
    /** Waits `ms` between a rate-limited request and its retry; defaults to a timer. */
    sleep?: (ms: number) => Promise<void>
    /** The clock, in milliseconds, that bounds the total time one call spends on rate-limit retries; defaults to `Date.now`. */
    now?: () => number
}

/**
 * The default bytes of one upload chunk or ranged read. Must not exceed
 * `NODE_UPLOAD_CHUNK_MAX_BYTES` in `server/node/bodyLimit.cjs`, which the server
 * enforces per request; a test pins the two.
 */
export const NODE_PIECE_BYTES = 8 * 1024 * 1024

/** What one upload request came to: it never reached an answer, or it did. */
type UploadReply =
    | { kind: 'network', error: unknown }
    | { kind: 'answer', status: number, body: unknown }

/** An upload id as the server issues it. */
const UPLOAD_ID_PATTERN = /^[0-9a-f]{32}$/

/** The non-negative safe integer under `name` in a JSON object answer, or `null`. */
function countField(body: unknown, name: string): number | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return null
    }
    const value = (body as Record<string, unknown>)[name]
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Whether an error answer is the server's own JSON failure (`error` and `code`
 * strings, as its upload routes answer after the handler ran and failed), and
 * not a proxy's page or an empty gateway answer.
 */
function isServerFailureBody(body: unknown): boolean {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return false
    }
    const { error, code } = body as { error?: unknown, code?: unknown }
    return typeof error === 'string' && typeof code === 'string'
}

function codeOfBody(body: unknown): string | null {
    const code = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as { code?: unknown }).code : undefined
    return typeof code === 'string' ? code : null
}

/** The pieces joined into one array; a single piece is returned as it is. */
function joinPieces(parts: readonly Uint8Array[]): Uint8Array {
    if (parts.length === 1) {
        return parts[0]
    }
    const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        whole.set(part, at)
        at += part.length
    }
    return whole
}

/** One ranged answer: the piece and what the server says about the whole value it was cut from. */
interface RangePiece {
    exists: boolean
    revision: number
    size: number
    bytes: Uint8Array
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
    constructor(public readonly status: number, public readonly operation: string, public readonly detail: NodeErrorDetail | null = null) {
        super(`The Node server answered ${status} to ${operation}.${detail === null ? '' : ` ${[detail.code, detail.message].filter((part) => part !== undefined).join(': ')}`}`)
        this.name = 'NodeHttpError'
    }
}

/** What a server error answer says about itself: the `code` and `message` of its JSON body, when it has them. For error details and logs only. */
export interface NodeErrorDetail {
    code?: string
    message?: string
}

const ERROR_DETAIL_FIELD_CAP = 500

function errorDetailOfBody(body: unknown): NodeErrorDetail | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return null
    }
    const { code, message } = body as { code?: unknown, message?: unknown }
    const detail: NodeErrorDetail = {}
    if (typeof code === 'string') {
        detail.code = code.slice(0, ERROR_DETAIL_FIELD_CAP)
    }
    if (typeof message === 'string') {
        detail.message = message.slice(0, ERROR_DETAIL_FIELD_CAP)
    }
    return detail.code === undefined && detail.message === undefined ? null : detail
}

/** The detail of an unparsed error answer; an answer that is not a JSON object (a proxy's page, an empty body) has none. */
async function errorDetailOf(response: Response): Promise<NodeErrorDetail | null> {
    try {
        return errorDetailOfBody(JSON.parse(await response.text()))
    } catch {
        return null
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
    const maxCheckOnlyKeys = options.maxCheckOnlyKeys ?? CHECK_ONLY_MAX_KEYS
    const guardedHeaderBytes = options.guardedHeaderBytes ?? GUARDED_HEADER_BYTES
    const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
    const pieceBytes = options.pieceBytes ?? NODE_PIECE_BYTES

    /**
     * Whether the server takes chunked uploads and ranged reads, as its last
     * successful `/api/caps` answer said. False until a probe answered; a probe
     * the server refuses, or an upload or ranged route that answers 404, clears
     * it; a probe that fails in transit leaves it as it was.
     */
    let piecesRecorded = false

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

    /** What a guarded request carries and expects back: the counts it echoes and the keys a 409 may name. */
    interface GuardedCall {
        operation: 'write-checked' | 'remove-checked' | 'caps'
        capability: 'check-only' | 'retire' | 'caps'
        method: 'GET' | 'POST'
        headers: Record<string, string>
        body?: Uint8Array<ArrayBuffer>
        /** Check-only entries sent; the echo must equal it. `null` for a call that sends no counts (`caps`). */
        checkOnlyCount: number | null
        /** Own keys that carry a version condition; the echo must equal it. Unused when `checkOnlyCount` is `null`. */
        ownConditionCount: number
        /** Keys retired; the echo of a remove must equal it. `null` when the call is not a remove. */
        retiredCount: number | null
        /** Hex of every key the request named, mapped back to the key for a conflict. */
        keysByHex: Map<string, string>
        /** Hex of the removed keys, whose `revisions` entries the answer must carry. */
        removedHex: readonly string[]
        /** The number of keys in the headers, for the list-too-long errors. */
        keyCount: number
    }

    type GuardedAnswer =
        | { kind: 'ok', body: Record<string, unknown> }
        | { kind: 'conflict', hex: string | null, currentVersion: number | null }

    /**
     * One guarded request and the proof that it was applied as asked. Does not
     * go through `send`: the redirect is never followed (a followed 307 would
     * replay the request on an unguarded route), and whether the request left
     * is tracked so a failure before it left is told from one after.
     */
    async function guardedRequest(call: GuardedCall): Promise<GuardedAnswer> {
        const lacks = (observed: string, mayHaveApplied: boolean) => new ServerLacksCapabilityError(call.capability, observed, mayHaveApplied)
        let requestSent = false
        let response: Response
        try {
            response = await retryOnRateLimit(async () => {
                requestSent = false
                const auth = await options.authHeader()
                requestSent = true
                return await doFetch(`${baseUrl}/api/${call.operation}`, {
                    method: call.method,
                    cache: 'no-store',
                    redirect: 'manual',
                    headers: { ...call.headers, 'risu-auth': auth },
                    body: call.body,
                })
            })
        } catch (error) {
            if (!requestSent) {
                throw error
            }
            throw new StoreOutcomeUnknownError(call.operation, error)
        }
        if (response.status === 431) {
            throw new StoreCheckListTooLongError(call.keyCount, true, false)
        }
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
            throw lacks(`redirect ${response.status}`, false)
        }
        if (response.headers.get(GUARDED_MARKER_HEADER) !== '1') {
            if (response.ok) {
                // The repository's own server and service worker never answer a guarded route with an HTML page, so a
                // page is a front end's fallback and the guarded handler did not answer. An intermediary that forwards
                // the request and then substitutes a page for the upstream answer is outside what this check covers.
                // Any other 2xx without the marker may be the real handler's answer with the marker lost on the way.
                const isPage = (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')
                throw lacks(`${response.status} without the guarded marker`, call.operation !== 'caps' && !isPage)
            }
            if (response.status === 404 || response.status === 405 || response.status === 501 || response.status === 409) {
                throw lacks(String(response.status), false)
            }
            throw new NodeHttpError(response.status, call.operation, await errorDetailOf(response))
        }
        let parsed: unknown = null
        try {
            parsed = await response.json()
        } catch {
            parsed = null
        }
        const body: Record<string, unknown> | null = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
        if (response.status === 400 && body?.code === 'guarded-count') {
            throw lacks('a check-only, retire or own-condition header was lost in transit (400)', false)
        }
        if (response.status === 409) {
            const hex = typeof body?.filePath === 'string' ? body.filePath.toLowerCase() : null
            const currentVersion = typeof body?.currentRevision === 'number' ? body.currentRevision : null
            return { kind: 'conflict', hex, currentVersion }
        }
        if (!response.ok) {
            throw new NodeHttpError(response.status, call.operation, errorDetailOfBody(body))
        }
        // Only a read-only answer is exempt from the mayHaveApplied flag below: a probe applies nothing.
        const refusedAnswer = (observed: string) => lacks(observed, call.operation !== 'caps')
        if (body === null) {
            throw refusedAnswer('the answer is not a JSON object')
        }
        if (call.checkOnlyCount === null) {
            return { kind: 'ok', body }
        }
        const revision = body.revision
        if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
            throw refusedAnswer('marker without a numeric revision')
        }
        if (body.checkOnly !== call.checkOnlyCount) {
            throw refusedAnswer('check-only not applied')
        }
        if (body.ownCondition !== call.ownConditionCount) {
            throw refusedAnswer('own condition not applied')
        }
        if (call.retiredCount !== null) {
            if (body.retired !== call.retiredCount) {
                throw new ServerLacksCapabilityError('retire', 'retire not applied', true)
            }
            const revisions = body.revisions
            if (typeof revisions !== 'object' || revisions === null || call.removedHex.some((hex) => typeof (revisions as Record<string, unknown>)[hex] !== 'number')) {
                throw refusedAnswer('marker without the revisions of the removed keys')
            }
        }
        return { kind: 'ok', body }
    }

    function checkOnlyHeaders(checkOnly: readonly CheckOnlyEntry[]): Record<string, string> {
        const headers: Record<string, string> = { 'check-only-count': String(checkOnly.length) }
        if (checkOnly.length > 0) {
            headers['check-only-path'] = checkOnly.map((entry) => hexOf(entry.key)).join('$$')
            headers['check-only-revision'] = checkOnly.map((entry) => String(entry.version)).join('$$')
        }
        return headers
    }

    /** Refuses a check-only list that is malformed, repeats a key, or names a key the request itself writes or removes. */
    function checkCheckOnly(checkOnly: readonly CheckOnlyEntry[], ownKeys: readonly string[]): void {
        const seen = new Set<string>(ownKeys)
        for (const entry of checkOnly) {
            checkAddressable(entry.key)
            if (typeof entry.version !== 'number' || !Number.isSafeInteger(entry.version) || entry.version < 0) {
                throw new StoreInvalidConditionError('a check-only version is a non-negative integer')
            }
            if (seen.has(entry.key)) {
                throw new StoreInvalidKeyError(entry.key, 'a check-only key is listed once and is not also a written or removed key')
            }
            seen.add(entry.key)
        }
    }

    /** Refuses a request whose key lists cannot fit one request, before anything is sent. */
    function checkListFits(keyCount: number, headerValues: readonly string[]): void {
        const bytes = headerValues.reduce((sum, value) => sum + value.length, 0)
        if (keyCount > maxCheckOnlyKeys || bytes > guardedHeaderBytes) {
            throw new StoreCheckListTooLongError(keyCount, false, false)
        }
    }

    function keyOfHex(call: GuardedCall, hex: string | null, fallback: string): string {
        if (hex === null) {
            return fallback
        }
        return call.keysByHex.get(hex) ?? fallback
    }

    async function guardedRemove(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[], retire: boolean): Promise<void> {
        if (entries.length === 0) {
            throw new StoreInvalidKeyError('', 'a guarded remove names at least one key')
        }
        for (const entry of entries) {
            checkAddressable(entry.key)
            checkCondition(entry.condition, true)
            if (retire && !isStore2Key(entry.key)) {
                throw new StoreInvalidKeyError(entry.key, `retire reaches only keys under ${STORE2_PREFIX}`)
            }
        }
        checkNoDuplicateKeys(entries)
        if (retire && checkOnly.length === 0) {
            throw new StoreInvalidConditionError('retire needs at least one check-only entry')
        }
        checkCheckOnly(checkOnly, entries.map((entry) => entry.key))
        const items = entries.map(removeItemOf)
        const headers: Record<string, string> = {
            'file-path': items.map((item) => item.hex).join('$$'),
            ...checkOnlyHeaders(checkOnly),
            'retire-count': retire ? String(entries.length) : '0',
            'own-condition-count': String(items.filter((item) => item.version !== null).length),
        }
        if (retire) {
            headers.retire = '1'
        }
        if (items.some((item) => item.version !== null)) {
            headers['if-match-revision'] = items.map((item) => item.version === null ? '' : String(item.version)).join('$$')
        }
        const keyCount = entries.length + checkOnly.length
        checkListFits(keyCount, [headers['file-path'], headers['check-only-path'] ?? '', headers['check-only-revision'] ?? '', headers['if-match-revision'] ?? ''])
        const call: GuardedCall = {
            operation: 'remove-checked',
            capability: retire ? 'retire' : 'check-only',
            method: 'GET',
            headers,
            checkOnlyCount: checkOnly.length,
            ownConditionCount: items.filter((item) => item.version !== null).length,
            retiredCount: retire ? entries.length : 0,
            keysByHex: new Map([...items.map((item) => [item.hex, item.key] as const), ...checkOnly.map((entry) => [hexOf(entry.key), entry.key] as const)]),
            removedHex: items.map((item) => item.hex),
            keyCount,
        }
        const answer = await guardedRequest(call)
        if (answer.kind === 'conflict') {
            // An empty key says the server named a key this request did not send.
            throw new StoreVersionConflictError(keyOfHex(call, answer.hex, ''), answer.currentVersion)
        }
    }

    const guarded: GuardedOperations = {
        async probe(): Promise<GuardedCapabilities> {
            let answer: GuardedAnswer
            try {
                answer = await guardedRequest({
                    operation: 'caps',
                    capability: 'caps',
                    method: 'GET',
                    headers: {},
                    checkOnlyCount: null,
                    ownConditionCount: 0,
                    retiredCount: null,
                    keysByHex: new Map(),
                    removedHex: [],
                    keyCount: 0,
                })
            } catch (error) {
                if (error instanceof ServerLacksCapabilityError) {
                    piecesRecorded = false
                }
                throw error
            }
            const body = answer.kind === 'ok' ? answer.body : {}
            // Flags the client does not know are ignored; the three it uses must be present and boolean.
            if (typeof body.checkOnly !== 'boolean' || typeof body.retire !== 'boolean' || typeof body.pieces !== 'boolean') {
                piecesRecorded = false
                throw new ServerLacksCapabilityError('caps', 'the answer lacks a boolean checkOnly, retire or pieces flag', false)
            }
            piecesRecorded = body.pieces
            return { checkOnly: body.checkOnly, retire: body.retire, pieces: body.pieces }
        },

        async writeChecked(key: string, bytes: Uint8Array, condition: StoreCondition, checkOnly: readonly CheckOnlyEntry[]): Promise<WriteResult> {
            const reason = nodeAddressableViolation(key) ?? nodeCreatableViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, true)
            checkBytes(bytes)
            checkCheckOnly(checkOnly, [key])
            const headers: Record<string, string> = {
                'content-type': 'application/octet-stream',
                'file-path': hexOf(key),
                ...checkOnlyHeaders(checkOnly),
                'own-condition-count': versionOf(condition) === null ? '0' : '1',
            }
            const ifVersion = versionOf(condition)
            if (ifVersion !== null) {
                headers['if-match-revision'] = String(ifVersion)
            }
            checkListFits(checkOnly.length, [headers['check-only-path'] ?? '', headers['check-only-revision'] ?? ''])
            const call: GuardedCall = {
                operation: 'write-checked',
                capability: 'check-only',
                method: 'POST',
                headers,
                body: bytes as Uint8Array<ArrayBuffer>,
                checkOnlyCount: checkOnly.length,
                ownConditionCount: versionOf(condition) === null ? 0 : 1,
                retiredCount: null,
                keysByHex: new Map(checkOnly.map((entry) => [hexOf(entry.key), entry.key] as const)),
                removedHex: [],
                keyCount: checkOnly.length,
            }
            const answer = await guardedRequest(call)
            if (answer.kind === 'conflict') {
                // A conflict without a check-only key's name is the written key's own.
                throw new StoreVersionConflictError(keyOfHex(call, answer.hex, key), answer.currentVersion)
            }
            return { version: answer.body.revision as number }
        },

        async removeChecked(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[]): Promise<void> {
            await guardedRemove(entries, checkOnly, false)
        },

        async retireChecked(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[]): Promise<void> {
            await guardedRemove(entries, checkOnly, true)
        },
    }

    /** Set once the server has shown it lacks `/api/list-prefix`; later lists go straight to `/api/list`. */
    let listPrefixUnsupported = false

    /**
     * An auth failure or a rate limit that outlasted the retries is the caller's
     * error, not a missing route. The repository's server refuses a token with
     * 400, which `listByPrefixRoute` therefore must not remember either.
     */
    function isAuthOrRateRefusal(status: number): boolean {
        return status === 401 || status === 403 || status === 429
    }

    async function jsonObjectOf(response: Response): Promise<Record<string, unknown> | null> {
        try {
            const parsed: unknown = await response.json()
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
        } catch {
            return null
        }
    }

    /**
     * The names `/api/list-prefix` answers for `prefix`, or `null` when the
     * server does not offer the route (any other status, a page, another shape),
     * in which case the caller lists everything. The names are unfiltered:
     * the caller re-filters them. A missing route is remembered; a 5xx and a
     * 400 are not, since a refused token or a transient fault may pass.
     */
    async function listByPrefixRoute(prefix: string): Promise<unknown[] | null> {
        const response = await send(`/api/list-prefix?prefix=${hexOf(prefix)}`, { method: 'GET', headers: {} })
        if (isAuthOrRateRefusal(response.status)) {
            throw new NodeHttpError(response.status, 'list')
        }
        const body = response.ok ? await jsonObjectOf(response) : null
        if (body !== null && body.success === true && Array.isArray(body.content)) {
            return body.content
        }
        if (response.status < 500 && response.status !== 400) {
            listPrefixUnsupported = true
        }
        return null
    }

    /**
     * One upload request. A failure to get an answer (including a body that
     * stops arriving) is `network`: the request may or may not have been applied.
     */
    async function uploadRequest(route: string, headers: Record<string, string>, body?: Uint8Array): Promise<UploadReply> {
        try {
            const response = await send(route, { method: 'POST', headers, body: body as Uint8Array<ArrayBuffer> | undefined })
            let parsed: unknown = null
            const text = await response.text()
            try {
                parsed = JSON.parse(text)
            } catch {
                parsed = null
            }
            return { kind: 'answer', status: response.status, body: parsed }
        } catch (error) {
            return { kind: 'network', error }
        }
    }

    /** The typed error of an upload answer that is not a success; a 404 also clears the capability record. */
    function uploadAnswerError(reply: { status: number, body: unknown }, operation: string): Error {
        if (reply.status === 410) {
            return new UploadGoneError(operation)
        }
        if (reply.status === 503 && codeOfBody(reply.body) === 'upload-capacity') {
            return new UploadCapacityError()
        }
        if (reply.status === 404) {
            piecesRecorded = false
        }
        return new NodeHttpError(reply.status, operation, errorDetailOfBody(reply.body))
    }

    /** A failure the same request may be re-sent after: no answer, or a 5xx that is not the server's own JSON failure. */
    function isResendable(reply: UploadReply): boolean {
        return reply.kind === 'network' || (reply.status >= 500 && !isServerFailureBody(reply.body) && !(reply.status === 503 && codeOfBody(reply.body) === 'upload-capacity'))
    }

    /** What a piece writer does with the value it is handed: send chunks to the upload routes, or collect it for one single-body write. */
    interface ValueWriter {
        write(data: Uint8Array): Promise<void>
        finish(finalKey?: string): Promise<WriteResult>
        abort(): Promise<void>
    }

    /**
     * A writer for one value. Refuses an unusable `key` before any request. With
     * `pieces` recorded and an asset-route key it uploads (begin on the first
     * chunk, append at the acknowledged offset, commit); in every other case,
     * and when the server turns out to lack the upload routes at `begin`, it
     * collects the pieces and writes the value in one request.
     */
    function createValueWriter(key: string): ValueWriter {
        const keyReason = nodeAddressableViolation(key) ?? nodeCreatableViolation(key)
        if (keyReason !== null) {
            throw new StoreInvalidKeyError(key, keyReason)
        }
        let mode = 'undecided' as 'undecided' | 'upload' | 'collect'
        let uploadId: string | null = null
        let acknowledged = 0
        let pending: Uint8Array[] = []
        let pendingBytes = 0
        const collected: Uint8Array[] = []
        let over: { error: unknown } | null = null
        let done: WriteResult | null = null

        function decideMode(): void {
            if (mode === 'undecided') {
                mode = piecesRecorded && nodeAssetRouteViolation(key) === null ? 'upload' : 'collect'
            }
        }

        async function sendAbort(): Promise<void> {
            const id = uploadId
            uploadId = null
            if (id !== null) {
                await uploadRequest('/api/upload/abort', { 'upload-id': id })
            }
        }

        /** Ends the writer after a failure: the upload is abandoned and every later call rejects with the same error. */
        async function fail(error: unknown): Promise<never> {
            over = { error }
            pending = []
            pendingBytes = 0
            collected.length = 0
            await sendAbort()
            throw error
        }

        /** Opens the upload on first use. False when the server has no upload routes: nothing was sent, so the writer collects instead. */
        async function ensureBegun(): Promise<boolean> {
            if (uploadId !== null) {
                return true
            }
            const reply = await uploadRequest('/api/upload/begin', {})
            if (reply.kind === 'network') {
                throw reply.error
            }
            if (reply.status === 404) {
                piecesRecorded = false
                mode = 'collect'
                collected.push(...pending)
                pending = []
                pendingBytes = 0
                return false
            }
            if (reply.status !== 200) {
                throw uploadAnswerError(reply, 'upload-begin')
            }
            const id = typeof reply.body === 'object' && reply.body !== null ? (reply.body as { id?: unknown }).id : undefined
            if (typeof id !== 'string' || !UPLOAD_ID_PATTERN.test(id)) {
                throw new StoreError('The Node server did not issue an upload id.')
            }
            uploadId = id
            return true
        }

        /** Removes the first `length` pending bytes; a piece large enough is cut as a view, without a copy. */
        function takePending(length: number): Uint8Array {
            const first = pending[0]
            if (first.length >= length) {
                if (first.length === length) {
                    pending.shift()
                } else {
                    pending[0] = first.subarray(length)
                }
                pendingBytes -= length
                return first.subarray(0, length)
            }
            const chunk = new Uint8Array(length)
            let at = 0
            while (at < length) {
                const piece = pending[0]
                const take = Math.min(piece.length, length - at)
                chunk.set(piece.subarray(0, take), at)
                at += take
                if (take === piece.length) {
                    pending.shift()
                } else {
                    pending[0] = piece.subarray(take)
                }
            }
            pendingBytes -= length
            return chunk
        }

        /** Appends `chunk` at the acknowledged offset; a failure to get an answer, or a 5xx that is not the server's own failure, is re-sent once. */
        async function appendChunk(chunk: Uint8Array): Promise<void> {
            const headers = { 'content-type': 'application/octet-stream', 'upload-id': uploadId as string, 'upload-offset': String(acknowledged) }
            let lastFailure: unknown = null
            for (let attempt = 1; attempt <= 2; attempt++) {
                const reply = await uploadRequest('/api/upload/append', headers, chunk)
                if (reply.kind === 'answer' && reply.status === 200) {
                    const size = countField(reply.body, 'size')
                    if (size !== acknowledged + chunk.length) {
                        throw new StoreError('The Node server did not acknowledge the upload chunk.')
                    }
                    acknowledged = size
                    return
                }
                if (isResendable(reply)) {
                    lastFailure = reply.kind === 'network' ? reply.error : uploadAnswerError(reply, 'upload-append')
                    continue
                }
                throw uploadAnswerError(reply as { status: number, body: unknown }, 'upload-append')
            }
            throw lastFailure
        }

        /** Sends the pending bytes in whole chunks (`all` also sends the last, shorter one). False when the writer fell back to collecting. */
        async function drainPending(all: boolean): Promise<boolean> {
            while (pendingBytes >= pieceBytes || (all && pendingBytes > 0)) {
                if (!await ensureBegun()) {
                    return false
                }
                await appendChunk(takePending(Math.min(pieceBytes, pendingBytes)))
            }
            return true
        }

        /**
         * The commit of the staged value under `target`. `ifAbsent` keeps an
         * existing value (the key is content-addressed). A commit whose answer was
         * lost is re-sent once; the server answers the re-send with the first
         * outcome. What is still unknown after that is settled by `has` for
         * `ifAbsent` and is `StoreOutcomeUnknownError` for a replacing commit.
         */
        async function commitUpload(target: string, ifAbsent: boolean): Promise<WriteResult> {
            const headers: Record<string, string> = { 'upload-id': uploadId as string, 'file-path': hexOf(target), 'upload-size': String(acknowledged) }
            if (ifAbsent) {
                headers['upload-if-absent'] = '1'
            }
            let cause: unknown = null
            for (let attempt = 1; attempt <= 2; attempt++) {
                const reply = await uploadRequest('/api/upload/commit', headers)
                if (reply.kind === 'answer' && reply.status === 200) {
                    const revision = countField(reply.body, 'revision')
                    if (revision === null) {
                        throw new StoreError('The Node server did not report the new revision of the key.')
                    }
                    return { version: revision }
                }
                if (reply.kind === 'answer' && reply.status === 410) {
                    cause = new UploadGoneError('upload-commit')
                    break
                }
                if (isResendable(reply)) {
                    cause = reply.kind === 'network' ? reply.error : uploadAnswerError(reply, 'upload-commit')
                    continue
                }
                throw uploadAnswerError(reply as { status: number, body: unknown }, 'upload-commit')
            }
            if (ifAbsent) {
                let present: boolean
                try {
                    present = await store.has(target)
                } catch (error) {
                    throw new StoreOutcomeUnknownError('upload commit', error)
                }
                if (present) {
                    // The key holds a value, so nothing needs the staged bytes; the commit may never have reached the server.
                    await sendAbort()
                    return { version: null }
                }
                if (cause instanceof UploadGoneError) {
                    throw cause
                }
            }
            throw new StoreOutcomeUnknownError('upload commit', cause)
        }

        return {
            async write(data: Uint8Array): Promise<void> {
                if (over !== null) {
                    throw over.error
                }
                if (done !== null) {
                    throw new StoreError('The piece writer is finished.')
                }
                try {
                    decideMode()
                    if (data.length === 0) {
                        return
                    }
                    if (mode === 'collect') {
                        collected.push(data)
                        return
                    }
                    pending.push(data)
                    pendingBytes += data.length
                    await drainPending(false)
                } catch (error) {
                    await fail(error)
                }
            },

            async finish(finalKey?: string): Promise<WriteResult> {
                if (over !== null) {
                    throw over.error
                }
                if (done !== null) {
                    return done
                }
                try {
                    let target = key
                    if (finalKey !== undefined) {
                        const finalReason = nodeAddressableViolation(finalKey) ?? nodeCreatableViolation(finalKey)
                        if (finalReason !== null) {
                            throw new StoreInvalidKeyError(finalKey, finalReason)
                        }
                        target = finalKey
                    }
                    decideMode()
                    let result: WriteResult | null = null
                    if (mode === 'upload') {
                        const routeReason = nodeAssetRouteViolation(target)
                        if (routeReason !== null) {
                            throw new StoreInvalidKeyError(target, routeReason)
                        }
                        if (await drainPending(true) && (uploadId !== null || await ensureBegun())) {
                            result = await commitUpload(target, finalKey !== undefined)
                        }
                    }
                    if (result === null) {
                        // Collecting: by choice, or because the server has no upload routes.
                        if (finalKey !== undefined && await store.has(target)) {
                            result = { version: null }
                        } else {
                            result = await store.write(target, collected.length === 0 ? new Uint8Array(0) : joinPieces(collected), 'unconditional')
                        }
                    }
                    done = result
                    uploadId = null
                    return result
                } catch (error) {
                    return await fail(error)
                }
            },

            async abort(): Promise<void> {
                if (over !== null || done !== null) {
                    return
                }
                over = { error: new StoreError('The piece writer was aborted.') }
                pending = []
                pendingBytes = 0
                collected.length = 0
                await sendAbort()
            },
        }
    }

    /** One ranged answer for `key` from `start`. A 404 means the server lacks the route: the record is cleared. */
    async function rangeRequest(key: string, start: number): Promise<RangePiece> {
        const response = await send('/api/read-range', {
            method: 'GET',
            headers: { 'file-path': hexOf(key), 'range-start': String(start), 'range-length': String(pieceBytes) },
        })
        if (!response.ok) {
            if (response.status === 404) {
                piecesRecorded = false
            }
            throw new NodeHttpError(response.status, 'read-range', await errorDetailOf(response))
        }
        const revision = asRevision(response.headers.get('x-risu-revision'))
        const size = asRevision(response.headers.get('x-risu-size'))
        const existsHeader = response.headers.get('x-risu-exists')
        if (revision === null || size === null || (existsHeader !== '1' && existsHeader !== '0')) {
            throw new StoreError('The Node server did not report the revision, size and existence of the key.')
        }
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (existsHeader === '1' && bytes.length !== Math.min(pieceBytes, Math.max(0, size - start))) {
            throw new StoreError('The Node server answered a ranged read with a piece of the wrong length.')
        }
        return { exists: existsHeader === '1', revision, size, bytes }
    }

    /** Whether `error` says the server has no ranged read route (and the record was cleared). */
    function isMissingRangeRoute(error: unknown): boolean {
        return error instanceof NodeHttpError && error.status === 404 && error.operation === 'read-range'
    }

    /**
     * The whole value assembled from ranged pieces. The first piece fixes the
     * revision and the size; a later piece that disagrees means the value
     * changed, and the assembly starts over, at most twice.
     */
    async function readRanged(key: string): Promise<ReadResult> {
        for (let attempt = 0; attempt <= 2; attempt++) {
            const first = await rangeRequest(key, 0)
            if (!first.exists) {
                return { bytes: null, version: first.revision }
            }
            if (first.bytes.length === first.size) {
                return { bytes: first.bytes, version: first.revision }
            }
            const whole = new Uint8Array(first.size)
            whole.set(first.bytes, 0)
            let at = first.bytes.length
            let changed = false
            while (at < first.size) {
                const piece = await rangeRequest(key, at)
                if (!piece.exists || piece.revision !== first.revision || piece.size !== first.size) {
                    changed = true
                    break
                }
                whole.set(piece.bytes, at)
                at += piece.bytes.length
            }
            if (!changed) {
                return { bytes: whole, version: first.revision }
            }
        }
        throw new StoreValueChangedError(key)
    }

    /** The pieces after `first`, each checked against the first piece's revision and size; never restarts. */
    async function* followingPieces(key: string, first: RangePiece): AsyncGenerator<Uint8Array> {
        if (first.bytes.length > 0) {
            yield first.bytes
        }
        let at = first.bytes.length
        while (at < first.size) {
            const piece = await rangeRequest(key, at)
            if (!piece.exists || piece.revision !== first.revision || piece.size !== first.size) {
                throw new StoreValueChangedError(key)
            }
            yield piece.bytes
            at += piece.bytes.length
        }
    }

    async function* viewsOf(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
        for (let at = 0; at < bytes.length; at += pieceBytes) {
            yield bytes.subarray(at, Math.min(bytes.length, at + pieceBytes))
        }
    }

    const store: ByteStore = {
        capabilities: { conditionalWrites: true },
        guarded,

        async read(key: string): Promise<ReadResult> {
            checkAddressable(key)
            if (piecesRecorded && nodeAssetRouteViolation(key) === null) {
                try {
                    return await readRanged(key)
                } catch (error) {
                    if (!isMissingRangeRoute(error)) {
                        throw error
                    }
                }
            }
            const { response, exists, version } = await readState(key, 'GET')
            const body = new Uint8Array(await response.arrayBuffer())
            return { bytes: exists ? body : null, version }
        },

        async readPieces(key: string): Promise<PieceSource | null> {
            checkAddressable(key)
            if (piecesRecorded && nodeAssetRouteViolation(key) === null) {
                try {
                    const first = await rangeRequest(key, 0)
                    if (!first.exists) {
                        return null
                    }
                    return { total: first.size, version: first.revision, pieces: followingPieces(key, first) }
                } catch (error) {
                    if (!isMissingRangeRoute(error)) {
                        throw error
                    }
                }
            }
            const { bytes, version } = await store.read(key)
            return bytes === null ? null : { total: bytes.length, version, pieces: viewsOf(bytes) }
        },

        openWriter(key: string): PieceWriter {
            const writer = createValueWriter(key)
            return {
                write: (data) => writer.write(data),
                finish: async (finalKey) => {
                    await writer.finish(finalKey)
                },
                abort: () => writer.abort(),
            }
        },

        async writeBlob(key: string, blob: Blob, condition: StoreCondition): Promise<WriteResult> {
            const reason = nodeAddressableViolation(key) ?? nodeCreatableViolation(key) ?? nodeAssetRouteViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, true)
            if (versionOf(condition) !== null || blob.size <= pieceBytes || !piecesRecorded) {
                return await store.write(key, new Uint8Array(await blob.arrayBuffer()), condition)
            }
            // Each slice is read before any request is made for it, so a read error
            // (a changed or vanished backup file) reaches the caller as it is and is
            // never mistaken for a transport failure or re-sent.
            const writer = createValueWriter(key)
            try {
                for (let start = 0; start < blob.size; start += pieceBytes) {
                    await writer.write(new Uint8Array(await blob.slice(start, start + pieceBytes).arrayBuffer()))
                }
                return await writer.finish()
            } catch (error) {
                await writer.abort()
                throw error
            }
        },

        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            const reason = nodeAddressableViolation(key) ?? nodeCreatableViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, true)
            checkBytes(bytes)
            if (piecesRecorded && versionOf(condition) === null && bytes.length > pieceBytes && nodeAssetRouteViolation(key) === null) {
                const writer = createValueWriter(key)
                try {
                    await writer.write(bytes)
                    return await writer.finish()
                } catch (error) {
                    // The caller's too-large handling names the single write.
                    if (error instanceof NodeHttpError && error.status === 413) {
                        throw new NodeHttpError(413, 'write', error.detail)
                    }
                    throw error
                }
            }
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
                throw new NodeHttpError(response.status, 'write', await errorDetailOf(response))
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
            let names = listPrefixUnsupported ? null : await listByPrefixRoute(prefix)
            if (names === null) {
                const response = await send('/api/list', { method: 'GET', headers: {} })
                if (!response.ok) {
                    throw new NodeHttpError(response.status, 'list')
                }
                const body: { content?: unknown } = await response.json()
                if (!Array.isArray(body.content)) {
                    throw new StoreError('The Node server did not answer with a list of names.')
                }
                names = body.content
            }
            // The server decodes hex names case-insensitively, so two files whose
            // names differ only in hex letter case arrive as the same key. Every
            // answer is filtered here whatever route produced it.
            const keys = new Set<string>()
            for (const name of names) {
                if (typeof name === 'string' && name.startsWith(prefix)) {
                    keys.add(name)
                }
            }
            return Array.from(keys)
        },

        async countPrefix(prefix: string): Promise<number | null> {
            if (prefix !== '') {
                checkAddressable(prefix)
            }
            if (listPrefixUnsupported) {
                return null
            }
            const response = await send(`/api/list-prefix?prefix=${hexOf(prefix)}&count=1`, { method: 'GET', headers: {} })
            if (isAuthOrRateRefusal(response.status)) {
                throw new NodeHttpError(response.status, 'count')
            }
            const body = response.ok ? await jsonObjectOf(response) : null
            const count = body?.success === true ? body.count : undefined
            return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null
        },

        async has(key: string): Promise<boolean> {
            checkAddressable(key)
            return (await readState(key, 'HEAD')).exists
        },
    }

    const assetToken = options.assetToken
    if (assetToken !== undefined) {
        store.urlFor = async (key: string): Promise<string> => {
            checkAddressable(key)
            const reason = nodeAssetRouteViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            return `${baseUrl}/api/asset/${hexOf(key)}?risu-auth=${encodeURIComponent(await assetToken())}`
        }
    }
    return store
}

/**
 * The writer of a `.bin` export on a Node-served page whose server advertises the streamed export
 * (`/api/caps` `exportStream`). The page still produces every byte of the container; this writer uploads them to a
 * staging file on the server in sequenced requests, asks the server to pin the files of the assets it lists (their
 * bodies never cross the page), and at `close` has the browser download the finished file from the server.
 *
 * Until the download is triggered nothing has reached the browser (`heldInMemory`), so a failure before it leaves no
 * file; after it a partial file may exist.
 */
import { ExportCancelledError } from "../exportCancel";
import type { SplicingExportWriter } from "../exportWriters";
import { retryOnRateLimit, retryTransientRequest } from "../storage/store/nodeHttpStore";
import { BackupAssetChangedError } from "./exportShell";

/** The server refused to stage the export (not enough space, or a configured limit): nothing was written. */
export class ExportStagingRefusedError extends Error {
    constructor(public readonly code: string | null) {
        super(`The server refused to stage the export${code === null ? '' : ` (${code})`}`)
        this.name = 'ExportStagingRefusedError'
    }
}

/** The export's job is no longer on the server (it was reaped or the server restarted). */
export class ExportServerGoneError extends Error {
    constructor(public readonly beforeDownload: boolean) {
        super('The server no longer holds this export')
        this.name = 'ExportServerGoneError'
    }
}

/** The server (or a proxy in front of it) answered a request in a way this client does not accept. */
export class ExportServerProtocolError extends Error {
    constructor(public readonly status: number | null, public readonly code: string | null, detail?: string) {
        super(`The export server answered unexpectedly${status === null ? '' : ` (${status}${code === null ? '' : ` ${code}`})`}${detail === undefined ? '' : `: ${detail}`}`)
        this.name = 'ExportServerProtocolError'
    }
}

/** The download the server was streaming did not complete; the browser may hold a partial file. */
export class ExportServerDownloadError extends Error {
    constructor(public readonly reason: string) {
        super(`The export download did not complete (${reason})`)
        this.name = 'ExportServerDownloadError'
    }
}

/** Bytes one append carries at most; pending writes are joined up to this size. */
export const EXPORT_APPEND_BYTES = 4 * 1024 * 1024
/** Milliseconds between two status reads while the browser downloads. */
export const EXPORT_POLL_INTERVAL_MS = 1000
/** Consecutive milliseconds of failing status reads after which the download is given up. */
export const EXPORT_POLL_ERROR_BUDGET_MS = 60_000
/** Milliseconds after the trigger within which the server must have started to stream. */
export const EXPORT_DOWNLOAD_START_MS = 60_000
const POLL_ERROR_BACKOFF_MIN_MS = 1000
const POLL_ERROR_BACKOFF_MAX_MS = 8000

export interface ServerExportBounds {
    appendBytes: number
    pollIntervalMs: number
    pollErrorBudgetMs: number
    downloadStartMs: number
}

export interface ServerExportWriterOptions {
    fetch: (url: string, init: RequestInit) => Promise<Response>
    authHeader: () => Promise<string>
    sleep: (ms: number) => Promise<void>
    now: () => number
    /**
     * Starts the browser's download of the finished file with the single-use `ticket`; the returned function is
     * called once the download has ended, and releases whatever the trigger put on the page.
     */
    trigger: (ticket: string) => (() => void) | void
    /** Runs before the finalize request; the place to ask for the click a download may need. */
    ensureActivation: () => Promise<void>
    onProgress: (sent: number, total: number) => void
    bounds?: Partial<ServerExportBounds>
}

function hexOfKey(key: string): string {
    let hex = ''
    for (const byte of new TextEncoder().encode(key)) {
        hex += byte.toString(16).padStart(2, '0')
    }
    return hex
}

async function errorCodeOf(response: Response): Promise<string | null> {
    try {
        const body: unknown = JSON.parse(await response.text())
        return typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : null
    } catch {
        return null
    }
}

function joined(parts: readonly Uint8Array[], length: number): Uint8Array {
    if (parts.length === 1) {
        return parts[0]
    }
    const whole = new Uint8Array(length)
    let at = 0
    for (const part of parts) {
        whole.set(part, at)
        at += part.length
    }
    return whole
}

interface StatusAnswer {
    state: string
    sent: number
    total: number
    failure: string | null
    key: string | null
}

function parseStatus(body: unknown): StatusAnswer | null {
    if (typeof body !== 'object' || body === null || !('state' in body) || typeof body.state !== 'string') {
        return null
    }
    const sent = 'sent' in body && typeof body.sent === 'number' ? body.sent : 0
    const total = 'total' in body && typeof body.total === 'number' ? body.total : 0
    const failure = 'failure' in body && typeof body.failure === 'string' ? body.failure : null
    const key = 'key' in body && typeof body.key === 'string' ? body.key : null
    return { state: body.state, sent, total, failure, key }
}

export class ServerExportWriter implements SplicingExportWriter {
    private seq = 0
    private pending: Uint8Array[] = []
    private pendingLength = 0
    private spliceAt: number | null = null
    private tail: Promise<unknown> = Promise.resolve()
    private triggered = false
    private closed = false
    private aborted = false
    private releaseTrigger: (() => void) | null = null
    private total = 0
    private readonly bounds: ServerExportBounds

    private constructor(private readonly id: string, private readonly options: ServerExportWriterOptions) {
        this.bounds = {
            appendBytes: EXPORT_APPEND_BYTES,
            pollIntervalMs: EXPORT_POLL_INTERVAL_MS,
            pollErrorBudgetMs: EXPORT_POLL_ERROR_BUDGET_MS,
            downloadStartMs: EXPORT_DOWNLOAD_START_MS,
            ...options.bounds,
        }
    }

    /**
     * Starts a job on the server for the file `fileName` (`.bin`, format version 1). A refusal throws before anything
     * exists on the server or in the browser. Begin creates a job on every call, so only a 429 (answered before the
     * handler runs) is sent again, never a transient failure.
     */
    static async open(fileName: string, options: ServerExportWriterOptions): Promise<ServerExportWriter> {
        const response = await ServerExportWriter.send(options, '/api/export/begin', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filename: fileName, format: 'bin', v: 1 }),
        }, null, () => false, false)
        await ServerExportWriter.refuseUnlessOk(response, true)
        let id: unknown
        try {
            const body: unknown = await response.json()
            id = typeof body === 'object' && body !== null && 'id' in body ? body.id : undefined
        } catch {
            id = undefined
        }
        if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) {
            throw new ExportServerProtocolError(response.status, null, 'no job id')
        }
        return new ServerExportWriter(id, options)
    }

    /** True until the download is triggered: a failed export leaves no file in the browser. */
    get heldInMemory(): boolean {
        return !this.triggered
    }

    private static async send(options: ServerExportWriterOptions, path: string, init: { method: string, headers: Record<string, string>, body?: BodyInit, keepalive?: boolean }, id: string | null, shouldStop: () => boolean = () => false, retryTransient = true): Promise<Response> {
        const attempt = async () => {
            if (shouldStop()) {
                throw new ExportCancelledError()
            }
            const auth = await options.authHeader()
            const headers = { ...init.headers, 'risu-auth': auth, ...(id === null ? {} : { 'export-id': id }) }
            return await options.fetch(path, { ...init, cache: 'no-store', headers })
        }
        return retryTransient ? await retryTransientRequest(attempt, options.sleep, options.now) : await retryOnRateLimit(attempt, options.sleep, options.now)
    }

    private request(path: string, init: { method: string, headers: Record<string, string>, body?: BodyInit }, retryTransient = true): Promise<Response> {
        return ServerExportWriter.send(this.options, path, init, this.id, () => this.aborted, retryTransient)
    }

    /**
     * Maps an answer that ends the export. Before the download is triggered every one of them leaves nothing in the
     * browser: 507 (the server could not stage), 404 `export-gone`, and any other non-OK answer.
     */
    private static async refuseUnlessOk(response: Response, beforeDownload: boolean): Promise<void> {
        if (response.ok) {
            return
        }
        const code = await errorCodeOf(response)
        if (response.status === 507) {
            throw new ExportStagingRefusedError(code)
        }
        if (response.status === 404 && code === 'export-gone') {
            throw new ExportServerGoneError(beforeDownload)
        }
        throw new ExportServerProtocolError(response.status, code)
    }

    private exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.tail.then(operation, operation)
        this.tail = run.catch(() => undefined)
        return run
    }

    private assertOpen(): void {
        if (this.aborted) {
            throw new ExportCancelledError()
        }
        if (this.closed) {
            throw new Error('The export writer is closed.')
        }
    }

    /**
     * Sends the pending bytes (and the marked splice point, and a pin request) as the next sequenced append. The
     * sequence advances, and the pending bytes are dropped, only when the server applied the request; a request that
     * failed in transit is sent again with the same sequence.
     */
    private async sendPending(pinKeyHex: string | null): Promise<{ size: number } | 'missing' | null> {
        if (this.pendingLength === 0 && this.spliceAt === null && pinKeyHex === null) {
            return null
        }
        const body = this.pendingLength === 0 ? new Uint8Array(0) : joined(this.pending, this.pendingLength)
        const headers: Record<string, string> = {
            'content-type': 'application/octet-stream',
            'export-seq': String(this.seq),
        }
        if (this.spliceAt !== null) {
            headers['splice-at'] = String(this.spliceAt)
        }
        if (pinKeyHex !== null) {
            headers['pin-key'] = pinKeyHex
        }
        const response = await this.request('/api/export/append', { method: 'POST', headers, body: body as Uint8Array<ArrayBuffer> })
        await ServerExportWriter.refuseUnlessOk(response, true)
        let pin: unknown
        try {
            const answer: unknown = await response.json()
            pin = typeof answer === 'object' && answer !== null && 'pin' in answer ? answer.pin : null
        } catch {
            throw new ExportServerProtocolError(response.status, null, 'unreadable answer')
        }
        let result: { size: number } | 'missing' | null = null
        if (pinKeyHex !== null) {
            if (pin === 'missing') {
                result = 'missing'
            } else if (typeof pin === 'object' && pin !== null && 'size' in pin && typeof pin.size === 'number' && Number.isSafeInteger(pin.size) && pin.size >= 0) {
                result = { size: pin.size }
            } else {
                throw new ExportServerProtocolError(response.status, null, 'no pin answer')
            }
        }
        this.seq += 1
        this.pending = []
        this.pendingLength = 0
        this.spliceAt = null
        return result
    }

    write(data: Uint8Array): Promise<void> {
        return this.exclusive(async () => {
            this.assertOpen()
            let offset = 0
            while (offset < data.length) {
                const take = Math.min(data.length - offset, this.bounds.appendBytes - this.pendingLength)
                this.pending.push(data.subarray(offset, offset + take))
                this.pendingLength += take
                offset += take
                if (this.pendingLength >= this.bounds.appendBytes) {
                    await this.sendPending(null)
                }
            }
        })
    }

    pinAsset(key: string): Promise<{ size: number } | 'missing'> {
        return this.exclusive(async () => {
            this.assertOpen()
            const answer = await this.sendPending(hexOfKey(key))
            if (answer === null) {
                throw new ExportServerProtocolError(null, null, 'no pin answer')
            }
            return answer
        })
    }

    markSplice(): void {
        this.spliceAt = this.pendingLength
    }

    close(): Promise<void> {
        return this.exclusive(async () => {
            this.assertOpen()
            await this.sendPending(null)
            await this.options.ensureActivation()
            this.assertOpen()
            const response = await this.request('/api/export/finalize', { method: 'POST', headers: {} })
            await ServerExportWriter.refuseUnlessOk(response, true)
            let ticket: unknown
            let total: unknown
            try {
                const answer: unknown = await response.json()
                ticket = typeof answer === 'object' && answer !== null && 'ticket' in answer ? answer.ticket : undefined
                total = typeof answer === 'object' && answer !== null && 'total' in answer ? answer.total : undefined
            } catch {
                throw new ExportServerProtocolError(response.status, null, 'unreadable answer')
            }
            if (typeof ticket !== 'string' || typeof total !== 'number' || !Number.isSafeInteger(total)) {
                throw new ExportServerProtocolError(response.status, null, 'no ticket')
            }
            this.assertOpen()
            this.total = total
            this.closed = true
            this.triggered = true
            const release = this.options.trigger(ticket)
            this.releaseTrigger = typeof release === 'function' ? release : null
            const triggeredAt = this.options.now()
            try {
                await this.follow(triggeredAt)
            } finally {
                this.releaseTrigger?.()
                this.releaseTrigger = null
            }
        })
    }

    /** Reads the job's status until the download ended; resolves only when the server sent every byte. */
    private async follow(triggeredAt: number): Promise<void> {
        let failingSince: number | null = null
        let backoff = POLL_ERROR_BACKOFF_MIN_MS
        for (;;) {
            if (this.aborted) {
                throw new ExportCancelledError()
            }
            let answer: StatusAnswer | null = null
            let failure: Error | null = null
            try {
                const response = await this.request('/api/export/status', { method: 'GET', headers: {} }, false)
                if (response.status === 404 && await errorCodeOf(response) === 'export-gone') {
                    throw new ExportServerGoneError(false)
                }
                if (response.ok) {
                    answer = parseStatus(await response.json())
                    if (answer === null) {
                        failure = new ExportServerProtocolError(response.status, null, 'unreadable status')
                    }
                } else {
                    failure = new ExportServerProtocolError(response.status, null)
                }
            } catch (error) {
                if (error instanceof ExportServerGoneError) {
                    throw new ExportServerDownloadError('the server no longer holds the export')
                }
                if (error instanceof ExportCancelledError) {
                    throw error
                }
                failure = error instanceof Error ? error : new Error(String(error))
            }
            if (answer === null) {
                const at = this.options.now()
                failingSince ??= at
                if (at - failingSince > this.bounds.pollErrorBudgetMs) {
                    throw new ExportServerDownloadError(`the server could not be reached: ${failure?.message ?? 'unknown'}`)
                }
                await this.options.sleep(backoff)
                backoff = Math.min(backoff * 2, POLL_ERROR_BACKOFF_MAX_MS)
                continue
            }
            failingSince = null
            backoff = POLL_ERROR_BACKOFF_MIN_MS
            if (answer.state === 'done') {
                if (answer.sent !== this.total || answer.total !== this.total) {
                    throw new ExportServerDownloadError(`${answer.sent} of ${this.total} bytes were sent`)
                }
                this.options.onProgress(answer.sent, answer.total)
                return
            }
            if (answer.state === 'failed') {
                if (answer.failure === 'asset-changed' && answer.key !== null) {
                    throw new BackupAssetChangedError(answer.key, new Error('The server could not read the asset to its end'))
                }
                throw new ExportServerDownloadError(answer.failure ?? 'failed')
            }
            if (answer.state === 'aborted') {
                throw new ExportServerDownloadError('aborted')
            }
            if (answer.state === 'streaming') {
                this.options.onProgress(answer.sent, answer.total)
            } else if (answer.state === 'ready') {
                if (this.options.now() - triggeredAt > this.bounds.downloadStartMs) {
                    this.abort()
                    throw new ExportServerDownloadError('the download did not start')
                }
            } else {
                throw new ExportServerDownloadError(`unexpected state ${answer.state}`)
            }
            await this.options.sleep(this.bounds.pollIntervalMs)
        }
    }

    /**
     * Gives up the export: the server removes the job (and cuts a download in progress), and polling stops. The
     * request is sent without waiting for its answer; a job the server already ended answers 404, which is ignored.
     */
    abort(_reason?: unknown): Promise<void> {
        if (this.aborted) {
            return Promise.resolve()
        }
        this.aborted = true
        void (async () => {
            try {
                const auth = await this.options.authHeader()
                await this.options.fetch('/api/export/abort', { method: 'POST', cache: 'no-store', keepalive: true, headers: { 'risu-auth': auth, 'export-id': this.id } })
            } catch {
                // The server removes an abandoned job by its idle bound.
            }
        })()
        return Promise.resolve()
    }
}

let formCounter = 0

/**
 * The browser's download of the finished file: a hidden same-origin frame that a hidden form posts the ticket into
 * (the ticket is in the body, never in a URL). The returned function removes both.
 */
export function submitDownloadForm(ticket: string): () => void {
    formCounter += 1
    const name = `risu-export-download-${formCounter}`
    const frame = document.createElement('iframe')
    frame.name = name
    frame.style.display = 'none'
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = '/api/export/download'
    form.target = name
    form.style.display = 'none'
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = 'ticket'
    input.value = ticket
    form.append(input)
    document.body.append(frame, form)
    form.submit()
    return () => {
        frame.remove()
        form.remove()
    }
}

// @vitest-environment jsdom
/**
 * The client of the server-streamed `.bin` export (`ServerExportWriter`) against a scripted server: the request
 * sequence it sends (sequence numbers, splice points, pins), what it retries, how every answer before and after the
 * download is triggered ends the export, and the form post that starts the download. The real server and the real
 * export shell are in `backupServerStream.test.ts`; a pass here says nothing about a browser's download.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The export shell and the cancel switch pull in the application's stores; only their error classes matter here.
vi.mock('../exportCancel', () => ({
    ExportCancelledError: class ExportCancelledError extends Error {
        constructor() {
            super('The export was cancelled')
            this.name = 'ExportCancelledError'
        }
    },
}))
vi.mock('./exportShell', () => ({
    BackupAssetChangedError: class BackupAssetChangedError extends Error {
        constructor(public readonly key: string, cause: unknown) {
            super(`The asset ${key} changed`, { cause })
            this.name = 'BackupAssetChangedError'
        }
    },
}))

import {
    ExportServerDownloadError,
    ExportServerGoneError,
    ExportServerProtocolError,
    ExportStagingRefusedError,
    ServerExportWriter,
    submitDownloadForm,
    type ServerExportWriterOptions,
} from './serverExportWriter'
import { BackupAssetChangedError } from './exportShell'
import { ExportCancelledError } from '../exportCancel'

interface Seen {
    path: string
    method: string
    headers: Record<string, string>
    body: Uint8Array | string | null
}

type Reply = Response | undefined

interface Harness {
    seen: Seen[]
    log: string[]
    sleeps: number[]
    clock: { now: number }
    options: ServerExportWriterOptions
    /** Answers `path` the nth time it is asked (1-based) instead of the happy path; `undefined` falls through. */
    script: (path: string, answer: (nth: number, seen: Seen) => Reply | Promise<Reply>) => void
    statuses: unknown[]
    tickets: string[]
    cleaned: { count: number }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const ID = 'ab'.repeat(16)

function bodyOf(init: RequestInit): Uint8Array | string | null {
    const body = init.body
    if (body === undefined || body === null) {
        return null
    }
    if (typeof body === 'string') {
        return body
    }
    return new Uint8Array(body as Uint8Array)
}

function harness(overrides: Partial<ServerExportWriterOptions> = {}): Harness {
    const seen: Seen[] = []
    const counts = new Map<string, number>()
    const scripts = new Map<string, (nth: number, seen: Seen) => Reply | Promise<Reply>>()
    const statuses: unknown[] = []
    const log: string[] = []
    const sleeps: number[] = []
    const clock = { now: 1_000_000 }
    const tickets: string[] = []
    const cleaned = { count: 0 }
    const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
        const entry: Seen = { path: url, method: init.method ?? 'GET', headers: { ...(init.headers as Record<string, string>) }, body: bodyOf(init) }
        seen.push(entry)
        log.push(url)
        const nth = (counts.get(url) ?? 0) + 1
        counts.set(url, nth)
        const scripted = await scripts.get(url)?.(nth, entry)
        if (scripted !== undefined) {
            return scripted
        }
        if (url === '/api/export/begin') {
            return json({ id: ID })
        }
        if (url === '/api/export/append') {
            const pinKey = entry.headers['pin-key']
            return json({ ok: true, pin: pinKey === undefined ? null : { size: 7 } })
        }
        if (url === '/api/export/finalize') {
            return json({ ticket: 't'.repeat(64), total: 100 })
        }
        if (url === '/api/export/status') {
            const next = statuses.length > 1 ? statuses.shift() : statuses[0]
            return json(next ?? { state: 'done', sent: 100, total: 100 })
        }
        return json({ ok: true })
    }
    const options: ServerExportWriterOptions = {
        fetch: fetchLike,
        authHeader: async () => 'auth',
        // A real macrotask, so a loop that never ends still lets the test's own timeout fire.
        sleep: async (ms) => { sleeps.push(ms); clock.now += ms; await new Promise((resolve) => setTimeout(resolve, 0)) },
        now: () => clock.now,
        trigger: (ticket) => {
            tickets.push(ticket)
            log.push('trigger')
            return () => { cleaned.count += 1 }
        },
        ensureActivation: async () => { log.push('activation') },
        onProgress: () => { },
        ...overrides,
    }
    return {
        seen, log, sleeps, clock, options, statuses, tickets, cleaned,
        script: (path, answer) => { scripts.set(path, answer) },
    }
}

const appends = (h: Harness) => h.seen.filter((entry) => entry.path === '/api/export/append')
const hex = (key: string) => Buffer.from(key, 'utf-8').toString('hex')
const bytesOf = (...values: number[]) => Uint8Array.from(values)
const bodyLength = (entry: Seen) => (entry.body as Uint8Array).length

afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe('request sequence', () => {
    test('begin asks for the bin format at version 1 with the file name', async () => {
        const h = harness()
        await ServerExportWriter.open('risu-backup.bin', h.options)
        const begin = h.seen[0]
        expect(begin.path).toBe('/api/export/begin')
        expect(JSON.parse(begin.body as string)).toEqual({ filename: 'risu-backup.bin', format: 'bin', v: 1 })
        expect(begin.headers['risu-auth']).toBe('auth')
    })

    test('writes are joined up to the append bound, split above it, and the caller buffers are not changed', async () => {
        const h = harness({ bounds: { appendBytes: 10 } })
        const writer = await ServerExportWriter.open('a.bin', h.options)
        const first = new Uint8Array(6).fill(1)
        const second = new Uint8Array(9).fill(2)
        const firstCopy = first.slice()
        const secondCopy = second.slice()
        await writer.write(first)
        expect(appends(h)).toHaveLength(0)
        await writer.write(second)
        expect(appends(h).map(bodyLength)).toEqual([10])
        await writer.close()
        expect(appends(h).map(bodyLength)).toEqual([10, 5])
        expect(appends(h).map((entry) => entry.headers['export-seq'])).toEqual(['0', '1'])
        const sent = Buffer.concat(appends(h).map((entry) => Buffer.from(entry.body as Uint8Array)))
        expect(sent.equals(Buffer.concat([Buffer.from(firstCopy), Buffer.from(secondCopy)]))).toBe(true)
        expect(first).toEqual(firstCopy)
        expect(second).toEqual(secondCopy)
    })

    test('a pin answered missing writes nothing of its own; a marked splice rides the next request of any kind', async () => {
        const h = harness()
        h.script('/api/export/append', (_nth, seen) => (seen.headers['pin-key'] === hex('assets/gone.png') ? json({ ok: true, pin: 'missing' }) : undefined))
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(1, 2))
        expect(await writer.pinAsset('assets/gone.png')).toBe('missing')
        expect(appends(h)).toHaveLength(1)
        expect(appends(h)[0].headers['splice-at']).toBeUndefined()

        expect(await writer.pinAsset('assets/Some Asset.png')).toEqual({ size: 7 })
        await writer.write(bytesOf(0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0))
        writer.markSplice()
        await writer.write(bytesOf(9))
        await writer.close()

        const all = appends(h)
        expect(all[1].headers['pin-key']).toBe(hex('assets/Some Asset.png'))
        expect(all[1].headers['splice-at']).toBeUndefined()
        expect(all[2].headers['splice-at']).toBe('12')
        expect(bodyLength(all[2])).toBe(13)
        expect(all[2].headers['pin-key']).toBeUndefined()
    })

    test('a marked splice with nothing after it is sent by close, and a second pin carries the first one\'s splice', async () => {
        const h = harness()
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.pinAsset('assets/a.png')
        await writer.write(bytesOf(7, 0, 0, 0))
        writer.markSplice()
        await writer.pinAsset('assets/b.png')
        await writer.write(bytesOf(7, 0, 0, 0))
        writer.markSplice()
        await writer.close()
        const all = appends(h)
        expect(all.map((entry) => entry.headers['splice-at'])).toEqual([undefined, '4', '4'])
        expect(all.map((entry) => entry.headers['pin-key'])).toEqual([hex('assets/a.png'), hex('assets/b.png'), undefined])
    })

    test('the pin key is the lowercase hex of the key bytes', async () => {
        const h = harness()
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.pinAsset('assets/Ünï.PNG')
        expect(appends(h)[0].headers['pin-key']).toBe(hex('assets/Ünï.PNG'))
        expect(appends(h)[0].headers['pin-key']).toBe(appends(h)[0].headers['pin-key'].toLowerCase())
    })
})

describe('ordering at the end', () => {
    test('U7: activation resolves before finalize, and the trigger gets finalize\'s ticket in the task that follows it', async () => {
        const h = harness()
        h.script('/api/export/finalize', () => json({ ticket: 'f'.repeat(64), total: 100 }))
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(1))
        await writer.close()
        const order = h.log.filter((entry) => entry === 'activation' || entry === '/api/export/finalize' || entry === 'trigger')
        expect(order).toEqual(['activation', '/api/export/finalize', 'trigger'])
        expect(h.tickets).toEqual(['f'.repeat(64)])
        expect(h.cleaned.count).toBe(1)
    })

    test('the writer holds nothing in the browser until the download is triggered', async () => {
        const h = harness()
        let heldAtTrigger: boolean | null = null
        let writer!: ServerExportWriter
        h.options.trigger = () => {
            heldAtTrigger = writer.heldInMemory
        }
        writer = await ServerExportWriter.open('a.bin', h.options)
        expect(writer.heldInMemory).toBe(true)
        await writer.write(bytesOf(1))
        expect(writer.heldInMemory).toBe(true)
        await writer.close()
        expect(heldAtTrigger).toBe(false)
        expect(writer.heldInMemory).toBe(false)
    })
})

describe('429 answers', () => {
    test.each([
        { name: 'append', path: '/api/export/append' },
        { name: 'finalize', path: '/api/export/finalize' },
        { name: 'status', path: '/api/export/status' },
    ])('U5: a 429 on $name is waited out as the server asks and sent again, with the same sequence', async ({ path }) => {
        const h = harness()
        h.script(path, (nth) => (nth === 1 ? json({ error: 'slow down' }, 429, { 'retry-after': '3' }) : undefined))
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(1))
        await writer.close()
        expect(h.sleeps).toContain(3000)
        const tries = h.seen.filter((entry) => entry.path === path)
        expect(tries.length).toBeGreaterThanOrEqual(2)
        if (path === '/api/export/append') {
            expect(tries.map((entry) => entry.headers['export-seq'])).toEqual(['0', '0'])
        }
    })

    test('U5: past five tries a 429 ends the export before the download as a refusal', async () => {
        const h = harness()
        h.script('/api/export/append', () => json({ error: 'slow down' }, 429, { 'retry-after': '1' }))
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(1))
        await expect(writer.close()).rejects.toBeInstanceOf(ExportServerProtocolError)
        expect(appends(h)).toHaveLength(5)
        expect(writer.heldInMemory).toBe(true)
    })
})

describe('transient failures', () => {
    test('an append lost in transit is sent again three times at 1, 2 and 4 seconds, with the same sequence and bytes', async () => {
        const h = harness()
        h.script('/api/export/append', (nth) => {
            if (nth <= 3) {
                throw new TypeError('fetch failed')
            }
            return undefined
        })
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(5, 6))
        await writer.close()
        expect(h.sleeps.slice(0, 3)).toEqual([1000, 2000, 4000])
        expect(appends(h).map((entry) => entry.headers['export-seq'])).toEqual(['0', '0', '0', '0'])
        expect(appends(h).every((entry) => Array.from(entry.body as Uint8Array).join() === '5,6')).toBe(true)
    })

    test('a request that keeps failing past the third retry ends the export before the download', async () => {
        const h = harness()
        h.script('/api/export/append', () => new Response('bad gateway', { status: 502 }))
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(1))
        await expect(writer.close()).rejects.toBeInstanceOf(ExportServerProtocolError)
        expect(appends(h)).toHaveLength(4)
        expect(writer.heldInMemory).toBe(true)
    })
})

describe('begin is not retried as an at-most-once request', () => {
    test('a 503 on begin ends the open after one request, because begin creates a job on every call', async () => {
        const h = harness()
        h.script('/api/export/begin', () => new Response('unavailable', { status: 503 }))
        await expect(ServerExportWriter.open('a.bin', h.options)).rejects.toBeInstanceOf(ExportServerProtocolError)
        expect(h.seen.filter((entry) => entry.path === '/api/export/begin')).toHaveLength(1)
        expect(h.sleeps).toEqual([])
    })

    test('a network failure on begin ends the open after one request', async () => {
        const h = harness()
        h.script('/api/export/begin', () => { throw new TypeError('fetch failed') })
        await expect(ServerExportWriter.open('a.bin', h.options)).rejects.toBeInstanceOf(TypeError)
        expect(h.seen.filter((entry) => entry.path === '/api/export/begin')).toHaveLength(1)
    })

    test('a 429 on begin is still waited out and sent again, because the limiter answers before the handler', async () => {
        const h = harness()
        h.script('/api/export/begin', (nth) => (nth === 1 ? json({ error: 'slow down' }, 429, { 'retry-after': '2' }) : undefined))
        await ServerExportWriter.open('a.bin', h.options)
        expect(h.seen.filter((entry) => entry.path === '/api/export/begin')).toHaveLength(2)
        expect(h.sleeps).toContain(2000)
    })
})

describe('answers that end the export before the download', () => {
    test('507 on begin is a staging refusal', async () => {
        const h = harness()
        h.script('/api/export/begin', () => json({ code: 'export-space' }, 507))
        await expect(ServerExportWriter.open('a.bin', h.options)).rejects.toBeInstanceOf(ExportStagingRefusedError)
    })

    test('507 on an append is a staging refusal and the browser holds nothing', async () => {
        const h = harness()
        h.script('/api/export/append', () => json({ code: 'export-space' }, 507))
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(1))
        await expect(writer.close()).rejects.toBeInstanceOf(ExportStagingRefusedError)
        expect(writer.heldInMemory).toBe(true)
    })

    test('404 export-gone on finalize is gone, and nothing was triggered', async () => {
        const h = harness()
        h.script('/api/export/finalize', () => json({ code: 'export-gone' }, 404))
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await expect(writer.close()).rejects.toBeInstanceOf(ExportServerGoneError)
        expect(h.tickets).toEqual([])
        expect(writer.heldInMemory).toBe(true)
    })

    test.each([
        { name: 'begin 400 export-version', path: '/api/export/begin', answer: () => json({ code: 'export-version' }, 400) },
        { name: 'begin 404 with no code', path: '/api/export/begin', answer: () => json({ error: 'Not found' }, 404) },
        { name: 'append 413 with an HTML page', path: '/api/export/append', answer: () => new Response('<html>too large</html>', { status: 413, headers: { 'content-type': 'text/html' } }) },
        { name: 'append 418', path: '/api/export/append', answer: () => new Response('teapot', { status: 418 }) },
        { name: 'append 409 export-seq', path: '/api/export/append', answer: () => json({ code: 'export-seq', expected: 3 }, 409) },
    ])('U10: $name is a protocol failure that leaves nothing in the browser', async ({ path, answer }) => {
        const h = harness()
        h.script(path, answer)
        let failure: unknown
        try {
            const writer = await ServerExportWriter.open('a.bin', h.options)
            await writer.write(bytesOf(1))
            await writer.close()
        } catch (error) {
            failure = error
        }
        expect(failure).toBeInstanceOf(ExportServerProtocolError)
        expect(h.tickets).toEqual([])
    })
})

describe('after the download is triggered', () => {
    async function closedWith(h: Harness, bounds?: ServerExportWriterOptions['bounds']): Promise<{ writer: ServerExportWriter, failure: unknown }> {
        const options = bounds === undefined ? h.options : { ...h.options, bounds }
        const writer = await ServerExportWriter.open('a.bin', options)
        let failure: unknown = null
        try {
            await writer.close()
        } catch (error) {
            failure = error
        }
        return { writer, failure }
    }

    test('done with every byte sent ends the export, and progress is reported', async () => {
        const onProgress = vi.fn()
        const h = harness({ onProgress })
        h.statuses.push({ state: 'streaming', sent: 40, total: 100 }, { state: 'done', sent: 100, total: 100 })
        const { failure } = await closedWith(h)
        expect(failure).toBeNull()
        expect(onProgress).toHaveBeenCalledWith(40, 100)
        expect(onProgress).toHaveBeenLastCalledWith(100, 100)
        expect(h.cleaned.count).toBe(1)
    })

    test('done with fewer bytes than the total is a failure with the file kept', async () => {
        const h = harness()
        h.statuses.push({ state: 'done', sent: 99, total: 100 })
        const { writer, failure } = await closedWith(h)
        expect(failure).toBeInstanceOf(ExportServerDownloadError)
        expect(writer.heldInMemory).toBe(false)
    })

    test('404 export-gone after the trigger is a download failure, never success', async () => {
        const h = harness()
        h.script('/api/export/status', () => json({ code: 'export-gone' }, 404))
        const { writer, failure } = await closedWith(h)
        expect(failure).toBeInstanceOf(ExportServerDownloadError)
        expect(writer.heldInMemory).toBe(false)
    })

    test('failed asset-changed names the asset', async () => {
        const h = harness()
        h.statuses.push({ state: 'failed', failure: 'asset-changed', key: 'assets/x.png', sent: 10, total: 100 })
        const { failure } = await closedWith(h)
        expect(failure).toBeInstanceOf(BackupAssetChangedError)
        expect((failure as BackupAssetChangedError).key).toBe('assets/x.png')
    })

    test.each([
        { name: 'stalled', status: { state: 'failed', failure: 'stalled', sent: 10, total: 100 } },
        { name: 'aborted', status: { state: 'aborted', sent: 10, total: 100 } },
        { name: 'an unknown state', status: { state: 'sideways', sent: 0, total: 100 } },
    ])('a $name job is a download failure', async ({ status }) => {
        const h = harness()
        h.statuses.push(status)
        const { failure } = await closedWith(h)
        expect(failure).toBeInstanceOf(ExportServerDownloadError)
    })

    test('status read errors within the budget are waited out and the export completes', async () => {
        const h = harness()
        h.script('/api/export/status', (nth) => {
            if (nth <= 3) {
                throw new TypeError('fetch failed')
            }
            return undefined
        })
        const { failure } = await closedWith(h)
        expect(failure).toBeNull()
        expect(h.sleeps).toEqual(expect.arrayContaining([1000, 2000, 4000]))
    })

    test('status read errors past the budget end the export as a failure with the file kept', async () => {
        const h = harness()
        h.script('/api/export/status', () => { throw new TypeError('fetch failed') })
        const { writer, failure } = await closedWith(h, { pollErrorBudgetMs: 10_000 })
        expect(failure).toBeInstanceOf(ExportServerDownloadError)
        expect(writer.heldInMemory).toBe(false)
    })

    test('a job that stays ready past the start bound is aborted on the server and fails', async () => {
        const h = harness()
        h.statuses.push({ state: 'ready', sent: 0, total: 100 })
        const { failure } = await closedWith(h, { downloadStartMs: 5000 })
        expect(failure).toBeInstanceOf(ExportServerDownloadError)
        await vi.waitFor(() => expect(h.seen.some((entry) => entry.path === '/api/export/abort')).toBe(true))
    })
})

describe('abort', () => {
    test('M14: abort tells the server, with the job id, and later calls are refused', async () => {
        const h = harness()
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(1))
        await writer.abort()
        await vi.waitFor(() => expect(h.seen.some((entry) => entry.path === '/api/export/abort')).toBe(true))
        const sent = h.seen.find((entry) => entry.path === '/api/export/abort')!
        expect(sent.headers['export-id']).toBe(ID)
        await expect(writer.write(bytesOf(2))).rejects.toThrow()
        expect(writer.heldInMemory).toBe(true)
    })

    test('an abort while finalize is in flight ends the close as cancelled, with no trigger and nothing in the browser', async () => {
        const h = harness()
        const gate: { release: () => void } = { release: () => { } }
        const gated = new Promise<void>((resolve) => { gate.release = resolve })
        const reached: { signal: () => void } = { signal: () => { } }
        const inFlight = new Promise<void>((resolve) => { reached.signal = resolve })
        h.script('/api/export/finalize', async () => {
            reached.signal()
            await gated
            return undefined
        })
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.write(bytesOf(1))
        const outcome = writer.close().then(() => null, (error: unknown) => error)
        await inFlight
        void writer.abort()
        gate.release()
        expect(await outcome).toBeInstanceOf(ExportCancelledError)
        expect(h.tickets).toEqual([])
        expect(h.log).not.toContain('trigger')
        expect(writer.heldInMemory).toBe(true)
    })

    test('an abort during the download stops the polling and removes the frame', async () => {
        const h = harness()
        h.statuses.push({ state: 'streaming', sent: 1, total: 100 })
        const writer = await ServerExportWriter.open('a.bin', h.options)
        let polls = 0
        h.script('/api/export/status', async () => {
            polls += 1
            if (polls === 2) {
                void writer.abort()
            }
            return undefined
        })
        await expect(writer.close()).rejects.toThrow()
        expect(polls).toBe(2)
        expect(h.cleaned.count).toBe(1)
        expect(writer.heldInMemory).toBe(false)
    })
})

describe('the download form', () => {
    test('U1: a hidden form posts the ticket in its body into a hidden frame, with no query on the action', () => {
        const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => { })
        const release = submitDownloadForm('c'.repeat(64))
        const form = document.querySelector('form')!
        const frame = document.querySelector('iframe')!
        expect(submit).toHaveBeenCalledTimes(1)
        expect(form.method.toLowerCase()).toBe('post')
        expect(form.getAttribute('action')).toBe('/api/export/download')
        expect(form.getAttribute('action')).not.toContain('?')
        expect(form.target).toBe(frame.name)
        expect(frame.name).not.toBe('')
        expect(form.target).not.toBe('_self')
        const inputs = Array.from(form.querySelectorAll('input'))
        expect(inputs.map((input) => [input.type, input.name, input.value])).toEqual([['hidden', 'ticket', 'c'.repeat(64)]])
        expect(document.body.innerHTML).not.toContain('?ticket')
        release()
        expect(document.querySelector('form')).toBeNull()
        expect(document.querySelector('iframe')).toBeNull()
    })
})

describe('guard: no network at all', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(() => { throw new Error('the global fetch must not be used') }))
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    test('the writer uses only the fetch it is given', async () => {
        const h = harness()
        const writer = await ServerExportWriter.open('a.bin', h.options)
        await writer.close()
        expect(globalThis.fetch).not.toHaveBeenCalled()
    })
})

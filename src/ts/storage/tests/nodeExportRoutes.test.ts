// @vitest-environment node
/**
 * The streamed .bin export routes of the real `server/node/server.cjs` (run as a
 * child process): staging, splicing from pins, the ticketed download, cleanup and
 * the bounds. Entries are framed by the real `encodeBackupEntryHeader`; assets go
 * through the real write route (large ones straight into the save directory).
 */
import { request, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { encodeBackupEntryHeader } from 'src/ts/exportWriters'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

// exportWriters is imported only for its pure header encoder; its page-side
// dependencies are replaced.
vi.mock('src/ts/alert', () => ({}))
vi.mock('src/ts/platform', () => ({ isTauri: false, isNodeServer: true, isWeb: false }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('src/ts/vendor/streamSaver', () => ({ default: {} }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }))

type Json = Record<string, unknown>

const BASE_ENV = { RISU_EXPORT_FREE_RESERVE_BYTES: '0' }
const MIB = 1024 * 1024

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer({ env: BASE_ENV })
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

async function relaunch(env: Record<string, string> = {}): Promise<void> {
    await fixture.restart({ env: { ...BASE_ENV, ...env } })
}

async function authed(headers: Record<string, string> = {}): Promise<Record<string, string>> {
    return { 'risu-auth': await fixture.authHeader(), ...headers }
}

async function json(response: Response): Promise<Json> {
    return (await response.json()) as Json
}

async function beginExport(filename = 'out.bin'): Promise<string> {
    const response = await fetch(`${fixture.baseUrl}/api/export/begin`, {
        method: 'POST',
        headers: await authed({ 'content-type': 'application/json' }),
        body: JSON.stringify({ filename, format: 'bin', v: 1 }),
    })
    expect(response.status).toBe(200)
    return String((await json(response)).id)
}

function appendChunk(id: string, seq: number, body: Uint8Array, extra: { spliceAt?: number, pinKey?: string } = {}): Promise<Response> {
    return authed({
        'content-type': 'application/octet-stream',
        'export-id': id,
        'export-seq': String(seq),
        ...(extra.spliceAt === undefined ? {} : { 'splice-at': String(extra.spliceAt) }),
        ...(extra.pinKey === undefined ? {} : { 'pin-key': extra.pinKey }),
    }).then((headers) => fetch(`${fixture.baseUrl}/api/export/append`, { method: 'POST', headers, body: new Uint8Array(body) }))
}

async function finalizeExport(id: string): Promise<{ ticket: string, total: number }> {
    const response = await fetch(`${fixture.baseUrl}/api/export/finalize`, { method: 'POST', headers: await authed({ 'export-id': id }) })
    expect(response.status).toBe(200)
    const answer = await json(response)
    return { ticket: String(answer.ticket), total: Number(answer.total) }
}

async function exportStatus(id: string): Promise<{ status: number, body: Json }> {
    const response = await fetch(`${fixture.baseUrl}/api/export/status`, { headers: await authed({ 'export-id': id }) })
    return { status: response.status, body: await json(response) }
}

async function abortExport(id: string): Promise<Response> {
    return await fetch(`${fixture.baseUrl}/api/export/abort`, { method: 'POST', headers: await authed({ 'export-id': id }) })
}

interface OpenDownload {
    status: number
    headers: IncomingHttpHeaders
    res: IncomingMessage
}

function openDownload(ticket: string | null, search = ''): Promise<OpenDownload> {
    const target = new URL(`${fixture.baseUrl}/api/export/download${search}`)
    const body = ticket === null ? '' : `ticket=${ticket}`
    return new Promise((resolve, reject) => {
        const req = request({
            host: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) },
        }, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, res }))
        req.once('error', reject)
        req.end(body)
    })
}

function readAll(res: IncomingMessage): Promise<{ bytes: Buffer, complete: boolean }> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('error', () => {})
        res.once('close', () => resolve({ bytes: Buffer.concat(chunks), complete: res.complete }))
        res.resume()
    })
}

async function downloadAll(ticket: string): Promise<{ status: number, bytes: Buffer, complete: boolean, headers: IncomingHttpHeaders }> {
    const opened = await openDownload(ticket)
    const read = await readAll(opened.res)
    return { status: opened.status, headers: opened.headers, ...read }
}

async function writeAsset(key: string, bytes: Buffer): Promise<void> {
    const response = await fetch(`${fixture.baseUrl}/api/write`, {
        method: 'POST',
        headers: await authed({ 'file-path': hexOfKey(key), 'content-type': 'application/octet-stream' }),
        body: new Uint8Array(bytes),
    })
    expect(response.status).toBe(200)
}

async function removeAsset(key: string): Promise<void> {
    const response = await fetch(`${fixture.baseUrl}/api/remove`, { headers: await authed({ 'file-path': hexOfKey(key), 'if-match-revision': '' }) })
    expect(response.status).toBe(200)
}

async function readRange(key: string, start: number, length: number): Promise<Buffer> {
    const response = await fetch(`${fixture.baseUrl}/api/read-range`, {
        headers: await authed({ 'file-path': hexOfKey(key), 'range-start': String(start), 'range-length': String(length) }),
    })
    expect(response.status).toBe(200)
    return Buffer.from(await response.arrayBuffer())
}

async function exportDirs(): Promise<string[]> {
    try {
        return await readdir(join(fixture.saveDir, '__exports'))
    } catch {
        return []
    }
}

async function until(condition: () => Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (await condition()) {
            return true
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return await condition()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function entryHeader(key: string, size: number): Buffer {
    return Buffer.from(encodeBackupEntryHeader(Buffer.from(key, 'utf-8'), size))
}

function pattern(size: number, seed: number): Buffer {
    const bytes = Buffer.alloc(size)
    for (let index = 0; index < size; index++) {
        bytes[index] = (index * 31 + seed) & 0xff
    }
    return bytes
}

/** Stages prefix + asset entry + tail the way the page does: the pin rides the prefix, the header and splice point the next request. */
async function stageEntry(id: string, firstSeq: number, key: string, assetSize: number, prefix: Buffer, tail: Buffer): Promise<Buffer> {
    const pinned = await appendChunk(id, firstSeq, prefix, { pinKey: hexOfKey(key) })
    expect(pinned.status).toBe(200)
    const pin = (await json(pinned)).pin as { size: number }
    expect(pin.size).toBe(assetSize)
    const header = entryHeader(key, assetSize)
    const spliced = await appendChunk(id, firstSeq + 1, Buffer.concat([header, tail]), { spliceAt: header.length })
    expect(spliced.status).toBe(200)
    return header
}

describe('T-S1 authorisation', () => {
    test('every export route refuses a request with no token or an asset-read token', async () => {
        const assetToken = await fixture.signToken({ aud: 'asset-read', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })
        const id = await beginExport()
        const routes: Array<[string, string]> = [
            ['POST', 'begin'], ['POST', 'append'], ['POST', 'finalize'], ['GET', 'status'], ['POST', 'abort'],
        ]
        const send = (route: string, method: string, extra: Record<string, string>) => fetch(`${fixture.baseUrl}/api/export/${route}`, {
            method,
            headers: { 'export-id': id, 'export-seq': '0', 'content-type': route === 'begin' ? 'application/json' : 'application/octet-stream', ...extra },
            body: method === 'POST' ? (route === 'begin' ? JSON.stringify({ filename: 'a.bin', format: 'bin', v: 1 }) : 'bytes') : undefined,
        })
        for (const [method, route] of routes) {
            for (const [label, extra] of [['no token', {}], ['an asset-read token', { 'risu-auth': assetToken }]] as Array<[string, Record<string, string>]>) {
                const refused = await send(route, method, extra)
                expect(refused.status, `${route} with ${label}`).toBe(400)
                expect(String((await json(refused)).error), `${route} with ${label}`).toMatch(/auth header|token/i)
            }
        }
        expect((await exportStatus(id)).body).toMatchObject({ state: 'staging', total: null })
        expect(await exportDirs()).toContain(id)
    })

    test('an append with no token is refused before its body is read', async () => {
        const target = new URL(fixture.baseUrl)
        const status = await new Promise<number>((resolve, reject) => {
            const req = request({
                host: target.hostname,
                port: target.port,
                path: '/api/export/append',
                method: 'POST',
                headers: { 'content-length': String(4 * MIB), 'export-id': 'a'.repeat(32), 'export-seq': '0' },
            }, (res) => {
                resolve(res.statusCode ?? 0)
                res.resume()
                req.destroy()
            })
            req.once('error', () => {})
            const timer = setTimeout(() => reject(new Error('The server waited for the body of an unauthenticated append')), 4000)
            req.once('close', () => clearTimeout(timer))
            req.flushHeaders()
        })
        expect(status).toBe(400)
    })
})

describe('T-S2 ticket and headers', () => {
    test('a ticket opens one download; its second use while streaming and its use in a query are refused; headers are the shipped set', async () => {
        const asset = pattern(48 * MIB, 3)
        const key = 'assets/big-ticket.bin'
        await writeFile(join(fixture.saveDir, hexOfKey(key)), asset)
        const id = await beginExport('ticket.bin')
        const prefix = Buffer.from('prefix-')
        const tail = Buffer.from('-tail')
        const header = await stageEntry(id, 0, key, asset.length, prefix, tail)
        const { ticket, total } = await finalizeExport(id)
        expect(total).toBe(prefix.length + header.length + asset.length + tail.length)

        const inQuery = await openDownload(null, `?ticket=${ticket}`)
        expect(inQuery.status).toBe(404)
        inQuery.res.resume()

        const first = await openDownload(ticket)
        expect(first.status).toBe(200)
        expect(first.headers['content-length']).toBe(String(total))
        expect(first.headers['content-disposition']).toBe('attachment; filename="ticket.bin"')
        expect(first.headers['content-type']).toBe('application/octet-stream')
        expect(first.headers['cache-control']).toBe('no-store')
        expect(first.headers['x-content-type-options']).toBe('nosniff')
        expect(first.headers['content-security-policy']).toBeUndefined()
        first.res.pause()
        const second = await openDownload(ticket)
        expect(second.status).toBe(404)
        second.res.resume()
        const got = await readAll(first.res)
        expect(got.complete).toBe(true)
        expect(got.bytes.equals(Buffer.concat([prefix, header, asset, tail]))).toBe(true)
        await rm(join(fixture.saveDir, hexOfKey(key)), { force: true })
    }, 60_000)

    test('a GET of the download route with a valid ticket in its query is a 404 and leaves the ticket usable', async () => {
        const id = await beginExport('get.bin')
        const body = Buffer.from('get-route-bytes')
        expect((await appendChunk(id, 0, body)).status).toBe(200)
        const { ticket } = await finalizeExport(id)
        const viaGet = await fetch(`${fixture.baseUrl}/api/export/download?ticket=${ticket}`, { headers: await authed() })
        expect(viaGet.status).toBe(404)
        expect(viaGet.headers.get('content-disposition')).toBeNull()
        expect((await exportStatus(id)).body.state).toBe('ready')
        const got = await downloadAll(ticket)
        expect(got.status).toBe(200)
        expect(got.bytes.equals(body)).toBe(true)
    })

    test('a bad file name is refused at begin', async () => {
        for (const filename of ['x.txt', '../x.bin', 'a/b.bin', 'a b.bin', '.bin']) {
            const response = await fetch(`${fixture.baseUrl}/api/export/begin`, {
                method: 'POST',
                headers: await authed({ 'content-type': 'application/json' }),
                body: JSON.stringify({ filename, format: 'bin', v: 1 }),
            })
            expect(response.status, filename).toBe(400)
        }
    })

    test('an expired ticket is refused', async () => {
        await relaunch({ RISU_EXPORT_TICKET_TTL_MS: '200' })
        const id = await beginExport()
        expect((await appendChunk(id, 0, Buffer.from('abc'))).status).toBe(200)
        const { ticket } = await finalizeExport(id)
        await sleep(450)
        expect((await openDownload(ticket)).status).toBe(404)
    })
})

describe('T-S3 pin keys', () => {
    test('a key outside assets/ or not decodable is 400 export-key; an absent asset answers missing', async () => {
        const id = await beginExport()
        const body = Buffer.from('x')
        for (const pinKey of [hexOfKey('other/key'), hexOfKey('inlays/b-abc.0123456789abcdef'), 'zz', 'abc', hexOfKey('assets/../x')]) {
            const response = await appendChunk(id, 0, body, { pinKey })
            expect(response.status, pinKey).toBe(400)
            expect((await json(response)).code).toBe('export-key')
        }
        const missing = await appendChunk(id, 0, body, { pinKey: hexOfKey('assets/absent.bin') })
        expect(missing.status).toBe(200)
        expect((await json(missing)).pin).toBe('missing')
    })
})

describe('T-S4 pins hold the bytes read through read-range', () => {
    test('a key overwritten or removed after its pin still downloads the bytes read-range returned', async () => {
        const overwritten = 'assets/over.bin'
        const removed = 'assets/gone.bin'
        const oldOver = pattern(MIB, 5)
        const oldGone = pattern(MIB + 17, 9)
        await writeAsset(overwritten, oldOver)
        await writeAsset(removed, oldGone)
        expect((await readRange(overwritten, 0, MIB)).equals(oldOver)).toBe(true)

        const id = await beginExport()
        const prefix = Buffer.from('P')
        const first = await stageEntry(id, 0, overwritten, oldOver.length, prefix, Buffer.from('m'))
        const second = await stageEntry(id, 2, removed, oldGone.length, Buffer.alloc(0), Buffer.from('end'))
        await writeAsset(overwritten, pattern(MIB, 77))
        await removeAsset(removed)

        const { ticket, total } = await finalizeExport(id)
        const got = await downloadAll(ticket)
        const expected = Buffer.concat([prefix, first, oldOver, Buffer.from('m'), second, oldGone, Buffer.from('end')])
        expect(total).toBe(expected.length)
        expect(got.bytes.equals(expected)).toBe(true)
        expect((await readRange(overwritten, 0, MIB)).equals(pattern(MIB, 77))).toBe(true)
        await expect(stat(join(fixture.saveDir, hexOfKey(removed)))).rejects.toMatchObject({ code: 'ENOENT' })
    }, 30_000)
})

describe('T-S5 identity mode', () => {
    test('an asset overwritten or removed after its pin fails the download naming the asset', async () => {
        await relaunch({ RISU_EXPORT_PIN: 'off' })
        for (const mode of ['overwrite', 'remove'] as const) {
            const key = `assets/identity-${mode}.bin`
            const original = pattern(2 * MIB, 11)
            await writeAsset(key, original)
            const id = await beginExport()
            await stageEntry(id, 0, key, original.length, Buffer.from('head'), Buffer.from('tail'))
            if (mode === 'overwrite') {
                await writeAsset(key, pattern(2 * MIB, 12))
            } else {
                await removeAsset(key)
            }
            const { ticket, total } = await finalizeExport(id)
            const got = await downloadAll(ticket)
            expect(got.complete && got.bytes.length === total, mode).toBe(false)
            const ended = await exportStatus(id)
            expect(ended.body).toMatchObject({ state: 'failed', failure: 'asset-changed', key })
        }
    }, 30_000)

    test('an unchanged asset downloads exactly and the key file is untouched', async () => {
        const key = 'assets/identity-keep.bin'
        const original = pattern(MIB, 13)
        await writeAsset(key, original)
        const id = await beginExport()
        const header = await stageEntry(id, 0, key, original.length, Buffer.from('a'), Buffer.from('b'))
        const { ticket } = await finalizeExport(id)
        const got = await downloadAll(ticket)
        expect(got.bytes.equals(Buffer.concat([Buffer.from('a'), header, original, Buffer.from('b')]))).toBe(true)
        expect((await readFile(join(fixture.saveDir, hexOfKey(key)))).equals(original)).toBe(true)
    })
})

describe('T-S6 cleanup', () => {
    test('a job directory is gone after done, after abort and after a restart, and key files stay byte for byte', async () => {
        await relaunch()
        const key = 'assets/keep.bin'
        const original = pattern(MIB, 21)
        await writeAsset(key, original)

        const done = await beginExport()
        await stageEntry(done, 0, key, original.length, Buffer.from('1'), Buffer.from('2'))
        expect(await exportDirs()).toContain(done)
        const listed = await fetch(`${fixture.baseUrl}/api/list`, { headers: await authed() })
        expect(JSON.stringify(await json(listed))).not.toContain(done)
        await downloadAll((await finalizeExport(done)).ticket)
        expect(await until(async () => !(await exportDirs()).includes(done))).toBe(true)

        const aborted = await beginExport()
        await stageEntry(aborted, 0, key, original.length, Buffer.from('1'), Buffer.from('2'))
        expect((await abortExport(aborted)).status).toBe(200)
        expect(await until(async () => !(await exportDirs()).includes(aborted))).toBe(true)
        expect((await readFile(join(fixture.saveDir, hexOfKey(key)))).equals(original)).toBe(true)

        const leftover = await beginExport()
        await stageEntry(leftover, 0, key, original.length, Buffer.from('1'), Buffer.from('2'))
        await fixture.halt('hard')
        const extra = join(fixture.saveDir, '__exports', 'leftover')
        await mkdir(extra, { recursive: true })
        await link(join(fixture.saveDir, hexOfKey(key)), join(extra, 'p0'))
        await fixture.restart({ env: BASE_ENV })
        expect(await exportDirs()).toEqual([])
        expect((await readFile(join(fixture.saveDir, hexOfKey(key)))).equals(original)).toBe(true)
    }, 30_000)

    test('an idle staging job is reaped and its directory removed', async () => {
        await relaunch({ RISU_EXPORT_IDLE_MS: '600' })
        const id = await beginExport()
        expect(await until(async () => !(await exportDirs()).includes(id), 6000)).toBe(true)
        expect((await exportStatus(id)).body).toMatchObject({ state: 'failed', failure: 'idle' })
    })
})

describe('T-S7 staged cap', () => {
    test('a cap refuses bytes over it with 507; with no cap the same bytes are accepted', async () => {
        await relaunch({ RISU_EXPORT_STAGED_CAP_BYTES: '1000' })
        const capped = await beginExport()
        expect((await appendChunk(capped, 0, Buffer.alloc(600, 1))).status).toBe(200)
        const refused = await appendChunk(capped, 1, Buffer.alloc(600, 2))
        expect(refused.status).toBe(507)
        expect((await json(refused)).code).toBe('export-cap')
        await relaunch()
        const open = await beginExport()
        expect((await appendChunk(open, 0, Buffer.alloc(600, 1))).status).toBe(200)
        expect((await appendChunk(open, 1, Buffer.alloc(600, 2))).status).toBe(200)
    })
})

describe('T-S8 and T-S15 streaming ends', () => {
    async function pausedBigDownload(key: string): Promise<{ id: string, opened: OpenDownload }> {
        const asset = pattern(96 * MIB, 31)
        await writeFile(join(fixture.saveDir, hexOfKey(key)), asset)
        const id = await beginExport()
        await stageEntry(id, 0, key, asset.length, Buffer.from('h'), Buffer.from('t'))
        const { ticket } = await finalizeExport(id)
        const opened = await openDownload(ticket)
        expect(opened.status).toBe(200)
        opened.res.pause()
        return { id, opened }
    }

    test('an abort during the download destroys the stream and removes the job', async () => {
        await relaunch()
        const key = 'assets/abort-big.bin'
        const { id, opened } = await pausedBigDownload(key)
        expect((await abortExport(id)).status).toBe(200)
        const got = await readAll(opened.res)
        expect(got.complete).toBe(false)
        expect(await until(async () => !(await exportDirs()).includes(id))).toBe(true)
        expect((await exportStatus(id)).body.state).toBe('aborted')
        await rm(join(fixture.saveDir, hexOfKey(key)), { force: true })
    }, 60_000)

    test('a client that stops reading is cut after the stall bound and the keys stay', async () => {
        await relaunch({ RISU_EXPORT_STALL_MS: '300' })
        const key = 'assets/stall-big.bin'
        const { id, opened } = await pausedBigDownload(key)
        expect(await until(async () => (await exportStatus(id)).body.state === 'failed', 8000)).toBe(true)
        expect((await exportStatus(id)).body.failure).toBe('stalled')
        expect(await until(async () => !(await exportDirs()).includes(id))).toBe(true)
        opened.res.destroy()
        expect((await stat(join(fixture.saveDir, hexOfKey(key)))).size).toBe(96 * MIB)
        await rm(join(fixture.saveDir, hexOfKey(key)), { force: true })
    }, 60_000)
})

describe('T-S9 sequence', () => {
    test('a replay answers the same, a gap is 409 export-seq, concurrent same-seq appends stage once', async () => {
        await relaunch()
        const id = await beginExport()
        const body = Buffer.from('0123456789')
        const first = await appendChunk(id, 0, body)
        const replay = await appendChunk(id, 0, body)
        expect(replay.status).toBe(200)
        expect(await json(replay)).toEqual(await json(first))
        const gap = await appendChunk(id, 5, body)
        expect(gap.status).toBe(409)
        expect(await json(gap)).toMatchObject({ code: 'export-seq', expected: 1 })

        const concurrent = Buffer.from('abcdefghij')
        const [a, b] = await Promise.all([appendChunk(id, 1, concurrent), appendChunk(id, 1, concurrent)])
        expect([a.status, b.status]).toEqual([200, 200])
        const { ticket, total } = await finalizeExport(id)
        expect(total).toBe(20)
        expect((await downloadAll(ticket)).bytes.toString()).toBe('0123456789abcdefghij')
    })
})

describe('T-S10 rate limits', () => {
    test('export routes draw on their own bucket and carry Retry-After once it is spent', async () => {
        await relaunch({ RISU_EXPORT_RATE_LIMIT_MAX: '5' })
        const statuses: number[] = []
        let limited: Response | undefined
        for (let attempt = 0; attempt < 8; attempt++) {
            const response = await fetch(`${fixture.baseUrl}/api/export/status`, { headers: await authed({ 'export-id': 'b'.repeat(32) }) })
            statuses.push(response.status)
            if (response.status === 429) {
                limited = response
                break
            }
        }
        expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404])
        expect(statuses[5]).toBe(429)
        expect(limited?.headers.get('retry-after')).not.toBeNull()
        const storage = await fetch(`${fixture.baseUrl}/api/caps`, { headers: await authed() })
        expect(storage.status).toBe(200)
    })

    test('the download has its own bucket of 30 a minute', async () => {
        await relaunch()
        const codes: number[] = []
        for (let attempt = 0; attempt < 32; attempt++) {
            const opened = await openDownload('c'.repeat(64))
            codes.push(opened.status)
            opened.res.resume()
        }
        expect(codes.slice(0, 30).every((code) => code === 404)).toBe(true)
        expect(codes[30]).toBe(429)
        expect(await exportStatus('b'.repeat(32))).toMatchObject({ status: 404 })
    })
})

describe('T-S11 ready jobs and tickets', () => {
    test('a ready job outlives an expired ticket, finalize mints another, and only the idle bound reaps it', async () => {
        await relaunch({ RISU_EXPORT_TICKET_TTL_MS: '200', RISU_EXPORT_IDLE_MS: '2500' })
        const id = await beginExport()
        expect((await appendChunk(id, 0, Buffer.from('ready-bytes'))).status).toBe(200)
        const stale = await finalizeExport(id)
        await sleep(1500)
        expect((await openDownload(stale.ticket)).status).toBe(404)
        expect((await exportStatus(id)).body.state).toBe('ready')
        const fresh = await finalizeExport(id)
        const got = await downloadAll(fresh.ticket)
        expect(got.bytes.toString()).toBe('ready-bytes')

        const idle = await beginExport()
        expect((await finalizeExport(idle)).total).toBe(0)
        expect(await until(async () => !(await exportDirs()).includes(idle), 8000)).toBe(true)
        expect((await exportStatus(idle)).body).toMatchObject({ state: 'failed', failure: 'idle' })
    }, 30_000)
})

describe('T-S12 unknown and ended ids', () => {
    test('unknown ids answer 404 export-gone on every route and a done job leaves a tombstone that expires', async () => {
        await relaunch({ RISU_EXPORT_TOMBSTONE_MS: '700' })
        const unknown = 'd'.repeat(32)
        const answers = [
            await appendChunk(unknown, 0, Buffer.from('x')),
            await fetch(`${fixture.baseUrl}/api/export/finalize`, { method: 'POST', headers: await authed({ 'export-id': unknown }) }),
            await abortExport(unknown),
            await fetch(`${fixture.baseUrl}/api/export/status`, { headers: await authed({ 'export-id': unknown }) }),
        ]
        for (const answer of answers) {
            expect(answer.status).toBe(404)
            expect((await json(answer)).code).toBe('export-gone')
        }
        const id = await beginExport()
        expect((await appendChunk(id, 0, Buffer.from('tomb'))).status).toBe(200)
        await downloadAll((await finalizeExport(id)).ticket)
        expect(await until(async () => (await exportStatus(id)).body.state === 'done')).toBe(true)
        expect((await exportStatus(id)).body).toMatchObject({ state: 'done', sent: 4, total: 4 })
        expect(await until(async () => (await exportStatus(id)).status === 404, 4000)).toBe(true)
        expect((await appendChunk(id, 1, Buffer.from('x'))).status).toBe(404)
    })
})

describe('T-S16 frame checks', () => {
    test('a wrong splice point, a missing one and an unexpected one are refused and commit nothing', async () => {
        await relaunch()
        const key = 'assets/frame.bin'
        const asset = pattern(1000, 41)
        await writeAsset(key, asset)
        const id = await beginExport()
        const prefix = Buffer.from('pre')
        expect((await appendChunk(id, 0, prefix, { pinKey: hexOfKey(key) })).status).toBe(200)
        const header = entryHeader(key, asset.length)

        const wrong = await appendChunk(id, 1, Buffer.concat([header, Buffer.from('t')]), { spliceAt: header.length - 1 })
        expect(wrong.status).toBe(400)
        expect((await json(wrong)).code).toBe('export-frame')
        const beyond = await appendChunk(id, 1, header, { spliceAt: header.length + 1 })
        expect(beyond.status).toBe(400)

        const noSplice = await appendChunk(id, 1, Buffer.concat([header, Buffer.from('t')]))
        expect(noSplice.status).toBe(409)
        expect((await json(noSplice)).code).toBe('export-frame')
        const noSpliceNewPin = await appendChunk(id, 1, Buffer.concat([header, Buffer.from('t')]), { pinKey: hexOfKey(key) })
        expect(noSpliceNewPin.status).toBe(409)
        expect((await json(noSpliceNewPin)).code).toBe('export-frame')
        const finalizeOpen = await fetch(`${fixture.baseUrl}/api/export/finalize`, { method: 'POST', headers: await authed({ 'export-id': id }) })
        expect(finalizeOpen.status).toBe(409)

        expect((await appendChunk(id, 1, Buffer.concat([header, Buffer.from('t')]), { spliceAt: header.length })).status).toBe(200)
        const stray = await appendChunk(id, 2, Buffer.from('more'), { spliceAt: 4 })
        expect(stray.status).toBe(400)
        expect((await json(stray)).code).toBe('export-frame')

        const { ticket } = await finalizeExport(id)
        const got = await downloadAll(ticket)
        expect(got.bytes.equals(Buffer.concat([prefix, header, asset, Buffer.from('t')]))).toBe(true)
    })
})

describe('T-S17 export ids', () => {
    test('an id that is not 32 lowercase hex characters is 400', async () => {
        for (const id of ['../x', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), '']) {
            const response = await fetch(`${fixture.baseUrl}/api/export/status`, { headers: await authed({ 'export-id': id }) })
            expect(response.status, id).toBe(400)
            const appended = await appendChunk(id, 0, Buffer.from('x'))
            expect(appended.status, id).toBe(400)
        }
    })
})

describe('T-S20 oversize bodies', () => {
    test('an append chunk over the chunk limit answers 413 and the job is unchanged', async () => {
        await relaunch({ RISU_UPLOAD_CHUNK_MAX_BYTES: '1024' })
        const id = await beginExport()
        const refused = await appendChunk(id, 0, Buffer.alloc(2000, 7))
        expect(refused.status).toBe(413)
        expect(await json(refused)).toMatchObject({ error: 'Export chunk is too large', code: 'PAYLOAD_TOO_LARGE' })
        expect((await exportStatus(id)).body).toMatchObject({ state: 'staging', total: null })
        expect((await appendChunk(id, 0, Buffer.from('fits'))).status).toBe(200)
        const { ticket, total } = await finalizeExport(id)
        expect(total).toBe(4)
        expect((await downloadAll(ticket)).bytes.toString()).toBe('fits')
    })

    test('a download body over the public limit answers a plain 404 and leaves the ticket and job alone', async () => {
        await relaunch()
        const id = await beginExport()
        expect((await appendChunk(id, 0, Buffer.from('still-here'))).status).toBe(200)
        const { ticket } = await finalizeExport(id)
        const refused = await fetch(`${fixture.baseUrl}/api/export/download`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: `ticket=${ticket}&pad=${'a'.repeat(70_000)}`,
        })
        expect(refused.status).toBe(404)
        expect(await json(refused)).toEqual({ error: 'Not found' })
        expect((await exportStatus(id)).body.state).toBe('ready')
        expect((await downloadAll(ticket)).bytes.toString()).toBe('still-here')
    })
})

describe('T-S18 format and version', () => {
    test('begin accepts only format bin version 1 and caps advertise version 1', async () => {
        await relaunch()
        const before = await exportDirs()
        for (const body of [{ filename: 'a.bin', format: 'rtb', v: 1 }, { filename: 'a.bin', format: 'bin', v: 2 }, { filename: 'a.bin' }]) {
            const response = await fetch(`${fixture.baseUrl}/api/export/begin`, {
                method: 'POST',
                headers: await authed({ 'content-type': 'application/json' }),
                body: JSON.stringify(body),
            })
            expect(response.status).toBe(400)
            expect((await json(response)).code).toBe('export-version')
        }
        expect(await exportDirs()).toEqual(before)
        const caps = await json(await fetch(`${fixture.baseUrl}/api/caps`, { headers: await authed() }))
        expect(caps).toMatchObject({ exportStream: true, exportStreamVersion: 1 })
    })
})

describe('T-S19 switch off', () => {
    test('with RISU_EXPORT_STREAM=off caps omit the feature and begin answers 404 export-gone', async () => {
        await relaunch({ RISU_EXPORT_STREAM: 'off' })
        const caps = await json(await fetch(`${fixture.baseUrl}/api/caps`, { headers: await authed() }))
        expect(caps).not.toHaveProperty('exportStream')
        expect(caps).not.toHaveProperty('exportStreamVersion')
        const response = await fetch(`${fixture.baseUrl}/api/export/begin`, {
            method: 'POST',
            headers: await authed({ 'content-type': 'application/json' }),
            body: JSON.stringify({ filename: 'a.bin', format: 'bin', v: 1 }),
        })
        expect(response.status).toBe(404)
        expect((await json(response)).code).toBe('export-gone')
        expect(await exportDirs()).toEqual([])
    })
})

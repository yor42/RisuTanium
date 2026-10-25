// @vitest-environment node
/**
 * The chunked upload routes (`/api/upload/*`), the ranged read
 * (`/api/read-range`), `HEAD /api/read`, the `min-size` filter of
 * `/api/list-prefix`, the `pieces` capability and the startup sweep of the real
 * `server/node/server.cjs`, run as child processes with small limits and short
 * timers.
 *
 * Reproducers (fail on the server before these routes existed): the HEAD test
 * (the old server read the whole file to answer it) and the sweep test (the old
 * server left orphans in place). Everything else under "upload", "read-range"
 * and "list-prefix min-size" tests new behaviour. The tests named "guard" pass
 * before and after: they pin what the change must not move. The concurrent
 * consistency test and the "authentication" cases pin the key lock and the
 * route authentication of the new routes; they are not reproducers.
 */
import { mkdir, readFile, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const FAULTS = fileURLToPath(new URL('./nodeWriteFaults.cjs', import.meta.url))
const withFaults = ['--require', FAULTS]

const ASSET_LIMIT = 1000
const CHUNK_MAX = 100

let main: NodeServerFixture
let capped: NodeServerFixture
let reaping: NodeServerFixture
let sweeping: NodeServerFixture
let crowded: NodeServerFixture

beforeAll(async () => {
    const limits = {
        RISU_NODE_ASSET_LIMIT_BYTES: String(ASSET_LIMIT),
        RISU_UPLOAD_CHUNK_MAX_BYTES: String(CHUNK_MAX),
    }
    main = await startNodeServer({ env: limits, nodeArgs: withFaults })
    capped = await startNodeServer({
        env: { ...limits, RISU_UPLOAD_STAGED_CAP_BYTES: '300', RISU_UPLOAD_EVICT_IDLE_MS: '150' },
        nodeArgs: withFaults,
    })
    reaping = await startNodeServer({ env: { ...limits, RISU_UPLOAD_IDLE_REAP_MS: '300' } })
    sweeping = await startNodeServer()
    // The default eviction idle time: no upload can become evictable during a test.
    crowded = await startNodeServer({ env: { ...limits, RISU_UPLOAD_STAGED_CAP_BYTES: '300' } })
}, 120_000)

afterAll(async () => {
    await Promise.all([main?.stop(), capped?.stop(), reaping?.stop(), sweeping?.stop(), crowded?.stop()])
}, 60_000)

interface Reply {
    status: number
    headers: Headers
    json: Record<string, unknown> | null
    bytes: Buffer
}

async function request(fx: NodeServerFixture, route: string, method: string, headers: Record<string, string> = {}, body?: Buffer, authenticated = true): Promise<Reply> {
    const sent = { ...headers }
    if (authenticated) {
        sent['risu-auth'] = await fx.authHeader()
    }
    const response = await fetch(`${fx.baseUrl}${route}`, { method, headers: sent, body: body === undefined ? undefined : Uint8Array.from(body) })
    const bytes = Buffer.from(await response.arrayBuffer())
    let json: Record<string, unknown> | null = null
    try {
        const parsed: unknown = JSON.parse(bytes.toString('utf-8'))
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            json = Object.fromEntries(Object.entries(parsed))
        }
    } catch {
        json = null
    }
    return { status: response.status, headers: response.headers, json, bytes }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function eventually(check: () => Promise<boolean>): Promise<boolean> {
    for (let attempt = 0; attempt < 60; attempt++) {
        if (await check()) {
            return true
        }
        await sleep(50)
    }
    return false
}

async function exists(path: string): Promise<boolean> {
    return await stat(path).then(() => true, () => false)
}

function patterned(length: number, seed: number): Buffer {
    return Buffer.from(Array.from({ length }, (_, index) => (index * 7 + seed) & 255))
}

function assetKey(name: string): string {
    return `assets/${name}.bin`
}

const markerDir = (fx: NodeServerFixture) => dirname(fx.saveDir)
const setMarker = (fx: NodeServerFixture, name: string, content: string) => writeFile(join(markerDir(fx), name), content)
const clearMarker = (fx: NodeServerFixture, name: string) => rm(join(markerDir(fx), name), { force: true })

async function begin(fx: NodeServerFixture, created?: string[]): Promise<string> {
    const reply = await request(fx, '/api/upload/begin', 'POST')
    const id = reply.json?.id
    if (reply.status !== 200 || typeof id !== 'string') {
        throw new Error(`begin answered ${reply.status}`)
    }
    created?.push(id)
    return id
}

const stagingOf = (fx: NodeServerFixture, id: string) => join(fx.saveDir, `__upload-${id}`)

function append(fx: NodeServerFixture, id: string, offset: number, bytes: Buffer): Promise<Reply> {
    return request(fx, '/api/upload/append', 'POST', { 'upload-id': id, 'upload-offset': String(offset), 'content-type': 'application/octet-stream' }, bytes)
}

function commit(fx: NodeServerFixture, id: string, key: string, size: number, ifAbsent = false): Promise<Reply> {
    const headers: Record<string, string> = { 'upload-id': id, 'file-path': hexOfKey(key), 'upload-size': String(size) }
    if (ifAbsent) {
        headers['upload-if-absent'] = '1'
    }
    return request(fx, '/api/upload/commit', 'POST', headers)
}

const abort = (fx: NodeServerFixture, id: string) => request(fx, '/api/upload/abort', 'POST', { 'upload-id': id })

const readKey = (fx: NodeServerFixture, key: string) => request(fx, '/api/read', 'GET', { 'file-path': hexOfKey(key) })

function writeKey(fx: NodeServerFixture, key: string, bytes: Buffer): Promise<Reply> {
    return request(fx, '/api/write', 'POST', { 'file-path': hexOfKey(key), 'content-type': 'application/octet-stream' }, bytes)
}

function readRange(fx: NodeServerFixture, key: string, start: number, length: number): Promise<Reply> {
    return request(fx, '/api/read-range', 'GET', { 'file-path': hexOfKey(key), 'range-start': String(start), 'range-length': String(length) })
}

/** Uploads `bytes` in chunks of at most the chunk maximum and commits them under `key`. */
async function uploadWhole(fx: NodeServerFixture, key: string, bytes: Buffer, ifAbsent = false): Promise<Reply> {
    const id = await begin(fx)
    for (let offset = 0; offset < bytes.length; offset += CHUNK_MAX) {
        const reply = await append(fx, id, offset, bytes.subarray(offset, offset + CHUNK_MAX))
        expect(reply.status).toBe(200)
    }
    return await commit(fx, id, key, bytes.length, ifAbsent)
}

/** A POST with no body and no length, which express's raw parser leaves as a non-Buffer body. */
function postWithoutBody(fx: NodeServerFixture, route: string, headers: Record<string, string>): Promise<{ status: number, body: string }> {
    return new Promise((resolve, reject) => {
        const socket = connect(Number(new URL(fx.baseUrl).port), '127.0.0.1')
        let received = ''
        socket.on('data', (chunk) => {
            received += chunk.toString('utf-8')
        })
        socket.on('error', reject)
        socket.on('close', () => {
            const separator = received.indexOf('\r\n\r\n')
            resolve({ status: Number(received.slice(9, 12)), body: separator === -1 ? '' : received.slice(separator + 4) })
        })
        const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('')
        socket.write(`POST ${route} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${headerLines}\r\n`)
    })
}

describe('upload: append', () => {
    test('begin stages a hidden file; appended chunks commit into the key with revision 1', async () => {
        const id = await begin(main)
        expect(id).toMatch(/^[0-9a-f]{32}$/)
        expect(await exists(stagingOf(main, id))).toBe(true)
        const keys = await request(main, '/api/list', 'GET')
        expect(keys.json?.content).not.toContain(`__upload-${id}`)

        const first = patterned(CHUNK_MAX, 1)
        const second = patterned(40, 2)
        expect((await append(main, id, 0, first)).json).toEqual({ success: true, size: 100 })
        expect((await append(main, id, 100, second)).json).toEqual({ success: true, size: 140 })
        const key = assetKey('basic')
        const done = await commit(main, id, key, 140)
        expect(done.status).toBe(200)
        expect(done.json).toEqual({ success: true, revision: 1 })
        const read = await readKey(main, key)
        expect(read.bytes.equals(Buffer.concat([first, second]))).toBe(true)
        expect(read.headers.get('x-risu-revision')).toBe('1')
        expect(await exists(stagingOf(main, id))).toBe(false)
    })

    test('an exact replay of the last chunk is acknowledged without writing it twice', async () => {
        const id = await begin(main)
        const chunk = patterned(60, 3)
        await append(main, id, 0, chunk)
        const replay = await append(main, id, 0, chunk)
        expect(replay.status).toBe(200)
        expect(replay.json).toEqual({ success: true, size: 60 })
        expect((await stat(stagingOf(main, id))).size).toBe(60)
        await abort(main, id)
    })

    test('a replay whose bytes differ from the staged ones is refused with the acknowledged size', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(60, 4))
        const mismatch = await append(main, id, 0, patterned(60, 5))
        expect(mismatch.status).toBe(409)
        expect(mismatch.json?.size).toBe(60)
        expect((await readFile(stagingOf(main, id))).equals(patterned(60, 4))).toBe(true)
        await abort(main, id)
    })

    test('an offset past the acknowledged size is refused and writes nothing', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(50, 6))
        const ahead = await append(main, id, 80, patterned(20, 7))
        expect(ahead.status).toBe(409)
        expect(ahead.json?.size).toBe(50)
        expect((await stat(stagingOf(main, id))).size).toBe(50)
        await abort(main, id)
    })

    test('an offset behind the acknowledged size that is not the last chunk is refused', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(50, 8))
        const behind = await append(main, id, 10, patterned(20, 8))
        expect(behind.status).toBe(409)
        expect(behind.json?.size).toBe(50)
        await abort(main, id)
    })

    test('a chunk over the chunk maximum is refused with 413 before it is staged', async () => {
        const id = await begin(main)
        const oversize = await append(main, id, 0, patterned(CHUNK_MAX + 1, 9))
        expect(oversize.status).toBe(413)
        expect(oversize.json?.code).toBe('PAYLOAD_TOO_LARGE')
        expect((await stat(stagingOf(main, id))).size).toBe(0)
        await abort(main, id)
    })

    test('a total over the asset limit is refused with 413 and leaves the acknowledged bytes', async () => {
        const id = await begin(main)
        for (let offset = 0; offset < ASSET_LIMIT; offset += CHUNK_MAX) {
            expect((await append(main, id, offset, patterned(CHUNK_MAX, 10))).status).toBe(200)
        }
        const over = await append(main, id, ASSET_LIMIT, Buffer.from([1]))
        expect(over.status).toBe(413)
        expect((await stat(stagingOf(main, id))).size).toBe(ASSET_LIMIT)
        await abort(main, id)
    })

    test('a request with a body that is not bytes is refused with 400', async () => {
        const id = await begin(main)
        const token = await main.authHeader()
        const reply = await postWithoutBody(main, '/api/upload/append', { 'risu-auth': token, 'upload-id': id, 'upload-offset': '0' })
        expect(reply.status).toBe(400)
        expect(JSON.parse(reply.body)).toMatchObject({ code: 'upload-body' })
        await abort(main, id)
    })

    test('an unknown id answers 410 upload-gone and a malformed id 400', async () => {
        const gone = await append(main, '0'.repeat(32), 0, patterned(5, 1))
        expect(gone.status).toBe(410)
        expect(gone.json?.code).toBe('upload-gone')
        const malformed = await append(main, 'not-an-id', 0, patterned(5, 1))
        expect(malformed.status).toBe(400)
    })

    test('a failed chunk write is truncated back to the acknowledged size; ENOSPC answers 507; the retry succeeds', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(50, 11))
        await setMarker(main, 'inject-upload-write-fail', 'ENOSPC')
        try {
            const failed = await append(main, id, 50, patterned(80, 12))
            expect(failed.status).toBe(507)
            expect((await stat(stagingOf(main, id))).size).toBe(50)
        } finally {
            await clearMarker(main, 'inject-upload-write-fail')
        }
        const retried = await append(main, id, 50, patterned(80, 12))
        expect(retried.json).toEqual({ success: true, size: 130 })
        await abort(main, id)
    })

    test('an append to an upload whose staging file was removed behind the server answers 410 and does not recreate the file', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(30, 14))
        await rm(stagingOf(main, id))
        const reply = await append(main, id, 30, patterned(10, 14))
        expect(reply.status).toBe(410)
        expect(await exists(stagingOf(main, id))).toBe(false)
        expect((await append(main, id, 30, patterned(10, 14))).status).toBe(410)
    })

    test('abort waits for an append in progress, then removes the staging file; a second abort is a no-op', async () => {
        const id = await begin(main)
        await setMarker(main, 'inject-upload-delay', '400')
        const slow = append(main, id, 0, patterned(30, 13))
        await sleep(150)
        await clearMarker(main, 'inject-upload-delay')
        const aborted = await abort(main, id)
        const appended = await slow
        expect(appended.status).toBe(200)
        expect(aborted.status).toBe(200)
        expect(await exists(stagingOf(main, id))).toBe(false)
        expect((await abort(main, id)).status).toBe(200)
        expect((await append(main, id, 30, patterned(5, 1))).status).toBe(410)
    })
})

describe('upload: commit', () => {
    test('a size that is not the acknowledged size is refused and the upload stays', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(50, 20))
        const wrong = await commit(main, id, assetKey('size-wrong'), 49)
        expect(wrong.status).toBe(409)
        expect(wrong.json?.size).toBe(50)
        expect((await readKey(main, assetKey('size-wrong'))).headers.get('x-risu-exists')).toBe('0')
        expect((await commit(main, id, assetKey('size-wrong'), 50)).status).toBe(200)
    })

    test('a staging file that no longer holds the acknowledged bytes is not committed', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(50, 21))
        await truncate(stagingOf(main, id), 20)
        const refused = await commit(main, id, assetKey('truncated'), 50)
        expect(refused.status).toBe(409)
        expect(refused.json?.size).toBe(20)
        expect((await readKey(main, assetKey('truncated'))).headers.get('x-risu-exists')).toBe('0')
        await abort(main, id)
    })

    test('a key that is not an asset key is refused and the staging file stays for abort', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(10, 22))
        const refused = await commit(main, id, 'settings/plain-key', 10)
        expect(refused.status).toBe(400)
        const oddHex = await request(main, '/api/upload/commit', 'POST', { 'upload-id': id, 'file-path': 'abc', 'upload-size': '10' })
        expect(oddHex.status).toBe(400)
        expect(await exists(stagingOf(main, id))).toBe(true)
        expect((await abort(main, id)).status).toBe(200)
        expect(await exists(stagingOf(main, id))).toBe(false)
    })

    test('if-absent keeps an existing value and bumps nothing; the staging file is gone', async () => {
        const key = assetKey('keep')
        const original = patterned(30, 23)
        expect((await writeKey(main, key, original)).json).toEqual({ success: true, revision: 1 })
        const id = await begin(main)
        await append(main, id, 0, patterned(40, 24))
        const kept = await commit(main, id, key, 40, true)
        expect(kept.status).toBe(200)
        expect(kept.json).toEqual({ kept: true, revision: 1 })
        const read = await readKey(main, key)
        expect(read.bytes.equals(original)).toBe(true)
        expect(read.headers.get('x-risu-revision')).toBe('1')
        expect(await exists(stagingOf(main, id))).toBe(false)
    })

    test('if-absent on a missing key stores the upload', async () => {
        const bytes = patterned(120, 25)
        const done = await uploadWhole(main, assetKey('fresh-if-absent'), bytes, true)
        expect(done.json).toEqual({ success: true, revision: 1 })
        expect((await readKey(main, assetKey('fresh-if-absent'))).bytes.equals(bytes)).toBe(true)
    })

    test('a replacing commit bumps the revision once and the new content is visible', async () => {
        const key = assetKey('replace')
        await writeKey(main, key, patterned(30, 26))
        const replacement = patterned(250, 27)
        const done = await uploadWhole(main, key, replacement)
        expect(done.json).toEqual({ success: true, revision: 2 })
        const read = await readKey(main, key)
        expect(read.bytes.equals(replacement)).toBe(true)
        expect(read.headers.get('x-risu-revision')).toBe('2')
    })

    test('a retried commit after a lost reply gets the first success and does not bump again', async () => {
        const key = assetKey('tombstone')
        const id = await begin(main)
        await append(main, id, 0, patterned(60, 28))
        const first = await commit(main, id, key, 60)
        expect(first.json).toEqual({ success: true, revision: 1 })
        const again = await commit(main, id, key, 60)
        expect(again.status).toBe(200)
        expect(again.json).toEqual({ success: true, revision: 1 })
        expect((await readKey(main, key)).headers.get('x-risu-revision')).toBe('1')
        const elsewhere = await commit(main, id, assetKey('tombstone-other'), 60)
        expect(elsewhere.status).toBe(410)
    })

    test('a rename failure leaves the revision bumped, the old content intact and a JSON failure; the upload is gone', async () => {
        const key = assetKey('rename-fault')
        const original = patterned(30, 29)
        await writeKey(main, key, original)
        const id = await begin(main)
        await append(main, id, 0, patterned(50, 30))
        await setMarker(main, 'inject-rename-fail', 'EIO')
        let failed: Reply
        try {
            failed = await commit(main, id, key, 50)
        } finally {
            await clearMarker(main, 'inject-rename-fail')
        }
        expect(failed.status).toBe(500)
        expect(failed.headers.get('content-type')).toContain('application/json')
        expect(failed.json).toMatchObject({ error: 'Failed to commit upload', code: 'EIO' })
        const read = await readKey(main, key)
        expect(read.bytes.equals(original)).toBe(true)
        expect(read.headers.get('x-risu-revision')).toBe('2')
        expect(await exists(stagingOf(main, id))).toBe(false)
        expect((await commit(main, id, key, 50)).status).toBe(410)
    })

    test('a rename failure for lack of space answers 507', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(10, 31))
        await setMarker(main, 'inject-rename-fail', 'ENOSPC')
        try {
            expect((await commit(main, id, assetKey('rename-enospc'), 10)).status).toBe(507)
        } finally {
            await clearMarker(main, 'inject-rename-fail')
        }
    })

    test('guard: /api/write under an injected rename failure bumps the revision first and keeps the old content', async () => {
        const key = assetKey('write-order')
        const original = patterned(30, 32)
        await writeKey(main, key, original)
        await setMarker(main, 'inject-rename-fail', 'EIO')
        try {
            expect((await writeKey(main, key, patterned(30, 33))).status).toBe(500)
        } finally {
            await clearMarker(main, 'inject-rename-fail')
        }
        const read = await readKey(main, key)
        expect(read.bytes.equals(original)).toBe(true)
        expect(read.headers.get('x-risu-revision')).toBe('2')
    })
})

describe('upload: capacity and reaping', () => {
    const created: string[] = []
    afterEach(async () => {
        await clearMarker(capped, 'inject-upload-delay')
        for (const id of created.splice(0)) {
            await abort(capped, id)
        }
    })

    test('over the staged-bytes cap an append answers 503 upload-capacity; once uploads are idle the least recent is evicted', async () => {
        const a = await begin(capped, created)
        const b = await begin(capped, created)
        const c = await begin(capped, created)
        const d = await begin(capped, created)
        for (const id of [a, b, c]) {
            expect((await append(capped, id, 0, patterned(100, 40))).status).toBe(200)
        }
        const refused = await append(capped, d, 0, patterned(100, 41))
        expect(refused.status).toBe(503)
        expect(refused.json?.code).toBe('upload-capacity')

        await sleep(300)
        expect((await append(capped, d, 0, patterned(100, 41))).status).toBe(200)
        const evicted = await append(capped, a, 100, patterned(10, 42))
        expect(evicted.status).toBe(410)
        expect(evicted.json?.code).toBe('upload-gone')
        expect(await eventually(async () => !(await exists(stagingOf(capped, a))))).toBe(true)
        expect(await exists(stagingOf(capped, b))).toBe(true)
        expect(await exists(stagingOf(capped, c))).toBe(true)
    })

    test('appends that arrive together reserve against the cap before either is written, so only the ones that fit are accepted', async () => {
        // On the fixture without a short eviction time, so a slow runner cannot make a or b evictable.
        const ids = [await begin(crowded), await begin(crowded), await begin(crowded), await begin(crowded)]
        try {
            await append(crowded, ids[0], 0, patterned(100, 47))
            await append(crowded, ids[1], 0, patterned(100, 47))
            const replies = await Promise.all([
                append(crowded, ids[2], 0, patterned(100, 48)),
                append(crowded, ids[3], 0, patterned(100, 48)),
            ])
            expect(replies.map((reply) => reply.status).sort()).toEqual([200, 503])
        } finally {
            for (const id of ids) {
                await abort(crowded, id)
            }
        }
    })

    test('an upload with a request in flight is not evicted even when its last touch is old', async () => {
        const a = await begin(capped, created)
        expect((await append(capped, a, 0, patterned(100, 43))).status).toBe(200)
        await sleep(250)
        await setMarker(capped, 'inject-upload-delay', '900')
        const slow = append(capped, a, 100, patterned(100, 44))
        await sleep(100)
        await clearMarker(capped, 'inject-upload-delay')
        await sleep(200)

        const b = await begin(capped, created)
        const c = await begin(capped, created)
        expect((await append(capped, b, 0, patterned(100, 45))).status).toBe(200)
        const refused = await append(capped, c, 0, patterned(100, 46))
        expect(refused.status).toBe(503)
        expect((await slow).status).toBe(200)
        expect(await exists(stagingOf(capped, a))).toBe(true)
    })

    test('the reaper removes an upload idle past the limit, and a later append gets 410; a touched upload survives', async () => {
        const idle = await begin(reaping)
        const busy = await begin(reaping)
        await append(reaping, idle, 0, patterned(50, 47))
        await append(reaping, busy, 0, patterned(10, 48))
        for (let step = 1; step <= 5; step++) {
            await sleep(150)
            expect((await append(reaping, busy, step * 10, patterned(10, 48))).status).toBe(200)
        }
        expect(await eventually(async () => !(await exists(stagingOf(reaping, idle))))).toBe(true)
        expect((await append(reaping, idle, 50, patterned(5, 1))).status).toBe(410)
        expect(await exists(stagingOf(reaping, busy))).toBe(true)
        await abort(reaping, busy)
    })
})

describe('read-range', () => {
    test('answers the bytes of a piece with the revision, the whole size and the existence headers, uncached', async () => {
        const key = assetKey('ranged')
        const bytes = patterned(250, 50)
        await uploadWhole(main, key, bytes)
        const first = await readRange(main, key, 0, 100)
        expect(first.status).toBe(200)
        expect(first.bytes.equals(bytes.subarray(0, 100))).toBe(true)
        expect(first.headers.get('x-risu-revision')).toBe('1')
        expect(first.headers.get('x-risu-size')).toBe('250')
        expect(first.headers.get('x-risu-exists')).toBe('1')
        expect(first.headers.get('cache-control')).toBe('no-store')
        const tail = await readRange(main, key, 200, 100)
        expect(tail.bytes.equals(bytes.subarray(200))).toBe(true)
        const beyond = await readRange(main, key, 400, 100)
        expect(beyond.bytes.length).toBe(0)
        expect(beyond.headers.get('x-risu-size')).toBe('250')
        expect(beyond.headers.get('x-risu-exists')).toBe('1')
    })

    test('a read after a sequential rewrite answers the new revision with the new bytes', async () => {
        const key = assetKey('ranged-rewrite')
        await writeKey(main, key, patterned(150, 51))
        const before = await readRange(main, key, 0, 100)
        expect(before.headers.get('x-risu-revision')).toBe('1')
        const next = patterned(150, 52)
        await writeKey(main, key, next)
        const after = await readRange(main, key, 0, 100)
        expect(after.headers.get('x-risu-revision')).toBe('2')
        expect(after.bytes.equals(next.subarray(0, 100))).toBe(true)
    })

    test('guard: under concurrent rewrites every revision that a ranged read or HEAD reports pairs with one size and one first byte', async () => {
        // The key lock makes the revision bump and the rename one step for a reader.
        // Without it a reader can see the bumped revision with the old bytes.
        const key = assetKey('range-consistency')
        const auth = await main.authHeader()
        const sizeOf = new Map<number, number>()
        const firstByteOf = new Map<number, number>()
        const conflicts: string[] = []
        const note = (revision: number, size: number, firstByte: number | null) => {
            if (revision === 0) {
                return
            }
            const knownSize = sizeOf.get(revision)
            if (knownSize !== undefined && knownSize !== size) {
                conflicts.push(`revision ${revision}: size ${knownSize} vs ${size}`)
            }
            sizeOf.set(revision, size)
            if (firstByte !== null) {
                const knownByte = firstByteOf.get(revision)
                if (knownByte !== undefined && knownByte !== firstByte) {
                    conflicts.push(`revision ${revision}: first byte ${knownByte} vs ${firstByte}`)
                }
                firstByteOf.set(revision, firstByte)
            }
        }
        const pending: Promise<unknown>[] = []
        for (let round = 1; round <= 200; round++) {
            // Consecutive rounds differ in both size and fill byte.
            const bytes = new Uint8Array(40 + (round % 7) * 8).fill(1 + (round % 7))
            pending.push(fetch(`${main.baseUrl}/api/write`, { method: 'POST', headers: { 'risu-auth': auth, 'file-path': hexOfKey(key), 'content-type': 'application/octet-stream' }, body: bytes }))
            for (let reader = 0; reader < 3; reader++) {
                pending.push(fetch(`${main.baseUrl}/api/read-range`, { headers: { 'risu-auth': auth, 'file-path': hexOfKey(key), 'range-start': '0', 'range-length': String(CHUNK_MAX) } }).then(async (response) => {
                    const body = new Uint8Array(await response.arrayBuffer())
                    note(Number(response.headers.get('x-risu-revision')), Number(response.headers.get('x-risu-size')), body.length > 0 ? body[0] : null)
                }))
                pending.push(fetch(`${main.baseUrl}/api/read`, { method: 'HEAD', headers: { 'risu-auth': auth, 'file-path': hexOfKey(key) } }).then((response) => {
                    note(Number(response.headers.get('x-risu-revision')), Number(response.headers.get('x-risu-size')), null)
                }))
            }
        }
        await Promise.all(pending)
        expect(sizeOf.size).toBeGreaterThan(1)
        expect(conflicts).toEqual([])
    }, 60_000)

    test('an absent key answers exists 0, size 0 and revision 0', async () => {
        const absent = await readRange(main, assetKey('never-written'), 0, 100)
        expect(absent.status).toBe(200)
        expect(absent.headers.get('x-risu-exists')).toBe('0')
        expect(absent.headers.get('x-risu-size')).toBe('0')
        expect(absent.headers.get('x-risu-revision')).toBe('0')
        expect(absent.bytes.length).toBe(0)
    })

    test('refuses a length over the chunk maximum, a zero length, a bad start and a key that is not served by the asset route', async () => {
        const key = assetKey('ranged')
        expect((await readRange(main, key, 0, CHUNK_MAX + 1)).status).toBe(400)
        expect((await readRange(main, key, 0, 0)).status).toBe(400)
        const badStart = await request(main, '/api/read-range', 'GET', { 'file-path': hexOfKey(key), 'range-start': '-1', 'range-length': '10' })
        expect(badStart.status).toBe(400)
        expect((await readRange(main, 'settings/plain-key', 0, 10)).status).toBe(400)
        const nonHex = await request(main, '/api/read-range', 'GET', { 'file-path': 'zz!', 'range-start': '0', 'range-length': '10' })
        expect(nonHex.status).toBe(400)
    })
})

describe('HEAD /api/read', () => {
    test('answers existence, size and revision from a stat and never reads the file', async () => {
        const key = assetKey('head-no-read')
        await writeKey(main, key, patterned(250, 53))
        const logPath = join(markerDir(main), 'read-file.log')
        await rm(logPath, { force: true })

        const head = await request(main, '/api/read', 'HEAD', { 'file-path': hexOfKey(key) })
        // Asserted first: the defect is the whole-file read, not a missing header.
        const reads = await readFile(logPath, 'utf-8').catch(() => '')
        expect(reads).not.toContain(hexOfKey(key))

        expect(head.status).toBe(200)
        expect(head.headers.get('x-risu-exists')).toBe('1')
        expect(head.headers.get('x-risu-size')).toBe('250')
        expect(head.headers.get('x-risu-revision')).toBe('1')
        expect(head.bytes.length).toBe(0)
        const absent = await request(main, '/api/read', 'HEAD', { 'file-path': hexOfKey(assetKey('head-absent')) })
        expect(absent.headers.get('x-risu-exists')).toBe('0')
        expect(absent.headers.get('x-risu-revision')).toBe('0')

        // The spy sees a real read: the same key through GET is logged.
        await readKey(main, key)
        expect(await readFile(logPath, 'utf-8')).toContain(hexOfKey(key))
    })

    test('guard: GET /api/read still answers the whole value with its revision and existence headers', async () => {
        const key = assetKey('get-unchanged')
        const bytes = patterned(90, 54)
        await writeKey(main, key, bytes)
        const read = await readKey(main, key)
        expect(read.bytes.equals(bytes)).toBe(true)
        expect(read.headers.get('x-risu-exists')).toBe('1')
        expect(read.headers.get('x-risu-revision')).toBe('1')
        expect(read.headers.get('content-type')).toBe('application/octet-stream')
    })
})

describe('list-prefix min-size', () => {
    const plant = async (key: string, size: number) => {
        await mkdir(main.saveDir, { recursive: true })
        await writeFile(join(main.saveDir, hexOfKey(key)), Buffer.alloc(size, 1))
    }

    test('answers only the keys larger than the bound, with their sizes; without the parameter the answer is the plain list', async () => {
        await main.clearKeys()
        await plant('assets/small', 5)
        await plant('assets/edge', 10)
        await plant('assets/big', 20)
        await plant('assets/bigger', 30)
        await plant('other/huge', 99)
        await writeFile(join(main.saveDir, `${hexOfKey('assets/tmp')}.tmp-0123456789abcdef`), Buffer.alloc(500))
        const prefix = hexOfKey('assets/')

        const filtered = await request(main, `/api/list-prefix?prefix=${prefix}&min-size=10`, 'GET')
        const content = filtered.json?.content
        const sizes = filtered.json?.sizes
        expect(Array.isArray(content) && Array.isArray(sizes)).toBe(true)
        const pairs = (content as string[]).map((key, index) => [key, (sizes as number[])[index]]).sort()
        expect(pairs).toEqual([['assets/big', 20], ['assets/bigger', 30]])

        const counted = await request(main, `/api/list-prefix?prefix=${prefix}&min-size=10&count=1`, 'GET')
        expect(counted.json).toEqual({ success: true, count: 2 })

        const plain = await request(main, `/api/list-prefix?prefix=${prefix}`, 'GET')
        const plainText = plain.bytes.toString('utf-8')
        expect(plainText).not.toContain('sizes')
        expect(plain.json?.content).toHaveLength(4)
        expect(plainText).toBe(JSON.stringify({ success: true, content: plain.json?.content }))
    })

    test('refuses a min-size that is not a non-negative integer', async () => {
        for (const bad of ['x', '-1', '1.5', '']) {
            const reply = await request(main, `/api/list-prefix?prefix=&min-size=${bad}`, 'GET')
            expect(reply.status).toBe(400)
        }
    })
})

describe('authentication', () => {
    // checkAuth answers 400 for a missing or refused token; 401 and 403 are also accepted as refusals.
    const refusedStatuses = [400, 401, 403]
    const noEffect = (reply: Reply) => {
        expect(refusedStatuses).toContain(reply.status)
        expect(reply.headers.get('x-risu-revision')).toBeNull()
        expect(reply.headers.get('x-risu-exists')).toBeNull()
        expect(reply.json?.success).toBeUndefined()
        expect(reply.json?.id).toBeUndefined()
    }

    test('a caller without a token cannot begin an upload (on the base server the route is absent, so it answers 404: this case is not a reproducer)', async () => {
        const before = await readdir(main.saveDir)
        noEffect(await request(main, '/api/upload/begin', 'POST', {}, undefined, false))
        expect(await readdir(main.saveDir)).toEqual(before)
    })

    test('a caller without a token cannot append, commit or abort, and the upload is unchanged', async () => {
        const id = await begin(main)
        const key = assetKey('auth-guarded')
        expect((await append(main, id, 0, patterned(30, 70))).json).toEqual({ success: true, size: 30 })

        noEffect(await request(main, '/api/upload/append', 'POST', { 'upload-id': id, 'upload-offset': '30', 'content-type': 'application/octet-stream' }, patterned(10, 71), false))
        expect((await stat(stagingOf(main, id))).size).toBe(30)

        noEffect(await request(main, '/api/upload/commit', 'POST', { 'upload-id': id, 'file-path': hexOfKey(key), 'upload-size': '30' }, undefined, false))
        expect((await readKey(main, key)).headers.get('x-risu-exists')).toBe('0')
        expect(await exists(stagingOf(main, id))).toBe(true)

        noEffect(await request(main, '/api/upload/abort', 'POST', { 'upload-id': id }, undefined, false))
        expect(await exists(stagingOf(main, id))).toBe(true)

        const done = await commit(main, id, key, 30)
        expect(done.json).toEqual({ success: true, revision: 1 })
    })

    test('a caller with an invalid token is refused on append, commit and abort', async () => {
        const id = await begin(main)
        await append(main, id, 0, patterned(20, 72))
        // Well formed, unexpired, but signed by a key the server does not know.
        const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
        const forged = { 'risu-auth': [part({ alg: 'ES256', typ: 'JWT' }), part({ pub: 'unknown', exp: 4102444800 }), 'AAAA'].join('.') }
        const refusals = await Promise.all([
            request(main, '/api/upload/append', 'POST', { ...forged, 'upload-id': id, 'upload-offset': '20', 'content-type': 'application/octet-stream' }, patterned(5, 73), false),
            request(main, '/api/upload/commit', 'POST', { ...forged, 'upload-id': id, 'file-path': hexOfKey(assetKey('auth-forged')), 'upload-size': '20' }, undefined, false),
            request(main, '/api/upload/abort', 'POST', { ...forged, 'upload-id': id }, undefined, false),
        ])
        refusals.forEach(noEffect)
        expect((await stat(stagingOf(main, id))).size).toBe(20)
        expect((await readKey(main, assetKey('auth-forged'))).headers.get('x-risu-exists')).toBe('0')
        await abort(main, id)
    })

    test('a caller without a token cannot HEAD a key, read a range or list with min-size', async () => {
        const key = assetKey('auth-read')
        await writeKey(main, key, patterned(25, 74))
        noEffect(await request(main, '/api/read', 'HEAD', { 'file-path': hexOfKey(key) }, undefined, false))
        const range = await request(main, '/api/read-range', 'GET', { 'file-path': hexOfKey(key), 'range-start': '0', 'range-length': '10' }, undefined, false)
        noEffect(range)
        expect(range.bytes.includes(patterned(10, 74))).toBe(false)
        const sized = await request(main, `/api/list-prefix?prefix=${hexOfKey('assets/')}&min-size=0`, 'GET', {}, undefined, false)
        noEffect(sized)
        expect(sized.json?.content).toBeUndefined()
        expect(sized.json?.sizes).toBeUndefined()
    })
})

describe('capabilities', () => {
    test('/api/caps answers pieces: true', async () => {
        const caps = await request(main, '/api/caps', 'GET')
        expect(caps.json).toMatchObject({ pieces: true })
    })
})

describe('startup sweep', () => {
    test('removes upload staging files and key write temps of any hex case and keeps keys and other files', async () => {
        const key = assetKey('survivor')
        expect((await writeKey(sweeping, key, patterned(20, 60))).status).toBe(200)
        await sweeping.halt()

        const hex32 = '0123456789abcdef0123456789abcdef'
        const doomed = [
            `__upload-${hex32}`,
            `__upload-${hex32.toUpperCase()}`,
            `${hexOfKey('assets/orphan')}.tmp-0123456789abcdef`,
            `${hexOfKey('assets/orphan')}.tmp-0123456789ABCDEF`,
        ]
        const kept = [
            hexOfKey('assets/other-key'),
            hexOfKey('assets/upper-key').toUpperCase(),
            '__stray',
            '__upload-short',
            `__upload-${hex32}x`,
            `${hexOfKey('assets/orphan')}.tmp-short`,
            `${hexOfKey('assets/orphan')}.tmp-0123456789abcdef0`,
            `${hexOfKey('assets/orphan')}.part`,
        ]
        for (const name of [...doomed, ...kept]) {
            await writeFile(join(sweeping.saveDir, name), 'x')
        }
        await sweeping.restart()

        const remaining = new Set(await readdir(sweeping.saveDir))
        for (const name of doomed) {
            expect(remaining.has(name)).toBe(false)
        }
        for (const name of [...kept, hexOfKey(key)]) {
            expect(remaining.has(name)).toBe(true)
        }
        expect((await readKey(sweeping, key)).bytes.equals(patterned(20, 60))).toBe(true)
    })

    test('a leftover staging file is gone after a hard kill and restart, and its id answers 410', async () => {
        const id = await begin(sweeping)
        await append(sweeping, id, 0, patterned(30, 61))
        await sweeping.halt('hard')
        expect(await exists(stagingOf(sweeping, id))).toBe(true)
        await sweeping.restart()
        expect(await exists(stagingOf(sweeping, id))).toBe(false)
        expect((await append(sweeping, id, 30, patterned(5, 1))).status).toBe(410)
    })
})

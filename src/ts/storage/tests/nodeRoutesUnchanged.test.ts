// @vitest-environment node
/**
 * Guards: the Node server's original storage routes (`/api/read`, `/api/write`,
 * `/api/remove`, `/api/list`) answer exactly as they did before the guarded
 * routes existed. These are compatibility guards: they pass on the server
 * without the guarded routes and on the server with them, and are not
 * reproducers of any defect.
 *
 * The expected responses below are literals captured from the unmodified server
 * (status, content type, ETag, revision and existence headers, body, and the
 * revision log). `date` and the `ratelimit-*` headers are not part of the table.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture, type NodeServerLaunchOptions } from './nodeServerFixture'
import { fileURLToPath } from 'node:url'

const FAULT_PRELOAD = fileURLToPath(new URL('./nodeRevisionFaults.cjs', import.meta.url))
const withFaults: NodeServerLaunchOptions = { nodeArgs: ['--require', FAULT_PRELOAD] }

let fixture: NodeServerFixture
let faultFixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer()
    faultFixture = await startNodeServer(withFaults)
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
    await faultFixture?.stop()
}, 30_000)

interface Step {
    name: string
    route: 'read' | 'write' | 'remove' | 'list'
    headers?: Record<string, string>
    body?: string
    unauthenticated?: boolean
}

interface Observed {
    name: string
    status: number
    contentType: string | null
    etag: string | null
    revision: string | null
    exists: string | null
    marker: string | null
    body: string
}

async function run(fx: NodeServerFixture, step: Step): Promise<Observed> {
    const headers: Record<string, string> = { ...step.headers }
    if (step.unauthenticated !== true) {
        headers['risu-auth'] = await fx.authHeader()
    }
    if (step.route === 'write') {
        headers['content-type'] = 'application/octet-stream'
    }
    const response = await fetch(`${fx.baseUrl}/api/${step.route}`, {
        method: step.route === 'write' ? 'POST' : 'GET',
        headers,
        body: step.route === 'write' ? Buffer.from(step.body ?? '') : undefined,
    })
    return {
        name: step.name,
        status: response.status,
        contentType: response.headers.get('content-type'),
        etag: response.headers.get('etag'),
        revision: response.headers.get('x-risu-revision'),
        exists: response.headers.get('x-risu-exists'),
        marker: response.headers.get('risu-storage-guarded'),
        body: await response.text(),
    }
}

const h = hexOfKey
const hex = (key: string) => ({ 'file-path': h(key) })

const SEQUENCE: Step[] = [
    { name: 'write new', route: 'write', headers: hex('k1'), body: 'one' },
    { name: 'write again', route: 'write', headers: hex('k1'), body: 'two' },
    { name: 'write if-match ok', route: 'write', headers: { ...hex('k1'), 'if-match-revision': '2' }, body: 'three' },
    { name: 'write if-match stale', route: 'write', headers: { ...hex('k1'), 'if-match-revision': '1' }, body: 'x' },
    { name: 'write if-match NaN', route: 'write', headers: { ...hex('k1'), 'if-match-revision': 'abc' }, body: 'x' },
    { name: 'write non-hex path', route: 'write', headers: { 'file-path': 'zz!' }, body: 'x' },
    { name: 'write without path', route: 'write', body: 'x' },
    { name: 'write upper-case path', route: 'write', headers: { 'file-path': h('k1').toUpperCase() }, body: 'four' },
    { name: 'read present', route: 'read', headers: hex('k1') },
    { name: 'read absent', route: 'read', headers: hex('k2') },
    { name: 'list', route: 'list' },
    { name: 'remove unconditional', route: 'remove', headers: hex('k1') },
    { name: 'remove stale', route: 'remove', headers: { ...hex('k1'), 'if-match-revision': '1' } },
    { name: 'write k3', route: 'write', headers: hex('k3'), body: 'c' },
    { name: 'write k4', route: 'write', headers: hex('k4'), body: 'd' },
    { name: 'remove batch conditional', route: 'remove', headers: { 'file-path': `${h('k3')}$$${h('k4')}`, 'if-match-revision': '1$$1' } },
    { name: 'remove duplicate', route: 'remove', headers: { 'file-path': `${h('k5')}$$${h('k5')}` } },
    { name: 'remove count mismatch', route: 'remove', headers: { 'file-path': `${h('k5')}$$${h('k6')}`, 'if-match-revision': '1' } },
    { name: 'remove bad segment', route: 'remove', headers: { ...hex('k5'), 'if-match-revision': 'x' } },
    { name: 'remove non-hex', route: 'remove', headers: { 'file-path': 'zz!' } },
    { name: 'remove absent', route: 'remove', headers: hex('k9') },
    { name: 'remove without header', route: 'remove' },
    { name: 'read tombstone', route: 'read', headers: hex('k1') },
    { name: 'write after remove', route: 'write', headers: hex('k1'), body: 'again' },
    { name: 'write unauthenticated', route: 'write', headers: hex('k1'), body: 'x', unauthenticated: true },
]

const EXPECTED: Observed[] = [
    { name: 'write new', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"1d-8QCE8GDx1YkBCJRH2Hq/mKqVo1I"', revision: null, exists: null, marker: null, body: '{"success":true,"revision":1}' },
    { name: 'write again', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"1d-0XPizGL50MsIOsMQOAGCbuBquY0"', revision: null, exists: null, marker: null, body: '{"success":true,"revision":2}' },
    { name: 'write if-match ok', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"1d-AxkVnSDbc3NRM/jdlRaV6TCKHSM"', revision: null, exists: null, marker: null, body: '{"success":true,"revision":3}' },
    { name: 'write if-match stale', status: 409, contentType: 'application/json; charset=utf-8', etag: 'W/"31-UuCZvSG2q0v35CYZhvWEAhOY5rI"', revision: null, exists: null, marker: null, body: '{"error":"Revision conflict","currentRevision":3}' },
    { name: 'write if-match NaN', status: 409, contentType: 'application/json; charset=utf-8', etag: 'W/"31-UuCZvSG2q0v35CYZhvWEAhOY5rI"', revision: null, exists: null, marker: null, body: '{"error":"Revision conflict","currentRevision":3}' },
    { name: 'write non-hex path', status: 400, contentType: 'application/json; charset=utf-8', etag: 'W/"18-e98gTfIEt0HJi3ao0AckXdvexJk"', revision: null, exists: null, marker: null, body: '{"error":"Invaild Path"}' },
    { name: 'write without path', status: 400, contentType: 'application/json; charset=utf-8', etag: 'W/"1e-DR9QCLXUi+2pHpdNqYJvI2rmmVY"', revision: null, exists: null, marker: null, body: '{"error":"File path required"}' },
    { name: 'write upper-case path', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"1d-b+ZvVT1L9fZ9Fa63JPnWga3+TSE"', revision: null, exists: null, marker: null, body: '{"success":true,"revision":4}' },
    { name: 'read present', status: 200, contentType: 'application/octet-stream', etag: 'W/"4-n49+7F3qWsQ3OHIZOcEgMYy/8d8"', revision: '4', exists: '1', marker: null, body: 'four' },
    { name: 'read absent', status: 200, contentType: null, etag: null, revision: '0', exists: '0', marker: null, body: '' },
    { name: 'list', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"21-ehAIFIaozmCXdm9VFLYFi5mHIQM"', revision: null, exists: null, marker: null, body: '{"success":true,"content":["k1"]}' },
    { name: 'remove unconditional', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"27-pP9rWyWM4TLNza0D3avULRb2TyM"', revision: null, exists: null, marker: null, body: '{"success":true,"revisions":{"6b31":5}}' },
    { name: 'remove stale', status: 409, contentType: 'application/json; charset=utf-8', etag: 'W/"53-eO90W6D7yhgoJ8ONZZh1plfSfIg"', revision: null, exists: null, marker: null, body: '{"success":false,"error":"Revision conflict","filePath":"6b31","currentRevision":5}' },
    { name: 'write k3', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"1d-8QCE8GDx1YkBCJRH2Hq/mKqVo1I"', revision: null, exists: null, marker: null, body: '{"success":true,"revision":1}' },
    { name: 'write k4', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"1d-8QCE8GDx1YkBCJRH2Hq/mKqVo1I"', revision: null, exists: null, marker: null, body: '{"success":true,"revision":1}' },
    { name: 'remove batch conditional', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"30-RiTt6j7f2SnvfmprOi5Gm1sb20k"', revision: null, exists: null, marker: null, body: '{"success":true,"revisions":{"6b33":2,"6b34":2}}' },
    { name: 'remove duplicate', status: 400, contentType: 'application/json; charset=utf-8', etag: 'W/"46-Ynlmdpb3OKb3LMbFJFuiamC/9oU"', revision: null, exists: null, marker: null, body: '{"error":"Duplicate file-path entries are not allowed in one request"}' },
    { name: 'remove count mismatch', status: 400, contentType: 'application/json; charset=utf-8', etag: 'W/"40-vAtwKQ5GQy7PhNV18zF77Y5zHgg"', revision: null, exists: null, marker: null, body: '{"error":"if-match-revision segment count must match file-path"}' },
    { name: 'remove bad segment', status: 400, contentType: 'application/json; charset=utf-8', etag: 'W/"2d-f3/S1n1s72JlMkhMnFuUyDI74E8"', revision: null, exists: null, marker: null, body: '{"error":"Invalid if-match-revision segment"}' },
    { name: 'remove non-hex', status: 400, contentType: 'application/json; charset=utf-8', etag: 'W/"18-e98gTfIEt0HJi3ao0AckXdvexJk"', revision: null, exists: null, marker: null, body: '{"error":"Invaild Path"}' },
    { name: 'remove absent', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"27-S7vM0hB6IPVb1i3bevJnJ1+jCt4"', revision: null, exists: null, marker: null, body: '{"success":true,"revisions":{"6b39":1}}' },
    { name: 'remove without header', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"1f-SoFDwCEBslvyb91Nbd/kSYzbjIM"', revision: null, exists: null, marker: null, body: '{"success":true,"revisions":{}}' },
    { name: 'read tombstone', status: 200, contentType: null, etag: null, revision: '5', exists: '0', marker: null, body: '' },
    { name: 'write after remove', status: 200, contentType: 'application/json; charset=utf-8', etag: 'W/"1d-aCLxg2N4tianOS5kpH9UWJ+P0Ek"', revision: null, exists: null, marker: null, body: '{"success":true,"revision":6}' },
    { name: 'write unauthenticated', status: 400, contentType: 'application/json; charset=utf-8', etag: 'W/"1a-aeTCJVj8wIIU99MA3svl9lUP0js"', revision: null, exists: null, marker: null, body: '{"error":"No auth header"}' },
]

const EXPECTED_LOG = '\n{"k":"6b31","r":1}\n{"k":"6b31","r":2}\n{"k":"6b31","r":3}\n{"k":"6b31","r":4}\n{"k":"6b31","r":5}\n{"k":"6b33","r":1}\n{"k":"6b34","r":1}\n{"k":"6b33","r":2}\n{"k":"6b34","r":2}\n{"k":"6b39","r":1}\n{"k":"6b31","r":6}'

describe('guard: the original storage routes answer as before', () => {
    test('a header-less request sequence gives the recorded responses and revision log', async () => {
        const observed: Observed[] = []
        for (const step of SEQUENCE) {
            observed.push(await run(fixture, step))
        }
        const log = await readFile(join(fixture.saveDir, '__revisions.log'), 'utf-8')
        expect(observed).toEqual(EXPECTED)
        expect(log).toBe(EXPECTED_LOG)
    })
})

describe('guard: the original routes ignore the guarded headers', () => {
    test('remove with check-only and retire headers removes the key, bumps it, does not retire it and sets no marker', async () => {
        await run(fixture, { name: 'seed', route: 'write', headers: hex('ig/a'), body: 'a' })
        const removed = await run(fixture, {
            name: 'remove with guarded headers',
            route: 'remove',
            headers: {
                ...hex('ig/a'),
                'check-only-path': h('ig/never'),
                'check-only-revision': '5',
                'check-only-count': '1',
                retire: '1',
                'retire-count': '1',
            },
        })
        expect(removed.status).toBe(200)
        expect(removed.marker).toBeNull()
        expect(JSON.parse(removed.body)).toEqual({ success: true, revisions: { [h('ig/a')]: 2 } })
        const read = await run(fixture, { name: 'read', route: 'read', headers: hex('ig/a') })
        expect(read.revision).toBe('2')
        expect(read.exists).toBe('0')
        expect(await readFile(join(fixture.saveDir, '__revisions.log'), 'utf-8')).not.toContain('"d":1')
    })

    test('write with check-only headers that would mismatch still succeeds and sets no marker', async () => {
        const written = await run(fixture, {
            name: 'write with guarded headers',
            route: 'write',
            headers: { ...hex('ig/b'), 'check-only-path': h('ig/never'), 'check-only-revision': '9', 'check-only-count': '1' },
            body: 'b',
        })
        expect(written.status).toBe(200)
        expect(written.marker).toBeNull()
        expect(JSON.parse(written.body)).toEqual({ success: true, revision: 1 })
    })
})

describe('guard: the original remove route when the file removal fails', () => {
    test('answers 500 with the bumped revisions, no marker and no delete record', async () => {
        await run(faultFixture, { name: 'seed', route: 'write', headers: hex('rf/a'), body: 'a' })
        await writeFile(join(faultFixture.saveDir, '..', 'inject-rm-fail'), '')
        const removed = await run(faultFixture, { name: 'remove failing', route: 'remove', headers: hex('rf/a') })
        expect(removed.status).toBe(500)
        expect(removed.marker).toBeNull()
        expect(JSON.parse(removed.body)).toEqual({ success: false, error: 'injected rm failure', revisions: { [h('rf/a')]: 2 } })
        expect(await readFile(join(faultFixture.saveDir, '__revisions.log'), 'utf-8')).not.toContain('"d":1')
        const read = await run(faultFixture, { name: 'read', route: 'read', headers: hex('rf/a') })
        expect(read.exists).toBe('1')
        expect(read.revision).toBe('2')
    })
})
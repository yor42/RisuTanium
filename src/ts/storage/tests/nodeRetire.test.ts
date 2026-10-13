// @vitest-environment node
/**
 * Retiring keys on the real `server/node/server.cjs` through
 * `/api/remove-checked` with the retire flag: the key's file is removed and its
 * revision entry is forgotten, so the revision table stays at the live-key
 * count. A retired key reads revision 0 and its name is never written again.
 * Delete records in the revision log are honoured by the start-up replay in log
 * order.
 *
 * New-behaviour tests are red on a server without the guarded routes. Cases
 * marked as guards pass on both servers.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture, type NodeServerLaunchOptions } from './nodeServerFixture'

const FAULT_PRELOAD = fileURLToPath(new URL('./nodeRevisionFaults.cjs', import.meta.url))
const withFaults = (env: Record<string, string> = {}): NodeServerLaunchOptions => ({ env, nodeArgs: ['--require', FAULT_PRELOAD] })

let fixture: NodeServerFixture | undefined

afterEach(async () => {
    await fixture?.stop()
    fixture = undefined
}, 30_000)

async function start(options: NodeServerLaunchOptions = {}): Promise<NodeServerFixture> {
    fixture = await startNodeServer(options)
    return fixture
}

interface Reply {
    status: number
    headers: Headers
    json: Record<string, unknown> | null
}

async function call(fx: NodeServerFixture, route: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: string): Promise<Reply> {
    const all: Record<string, string> = { ...headers, 'risu-auth': await fx.authHeader() }
    if (method === 'POST') {
        all['content-type'] = 'application/octet-stream'
    }
    const response = await fetch(`${fx.baseUrl}${route}`, { method, headers: all, body: method === 'POST' ? Buffer.from(body ?? '') : undefined })
    const text = await response.text()
    let json: Record<string, unknown> | null = null
    try {
        json = JSON.parse(text)
    } catch {
        json = null
    }
    return { status: response.status, headers: response.headers, json }
}

async function put(fx: NodeServerFixture, key: string, text = 'x'): Promise<number> {
    const reply = await call(fx, '/api/write', 'POST', { 'file-path': hexOfKey(key) }, text)
    return reply.json?.revision as number
}

interface RetireOptions {
    revisions?: number[]
    guard?: Array<[string, number]>
    retire?: boolean
    raw?: Record<string, string | null>
}

async function removeChecked(fx: NodeServerFixture, keys: string[], options: RetireOptions = {}): Promise<Reply> {
    const guard = options.guard ?? []
    const retire = options.retire ?? true
    const headers: Record<string, string> = {
        'file-path': keys.map(hexOfKey).join('$$'),
        'check-only-count': String(guard.length),
        'retire-count': retire ? String(keys.length) : '0',
        'own-condition-count': String(options.revisions?.length ?? 0),
    }
    if (guard.length > 0) {
        headers['check-only-path'] = guard.map(([key]) => hexOfKey(key)).join('$$')
        headers['check-only-revision'] = guard.map(([, revision]) => String(revision)).join('$$')
    }
    if (retire) {
        headers.retire = '1'
    }
    if (options.revisions !== undefined) {
        headers['if-match-revision'] = options.revisions.join('$$')
    }
    for (const [name, value] of Object.entries(options.raw ?? {})) {
        if (value === null) {
            delete headers[name]
        } else {
            headers[name] = value
        }
    }
    return await call(fx, '/api/remove-checked', 'GET', headers)
}

async function readState(fx: NodeServerFixture, key: string): Promise<{ revision: number, exists: boolean }> {
    const response = await fetch(`${fx.baseUrl}/api/read`, { headers: { 'file-path': hexOfKey(key), 'risu-auth': await fx.authHeader() } })
    await response.arrayBuffer()
    return { revision: Number(response.headers.get('x-risu-revision')), exists: response.headers.get('x-risu-exists') === '1' }
}

async function list(fx: NodeServerFixture): Promise<string[]> {
    const response = await fetch(`${fx.baseUrl}/api/list`, { headers: { 'risu-auth': await fx.authHeader() } })
    return (await response.json() as { content: string[] }).content
}

const snapshotPath = (fx: NodeServerFixture) => join(fx.saveDir, '__revisions.json')
const logPath = (fx: NodeServerFixture) => join(fx.saveDir, '__revisions.log')
const markerPath = (fx: NodeServerFixture, name: string) => join(fx.saveDir, '..', name)

async function snapshotKeys(fx: NodeServerFixture): Promise<string[]> {
    return Object.keys(JSON.parse(await readFile(snapshotPath(fx), 'utf-8')))
}

const unit = (name: string) => `store2/${name}`

describe('retire', () => {
    test('removes the file, answers the bumped revisions with the echo, and the key then reads 0 and is not listed', async () => {
        const fx = await start()
        const commit = 'commit/head'
        await put(fx, commit)
        const a = unit('a')
        const b = unit('b')
        await put(fx, a)
        await put(fx, b)
        const reply = await removeChecked(fx, [a, b], { revisions: [1, 1], guard: [[commit, 1]] })
        expect(reply.status).toBe(200)
        expect(reply.json).toEqual({
            success: true,
            revisions: { [hexOfKey(a)]: 2, [hexOfKey(b)]: 2 },
            revision: 2,
            checkOnly: 1,
            retired: 2,
            ownCondition: 2,
        })
        expect(reply.headers.get('risu-storage-guarded')).toBe('1')
        expect(await readState(fx, a)).toEqual({ revision: 0, exists: false })
        expect(await readState(fx, b)).toEqual({ revision: 0, exists: false })
        expect(await list(fx)).toEqual([commit])
    }, 60_000)

    test('after a restart the retired keys read 0 and the snapshot holds no retired key, while a plainly removed key stays as a tombstone', async () => {
        const fx = await start()
        const commit = 'commit/head'
        await put(fx, commit)
        const retired = unit('retired')
        const plain = unit('plain')
        await put(fx, retired)
        await put(fx, plain)
        expect((await removeChecked(fx, [retired], { guard: [[commit, 1]] })).status).toBe(200)
        expect((await removeChecked(fx, [plain], { guard: [[commit, 1]], retire: false })).status).toBe(200)
        await fx.restart()
        expect(await readState(fx, retired)).toEqual({ revision: 0, exists: false })
        expect(await readState(fx, plain)).toEqual({ revision: 2, exists: false })
        const keys = await snapshotKeys(fx)
        expect(keys).not.toContain(hexOfKey(retired))
        expect(keys).toContain(hexOfKey(plain))
        expect(keys).toContain(hexOfKey(commit))
    }, 60_000)

    test('a batch of two retired keys: after a restart both read 0 and neither is in the snapshot', async () => {
        const fx = await start()
        const commit = 'commit/head'
        await put(fx, commit)
        const first = unit('first')
        const second = unit('second')
        await put(fx, first)
        await put(fx, second)
        expect((await removeChecked(fx, [first, second], { guard: [[commit, 1]] })).status).toBe(200)
        await fx.restart()
        expect(await readState(fx, first)).toEqual({ revision: 0, exists: false })
        expect(await readState(fx, second)).toEqual({ revision: 0, exists: false })
        const keys = await snapshotKeys(fx)
        expect(keys).not.toContain(hexOfKey(first))
        expect(keys).not.toContain(hexOfKey(second))
    }, 60_000)

    test('retire, then a forced runtime compaction, then a restart: the key stays at 0 and out of the snapshot', async () => {
        const fx = await start({ env: { RISU_REVISION_LOG_COMPACT_AT: '1' } })
        const commit = 'commit/head'
        await put(fx, commit)
        const retired = unit('retired')
        await put(fx, retired)
        expect((await removeChecked(fx, [retired], { guard: [[commit, 1]] })).status).toBe(200)
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline) {
            try {
                if (!(await snapshotKeys(fx)).includes(hexOfKey(retired)) && (await snapshotKeys(fx)).includes(hexOfKey(commit))) {
                    break
                }
            } catch {
                // The snapshot is not written yet.
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        expect(await snapshotKeys(fx)).not.toContain(hexOfKey(retired))
        await fx.restart()
        expect(await readState(fx, retired)).toEqual({ revision: 0, exists: false })
        expect(await snapshotKeys(fx)).not.toContain(hexOfKey(retired))
    }, 60_000)

    describe('replay of delete records, with hand-built files while the server is stopped', () => {
        const K = unit('replay')
        const kHex = hexOfKey(K)

        async function replay(snapshot: Record<string, number> | null, lines: string[]): Promise<number> {
            const fx = await start()
            await fx.halt()
            if (snapshot !== null) {
                await writeFile(snapshotPath(fx), JSON.stringify(snapshot))
            }
            await writeFile(logPath(fx), lines.map((line) => `\n${line}`).join(''))
            await fx.restart()
            return (await readState(fx, K)).revision
        }

        test('(a) a snapshot without the key plus a bump and then a delete reads 0', async () => {
            expect(await replay({}, [`{"k":"${kHex}","r":5}`, `{"k":"${kHex}","d":1}`])).toBe(0)
        })

        test('(b) a snapshot holding the key plus a delete reads 0', async () => {
            expect(await replay({ [kHex]: 5 }, [`{"k":"${kHex}","d":1}`])).toBe(0)
        })

        test('(c) a delete followed by a bump reads the later bump, not the snapshot value (log order)', async () => {
            expect(await replay({ [kHex]: 5 }, [`{"k":"${kHex}","d":1}`, `{"k":"${kHex}","r":2}`])).toBe(2)
        })

        test('(d) a record with both d and r, a non-string key, d other than 1 and a torn tail are skipped: the snapshot value stays', async () => {
            const lines = [
                `{"k":"${kHex}","d":1,"r":5}`,
                `{"k":5,"d":1}`,
                `{"k":"${kHex}","d":2}`,
                `{"k":"${kHex}","d":1`,
            ]
            expect(await replay({ [kHex]: 3 }, lines)).toBe(3)
        })
    })

    test('a failing file removal answers 500 with the bumped revisions, retires nothing, and a repeat carrying the bumped revision retires', async () => {
        const fx = await start(withFaults())
        const commit = 'commit/head'
        await put(fx, commit)
        const a = unit('a')
        await put(fx, a)
        await writeFile(markerPath(fx, 'inject-rm-fail'), '')
        const failed = await removeChecked(fx, [a], { revisions: [1], guard: [[commit, 1]] })
        expect(failed.status).toBe(500)
        expect(failed.json).toMatchObject({ success: false, revisions: { [hexOfKey(a)]: 2 } })
        expect(await readState(fx, a)).toEqual({ revision: 2, exists: true })
        expect(await readFile(logPath(fx), 'utf-8')).not.toContain('"d":1')
        const repeat = await removeChecked(fx, [a], { revisions: [2], guard: [[commit, 1]] })
        expect(repeat.status).toBe(200)
        expect(await readState(fx, a)).toEqual({ revision: 0, exists: false })
    }, 60_000)

    test('a failing append of the delete record answers 500 with the bumped revisions, keeps memory at the bumped value, and a restart reads 0 or the bumped value', async () => {
        const fx = await start(withFaults())
        const commit = 'commit/head'
        await put(fx, commit)
        const a = unit('a')
        const b = unit('b')
        await put(fx, a)
        await put(fx, b)
        await writeFile(markerPath(fx, 'inject-retire-append-fail'), '')
        const failed = await removeChecked(fx, [a, b], { revisions: [1, 1], guard: [[commit, 1]] })
        expect(failed.status).toBe(500)
        expect(failed.json).toMatchObject({ success: false, revisions: { [hexOfKey(a)]: 2, [hexOfKey(b)]: 2 } })
        expect(await readState(fx, a)).toEqual({ revision: 2, exists: false })
        expect(await readState(fx, b)).toEqual({ revision: 2, exists: false })
        const immediate = await removeChecked(fx, [unit('other')], { guard: [[a, 2]], retire: false })
        expect(immediate.status).toBe(200)
        // The default compaction threshold leaves the log alone until the restart replays it, so a key whose delete
        // record became durable reads 0 and the others keep the bumped revision. A half-written delete lowering a key
        // to 0 is the accepted outcome: the file is already gone.
        await fx.restart()
        for (const key of [a, b]) {
            const { revision } = await readState(fx, key)
            expect([0, 2]).toContain(revision)
        }
    }, 60_000)

    test('keys outside the A-lite prefix are refused whole, and nothing is removed, bumped or logged', async () => {
        const fx = await start()
        const commit = 'commit/head'
        await put(fx, commit)
        const inside = unit('inside')
        const outside = 'database/database.bin'
        await put(fx, inside)
        await put(fx, outside)
        const logBefore = await readFile(logPath(fx), 'utf-8')
        for (const keys of [[outside], [inside, outside], ['store2']]) {
            const reply = await removeChecked(fx, keys, { guard: [[commit, 1]] })
            expect(reply.status, keys.join()).toBe(400)
            expect(reply.headers.get('risu-storage-guarded')).toBe('1')
        }
        expect(await readState(fx, inside)).toEqual({ revision: 1, exists: true })
        expect(await readState(fx, outside)).toEqual({ revision: 1, exists: true })
        expect(await readFile(logPath(fx), 'utf-8')).toBe(logBefore)
    }, 60_000)

    test('retire without a check-only key, or with a retire value other than 1, is refused', async () => {
        const fx = await start()
        const a = unit('a')
        await put(fx, a)
        expect((await removeChecked(fx, [a])).status).toBe(400)
        expect((await removeChecked(fx, [a], { guard: [['commit/head', 0]], raw: { retire: '2' } })).status).toBe(400)
        expect((await removeChecked(fx, [a], { guard: [['commit/head', 0]], raw: { retire: 'true' } })).status).toBe(400)
        expect(await readState(fx, a)).toEqual({ revision: 1, exists: true })
    }, 60_000)

    test('a stale check-only key answers 409 and nothing is removed or retired', async () => {
        const fx = await start()
        const commit = 'commit/head'
        await put(fx, commit)
        const a = unit('a')
        await put(fx, a)
        const reply = await removeChecked(fx, [a], { guard: [[commit, 7]] })
        expect(reply.status).toBe(409)
        expect(reply.json?.filePath).toBe(hexOfKey(commit))
        expect(await readState(fx, a)).toEqual({ revision: 1, exists: true })
        expect(await readFile(logPath(fx), 'utf-8')).not.toContain('"d":1')
    }, 60_000)

    test('remove-checked without the retire flag never writes a delete record and the removed key reads its bumped revision', async () => {
        const fx = await start()
        const commit = 'commit/head'
        await put(fx, commit)
        const a = unit('a')
        await put(fx, a)
        const reply = await removeChecked(fx, [a], { guard: [[commit, 1]], retire: false })
        expect(reply.status).toBe(200)
        expect(reply.json?.retired).toBe(0)
        expect(await readState(fx, a)).toEqual({ revision: 2, exists: false })
        expect(await readFile(logPath(fx), 'utf-8')).not.toContain('"d":1')
    }, 60_000)

    test('diagnostic: a retired name written again restarts at revision 1, which is why a retired name is never reused', async () => {
        const fx = await start()
        const commit = 'commit/head'
        await put(fx, commit)
        const a = unit('a')
        await put(fx, a)
        await put(fx, a)
        expect((await removeChecked(fx, [a], { guard: [[commit, 1]] })).status).toBe(200)
        expect(await put(fx, a)).toBe(1)
    }, 60_000)

    test('retire batches racing guarded writes and a forced compaction end with a revision table equal to the live set after a restart', async () => {
        const fx = await start({ env: { RISU_REVISION_LOG_COMPACT_AT: '5' } })
        const commit = 'commit/head'
        await put(fx, commit)
        const garbage: string[] = []
        for (let i = 0; i < 40; i++) {
            garbage.push(unit(`g${i}`))
            await put(fx, garbage[i])
        }
        const jobs: Array<Promise<unknown>> = []
        for (let i = 0; i < 40; i += 4) {
            jobs.push(removeChecked(fx, garbage.slice(i, i + 4), { guard: [[commit, 1]] }))
            jobs.push(call(fx, '/api/write-checked', 'POST', {
                'file-path': hexOfKey(`live/${i}`),
                'check-only-count': '1',
                'own-condition-count': '0',
                'check-only-path': hexOfKey(commit),
                'check-only-revision': '1',
            }, 'live'))
        }
        const replies = await Promise.all(jobs)
        expect(replies.every((reply) => (reply as Reply).status === 200)).toBe(true)
        await fx.restart()
        const keys = await snapshotKeys(fx)
        for (const key of garbage) {
            expect(keys).not.toContain(hexOfKey(key))
            expect((await readState(fx, key)).revision).toBe(0)
        }
        expect(keys).toContain(hexOfKey(commit))
        expect(keys.length).toBe(1 + 10)
    }, 120_000)
})

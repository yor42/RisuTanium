// @vitest-environment node
/**
 * The Node server's per-key revision counters against the real
 * `server/node/server.cjs`, run as a child process and restarted or killed on
 * the same data directory. The revisions a client has been told must never be
 * recovered lower, and a write must not rewrite the whole revision snapshot.
 */
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

interface WriteResult { status: number, revision?: number, currentRevision?: number }

async function write(fx: NodeServerFixture, key: string, ifMatch?: number): Promise<WriteResult> {
    const headers: Record<string, string> = {
        'file-path': hexOfKey(key),
        'risu-auth': await fx.authHeader(),
        'content-type': 'application/octet-stream',
    }
    if (ifMatch !== undefined) {
        headers['if-match-revision'] = String(ifMatch)
    }
    const response = await fetch(`${fx.baseUrl}/api/write`, { method: 'POST', headers, body: Buffer.from(`body of ${key}`) })
    const body = await response.json().catch(() => ({})) as { revision?: number, currentRevision?: number }
    return { status: response.status, revision: body.revision, currentRevision: body.currentRevision }
}

async function readRevision(fx: NodeServerFixture, key: string): Promise<number> {
    const response = await fetch(`${fx.baseUrl}/api/read`, { headers: { 'file-path': hexOfKey(key), 'risu-auth': await fx.authHeader() } })
    await response.arrayBuffer()
    return Number(response.headers.get('x-risu-revision'))
}

async function remove(fx: NodeServerFixture, keys: string[]): Promise<{ status: number, revisions?: Record<string, number> }> {
    const response = await fetch(`${fx.baseUrl}/api/remove`, {
        headers: { 'file-path': keys.map(hexOfKey).join('$$'), 'risu-auth': await fx.authHeader() },
    })
    const body = await response.json().catch(() => ({})) as { revisions?: Record<string, number> }
    return { status: response.status, revisions: body.revisions }
}

async function rawStatus(fx: NodeServerFixture, route: 'read' | 'remove' | 'write', filePath: string): Promise<number> {
    const response = await fetch(`${fx.baseUrl}/api/${route}`, {
        method: route === 'write' ? 'POST' : 'GET',
        headers: { 'file-path': filePath, 'risu-auth': await fx.authHeader(), 'content-type': 'application/octet-stream' },
        body: route === 'write' ? Buffer.from('x') : undefined,
    })
    await response.arrayBuffer()
    return response.status
}

async function list(fx: NodeServerFixture): Promise<string[]> {
    const response = await fetch(`${fx.baseUrl}/api/list`, { headers: { 'risu-auth': await fx.authHeader() } })
    return (await response.json() as { content: string[] }).content
}

const markerPath = (fx: NodeServerFixture, name: string) => join(fx.saveDir, '..', name)
const snapshotPath = (fx: NodeServerFixture) => join(fx.saveDir, '__revisions.json')
const logPath = (fx: NodeServerFixture) => join(fx.saveDir, '__revisions.log')
const record = (key: string, revision: number | string) => `\n{"k":"${hexOfKey(key)}","r":${revision}}`

async function readSnapshot(fx: NodeServerFixture): Promise<Record<string, number>> {
    return JSON.parse(await readFile(snapshotPath(fx), 'utf-8'))
}

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
        if (await condition()) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out waiting for ${what}`)
}

describe('revision persistence cost', () => {
    test('a write after a restart leaves the snapshot bytes alone and its revision survives a hard kill', async () => {
        const fx = await start()
        for (let i = 0; i < 50; i++) {
            expect((await write(fx, `bulk/${i}`)).status).toBe(200)
        }
        await fx.restart()
        const before = await readFile(snapshotPath(fx), 'utf-8')

        const written = await write(fx, 'bulk/7', 1)
        expect(written).toEqual({ status: 200, revision: 2, currentRevision: undefined })
        const after = await readFile(snapshotPath(fx), 'utf-8')
        expect(after).toBe(before)

        await fx.halt('hard')
        await fx.restart()
        expect(await readRevision(fx, 'bulk/7')).toBe(2)
    }, 60_000)
})

describe('revision recovery', () => {
    test('guard: after a hard kill no acknowledged revision is recovered lower', async () => {
        const fx = await start()
        expect((await write(fx, 'k1')).revision).toBe(1)
        expect((await write(fx, 'k2')).revision).toBe(1)
        expect((await write(fx, 'k3')).revision).toBe(1)
        expect((await write(fx, 'k1', 1)).revision).toBe(2)
        expect((await write(fx, 'k1', 2)).revision).toBe(3)
        const stale = await write(fx, 'k1', 1)
        expect(stale).toEqual({ status: 409, revision: undefined, currentRevision: 3 })
        const removed = await remove(fx, ['k2'])
        expect(removed).toEqual({ status: 200, revisions: { [hexOfKey('k2')]: 2 } })

        await fx.halt('hard')
        await fx.restart()

        expect(await readRevision(fx, 'k1')).toBe(3)
        expect(await readRevision(fx, 'k2')).toBe(2)
        expect(await readRevision(fx, 'k3')).toBe(1)
        expect((await write(fx, 'k1', 3)).revision).toBe(4)
    }, 60_000)

    test('guard: a stale conditional write is refused after a restart that replayed the log', async () => {
        const fx = await start()
        await write(fx, 'doc')
        await write(fx, 'doc', 1)
        await write(fx, 'doc', 2)

        await fx.restart()

        expect(await write(fx, 'doc', 2)).toEqual({ status: 409, revision: undefined, currentRevision: 3 })
        expect((await write(fx, 'doc', 3)).revision).toBe(4)
    }, 60_000)

    test('skips torn, garbage and invalid log records, keeps the valid ones, and lets a key with only invalid records advance', async () => {
        const fx = await start()
        await fx.halt()
        await writeFile(logPath(fx), [
            record('a', 5),
            record('b', 3),
            record('a', 2),
            '\nnot json at all',
            record('c', '1e20'),
            record('c', -1),
            record('c', 1.5),
            '\n{"r":9}',
            `\n{"k":7,"r":9}`,
            '\n[1,2]',
            '\nnull',
            `\n{"k":"${hexOfKey('c')}"}`,
            `\n{"k":"${hexOfKey('a')}","r":99`,
        ].join(''))

        await fx.restart()

        expect(await readRevision(fx, 'a')).toBe(5)
        expect(await readRevision(fx, 'b')).toBe(3)
        expect(await readRevision(fx, 'c')).toBe(0)
        expect((await write(fx, 'c')).revision).toBe(1)
        expect((await write(fx, 'a', 5)).revision).toBe(6)
    }, 60_000)

    test('folds a log present at startup into the snapshot, removes it, and a second restart reads the same revisions', async () => {
        const fx = await start()
        await write(fx, 'x')
        await write(fx, 'x', 1)
        await write(fx, 'y')
        await fx.halt('hard')
        expect(existsSync(logPath(fx))).toBe(true)

        await fx.restart()

        expect(existsSync(logPath(fx))).toBe(false)
        expect(await readSnapshot(fx)).toEqual({ [hexOfKey('x')]: 2, [hexOfKey('y')]: 1 })
        await fx.restart()
        expect(await readRevision(fx, 'x')).toBe(2)
        expect(await readRevision(fx, 'y')).toBe(1)
    }, 60_000)

    test('recovers the same revisions when the snapshot was renamed into place but the log was not yet deleted', async () => {
        const fx = await start()
        await fx.halt()
        await writeFile(snapshotPath(fx), JSON.stringify({ [hexOfKey('a')]: 2, [hexOfKey('b')]: 1 }))
        await writeFile(logPath(fx), [record('a', 1), record('a', 2), record('b', 1)].join(''))

        await fx.restart()

        expect(await readRevision(fx, 'a')).toBe(2)
        expect(await readRevision(fx, 'b')).toBe(1)
        expect(existsSync(logPath(fx))).toBe(false)
    }, 60_000)

    test('treats prototype-named keys in the log as ordinary data', async () => {
        const fx = await start()
        await fx.halt()
        await writeFile(logPath(fx), [
            '\n{"k":"__proto__","r":4}',
            '\n{"k":"constructor","r":4}',
            record('a', 2),
        ].join(''))

        await fx.restart()

        const snapshot = await readSnapshot(fx)
        expect(Object.hasOwn(snapshot, '__proto__')).toBe(true)
        expect(Object.hasOwn(snapshot, 'constructor')).toBe(true)
        expect(snapshot[hexOfKey('a')]).toBe(2)
        expect(await readRevision(fx, 'a')).toBe(2)
    }, 60_000)

    test('guard: a data directory with a snapshot and a stray snapshot temp starts with the same revisions', async () => {
        const fx = await start()
        await fx.halt()
        await writeFile(snapshotPath(fx), JSON.stringify({ [hexOfKey('a')]: 3, [hexOfKey('b')]: 1 }))
        await writeFile(join(fx.saveDir, '__revisions.json.tmp-0123456789abcdef'), '{"partial":')

        await fx.restart()

        expect(await readRevision(fx, 'a')).toBe(3)
        expect(await readRevision(fx, 'b')).toBe(1)
        expect(await write(fx, 'a', 3)).toMatchObject({ status: 200, revision: 4 })
    }, 60_000)
})

describe('failed revision append', () => {
    test('fails the request, rolls the bump back, and leaves a torn record that cannot merge into the next one', async () => {
        const fx = await start(withFaults())
        expect((await write(fx, 'k1')).revision).toBe(1)

        await writeFile(markerPath(fx, 'inject-append-fail'), '')
        const failed = await write(fx, 'k2')
        expect(failed.status).toBe(500)
        expect(await readRevision(fx, 'k2')).toBe(0)

        expect((await write(fx, 'k2')).revision).toBe(1)
        expect((await write(fx, 'k1', 1)).revision).toBe(2)

        const lines = (await readFile(logPath(fx), 'utf-8')).split('\n')
        expect(lines).toContain(`{"k":"${hexOfKey('k2')}","r":1}`)
        expect(lines).toContain(`{"k":"${hexOfKey('k1')}","r":2}`)

        await fx.halt('hard')
        await fx.restart()
        expect(await readRevision(fx, 'k1')).toBe(2)
        expect(await readRevision(fx, 'k2')).toBe(1)
    }, 60_000)
})

describe('failed revision append on remove', () => {
    test('fails the batch, rolls every in-memory bump back, and a later remove succeeds with revisions never lower', async () => {
        const fx = await start(withFaults())
        await write(fx, 'a')
        await write(fx, 'b')

        await writeFile(markerPath(fx, 'inject-append-fail'), '')
        const failed = await remove(fx, ['a', 'b'])
        expect(failed.status).toBe(500)
        expect(await readRevision(fx, 'a')).toBe(1)
        expect(await readRevision(fx, 'b')).toBe(1)

        const removed = await remove(fx, ['a', 'b'])
        expect(removed).toEqual({ status: 200, revisions: { [hexOfKey('a')]: 2, [hexOfKey('b')]: 2 } })

        await fx.halt('hard')
        await fx.restart()
        expect(await readRevision(fx, 'a')).toBe(2)
        expect(await readRevision(fx, 'b')).toBe(2)
    }, 60_000)
})

describe('unreadable revision log', () => {
    test('refuses to start, leaves the log bytes alone, and a restart after the fault is gone recovers the logged revision', async () => {
        const fx = await start(withFaults())
        await write(fx, 'doc')
        await write(fx, 'doc', 1)
        await fx.restart()
        expect((await write(fx, 'doc', 2)).revision).toBe(3)
        await fx.halt('hard')
        const logBefore = await readFile(logPath(fx))
        const snapshotBefore = await readFile(snapshotPath(fx))
        expect(logBefore.length).toBeGreaterThan(0)

        await writeFile(markerPath(fx, 'inject-read-fail'), '')
        await expect(fx.restart()).rejects.toThrow(/exited with code 1 before it was ready/)
        expect((await readFile(logPath(fx))).equals(logBefore)).toBe(true)
        expect((await readFile(snapshotPath(fx))).equals(snapshotBefore)).toBe(true)

        await rm(markerPath(fx, 'inject-read-fail'))
        await fx.restart()
        expect(await readRevision(fx, 'doc')).toBe(3)
        expect(await write(fx, 'doc', 2)).toMatchObject({ status: 409, currentRevision: 3 })
    }, 60_000)
})

describe('hidden revision files', () => {
    test('guard: list never returns the revision files and read, write and remove refuse their names', async () => {
        const fx = await start()
        await write(fx, 'real')
        await fx.restart()
        await write(fx, 'real', 1)
        await writeFile(join(fx.saveDir, '__revisions.json.tmp-0123456789abcdef'), '')
        const names = ['__revisions.json', '__revisions.log', '__revisions.json.tmp-0123456789abcdef']
        const revisionFiles = async () => (await readdir(fx.saveDir)).filter((name) => name.startsWith('__revisions')).sort()
        const filesBefore = await revisionFiles()
        expect(filesBefore).toContain('__revisions.json')

        expect(await list(fx)).toEqual(['real'])
        const snapshotBefore = await readFile(snapshotPath(fx), 'utf-8')
        for (const name of names) {
            for (const route of ['read', 'write', 'remove'] as const) {
                expect(await rawStatus(fx, route, name), `${route} ${name}`).toBe(400)
            }
        }
        expect(await readFile(snapshotPath(fx), 'utf-8')).toBe(snapshotBefore)
        expect(await revisionFiles()).toEqual(filesBefore)
    }, 60_000)
})

describe('revision log compaction', () => {
    test('compacts at runtime once the log passes the threshold, shrinking it without changing any revision', async () => {
        const fx = await start({ env: { RISU_REVISION_LOG_COMPACT_AT: '5' } })
        const expected: Record<string, number> = {}
        for (let i = 0; i < 13; i++) {
            const key = `key/${i % 9}`
            const result = await write(fx, key)
            expect(result.status).toBe(200)
            expected[hexOfKey(key)] = result.revision as number
            if (i === 3) {
                expect(existsSync(logPath(fx))).toBe(true)
                expect(existsSync(snapshotPath(fx))).toBe(false)
            }
        }
        await waitFor(async () => existsSync(snapshotPath(fx)), 'the runtime snapshot')
        await waitFor(async () => !existsSync(logPath(fx)) || (await stat(logPath(fx))).size < 5 * 80, 'the log to shrink')

        const snapshot = await readSnapshot(fx)
        for (const [key, revision] of Object.entries(snapshot)) {
            expect(revision).toBeLessThanOrEqual(expected[key])
        }
        await fx.halt('hard')
        await fx.restart()
        for (let i = 0; i < 9; i++) {
            expect(await readRevision(fx, `key/${i}`)).toBe(expected[hexOfKey(`key/${i}`)])
        }
    }, 60_000)

    test('a failing runtime compaction never fails a request, is not retried on every write, and a later one loses nothing', async () => {
        const fx = await start(withFaults({ RISU_REVISION_LOG_COMPACT_AT: '3' }))
        await writeFile(markerPath(fx, 'inject-rename-fail'), '')
        const attempts = async () => existsSync(markerPath(fx, 'rename-attempts.txt'))
            ? (await readFile(markerPath(fx, 'rename-attempts.txt'), 'utf-8')).split('\n').filter(Boolean).length
            : 0

        for (let i = 1; i <= 5; i++) {
            expect((await write(fx, `w/${i}`)).revision).toBe(1)
        }
        await waitFor(async () => (await attempts()) >= 1, 'the first compaction attempt')
        expect(await attempts()).toBe(1)
        expect(existsSync(logPath(fx))).toBe(true)

        await rm(markerPath(fx, 'inject-rename-fail'))
        expect((await write(fx, 'w/6')).revision).toBe(1)
        await waitFor(async () => !existsSync(logPath(fx)), 'the log to be compacted away')
        expect(Object.keys(await readSnapshot(fx))).toHaveLength(6)

        await fx.halt('hard')
        await fx.restart()
        for (let i = 1; i <= 6; i++) {
            expect(await readRevision(fx, `w/${i}`)).toBe(1)
        }
    }, 60_000)

    test('a failing startup compaction still starts the server with every revision and keeps the log, and a later start folds it', async () => {
        const fx = await start(withFaults())
        await write(fx, 'p')
        await write(fx, 'p', 1)
        await write(fx, 'q')
        await fx.halt('hard')
        await writeFile(markerPath(fx, 'inject-rename-fail'), '')

        await fx.restart()

        expect(await readRevision(fx, 'p')).toBe(2)
        expect(await readRevision(fx, 'q')).toBe(1)
        expect(existsSync(logPath(fx))).toBe(true)
        expect((await write(fx, 'p', 2)).revision).toBe(3)
        expect(existsSync(snapshotPath(fx))).toBe(false)

        await fx.halt('hard')
        await rm(markerPath(fx, 'inject-rename-fail'))
        await fx.restart()

        expect(existsSync(logPath(fx))).toBe(false)
        expect(await readRevision(fx, 'p')).toBe(3)
        expect(await readRevision(fx, 'q')).toBe(1)
    }, 60_000)
})

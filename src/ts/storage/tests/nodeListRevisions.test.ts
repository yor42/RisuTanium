// @vitest-environment node
/**
 * `/api/list-prefix?revisions=1` of the real `server/node/server.cjs` (run as a
 * child process) and the Node adapter's `listRevisions`. They protect: the route
 * answers each key's in-memory revision beside its name, a present file with no
 * revision entry is listed at 0 and a guarded removal at that 0 is a real
 * condition, a case-variant file name has no revision, `count=1` still answers
 * the count only, `min-size` with `revisions=1` is refused, and an answer
 * without revisions (an older server) is "no answer", never a guessed revision.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { StoreVersionConflictError } from 'src/ts/storage/store/errors'
import { NodeHttpError, createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

async function route(query: string): Promise<Response> {
    return await fetch(`${fixture.baseUrl}/api/list-prefix${query}`, { headers: { 'risu-auth': await fixture.authHeader() } })
}

async function plantFile(name: string): Promise<void> {
    await mkdir(fixture.saveDir, { recursive: true })
    await writeFile(join(fixture.saveDir, name), 'x')
}

function realStore(): ByteStore {
    return createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
}

const bytes = (value: number) => Uint8Array.from([value])

interface RevisionAnswer {
    success: boolean
    content: string[]
    revisions: (number | null)[]
}

describe('/api/list-prefix?revisions=1 on the real server', () => {
    beforeEach(async () => {
        await fixture.clearKeys()
    })

    test('answers each name with its own revision, in the order of the names', async () => {
        const store = realStore()
        await store.write('a/once', bytes(1), 'unconditional')
        await store.write('a/twice', bytes(1), 'unconditional')
        await store.write('a/twice', bytes(2), 'unconditional')
        await store.write('a/thrice', bytes(1), 'unconditional')
        await store.write('a/thrice', bytes(2), 'unconditional')
        await store.write('a/thrice', bytes(3), 'unconditional')
        await store.write('b/other', bytes(1), 'unconditional')
        const response = await route(`?prefix=${hexOfKey('a/')}&revisions=1`)
        expect(response.status).toBe(200)
        const body = await response.json() as RevisionAnswer
        expect(body.success).toBe(true)
        expect(body.revisions).toHaveLength(body.content.length)
        const byName = new Map(body.content.map((name, i) => [name, body.revisions[i]]))
        expect(Object.fromEntries(byName)).toEqual({ 'a/once': 1, 'a/twice': 2, 'a/thrice': 3 })
        // The answer is the map's revision: it equals what a read of the key reports.
        for (const [name, revision] of byName) {
            expect((await store.read(name)).version).toBe(revision)
        }
    })

    test('a present file with no revision entry is answered at 0', async () => {
        await plantFile(hexOfKey('p/planted'))
        const body = await (await route(`?prefix=${hexOfKey('p/')}&revisions=1`)).json() as RevisionAnswer
        expect(body.content).toEqual(['p/planted'])
        expect(body.revisions).toEqual([0])
    })

    test('a file whose name differs from the lowercase key in letter case has no revision', async () => {
        const upper = hexOfKey('c/variant').toUpperCase()
        expect(upper).not.toBe(hexOfKey('c/variant'))
        await plantFile(upper)
        await realStore().write('c/plain', bytes(1), 'unconditional')
        const body = await (await route(`?prefix=${hexOfKey('c/')}&revisions=1`)).json() as RevisionAnswer
        const byName = Object.fromEntries(body.content.map((name, i) => [name, body.revisions[i]]))
        expect(byName).toEqual({ 'c/variant': null, 'c/plain': 1 })
    })

    test('without revisions=1 the answer has no revisions member', async () => {
        await realStore().write('a/1', bytes(1), 'unconditional')
        const body = await (await route(`?prefix=${hexOfKey('a/')}`)).json() as Record<string, unknown>
        expect(body).toEqual({ success: true, content: ['a/1'] })
        const other = await (await route(`?prefix=${hexOfKey('a/')}&revisions=0`)).json() as Record<string, unknown>
        expect(other).toEqual({ success: true, content: ['a/1'] })
    })

    test('count=1 with revisions=1 answers the count only', async () => {
        const store = realStore()
        await store.write('a/1', bytes(1), 'unconditional')
        await store.write('a/2', bytes(1), 'unconditional')
        const body = await (await route(`?prefix=${hexOfKey('a/')}&revisions=1&count=1`)).json() as Record<string, unknown>
        expect(body).toEqual({ success: true, count: 2 })
    })

    test('min-size with revisions=1 is refused with 400, with or without count=1', async () => {
        await realStore().write('a/1', bytes(1), 'unconditional')
        for (const extra of ['', '&count=1']) {
            const response = await route(`?prefix=${hexOfKey('a/')}&revisions=1&min-size=0${extra}`)
            expect(response.status).toBe(400)
            expect((await response.json() as { success: boolean }).success).toBe(false)
        }
    })

    test('the adapter lists keys with revisions through the route', async () => {
        const store = realStore()
        await store.write('m/1', bytes(1), 'unconditional')
        await store.write('m/1', bytes(2), 'unconditional')
        await plantFile(hexOfKey('m/planted'))
        await plantFile(hexOfKey('m/variant').toUpperCase())
        const listed = await store.listRevisions!('m/')
        expect(listed).not.toBeNull()
        expect([...listed!].sort((x, y) => x.key.localeCompare(y.key))).toEqual([
            { key: 'm/1', rev: 2 },
            { key: 'm/planted', rev: 0 },
            { key: 'm/variant', rev: null },
        ])
        expect(await store.listRevisions!('absent/')).toEqual([])
    })
})

describe('a file with no revision entry and the guarded removal at 0', () => {
    beforeEach(async () => {
        await fixture.clearKeys()
    })

    async function commitOf(store: ByteStore, label: string): Promise<{ key: string, version: number }> {
        const key = `store2-commit-${label}`
        const written = await store.write(key, bytes(1), 'unconditional')
        return { key, version: written.version as number }
    }

    test('is listed at 0 and removed by a removal conditioned on version 0', async () => {
        const store = realStore()
        await plantFile(hexOfKey('assets/orphan'))
        const listed = await store.listRevisions!('assets/')
        expect(listed).toEqual([{ key: 'assets/orphan', rev: 0 }])
        const commit = await commitOf(store, 't11')
        await store.guarded!.removeChecked([{ key: 'assets/orphan', condition: { ifVersion: listed![0].rev! } }], [{ key: commit.key, version: commit.version }])
        expect(await store.has('assets/orphan')).toBe(false)
    })

    test('a write after the listing moves the revision to 1, so the removal at 0 conflicts and the file stays', async () => {
        const store = realStore()
        await plantFile(hexOfKey('assets/late'))
        const listed = await store.listRevisions!('assets/')
        expect(listed).toEqual([{ key: 'assets/late', rev: 0 }])
        await store.write('assets/late', bytes(7), 'unconditional')
        expect((await store.read('assets/late')).version).toBe(1)
        const commit = await commitOf(store, 't11b')
        await expect(store.guarded!.removeChecked([{ key: 'assets/late', condition: { ifVersion: 0 } }], [{ key: commit.key, version: commit.version }]))
            .rejects.toBeInstanceOf(StoreVersionConflictError)
        expect(await store.has('assets/late')).toBe(true)
    })
})

interface Scripted {
    store: ByteStore
    calls: string[]
}

/** A store whose server answers `/api/list-prefix` with `answer` and `/api/list` with `fullNames`. */
function scripted(answer: () => Response, fullNames: string[] = []): Scripted {
    const calls: string[] = []
    const stub: FetchLike = async (url) => {
        calls.push(url)
        if (url.startsWith('/api/list-prefix')) {
            return answer()
        }
        if (url.startsWith('/api/list')) {
            return new Response(JSON.stringify({ success: true, content: fullNames }))
        }
        throw new Error(`unexpected request ${url}`)
    }
    return { store: createNodeHttpStore({ authHeader: async () => 'token', fetch: stub }), calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('listRevisions with a stubbed server', () => {
    test('asks the route with the hex of the prefix and revisions=1, and maps names to revisions', async () => {
        const { store, calls } = scripted(() => json({ success: true, content: ['a/1', 'a/2', 'a/3'], revisions: [4, 0, null] }))
        expect(await store.listRevisions!('a/')).toEqual([{ key: 'a/1', rev: 4 }, { key: 'a/2', rev: 0 }, { key: 'a/3', rev: null }])
        expect(calls).toEqual([`/api/list-prefix?prefix=${hexOfKey('a/')}&revisions=1`])
    })

    test('an empty prefix is refused before any request, as for listSized', async () => {
        const { store, calls } = scripted(() => json({ success: true, content: [], revisions: [] }))
        await expect(store.listRevisions!('')).rejects.toThrow()
        expect(calls).toEqual([])
    })

    test('keeps only names under the prefix, and a name that arrives twice has no revision', async () => {
        const { store } = scripted(() => json({ success: true, content: ['a/1', 'b/2', 'a/dup', 'a/dup'], revisions: [1, 2, 3, 5] }))
        expect(await store.listRevisions!('a/')).toEqual([{ key: 'a/1', rev: 1 }, { key: 'a/dup', rev: null }])
    })

    test.each([
        ['an answer without revisions (an older server)', () => json({ success: true, content: ['a/1'] })],
        ['a revisions list of another length', () => json({ success: true, content: ['a/1', 'a/2'], revisions: [1] })],
        ['a revisions member that is not a list', () => json({ success: true, content: ['a/1'], revisions: 1 })],
        ['a string revision', () => json({ success: true, content: ['a/1'], revisions: ['1'] })],
        ['a negative revision', () => json({ success: true, content: ['a/1'], revisions: [-1] })],
        ['a fractional revision', () => json({ success: true, content: ['a/1'], revisions: [1.5] })],
        ['an unsafe revision', () => json({ success: true, content: ['a/1'], revisions: [2 ** 60] })],
        ['a non-string name', () => json({ success: true, content: [7], revisions: [1] })],
        ['success false', () => json({ success: false, content: ['a/1'], revisions: [1] })],
        ['a missing route (404)', () => new Response('Cannot GET', { status: 404 })],
        ['an HTML body', () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
        ['a non-JSON body', () => new Response('nope')],
        ['an array body', () => json(['a/1'])],
    ])('answers null on %s and never asks /api/list', async (_label, answer) => {
        const { store, calls } = scripted(answer, ['a/1'])
        expect(await store.listRevisions!('a/')).toBeNull()
        expect(calls.filter((call) => call === '/api/list')).toEqual([])
    })

    test.each([400, 401, 403, 429, 500, 503])('a %i rejects with NodeHttpError and is not null', async (status) => {
        const { store } = scripted(() => new Response('refused', { status }))
        await expect(store.listRevisions!('a/')).rejects.toBeInstanceOf(NodeHttpError)
    })

    test('a network error rejects', async () => {
        const store = createNodeHttpStore({
            authHeader: async () => 'token',
            fetch: async () => {
                throw new TypeError('network down')
            },
        })
        await expect(store.listRevisions!('a/')).rejects.toThrow('network down')
    })

    test('answers null without a request once a list has shown the route missing', async () => {
        const { store, calls } = scripted(() => new Response('Cannot GET', { status: 404 }), ['a/1'])
        await store.list('a/')
        calls.length = 0
        expect(await store.listRevisions!('a/')).toBeNull()
        expect(calls).toEqual([])
    })

    test('a prefix no key can have is refused before any request', async () => {
        const { store, calls } = scripted(() => json({ success: true, content: [], revisions: [] }))
        await expect(store.listRevisions!('a\uD800')).rejects.toThrow()
        expect(calls).toEqual([])
    })
})

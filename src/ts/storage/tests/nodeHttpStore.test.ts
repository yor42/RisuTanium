// @vitest-environment node
/**
 * The Node adapter (`src/ts/storage/store/nodeHttpStore.ts`) against the real
 * `server/node/server.cjs`, run as a child process: the shared conformance
 * scenarios, then what only this adapter does, then the server's answers to
 * `/api/read` and `/api/list` that the adapter relies on. A few request-level
 * cases use a stub fetch where the real server cannot be made to fail on
 * demand. These are conformance and compatibility guards for code with no
 * callers.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { StoreDeleteManyError, StoreError, StoreInvalidKeyError, StoreVersionConflictError } from 'src/ts/storage/store/errors'
import { createNodeHttpStore, NodeHttpError, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { describeByteStoreConformance } from './byteStoreConformance'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture
const requests: Array<{ path: string, method: string, headers: Record<string, string>, cache: RequestCache | undefined }> = []

const recordingFetch: FetchLike = (url, init) => {
    requests.push({
        path: url.slice(fixture.baseUrl.length),
        method: init?.method ?? 'GET',
        headers: { ...(init?.headers as Record<string, string>) },
        cache: init?.cache,
    })
    return fetch(url, init)
}

function makeStore(extra: { requestKeyBytes?: number } = {}) {
    return createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader(), fetch: recordingFetch, ...extra })
}

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

async function rawRead(key: string, headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${fixture.baseUrl}/api/read`, {
        headers: { 'file-path': hexOfKey(key), 'risu-auth': await fixture.authHeader(), ...headers },
    })
}

async function rawHttpRead(key: string, headers: Record<string, string>): Promise<{ status: number, headers: IncomingHttpHeaders }> {
    const auth = await fixture.authHeader()
    return await new Promise((resolve, reject) => {
        const request = httpRequest(`${fixture.baseUrl}/api/read`, { headers: { 'file-path': hexOfKey(key), 'risu-auth': auth, ...headers } }, (response) => {
            response.resume()
            response.once('end', () => resolve({ status: response.statusCode, headers: response.headers }))
        })
        request.once('error', reject)
        request.end()
    })
}

async function rawList(): Promise<string[]> {
    const response = await fetch(`${fixture.baseUrl}/api/list`, { headers: { 'risu-auth': await fixture.authHeader() } })
    return (await response.json()).content
}

beforeAll(async () => {
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

describeByteStoreConformance({
    name: 'Node HTTP',
    conditionalWrites: true,
    async create() {
        await fixture.clearKeys()
        return makeStore()
    },
    async plant(key, value) {
        await writeFile(join(fixture.saveDir, hexOfKey(key)), value)
    },
    async peek(key) {
        try {
            return new Uint8Array(await readFile(join(fixture.saveDir, hexOfKey(key))))
        } catch {
            return null
        }
    },
    backendCalls: () => requests.length,
    invalidEverywhere: ['', 'a\uD800b'],
    invalidPrefixes: ['', 'a\uD800'],
    writeOnlyInvalid: [`k/${'x'.repeat(116)}`],
    oddKeys: ['assets/x.v2\\smile', 'assets/x.jpg\u0001'],
})

describe('Node HTTP store against the real server', () => {
    beforeEach(async () => {
        await fixture.clearKeys()
        requests.length = 0
    })

    test('test_auth reports success for the fixture\'s key pair, and a freshly made store\'s first call is served', async () => {
        const status = await (await fetch(`${fixture.baseUrl}/api/test_auth`, { headers: { 'risu-auth': await fixture.authHeader() } })).json()
        expect(status).toEqual({ status: 'success' })
        expect(await makeStore().list('anything/')).toEqual([])
    })

    test('a request with an auth header the server does not accept rejects with the server\'s status', async () => {
        const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: async () => 'not.a.token' })
        const error = await store.read('k/1').catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(NodeHttpError)
        expect((error as NodeHttpError).status).toBeGreaterThanOrEqual(400)
    })

    test('every request to the server opts out of the browser HTTP cache', async () => {
        const store = makeStore()
        await store.write('cache/a', bytes(1), 'unconditional')
        await store.write('cache/b', bytes(2), 'unconditional')
        await store.read('cache/a')
        await store.has('cache/a')
        await store.list('cache/')
        await store.delete('cache/a', 'unconditional')
        await store.deleteMany([{ key: 'cache/b', condition: 'unconditional' }])

        expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
            'POST /api/write', 'POST /api/write', 'GET /api/read', 'HEAD /api/read', 'GET /api/list', 'GET /api/remove', 'GET /api/remove',
        ])
        expect(requests.map((request) => request.cache)).toEqual(Array(7).fill('no-store'))
    })

    describe('listing', () => {
        test('drops write temps, orphan temps and server files, and returns each key once', async () => {
            const store = makeStore()
            await store.write('database/database.bin', bytes(1), 'unconditional')
            await store.write('assets/x.png', bytes(2), 'unconditional')
            // The leftover of an interrupted write of an existing key, an orphan
            // whose key never got a file, and a stray name that is not hex at all.
            await writeFile(join(fixture.saveDir, `${hexOfKey('database/database.bin')}.tmp-0123456789abcdef`), 'junk')
            await writeFile(join(fixture.saveDir, `${hexOfKey('database/dbbackup-9.bin')}.tmp-fedcba9876543210`), 'junk')
            await writeFile(join(fixture.saveDir, '__stray.json'), '{}')

            expect(await store.list('database/')).toEqual(['database/database.bin'])
            expect(await store.list('assets/')).toEqual(['assets/x.png'])
            expect(await store.list('database/dbbackup-')).toEqual([])
        })

        test('a key stored under an upper-case hex name is listed once under its decoded name', async () => {
            const store = makeStore()
            await writeFile(join(fixture.saveDir, hexOfKey('upper/key').toUpperCase()), bytes(1))

            expect(await store.list('upper/')).toEqual(['upper/key'])
        })

        test('the names are deduplicated and filtered by prefix on the client too', async () => {
            const stub: FetchLike = async () => new Response(JSON.stringify({
                success: true,
                content: ['a/1', 'a/1', '', 'b/2', 'a/2'],
            }))
            const store = createNodeHttpStore({ authHeader: async () => 'token', fetch: stub })

            expect((await store.list('a/')).sort()).toEqual(['a/1', 'a/2'])
        })
    })

    describe('writing', () => {
        test('a key over 117 UTF-8 bytes is refused before any request, and its revision is untouched', async () => {
            const store = makeStore()
            const longKey = `q/${'y'.repeat(116)}`
            expect(new TextEncoder().encode(longKey).length).toBe(118)
            requests.length = 0

            await expect(store.write(longKey, bytes(1), 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)

            expect(requests).toEqual([])
            expect((await store.read(longKey)).version).toBe(0)
        })

        test('a key of exactly 117 UTF-8 bytes is stored and read back', async () => {
            const store = makeStore()
            const longestKey = `k/${'x'.repeat(115)}`
            expect(new TextEncoder().encode(longestKey).length).toBe(117)

            await store.write(longestKey, bytes(4, 2), 'unconditional')

            expect(Array.from((await store.read(longestKey)).bytes)).toEqual([4, 2])
        })

        test('a zero-length body written through fetch reads back as a zero-length array, and an absent key as null', async () => {
            const store = makeStore()
            const response = await fetch(`${fixture.baseUrl}/api/write`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/octet-stream',
                    'file-path': hexOfKey('empty/raw'),
                    'risu-auth': await fixture.authHeader(),
                },
                body: new Uint8Array(0),
            })
            expect(response.status).toBe(200)

            const stored = await store.read('empty/raw')
            expect(stored.bytes).not.toBeNull()
            expect(stored.bytes.byteLength).toBe(0)
            expect((await store.read('empty/absent')).bytes).toBeNull()
        })
    })

    describe('has', () => {
        test('asks the server with HEAD, which never downloads the value', async () => {
            const store = makeStore()
            await store.write('has/k', bytes(1), 'unconditional')
            requests.length = 0

            expect(await store.has('has/k')).toBe(true)
            expect(await store.has('has/absent')).toBe(false)
            expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual(['HEAD /api/read', 'HEAD /api/read'])
        })
    })

    describe('ifVersion 0 on deletes', () => {
        // The server's revision of a key it has never bumped is 0, and a file
        // carried over from a server that kept no revisions is at 0 while it exists.
        let counter = 0
        const freshKey = () => `v0/${Date.now().toString(36)}-${counter++}`

        test('a planted file at version 0 is deleted by a delete with ifVersion 0', async () => {
            const store = makeStore()
            const key = freshKey()
            await writeFile(join(fixture.saveDir, hexOfKey(key)), bytes(1))
            expect((await store.read(key)).version).toBe(0)

            await store.delete(key, { ifVersion: 0 })

            expect(await store.has(key)).toBe(false)
        })

        test('a planted file at version 0 is deleted by a deleteMany entry with ifVersion 0', async () => {
            const store = makeStore()
            const key = freshKey()
            await writeFile(join(fixture.saveDir, hexOfKey(key)), bytes(1))

            await store.deleteMany([{ key, condition: { ifVersion: 0 } }])

            expect(await store.has(key)).toBe(false)
        })

        test('a written key is not at version 0: a delete with ifVersion 0 conflicts and keeps the value', async () => {
            const store = makeStore()
            const key = freshKey()
            await store.write(key, bytes(5), 'unconditional')

            await expect(store.delete(key, { ifVersion: 0 })).rejects.toBeInstanceOf(StoreVersionConflictError)

            expect(Array.from((await store.read(key)).bytes)).toEqual([5])
        })

        test('a written key is not at version 0: a deleteMany entry with ifVersion 0 conflicts and keeps the value', async () => {
            const store = makeStore()
            const key = freshKey()
            await store.write(key, bytes(5), 'unconditional')

            const error = await store.deleteMany([{ key, condition: { ifVersion: 0 } }]).catch((caught: unknown) => caught)

            expect(error).toBeInstanceOf(StoreDeleteManyError)
            expect((error as StoreDeleteManyError).report.map((entry) => entry.outcome)).toEqual(['conflict'])
            expect(Array.from((await store.read(key)).bytes)).toEqual([5])
        })
    })

    describe('deleteMany across requests', () => {
        test('requests run in order; after a conflict the later keys are unchanged and are not requested', async () => {
            const store = makeStore()
            const small = makeStore({ requestKeyBytes: 15 })
            const first = await store.write('c/1', bytes(1), 'unconditional')
            const second = await store.write('c/2', bytes(2), 'unconditional')
            const third = await store.write('c/3', bytes(3), 'unconditional')
            requests.length = 0

            const error = await small.deleteMany([
                { key: 'c/1', condition: { ifVersion: first.version } },
                { key: 'c/2', condition: { ifVersion: second.version + 9 } },
                { key: 'c/3', condition: { ifVersion: third.version } },
            ]).catch((caught: unknown) => caught)

            expect(error).toBeInstanceOf(StoreDeleteManyError)
            expect((error as StoreDeleteManyError).report.map((entry) => [entry.key, entry.outcome])).toEqual([
                ['c/1', 'removed'],
                ['c/2', 'conflict'],
                ['c/3', 'unchanged'],
            ])
            expect((error as StoreDeleteManyError).report[1].currentVersion).toBe(second.version)
            expect(requests.filter((request) => request.path === '/api/remove')).toHaveLength(2)
            expect(await store.has('c/1')).toBe(false)
            expect(await store.has('c/2')).toBe(true)
            expect(await store.has('c/3')).toBe(true)
        })

        test('keys beyond the request budget are split over several requests, each within the budget', async () => {
            const store = makeStore({ requestKeyBytes: 60 })
            const keys = Array.from({ length: 12 }, (_, index) => `many/key-${index}`)
            for (const key of keys) {
                await store.write(key, bytes(1), 'unconditional')
            }
            requests.length = 0

            await store.deleteMany(keys.map((key) => ({ key, condition: 'unconditional' as const })))

            const removals = requests.filter((request) => request.path === '/api/remove')
            expect(removals.length).toBeGreaterThan(1)
            for (const removal of removals) {
                expect(removal.headers['file-path'].length + removal.headers['if-match-revision'].length).toBeLessThanOrEqual(60)
            }
            expect(await store.list('many/')).toEqual([])
        })
    })

    describe('requests the real server cannot be made to fail', () => {
        function stubStore(respond: () => Promise<Response>, requestKeyBytes?: number) {
            const seen: string[] = []
            const store = createNodeHttpStore({
                authHeader: async () => 'token',
                fetch: async (url) => {
                    seen.push(url)
                    return await respond()
                },
                requestKeyBytes,
            })
            return { store, seen }
        }

        const ENTRIES = ['d/1', 'd/2', 'd/3'].map((key) => ({ key, condition: 'unconditional' as const }))

        test('a server error leaves the keys of its request unknown and the later requests unattempted', async () => {
            const { store, seen } = stubStore(async () => new Response('boom', { status: 500 }), 12)
            const error = await store.deleteMany(ENTRIES).catch((caught: unknown) => caught)

            expect((error as StoreDeleteManyError).report.map((entry) => entry.outcome)).toEqual(['unknown', 'unchanged', 'unchanged'])
            expect(seen).toHaveLength(1)
        })

        test('a request the server rejected as a whole leaves its keys unchanged', async () => {
            const { store } = stubStore(async () => new Response('{}', { status: 431 }))
            const error = await store.deleteMany(ENTRIES).catch((caught: unknown) => caught)

            expect((error as StoreDeleteManyError).report.map((entry) => entry.outcome)).toEqual(['unchanged', 'unchanged', 'unchanged'])
        })

        test('a connection that fails mid-request leaves its keys unknown', async () => {
            const { store } = stubStore(async () => {
                throw new TypeError('fetch failed')
            })
            const error = await store.deleteMany(ENTRIES).catch((caught: unknown) => caught)

            expect((error as StoreDeleteManyError).report.map((entry) => entry.outcome)).toEqual(['unknown', 'unknown', 'unknown'])
        })

        test('an auth header that cannot be produced sends nothing and leaves the keys unchanged', async () => {
            const seen: string[] = []
            const store = createNodeHttpStore({
                authHeader: async () => {
                    throw new Error('no key pair')
                },
                fetch: async (url) => {
                    seen.push(url)
                    return new Response('{}')
                },
            })
            const error = await store.deleteMany(ENTRIES).catch((caught: unknown) => caught)

            expect(seen).toEqual([])
            expect((error as StoreDeleteManyError).report.map((entry) => entry.outcome)).toEqual(['unchanged', 'unchanged', 'unchanged'])
            await expect(store.read('d/1')).rejects.toThrow('no key pair')
            expect(seen).toEqual([])
        })

        test('a conflict names the key the server reported, whatever the case of its hex', async () => {
            const hex = hexOfKey('d/2').toUpperCase()
            const { store } = stubStore(async () => new Response(JSON.stringify({ filePath: hex, currentRevision: 8 }), { status: 409 }))
            const error = await store.deleteMany(ENTRIES).catch((caught: unknown) => caught)

            expect((error as StoreDeleteManyError).report).toEqual([
                { key: 'd/1', outcome: 'unchanged' },
                { key: 'd/2', outcome: 'conflict', currentVersion: 8 },
                { key: 'd/3', outcome: 'unchanged' },
            ])
        })

        test('a single delete that conflicts throws the typed conflict with the reported version', async () => {
            const { store } = stubStore(async () => new Response(JSON.stringify({ filePath: hexOfKey('d/1'), currentRevision: 4 }), { status: 409 }))
            const error = await store.delete('d/1', { ifVersion: 1 }).catch((caught: unknown) => caught)

            expect(error).toBeInstanceOf(StoreVersionConflictError)
            expect((error as StoreVersionConflictError).currentVersion).toBe(4)
        })

        test('a single delete whose request the server answers with an error status rejects with that status', async () => {
            for (const status of [500, 431]) {
                const { store } = stubStore(async () => new Response('{}', { status }))
                const error = await store.delete('d/1', 'unconditional').catch((caught: unknown) => caught)

                expect(error, `status ${status}`).toBeInstanceOf(NodeHttpError)
                expect((error as NodeHttpError).status).toBe(status)
            }
        })

        test('a single delete whose connection fails rejects with the connection\'s error', async () => {
            const failure = new TypeError('fetch failed')
            const { store } = stubStore(async () => {
                throw failure
            })

            await expect(store.delete('d/1', 'unconditional')).rejects.toBe(failure)
        })

        test('a single delete whose auth header cannot be produced rejects and sends nothing', async () => {
            const seen: string[] = []
            const store = createNodeHttpStore({
                authHeader: async () => {
                    throw new Error('no key pair')
                },
                fetch: async (url) => {
                    seen.push(url)
                    return new Response('{}')
                },
            })

            await expect(store.delete('d/1', 'unconditional')).rejects.toThrow('no key pair')
            expect(seen).toEqual([])
        })

        test.each([
            ['no revision', {}],
            ['a revision that is not a number', { revision: '3' }],
            ['a negative revision', { revision: -1 }],
            ['a revision that is not an integer', { revision: 1.5 }],
        ])('a write the server accepted with %s in its answer rejects instead of returning a version', async (_label, answer) => {
            const { store } = stubStore(async () => new Response(JSON.stringify({ success: true, ...answer })))

            await expect(store.write('d/1', bytes(1), 'unconditional')).rejects.toBeInstanceOf(StoreError)
        })

        test.each([
            ['no revision header', { 'x-risu-exists': '1' }],
            ['an unparsable revision', { 'x-risu-revision': 'abc', 'x-risu-exists': '1' }],
            ['a negative revision', { 'x-risu-revision': '-1', 'x-risu-exists': '1' }],
            ['no existence header', { 'x-risu-revision': '3' }],
            ['an unknown existence value', { 'x-risu-revision': '3', 'x-risu-exists': 'yes' }],
        ])('a read answered with %s rejects instead of returning a version', async (_label, headers) => {
            const { store } = stubStore(async () => new Response(new Uint8Array([1]), { headers }))

            await expect(store.read('d/1')).rejects.toBeInstanceOf(StoreError)
            await expect(store.has('d/1')).rejects.toBeInstanceOf(StoreError)
        })
    })

    describe('the server answers the adapter relies on', () => {
        test('/api/read says whether the key holds a value, also for an empty one and also on a 304', async () => {
            const store = makeStore()
            await store.write('raw/full', bytes(1, 2, 3), 'unconditional')
            await store.write('raw/empty', new Uint8Array(0), 'unconditional')

            const full = await rawRead('raw/full')
            expect(full.headers.get('x-risu-exists')).toBe('1')
            expect(full.headers.get('x-risu-revision')).toMatch(/^\d+$/)

            const empty = await rawRead('raw/empty')
            expect(empty.headers.get('x-risu-exists')).toBe('1')
            expect((await empty.arrayBuffer()).byteLength).toBe(0)

            const absent = await rawRead('raw/absent')
            expect(absent.headers.get('x-risu-exists')).toBe('0')
            expect(absent.headers.get('x-risu-revision')).toBe('0')

            // fetch adds `cache-control: no-cache` to a conditional request, which
            // stops the server from answering 304, so the revalidation goes through
            // node:http.
            const etag = full.headers.get('etag')
            expect(etag).not.toBeNull()
            const revalidated = await rawHttpRead('raw/full', { 'if-none-match': etag })
            expect(revalidated.status).toBe(304)
            expect(revalidated.headers['x-risu-exists']).toBe('1')
            expect(revalidated.headers['x-risu-revision']).toBe(full.headers.get('x-risu-revision'))
        })

        test('/api/list answers only the decoded names of whole hex files', async () => {
            const store = makeStore()
            await store.write('list/real', bytes(1), 'unconditional')
            await writeFile(join(fixture.saveDir, `${hexOfKey('list/real')}.tmp-0123456789abcdef`), 'junk')
            await writeFile(join(fixture.saveDir, `${hexOfKey('list/orphan')}.tmp-fedcba9876543210`), 'junk')
            await writeFile(join(fixture.saveDir, '__stray'), 'junk')
            await writeFile(join(fixture.saveDir, 'abc'), 'odd-length hex')
            await writeFile(join(fixture.saveDir, hexOfKey('list/upper').toUpperCase()), 'upper-case hex')

            const names = await rawList()

            expect(names.sort()).toEqual(['list/real', 'list/upper'])
        })
    })
})

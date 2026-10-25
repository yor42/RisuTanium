// @vitest-environment node
/**
 * `/api/list-prefix` of the real `server/node/server.cjs` (run as a child
 * process) and the Node adapter's use of it: `list` re-filters every answer and
 * falls back to `/api/list` on a server without the route, and `countPrefix`
 * answers a number or `null` and never lists. They protect: the route's key
 * filter and prefix match equal `/api/list`'s, a lying or unrecognised answer
 * never changes the key set `list` returns, a missing route is remembered but a
 * refused token (the server answers 400) or a 5xx never is, and a count is
 * only ever a trusted non-negative integer or `null`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { NodeHttpError, createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

async function route(query: string, authorised = true): Promise<Response> {
    const headers: Record<string, string> = authorised ? { 'risu-auth': await fixture.authHeader() } : {}
    return await fetch(`${fixture.baseUrl}/api/list-prefix${query}`, { headers })
}

async function names(query: string): Promise<string[]> {
    const body = await (await route(query)).json() as { success: boolean, content: string[] }
    expect(body.success).toBe(true)
    return body.content
}

async function countOf(query: string): Promise<number> {
    const body = await (await route(`${query}&count=1`)).json() as { success: boolean, count: number }
    expect(body.success).toBe(true)
    return body.count
}

async function plantFile(name: string): Promise<void> {
    await mkdir(fixture.saveDir, { recursive: true })
    await writeFile(join(fixture.saveDir, name), 'x')
}

describe('/api/list-prefix on the real server', () => {
    beforeEach(async () => {
        await fixture.clearKeys()
    })

    test('answers the decoded names that start with the hex prefix, in the shape of /api/list', async () => {
        await plantFile(hexOfKey('a/1'))
        await plantFile(hexOfKey('a/2'))
        await plantFile(hexOfKey('b/1'))
        const response = await route(`?prefix=${hexOfKey('a/')}`)
        expect(response.status).toBe(200)
        const body = await response.json() as { success: boolean, content: string[] }
        expect(body.success).toBe(true)
        expect(body.content.sort()).toEqual(['a/1', 'a/2'])
    })

    test('matches the prefix case-insensitively in either direction', async () => {
        await plantFile(hexOfKey('up/key').toUpperCase())
        await plantFile(hexOfKey('low/key'))
        expect(await names(`?prefix=${hexOfKey('up/')}`)).toEqual(['up/key'])
        expect(await names(`?prefix=${hexOfKey('low/').toUpperCase()}`)).toEqual(['low/key'])
        expect(await countOf(`?prefix=${hexOfKey('up/')}`)).toBe(1)
        expect(await countOf(`?prefix=${hexOfKey('low/').toUpperCase()}`)).toBe(1)
    })

    test('never lists or counts a write temp, a `__` file, an odd-length name or a non-hex name', async () => {
        await plantFile(hexOfKey('k/real'))
        await plantFile(`${hexOfKey('k/real')}.tmp-0123456789abcdef`)
        await plantFile(`${hexOfKey('k/orphan')}.tmp-fedcba9876543210`)
        await plantFile('__revisions.json')
        await plantFile('__stray')
        await plantFile('abc')
        await plantFile(`${hexOfKey('k/odd')}0`)
        await plantFile('zz')
        for (const prefix of ['', hexOfKey('k/'), hexOfKey('k/real'), '5f5f']) {
            const listed = await names(`?prefix=${prefix}`)
            expect(listed.filter((name) => name !== 'k/real')).toEqual([])
            expect(await countOf(`?prefix=${prefix}`)).toBe(listed.length)
        }
        expect(await names(`?prefix=${hexOfKey('k/')}`)).toEqual(['k/real'])
    })

    test('an empty prefix lists what /api/list lists', async () => {
        await plantFile(hexOfKey('e/1'))
        await plantFile(hexOfKey('f/2').toUpperCase())
        await plantFile(`${hexOfKey('e/1')}.tmp-0123456789abcdef`)
        await plantFile('__stray')
        const all = await (await fetch(`${fixture.baseUrl}/api/list`, { headers: { 'risu-auth': await fixture.authHeader() } })).json() as { content: string[] }
        expect((await names('?prefix=')).sort()).toEqual(all.content.sort())
        expect(await countOf('?prefix=')).toBe(all.content.length)
    })

    test('count=1 equals the length of the matching list and carries no names', async () => {
        for (let i = 0; i < 5; i++) {
            await plantFile(hexOfKey(`c/${i}`))
        }
        await plantFile(hexOfKey('d/0'))
        const body = await (await route(`?prefix=${hexOfKey('c/')}&count=1`)).json() as Record<string, unknown>
        expect(body).toEqual({ success: true, count: 5 })
        expect(await countOf(`?prefix=${hexOfKey('zz/')}`)).toBe(0)
    })

    test.each(['?prefix=abc', '?prefix=zz', '?prefix=a/', '', '?prefix=aa&prefix=bb', '?prefix=%00'])('refuses the prefix query %j with 400', async (query) => {
        const response = await route(query)
        expect(response.status).toBe(400)
        expect((await response.json() as { success: boolean }).success).toBe(false)
    })

    test('refuses an unauthenticated caller', async () => {
        await plantFile(hexOfKey('a/1'))
        const response = await route('?prefix=', false)
        expect(response.status).toBe(400)
        const body = await response.text()
        expect(body).not.toContain('a/1')
    })

    test('/api/caps carries listPrefix next to the three flags', async () => {
        const response = await fetch(`${fixture.baseUrl}/api/caps`, { headers: { 'risu-auth': await fixture.authHeader() } })
        expect(await response.json()).toEqual({ checkOnly: true, retire: true, pieces: true, listPrefix: true })
    })
})

interface Scripted {
    store: ReturnType<typeof createNodeHttpStore>
    calls: string[]
}

/** A store whose server answers `/api/list-prefix` with `prefixAnswer` and `/api/list` with `fullNames`. */
function scripted(prefixAnswer: () => Response, fullNames: string[] = [], authHeader: () => Promise<string> = async () => 'token'): Scripted {
    const calls: string[] = []
    const stub: FetchLike = async (url) => {
        calls.push(url)
        if (url.startsWith('/api/list-prefix')) {
            return prefixAnswer()
        }
        if (url.startsWith('/api/list')) {
            return new Response(JSON.stringify({ success: true, content: fullNames }))
        }
        throw new Error(`unexpected request ${url}`)
    }
    return { store: createNodeHttpStore({ authHeader, fetch: stub }), calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('list through /api/list-prefix', () => {
    test('uses the route with the hex of the prefix when it answers, and never asks /api/list', async () => {
        const { store, calls } = scripted(() => json({ success: true, content: ['a/1', 'a/2'] }), ['should/not/appear'])
        expect((await store.list('a/')).sort()).toEqual(['a/1', 'a/2'])
        expect(calls).toEqual([`/api/list-prefix?prefix=${hexOfKey('a/')}`])
    })

    test('re-filters an answer that holds names outside the prefix, and deduplicates', async () => {
        const { store } = scripted(() => json({ success: true, content: ['a/1', 'b/2', 'a/1', 'A/3', '', 7, null] }))
        expect(await store.list('a/')).toEqual(['a/1'])
    })

    test('keeps using the route on later lists while it answers, and still re-filters each', async () => {
        const { store, calls } = scripted(() => json({ success: true, content: ['x/1', 'y/1'] }))
        expect(await store.list('x/')).toEqual(['x/1'])
        expect(await store.list('y/')).toEqual(['y/1'])
        expect(calls.every((call) => call.startsWith('/api/list-prefix'))).toBe(true)
        expect(calls).toHaveLength(2)
    })

    test.each([
        ['404', () => new Response('Cannot GET', { status: 404 })],
        ['405', () => new Response('no', { status: 405 })],
        ['an HTML body', () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
        ['success false', () => json({ success: false, content: ['a/1'] })],
        ['a wrong shape', () => json({ success: true, content: 'a/1' })],
        ['a missing content', () => json({ success: true })],
        ['an array body', () => json(['a/1'])],
        ['a non-JSON body', () => new Response('nope', { status: 200 })],
    ])('falls back to /api/list on %s, and does not ask the route again on that instance', async (_label, answer) => {
        const { store, calls } = scripted(answer, ['a/1', 'b/1', 'a/2'])
        expect((await store.list('a/')).sort()).toEqual(['a/1', 'a/2'])
        expect((await store.list('b/')).sort()).toEqual(['b/1'])
        expect(calls.filter((call) => call.startsWith('/api/list-prefix'))).toHaveLength(1)
        expect(calls.filter((call) => call === '/api/list')).toHaveLength(2)
    })

    test.each([401, 403])('an auth failure (%i) rejects with NodeHttpError and does not fall back or mark the route unsupported', async (status) => {
        let refuse = true
        const { store, calls } = scripted(() => refuse ? new Response('denied', { status }) : json({ success: true, content: ['a/1'] }), ['a/1'])
        await expect(store.list('a/')).rejects.toBeInstanceOf(NodeHttpError)
        expect(calls).toEqual([`/api/list-prefix?prefix=${hexOfKey('a/')}`])
        refuse = false
        expect(await store.list('a/')).toEqual(['a/1'])
        expect(calls.filter((call) => call === '/api/list')).toHaveLength(0)
    })

    test('a network error rejects and does not fall back', async () => {
        const calls: string[] = []
        const store = createNodeHttpStore({
            authHeader: async () => 'token',
            fetch: async (url) => {
                calls.push(url)
                throw new TypeError('network down')
            },
        })
        await expect(store.list('a/')).rejects.toThrow('network down')
        expect(calls).toHaveLength(1)
    })

    test('a failing auth header rejects before any request', async () => {
        const { store, calls } = scripted(() => json({ success: true, content: [] }), [], async () => {
            throw new Error('no token')
        })
        await expect(store.list('a/')).rejects.toThrow('no token')
        expect(calls).toEqual([])
    })

    test('a 400 falls back for that call but the route is asked again on the next', async () => {
        let status = 400
        const { store, calls } = scripted(() => status === 400 ? json({ success: false, error: 'refused' }, 400) : json({ success: true, content: ['a/1'] }), ['a/1'])
        expect(await store.list('a/')).toEqual(['a/1'])
        status = 200
        expect(await store.list('a/')).toEqual(['a/1'])
        expect(calls.filter((call) => call.startsWith('/api/list-prefix'))).toHaveLength(2)
        expect(calls.filter((call) => call === '/api/list')).toHaveLength(1)
    })

    test('a 5xx falls back for that call but the route is tried again on the next', async () => {
        let status = 500
        const { store, calls } = scripted(() => status === 500 ? new Response('boom', { status }) : json({ success: true, content: ['a/1'] }), ['a/1'])
        expect(await store.list('a/')).toEqual(['a/1'])
        status = 200
        expect(await store.list('a/')).toEqual(['a/1'])
        expect(calls.filter((call) => call.startsWith('/api/list-prefix'))).toHaveLength(2)
    })
})

describe('countPrefix', () => {
    test('asks the route with count=1 and returns the number', async () => {
        const { store, calls } = scripted(() => json({ success: true, count: 42 }))
        expect(await store.countPrefix?.('store2/')).toBe(42)
        expect(calls).toEqual([`/api/list-prefix?prefix=${hexOfKey('store2/')}&count=1`])
    })

    test('an empty prefix counts everything', async () => {
        const { store, calls } = scripted(() => json({ success: true, count: 0 }))
        expect(await store.countPrefix?.('')).toBe(0)
        expect(calls).toEqual(['/api/list-prefix?prefix=&count=1'])
    })

    test.each([
        ['an old server (404)', () => new Response('Cannot GET', { status: 404 })],
        ['a 405', () => new Response('no', { status: 405 })],
        ['an HTML body', () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
        ['success false', () => json({ success: false, count: 3 })],
        ['a negative count', () => json({ success: true, count: -1 })],
        ['a fractional count', () => json({ success: true, count: 1.5 })],
        ['a string count', () => json({ success: true, count: '3' })],
        ['a missing count', () => json({ success: true })],
        ['an unsafe integer count', () => json({ success: true, count: 2 ** 60 })],
        ['a list answer instead of a count', () => json({ success: true, content: ['a'] })],
        ['a non-JSON body', () => new Response('nope')],
    ])('answers null on %s and never asks /api/list', async (_label, answer) => {
        const { store, calls } = scripted(answer, ['a/1'])
        expect(await store.countPrefix?.('a/')).toBeNull()
        expect(calls.filter((call) => call === '/api/list')).toEqual([])
    })

    test('answers null without a request once a list has shown the route missing', async () => {
        const { store, calls } = scripted(() => new Response('Cannot GET', { status: 404 }), ['a/1'])
        await store.list('a/')
        calls.length = 0
        expect(await store.countPrefix?.('a/')).toBeNull()
        expect(calls).toEqual([])
    })

    test.each([401, 403])('an auth failure (%i) rejects with NodeHttpError and is not null', async (status) => {
        const { store } = scripted(() => new Response('denied', { status }))
        await expect(store.countPrefix?.('a/')).rejects.toBeInstanceOf(NodeHttpError)
    })

    test('a prefix no key can have is refused before any request', async () => {
        const { store, calls } = scripted(() => json({ success: true, count: 1 }))
        await expect(store.countPrefix?.('a\uD800')).rejects.toThrow()
        expect(calls).toEqual([])
    })
})

describe('the adapter against the real server', () => {
    beforeEach(async () => {
        await fixture.clearKeys()
    })

    function realStore() {
        return createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
    }

    test('list and countPrefix agree, and the route is used', async () => {
        const store = realStore()
        for (let i = 0; i < 3; i++) {
            await store.write(`m/${i}`, Uint8Array.from([i]), 'unconditional')
        }
        await store.write('n/0', Uint8Array.from([9]), 'unconditional')
        expect((await store.list('m/')).sort()).toEqual(['m/0', 'm/1', 'm/2'])
        expect(await store.countPrefix?.('m/')).toBe(3)
        expect(await store.countPrefix?.('absent/')).toBe(0)
        expect(await store.countPrefix?.('')).toBe(4)
    })

    test('an expired token (the server answers 400) rejects, and once the token is valid the route is used and counts again', async () => {
        const store = realStore()
        await store.write('m/1', Uint8Array.from([1]), 'unconditional')
        let expired = true
        const calls: string[] = []
        const issuedAt = Math.floor(Date.now() / 1000)
        const flaky = createNodeHttpStore({
            baseUrl: fixture.baseUrl,
            authHeader: () => expired ? fixture.signToken({ iat: issuedAt - 1000, exp: issuedAt - 500 }) : fixture.authHeader(),
            fetch: async (url, init) => {
                calls.push(url.slice(fixture.baseUrl.length))
                return await fetch(url, init)
            },
        })
        await expect(flaky.list('m/')).rejects.toBeInstanceOf(NodeHttpError)
        expired = false
        calls.length = 0
        expect(await flaky.list('m/')).toEqual(['m/1'])
        expect(await flaky.countPrefix?.('m/')).toBe(1)
        expect(calls).toEqual([`/api/list-prefix?prefix=${hexOfKey('m/')}`, `/api/list-prefix?prefix=${hexOfKey('m/')}&count=1`])
    })

    test('a store against a server that lacks the route (404 for it) still lists correctly through /api/list', async () => {
        const store = realStore()
        await store.write('m/1', Uint8Array.from([1]), 'unconditional')
        const calls: string[] = []
        const oldServer: FetchLike = async (url, init) => {
            calls.push(url.slice(fixture.baseUrl.length))
            if (url.includes('/api/list-prefix')) {
                return new Response('Cannot GET /api/list-prefix', { status: 404 })
            }
            return await fetch(url, init)
        }
        const legacy = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader(), fetch: oldServer })
        expect(await legacy.list('m/')).toEqual(['m/1'])
        expect(await legacy.countPrefix?.('m/')).toBeNull()
        expect(calls.filter((call) => call.startsWith('/api/list-prefix'))).toHaveLength(1)
    })
})

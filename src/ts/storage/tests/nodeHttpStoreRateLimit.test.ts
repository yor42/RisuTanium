/**
 * The Node HTTP store waits out a 429 and retries, in `send` (read, write,
 * has, list) and in `removeChunk` (delete, deleteMany). The server's limiter
 * answers before any handler runs, so a refused request changed nothing and
 * its retry carries the same condition. Each call makes at most 5 tries and
 * spends at most 90 s waiting; past that it fails with the 429 error it fails
 * with without retries.
 *
 * `fetch`, the clock and the wait are fakes: nothing here proves the Node
 * server's limiter, only what the store does with the answers it is given.
 */
import { describe, expect, test } from 'vitest'
import { StoreDeleteManyError, StoreVersionConflictError } from 'src/ts/storage/store/errors'
import { createNodeHttpStore, NodeHttpError, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'

interface RecordedRequest {
    path: string
    method: string
    headers: Record<string, string>
    body: unknown
}

type Answer = () => Response

function rateLimited(headers: Record<string, string> = {}, body: BodyInit | null = null): Answer {
    return () => new Response(body, { status: 429, headers })
}

function readAnswer(value: number[]): Answer {
    return () => new Response(new Uint8Array(value), {
        status: 200,
        headers: { 'x-risu-revision': '3', 'x-risu-exists': '1' },
    })
}

function jsonAnswer(status: number, body: unknown): Answer {
    return () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A store whose fetch answers from `answers` in order and records every request; the wait advances a fake clock. */
function makeStore(answers: Answer[], extra: { requestKeyBytes?: number } = {}) {
    const requests: RecordedRequest[] = []
    const sleeps: number[] = []
    let clock = 0
    let next = 0
    const fetchFake: FetchLike = async (url, init) => {
        requests.push({
            path: url,
            method: init?.method ?? 'GET',
            headers: { ...(init?.headers as Record<string, string>) },
            body: init?.body,
        })
        const answer = answers[Math.min(next, answers.length - 1)]
        next += 1
        return answer()
    }
    const store = createNodeHttpStore({
        authHeader: async () => 'auth',
        fetch: fetchFake,
        requestKeyBytes: extra.requestKeyBytes,
        sleep: async (ms) => {
            sleeps.push(ms)
            clock += ms
        },
        now: () => clock,
    })
    return { store, requests, sleeps }
}

describe('a 429 is waited out and retried', () => {
    test('read waits for Retry-After seconds and then returns the value', async () => {
        const { store, requests, sleeps } = makeStore([rateLimited({ 'retry-after': '2' }), readAnswer([1, 2, 3])])

        const result = await store.read('assets/a.png')

        expect(Array.from(result.bytes ?? [])).toEqual([1, 2, 3])
        expect(result.version).toBe(3)
        expect(sleeps).toEqual([2000])
        expect(requests).toHaveLength(2)
        expect(requests[1].headers).toEqual(requests[0].headers)
    })

    test('has and list retry too', async () => {
        const hasCase = makeStore([rateLimited({ 'retry-after': '1' }), readAnswer([])])
        expect(await hasCase.store.has('assets/a.png')).toBe(true)
        expect(hasCase.sleeps).toEqual([1000])

        const listCase = makeStore([rateLimited({ 'retry-after': '1' }), jsonAnswer(200, { content: ['assets/a.png'] })])
        expect(await listCase.store.list('assets/')).toEqual(['assets/a.png'])
        expect(listCase.sleeps).toEqual([1000])
    })

    test('RateLimit-Reset is used when there is no Retry-After', async () => {
        const { store, sleeps } = makeStore([rateLimited({ 'ratelimit-reset': '3' }), readAnswer([7])])

        await store.read('assets/a.png')

        expect(sleeps).toEqual([3000])
    })

    test('Retry-After given as an HTTP date waits until that date', async () => {
        // The fake clock starts at 0 (the epoch), so a date 5 s after it is a 5 s wait.
        const date = new Date(5000).toUTCString()
        const { store, sleeps } = makeStore([rateLimited({ 'retry-after': date }), readAnswer([7])])

        await store.read('assets/a.png')

        expect(sleeps).toEqual([5000])
    })

    test('a conditional write keeps its condition and body on the retry and succeeds', async () => {
        const { store, requests, sleeps } = makeStore([rateLimited({ 'retry-after': '1' }), jsonAnswer(200, { revision: 8 })])
        const payload = new Uint8Array([4, 5, 6])

        const result = await store.write('assets/a.png', payload, { ifVersion: 7 })

        expect(result).toEqual({ version: 8 })
        expect(sleeps).toEqual([1000])
        expect(requests).toHaveLength(2)
        expect(requests[1].path).toBe('/api/write')
        expect(requests[1].headers['if-match-revision']).toBe('7')
        expect(requests[1].headers['file-path']).toBe(requests[0].headers['file-path'])
        expect(requests[1].body).toBe(payload)
    })

    test('a conflict that follows a 429 is still reported as a conflict, with the same condition', async () => {
        const { store, requests } = makeStore([rateLimited({ 'retry-after': '1' }), jsonAnswer(409, { currentRevision: 9 })])

        const failure = await store.write('assets/a.png', new Uint8Array([1]), { ifVersion: 7 }).catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(StoreVersionConflictError)
        expect((failure as StoreVersionConflictError).currentVersion).toBe(9)
        expect(requests.map((request) => request.headers['if-match-revision'])).toEqual(['7', '7'])
    })

    test('delete retries a 429 with the same revision condition', async () => {
        const { store, requests, sleeps } = makeStore([rateLimited({ 'retry-after': '1' }), jsonAnswer(200, {})])

        await store.delete('assets/a.png', { ifVersion: 4 })

        expect(sleeps).toEqual([1000])
        expect(requests).toHaveLength(2)
        expect(requests[1].path).toBe('/api/remove')
        expect(requests[1].headers['if-match-revision']).toBe('4')
        expect(requests[1].headers['file-path']).toBe(requests[0].headers['file-path'])
    })

    test('deleteMany retries a 429 on each request of its chunks and reports the keys removed', async () => {
        // A request budget of 40 bytes puts the two keys in separate requests.
        const { store, requests, sleeps } = makeStore([
            rateLimited({ 'retry-after': '1' }), jsonAnswer(200, {}),
            rateLimited({ 'retry-after': '1' }), jsonAnswer(200, {}),
        ], { requestKeyBytes: 40 })

        await store.deleteMany([
            { key: 'assets/a.png', condition: { ifVersion: 1 } },
            { key: 'assets/b.png', condition: { ifVersion: 2 } },
        ])

        expect(requests).toHaveLength(4)
        expect(sleeps).toEqual([1000, 1000])
    })

    test('the body of each 429 is cancelled before the retry', async () => {
        let cancelled = 0
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('slow down'))
            },
            cancel() {
                cancelled += 1
            },
        })
        const { store } = makeStore([rateLimited({ 'retry-after': '1' }, body), readAnswer([1])])

        await store.read('assets/a.png')

        expect(cancelled).toBe(1)
    })

    test('without a delay in the answer the wait doubles from one second', async () => {
        const { store, sleeps, requests } = makeStore([rateLimited(), rateLimited(), rateLimited(), readAnswer([1])])

        await store.read('assets/a.png')

        expect(sleeps).toEqual([1000, 2000, 4000])
        expect(requests).toHaveLength(4)
    })
})

describe('the bound on retrying a 429', () => {
    test('after 5 tries the call fails with the error it fails with when nothing is retried', async () => {
        const { store, requests, sleeps } = makeStore([rateLimited()])

        const failure = await store.write('assets/a.png', new Uint8Array([1]), 'unconditional').catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(NodeHttpError)
        expect((failure as NodeHttpError).status).toBe(429)
        expect((failure as NodeHttpError).operation).toBe('write')
        expect(requests).toHaveLength(5)
        expect(sleeps).toEqual([1000, 2000, 4000, 8000])
    })

    test('a delete that stays rate limited fails after 5 tries with the remove error', async () => {
        const { store, requests } = makeStore([rateLimited()])

        const failure = await store.delete('assets/a.png', 'unconditional').catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(NodeHttpError)
        expect((failure as NodeHttpError).status).toBe(429)
        expect((failure as NodeHttpError).operation).toBe('remove')
        expect(requests).toHaveLength(5)
    })

    test('a deleteMany that stays rate limited leaves its keys unchanged', async () => {
        const { store } = makeStore([rateLimited()])

        const failure = await store.deleteMany([{ key: 'assets/a.png', condition: 'unconditional' }]).catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(StoreDeleteManyError)
        expect((failure as StoreDeleteManyError).report.map((entry) => entry.outcome)).toEqual(['unchanged'])
    })

    test('a wait that would carry the call past 90 seconds is not taken: the call fails at once', async () => {
        const { store, requests, sleeps } = makeStore([rateLimited({ 'retry-after': '100' })])

        const failure = await store.read('assets/a.png').catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(NodeHttpError)
        expect((failure as NodeHttpError).status).toBe(429)
        expect(requests).toHaveLength(1)
        expect(sleeps).toEqual([])
    })

    test('the waits of one call add up to at most 90 seconds', async () => {
        const { store, requests, sleeps } = makeStore([rateLimited({ 'retry-after': '40' })])

        const failure = await store.read('assets/a.png').catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(NodeHttpError)
        expect(sleeps).toEqual([40000, 40000])
        expect(requests).toHaveLength(3)
    })

    test('an answer that is not a 429 is never retried', async () => {
        const { store, requests, sleeps } = makeStore([jsonAnswer(500, {})])

        const failure = await store.write('assets/a.png', new Uint8Array([1]), 'unconditional').catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(NodeHttpError)
        expect((failure as NodeHttpError).status).toBe(500)
        expect(requests).toHaveLength(1)
        expect(sleeps).toEqual([])
    })
})

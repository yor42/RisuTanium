// @vitest-environment node
/**
 * The Node server's store2 change feed (`GET /api/store2-feed?since=`) against the real `server/node/server.cjs`
 * process. Labels: new-path guards of a route that has no earlier counterpart; their killing mutants are their
 * evidence. The feed is wake-only: it carries a revision and a server-instance id, never store contents.
 *
 * The long-poll timeout and the waiter cap are set through the environment so the test runs in seconds; the
 * production defaults (25 s, a larger cap) are not exercised here.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { startNodePeerFeed } from 'src/ts/storage/store2/nodePeerFeed'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const TIMEOUT_MS = 1500
const MAX_WAITERS = 2

interface FeedAnswer {
    rev: number
    instance: string
}

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer({ env: { RISU_STORE2_FEED_TIMEOUT_MS: String(TIMEOUT_MS), RISU_STORE2_FEED_MAX_WAITERS: String(MAX_WAITERS) } })
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

async function poll(since: string, options: { auth?: boolean, signal?: AbortSignal } = {}): Promise<Response> {
    const headers: Record<string, string> = options.auth === false ? {} : { 'risu-auth': await fixture.authHeader() }
    return await fetch(`${fixture.baseUrl}/api/store2-feed?since=${since}`, { headers, signal: options.signal })
}

async function answerOf(response: Response): Promise<FeedAnswer> {
    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    expect(typeof body === 'object' && body !== null && 'rev' in body && 'instance' in body).toBe(true)
    return body as FeedAnswer
}

function store() {
    return createNodeHttpStore({ authHeader: () => fixture.authHeader(), baseUrl: fixture.baseUrl })
}

/** One guarded write of `key`, over the version the server reports for it. */
async function writeKey(key: string): Promise<void> {
    const bytes = Uint8Array.from([1, 2, 3])
    const handle = store()
    const read = await handle.read(key)
    await handle.guarded?.writeChecked(key, bytes, { ifVersion: read.version ?? 0 }, [])
}

async function currentRev(): Promise<FeedAnswer> {
    // since is far above any revision, so the answer arrives at the timeout with the current revision.
    return await answerOf(await poll('999999999'))
}

/** Resolves true when `promise` settles within `ms`, false otherwise. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    const pending = Symbol('pending')
    const winner = await Promise.race([promise.then(() => 'settled', () => 'settled'), new Promise<symbol>((resolve) => setTimeout(() => resolve(pending), ms))])
    return winner === 'settled'
}

describe('GET /api/store2-feed', () => {
    test('answers at once when the revision is already past since', async () => {
        await writeKey(COMMIT_KEY)
        const started = Date.now()
        const answer = await answerOf(await poll('0'))
        expect(answer.rev).toBeGreaterThan(0)
        expect(typeof answer.instance).toBe('string')
        expect(Date.now() - started).toBeLessThan(TIMEOUT_MS)
    })

    test('answers when a commit-key write lands while it waits', async () => {
        const { rev } = await currentRev()
        const started = Date.now()
        const waiting = poll(String(rev))
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
        await writeKey(COMMIT_KEY)
        const answer = await answerOf(await waiting)
        expect(answer.rev).toBe(rev + 1)
        expect(Date.now() - started).toBeLessThan(TIMEOUT_MS)
    })

    test('answers unchanged after the timeout', async () => {
        const { rev, instance } = await currentRev()
        const started = Date.now()
        const answer = await answerOf(await poll(String(rev)))
        expect(answer).toEqual({ rev, instance })
        expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT_MS - 200)
    })

    test('a write of another key does not answer a waiter', async () => {
        const { rev } = await currentRev()
        const started = Date.now()
        const waiting = poll(String(rev))
        await new Promise<void>((resolve) => setTimeout(resolve, 200))
        await writeKey('store2/some-unit-key')
        const answer = await answerOf(await waiting)
        expect(answer.rev).toBe(rev)
        expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT_MS - 200)
    })

    test('answers carry only the revision and the instance id', async () => {
        const answer = await answerOf(await poll('0'))
        expect(Object.keys(answer).sort()).toEqual(['instance', 'rev'])
    })

    test('refuses a request without a valid token and holds nothing', async () => {
        const started = Date.now()
        const response = await poll('0', { auth: false })
        // checkAuth answers 400 for a missing token; the route adds no status of its own.
        expect(response.status).toBe(400)
        expect(Date.now() - started).toBeLessThan(TIMEOUT_MS)
    })

    test.each(['abc', '-1', '1.5', '', '1e3', '99999999999999999999'])('refuses since=%j with 400', async (since) => {
        expect((await poll(since)).status).toBe(400)
    })

    test('R1b answers a request with no since at once, as the baseline', async () => {
        const started = Date.now()
        const answer = await answerOf(await fetch(`${fixture.baseUrl}/api/store2-feed`, { headers: { 'risu-auth': await fixture.authHeader() } }))
        expect(typeof answer.rev).toBe('number')
        expect(typeof answer.instance).toBe('string')
        expect(Date.now() - started).toBeLessThan(TIMEOUT_MS)
    })

    test('refuses a waiter past the cap and takes one again when a waiter leaves', async () => {
        const { rev } = await currentRev()
        const first = new AbortController()
        const second = new AbortController()
        const held = [poll(String(rev), { signal: first.signal }), poll(String(rev), { signal: second.signal })]
        held.forEach((request) => request.catch(() => undefined))
        await new Promise<void>((resolve) => setTimeout(resolve, 300))

        const refused = await poll(String(rev))
        expect(refused.status).toBe(503)

        // A waiter that disconnects frees its place at once: the next one is held, not refused.
        first.abort()
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
        const third = new AbortController()
        const retried = poll(String(rev), { signal: third.signal })
        expect(await settlesWithin(retried, 500)).toBe(false)
        third.abort()
        second.abort()
        await retried.catch(() => undefined)
    })

    test('a restarted server reports a different instance and a revision from zero', async () => {
        const before = await currentRev()
        await fixture.restart()
        const after = await currentRev()
        expect(after.instance).not.toBe(before.instance)
        expect(after.rev).toBe(0)
    }, 60_000)

    test('R1b at revision 0 after a restart, a request with no since is still answered at once', async () => {
        const started = Date.now()
        const answer = await answerOf(await fetch(`${fixture.baseUrl}/api/store2-feed`, { headers: { 'risu-auth': await fixture.authHeader() } }))
        expect(answer.rev).toBe(0)
        expect(Date.now() - started).toBeLessThan(TIMEOUT_MS)
    })

    test('R1 a commit made while the first held request waits is one wake, also on a fresh server', async () => {
        await fixture.restart()
        const events = { count: 0 }
        const feed = startNodePeerFeed({
            authHeader: () => fixture.authHeader(),
            onPeerCommit: () => { events.count += 1 },
            baseUrl: fixture.baseUrl,
        })
        try {
            await new Promise<void>((resolve) => setTimeout(resolve, 300))
            await writeKey(COMMIT_KEY)
            const deadline = Date.now() + TIMEOUT_MS
            while (events.count === 0 && Date.now() < deadline) {
                await new Promise<void>((resolve) => setTimeout(resolve, 20))
            }
            expect(events.count).toBe(1)
        } finally {
            feed.stop()
        }
    }, 60_000)
})

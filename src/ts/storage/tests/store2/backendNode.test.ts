// @vitest-environment node
/**
 * The store2 Node backend against the real `server/node/server.cjs` (a child
 * process per test, through the same fixture the byte-store tests use): the shared
 * conformance suite, then what is specific to Node (revision tokens, the guarded
 * request shapes, the units a failed commit may leave behind, outcome
 * classification). A fresh server per test: a server keeps a revision for every key
 * it ever held, and a unit key is created once per server. Cases that need a
 * response the real server never gives (a lost response, a 500, a 409 naming a
 * unit on a removal) put a wrapper around `fetch`, which forwards to the real
 * server or answers in its place.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    Store2BackendFailureError,
    Store2CommitConflictError,
    Store2FenceConflictError,
    Store2OverwriteRefusedError,
    Store2UnitConflictError,
    Store2UnknownOutcomeError,
    createNodeBackend,
    revisionTokenOf,
    type Store2Backend,
    type Store2Read,
} from 'src/ts/storage/store2/backend'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { hexOfKey, startNodeServer, type NodeServerFixture } from '../nodeServerFixture'
import { absentCommit, absentFence, bytesOf, runBackendConformance, tokenOf, unit, unitKey } from './backendConformance'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const fixtures: NodeServerFixture[] = []

afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()))
})

interface Sent {
    path: string
    headers: Record<string, string>
}

interface Wire {
    /** Every request the backend's store sent, in order. */
    sent: Sent[]
    /** Answers a request in place of the real server; `real` forwards it. Return what the store should see, or throw to lose the response. */
    answer?: (request: Sent, real: () => Promise<Response>) => Promise<Response>
    /** Makes the next auth header fail, as a store that cannot produce its token. */
    authFails: boolean
}

interface Opened {
    fixture: NodeServerFixture
    store: ByteStore
    backend: Store2Backend
    wire: Wire
}

async function open(): Promise<Opened> {
    const fixture = await startNodeServer()
    fixtures.push(fixture)
    const wire: Wire = { sent: [], authFails: false }
    const wired: FetchLike = async (url, init) => {
        const request: Sent = { path: new URL(url).pathname, headers: { ...(init?.headers as Record<string, string>) } }
        wire.sent.push(request)
        const real = () => fetch(url, init)
        return wire.answer === undefined ? real() : wire.answer(request, real)
    }
    const store = createNodeHttpStore({
        baseUrl: fixture.baseUrl,
        authHeader: () => wire.authFails ? Promise.reject(new Error('No token.')) : fixture.authHeader(),
        fetch: wired,
    })
    return { fixture, store, backend: createNodeBackend(store), wire }
}

/** A write the backend itself never makes: a foreign or damaged writer, straight to the server. */
async function rawWrite(fixture: NodeServerFixture, key: string, bytes: Uint8Array): Promise<void> {
    const response = await fetch(`${fixture.baseUrl}/api/write`, {
        method: 'POST',
        headers: { 'file-path': hexOfKey(key), 'risu-auth': await fixture.authHeader(), 'content-type': 'application/octet-stream' },
        body: bytes as Uint8Array<ArrayBuffer>,
    })
    expect(response.ok).toBe(true)
}

function isWriteOf(request: Sent, key: string): boolean {
    return request.path === '/api/write-checked' && request.headers['file-path'] === hexOfKey(key)
}

/** Lets the real server apply `real`, then drops the connection as a network loss would. */
async function applyThenLose(real: () => Promise<Response>): Promise<Response> {
    await (await real()).arrayBuffer()
    throw new TypeError('fetch failed')
}

runBackendConformance('node', async () => {
    const { fixture, backend } = await open()
    return { backend, plant: (key, bytes) => rawWrite(fixture, key, bytes) }
}, { compare: 'revision', atomicUnits: false })

describe('node backend revision tokens', () => {
    test('a read hands out a revision token, present only when the key holds a value', async () => {
        const { backend } = await open()
        expect((await backend.readCommit()).token).toMatchObject({ kind: 'revision', present: false })
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        expect((await backend.readCommit()).token).toMatchObject({ kind: 'revision', present: true })
    })

    test('a first create presents the revision the absence read returned, which is not zero once the key was held and removed', async () => {
        const { backend, store } = await open()
        for (const key of [COMMIT_KEY, FENCE_KEY]) {
            await store.write(key, bytesOf(1), 'unconditional')
            await store.delete(key, 'unconditional')
        }
        const commit = await absentCommit(backend)
        const fence = await absentFence(backend)
        expect(commit).toMatchObject({ present: false })
        expect(revisionTokenOf(commit).revision).toBeGreaterThan(0)
        expect(revisionTokenOf(fence).revision).toBeGreaterThan(0)
        await backend.casCommit(commit, bytesOf(2))
        await backend.casFence(fence, bytesOf(3))
        expect([...(await backend.readCommit()).bytes!]).toEqual([2])
        expect([...(await backend.readFence()).bytes!]).toEqual([3])
    })

    test('a byte token is refused with a RangeError before any request', async () => {
        const { backend, wire } = await open()
        const sentBefore = wire.sent.length
        await expect(backend.casCommit(tokenOf(null), bytesOf(1))).rejects.toBeInstanceOf(RangeError)
        await expect(backend.casFence(tokenOf(bytesOf(1)), null)).rejects.toBeInstanceOf(RangeError)
        await expect(backend.commitOrdinary(tokenOf(null), [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(RangeError)
        await expect(backend.removeBatch([unitKey(1)], tokenOf(null), tokenOf(null))).rejects.toBeInstanceOf(RangeError)
        expect(wire.sent.length).toBe(sentBefore)
    })

    test('a write reports no flush status', async () => {
        const { backend } = await open()
        const results = [
            await backend.casCommit(await absentCommit(backend), bytesOf(1)),
            await backend.casFence(await absentFence(backend), bytesOf(1)),
            await backend.putUnit(unitKey(1), bytesOf(1)),
            await backend.commitOrdinary((await backend.readCommit()).token, [unit(2)], bytesOf(2)),
            await backend.removeBatch([unitKey(1)], (await backend.readCommit()).token, (await backend.readFence()).token),
        ]
        for (const result of results) {
            expect(result).toEqual({ flushed: undefined })
            expect('flushed' in result).toBe(true)
        }
    })
})

describe('node backend commit key conflicts', () => {
    test('a 409 on the commit key re-reads it and reports what is there now', async () => {
        const { backend, fixture, wire } = await open()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const stale = await backend.readCommit()
        await rawWrite(fixture, COMMIT_KEY, bytesOf(2, 2))
        wire.sent.length = 0
        const error = await backend.casCommit(stale.token, bytesOf(3)).catch((e: unknown) => e)
        const paths = wire.sent.map((request) => request.path)
        expect(error).toBeInstanceOf(Store2CommitConflictError)
        const current = (error as Store2CommitConflictError).current
        expect([...current.bytes!]).toEqual([2, 2])
        expect(current.token).toEqual((await backend.readCommit()).token)
        expect(paths).toEqual(['/api/write-checked', '/api/read'])
    })

    test('a stale commitOrdinary leaves the commit key as it was and only fresh units this step wrote', async () => {
        const { backend, fixture } = await open()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const stale = await backend.readCommit()
        await rawWrite(fixture, COMMIT_KEY, bytesOf(2))
        const units = [unit(1), unit(2), unit(3)]
        await expect(backend.commitOrdinary(stale.token, units, bytesOf(3))).rejects.toBeInstanceOf(Store2CommitConflictError)
        expect([...(await backend.readCommit()).bytes!]).toEqual([2])
        const read = await backend.readUnits(units.map((u) => u.key))
        expect(units.map((u) => [...read.get(u.key)!])).toEqual(units.map((u) => [...u.bytes]))
    })

    test('a unit that changed between its upload and the commit-key write fails the step and the commit key is not written', async () => {
        const { backend, fixture, wire } = await open()
        const absent = await absentCommit(backend)
        let fired = false
        wire.answer = async (request, real) => {
            if (!fired && isWriteOf(request, COMMIT_KEY)) {
                fired = true
                await rawWrite(fixture, unitKey(2), bytesOf(99))
            }
            return real()
        }
        const error = await backend.commitOrdinary(absent, [unit(1), unit(2), unit(3)], bytesOf(1)).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Store2UnitConflictError)
        expect((error as Store2UnitConflictError).key).toBe(unitKey(2))
        expect((await backend.readCommit()).bytes).toBeNull()
    })

    test('the commit-key write carries a check-only revision for every uploaded unit', async () => {
        const { backend, wire } = await open()
        const units = [unit(1), unit(2)]
        await backend.commitOrdinary(await absentCommit(backend), units, bytesOf(1))
        const commitWrite = wire.sent.find((request) => isWriteOf(request, COMMIT_KEY))!
        expect(commitWrite.headers['check-only-count']).toBe('2')
        expect(commitWrite.headers['check-only-path'].split('$$').sort()).toEqual(units.map((u) => hexOfKey(u.key)).sort())
        expect(commitWrite.headers['check-only-revision']).toBe('1$$1')
    })

    test('a unit already on the server is refused as an overwrite, never replaced', async () => {
        const { backend, fixture } = await open()
        await rawWrite(fixture, unitKey(1), bytesOf(42))
        await expect(backend.putUnit(unitKey(1), bytesOf(1))).rejects.toBeInstanceOf(Store2OverwriteRefusedError)
        expect([...(await backend.readUnits([unitKey(1)])).get(unitKey(1))!]).toEqual([42])
    })
})

describe('node backend removal', () => {
    async function seeded(backend: Store2Backend, count: number): Promise<string[]> {
        const keys = Array.from({ length: count }, (_, i) => unitKey(i))
        for (const key of keys) {
            await backend.putUnit(key, bytesOf(1))
        }
        return keys
    }

    test('one request carries the batch and a check-only revision for the commit key, then the fence', async () => {
        const { backend, wire } = await open()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const keys = await seeded(backend, 25)
        const commit = await backend.readCommit()
        const fence = await backend.readFence()
        wire.sent.length = 0
        await backend.removeBatch(keys, commit.token, fence.token)
        expect(wire.sent.map((request) => request.path)).toEqual(['/api/remove-checked'])
        const headers = wire.sent[0].headers
        expect(headers['file-path'].split('$$')).toEqual(keys.map(hexOfKey))
        expect(headers['check-only-count']).toBe('2')
        expect(headers['check-only-path']).toBe(`${hexOfKey(COMMIT_KEY)}$$${hexOfKey(FENCE_KEY)}`)
        const revision = (read: Store2Read) => String(revisionTokenOf(read.token).revision)
        expect(headers['check-only-revision']).toBe(`${revision(commit)}$$${revision(fence)}`)
        expect(await backend.listStore2()).toEqual([])
    })

    test('a fence that appeared deletes nothing, in the one request that was sent', async () => {
        const { backend, fixture, wire } = await open()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const keys = await seeded(backend, 5)
        const commit = await backend.readCommit()
        const noFence = await backend.readFence()
        await rawWrite(fixture, FENCE_KEY, bytesOf(1))
        wire.sent.length = 0
        await expect(backend.removeBatch(keys, commit.token, noFence.token)).rejects.toBeInstanceOf(Store2FenceConflictError)
        expect(wire.sent.filter((request) => request.path === '/api/remove-checked').length).toBe(1)
        expect(await backend.listStore2()).toEqual(keys)
    })

    test('a fence that was created and deleted again still conflicts: the revision moved although the key is absent', async () => {
        const { backend, store } = await open()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const keys = await seeded(backend, 3)
        const commit = await backend.readCommit()
        const noFence = await backend.readFence()
        await store.write(FENCE_KEY, bytesOf(1), 'unconditional')
        await store.delete(FENCE_KEY, 'unconditional')
        await expect(backend.removeBatch(keys, commit.token, noFence.token)).rejects.toBeInstanceOf(Store2FenceConflictError)
        expect(await backend.listStore2()).toEqual(keys)
    })

    test('a stale commit key is reported as the commit key, before the fence', async () => {
        const { backend, fixture } = await open()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const keys = await seeded(backend, 3)
        const commit = await backend.readCommit()
        const noFence = await backend.readFence()
        await rawWrite(fixture, COMMIT_KEY, bytesOf(2))
        await rawWrite(fixture, FENCE_KEY, bytesOf(1))
        await expect(backend.removeBatch(keys, commit.token, noFence.token)).rejects.toBeInstanceOf(Store2CommitConflictError)
        expect(await backend.listStore2()).toEqual(keys)
    })

    test('a conflict the server names on a unit key is reported with that key, and the step is not retried', async () => {
        // The real server compares only the revisions this backend sends (commit key and fence), so the 409 that names a
        // unit is served by the wrapper; what is verified is the mapping from the named key to the typed error.
        const { backend, wire } = await open()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const keys = await seeded(backend, 3)
        const commit = await backend.readCommit()
        const fence = await backend.readFence()
        wire.answer = async (request, real) => {
            if (request.path !== '/api/remove-checked') {
                return real()
            }
            return new Response(JSON.stringify({ success: false, error: 'Revision conflict', filePath: hexOfKey(keys[1]), currentRevision: 3 }), {
                status: 409,
                headers: { 'content-type': 'application/json', 'risu-storage-guarded': '1' },
            })
        }
        wire.sent.length = 0
        const error = await backend.removeBatch(keys, commit.token, fence.token).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Store2UnitConflictError)
        expect((error as Store2UnitConflictError).key).toBe(keys[1])
        expect(wire.sent.filter((request) => request.path === '/api/remove-checked').length).toBe(1)
    })

    test('an empty batch only checks the commit key and the fence', async () => {
        const { backend, fixture } = await open()
        await backend.casCommit(await absentCommit(backend), bytesOf(1))
        const commit = await backend.readCommit()
        const fence = await backend.readFence()
        await backend.removeBatch([], commit.token, fence.token)
        await rawWrite(fixture, FENCE_KEY, bytesOf(1))
        await expect(backend.removeBatch([], commit.token, fence.token)).rejects.toBeInstanceOf(Store2FenceConflictError)
    })
})

describe('node backend outcome classification', () => {
    test('a connection lost after the commit-key request was sent is an unknown outcome, and the write did apply', async () => {
        const { backend, wire } = await open()
        const absent = await absentCommit(backend)
        wire.answer = (request, real) => isWriteOf(request, COMMIT_KEY) ? applyThenLose(real) : real()
        await expect(backend.casCommit(absent, bytesOf(7))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        wire.answer = undefined
        expect([...(await backend.readCommit()).bytes!]).toEqual([7])
    })

    test('a connection lost after a unit upload, a fence write or a removal was sent is an unknown outcome', async () => {
        const { backend, wire } = await open()
        wire.answer = (request, real) => request.path === '/api/write-checked' ? applyThenLose(real) : real()
        await expect(backend.putUnit(unitKey(1), bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        await expect(backend.commitOrdinary(await absentCommit(backend), [unit(2)], bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        await expect(backend.casFence(await absentFence(backend), bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        wire.answer = (request, real) => request.path === '/api/remove-checked' ? applyThenLose(real) : real()
        await expect(backend.removeBatch([unitKey(1)], await absentCommit(backend), (await backend.readFence()).token)).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
    })

    test('a lost response that hides a conflict is still an unknown outcome, not a conflict', async () => {
        const { backend, wire, fixture } = await open()
        const absent = await absentCommit(backend)
        await rawWrite(fixture, COMMIT_KEY, bytesOf(1))
        wire.answer = (request, real) => isWriteOf(request, COMMIT_KEY) ? applyThenLose(real) : real()
        await expect(backend.casCommit(absent, bytesOf(2))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
    })

    test('a server error after the request was sent is an unknown outcome', async () => {
        const { backend, wire } = await open()
        const absent = await absentCommit(backend)
        wire.answer = async (request, real) => isWriteOf(request, COMMIT_KEY) ? new Response('boom', { status: 500 }) : real()
        await expect(backend.casCommit(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
    })

    // The tests below are mapping tests: the wrapper serves an answer the real server never gives, and what is verified is
    // how the backend classifies it, not what the server does.
    test.each([502, 503, 504])('a %i answer to a commit-key write, which a proxy may give after the server applied it, is an unknown outcome', async (status) => {
        const { backend, wire } = await open()
        const absent = await absentCommit(backend)
        wire.answer = async (request, real) => isWriteOf(request, COMMIT_KEY) ? new Response('upstream', { status }) : real()
        await expect(backend.casCommit(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
    })

    test('a 200 JSON answer without the guarded marker to a commit-key write is an unknown outcome: the marker may have been lost after the server applied it', async () => {
        const { backend, wire } = await open()
        const absent = await absentCommit(backend)
        wire.answer = async (request, real) => isWriteOf(request, COMMIT_KEY) ? new Response('{"success":true}', { status: 200, headers: { 'content-type': 'application/json' } }) : real()
        await expect(backend.casCommit(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        await expect(backend.commitOrdinary(absent, [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
    })

    test('a 200 HTML page without the guarded marker to a commit-key write is a definite failure: it is taken as a front end fallback the guarded handler never answered', async () => {
        const { backend, wire } = await open()
        const absent = await absentCommit(backend)
        wire.answer = async (request, real) => isWriteOf(request, COMMIT_KEY) ? new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) : real()
        await expect(backend.casCommit(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
    })

    test('commitOrdinary with one upload refused with a 400 and another whose response is lost is an unknown outcome, and the commit key is not written', async () => {
        const { backend, wire } = await open()
        const absent = await absentCommit(backend)
        wire.answer = async (request, real) => {
            if (isWriteOf(request, unitKey(1))) {
                return new Response('bad', { status: 400 })
            }
            return isWriteOf(request, unitKey(2)) ? applyThenLose(real) : real()
        }
        const error = await backend.commitOrdinary(absent, [unit(1), unit(2)], bytesOf(1)).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Store2UnknownOutcomeError)
        expect(wire.sent.some((request) => isWriteOf(request, COMMIT_KEY))).toBe(false)
        wire.answer = undefined
        expect((await backend.readCommit()).bytes).toBeNull()
    })

    test('a refusal that applies nothing, and a request that could not be sent, are definite failures', async () => {
        const { backend, wire } = await open()
        const absent = await absentCommit(backend)
        wire.answer = async (request, real) => isWriteOf(request, COMMIT_KEY) ? new Response('no', { status: 401 }) : real()
        await expect(backend.casCommit(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
        wire.answer = undefined
        wire.authFails = true
        await expect(backend.casCommit(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
        await expect(backend.readCommit()).rejects.toBeInstanceOf(Store2BackendFailureError)
        wire.authFails = false
        expect((await backend.readCommit()).bytes).toBeNull()
    })

    test('a failed read is a failure even when the connection is lost', async () => {
        const { backend, wire } = await open()
        wire.answer = async () => {
            throw new TypeError('fetch failed')
        }
        await expect(backend.readCommit()).rejects.toBeInstanceOf(Store2BackendFailureError)
        await expect(backend.readUnits([unitKey(1)])).rejects.toBeInstanceOf(Store2BackendFailureError)
        await expect(backend.listStore2()).rejects.toBeInstanceOf(Store2BackendFailureError)
    })
})

describe('node backend reads and listing', () => {
    test('readUnits runs at most eight requests at a time', async () => {
        const { backend, wire } = await open()
        const keys = Array.from({ length: 30 }, (_, i) => unitKey(i))
        for (const key of keys.slice(0, 10)) {
            await backend.putUnit(key, bytesOf(1))
        }
        let inFlight = 0
        let peak = 0
        wire.answer = async (request, real) => {
            if (request.path !== '/api/read') {
                return real()
            }
            inFlight++
            peak = Math.max(peak, inFlight)
            try {
                await new Promise((resolve) => setTimeout(resolve, 15))
                return await real()
            } finally {
                inFlight--
            }
        }
        const read = await backend.readUnits(keys)
        expect(read.size).toBe(30)
        expect(peak).toBeGreaterThan(1)
        expect(peak).toBeLessThanOrEqual(8)
    })

    test('names the server adds to a prefix answer that are not unit keys are never listed', async () => {
        const { backend, wire } = await open()
        await backend.putUnit(unitKey(1), bytesOf(1))
        wire.answer = async (request, real) => {
            const response = await real()
            if (request.path !== '/api/list-prefix') {
                return response
            }
            const body = await response.json() as { content: string[] }
            body.content.push('store-commit-lookalike', 'store2/', 'store2-commit', 'store2-fence', 'store20/x', 'assets/a.png')
            return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        expect(await backend.listStore2()).toEqual([unitKey(1)])
    })

    test('a server without the prefix route is listed and counted through the full list', async () => {
        const { backend, wire } = await open()
        await backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2)], bytesOf(1))
        wire.answer = async (request, real) => request.path === '/api/list-prefix' ? new Response('Not found', { status: 404 }) : real()
        expect(await backend.listStore2()).toEqual([unitKey(1), unitKey(2)])
        expect(await backend.countPrefix('store2/')).toBe(2)
        expect(await backend.countPrefix('store2-')).toBe(1)
        expect(wire.sent.some((request) => request.path === '/api/list')).toBe(true)
    })
})

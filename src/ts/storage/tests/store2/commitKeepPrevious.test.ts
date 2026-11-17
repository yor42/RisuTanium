// @vitest-environment node
/**
 * `CommitRequest.keepPrevious`: the previous `current` enters `retained` whatever the admission interval says, in an
 * ordinary commit and in the final write of a bulk one, and nothing else about the commit changes: `force` keeps its
 * own meaning (the descent line is minted anew), `keepPrevious` leaves the descent line alone. Memory backend; a
 * mocked backend says nothing about a native one.
 */
import { describe, expect, test } from 'vitest'
import { BULK_UNIT_THRESHOLD, createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import type { CommitRequest, Committer } from 'src/ts/storage/store2/commit'
import { ADMISSION_INTERVAL_MS } from 'src/ts/storage/store2/commit'
import { RETAINED_MAX } from 'src/ts/storage/store2/commitKey'
import { committerOf, createClock, parsedCommit, seedStore, testEnv, treeRequest } from './commitFixtures'
import { extrasOf } from './lineFixtures'

const MINUTE = 60_000

async function world() {
    const backend = createMemoryBackend()
    const clock = createClock()
    const m0 = await seedStore(backend, testEnv(clock, 1))
    return { backend, clock, m0, committer: committerOf(backend, clock, 100) }
}

/** A delta over the current tree, as a save pass plans it: it carries nothing, so only its descent line is judged. */
async function deltaRequest(committer: Committer, backend: Store2Backend, extra = 0, tag = 'x', more: Partial<CommitRequest> = {}): Promise<CommitRequest> {
    const current = (await parsedCommit(backend)).current
    if (current === null) {
        throw new Error('No current manifest.')
    }
    return { ...treeRequest(extra, { tag }), carry: { from: current.key, units: 0 }, ...more }
}
async function commit(committer: Committer, request: CommitRequest): Promise<string> {
    const result = await committer.commit(await committer.readCommit(), request)
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') {
        throw new Error(`Expected committed, got ${result.status}.`)
    }
    return result.manifestKey
}

describe('keepPrevious in an ordinary commit', () => {
    test('RET1 inside the admission window the previous current is kept, and without the flag it is not', async () => {
        const { backend, clock, m0, committer } = await world()
        const m1 = await commit(committer, await deltaRequest(committer, backend))
        clock.advance(MINUTE)
        const m2 = await commit(committer, await deltaRequest(committer, backend, 0, 'kept', { keepPrevious: true }))
        expect((await parsedCommit(backend)).retained.map(entry => entry.key)).toEqual([m1, m0])
        clock.advance(MINUTE)
        await commit(committer, await deltaRequest(committer, backend, 0, 'plain'))
        const plain = (await parsedCommit(backend)).retained.map(entry => entry.key)
        expect(plain).toEqual([m1, m0])
        expect(plain).not.toContain(m2)
    })

    test('RET1b keepPrevious leaves the descent line alone, where force mints a new one (C6)', async () => {
        const { backend, clock, committer } = await world()
        await commit(committer, await deltaRequest(committer, backend))
        clock.advance(MINUTE)
        await commit(committer, await deltaRequest(committer, backend, 0, 'second'))
        const line = extrasOf(await parsedCommit(backend)).line
        expect(line).toBeDefined()
        clock.advance(MINUTE)
        await commit(committer, await deltaRequest(committer, backend, 0, 'kept', { keepPrevious: true }))
        expect(extrasOf(await parsedCommit(backend)).line?.id).toBe(line?.id)
        clock.advance(MINUTE)
        await commit(committer, await deltaRequest(committer, backend, 0, 'forced', { force: true }))
        expect(extrasOf(await parsedCommit(backend)).line?.id).not.toBe(line?.id)
    })

    test('RET5 with a full unpinned retained list one keepPrevious commit evicts exactly the oldest entry', async () => {
        const { backend, clock, committer } = await world()
        for (let index = 0; index < RETAINED_MAX + 2; index++) {
            clock.advance(ADMISSION_INTERVAL_MS + 1)
            await commit(committer, await deltaRequest(committer, backend, 0, `r${index}`))
        }
        const before = (await parsedCommit(backend)).retained
        expect(before).toHaveLength(RETAINED_MAX)
        const current = (await parsedCommit(backend)).current?.key
        clock.advance(MINUTE)
        await commit(committer, await deltaRequest(committer, backend, 0, 'kept', { keepPrevious: true }))
        const after = (await parsedCommit(backend)).retained
        expect(after).toHaveLength(RETAINED_MAX)
        expect(after[0].key).toBe(current)
        expect(after.map(entry => entry.key)).toEqual([current, ...before.slice(0, RETAINED_MAX - 1).map(entry => entry.key)])
    })
})

describe('keepPrevious in a bulk commit (RET7)', () => {
    test('the final write keeps the previous current inside the window; without the flag it does not', async () => {
        const kept = await world()
        const m1 = await commit(kept.committer, await deltaRequest(kept.committer, kept.backend))
        kept.clock.advance(MINUTE)
        const bulk = await deltaRequest(kept.committer, kept.backend, BULK_UNIT_THRESHOLD, 'bulk', { keepPrevious: true })
        expect(bulk.newUnits).toBeGreaterThan(BULK_UNIT_THRESHOLD)
        await commit(kept.committer, bulk)
        expect((await parsedCommit(kept.backend)).retained.map(entry => entry.key)).toContain(m1)
        const plain = await world()
        const p1 = await commit(plain.committer, await deltaRequest(plain.committer, plain.backend))
        plain.clock.advance(MINUTE)
        await commit(plain.committer, await deltaRequest(plain.committer, plain.backend, BULK_UNIT_THRESHOLD, 'bulk'))
        expect((await parsedCommit(plain.backend)).retained.map(entry => entry.key)).not.toContain(p1)
    })
})

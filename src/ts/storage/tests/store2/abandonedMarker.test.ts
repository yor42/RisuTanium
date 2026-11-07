// @vitest-environment node
/**
 * The abandoned-marker helper and the host probe: a foreign bulk marker is cleared only on a 'gone' answer, an own
 * marker is cleared without asking, and the web probe answers from a Web Locks snapshot plus this tab's own hold.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Store2BackendFailureError } from 'src/ts/storage/store2/backend'
import {
    clearAbandonedMarker, markerOwnerProbeFor, type MarkerLiveness, type MarkerOwnerProbe,
} from 'src/ts/storage/store2/abandonedMarker'
import { IMPORT_REPLACES_BASE, type Committer } from 'src/ts/storage/store2/commit'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'
import {
    COMMIT_BACKENDS, committerOf, createClock, expectInvariant, hooked, parsedCommit, peerWrite, seedStore, testEnv,
    treeRequest, type Hooks, type OpenedBackend,
} from './commitFixtures'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const opened: OpenedBackend[] = []
const BULK_MIN = 49

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

async function until(condition: () => Promise<boolean>, what: string): Promise<void> {
    const deadline = Date.now() + 8000
    while (!(await condition())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}.`)
        }
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

/** The marker a bulk commit sets by its real marker write: its build never returns, so the marker stands. */
async function leaveBulkMarker(by: Committer, backend: OpenedBackend['backend']): Promise<void> {
    void by.commit(await by.readCommit(), {
        newUnits: 100,
        carry: IMPORT_REPLACES_BASE,
        label: 'bulk',
        build: () => new Promise(() => {}),
    })
    await until(async () => (await parsedCommit(backend)).staging !== null, 'the marker')
}

describe.each(COMMIT_BACKENDS.map(fixture => [fixture.name, fixture] as const))('clearAbandonedMarker on the %s backend', (_name, fixture) => {
    async function setup(hooks: Hooks = {}) {
        const entry = await fixture.open()
        opened.push(entry)
        const clock = createClock()
        const m0 = await seedStore(entry.backend, testEnv(clock, 1))
        const wrapped = hooked(entry.backend, hooks)
        const mine = committerOf(wrapped.backend, clock, 100)
        const foreign = committerOf(wrapped.backend, clock, 200, { owner: 'foreign-page' })
        return { raw: entry.backend, mine, foreign, clock, m0 }
    }

    function probeOf(answer: MarkerLiveness | Error): { probe: MarkerOwnerProbe, calls: string[] } {
        const calls: string[] = []
        return {
            calls,
            probe: async (marker) => {
                calls.push(marker.owner)
                if (answer instanceof Error) {
                    throw answer
                }
                return answer
            },
        }
    }

    test('a foreign marker whose owner is gone is cleared to the read key minus its marker', async () => {
        const { raw, mine, foreign } = await setup()
        await leaveBulkMarker(foreign, raw)
        const read = await mine.readCommit()
        const before = await parsedCommit(raw)
        const { probe, calls } = probeOf('gone')
        const outcome = await clearAbandonedMarker(mine, read, probe)
        expect(outcome).toMatchObject({ own: false, liveness: 'gone', result: { status: 'cleared' } })
        expect(outcome.marker?.owner).toBe('foreign-page')
        expect(calls).toEqual(['foreign-page'])
        const after = await parsedCommit(raw)
        expect(after.staging).toBeNull()
        expect(after.current).toEqual(before.current)
        expect(after.seq).toBe(before.seq + 1)
        await expectInvariant(raw)
    })

    test('a foreign marker whose owner is alive is left and nothing is written', async () => {
        const { raw, mine, foreign } = await setup()
        await leaveBulkMarker(foreign, raw)
        const read = await mine.readCommit()
        const { probe } = probeOf('alive')
        const outcome = await clearAbandonedMarker(mine, read, probe)
        expect(outcome).toMatchObject({ own: false, liveness: 'alive', result: null })
        expect((await parsedCommit(raw)).staging?.owner).toBe('foreign-page')
        expect((await mine.readCommit()).bytes).toEqual(read.bytes)
    })

    test('a probe that throws counts as unknown and nothing is written', async () => {
        const { raw, mine, foreign } = await setup()
        await leaveBulkMarker(foreign, raw)
        const read = await mine.readCommit()
        const { probe } = probeOf(new Error('query failed'))
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const outcome = await clearAbandonedMarker(mine, read, probe)
            expect(outcome).toMatchObject({ own: false, liveness: 'unknown', result: null })
        } finally {
            errors.mockRestore()
        }
        expect((await mine.readCommit()).bytes).toEqual(read.bytes)
    })

    test('an unknown answer leaves the marker', async () => {
        const { raw, mine, foreign } = await setup()
        await leaveBulkMarker(foreign, raw)
        const read = await mine.readCommit()
        const outcome = await clearAbandonedMarker(mine, read, probeOf('unknown').probe)
        expect(outcome).toMatchObject({ own: false, liveness: 'unknown', result: null })
        expect((await mine.readCommit()).bytes).toEqual(read.bytes)
    })

    test('no probe leaves a foreign marker and reports no liveness', async () => {
        const { raw, mine, foreign } = await setup()
        await leaveBulkMarker(foreign, raw)
        const read = await mine.readCommit()
        const outcome = await clearAbandonedMarker(mine, read, null)
        expect(outcome).toMatchObject({ own: false, liveness: null, result: null })
        expect(outcome.marker?.owner).toBe('foreign-page')
        expect((await mine.readCommit()).bytes).toEqual(read.bytes)
    })

    test('an own marker is cleared and the probe is never asked', async () => {
        const { raw, mine } = await setup()
        await leaveBulkMarker(mine, raw)
        const read = await mine.readCommit()
        const { probe, calls } = probeOf('alive')
        const outcome = await clearAbandonedMarker(mine, read, probe)
        expect(outcome).toMatchObject({ own: true, liveness: null, result: { status: 'cleared' } })
        expect(calls).toEqual([])
        expect((await parsedCommit(raw)).staging).toBeNull()
    })

    test('no marker: nothing is judged', async () => {
        const { mine } = await setup()
        const outcome = await clearAbandonedMarker(mine, await mine.readCommit(), probeOf('gone').probe)
        expect(outcome).toEqual({ marker: null, own: false, liveness: null, result: null })
    })

    test('a peer\'s ordinary commit between the read and the clear is kept: the clear is judged again on a fresh read', async () => {
        const { raw, mine, foreign, clock, m0 } = await setup()
        await leaveBulkMarker(foreign, raw)
        const read = await mine.readCommit()
        await peerWrite(raw, testEnv(clock, 300), { pins: [{ key: m0, reason: 'keep' }] })
        const outcome = await clearAbandonedMarker(mine, read, probeOf('gone').probe)
        expect(outcome.result?.status).toBe('cleared')
        const after = await parsedCommit(raw)
        expect(after.staging).toBeNull()
        expect(after.pins).toEqual([{ key: m0, reason: 'keep' }])
    })

    test('a marker another owner has replaced is not cleared', async () => {
        const { raw, mine, foreign, clock } = await setup()
        await leaveBulkMarker(foreign, raw)
        const read = await mine.readCommit()
        const stale = await parsedCommit(raw)
        await peerWrite(raw, testEnv(clock, 400), { staging: { owner: 'third-page', prefix: stale.staging?.prefix as string, startedAt: 9, label: 'bulk' } })
        const bytesBefore = (await mine.readCommit()).bytes
        const outcome = await clearAbandonedMarker(mine, read, probeOf('gone').probe)
        expect(outcome.result?.status).toBe('refused')
        expect((await mine.readCommit()).bytes).toEqual(bytesBefore)
        expect((await parsedCommit(raw)).staging?.owner).toBe('third-page')
    })

    test('a clear that throws is logged and answers no result', async () => {
        const { raw, mine, foreign } = await setup()
        await leaveBulkMarker(foreign, raw)
        const read = await mine.readCommit()
        const throwing: Pick<Committer, 'owner' | 'abandonClear'> = {
            owner: mine.owner,
            abandonClear: async () => {
                throw new Store2BackendFailureError('down')
            },
        }
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const outcome = await clearAbandonedMarker(throwing, read, probeOf('gone').probe)
            expect(outcome).toMatchObject({ own: false, liveness: 'gone', result: null })
        } finally {
            errors.mockRestore()
        }
    })
})

describe('a bulk that failed partway leaves a marker whose staged units one GC pass reclaims once the helper clears it', () => {
    test('the marker stands over three staged units; after the clear a GC pass deletes them', async () => {
        const entry = await COMMIT_BACKENDS.find(fixture => fixture.name === 'memory')!.open()
        opened.push(entry)
        const clock = createClock()
        await seedStore(entry.backend, testEnv(clock, 1))
        let armed = false
        let putUnits = 0
        let casCommits = 0
        const wrapped = hooked(entry.backend, {
            before: (name) => {
                if (!armed) {
                    return
                }
                if (name === 'putUnit') {
                    putUnits += 1
                    if (putUnits === 4) {
                        throw new Store2BackendFailureError('down')
                    }
                } else if (name === 'casCommit') {
                    casCommits += 1
                    if (casCommits === 2) {
                        throw new Store2BackendFailureError('down')
                    }
                }
            },
        })
        const foreign = committerOf(wrapped.backend, clock, 200, { owner: 'foreign-page' })
        const mine = committerOf(wrapped.backend, clock, 100)
        armed = true
        await foreign.commit(await foreign.readCommit(), treeRequest(BULK_MIN)).catch(() => null)
        const marker = (await parsedCommit(entry.backend)).staging
        expect(marker?.owner).toBe('foreign-page')
        const staged = (await entry.backend.listStore2()).filter(key => key.startsWith(marker?.prefix as string))
        expect(staged).toHaveLength(3)
        const outcome = await clearAbandonedMarker(mine, await mine.readCommit(), async () => 'gone')
        expect(outcome.result?.status).toBe('cleared')
        const result = await gcPass({ backend: entry.backend, kind: 'indexeddb', idleReason: () => null })
        expect(result.status).toBe('done')
        const left = (await entry.backend.listStore2()).filter(key => key.startsWith(marker?.prefix as string))
        expect(left).toEqual([])
    })
})

describe('markerOwnerProbeFor', () => {
    type Snapshot = Awaited<ReturnType<LockManager['query']>>
    const presence = (mode: 'shared' | 'exclusive' = 'shared') => ({ name: STORAGE_TAB_LOCK_NAME, mode })

    function web(snapshot: Snapshot | Error, holds = true) {
        const query = vi.fn(async (): Promise<Snapshot> => {
            if (snapshot instanceof Error) {
                throw snapshot
            }
            return snapshot
        })
        const probe = markerOwnerProbeFor('indexeddb', { query, holdsOwnPresence: () => holds })
        return { probe, query }
    }

    const marker = { owner: 'peer', prefix: 'store2/g-0000000000000001-', startedAt: 1, label: 'bulk' as const }

    test('one presence holder and no exclusive operation: gone', async () => {
        expect(await web({ held: [presence()], pending: [] }).probe?.(marker)).toBe('gone')
    })

    test('two presence holders: alive', async () => {
        expect(await web({ held: [presence(), presence()], pending: [] }).probe?.(marker)).toBe('alive')
    })

    test('an exclusive holder: alive', async () => {
        expect(await web({ held: [presence('exclusive')], pending: [] }).probe?.(marker)).toBe('alive')
    })

    test('a pending exclusive request: alive', async () => {
        expect(await web({ held: [presence()], pending: [presence('exclusive')] }).probe?.(marker)).toBe('alive')
    })

    test('no presence holder although this tab believes it holds one: unknown', async () => {
        expect(await web({ held: [], pending: [] }).probe?.(marker)).toBe('unknown')
    })

    test('a throwing query: unknown', async () => {
        expect(await web(new Error('query failed')).probe?.(marker)).toBe('unknown')
    })

    test('this tab does not hold its own presence: unknown, and the query is not called', async () => {
        const { probe, query } = web({ held: [presence()], pending: [] }, false)
        expect(await probe?.(marker)).toBe('unknown')
        expect(query).not.toHaveBeenCalled()
    })

    test('this tab does not hold its own presence and two holders show: still unknown', async () => {
        expect(await web({ held: [presence(), presence()], pending: [] }, false).probe?.(marker)).toBe('unknown')
    })

    test('the web without a lock query gets a probe that answers unknown', async () => {
        const probe = markerOwnerProbeFor('indexeddb', { query: undefined, holdsOwnPresence: () => true })
        expect(probe).not.toBeNull()
        expect(await probe?.(marker)).toBe('unknown')
    })

    test('node answers unknown and never reads the locks', async () => {
        const query = vi.fn(async (): Promise<Snapshot> => ({ held: [presence()], pending: [] }))
        const holdsOwnPresence = vi.fn(() => true)
        const probe = markerOwnerProbeFor('node', { query, holdsOwnPresence })
        expect(await probe?.(marker)).toBe('unknown')
        expect(query).not.toHaveBeenCalled()
        expect(holdsOwnPresence).not.toHaveBeenCalled()
    })

    test.each(['tauri', 'opfs-transitional'] as const)('%s gets no probe', (kind) => {
        expect(markerOwnerProbeFor(kind, { query: undefined, holdsOwnPresence: () => true })).toBeNull()
    })
})

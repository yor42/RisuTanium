// @vitest-environment node
/**
 * The deleting pass of the asset sweep on a Node page (`store2/sweep/run.ts`) against the real `server/node/server.cjs`
 * (a child process) behind `createNodeHttpStore`: the third-sighting age rule over the revisions the server lists, the
 * two clock samples, the sole-tab answers, the bound record write under `store2-sweep` and the per-batch freshness
 * check of the commit key and the fence by revision.
 *
 * Producers: the assets are written through the page's store, the age record through the product's encoder, the commit
 * key by the production committer (a second committer for a peer's commit and marker). Stand-ins: the page's live facts
 * (resident names, written names, other tabs, stop conditions) are functions of the test, and the clock is the real
 * `buildNodeGcAge` sampler except where a test names a scripted one (the real server's clock cannot be advanced by a
 * day inside a test). Nothing here says anything about a browser, the Web Locks of several origins or another server
 * version.
 *
 * Labels: S2-T1, T1b, T2, T3, T3b, T4, T4b, T5, T5b, T6a-d and T12 are guards of the rules they name (each names the
 * scratch mutant that turns it red in the hand-back); the pass did not run on Node before, so none has a pre-fix
 * failure of its own, and RR2 (`maintenanceRunner.test.ts`) is the live-path reproducer.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { holdAssetDeletion, resetAssetDeleteHoldForTests } from 'src/ts/storage/assetDeleteHold'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { StoreOutcomeUnknownError } from 'src/ts/storage/store/errors'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { createNodeBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import type { CompareToken } from 'src/ts/storage/store2/backend/types'
import type { Committer } from 'src/ts/storage/store2/commit'
import { encodeUnit, FENCE_KEY, SWEEP_KEY, UNIT_TYPE, type SweepRecord } from 'src/ts/storage/store2/format'
import { GC_AGE_KEY, buildNodeGcAge, readUnitAgeRecord } from 'src/ts/storage/store2/gc/unitAge'
import { Store2Session } from 'src/ts/storage/store2/session'
import { SWEEP_MIN_AGE_MS, runAssetSweep, type AssetSweepEnv, type AssetSweepResult } from 'src/ts/storage/store2/sweep'
import { SEEN_BEFORE } from 'src/ts/storage/store2/sweep/ageRecord'
import { startNodeServer, type NodeServerFixture } from '../nodeServerFixture'
import { committerOf, createClock, seedStore, testEnv, treeRequest } from './commitFixtures'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 })

const DAY = SWEEP_MIN_AGE_MS
const HOUR = 60 * 60 * 1000

const servers: NodeServerFixture[] = []
const clock = createClock()
const keyEnv = testEnv(clock, 3)

interface World {
    fixture: NodeServerFixture
    store: ByteStore
    backend: Store2Backend
    session: Store2Session
    /** Another page's committer over the same server. */
    peer: Committer
}

async function openWorld(): Promise<World> {
    const fixture = await startNodeServer()
    servers.push(fixture)
    const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
    const backend = createNodeBackend(store)
    await seedStore(backend, keyEnv)
    const session = await Store2Session.open(store, { kind: 'node', backend, upstreamMainFile: async () => false })
    expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
    return { fixture, store, backend, session, peer: committerOf(backend, clock, 99) }
}

beforeEach(() => {
    resetAssetDeleteHoldForTests()
})

afterEach(async () => {
    vi.restoreAllMocks()
    resetAssetDeleteHoldForTests()
    await Promise.all(servers.splice(0).map(server => server.stop()))
})

/** What the server lists under `assets/`, by name. */
async function revisionsOf(world: World): Promise<Map<string, number>> {
    const rows = await world.store.listRevisions?.('assets/') ?? []
    return new Map(rows.map(row => [row.key.slice('assets/'.length), row.rev ?? -1]))
}

async function plantAssets(world: World, names: readonly string[]): Promise<Map<string, number>> {
    for (const name of names) {
        await world.store.write(`assets/${name}`, new Uint8Array([7, name.length]), 'unconditional')
    }
    return revisionsOf(world)
}

const present = (world: World, name: string): Promise<boolean> => world.store.has(`assets/${name}`)

async function plantRecord(world: World, at: number, items: SweepRecord['items']): Promise<void> {
    await world.store.write(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at, items }), 'unconditional')
}

async function recordOf(world: World): Promise<{ at: number, items: SweepRecord['items'] } | null> {
    const read = await readUnitAgeRecord(world.store, SWEEP_KEY)
    return read.status === 'ok' ? { at: read.value.at, items: read.value.items } : null
}

/** The sweep's own record bytes and version, for "nothing was written" checks. */
async function recordBytes(world: World): Promise<{ bytes: number[] | null, version: number | null }> {
    const read = await world.store.read(SWEEP_KEY)
    return { bytes: read.bytes === null ? null : [...read.bytes], version: read.version }
}

function envOf(world: World, over: Partial<AssetSweepEnv> = {}): AssetSweepEnv {
    return {
        session: world.session,
        store: world.store,
        residentRefs: () => [],
        writtenCount: () => 0,
        writtenThisPage: () => [],
        peers: async () => 'alone',
        shouldStop: () => false,
        release: () => { },
        hold: remove => holdAssetDeletion(remove),
        sampleClock: buildNodeGcAge(world.store)?.sampleClock,
        ...over,
    }
}

function done(result: AssetSweepResult) {
    if (result.status !== 'done') {
        throw new Error(`The pass ended ${JSON.stringify(result)}.`)
    }
    return result
}

/** A clock a test moves; both samples read it. */
function simClock(start = Date.now()) {
    const sim = { now: start, sample: async () => ({ early: sim.now, late: sim.now }) }
    return sim
}

/** Counts every deletion the pass hands to the hold: one per removal request. */
function countingHold(before: (call: number) => Promise<void> = async () => { }) {
    const counter = {
        calls: 0,
        hold: async (remove: () => Promise<void>): Promise<void> => {
            counter.calls++
            await before(counter.calls)
            await holdAssetDeletion(remove)
        },
    }
    return counter
}

/** A sampler that runs `onCall` on its `call`th use and otherwise answers the real clock. */
function samplerWith(world: World, onCall: (call: number) => Promise<void>): () => Promise<{ early: number, late: number }> {
    let calls = 0
    const real = buildNodeGcAge(world.store)?.sampleClock
    return async () => {
        calls++
        await onCall(calls)
        if (real === undefined) {
            throw new Error('The store has no server clock.')
        }
        return real()
    }
}

/** A record naming `names` at their listed revisions, marked, dated 25 hours ago by the real clock. */
async function plantMarked(world: World, names: readonly string[], revs: ReadonlyMap<string, number>): Promise<void> {
    await plantRecord(world, Date.now() - DAY - HOUR, names.map((name): SweepRecord['items'][number] => [name, revs.get(name) ?? -1, SEEN_BEFORE]))
}

describe('the third sighting over the revisions the server lists', () => {
    test('S2-T6a: three passes a day apart: the first records, the second marks, the third deletes at the recorded revision, and no pass throws', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan-a.png'])
        const rev = revs.get('orphan-a.png')
        const sim = simClock()
        const run = async () => done(await runAssetSweep(envOf(world, { sampleClock: sim.sample })))

        expect(await run()).toMatchObject({ phase: 'recorded', candidates: 1, deleted: 0, recorded: true })
        expect((await recordOf(world))?.items).toEqual([['orphan-a.png', rev]])

        sim.now += DAY + 1000
        expect(await run()).toMatchObject({ phase: 'swept', deleted: 0, recorded: true })
        expect((await recordOf(world))?.items).toEqual([['orphan-a.png', rev, SEEN_BEFORE]])
        expect(await present(world, 'orphan-a.png')).toBe(true)

        sim.now += DAY + 1000
        expect(await run()).toMatchObject({ phase: 'swept', deleted: 1, failed: 0, recorded: true })
        expect(await present(world, 'orphan-a.png')).toBe(false)
        expect((await recordOf(world))?.items).toEqual([])
    })

    test('S2-T1: an asset whose revision moved after the record is not deleted and is recorded unmarked at its new revision', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['moved.png', 'still.png'])
        await plantMarked(world, ['moved.png', 'still.png'], revs)
        expect((await world.store.touch?.('assets/moved.png'))?.kept).toBe(true)
        const moved = (await revisionsOf(world)).get('moved.png')
        expect(moved).toBeGreaterThan(revs.get('moved.png') ?? Infinity)

        const result = done(await runAssetSweep(envOf(world)))

        expect(result).toMatchObject({ phase: 'swept', deleted: 1, failed: 0 })
        expect(await present(world, 'moved.png')).toBe(true)
        expect(await present(world, 'still.png')).toBe(false)
        expect((await recordOf(world))?.items).toEqual([['moved.png', moved]])
    })

    test('S2-T1b: a touch that lands after the decision and before the removal request conflicts the removal on the asset: it is kept and counted kept-live', async () => {
        const world = await openWorld()
        const second = createNodeHttpStore({ baseUrl: world.fixture.baseUrl, authHeader: () => world.fixture.authHeader() })
        const revs = await plantAssets(world, ['raced.png'])
        await plantMarked(world, ['raced.png'], revs)
        const counted = countingHold(async () => { await second.touch?.('assets/raced.png') })

        const result = done(await runAssetSweep(envOf(world, { hold: counted.hold })))

        expect(counted.calls).toBe(1)
        expect(result).toMatchObject({ deleted: 0, failed: 0, keptLive: 1 })
        expect(await present(world, 'raced.png')).toBe(true)
        expect((await revisionsOf(world)).get('raced.png')).toBeGreaterThan(revs.get('raced.png') ?? Infinity)
    })
})

describe('a commit landing under the pass (the removal carries the commit key and the fence)', () => {
    test('S2-T2: a commit between the freshness check and the removal request conflicts the removal on the commit key, the next round rebuilds and deletes under the new gate', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan.png'])
        await plantMarked(world, ['orphan.png'], revs)
        const counted = countingHold(async (call) => {
            if (call === 1) {
                expect((await world.peer.commit(await world.peer.readCommit(), treeRequest(0))).status).toBe('committed')
            }
        })

        const result = done(await runAssetSweep(envOf(world, { hold: counted.hold })))

        expect(counted.calls, 'the first removal conflicted on the commit key, and the second round sent it again').toBe(2)
        expect(result).toMatchObject({ deleted: 1, failed: 0, batches: 2 })
        expect(await present(world, 'orphan.png')).toBe(false)
    })

    test('S2-T2: a marker opened by another committer before the removal request keeps the asset: the removal conflicts and the next round refuses staging', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan.png'])
        await plantMarked(world, ['orphan.png'], revs)
        const counted = countingHold(async (call) => {
            if (call === 1) {
                expect((await world.peer.openHeldBulk?.(await world.peer.readCommit(), { label: 'bulk' }))?.status).toBe('opened')
            }
        })

        const result = await runAssetSweep(envOf(world, { hold: counted.hold }))

        expect(result).toEqual({ status: 'refused', reason: 'staging' })
        expect(counted.calls).toBe(1)
        expect(await present(world, 'orphan.png')).toBe(true)
    })
})

describe('the two clock samples', () => {
    test('S2-T3: the age is judged by the second sample (a record that was old at the first is young at the second) and the record is dated with the later clock of the second', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan.png'])
        const t = Date.now()
        const at = t - DAY - 1000
        await plantRecord(world, at, [['orphan.png', revs.get('orphan.png') ?? -1, SEEN_BEFORE]])
        const before = await recordBytes(world)
        let calls = 0
        const sample = async () => (++calls === 1 ? { early: t, late: t } : { early: at + DAY - 1, late: t })

        const young = done(await runAssetSweep(envOf(world, { sampleClock: sample })))

        expect(calls).toBe(2)
        expect(young).toMatchObject({ phase: 'young', deleted: 0, recorded: false })
        expect(await present(world, 'orphan.png')).toBe(true)
        expect(await recordBytes(world)).toEqual(before)

        await plantRecord(world, at, [['orphan.png', revs.get('orphan.png') ?? -1]])
        calls = 0
        const dated = done(await runAssetSweep(envOf(world, {
            sampleClock: async () => (++calls === 1 ? { early: t, late: t } : { early: t + 10, late: t + 5000 }),
        })))

        expect(dated).toMatchObject({ phase: 'swept', recorded: true })
        expect((await recordOf(world))?.at).toBe(t + 5000)
    })

    test('S2-T3b: a second sample that rejects ends no-server-time with nothing deleted and nothing written', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan.png'])
        await plantMarked(world, ['orphan.png'], revs)
        const before = await recordBytes(world)
        const counted = countingHold()
        const real = buildNodeGcAge(world.store)?.sampleClock
        let calls = 0
        const sample = async () => {
            if (++calls === 2) {
                throw new Error('the server clock is gone')
            }
            if (real === undefined) {
                throw new Error('no clock')
            }
            return real()
        }

        const result = await runAssetSweep(envOf(world, { sampleClock: sample, hold: counted.hold }))

        expect(result).toEqual({ status: 'refused', reason: 'no-server-time' })
        expect(calls).toBe(2)
        expect(counted.calls).toBe(0)
        expect(await present(world, 'orphan.png')).toBe(true)
        expect(await recordBytes(world)).toEqual(before)
    })

    test.each([['no sampler', undefined], ['a first sample that rejects', async () => { throw new Error('the server clock is gone') }]] as const)(
        'S2-T3b: %s ends no-server-time before the gate, the listing or any read of the store', async (_label, sampleClock) => {
            const world = await openWorld()
            await plantAssets(world, ['orphan.png'])
            const read = vi.spyOn(world.store, 'read')
            const listing = vi.spyOn(world.store, 'listRevisions')
            const gate = vi.spyOn(world.session, 'openGate')

            const result = await runAssetSweep(envOf(world, { sampleClock }))

            expect(result).toEqual({ status: 'refused', reason: 'no-server-time' })
            expect(read).not.toHaveBeenCalled()
            expect(listing).not.toHaveBeenCalled()
            expect(gate).not.toHaveBeenCalled()
        })
})

describe('the sole-tab answers', () => {
    test.each([['unsupported', 'no-web-locks'], ['others', 'other-tab']] as const)(
        'S2-T4: peers %s refuses %s before any read of the store', async (answer, reason) => {
            const world = await openWorld()
            await plantAssets(world, ['orphan.png'])
            const read = vi.spyOn(world.store, 'read')
            const listing = vi.spyOn(world.store, 'listRevisions')
            const gate = vi.spyOn(world.session, 'openGate')

            const result = await runAssetSweep(envOf(world, { peers: async () => answer }))

            expect(result).toEqual({ status: 'refused', reason })
            expect(read).not.toHaveBeenCalled()
            expect(listing).not.toHaveBeenCalled()
            expect(gate).not.toHaveBeenCalled()
            expect(await recordBytes(world)).toEqual({ bytes: null, version: expect.anything() })
        })

    test('S2-T4b: peers asked before every delete: alone at the round start and for the first delete, then another tab: one asset is deleted, the pass stops other-tab and the second is kept', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['first.png', 'second.png'])
        await plantMarked(world, ['first.png', 'second.png'], revs)
        let asked = 0

        const result = done(await runAssetSweep(envOf(world, { peers: async () => (++asked <= 2 ? 'alone' : 'others') })))

        expect(result).toMatchObject({ deleted: 1, stopped: 'other-tab', recorded: false })
        expect(await present(world, 'first.png')).toBe(false)
        expect(await present(world, 'second.png')).toBe(true)
    })
})

describe('the bound record write', () => {
    test('S2-T5: a foreign write of the record after it was read conflicts the write: nothing is retried, the foreign record stands and recorded is false', async () => {
        const world = await openWorld()
        await plantAssets(world, ['orphan.png'])
        const guarded = world.store.guarded
        if (guarded === undefined) {
            throw new Error('The store has no guarded routes.')
        }
        const writing = vi.spyOn(guarded, 'writeChecked')
        const foreign = encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - 1000, items: [['foreign.png', 3]] })

        const result = done(await runAssetSweep(envOf(world, {
            sampleClock: samplerWith(world, async (call) => {
                if (call === 2) {
                    await world.store.write(SWEEP_KEY, foreign, 'unconditional')
                }
            }),
        })))

        expect(result).toMatchObject({ phase: 'recorded', recorded: false, stopped: 'record-conflict' })
        expect(writing).toHaveBeenCalledTimes(1)
        expect((await recordOf(world))?.items).toEqual([['foreign.png', 3]])
    })

    test('S2-T5: a commit between the freshness check and the record write conflicts the write on the commit key: no record is stored', async () => {
        const world = await openWorld()
        await plantAssets(world, ['orphan.png'])
        let asked = 0

        const result = done(await runAssetSweep(envOf(world, {
            peers: async () => {
                // The first answer opens the round; the second is the one directly before the record write.
                if (++asked === 2) {
                    expect((await world.peer.commit(await world.peer.readCommit(), treeRequest(0))).status).toBe('committed')
                }
                return 'alone'
            },
        })))

        expect(result).toMatchObject({ phase: 'recorded', recorded: false, stopped: 'record-conflict' })
        expect((await recordBytes(world)).bytes).toBeNull()
    })

    test('S2-T5: an outcome that is not known ends record-unknown, is sent once and stores nothing from this pass', async () => {
        const world = await openWorld()
        await plantAssets(world, ['orphan.png'])
        const guarded = world.store.guarded
        if (guarded === undefined) {
            throw new Error('The store has no guarded routes.')
        }
        const writing = vi.spyOn(guarded, 'writeChecked').mockRejectedValue(new StoreOutcomeUnknownError('write', new Error('connection lost')))

        const result = done(await runAssetSweep(envOf(world)))

        expect(result).toMatchObject({ recorded: false, stopped: 'record-unknown' })
        expect(writing).toHaveBeenCalledTimes(1)
        expect((await recordBytes(world)).bytes).toBeNull()
    })

    test('S2-T5b: the record lands under store2-sweep, and the unit pass\'s store2-gc-age is neither read into the decision nor written', async () => {
        const world = await openWorld()
        await plantAssets(world, ['orphan.png'])
        const gcBefore = await world.store.read(GC_AGE_KEY)

        const result = done(await runAssetSweep(envOf(world)))

        expect(result).toMatchObject({ phase: 'recorded', recorded: true })
        expect((await recordOf(world))?.items).toHaveLength(1)
        const gcAfter = await world.store.read(GC_AGE_KEY)
        expect(gcAfter.bytes).toBeNull()
        expect(gcAfter.version).toBe(gcBefore.version)

        // A record planted under the unit pass's key says nothing to the sweep.
        await world.store.write(GC_AGE_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - DAY - HOUR, items: [['orphan.png', 1, SEEN_BEFORE]] }), 'unconditional')
        await world.store.write(SWEEP_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - 5 * HOUR, items: [] }), 'unconditional')
        expect(done(await runAssetSweep(envOf(world)))).toMatchObject({ phase: 'young', deleted: 0 })
        expect(await present(world, 'orphan.png')).toBe(true)
    })
})

describe('the freshness check of the commit key and the fence', () => {
    test('S2-T6b: a fence written between the gate and the batch ends the pass fence-conflict with no removal request', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan.png'])
        await plantMarked(world, ['orphan.png'], revs)
        const counted = countingHold()

        const result = done(await runAssetSweep(envOf(world, {
            hold: counted.hold,
            sampleClock: samplerWith(world, async (call) => {
                if (call === 2) {
                    await world.store.write(FENCE_KEY, new Uint8Array([1]), 'unconditional')
                }
            }),
        })))

        expect(result).toMatchObject({ deleted: 0, stopped: 'fence-conflict', recorded: false })
        expect(counted.calls).toBe(0)
        expect(await present(world, 'orphan.png')).toBe(true)
    })

    test('S2-T6c: a commit between the gate and the batch makes the round rebuild before any removal request, and the next round deletes once', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan.png'])
        await plantMarked(world, ['orphan.png'], revs)
        const counted = countingHold()
        let committed = false

        const result = done(await runAssetSweep(envOf(world, {
            hold: counted.hold,
            sampleClock: samplerWith(world, async (call) => {
                if (call === 2 && !committed) {
                    committed = true
                    expect((await world.peer.commit(await world.peer.readCommit(), treeRequest(0))).status).toBe('committed')
                }
            }),
        })))

        expect(counted.calls, 'the stale round sent no removal request').toBe(1)
        expect(result).toMatchObject({ deleted: 1, batches: 1, failed: 0 })
        expect(await present(world, 'orphan.png')).toBe(false)
    })

    test('S2-T6d: a token of another kind that carries the gate\'s revision is not the gate\'s token: the fence ends the pass fence-conflict and the commit key rebuilds, and nothing throws', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan.png'])
        await plantMarked(world, ['orphan.png'], revs)
        const gateFence = (await world.backend.readFence()).token
        const gateCommit = (await world.backend.readCommit()).token
        if (gateFence.kind !== 'revision' || gateCommit.kind !== 'revision') {
            throw new Error('The Node backend reads revision tokens.')
        }
        // Built through variables: the token carries `revision` and `present` on a `bytes` kind.
        const wrongFence = { kind: 'bytes' as const, bytes: null, revision: gateFence.revision, present: gateFence.present }
        const wrongCommit = { kind: 'bytes' as const, bytes: null, revision: gateCommit.revision, present: gateCommit.present }
        let armed = false
        const counted = countingHold()
        const mislabelled = (mode: 'fence' | 'commit'): Store2Backend => Object.create(world.backend, {
            readFence: { value: async () => armed && mode === 'fence' ? { bytes: null, token: wrongFence as CompareToken } : world.backend.readFence() },
            readCommit: { value: async () => armed && mode === 'commit' ? { bytes: null, token: wrongCommit as CompareToken } : world.backend.readCommit() },
        })
        const sessionOver = (backend: Store2Backend) => ({
            kind: 'node' as const,
            backend,
            get idleReason() { return null },
            openGate: (deleter: Parameters<Store2Session['openGate']>[0]) => world.session.openGate(deleter),
        })
        // The tokens turn wrong with the second sample, which is taken after the gate.
        const arm = () => samplerWith(world, async (call) => { if (call === 2) { armed = true } })

        const fenced = done(await runAssetSweep(envOf(world, { session: sessionOver(mislabelled('fence')), hold: counted.hold, sampleClock: arm() })))
        expect(fenced).toMatchObject({ deleted: 0, stopped: 'fence-conflict' })

        armed = false
        const rebuilt = done(await runAssetSweep(envOf(world, { session: sessionOver(mislabelled('commit')), hold: counted.hold, sampleClock: arm() })))
        expect(rebuilt).toMatchObject({ deleted: 0, stopped: 'commit-conflict' })
        expect(counted.calls, 'no removal request was sent under either mislabelled token').toBe(0)
        expect(await present(world, 'orphan.png')).toBe(true)
    })
})

describe('a young record', () => {
    test('S2-T12: a record younger than the minimum age ends the pass with no commit key, fence, manifest or listing read, and writes nothing', async () => {
        const world = await openWorld()
        const revs = await plantAssets(world, ['orphan.png'])
        await plantRecord(world, Date.now() - HOUR, [['orphan.png', revs.get('orphan.png') ?? -1, SEEN_BEFORE]])
        const before = await recordBytes(world)
        const reads = {
            commit: vi.spyOn(world.backend, 'readCommit'),
            fence: vi.spyOn(world.backend, 'readFence'),
            units: vi.spyOn(world.backend, 'readUnits'),
            listing: vi.spyOn(world.store, 'listRevisions'),
            gate: vi.spyOn(world.session, 'openGate'),
        }

        const result = done(await runAssetSweep(envOf(world)))

        expect(result).toMatchObject({ phase: 'young', candidates: 0, deleted: 0, batches: 0, recorded: false })
        for (const spy of Object.values(reads)) {
            expect(spy).not.toHaveBeenCalled()
        }
        expect(await recordBytes(world)).toEqual(before)
        expect(await present(world, 'orphan.png')).toBe(true)
    })
})

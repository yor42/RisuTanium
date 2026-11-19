// @vitest-environment node
/**
 * The aged GC pass on a Node server (`gc/pass.ts` with `age`): a unit is retired only on its third sighting, each at least
 * the minimum age after the previous record in the earlier of two clocks; the record is bound to the commit key and the
 * fence; a standing marker, another tab, a stale base, a missing server clock or a record that cannot be read refuse; and a
 * round that stops early writes no record.
 *
 * Stand-ins: the real Node server process, real commits and a real record under its literal key. The clocks are injected
 * through `GcAgeDeps.sampleClock`, so an age is a number, not a wait. A pass is no evidence about a real browser's tabs.
 * Every case is a guard of the rule it pins (its mutants are in the hand-back); the maintenance-runner case RR1 is the
 * regression reproducer, and `unitAgeRecord.test.ts` pins the record itself.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore, GuardedOperations } from 'src/ts/storage/store/contract'
import { StoreOutcomeUnknownError } from 'src/ts/storage/store/errors'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { createNodeBackend, Store2BackendFailureError, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, newStagedKey, newStagingId, newUnitKey, stagingPrefix, UNIT_TYPE, type SweepRecord,
} from 'src/ts/storage/store2/format'
import { formatGcResult } from 'src/ts/storage/store2/gc/autoGc'
import { gcPass, type GcDeps, type GcPeerAnswer, type GcResult } from 'src/ts/storage/store2/gc/pass'
import { buildNodeGcAge, GC_AGE_KEY, readUnitAgeRecord, type GcAgeDeps } from 'src/ts/storage/store2/gc/unitAge'
import { SWEEP_MIN_AGE_MS } from 'src/ts/storage/store2/sweep/params'
import { startNodeServer, type NodeServerFixture } from '../nodeServerFixture'
import { committerOf, createClock, expectInvariant, hooked, plantKey, seedStore, START_TIME, testEnv, treeRequest } from './commitFixtures'
import { plantFence } from './fenceFixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const DAY = SWEEP_MIN_AGE_MS
const T0 = 1_900_000_000_000

const servers: NodeServerFixture[] = []

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.stop()))
})

const clock = createClock()
const env = testEnv(clock, 4711)
let peerSeed = 8800

interface Rig {
    store: ByteStore
    guarded: GuardedOperations
    backend: Store2Backend
    base: string
    /** The injected sample of both clocks; a test moves it to move time. */
    time: { early: number, late: number }
}

async function openRig(): Promise<Rig> {
    const fixture = await startNodeServer()
    servers.push(fixture)
    const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
    const { guarded } = store
    if (guarded === undefined) {
        throw new Error('The Node store offers no guarded operations.')
    }
    const backend = createNodeBackend(store)
    const base = await seedStore(backend, env)
    return { store, guarded, backend, base, time: { early: T0, late: T0 } }
}

function agedOver(rig: Rig, store: ByteStore = rig.store): GcAgeDeps {
    const age = buildNodeGcAge(store)
    if (age === null) {
        throw new Error('The store has no aged dependencies.')
    }
    return { ...age, sampleClock: async () => ({ ...rig.time }) }
}

function depsOf(rig: Rig, backend: Store2Backend, extra: Partial<GcDeps> = {}): GcDeps {
    return {
        backend,
        kind: 'node',
        idleReason: () => null,
        probe: () => rig.guarded.probe(),
        age: agedOver(rig),
        ...extra,
    }
}

async function orphan(backend: Store2Backend): Promise<string> {
    const key = newUnitKey(env)
    await backend.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
    return key
}

async function orphans(backend: Store2Backend, count: number): Promise<string[]> {
    const keys: string[] = []
    for (let i = 0; i < count; i++) {
        keys.push(await orphan(backend))
    }
    return keys
}

async function exists(backend: Store2Backend, key: string): Promise<boolean> {
    return (await backend.readUnits([key])).get(key) !== null
}

async function leftOf(backend: Store2Backend, keys: readonly string[]): Promise<number> {
    const read = await backend.readUnits([...keys])
    return keys.filter(key => read.get(key) !== null).length
}

function plantRecord(rig: Rig, record: SweepRecord): Promise<unknown> {
    return rig.store.write(GC_AGE_KEY, encodeUnit(UNIT_TYPE.sweepRecord, record), 'unconditional')
}

/** The record planted as an earlier pass would have written it: `names` seen once, or `marked` seen before. */
function recordOf(at: number, names: readonly string[], marked: readonly string[] = []): SweepRecord {
    return {
        v: 1,
        at,
        items: [...marked.map((name): SweepRecord['items'][number] => [name, null, 1]), ...names.map((name): SweepRecord['items'][number] => [name, null])],
    }
}

async function storedRecord(rig: Rig): Promise<SweepRecord> {
    const read = await readUnitAgeRecord(rig.store)
    if (read.status !== 'ok') {
        throw new Error(`The record reads ${read.status}.`)
    }
    return read.value
}

async function recordBytes(rig: Rig): Promise<number[]> {
    return [...(await rig.store.read(GC_AGE_KEY)).bytes ?? []]
}

function done(result: GcResult): Extract<GcResult, { status: 'done' }> {
    if (result.status !== 'done') {
        throw new Error(`The pass was refused: ${result.reason}.`)
    }
    return result
}

/** A standing marker of another owner over the current manifest, as a bulk writer leaves it. */
async function plantMarker(backend: Store2Backend): Promise<string> {
    const parsed = classifyCommitRead(await backend.readCommit())
    if (parsed.status !== 'parsed') {
        throw new Error('The commit key does not parse.')
    }
    const stagingId = newStagingId(env)
    const marker = { owner: 'b'.repeat(26), prefix: stagingPrefix(stagingId), startedAt: START_TIME, label: 'bulk' } as const
    await plantKey(backend, firstCommitKey({ current: parsed.value.current, staging: marker }, env))
    const staged = newStagedKey(stagingId, 'u', env)
    await backend.putUnit(staged, encodeUnit(UNIT_TYPE.preset, { v: 1 }))
    return staged
}

async function landCommit(backend: Store2Backend): Promise<void> {
    const result = await committerOf(backend, clock, peerSeed++).commit(await backend.readCommit(), treeRequest(0, {}))
    expect(result.status).toBe('committed')
}

describe('the three sightings', () => {
    test('T1, T3: a unit is recorded, then marked a day later, then retired a day after that; a unit that appeared later waits its own turns', async () => {
        const rig = await openRig()
        const first = await orphans(rig.backend, 3)

        const one = done(await gcPass(depsOf(rig, rig.backend)))
        expect(one).toMatchObject({ deleted: 0, age: { phase: 'recorded', candidates: 3, recordedItems: 3, record: 'written', clockGapMs: 0 } })
        expect(await storedRecord(rig)).toEqual(recordOf(T0, [...first].sort()))

        rig.time = { early: T0 + DAY, late: T0 + DAY }
        const later = await orphan(rig.backend)
        const two = done(await gcPass(depsOf(rig, rig.backend)))
        expect(two).toMatchObject({ deleted: 0, age: { phase: 'swept', candidates: 4, recordedItems: 4, record: 'written' } })
        const marked = await storedRecord(rig)
        expect(marked.at).toBe(T0 + DAY)
        expect(marked.items.filter(item => item[2] === 1).map(item => item[0]).sort()).toEqual([...first].sort())
        expect(marked.items.find(item => item[0] === later)).toEqual([later, null])
        expect(await leftOf(rig.backend, [...first, later])).toBe(4)

        rig.time = { early: T0 + 2 * DAY, late: T0 + 2 * DAY }
        const three = done(await gcPass(depsOf(rig, rig.backend)))
        expect(three).toMatchObject({ deleted: 3, batches: 1, age: { phase: 'swept', record: 'written' } })
        expect(await leftOf(rig.backend, first)).toBe(0)
        expect(await exists(rig.backend, later), 'the later unit has been seen twice only').toBe(true)
        expect(await storedRecord(rig)).toEqual(recordOf(T0 + 2 * DAY, [], [later]))
        await expectInvariant(rig.backend)
    })

    test('T3: only the number 1 marks a sighting: other third elements are re-recorded as marked and deleted nothing', async () => {
        const rig = await openRig()
        const [a, b, c] = await orphans(rig.backend, 3)
        await plantRecord(rig, { v: 1, at: T0 - 2 * DAY, items: [[a, null, 'x'], [b, null, true], [c, null, 2]] })

        const result = done(await gcPass(depsOf(rig, rig.backend)))

        expect(result.deleted).toBe(0)
        expect(await leftOf(rig.backend, [a, b, c])).toBe(3)
        expect((await storedRecord(rig)).items.map(item => item[2])).toEqual([1, 1, 1])
    })

    test('AS5: a marked item that the mark names is kept and dropped from the record', async () => {
        const rig = await openRig()
        const live = (await rig.backend.listStore2()).filter(key => key !== rig.base)
        const junk = await orphan(rig.backend)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], [...live, junk]))

        const result = done(await gcPass(depsOf(rig, rig.backend)))

        expect(result.deleted).toBe(1)
        expect(await leftOf(rig.backend, live)).toBe(live.length)
        expect(await exists(rig.backend, junk)).toBe(false)
        expect(await storedRecord(rig)).toEqual(recordOf(T0, []))
        await expectInvariant(rig.backend)
    })

    test('a record ahead of the later clock by more than the skew restarts: nothing is deleted and every item is recorded unmarked', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 + 3 * DAY, [], junk))

        const result = done(await gcPass(depsOf(rig, rig.backend)))

        expect(result).toMatchObject({ deleted: 0, age: { phase: 'recorded', record: 'written' } })
        expect(await storedRecord(rig)).toEqual(recordOf(T0, [...junk].sort()))
    })

    test('T12: a record 12 hours old by the earlier clock is young however far ahead the later clock is: nothing is read or written (MU2, MU4, MU5)', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 - DAY, [], junk))
        const before = await recordBytes(rig)
        rig.time = { early: T0 - DAY / 2, late: T0 + DAY }
        const watched = hooked(rig.backend)

        const result = done(await gcPass(depsOf(rig, watched.backend)))

        expect(result).toMatchObject({ deleted: 0, batches: 0, age: { phase: 'young', record: 'none', clockGapMs: 1.5 * DAY } })
        expect(watched.log).toEqual([])
        expect(await recordBytes(rig)).toEqual(before)
        expect(await leftOf(rig.backend, junk)).toBe(2)
    })

    test('T2: a young record ends the round before any listing, commit read, mark or write (MU19)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        done(await gcPass(depsOf(rig, rig.backend)))
        const before = await recordBytes(rig)
        rig.time = { early: T0 + DAY / 4, late: T0 + DAY / 4 }
        const watched = hooked(rig.backend)

        const result = done(await gcPass(depsOf(rig, watched.backend)))

        expect(result).toMatchObject({ deleted: 0, age: { phase: 'young', record: 'none' } })
        expect(watched.log).toEqual([])
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('a clock that goes back between the two samples ends the round young with nothing deleted or written', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 - 25 * 3_600_000, [], junk))
        const before = await recordBytes(rig)
        const samples = [{ early: T0, late: T0 }, { early: T0 - 2 * 3_600_000, late: T0 - 2 * 3_600_000 }]
        const age: GcAgeDeps = { ...agedOver(rig), sampleClock: async () => samples.shift() ?? { early: 0, late: 0 } }

        const result = done(await gcPass(depsOf(rig, rig.backend, { age })))

        expect(result).toMatchObject({ deleted: 0, batches: 0, age: { phase: 'young', record: 'none' } })
        expect(await leftOf(rig.backend, junk)).toBe(2)
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T13: the deciding sample is taken after the commit read and the mark, and its later clock dates the record (MU6)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 1)
        const events: string[] = []
        const samples = [{ early: T0, late: T0 }, { early: T0 + 7, late: T0 + 9 }]
        const age: GcAgeDeps = { ...agedOver(rig), sampleClock: async () => { events.push('clock'); return samples.shift() ?? { early: 0, late: 0 } } }
        const watched = hooked(rig.backend, { before: name => { events.push(name) } })

        done(await gcPass(depsOf(rig, watched.backend, { age })))

        expect(events.indexOf('clock')).toBeLessThan(events.indexOf('listStore2'))
        expect(events.lastIndexOf('clock')).toBeGreaterThan(events.indexOf('readCommit'))
        expect(events.lastIndexOf('clock')).toBeGreaterThan(events.lastIndexOf('readUnits'))
        expect((await storedRecord(rig)).at).toBe(T0 + 9)
    })
})

describe('refusals', () => {
    test('T4: a standing marker refuses staging before the mark: no unit read, no deletion, the record unchanged (MU7, MU7b)', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const staged = await plantMarker(rig.backend)
        const before = await recordBytes(rig)
        const watched = hooked(rig.backend)

        const result = await gcPass(depsOf(rig, watched.backend))

        expect(result).toMatchObject({ status: 'refused', reason: 'staging' })
        expect(watched.log).not.toContain('readUnits')
        expect(watched.log).not.toContain('removeBatch')
        expect(await leftOf(rig.backend, junk)).toBe(2)
        expect(await exists(rig.backend, staged)).toBe(true)
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T5a: a marker set after the commit read and before any batch is applied refuses staging in the rebuild round (MU7)', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 3)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const before = await recordBytes(rig)
        let staged = ''
        const watched = hooked(rig.backend, { after: async (name, count) => {
            if (name === 'readCommit' && count === 1) {
                staged = await plantMarker(rig.backend)
            }
        } })

        const result = await gcPass(depsOf(rig, watched.backend))

        expect(result).toMatchObject({ status: 'refused', reason: 'staging' })
        expect(await leftOf(rig.backend, junk)).toBe(3)
        expect(await exists(rig.backend, staged)).toBe(true)
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T5b: a marker set after the first batch was applied ends the pass done, stopped refused for staging, with no record', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 60)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const before = await recordBytes(rig)
        const watched = hooked(rig.backend, { after: async (name, count) => {
            if (name === 'removeBatch' && count === 1) {
                await plantMarker(rig.backend)
            }
        } })

        const result = done(await gcPass(depsOf(rig, watched.backend)))

        expect(result).toMatchObject({ deleted: 25, batches: 1, stopped: 'refused', refusal: { reason: 'staging' } })
        expect(await leftOf(rig.backend, junk)).toBe(35)
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T6: an own base that is not the commit key\'s current refuses stale-base before any unit read or write (MU8)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        const watched = hooked(rig.backend)

        const result = await gcPass(depsOf(rig, watched.backend, { peers: async () => 'alone', ownBase: () => 'store2/m-not-the-base' }))

        expect(result).toMatchObject({ status: 'refused', reason: 'stale-base' })
        expect(watched.log).not.toContain('readUnits')
        expect((await rig.store.read(GC_AGE_KEY)).bytes).toBeNull()
    })

    test.each<[GcPeerAnswer, string]>([['alone', 'recorded'], ['unsupported', 'recorded']])(
        'T7: peers %s proceeds on Node (MU9)', async (answer, phase) => {
            const rig = await openRig()
            await orphans(rig.backend, 2)

            const result = done(await gcPass(depsOf(rig, rig.backend, { peers: async () => answer, ownBase: () => rig.base })))

            expect(result.age?.phase).toBe(phase)
            expect(result.age?.record).toBe('written')
        })

    test('T7: peers others refuses other-tab before any store2 read and writes no record (MU10)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        const watched = hooked(rig.backend)

        const result = await gcPass(depsOf(rig, watched.backend, { peers: async () => 'others', ownBase: () => rig.base }))

        expect(result).toMatchObject({ status: 'refused', reason: 'other-tab' })
        expect(watched.log).toEqual([])
        expect((await rig.store.read(GC_AGE_KEY)).bytes).toBeNull()
    })

    test('T-peers-pre: the proof is asked again right before the record write: others there stops other-tab and writes no record (MU17)', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const before = await recordBytes(rig)
        let asked = 0
        // Asked: at the round start, before the one batch, and before the record write.
        const peers = async (): Promise<GcPeerAnswer> => (++asked >= 3 ? 'others' : 'alone')

        const result = done(await gcPass(depsOf(rig, rig.backend, { peers, ownBase: () => rig.base })))

        expect(result).toMatchObject({ deleted: 2, batches: 1, stopped: 'other-tab' })
        expect(asked).toBe(3)
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T-stop: a stop that turns true after the last batch writes no record (MU16, MU22)', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const before = await recordBytes(rig)
        let asked = 0
        // Asked: at the round start, before the one batch, and before the record write.
        const shouldStop = (): boolean => ++asked >= 3

        const result = done(await gcPass(depsOf(rig, rig.backend, { shouldStop })))

        expect(result).toMatchObject({ deleted: 2, batches: 1, stopped: 'yielded' })
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T11: a stop before the second batch leaves the record as it was (MU22)', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 60)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const before = await recordBytes(rig)
        const watched = hooked(rig.backend)

        const result = done(await gcPass(depsOf(rig, watched.backend, { shouldStop: () => watched.count('removeBatch') >= 1 })))

        expect(result).toMatchObject({ deleted: 25, batches: 1, stopped: 'yielded' })
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T11b: a fence written before the second batch stops fence-conflict, and a backend failure stops backend-failure: neither writes a record (MU30)', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 60)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const before = await recordBytes(rig)
        const fenced = hooked(rig.backend, { after: async (name, count) => {
            if (name === 'removeBatch' && count === 1) {
                await plantFence(rig.backend, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 1, priorCommits: [], keys: [] }))
            }
        } })

        const fence = done(await gcPass(depsOf(rig, fenced.backend)))
        expect(fence).toMatchObject({ deleted: 25, stopped: 'fence-conflict' })
        expect(await recordBytes(rig)).toEqual(before)

        const failing = hooked(rig.backend, { before: (name, count) => {
            if (name === 'removeBatch' && count === 1) {
                throw new Store2BackendFailureError('Injected removal failure.')
            }
        } })
        await plantFence(rig.backend, null)
        const failed = done(await gcPass(depsOf(rig, failing.backend)))
        expect(failed).toMatchObject({ deleted: 0, stopped: 'backend-failure' })
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T8: a server clock that cannot be had refuses no-server-time before any store2 read, at the first sample and at the deciding one', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const before = await recordBytes(rig)

        const none = hooked(rig.backend)
        const noClock: GcAgeDeps = { ...agedOver(rig), sampleClock: async () => { throw new Error('no clock') } }
        expect(await gcPass(depsOf(rig, none.backend, { age: noClock }))).toMatchObject({ status: 'refused', reason: 'no-server-time' })
        expect(none.log).toEqual([])

        let samples = 0
        const lateFailure: GcAgeDeps = { ...agedOver(rig), sampleClock: async () => {
            if (++samples === 2) {
                throw new Error('no clock')
            }
            return { early: T0, late: T0 }
        } }
        expect(await gcPass(depsOf(rig, rig.backend, { age: lateFailure }))).toMatchObject({ status: 'refused', reason: 'no-server-time' })
        expect(await leftOf(rig.backend, junk)).toBe(2)
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T9: a record from a newer build refuses record-too-new and is left as it is; an unreadable read refuses record-io-failed (MU18)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        await rig.store.write(GC_AGE_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 2, at: 1, items: [] }), 'unconditional')
        const before = await recordBytes(rig)
        const watched = hooked(rig.backend)

        expect(await gcPass(depsOf(rig, watched.backend))).toMatchObject({ status: 'refused', reason: 'record-too-new' })
        expect(watched.log).toEqual([])
        expect(await recordBytes(rig)).toEqual(before)

        const unreadable: GcAgeDeps = { ...agedOver(rig), readRecord: async () => ({ status: 'io-failed' }) }
        expect(await gcPass(depsOf(rig, watched.backend, { age: unreadable }))).toMatchObject({ status: 'refused', reason: 'record-io-failed' })
        expect(watched.log).toEqual([])
    })

    test('AS9: without the capability probe\'s answer the pass refuses capability-missing before any store2 read', async () => {
        const rig = await openRig()
        const watched = hooked(rig.backend)

        const result = await gcPass(depsOf(rig, watched.backend, { probe: async () => ({ checkOnly: false, retire: true, pieces: false }) }))

        expect(result).toMatchObject({ status: 'refused', reason: 'capability-missing' })
        expect(watched.log).toEqual([])
    })
})

describe('the record is bound to the commit key and the fence', () => {
    test('T10: a foreign record write during the pass conflicts on the record, with exactly one attempt and the foreign bytes kept (MU13, MU25)', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 2)
        const foreign = encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: 5, items: [['store2/u-foreign', null]] })
        const watched = hooked(rig.backend, { before: async (name, count) => {
            if (name === 'readUnits' && count === 1) {
                await rig.store.write(GC_AGE_KEY, foreign, 'unconditional')
            }
        } })
        let attempts = 0
        const counting: GuardedOperations = {
            ...rig.guarded,
            writeChecked: (...args) => { attempts++; return rig.guarded.writeChecked(...args) },
        }

        const result = done(await gcPass(depsOf(rig, watched.backend, { age: agedOver(rig, { ...rig.store, guarded: counting }) })))

        expect(result.age).toMatchObject({ phase: 'recorded', record: 'conflict', conflictOn: 'record' })
        expect(attempts).toBe(1)
        expect(await recordBytes(rig)).toEqual([...foreign])
        expect(await leftOf(rig.backend, junk)).toBe(2)
        expect(formatGcResult(result)).toContain('record=conflict conflict=record')
    })

    test('T10b: an unknown outcome of the record write is reported as unknown and never retried (MU29)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        let attempts = 0
        const lossy: GuardedOperations = {
            ...rig.guarded,
            writeChecked: async () => {
                attempts++
                throw new StoreOutcomeUnknownError('write-checked', new Error('reset'))
            },
        }
        const age = agedOver(rig, { ...rig.store, guarded: lossy })

        const result = done(await gcPass(depsOf(rig, rig.backend, { age })))

        expect(result.age).toMatchObject({ phase: 'recorded', record: 'unknown' })
        expect(attempts).toBe(1)
        expect(formatGcResult(result)).toContain('record=unknown')
    })

    test('T-bind1 (a): a commit that lands during the mark of a recorded round conflicts the record write on the commit key (MU14)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        const watched = hooked(rig.backend, { after: async (name, count) => {
            if (name === 'readUnits' && count === 1) {
                await landCommit(rig.backend)
            }
        } })

        const result = done(await gcPass(depsOf(rig, watched.backend)))

        expect(result.age).toMatchObject({ phase: 'recorded', record: 'conflict', conflictOn: 'commit' })
        expect((await rig.store.read(GC_AGE_KEY)).bytes).toBeNull()
    })

    test('T-bind1 (b): in a swept round with nothing to delete, a commit between the commit read and the record write conflicts on the commit key (MU14)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, ['store2/u-nothing-listed']))
        const before = await recordBytes(rig)
        const watched = hooked(rig.backend, { after: async (name, count) => {
            if (name === 'readFence' && count === 1) {
                await landCommit(rig.backend)
            }
        } })

        const result = done(await gcPass(depsOf(rig, watched.backend)))

        expect(result.age).toMatchObject({ phase: 'swept', record: 'conflict', conflictOn: 'commit' })
        expect(await recordBytes(rig)).toEqual(before)
    })

    test('T-bind1 (c): a fence written between the mark and the record write conflicts on the fence', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        const watched = hooked(rig.backend, { after: async (name, count) => {
            if (name === 'readFence' && count === 1) {
                await plantFence(rig.backend, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 1, priorCommits: [], keys: [] }))
            }
        } })

        const result = done(await gcPass(depsOf(rig, watched.backend)))

        expect(result.age).toMatchObject({ record: 'conflict', conflictOn: 'fence' })
        expect((await rig.store.read(GC_AGE_KEY)).bytes).toBeNull()
    })

    test('T-bind2: the same swept round with nothing to delete and no commit writes the record (the positive control of T-bind1)', async () => {
        const rig = await openRig()
        await orphans(rig.backend, 2)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, ['store2/u-nothing-listed']))

        const result = done(await gcPass(depsOf(rig, rig.backend)))

        expect(result.age).toMatchObject({ phase: 'swept', record: 'written' })
        expect((await storedRecord(rig)).at).toBe(T0)
    })

    test('T-order: a unit uploaded after the commit read and never committed is absent from the record (MU15)', async () => {
        const rig = await openRig()
        const listed = await orphans(rig.backend, 2)
        let late = ''
        const watched = hooked(rig.backend, { after: async (name, count) => {
            if (name === 'readCommit' && count === 1) {
                late = await orphan(rig.backend)
            }
        } })

        done(await gcPass(depsOf(rig, watched.backend)))

        const names = (await storedRecord(rig)).items.map(item => item[0])
        expect(names.sort()).toEqual([...listed].sort())
        expect(names).not.toContain(late)
    })

    test('a commit that lands between two batches rebuilds once, the retire resumes under the new commit key and the record is written with its revision', async () => {
        const rig = await openRig()
        const junk = await orphans(rig.backend, 60)
        await plantRecord(rig, recordOf(T0 - 2 * DAY, [], junk))
        const watched = hooked(rig.backend, { after: async (name, count) => {
            if (name === 'removeBatch' && count === 1) {
                await landCommit(rig.backend)
            }
        } })

        const result = done(await gcPass(depsOf(rig, watched.backend)))

        expect(result).toMatchObject({ deleted: 60, age: { phase: 'swept', record: 'written' } })
        expect(await leftOf(rig.backend, junk)).toBe(0)
        expect((await storedRecord(rig)).items).toEqual([])
        await expectInvariant(rig.backend)
    })
})

// @vitest-environment node
/**
 * The unit age record and the aged dependencies of the Node collector (`store2/gc/unitAge.ts`): the record through the
 * page's byte store over a real Node server process, the outcome of a guarded write (written, refused on the record, the
 * commit key or the fence, or unknown, never retried), and the two clocks of a sample.
 *
 * The module does not exist on the base, so a failure at import there proves nothing; every test is a guard that a mutant of
 * the rule it pins turns red. The server is the real process; a stubbed guarded layer stands in only where the server cannot
 * be made to lose a reply.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import type { ByteStore, GuardedOperations } from 'src/ts/storage/store/contract'
import {
    ServerLacksCapabilityError, StoreOutcomeUnknownError, StoreVersionConflictError,
} from 'src/ts/storage/store/errors'
import { createNodeHttpStore, NodeHttpError } from 'src/ts/storage/store/nodeHttpStore'
import { createMemoryBackend, createNodeBackend, revisionTokenOf, type Store2Backend } from 'src/ts/storage/store2/backend'
import { openDeleterGate } from 'src/ts/storage/store2/boot'
import { UNIT_TYPE, encodeUnit, newUnitKey, tailOfKey, type SweepRecord } from 'src/ts/storage/store2/format'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import {
    buildNodeGcAge, GC_AGE_KEY, readUnitAgeRecord, unitKeepOf, writeUnitAgeRecord, type UnitRecordRead,
} from 'src/ts/storage/store2/gc/unitAge'
import { startNodeServer, type NodeServerFixture } from '../nodeServerFixture'
import { committerOf, createClock, seedStore, testEnv, treeRequest } from './commitFixtures'
import { plantFence } from './fenceFixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const servers: NodeServerFixture[] = []

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.stop()))
})

const clock = createClock()
const env = testEnv(clock, 91)

interface Rig {
    store: ByteStore
    guarded: GuardedOperations
    backend: Store2Backend
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
    await seedStore(backend, env)
    return { store, guarded, backend }
}

async function revisionsOf(backend: Store2Backend): Promise<{ commit: number, fence: number }> {
    return {
        commit: revisionTokenOf((await backend.readCommit()).token).revision,
        fence: revisionTokenOf((await backend.readFence()).token).revision,
    }
}

const RECORD: SweepRecord = { v: 1, at: 1_900_000_000_000, items: [['store2/u-a', null], ['store2/u-b', null, 1]] }

function okRead(read: UnitRecordRead): Extract<UnitRecordRead, { status: 'ok' }> {
    if (read.status !== 'ok') {
        throw new Error(`The record read ${read.status}.`)
    }
    return read
}

describe('the record through a real Node server', () => {
    test('T1: an absent record reads absent at version 0; a written one round-trips with the seen-before element and rev null on every unit item', async () => {
        const { store, guarded, backend } = await openRig()
        expect(await readUnitAgeRecord(store)).toEqual({ status: 'absent', version: 0 })
        const { commit, fence } = await revisionsOf(backend)

        expect(await writeUnitAgeRecord(guarded, RECORD, 0, commit, fence)).toBe('written')

        const read = okRead(await readUnitAgeRecord(store))
        expect(read.value).toEqual(RECORD)
        expect(read.value.items.every(item => item[1] === null)).toBe(true)
        expect(read.version).toBeGreaterThan(0)
    })

    test('the record key is outside store2/ and the commit key is untouched by its write', async () => {
        const { store, guarded, backend } = await openRig()
        const before = await backend.readCommit()
        const { commit, fence } = await revisionsOf(backend)

        await writeUnitAgeRecord(guarded, RECORD, 0, commit, fence)

        expect(GC_AGE_KEY.startsWith('store2/')).toBe(false)
        expect(await store.list('store2/')).not.toContain(GC_AGE_KEY)
        expect(revisionTokenOf((await backend.readCommit()).token).revision).toBe(revisionTokenOf(before.token).revision)
    })

    test('T9: bytes that are no record read unreadable at their version and a newer record reads too-new; neither reads as absent', async () => {
        const { store } = await openRig()
        await store.write(GC_AGE_KEY, new Uint8Array([9, 9, 9]), 'unconditional')
        const unreadable = await readUnitAgeRecord(store)
        expect(unreadable.status).toBe('unreadable')
        expect('version' in unreadable && unreadable.version).toBeGreaterThan(0)

        await store.write(GC_AGE_KEY, encodeUnit(UNIT_TYPE.sweepRecord, { v: 2, at: 1, items: [] }), 'unconditional')
        expect(await readUnitAgeRecord(store)).toEqual({ status: 'too-new' })
    })

    test('T9: a read that fails, and a store that reports no revision, are io-failed', async () => {
        const failing = createMemoryByteStore()
        failing.failRead = () => new Error('read failed')
        expect(await readUnitAgeRecord(failing)).toEqual({ status: 'io-failed' })
        expect(await readUnitAgeRecord(createMemoryByteStore()), 'a version of null cannot bind a write').toEqual({ status: 'io-failed' })
    })

    test('T10: a foreign write between the read and the write refuses on the record, writes nothing and leaves the foreign bytes', async () => {
        const { store, guarded, backend } = await openRig()
        const read = await readUnitAgeRecord(store)
        const { commit, fence } = await revisionsOf(backend)
        const foreign = encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: 5, items: [['store2/u-foreign', null]] })
        await store.write(GC_AGE_KEY, foreign, 'unconditional')

        const outcome = await writeUnitAgeRecord(guarded, RECORD, 'version' in read ? read.version : -1, commit, fence)

        expect(outcome).toEqual({ conflict: 'record' })
        expect([...(await store.read(GC_AGE_KEY)).bytes ?? []]).toEqual([...foreign])
    })

    test('T-bind: a commit between the read of the commit key and the write refuses on the commit key and writes nothing', async () => {
        const { store, guarded, backend } = await openRig()
        const { commit, fence } = await revisionsOf(backend)
        const committed = await committerOf(backend, clock, 92).commit(await backend.readCommit(), treeRequest(0, {}))
        expect(committed.status).toBe('committed')

        expect(await writeUnitAgeRecord(guarded, RECORD, 0, commit, fence)).toEqual({ conflict: 'commit' })
        expect((await store.read(GC_AGE_KEY)).bytes).toBeNull()
    })

    test('T-bind: a fence written between the read and the write refuses on the fence and writes nothing', async () => {
        const { store, guarded, backend } = await openRig()
        const { commit, fence } = await revisionsOf(backend)
        await plantFence(backend, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 1, priorCommits: [], keys: [] }))

        expect(await writeUnitAgeRecord(guarded, RECORD, 0, commit, fence)).toEqual({ conflict: 'fence' })
        expect((await store.read(GC_AGE_KEY)).bytes).toBeNull()
    })
})

describe('the outcome of a write that cannot be known', () => {
    function stub(fail: () => Error): { guarded: GuardedOperations, attempts: () => number } {
        let attempts = 0
        const guarded: GuardedOperations = {
            probe: async () => ({ checkOnly: true, retire: true, pieces: false }),
            writeChecked: async () => {
                attempts++
                throw fail()
            },
            removeChecked: async () => {},
            retireChecked: async () => {},
        }
        return { guarded, attempts: () => attempts }
    }

    test.each<[string, () => Error]>([
        ['a lost connection', () => new StoreOutcomeUnknownError('write-checked', new Error('reset'))],
        ['a server error status', () => new NodeHttpError(502, 'write-checked')],
        ['an answer that may have applied', () => new ServerLacksCapabilityError('check-only', 'no echo', true)],
    ])('T10b: %s is unknown and the write is attempted exactly once (MU29)', async (_label, fail) => {
        const { guarded, attempts } = stub(fail)

        expect(await writeUnitAgeRecord(guarded, RECORD, 3, 4, 5)).toBe('unknown')
        expect(attempts()).toBe(1)
    })

    test('a failure that is none of these is not hidden as an outcome', async () => {
        const { guarded } = stub(() => new TypeError('a bug'))

        await expect(writeUnitAgeRecord(guarded, RECORD, 3, 4, 5)).rejects.toThrow(TypeError)
    })

    test('a conflict on an unrelated key is reported on the record', async () => {
        const { guarded } = stub(() => new StoreVersionConflictError('store2/u-x', 1))

        expect(await writeUnitAgeRecord(guarded, RECORD, 3, 4, 5)).toEqual({ conflict: 'record' })
    })
})

describe('the aged dependencies', () => {
    const guardedWith = (serverNow: GuardedOperations['serverNow']): GuardedOperations => ({
        probe: async () => ({ checkOnly: true, retire: true, pieces: false }),
        serverNow,
        writeChecked: async () => ({ version: 1 }),
        removeChecked: async () => {},
        retireChecked: async () => {},
    })

    test('T8: a store without the guarded routes, or without a server clock, gets no aged dependencies', () => {
        expect(buildNodeGcAge(createMemoryByteStore())).toBeNull()
        expect(buildNodeGcAge({ ...createMemoryByteStore(), guarded: guardedWith(undefined) })).toBeNull()
    })

    test.each([
        ['server 12 h, page 48 h', 12, 48],
        ['server 48 h, page 12 h', 48, 12],
    ])('T12: with %s the earlier clock is the 12 hours and the later one the 48 (MU2, MU4, MU5)', async (_label, serverHours, pageHours) => {
        const HOUR = 3_600_000
        const store = { ...createMemoryByteStore(), guarded: guardedWith(async () => serverHours * HOUR) }
        const age = buildNodeGcAge(store, () => pageHours * HOUR)

        expect(await age?.sampleClock()).toEqual({ early: 12 * HOUR, late: 48 * HOUR })
    })

    test('a server clock that cannot be had rejects the sample: the page clock alone never decides', async () => {
        const store = { ...createMemoryByteStore(), guarded: guardedWith(async () => { throw new Error('no clock') }) }
        const age = buildNodeGcAge(store, () => 5)

        await expect(age?.sampleClock()).rejects.toThrow('no clock')
    })

    test('the page clock is read after the server answers', async () => {
        const order: string[] = []
        const store = { ...createMemoryByteStore(), guarded: guardedWith(async () => { order.push('server'); return 1 }) }
        const age = buildNodeGcAge(store, () => { order.push('page'); return 2 })

        await age?.sampleClock()

        expect(order).toEqual(['server', 'page'])
    })
})

describe('the keep-set of a mark', () => {
    test('it holds the marked keys and the keys of a standing fence, and nothing else', async () => {
        const backend = createMemoryBackend()
        await seedStore(backend, env)
        const fenced = newUnitKey(env)
        const other = newUnitKey(env)
        await plantFence(backend, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 1, priorCommits: [], keys: [tailOfKey(fenced)] }))
        const mark = await markLiveKeys(backend, await backend.readCommit())
        const gate = await openDeleterGate(backend, 'gc')
        if (mark.status !== 'marked' || gate.status !== 'open') {
            throw new Error('The seeded store must mark and open the gate.')
        }

        const keep = unitKeepOf(mark, gate)

        expect([...mark.live].length).toBeGreaterThan(0)
        for (const key of mark.live) {
            expect(keep.holds(key)).toBe(true)
        }
        expect(keep.holds(fenced)).toBe(true)
        expect(keep.holds(other)).toBe(false)
    })
})

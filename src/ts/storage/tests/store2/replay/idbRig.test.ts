// @vitest-environment node
/**
 * The IndexedDB rig of the replay: the real adapter over `fake-indexeddb`, one connection per tab, scheduled at the
 * `Store2Backend` layer. These tests pin what the rig itself promises (determinism, a connection per tab, the per-key
 * read split, the listing shuffle, the faults and the raw hooks); the protocol's behaviour on it is the corpus's and
 * the regions'.
 */
import { describe, expect, test } from 'vitest'
import { isStore2Key } from 'src/ts/storage/store/keyRules'
import { Store2UnknownOutcomeError } from 'src/ts/storage/store2/backend'
import { encodeUnit, newUnitKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { createClock, testEnv } from '../commitFixtures'
import type { ReplayRigOptions } from './actors'
import { createIdbReplayRig, type IdbReplayRig } from './idbRig'
import { REGIONS, runRegion } from './regions'
import { GARBAGE, plantGarbageUnits } from './replayFixtures'
import type { SchedulerOptions } from './scheduler'

type Options = Partial<Omit<ReplayRigOptions, 'scheduler'>> & { scheduler: Omit<SchedulerOptions, 'onStep'> }

async function twoTabs(options: Options): Promise<IdbReplayRig> {
    const rig = await createIdbReplayRig(options)
    for (const [id, actorSeed] of [['t1', 10], ['t2', 11]] as const) {
        rig.spawn(id, actorSeed, async (actor) => {
            await actor.open()
            await actor.commit(id)
            await actor.gcPass()
        })
    }
    return rig
}

/** Everything a run did: the full call log with its faults and outcomes, the final stored state's fingerprint and the actors' ends. */
async function traceOf(options: Options): Promise<{ log: string[], fingerprint: string, actors: string }> {
    const rig = await twoTabs(options)
    const result = await rig.run({ maxSteps: 20_000 })
    return {
        log: rig.scheduler.log.map((entry) => `${entry.step} ${entry.actor} ${entry.op} ${entry.target} ${entry.fault ?? '-'} ${entry.outcome}`),
        fingerprint: rig.scheduler.fingerprint(rig.raw()),
        actors: JSON.stringify(result.actors),
    }
}

/** A unit of the kind a tab uploads, under a key no other draw of the run mints. */
function strayUnit(): { key: string, bytes: Uint8Array } {
    return { key: newUnitKey(testEnv(createClock(), 99)), bytes: encodeUnit(UNIT_TYPE.preset, { v: 1, tag: 'stray' }) }
}

describe('the IndexedDB rig', () => {
    test('one seed twice gives the same call log, the same stored state and the same ends, under the random and the PCT policy and with faults', async () => {
        const plans: Array<Partial<SchedulerOptions>> = [
            {},
            { policy: { kind: 'pct', depth: 3, horizon: 60 } },
            { policy: { kind: 'pct', depth: 3, horizon: 60 }, faults: { mode: 'random', probability: 0.15, budget: { lostPerActor: Infinity, crashPerActor: 1 } } },
        ]
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            for (const plan of plans) {
                const options: Options = { scheduler: { seed, ...plan } }
                const first = await traceOf(options)
                const second = await traceOf(options)
                expect(first.log.length, `seed ${seed}`).toBeGreaterThan(20)
                expect(second, `seed ${seed} ${JSON.stringify(plan)}`).toEqual(first)
            }
        }
    })

    test('a region run twice on IndexedDB gives the same record: faults, interleavings and all', async () => {
        for (const id of ['R1', 'R3', 'R11', 'R17g', 'R18a', 'R18a2', 'R18b']) {
            const region = REGIONS.find((each) => each.id === id)
            expect(region, id).toBeDefined()
            for (const seed of [1, 2, 3]) {
                const first = await runRegion(region!, 'indexeddb', seed)
                const second = await runRegion(region!, 'indexeddb', seed)
                expect(second, `${id} seed ${seed}`).toEqual(first)
                expect(first.steps, `${id} seed ${seed}`).toBeGreaterThan(30)
            }
        }
    })
    test('different seeds interleave the tabs differently', async () => {
        const logs = new Set<string>()
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            logs.add((await traceOf({ scheduler: { seed } })).log.map((line) => line.split(' ').slice(1, 4).join(' ')).join('\n'))
        }
        expect(logs.size).toBeGreaterThan(1)
    })

    test('two tabs of one profile run to the end with no violation, and each holds a connection of its own', async () => {
        for (const seed of [1, 2, 3]) {
            const rig = await twoTabs({ scheduler: { seed } })
            const result = await rig.run({ maxSteps: 20_000 })
            expect(result.status).toBe('finished')
            expect(rig.checker.violations).toEqual([])
            expect(Object.values(result.actors).map((actor) => actor.state)).toEqual(['done', 'done'])
            expect(rig.openConnections()).toBe(2)
        }
    })

    test('a tree read is one scheduled request per key, never a multi-key read', async () => {
        const rig = await twoTabs({ scheduler: { seed: 1 } })
        await rig.run({ maxSteps: 20_000 })
        const reads = rig.scheduler.log.filter((entry) => entry.op === 'readUnits')
        expect(reads.length).toBeGreaterThanOrEqual(20)
        for (const read of reads) {
            expect(isStore2Key(read.target), `${read.actor} read ${read.target}`).toBe(true)
        }
    })

    test('a listing is a seeded permutation of the sorted keys the adapter answers, and loses none', async () => {
        const seen = new Set<string>()
        for (const seed of [1, 2, 3, 4]) {
            const rig = await createIdbReplayRig({
                scheduler: { seed },
                prepare: (hooks, env) => plantGarbageUnits(hooks.plant, env, 60),
            })
            let listed: string[] = []
            rig.spawn('t', 10, async (actor) => {
                await actor.open()
                listed = await actor.declared({ kind: 'read' }, 'plain', (session) => session.backend!.listStore2())
            })
            const result = await rig.run({ maxSteps: 20_000 })
            expect(result.status).toBe('finished')
            const sorted = rig.hooks.list('store2/').filter(isStore2Key).sort()
            expect(sorted.length).toBeGreaterThan(60)
            expect([...listed].sort()).toEqual(sorted)
            expect(listed, `seed ${seed}`).not.toEqual(sorted)
            seen.add(listed.join())
        }
        // The seed decides the permutation.
        expect(seen.size).toBe(4)
    })
    describe('faults', () => {
        async function strayWrite(kind: 'lost-response' | 'lost-request' | 'crash-after-write' | null): Promise<{ rig: IdbReplayRig, stray: { key: string, bytes: Uint8Array }, caught: unknown, ended: string }> {
            const stray = strayUnit()
            const rig = await createIdbReplayRig({
                scheduler: {
                    seed: 1,
                    faults: kind === null ? { mode: 'none' } : { mode: 'script', entries: [{ actor: 't', kind, op: 'putUnit' }], budget: { lostPerActor: 1, crashPerActor: 1 } },
                },
            })
            let caught: unknown = null
            let ended = 'unreached'
            rig.spawn('t', 10, async (actor) => {
                await actor.open()
                try {
                    await actor.declared({ kind: 'commit' }, 'plain', (session) => session.backend!.putUnit(stray.key, stray.bytes))
                } catch (error) {
                    caught = error
                }
                ended = 'after'
            })
            const result = await rig.run({ maxSteps: 20_000 })
            return { rig, stray, caught, ended: ended === 'unreached' ? result.actors.t.state : ended }
        }

        test('a lost response applies the write, then fails with the adapter\'s own unknown-outcome error', async () => {
            const { rig, stray, caught } = await strayWrite('lost-response')
            expect(caught).toBeInstanceOf(Store2UnknownOutcomeError)
            expect(rig.hooks.peek(stray.key)).toEqual(stray.bytes)
            expect(rig.checker.violations).toEqual([])
        })

        test('a lost request fails with the same error and writes nothing', async () => {
            const { rig, stray, caught } = await strayWrite('lost-request')
            expect(caught).toBeInstanceOf(Store2UnknownOutcomeError)
            expect(rig.hooks.peek(stray.key)).toBeNull()
        })

        test('a crash after the write applies it and retires the tab', async () => {
            const { rig, stray, ended } = await strayWrite('crash-after-write')
            expect(ended).toBe('crashed')
            expect(rig.hooks.peek(stray.key)).toEqual(stray.bytes)
        })

        test('with no fault the write lands and the tab goes on', async () => {
            const { rig, stray, caught, ended } = await strayWrite(null)
            expect(caught).toBeNull()
            expect(ended).toBe('after')
            expect(rig.hooks.peek(stray.key)).toEqual(stray.bytes)
        })
    })

    describe('damage and loss go straight to the database', () => {
        test('the raw hooks and the raw state agree with what the adapter stored', async () => {
            const rig = await createIdbReplayRig({ scheduler: { seed: 1 } })
            const seeded = rig.raw()
            expect(rig.seedManifest).not.toBeNull()
            expect(seeded.get(rig.seedManifest as string)?.bytes).not.toBeNull()
            expect(seeded.get(COMMIT_KEY)?.bytes).not.toBeNull()
            expect(seeded.get(FENCE_KEY)).toEqual({ bytes: null, revision: null })
            expect(rig.hooks.list('store2/').filter(isStore2Key)).toContain(rig.seedManifest)
            rig.hooks.remove(rig.seedManifest as string)
            expect(rig.hooks.peek(rig.seedManifest as string)).toBeNull()
            expect(rig.raw().get(rig.seedManifest as string)).toBeUndefined()
            const stray = strayUnit()
            rig.hooks.plant(stray.key, stray.bytes)
            expect(rig.raw().get(stray.key)?.bytes).toEqual(stray.bytes)
        })

        test('a silent damage of the commit key is a different value to the adapter\'s compare: a held commit conflicts and writes nothing', async () => {
            const rig = await createIdbReplayRig({
                scheduler: { seed: 1 },
                holds: [{ call: { actor: 't', op: 'commitOrdinary' }, until: { actor: '$env', op: 'damage-commit' } }],
            })
            // The damage lands after the tab's read of the commit key and before its write.
            void rig.reached({ actor: 't', op: 'readCommit', context: 'commit' }).then(() => {
                rig.scheduler.environment('damage-commit', 'damage-commit', () => rig.hooks.plant(COMMIT_KEY, GARBAGE))
            })
            const outcomes: string[] = []
            rig.spawn('t', 10, async (actor) => {
                await actor.open()
                outcomes.push((await actor.commit('t')).result.status)
            })
            const result = await rig.run({ maxSteps: 20_000 })
            expect(result.status).toBe('finished')
            expect(outcomes).toEqual(['conflict'])
            expect(rig.hooks.peek(COMMIT_KEY)).toEqual(GARBAGE)
            expect(rig.checker.violations).toEqual([])
        })

        test('a silent damage of the fence is what the next fence read finds', async () => {
            const rig = await createIdbReplayRig({ scheduler: { seed: 1 } })
            rig.scheduler.environment('damage-fence', 'damage-fence', () => rig.hooks.plant(FENCE_KEY, GARBAGE))
            const verdicts: string[] = []
            rig.spawn('t', 10, async (actor) => {
                await actor.rig.reached({ actor: '$env', op: 'damage-fence' })
                const session = await actor.open()
                verdicts.push(session.fence.state === 'blocked' ? `blocked:${session.fence.reason}` : session.fence.state)
            })
            const result = await rig.run({ maxSteps: 20_000 })
            expect(result.status).toBe('finished')
            expect(verdicts).toEqual(['blocked:unparsable'])
        })
    })
})

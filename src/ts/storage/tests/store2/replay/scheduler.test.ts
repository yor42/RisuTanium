// @vitest-environment node
/**
 * The replay scheduler: one granted request per step, the same seed giving the
 * same call log, every fault kind reachable with its stated effect on both
 * scheduled layers, PCT change points honoured, the two decorators, and the
 * fingerprint.
 */
import { describe, expect, test } from 'vitest'
import {
    createMemoryBackend, createNodeBackend, createTauriBackend, Store2CommitConflictError, Store2UnknownOutcomeError, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import { newUnitKey, type KeyEnv } from 'src/ts/storage/store2/format'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { isStore2Key } from 'src/ts/storage/store/keyRules'
import { StoreDeleteManyError, StoreOutcomeUnknownError, StoreStaleGenerationError } from 'src/ts/storage/store/errors'
import { bytesOf } from '../backendConformance'
import { createClock, testEnv } from '../commitFixtures'
import {
    createRng, createScheduler, shuffleListing, splitReadUnits,
    type FaultPlan, type PolicyConfig, type Scheduler, type StepInfo,
} from './scheduler'
import { GARBAGE, nodeRig, plantGarbageUnits } from './replayFixtures'
import { createNodeReplayRig } from './nodeRig'
import { createTauriReplayRig } from './tauriRig'
import { createTauriSemanticStore, type TauriSemanticStore } from './tauriSemanticStore'

const clock = createClock()

function unitKeys(count: number, seed = 11): string[] {
    const env = testEnv(clock, seed)
    return Array.from({ length: count }, () => newUnitKey(env))
}

function stored(snapshot: Map<string, Uint8Array>, key: string): boolean {
    return snapshot.has(key)
}

/** The semantic store as a Tauri byte store: the page-generation gate over its plain write and deleteMany. Built once per rig, so the actors of a page share it. */
function withGate(inner: ByteStore): ByteStore {
    let generation = 0
    const refuseStale = (gen: number): void => {
        if (gen === 0 || gen !== generation) {
            throw new StoreStaleGenerationError('not the current generation')
        }
    }
    return {
        ...inner,
        pageGate: {
            registerPage: async () => ++generation,
            writeTop: async (gen, key, bytes) => {
                refuseStale(gen)
                return await inner.write(key, bytes, 'unconditional')
            },
            removeTop: async (gen, keys) => {
                refuseStale(gen)
                await inner.deleteMany(keys.map((key) => ({ key, condition: 'unconditional' as const })))
            },
        },
    }
}

describe('determinism', () => {
    async function scenario(seed: number): Promise<string> {
        const memory = createMemoryBackend()
        const scheduler = createScheduler({
            seed,
            faults: { mode: 'random', probability: 0.4, budget: { lostPerActor: 1, crashPerActor: 1 } },
        })
        const keys = unitKeys(12)
        ;['a', 'b', 'c'].forEach((id, index) => {
            scheduler.spawn(id, async (actor) => {
                const backend = actor.backend(memory)
                for (const key of keys.slice(index * 4, index * 4 + 4)) {
                    try {
                        await backend.putUnit(key, bytesOf(index))
                    } catch (error) {
                        if (!(error instanceof Store2UnknownOutcomeError)) {
                            throw error
                        }
                    }
                    await backend.readCommit()
                    await backend.listStore2()
                }
            })
        })
        const result = await scheduler.run()
        return JSON.stringify({ log: scheduler.log, result })
    }

    test('one seed run twice gives an identical full call log, faults included', async () => {
        const first = await scenario(5)
        const second = await scenario(5)
        expect(first).toBe(second)
        expect(JSON.parse(first).log.length).toBeGreaterThan(10)
        expect(JSON.parse(first).log.some((entry: { fault: string | null }) => entry.fault !== null)).toBe(true)
    })

    test('other seeds choose other interleavings', async () => {
        const base = await scenario(5)
        const others = await Promise.all([6, 7, 8, 9].map(scenario))
        expect(others.some((other) => other !== base)).toBe(true)
    })

    test('PCT with a seed is deterministic as well', async () => {
        async function pct(seed: number): Promise<string> {
            const memory = createMemoryBackend()
            const scheduler = createScheduler({ seed, policy: { kind: 'pct', depth: 3, horizon: 30 } })
            for (const id of ['x', 'y', 'z']) {
                scheduler.spawn(id, async (actor) => {
                    const backend = actor.backend(memory)
                    for (let i = 0; i < 8; i++) {
                        await backend.readCommit()
                    }
                })
            }
            await scheduler.run()
            return JSON.stringify({ log: scheduler.log, points: scheduler.changePoints })
        }
        expect(await pct(3)).toBe(await pct(3))
        const points = JSON.parse(await pct(3)).points as number[]
        expect(points).toHaveLength(3)
        expect(new Set(points).size).toBe(3)
        expect(points.every((point) => point >= 1 && point <= 30)).toBe(true)
    })
})

describe('one granted request per step', () => {
    test('concurrent requests of one actor are granted one at a time and each is logged', async () => {
        const memory = createMemoryBackend()
        const scheduler = createScheduler({ seed: 1 })
        const keys = unitKeys(4)
        scheduler.spawn('a', async (actor) => {
            const backend = actor.backend(memory)
            await Promise.all(keys.map((key) => backend.putUnit(key, bytesOf(1))))
        })
        const result = await scheduler.run()
        expect(result.status).toBe('finished')
        expect(result.steps).toBe(4)
        expect(scheduler.log.map((entry) => entry.step)).toEqual([1, 2, 3, 4])
        expect(new Set(scheduler.log.map((entry) => entry.target))).toEqual(new Set(keys))
    })

    test('an actor that never reaches another scheduled call is reported as stalled, not hidden', async () => {
        const memory = createMemoryBackend()
        const scheduler = createScheduler({ seed: 1 })
        scheduler.spawn('a', async (actor) => {
            await actor.backend(memory).readCommit()
            await new Promise<void>(() => {})
        })
        const result = await scheduler.run()
        expect(result.status).toBe('stalled')
        expect(result.actors.a.state).toBe('running')
    })

    test('an actor that throws is reported as failed with its error', async () => {
        const scheduler = createScheduler({ seed: 1 })
        scheduler.spawn('a', async () => {
            throw new RangeError('boom')
        })
        const result = await scheduler.run()
        expect(result.status).toBe('finished')
        expect(result.actors.a).toMatchObject({ state: 'failed', error: 'RangeError: boom' })
    })
})

describe('fault kinds on the Store2Backend layer', () => {
    async function runWith(faults: FaultPlan, body: (backend: Store2Backend) => Promise<void>) {
        const memory = createMemoryBackend()
        const scheduler = createScheduler({ seed: 1, faults })
        scheduler.spawn('a', async (actor) => body(actor.backend(memory)))
        const result = await scheduler.run()
        return { memory, result, scheduler }
    }

    test('a lost response applies the write and then fails with the unknown outcome', async () => {
        const [key] = unitKeys(1)
        let failure: unknown
        const { memory, scheduler } = await runWith({ mode: 'script', entries: [{ actor: 'a', write: 1, kind: 'lost-response' }] }, async (backend) => {
            try {
                await backend.putUnit(key, bytesOf(1))
            } catch (error) {
                failure = error
            }
        })
        expect(failure).toBeInstanceOf(Store2UnknownOutcomeError)
        expect(stored(memory.snapshot(), key)).toBe(true)
        expect(scheduler.log[0]).toMatchObject({ fault: 'lost-response', outcome: 'lost-response' })
    })

    test('a lost request does not apply the write and fails with the same unknown outcome', async () => {
        const [key] = unitKeys(1)
        let failure: unknown
        const { memory, scheduler } = await runWith({ mode: 'script', entries: [{ actor: 'a', write: 1, kind: 'lost-request' }] }, async (backend) => {
            try {
                await backend.putUnit(key, bytesOf(1))
            } catch (error) {
                failure = error
            }
        })
        expect(failure).toBeInstanceOf(Store2UnknownOutcomeError)
        expect(stored(memory.snapshot(), key)).toBe(false)
        expect(scheduler.log[0]).toMatchObject({ fault: 'lost-request', outcome: 'lost-request' })
    })

    test('a lost response hides the conflict the call would have reported', async () => {
        let failure: unknown
        const { memory } = await runWith({ mode: 'script', entries: [{ actor: 'a', write: 2, kind: 'lost-response' }] }, async (backend) => {
            const stale = (await backend.readCommit()).token
            await backend.casCommit(stale, bytesOf(1)).catch(() => undefined)
            try {
                await backend.casCommit(stale, bytesOf(2))
            } catch (error) {
                failure = error
            }
        })
        expect(failure).toBeInstanceOf(Store2UnknownOutcomeError)
        expect(memory.snapshot().get(COMMIT_KEY)).toEqual(bytesOf(1))
    })

    test('a commit conflict the actor saw is reported on its step with the commit key value it carried; one a lost response hid is not', async () => {
        const steps: StepInfo[] = []
        const memory = createMemoryBackend()
        const scheduler = createScheduler({
            seed: 1,
            faults: { mode: 'script', entries: [{ actor: 'a', write: 3, kind: 'lost-response' }] },
            onStep: (info) => steps.push(info),
        })
        scheduler.spawn('a', async (actor) => {
            const backend = actor.backend(memory)
            const stale = (await backend.readCommit()).token
            await backend.casCommit(stale, bytesOf(1))
            await backend.casCommit(stale, bytesOf(2)).catch(() => undefined)
            await backend.casCommit(stale, bytesOf(3)).catch(() => undefined)
        })
        const result = await scheduler.run()

        expect(result.status).toBe('finished')
        const writes = steps.filter((info) => info.op === 'casCommit')
        expect(writes).toHaveLength(3)
        expect(writes[0].commitConflictRead).toBeUndefined()
        expect(writes[1].commitConflictRead).toEqual(bytesOf(1))
        expect(writes[2].commitConflictRead).toBeUndefined()
    })

    test('a crash after the write applies it, never resolves it and retires the actor; its later calls never happen', async () => {
        const keys = unitKeys(3)
        let continued = false
        const memory = createMemoryBackend()
        const scheduler = createScheduler({ seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', write: 2, kind: 'crash-after-write' }] } })
        scheduler.spawn('a', async (actor) => {
            const backend = actor.backend(memory)
            await backend.putUnit(keys[0], bytesOf(1))
            await backend.putUnit(keys[1], bytesOf(1))
            continued = true
            await backend.putUnit(keys[2], bytesOf(1))
        })
        scheduler.spawn('b', async (actor) => {
            await actor.backend(memory).readCommit()
        })
        const result = await scheduler.run()
        expect(result.status).toBe('finished')
        expect(result.actors.a.state).toBe('crashed')
        expect(result.actors.b.state).toBe('done')
        expect(continued).toBe(false)
        const held = memory.snapshot()
        expect(stored(held, keys[0])).toBe(true)
        expect(stored(held, keys[1])).toBe(true)
        expect(stored(held, keys[2])).toBe(false)
    })

    test('a crash drops the actor\'s calls that were not yet granted and keeps the ones already granted', async () => {
        const keys = unitKeys(4)
        const memory = createMemoryBackend()
        const scheduler = createScheduler({ seed: 3, faults: { mode: 'script', entries: [{ actor: 'a', write: 3, kind: 'crash-after-write' }] } })
        scheduler.spawn('a', async (actor) => {
            const backend = actor.backend(memory)
            await Promise.all(keys.map((key) => backend.putUnit(key, bytesOf(1))))
        })
        // A second actor keeps the run alive, so a call of `a` that survived the crash would still be granted.
        scheduler.spawn('b', async (actor) => {
            for (let i = 0; i < 10; i++) {
                await actor.backend(memory).readCommit()
            }
        })
        const result = await scheduler.run()
        expect(result.actors.a).toMatchObject({ state: 'crashed', writes: 3, calls: 3 })
        const granted = scheduler.log.filter((entry) => entry.actor === 'a').map((entry) => entry.target)
        expect(granted).toHaveLength(3)
        const held = memory.snapshot()
        expect(keys.filter((key) => stored(held, key)).sort()).toEqual([...granted].sort())
        expect(keys.filter((key) => !granted.includes(key))).toHaveLength(1)
        expect(stored(held, keys.find((key) => !granted.includes(key))!)).toBe(false)
    })

    test('a random plan stays inside its per-actor budget', async () => {
        const keys = unitKeys(10)
        const memory = createMemoryBackend()
        const scheduler = createScheduler({ seed: 2, faults: { mode: 'random', probability: 1, budget: { lostPerActor: 1, crashPerActor: 0 } } })
        scheduler.spawn('a', async (actor) => {
            for (const key of keys) {
                await actor.backend(memory).putUnit(key, bytesOf(1)).catch((error: unknown) => {
                    if (!(error instanceof Store2UnknownOutcomeError)) {
                        throw error
                    }
                })
            }
        })
        const result = await scheduler.run()
        expect(result.actors.a.state).toBe('done')
        expect(scheduler.log.filter((entry) => entry.fault !== null)).toHaveLength(1)
    })

    test('a random plan with crashes only retires the actor at its first write', async () => {
        const keys = unitKeys(3)
        const memory = createMemoryBackend()
        const scheduler = createScheduler({ seed: 2, faults: { mode: 'random', probability: 1, budget: { lostPerActor: 0, crashPerActor: 1 } } })
        scheduler.spawn('a', async (actor) => {
            for (const key of keys) {
                await actor.backend(memory).putUnit(key, bytesOf(1))
            }
        })
        const result = await scheduler.run()
        expect(result.actors.a.state).toBe('crashed')
        expect(memory.snapshot().size).toBe(1)
    })

    test('a scripted plan above its budget is refused when the scheduler is built', () => {
        expect(() => createScheduler({
            seed: 1,
            faults: {
                mode: 'script',
                budget: { lostPerActor: 1, crashPerActor: 1 },
                entries: [{ actor: 'a', write: 1, kind: 'lost-response' }, { actor: 'a', write: 2, kind: 'lost-request' }],
            },
        })).toThrow(RangeError)
    })

    test('a scripted fault on a call that cannot have it fails the run instead of being skipped', async () => {
        const scheduler = createScheduler({ seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', write: 1, kind: 'partial-removal' }] } })
        const rig = nodeRig()
        scheduler.spawn('a', async (actor) => {
            await actor.byteStore(rig.fake.store).write('k/a', bytesOf(1), 'unconditional')
        })
        await expect(scheduler.run()).rejects.toThrow(RangeError)
    })
})

describe('fault kinds on the ByteStore layer under the real Node backend', () => {
    test('a lost response of a unit upload through the Node backend is an unknown outcome that was applied; a lost request is one that was not', async () => {
        for (const kind of ['lost-response', 'lost-request'] as const) {
            const rig = nodeRig()
            const scheduler = createScheduler({ seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', write: 1, kind }] } })
            const [key] = unitKeys(1)
            let failure: unknown
            scheduler.spawn('a', async (actor) => {
                const backend = createNodeBackend(actor.byteStore(rig.fake.store))
                try {
                    await backend.putUnit(key, bytesOf(1))
                } catch (error) {
                    failure = error
                }
            })
            await scheduler.run()
            expect(failure).toBeInstanceOf(Store2UnknownOutcomeError)
            expect(rig.fake.peek(key).bytes !== null).toBe(kind === 'lost-response')
        }
    })

    test('a lost response of a guarded write hides the conflict it would have reported', async () => {
        const rig = nodeRig()
        const scheduler = createScheduler({ seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', write: 1, kind: 'lost-response' }] } })
        let failure: unknown
        scheduler.spawn('a', async (actor) => {
            try {
                await actor.byteStore(rig.fake.store).guarded!.writeChecked('k/guarded', bytesOf(1), { ifVersion: 5 }, [])
            } catch (error) {
                failure = error
            }
        })
        await scheduler.run()
        expect(failure).toBeInstanceOf(StoreOutcomeUnknownError)
        expect(rig.fake.peek('k/guarded')).toEqual({ bytes: null, revision: 0 })
    })

    test('a plain write whose response is lost fails with the transport error and was applied; a lost request was not', async () => {
        for (const kind of ['lost-response', 'lost-request'] as const) {
            const rig = nodeRig()
            const scheduler = createScheduler({ seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', write: 1, kind }] } })
            let failure: unknown
            scheduler.spawn('a', async (actor) => {
                try {
                    await actor.byteStore(rig.fake.store).write('k/plain', bytesOf(4), 'unconditional')
                } catch (error) {
                    failure = error
                }
            })
            await scheduler.run()
            expect(failure).toBeInstanceOf(TypeError)
            expect(rig.fake.peek('k/plain').bytes !== null).toBe(kind === 'lost-response')
        }
    })

    test('a crash after a unit upload of the Node backend leaves the upload and never starts the commit-key write', async () => {
        const rig = nodeRig()
        const scheduler = createScheduler({ seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', write: 1, kind: 'crash-after-write' }] } })
        const [key] = unitKeys(1)
        scheduler.spawn('a', async (actor) => {
            const backend = createNodeBackend(actor.byteStore(rig.fake.store))
            await backend.commitOrdinary((await backend.readCommit()).token, [{ key, bytes: bytesOf(1) }], bytesOf(2))
        })
        const result = await scheduler.run()
        expect(result.actors.a.state).toBe('crashed')
        expect(rig.fake.peek(key).bytes).not.toBeNull()
        expect(rig.fake.peek(COMMIT_KEY).bytes).toBeNull()
    })

    test('commit-key damage is an environment step that changes the bytes and keeps the revision', async () => {
        const rig = nodeRig()
        const scheduler = createScheduler({ seed: 1 })
        const [key] = unitKeys(1)
        await rig.fake.store.write(COMMIT_KEY, bytesOf(1), 'unconditional')
        scheduler.environment('damage-commit', 'damage-commit', () => rig.fake.damage(COMMIT_KEY, GARBAGE))
        scheduler.spawn('a', async (actor) => {
            const store = actor.byteStore(rig.fake.store)
            for (let i = 0; i < 20; i++) {
                await store.read(key)
            }
        })
        await scheduler.run()
        expect(rig.fake.peek(COMMIT_KEY)).toEqual({ bytes: GARBAGE, revision: 1 })
        const damage = scheduler.log.filter((entry) => entry.fault === 'damage-commit')
        expect(damage).toEqual([expect.objectContaining({ actor: '$env', op: 'damage-commit', outcome: 'env' })])
    })

    test('an environment step that is still waiting when every actor has finished is not taken', async () => {
        const rig = nodeRig()
        const scheduler = createScheduler({ seed: 1 })
        let taken = false
        scheduler.spawn('a', async () => {})
        scheduler.environment('late', 'damage-fence', () => {
            taken = true
        })
        const result = await scheduler.run()
        expect(result.status).toBe('finished')
        expect(taken).toBe(false)
        expect(rig.fake.log).toEqual([])
    })

    test('an environment step is a way forward: it is taken when no call is pending, instead of a stall', async () => {
        const rig = nodeRig()
        let damaged = false
        let registered = false
        let release = (): void => {}
        const waitForDamage = new Promise<void>((resolve) => { release = resolve })
        // The step is registered when a's read has been applied, and a has no further call: from then on
        // nothing is pending, so the environment step is the only way forward.
        const scheduler: Scheduler = createScheduler({
            seed: 1,
            onStep: (info) => {
                if (info.actor === 'a' && !registered) {
                    registered = true
                    scheduler.environment('damage-commit', 'damage-commit', () => {
                        rig.fake.damage(COMMIT_KEY, GARBAGE)
                        damaged = true
                        release()
                    })
                }
            },
        })
        const [key] = unitKeys(1)
        await rig.fake.store.write(COMMIT_KEY, bytesOf(1), 'unconditional')
        scheduler.spawn('a', async (actor) => {
            const store = actor.byteStore(rig.fake.store)
            await store.read(key)
            await waitForDamage
        })
        const result = await scheduler.run()
        expect(result.status).toBe('finished')
        expect(scheduler.log.map((entry) => `${entry.actor}:${entry.op}`)).toEqual(['a:read', '$env:damage-commit'])
        expect(damaged).toBe(true)
        expect(rig.fake.peek(COMMIT_KEY).bytes).toEqual(GARBAGE)
    })
})

describe('PCT change points', () => {
    async function actorSequence(policy: PolicyConfig): Promise<{ actors: string[], scheduler: Scheduler }> {
        const memory = createMemoryBackend()
        const scheduler = createScheduler({ seed: 4, policy })
        for (const id of ['x', 'y']) {
            scheduler.spawn(id, async (actor) => {
                const backend = actor.backend(memory)
                for (let i = 0; i < 6; i++) {
                    await backend.readCommit()
                }
            })
        }
        await scheduler.run()
        return { actors: scheduler.log.map((entry) => entry.actor), scheduler }
    }

    test('without a change point the highest-priority actor runs to the end first', async () => {
        const { actors } = await actorSequence({ kind: 'pct', depth: 1, horizon: 12, changePoints: [] })
        const top = actors[0]
        const other = top === 'x' ? 'y' : 'x'
        expect(actors).toEqual([...Array(6).fill(top), ...Array(6).fill(other)])
    })

    test('at a change point the actor that would run is demoted below the others', async () => {
        const { actors, scheduler } = await actorSequence({ kind: 'pct', depth: 1, horizon: 12, changePoints: [3] })
        const top = actors[0]
        const other = top === 'x' ? 'y' : 'x'
        expect(scheduler.changePoints).toEqual([3])
        expect(actors).toEqual([top, top, ...Array(6).fill(other), ...Array(4).fill(top)])
    })

    test('a later change point demotes whichever actor is running then', async () => {
        const { actors } = await actorSequence({ kind: 'pct', depth: 2, horizon: 12, changePoints: [2, 9] })
        const top = actors[0]
        const other = top === 'x' ? 'y' : 'x'
        // Step 2 demotes the first actor; the other runs its 6 calls (steps 2 to 7), then the demoted one finishes.
        expect(actors.slice(0, 2)).toEqual([top, other])
        expect(actors.slice(0, 7)).toEqual([top, ...Array(6).fill(other)])
        expect(actors).toHaveLength(12)
        expect(actors.filter((actor) => actor === top)).toHaveLength(6)
    })
})

describe('PCT within one actor', () => {
    const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

    async function pool(seed: number, faults?: FaultPlan): Promise<{ keys: string[], granted: string[], applied: string[] }> {
        const memory = createMemoryBackend()
        const keys = unitKeys(4, 40 + seed)
        const scheduler = createScheduler({ seed, policy: { kind: 'pct', depth: 1, horizon: 8 }, ...(faults === undefined ? {} : { faults }) })
        scheduler.spawn('a', async (actor) => {
            const backend = actor.backend(memory)
            await Promise.all(keys.map((key) => backend.putUnit(key, bytesOf(1))))
        })
        await scheduler.run()
        return { keys, granted: scheduler.log.map((entry) => entry.target), applied: keys.filter((key) => stored(memory.snapshot(), key)) }
    }

    test('concurrent calls of the chosen actor are granted in an order other than arrival for some seed, and each seed is repeatable', async () => {
        let reordered = 0
        for (const seed of SEEDS) {
            const first = await pool(seed)
            expect([...first.granted].sort()).toEqual([...first.keys].sort())
            expect((await pool(seed)).granted).toEqual(first.granted)
            if (first.granted.join() !== first.keys.join()) {
                reordered++
            }
        }
        expect(reordered).toBeGreaterThan(0)
    })

    test('a crash in the middle of a pool can leave a subset that is not a prefix of the arrival order', async () => {
        let nonPrefix = 0
        for (const seed of SEEDS) {
            const { keys, applied } = await pool(seed, { mode: 'script', entries: [{ actor: 'a', write: 2, kind: 'crash-after-write' }] })
            expect(applied).toHaveLength(2)
            if (applied.join() !== keys.slice(0, 2).join()) {
                nonPrefix++
            }
        }
        expect(nonPrefix).toBeGreaterThan(0)
    })
})

describe('deleteMany faults on the ByteStore layer', () => {
    const NAMES = ['k/1', 'k/2', 'k/3']

    async function runDelete(kind: 'lost-response' | 'lost-request' | 'partial-removal', seed = 1) {
        const rig = nodeRig()
        for (const name of NAMES) {
            await rig.fake.store.write(name, bytesOf(1), 'unconditional')
        }
        const scheduler = createScheduler({ seed, faults: { mode: 'script', entries: [{ actor: 'a', write: 1, kind }] } })
        let failure: unknown
        scheduler.spawn('a', async (actor) => {
            try {
                await actor.byteStore(rig.fake.store).deleteMany(NAMES.map((key) => ({ key, condition: 'unconditional' as const })))
            } catch (error) {
                failure = error
            }
        })
        await scheduler.run()
        const held = NAMES.filter((name) => rig.fake.peek(name).bytes !== null)
        return { failure, held, scheduler }
    }

    test('a lost response removes every key and reports each as failed', async () => {
        const { failure, held } = await runDelete('lost-response')
        expect(failure).toBeInstanceOf(StoreDeleteManyError)
        expect((failure as StoreDeleteManyError).report.map((entry) => entry.outcome)).toEqual(['failed', 'failed', 'failed'])
        expect(held).toEqual([])
    })

    test('a lost request removes nothing and reports each key as failed', async () => {
        const { failure, held } = await runDelete('lost-request')
        expect(failure).toBeInstanceOf(StoreDeleteManyError)
        expect((failure as StoreDeleteManyError).report.map((entry) => entry.outcome)).toEqual(['failed', 'failed', 'failed'])
        expect(held).toEqual(NAMES)
    })

    test('a partial removal reports exactly the keys that went as removed and keeps at least one failed', async () => {
        let someRemoved = 0
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
            const { failure, held, scheduler } = await runDelete('partial-removal', seed)
            expect(failure).toBeInstanceOf(StoreDeleteManyError)
            const report = (failure as StoreDeleteManyError).report
            expect(report.filter((entry) => entry.outcome === 'failed').length).toBeGreaterThan(0)
            expect(report.filter((entry) => entry.outcome === 'failed').map((entry) => entry.key).sort()).toEqual([...held].sort())
            expect(scheduler.log[0]).toMatchObject({ fault: 'partial-removal', outcome: 'partial-removal' })
            if (held.length < NAMES.length) {
                someRemoved++
            }
        }
        expect(someRemoved).toBeGreaterThan(0)
    })

    test('through the Tauri backend each of the three is an unknown outcome of the removal', async () => {
        for (const kind of ['lost-response', 'lost-request', 'partial-removal'] as const) {
            const rig = nodeRig()
            const keys = unitKeys(3).sort()
            for (const key of keys) {
                await rig.fake.store.write(key, bytesOf(1), 'unconditional')
            }
            // Write 1 of the actor is the page's registration; write 2 is the removal.
            const scheduler = createScheduler({ seed: 2, faults: { mode: 'script', entries: [{ actor: 'a', write: 2, kind }] } })
            const gated = withGate(rig.fake.store)
            let failure: unknown
            scheduler.spawn('a', async (actor) => {
                const backend = await createTauriBackend(actor.byteStore(gated))
                try {
                    await backend.removeBatch(keys, (await backend.readCommit()).token, (await backend.readFence()).token)
                } catch (error) {
                    failure = error
                }
            })
            await scheduler.run()
            expect(failure, kind).toBeInstanceOf(Store2UnknownOutcomeError)
            expect(keys.filter((key) => rig.fake.peek(key).bytes !== null).length === 0, kind).toBe(kind === 'lost-response')
        }
    })
})

describe('actors of one Tauri page', () => {
    const SEEDS = Array.from({ length: 30 }, (_, index) => index + 1)

    test('they share one scheduled store, so two of them cannot both win a compare-and-write of the same key', async () => {
        let bothWon = 0
        for (const seed of SEEDS) {
            const rig = nodeRig()
            const gated = withGate(rig.fake.store)
            const scheduler = createScheduler({ seed })
            const stores: ByteStore[] = []
            // One backend per page, as in the app: a second registration would make the first backend stale.
            let pageBackend: Promise<Store2Backend> | undefined
            let wins = 0
            // Both read the key before either writes, so only the mutex can keep them from both winning.
            let readers = 0
            let released!: () => void
            const bothRead = new Promise<void>((resolve) => { released = resolve })
            for (const id of ['a', 'b']) {
                scheduler.spawn(id, async (actor) => {
                    const store = actor.byteStore(gated)
                    stores.push(store)
                    pageBackend ??= createTauriBackend(store)
                    const backend = await pageBackend
                    const read = await backend.readCommit()
                    if (++readers === 2) {
                        released()
                    }
                    await bothRead
                    try {
                        await backend.casCommit(read.token, bytesOf(id.charCodeAt(0)))
                        wins++
                    } catch (error) {
                        if (!(error instanceof Store2CommitConflictError)) {
                            throw error
                        }
                    }
                }, { page: 'p' })
            }
            const result = await scheduler.run()
            expect(result.status, `seed ${seed}`).toBe('finished')
            expect(stores[0], `seed ${seed}`).toBe(stores[1])
            if (wins !== 1) {
                bothWon++
            }
        }
        expect(bothWon).toBe(0)
    })

    test('actors of different pages do not share a store', async () => {
        const rig = nodeRig()
        const scheduler = createScheduler({ seed: 1 })
        const stores: ByteStore[] = []
        for (const [id, page] of [['a', 'p'], ['b', 'q']]) {
            scheduler.spawn(id, async (actor) => {
                stores.push(actor.byteStore(rig.fake.store))
            }, { page })
        }
        await scheduler.run()
        expect(stores[0]).not.toBe(stores[1])
    })

    test('a crash of one actor retires every actor of its page and none of another page', async () => {
        let pageRetired = 0
        for (const seed of SEEDS.slice(0, 12)) {
            const rig = nodeRig()
            const gated = withGate(rig.fake.store)
            // Write 1 of actor a is the page's registration; write 2 is its unit write.
            const scheduler = createScheduler({ seed, faults: { mode: 'script', entries: [{ actor: 'a', write: 2, kind: 'crash-after-write' }] } })
            const aKey = unitKeys(1, 60 + seed)[0]
            const bKeys = unitKeys(5, 80 + seed)
            scheduler.spawn('a', async (actor) => {
                await (await createTauriBackend(actor.byteStore(gated))).putUnit(aKey, bytesOf(1))
            }, { page: 'p' })
            scheduler.spawn('b', async (actor) => {
                const backend = await createTauriBackend(actor.byteStore(gated))
                for (const key of bKeys) {
                    await backend.putUnit(key, bytesOf(2))
                }
            }, { page: 'p' })
            scheduler.spawn('c', async (actor) => {
                const store = actor.byteStore(rig.fake.store)
                for (let i = 0; i < 3; i++) {
                    await store.read('k/c')
                }
            }, { page: 'q' })
            const result = await scheduler.run()
            expect(result.status, `seed ${seed}`).toBe('finished')
            expect(result.actors.a.state, `seed ${seed}`).toBe('crashed')
            expect(['crashed', 'done'], `seed ${seed}`).toContain(result.actors.b.state)
            expect(result.actors.c.state, `seed ${seed}`).toBe('done')
            if (result.actors.b.state === 'crashed') {
                pageRetired++
            }
        }
        expect(pageRetired).toBeGreaterThan(0)
    })
})

describe('the gate capability of a ByteStore', () => {
    const KEYS = unitKeys(2, 31).sort()

    async function runGate(entries: FaultPlan, body: (store: ByteStore) => Promise<void>) {
        const rig = nodeRig()
        const scheduler = createScheduler({ seed: 3, faults: entries })
        scheduler.spawn('a', async (actor) => {
            await body(actor.byteStore(withGate(rig.fake.store)))
        })
        const result = await scheduler.run()
        return { rig, scheduler, result }
    }

    test('registerPage, writeTop and removeTop are scheduled calls, and a store without a gate offers none', async () => {
        const { scheduler, rig } = await runGate({ mode: 'none' }, async (store) => {
            const gen = await store.pageGate!.registerPage()
            await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(1))
            await store.pageGate!.removeTop(gen, [KEYS[0]])
        })
        expect(scheduler.log.map((entry) => `${entry.op}:${entry.target}`)).toEqual(['registerPage:', `writeTop:${COMMIT_KEY}`, `removeTop:${KEYS[0]}`])
        expect(rig.fake.peek(COMMIT_KEY).bytes).toEqual(bytesOf(1))

        const plain = createScheduler({ seed: 1 })
        let offered: unknown = 'unset'
        plain.spawn('a', async (actor) => {
            offered = actor.byteStore(nodeRig().fake.store).pageGate
        })
        await plain.run()
        expect(offered).toBeUndefined()
    })

    test('a lost request of writeTop applies nothing, a lost response applies it, and both fail as the plain write does', async () => {
        for (const kind of ['lost-request', 'lost-response'] as const) {
            let failure: unknown
            const { rig } = await runGate({ mode: 'script', entries: [{ actor: 'a', write: 2, kind }] }, async (store) => {
                const gen = await store.pageGate!.registerPage()
                try {
                    await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(1))
                } catch (error) {
                    failure = error
                }
            })
            expect(failure, kind).toBeInstanceOf(TypeError)
            expect(rig.fake.peek(COMMIT_KEY).bytes !== null, kind).toBe(kind === 'lost-response')
        }
    })

    test('a crash after writeTop applies it, retires the actor and leaves its later calls unsent', async () => {
        const { rig, result } = await runGate({ mode: 'script', entries: [{ actor: 'a', write: 2, kind: 'crash-after-write' }] }, async (store) => {
            const gen = await store.pageGate!.registerPage()
            await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(1))
            await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(2))
        })
        expect(result.actors.a.state).toBe('crashed')
        expect(rig.fake.peek(COMMIT_KEY).bytes).toEqual(bytesOf(1))
    })

    test('a partial removal through removeTop reports per key like deleteMany', async () => {
        let failure: unknown
        const rig = nodeRig()
        for (const key of KEYS) {
            await rig.fake.store.write(key, bytesOf(1), 'unconditional')
        }
        const scheduler = createScheduler({ seed: 4, faults: { mode: 'script', entries: [{ actor: 'a', write: 2, kind: 'partial-removal' }] } })
        scheduler.spawn('a', async (actor) => {
            const store = actor.byteStore(withGate(rig.fake.store))
            const gen = await store.pageGate!.registerPage()
            try {
                await store.pageGate!.removeTop(gen, KEYS)
            } catch (error) {
                failure = error
            }
        })
        await scheduler.run()
        expect(failure).toBeInstanceOf(StoreDeleteManyError)
        const report = (failure as StoreDeleteManyError).report
        expect(report.map((entry) => entry.key)).toEqual(KEYS)
        expect(report.filter((entry) => entry.outcome === 'failed').length).toBeGreaterThan(0)
        expect(report.filter((entry) => entry.outcome === 'failed').map((entry) => entry.key).sort()).toEqual(KEYS.filter((key) => rig.fake.peek(key).bytes !== null))
    })
})

describe('decorators', () => {
    test('splitReadUnits turns one multi-key read into one scheduled request per key and keeps the answer', async () => {
        const memory = createMemoryBackend()
        const keys = unitKeys(3)
        await memory.putUnit(keys[0], bytesOf(1))
        await memory.putUnit(keys[2], bytesOf(3))
        const scheduler = createScheduler({ seed: 2 })
        let answer: Map<string, Uint8Array | null> | undefined
        scheduler.spawn('a', async (actor) => {
            answer = await splitReadUnits(actor.backend(memory)).readUnits(keys)
        })
        await scheduler.run()
        expect(scheduler.log.map((entry) => entry.op)).toEqual(['readUnits', 'readUnits', 'readUnits'])
        expect(new Set(scheduler.log.map((entry) => entry.target))).toEqual(new Set(keys))
        expect([...answer!.keys()]).toEqual(keys)
        expect(answer!.get(keys[0])).toEqual(bytesOf(1))
        expect(answer!.get(keys[1])).toBeNull()
        expect(answer!.get(keys[2])).toEqual(bytesOf(3))
    })

    test('splitReadUnits still refuses a repeated key and does not schedule an empty read', async () => {
        const memory = createMemoryBackend()
        const [key] = unitKeys(1)
        const scheduler = createScheduler({ seed: 2 })
        let failure: unknown
        scheduler.spawn('a', async (actor) => {
            const backend = splitReadUnits(actor.backend(memory))
            expect((await backend.readUnits([])).size).toBe(0)
            try {
                await backend.readUnits([key, key])
            } catch (error) {
                failure = error
            }
        })
        await scheduler.run()
        expect(failure).toBeInstanceOf(RangeError)
        expect(scheduler.log).toEqual([])
    })

    test('shuffleListing permutes every listing by its seed and loses no key', async () => {
        const memory = createMemoryBackend()
        const keys = unitKeys(20)
        for (const key of keys) {
            await memory.putUnit(key, bytesOf(1))
        }
        const sorted = await memory.listStore2()
        const first = await shuffleListing(memory, createRng(7)).listStore2()
        const again = await shuffleListing(memory, createRng(7)).listStore2()
        const other = await shuffleListing(memory, createRng(8)).listStore2()
        expect(first).toEqual(again)
        expect(first).not.toEqual(sorted)
        expect(first).not.toEqual(other)
        expect([...first].sort()).toEqual(sorted)
    })

    test.each(['node', 'tauri'] as const)('the %s replay rig answers a listing as a seeded permutation of the sorted keys and loses none', async (variant) => {
        const seen = new Set<string>()
        for (const seed of [1, 2, 3, 4]) {
            const options = { scheduler: { seed }, prepare: (hooks: { plant: (key: string, bytes: Uint8Array) => void }, env: KeyEnv) => plantGarbageUnits(hooks.plant, env, 60) }
            const rig = variant === 'node' ? await createNodeReplayRig(options) : await createTauriReplayRig(options)
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

    test('the decorators pass every other method through unchanged', async () => {
        const memory = createMemoryBackend()
        const [key] = unitKeys(1)
        const decorated = shuffleListing(splitReadUnits(memory), createRng(1))
        await decorated.putUnit(key, bytesOf(9))
        expect((await decorated.readUnits([key])).get(key)).toEqual(bytesOf(9))
        expect(await decorated.countPrefix('store2/')).toBe(1)
        expect((await decorated.readCommit()).bytes).toBeNull()
    })
})

describe('fingerprint', () => {
    test('it depends on the key set, the revisions, the commit-key and fence bytes and the actors\' progress', async () => {
        const rig = nodeRig()
        const scheduler = createScheduler({ seed: 1 })
        scheduler.spawn('a', async (actor) => {
            const store = actor.byteStore(rig.fake.store)
            await store.read('k/x')
            await store.read('k/x')
        })
        const start = scheduler.fingerprint(rig.raw())
        expect(scheduler.fingerprint(rig.raw())).toBe(start)
        await scheduler.run()
        const finished = scheduler.fingerprint(rig.raw())
        expect(finished).not.toBe(start)

        const base = scheduler.fingerprint(rig.raw())
        await rig.fake.store.write('k/y', bytesOf(1), 'unconditional')
        const withKey = scheduler.fingerprint(rig.raw())
        expect(withKey).not.toBe(base)
        await rig.fake.store.write('k/y', bytesOf(1), 'unconditional')
        expect(scheduler.fingerprint(rig.raw())).not.toBe(withKey)
        await rig.fake.store.write(COMMIT_KEY, bytesOf(1), 'unconditional')
        const withCommit = scheduler.fingerprint(rig.raw())
        rig.fake.damage(COMMIT_KEY, bytesOf(2))
        expect(scheduler.fingerprint(rig.raw())).not.toBe(withCommit)
    })
})

describe('flush faults and page restarts on the Tauri-semantics store', () => {
    const FENCE = 'store2-fence'

    async function runPage(options: { faults?: FaultPlan, unflushed?: boolean, seed?: number }, body: (store: ByteStore, fake: TauriSemanticStore, scheduler: Scheduler) => Promise<void>) {
        const fake = createTauriSemanticStore()
        const scheduler = createScheduler({
            seed: options.seed ?? 1,
            faults: options.faults,
            ...(options.unflushed === false ? {} : { unflushed: (key: string) => fake.markUnflushed(key) }),
        })
        scheduler.spawn('a', async (actor) => {
            await body(actor.byteStore(fake.store), fake, scheduler)
        }, { page: 'p' })
        const result = await scheduler.run()
        return { fake, scheduler, result }
    }

    test('a scripted flush fault applies the write, reports flushed:false and tells the store; the next flushed write ends it', async () => {
        const reports: Array<boolean | undefined> = []
        const { fake, scheduler, result } = await runPage(
            { faults: { mode: 'script', entries: [{ actor: 'a', kind: 'flush-fault', op: 'writeTop', target: COMMIT_KEY }] } },
            async (store, fake) => {
                const gen = await store.pageGate!.registerPage()
                reports.push((await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(1))).flushed)
                expect(fake.unflushed()).toEqual([COMMIT_KEY])
                reports.push((await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(2))).flushed)
            },
        )
        expect(result.status).toBe('finished')
        expect(reports).toEqual([false, true])
        expect(fake.peek(COMMIT_KEY)).toEqual(bytesOf(2))
        expect(fake.unflushed()).toEqual([])
        const entry = scheduler.log.find((each) => each.fault === 'flush-fault')
        expect(entry).toMatchObject({ op: 'writeTop', target: COMMIT_KEY, outcome: 'flush-fault' })
    })

    test('the flush fault step is applied: the checker would see the written bytes on that very step', async () => {
        const seen: StepInfo[] = []
        const fake = createTauriSemanticStore()
        const scheduler = createScheduler({
            seed: 1,
            faults: { mode: 'script', entries: [{ actor: 'a', kind: 'flush-fault', op: 'writeTop', target: FENCE }] },
            unflushed: (key) => fake.markUnflushed(key),
            onStep: (info) => { seen.push({ ...info }) },
        })
        scheduler.spawn('a', async (actor) => {
            const store = actor.byteStore(fake.store)
            await store.pageGate!.writeTop(await store.pageGate!.registerPage(), FENCE, bytesOf(1))
        }, { page: 'p' })
        await scheduler.run()
        const step = seen.find((info) => info.fault === 'flush-fault')
        expect(step).toMatchObject({ applied: true, kind: 'call', op: 'writeTop', target: FENCE })
        expect(fake.peek(FENCE)).toEqual(bytesOf(1))
    })

    test('a flush fault on a store with no flush status fails the run instead of being skipped', async () => {
        const fake = createTauriSemanticStore()
        const scheduler = createScheduler({ seed: 1, faults: { mode: 'script', entries: [{ actor: 'a', kind: 'flush-fault', op: 'writeTop', target: COMMIT_KEY }] } })
        scheduler.spawn('a', async (actor) => {
            const store = actor.byteStore(fake.store)
            await store.pageGate!.writeTop(await store.pageGate!.registerPage(), COMMIT_KEY, bytesOf(1))
        }, { page: 'p' })
        await expect(scheduler.run()).rejects.toThrow(/flush-fault/)
    })

    test('a scripted flush fault spends the lost-call budget', () => {
        const entries = [
            { actor: 'a', kind: 'flush-fault' as const, op: 'writeTop', target: COMMIT_KEY },
            { actor: 'a', kind: 'lost-response' as const, op: 'writeTop', target: FENCE },
        ]
        expect(() => createScheduler({ seed: 1, faults: { mode: 'script', entries, budget: { lostPerActor: 1, crashPerActor: 0 } } })).toThrow(RangeError)
    })

    test('a random plan draws the flush fault only with flushFaults, and then within the lost-call budget', async () => {
        async function kindsOf(flushFaults: boolean | undefined): Promise<string[]> {
            const kinds: string[] = []
            for (let seed = 1; seed <= 12; seed++) {
                const { scheduler } = await runPage(
                    { seed, faults: { mode: 'random', probability: 1, budget: { lostPerActor: 2, crashPerActor: 0 }, ...(flushFaults === undefined ? {} : { flushFaults }) } },
                    async (store) => {
                        const gen = await store.pageGate!.registerPage().catch(() => 0)
                        for (let i = 0; i < 4; i++) {
                            await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(i)).catch(() => undefined)
                        }
                    },
                )
                const faulted = scheduler.log.filter((entry) => entry.fault !== null)
                expect(faulted.length, `seed ${seed}`).toBeLessThanOrEqual(2)
                kinds.push(...faulted.map((entry) => entry.fault as string))
            }
            return kinds
        }
        expect(await kindsOf(undefined)).not.toContain('flush-fault')
        expect(await kindsOf(false)).not.toContain('flush-fault')
        expect(await kindsOf(true)).toContain('flush-fault')
    })

    test('restartPage is an environment step of its own: logged as $env, judged as restart, and its answer is the log outcome', async () => {
        const seen: StepInfo[] = []
        const fake = createTauriSemanticStore()
        const scheduler = createScheduler({ seed: 1, onStep: (info) => { seen.push({ ...info }) } })
        scheduler.spawn('a', async (actor) => {
            await actor.restartPage(() => `dropped=${fake.restart(true).length}`)
        }, { page: 'p' })
        const result = await scheduler.run()
        expect(result.actors.a.state).toBe('done')
        expect(scheduler.log).toMatchObject([{ actor: '$env', op: 'restart', fault: 'restart', outcome: 'env:dropped=0' }])
        expect(seen).toMatchObject([{ kind: 'env', actor: '$env', op: 'restart', fault: 'restart', applied: true, context: null }])
    })

    test('a restart retires the other actors of the page and drops their ungranted calls, and leaves another page alone', async () => {
        let retiredCalls = 0
        for (let seed = 1; seed <= 12; seed++) {
            const fake = createTauriSemanticStore()
            const scheduler = createScheduler({ seed })
            let restarted = false
            scheduler.spawn('a', async (actor) => {
                await actor.restartPage(() => 'dropped=0')
                restarted = true
                // Calls after the restart still run: the restarting actor is the new page.
                await actor.byteStore(fake.store).read('k/a')
            }, { page: 'p' })
            scheduler.spawn('b', async (actor) => {
                const store = actor.byteStore(fake.store)
                for (let i = 0; i < 6; i++) {
                    await store.read('k/b')
                    retiredCalls += restarted ? 1 : 0
                }
            }, { page: 'p' })
            scheduler.spawn('c', async (actor) => {
                const store = actor.byteStore(fake.store)
                for (let i = 0; i < 3; i++) {
                    await store.read('k/c')
                }
            }, { page: 'q' })
            const result = await scheduler.run()
            expect(result.status, `seed ${seed}`).toBe('finished')
            expect(result.actors.a.state, `seed ${seed}`).toBe('done')
            expect(['crashed', 'done'], `seed ${seed}`).toContain(result.actors.b.state)
            expect(result.actors.c.state, `seed ${seed}`).toBe('done')
        }
        // A retired actor's call never resolves after the restart step, so none of b's reads completes once `restarted` is set.
        expect(retiredCalls).toBe(0)
    })

    test('an actor of no page cannot restart one', async () => {
        const scheduler = createScheduler({ seed: 1 })
        let refusal = ''
        scheduler.spawn('a', async (actor) => {
            await actor.restartPage(() => 'dropped=0').catch((error: unknown) => { refusal = error instanceof RangeError ? error.message : 'other' })
        })
        await scheduler.run()
        expect(refusal).toMatch(/no page/)
    })

    test('a flush fault, then a restart that drops it: the write is gone from the store', async () => {
        const { fake, scheduler } = await runPage(
            { faults: { mode: 'script', entries: [{ actor: 'a', kind: 'flush-fault', op: 'writeTop', target: COMMIT_KEY }] } },
            async (store, fake) => {
                const gen = await store.pageGate!.registerPage()
                await store.pageGate!.writeTop(gen, COMMIT_KEY, bytesOf(1))
                expect(fake.peek(COMMIT_KEY)).toEqual(bytesOf(1))
            },
        )
        expect(fake.unflushed()).toEqual([COMMIT_KEY])
        const dropped = fake.restart(true)
        expect(dropped).toEqual([COMMIT_KEY])
        expect(fake.peek(COMMIT_KEY)).toBeNull()
        expect(scheduler.log.some((entry) => entry.fault === 'flush-fault')).toBe(true)
    })
})
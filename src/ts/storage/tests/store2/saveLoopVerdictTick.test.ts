// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Committer } from '../../store2/commit'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import type { ListDerivation } from '../../store2/codec'
import { stubFromEntry } from '../../store2/codec'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { runStore2SaveLoop, type Store2LoopPort, type UnsavableCharacter } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { buildSmall, fakeLists, seededEnv } from './codecFixtures'

/**
 * The idle net's verdict slot (CHORE-205 stage 1b): an ordinary slot reads the peer, judges one resident against the
 * acknowledged encoding and passes only a character that differs, silently. The loop runs over a real memory backend and
 * committer with a hand-built port whose clock the test sets. A slot is observed through its base reads, its verdict
 * calls and the plans that reach the encoder.
 * Labels: reproducer (fails against the pre-fix base), guard (passes before and after), equivalence.
 */

type Entry = Record<string, unknown>

interface Slot {
    reads: number
    verdicts: string[]
    requests: SavePassRequest[]
}

interface World {
    kit: Store2Kit
    db: Database
    /** The encoder the loop saves through; a test may replace a method to inject a fault. */
    encoder: SaveEncoder
    tracker: toSaveType
    clock: { now: number }
    start: number
    requests: SavePassRequest[]
    verdicts: string[]
    counted: { reads: number, sweeps: number, begun: number }
    state: { due: boolean, dirty: boolean }
    failures: unknown[]
    crashed: unknown[]
    unsavableCalls: Array<{ current: readonly UnsavableCharacter[], newly: readonly UnsavableCharacter[] }>
    /** Moves the clock to `offset` ms after the loop's start and waits for the full tick that follows to reach the encoder. */
    tickAt(offset: number): Promise<SavePassRequest>
    /** Moves the clock to `offset` ms after the loop's start and waits for the slot that follows to end, whatever it did. */
    slotAt(offset: number): Promise<Slot>
    stop(): void
}

const worlds: World[] = []

afterEach(() => {
    for (const world of worlds) {
        world.stop()
    }
    worlds.length = 0
    vi.restoreAllMocks()
})

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
}

function idOf(db: Database, index: number): string {
    return String(chars(db)[index].chaId)
}

function pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function cyclic(): Entry {
    const value: Entry = {}
    value.self = value
    return value
}

interface StartOptions {
    lists?: ListDerivation
    /** Replaces the committer before the loop reads it and the reads are counted. */
    configure?: (kit: Store2Kit) => void
    /** Runs after the encoder is in place and before the loop starts. */
    prepare?: (kit: Store2Kit, inner: SaveEncoder) => Promise<void>
}

async function startWorld(db: Database, options: StartOptions = {}): Promise<World> {
    const kit = await startStore2({ db, idleNet: { intervalMs: 1 }, lists: options.lists })
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const verdicts: string[] = []
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    encoder.verdictOf = (slot) => {
        verdicts.push(String((slot as { chaId?: unknown }).chaId))
        return inner.verdictOf(slot)
    }
    kit.context.encoder = encoder
    options.configure?.(kit)
    const counted = { reads: 0, sweeps: 0, begun: 0 }
    const real = kit.context.session.committer as Committer
    const counting: Committer = {
        ...real,
        async readCommit() {
            counted.reads += 1
            return real.readCommit()
        },
    }
    kit.context.session = { ...kit.context.session, committer: counting }
    await options.prepare?.(kit, inner)
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const clock = { now: 1_800_000_000_000 }
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const state = { due: false, dirty: false }
    const world: World = {
        kit, db, encoder, tracker, clock, start: clock.now, requests, verdicts, counted, state,
        failures: [],
        crashed: [],
        unsavableCalls: [],
        async tickAt(offset) {
            const before = requests.length
            clock.now = world.start + offset
            await until(() => requests.length > before, `the tick at +${offset} ms`, 4000)
            return requests[requests.length - 1]
        },
        async slotAt(offset) {
            const reads = counted.reads
            const judged = verdicts.length
            const planned = requests.length
            clock.now = world.start + offset
            await until(() => counted.reads > reads, `the slot at +${offset} ms to read the base`, 4000)
            // The loop reaches its next iteration only once the slot has ended.
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps, `the slot at +${offset} ms to end`, 4000)
            return { reads: counted.reads - reads, verdicts: verdicts.slice(judged), requests: requests.slice(planned) }
        },
        stop() {
            stopped = true
        },
    }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack(live, snapshot) {
            live.modules ||= snapshot.modules
        },
        liveCheck: () => {},
        sweep() {
            counted.sweeps += 1
        },
        isDue: () => state.due,
        isDirty: () => state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            counted.begun += 1
            state.due = false
        },
        endIteration: () => {},
        snapshotTaken() {
            state.dirty = false
        },
        requestPass() {
            state.dirty = true
            state.due = true
        },
        unsavable(current, newly) {
            world.unsavableCalls.push({ current, newly })
        },
        saved: () => {},
        broadcast: () => {},
        peerHeard: () => false,
        setStopped: () => {},
        reportFailure(error) {
            world.failures.push(error)
            return 1
        },
        reportUncountedFailure(error) {
            world.failures.push(error)
            return 1
        },
        async withWriteLock(work) {
            const before = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await work()
            } finally {
                release()
            }
        },
        wait: idle,
        sleep: () => idle(),
        sleepForever: () => new Promise<never>(() => {}),
        now: () => clock.now,
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        world.crashed.push(error)
    })
    worlds.push(world)
    return world
}

/** An ordinary slot over a clean resident, or none: one base read, no plan. */
function expectQuietSlot(slot: Slot): void {
    expect(slot.reads).toBe(1)
    expect(slot.requests).toEqual([])
}

describe('R1 and R2: an ordinary slot over a clean page plans no full pass', () => {
    test('reproducer R1: with no resident character, ordinary slots read the peer and plan nothing', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        for (const offset of [2_000, 4_000, 6_000, 8_000]) {
            const slot = await world.slotAt(offset)
            expectQuietSlot(slot)
            expect(slot.verdicts).toEqual([])
        }
        expect(world.requests).toEqual([])
        expect(world.failures).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('reproducer R2: with one clean resident, an ordinary slot judges it and plans nothing', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        for (const offset of [2_000, 4_000, 6_000]) {
            const slot = await world.slotAt(offset)
            expectQuietSlot(slot)
            expect(slot.verdicts).toEqual([idOf(db, 0)])
        }
        expect(world.counted.begun).toBe(0)
        expect(world.crashed).toEqual([])
    })

    test('reproducer: a page of several clean residents plans nothing and visits them round-robin', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        const visited: string[] = []
        for (const offset of [2_000, 4_000, 6_000, 8_000, 10_000]) {
            const slot = await world.slotAt(offset)
            expectQuietSlot(slot)
            visited.push(...slot.verdicts)
        }
        expect(visited).toEqual([0, 1, 2, 3, 0].map(index => idOf(db, index)))
    })
})

describe('an edit nothing marked reaches the disk through the verdict', () => {
    test('reproducer: an unmarked in-place edit of a non-selected resident is saved by the slot of its turn, silently', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[2].personality = 'edited in place, nothing marked'
        expectQuietSlot(await world.slotAt(2_000))
        expectQuietSlot(await world.slotAt(4_000))
        expect((await world.kit.saved()).characters[2]).not.toMatchObject({ personality: 'edited in place, nothing marked' })
        const slot = await world.slotAt(6_000)
        expect(slot.verdicts).toEqual([idOf(db, 2)])
        expect(slot.requests).toHaveLength(1)
        // The silent pass: it names the judged character, takes no module scope and begins no iteration.
        expect(slot.requests[0].marked.size).toBe(0)
        expect(slot.requests[0].modules).toBe(false)
        expect(slot.requests[0].whole).toBe(false)
        expect(slot.requests[0].net).toEqual({ chaId: idOf(db, 2), modules: false })
        expect((await world.kit.saved()).characters[2]).toMatchObject({ personality: 'edited in place, nothing marked' })
        expect(world.counted.begun).toBe(0)
        expect(world.failures).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('reproducer: a lastInteraction-only edit of a non-selected resident is saved within the same bound', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].lastInteraction = 424242
        expectQuietSlot(await world.slotAt(2_000))
        const slot = await world.slotAt(4_000)
        expect(slot.verdicts).toEqual([idOf(db, 1)])
        expect(slot.requests).toHaveLength(1)
        expect((await world.kit.saved()).characters[1]).toMatchObject({ lastInteraction: 424242 })
    })

    test('guard: a dirty verdict advances the round-robin index exactly once', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = 'edited in place, nothing marked'
        const visited: string[] = []
        for (const offset of [2_000, 4_000, 6_000, 8_000, 10_000]) {
            visited.push(...(await world.slotAt(offset)).verdicts)
        }
        // Index 1 was judged dirty and passed; the next slots go on to 2, 3 and back to 0, never 1 again and never past 2.
        expect(visited).toEqual([0, 1, 2, 3, 0].map(index => idOf(db, index)))
    })

    test('reproducer: an unmarked fixed-group edit is written by the 30 s full tick, not by the slots before it (MC-374 1)', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        ;(db.botPresets as unknown as Entry[])[0].temperature = 0.1234
        expectQuietSlot(await world.slotAt(2_000))
        expectQuietSlot(await world.slotAt(4_000))
        await pause(60)
        expect(((await world.kit.saved()).botPresets as unknown as Entry[])[0].temperature).not.toBe(0.1234)
        await world.tickAt(30_000)
        await until(async () => ((await world.kit.saved()).botPresets as unknown as Entry[])[0].temperature === 0.1234, 'the 30 s full tick to write the preset edit', 4000)
        expect(world.crashed).toEqual([])
    })

    test('guard: a new character with no mark reaches the disk at the next slot', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        const slot = await world.slotAt(2_000)
        expect(slot.requests.length).toBeGreaterThanOrEqual(1)
        expect((await world.kit.saved()).characters).toHaveLength(4)
        expect(world.crashed).toEqual([])
    })

    test('guard: a stub rename without a mark reaches the disk at the next slot', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const entries = (world.kit.context.previous.objects?.shards ?? []).flatMap(shard => shard.entries)
        const entry = entries.find(candidate => candidate.chaId === idOf(db, 1))
        expect(entry).toBeDefined()
        const stub = stubFromEntry(entry as NonNullable<typeof entry>) as unknown as Entry
        chars(db)[1] = stub
        const slot = await world.slotAt(2_000)
        expect(slot.requests).toHaveLength(0)
        stub.name = 'Renamed stub'
        const renamed = await world.slotAt(4_000)
        expect(renamed.requests.length).toBeGreaterThanOrEqual(1)
        // The overlay lives in the shard entry, so the acknowledged entry is what the rename reached.
        const nameOnDisk = () => (world.encoder.acknowledged().objects?.shards ?? []).flatMap(shard => shard.entries).find(candidate => candidate.chaId === idOf(db, 1))?.name
        await until(() => nameOnDisk() === 'Renamed stub', 'the renamed stub to reach the disk', 4000)
        const key = (await world.kit.commitKey()).current?.key
        expect(key).toBe(world.encoder.manifestKey)
        expect(world.crashed).toEqual([])
    })
})

describe('the fallbacks to a full pass', () => {
    test('guard: a verdict that throws leaves the loop ticking, and the next slot still runs', async () => {
        const fault = { on: false }
        const lists: ListDerivation = {
            ...fakeLists,
            characterAssets: (owner) => {
                if (fault.on) {
                    throw new Error('list derivation fault')
                }
                return fakeLists.characterAssets(owner)
            },
        }
        const db = clone(buildSmall(3))
        const world = await startWorld(db, { lists })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        fault.on = true
        const faulted = await world.slotAt(2_000)
        expect(faulted.verdicts).toEqual([idOf(db, 0)])
        expect(world.crashed).toEqual([])
        fault.on = false
        chars(db)[1].personality = 'edited after the fault'
        const next = await world.slotAt(4_000)
        expect(next.verdicts).toEqual([idOf(db, 1)])
        expect((await world.kit.saved()).characters[1]).toMatchObject({ personality: 'edited after the fault' })
        expect(world.crashed).toEqual([])
    })

    test('guard: a fault in the checks falls back to the full tick and the loop goes on (the H1 guard)', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        const real = world.encoder.unheldChaIds
        let throws = 1
        world.encoder.unheldChaIds = (checked) => {
            if (throws > 0) {
                throws -= 1
                throw new Error('the check fault')
            }
            return real(checked)
        }
        const faulted = await world.slotAt(2_000)
        expect(faulted.requests).toHaveLength(1)
        expect(logged).toHaveBeenCalled()
        expect(world.crashed).toEqual([])
        expectQuietSlot(await world.slotAt(4_000))
    })

    test('guard: a base read that keeps failing is reported within one slot and sets no peer latch; the 30 s full tick still runs', async () => {
        const db = clone(buildSmall(3))
        const failing = { reads: true }
        const world = await startWorld(db, {
            configure(kit) {
                const real = kit.committer
                const scripted: Committer = {
                    ...real,
                    async readCommit() {
                        if (failing.reads) {
                            throw new Error('the base read failed')
                        }
                        return real.readCommit()
                    },
                }
                kit.context.session = { ...kit.context.session, committer: scripted }
            },
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const slot = await world.slotAt(2_000)
        // The slot's own read, then the full tick's read, which reports it.
        expect(slot.reads).toBe(2)
        expect(world.failures).toHaveLength(1)
        await pause(80)
        // A latch would make the loop read again on every iteration until the clock moved.
        expect(world.counted.reads).toBe(2)
        expect(world.crashed).toEqual([])
        failing.reads = false
        const tick = await world.tickAt(30_000)
        expect(tick.modules || tick.net?.modules === true).toBe(true)
    })

    test('guard: a slot whose base read finds the page due ends without a verdict, and the marked pass follows', async () => {
        const db = clone(buildSmall(3))
        let fired = false
        const world = await startWorld(db, {
            configure(kit) {
                const real = kit.committer
                const scripted: Committer = {
                    ...real,
                    async readCommit() {
                        const read = await real.readCommit()
                        if (world.clock.now > world.start && !fired) {
                            fired = true
                            world.state.due = true
                            world.state.dirty = true
                        }
                        return read
                    },
                }
                kit.context.session = { ...kit.context.session, committer: scripted }
            },
        })
        const slot = await world.slotAt(2_000)
        expect(slot.verdicts).toEqual([])
        await until(() => world.counted.begun === 1, 'the marked pass to follow', 4000)
        expect(world.crashed).toEqual([])
    })

    test('equivalence: a pending attempt that landed is adopted by the slot, and a clean page then plans nothing', async () => {
        const db = clone(buildSmall(3))
        let inner: SaveEncoder | null = null
        const world = await startWorld(db, {
            async prepare(kit, encoder) {
                inner = encoder
                const read = await kit.committer.readCommit()
                const plan = await encoder.plan(db, { marked: new Set([idOf(db, 0)]), modules: false, whole: false })
                const result = await kit.committer.commit(read, plan.commitRequest())
                expect(result.status).toBe('committed')
                plan.keepAsPending()
                expect(encoder.pendingKey).not.toBeNull()
            },
        })
        expectQuietSlot(await world.slotAt(2_000))
        expect((inner as SaveEncoder | null)?.pendingKey).toBeNull()
    })

    test('guard: a pending attempt that did not land is resolved by a full tick within the slot', async () => {
        const db = clone(buildSmall(3))
        let inner: SaveEncoder | null = null
        const world = await startWorld(db, {
            async prepare(_kit, encoder) {
                inner = encoder
                const plan = await encoder.plan(db, { marked: new Set([idOf(db, 0)]), modules: false, whole: false })
                const { mint } = createKeyMint(seededEnv(900), null)
                const context: BuildContext = { mint, seq: 2, now: 1_700_000_000_000 }
                await plan.commitRequest().build(context)
                plan.keepAsPending()
                expect(encoder.pendingKey).not.toBeNull()
            },
        })
        const slot = await world.slotAt(2_000)
        expect(slot.requests).toHaveLength(1)
        expect((inner as SaveEncoder | null)?.pendingKey).toBeNull()
        expect(world.failures).toEqual([])
    })
})

describe('the module clock (MC-372 1)', () => {
    function modulesIn(db: Database): Entry[] {
        return db.modules as unknown as Entry[]
    }

    async function savedDescription(world: World): Promise<unknown> {
        return modulesIn(await world.kit.saved())[1].description
    }

    function takesModules(request: SavePassRequest): boolean {
        return request.whole || request.rewriteAll === true || request.modules || request.net?.modules === true
    }

    test('reproducer: a fallback full tick before the modules are due takes no module scope, and the 30 s slot writes the module edit', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        modulesIn(db)[1].description = 'unflagged module edit'
        // A character no mark names is a step-4 fallback: a full tick runs at once, ahead of the module clock.
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        const early = await world.slotAt(2_000)
        expect(early.requests.length).toBeGreaterThanOrEqual(1)
        expect(early.requests.some(takesModules)).toBe(false)
        expect((await world.kit.saved()).characters).toHaveLength(4)
        expect(await savedDescription(world)).not.toBe('unflagged module edit')
        const due = await world.tickAt(30_000)
        expect(takesModules(due)).toBe(true)
        await until(async () => await savedDescription(world) === 'unflagged module edit', 'the 30 s slot to write the module edit', 4000)
        expect(world.crashed).toEqual([])
    })

    test('guard: an override pass shortly before the modules are due leaves the module clock alone', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        modulesIn(db)[1].description = 'unflagged module edit'
        chars(db)[0].personality = 'edited in place, nothing marked'
        const override = await world.slotAt(28_000)
        expect(override.requests).toHaveLength(1)
        expect(override.requests[0].net).toEqual({ chaId: idOf(db, 0), modules: false })
        const due = await world.tickAt(30_000)
        expect(takesModules(due)).toBe(true)
        await until(async () => await savedDescription(world) === 'unflagged module edit', 'the 30 s slot to write the module edit', 4000)
        expect(world.crashed).toEqual([])
    })
})

describe('a pending attempt with no resident character', () => {
    test('guard (passes on the base, kills a dropped pending check): a pending attempt that did not land is resolved by a full tick within the slot', async () => {
        const db = clone(buildSmall(0))
        let inner: SaveEncoder | null = null
        const world = await startWorld(db, {
            async prepare(_kit, encoder) {
                inner = encoder
                const plan = await encoder.plan(db, { marked: new Set(), modules: false, whole: false })
                const { mint } = createKeyMint(seededEnv(900), null)
                const context: BuildContext = { mint, seq: 2, now: 1_700_000_000_000 }
                await plan.commitRequest().build(context)
                plan.keepAsPending()
                expect(encoder.pendingKey).not.toBeNull()
            },
        })
        const slot = await world.slotAt(2_000)
        expect(slot.requests).toHaveLength(1)
        expect((inner as SaveEncoder | null)?.pendingKey).toBeNull()
        expect(world.failures).toEqual([])
    })
})

describe('unsavable characters (A2)', () => {
    test('guard (passes on the base, kills a dropped A2 rule): a restored unsavable character is passed on its turn and its notice clears', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        const original = chars(db)[1].personality
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.unsavableCalls.length >= 1, 'the notice of the break', 4000)
        chars(db)[1].personality = original
        // The restored character is clean against the acknowledged copy it kept; only the unsavable set says a pass is owed.
        await world.slotAt(2_000)
        expect(world.unsavableCalls).toHaveLength(1)
        const turn = await world.slotAt(4_000)
        // An unsavable character is not judged: it reads as unknown, so its turn is a pass that names it.
        expect(turn.verdicts).toEqual([])
        expect(turn.requests.map(request => request.net?.chaId)).toEqual([idOf(db, 1)])
        expect(world.unsavableCalls).toHaveLength(2)
        expect(world.unsavableCalls[1].current).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('guard (passes on the base, kills a dropped removed-character rule): an unsavable character that is no longer present clears its notice within one slot', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.unsavableCalls.length >= 1, 'the notice of the break', 4000)
        chars(db).splice(1, 1)
        await world.slotAt(2_000)
        expect(world.unsavableCalls).toHaveLength(2)
        expect(world.unsavableCalls[1].current).toEqual([])
        expect(world.crashed).toEqual([])
    })
})

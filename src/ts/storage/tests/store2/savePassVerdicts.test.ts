// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import type { Committer } from '../../store2/commit'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import type { ListDerivation } from '../../store2/codec'
import { stubFromEntry } from '../../store2/codec'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import {
    noteNetSlotBegin, noteNetSlotEnd, noteNetSlotMs, noteNetSlotPart, startSavePass,
    type NetSlotPart, type NetSlotReason, type NetSlotTiming, type NetVerdictSummary, type SavePassMeterHandle,
} from '../../store2/savePassMeter'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { buildSmall, fakeLists, seededEnv } from './codecFixtures'

/**
 * The verdict tally of a measurement build (CHORE-205 stage 1c): every idle-net slot ends in exactly one counted way, a
 * slot that reached a verdict also counts its outcome, and the decision part of each slot is timed. The loop runs over a
 * real memory backend and committer with a hand-built port whose clock the test sets, so one `slotAt` is one slot.
 * These are meter tests of new behaviour, not regression reproducers.
 */

type Entry = Record<string, unknown>
type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }

interface World {
    kit: Store2Kit
    db: Database
    encoder: SaveEncoder
    tracker: toSaveType
    clock: { now: number }
    start: number
    requests: SavePassRequest[]
    counted: { reads: number, sweeps: number }
    state: { due: boolean, dirty: boolean }
    notices: number
    crashed: unknown[]
    /** Moves the clock to `offset` ms after the loop's start and waits for the slot that follows to end, whatever it did. */
    slotAt(offset: number): Promise<void>
    stop(): void
}

const worlds: World[] = []

function meterOf(): SavePassMeterHandle {
    const found = (globalThis as MeterGlobal).__risuSavePassMeter
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

beforeEach(() => {
    flag.measure = true
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    startSavePass()
    meterOf().reset()
})

afterEach(() => {
    for (const world of worlds) {
        world.stop()
    }
    worlds.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
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

function cyclic(): Entry {
    const value: Entry = {}
    value.self = value
    return value
}

interface StartOptions {
    lists?: ListDerivation
    configure?: (kit: Store2Kit) => void
    prepare?: (kit: Store2Kit, inner: SaveEncoder) => Promise<void>
    /** Runs when the test port grants the write lock, before the locked work starts. */
    onLockGranted?: () => void
}

async function startWorld(db: Database, options: StartOptions = {}): Promise<World> {
    const kit = await startStore2({ db, idleNet: { intervalMs: 1 }, lists: options.lists })
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    kit.context.encoder = encoder
    options.configure?.(kit)
    const counted = { reads: 0, sweeps: 0 }
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
        kit, db, encoder, tracker, clock, start: clock.now, requests, counted, state,
        notices: 0,
        crashed: [],
        async slotAt(offset) {
            const reads = counted.reads
            clock.now = world.start + offset
            await until(() => counted.reads > reads, `the slot at +${offset} ms to read the base`, 4000)
            // The loop reaches its next iteration only once the slot has ended.
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps, `the slot at +${offset} ms to end`, 4000)
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
        unsavable() {
            world.notices += 1
        },
        saved: () => {},
        broadcast: () => {},
        peerHeard: () => false,
        setStopped: () => {},
        reportFailure: () => 1,
        reportUncountedFailure: () => 1,
        async withWriteLock(work) {
            const before = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            options.onLockGranted?.()
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

function sumOf(ends: NetVerdictSummary['slotEnds']): number {
    return Object.values(ends).reduce((total, count) => total + count, 0)
}

/** The tally after `slots` slots: the ends sum to the slot count, and each reason not named in `expected` is zero. */
function expectEnds(slots: number, expected: Partial<Record<NetSlotReason, number>>): NetVerdictSummary {
    const tally = meterOf().verdicts()
    expect(tally.slots).toBe(slots)
    expect(sumOf(tally.slotEnds)).toBe(slots)
    expect(tally.decisionMs).toHaveLength(slots)
    for (const [reason, count] of Object.entries(tally.slotEnds)) {
        expect(count, reason).toBe(expected[reason as NetSlotReason] ?? 0)
    }
    return tally
}

describe('every slot ends in exactly one counted way', () => {
    test('noResident: a page with no resident character counts each slot', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        await world.slotAt(2_000)
        await world.slotAt(4_000)
        const tally = expectEnds(2, { noResident: 2 })
        expect(tally.outcomes).toEqual({ clean: 0, dirty: 0, unknown: 0 })
        expect(tally.slotPassMs).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('verdictClean and verdictDirty: the outcomes follow the verdicts, and only the dirty slot times a pass', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[2].personality = 'edited in place, nothing marked'
        for (const offset of [2_000, 4_000, 6_000, 8_000]) {
            await world.slotAt(offset)
        }
        const tally = expectEnds(4, { verdictClean: 3, verdictDirty: 1 })
        expect(tally.outcomes).toEqual({ clean: 3, dirty: 1, unknown: 0 })
        expect(tally.slotPassMs).toHaveLength(1)
        expect(world.crashed).toEqual([])
    })

    test('verdictUnknown: a verdict that throws is logged by the encoder and counts as unknown', async () => {
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
        const world = await startWorld(clone(buildSmall(3)), { lists })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        fault.on = true
        await world.slotAt(2_000)
        const tally = expectEnds(1, { verdictUnknown: 1 })
        expect(tally.outcomes).toEqual({ clean: 0, dirty: 0, unknown: 1 })
        expect(tally.slotPassMs).toHaveLength(1)
        expect(world.crashed).toEqual([])
    })

    test('verdictUnknown: an unsavable resident on its turn counts as unknown, and a removed one as unsavableAbsent', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        const original = chars(db)[1].personality
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.notices >= 1, 'the notice of the break', 4000)
        chars(db)[1].personality = original
        // The first slot judges character 0, the second reaches character 1, which the unsavable set makes unknown.
        await world.slotAt(2_000)
        await world.slotAt(4_000)
        expectEnds(2, { verdictClean: 1, verdictUnknown: 1 })
        expect(meterOf().verdicts().outcomes).toEqual({ clean: 1, dirty: 0, unknown: 1 })
        expect(world.crashed).toEqual([])
    })

    test('unsavableAbsent: an unsavable character that is no longer present sends the slot to a full pass', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.notices >= 1, 'the notice of the break', 4000)
        chars(db).splice(1, 1)
        await world.slotAt(2_000)
        expectEnds(1, { unsavableAbsent: 1 })
        expect(world.crashed).toEqual([])
    })

    test('modulesDue: the slot after the module interval is a full tick', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        await world.slotAt(2_000)
        await world.slotAt(30_000)
        const tally = expectEnds(2, { verdictClean: 1, modulesDue: 1 })
        expect(tally.slotPassMs).toHaveLength(1)
    })

    test('readFailed: a base read that throws ends the slot in a full tick, and the slot is counted once', async () => {
        const failing = { reads: true }
        const world = await startWorld(clone(buildSmall(3)), {
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
        await world.slotAt(2_000)
        expectEnds(1, { readFailed: 1 })
    })

    test('guardThrow: a fault in a check after the read ends the slot in a full tick', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        world.encoder.unheldChaIds = () => {
            throw new Error('the check fault')
        }
        await world.slotAt(2_000)
        const tally = expectEnds(1, { guardThrow: 1 })
        expect(tally.slotPassMs).toHaveLength(1)
        expect(world.crashed).toEqual([])
    })

    test('parked: a base the page did not write parks the loop and the slot is counted', async () => {
        let hide = false
        const world = await startWorld(clone(buildSmall(3)), {
            configure(kit) {
                const real = kit.committer
                const scripted: Committer = {
                    ...real,
                    async readCommit() {
                        const read = await real.readCommit()
                        return hide ? { ...read, bytes: null } : read
                    },
                }
                kit.context.session = { ...kit.context.session, committer: scripted }
            },
        })
        hide = true
        await world.slotAt(2_000)
        expectEnds(1, { parked: 1 })
        expect(world.requests).toEqual([])
    })

    test('dueAfterRead: a page that became due during the base read ends the slot without a verdict', async () => {
        let fired = false
        const world = await startWorld(clone(buildSmall(3)), {
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
        await world.slotAt(2_000)
        expectEnds(1, { dueAfterRead: 1 })
        expect(meterOf().verdicts().outcomes).toEqual({ clean: 0, dirty: 0, unknown: 0 })
    })

    test('pending: an attempt that did not land is resolved by a full tick', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, {
            async prepare(_kit, encoder) {
                const plan = await encoder.plan(db, { marked: new Set([idOf(db, 0)]), modules: false, whole: false })
                const { mint } = createKeyMint(seededEnv(900), null)
                const context: BuildContext = { mint, seq: 2, now: 1_700_000_000_000 }
                await plan.commitRequest().build(context)
                plan.keepAsPending()
            },
        })
        await world.slotAt(2_000)
        const tally = expectEnds(1, { pending: 1 })
        expect(tally.slotPassMs).toHaveLength(1)
    })

    test('unheld: a new character no entity holds sends the slot to a full pass', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        await world.slotAt(2_000)
        expectEnds(1, { unheld: 1 })
    })

    test('stub: a stub whose overlay differs from its acknowledged entry sends the slot to a full pass', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const entries = (world.kit.context.previous.objects?.shards ?? []).flatMap(shard => shard.entries)
        const entry = entries.find(candidate => candidate.chaId === idOf(db, 1))
        const stub = stubFromEntry(entry as NonNullable<typeof entry>) as unknown as Entry
        chars(db)[1] = stub
        await world.slotAt(2_000)
        stub.name = 'Renamed stub'
        await world.slotAt(4_000)
        const tally = meterOf().verdicts()
        expect(tally.slots).toBe(2)
        expect(sumOf(tally.slotEnds)).toBe(2)
        expect(tally.slotEnds.stub).toBe(1)
    })

    test('the reasons sum to the slot count over a mixed run', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = 'edited in place, nothing marked'
        let offset = 0
        for (let slot = 0; slot < 6; slot++) {
            offset += 2_000
            await world.slotAt(offset)
        }
        await world.slotAt(30_000)
        const tally = meterOf().verdicts()
        expect(tally.slots).toBe(7)
        expect(sumOf(tally.slotEnds)).toBe(7)
        expect(tally.slotEnds.modulesDue).toBe(1)
        expect(tally.outcomes.clean + tally.outcomes.dirty + tally.outcomes.unknown).toBe(6)
        expect(tally.decisionMs).toHaveLength(7)
        expect(tally.decisionMs.every(ms => Number.isFinite(ms) && ms >= 0)).toBe(true)
    })
})

const ALL_PARTS: readonly NetSlotPart[] = ['lockWaitMs', 'readMs', 'judgeMs', 'checksMs', 'verdictMs', 'primitiveMs', 'movedMs']

/** The single slot's timing record: the parts named in `taken` are finite non-negative numbers, every other part is null. */
function expectTiming(reason: NetSlotReason, taken: readonly NetSlotPart[]): NetSlotTiming {
    const tally = meterOf().verdicts()
    expect(tally.slotTimings).toHaveLength(tally.decisionMs.length)
    const timing = tally.slotTimings[tally.slotTimings.length - 1]
    expect(timing.reason).toBe(reason)
    expect(timing.decisionMs).toBe(tally.decisionMs[tally.decisionMs.length - 1])
    for (const part of ALL_PARTS) {
        if (taken.includes(part)) {
            expect(Number.isFinite(timing[part]) && (timing[part] as number) >= 0, `${part} of ${reason}`).toBe(true)
        } else {
            expect(timing[part], `${part} of ${reason}`).toBeNull()
        }
    }
    return timing
}

describe('the sub-timings of a slot decision', () => {
    const READ: readonly NetSlotPart[] = ['lockWaitMs', 'readMs', 'judgeMs']

    test('a clean verdict times every part, the primitive and the moved-field compare included', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        await world.slotAt(2_000)
        expectTiming('verdictClean', [...READ, 'checksMs', 'verdictMs', 'primitiveMs', 'movedMs'])
        expect(world.crashed).toEqual([])
    })

    test('a dirty primitive skips the moved-field compare', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db)[0].personality = 'edited in place, nothing marked'
        await world.slotAt(2_000)
        expectTiming('verdictDirty', [...READ, 'checksMs', 'verdictMs', 'primitiveMs'])
    })

    test('a verdict that throws inside the primitive keeps the verdict time and no primitive time', async () => {
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
        const world = await startWorld(clone(buildSmall(3)), { lists })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        fault.on = true
        await world.slotAt(2_000)
        expectTiming('verdictUnknown', [...READ, 'checksMs', 'verdictMs'])
    })

    test('an unsavable resident on its turn ends before any verdict', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        const original = chars(db)[1].personality
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.notices >= 1, 'the notice of the break', 4000)
        chars(db)[1].personality = original
        await world.slotAt(2_000)
        await world.slotAt(4_000)
        expectTiming('verdictUnknown', [...READ, 'checksMs'])
    })

    test('no resident: the checks are timed and no verdict is', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        await world.slotAt(2_000)
        expectTiming('noResident', [...READ, 'checksMs'])
    })

    test('unheld: the checks are timed and no verdict is', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        await world.slotAt(2_000)
        expectTiming('unheld', [...READ, 'checksMs'])
    })

    test('modulesDue: no read, no judge, no checks', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        await world.slotAt(30_000)
        expectTiming('modulesDue', [])
    })

    test('pending: the slot ends after the judge, before the checks', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, {
            async prepare(_kit, encoder) {
                const plan = await encoder.plan(db, { marked: new Set([idOf(db, 0)]), modules: false, whole: false })
                const { mint } = createKeyMint(seededEnv(900), null)
                const context: BuildContext = { mint, seq: 2, now: 1_700_000_000_000 }
                await plan.commitRequest().build(context)
                plan.keepAsPending()
            },
        })
        await world.slotAt(2_000)
        expectTiming('pending', READ)
    })

    test('readFailed: the lock wait and the failed read are timed, the judge is not', async () => {
        const world = await startWorld(clone(buildSmall(3)), {
            configure(kit) {
                const real = kit.committer
                const scripted: Committer = {
                    ...real,
                    async readCommit() {
                        throw new Error('the base read failed')
                    },
                }
                kit.context.session = { ...kit.context.session, committer: scripted }
            },
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await world.slotAt(2_000)
        expectTiming('readFailed', ['lockWaitMs', 'readMs'])
    })

    test('parked: the judge is timed and the checks are not', async () => {
        let hide = false
        const world = await startWorld(clone(buildSmall(3)), {
            configure(kit) {
                const real = kit.committer
                const scripted: Committer = {
                    ...real,
                    async readCommit() {
                        const read = await real.readCommit()
                        return hide ? { ...read, bytes: null } : read
                    },
                }
                kit.context.session = { ...kit.context.session, committer: scripted }
            },
        })
        hide = true
        await world.slotAt(2_000)
        expectTiming('parked', READ)
    })

    test('the slot records are aligned with decisionMs over a mixed run', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = 'edited in place, nothing marked'
        for (const offset of [2_000, 4_000, 6_000]) {
            await world.slotAt(offset)
        }
        await world.slotAt(30_000)
        const tally = meterOf().verdicts()
        expect(tally.slotTimings.map(timing => timing.decisionMs)).toEqual(tally.decisionMs)
        expect(tally.slotTimings.map(timing => timing.reason).filter(reason => reason === null)).toEqual([])
    })

    test('parts noted outside a slot record nothing, and the rings are capped', () => {
        noteNetSlotPart('judgeMs', 5)
        noteNetSlotMs(1)
        expect(meterOf().verdicts().slotTimings[0].judgeMs).toBeNull()
        meterOf().reset()
        for (let slot = 0; slot < 1_005; slot++) {
            noteNetSlotBegin()
            noteNetSlotPart('judgeMs', slot)
            noteNetSlotEnd('noResident')
            noteNetSlotMs(slot)
        }
        const tally = meterOf().verdicts()
        expect(tally.slotTimings).toHaveLength(1_000)
        expect(tally.decisionMs).toHaveLength(1_000)
        expect(tally.slotTimings[0]).toMatchObject({ judgeMs: 5, decisionMs: 5, reason: 'noResident' })
        expect(tally.slotTimings[999]).toMatchObject({ judgeMs: 1_004, decisionMs: 1_004 })
    })

    test('the switch turned on mid-slot: the slot is recorded with a null reason and no parts', () => {
        vi.stubGlobal('localStorage', { getItem: () => null })
        noteNetSlotBegin()
        noteNetSlotPart('judgeMs', 5)
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        noteNetSlotEnd('noResident')
        noteNetSlotMs(3)
        const tally = meterOf().verdicts()
        expect(tally.slotTimings).toEqual([
            { reason: null, decisionMs: 3, lockWaitMs: null, readMs: null, judgeMs: null, checksMs: null, verdictMs: null, primitiveMs: null, movedMs: null },
        ])
        expect(tally.decisionMs).toEqual([3])
    })

    test('the switch turned off mid-slot: neither ring records the slot', () => {
        noteNetSlotBegin()
        vi.stubGlobal('localStorage', { getItem: () => null })
        noteNetSlotEnd('noResident')
        noteNetSlotMs(3)
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        const tally = meterOf().verdicts()
        expect(tally.slotTimings).toEqual([])
        expect(tally.decisionMs).toEqual([])
    })

    test('the switch not on at the slot start: a begun slot records nothing', () => {
        vi.stubGlobal('localStorage', { getItem: () => null })
        noteNetSlotBegin()
        noteNetSlotPart('judgeMs', 5)
        noteNetSlotEnd('noResident')
        noteNetSlotMs(5)
        expect(meterOf().verdicts().slotTimings).toEqual([])
    })
})

/**
 * A clock the test advances by hand, so a part's value is exactly the time the test spent inside it. Installed after the
 * world started; `performance.now()` then reads the same value until a hook moves it, so every interval the meter takes
 * is 0 except where the test says time passed.
 */
function installHandClock(): { now: number } {
    const hand = { now: 1_000 }
    vi.spyOn(performance, 'now').mockImplementation(() => hand.now)
    return hand
}

describe('each part carries the time spent inside it', () => {
    const NONE: Partial<Record<NetSlotPart, number>> = { lockWaitMs: 0, readMs: 0, judgeMs: 0, checksMs: 0, verdictMs: 0, primitiveMs: 0, movedMs: 0 }

    function expectParts(expected: Partial<Record<NetSlotPart, number>>, decisionMs: number): void {
        const timing = meterOf().verdicts().slotTimings[0]
        expect(timing.reason).toBe('verdictClean')
        expect(timing.decisionMs).toBe(decisionMs)
        expect({ ...timing, reason: undefined, decisionMs: undefined }).toEqual({ ...NONE, ...expected, reason: undefined, decisionMs: undefined })
    }

    test('a slow base read lands in readMs and nowhere else', async () => {
        const armed = { on: false }
        let hand: { now: number } | null = null
        const world = await startWorld(clone(buildSmall(3)), {
            configure(kit) {
                const real = kit.committer
                const scripted: Committer = {
                    ...real,
                    async readCommit() {
                        const read = await real.readCommit()
                        // After the await, so a measured read that does not wait for the committer misses it.
                        if (armed.on && hand !== null) {
                            hand.now += 60
                        }
                        return read
                    },
                }
                kit.context.session = { ...kit.context.session, committer: scripted }
            },
        })
        hand = installHandClock()
        armed.on = true
        await world.slotAt(2_000)
        expectParts({ readMs: 60 }, 60)
    })

    test('a held write lock lands in lockWaitMs and nowhere else', async () => {
        const armed = { on: false }
        const handRef: { hand: { now: number } | null } = { hand: null }
        const world = await startWorld(clone(buildSmall(3)), {
            onLockGranted() {
                if (armed.on && handRef.hand !== null) {
                    handRef.hand.now += 80
                }
            },
        })
        handRef.hand = installHandClock()
        armed.on = true
        await world.slotAt(2_000)
        expectParts({ lockWaitMs: 80 }, 80)
    })

    test('a slow primitive lands in primitiveMs and verdictMs, not in the checks or the moved-field compare', async () => {
        const armed = { on: false }
        const handRef: { hand: { now: number } | null } = { hand: null }
        const lists: ListDerivation = {
            ...fakeLists,
            characterAssets: (owner) => {
                if (armed.on && handRef.hand !== null) {
                    handRef.hand.now += 20
                }
                return fakeLists.characterAssets(owner)
            },
        }
        const world = await startWorld(clone(buildSmall(3)), { lists })
        handRef.hand = installHandClock()
        armed.on = true
        await world.slotAt(2_000)
        const timing = meterOf().verdicts().slotTimings[0]
        expect(timing.primitiveMs).toBeGreaterThanOrEqual(20)
        expectParts({ primitiveMs: timing.primitiveMs as number, verdictMs: timing.primitiveMs as number }, timing.primitiveMs as number)
    })

    test('a slow primitive and a slow moved-field compare each land in their own part, and both in verdictMs', async () => {
        const db = clone(buildSmall(3))
        const handRef: { hand: { now: number } | null } = { hand: null }
        const lists: ListDerivation = {
            ...fakeLists,
            characterAssets: (owner) => {
                if (handRef.hand !== null) {
                    handRef.hand.now += 20
                }
                return fakeLists.characterAssets(owner)
            },
        }
        const world = await startWorld(db, { lists })
        const hand = installHandClock()
        handRef.hand = hand
        const target = chars(db)[0]
        const value = target.lastInteraction
        let reads = 0
        Object.defineProperty(target, 'lastInteraction', {
            configurable: true,
            enumerable: true,
            get() {
                // The primitive reads the field once; the later read is the moved-field compare's.
                reads += 1
                if (reads > 1) {
                    hand.now += 15
                }
                return value
            },
        })
        await world.slotAt(2_000)
        expect(reads).toBe(2)
        const timing = meterOf().verdicts().slotTimings[0]
        // The primitive's own time is whatever the list derivation cost; the compare adds exactly its 15.
        expect(timing.primitiveMs).toBeGreaterThanOrEqual(20)
        expectParts({ movedMs: 15, primitiveMs: timing.primitiveMs as number, verdictMs: (timing.primitiveMs as number) + 15 }, (timing.primitiveMs as number) + 15)
    })

    test('a slow check lands in checksMs and not in verdictMs', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        const hand = installHandClock()
        world.encoder.unheldChaIds = () => {
            hand.now += 7
            return []
        }
        await world.slotAt(2_000)
        expectParts({ checksMs: 7 }, 7)
    })

    test('a slow stub check lands in checksMs too', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        const hand = installHandClock()
        world.encoder.stubsNeedFullPass = () => {
            hand.now += 9
            return false
        }
        await world.slotAt(2_000)
        expectParts({ checksMs: 9 }, 9)
    })
})

describe('the tally records nothing when the measurement is off', () => {
    test('MEASURE false: the slot timings stay empty although slots run', async () => {
        flag.measure = false
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db)[1].personality = 'edited in place, nothing marked'
        await world.slotAt(2_000)
        await world.slotAt(4_000)
        expect(meterOf().verdicts().slotTimings).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('the stored switch not on: the slot timings stay empty although slots run', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        vi.stubGlobal('localStorage', { getItem: () => null })
        await world.slotAt(2_000)
        expect(meterOf().verdicts().slotTimings).toEqual([])
    })

    test('MEASURE false: slots run and nothing is counted', async () => {
        flag.measure = false
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db)[1].personality = 'edited in place, nothing marked'
        await world.slotAt(2_000)
        await world.slotAt(4_000)
        const tally = meterOf().verdicts()
        expect(tally.slots).toBe(0)
        expect(tally.decisionMs).toEqual([])
        expect(tally.slotPassMs).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('MEASURE false: the early-ending slots (due after the read, modules due, a new character) count nothing either', async () => {
        flag.measure = false
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
        await world.slotAt(2_000)
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        await world.slotAt(4_000)
        await world.slotAt(30_000)
        const tally = meterOf().verdicts()
        expect(tally.slots).toBe(0)
        expect(tally.decisionMs).toEqual([])
        expect(world.crashed).toEqual([])
    })

    test('the stored switch not on: slots run and nothing is counted', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        vi.stubGlobal('localStorage', { getItem: () => null })
        await world.slotAt(2_000)
        const tally = meterOf().verdicts()
        expect(tally.slots).toBe(0)
        expect(tally.decisionMs).toEqual([])
    })

    test('reset clears the tally', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        await world.slotAt(2_000)
        expect(meterOf().verdicts().slots).toBe(1)
        meterOf().reset()
        expect(meterOf().verdicts().slots).toBe(0)
    })
})

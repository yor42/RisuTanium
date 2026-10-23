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
import type { ShardEntry } from '../../store2/format'
import { residentChaIds, runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
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
        world.encoder.netScan = () => {
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

const ALL_PARTS: readonly NetSlotPart[] = [
    'lockWaitMs', 'readMs', 'judgeMs', 'checksMs', 'scanMs', 'unsavableMs', 'pruneMs', 'findMs', 'verdictMs', 'primitiveMs', 'movedMs',
]

const READ: readonly NetSlotPart[] = ['lockWaitMs', 'readMs', 'judgeMs']
// The checks a slot ran when it reached a resident lookup with no unsavable character to scan.
const CHECKS: readonly NetSlotPart[] = ['checksMs', 'scanMs', 'pruneMs']

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
    test('a clean verdict times every part, the primitive and the moved-field compare included', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        await world.slotAt(2_000)
        expectTiming('verdictClean', [...READ, ...CHECKS, 'findMs', 'verdictMs', 'primitiveMs', 'movedMs'])
        expect(world.crashed).toEqual([])
    })

    test('a dirty primitive skips the moved-field compare', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db)[0].personality = 'edited in place, nothing marked'
        await world.slotAt(2_000)
        expectTiming('verdictDirty', [...READ, ...CHECKS, 'findMs', 'verdictMs', 'primitiveMs'])
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
        expectTiming('verdictUnknown', [...READ, ...CHECKS, 'findMs', 'verdictMs'])
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
        expectTiming('verdictUnknown', [...READ, ...CHECKS, 'unsavableMs'])
    })

    test('no resident: the checks are timed and no verdict is', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        await world.slotAt(2_000)
        expectTiming('noResident', [...READ, ...CHECKS])
    })

    test('unheld: the checks are timed and no verdict is', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        await world.slotAt(2_000)
        expectTiming('unheld', [...READ, 'checksMs', 'scanMs'])
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
            {
                reason: null, decisionMs: 3, lockWaitMs: null, readMs: null, judgeMs: null, checksMs: null, scanMs: null,
                unsavableMs: null, pruneMs: null, findMs: null, verdictMs: null, primitiveMs: null, movedMs: null,
            },
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
        noteNetSlotPart('unsavableMs', 5)
        noteNetSlotPart('findMs', 5)
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
    // `unsavableMs` is null unless the slot scanned an unsavable character; every other part of a clean slot is a number.
    const NONE: Partial<Record<NetSlotPart, number | null>> = {
        lockWaitMs: 0, readMs: 0, judgeMs: 0, checksMs: 0, scanMs: 0, unsavableMs: null, pruneMs: 0, findMs: 0,
        verdictMs: 0, primitiveMs: 0, movedMs: 0,
    }

    function expectParts(expected: Partial<Record<NetSlotPart, number | null>>, decisionMs: number): void {
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

    /** Wraps the encoder's `netScan` so it answers as the real one does and takes `ms` more of the hand clock. */
    function slowScan(encoder: Pick<SaveEncoder, 'netScan'>, hand: { now: number }, ms: number): void {
        const real = encoder.netScan
        encoder.netScan = (checked) => {
            const scan = real(checked)
            hand.now += ms
            return scan
        }
    }

    /** Wraps the encoder's `pruneShadows` so it prunes as the real one does and takes `ms` more of the hand clock. */
    function slowPrune(encoder: Pick<SaveEncoder, 'pruneShadows'>, hand: { now: number }, ms: number): void {
        const real = encoder.pruneShadows
        encoder.pruneShadows = (residents) => {
            real(residents)
            hand.now += ms
        }
    }

    test('a slow scan lands in scanMs and checksMs and not in verdictMs', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        const hand = installHandClock()
        slowScan(world.encoder, hand, 7)
        await world.slotAt(2_000)
        expectParts({ checksMs: 7, scanMs: 7 }, 7)
    })

    test('a slow shadow prune lands in pruneMs and checksMs only', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        const hand = installHandClock()
        slowPrune(world.encoder, hand, 9)
        await world.slotAt(2_000)
        expectParts({ checksMs: 9, pruneMs: 9 }, 9)
    })

    /**
     * Makes every read of `db.characters` advance the hand clock by the next entry of `steps` (reads past the end add
     * nothing). `netScan` reads it once, `presentChaIds` twice and the final lookup once, so the entries place time
     * inside one of them.
     */
    function slowCharactersReads(db: object, hand: { now: number }, steps: readonly number[]): void {
        let stored = (db as { characters: unknown }).characters
        let reads = 0
        Object.defineProperty(db, 'characters', {
            configurable: true,
            enumerable: true,
            get() {
                hand.now += steps[reads] ?? 0
                reads += 1
                return stored
            },
            set(value: unknown) {
                stored = value
            },
        })
    }

    test('a slow read of the character list inside the scan lands in scanMs and checksMs only', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const hand = installHandClock()
        // The scan's one read; the final lookup is the second read and stays fast.
        slowCharactersReads(db, hand, [5])
        await world.slotAt(2_000)
        expectParts({ scanMs: 5, checksMs: 5 }, 5)
    })

    test('a slow final lookup lands in findMs and checksMs only', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const hand = installHandClock()
        slowCharactersReads(db, hand, [0, 13])
        await world.slotAt(2_000)
        expectParts({ findMs: 13, checksMs: 13 }, 13)
    })

    test('a slow unsavable scan lands in unsavableMs and checksMs only', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.notices >= 1, 'the notice of the break', 4000)
        chars(db)[1].personality = 'restored'
        const hand = installHandClock()
        // The scan's read comes first and stays fast; the two reads inside presentChaIds follow, then the lookup.
        slowCharactersReads(db, hand, [0, 4, 4])
        await world.slotAt(2_000)
        expectParts({ unsavableMs: 8, checksMs: 8 }, 8)
    })

    test('every sub-part carries its own time and they sum to checksMs', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.notices >= 1, 'the notice of the break', 4000)
        chars(db)[1].personality = 'restored'
        const hand = installHandClock()
        slowPrune(world.encoder, hand, 4)
        // The scan (one read), presentChaIds (two reads), then the final lookup.
        slowCharactersReads(db, hand, [3, 5, 5, 6])
        await world.slotAt(2_000)
        expectParts({ scanMs: 3, unsavableMs: 10, pruneMs: 4, findMs: 6, checksMs: 23 }, 23)
        const timing = meterOf().verdicts().slotTimings[0]
        const sum = (timing.scanMs as number) + (timing.unsavableMs as number) + (timing.pruneMs as number) + (timing.findMs as number)
        expect(sum).toBe(timing.checksMs)
    })

    test('unsavableMs is null when nothing is unsavable', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        await world.slotAt(2_000)
        const timing = expectTiming('verdictClean', [...READ, ...CHECKS, 'findMs', 'verdictMs', 'primitiveMs', 'movedMs'])
        expect(timing.unsavableMs).toBeNull()
    })

    test('the scan runs once per slot that reaches the checks, and an unheld character ends them at scanMs', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const real = world.encoder.netScan
        let scans = 0
        world.encoder.netScan = (checked) => {
            scans += 1
            return real(checked)
        }
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        await world.slotAt(2_000)
        expect(scans).toBe(1)
        const timing = expectTiming('unheld', [...READ, 'checksMs', 'scanMs'])
        expect(timing.pruneMs).toBeNull()
    })

    test('a stub that needs a full pass before an unheld character still ends the slot as unheld', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const entries = (world.kit.context.previous.objects?.shards ?? []).flatMap(shard => shard.entries)
        const entry = entries.find(candidate => candidate.chaId === idOf(db, 1))
        const stub = stubFromEntry(entry as NonNullable<typeof entry>) as unknown as Entry
        stub.name = 'Renamed stub'
        chars(db)[1] = stub
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        await world.slotAt(2_000)
        expectEnds(1, { unheld: 1 })
        expectTiming('unheld', [...READ, 'checksMs', 'scanMs'])
    })

    test('a stub that needs a full pass ends the checks at scanMs', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        const hand = installHandClock()
        // The scan answers a stub that needs a full pass; the slot exits there, so no resident lookup depends on it.
        world.encoder.netScan = () => {
            hand.now += 9
            return { unheld: false, stubsNeedFull: true, residents: [] }
        }
        await world.slotAt(2_000)
        const timing = expectTiming('stub', [...READ, 'checksMs', 'scanMs'])
        expect(timing.scanMs).toBe(9)
        expect(timing.checksMs).toBe(9)
    })

    test('an absent unsavable character ends the checks after unsavableMs', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.notices >= 1, 'the notice of the break', 4000)
        chars(db).splice(1, 1)
        await world.slotAt(2_000)
        expectTiming('unsavableAbsent', [...READ, 'checksMs', 'scanMs', 'unsavableMs'])
    })
})

/** Every `performance.now()` read returns one more than the last, so each clock read between two laps counts as 1. */
function installTickingClock(): void {
    const tick = { now: 5_000 }
    vi.spyOn(performance, 'now').mockImplementation(() => {
        tick.now += 1
        return tick.now
    })
}

/** The latest slot's record, and how far `checksMs` is from the sum of the sub-parts the slot ran (null when `checksMs` is null). */
function lastSlotChecks(): { reason: NetSlotReason | null, ran: NetSlotPart[], residual: number | null } {
    const timings = meterOf().verdicts().slotTimings
    const timing = timings[timings.length - 1]
    const ran: NetSlotPart[] = []
    let sum = 0
    for (const part of ['scanMs', 'unsavableMs', 'pruneMs', 'findMs'] as const) {
        const value = timing[part]
        if (value !== null) {
            ran.push(part)
            sum += value
        }
    }
    return { reason: timing.reason, ran, residual: timing.checksMs === null ? null : timing.checksMs - sum }
}

describe('the sub-parts sum exactly to checksMs on every exit', () => {
    /** An unsavable character at index 1, after which the world is left with the unsavable set non-empty. */
    async function worldWithUnsavable(): Promise<{ db: Database, world: World }> {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.notices >= 1, 'the notice of the break', 4000)
        return { db, world }
    }

    test('unheld exit', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        installTickingClock()
        await world.slotAt(2_000)
        expect(lastSlotChecks()).toEqual({ reason: 'unheld', ran: ['scanMs'], residual: 0 })
    })

    test('stub exit', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        world.encoder.netScan = () => ({ unheld: false, stubsNeedFull: true, residents: [] })
        installTickingClock()
        await world.slotAt(2_000)
        expect(lastSlotChecks()).toEqual({ reason: 'stub', ran: ['scanMs'], residual: 0 })
    })

    test('absent unsavable exit', async () => {
        const { db, world } = await worldWithUnsavable()
        chars(db).splice(1, 1)
        installTickingClock()
        await world.slotAt(2_000)
        expect(lastSlotChecks()).toEqual({ reason: 'unsavableAbsent', ran: ['scanMs', 'unsavableMs'], residual: 0 })
    })

    test('unsavable resident on its turn', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        const personality = chars(db)[1].personality
        chars(db)[1].personality = cyclic()
        world.tracker.character = [idOf(db, 1)]
        world.state.due = true
        world.state.dirty = true
        await until(() => world.notices >= 1, 'the notice of the break', 4000)
        chars(db)[1].personality = personality
        installTickingClock()
        await world.slotAt(2_000)
        await world.slotAt(4_000)
        expect(lastSlotChecks()).toEqual({ reason: 'verdictUnknown', ran: ['scanMs', 'unsavableMs', 'pruneMs'], residual: 0 })
    })

    test('no resident exit', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        installTickingClock()
        await world.slotAt(2_000)
        expect(lastSlotChecks()).toEqual({ reason: 'noResident', ran: ['scanMs', 'pruneMs'], residual: 0 })
    })

    test('verdict exit with no unsavable character', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        installTickingClock()
        await world.slotAt(2_000)
        expect(lastSlotChecks()).toEqual({ reason: 'verdictClean', ran: ['scanMs', 'pruneMs', 'findMs'], residual: 0 })
    })

    test('verdict exit after an unsavable scan', async () => {
        const { db, world } = await worldWithUnsavable()
        chars(db)[1].personality = 'restored'
        installTickingClock()
        await world.slotAt(2_000)
        expect(lastSlotChecks()).toEqual({ reason: 'verdictClean', ran: ['scanMs', 'unsavableMs', 'pruneMs', 'findMs'], residual: 0 })
    })
})

/**
 * D2 (CHORE-205 stage 2c): the real loop decides each slot as the three old calls did. The expected decision is computed
 * from `unheldChaIds`, `stubsNeedFullPass` and `residentChaIds` over the same database, and observed through the slot's
 * counted reason and the character `verdictOf` is asked about (the first resident, as the net starts at index 0).
 */
describe('the slot decides as the three old calls did (D2)', () => {
    type Mutate = (db: Database, entries: ShardEntry[]) => void

    function stubOf(entries: ShardEntry[], db: Database, index: number, edit: (stub: Entry) => void = () => {}): Entry {
        const entry = entries.find(candidate => candidate.chaId === idOf(db, index))
        expect(entry).toBeDefined()
        const stub = stubFromEntry(entry as NonNullable<typeof entry>) as unknown as Entry
        edit(stub)
        return stub
    }

    function newcomer(db: Database): Entry {
        return { ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' }
    }

    function throwing(slot: Entry, field: string): void {
        Object.defineProperty(slot, field, { configurable: true, enumerable: true, get() { throw new Error(`getter ${field}`) } })
    }

    const cases: Array<{ name: string, mutate: Mutate }> = [
        { name: 'an untouched page', mutate: () => {} },
        { name: 'a new character', mutate: (db) => { chars(db).push(newcomer(db)) } },
        { name: 'every character a clean stub', mutate: (db, entries) => { for (let i = 0; i < 3; i++) { chars(db)[i] = stubOf(entries, db, i) } } },
        { name: 'a clean stub beside residents', mutate: (db, entries) => { chars(db)[0] = stubOf(entries, db, 0) } },
        { name: 'a renamed stub', mutate: (db, entries) => { chars(db)[1] = stubOf(entries, db, 1, (s) => { s.name = 'Renamed stub' }) } },
        { name: 'a stub with edited tags', mutate: (db, entries) => { chars(db)[1] = stubOf(entries, db, 1, (s) => { s.tags = ['edited'] }) } },
        { name: 'a stub that names another unit', mutate: (db, entries) => { chars(db)[2] = stubOf(entries, db, 2, (s) => { s.coldstorage = 'another-unit' }) } },
        { name: 'a stub that needs a full pass before a new character', mutate: (db, entries) => { chars(db)[0] = stubOf(entries, db, 0, (s) => { s.name = 'x' }); chars(db).push(newcomer(db)) } },
        { name: 'a new character before a stub that needs a full pass', mutate: (db, entries) => { chars(db)[2] = stubOf(entries, db, 2, (s) => { s.name = 'x' }); chars(db).unshift(newcomer(db)) } },
        { name: 'holes in the list', mutate: (db) => { chars(db).splice(1, 0, null as unknown as Entry, 7 as unknown as Entry) } },
        { name: 'an array slot', mutate: (db) => { chars(db).splice(1, 0, [] as unknown as Entry) } },
        { name: 'a duplicate of an id', mutate: (db) => { chars(db).push({ ...clone(chars(db)[0]) }) } },
        { name: 'a stub before its own duplicate', mutate: (db, entries) => { const stub = stubOf(entries, db, 0); chars(db).splice(0, 1, stub, { ...clone(chars(db)[0]) }) } },
        { name: 'no character', mutate: (db) => { chars(db).length = 0 } },
        { name: 'a getter that throws on a resident id', mutate: (db) => { throwing(chars(db)[1], 'chaId') } },
        { name: 'a getter that throws on a stub name', mutate: (db, entries) => { chars(db)[1] = stubOf(entries, db, 1); throwing(chars(db)[1], 'name') } },
        { name: 'a throwing getter after a new character', mutate: (db) => { chars(db).unshift(newcomer(db)); throwing(chars(db)[2], 'coldstorage') } },
    ]

    test.each(cases)('$name', async ({ mutate }) => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const entries = (world.kit.context.previous.objects?.shards ?? []).flatMap(shard => shard.entries)
        mutate(db, entries)
        const judged: string[] = []
        const real = world.encoder.verdictOf
        world.encoder.verdictOf = (slot) => {
            judged.push(String((slot as { chaId?: unknown }).chaId))
            return real(slot)
        }
        let expected: NetSlotReason | 'verdict'
        let first: string | null = null
        try {
            const unheld = world.encoder.unheldChaIds(db).length > 0
            if (unheld) {
                expected = 'unheld'
            } else if (world.encoder.stubsNeedFullPass(db)) {
                expected = 'stub'
            } else {
                const residents = residentChaIds(db)
                first = residents[0] ?? null
                expected = residents.length === 0 ? 'noResident' : 'verdict'
            }
        } catch {
            expected = 'guardThrow'
        }
        await world.slotAt(2_000)
        const ends = Object.entries(meterOf().verdicts().slotEnds).filter(([, count]) => count > 0)
        expect(ends).toHaveLength(1)
        const reason = ends[0][0] as NetSlotReason
        if (expected === 'verdict') {
            expect(['verdictClean', 'verdictDirty', 'verdictUnknown']).toContain(reason)
            expect(judged).toEqual([first])
        } else {
            expect(reason).toBe(expected)
            expect(judged).toEqual([])
        }
        expect(world.crashed).toEqual([])
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

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: false }))
const yielded = vi.hoisted(() => ({ calls: 0 }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

// The real primitive stays reachable for every other caller; only the idle-net slot's default yield is counted.
vi.mock('../../saveYield', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../saveYield')>()
    return {
        ...original,
        yieldToEventLoop: async () => {
            yielded.calls += 1
            await original.yieldToEventLoop()
        },
    }
})

import type { Store2Read } from '../../store2/backend/types'
import type { Committer } from '../../store2/commit'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { startSavePass, type NetSlotPart, type NetSlotReason, type NetSlotTiming, type SavePassMeterHandle } from '../../store2/savePassMeter'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import { createSaveScheduler } from '../../saveScheduler'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { startStore2 } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * CHORE-205 stage 2d: the idle-net slot yields once before its verdict. The behavioural tests run with the measurement
 * switch off, so what they assert is what a release build does; the meter tests run it on. Labels: R1 is the regression
 * reproducer (fails without the yield), G1 to G7 and the named extras are guards of the re-check order and the meter.
 */

type Entry = Record<string, unknown>
type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }

interface SlotOutcome {
    verdicts: string[]
    requests: SavePassRequest[]
}

interface World {
    holder: { db: Database }
    encoder: SaveEncoder
    order: string[]
    requests: SavePassRequest[]
    verdicts: string[]
    state: { due: boolean, dirty: boolean }
    tracker: toSaveType
    notices: number
    errors: unknown[]
    crashed: unknown[]
    /** Runs inside the injected yield, once. */
    onYield: { action: (() => void) | null, reject: boolean }
    /** Runs inside the wrapped `netScan` / `verdictOf` / the first `isDue` after the yield. */
    hooks: { afterScan: (() => void) | null, beforeVerdict: (() => void) | null, afterYieldDue: (() => void) | null }
    scheduler: ReturnType<typeof createSaveScheduler>
    armWait(): void
    /** Moves the loop's clock to `offset` ms after its start without waiting for anything. */
    moveClock(offset: number): void
    slotAt(offset: number): Promise<SlotOutcome>
    stop(): void
}

interface StartOptions {
    /** No injected `yieldNow`: the slot uses the default primitive. */
    defaultYield?: boolean
    /** The loop waits through a real `createSaveScheduler` whose sleeps never finish once `armWait` was called. */
    useScheduler?: boolean
    /** While `on`, the slot's base read throws. */
    failRead?: { on: boolean }
    /** While `fn` is set, every base read is passed through it, so a test can spend time inside `judge`. */
    readWrap?: { fn: ((read: Store2Read) => Store2Read) | null }
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
    flag.measure = false
    yielded.calls = 0
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

function useMeter(): void {
    flag.measure = true
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    startSavePass()
    meterOf().reset()
}

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

async function startWorld(db: Database, options: StartOptions = {}): Promise<World> {
    const kit = await startStore2({ db, idleNet: { intervalMs: 1 } })
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const verdicts: string[] = []
    const order: string[] = []
    const hooks: World['hooks'] = { afterScan: null, beforeVerdict: null, afterYieldDue: null }
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    encoder.netScan = (scanDb) => {
        order.push('scan')
        const scan = inner.netScan(scanDb)
        hooks.afterScan?.()
        return scan
    }
    encoder.verdictOf = (slot) => {
        order.push('verdict')
        verdicts.push(String((slot as { chaId?: unknown }).chaId))
        hooks.beforeVerdict?.()
        return inner.verdictOf(slot)
    }
    kit.context.encoder = encoder
    const counted = { reads: 0, sweeps: 0 }
    const failRead = options.failRead ?? { on: false }
    const readWrap = options.readWrap ?? { fn: null }
    const real = kit.context.session.committer as Committer
    kit.context.session = {
        ...kit.context.session,
        committer: {
            ...real,
            async readCommit() {
                counted.reads += 1
                if (failRead.on) {
                    throw new Error('the base read failed')
                }
                const read = await real.readCommit()
                return readWrap.fn === null ? read : readWrap.fn(read)
            },
        },
    }
    let stopped = false
    let waitArmed = false
    let tail: Promise<void> = Promise.resolve()
    const clock = { now: 1_800_000_000_000 }
    const start = clock.now
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const state = { due: false, dirty: false }
    const holder = { db }
    const onYield: World['onYield'] = { action: null, reject: false }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const scheduler = createSaveScheduler({
        debounceMs: 500,
        // Once armed, a sleep never finishes: only the scheduler's latch can end the next wait.
        sleep: () => waitArmed ? new Promise<void>(() => {}) : idle(),
        hooks: {
            onMark: () => {},
            onDue: () => { state.due = true },
            onRequestNow: () => { state.dirty = true; state.due = true },
        },
    })
    const world: World = {
        holder, encoder: inner, order, requests, verdicts, state, tracker, hooks, scheduler, onYield,
        notices: 0, errors: [], crashed: [],
        armWait() {
            waitArmed = true
        },
        moveClock(offset) {
            clock.now = start + offset
        },
        async slotAt(offset) {
            const reads = counted.reads
            const judged = verdicts.length
            const planned = requests.length
            clock.now = start + offset
            await until(() => counted.reads > reads, `read at ${offset}`, 4000)
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps, `end at ${offset}`, 4000)
            return { verdicts: verdicts.slice(judged), requests: requests.slice(planned) }
        },
        stop() {
            stopped = true
        },
    }
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => holder.db,
        mergeBack() {},
        liveCheck: () => {},
        sweep() {
            counted.sweeps += 1
        },
        isDue: () => {
            const afterYield = hooks.afterYieldDue
            if (afterYield !== null) {
                hooks.afterYieldDue = null
                afterYield()
            }
            return state.due
        },
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
            try {
                return await work()
            } finally {
                release()
            }
        },
        wait: options.useScheduler === true ? (ms) => scheduler.wait(ms) : idle,
        sleep: () => idle(),
        sleepForever: () => new Promise<never>(() => {}),
        now: () => clock.now,
    }
    if (options.defaultYield !== true) {
        port.yieldNow = async () => {
            order.push('yield')
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
            const action = onYield.action
            onYield.action = null
            action?.()
            if (onYield.reject) {
                onYield.reject = false
                throw new Error('the injected yield rejected')
            }
        }
    }
    vi.spyOn(console, 'error').mockImplementation((error: unknown) => {
        world.errors.push(error)
    })
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        world.crashed.push(error)
    })
    worlds.push(world)
    return world
}

describe('the yield and the re-checks after it (measurement off)', () => {
    test('R1 reproducer: the scan runs before the yield, the lookup and the verdict after it', async () => {
        const world = await startWorld(clone(buildSmall(1)))
        world.order.length = 0
        await world.slotAt(2_000)
        expect(world.order).toEqual(['scan', 'yield', 'verdict'])
    })

    test('D8 the default primitive is used when the port has no yieldNow', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db, { defaultYield: true })
        const before = yielded.calls
        const slot = await world.slotAt(2_000)
        expect(yielded.calls).toBe(before + 1)
        expect(slot.verdicts).toEqual([idOf(db, 0)])
    })

    test('D1 P-N1 isDue during the yield uses no turn: the next judged slot is resident 0', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        world.onYield.action = () => {
            world.state.due = true
        }
        const first = await world.slotAt(2_000)
        expect(first.verdicts).toEqual([])
        await until(() => !world.state.due, 'the marked pass', 4000)
        const second = await world.slotAt(4_000)
        expect(second.verdicts).toEqual([idOf(db, 0)])
    })

    test('D1 P-N2 a replaced database during the yield uses no turn: the next judged slot is resident 0', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        world.onYield.action = () => {
            world.holder.db = clone(db)
        }
        const first = await world.slotAt(2_000)
        expect(first.verdicts).toEqual([])
        const second = await world.slotAt(4_000)
        expect(second.verdicts).toEqual([idOf(db, 0)])
    })

    test('D1 P-N3 the round robin is unchanged: residents 0, 1, 2, 0', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const seen: string[] = []
        for (const offset of [2_000, 4_000, 6_000, 8_000]) {
            seen.push(...(await world.slotAt(offset)).verdicts)
        }
        expect(seen).toEqual([0, 1, 2, 0].map(index => idOf(db, index)))
    })

    test('G1 a resident replaced by an edited copy during the yield is judged live: dirty and passed', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        world.onYield.action = () => {
            chars(db)[0] = { ...clone(chars(db)[0]), personality: 'replaced during the yield' }
        }
        const slot = await world.slotAt(2_000)
        expect(slot.verdicts).toEqual([idOf(db, 0)])
        expect(slot.requests.map(request => request.net)).toEqual([{ chaId: idOf(db, 0), modules: false }])
    })

    test('G2 a different database object during the yield: no verdict and no pass', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        world.onYield.action = () => {
            world.holder.db = clone(db)
        }
        const slot = await world.slotAt(2_000)
        expect(slot.verdicts).toEqual([])
        expect(slot.requests).toEqual([])
    })

    test('G3 a pass becoming due during the yield: no verdict', async () => {
        const world = await startWorld(clone(buildSmall(1)))
        world.onYield.action = () => {
            world.state.due = true
        }
        const slot = await world.slotAt(2_000)
        expect(slot.verdicts).toEqual([])
    })

    test('G4 / D7 the chosen resident removed during the yield: slotMissing takes the full tick', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        const ids = [0, 1, 2].map(index => idOf(db, index))
        world.onYield.action = () => {
            chars(db).splice(0, 1)
        }
        const slot = await world.slotAt(2_000)
        expect(slot.verdicts).toEqual([])
        expect(slot.requests.map(request => request.net)).toEqual([{ chaId: ids[2], modules: false }])
    })

    test('G5 compatibility guard, needs the yieldNow hook: a requestNow during the yield is not lost, the next wait returns at once', async () => {
        const world = await startWorld(clone(buildSmall(1)), { useScheduler: true })
        world.onYield.action = () => {
            world.scheduler.requestNow()
        }
        world.armWait()
        // Waits for the marked pass itself, not for a sweep: the whole chain can finish between two polls of the harness.
        world.moveClock(2_000)
        await until(() => world.requests.some(request => request.net === undefined), 'the pass the request asked for', 4000)
        expect(world.verdicts).toEqual([])
    })

    test('G6 an edit to the live resident on a shadow-hit path is dirty and passed, not clean', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        const first = await world.slotAt(2_000)
        expect(first.requests).toEqual([])
        expect(world.encoder.shadowStats().entries).toBe(1)
        world.onYield.action = () => {
            chars(db)[0] = { ...clone(chars(db)[0]), personality: 'replaced during the yield' }
        }
        const slot = await world.slotAt(4_000)
        expect(slot.verdicts).toEqual([idOf(db, 0)])
        expect(slot.requests.map(request => request.net)).toEqual([{ chaId: idOf(db, 0), modules: false }])
    })

    test('D8 a throw in a step after the yield reaches the guard and takes the full tick', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        const id = idOf(db, 0)
        world.onYield.action = () => {
            let thrown = false
            Object.defineProperty(chars(db)[0], 'chaId', {
                configurable: true,
                enumerable: true,
                get() {
                    if (!thrown) {
                        thrown = true
                        throw new Error('faulting chaId after the yield')
                    }
                    return id
                },
            })
        }
        const slot = await world.slotAt(2_000)
        expect(slot.verdicts).toEqual([])
        expect(slot.requests.map(request => request.net)).toEqual([{ chaId: id, modules: false }])
        expect(world.errors.some(error => error instanceof Error && error.message === 'faulting chaId after the yield')).toBe(true)
    })

    test('D8 a rejecting yield is a throw after the yield: the guard logs it and the full tick runs', async () => {
        const world = await startWorld(clone(buildSmall(1)))
        world.onYield.reject = true
        const slot = await world.slotAt(2_000)
        expect(slot.verdicts).toEqual([])
        expect(slot.requests).toHaveLength(1)
        expect(world.errors.some(error => error instanceof Error && error.message === 'the injected yield rejected')).toBe(true)
        expect(world.crashed).toEqual([])
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

/** A clock the test advances by hand; every interval is 0 except where a hook moves it. */
function installHandClock(): { now: number } {
    const hand = { now: 1_000 }
    vi.spyOn(performance, 'now').mockImplementation(() => hand.now)
    return hand
}

function lastTiming(): NetSlotTiming {
    const timings = meterOf().verdicts().slotTimings
    return timings[timings.length - 1]
}

/** How far `checksMs` is from the sum of the sub-parts the latest slot ran, and which ones those were. */
function lastChecks(): { ran: NetSlotPart[], residual: number | null } {
    const timing = lastTiming()
    const ran: NetSlotPart[] = []
    let sum = 0
    for (const part of ['scanMs', 'unsavableMs', 'pruneMs', 'findMs'] as const) {
        const value = timing[part]
        if (value !== null) {
            ran.push(part)
            sum += value
        }
    }
    return { ran, residual: timing.checksMs === null ? null : timing.checksMs - sum }
}

/** What `decisionMs` holds beyond the spans: the clock reads that sit between them. */
function unspanned(timing: NetSlotTiming): number {
    return timing.decisionMs - ((timing.lockWaitMs ?? 0) + (timing.readMs ?? 0) + (timing.spanAMs ?? 0) + (timing.yieldMs ?? 0) + (timing.spanBMs ?? 0))
}

describe('the yield spans in the slot record (measurement on)', () => {
    beforeEach(() => {
        useMeter()
    })

    test('G7a hand clock: each span carries exactly the time injected into its stretch', async () => {
        const world = await startWorld(clone(buildSmall(3)))
        const hand = installHandClock()
        world.hooks.afterScan = () => { hand.now += 7 }
        world.onYield.action = () => {
            hand.now += 11
            // The first isDue after the resume: a resume read taken late would put these 3 ms into the yield.
            world.hooks.afterYieldDue = () => { hand.now += 3 }
        }
        world.hooks.beforeVerdict = () => { hand.now += 5 }
        await world.slotAt(2_000)
        const timing = lastTiming()
        expect(timing.reason).toBe('verdictClean')
        expect(timing).toMatchObject({ lockWaitMs: 0, readMs: 0, spanAMs: 7, yieldMs: 11, spanBMs: 8, verdictMs: 5, decisionMs: 26 })
    })

    test('G7a time spent inside judge belongs to span A, which starts before it', async () => {
        const readWrap: { fn: ((read: Store2Read) => Store2Read) | null } = { fn: null }
        const world = await startWorld(clone(buildSmall(3)), { readWrap })
        const hand = installHandClock()
        let spent = false
        readWrap.fn = (read) => ({
            ...read,
            get token() {
                // `judge` reads the token first; only the first read spends time.
                if (!spent) {
                    spent = true
                    hand.now += 4
                }
                return read.token
            },
        })
        world.hooks.afterScan = () => { hand.now += 7 }
        await world.slotAt(2_000)
        const timing = lastTiming()
        expect(timing).toMatchObject({ reason: 'verdictClean', judgeMs: 4, spanAMs: 11, decisionMs: 11 })
    })

    test('G7c a yielding slot does not leak its yield reads into the next, pre-yield slot of the same loop', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        installTickingClock()
        await world.slotAt(2_000)
        expect(lastTiming().reason).toBe('verdictClean')
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        await world.slotAt(4_000)
        const unheld = lastTiming()
        expect(unheld.reason).toBe('unheld')
        expect(unheld.spanAMs).toEqual(expect.any(Number))
        expect(unheld.yieldMs).toBeNull()
        expect(unheld.spanBMs).toBeNull()
    })

    const yieldingExits: Array<{ name: string, reason: NetSlotReason, ran: NetSlotPart[], arrange: (world: World, db: Database) => void }> = [
        { name: 'verdictClean', reason: 'verdictClean', ran: ['scanMs', 'pruneMs', 'findMs'], arrange: () => {} },
        { name: 'verdictDirty', reason: 'verdictDirty', ran: ['scanMs', 'pruneMs', 'findMs'], arrange: (_world, db) => { chars(db)[0].personality = 'edited in place, nothing marked' } },
        { name: 'dueAfterYield', reason: 'dueAfterYield', ran: ['scanMs', 'pruneMs'], arrange: (world) => { world.onYield.action = () => { world.state.due = true } } },
        { name: 'dbChanged', reason: 'dbChanged', ran: ['scanMs', 'pruneMs'], arrange: (world, db) => { world.onYield.action = () => { world.holder.db = clone(db) } } },
        { name: 'slotMissing', reason: 'slotMissing', ran: ['scanMs', 'pruneMs', 'findMs'], arrange: (world, db) => { world.onYield.action = () => { chars(db).splice(0, 1) } } },
    ]

    for (const exit of yieldingExits) {
        test(`G7b ticking clock: ${exit.name} has all three spans, a zero checks residual and the decision bound`, async () => {
            const db = clone(buildSmall(3))
            const world = await startWorld(db)
            exit.arrange(world, db)
            installTickingClock()
            await world.slotAt(2_000)
            const timing = lastTiming()
            expect(timing.reason).toBe(exit.reason)
            expect(lastChecks()).toEqual({ ran: exit.ran, residual: 0 })
            expect(timing.spanAMs).toEqual(expect.any(Number))
            expect(timing.yieldMs).toEqual(expect.any(Number))
            expect(timing.spanBMs).toEqual(expect.any(Number))
            expect(unspanned(timing)).toBeGreaterThanOrEqual(0)
        })
    }

    test('G7b ticking clock: the unsavable resident on its turn yields and keeps findMs null', async () => {
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
        const timing = lastTiming()
        expect(timing.reason).toBe('verdictUnknown')
        expect(timing.findMs).toBeNull()
        expect(lastChecks()).toEqual({ ran: ['scanMs', 'unsavableMs', 'pruneMs'], residual: 0 })
        expect(timing.spanAMs).toEqual(expect.any(Number))
        expect(timing.yieldMs).toEqual(expect.any(Number))
        expect(timing.spanBMs).toEqual(expect.any(Number))
    })

    test('G7b ticking clock: a throw after the yield and a rejecting yield both keep all three spans', async () => {
        for (const mode of ['throw', 'reject'] as const) {
            meterOf().reset()
            const db = clone(buildSmall(1))
            const world = await startWorld(db)
            const id = idOf(db, 0)
            if (mode === 'reject') {
                world.onYield.reject = true
            } else {
                world.onYield.action = () => {
                    let thrown = false
                    Object.defineProperty(chars(db)[0], 'chaId', {
                        configurable: true,
                        enumerable: true,
                        get() {
                            if (!thrown) {
                                thrown = true
                                throw new Error('faulting chaId after the yield')
                            }
                            return id
                        },
                    })
                }
            }
            installTickingClock()
            await world.slotAt(2_000)
            const timing = lastTiming()
            expect(timing.reason, mode).toBe('guardThrow')
            expect(timing.spanAMs, mode).toEqual(expect.any(Number))
            expect(timing.yieldMs, mode).toEqual(expect.any(Number))
            expect(timing.spanBMs, mode).toEqual(expect.any(Number))
            expect(lastChecks().residual, mode).toBe(0)
            expect(unspanned(timing), mode).toBeGreaterThanOrEqual(0)
            world.stop()
            vi.restoreAllMocks()
            useMeter()
        }
    })

    test('G7c exits before the yield: spanAMs ends at the exit and the other two spans are null', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db)
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        installTickingClock()
        await world.slotAt(2_000)
        const unheld = lastTiming()
        expect(unheld.reason).toBe('unheld')
        expect(unheld.spanAMs).toEqual(expect.any(Number))
        expect(unheld.yieldMs).toBeNull()
        expect(unheld.spanBMs).toBeNull()
        world.stop()
        const empty = await startWorld(clone(buildSmall(0)))
        await empty.slotAt(2_000)
        const none = lastTiming()
        expect(none.reason).toBe('noResident')
        expect(none.spanAMs).toEqual(expect.any(Number))
        expect(none.yieldMs).toBeNull()
        expect(none.spanBMs).toBeNull()
    })

    test('G7c a slot whose base read failed has none of the three spans', async () => {
        const failRead = { on: false }
        const world = await startWorld(clone(buildSmall(3)), { failRead })
        failRead.on = true
        await world.slotAt(2_000)
        const timing = lastTiming()
        expect(timing.reason).toBe('readFailed')
        expect(timing.spanAMs).toBeNull()
        expect(timing.yieldMs).toBeNull()
        expect(timing.spanBMs).toBeNull()
    })

    test('G7d the unspanned remainder of the decision is the same on exits that reached judge', async () => {
        installTickingClock()
        const world = await startWorld(clone(buildSmall(3)))
        await world.slotAt(2_000)
        const clean = lastTiming()
        world.stop()
        const second = await startWorld(clone(buildSmall(3)))
        second.onYield.action = () => { second.state.due = true }
        await second.slotAt(2_000)
        const due = lastTiming()
        second.stop()
        const db = clone(buildSmall(3))
        const third = await startWorld(db)
        chars(db).push({ ...clone(chars(db)[0]), chaId: 'brand-new-character', name: 'Brand new' })
        ;(db as unknown as Entry).characterOrder = chars(db).map(slot => slot.chaId)
        await third.slotAt(2_000)
        const unheld = lastTiming()
        expect(clean.reason).toBe('verdictClean')
        expect(due.reason).toBe('dueAfterYield')
        expect(unheld.reason).toBe('unheld')
        expect(unspanned(due)).toBe(unspanned(clean))
        expect(unspanned(unheld)).toBe(unspanned(clean))
    })
})

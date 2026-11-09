// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { COMMIT_KEY } from '../../store2/format/keys'
import type { CommitRequest, CommitResult, Committer } from '../../store2/commit'
import type { Store2Read } from '../../store2/backend/types'
import { stubFromEntry } from '../../store2/codec'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { startSavePass, type NetSlotReason, type SavePassMeterHandle } from '../../store2/savePassMeter'
import {
    IDLE_NET_QUIET_AFTER_MS,
    IDLE_NET_QUIET_INTERVAL_MS,
    IDLE_NET_QUIET_MODULE_INTERVAL_MS,
    runStore2SaveLoop,
    type Store2LoopPort,
    type UnsavableCharacter,
} from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { peerCommit, startStore2, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * CHORE-687 idle back-off: after 60 s with no activity the net scans at most every 30 s and module-scope ticks come
 * every 5 min once one ended unchanged; any activity, a hide or Back sweep, a hidden page or an unsavable character
 * restores the base cadence. The loop runs over a real memory backend and committer with a hand-built port whose clock
 * the test sets, as saveLoopNetBackstop does. Labels T1 to T13 follow the plan; "test B6" and the like name the
 * backstop suite's tests, while "bump B1" to "bump B7" name the activity causes. Every sequence is count- or
 * sequence-based. Slots are at odd seconds, every 2 s unless a test says otherwise.
 */

type Entry = Record<string, unknown>
type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }
type VerdictMode = 'real' | 'dirty' | 'unknown' | 'throw'

interface Slot {
    reads: number
    scans: number
    verdicts: string[]
    requests: SavePassRequest[]
    reason: NetSlotReason | null
}

interface World {
    kit: Store2Kit
    holder: { db: Database }
    clock: { now: number }
    start: number
    requests: SavePassRequest[]
    verdicts: string[]
    counted: { reads: number, scans: number, sweeps: number, begun: number }
    state: { due: boolean, dirty: boolean }
    flags: { hidden: boolean, sweep: boolean, residentLoaded: boolean, peerHeard: boolean }
    mode: { verdict: VerdictMode }
    commitFault: { on: boolean }
    pending: { on: boolean }
    /** Moves the clock forward by `ms` inside the next base read and arms a one-shot that sets it back at the next loop top. */
    readJump: { ms: number }
    onYield: { action: (() => void) | null }
    onSweep: { action: (() => void) | null }
    failures: Array<{ error: unknown, attempts: number }>
    unsavableCalls: Array<{ current: readonly UnsavableCharacter[], newly: readonly UnsavableCharacter[] }>
    stopLog: string[]
    crashed: unknown[]
    slotAt(offset: number): Promise<Slot>
    markedPass(ids: string[]): Promise<void>
    stop(): void
}

interface StartOptions {
    /** Absent means the production default, 30 000. */
    moduleIntervalMs?: number
    /** Absent means the production default, 30 000; 0 disables the clean-verdict skip. */
    backstopMs?: number
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

function indexOfId(db: Database, chaId: string): number {
    return chars(db).findIndex(slot => slot.chaId === chaId)
}

function cyclic(): Entry {
    const value: Entry = {}
    value.self = value
    return value
}

function moduleOf(db: Database, index: number): Entry {
    return (db as unknown as { modules: Entry[] }).modules[index]
}

function takesModuleScope(request: SavePassRequest): boolean {
    return request.net?.modules === true || request.modules === true
}

/** Starts the loop with the production quiet constants; no `moduleIntervalMs` or `backstopMs` unless the test states one. */
async function startWorld(db: Database, options: StartOptions = {}): Promise<World> {
    const idleNet = {
        intervalMs: 1,
        ...(options.moduleIntervalMs === undefined ? {} : { moduleIntervalMs: options.moduleIntervalMs }),
        ...(options.backstopMs === undefined ? {} : { backstopMs: options.backstopMs }),
    }
    const kit = await startStore2({ db, idleNet })
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const verdicts: string[] = []
    const mode: World['mode'] = { verdict: 'real' }
    const pending = { on: false }
    const counted = { reads: 0, scans: 0, sweeps: 0, begun: 0 }
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        pending.on = false
        return inner.plan(planDb, request)
    }
    encoder.netScan = (scanDb) => {
        counted.scans += 1
        return inner.netScan(scanDb)
    }
    encoder.verdictOf = (slot) => {
        verdicts.push(String((slot as { chaId?: unknown }).chaId))
        if (mode.verdict === 'throw') {
            throw new Error('the verdict threw')
        }
        if (mode.verdict === 'dirty' || mode.verdict === 'unknown') {
            return mode.verdict
        }
        return inner.verdictOf(slot)
    }
    Object.defineProperty(encoder, 'pendingKey', {
        get: () => pending.on ? 'a-pending-key-the-test-holds' : inner.pendingKey,
    })
    kit.context.encoder = encoder
    const commitFault = { on: false }
    const clock = { now: 1_800_000_000_000 }
    const onYield: World['onYield'] = { action: null }
    const onSweep: World['onSweep'] = { action: null }
    const readJump: World['readJump'] = { ms: 0 }
    const real = kit.context.session.committer as Committer
    kit.context.session = {
        ...kit.context.session,
        committer: {
            ...real,
            async readCommit(): Promise<Store2Read> {
                counted.reads += 1
                if (readJump.ms !== 0) {
                    const before = clock.now
                    clock.now += readJump.ms
                    onSweep.action = () => { clock.now = before }
                    readJump.ms = 0
                }
                return real.readCommit()
            },
            async commit(read: Store2Read, request: CommitRequest): Promise<CommitResult> {
                if (commitFault.on) {
                    throw new Error('the commit failed')
                }
                return real.commit(read, request)
            },
        },
    }
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const state = { due: false, dirty: false }
    const flags = { hidden: false, sweep: false, residentLoaded: false, peerHeard: false }
    const holder = { db }
    const world: World = {
        kit, holder, clock, start: clock.now, requests, verdicts, counted, state, flags, mode, commitFault, pending, readJump, onYield, onSweep,
        failures: [],
        unsavableCalls: [],
        stopLog: [],
        crashed: [],
        async slotAt(offset) {
            const reads = counted.reads
            const scans = counted.scans
            const judged = verdicts.length
            const planned = requests.length
            const records = meterOf().signalSlots().length
            clock.now = world.start + offset
            await until(() => counted.reads > reads, `the slot at +${offset} ms to read the base`, 4000)
            // The loop reaches its next iteration only once the slot, and any silent pass it asked for, has ended.
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps, `the slot at +${offset} ms to end`, 4000)
            const added = meterOf().signalSlots().slice(records)
            const last = added.length === 0 ? null : added[added.length - 1]
            return {
                reads: counted.reads - reads,
                scans: counted.scans - scans,
                verdicts: verdicts.slice(judged),
                requests: requests.slice(planned),
                reason: last?.reason ?? null,
            }
        },
        async markedPass(ids) {
            const begun = counted.begun
            tracker.character.push(...ids)
            state.dirty = true
            state.due = true
            await until(() => counted.begun > begun, 'the marked pass to begin', 4000)
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps + 1, 'the loop to go on past the marked pass', 4000)
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
        getDatabase: () => holder.db,
        mergeBack(live, snapshot) {
            live.modules ||= snapshot.modules
        },
        liveCheck: () => {},
        sweep() {
            const action = onSweep.action
            onSweep.action = null
            action?.()
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
        peerHeard() {
            const heard = flags.peerHeard
            flags.peerHeard = false
            return heard
        },
        setStopped(reason) {
            world.stopLog.push(reason)
        },
        reportFailure(error, attempts) {
            world.failures.push({ error, attempts })
            return 1
        },
        reportUncountedFailure(error, attempts) {
            world.failures.push({ error, attempts })
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
        async yieldNow() {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
            const action = onYield.action
            onYield.action = null
            action?.()
        },
        pageHidden: () => flags.hidden,
        takeNetSweep() {
            const swept = flags.sweep
            flags.sweep = false
            return swept
        },
        takeResidentLoaded() {
            const loaded = flags.residentLoaded
            flags.residentLoaded = false
            return loaded
        },
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        world.crashed.push(error)
    })
    worlds.push(world)
    return world
}

/** Runs the slots at `fromSecond`, `fromSecond + 2`, ... up to `toSecond`, returning each with its second. */
async function runSlots(world: World, fromSecond: number, toSecond: number): Promise<Array<{ second: number, slot: Slot }>> {
    const ran: Array<{ second: number, slot: Slot }> = []
    for (let second = fromSecond; second <= toSecond; second += 2) {
        ran.push({ second, slot: await world.slotAt(second * 1000) })
    }
    return ran
}

/** Waits for the loop to plan `count` more requests, then to go on past the tick that carries the last one. */
async function nextRequestsDone(world: World, planned: number, count = 1): Promise<void> {
    await until(() => world.requests.length >= planned + count, 'the forced tick to plan', 4000)
    const sweeps = world.counted.sweeps
    await until(() => world.counted.sweeps > sweeps, 'the loop to go on past the forced tick', 4000)
}

function stubsOf(world: World, db: Database, indexes: number[]): Entry[] {
    const entries = (world.kit.context.previous.objects?.shards ?? []).flatMap(shard => shard.entries)
    return indexes.map((index) => {
        const entry = entries.find(candidate => candidate.chaId === idOf(db, index))
        expect(entry).toBeDefined()
        return stubFromEntry(entry as NonNullable<typeof entry>) as unknown as Entry
    })
}

const LONG = 120_000

describe('T12 the constants pin the maintainer answers', () => {
    test('T12 60 s of quiet, a 30 s scan interval and a 5 min module interval', () => {
        expect(IDLE_NET_QUIET_AFTER_MS).toBe(60_000)
        expect(IDLE_NET_QUIET_INTERVAL_MS).toBe(30_000)
        expect(IDLE_NET_QUIET_MODULE_INTERVAL_MS).toBe(300_000)
    })
})

describe('T1 and T2 a quiet clean page backs off its scans and its module ticks', () => {
    test('T1 netScan runs every slot for the first minute and then at most once per 30 s, one read per slot', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        const ran = await runSlots(world, 1, 181)
        for (const { second, slot } of ran) {
            expect(slot.reads, `reads at ${second} s`).toBe(1)
        }
        // The module tick at 31 s is the one pre-scan return; every other slot of the first minute scans.
        const first = ran.filter(({ second }) => second <= 59)
        expect(first.filter(({ slot }) => slot.scans === 1).map(({ second }) => second)).toEqual(
            first.map(({ second }) => second).filter(second => second !== 31))
        const later = ran.filter(({ second }) => second >= 63)
        expect(later.filter(({ slot }) => slot.scans === 1).map(({ second }) => second)).toEqual([89, 119, 149, 179])
        expect(later.filter(({ slot }) => slot.reason === 'scanBackedOff').length).toBe(later.length - 4)
        expect(world.crashed).toEqual([])
    }, LONG)

    test('T2 module scope at 31 s and then 300 s later, not every 30 s', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        const ran = await runSlots(world, 1, 361)
        const moduleSeconds = ran.filter(({ slot }) => slot.requests.some(takesModuleScope)).map(({ second }) => second)
        // The 331 s tick also ends unchanged, so the slot 30 s after it is not a module tick.
        expect(moduleSeconds).toEqual([31, 331])
        expect(world.crashed).toEqual([])
    }, LONG)
})

describe('T3 a stub edit made during the back-off', () => {
    async function stubWorld(): Promise<{ world: World, db: Database }> {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, { moduleIntervalMs: 1_000_000_000 })
        const stubs = stubsOf(world, db, [0, 1, 2])
        stubs.forEach((stub, index) => { chars(db)[index] = stub })
        return { world, db }
    }

    test('T3a it is not planned before the next backed-off scan', async () => {
        const { world, db } = await stubWorld()
        await runSlots(world, 1, 61)
        expect(world.requests).toEqual([])
        chars(db)[1].name = 'Renamed while backed off'
        const ran = await runSlots(world, 63, 87)
        expect(ran.every(({ slot }) => slot.requests.length === 0 && slot.scans === 0)).toBe(true)
        expect(world.requests).toEqual([])
    }, LONG)

    test('T3b it is saved by the next backed-off scan', async () => {
        const { world, db } = await stubWorld()
        await runSlots(world, 1, 61)
        chars(db)[1].name = 'Renamed while backed off'
        await runSlots(world, 63, 87)
        const mark = world.kit.memory.snapshot()
        const scanned = await world.slotAt(89_000)
        expect(scanned.reason).toBe('stub')
        expect(scanned.requests).toHaveLength(1)
        // A stub's name lives in its shard entry: the tick rewrites the shard and the manifest.
        expect(world.kit.writtenSince(mark)).toEqual(['manifest', 'shard'])
    }, LONG)
})

describe('T4 a hide or Back sweep', () => {
    test('T4a it runs a module-scope tick at once, without waiting for the module interval or the next slot time', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        await runSlots(world, 1, 45)
        const planned = world.requests.length
        world.flags.sweep = true
        await nextRequestsDone(world, planned)
        expect(world.requests.length - planned).toBe(1)
        expect(takesModuleScope(world.requests[planned])).toBe(true)
        const after = await world.slotAt(47_000)
        expect(after.requests).toEqual([])
        expect(after.scans).toBe(1)
    }, LONG)

    test('T4b an unmarked module edit is saved by the sweep tick', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        await runSlots(world, 1, 101)
        moduleOf(db, 1).description = 'a module edit with no mark'
        const planned = world.requests.length
        world.flags.sweep = true
        await nextRequestsDone(world, planned)
        expect(takesModuleScope(world.requests[planned])).toBe(true)
        expect(moduleOf(await world.kit.saved(), 1).description).toBe('a module edit with no mark')
    }, LONG)

    test('T4c every resident is verdicted after the sweep, one per slot, with every clean clock cleared', async () => {
        const db = clone(buildSmall(3))
        const world = await startWorld(db, { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 121)
        const last = indexOfId(db, world.verdicts[world.verdicts.length - 1])
        const other = (last + 2) % 3
        chars(db)[other].personality = 'an edit with no mark'
        const planned = world.requests.length
        world.flags.sweep = true
        await nextRequestsDone(world, planned)
        // The forced tick names the next resident in the rotation, clean and unchanged: it bumps nothing.
        expect(world.requests[planned].net?.chaId).toBe(idOf(db, (last + 1) % 3))
        const ran = await runSlots(world, 123, 127)
        expect(ran.map(({ slot }) => slot.reason)).toContain('verdictDirty')
        expect(chars(await world.kit.saved())[other].personality).toBe('an edit with no mark')
    }, LONG)
})

describe('T5 an unmarked module edit waits for the 5 min tick', () => {
    test('T5 not written by 329 s, written by 331 s, and the next module tick comes 30 s after that write', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        await runSlots(world, 1, 41)
        moduleOf(db, 1).description = 'a module edit with no mark'
        const before = await runSlots(world, 43, 329)
        expect(before.some(({ slot }) => slot.requests.some(takesModuleScope))).toBe(false)
        expect(moduleOf(await world.kit.saved(), 1).description).not.toBe('a module edit with no mark')
        const after = await runSlots(world, 331, 361)
        expect(after.filter(({ slot }) => slot.requests.some(takesModuleScope)).map(({ second }) => second)).toEqual([331, 361])
        expect(moduleOf(await world.kit.saved(), 1).description).toBe('a module edit with no mark')
    }, 240_000)
})

describe('T6 each activity restores the base cadence at the next slot', () => {
    test('T6a bump B1: a marked pass that wrote', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db, { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 101)
        chars(db)[0].personality = 'a marked edit'
        await world.markedPass([idOf(db, 0)])
        const ran = await runSlots(world, 103, 107)
        expect(ran.map(({ slot }) => slot.scans)).toEqual([1, 1, 1])
    }, LONG)

    test('T6b bump B1: a failed module tick is activity and does not leave the 5 min interval', async () => {
        const db = clone(buildSmall(0))
        const world = await startWorld(db)
        await runSlots(world, 1, 329)
        moduleOf(db, 1).description = 'a module edit with no mark'
        world.commitFault.on = true
        const failed = await world.slotAt(331_000)
        expect(failed.requests.some(takesModuleScope)).toBe(true)
        expect(world.failures).toHaveLength(1)
        world.commitFault.on = false
        const next = await world.slotAt(333_000)
        expect(next.scans).toBe(1)
        expect(next.requests).toEqual([])
        const retried = await world.slotAt(361_000)
        expect(retried.requests.some(takesModuleScope)).toBe(true)
        expect(moduleOf(await world.kit.saved(), 1).description).toBe('a module edit with no mark')
    }, 240_000)

    test('T6c bump B2: the end of a park', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db, { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 101)
        const commitBytes = world.kit.memory.snapshot().get(COMMIT_KEY)
        expect(commitBytes).toBeDefined()
        await peerCommit(world.kit, (peerDb) => { chars(peerDb)[0].name = 'the peer edit' })
        const parked = await world.slotAt(103_000)
        expect(parked.reason).toBe('parked')
        // The peer's commit is taken back and the page's base is current again: the recheck ends the park.
        world.kit.memory.poke(COMMIT_KEY, commitBytes as Uint8Array)
        world.flags.peerHeard = true
        await until(() => world.stopLog[world.stopLog.length - 1] === '', 'the park to end', 4000)
        const next = await world.slotAt(105_000)
        expect(next.scans).toBe(1)
    }, LONG)

    test('T6d bump B3: a resident load', async () => {
        const world = await startWorld(clone(buildSmall(1)), { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 101)
        world.flags.residentLoaded = true
        expect((await world.slotAt(103_000)).scans).toBe(1)
    }, LONG)

    test('T6e bump B5: a replaced database object', async () => {
        const world = await startWorld(clone(buildSmall(1)), { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 101)
        world.holder.db = clone(world.holder.db)
        expect((await world.slotAt(103_000)).scans).toBe(1)
    }, LONG)

    test('T6f bump B6: a slot that scanned and found a dirty verdict, even when its pass ends unchanged', async () => {
        // The clean-verdict skip is off, so the 119 s turn verdicts on the base cadence too.
        const world = await startWorld(clone(buildSmall(1)), { moduleIntervalMs: 1_000_000_000, backstopMs: 0 })
        await runSlots(world, 1, 117)
        world.mode.verdict = 'dirty'
        const dirty = await world.slotAt(119_000)
        expect(dirty.reason).toBe('verdictDirty')
        world.mode.verdict = 'real'
        const ran = await runSlots(world, 121, 125)
        expect(ran.map(({ slot }) => slot.scans)).toEqual([1, 1, 1])
    }, LONG)
})

describe('T-N1 a dirty page is activity', () => {
    test('T-N1 a mark whose debounce never elapses keeps every-slot scans beyond 60 s', async () => {
        const world = await startWorld(clone(buildSmall(0)), { moduleIntervalMs: 1_000_000_000 })
        world.state.dirty = true
        const ran = await runSlots(world, 1, 121)
        expect(ran).toHaveLength(61)
        for (const { second, slot } of ran) {
            expect(slot.scans, `scans at ${second} s`).toBe(1)
            expect(slot.reason).toBe('noResident')
            expect(slot.requests).toEqual([])
        }
    }, LONG)

    test('T-N1b a dirty page restores the 30 s module interval in the same slot', async () => {
        const world = await startWorld(clone(buildSmall(0)))
        await runSlots(world, 1, 101)
        world.state.dirty = true
        const next = await world.slotAt(103_000)
        expect(next.requests.some(takesModuleScope)).toBe(true)
    }, LONG)
})

describe('T7 to T9 the branches that are never delayed', () => {
    test('T7 a peer commit parks at the next slot while backed off', async () => {
        const world = await startWorld(clone(buildSmall(1)), { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 101)
        await peerCommit(world.kit, (peerDb) => { chars(peerDb)[0].name = 'the peer edit' })
        const parked = await world.slotAt(103_000)
        expect(parked.reason).toBe('parked')
        expect(parked.reads).toBe(1)
    }, LONG)

    test('T8 a pending key forces a full tick at the next slot while backed off', async () => {
        const world = await startWorld(clone(buildSmall(1)), { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 101)
        world.pending.on = true
        const slot = await world.slotAt(103_000)
        expect(slot.reason).toBe('pending')
        expect(slot.requests).toHaveLength(1)
    }, LONG)

    test('T9 an unsavable resident among six keeps the base cadence beyond 60 s', async () => {
        const db = clone(buildSmall(6))
        const world = await startWorld(db, { moduleIntervalMs: 1_000_000_000 })
        const bad = idOf(db, 3)
        chars(db)[3].personality = cyclic()
        await world.markedPass([bad])
        await until(() => world.unsavableCalls.length > 0, 'the character to be reported unsavable', 4000)
        const ran = await runSlots(world, 1, 121)
        for (const { second, slot } of ran) {
            expect(slot.scans, `scans at ${second} s`).toBe(1)
        }
    }, 240_000)
})

describe('T-hid a hidden page keeps the base cadence', () => {
    test('T-hid every non-module slot scans and verdicts, and module ticks come every 30 s, beyond 60 s', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        world.flags.hidden = true
        const ran = await runSlots(world, 1, 121)
        const moduleSeconds = new Set([31, 61, 91, 121])
        for (const { second, slot } of ran) {
            if (moduleSeconds.has(second)) {
                expect(slot.requests.some(takesModuleScope), `module scope at ${second} s`).toBe(true)
            } else {
                expect(slot.scans, `scans at ${second} s`).toBe(1)
                expect(slot.verdicts, `verdicts at ${second} s`).toEqual([idOf(db, 0)])
                expect(slot.reason).toBe('verdictClean')
            }
        }
    }, LONG)
})

describe('T-F4 a backed-off scan turn verdicts a resident whose clean clock is young', () => {
    test('T-F4 the edit is caught at the turn 30 s after the scan, not skipped', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db, { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 87)
        // The clock moves inside the 89 s turn, so its clean clock reads 90.5 s and is younger than the backstop at 119 s.
        world.onYield.action = () => { world.clock.now += 1_500 }
        await world.slotAt(89_000)
        chars(db)[0].personality = 'an edit with no mark'
        await runSlots(world, 91, 117)
        const turn = await world.slotAt(119_000)
        expect(turn.reason).toBe('verdictDirty')
        expect(chars(await world.kit.saved())[0].personality).toBe('an edit with no mark')
    }, LONG)
})

describe('T-F9 a failed forced tick stays owed', () => {
    test('T-F9 the next slot after the failure is a module-scope full tick that saves the edit, and the one after is not', async () => {
        const db = clone(buildSmall(4))
        const world = await startWorld(db)
        await runSlots(world, 1, 45)
        moduleOf(db, 1).description = 'a module edit with no mark'
        world.commitFault.on = true
        const planned = world.requests.length
        world.flags.sweep = true
        await until(() => world.failures.length === 1, 'the forced tick to fail', 4000)
        await nextRequestsDone(world, planned)
        world.commitFault.on = false
        const retried = await world.slotAt(47_000)
        expect(retried.requests.some(takesModuleScope)).toBe(true)
        expect(moduleOf(await world.kit.saved(), 1).description).toBe('a module edit with no mark')
        const after = await world.slotAt(49_000)
        expect(after.requests.some(takesModuleScope)).toBe(false)
    }, LONG)
})

describe('T13 a negative scan age is due', () => {
    test('T13 a scan stamped in the future does not hold back the next scan once the clock is back', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db, { moduleIntervalMs: 1_000_000_000 })
        await runSlots(world, 1, 119)
        world.readJump.ms = 1_000_000
        const jumped = await world.slotAt(121_000)
        // The scan at the jumped clock verdicts and bumps nothing: a bump there would put the activity clock in the future.
        expect(jumped.reason).toBe('verdictClean')
        expect(jumped.requests).toEqual([])
        const back = await world.slotAt(123_000)
        expect(back.scans).toBe(1)
        expect(back.reason).not.toBe('scanBackedOff')
    }, LONG)
})

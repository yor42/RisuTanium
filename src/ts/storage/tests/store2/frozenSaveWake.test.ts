// @vitest-environment node
/**
 * CHORE-166 stage 2C: one save request ends a save loop that waits in a page timer or yield on a frozen page. The loop runs
 * over the real Tauri backend on the Android stand-ins (`androidTauriWorld`) with the REAL `createSaveScheduler`; the page
 * is hidden and frozen: no timer, `scheduler.yield` or MessageChannel message is delivered, and only microtasks run. Every
 * reproducer issues exactly one `requestNow` after the loop reached the await under test, and asserts that the commit
 * bytes changed and `saved()` rose while frozen. A pass is not evidence about the native bridge or about how long a real
 * page stays unfrozen.
 * Labels: reproducer (fails on the code before the change, for the stated cause), guard (may pass before and after).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => (await import('src/ts/storage/tests/store2/androidTauriWorld')).createAndroidTauriWorld())
/** The measurement switch the suite runs under; a guard turns it on (the getter below reads it on every use). */
const measure = vi.hoisted(() => ({ on: false }))

vi.mock('src/ts/process/memory/measureFlag', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/process/memory/measureFlag')>()),
    get MEASURE() {
        return measure.on
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

import { createTauriBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { Store2CommitConflictError } from 'src/ts/storage/store2/backend/errors'
import { StubRefusedError } from 'src/ts/storage/store2/codec'
import { createCommitter } from 'src/ts/storage/store2/commit'
import { previousFrom } from 'src/ts/storage/store2/codec'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { backedOffWait, runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import { startSavePass, type SavePassMeterHandle } from 'src/ts/storage/store2/savePassMeter'
import type { Store2SaveContext } from 'src/ts/storage/store2/saveActive'
import { createSaveScheduler } from 'src/ts/storage/saveScheduler'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { shouldBypassFrozenPagePaths } from 'src/ts/storage/tauriByteTransport'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createClock, createPeerDouble, seedTree, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'

type Entry = Record<string, unknown>
type Fault = 'throw' | 'conflict' | 'notFlushed' | 'edited'

/** The delay every failure report answers; far longer than any step a test drives except where it drives it on purpose. */
const REPORT_MS = 30_000

interface TraceEntry {
    kind: 'sleep' | 'rearm' | 'wait'
    ms: number
    settled: boolean
}

interface WakeOptions {
    /** The port carries `rearmWait` (the Android transport's page port). Default true. */
    rearm?: boolean
    /** Commit writes that fail in order, one per attempt; an empty queue commits for real. */
    faults?: Fault[]
    /** Every commit write fails. */
    alwaysThrow?: boolean
    /** The commit lands and the broadcast after it throws, once. */
    landedThrow?: boolean
    /** Idle-net slots run (interval 1 ms, no backstop). */
    idleNet?: boolean
    /** Replaces the page's `yieldImmediately`. */
    yieldImmediately?: () => boolean
    /** The port's injected idle-net yield; every call is counted. */
    countYieldNow?: boolean
}

interface WakeLoop {
    scheduler: ReturnType<typeof createSaveScheduler>
    saved(): number
    attempts(): number
    reports(): unknown[]
    crashed: unknown[]
    trace: TraceEntry[]
    /** The newest back-off still pending: a sleep, rearm wait or wait of any length but the loop's own 500 ms turn. */
    backoff(): TraceEntry | null
    readCommits(): number
    yieldCalls(): number
    yieldNowCalls(): number
    edit(value: string): void
    /** A mark that is due without any request: nothing wakes the loop. */
    markDue(): void
    commitBytes(): Promise<Uint8Array>
    failNextPeerRead(): void
    holdNextCommit(): { entered(): boolean, release(): void }
    freeze(): void
    stop(): void
}

const stops: Array<() => void> = []

beforeEach(() => {
    h.reset()
    measure.on = false
})

afterEach(() => {
    for (const stop of stops) {
        stop()
    }
    stops.length = 0
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as { __risuSavePassMeter?: SavePassMeterHandle }).__risuSavePassMeter
})

function mergeBack(live: toSaveType, snapshot: toSaveType): void {
    for (const chaId of snapshot.character) {
        if (!live.character.includes(chaId)) {
            live.character.push(chaId)
        }
    }
    for (const pair of snapshot.chat) {
        if (!live.chat.some(([a, b]) => a === pair[0] && b === pair[1])) {
            live.chat.push(pair)
        }
    }
    live.botPreset ||= snapshot.botPreset
    live.modules ||= snapshot.modules
    live.loadouts ||= snapshot.loadouts
    live.plugins ||= snapshot.plugins
    live.pluginCustomStorage ||= snapshot.pluginCustomStorage
}

/**
 * The loop over the Tauri backend with its real scheduler. The page is visible and its timers are fake and advanceable
 * until `freeze()`; after it only microtasks run unless a test advances the timers again.
 */
async function startWakeLoop(options: WakeOptions = {}): Promise<WakeLoop> {
    const db = JSON.parse(JSON.stringify(buildSmall(4))) as Database
    const seedDb = JSON.parse(JSON.stringify(db)) as Database
    const clock = createClock()
    const inner = await createTauriBackend(createTauriFilesStore({ platform: 'posix' }))
    const seeded = await seedTree(inner, seedDb, testEnv(clock, 4242), fakeLists)
    const faults = [...(options.faults ?? [])]
    const counters = { attempts: 0, reads: 0, saved: 0, yieldCalls: 0, yieldNowCalls: 0 }
    const reports: unknown[] = []
    const crashed: unknown[] = []
    const trace: TraceEntry[] = []
    const peerRead = { fail: false }
    const hold = { entered: false, released: false, release: () => {}, armed: false, gate: Promise.resolve() }
    const landed = { throwOnce: options.landedThrow === true }
    const doc = { visibilityState: 'visible' }
    vi.stubGlobal('document', doc)

    const backend: Store2Backend = Object.create(inner) as Store2Backend
    backend.readCommit = async () => {
        counters.reads += 1
        if (peerRead.fail) {
            peerRead.fail = false
            throw new Error('the peer check read failed')
        }
        return inner.readCommit()
    }
    backend.commitOrdinary = async (expected, units, next) => {
        counters.attempts += 1
        if (hold.armed) {
            hold.armed = false
            hold.entered = true
            await hold.gate
            throw new Error('the held commit write failed')
        }
        if (options.alwaysThrow === true) {
            throw new Error('the commit write failed')
        }
        const fault = faults.shift()
        switch (fault) {
            case 'throw':
                throw new Error('the commit write failed')
            case 'conflict':
                throw new Store2CommitConflictError(await inner.readCommit())
            case 'edited':
                throw new StubRefusedError('module', 'module-1', null, { name: 'Module', reason: 'edited' })
            case 'notFlushed':
                return { ...(await inner.commitOrdinary(expected, units, next)), flushed: false }
            default:
                return inner.commitOrdinary(expected, units, next)
        }
    }

    const context: Store2SaveContext = {
        session: { kind: 'tauri', committer: createCommitter(backend, { owner: freshOwnerId(testEnv(clock, 778)), env: testEnv(clock, 777) }) },
        previous: previousFrom(seeded.tree),
        lists: fakeLists,
        env: testEnv(clock, 99),
        peer: createPeerDouble(),
        idleNet: options.idleNet === true ? { intervalMs: 1, backstopMs: 0 } : null,
    }
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const state = { due: false, dirty: false, peerHeard: false }
    const pageSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })
    const scheduler = createSaveScheduler({
        debounceMs: 500,
        sleep: pageSleep,
        hooks: {
            onMark: (markDirty) => {
                if (markDirty) {
                    state.dirty = true
                }
            },
            onDue: () => { state.due = true },
            onRequestNow: () => { state.dirty = true; state.due = true },
        },
    })
    const traced = <T extends Promise<unknown>>(kind: TraceEntry['kind'], ms: number, run: () => T): T => {
        const entry: TraceEntry = { kind, ms, settled: false }
        trace.push(entry)
        const promise = run()
        void promise.then(() => { entry.settled = true })
        return promise
    }
    let tail: Promise<void> = Promise.resolve()
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack,
        liveCheck: () => {},
        sweep: () => {},
        isDue: () => state.due,
        isDirty: () => state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            state.due = false
        },
        endIteration() {},
        snapshotTaken() {
            state.dirty = false
        },
        requestPass() {
            state.dirty = true
            state.due = true
        },
        unsavable() {},
        saved() {
            counters.saved += 1
        },
        broadcast() {
            if (landed.throwOnce) {
                landed.throwOnce = false
                throw new Error('the broadcast failed')
            }
        },
        peerHeard() {
            const heard = state.peerHeard
            state.peerHeard = false
            return heard
        },
        setStopped() {},
        notifyTooLarge() {},
        reportFailure(error) {
            reports.push(error)
            return REPORT_MS
        },
        reportUncountedFailure(error) {
            reports.push(error)
            return REPORT_MS
        },
        async withWriteLock(run) {
            const before = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await run()
            } finally {
                release()
            }
        },
        wait: (ms) => traced('wait', ms, () => scheduler.wait(ms)),
        sleep: (ms) => traced('sleep', ms, () => pageSleep(ms)),
        sleepForever: () => new Promise<never>(() => {}),
        now: () => Date.now(),
        pageHidden: () => doc.visibilityState === 'hidden',
        yieldImmediately: options.yieldImmediately ?? shouldBypassFrozenPagePaths,
    }
    if (options.rearm !== false) {
        port.rearmWait = (ms) => traced('rearm', ms, () => scheduler.waitRearm(ms))
    }
    if (options.countYieldNow === true) {
        port.yieldNow = async () => {
            counters.yieldNowCalls += 1
        }
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date'] })
    runStore2SaveLoop(context, port).catch((error: unknown) => {
        crashed.push(error)
    })
    const loop: WakeLoop = {
        scheduler,
        saved: () => counters.saved,
        attempts: () => counters.attempts,
        reports: () => reports,
        crashed,
        trace,
        backoff() {
            for (let index = trace.length - 1; index >= 0; index--) {
                const entry = trace[index]
                if (!entry.settled && !(entry.kind === 'wait' && (entry.ms === 500 || entry.ms === 1000) && index === trace.length - 1)) {
                    return entry
                }
            }
            return null
        },
        readCommits: () => counters.reads,
        yieldCalls: () => counters.yieldCalls,
        yieldNowCalls: () => counters.yieldNowCalls,
        edit(value) {
            const character = db.characters[0] as unknown as Entry
            character.personality = value
            const chaId = String(character.chaId)
            if (!tracker.character.includes(chaId)) {
                tracker.character.push(chaId)
            }
            state.dirty = true
        },
        markDue() {
            state.due = true
        },
        async commitBytes() {
            return (await inner.readCommit()).bytes!
        },
        failNextPeerRead() {
            peerRead.fail = true
            state.peerHeard = true
        },
        holdNextCommit() {
            hold.armed = true
            hold.entered = false
            hold.gate = new Promise<void>((resolve) => { hold.release = resolve })
            return { entered: () => hold.entered, release: () => hold.release() }
        },
        freeze() {
            doc.visibilityState = 'hidden'
            vi.stubGlobal('scheduler', { yield: () => { counters.yieldCalls += 1; return new Promise<void>(() => {}) } })
            vi.stubGlobal('MessageChannel', class {
                port1 = { onmessage: null as unknown, close() {} }
                port2 = { postMessage() {}, close() {} }
            })
            h.frozen.on = true
        },
        stop() {
            state.due = false
            options.alwaysThrow = false
            hold.release()
        },
    }
    stops.push(loop.stop)
    return loop
}

/** Advances the page's timers in small steps until `done` holds; the page is not frozen while this runs. */
async function drive(done: () => boolean, what: string, limitMs = 120_000): Promise<void> {
    for (let spent = 0; !done(); spent += 50) {
        if (spent > limitMs) {
            throw new Error(`timed out driving the page to ${what}`)
        }
        await vi.advanceTimersByTimeAsync(50)
    }
}

/** Lets only microtasks run, as a frozen page does; resolves once `done` holds, or after `limit` turns. */
async function runMicrotasks(done: () => boolean, limit = 400_000): Promise<void> {
    for (let turn = 0; turn < limit && !done(); turn++) {
        await Promise.resolve()
    }
}

interface Scenario {
    name: string
    options: WakeOptions
    /** What the loop reaches before the freeze. */
    reached(loop: WakeLoop): boolean
    /** The pending back-off then, and which port call made it. */
    backoffMs: number
    kind: 'sleep' | 'rearm'
    /** Edit and schedule a first pass; false for a scenario with no pass in it. */
    firstPass: boolean
    arrange?(loop: WakeLoop): void
}

const BACKOFF_SCENARIOS: Scenario[] = [
    { name: 'R2 a quiet retry (conflict, once)', options: { faults: ['conflict'] }, reached: (loop) => loop.attempts() >= 1, backoffMs: 1000, kind: 'rearm', firstPass: true },
    { name: 'R3 the third retry in a row (conflict, three times)', options: { faults: ['conflict', 'conflict', 'conflict'] }, reached: (loop) => loop.attempts() >= 3, backoffMs: REPORT_MS, kind: 'rearm', firstPass: true },
    { name: 'R4 a commit that landed without a flush', options: { faults: ['notFlushed'] }, reached: (loop) => loop.attempts() >= 1, backoffMs: backedOffWait(REPORT_MS, 1), kind: 'rearm', firstPass: true },
    { name: 'R5 a pass that fails before its commit lands', options: { faults: ['throw'] }, reached: (loop) => loop.attempts() >= 1, backoffMs: REPORT_MS, kind: 'rearm', firstPass: true },
    { name: 'R6 a throw after the commit landed', options: { landedThrow: true }, reached: (loop) => loop.attempts() >= 1, backoffMs: REPORT_MS, kind: 'rearm', firstPass: true },
    { name: 'R7 a module edit the commit cannot carry', options: { faults: ['edited'] }, reached: (loop) => loop.attempts() >= 1, backoffMs: REPORT_MS, kind: 'rearm', firstPass: true },
    {
        name: 'R6b a failed peer check read',
        options: {},
        reached: (loop) => loop.readCommits() >= 1,
        backoffMs: 1000,
        kind: 'rearm',
        firstPass: false,
        arrange: (loop) => loop.failNextPeerRead(),
    },
]

/** The loop reaches the scenario's back-off with the page visible, then the page freezes. */
async function reachBackOff(scenario: Scenario): Promise<WakeLoop> {
    const loop = await startWakeLoop(scenario.options)
    scenario.arrange?.(loop)
    if (scenario.firstPass) {
        loop.edit('first edit')
        loop.scheduler.schedule()
    }
    await drive(() => scenario.reached(loop) && loop.backoff() !== null && loop.backoff()!.ms === scenario.backoffMs, `the back-off of ${scenario.backoffMs} ms`)
    return loop
}

describe('one save request ends the back-off of a failed pass on a frozen page', () => {
    for (const scenario of BACKOFF_SCENARIOS) {
        // Reproducer: before the change the back-off is a page timer (a plain sleep, or a wait whose wake is spent), which never fires.
        test(`reproducer: ${scenario.name}`, async () => {
            const loop = await reachBackOff(scenario)
            const target = loop.backoff()!
            expect(target.ms).toBe(scenario.backoffMs)
            expect(target.settled).toBe(false)
            const before = await loop.commitBytes()
            const savedBefore = loop.saved()
            loop.freeze()

            loop.edit('edit made while frozen')
            loop.scheduler.requestNow()
            await runMicrotasks(() => loop.saved() > savedBefore && loop.saved() >= 1)

            expect(loop.saved()).toBeGreaterThanOrEqual(1)
            expect(loop.saved()).toBeGreaterThan(savedBefore)
            expect(Array.from(await loop.commitBytes())).not.toEqual(Array.from(before))
            expect(loop.crashed).toEqual([])
        })
    }

    // Reproducer: a request that lands while the commit is in flight and then sees it fail is spent by the back-off, if the back-off clears the latch.
    test('reproducer: R8 a request made while the commit is in flight, which then fails, still commits', async () => {
        const loop = await startWakeLoop({})
        const held = loop.holdNextCommit()
        loop.edit('first edit')
        loop.scheduler.schedule()
        await drive(() => held.entered(), 'the commit write')
        const before = await loop.commitBytes()
        loop.freeze()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        held.release()
        await runMicrotasks(() => loop.saved() >= 1)

        expect(loop.attempts()).toBeGreaterThanOrEqual(2)
        expect(loop.saved()).toBeGreaterThanOrEqual(1)
        expect(Array.from(await loop.commitBytes())).not.toEqual(Array.from(before))
        expect(loop.crashed).toEqual([])
    })

    // Reproducer: before the change the idle-net slot yields through `scheduler.yield` on a hidden Android page, which a frozen page never resumes.
    test('reproducer: R1 a request made while the idle-net slot sits in its yield commits', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        loop.freeze()
        await drive(() => loop.readCommits() >= 1, 'the idle-net slot')
        await vi.advanceTimersByTimeAsync(200)
        expect(loop.readCommits()).toBeGreaterThanOrEqual(1)
        const before = await loop.commitBytes()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        await runMicrotasks(() => loop.saved() >= 1)

        expect(loop.saved()).toBeGreaterThanOrEqual(1)
        expect(Array.from(await loop.commitBytes())).not.toEqual(Array.from(before))
        expect(loop.yieldCalls()).toBe(0)
        expect(loop.crashed).toEqual([])
    })
})

describe('guards of the wake', () => {
    // Guard: the back-off keeps its delay when nothing asks for a save, and each failure is reported once, before the choice of wait.
    const reportGuards = BACKOFF_SCENARIOS.filter((scenario) => scenario.firstPass)
    for (const scenario of reportGuards) {
        test(`G-backoff: ${scenario.name} waits its full delay and reports once per failure`, async () => {
            const loop = await reachBackOff(scenario)
            const target = loop.backoff()!
            const expectedReports = scenario.backoffMs === 1000 ? 0 : 1
            expect(loop.reports()).toHaveLength(expectedReports)
            expect(target.kind).toBe('rearm')
            const attempts = loop.attempts()

            await vi.advanceTimersByTimeAsync(scenario.backoffMs - 1)
            expect(target.settled).toBe(false)
            expect(loop.attempts()).toBe(attempts)
            await vi.advanceTimersByTimeAsync(1)
            expect(target.settled).toBe(true)

            await vi.advanceTimersByTimeAsync(2000)
            expect(loop.reports()).toHaveLength(expectedReports)
        })
    }

    // Guard: the extra attempt a request buys is bounded; five requests in a burst give one extra attempt, not a storm.
    test('G-storm: five requests during one back-off give exactly one extra attempt', async () => {
        const loop = await startWakeLoop({ alwaysThrow: true })
        loop.edit('first edit')
        loop.scheduler.schedule()
        await drive(() => loop.attempts() >= 1 && loop.backoff() !== null && loop.backoff()!.ms === REPORT_MS, 'the first back-off')
        expect(loop.attempts()).toBe(1)
        loop.freeze()

        for (let request = 0; request < 5; request++) {
            loop.scheduler.requestNow()
        }
        await runMicrotasks(() => false, 60_000)

        expect(loop.attempts()).toBe(2)
        expect(loop.crashed).toEqual([])
    })

    // Guard: a request that wakes an idle wait is spent there; the loop's next turn after the pass keeps its 500 ms.
    test('G-idle-latch: an idle wake leaves no latch behind', async () => {
        const loop = await startWakeLoop({})
        loop.freeze()
        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        await runMicrotasks(() => loop.saved() >= 1)
        expect(loop.saved()).toBe(1)

        loop.markDue()
        loop.edit('a second edit, nothing asked for a save')
        await runMicrotasks(() => false, 60_000)
        expect(loop.saved()).toBe(1)

        await vi.advanceTimersByTimeAsync(500)
        await runMicrotasks(() => loop.saved() >= 2)
        expect(loop.saved()).toBe(2)
    })

    // Guard: a page port without `rearmWait` keeps the plain timed sleep.
    test('G-nonandroid: without rearmWait the back-off is the plain sleep and runs its full delay', async () => {
        const loop = await startWakeLoop({ rearm: false, faults: ['throw'] })
        loop.edit('first edit')
        loop.scheduler.schedule()
        await drive(() => loop.attempts() >= 1 && loop.backoff() !== null && loop.backoff()!.ms === REPORT_MS, 'the back-off')
        expect(loop.backoff()!.kind).toBe('sleep')
        expect(loop.trace.some((entry) => entry.kind === 'rearm')).toBe(false)

        await vi.advanceTimersByTimeAsync(REPORT_MS - 1)
        expect(loop.attempts()).toBe(1)
        await vi.advanceTimersByTimeAsync(1)
        await drive(() => loop.saved() >= 1, 'the retry')
        expect(loop.attempts()).toBe(2)
    })

    test('G-nonandroid: a hidden page whose transport does not ask to skip yields in the idle-net slot', async () => {
        const loop = await startWakeLoop({ idleNet: true, yieldImmediately: () => false, countYieldNow: true })
        loop.freeze()
        await drive(() => loop.readCommits() >= 1, 'the idle-net slot')
        await vi.advanceTimersByTimeAsync(200)

        expect(loop.yieldNowCalls()).toBeGreaterThanOrEqual(1)
    })

    test('G-nonandroid: a hidden Android page skips the idle-net yield', async () => {
        const loop = await startWakeLoop({ idleNet: true, countYieldNow: true })
        loop.freeze()
        await drive(() => loop.readCommits() >= 1, 'the idle-net slot')
        await vi.advanceTimersByTimeAsync(200)

        expect(loop.yieldNowCalls()).toBe(0)
        expect(loop.yieldCalls()).toBe(0)
    })

    // Guard: with the yield skipped the measurement still closes its spans from the resume read, so no span is garbage.
    test('G-measure: a skipped yield keeps findMs and checksMs bounded', async () => {
        measure.on = true
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        vi.spyOn(console, 'log').mockImplementation(() => {})
        startSavePass()
        const meter = (globalThis as { __risuSavePassMeter?: SavePassMeterHandle }).__risuSavePassMeter!
        meter.reset()
        const hand = { now: 1_000_000 }
        vi.spyOn(performance, 'now').mockImplementation(() => (hand.now += 1))
        const loop = await startWakeLoop({ idleNet: true })
        loop.freeze()

        await drive(() => meter.verdicts().slotTimings.length >= 1, 'a recorded idle-net slot')
        const timing = meter.verdicts().slotTimings[meter.verdicts().slotTimings.length - 1]

        expect(loop.yieldCalls()).toBe(0)
        expect(timing.findMs).not.toBeNull()
        expect(timing.findMs!).toBeLessThan(1000)
        expect(timing.checksMs!).toBeLessThan(1000)
    })
})

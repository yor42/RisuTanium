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
import { createSaveEncoder, type SaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { previousFrom } from 'src/ts/storage/store2/codec'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { backedOffWait, IDLE_NET_MODULE_INTERVAL_MS, runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import { yieldGapMeterHandle } from 'src/ts/storage/store2/saveYieldMeter'
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
    /** Idle-net slots run (interval 1 ms, no backstop by default); an object overrides those intervals. */
    idleNet?: boolean | { intervalMs?: number, moduleIntervalMs?: number, backstopMs?: number }
    /** Replaces the page's `yieldImmediately`. */
    yieldImmediately?: () => boolean
    /** The port's injected idle-net yield; every call is counted. */
    countYieldNow?: boolean
    /** The port carries `onRequest` (the Android transport's page port) whenever it carries `rearmWait`. Default true. */
    requestHook?: boolean
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
    holdNextCommit(options?: { land?: boolean }): { entered(): boolean, release(): void }
    /** Changes a character (the first, unless named) with no mark and no dirty flag: only the idle net can find it. */
    editUnmarked(value: string, chaId?: string): void
    /** The next read of the commit key waits for the release. */
    holdNextRead(): { entered(): boolean, release(): void }
    /**
     * The page is hidden but not frozen: `scheduler.yield` and a `MessageChannel` message count their calls and resolve.
     * `scheduler.yield` resolves as a microtask. A message resolves as a microtask too, or with `messageAsTask` as a
     * fake `setTimeout(0)` task, the way a real page runs it behind the tasks already queued.
     */
    hide(options?: { messageAsTask?: boolean }): void
    /** The next yield call, on whichever primitive, never resolves. */
    parkNextYield(): void
    /** The `nth` yield call from now (1-based), on whichever primitive, resolves only after `release`. */
    holdNextYield(nth?: number): { entered(): boolean, release(): void }
    /** The next read of the commit key throws; the peer check is not signalled, so the idle net's own read fails. */
    failNextRead(): void
    /**
     * One ordered log of the loop's calls: `saved`, `redo:true`, `redo:false`, and the encoder's plans as
     * `tick-start`, `tick-end`, `tick-abort`, `marked-start`, `marked-end`, `marked-abort`.
     */
    log: string[]
    /** The scope of each tick plan that started: the resident it names and whether it takes module scope. */
    ticks: Array<{ chaId: string | null, modules: boolean }>
    /** Yields taken through `scheduler.yield`, and through a `MessageChannel` message. `yieldCalls` is their sum. */
    schedulerYields(): number
    messageYields(): number
    /** The page holds an edit that no commit has taken. */
    dirty(): boolean
    /** The module count the tick walks. */
    moduleCount(): number
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
    probeOf()?.reset()
    delete (globalThis as ProbeGlobal).__risuSaveRequestProbe
})

type ProbeGlobal = { __risuSaveRequestProbe?: { all(): Array<{ kind: string, armed?: boolean, waiting?: boolean }>, reset(): void } }

/** The request probe, read by name: absent until the first note. */
function probeOf(): ProbeGlobal['__risuSaveRequestProbe'] {
    return (globalThis as ProbeGlobal).__risuSaveRequestProbe
}

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
    const counters = { attempts: 0, reads: 0, saved: 0, yieldCalls: 0, messageYields: 0, schedulerYields: 0, yieldNowCalls: 0 }
    const reports: unknown[] = []
    const crashed: unknown[] = []
    const trace: TraceEntry[] = []
    const peerRead = { fail: false }
    const hold = { entered: false, released: false, release: () => {}, armed: false, gate: Promise.resolve(), land: false }
    const readHold = { armed: false, entered: false, release: () => {}, gate: Promise.resolve() }
    const yieldPark = { next: false }
    const yieldHold = { remaining: 0, entered: false, deliver: () => {} }
    const readFault = { next: false }
    const log: string[] = []
    const ticks: Array<{ chaId: string | null, modules: boolean }> = []
    /** The yield stubs' shared decision: a held yield enters and waits for its release; a parked one never resolves. */
    const yieldMode = (deliver: () => void): 'park' | 'hold' | 'go' => {
        if (yieldPark.next) {
            yieldPark.next = false
            return 'park'
        }
        if (yieldHold.remaining > 0) {
            yieldHold.remaining -= 1
            if (yieldHold.remaining === 0) {
                yieldHold.entered = true
                yieldHold.deliver = deliver
                return 'hold'
            }
        }
        return 'go'
    }
    const landed = { throwOnce: options.landedThrow === true }
    const doc = { visibilityState: 'visible' }
    vi.stubGlobal('document', doc)

    const backend: Store2Backend = Object.create(inner) as Store2Backend
    backend.readCommit = async () => {
        counters.reads += 1
        if (readFault.next) {
            readFault.next = false
            throw new Error('the idle net read failed')
        }
        if (readHold.armed) {
            readHold.armed = false
            readHold.entered = true
            await readHold.gate
        }
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
            if (!hold.land) {
                throw new Error('the held commit write failed')
            }
            return inner.commitOrdinary(expected, units, next)
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

    const saveEnv = testEnv(clock, 99)
    const previous = previousFrom(seeded.tree)
    const innerEncoder = createSaveEncoder({ previous, lists: fakeLists, env: saveEnv })
    // The real encoder behind a logging wrapper: it records where each plan starts and ends, and in which kind of pass.
    const encoder: SaveEncoder = Object.create(innerEncoder) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        const kind = request.net !== undefined ? 'tick' : 'marked'
        if (request.net !== undefined) {
            ticks.push({ chaId: request.net.chaId, modules: request.net.modules })
        }
        log.push(`${kind}-start`)
        try {
            const plan = await innerEncoder.plan(planDb, request)
            log.push(`${kind}-end`)
            return plan
        } catch (error) {
            log.push(`${kind}-abort`)
            throw error
        }
    }
    const context: Store2SaveContext = {
        session: { kind: 'tauri', committer: createCommitter(backend, { owner: freshOwnerId(testEnv(clock, 778)), env: testEnv(clock, 777) }) },
        previous,
        lists: fakeLists,
        env: saveEnv,
        encoder,
        peer: createPeerDouble(),
        idleNet: options.idleNet === true
            ? { intervalMs: 1, backstopMs: 0 }
            : typeof options.idleNet === 'object' ? { intervalMs: 1, backstopMs: 0, ...options.idleNet } : null,
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
            log.push('saved')
        },
        tickRedoOwed(owed) {
            log.push(`redo:${owed}`)
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
        if (options.requestHook !== false) {
            port.onRequest = (listener) => scheduler.onRequest(listener)
        }
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
        schedulerYields: () => counters.schedulerYields,
        messageYields: () => counters.messageYields,
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
        editUnmarked(value, chaId) {
            const entries = db.characters as unknown as Entry[]
            const target = chaId === undefined ? entries[0] : entries.find((entry) => entry.chaId === chaId)
            ;(target as Entry).personality = value
        },
        holdNextCommit(holdOptions) {
            hold.armed = true
            hold.land = holdOptions?.land === true
            hold.entered = false
            hold.gate = new Promise<void>((resolve) => { hold.release = resolve })
            return { entered: () => hold.entered, release: () => hold.release() }
        },
        holdNextRead() {
            readHold.armed = true
            readHold.entered = false
            readHold.gate = new Promise<void>((resolve) => { readHold.release = resolve })
            return { entered: () => readHold.entered, release: () => readHold.release() }
        },
        hide(hideOptions) {
            doc.visibilityState = 'hidden'
            vi.stubGlobal('scheduler', {
                yield: () => {
                    counters.yieldCalls += 1
                    counters.schedulerYields += 1
                    let resolveHeld = (): void => {}
                    const held = new Promise<void>((resolve) => { resolveHeld = resolve })
                    const mode = yieldMode(resolveHeld)
                    if (mode === 'park') {
                        return new Promise<void>(() => {})
                    }
                    return mode === 'hold' ? held : Promise.resolve()
                },
            })
            const asTask = hideOptions?.messageAsTask === true
            vi.stubGlobal('MessageChannel', class {
                port1 = { onmessage: null as ((event: unknown) => void) | null, close() {} }
                port2 = {
                    postMessage: () => {
                        counters.yieldCalls += 1
                        counters.messageYields += 1
                        const deliver = (): void => { this.port1.onmessage?.({}) }
                        const mode = yieldMode(deliver)
                        if (mode !== 'go') {
                            return
                        }
                        if (asTask) {
                            setTimeout(deliver, 0)
                        } else {
                            queueMicrotask(deliver)
                        }
                    },
                    close() {},
                }
            })
        },
        parkNextYield() {
            yieldPark.next = true
        },
        holdNextYield(nth = 1) {
            yieldHold.remaining = nth
            yieldHold.entered = false
            return { entered: () => yieldHold.entered, release: () => yieldHold.deliver() }
        },
        failNextRead() {
            readFault.next = true
        },
        log,
        ticks,
        dirty: () => state.dirty,
        moduleCount: () => db.modules.length,
        freeze() {
            doc.visibilityState = 'hidden'
            vi.stubGlobal('scheduler', { yield: () => { counters.yieldCalls += 1; counters.schedulerYields += 1; return new Promise<void>(() => {}) } })
            vi.stubGlobal('MessageChannel', class {
                port1 = { onmessage: null as unknown, close() {} }
                port2 = { postMessage() { counters.yieldCalls += 1; counters.messageYields += 1 }, close() {} }
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

/** Every clock read advances 10 ms, so each budget check finds the 8 ms budget spent. */
function stepClock(): void {
    let ticks = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (ticks += 10))
}

/** The loop's first module-scoped tick runs at the turn `moduleMs` after the loop started; this stops 100 ms short of it. */
async function reachBeforeModuleTick(loop: WakeLoop): Promise<void> {
    await vi.advanceTimersByTimeAsync(IDLE_NET_MODULE_INTERVAL_MS - 100)
    expect(loop.crashed).toEqual([])
}

describe('a hidden Android tick yields, and a save request pre-empts it', () => {
    // Reproducer: on the code before the change the page's skip rule removes every yield of a tick on a hidden Android page.
    test('reproducer: TA-1 a hidden module tick takes its budgeted yields (release build)', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)

        expect(loop.yieldCalls()).toBeGreaterThanOrEqual(loop.moduleCount())
        expect(loop.crashed).toEqual([])
    })

    // Reproducer: the same in a measurement build, read from the pass's yield-gap record.
    test('reproducer: TA-1 a hidden module tick takes its budgeted yields (measurement build)', async () => {
        measure.on = true
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        vi.spyOn(console, 'log').mockImplementation(() => {})
        startSavePass()
        yieldGapMeterHandle.reset()
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)

        const record = yieldGapMeterHandle.all().find((entry) => entry.kind === 'tick' && entry.modules)
        expect(record).toBeDefined()
        expect(record!.yields).toBeGreaterThanOrEqual(loop.moduleCount())
        expect(record!.hidden).toBe(true)
        expect(record!.pageSkip).toBe(true)
        expect(record!.preempted).toBe(false)
    })

    // Reproducer: the raced yield of a hidden Android tick is a message, never `scheduler.yield`.
    test('reproducer: T1.1 a hidden module tick takes its raced yields as messages and none through scheduler.yield (release build)', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)

        expect(loop.messageYields()).toBeGreaterThanOrEqual(loop.moduleCount())
        expect(loop.schedulerYields()).toBe(0)
        expect(loop.crashed).toEqual([])
    })

    // Diagnostic under a stated platform model: a message is a task that queues behind the page's other tasks while
    // `scheduler.yield` is a microtask here. The tick still ends once the page's tasks run, through messages only.
    test('diagnostic: T1.2 a hidden module tick whose messages are tasks finishes through messages only', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide({ messageAsTask: true })
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)

        expect(loop.messageYields()).toBeGreaterThanOrEqual(loop.moduleCount())
        expect(loop.schedulerYields()).toBe(0)
        expect(loop.crashed).toEqual([])
    })

    // Reproducer: the record of a hidden tick names the primitive it used, with the localStorage switch absent.
    test('reproducer: T1.3 the yield-gap record of a hidden tick reads message mode with the switch absent (measurement build)', async () => {
        measure.on = true
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        vi.spyOn(console, 'log').mockImplementation(() => {})
        startSavePass()
        yieldGapMeterHandle.reset()
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)

        const record = yieldGapMeterHandle.all().find((entry) => entry.kind === 'tick' && entry.modules)
        expect(record).toBeDefined()
        expect(record!.mode).toBe('message')
        expect(loop.schedulerYields()).toBe(0)
    })

    // Reproducer of the pre-emption half. Base B- (scratch): no race and no `isDue` term; the parked yield is never resolved.
    test('reproducer: TA-2 a tick parked in a yield on a frozen page is pre-empted and the request commits', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        loop.parkNextYield()
        stepClock()
        await vi.advanceTimersByTimeAsync(100)
        await runMicrotasks(() => loop.yieldCalls() >= 1, 20_000)
        loop.freeze()
        expect(loop.yieldCalls()).toBe(1)
        const savedBefore = loop.saved()
        const before = await loop.commitBytes()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        await runMicrotasks(() => loop.saved() > savedBefore && !loop.dirty())

        expect(loop.saved()).toBeGreaterThan(savedBefore)
        expect(Array.from(await loop.commitBytes())).not.toEqual(Array.from(before))
        expect(loop.dirty()).toBe(false)
        expect(loop.yieldCalls()).toBe(1)
        expect(loop.crashed).toEqual([])
    })

    // Reproducer of the `isDue` term: a request that lands before the tick's first yield leaves no race to win.
    test('reproducer: TA-3 a request made while the tick reads, before its first yield, takes no yield', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        const held = loop.holdNextRead()
        stepClock()
        await vi.advanceTimersByTimeAsync(100)
        await runMicrotasks(() => held.entered(), 20_000)
        expect(held.entered()).toBe(true)
        loop.freeze()
        const savedBefore = loop.saved()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        held.release()
        await runMicrotasks(() => loop.saved() > savedBefore && !loop.dirty())

        expect(loop.saved()).toBeGreaterThan(savedBefore)
        expect(loop.dirty()).toBe(false)
        expect(loop.yieldCalls()).toBe(0)
        expect(loop.crashed).toEqual([])
    })

    // New-behaviour (a measurement that did not exist before; not a reproducer of a defect). Reads the probe global by name.
    test('probe: a request while a hidden tick is parked in a yield reads armed and the yield-gap record is pre-empted', async () => {
        measure.on = true
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        vi.spyOn(console, 'log').mockImplementation(() => {})
        startSavePass()
        yieldGapMeterHandle.reset()
        probeOf()?.reset()
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        loop.parkNextYield()
        stepClock()
        await vi.advanceTimersByTimeAsync(100)
        await runMicrotasks(() => loop.yieldCalls() >= 1, 20_000)
        loop.freeze()
        const savedBefore = loop.saved()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        await runMicrotasks(() => loop.saved() > savedBefore && !loop.dirty())

        const requests = probeOf()!.all().filter((record) => record.kind === 'requestNow')
        const last = requests[requests.length - 1]
        expect(last.kind === 'requestNow' && last.armed).toBe(true)
        expect(last.kind === 'requestNow' && last.waiting).toBe(false)
        const gap = yieldGapMeterHandle.all().find((entry) => entry.kind === 'tick' && entry.modules)
        expect(gap).toBeDefined()
        expect(gap!.preempted).toBe(true)
        expect(loop.crashed).toEqual([])
    })

    // New-behaviour: a request that lands while the tick reads, before its first yield, finds no listener armed.
    test('probe: a request while the tick reads, before its first yield, reads armed false and waiting false', async () => {
        measure.on = true
        probeOf()?.reset()
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        const held = loop.holdNextRead()
        stepClock()
        await vi.advanceTimersByTimeAsync(100)
        await runMicrotasks(() => held.entered(), 20_000)
        expect(held.entered()).toBe(true)
        loop.freeze()
        const savedBefore = loop.saved()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        held.release()
        await runMicrotasks(() => loop.saved() > savedBefore && !loop.dirty())

        const requests = probeOf()!.all().filter((record) => record.kind === 'requestNow')
        const last = requests[requests.length - 1]
        expect(last.kind === 'requestNow' && last.armed).toBe(false)
        expect(last.kind === 'requestNow' && last.waiting).toBe(false)
        expect(loop.crashed).toEqual([])
    })

    // Guard: a marked pass keeps the page's skip on a frozen hidden Android page, whatever the hook says. Save mine reaches the
    // loop as a marked pass (its answer requests a pass first), so this also pins the Save-mine exclusion in reachable states.
    test('guard: TA-4 a marked pass on a frozen page with the request hook commits without yielding', async () => {
        const loop = await startWakeLoop({})
        loop.freeze()
        stepClock()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        await runMicrotasks(() => loop.saved() >= 1)

        expect(loop.saved()).toBeGreaterThanOrEqual(1)
        expect(loop.yieldCalls()).toBe(0)
        expect(loop.crashed).toEqual([])
    })

    // Reproducer of the release rule: a listener that a finished yield leaves armed turns the next idle request into a latch.
    test('reproducer: TA-6(c) a finished hidden tick leaves no listener armed, so an idle request leaves no latch', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)
        expect(loop.yieldCalls()).toBeGreaterThanOrEqual(loop.moduleCount())
        const savedBefore = loop.saved()

        loop.edit('edit made while idle')
        loop.scheduler.requestNow()
        await runMicrotasks(() => loop.saved() > savedBefore)
        const saved = loop.saved()
        expect(saved).toBeGreaterThan(savedBefore)

        loop.markDue()
        loop.edit('a second edit, nothing asked for a save')
        await runMicrotasks(() => false, 60_000)
        expect(loop.saved()).toBe(saved)
    })

    // Guard: a visible page yields in a tick as before (passes before and after from the Stage 0 snapshot on; the `hidden` field is new).
    test('guard: TA-8 a visible page takes the tick yields (measurement build)', async () => {
        measure.on = true
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        vi.spyOn(console, 'log').mockImplementation(() => {})
        startSavePass()
        yieldGapMeterHandle.reset()
        const loop = await startWakeLoop({ idleNet: true })
        vi.stubGlobal('scheduler', { yield: () => Promise.resolve() })
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)

        const record = yieldGapMeterHandle.all().find((entry) => entry.kind === 'tick' && entry.modules)
        expect(record).toBeDefined()
        expect(record!.hidden).toBe(false)
        expect(record!.yields).toBeGreaterThanOrEqual(loop.moduleCount())
    })

    // Guard (passes before and after): a visible Android page is not raced, so its tick yields through scheduler.yield and no message.
    test('guard: T1.4 a visible page takes its tick yields through scheduler.yield and none by message', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        const counted = { scheduler: 0, message: 0 }
        vi.stubGlobal('scheduler', { yield: () => { counted.scheduler += 1; return Promise.resolve() } })
        vi.stubGlobal('MessageChannel', class {
            port1 = { onmessage: null as unknown, close() {} }
            port2 = { postMessage() { counted.message += 1 }, close() {} }
        })
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)

        expect(counted.scheduler).toBeGreaterThanOrEqual(loop.moduleCount())
        expect(counted.message).toBe(0)
        expect(loop.crashed).toEqual([])
    })

    // Guard: a port without the request hook keeps today's skip on a hidden Android page.
    test('guard: TA-8 without the request hook a hidden tick takes no yield', async () => {
        const loop = await startWakeLoop({ idleNet: true, requestHook: false })
        loop.hide()
        await reachBeforeModuleTick(loop)
        stepClock()
        await vi.advanceTimersByTimeAsync(1000)

        expect(loop.yieldCalls()).toBe(0)
        expect(loop.crashed).toEqual([])
    })
})

/** The page is hidden and the first module tick waits in its `nth` yield; resolves once it is there. */
async function holdModuleTick(loop: WakeLoop, nth = 1): Promise<{ entered(): boolean, release(): void }> {
    loop.hide()
    await reachBeforeModuleTick(loop)
    const held = loop.holdNextYield(nth)
    stepClock()
    await vi.advanceTimersByTimeAsync(100)
    await runMicrotasks(() => held.entered(), 20_000)
    expect(held.entered()).toBe(true)
    return held
}

/** A mark and one save request while a tick waits in a yield; resolves once the marked pass has committed. */
async function requestWhileHeld(loop: WakeLoop): Promise<void> {
    const before = loop.saved()
    loop.edit(`marked edit ${before}`)
    loop.scheduler.requestNow()
    await drive(() => loop.saved() > before && !loop.dirty(), 'the marked pass saved')
}

/** The log entries of the plans, the saves and the redo signal, in order. */
function planLog(loop: WakeLoop, ...kinds: string[]): string[] {
    return loop.log.filter((entry) => kinds.includes(entry))
}

/** The page is frozen in a held module tick, a request ends it, and the marked pass commits; the page is then thawed and hidden. */
async function cutModuleTickFrozen(loop: WakeLoop): Promise<void> {
    await holdModuleTick(loop)
    loop.freeze()
    const savedBefore = loop.saved()
    loop.edit('edit made while frozen')
    loop.scheduler.requestNow()
    await runMicrotasks(() => loop.saved() > savedBefore && !loop.dirty())
    h.frozen.on = false
    loop.hide()
}

describe('a hidden full or module tick ends at the first yield after a pass is due, and its redo is owed', () => {
    // Reproducer: the Stage 1 tick finishes under the page rule once a request arrives, so its plan ends before the marked pass starts.
    test('reproducer: T2.1 a request in a hidden tick\'s yield cuts it; the marked pass commits next with microtasks only', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        const held = await holdModuleTick(loop)
        loop.freeze()
        const savedBefore = loop.saved()
        const before = await loop.commitBytes()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        await runMicrotasks(() => loop.saved() > savedBefore && !loop.dirty())

        expect(held.entered()).toBe(true)
        expect(loop.log).not.toContain('tick-end')
        expect(loop.log.indexOf('tick-abort')).toBeGreaterThan(-1)
        expect(loop.log.indexOf('tick-abort')).toBeLessThan(loop.log.indexOf('marked-start'))
        expect(Array.from(await loop.commitBytes())).not.toEqual(Array.from(before))
        expect(loop.dirty()).toBe(false)
        // The cut is quiet: nothing is reported, no back-off waits, and only the marked pass counts as a save.
        expect(loop.reports()).toEqual([])
        expect(loop.trace.some((entry) => entry.kind !== 'wait')).toBe(false)
        expect(planLog(loop, 'saved')).toHaveLength(1)
        expect(loop.crashed).toEqual([])
    })

    // Reproducer: the cut tick's yield-gap record plans nothing and says it was cut.
    test('reproducer: T2.2 the yield-gap record of a cut tick has a null planMs and cut true (measurement build)', async () => {
        measure.on = true
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        vi.spyOn(console, 'log').mockImplementation(() => {})
        startSavePass()
        yieldGapMeterHandle.reset()
        const loop = await startWakeLoop({ idleNet: true })
        await holdModuleTick(loop)
        loop.freeze()
        const savedBefore = loop.saved()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        await runMicrotasks(() => loop.saved() > savedBefore && !loop.dirty())

        const record = yieldGapMeterHandle.all().find((entry) => entry.kind === 'tick' && entry.modules)
        expect(record).toBeDefined()
        expect(record!.planMs).toBeNull()
        expect(record!.cut).toBe(true)
        expect(record!.preempted).toBe(true)
    })

    // Reproducer: a request that landed while the tick read its base cuts it before it plans anything.
    test('reproducer: T2.3 a request made while the tick reads cuts it before its plan starts', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        loop.hide()
        await reachBeforeModuleTick(loop)
        const held = loop.holdNextRead()
        stepClock()
        await vi.advanceTimersByTimeAsync(100)
        await runMicrotasks(() => held.entered(), 20_000)
        expect(held.entered()).toBe(true)
        loop.freeze()
        const savedBefore = loop.saved()

        loop.edit('edit made while frozen')
        loop.scheduler.requestNow()
        held.release()
        await runMicrotasks(() => loop.saved() > savedBefore && !loop.dirty())

        expect(loop.ticks).toEqual([])
        expect(loop.log).not.toContain('tick-start')
        expect(loop.log).toContain('marked-end')
        expect(loop.reports()).toEqual([])
    })

    // Reproducer: ticks 1 and 2 are cut, tick 3 finishes whatever becomes due, tick 4 may be cut again.
    test('reproducer: T2.4 two consecutive cuts, then a finished tick that ends the redo, then a fresh streak', async () => {
        const loop = await startWakeLoop({ idleNet: { moduleIntervalMs: 1 } })
        loop.hide()
        for (let tick = 1; tick <= 4; tick++) {
            const held = loop.holdNextYield()
            stepClock()
            await drive(() => held.entered(), `tick ${tick} in its first yield`)
            await requestWhileHeld(loop)
        }

        expect(planLog(loop, 'tick-abort', 'tick-end').slice(0, 4)).toEqual(['tick-abort', 'tick-abort', 'tick-end', 'tick-abort'])
        expect(planLog(loop, 'redo:true', 'redo:false').slice(0, 4)).toEqual(['redo:true', 'redo:true', 'redo:false', 'redo:true'])
        expect(loop.reports()).toEqual([])
        expect(loop.crashed).toEqual([])
    })

    // Guard (the base has no cut): the redo takes module scope again and names the same resident as the cut tick.
    test('guard: T2.5/T2.6 the redo takes the cut tick\'s module scope and its resident', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        await cutModuleTickFrozen(loop)

        await drive(() => loop.ticks.length >= 2, 'the redo tick')

        expect(loop.ticks[0].modules).toBe(true)
        expect(loop.ticks[1]).toEqual(loop.ticks[0])
        expect(loop.ticks[0].chaId).not.toBeNull()
    })

    // Guard: the redo's signal order. `redo:true` precedes the marked save; `redo:false` follows the redo's plan, and its save when it wrote.
    test('guard: T2.16 redo:true precedes the marked save and redo:false follows the redo tick\'s own save', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        await cutModuleTickFrozen(loop)
        loop.editUnmarked('an unmarked edit the redo carries', loop.ticks[0].chaId!)

        await drive(() => loop.log.includes('redo:false'), 'the redo ended')

        expect(loop.log).toEqual([
            'tick-start', 'tick-abort', 'redo:true', 'marked-start', 'marked-end', 'saved',
            'tick-start', 'tick-end', 'saved', 'redo:false',
        ])
    })

    // Guard: a redo that plans unchanged ends the owed state with no save of its own.
    test('guard: T2.17 a redo that plans unchanged ends with redo:false and no save', async () => {
        const loop = await startWakeLoop({ idleNet: true })
        await cutModuleTickFrozen(loop)

        await drive(() => loop.log.includes('redo:false'), 'the redo ended')

        expect(loop.log.slice(loop.log.indexOf('marked-end'))).toEqual(['marked-end', 'saved', 'tick-start', 'tick-end', 'redo:false'])
    })

    // Guard: a request that arrives while the tick's own commit is under way does not cut it.
    test('guard: T2.8 a request during the tick\'s commit does not cut it; both commits land', async () => {
        const loop = await startWakeLoop({ idleNet: { moduleIntervalMs: 1 } })
        loop.hide()
        loop.editUnmarked('an unmarked edit the tick carries')
        const held = loop.holdNextCommit({ land: true })
        stepClock()
        await drive(() => held.entered(), 'the tick\'s commit')

        loop.edit('marked edit')
        loop.scheduler.requestNow()
        held.release()
        await drive(() => planLog(loop, 'saved').length >= 2 && !loop.dirty(), 'both commits saved')

        expect(loop.log.slice(0, 6)).toEqual(['tick-start', 'tick-end', 'saved', 'marked-start', 'marked-end', 'saved'])
        expect(loop.reports()).toEqual([])
    })

    // Guard: a marked pass is never cut, even when another request becomes due during its read.
    test('guard: T2.9 a request during a marked pass\'s read does not cut it', async () => {
        const loop = await startWakeLoop({})
        loop.hide()
        const held = loop.holdNextRead()
        loop.edit('edit 1')
        loop.scheduler.requestNow()
        stepClock()
        await drive(() => held.entered(), 'the marked pass\'s read')

        loop.edit('edit 2')
        loop.scheduler.requestNow()
        held.release()
        await drive(() => planLog(loop, 'marked-end').length >= 2 && !loop.dirty(), 'both marked passes ended')

        expect(loop.log).not.toContain('marked-abort')
        expect(loop.reports()).toEqual([])
    })

    // Guard (passes before and after): a visible Android page is not cut; its tick finishes before the marked pass.
    test('guard: T2.10 a request inside a visible tick\'s yield does not cut it', async () => {
        const loop = await startWakeLoop({ idleNet: { moduleIntervalMs: 1 } })
        let yields = 0
        vi.stubGlobal('scheduler', {
            yield: () => {
                yields += 1
                if (yields === 2) {
                    loop.edit('edit inside the yield')
                    loop.scheduler.requestNow()
                }
                return Promise.resolve()
            },
        })
        stepClock()
        await drive(() => loop.log.includes('marked-end'), 'the marked pass')

        expect(loop.log).not.toContain('tick-abort')
        expect(loop.log.indexOf('tick-end')).toBeGreaterThan(-1)
        expect(loop.log.indexOf('tick-end')).toBeLessThan(loop.log.indexOf('marked-start'))
    })

    // Reproducer: a debounced edit's due flag, with no request listener fired, cuts the tick at its next yield.
    test('reproducer: T2.12 a debounced edit that becomes due in a yield cuts the tick; the marked pass follows the 500 ms wait', async () => {
        const loop = await startWakeLoop({ idleNet: { moduleIntervalMs: 1 } })
        loop.hide()
        const held = loop.holdNextYield()
        stepClock()
        await drive(() => held.entered(), 'the tick in its first yield')

        loop.edit('a debounced edit')
        loop.scheduler.schedule()
        await vi.advanceTimersByTimeAsync(500)
        held.release()
        await runMicrotasks(() => loop.log.includes('tick-abort'), 20_000)

        expect(loop.log).not.toContain('tick-end')
        expect(loop.log).toContain('tick-abort')
        expect(loop.log).not.toContain('marked-start')
        await vi.advanceTimersByTimeAsync(600)
        expect(loop.log).toContain('marked-start')
    })

    // Guard (passes before and after; red when the verdict exemption is removed): a verdict tick commits before the marked pass.
    test('guard: T2.15 a hidden verdict tick with a request in its yield is not cut', async () => {
        const loop = await startWakeLoop({ idleNet: { moduleIntervalMs: 1_000_000_000 } })
        loop.hide()
        loop.editUnmarked('an unmarked edit the verdict finds')
        const held = loop.holdNextYield()
        stepClock()
        await drive(() => held.entered(), 'the verdict tick in its yield')
        expect(loop.ticks[0].modules).toBe(false)
        expect(loop.ticks[0].chaId).not.toBeNull()

        loop.edit('marked edit')
        loop.scheduler.requestNow()
        await drive(() => loop.log.includes('marked-end'), 'the marked pass')

        expect(loop.log).not.toContain('tick-abort')
        expect(loop.log.indexOf('tick-end')).toBeLessThan(loop.log.indexOf('marked-start'))
        expect(loop.log.indexOf('saved')).toBeLessThan(loop.log.indexOf('marked-start'))
        expect(loop.log.some((entry) => entry.startsWith('redo'))).toBe(false)
    })

    // Guard: a cut full tick that was not module-scoped still owes a full redo, and the redo ends the owed state.
    test('guard: T2.18 a read-fault full tick that is cut is followed by a full tick and redo:false', async () => {
        const loop = await startWakeLoop({ idleNet: { moduleIntervalMs: 1_000_000_000 } })
        loop.hide()
        loop.failNextRead()
        const held = loop.holdNextYield()
        stepClock()
        await drive(() => held.entered(), 'the full tick in its yield')
        expect(loop.ticks[0].modules).toBe(false)
        await requestWhileHeld(loop)

        await drive(() => loop.log.includes('redo:false'), 'the redo ended')

        expect(loop.ticks.length).toBeGreaterThanOrEqual(2)
        expect(planLog(loop, 'redo:true', 'redo:false')).toEqual(['redo:true', 'redo:false'])
    })

    // Guard: the redo waits for the net interval after the cut and runs at the next slot after that.
    test('guard: T2.19 the redo does not start before the net interval and starts at the slot after it', async () => {
        const loop = await startWakeLoop({ idleNet: { intervalMs: 1000, moduleIntervalMs: 1 } })
        loop.hide()
        const held = loop.holdNextYield()
        stepClock()
        await drive(() => held.entered(), 'the tick in its first yield')
        const cutAt = Date.now()
        await requestWhileHeld(loop)

        let redoAt = -1
        for (let spent = 0; spent < 4000 && redoAt < 0; spent += 50) {
            await vi.advanceTimersByTimeAsync(50)
            if (loop.ticks.length >= 2) {
                redoAt = Date.now()
            }
        }

        expect(redoAt).toBeGreaterThanOrEqual(cutAt - 100 + 1000)
        expect(redoAt).toBeLessThanOrEqual(cutAt + 1500 + 100)
    })
})

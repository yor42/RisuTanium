// @vitest-environment node
/**
 * The save loop's quiet `deferred` outcome: a module the planner cannot carry is loaded through the context's valve, the
 * valve answers `deferred` while the load waits for the person, and the loop makes no further pass until the load has
 * settled. The loop is the real `runStore2SaveLoop` over a real memory backend and committer; the valve is a double whose
 * answers and `settled` promise the test controls, and the port records what the loop reports. A refusal is made the way
 * a page meets it: a module stub of a recorded entry, plus a second module of the same id.
 * Labels: reproducer (fails against the base or the named mutant), guard (passes before and after).
 */
import { afterEach, describe, expect, test } from 'vitest'
import { StubRefusedError } from '../../store2/codec'
import { moduleStubOf } from '../../store2/moduleStubMatch'
import type { ModuleStubLoad } from '../../store2/saveActive'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { runStore2SaveLoop, type IdleNetOptions, type Store2LoopPort } from '../../store2/saveLoop'
import type { Committer } from '../../store2/commit'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { createPeerDouble, peerCommit, peerPin, startStore2, type PeerDouble, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

type Plain = Record<string, unknown>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

interface Gate {
    promise: Promise<void>
    settle(): void
}

function gateOf(): Gate {
    let settle: () => void = () => {}
    const promise = new Promise<void>((resolve) => { settle = resolve })
    return { promise, settle }
}

interface Run {
    kit: Store2Kit
    peer: PeerDouble
    db: Database
    /** The module as the store holds it, for the install a flight would make. */
    body: Plain
    tracker: toSaveType
    clock: { now: number }
    state: { due: boolean, dirty: boolean, saved: number, begun: number, ended: number }
    /** Each reported failure, with how many valve calls had been made when it was reported. */
    failures: Array<{ error: unknown, attempts: number, valveCallsAtReport: number }>
    uncounted: unknown[]
    sleeps: number[]
    requests: SavePassRequest[]
    valveCalls: string[]
    /** The answers of the valve, by call number. */
    valve: (call: number) => ModuleStubLoad
    commits: number
    reads: number
    crashed: unknown[]
    heard: boolean
    /** Marks the modules dirty and asks for a pass, as an edit does. */
    mark(): void
    /** Puts the full body back into the stub's slot, as a finished load does. */
    install(index?: number): void
    /** Whether the write lock is free right now. */
    lockFree(): Promise<boolean>
    stop(): void
}

const runs: Run[] = []

afterEach(() => {
    for (const run of runs.splice(0)) {
        run.stop()
    }
})

interface StartOptions {
    idleNet?: IdleNetOptions | null
    peerAnswer?: 'reload' | 'save-mine'
    /** Whether the live list starts as the refusing state (a stub and a second module of its id). */
    refusing?: boolean
}

/** Turns module 0 of `db` into its recorded stub and adds a second module of the same id: the planner cannot carry the stub then. */
function refuse(run: Pick<Run, 'db' | 'kit'>, index = 0): void {
    const entry = run.kit.context.previous.objects?.moduleIndex?.entries[index]
    if (entry === undefined) {
        throw new Error('The seeded tree holds no module index.')
    }
    const modules = run.db.modules as unknown as Plain[]
    modules.push({ ...clone(modules[index]), name: 'second module of the same id' })
    modules[index] = moduleStubOf(entry) as unknown as Plain
}

async function startRun(options: StartOptions = {}): Promise<Run> {
    const peer = createPeerDouble(options.peerAnswer ?? 'reload')
    const kit = await startStore2({ db: buildSmall(2), peer, idleNet: options.idleNet ?? null })
    const db = clone(kit.seedDb)
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    kit.context.encoder = encoder
    const valveCalls: string[] = []
    const run: Run = {
        kit, peer, db, body: clone((kit.seedDb.modules as unknown as Plain[])[0]),
        tracker: { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false },
        clock: { now: 1_800_000_000_000 },
        state: { due: false, dirty: false, saved: 0, begun: 0, ended: 0 },
        failures: [], uncounted: [], sleeps: [], requests, valveCalls,
        valve: () => ({ kind: 'loaded' }),
        commits: 0, reads: 0, crashed: [], heard: false,
        mark() {
            run.tracker.modules = true
            run.state.dirty = true
            run.state.due = true
        },
        install(index = 0) {
            ;(run.db.modules as unknown as Plain[])[index] = clone((kit.seedDb.modules as unknown as Plain[])[index])
        },
        async lockFree() {
            return Promise.race([port.withWriteLock(async () => true), sleep(80).then(() => false)])
        },
        stop() {
            stopped = true
        },
    }
    kit.context.loadModuleStub = async (moduleId) => {
        valveCalls.push(moduleId)
        return run.valve(valveCalls.length)
    }
    const wrapped = kit.context.session.committer
    if (wrapped !== null) {
        const counting: Committer = {
            ...wrapped,
            async readCommit() {
                run.reads += 1
                return wrapped.readCommit()
            },
            async commit(read, request) {
                run.commits += 1
                return wrapped.commit(read, request)
            },
            async saveMine(read, request) {
                run.commits += 1
                return wrapped.saveMine(read, request)
            },
        }
        kit.context.session = { ...kit.context.session, committer: counting }
    }
    if (options.refusing !== false) {
        refuse(run)
    }
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker: run.tracker,
        reloadFlag: { state: false },
        getDatabase: () => run.db,
        mergeBack(live, snapshot) {
            live.modules ||= snapshot.modules
        },
        liveCheck: () => {},
        sweep: () => {},
        isDue: () => run.state.due,
        isDirty: () => run.state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            run.state.due = false
            run.state.begun += 1
        },
        endIteration() {
            run.state.ended += 1
        },
        snapshotTaken() {
            run.state.dirty = false
        },
        requestPass() {
            run.state.dirty = true
            run.state.due = true
        },
        unsavable: () => {},
        saved() {
            run.state.saved += 1
        },
        broadcast: () => {},
        peerHeard() {
            const heard = run.heard
            run.heard = false
            return heard
        },
        setStopped: () => {},
        reportFailure(error, attempts) {
            run.failures.push({ error, attempts, valveCallsAtReport: valveCalls.length })
            return 1
        },
        reportUncountedFailure(error) {
            run.uncounted.push(error)
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
        async sleep(ms) {
            run.sleeps.push(ms)
            await idle()
        },
        sleepForever: () => new Promise<never>(() => {}),
        now: () => run.clock.now,
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        run.crashed.push(error)
    })
    runs.push(run)
    return run
}

describe('the valve loads each refused module once per pass', () => {
    test('two refused modules are both loaded in the one pass, which then saves', async () => {
        const run = await startRun({ refusing: false })
        refuse(run, 0)
        refuse(run, 1)
        run.valve = (call) => {
            run.install(call - 1)
            return { kind: 'loaded' }
        }
        run.mark()
        await until(() => run.state.saved === 1, 'the pass that loads both modules')
        expect(run.valveCalls).toHaveLength(2)
        expect(run.commits).toBe(1)
        expect(run.failures).toEqual([])
    })

    test('a load that leaves the refusal in place is a failed save after one load, with the planner\'s own refusal', async () => {
        const run = await startRun()
        // A valve that keeps answering loaded must not keep the pass planning: the cap ends a loop that has no bound of its own.
        run.valve = (call) => {
            if (call > 5) {
                throw new Error('The valve was called again and again in one pass.')
            }
            return { kind: 'loaded' }
        }
        run.mark()
        await until(() => run.failures.length >= 1, 'the failed save')
        // The retry pass starts within milliseconds, so the live call count may already be 2; the count at the moment of the report is the invariant.
        expect(run.failures[0].valveCallsAtReport).toBe(1)
        expect(run.failures[0].error).toBeInstanceOf(StubRefusedError)
        expect(run.commits).toBe(0)
    })

    test('guard: the pass after a failed one loads the same module again, not once per page', async () => {
        const run = await startRun()
        run.valve = (call) => {
            if (call > 20) {
                throw new Error('The valve was called again and again.')
            }
            return { kind: 'loaded' }
        }
        run.mark()
        await until(() => run.failures.length >= 1, 'the failed save')
        // The wait ends below the test timeout so a missing second call fails at the assertion.
        await until(() => run.valveCalls.length >= 2, 'the retry pass loading again', 2000).catch(() => {})
        expect(run.valveCalls.length).toBeGreaterThanOrEqual(2)
        expect(run.valveCalls[1]).toBe(run.valveCalls[0])
    })
})

describe('a deferred pass is quiet', () => {
    test('it reports nothing, writes nothing and holds no lock while the load waits', async () => {
        const run = await startRun()
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        await sleep(80)
        expect(run.failures).toEqual([])
        expect(run.uncounted).toEqual([])
        expect(run.commits).toBe(0)
        expect(run.state.saved).toBe(0)
        expect(await run.lockFree()).toBe(true)
        expect(run.crashed).toEqual([])
        gate.settle()
    })

    test('it makes one attempt and no retry cadence: the valve and the planner ran once, and the loop never slept', async () => {
        const run = await startRun()
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        await sleep(300)
        expect(run.valveCalls).toHaveLength(1)
        expect(run.requests).toHaveLength(1)
        expect(run.sleeps).toEqual([])
        gate.settle()
    })

    test('the page stays dirty and the iteration is closed: nothing counts as saved', async () => {
        const run = await startRun()
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        await sleep(40)
        expect(run.state.dirty).toBe(true)
        expect(run.state.saved).toBe(0)
        expect(run.state.begun).toBe(run.state.ended)
        gate.settle()
    })

    test('exactly one pass follows the settled load, carries the marks that were folded back, and commits once', async () => {
        const run = await startRun()
        const gate = gateOf()
        run.valve = (call) => call === 1 ? { kind: 'deferred', settled: gate.promise } : { kind: 'refused' }
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        run.install()
        gate.settle()
        await until(() => run.state.saved === 1, 'the pass after the answer')
        await sleep(100)
        expect(run.requests).toHaveLength(2)
        expect(run.requests[1].modules).toBe(true)
        expect(run.valveCalls).toHaveLength(1)
        expect(run.commits).toBe(1)
        expect(run.failures).toEqual([])
    })

    test('a load that failed is reported once, by the next pass, as the planner\'s own refusal', async () => {
        const run = await startRun()
        const gate = gateOf()
        run.valve = (call) => call === 1 ? { kind: 'deferred', settled: gate.promise } : { kind: 'refused' }
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        await sleep(60)
        expect(run.failures).toEqual([])
        gate.settle()
        await until(() => run.failures.length >= 1, 'the report')
        expect(run.failures[0].attempts).toBe(1)
        expect(run.failures[0].error).toBeInstanceOf(StubRefusedError)
        expect(run.failures[0].error).toMatchObject({ kind: 'module', reason: 'uncarriable' })
    })
})

describe('the loop keeps its park, peer and net handling while a load is deferred', () => {
    test('a peer commit during the deferral parks the page and asks the person, and no pass runs', async () => {
        const run = await startRun()
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        await peerCommit(run.kit, (peerDb) => { peerDb.username = 'written by a peer' })
        run.heard = true
        await until(() => run.peer.asked.length === 1, 'the question about the peer commit')
        expect(run.requests).toHaveLength(1)
        expect(run.peer.asked[0].reason).toBe('peer-commit')
        gate.settle()
    })

    test('a peer signal during the deferral reads the base again and changes nothing when the base is still this page\'s', async () => {
        const run = await startRun()
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        await sleep(40)
        const before = run.reads
        await peerPin(run.kit)
        run.heard = true
        await until(() => run.reads > before, 'the base read')
        await sleep(60)
        expect(run.peer.asked).toEqual([])
        expect(run.requests).toHaveLength(1)
        gate.settle()
    })

    test('the idle net takes no slot while a load is deferred', async () => {
        const run = await startRun({ idleNet: { intervalMs: 1, moduleIntervalMs: 1 } })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        await sleep(40)
        const reads = run.reads
        const planned = run.requests.length
        run.clock.now += 60_000
        await sleep(150)
        expect(run.reads).toBe(reads)
        expect(run.requests).toHaveLength(planned)
        gate.settle()
    })

    test('a deferral that starts in an idle-net tick folds nothing back, and the save after the answer comes from the install\'s own mark', async () => {
        const run = await startRun({ idleNet: { intervalMs: 1, moduleIntervalMs: 1 } })
        const gate = gateOf()
        run.valve = (call) => call === 1 ? { kind: 'deferred', settled: gate.promise } : { kind: 'refused' }
        run.clock.now += 60_000
        await until(() => run.valveCalls.length === 1, 'the valve call from the tick')
        await sleep(40)
        expect(run.state.dirty).toBe(false)
        expect(run.commits).toBe(0)
        expect(run.failures).toEqual([])
        // The install writes the slot and the change effects mark the modules.
        run.install()
        run.mark()
        gate.settle()
        await until(() => run.state.saved >= 1, 'the pass after the answer')
        expect(run.commits).toBe(1)
        expect(run.failures).toEqual([])
    })
})

describe('Save mine consent survives a deferral', () => {
    test('a peer signal for the epoch the person agreed to overwrite does not park the page again', async () => {
        const run = await startRun({ peerAnswer: 'reload', refusing: false })
        const gate = gateOf()
        run.valve = (call) => call === 1 ? { kind: 'deferred', settled: gate.promise } : { kind: 'refused' }
        // A peer commits; the page, dirty, parks and asks. The question stays open while the list becomes the refusing one.
        const held = gateOf()
        run.peer.hold = held.promise
        await peerCommit(run.kit, (peerDb) => { peerDb.username = 'written by a peer' })
        run.state.dirty = true
        run.heard = true
        await until(() => run.peer.asked.length === 1, 'the question about the peer commit')
        refuse(run)
        run.tracker.modules = true
        run.peer.answer = 'save-mine'
        run.peer.hold = null
        held.settle()
        await until(() => run.valveCalls.length === 1, 'the Save mine pass reaching the valve')
        // A peer signal for the same epoch while the load is deferred.
        run.heard = true
        await sleep(150)
        expect(run.peer.asked).toHaveLength(1)
        run.install()
        run.mark()
        gate.settle()
        await until(() => run.state.saved >= 1, 'the Save mine pass after the answer')
        expect(run.peer.asked).toHaveLength(1)
        expect(run.commits).toBe(1)
        expect(run.failures).toEqual([])
    })

    test('a newer peer epoch during the deferral parks the page again and clears the consent', async () => {
        const run = await startRun({ peerAnswer: 'reload', refusing: false })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        const held = gateOf()
        run.peer.hold = held.promise
        await peerCommit(run.kit, (peerDb) => { peerDb.username = 'written by a peer' })
        run.state.dirty = true
        run.heard = true
        await until(() => run.peer.asked.length === 1, 'the question about the peer commit')
        refuse(run)
        run.tracker.modules = true
        run.peer.answer = 'save-mine'
        run.peer.hold = null
        held.settle()
        await until(() => run.valveCalls.length === 1, 'the Save mine pass reaching the valve')
        // A second peer commit moves the epoch past the one the person agreed to overwrite.
        await peerCommit(run.kit, (peerDb) => { peerDb.username = 'written by a second peer commit' }, 31338)
        run.heard = true
        await until(() => run.peer.asked.length === 2, 'the question about the newer peer commit')
        expect(run.peer.asked[1].reason).toBe('peer-commit')
        expect(run.commits).toBe(0)
        gate.settle()
    })
})

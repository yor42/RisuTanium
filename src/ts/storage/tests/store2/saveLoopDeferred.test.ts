// @vitest-environment node
/**
 * The save loop's quiet `deferred` outcome: a module the planner cannot carry is loaded through the context's valve, the
 * valve answers `deferred` while the load waits for the person, and the loop makes no further pass until the load has
 * settled. The loop is the real `runStore2SaveLoop` over a real memory backend and committer; the valve is a double whose
 * answers and `settled` promise the test controls, and the port records what the loop reports. A refusal is made the way
 * a page meets it: a module stub of a recorded entry, plus a second module of the same id.
 * Labels: reproducer (fails against the base or the named mutant), guard (passes before and after).
 * The port reports a visible page unless a test gives it a `hidden` flag and hides it.
 */
import { afterEach, describe, expect, test } from 'vitest'
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
    /** Commits whose write resolved. */
    landed: number
    /** When set, the counting committer waits for it before it writes. */
    commitHold: Promise<void> | null
    /** A hide or Back sweep the port hands to the loop at its next turn (only with the `sweep` option). */
    sweepOwed: boolean
    /** How many coming `saved` notices throw, as a failed hand-off after a landed commit does. */
    savedThrows: number
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
    /** The page's visibility, read live; without it the port has no `pageHidden` and no `markUnsaved` (a visible page). */
    hidden?: { value: boolean }
    /** Whether the port hands hide or Back sweeps to the loop (`takeNetSweep`). */
    sweep?: boolean
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
        commits: 0, reads: 0, crashed: [], heard: false, landed: 0, commitHold: null, sweepOwed: false, savedThrows: 0,
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
                if (run.commitHold !== null) {
                    await run.commitHold
                }
                const result = await wrapped.commit(read, request)
                run.landed += 1
                return result
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
            if (run.savedThrows > 0) {
                run.savedThrows -= 1
                throw new Error('The saved notice failed.')
            }
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
    const hidden = options.hidden
    if (hidden !== undefined) {
        port.pageHidden = () => hidden.value
        port.markUnsaved = () => {
            run.state.dirty = true
        }
    }
    if (options.sweep === true) {
        port.takeNetSweep = () => {
            const owed = run.sweepOwed
            run.sweepOwed = false
            return owed
        }
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

    test('a load that leaves the refusal in place is no failed save: one load, then the pass goes on with the modules carried and the person is told', async () => {
        const run = await startRun()
        // A valve that keeps answering loaded must not keep the pass planning: the cap ends a loop that has no bound of its own.
        run.valve = (call) => {
            if (call > 5) {
                throw new Error('The valve was called again and again in one pass.')
            }
            return { kind: 'loaded' }
        }
        const character = (run.db.characters as unknown as Plain[])[0]
        character.name = 'saved beside the unloaded module'
        run.tracker.character.push(character.chaId as string)
        run.mark()
        await until(() => run.state.ended >= 1, 'the first pass')
        expect(run.failures).toEqual([])
        expect(run.valveCalls).toHaveLength(1)
        expect(run.commits).toBe(1)
        expect(run.requests.at(-1)?.carryModules).toBe(true)
        expect(run.peer.notSaved).toHaveLength(1)
    })

    test('the next marked pass loads the same module again, not once per page', async () => {
        const run = await startRun()
        run.valve = (call) => {
            if (call > 20) {
                throw new Error('The valve was called again and again.')
            }
            return { kind: 'loaded' }
        }
        run.mark()
        await until(() => run.state.ended >= 1, 'the first pass')
        run.mark()
        await until(() => run.state.ended >= 2, 'the second pass')
        expect(run.valveCalls).toHaveLength(2)
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

    test('a load that failed is told once, by the next pass, as a module that cannot be saved, with no failed save', async () => {
        const run = await startRun()
        const gate = gateOf()
        run.valve = (call) => call === 1 ? { kind: 'deferred', settled: gate.promise } : { kind: 'refused' }
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the valve call')
        await sleep(60)
        expect(run.failures).toEqual([])
        expect(run.peer.notSaved).toEqual([])
        gate.settle()
        await until(() => run.failures.length >= 1 || run.peer.notSaved.length >= 1, 'the pass after the answer')
        expect(run.failures).toEqual([])
        expect(run.peer.notSaved).toHaveLength(1)
        expect(run.peer.notSaved[0].moduleId).toBe(run.kit.context.previous.objects?.moduleIndex?.entries[0].id)
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

/** A valve like the real one: `deferred` with the same flight's promise while the question is open, `refused` once it has settled. */
function askingValve(gate: Gate): (call: number) => ModuleStubLoad {
    let open = true
    void gate.promise.then(() => {
        open = false
    })
    return () => open ? { kind: 'deferred', settled: gate.promise } : { kind: 'refused' }
}

function chaIdOf(run: Run): string {
    return String((run.db.characters as unknown as Plain[])[0].chaId)
}

function nameIn(db: Database, chaId: string): unknown {
    return (db.characters as unknown as Plain[]).find((slot) => slot !== null && slot.chaId === chaId)?.name
}

/** Renames character 0; a marked edit also takes the character mark and asks for a pass, as an edit does. */
function editCharacter(run: Run, name: string, marked = true): void {
    const character = (run.db.characters as unknown as Plain[])[0]
    character.name = name
    if (marked) {
        run.tracker.character.push(character.chaId as string)
        run.state.dirty = true
        run.state.due = true
    }
}

describe('c699 a hidden page saves past an open module question (MC-1233)', () => {
    test('T1 a hide flush while the question holds the loop saves the character edit with the modules carried, quietly, and keeps the page dirty', async () => {
        const hidden = { value: false }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the visible deferred pass')
        await sleep(40)
        expect(run.commits).toBe(0)
        hidden.value = true
        editCharacter(run, 'saved while hidden')
        await sleep(300)
        expect(run.commits).toBe(1)
        const saved = await run.kit.saved()
        expect(nameIn(saved, chaIdOf(run))).toBe('saved while hidden')
        expect(saved.modules).toEqual(run.kit.seedDb.modules)
        expect(run.requests.at(-1)?.carryModules).toBe(true)
        expect(run.failures).toEqual([])
        expect(run.uncounted).toEqual([])
        expect(run.peer.notSaved).toEqual([])
        expect(run.peer.edited).toEqual([])
        expect(run.state.dirty).toBe(true)
        expect(run.tracker.modules).toBe(true)
        gate.settle()
    })

    test('T2 a page already hidden when the first deferred answer comes saves in that same pass, and a visible page then keeps the hold', async () => {
        const hidden = { value: true }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        editCharacter(run, 'saved on a hidden page')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(1)
        expect(run.valveCalls).toHaveLength(1)
        expect(run.requests).toHaveLength(2)
        expect(run.requests[1].carryModules).toBe(true)
        hidden.value = false
        const planned = run.requests.length
        run.mark()
        await sleep(300)
        expect(run.requests).toHaveLength(planned)
        expect(run.commits).toBe(1)
        gate.settle()
    })

    test('T3 a second hide saves the second edit, and a visible mark after it still makes no pass', async () => {
        const hidden = { value: false }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the visible deferred pass')
        hidden.value = true
        editCharacter(run, 'first hide')
        await sleep(300)
        expect(run.commits).toBe(1)
        hidden.value = false
        await sleep(40)
        hidden.value = true
        editCharacter(run, 'second hide')
        await sleep(300)
        expect(run.commits).toBe(2)
        expect(nameIn(await run.kit.saved(), chaIdOf(run))).toBe('second hide')
        hidden.value = false
        const planned = run.requests.length
        run.mark()
        await sleep(300)
        expect(run.requests).toHaveLength(planned)
        gate.settle()
    })

    test('T4a after a held commit, the answer that installs is followed by exactly one pass with module scope', async () => {
        const hidden = { value: true }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = askingValve(gate)
        editCharacter(run, 'held commit')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(1)
        run.install()
        gate.settle()
        await until(() => run.commits === 2, 'the pass after the answer')
        await sleep(100)
        expect(run.commits).toBe(2)
        expect(run.requests.at(-1)?.modules).toBe(true)
        expect(run.requests.at(-1)?.carryModules).not.toBe(true)
        expect(run.valveCalls).toHaveLength(1)
        expect(run.failures).toEqual([])
    })

    test('T4b after a held commit, a load that failed is told once by the pass that follows the answer', async () => {
        const hidden = { value: true }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = askingValve(gate)
        editCharacter(run, 'held commit')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(1)
        expect(run.peer.notSaved).toEqual([])
        gate.settle()
        await sleep(300)
        expect(run.failures).toEqual([])
        expect(run.peer.notSaved).toHaveLength(1)
        expect(run.peer.notSaved[0].moduleId).toBe(run.kit.context.previous.objects?.moduleIndex?.entries[0].id)
    })

    test('T5 a page that reports itself visible keeps the hold: one plan, no commit', async () => {
        const run = await startRun({ hidden: { value: false } })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        editCharacter(run, 'visible')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(0)
        expect(run.requests).toHaveLength(1)
        expect(run.valveCalls).toHaveLength(1)
        gate.settle()
    })

    test('T5b a pass admitted while hidden that turns visible before the valve answers keeps the quiet hold', async () => {
        const hidden = { value: true }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = () => {
            hidden.value = false
            return { kind: 'deferred', settled: gate.promise }
        }
        editCharacter(run, 'turned visible')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(0)
        expect(run.valveCalls).toHaveLength(1)
        const planned = run.requests.length
        run.mark()
        await sleep(300)
        expect(run.requests).toHaveLength(planned)
        gate.settle()
        await until(() => run.requests.length > planned, 'the pass after the answer')
    })

    test('T6 a question answered while the held commit is in flight: the held commit lands first with the stored module, then a module pass lands the answer', async () => {
        const hidden = { value: true }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = askingValve(gate)
        const first = gateOf()
        run.commitHold = first.promise
        editCharacter(run, 'edit before the answer')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(1)
        expect(run.landed).toBe(0)
        run.install()
        ;(run.db.modules as unknown as Plain[])[0].name = 'renamed by the answer'
        run.mark()
        gate.settle()
        const second = gateOf()
        run.commitHold = second.promise
        first.settle()
        await until(() => run.landed === 1, 'the held commit')
        const afterHeld = await run.kit.saved()
        expect((afterHeld.modules as unknown as Plain[])[0].name).toBe((run.kit.seedDb.modules as unknown as Plain[])[0].name)
        expect(nameIn(afterHeld, chaIdOf(run))).toBe('edit before the answer')
        second.settle()
        await until(() => run.landed === 2, 'the module pass')
        const final = await run.kit.saved()
        expect((final.modules as unknown as Plain[])[0].name).toBe('renamed by the answer')
        expect(nameIn(final, chaIdOf(run))).toBe('edit before the answer')
        expect(run.failures).toEqual([])
    })

    test('T7 a peer commit before the hide parks the page and asks, and nothing is written over it', async () => {
        const hidden = { value: false }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the visible deferred pass')
        await peerCommit(run.kit, (peerDb) => { peerDb.username = 'written by a peer' })
        hidden.value = true
        editCharacter(run, 'hidden edit')
        await sleep(300)
        expect(run.peer.asked).toHaveLength(1)
        expect(run.peer.asked[0].reason).toBe('peer-commit')
        expect(run.commits).toBe(0)
        expect((await run.kit.saved()).username).toBe('written by a peer')
        gate.settle()
    })

    test('T8 no busy loop: after a held commit the net makes no module-scope tick until the module interval, then exactly one', async () => {
        const hidden = { value: true }
        const run = await startRun({ hidden, sweep: true, idleNet: { intervalMs: 1, moduleIntervalMs: 600_000 } })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        editCharacter(run, 'held commit')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(1)
        const valveCalls = run.valveCalls.length
        const commits = run.commits
        run.clock.now += 1000
        await sleep(300)
        expect(run.valveCalls).toHaveLength(valveCalls)
        expect(run.commits).toBe(commits)
        run.clock.now += 600_000
        await sleep(300)
        expect(run.valveCalls).toHaveLength(valveCalls + 1)
        await sleep(300)
        expect(run.valveCalls).toHaveLength(valveCalls + 1)
        expect(run.failures).toEqual([])
        gate.settle()
    })

    test('T10 a hidden page whose acknowledged encoding holds no module set keeps the quiet wait', async () => {
        const run = await startRun({ hidden: { value: true } })
        run.kit.context.encoder!.carriesModules = () => false
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        editCharacter(run, 'cannot carry')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(0)
        expect(run.valveCalls).toHaveLength(1)
        expect(run.requests).toHaveLength(1)
        gate.settle()
    })

    test('T10b with no module set to carry, a hidden sweep does not open the net over the hold', async () => {
        const hidden = { value: true }
        const run = await startRun({ hidden, sweep: true, idleNet: { intervalMs: 1, moduleIntervalMs: 600_000 } })
        run.kit.context.encoder!.carriesModules = () => false
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the deferred pass')
        run.sweepOwed = true
        await sleep(300)
        expect(run.valveCalls).toHaveLength(1)
        expect(run.commits).toBe(0)
        gate.settle()
    })

    test('T12 a held pass does not reset the not-saved memory: the person is told once', async () => {
        const hidden = { value: false }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = (call) => call === 2 || call === 3 ? { kind: 'deferred', settled: gate.promise } : { kind: 'refused' }
        run.mark()
        await until(() => run.peer.notSaved.length === 1 && run.state.begun === run.state.ended, 'the degraded pass')
        run.mark()
        await until(() => run.valveCalls.length === 2, 'the visible deferred pass')
        await sleep(40)
        hidden.value = true
        editCharacter(run, 'held commit')
        run.mark()
        await sleep(300)
        hidden.value = false
        gate.settle()
        await until(() => run.valveCalls.length >= 4 && run.state.begun === run.state.ended, 'the pass after the answer')
        await sleep(100)
        expect(run.peer.notSaved).toHaveLength(1)
    })

    test('T13 a hide sweep while the question holds the loop saves an unmarked resident change with the modules carried', async () => {
        const hidden = { value: false }
        const run = await startRun({ hidden, sweep: true, idleNet: { intervalMs: 600_000, moduleIntervalMs: 600_000 } })
        const gate = gateOf()
        run.valve = () => ({ kind: 'deferred', settled: gate.promise })
        run.mark()
        await until(() => run.valveCalls.length === 1, 'the visible deferred pass')
        await sleep(40)
        hidden.value = true
        editCharacter(run, 'unmarked change', false)
        run.sweepOwed = true
        await sleep(300)
        expect(run.commits).toBe(1)
        expect(nameIn(await run.kit.saved(), chaIdOf(run))).toBe('unmarked change')
        expect(run.requests.at(-1)?.carryModules).toBe(true)
        expect(run.failures).toEqual([])
        expect(run.peer.notSaved).toEqual([])
        gate.settle()
    })

    test('T14 a held pass whose commit landed and whose notice then threw still asks for one pass when the answer comes', async () => {
        const hidden = { value: true }
        const run = await startRun({ hidden })
        const gate = gateOf()
        run.valve = askingValve(gate)
        run.savedThrows = 1
        editCharacter(run, 'held commit')
        run.mark()
        await sleep(300)
        expect(run.commits).toBe(1)
        expect(run.uncounted).toHaveLength(1)
        hidden.value = false
        gate.settle()
        await sleep(300)
        expect(run.peer.notSaved).toHaveLength(1)
    })
})

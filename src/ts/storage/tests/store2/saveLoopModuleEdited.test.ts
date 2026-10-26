// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

// MOCKED: the alert modules `peerUi` imports; the loop under test never shows an alert through them.
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

import { StubRefusedError } from '../../store2/codec'
import { moduleStubOf } from '../../store2/moduleStubMatch'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { runStore2SaveLoop, type IdleNetOptions, type Store2LoopPort } from '../../store2/saveLoop'
import type { SaveFailureClass } from '../../store2/saveFailure'
import { describeSaveFailure, saveFailureClassOf } from '../../store2/ui/peerUi'
import { createSaveScheduler, type SaveScheduler } from '../../saveScheduler'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { createPeerDouble, startStore2, type PeerDouble, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The save loop over a module stub that was edited in this tab. The loop is the real `runStore2SaveLoop` over a real
 * memory backend and committer; the port records what the loop reports, waits and sleeps, and applies the real
 * `describeSaveFailure` to every reported failure. An edited stub is made the way a page meets it: the stub of a
 * recorded entry whose name was then changed.
 *
 * Labels: R reproducer (fails on the code before the change at an assertion), G guard (passes before and after, and is
 * given teeth by a named mutant), M new behaviour (fails before the change because it needs the new behaviour: the peer
 * double's `moduleEdited` record, which the code before the change never fills, or the 5 s interruptible wait, which
 * the code before the change never makes).
 */

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

interface Report {
    attempts: number
    failureClass: SaveFailureClass
    toast: string | null
    alert: { msg: string, submsg: string } | null
    showRaw: boolean
}

/** How the wait after an edited failure behaves: ends at once, stays held until the test releases it, or is the real scheduler's. */
type EditedWait = 'fast' | 'held' | 'scheduler'

interface Run {
    kit: Store2Kit
    peer: PeerDouble
    db: Database
    tracker: toSaveType
    clock: { now: number }
    state: { due: boolean, dirty: boolean, saved: number, begun: number, ended: number }
    reports: Report[]
    uncounted: unknown[]
    sleeps: number[]
    waits: number[]
    requests: SavePassRequest[]
    valveCalls: string[]
    commits: number
    crashed: unknown[]
    /** While true the loop sees no due pass, so only the idle net can run. */
    holdDue: boolean
    /** Released by the test to end a held edited wait. */
    editedGate: Gate
    scheduler: SaveScheduler
    mark(): void
    /** Puts the full body back into a slot, as a finished load or an undo does. */
    install(index: number): void
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
    editedWait?: EditedWait
    idleNet?: IdleNetOptions | null
    /** Whether module 0 starts as an edited stub. */
    edited?: boolean
}

/** Replaces the module at `index` with the stub of its recorded entry under a changed name. */
function edit(run: Pick<Run, 'db' | 'kit'>, index: number, name = 'Edited module'): void {
    const entry = run.kit.context.previous.objects?.moduleIndex?.entries[index]
    if (entry === undefined) {
        throw new Error('The seeded tree holds no module index.')
    }
    const modules = run.db.modules as unknown as Plain[]
    modules[index] = { ...(moduleStubOf(entry) as unknown as Plain), name }
}

/** Turns module 0 into its recorded stub and adds a second module of the same id: the planner cannot carry that stub. */
function refuseUncarriable(run: Pick<Run, 'db' | 'kit'>): void {
    const entry = run.kit.context.previous.objects?.moduleIndex?.entries[0]
    if (entry === undefined) {
        throw new Error('The seeded tree holds no module index.')
    }
    const modules = run.db.modules as unknown as Plain[]
    modules.push({ ...clone(modules[0]), name: 'second module of the same id' })
    modules[0] = moduleStubOf(entry) as unknown as Plain
}

async function startRun(options: StartOptions = {}): Promise<Run> {
    const editedWait = options.editedWait ?? 'fast'
    const peer = createPeerDouble('reload')
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
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const idle = () => new Promise<void>((resolve) => {
        // Each idle turn advances the loop's clock, so the idle net's interval elapses.
        run.clock.now += 100
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const run: Run = {
        kit, peer, db,
        tracker: { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false },
        clock: { now: 1_800_000_000_000 },
        state: { due: false, dirty: false, saved: 0, begun: 0, ended: 0 },
        reports: [], uncounted: [], sleeps: [], waits: [], requests, valveCalls,
        commits: 0, crashed: [], holdDue: false,
        editedGate: gateOf(),
        // The scheduler's own sleep never ends, so only `requestNow` can end a wait that goes through it.
        scheduler: createSaveScheduler({
            debounceMs: 1000,
            sleep: () => new Promise<void>(() => {}),
            hooks: { onMark: () => {}, onDue: () => {}, onRequestNow: () => run.mark() },
        }),
        mark() {
            run.tracker.modules = true
            run.state.dirty = true
            run.state.due = true
        },
        install(index) {
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
        return { kind: 'loaded' }
    }
    const wrapped = kit.context.session.committer
    if (wrapped !== null) {
        kit.context.session = {
            ...kit.context.session,
            committer: {
                ...wrapped,
                async commit(read, request) {
                    run.commits += 1
                    return wrapped.commit(read, request)
                },
            },
        }
    }
    const port: Store2LoopPort = {
        tracker: run.tracker,
        reloadFlag: { state: false },
        getDatabase: () => run.db,
        mergeBack(live, snapshot) {
            live.modules ||= snapshot.modules
        },
        liveCheck: () => {},
        sweep: () => {},
        isDue: () => run.state.due && !run.holdDue,
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
        peerHeard: () => false,
        setStopped: () => {},
        reportFailure(error, attempts) {
            const report = describeSaveFailure(error, attempts, false)
            run.reports.push({
                attempts,
                failureClass: saveFailureClassOf(error, false),
                toast: report.toast,
                alert: report.alert,
                showRaw: report.showRaw,
            })
            return report.waitMs
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
        wait(ms) {
            run.waits.push(ms)
            if (ms === 5000) {
                if (editedWait === 'held') {
                    return run.editedGate.promise
                }
                if (editedWait === 'scheduler') {
                    return run.scheduler.wait(ms)
                }
            }
            return idle()
        },
        async sleep(ms) {
            run.sleeps.push(ms)
            await idle()
        },
        sleepForever: () => new Promise<never>(() => {}),
        now: () => run.clock.now,
    }
    if (options.edited !== false) {
        edit(run, 0)
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        run.crashed.push(error)
    })
    runs.push(run)
    return run
}

describe('an edited module stub is announced once, with no toast and no raw error', () => {
    test('M edited-prompt-asked-once-over-many-passes: the peer is told once, naming the module, however many passes fail', async () => {
        const run = await startRun()
        run.mark()
        await until(() => run.reports.length >= 5, 'five failed passes')
        expect(run.peer.edited).toHaveLength(1)
        expect(run.peer.edited[0].moduleName).toBe('Edited module')
        expect(run.peer.edited[0].moduleId).toBe(run.kit.context.previous.objects?.moduleIndex?.entries[0].id)
        expect(run.commits).toBe(0)
        expect(run.crashed).toEqual([])
    })

    test('R edited-failure-has-no-toast-and-no-raw-alert: every counted pass is the module-edited class with nothing shown', async () => {
        const run = await startRun()
        run.mark()
        await until(() => run.reports.length >= 6, 'six failed passes')
        const seen = run.reports.slice(0, 6)
        expect(seen.map((report) => report.attempts)).toEqual([1, 2, 3, 4, 5, 6])
        expect(seen.map((report) => report.failureClass)).toEqual(Array<SaveFailureClass>(6).fill('module-edited'))
        expect(seen.map((report) => report.toast)).toEqual(Array<null>(6).fill(null))
        expect(seen.map((report) => report.alert)).toEqual(Array<null>(6).fill(null))
        expect(seen.map((report) => report.showRaw)).toEqual(Array<boolean>(6).fill(false))
    })

    test('R edited-retry-wait-is-5s: the retry waits five seconds through the interruptible wait', async () => {
        const run = await startRun()
        run.mark()
        await until(() => run.reports.length >= 2, 'two failed passes')
        expect(run.waits).toContain(5000)
        expect(run.sleeps).not.toContain(1000)
    })

    test('M hide-flush-ends-edited-wait: the wait is the port wait, not the sleep, and a held wait keeps the retry back until it ends', async () => {
        const run = await startRun({ editedWait: 'held' })
        run.mark()
        await until(() => run.reports.length >= 1, 'the first failed pass')
        await until(() => run.waits.includes(5000), 'the edited wait')
        expect(run.sleeps).not.toContain(5000)
        const planned = run.requests.length
        await sleep(60)
        expect(run.requests).toHaveLength(planned)
        run.editedGate.settle()
        await until(() => run.reports.length >= 2, 'the retry after the wait ended')
    })

    test('M hide-flush-ends-edited-wait: with the real scheduler, requestNow ends the wait and the retry runs at once', async () => {
        const run = await startRun({ editedWait: 'scheduler' })
        run.mark()
        await until(() => run.reports.length >= 1, 'the first failed pass')
        await until(() => run.waits.includes(5000), 'the edited wait')
        const planned = run.requests.length
        await sleep(60)
        expect(run.requests).toHaveLength(planned)
        run.scheduler.requestNow()
        await until(() => run.reports.length >= 2, 'the retry after the flush')
    })
})

describe('the marks of an edited pass are kept', () => {
    test('M edited-marks-are-folded-back-nothing-dropped: while the wait holds, the module mark and the dirty flag are back', async () => {
        const run = await startRun({ editedWait: 'held' })
        run.mark()
        await until(() => run.waits.includes(5000), 'the edited wait')
        expect(run.tracker.modules).toBe(true)
        expect(run.state.dirty).toBe(true)
        expect(run.commits).toBe(0)
    })
})

describe('the announcement follows the stub, not the pass count', () => {
    test('G deleting-the-edited-stub-resumes-saves: with the stub gone the next pass saves', async () => {
        const run = await startRun()
        run.mark()
        await until(() => run.reports.length >= 2, 'two failed passes')
        ;(run.db.modules as unknown as Plain[]).splice(0, 1)
        run.mark()
        await until(() => run.commits >= 1, 'the commit of the pass that saves')
        await until(() => run.state.saved >= 1, 'the saved report')
    })

    test('M re-announces-after-delete-then-new-edit-on-another-id: a saved pass clears the announcement, so a new edit asks again', async () => {
        const run = await startRun()
        run.mark()
        await until(() => run.peer.edited.length === 1, 'the first announcement')
        run.install(0)
        run.mark()
        await until(() => run.state.saved >= 1, 'the pass that saves')
        const reportsBefore = run.reports.length
        edit(run, 1, 'Second edited module')
        run.mark()
        await until(() => run.peer.edited.length === 2, 'the second announcement')
        expect(run.peer.edited[1].moduleName).toBe('Second edited module')
        expect(run.peer.edited[1].moduleId).not.toBe(run.peer.edited[0].moduleId)
        expect(run.reports.length).toBeGreaterThan(reportsBefore)
    })

    test('M re-announces-after-delete-then-new-edit-on-another-id: the same module edited again after a save asks again', async () => {
        const run = await startRun()
        run.mark()
        await until(() => run.peer.edited.length === 1, 'the first announcement')
        run.install(0)
        run.mark()
        await until(() => run.state.saved >= 1, 'the pass that saves')
        edit(run, 0, 'Edited again')
        run.mark()
        await until(() => run.peer.edited.length === 2, 'the second announcement')
        expect(run.peer.edited[1].moduleId).toBe(run.peer.edited[0].moduleId)
    })

    test('M tick-pass-does-not-reset-announcement: idle-net passes that save while the stub stands do not ask again', async () => {
        const run = await startRun({ idleNet: { intervalMs: 5, moduleIntervalMs: 3_600_000_000_000, backstopMs: 0 } })
        run.mark()
        await until(() => run.peer.edited.length === 1, 'the announcement')
        run.holdDue = true
        // A character changed without a mark is what the net exists to find: its pass is a tick that saves.
        ;(run.db.characters as unknown as Plain[])[0].name = 'changed without a mark'
        const beforeNet = run.requests.length
        await until(() => run.requests.slice(beforeNet).some((request) => request.net !== undefined && !request.modules), 'an idle-net pass without module scope')
        await until(() => run.commits >= 1, 'the commit of the idle-net pass')
        run.holdDue = false
        const failed = run.reports.length
        await until(() => run.reports.length >= failed + 2, 'two more failed passes')
        expect(run.peer.edited).toHaveLength(1)
    })
})

describe('the prompt is never awaited by the loop', () => {
    test('M edited-prompt-never-awaited-under-lock: a prompt that never answers leaves the lock free and the retries going', async () => {
        const run = await startRun()
        const unanswered = gateOf()
        // The handler returns a promise that never settles; the loop must not wait for it.
        run.peer.moduleEdited = (info, stillBlocked) => {
            run.peer.edited.push(info)
            run.peer.editedStillBlocked.push(stillBlocked)
            return unanswered.promise
        }
        run.mark()
        await until(() => run.reports.length >= 3, 'three failed passes with the prompt unanswered')
        expect(await run.lockFree()).toBe(true)
        expect(run.peer.edited).toHaveLength(1)
    })

    test('M the probe handed to the peer is true while the stub stands and false once a pass has saved', async () => {
        const run = await startRun()
        run.mark()
        await until(() => run.peer.edited.length === 1, 'the announcement')
        expect(run.peer.editedStillBlocked[0]()).toBe(true)
        run.install(0)
        run.mark()
        await until(() => run.state.saved >= 1, 'the pass that saves')
        expect(run.peer.editedStillBlocked[0]()).toBe(false)
    })
})

describe('other failures keep their path', () => {
    test('G uncarriable-and-other-failures-unchanged: an uncarriable stub is not announced and keeps the retrying toast and the one-second sleep', async () => {
        const run = await startRun({ edited: false })
        refuseUncarriable(run)
        run.mark()
        await until(() => run.reports.length >= 2, 'two failed passes')
        expect(run.reports[0].failureClass).toBe('other')
        expect(run.reports[0].toast).not.toBeNull()
        expect(run.peer.edited).toEqual([])
        expect(run.waits).not.toContain(5000)
        expect(run.sleeps).toContain(1000)
    })
})

describe('the fixture', () => {
    test('G the edited stub is refused as edited by the planner, so the rows above see the refusal they cause', async () => {
        const run = await startRun({ edited: false })
        edit(run, 0)
        const error = await run.kit.context.encoder?.plan(run.db, { marked: new Set(), modules: true, whole: false }).then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(StubRefusedError)
        expect((error as StubRefusedError).reason).toBe('edited')
    })
})

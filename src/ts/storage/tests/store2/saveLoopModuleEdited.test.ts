// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

// MOCKED: the alert modules `peerUi` imports; the loop under test never shows an alert through them.
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

import { StubRefusedError, type PreviousEncoding } from '../../store2/codec'
import { moduleStubOf } from '../../store2/moduleStubMatch'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { runStore2SaveLoop, type IdleNetOptions, type Store2LoopPort } from '../../store2/saveLoop'
import type { SaveFailureClass } from '../../store2/saveFailure'
import { describeSaveFailure, saveFailureClassOf } from '../../store2/ui/peerUi'
import { createSaveScheduler, type SaveScheduler } from '../../saveScheduler'
import type { Database, character } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { buildColdStub } from '../../../process/coldCharacter'
import { until } from '../saveLoopWorld'
import { createPeerDouble, startStore2, type PeerDouble, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The save loop over a module stub that blocks module saves. The loop is the real `runStore2SaveLoop` over a real
 * memory backend and committer; the port records what the loop reports, waits and sleeps, and applies the real
 * `describeSaveFailure` to every reported failure. An edited stub is made the way a page meets it: the stub of a
 * recorded entry whose name was then changed. An uncarriable stub is the stub of a recorded entry beside a second
 * module of the same id.
 *
 * Invariant under test: a module the pass cannot encode never blocks characters and chats. The pass carries the modules
 * whole, keeps the module mark and the dirty flag, tells the person once, and makes no pass due and no wait of its own.
 *
 * Labels: R reproducer (fails on the code before the change at an assertion), G guard (passes before and after, and is
 * given teeth by a named mutant), M new behaviour (fails before the change because it needs the new behaviour). Rows that
 * pass before the change are labelled G even when they pin new code. T rows pass or fail before the change depending
 * on timing, so they are neither reproducers nor guards; they pass on every run of the current code.
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
    markUnsavedCalls: number
    crashed: unknown[]
    /** While true the loop sees no due pass, so only the idle net can run. */
    holdDue: boolean
    /** While set, the loop's sleeps wait for it, so a test reads the state a pass left before the next pass starts. */
    sleepGate: Gate | null
    /** The next commit that lands reports that it was not confirmed durable. */
    unflushedOnce: boolean
    /** The next broadcast throws, as a failed hand-off after a landed commit does. */
    broadcastThrowsOnce: boolean
    /** The scheduler the loop's own waits go through when `schedulerWaits` is set. */
    loopScheduler: SaveScheduler
    /** While true the scheduler's sleep does not end within a test's window, so only a wake or a latch can end a wait. */
    stallScheduler: boolean
    mark(): void
    /** Puts the full body back into a slot, as a finished load or an undo does. */
    install(index: number): void
    lockFree(): Promise<boolean>
    stop(): void
}

const runs: Run[] = []

afterEach(() => {
    for (const run of runs.splice(0)) {
        run.sleepGate?.settle()
        run.stop()
    }
})

interface StartOptions {
    idleNet?: IdleNetOptions | null
    /** Whether module 0 starts as an edited stub. */
    edited?: boolean
    /** Every wait of the loop goes through a real scheduler whose sleep ends, so `requestNow` can wake or latch it. */
    schedulerWaits?: boolean
    /** The acknowledged encoding holds the module index body but not its unit: the modules cannot be carried. */
    withoutIndexUnit?: boolean
    /** The page has no module valve. */
    noValve?: boolean
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

/** Renames the first character and marks it, without making a pass due. */
function changeCharacter(run: Run, name: string): void {
    const character = (run.db.characters as unknown as Plain[])[0]
    character.name = name
    run.tracker.character.push(character.chaId as string)
    run.state.dirty = true
}

/** One marked pass, from the mark to the end of the pass. */
async function markPass(run: Run, what = 'a marked pass'): Promise<void> {
    const before = run.state.ended
    run.mark()
    await until(() => run.state.ended > before, what)
}

async function storedCharacterName(run: Run): Promise<unknown> {
    return ((await run.kit.saved()).characters[0] as unknown as Plain).name
}

async function storedModuleNames(run: Run): Promise<unknown[]> {
    return ((await run.kit.saved()).modules as unknown as Plain[]).map((module) => module.name)
}

function seedModuleNames(run: Run): unknown[] {
    return (run.kit.seedDb.modules as unknown as Plain[]).map((module) => module.name)
}

async function startRun(options: StartOptions = {}): Promise<Run> {
    const peer = createPeerDouble('reload')
    const kit = await startStore2({ db: buildSmall(2), peer, idleNet: options.idleNet ?? null })
    const db = clone(kit.seedDb)
    let previous: PreviousEncoding = kit.context.previous
    if (options.withoutIndexUnit === true) {
        const units = new Map(previous.units)
        units.delete('moduleIndex')
        previous = { ...previous, units }
    }
    const inner = createSaveEncoder({ previous, lists: kit.context.lists, env: kit.context.env })
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
        commits: 0, markUnsavedCalls: 0, crashed: [], holdDue: false, sleepGate: null, unflushedOnce: false, broadcastThrowsOnce: false,
        loopScheduler: createSaveScheduler({
            debounceMs: 1000,
            sleep: () => run.stallScheduler ? new Promise<void>((resolve) => { setTimeout(resolve, 10_000) }) : idle(),
            hooks: { onMark: () => {}, onDue: () => {}, onRequestNow: () => run.mark() },
        }),
        stallScheduler: false,
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
    if (options.noValve !== true) {
        kit.context.loadModuleStub = async (moduleId) => {
            valveCalls.push(moduleId)
            return { kind: 'loaded' }
        }
    }
    const wrapped = kit.context.session.committer
    if (wrapped !== null) {
        kit.context.session = {
            ...kit.context.session,
            committer: {
                ...wrapped,
                async commit(read, request) {
                    run.commits += 1
                    const result = await wrapped.commit(read, request)
                    if (run.unflushedOnce && result.status === 'committed') {
                        run.unflushedOnce = false
                        return { ...result, flushed: false }
                    }
                    return result
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
            for (const chaId of snapshot.character) {
                if (!live.character.includes(chaId)) {
                    live.character.push(chaId)
                }
            }
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
        markUnsaved() {
            run.markUnsavedCalls += 1
            run.state.dirty = true
        },
        unsavable: () => {},
        saved() {
            run.state.saved += 1
        },
        broadcast() {
            if (run.broadcastThrowsOnce) {
                run.broadcastThrowsOnce = false
                throw new Error('The hand-off to the other tabs failed.')
            }
        },
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
            return options.schedulerWaits === true ? run.loopScheduler.wait(ms) : idle()
        },
        async sleep(ms) {
            run.sleeps.push(ms)
            if (run.sleepGate !== null) {
                await run.sleepGate.promise
            }
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

describe('a refused module stub no longer blocks characters and chats', () => {
    test('R uncarriable-stub-lets-the-character-save: the character edit lands, the modules are carried, the module mark and dirty flag are held, one notice', async () => {
        const run = await startRun({ edited: false })
        refuseUncarriable(run)
        changeCharacter(run, 'saved beside the stuck module')
        await markPass(run)
        expect(run.commits).toBeGreaterThan(0)
        expect(await storedCharacterName(run)).toBe('saved beside the stuck module')
        expect(await storedModuleNames(run)).toEqual(seedModuleNames(run))
        expect(run.tracker.modules).toBe(true)
        expect(run.state.dirty).toBe(true)
        expect(run.state.due).toBe(false)
        expect(run.reports).toEqual([])
        expect(run.peer.notSaved).toHaveLength(1)
        expect(run.peer.notSaved[0].moduleId).toBe(run.kit.context.previous.objects?.moduleIndex?.entries[0].id)
        expect(run.peer.edited).toEqual([])
        expect(run.crashed).toEqual([])
    })

    test('R edited-stub-lets-the-character-save: the same for an edited stub, announced through the edited prompt', async () => {
        const run = await startRun()
        changeCharacter(run, 'saved beside the edited module')
        await markPass(run)
        expect(run.commits).toBeGreaterThan(0)
        expect(await storedCharacterName(run)).toBe('saved beside the edited module')
        expect(await storedModuleNames(run)).toEqual(seedModuleNames(run))
        expect(run.tracker.modules).toBe(true)
        expect(run.state.dirty).toBe(true)
        expect(run.state.due).toBe(false)
        expect(run.peer.edited).toHaveLength(1)
        expect(run.peer.edited[0].moduleName).toBe('Edited module')
        expect(run.peer.edited[0].moduleId).toBe(run.kit.context.previous.objects?.moduleIndex?.entries[0].id)
        expect(run.peer.notSaved).toEqual([])
    })

    test('R uncarriable-notice-once-over-many-passes: however many passes meet the same stub, the person is told once', async () => {
        const run = await startRun({ edited: false })
        refuseUncarriable(run)
        for (let index = 0; index < 4; index += 1) {
            changeCharacter(run, `pass ${index}`)
            await markPass(run)
        }
        expect(run.commits).toBeGreaterThan(0)
        expect(run.peer.notSaved).toHaveLength(1)
        expect(run.reports).toEqual([])
    })

    test('M edited-prompt-asked-once-over-many-passes: the peer is told once, naming the module, however many passes meet the stub', async () => {
        const run = await startRun()
        for (let index = 0; index < 5; index += 1) {
            await markPass(run)
        }
        expect(run.peer.edited).toHaveLength(1)
        expect(run.peer.edited[0].moduleName).toBe('Edited module')
        expect(run.peer.edited[0].moduleId).toBe(run.kit.context.previous.objects?.moduleIndex?.entries[0].id)
        expect(run.reports).toEqual([])
        expect(run.crashed).toEqual([])
    })

    test('R edited-refusal-is-no-failure: no pass is counted as failed, so no toast, no alert and no raw error is shown', async () => {
        const run = await startRun()
        for (let index = 0; index < 6; index += 1) {
            await markPass(run)
        }
        expect(run.reports).toEqual([])
        expect(run.uncounted).toEqual([])
    })

    test('G valve-first: an uncarriable stub is offered to the valve once per pass before it is carried, an edited one never', async () => {
        const uncarriable = await startRun({ edited: false })
        refuseUncarriable(uncarriable)
        for (let index = 0; index < 3; index += 1) {
            await markPass(uncarriable)
        }
        expect(uncarriable.valveCalls).toHaveLength(3)

        const edited = await startRun()
        for (let index = 0; index < 3; index += 1) {
            await markPass(edited)
        }
        expect(edited.valveCalls).toEqual([])
    })

    test('R no-valve-degrades-at-once: a page without a module valve carries an uncarriable stub instead of failing for good', async () => {
        const run = await startRun({ edited: false, noValve: true })
        refuseUncarriable(run)
        changeCharacter(run, 'saved without a valve')
        await markPass(run)
        expect(run.commits).toBeGreaterThan(0)
        expect(await storedCharacterName(run)).toBe('saved without a valve')
        expect(run.peer.notSaved).toHaveLength(1)
        expect(run.valveCalls).toEqual([])
        expect(run.reports).toEqual([])
    })
})

describe('module changes are held while one module is stuck', () => {
    test('R held-module-change-waits-for-the-fix: another module\'s change is not stored while the stub stands, and is stored once it is gone', async () => {
        const run = await startRun()
        changeCharacter(run, 'saved while a module is stuck')
        ;(run.db.modules as unknown as Plain[])[1].name = 'Changed second module'
        await markPass(run)
        expect(run.commits).toBeGreaterThan(0)
        expect(await storedCharacterName(run)).toBe('saved while a module is stuck')
        expect(await storedModuleNames(run)).toEqual(seedModuleNames(run))
        expect(run.tracker.modules).toBe(true)
        expect(run.state.dirty).toBe(true)
        expect(run.peer.edited).toHaveLength(1)

        run.install(0)
        const commitsBefore = run.commits
        await markPass(run)
        expect(run.commits).toBeGreaterThan(commitsBefore)
        expect((await storedModuleNames(run))[1]).toBe('Changed second module')
        expect(run.tracker.modules).toBe(false)
        expect(run.peer.editedStillBlocked[0]()).toBe(false)
    })
})

describe('the pace after a refusal', () => {
    test('R no-wait-and-no-retry-after-a-refusal: no five-second wait, no one-second sleep, no further pass without a mark', async () => {
        const run = await startRun()
        await markPass(run)
        expect(run.waits).not.toContain(5000)
        expect(run.sleeps).toEqual([])
        const planned = run.requests.length
        await sleep(60)
        expect(run.requests).toHaveLength(planned)
        expect(run.state.due).toBe(false)
    })

    test('R hide-flush-wakes-the-wait-while-stuck: a request-now during the loop wait after a degraded pass flushes the character at once', async () => {
        const run = await startRun({ schedulerWaits: true })
        await markPass(run)
        expect(run.peer.edited).toHaveLength(1)
        run.stallScheduler = true
        await sleep(100)
        changeCharacter(run, 'flushed through a stalled wait')
        const commitsBefore = run.commits
        run.loopScheduler.requestNow()
        await until(() => run.commits > commitsBefore, 'the flush commit', 1000)
        expect(await storedCharacterName(run)).toBe('flushed through a stalled wait')
        expect(run.waits).not.toContain(5000)
        expect(run.sleeps).toEqual([])
    })

    test('R hide-flush-is-latched-during-a-degraded-pass: a request-now between plan and commit of a degraded pass is served by the next pass at once', async () => {
        const run = await startRun({ schedulerWaits: true })
        await markPass(run)
        run.stallScheduler = true
        await sleep(100)
        const hold = gateOf()
        const encoder = run.kit.context.encoder
        if (encoder === undefined) {
            throw new Error('The run holds no encoder.')
        }
        const plan = encoder.plan.bind(encoder)
        let held = false
        encoder.plan = async (planDb, request) => {
            const planned = await plan(planDb, request)
            if (!held) {
                held = true
                await hold.promise
            }
            return planned
        }
        changeCharacter(run, 'first')
        run.loopScheduler.requestNow()
        await until(() => held, 'the pass to finish planning', 1000)
        changeCharacter(run, 'latched flush')
        run.loopScheduler.requestNow()
        const commitsBefore = run.commits
        hold.settle()
        await until(() => run.commits > commitsBefore, 'the first commit', 1000)
        await until(() => run.commits >= commitsBefore + 2, 'the latched flush commit', 1000)
        expect(await storedCharacterName(run)).toBe('latched flush')
        expect(run.waits).not.toContain(5000)
        expect(run.sleeps).toEqual([])
    })

    test('R idle-tick-keeps-the-net-running-and-the-page-dirty: a refusal found by a tick is no failure, holds the module mark, and the net still saves a character', async () => {
        const run = await startRun({ idleNet: { intervalMs: 5, moduleIntervalMs: 1000, backstopMs: 0 } })
        await until(() => run.requests.some((request) => request.net?.modules === true), 'a tick that takes module scope')
        await until(() => run.reports.length >= 1 || run.markUnsavedCalls >= 1, 'the tick pass to end')
        expect(run.reports).toEqual([])
        expect(run.markUnsavedCalls).toBeGreaterThanOrEqual(1)
        expect(run.tracker.modules).toBe(true)
        expect(run.state.dirty).toBe(true)
        expect(run.peer.edited).toHaveLength(1)
        // A character changed without a mark is what the net exists to find.
        ;(run.db.characters as unknown as Plain[])[0].name = 'found by the net'
        await until(() => run.commits >= 1, 'the commit of the net pass')
        expect(await storedCharacterName(run)).toBe('found by the net')
        expect(run.peer.edited).toHaveLength(1)
    })
})

describe('the module mark survives every outcome after the refusal', () => {
    test('R not-flushed-keeps-the-mark: a commit that cannot confirm durability leaves the mark, the dirty flag and one notice; the forced retry lands', async () => {
        const run = await startRun({ edited: false })
        refuseUncarriable(run)
        changeCharacter(run, 'saved but not confirmed')
        run.unflushedOnce = true
        run.sleepGate = gateOf()
        run.mark()
        await until(() => run.sleeps.length >= 1, 'the first pass to reach its sleep')
        expect(run.commits).toBeGreaterThan(0)
        expect(run.tracker.modules).toBe(true)
        expect(run.state.dirty).toBe(true)
        expect(run.peer.notSaved).toHaveLength(1)
        run.sleepGate.settle()
        run.sleepGate = null
        await until(() => run.commits >= 2, 'the forced retry')
        await until(() => run.state.ended >= 2, 'the retry pass to end')
        expect(run.tracker.modules).toBe(true)
        expect(run.state.dirty).toBe(true)
        expect(run.peer.notSaved).toHaveLength(1)
    })

    test('R throw-after-commit-keeps-the-mark: a failed hand-off after the commit landed leaves the mark, the dirty flag and one notice', async () => {
        const run = await startRun({ edited: false })
        refuseUncarriable(run)
        changeCharacter(run, 'saved before the hand-off failed')
        run.broadcastThrowsOnce = true
        await markPass(run)
        expect(run.commits).toBeGreaterThan(0)
        expect(run.uncounted).toHaveLength(1)
        expect(run.tracker.modules).toBe(true)
        expect(run.state.dirty).toBe(true)
        expect(run.peer.notSaved).toHaveLength(1)
    })
})

describe('the announcement follows the stub, not the pass count', () => {
    test('T deleting-the-edited-stub-resumes-saves: with the stub gone the next pass saves the modules', async () => {
        const run = await startRun()
        await markPass(run)
        await markPass(run)
        ;(run.db.modules as unknown as Plain[]).splice(0, 1)
        await markPass(run)
        expect(run.commits).toBeGreaterThanOrEqual(1)
        expect(await storedModuleNames(run)).toHaveLength(seedModuleNames(run).length - 1)
        expect(run.tracker.modules).toBe(false)
    })

    test('M re-announces-after-delete-then-new-edit-on-another-id: a clean module pass clears the announcement, so a new edit asks again', async () => {
        const run = await startRun()
        await markPass(run)
        expect(run.peer.edited).toHaveLength(1)
        run.install(0)
        await markPass(run)
        expect(run.peer.editedStillBlocked[0]()).toBe(false)
        edit(run, 1, 'Second edited module')
        await markPass(run)
        expect(run.peer.edited).toHaveLength(2)
        expect(run.peer.edited[1].moduleName).toBe('Second edited module')
        expect(run.peer.edited[1].moduleId).not.toBe(run.peer.edited[0].moduleId)
        expect(run.reports).toEqual([])
    })

    test('T re-announces-the-same-module-edited-again: the same module edited again after a clean pass asks again', async () => {
        const run = await startRun()
        await markPass(run)
        expect(run.peer.edited).toHaveLength(1)
        run.install(0)
        await markPass(run)
        expect(run.peer.editedStillBlocked[0]()).toBe(false)
        edit(run, 0, 'Edited again')
        await markPass(run)
        expect(run.peer.edited).toHaveLength(2)
        expect(run.peer.edited[1].moduleId).toBe(run.peer.edited[0].moduleId)
    })

    test('M clean-pass-clears-the-uncarriable-notice: once the modules are whole again a new stuck stub is told again', async () => {
        const run = await startRun({ edited: false })
        refuseUncarriable(run)
        await markPass(run)
        expect(run.peer.notSaved).toHaveLength(1)
        run.db.modules = clone(run.kit.seedDb.modules)
        await markPass(run)
        refuseUncarriable(run)
        await markPass(run)
        expect(run.peer.notSaved).toHaveLength(2)
    })

    test('M tick-pass-that-saves-the-modules-clears-the-announcement: an idle-net pass with module scope, once the stub is gone, lets a new edit ask again', async () => {
        const run = await startRun({ idleNet: { intervalMs: 5, moduleIntervalMs: 5, backstopMs: 0 } })
        await until(() => run.peer.edited.length === 1, 'the first announcement')
        run.holdDue = true
        run.install(0)
        const beforeNet = run.requests.length
        await until(() => run.requests.slice(beforeNet).some((request) => request.net?.modules === true), 'a clean idle-net pass with module scope')
        await until(() => !run.peer.editedStillBlocked[0](), 'the clean tick to clear the stub')
        run.holdDue = false
        edit(run, 0, 'Edited after the tick')
        await markPass(run)
        await until(() => run.peer.edited.length === 2, 'the second announcement')
        expect(run.peer.edited[1].moduleName).toBe('Edited after the tick')
    })

    test('G tick-pass-does-not-reset-announcement: idle-net passes that save without module scope do not ask again', async () => {
        const run = await startRun({ idleNet: { intervalMs: 5, moduleIntervalMs: 3_600_000_000_000, backstopMs: 0 } })
        await markPass(run)
        expect(run.peer.edited).toHaveLength(1)
        run.holdDue = true
        // A character changed without a mark is what the net exists to find: its pass is a tick that saves.
        ;(run.db.characters as unknown as Plain[])[0].name = 'changed without a mark'
        const beforeNet = run.requests.length
        await until(() => run.requests.slice(beforeNet).some((request) => request.net !== undefined && !request.modules), 'an idle-net pass without module scope')
        await until(() => run.commits >= 1, 'the commit of the idle-net pass')
        run.holdDue = false
        await markPass(run)
        await markPass(run)
        expect(run.peer.edited).toHaveLength(1)
    })
})

describe('the prompt is never awaited by the loop', () => {
    test('G edited-prompt-never-awaited-under-lock: a prompt that never answers leaves the lock free and the passes going', async () => {
        const run = await startRun()
        const unanswered = gateOf()
        // The handler returns a promise that never settles; the loop must not wait for it.
        run.peer.moduleEdited = (info, stillBlocked) => {
            run.peer.edited.push(info)
            run.peer.editedStillBlocked.push(stillBlocked)
            return unanswered.promise
        }
        for (let index = 0; index < 3; index += 1) {
            await markPass(run)
        }
        expect(await run.lockFree()).toBe(true)
        expect(run.peer.edited).toHaveLength(1)
    })

    test('G the probe handed to the peer is true while the stub stands and false once a clean module pass has saved', async () => {
        const run = await startRun()
        await markPass(run)
        expect(run.peer.editedStillBlocked[0]()).toBe(true)
        await markPass(run)
        expect(run.peer.editedStillBlocked[0]()).toBe(true)
        run.install(0)
        await markPass(run)
        expect(run.peer.editedStillBlocked[0]()).toBe(false)
    })
})

describe('failures that are not a module refusal keep their path', () => {
    test('G unloadable-character-stub-fails-as-before: the loader is asked once per pass and the modules are not carried to get past it', async () => {
        const run = await startRun({ edited: false })
        const characters = run.db.characters as unknown as Plain[]
        const resident = clone(characters[1])
        characters[1] = buildColdStub(resident as unknown as character, 'a-key-the-entry-does-not-name', ['chat-a']) as unknown as Plain
        let asked = 0
        run.kit.context.loadStub = async () => {
            asked += 1
            return false
        }
        changeCharacter(run, 'blocked by a character stub')
        run.sleepGate = gateOf()
        run.mark()
        await until(() => run.reports.length >= 1, 'the failed pass')
        expect(run.reports[0].failureClass).toBe('other')
        expect(asked).toBe(1)
        expect(run.requests).toHaveLength(1)
        expect(run.requests.every((request) => request.carryModules !== true)).toBe(true)
        expect(run.commits).toBe(0)
    })

    test('G inconsistent-encoding-keeps-the-edited-failure: an encoding that cannot carry the modules fails with the edited refusal itself, never with a codec input error', async () => {
        const run = await startRun({ withoutIndexUnit: true })
        run.mark()
        await until(() => run.reports.length >= 2, 'two failed passes')
        expect(run.reports.map((report) => report.failureClass)).toEqual(Array<SaveFailureClass>(run.reports.length).fill('module-edited'))
        expect(run.peer.edited).toHaveLength(1)
        expect(run.waits).toContain(5000)
        expect(run.commits).toBe(0)
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

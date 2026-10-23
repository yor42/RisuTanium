// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import type { Committer, CommitResult } from '../../store2/commit'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { IDLE_NET_MODULE_INTERVAL_MS, runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { peerCommit, startStore2, type Store2Kit } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The idle net's module cadence (MC-372 1): a tick takes module scope at most once per `moduleIntervalMs` (30 s by
 * default), whatever the number of resident characters. The loop runs over a real memory backend and committer with a
 * hand-built port whose clock the test sets, so a 30 s interval is crossed without waiting. The effective module scope
 * of a pass is read from the request the encoder is given: `modules` or `net.modules`, which the encoder ORs.
 * Labels: reproducer (fails against the base), guard (passes before and after).
 */

type Entry = Record<string, unknown>

interface Run {
    kit: Store2Kit
    db: Database
    tracker: toSaveType
    clock: { now: number }
    start: number
    /** Every request that reached the encoder, in order. */
    requests: SavePassRequest[]
    state: { due: boolean, dirty: boolean, saved: number }
    failures: unknown[]
    crashed: unknown[]
    /** Moves the clock to `offset` ms after the loop's start and waits for the tick that follows to reach the encoder. */
    tickAt(offset: number): Promise<SavePassRequest>
    stop(): void
}

const runs: Run[] = []

afterEach(() => {
    for (const run of runs) {
        run.stop()
    }
    runs.length = 0
})

function clone(db: Database): Database {
    return JSON.parse(JSON.stringify(db)) as Database
}

function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
}

function modulesOf(db: Database): Entry[] {
    return db.modules as unknown as Entry[]
}

function pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** What the encoder scopes: the module flag, the net's module flag, or a full pass. */
function effectiveModules(request: SavePassRequest): boolean {
    return request.whole || request.rewriteAll === true || request.modules || request.net?.modules === true
}

/** Starts the loop; `edit` may replace the kit's committer before the loop reads it. */
async function startRun(db: Database, idleNet: { intervalMs: number, moduleIntervalMs?: number } | null, edit: (kit: Store2Kit) => void = () => {}): Promise<Run> {
    const kit = await startStore2({ db, idleNet })
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const requests: SavePassRequest[] = []
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    kit.context.encoder = encoder
    edit(kit)
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const clock = { now: 1_800_000_000_000 }
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const run: Run = {
        kit, db, tracker, clock, start: clock.now, requests,
        state: { due: false, dirty: false, saved: 0 },
        failures: [],
        crashed: [],
        async tickAt(offset) {
            const before = requests.length
            clock.now = run.start + offset
            await until(() => requests.length > before, `the tick at +${offset} ms`, 4000)
            return requests[requests.length - 1]
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
        sweep: () => {},
        isDue: () => run.state.due,
        isDirty: () => run.state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            run.state.due = false
        },
        endIteration: () => {},
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
        reportFailure(error) {
            run.failures.push(error)
            return 1
        },
        reportUncountedFailure(error) {
            run.failures.push(error)
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
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        run.crashed.push(error)
    })
    runs.push(run)
    return run
}

/** The net is on at a one-ms tick interval, so a tick happens whenever the test moves the clock; the module interval is the default. */
const TICKING = { intervalMs: 1 }

async function savedModuleDescription(run: Run): Promise<unknown> {
    return (modulesOf(await run.kit.saved())[1]).description
}

describe('the idle net takes module scope at most once per interval', () => {
    test('reproducer: the default interval is 30 s', () => {
        // Pins the constant the product statement names (MC-372 1); it fails on the base because the constant does not exist.
        expect(IDLE_NET_MODULE_INTERVAL_MS).toBe(30_000)
    })

    test('reproducer: with no resident character, module scope is not taken until 30 s, then once, then not again until 60 s', async () => {
        const run = await startRun(clone(buildSmall(0)), TICKING)
        const scoped: Array<[number, boolean]> = []
        for (const offset of [2_000, 29_999, 30_000, 31_000, 59_999, 60_000]) {
            scoped.push([offset, effectiveModules(await run.tickAt(offset))])
        }
        expect(scoped).toEqual([[2_000, false], [29_999, false], [30_000, true], [31_000, false], [59_999, false], [60_000, true]])
        expect(run.crashed).toEqual([])
    })

    test('reproducer: with no resident character, both request fields carry the gate, not only the net field', async () => {
        const run = await startRun(clone(buildSmall(0)), TICKING)
        const early = await run.tickAt(2_000)
        expect(early.modules).toBe(false)
        expect(early.net).toEqual({ chaId: null, modules: false })
        const due = await run.tickAt(30_000)
        expect(due.modules).toBe(true)
        expect(due.net).toEqual({ chaId: null, modules: true })
    })

    test('reproducer: with residents, module scope follows the clock and not the round-robin index', async () => {
        const db = clone(buildSmall(4))
        const run = await startRun(db, TICKING)
        const ids = chars(db).map(entry => String(entry.chaId))
        const ticks: Array<[number, string | null | undefined, boolean]> = []
        for (const offset of [2_000, 4_000, 6_000, 30_000, 32_000]) {
            const request = await run.tickAt(offset)
            expect(request.modules).toBe(false)
            ticks.push([offset, request.net?.chaId, effectiveModules(request)])
        }
        // Index 0 does not take module scope before 30 s; the first tick after 30 s does, on index 3; the next, on index 0, does not.
        expect(ticks).toEqual([
            [2_000, ids[0], false], [4_000, ids[1], false], [6_000, ids[2], false], [30_000, ids[3], true], [32_000, ids[0], false],
        ])
    })

    test('reproducer: an unmarked module edit is written by the first module tick after 30 s and not before', async () => {
        const db = clone(buildSmall(4))
        const run = await startRun(db, TICKING)
        modulesOf(db)[1].description = 'unflagged module edit'
        await run.tickAt(2_000)
        await run.tickAt(29_999)
        await pause(60)
        expect(await savedModuleDescription(run)).not.toBe('unflagged module edit')
        await run.tickAt(30_000)
        await until(async () => await savedModuleDescription(run) === 'unflagged module edit', 'the due tick to write the module edit', 4000)
        expect(run.crashed).toEqual([])
    })

    test('reproducer: a configured moduleIntervalMs replaces the default', async () => {
        const run = await startRun(clone(buildSmall(0)), { intervalMs: 1, moduleIntervalMs: 5_000 })
        expect(effectiveModules(await run.tickAt(4_999))).toBe(false)
        expect(effectiveModules(await run.tickAt(5_000))).toBe(true)
        expect(effectiveModules(await run.tickAt(9_999))).toBe(false)
        expect(effectiveModules(await run.tickAt(10_000))).toBe(true)
    })

    test('guard: a marked module edit is written by its own pass without waiting for the interval', async () => {
        const db = clone(buildSmall(4))
        const run = await startRun(db, TICKING)
        modulesOf(db)[1].description = 'flagged module edit'
        run.tracker.modules = true
        run.state.due = true
        run.state.dirty = true
        await until(async () => await savedModuleDescription(run) === 'flagged module edit', 'the marked pass to write the module edit', 4000)
        expect(run.requests[0].modules).toBe(true)
        expect(run.requests[0].net).toBeUndefined()
    })

    test('guard: the character round-robin is unchanged across a module tick', async () => {
        const db = clone(buildSmall(4))
        const run = await startRun(db, TICKING)
        const ids = chars(db).map(entry => String(entry.chaId))
        const seen: Array<string | null | undefined> = []
        for (const offset of [2_000, 4_000, 30_000, 32_000, 34_000, 36_000]) {
            seen.push((await run.tickAt(offset)).net?.chaId)
        }
        expect(seen).toEqual([ids[0], ids[1], ids[2], ids[3], ids[0], ids[1]])
    })

    test('guard: with the net off no tick runs even when the interval has passed', async () => {
        const run = await startRun(clone(buildSmall(0)), null)
        run.clock.now = run.start + 120_000
        await pause(80)
        expect(run.requests).toEqual([])
        expect(run.crashed).toEqual([])
    })
})

describe('the module slot is consumed only by a tick that plans modules', () => {
    test('reproducer: a module tick whose commit fails waits for the next interval, and the edit is saved by that one', async () => {
        const db = clone(buildSmall(4))
        let refusals = 1
        const run = await startRun(db, TICKING, (kit) => {
            const real = kit.committer
            const scripted: Committer = {
                ...real,
                async commit(read, request) {
                    if (refusals > 0) {
                        refusals -= 1
                        return { status: 'refused', reason: 'bad-unit-set', detail: 'x' } as CommitResult
                    }
                    return real.commit(read, request)
                },
            }
            kit.context.session = { ...kit.context.session, committer: scripted }
        })
        modulesOf(db)[1].description = 'unflagged module edit'
        expect(effectiveModules(await run.tickAt(30_000))).toBe(true)
        await until(() => run.failures.length === 1, 'the refused module tick to be reported', 4000)
        expect(effectiveModules(await run.tickAt(30_001))).toBe(false)
        expect(effectiveModules(await run.tickAt(59_999))).toBe(false)
        await pause(60)
        expect(await savedModuleDescription(run)).not.toBe('unflagged module edit')
        expect(effectiveModules(await run.tickAt(60_000))).toBe(true)
        await until(async () => await savedModuleDescription(run) === 'unflagged module edit', 'the next module tick to write the edit', 4000)
    })

    test('guard: a tick whose base read throws does not consume the slot', async () => {
        const db = clone(buildSmall(4))
        let throws = 1
        const run = await startRun(db, TICKING, (kit) => {
            const real = kit.committer
            const scripted: Committer = {
                ...real,
                async readCommit() {
                    if (throws > 0) {
                        throws -= 1
                        throw new Error('the base read failed')
                    }
                    return real.readCommit()
                },
            }
            kit.context.session = { ...kit.context.session, committer: scripted }
        })
        run.clock.now = run.start + 30_000
        await until(() => run.failures.length === 1, 'the failed base read to be reported', 4000)
        expect(run.requests).toEqual([])
        expect(effectiveModules(await run.tickAt(30_001))).toBe(true)
    })
})

describe('with no resident character and modules not due, the tick still runs', () => {
    test('guard: an unmarked fixed-group edit is written by a tick', async () => {
        const db = clone(buildSmall(0))
        const run = await startRun(db, TICKING)
        ;(db.botPresets as unknown as Entry[])[0].temperature = 0.1234
        await run.tickAt(2_000)
        await until(async () => ((await run.kit.saved()).botPresets as unknown as Entry[])[0].temperature === 0.1234, 'the tick to write the preset edit', 4000)
        expect(run.crashed).toEqual([])
    })

    test('reproducer: the same tick leaves an unmarked module edit unwritten until the modules are due', async () => {
        const db = clone(buildSmall(0))
        const run = await startRun(db, TICKING)
        ;(db.botPresets as unknown as Entry[])[0].temperature = 0.1234
        modulesOf(db)[1].description = 'unflagged module edit'
        await run.tickAt(2_000)
        await until(async () => ((await run.kit.saved()).botPresets as unknown as Entry[])[0].temperature === 0.1234, 'the tick to write the preset edit', 4000)
        expect(await savedModuleDescription(run)).not.toBe('unflagged module edit')
        await run.tickAt(30_000)
        await until(async () => await savedModuleDescription(run) === 'unflagged module edit', 'the due tick to write the module edit', 4000)
    })

    test('guard: a peer commit is noticed by a tick when no broadcast was heard', async () => {
        const db = clone(buildSmall(0))
        const run = await startRun(db, TICKING)
        await peerCommit(run.kit, (peerDb) => { ;(peerDb.botPresets as unknown as Entry[])[0].temperature = 0.4321 })
        run.clock.now = run.start + 2_000
        await until(() => run.kit.peer.clean.length >= 1, 'the tick to notice the peer commit', 4000)
        // The tick judged the base before it planned anything.
        expect(run.requests).toEqual([])
        expect(run.kit.peer.clean[0]).toMatchObject({ reason: 'peer-commit', unsaved: false })
        expect(run.crashed).toEqual([])
    })
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CommitRequest, Committer } from '../../store2/commit'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { YieldBudgetOptions } from '../../saveYield'
import { startYieldGaps, yieldGapMeterHandle, type YieldGapMeterHandle, type YieldGapRecord } from '../../store2/saveYieldMeter'
import type { Database, character } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { buildColdStub } from '../../../process/coldCharacter'
import { buildSmall } from './codecFixtures'

/**
 * The yield-gap meter of a measurement build, observed through the real save loop over a real memory backend and
 * committer. The yield budget is replaced by one that really yields on every `every`-th `maybeYield` call, so the
 * number of real yields differs from the number of calls and a segment can be given a known length by spinning before
 * the yield. The backend's calls (the commit key read, the marker write, the commit) and the stub loader are delayed by a
 * real timer where the loop awaits them: no segment may contain such a wait.
 * Labels: reproducer (fails on a loop without the meter, because no record exists, or on the mutant named in its test),
 * guard (passes before and after). The reproducers are feature tests of a new meter: what makes them discriminate is
 * the scratch mutants (a wait left inside a segment, a missing pause, a lost bulk flag), not the absence of a record.
 */

const flags = vi.hoisted(() => ({ measure: true }))
const budget = vi.hoisted(() => ({
    calls: 0,
    every: 2,
    spinMs: 0,
    options: [] as Array<Record<string, unknown> | undefined>,
}))

vi.mock('../../../process/memory/measureFlag', () => ({
    get MEASURE() {
        return flags.measure
    },
}))

vi.mock('../../saveYield', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../saveYield')>()
    return {
        ...real,
        createYieldBudget(options?: YieldBudgetOptions) {
            budget.options.push(options as Record<string, unknown> | undefined)
            return {
                noteYielded() {},
                async maybeYield() {
                    budget.calls += 1
                    if (budget.calls % budget.every !== 0) {
                        return
                    }
                    const end = performance.now() + budget.spinMs
                    while (performance.now() < end) {
                        // A known stretch of synchronous work before the yield.
                    }
                    // The real budget consults `skip` only when it would yield, and then yields nothing.
                    if (options?.skip?.() === true) {
                        return
                    }
                    await (options?.yieldFn ?? real.yieldToEventLoop)()
                },
            }
        },
    }
})

type Entry = Record<string, unknown>

const MODE_KEY = 'risu-measure-yield-mode'
const DELAY_MS = 400
const SEGMENT_LIMIT_MS = 100
/** planMs spans the planning yields, which run on real timers; an injected DELAY_MS wait exceeds this bound, and the planning yields stay well under it. */
const PLAN_LIMIT_MS = DELAY_MS - 100
/** Synchronous work the committer or budget spins, and the bounds that tell it from load: a lower bound just under the spin, and for the bulk path an upper bound well under the spin but above an ordinary build. */
const SPIN_MS = 60
const COMMIT_SPIN_MS = 200
const SETTLE_MS = 250

const stops: Array<() => void> = []

function installedHandle(): YieldGapMeterHandle | undefined {
    return (globalThis as { __risuYieldGapMeter?: YieldGapMeterHandle }).__risuYieldGapMeter
}

function records(): YieldGapRecord[] {
    return yieldGapMeterHandle.all()
}

beforeEach(() => {
    flags.measure = true
    budget.calls = 0
    budget.every = 2
    budget.spinMs = 0
    budget.options.length = 0
    delete (globalThis as { __risuYieldGapMeter?: YieldGapMeterHandle }).__risuYieldGapMeter
    yieldGapMeterHandle.reset()
})

afterEach(async () => {
    for (const stop of stops) {
        stop()
    }
    stops.length = 0
    vi.unstubAllGlobals()
    // A pass of the stopped loop may still be finishing; let it end before the next test resets the records.
    await pause(SETTLE_MS)
})

function pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

interface Delays {
    read: number
    /** A delay after the real commit returned, used only with `commitThrows`. */
    commit: number
    /** The commit throws after its delay instead of returning. */
    commitThrows: boolean
    readThrows: boolean
    /** Backend calls (by name) that wait `DELAY_MS` on a real timer, where the committer awaits them. */
    backend: ReadonlySet<string>
    /** The live database holds this many characters while the committed tree holds four, so the pass writes many new units. */
    liveUnits: number
    /** Synchronous work, in ms, the committer does between being handed the request and building it. */
    commitSpinMs: number
}

interface Extra {
    configure?: (kit: Store2Kit, db: Database) => void
}

interface Run {
    saved: () => number
    putUnits: () => number
    failures: unknown[]
    crashed: unknown[]
    whole(): void
    due(): void
}

async function startRun(delays: Partial<Delays> = {}, edit: (db: Database) => void = (db) => {
    ;(db.characters as unknown as Entry[])[1].personality = 'metered edit'
}, extra: Extra = {}): Promise<Run> {
    const seed = JSON.parse(JSON.stringify(buildSmall(4))) as Database
    const armed = { on: false }
    const kit = await startStore2({
        db: seed,
        idleNet: null,
        hooks: {
            before: async (name) => {
                if (armed.on && delays.backend?.has(name) === true) {
                    await pause(DELAY_MS)
                }
            },
        },
    })
    armed.on = true
    const db = delays.liveUnits === undefined ? seed : JSON.parse(JSON.stringify(buildSmall(delays.liveUnits))) as Database
    extra.configure?.(kit, db)
    const real = kit.committer
    const scripted: Committer = {
        ...real,
        async readCommit() {
            if (delays.read !== undefined) {
                await pause(delays.read)
            }
            if (delays.readThrows === true) {
                throw new Error('the base read failed')
            }
            return real.readCommit()
        },
        async commit(read, request) {
            if (delays.commitSpinMs !== undefined) {
                const end = performance.now() + delays.commitSpinMs
                while (performance.now() < end) {
                    // The committer's own synchronous work before its build.
                }
            }
            const result = await real.commit(read, request)
            if (delays.commit !== undefined) {
                await pause(delays.commit)
            }
            if (delays.commitThrows === true) {
                throw new Error('the commit failed after its build')
            }
            return result
        },
    }
    kit.context.session = { ...kit.context.session, committer: scripted }
    edit(db)
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const reloadFlag = { state: false }
    const state = { due: false, dirty: false, saved: 0 }
    const run: Run = {
        saved: () => state.saved,
        putUnits: () => kit.counted.writes.filter(write => write.call === 'putUnit').length,
        failures: [],
        crashed: [],
        whole() {
            reloadFlag.state = true
            run.due()
        },
        due() {
            state.due = true
            state.dirty = true
        },
    }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag,
        getDatabase: () => db,
        mergeBack: () => {},
        liveCheck: () => {},
        sweep: () => {},
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
        unsavable: () => {},
        saved() {
            state.saved += 1
        },
        broadcast: () => {},
        peerHeard: () => false,
        setStopped: () => {},
        reportFailure(error) {
            run.failures.push(error)
            return 5_000
        },
        reportUncountedFailure(error) {
            run.failures.push(error)
            return 5_000
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
        now: () => Date.now(),
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        run.crashed.push(error)
    })
    stops.push(() => { stopped = true })
    return run
}

function stubMode(value: string | null): { reads: () => number } {
    const keys: string[] = []
    vi.stubGlobal('localStorage', {
        getItem(key: string) {
            keys.push(key)
            return key === MODE_KEY ? value : null
        },
    })
    return { reads: () => keys.filter(key => key === MODE_KEY).length }
}

describe('segments hold no I/O wait', () => {
    test('reproducer: a backend whose key read and ordinary commit are delayed appears in no segment, and the stretches are the pass\'s own', async () => {
        const run = await startRun({ backend: new Set(['readCommit', 'commitOrdinary']) })
        run.whole()
        await until(() => run.saved() >= 1, 'the metered whole pass to save', 8000)
        const record = records()[0]
        expect(record.kind).toBe('whole')
        expect(record.modules).toBe(true)
        expect(record.bulk).toBe(false)
        expect(record.maxSegmentMs).toBeLessThan(SEGMENT_LIMIT_MS)
        expect(record.planMs).not.toBeNull()
        expect(record.planMs as number).toBeLessThan(PLAN_LIMIT_MS)
        expect(record.buildMs).toBeGreaterThan(0)
        expect(record.buildMs).toBeLessThan(SEGMENT_LIMIT_MS)
        expect(record.segmentMaxMs.c).toBeGreaterThanOrEqual(record.buildMs)
        expect(record.budgetMs).toBe(8)
        expect(run.crashed).toEqual([])
    })

    test('reproducer: a known stretch before a real yield is the longest segment, in the planning part', async () => {
        budget.spinMs = SPIN_MS
        const run = await startRun()
        run.whole()
        await until(() => run.saved() >= 1, 'the metered whole pass to save', 8000)
        const record = records()[0]
        expect(record.maxSegmentMs).toBeGreaterThanOrEqual(SPIN_MS - 10)
        expect(['a', 'b']).toContain(record.maxSegmentLabel)
        expect(record.segmentMaxMs.d).toBeLessThan(SEGMENT_LIMIT_MS)
    })

    test('reproducer: yields counts the real yields and not the maybeYield calls', async () => {
        const run = await startRun()
        run.whole()
        await until(() => run.saved() >= 1, 'the metered whole pass to save', 8000)
        const record = records()[0]
        expect(budget.calls).toBeGreaterThanOrEqual(4)
        expect(record.yields).toBe(Math.floor(budget.calls / budget.every))
        expect(record.yields).toBeGreaterThanOrEqual(2)
        expect(record.yieldWaitSumMs).toBeGreaterThanOrEqual(record.yieldWaitMaxMs)
        expect(record.yieldWaitMaxMs).toBeGreaterThanOrEqual(0)
    })

    test('reproducer: a commit that throws after a delay still closes the record, with the delay outside every segment', async () => {
        const run = await startRun({ commit: DELAY_MS, commitThrows: true })
        run.whole()
        await until(() => run.failures.length >= 1, 'the commit failure to be reported', 8000)
        const record = records()[0]
        expect(record).toBeDefined()
        expect(record.maxSegmentMs).toBeLessThan(SEGMENT_LIMIT_MS)
        expect(run.crashed).toEqual([])
    })

    test('guard: a pass whose base read throws built no request and records nothing', async () => {
        const run = await startRun({ readThrows: true })
        run.due()
        await until(() => run.failures.length >= 1, 'the failed base read to be reported', 8000)
        expect(records()).toEqual([])
    })

    test('reproducer: a bulk commit whose marker write and key re-read wait on the backend has no such wait in any segment', async () => {
        const run = await startRun({ backend: new Set(['readCommit', 'casCommit']), liveUnits: 40 })
        run.whole()
        await until(() => run.saved() >= 1, 'the metered bulk pass to save', 15000)
        const record = records()[0]
        // More new units than the bulk threshold, so the committer took the marker path.
        expect(run.putUnits()).toBeGreaterThan(59)
        expect(record.bulk).toBe(true)
        expect(record.maxSegmentMs).toBeLessThan(SEGMENT_LIMIT_MS)
        expect(record.segmentMaxMs.c).toBeLessThan(SEGMENT_LIMIT_MS)
        expect(record.buildMs).toBeGreaterThan(0)
        expect(run.crashed).toEqual([])
    }, 30000)

    test('reproducer: the committer\'s own work before an ordinary build is inside segment c, and before a bulk build is not', async () => {
        const ordinary = await startRun({ commitSpinMs: COMMIT_SPIN_MS })
        ordinary.whole()
        await until(() => ordinary.saved() >= 1, 'the ordinary pass to save', 8000)
        const ordinaryRecord = records()[0]
        expect(ordinaryRecord.bulk).toBe(false)
        expect(ordinaryRecord.segmentMaxMs.c).toBeGreaterThanOrEqual(COMMIT_SPIN_MS - 10)

        yieldGapMeterHandle.reset()
        const bulk = await startRun({ commitSpinMs: COMMIT_SPIN_MS, liveUnits: 40 })
        bulk.whole()
        await until(() => bulk.saved() >= 1, 'the bulk pass to save', 15000)
        const bulkRecord = records()[0]
        expect(bulkRecord.bulk).toBe(true)
        expect(bulkRecord.segmentMaxMs.c).toBeLessThan(COMMIT_SPIN_MS - 50)
    }, 30000)

    test('reproducer: a stub load that waits appears in no segment', async () => {
        let loaded = 0
        let resident: Entry | null = null
        const run = await startRun({}, (db) => {
            const list = db.characters as unknown as Entry[]
            resident = JSON.parse(JSON.stringify(list[1])) as Entry
            list[1] = buildColdStub(resident as unknown as character, 'a-key-the-entry-does-not-name', ['chat-a']) as unknown as Entry
        }, {
            configure(kit, db) {
                kit.context.loadStub = async () => {
                    loaded += 1
                    await pause(DELAY_MS)
                    ;(db.characters as unknown as Entry[])[1] = resident as Entry
                    return true
                }
            },
        })
        run.whole()
        await until(() => run.saved() >= 1, 'the pass to save after the stub load', 8000)
        const record = records()[0]
        expect(loaded).toBe(1)
        expect(record.maxSegmentMs).toBeLessThan(SEGMENT_LIMIT_MS)
        expect(run.failures).toEqual([])
    })

    test('reproducer: a pass that changes nothing records its stretches and no build', async () => {
        const run = await startRun({}, () => {})
        run.due()
        await until(() => run.saved() >= 1, 'the unchanged pass to report saved', 8000)
        const record = records()[0]
        expect(record.buildMs).toBe(0)
        expect(record.kind).toBe('edit')
    })
})

describe('the mode switch changes only the yield primitive', () => {
    test('reproducer: by default a real yield goes through scheduler.yield', async () => {
        const schedulerYield = vi.fn(() => Promise.resolve())
        vi.stubGlobal('scheduler', { yield: schedulerYield })
        const mode = stubMode(null)
        const run = await startRun()
        run.whole()
        await until(() => run.saved() >= 1, 'the pass to save', 8000)
        const record = records()[0]
        expect(record.mode).toBe('scheduler')
        expect(schedulerYield).toHaveBeenCalledTimes(record.yields)
        expect(record.yields).toBeGreaterThanOrEqual(2)
        expect(mode.reads()).toBe(1)
    })

    test('reproducer: with the message switch no real yield goes through scheduler.yield, and the pass saves the same', async () => {
        const schedulerYield = vi.fn(() => Promise.resolve())
        vi.stubGlobal('scheduler', { yield: schedulerYield })
        const mode = stubMode('message')
        const run = await startRun()
        run.whole()
        await until(() => run.saved() >= 1, 'the pass to save', 8000)
        const record = records()[0]
        expect(record.mode).toBe('message')
        expect(record.yields).toBeGreaterThanOrEqual(2)
        expect(schedulerYield).not.toHaveBeenCalled()
        // Read once per pass, not once per yield.
        expect(mode.reads()).toBe(1)
        expect(run.failures).toEqual([])
    })

    test('reproducer: a value other than message leaves the default primitive', async () => {
        const schedulerYield = vi.fn(() => Promise.resolve())
        vi.stubGlobal('scheduler', { yield: schedulerYield })
        stubMode('on')
        const run = await startRun()
        run.whole()
        await until(() => run.saved() >= 1, 'the pass to save', 8000)
        expect(records()[0].mode).toBe('scheduler')
        expect(schedulerYield).toHaveBeenCalled()
    })
})

describe('a normal build installs nothing', () => {
    test('guard: with MEASURE false there is no recorder, no global, no switch read, and the budget is the default one', async () => {
        flags.measure = false
        const schedulerYield = vi.fn(() => Promise.resolve())
        vi.stubGlobal('scheduler', { yield: schedulerYield })
        const mode = stubMode('message')
        const run = await startRun()
        run.whole()
        await until(() => run.saved() >= 1, 'the pass to save', 8000)
        expect(installedHandle()).toBeUndefined()
        expect(records()).toEqual([])
        expect(mode.reads()).toBe(0)
        expect(budget.options.length).toBeGreaterThan(0)
        // The exact option shape: only the frozen-page `skip` function, no `yieldFn`, `budgetMs` or `now`, so the budget and primitive are the default ones.
        expect(budget.options.every(options => options !== undefined && Object.keys(options).join() === 'skip' && typeof options.skip === 'function')).toBe(true)
        // The default primitive ran: the real yields went through scheduler.yield.
        expect(schedulerYield).toHaveBeenCalled()
    })
})

describe('guard (passes before and after the carry rule): the build wrapper keeps the fields of the request it wraps', () => {
    test('G9: the carry claim of a wrapped request is the request\'s own', () => {
        const recorder = startYieldGaps({})
        expect(recorder).not.toBeNull()
        const request: CommitRequest = { newUnits: 3, build: () => { throw new Error('not built here') }, carry: { from: 'store2/m-from', units: 4 }, force: true }
        const wrapped = recorder?.wrapBuild(request)
        expect(wrapped?.carry).toEqual({ from: 'store2/m-from', units: 4 })
        expect(wrapped?.force).toBe(true)
        expect(wrapped?.newUnits).toBe(3)
        recorder?.finish()
    })
})

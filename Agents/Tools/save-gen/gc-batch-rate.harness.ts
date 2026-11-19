// @vitest-environment node
/**
 * Run this file by name only. Never run the `save-gen/` folder. The harness config includes `save-gen/*.harness.ts`, and a
 * folder run also rewrites goldens.
 *
 *   npx --no-install vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/gc-batch-rate.harness.ts
 *
 * C1 closeout measurement (a diagnostic: it blocks nothing and is an input to closing C1). It measures the aged clean-up
 * pass on a Node server through the real path: the real `server/node/server.cjs` with the test clock-shift preload, the
 * real `gcPass` over `buildAutoGcDeps(...)`, the real `backend.removeBatch` (at most `REMOVE_BATCH_MAX` keys per batch)
 * and the Node pace `batchPaceOf('node')`. Orphans are real units put through the backend; nothing is written into the
 * save directory directly. Each run reaches the deleting pass the production way: pass 1 records, pass 2 (a day and ten
 * minutes later) marks, pass 3 (two days and twenty minutes) deletes. Pass 3 is the measured pass. There is no `minAgeMs`
 * override. The server clock and the page clock are shifted together; timings use `performance.now()`.
 *
 * Environment variables (all optional):
 *   GCB_RUNS   runs per size (default 5)
 *   GCB_LARGE  orphan count of the large store (default 2000, the per-pass cap `UNIT_RECORD_CAP`)
 *   GCB_SMALL  orphan count of the small store (default 26: two batches, one pace)
 *
 * Output: JSON and Markdown under `%TEMP%\risu-b715\b61\orphan-features\n159\c1-batch-rate\`.
 * The hidden-tab figures are a PROJECTION from the measured round trip, not a measurement; they assume the network
 * awaits are not throttled. The hardware is a best-case i9 and the numbers are not representative of a low-end device.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { createNodeBackend, REMOVE_BATCH_MAX, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newUnitKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { buildAutoGcDeps, type AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import { gcPass, type GcResult } from 'src/ts/storage/store2/gc/pass'
import { UNIT_RECORD_CAP } from 'src/ts/storage/store2/gc/unitAge'
import { createClock, seedStore, testEnv } from 'src/ts/storage/tests/store2/commitFixtures'
import { startNodeServer } from 'src/ts/storage/tests/nodeServerFixture'

vi.setConfig({ testTimeout: 600_000, hookTimeout: 120_000 })

const CLOCK_SHIFT_PRELOAD = fileURLToPath(new URL('../../../src/ts/storage/tests/nodeServerClockShift.cjs', import.meta.url))
const SHIFT_ENV = 'RISU_TEST_SERVER_CLOCK_SHIFT_MS'
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const OUT_DIR = join(tmpdir(), 'risu-b715', 'b61', 'orphan-features', 'n159', 'c1-batch-rate')
const PUT_CONCURRENCY = 16

function intFromEnv(name: string, fallback: number): number {
    const raw = process.env[name]
    if (raw === undefined || raw === '') {
        return fallback
    }
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
    }
    return value
}

const RUNS = intFromEnv('GCB_RUNS', 5)
const SIZES = [
    { label: 'small', orphans: intFromEnv('GCB_SMALL', 26) },
    { label: 'large', orphans: intFromEnv('GCB_LARGE', 2000) },
]

const realNow = Date.now.bind(Date)

//#region statistics

function sortedCopy(values: readonly number[]): number[] {
    return [...values].sort((a, b) => a - b)
}

function median(values: readonly number[]): number {
    if (values.length === 0) {
        return Number.NaN
    }
    const sorted = sortedCopy(values)
    const mid = sorted.length >> 1
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Nearest-rank percentile. */
function percentile(values: readonly number[], fraction: number): number {
    if (values.length === 0) {
        return Number.NaN
    }
    const sorted = sortedCopy(values)
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]
}

interface Spread {
    median: number
    min: number
    max: number
}

function spreadOf(values: readonly number[]): Spread {
    return { median: median(values), min: Math.min(...values), max: Math.max(...values) }
}

//#endregion

//#region one run

interface PassMeasure {
    wallMs: number
    status: string
    deleted: number
    batches: number
    stopped: string | null
    phase: string | null
    candidates: number | null
    batchRoundTripsMs: number[]
    batchSizes: number[]
    paceTotalMs: number
}

interface RunMeasure {
    size: string
    orphans: number
    pass1: PassMeasure
    pass2: PassMeasure
    pass3: PassMeasure
    rssMaxBytes: number
    problems: string[]
}

const runs: RunMeasure[] = []

async function seedOrphans(backend: Store2Backend, count: number, seed: number): Promise<number> {
    const clock = createClock(realNow())
    const env = testEnv(clock, seed)
    await seedStore(backend, env)
    let planted = 0
    while (planted < count) {
        const chunk = Math.min(PUT_CONCURRENCY, count - planted)
        await Promise.all(Array.from({ length: chunk }, (_, offset) => {
            const key = newUnitKey(env)
            return backend.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: planted + offset }))
        }))
        planted += chunk
    }
    return planted
}

async function measuredPass(deps: NonNullable<ReturnType<typeof buildAutoGcDeps>>): Promise<PassMeasure> {
    const batchRoundTripsMs: number[] = []
    const batchSizes: number[] = []
    let paceTotalMs = 0
    const realBackend = deps.backend
    deps.backend = Object.create(realBackend, {
        removeBatch: {
            value: async (...args: Parameters<Store2Backend['removeBatch']>) => {
                const started = performance.now()
                try {
                    return await realBackend.removeBatch(...args)
                } finally {
                    batchRoundTripsMs.push(performance.now() - started)
                    batchSizes.push(args[0].length)
                }
            },
        },
    }) as Store2Backend
    const realPace = deps.pace
    if (realPace !== undefined) {
        deps.pace = async () => {
            const started = performance.now()
            try {
                await realPace()
            } finally {
                paceTotalMs += performance.now() - started
            }
        }
    }
    const started = performance.now()
    const result: GcResult = await gcPass(deps)
    const wallMs = performance.now() - started
    if (result.status === 'refused') {
        return {
            wallMs, status: `refused:${result.reason}`, deleted: 0, batches: 0, stopped: null, phase: null, candidates: null,
            batchRoundTripsMs, batchSizes, paceTotalMs,
        }
    }
    return {
        wallMs, status: 'done', deleted: result.deleted, batches: result.batches, stopped: result.stopped ?? null,
        phase: result.age?.phase ?? null, candidates: result.age?.candidates ?? null,
        batchRoundTripsMs, batchSizes, paceTotalMs,
    }
}

async function oneRun(size: { label: string, orphans: number }, index: number): Promise<RunMeasure> {
    const fixture = await startNodeServer({ nodeArgs: ['--require', CLOCK_SHIFT_PRELOAD], env: { [SHIFT_ENV]: '0' } })
    let clockShift = 0
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockShift)
    const problems: string[] = []
    let rssMaxBytes = 0
    try {
        const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
        const backend = createNodeBackend(store)
        const planted = await seedOrphans(backend, size.orphans, 1000 + index)

        const facts = (ownBase: () => string | null): AutoGcFacts => ({
            isBusy: () => false,
            saveLoopParked: () => false,
            isSaveClean: () => true,
            restoreInProgress: () => false,
            peers: async () => 'unsupported',
            ownBase,
        })
        const parsed = classifyCommitRead(await backend.readCommit())
        const base = parsed.status === 'parsed' && parsed.value.current !== null ? parsed.value.current.key : null
        const runPass = async (): Promise<PassMeasure> => {
            const deps = buildAutoGcDeps({ kind: 'node', backend, idleReason: null }, facts(() => base), store)
            if (deps === null) {
                throw new Error('The pass has no dependencies.')
            }
            if (deps.age === undefined) {
                throw new Error('The aged dependencies are missing: the server has no guarded routes or clock.')
            }
            const measured = await measuredPass(deps)
            rssMaxBytes = Math.max(rssMaxBytes, process.memoryUsage().rss)
            return measured
        }
        const restartAt = async (shift: number): Promise<void> => {
            await fixture.restart({ env: { [SHIFT_ENV]: String(shift) } })
            clockShift = shift
        }

        const pass1 = await runPass()
        await restartAt(DAY + 10 * MINUTE)
        const pass2 = await runPass()
        await restartAt(2 * DAY + 20 * MINUTE)
        const pass3 = await runPass()

        const expectedDeleted = Math.min(planted, UNIT_RECORD_CAP)
        if (pass1.status !== 'done' || pass1.stopped !== null) {
            problems.push(`pass 1 did not finish cleanly: ${pass1.status} stopped=${pass1.stopped}`)
        }
        if (pass2.status !== 'done' || pass2.stopped !== null) {
            problems.push(`pass 2 did not finish cleanly: ${pass2.status} stopped=${pass2.stopped}`)
        }
        if (pass3.status !== 'done') {
            problems.push(`pass 3 is ${pass3.status}`)
        }
        if (pass3.stopped !== null) {
            problems.push(`pass 3 stopped: ${pass3.stopped}`)
        }
        if (pass3.deleted !== expectedDeleted) {
            problems.push(`pass 3 deleted ${pass3.deleted}, planted ${expectedDeleted}`)
        }
        if (pass3.batchSizes.some((length) => length > REMOVE_BATCH_MAX || length < 1)) {
            problems.push(`a batch held ${Math.max(...pass3.batchSizes)} keys (limit ${REMOVE_BATCH_MAX})`)
        }
        if (pass3.batchSizes.reduce((sum, length) => sum + length, 0) !== pass3.deleted) {
            problems.push('the batch sizes do not add up to the deleted count')
        }
        return { size: size.label, orphans: planted, pass1, pass2, pass3, rssMaxBytes, problems }
    } finally {
        spy.mockRestore()
        await fixture.stop()
    }
}

//#endregion

//#region report

/** `T = N·c + (N−1)·p`, seconds; `pace(elapsed)` gives the pause after a batch that ended `elapsed` seconds in. */
function projectedSeconds(batches: number, roundTripS: number, pace: (elapsedS: number) => number): number {
    let elapsed = 0
    for (let batch = 1; batch <= batches; batch++) {
        elapsed += roundTripS
        if (batch < batches) {
            elapsed += pace(elapsed)
        }
    }
    return elapsed
}

interface SizeSummary {
    size: string
    orphans: number
    runs: number
    batches: Spread
    deleted: Spread
    pass1WallMs: Spread
    pass2WallMs: Spread
    pass3WallMs: Spread
    batchRoundTripMedianMs: Spread
    batchRoundTripP90Ms: Spread
    paceTotalMs: Spread
    pooledRoundTripMedianMs: number
    pooledRoundTripP90Ms: number
    rssMaxMiB: number
    problems: string[]
    projection: { model: string, formula: string, seconds: number }[]
}

function summarise(size: string): SizeSummary | null {
    const own = runs.filter((run) => run.size === size)
    if (own.length === 0) {
        return null
    }
    const pooled = own.flatMap((run) => run.pass3.batchRoundTripsMs)
    const batches = spreadOf(own.map((run) => run.pass3.batches))
    const roundTripS = median(own.map((run) => median(run.pass3.batchRoundTripsMs))) / 1000
    const n = Math.round(batches.median)
    const models: { model: string, p: (elapsedS: number) => number, formula: string }[] = [
        { model: 'normal (p = 0.1 s)', p: () => 0.1, formula: 'T = N·c + (N−1)·0.1' },
        { model: 'hidden (p ≈ 1 s)', p: () => 1, formula: 'T = N·c + (N−1)·1' },
        { model: 'intensive throttling (a): p ≈ 60 s from the start', p: () => 60, formula: 'T = N·c + (N−1)·60' },
        {
            model: 'intensive throttling (b): p ≈ 1 s until 5 min of hidden time, then 60 s',
            p: (elapsedS) => (elapsedS < 300 ? 1 : 60),
            formula: 'T = N·c + Σ p(t), p = 1 s while t < 300 s, else 60 s',
        },
    ]
    return {
        size,
        orphans: own[0].orphans,
        runs: own.length,
        batches,
        deleted: spreadOf(own.map((run) => run.pass3.deleted)),
        pass1WallMs: spreadOf(own.map((run) => run.pass1.wallMs)),
        pass2WallMs: spreadOf(own.map((run) => run.pass2.wallMs)),
        pass3WallMs: spreadOf(own.map((run) => run.pass3.wallMs)),
        batchRoundTripMedianMs: spreadOf(own.map((run) => median(run.pass3.batchRoundTripsMs))),
        batchRoundTripP90Ms: spreadOf(own.map((run) => percentile(run.pass3.batchRoundTripsMs, 0.9))),
        paceTotalMs: spreadOf(own.map((run) => run.pass3.paceTotalMs)),
        pooledRoundTripMedianMs: median(pooled),
        pooledRoundTripP90Ms: percentile(pooled, 0.9),
        rssMaxMiB: Math.max(...own.map((run) => run.rssMaxBytes)) / (1024 * 1024),
        problems: own.flatMap((run, index) => run.problems.map((problem) => `run ${index + 1}: ${problem}`)),
        projection: models.map((model) => ({ model: model.model, formula: model.formula, seconds: projectedSeconds(n, roundTripS, model.p) })),
    }
}

const f1 = (value: number): string => value.toFixed(1)
const spreadRow = (label: string, spread: Spread, digits = 1): string =>
    `| ${label} | ${spread.median.toFixed(digits)} | ${spread.min.toFixed(digits)} | ${spread.max.toFixed(digits)} |`

function markdownOf(summaries: SizeSummary[]): string {
    const lines: string[] = [
        '# C1 batch-rate measurement',
        '',
        `Date: ${new Date().toISOString()}. Runs per size: ${RUNS}. Node ${process.version}, ${process.platform}.`,
        '',
        'Diagnostic only: it blocks nothing and is an input to closing C1. Real `server.cjs`, real `gcPass`, real `removeBatch`',
        `(at most ${REMOVE_BATCH_MAX} keys per batch), Node pace 100 ms. Pass 3 is the deleting pass; passes 1 and 2 record and mark.`,
        '',
        '**Hardware note:** the numbers come from a best-case i9 desktop with a loopback server. A low-end device or a remote server',
        'has a larger round trip; read them as a floor, not as a typical figure.',
        '',
    ]
    for (const summary of summaries) {
        lines.push(
            `## ${summary.size} store`,
            '',
            `Actual counts: planted orphans ${summary.orphans}; runs ${summary.runs}; pass-3 deleted (median ${summary.deleted.median}, min ${summary.deleted.min}, max ${summary.deleted.max}); pass-3 batches (median ${summary.batches.median}, min ${summary.batches.min}, max ${summary.batches.max}); paces = batches − 1.`,
            `Peak resident set of the vitest process seen: ${f1(summary.rssMaxMiB)} MiB (the server child is not included).`,
            '',
            `Sanity: ${summary.problems.length === 0 ? 'all passed (deleted equals planted, every batch within the limit, no pass stopped).' : 'PROBLEMS'}`,
            ...summary.problems.map((problem) => `- ${problem}`),
            '',
            '| measure (ms) | median | min | max |',
            '|---|---|---|---|',
            spreadRow('pass 3 wall time', summary.pass3WallMs),
            spreadRow('per-batch round trip, median of a run', summary.batchRoundTripMedianMs, 2),
            spreadRow('per-batch round trip, p90 of a run', summary.batchRoundTripP90Ms, 2),
            spreadRow('total pace time (pass 3)', summary.paceTotalMs),
            spreadRow('pass 1 wall time', summary.pass1WallMs),
            spreadRow('pass 2 wall time', summary.pass2WallMs),
            '',
            `Pooled over all runs, per-batch round trip: median ${summary.pooledRoundTripMedianMs.toFixed(2)} ms, p90 ${summary.pooledRoundTripP90Ms.toFixed(2)} ms.`,
            '',
            `### Hidden-tab projection (PROJECTION, not a measurement) for the ${summary.size} store`,
            '',
            `Formula: T = N·c + (N−1)·p, with N = ${Math.round(summary.batches.median)} batches (median) and c = ${summary.batchRoundTripMedianMs.median.toFixed(2)} ms (the median over runs of each run's median round trip).`,
            'Assumes the network awaits are not throttled; only the pace timer is.',
            '',
            '| pace model | T (s) | T (min) |',
            '|---|---|---|',
            ...summary.projection.map((row) => `| ${row.model}<br>${row.formula} | ${row.seconds.toFixed(1)} | ${(row.seconds / 60).toFixed(2)} |`),
            '',
        )
    }
    return lines.join('\n')
}

afterAll(async () => {
    const summaries = SIZES.map((size) => summarise(size.label)).filter((summary): summary is SizeSummary => summary !== null)
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(join(OUT_DIR, 'gc-batch-rate.json'), JSON.stringify({ runsPerSize: RUNS, sizes: SIZES, summaries, runs }, null, 2), 'utf-8')
    await writeFile(join(OUT_DIR, 'gc-batch-rate.md'), markdownOf(summaries), 'utf-8')
    console.log(`gc-batch-rate output: ${OUT_DIR}`)
})

//#endregion

describe('C1 batch rate: aged clean-up pass 3 on a real Node server', () => {
    for (const size of SIZES) {
        for (let index = 0; index < RUNS; index++) {
            test(`${size.label} store (${size.orphans} orphans), run ${index + 1} of ${RUNS}`, async () => {
                const measured = await oneRun(size, index)
                runs.push(measured)
                expect(measured.problems).toEqual([])
            })
        }
    }
})

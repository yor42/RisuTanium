// Long PCT driver. Walks a queue of region/backend pairs; per pair it starts W worker processes (vitest running
// pct-worker.test.mjs, stride seeding) and, when every worker has met its quotas (>= minRuns runs in total AND wall clock >= minMs
// since the pair started), writes <out>/<region>-<backend>.json.
//
//   node pct-driver.mjs run   <queue.json>                       the unattended batch
//   node pct-driver.mjs pair  <region> <backend> [--workers N] [--min-runs N] [--min-ms N] [--full] [--out DIR] [--report FILE] [--slot N]   one pair (smoke)
//   node pct-driver.mjs aggregate <pairDir> <region> <backend> [<outFile>]   rebuild a report from a worker directory (partial ok)
//
// Environment: RISU_ROOT (repository root; default: found relative to this file), RISU_SCRATCH (output directory; default: an OS
// temp subdirectory), L7_BASE (result directory; default <scratch>/pct-out), L7_QMIN_RUNS (default 20000), L7_QMIN_MS (default 1 h 1 min).
// Control files (re-read at every scheduling decision, so they can be changed while the batch runs):
//   <scratch>/pct-concurrency.txt  pairs at a time (default 2)   <scratch>/pct-workers.txt  workers per pair (default 8)
//   <out>/STOP  no new pair starts
// Everything is written under the scratch directory; the repository is only read.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/')
const ROOT = (process.env.RISU_ROOT ?? resolve(HERE, '../../../..')).replace(/\\/g, '/')
const SCRATCH = (process.env.RISU_SCRATCH ?? join(tmpdir(), 'risu-replay-tools')).replace(/\\/g, '/')
const BASE = process.env.L7_BASE ?? `${SCRATCH}/pct-out`
const VIOL = `${SCRATCH}/pct-violations`
const NONRED = `${SCRATCH}/pct-nonred`
const LOGS = `${SCRATCH}/pct-logs`
const VITEST = `${ROOT}/node_modules/vitest/vitest.mjs`
const CONFIG = `${HERE}/pct.config.mjs`
const MIN_RUNS = Number(process.env.L7_QMIN_RUNS ?? 20000)
const MIN_MS = Number(process.env.L7_QMIN_MS ?? 3600000 + 60000)
const WATCHDOG_MS = 10 * 60 * 1000

mkdirSync(SCRATCH, { recursive: true })
const now = () => new Date().toISOString()
const log = (text) => appendFileSync(`${SCRATCH}/pct-driver.log`, `${now()} ${text}\n`)
const readNumber = (file, fallback) => {
    try {
        const value = Number(readFileSync(file, 'utf8').trim())
        return Number.isFinite(value) && value > 0 ? value : fallback
    } catch {
        return fallback
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readJson = (file) => {
    try {
        return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
        return null
    }
}
const killTree = (pid) => {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
        try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
    }
}

// ---- aggregation ----

function estimate(registers) {
    const m = registers.length
    let sum = 0
    let zeros = 0
    for (const value of registers) {
        sum += 2 ** -value
        if (value === 0) {
            zeros++
        }
    }
    const alpha = 0.7213 / (1 + 1.079 / m)
    let result = (alpha * m * m) / sum
    if (result <= 2.5 * m && zeros > 0) {
        result = m * Math.log(m / zeros)
    }
    return Math.round(result)
}

export function aggregate(dir, region, backend, extra = {}) {
    const total = {
        region, backend, status: 'partial', workers: new Set(), incarnations: 0, chunks: [], runs: 0, steps: 0, workerMs: 0, kinds: {}, reached: {}, faultRuns: {},
        faultTotal: {}, outcomes: {}, violations: [], nonRed: [], faultedRuns: 0, exercisedRuns: 0, hashedSteps: 0, maxRunMs: 0,
    }
    const registers = new Uint8Array(65536)
    let exactSum = null
    const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.summary.json')) : []
    for (const name of files) {
        const s = readJson(join(dir, name))
        if (s === null) {
            continue
        }
        total.incarnations++
        total.workers.add(s.worker)
        total.runs += s.runs
        total.steps += s.steps
        total.workerMs += s.ms
        total.faultedRuns += s.faultedRuns
        total.exercisedRuns += s.exercisedRuns
        total.hashedSteps += s.hashedSteps
        total.maxRunMs = Math.max(total.maxRunMs, s.maxRunMs)
        for (const [key, count] of Object.entries(s.kinds)) total.kinds[key] = (total.kinds[key] ?? 0) + count
        for (const [key, count] of Object.entries(s.reached)) total.reached[key] = (total.reached[key] ?? 0) + count
        for (const [key, count] of Object.entries(s.faultRuns)) total.faultRuns[key] = (total.faultRuns[key] ?? 0) + count
        for (const [key, count] of Object.entries(s.faultTotal)) total.faultTotal[key] = (total.faultTotal[key] ?? 0) + count
        for (const [key, count] of Object.entries(s.outcomes)) total.outcomes[key] = (total.outcomes[key] ?? 0) + count
        for (const violation of s.violations) total.violations.push({ ...violation, worker: s.worker })
        for (const finding of s.findings) total.nonRed.push({ ...finding, worker: s.worker })
        if (s.runs > 0) {
            total.chunks.push({ worker: s.worker, inc: s.inc, first: s.firstSeed, last: s.lastSeed, stride: s.workers, runs: s.runs, ended: s.ended })
        }
        if (s.hll !== '') {
            const bytes = Buffer.from(s.hll, 'base64')
            for (let i = 0; i < registers.length; i++) {
                if (bytes[i] > registers[i]) registers[i] = bytes[i]
            }
        }
        if (s.exactDistinct !== null) {
            exactSum = (exactSum ?? 0) + s.exactDistinct
        }
    }
    // Largest prefix 1..N of seeds all covered by some chunk, and the covered count.
    const covered = (seed) => total.chunks.some((c) => seed >= c.first && seed <= c.last && (seed - c.first) % c.stride === 0)
    let prefix = 0
    const limit = total.chunks.reduce((max, c) => Math.max(max, c.last), 0)
    while (prefix < limit && covered(prefix + 1)) prefix++
    const events = existsSync(join(dir, 'events.jsonl')) ? readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
    return {
        ...extra,
        region, backend,
        status: extra.status ?? 'partial',
        workers: [...total.workers].sort((a, b) => a - b).length,
        incarnations: total.incarnations,
        workerEvents: events.filter((e) => e.event !== 'start' && e.event !== 'end'),
        seeds: { contiguousFrom1: prefix, highest: limit, chunks: total.chunks.sort((a, b) => a.worker - b.worker || a.inc - b.inc) },
        runs: total.runs, totalSteps: total.steps, workerCpuMs: total.workerMs, maxRunMs: total.maxRunMs,
        distinctFingerprintsEstimate: estimate(registers), fingerprintsHashed: total.hashedSteps, exactDistinctSummedOverWorkers: exactSum,
        kinds: total.kinds, exercisedRuns: total.exercisedRuns, faultedRuns: total.faultedRuns,
        violations: total.violations, nonRedFailures: total.nonRed,
        reachedKeyRuns: Object.fromEntries(Object.entries(total.reached).sort()),
        faultKindRuns: total.faultRuns, faultKindTotals: total.faultTotal,
        outcomeLabels: Object.fromEntries(Object.entries(total.outcomes).sort()),
    }
}

// ---- running one pair ----

async function runPair(pair, options) {
    const { region, backend } = pair
    const name = `${region}-${backend}`
    const out = options.out ?? `${BASE}/runs/${name}`
    if (existsSync(out)) {
        renameSync(out, `${out}-partial-${Date.now()}`)
    }
    mkdirSync(out, { recursive: true })
    mkdirSync(LOGS, { recursive: true })
    const workers = options.workers
    const regionStart = Date.now()
    const event = (e) => appendFileSync(join(out, 'events.jsonl'), JSON.stringify({ t: now(), ...e }) + '\n')
    const git = (...gitArgs) => spawnSync('git', ['-C', ROOT, ...gitArgs], { encoding: 'utf8' }).stdout.trim()
    const code = { head: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--porcelain', '--', 'src/ts/storage', 'server').split('\n').filter(Boolean) }
    event({ event: 'start', workers, regionStart, minRuns: options.minRuns, minMs: options.minMs, code })
    log(`pair ${name} start workers=${workers} slot=${options.slot}`)
    const quotaRuns = Math.ceil(options.minRuns / workers)

    const runWorker = async (w) => {
        let inc = 0
        let first = w + 1
        let doneBefore = 0
        let lastCrashFirst = -1
        while (true) {
            const tag = `w${w}-i${inc}`
            const logFile = `${LOGS}/${name}-${tag}.log`
            const env = {
                ...process.env,
                RISU_ROOT: ROOT, RISU_SCRATCH: SCRATCH,
                L7_REGION: region, L7_BACKEND: backend, L7_WORKER: String(w), L7_WORKERS: String(workers), L7_FIRST_SEED: String(first),
                L7_QUOTA_RUNS: String(quotaRuns), L7_DONE_BEFORE: String(doneBefore), L7_MIN_MS: String(options.minMs),
                L7_REGION_START: String(regionStart), L7_INC: String(inc), L7_OUT: out, L7_VIOL_DIR: VIOL, L7_NONRED_DIR: NONRED,
                L7_CACHE_TAG: `s${options.slot}-w${w}`, L7_FULL: options.full ? '1' : '0',
            }
            const child = spawn(process.execPath, [VITEST, 'run', '--config', CONFIG], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
            appendFileSync(`${SCRATCH}/pct-pids.txt`, `${now()} pid=${child.pid} role=worker pair=${name} w=${w} inc=${inc} first=${first}\n`)
            const sink = (data) => appendFileSync(logFile, data)
            child.stdout.on('data', sink)
            child.stderr.on('data', sink)
            let killedByWatchdog = false
            child.spawnedAt = Date.now()
            const watch = setInterval(() => {
                const touched = ['summary.json', 'jsonl'].map((ext) => join(out, `${tag}.${ext}`)).filter(existsSync).map((f) => statSync(f).mtimeMs)
                const idle = Date.now() - Math.max(child.spawnedAt, ...touched)
                if (idle > WATCHDOG_MS) {
                    killedByWatchdog = true
                    killTree(child.pid)
                }
            }, 60000)
            const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)))
            clearInterval(watch)
            const summary = readJson(join(out, `${tag}.summary.json`))
            const cleanDone = existsSync(join(out, `${tag}.done`))
            if (cleanDone) {
                event({ event: 'worker-done', w, inc, code })
                return
            }
            const lastSeed = summary?.lastSeed ?? null
            const runs = summary?.runs ?? 0
            doneBefore += runs
            if (code === 75) {
                event({ event: 'worker-hang', w, inc, hungSeed: lastSeed })
                first = lastSeed + workers
            } else {
                event({ event: killedByWatchdog ? 'worker-watchdog-kill' : 'worker-crash', w, inc, code, lastSummarySeed: lastSeed, restartsFrom: lastSeed === null ? first : lastSeed + workers })
                first = lastSeed === null ? first : lastSeed + workers
                if (first === lastCrashFirst) {
                    // The same restart seed crashed twice: skip a stride block so the batch cannot loop on one seed (recorded; the skipped seeds are not claimed).
                    event({ event: 'worker-skip-ahead', w, inc, from: first, to: first + 50 * workers })
                    first += 50 * workers
                }
                lastCrashFirst = first
            }
            inc++
            if (inc > 60) {
                event({ event: 'worker-gave-up', w, inc })
                return
            }
        }
    }

    await Promise.all(Array.from({ length: workers }, (_, w) => runWorker(w)))
    const finished = Date.now()
    event({ event: 'end', finished })
    const report = aggregate(out, region, backend, { status: 'done', startedAt: new Date(regionStart).toISOString(), endedAt: new Date(finished).toISOString(), elapsedMs: finished - regionStart, code, workersConfigured: workers, minRuns: options.minRuns, minMs: options.minMs })
    const target = options.report ?? `${BASE}/${name}.json`
    writeFileSync(target, JSON.stringify(report, null, 1))
    writeFileSync(target.replace(/\.json$/, '.log'), `${name} ${report.status} runs=${report.runs} steps=${report.totalSteps} distinct~${report.distinctFingerprintsEstimate} violations=${report.violations.length} nonRed=${report.nonRedFailures.length} kinds=${JSON.stringify(report.kinds)} elapsedMs=${report.elapsedMs}\n` + readFileSync(join(out, 'events.jsonl'), 'utf8'))
    log(`pair ${name} done runs=${report.runs} violations=${report.violations.length} nonRed=${report.nonRedFailures.length} elapsed=${Math.round(report.elapsedMs / 1000)}s`)
    return report
}

// ---- the queue ----

async function runQueue(queueFile) {
    mkdirSync(BASE, { recursive: true })
    const queue = JSON.parse(readFileSync(queueFile, 'utf8')).filter((pair) => {
        const done = readJson(`${BASE}/${pair.region}-${pair.backend}.json`)
        return done === null || done.status !== 'done'
    })
    appendFileSync(`${SCRATCH}/pct-pids.txt`, `${now()} pid=${process.pid} role=driver queue=${queueFile} pairs=${queue.length}\n`)
    log(`driver start pid=${process.pid} pairs=${queue.length}`)
    const running = new Map()
    const slots = new Set()
    const startedPairs = []
    const progress = () => {
        const rows = [...running.keys()].map((name) => {
            const [region, backend] = name.split('-')
            const agg = aggregate(`${BASE}/runs/${name}`, region, backend)
            return { pair: name, runs: agg.runs, steps: agg.totalSteps, distinct: agg.distinctFingerprintsEstimate, kinds: agg.kinds, violations: agg.violations.length, nonRed: agg.nonRedFailures.length, workerEvents: agg.workerEvents.length }
        })
        writeFileSync(`${BASE}/progress.json`, JSON.stringify({ t: now(), running: rows, remaining: queue.map((p) => `${p.region}-${p.backend}`), started: startedPairs }, null, 1))
    }
    const ticker = setInterval(progress, 30000)
    while (queue.length > 0 || running.size > 0) {
        const stopped = existsSync(`${BASE}/STOP`)
        if (!stopped && queue.length > 0 && running.size < readNumber(`${SCRATCH}/pct-concurrency.txt`, 2)) {
            const pair = queue.shift()
            const name = `${pair.region}-${pair.backend}`
            let slot = 0
            while (slots.has(slot)) slot++
            slots.add(slot)
            startedPairs.push(name)
            const promise = runPair(pair, { workers: readNumber(`${SCRATCH}/pct-workers.txt`, 8), minRuns: MIN_RUNS, minMs: MIN_MS, slot, full: false })
                .catch((error) => log(`pair ${name} FAILED in driver: ${error?.stack ?? error}`))
                .finally(() => { running.delete(name); slots.delete(slot) })
            running.set(name, promise)
            await sleep(3000)
            continue
        }
        if (stopped && running.size === 0) break
        await sleep(5000)
    }
    clearInterval(ticker)
    progress()
    log('driver end')
}

// ---- entry ----

const [command, ...args] = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
if (command === 'run') {
    await runQueue(args[0])
} else if (command === 'pair') {
    const report = await runPair({ region: args[0], backend: args[1] }, {
        workers: Number(flag('--workers', 4)), minRuns: Number(flag('--min-runs', 200)), minMs: Number(flag('--min-ms', 0)),
        full: args.includes('--full'), out: flag('--out', undefined), report: flag('--report', undefined), slot: Number(flag('--slot', 9)),
    })
    console.log(JSON.stringify({ runs: report.runs, steps: report.totalSteps, distinct: report.distinctFingerprintsEstimate, exact: report.exactDistinctSummedOverWorkers, kinds: report.kinds, violations: report.violations.length, nonRed: report.nonRedFailures.length, elapsedMs: report.elapsedMs }))
} else if (command === 'aggregate') {
    const report = aggregate(args[0], args[1], args[2], {})
    if (args[3]) writeFileSync(args[3], JSON.stringify(report, null, 1))
    else console.log(JSON.stringify(report).slice(0, 2000))
}

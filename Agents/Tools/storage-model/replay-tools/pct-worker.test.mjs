// Long PCT worker. Walks the seed stride  first, first+W, first+2W ...  of one region on one backend through the
// in-tree runRegion, until BOTH quotas hold: this worker has done at least `quotaRuns` runs (counting earlier incarnations) and
// the wall clock has passed `regionStart + minMs`. Environment:
//   RISU_ROOT (repository root; default: found relative to this file)
//   L7_REGION L7_BACKEND L7_WORKER L7_WORKERS L7_FIRST_SEED L7_QUOTA_RUNS L7_DONE_BEFORE L7_MIN_MS L7_REGION_START L7_INC
//   L7_OUT L7_VIOL_DIR L7_NONRED_DIR L7_RUN_TIMEOUT_MS (default 180000) L7_FULL (1: every run gets a jsonl line with the full
//   RegionRun, plus an exact fingerprint set; used by the smoke/determinism check)
// Without L7_REGION the test is skipped, so an ordinary `vitest run` over the repository does not execute this file.
// Files in L7_OUT:  w<W>-i<INC>.jsonl (every non-routine run, or every run under L7_FULL), w<W>-i<INC>.summary.json (counters,
// rewritten every 200 runs / 20 s and at the end), w<W>-i<INC>.done (written at a clean end).
// A run that does not settle within the run timeout is recorded as a hang and the process exits 75 so the driver restarts the
// worker at the next seed (a dangling run must not share the fingerprint hook with the next one).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import inspector from 'node:inspector'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const env = process.env
const root = (env.RISU_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')).replace(/\\/g, '/')
const regionId = env.L7_REGION
const backend = env.L7_BACKEND
const worker = Number(env.L7_WORKER ?? 0)
const workers = Number(env.L7_WORKERS ?? 1)
const first = Number(env.L7_FIRST_SEED ?? worker + 1)
const quotaRuns = Number(env.L7_QUOTA_RUNS ?? 1)
const doneBefore = Number(env.L7_DONE_BEFORE ?? 0)
const minMs = Number(env.L7_MIN_MS ?? 0)
const regionStart = Number(env.L7_REGION_START ?? Date.now())
const inc = Number(env.L7_INC ?? 0)
const out = env.L7_OUT
const runTimeout = Number(env.L7_RUN_TIMEOUT_MS ?? 180000)
const full = env.L7_FULL === '1'
const tag = `w${worker}-i${inc}`

test.skipIf(regionId === undefined)(`l7 ${regionId} ${backend} ${tag}`, async () => {
    const { REGIONS, runRegion } = await import(`${root}/src/ts/storage/tests/store2/replay/regions.ts`)
    const region = REGIONS.find((entry) => entry.id === regionId)
    if (region === undefined || !region.backends.includes(backend)) {
        throw new Error(`l7: no region ${regionId} on ${backend}`)
    }
    mkdirSync(out, { recursive: true })
    const jsonl = `${out}/${tag}.jsonl`

    const stats = {
        region: regionId, backend, worker, workers, inc, firstSeed: first, lastSeed: null, runs: 0, steps: 0, ms: 0,
        kinds: {}, reached: {}, faultRuns: {}, faultTotal: {}, outcomes: {}, violations: [], findings: [],
        faultedRuns: 0, exercisedRuns: 0, maxRunMs: 0, heapMb: 0, hashedSteps: 0, hll: '', exactDistinct: null, ended: 'running',
    }

    // Distinct state fingerprints: a HyperLogLog (2^16 registers, about 0.4 % standard error) over the 64-bit scheduler
    // fingerprint of the raw state after every step; L7_FULL=1 also keeps the exact set, to validate the estimate.
    const hll = new Uint8Array(65536)
    const exact = full ? new Set() : null
    const mix1 = (x) => { x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return x >>> 0 }
    const mix2 = (x) => { x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15; return x >>> 0 }
    let hashed = 0
    let cur = null
    globalThis.__l7step = (info, getRig) => {
        if (env.L7_NOHOOK === '1') {
            return
        }
        if (cur === null) {
            return
        }
        const rig = getRig()
        const fp = rig.scheduler.fingerprint(rig.raw())
        const index = mix1(parseInt(fp.slice(0, 8), 16) | 0) >>> 16
        const rank = Math.clz32(mix2(parseInt(fp.slice(8), 16) | 0)) + 1
        if (rank > hll[index]) {
            hll[index] = rank
        }
        hashed++
        if (exact !== null) {
            exact.add(fp)
        }
        if (cur.trace !== null && cur.trace.length < 4000) {
            cur.trace.push(`${info.step} ${info.actor} ${info.kind} ${info.op} ${info.target}${info.applied ? '' : ' LOST-REQUEST'}${info.fault === null ? '' : ' fault=' + info.fault}`)
        }
    }

    const flush = (ended) => {
        stats.ended = ended
        stats.heapMb = Math.round(process.memoryUsage().heapUsed / 1048576)
        stats.hashedSteps = hashed
        stats.hll = Buffer.from(hll).toString('base64')
        stats.exactDistinct = exact === null ? null : exact.size
        writeFileSync(`${out}/${tag}.summary.json`, JSON.stringify(stats))
    }

    const once = async (seed, trace) => {
        cur = { trace: trace ? [] : null }
        const t0 = Date.now()
        let timer
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('hang'), runTimeout) })
        let run
        let thrown = null
        try {
            run = await Promise.race([runRegion(region, backend, seed), timeout])
        } catch (error) {
            thrown = `${error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 400)}`
        }
        clearTimeout(timer)
        const ms = Date.now() - t0
        const traceOut = cur.trace
        cur = null
        return { run, thrown, ms, trace: traceOut }
    }

    const dump = (dir, seed, kind, firstResult, second) => {
        mkdirSync(dir, { recursive: true })
        writeFileSync(`${dir}/${regionId}-${backend}-s${seed}.json`, JSON.stringify({
            region: regionId, backend, seed, kind,
            first: firstResult.run ?? { thrown: firstResult.thrown },
            rerun: second.run ?? { thrown: second.thrown },
            rerunMatchesFirst: JSON.stringify(firstResult.run) === JSON.stringify(second.run),
            trace: second.trace,
        }, null, 1))
    }

    // Optional CPU profile of the runs with index L7_PROF_FROM <= k < L7_PROF_TO, written to L7_PROF_FILE (diagnostic only).
    const profFrom = env.L7_PROF_FROM === undefined ? -1 : Number(env.L7_PROF_FROM)
    const profTo = Number(env.L7_PROF_TO ?? -1)
    let session = null
    const profileStop = () => new Promise((resolve) => { session.post('Profiler.stop', (error, result) => { if (error === null) { writeFileSync(env.L7_PROF_FILE, JSON.stringify(result.profile)) } session = null; resolve() }) })
    let hung = false
    let lastFlush = Date.now()
    for (let k = 0; ; k++) {
        if (doneBefore + stats.runs >= quotaRuns && Date.now() >= regionStart + minMs) {
            break
        }
        if (k === profFrom) { session = new inspector.Session(); session.connect(); await new Promise((r) => session.post('Profiler.enable', () => session.post('Profiler.start', () => r()))) }
        if (k === profTo && session !== null) { await profileStop() }
        const seed = first + k * workers
        const result = await once(seed, false)
        let line
        let kind
        if (result.run === 'hang') {
            kind = 'hang'
            line = { seed, kind, ms: result.ms }
            stats.findings.push({ seed, kind, detail: `no settle within ${runTimeout} ms` })
            hung = true
        } else if (result.thrown !== null) {
            kind = 'driver-threw'
            line = { seed, kind, ms: result.ms, error: result.thrown }
            stats.findings.push({ seed, kind, detail: result.thrown })
        } else {
            const run = result.run
            kind = run.kind
            stats.steps += run.steps
            for (const key of run.reached) {
                stats.reached[key] = (stats.reached[key] ?? 0) + 1
            }
            for (const [faultKind, count] of Object.entries(run.faults)) {
                stats.faultRuns[faultKind] = (stats.faultRuns[faultKind] ?? 0) + 1
                stats.faultTotal[faultKind] = (stats.faultTotal[faultKind] ?? 0) + count
            }
            for (const labels of Object.values(run.outcomes)) {
                for (const label of labels) {
                    stats.outcomes[label] = (stats.outcomes[label] ?? 0) + 1
                }
            }
            if (kind !== 'not-exercised') {
                stats.exercisedRuns++
                if (run.firstFaultStep !== null) {
                    stats.faultedRuns++
                }
            }
            line = { seed, kind, steps: run.steps, ms: result.ms }
            if (full) {
                line.full = run
            }
            if (run.violations.length > 0) {
                line.violations = run.violations
                for (const violation of run.violations) {
                    stats.violations.push({ seed, violation })
                }
            }
            if (run.errors.length > 0 && (kind === 'threw' || kind === 'stalled' || kind === 'max-steps')) {
                line.error = run.errors.join(' | ').slice(0, 600)
            }
            if (kind === 'stalled' || kind === 'max-steps' || kind === 'threw') {
                stats.findings.push({ seed, kind, detail: (line.error ?? '').slice(0, 300) })
            }
        }
        stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1
        stats.runs++
        stats.ms += result.ms
        stats.maxRunMs = Math.max(stats.maxRunMs, result.ms)
        stats.lastSeed = seed
        if (full || !(kind === 'complete' || kind === 'crashed' || kind === 'not-exercised')) {
            appendFileSync(jsonl, JSON.stringify(line) + '\n')
        }
        if (hung) {
            break
        }
        if (kind === 'violation' || kind === 'stalled' || kind === 'max-steps' || kind === 'threw' || kind === 'driver-threw') {
            // A deterministic re-run with a step trace; the dump keeps both records so a seed that does not reproduce is visible.
            const second = await once(seed, true)
            if (second.run !== 'hang') {
                dump(kind === 'violation' ? env.L7_VIOL_DIR : env.L7_NONRED_DIR, seed, kind, result, second)
            }
        }
        if (stats.runs % 200 === 0 || Date.now() - lastFlush > 20000) {
            lastFlush = Date.now()
            flush('running')
        }
    }
    flush(hung ? 'hang' : 'done')
    if (hung) {
        process.exit(75)
    }
    writeFileSync(`${out}/${tag}.done`, String(Date.now()))
}, 0)

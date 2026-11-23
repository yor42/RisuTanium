// node run-spike.mjs --port <cdp> --base http://127.0.0.1:<srv> --model <id> --pooling mean|cls --count N --batch B --out <result.json>
//   [--idle-seconds 20] [--dtype q8] [--seed 1] [--load-timeout-s 300] [--index-timeout-s 1800] [--cdp <path to cdp.mjs>]
// Drives window.__s3a (probe.js) in the app WebView through cdp.mjs, one short evaluation per child process (shell:false).
// Invariants: result.json is always written; exit 0 means the run reached a verdict (pass or fail is in the file),
// exit 1 means the CDP target vanished and the file records rendererLost: true. No adb: memory is sampled by another tool.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1]

const required = ['port', 'base', 'model', 'pooling', 'count', 'batch', 'out']
const missing = required.filter((k) => !args[k])
if (missing.length || !['mean', 'cls'].includes(args.pooling)) {
  console.error('usage: node run-spike.mjs --port <cdp> --base <url> --model <id> --pooling mean|cls --count N --batch B --out <result.json> [--idle-seconds 20]')
  process.exit(4)
}
const config = {
  port: String(args.port),
  base: args.base.replace(/\/$/, ''),
  model: args.model,
  pooling: args.pooling,
  dtype: args.dtype || 'q8',
  count: Number(args.count),
  batch: Number(args.batch),
  seed: Number(args.seed || 1),
  idleSeconds: Number(args['idle-seconds'] || 20),
  loadTimeoutMs: Number(args['load-timeout-s'] || 300) * 1000,
  indexTimeoutMs: Number(args['index-timeout-s'] || 1800) * 1000,
}
const out = resolve(args.out)
const cdpPath = resolve(args.cdp || join(here, '..', 'device', 'cdp.mjs'))
const probePath = join(here, 'probe.js')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// One cdp.mjs child per evaluation; cdp.mjs ends within its own --timeout, the kill timer is a backstop.
const evaluate = (flag, payload, timeoutMs) => new Promise((done) => {
  const child = spawn(process.execPath, [cdpPath, config.port, '--timeout', String(timeoutMs), flag, payload], { shell: false, windowsHide: true })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const killer = setTimeout(() => child.kill(), timeoutMs + 3000)
  child.on('error', (error) => { clearTimeout(killer); done({ code: 4, value: null, stderr: String(error.message) }) })
  child.on('close', (code) => {
    clearTimeout(killer)
    let value = null
    if (code === 0) { try { value = JSON.parse(stdout) } catch { value = stdout.trim() } }
    done({ code, value, stderr: stderr.trim().slice(0, 400) })
  })
})
const call = (method, arg, timeoutMs = 10000) =>
  evaluate('-e', 'window.__s3a.' + method + '(' + (arg === undefined ? '' : JSON.stringify(arg)) + ')', timeoutMs)

const result = {
  tool: 'ltm-embed-spike/run-spike.mjs',
  startedAt: new Date().toISOString(),
  config,
  probeVersion: null,
  constructError: null,
  rendererLost: false,
  lostReason: null,
  pageSessionIds: [],
  pageSessionStable: null,
  loadMs: null,
  dims: null,
  index: null,
  phases: null,
  snapshot: null,
  errors: [],
  bars: null,
}

const finish = (exitCode) => {
  result.finishedAt = new Date().toISOString()
  result.pageSessionStable = result.pageSessionIds.length > 0 && result.pageSessionIds.every((id) => id === result.pageSessionIds[0])
  if (!result.pageSessionStable && result.pageSessionIds.length > 1) result.rendererLost = true
  const phases = result.phases || {}
  const heavy = ['load', 'index'].map((name) => phases[name]).filter(Boolean)
  const over50 = heavy.reduce((sum, p) => sum + (p.longtask ? p.longtask.over50 : 0), 0)
  const idleOver50 = phases['idle-baseline'] && phases['idle-baseline'].longtask ? phases['idle-baseline'].longtask.over50 : null
  result.bars = {
    longtasksOver50DuringLoadAndIndex: heavy.length ? over50 : null,
    longtasksOver50IdleBaseline: idleOver50,
    indexMsgsPerSec: result.index ? result.index.msgsPerSec : null,
    indexAtLeast1PerSec: result.index && result.index.msgsPerSec !== null ? result.index.msgsPerSec >= 1 : null,
    noRendererLoss: !result.rendererLost,
    rendererPeakWithin1p5GB: null,
  }
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  console.log('wrote ' + out + ' rendererLost=' + result.rendererLost)
  process.exit(exitCode)
}

const noteSession = (id) => {
  if (typeof id === 'string' && !result.pageSessionIds.includes(id)) result.pageSessionIds.push(id)
}
const lose = (reason) => {
  result.rendererLost = true
  result.lostReason = reason
  finish(1)
}

// Poll-level failure policy: a missing page target or a missing __s3a means the renderer is gone or reloaded;
// timeouts are tolerated a few times because a busy main thread can delay one evaluation.
let timeouts = 0
const checked = async (method, arg, timeoutMs) => {
  const response = await call(method, arg, timeoutMs)
  if (response.code === 0) { timeouts = 0; return response.value }
  if (response.code === 3) {
    result.errors.push(method + ' timeout')
    if (++timeouts >= 5) lose('five consecutive evaluation timeouts')
    return null
  }
  if (response.code === 2) lose('no page target: ' + response.stderr)
  if (/__s3a/.test(response.stderr) || /not defined|undefined/.test(response.stderr)) lose('probe missing after reload: ' + response.stderr)
  result.errors.push(method + ' failed ' + response.code + ' ' + response.stderr)
  if (++timeouts >= 5) lose('five consecutive evaluation failures')
  return null
}

const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null

const install = await evaluate('-f', probePath, 15000)
if (install.code !== 0) {
  result.errors.push('probe install failed ' + install.code + ' ' + install.stderr)
  if (install.code === 2) lose('no page target at install')
  finish(0)
}
result.probeVersion = install.value

const started = await checked('start', { base: config.base, model: config.model, pooling: config.pooling, dtype: config.dtype }, 30000)
if (!started || !started.ok) {
  result.constructError = started ? started.constructError : 'start gave no answer'
  finish(0)
}

// Idle baseline: the same monitors run with no embedding work so later long tasks can be compared against it.
const idleUntil = Date.now() + config.idleSeconds * 1000
while (Date.now() < idleUntil) {
  await sleep(Math.min(2000, Math.max(0, idleUntil - Date.now())))
  const p = await checked('poll', 0, 8000)
  if (p) noteSession(p.pageSessionId)
}

await checked('load', undefined, 8000)
const loadUntil = Date.now() + config.loadTimeoutMs
let last = null
while (Date.now() < loadUntil) {
  await sleep(2000)
  const p = await checked('poll', 0, 8000)
  if (!p) continue
  noteSession(p.pageSessionId)
  last = p
  if (p.ready || (p.workerErrors > 0 && !p.loading)) break
}
if (!last || !last.ready) {
  result.errors.push('worker not ready within load timeout or errored')
  result.snapshot = await checked('snapshot', undefined, 15000)
  if (result.snapshot) result.phases = result.snapshot.phaseStats
  finish(0)
}
result.loadMs = last.loadMs
result.dims = last.dims

const run = await checked('runIndex', { count: config.count, batch: config.batch, seed: config.seed }, 10000)
if (!run || !run.ok) {
  result.errors.push('runIndex refused ' + JSON.stringify(run))
  finish(0)
}
const callMs = []
const indexUntil = Date.now() + config.indexTimeoutMs
let progress = null
while (Date.now() < indexUntil) {
  await sleep(2000)
  const p = await checked('poll', callMs.length, 8000)
  if (!p) continue
  noteSession(p.pageSessionId)
  progress = p
  if (p.index) {
    callMs.push(...p.index.callMs)
    if (p.index.finished) break
  }
}
if (!progress || !progress.index || !progress.index.finished) result.errors.push('index did not finish within timeout')

const sorted = [...callMs].sort((a, b) => a - b)
const idx = progress && progress.index
result.index = {
  requested: config.count,
  done: idx ? idx.done : 0,
  batchSize: config.batch,
  totalMs: idx ? idx.totalMs : null,
  msgsPerSec: idx ? idx.msgsPerSec : null,
  error: idx ? idx.error : null,
  callMs: { n: sorted.length, p50: percentile(sorted, 50), p90: percentile(sorted, 90), p99: percentile(sorted, 99), max: sorted.length ? sorted[sorted.length - 1] : null },
}

result.snapshot = await checked('snapshot', undefined, 15000)
if (result.snapshot) {
  noteSession(result.snapshot.pageSessionId)
  result.phases = result.snapshot.phaseStats
}
await call('stop', undefined, 8000)
finish(0)

// CHORE-806 stage 4: peak memory of a synthetic .bin import through the real page (first-life boot import), on a ladder of sizes.
//
//   node c806-import.mjs run [--rungs 0.5,1,2,4] [--characters 1000] [--chats 20] [--modules 180] [--archive on|off] [--cap-min 60]
//                            [--stage1-census <census.json>] [--no-census] [--keep-bin] [--out <folder under the scratch root>]
//   node c806-import.mjs selfcheck        (a tiny rung clean, then with C806_FAULT=truncate-bin and no-sidecar; prints which checks failed)
//
// A rung is one message median (the library's `messagesPerChat`). The ladder climbs through --rungs in order and stops at the first
// rung that fails, crashes, is refused, hits the cap or cannot be generated; the reason is recorded. The base rung is the median 0.5 that
// matches the real library size (MC-1966, stage 0 sweep); 1, 2 and 4 climb above it, and 6 can be added with --rungs.
// A failed rung carries no peak figure.
// Rung status: ok only when the census harness exited 0 and the imported tree's census equals the .bin's parameters
// (census.againstParams.equal); unverified when --no-census skipped it (the figures are then unchecked and labelled so); failed
// otherwise, with no figure in rung.json, ladder.json or the console line. The ladder stops at the first failed rung only.
// Heap figures: phaseRingPeakHeapMiB (the page's own import phase ring, __risuImportPhases) is the headline heap figure;
// cdpHeapPeakBetweenBlocksMiB is the highest CDP sample and misses a peak inside a blocked stretch (see the block report).
// Invariants:
// - Each rung starts from a freshly generated .bin, an empty server data dir (no login files), a fresh Chrome profile, and one
//   measurement-flag state: risu-measure-import on, risu-measure-savepass off, both set by a script added before any page script.
// - The flow is the real first move of an upstream user: sign in on the empty profile, then the first-life offer's restore button,
//   whose file picker is intercepted and answered with the generated .bin (c806-page importBinThroughPage). Only a .bin with a
//   matching c806 sidecar is accepted, so no real backup can reach the page. The Settings-import arm is not run.
// - Every 250 ms the page's JS heap is read over CDP (Runtime.getHeapUsage). A gap between two samples above 1000 ms means the
//   main thread was blocked, and is kept and reported as such. In parallel c806-proc-sampler.ps1 reads private bytes and
//   working set of every Chrome process and of the server from the OS; the PID list comes from SystemInfo.getProcessInfo on the
//   browser target, refreshed every second. The OS sampler covers a synchronous decode in which the CDP samples stall.
// - "File to home" runs from the moment the file was handed to the picker (DOM.setFileInputFiles) to the home screen.
// - The full-run slot (%TEMP%\risu-b715\fullrun-slot) is acquired once per rung and released after it, also on failure; at least
//   90 s pass before the next acquire.
// - Only PIDs this tool started are killed (server, Chrome, launcher, sampler), by recorded PID after a command-line check.
// Fault knobs (scratch self-checks): C806_FAULT=truncate-bin (the .bin is cut in half and its sidecar rewritten, so the page gets a
// damaged file), no-sidecar (the sidecar is removed, so the guard must refuse), census-mismatch (the expected chat count is raised
// by one before the census comparison, so a rung that would pass must become failed and carry no figure).
// Signals: SIGINT and SIGTERM stop the samplers, Chrome (recorded PID, name-checked), the server and the slot before exiting.
// Best-case hardware: figures come from desktop hardware (i9 class); diagnostic numbers, not thresholds, nothing about phones.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { C806_ROOT, REPO_ROOT, commandLineOf, dirsOf, listenable, prepareDist, scratchPath, serverRss, startServer } from './c806-server.mjs'
import { attach, closeChrome, fillPasswordPrompt, importBinThroughPage, launchChrome, mouseClick, readReqlog, sleep } from './c806-page.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const SAMPLER_PS1 = path.join(HERE, 'c806-proc-sampler.ps1')
const SLOT = path.join(os.tmpdir(), 'risu-b715', 'fullrun-slot')
const SLOT_TEXT = 'Lane-A CHORE-806 stage 4 import runs'
const SLOT_GAP_MS = 95000
const SERVER_PORTS = [6860, 6889]
const RESTORE_RE = /백업 복원|Restore a backup|Restore backup/
const BLOCK_GAP_MS = 1000
const FAULT = process.env.C806_FAULT ?? ''
const MIB = 2 ** 20
const SEED = 806

//#region full-run slot
let slotOwner = null
function releaseSlot() {
  if (slotOwner === null) return
  try {
    const ownerFile = path.join(SLOT, 'owner.txt')
    if (fs.existsSync(ownerFile) && fs.readFileSync(ownerFile, 'utf8').trim() === slotOwner) fs.rmSync(SLOT, { recursive: true, force: true })
  } catch {}
  slotOwner = null
}

async function acquireSlot(text) {
  const t0 = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(SLOT)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      await sleep(3000)
    }
  }
  slotOwner = text + ' (since ' + new Date().toISOString().slice(0, 19) + ')'
  fs.writeFileSync(path.join(SLOT, 'owner.txt'), slotOwner + '\n')
  return { waitedMs: Date.now() - t0 }
}
process.on('exit', releaseSlot)

// What a signal must end: the resources of the rung that is running, set by runRung and cleared when it finishes.
const live = { heap: null, phases: null, proc: null, h: null, server: null, generatorPid: null, censusPid: null, selfcheckPid: null }
let signalled = false
async function endLiveResources(signal) {
  if (signalled) return
  signalled = true
  const steps = [
    () => live.heap?.end(), () => live.phases?.end(), () => live.proc?.end(), () => (live.h ? closeChrome(live.h) : null), () => live.server?.stop(),
    () => {
      // the generator child of this file: killed by its recorded PID after a command-line check
      if (live.generatorPid === null) return
      const cmd = commandLineOf(live.generatorPid)
      if (cmd !== null && cmd.includes('c806-import.mjs') && /\sgen\s/.test(cmd)) process.kill(live.generatorPid)
    },
    () => {
      // the census vitest child: killed by its recorded PID after a command-line check
      if (live.censusPid === null) return
      const cmd = commandLineOf(live.censusPid)
      if (cmd !== null && cmd.includes('vitest') && cmd.includes('c806-tree.harness')) process.kill(live.censusPid)
    },
    () => {
      // the selfcheck-one child of the selfcheck parent: killed by its recorded PID after a command-line check
      if (live.selfcheckPid === null) return
      const cmd = commandLineOf(live.selfcheckPid)
      if (cmd !== null && cmd.includes('c806-import.mjs') && cmd.includes('selfcheck-one')) process.kill(live.selfcheckPid)
    },
  ]
  for (const step of steps) {
    try { await step() } catch {}
  }
  releaseSlot()
  process.exit(signal === 'SIGINT' ? 130 : 143)
}
//#endregion

//#region helpers
const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const round1 = (x) => Math.round(x * 10) / 10
const mib = (bytes) => round1(bytes / MIB)

function gitText(...args) {
  try { return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim() } catch (e) { return 'git failed: ' + e.message }
}

function guarded(promise, ms, label) {
  let timer
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out: ' + label)), ms) })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

/** A server port of 6860-6889 with a random start, so a parallel lane's server is less likely to collide. */
async function pickStage4Port() {
  const [lo, hi] = SERVER_PORTS
  const start = lo + Math.floor(Math.random() * (hi - lo + 1))
  for (let i = 0; i <= hi - lo; i++) {
    const p = lo + ((start - lo + i) % (hi - lo + 1))
    if (await listenable(p)) return p
  }
  throw new Error('no free server port in ' + SERVER_PORTS.join('-'))
}
//#endregion

//#region generation (child process: the library and the writer need a large heap)
async function generateBin({ out, median, params, logFile }) {
  const args = ['--max-old-space-size=16384', SELF, 'gen', '--out', out, '--median', String(median), '--characters', String(params.characters), '--chats', String(params.chats), '--modules', String(params.modules), '--archive', params.archive, '--seed', String(params.seed)]
  const logFd = fs.openSync(logFile, 'a')
  const t0 = Date.now()
  const child = spawn(process.execPath, args, { stdio: ['ignore', logFd, logFd], windowsHide: true, env: { ...process.env } })
  live.generatorPid = child.pid
  const code = await new Promise((resolve) => { child.on('exit', (c) => resolve(c)); child.on('error', () => resolve(-1)) })
  live.generatorPid = null
  fs.closeSync(logFd)
  return { code, ms: Date.now() - t0 }
}

async function genCommand(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
  const lib = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c806-library.mjs')).href)
  const writer = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c806-bin-write.mjs')).href)
  const params = lib.normalizeParams({ seed: Number(get('--seed') ?? SEED), characters: Number(get('--characters')), chatsPerCharacter: Number(get('--chats')), messagesPerChat: Number(get('--median')), modules: Number(get('--modules')), archiveCharacters: get('--archive') !== 'off' })
  const out = get('--out')
  const database = lib.buildLibrary(params)
  const counts = lib.libraryCounts(database)
  const written = writer.writeBin({ database, out, params })
  fs.writeFileSync(out + '.counts.json', JSON.stringify({ params, counts }))
  console.log(JSON.stringify({ out: written.out, fileBytes: written.fileBytes, entryBytes: written.entryBytes, sha256: written.sha256, counts }))
}
//#endregion

//#region browser-level CDP client (SystemInfo lives on the browser target, not on the page)
async function openBrowserClient(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('browser websocket failed')) })
  let nextId = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data)
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(new Error(JSON.stringify(m.error)))
    else p.resolve(m.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return { send, close: () => { try { ws.close() } catch {} } }
}
//#endregion

//#region samplers
/** Heap samples every 250 ms; gap = time since the previous finished sample. */
function startHeapSampler(c, file) {
  const rec = { samples: [], errors: 0, stop: false, done: null }
  let pendingLines = []
  const flush = () => { if (pendingLines.length) { fs.appendFileSync(file, pendingLines.join('')); pendingLines = [] } }
  rec.done = (async () => {
    let last = Date.now()
    while (!rec.stop) {
      const t0 = Date.now()
      try {
        const u = await c.send('Runtime.getHeapUsage')
        const t = Date.now()
        const s = { t, used: u.usedSize, total: u.totalSize, gap: t - last }
        rec.samples.push(s)
        pendingLines.push(JSON.stringify(s) + '\n')
        if (pendingLines.length >= 40) flush()
        last = t
      } catch { rec.errors++ }
      const wait = 250 - (Date.now() - t0)
      if (wait > 0) await sleep(wait)
    }
    flush()
  })()
  rec.end = async () => { rec.stop = true; await Promise.race([rec.done, sleep(4000)]); flush() }
  return rec
}

/** The newest non-shrinking __risuImportPhases snapshot (the page may reload; the ring is lost with it). */
function startPhasePoller(c) {
  const rec = { best: [], stop: false, done: null }
  rec.take = async () => {
    try {
      const snap = await guarded(c.ev('globalThis.__risuImportPhases ? globalThis.__risuImportPhases.snapshot() : null'), 8000, 'phase snapshot')
      if (Array.isArray(snap) && snap.length >= rec.best.length) rec.best = snap
    } catch {}
  }
  // a short cadence: a small import ends within seconds, and the ring is lost when the page reloads
  rec.done = (async () => {
    while (!rec.stop) {
      await rec.take()
      await sleep(400)
    }
  })()
  rec.end = async () => { rec.stop = true; await Promise.race([rec.done, sleep(4000)]) }
  return rec
}

/** Follows the browser's process list into a PID file for the PowerShell sampler, and starts the sampler. */
async function startProcessSampler({ chromeCdpPort, serverPid, dir, maxSeconds }) {
  const pidFile = path.join(dir, 'sampler-pids.txt')
  const stopFile = path.join(dir, 'sampler-stop.txt')
  const outFile = path.join(dir, 'proc.jsonl')
  const rec = { types: new Map([[serverPid, 'server']]), errors: [], stop: false, child: null, exited: false, done: null, pidFile, stopFile, outFile }
  const browser = await openBrowserClient(chromeCdpPort)
  rec.browser = browser
  const refresh = async () => {
    try {
      const info = await guarded(browser.send('SystemInfo.getProcessInfo'), 5000, 'SystemInfo.getProcessInfo')
      for (const p of info.processInfo) rec.types.set(p.id, p.type)
    } catch (e) { rec.errors.push(String(e.message).slice(0, 200)) }
    const current = [...rec.types.keys()]
    // the sampler may hold the file open at this instant; a skipped refresh is retried one second later
    try { fs.writeFileSync(pidFile, current.join(',')) } catch (e) { rec.errors.push('pid file write: ' + e.code) }
  }
  await refresh()
  rec.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SAMPLER_PS1, '-PidFile', pidFile, '-OutFile', outFile, '-StopFile', stopFile, '-IntervalMs', '250', '-ParentPid', String(process.pid), '-MaxSeconds', String(maxSeconds)], { stdio: 'ignore', windowsHide: true })
  rec.child.on('exit', () => { rec.exited = true })
  rec.samplerPid = rec.child.pid
  rec.done = (async () => { while (!rec.stop) { await sleep(1000); await refresh() } })()
  rec.end = async () => {
    rec.stop = true
    await Promise.race([rec.done, sleep(6000)])
    fs.writeFileSync(stopFile, 'stop')
    const t0 = Date.now()
    while (!rec.exited && Date.now() - t0 < 15000) await sleep(200)
    if (!rec.exited) {
      const cmd = commandLineOf(rec.samplerPid)
      if (cmd !== null && /c806-proc-sampler\.ps1/.test(cmd)) { process.kill(rec.samplerPid); rec.killed = true } else rec.killed = false
    }
    browser.close()
  }
  return rec
}
//#endregion

//#region analysis
function analyseHeap(samples, from, to) {
  const s = samples.filter(x => x.t >= from && x.t <= to)
  const blocks = s.filter(x => x.gap > BLOCK_GAP_MS)
  return {
    samples: s.length,
    // the highest sample the CDP read returned; a sample cannot be taken while the main thread is blocked, so this is no peak
    cdpHeapPeakBetweenBlocksMiB: s.length ? mib(Math.max(...s.map(x => x.used))) : null,
    cdpHeapTotalPeakBetweenBlocksMiB: s.length ? mib(Math.max(...s.map(x => x.total))) : null,
    maxGapMs: s.length ? Math.max(...s.map(x => x.gap)) : null,
    blocks: { count: blocks.length, totalMs: blocks.reduce((a, x) => a + x.gap, 0), largest: [...blocks].sort((a, b) => b.gap - a.gap).slice(0, 10).map(x => ({ endsAtMs: x.t - from, gapMs: x.gap, usedMiB: mib(x.used) })) },
  }
}

function readProcSamples(file) {
  if (!fs.existsSync(file)) return []
  const out = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

function analyseProc(samples, types, from, to) {
  const s = samples.filter(x => x.t >= from && x.t <= to)
  const perPid = new Map()
  const perTypeSum = {}
  let gapMax = 0
  let prev = null
  for (const tick of s) {
    if (prev !== null) gapMax = Math.max(gapMax, tick.t - prev)
    prev = tick.t
    const sums = {}
    for (const p of tick.p) {
      const type = types.get(p.id) ?? 'unknown'
      const e = perPid.get(p.id) ?? { type, peakPriv: 0, peakWs: 0 }
      e.peakPriv = Math.max(e.peakPriv, p.priv)
      e.peakWs = Math.max(e.peakWs, p.ws)
      perPid.set(p.id, e)
      sums[type] = (sums[type] ?? 0) + p.priv
    }
    for (const [type, v] of Object.entries(sums)) perTypeSum[type] = Math.max(perTypeSum[type] ?? 0, v)
  }
  const pids = [...perPid.entries()].map(([id, e]) => ({ id, type: e.type, peakPrivateMiB: mib(e.peakPriv), peakWorkingSetMiB: mib(e.peakWs) })).sort((a, b) => b.peakPrivateMiB - a.peakPrivateMiB)
  const renderers = pids.filter(p => p.type === 'renderer')
  return {
    ticks: s.length, maxTickGapMs: gapMax, perPid: pids,
    pageRendererGuess: renderers.length ? renderers[0] : null,
    peakSumPrivateMiBByType: Object.fromEntries(Object.entries(perTypeSum).map(([k, v]) => [k, mib(v)])),
  }
}

/** A coarse series for the report: every 5 s from the file hand-over, the page renderer's private bytes and the heap. */
function seriesOf(heap, proc, rendererId, from, to) {
  const out = []
  for (let t = from; t <= to; t += 5000) {
    const h = heap.filter(x => x.t >= t && x.t < t + 5000)
    const p = proc.filter(x => x.t >= t && x.t < t + 5000).flatMap(x => x.p.filter(e => e.id === rendererId))
    out.push({ atS: Math.round((t - from) / 1000), cdpHeapPeakBetweenBlocksMiB: h.length ? mib(Math.max(...h.map(x => x.used))) : null, rendererPrivPeakMiB: p.length ? mib(Math.max(...p.map(x => x.priv))) : null, heapSamples: h.length })
  }
  return out
}

function aggregateReqlog(lines, from) {
  const out = { total: lines.length, byRoute: {}, limited429: 0, aborted: 0, writeRequests: 0, stagedKeys: 0, stagedKeysByClass: {}, firstWriteAfterFileMs: null, lastWriteAfterFileMs: null, statuses: {} }
  for (const l of lines) {
    const route = l.route.startsWith('/api/') ? l.route : 'static'
    const r = out.byRoute[route] ??= { count: 0, inBytes: 0, outBytes: 0 }
    r.count++; r.inBytes += l.inBytes ?? 0; r.outBytes += l.outBytes ?? 0
    out.statuses[l.status] = (out.statuses[l.status] ?? 0) + 1
    if (l.limited) out.limited429++
    if (l.aborted) out.aborted++
    if (l.method !== 'GET' && l.route.startsWith('/api/write')) {
      out.writeRequests++
      out.stagedKeys += l.keyCount ?? 0
      for (const [cls, n] of Object.entries(l.classes ?? {})) out.stagedKeysByClass[cls] = (out.stagedKeysByClass[cls] ?? 0) + (typeof n === 'number' ? n : 1)
      if (from !== null) {
        const rel = Math.round(l.t0 - from)
        out.firstWriteAfterFileMs = out.firstWriteAfterFileMs === null ? rel : Math.min(out.firstWriteAfterFileMs, rel)
        out.lastWriteAfterFileMs = out.lastWriteAfterFileMs === null ? rel : Math.max(out.lastWriteAfterFileMs, rel)
      }
    }
  }
  return out
}
//#endregion

//#region page flow
/** Signs in on the empty profile and waits for the first-life offer's restore button; answers the password prompt and start-up notices. */
async function reachOffer(c, timeoutMs) {
  const t0 = Date.now()
  let prompts = 0
  let notices = 0
  let lastAnswer = 0
  const probe = `(() => {
    const re = ${RESTORE_RE.toString()}
    const bs = [...document.querySelectorAll('button')].filter(e => e.offsetParent)
    return { prompt: !!document.querySelector('#alert-input'), restore: bs.some(e => re.test((e.innerText || '').trim())), ok: bs.some(e => (e.innerText || '').split('\\n')[0].trim() === 'OK'), home: !!document.querySelector('[data-part=home-landing]') }
  })()`
  while (Date.now() - t0 < timeoutMs) {
    let st = null
    try { st = await guarded(c.ev(probe), 15000, 'offer probe') } catch { st = null }
    if (st) {
      if (st.home) throw new Error('the home screen showed before any offer: the profile or server data dir was not empty')
      if (st.restore) return { ms: Date.now() - t0, prompts, notices }
      if (st.prompt && Date.now() - lastAnswer > 3000) {
        prompts++
        lastAnswer = Date.now()
        try { await guarded(fillPasswordPrompt(c), 15000, 'sign-in prompt') } catch {}
      } else if (!st.prompt && st.ok) {
        notices++
        try { await c.ev(`(() => { const el = [...document.querySelectorAll('button')].find(e => e.offsetParent && (e.innerText || '').split('\\n')[0].trim() === 'OK'); if (el) el.click() })()`) } catch {}
        await sleep(1200)
      }
    }
    await sleep(400)
  }
  throw new Error('the first-life offer never showed within ' + Math.round(timeoutMs / 1000) + ' s')
}
//#endregion

//#region census
function runCensus({ treeDir, tag, outRoot, logFile }) {
  const vitest = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  const env = { ...process.env, C806_MODE: 'census', C806_TREE_DIR: treeDir, C806_TAG: tag, C806_OUT_ROOT: outRoot, NODE_OPTIONS: '--max-old-space-size=16384' }
  const logFd = fs.openSync(logFile, 'a')
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitest, 'run', '--config', 'Agents/Tools/vitest.harness.config.ts', 'Agents/Tools/save-gen/c806-tree.harness.ts'], { cwd: REPO_ROOT, env, stdio: ['ignore', logFd, logFd], windowsHide: true })
    live.censusPid = child.pid
    child.on('exit', (code) => { live.censusPid = null; fs.closeSync(logFd); resolve(code) })
    child.on('error', () => { live.censusPid = null; fs.closeSync(logFd); resolve(-1) })
  })
}

function compareCensusToParams(census, counts) {
  const c = census.census
  const rows = [
    ['characters', c.characters.count, counts.characters], ['chats', c.chats, counts.chats], ['messages', c.messages, counts.messages],
    ['modules', c.modules.count, counts.modules], ['enabledModules', c.configEnabledModules, counts.enabledModules], ['archiveCharacters', c.configArchiveCharacters, counts.archiveCharacters],
  ]
  const fields = Object.fromEntries(rows.map(([k, got, want]) => [k, { census: got, params: want, equal: got === want }]))
  return { problems: c.problems, equal: c.problems.length === 0 && rows.every(([, got, want]) => got === want), fields }
}

/** Counts equal and bytes within 1% per unit type, against another census (the stage 1 tree of the same library). */
function compareCensusToTree(census, otherFile) {
  const other = JSON.parse(fs.readFileSync(otherFile, 'utf8')).census
  const a = census.census
  const differences = []
  for (const type of new Set([...Object.keys(a.byType), ...Object.keys(other.byType)])) {
    const x = a.byType[type] ?? { count: 0, bytes: 0 }
    const y = other.byType[type] ?? { count: 0, bytes: 0 }
    if (x.count !== y.count) differences.push({ type, what: 'count', imported: x.count, other: y.count })
    else if (Math.abs(x.bytes - y.bytes) > 0.01 * Math.max(x.bytes, y.bytes, 1)) differences.push({ type, what: 'bytes', imported: x.bytes, other: y.bytes })
  }
  return { otherFile, equal: differences.length === 0, differences: differences.slice(0, 20) }
}
//#endregion

//#region one rung
async function runRung(o, median, slotWaitedMs) {
  const tag = 'imp-m' + String(median).replace('.', 'p') + '-' + Date.now()
  const runDir = scratchPath(o.outDir, tag)
  fs.mkdirSync(runDir, { recursive: true })
  const rung = { tag, median, status: 'failed', why: null, slotWaitedMs, startedAt: new Date().toISOString(), fault: FAULT || null, params: { seed: SEED, characters: o.characters, chats: o.chats, modules: o.modules, archive: o.archive }, figures: null }
  const d = dirsOf(tag)
  const binDir = scratchPath(o.outDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  const bin = path.join(binDir, tag + '.bin')
  const dist = scratchPath(C806_ROOT, 'build', 'dist')
  let server = null
  let h = null
  let heap = null
  let phases = null
  let proc = null
  const cur = { crashed: false }
  try {
    // 1: the .bin
    if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('no measurement dist at ' + dist)
    const gen = await generateBin({ out: bin, median, params: rung.params, logFile: path.join(runDir, 'gen.log') })
    rung.generator = { exitCode: gen.code, ms: gen.ms }
    if (gen.code !== 0 || !fs.existsSync(bin + '.c806.json')) {
      rung.generator.tail = fs.existsSync(path.join(runDir, 'gen.log')) ? fs.readFileSync(path.join(runDir, 'gen.log'), 'utf8').slice(-600) : ''
      throw new Error('generator failed (exit ' + gen.code + ')')
    }
    const side = JSON.parse(fs.readFileSync(bin + '.c806.json', 'utf8'))
    const expected = JSON.parse(fs.readFileSync(bin + '.counts.json', 'utf8'))
    rung.bin = { fileBytes: side.fileBytes, entryBytes: side.entryBytes, sha256: side.sha256, counts: expected.counts }
    if (FAULT === 'truncate-bin') {
      const bytes = fs.readFileSync(bin)
      const cut = bytes.subarray(0, Math.floor(bytes.length / 2))
      fs.writeFileSync(bin, cut)
      side.sha256 = createHash('sha256').update(cut).digest('hex')
      side.fileBytes = cut.length
      fs.writeFileSync(bin + '.c806.json', JSON.stringify(side))
    }
    if (FAULT === 'no-sidecar') fs.rmSync(bin + '.c806.json', { force: true })
    // 2: empty server, fresh profile
    rung.distIndexSha256 = prepareDist(tag, dist)
    fs.mkdirSync(d.save, { recursive: true })
    rung.saveEntriesAtStart = fs.readdirSync(d.save).length
    // another lane's process can take the chosen port between the free check and the bind; a few fresh ports are tried
    rung.serverStartAttempts = []
    for (let attempt = 0; server === null; attempt++) {
      const port = await pickStage4Port()
      try {
        server = await startServer({ tag, port })
      } catch (e) {
        rung.serverStartAttempts.push({ port, error: String(e.message).slice(0, 200) })
        if (attempt >= 4) throw e
        await sleep(1500)
      }
    }
    live.server = server
    h = await launchChrome({ runDir, profileName: tag })
    live.h = h
    rung.pids = { server: server.pid, serverPort: server.port, chrome: h.chrome, launcher: h.launcher, cdpPort: h.cdpPort }
    const switches = { 'risu-measure-import': 'on', 'risu-measure-savepass': 'off' }
    const { c, state } = await attach(h, { switches })
    c.on((m) => { if (m.method === 'Inspector.targetCrashed') cur.crashed = true })
    rung.chromeVersion = (await c.send('Browser.getVersion')).product
    heap = startHeapSampler(c, path.join(runDir, 'heap.jsonl'))
    live.heap = heap
    phases = startPhasePoller(c)
    live.phases = phases
    // the sampler also ends when this process is gone, or after the cap plus ten minutes
    proc = await startProcessSampler({ chromeCdpPort: h.cdpPort, serverPid: server.pid, dir: runDir, maxSeconds: Math.ceil(o.capMs / 1000) + 600 })
    live.proc = proc
    rung.samplerPid = proc.samplerPid
    // 3: login and the first-life offer
    const tNav = Date.now()
    await c.send('Page.navigate', { url: server.baseUrl + '/' })
    rung.offer = await reachOffer(c, 3 * 60 * 1000)
    // 4: the import
    const fileGiven = { at: null }
    const logLines = []
    rung.importLog = logLines
    // After the file is handed over the page asks its size, time and space warnings ("Continue?"). A measurement run answers Yes to
    // those, as the maintainer's import test does. A confirmation that part of the backup could not be imported completely is never
    // answered: it is a refusal finding and ends the rung.
    rung.confirmsAnswered = []
    const confirmFailure = new Promise((_, reject) => {
      let stop = false
      rung.stopConfirms = () => { stop = true }
      const lastClick = { at: 0 }
      ;(async () => {
        while (!stop) {
          await sleep(700)
          if (stop || fileGiven.at === null) continue
          let st = null
          try { st = await guarded(c.ev(`({ text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 1500), yes: [...document.querySelectorAll('button')].some(e => e.offsetParent && /^(예|Yes)$/.test((e.innerText || '').trim())) })`), 8000, 'confirm probe') } catch { st = null }
          if (!st || !st.yes) continue
          if (/완전히 가져오지 못했습니다|could not be brought in completely/.test(st.text)) { reject(new Error('the import asked an incomplete-data confirmation, left unanswered: ' + st.text.slice(0, 300))); return }
          if (/계속하시겠습니까|Continue\?/.test(st.text) && Date.now() - lastClick.at > 1500) {
            lastClick.at = Date.now()
            if (await mouseClick(c, /^(예|Yes)$/)) rung.confirmsAnswered.push({ afterFileMs: Date.now() - fileGiven.at, text: st.text.slice(0, 220) })
          }
        }
      })()
    })
    confirmFailure.catch(() => {})
    const watch = new Promise((_, reject) => {
      const timer = setInterval(() => {
        if (cur.crashed) { clearInterval(timer); reject(new Error('renderer crash')) } else if (h.hasExited()) { clearInterval(timer); reject(new Error('Chrome exited')) }
      }, 500)
      rung.stopWatch = () => clearInterval(timer)
    })
    watch.catch(() => {})
    const importing = importBinThroughPage(c, bin, { restoreLabel: RESTORE_RE, doneSelector: '[data-part=home-landing], [data-part=chat-messages]', timeoutMs: o.capMs, log: (m) => { if (m.startsWith('file given')) fileGiven.at = Date.now(); if (logLines.length < 400) logLines.push(Date.now() + ' ' + m) } })
    importing.catch(() => {})
    let outcome
    try {
      outcome = await Promise.race([importing, watch, confirmFailure])
    } finally {
      rung.stopWatch()
      rung.stopConfirms()
    }
    const doneAt = Date.now()
    await phases.take()
    if (fileGiven.at === null) throw new Error('the file was never handed to the picker')
    rung.importLog = logLines
    rung.fileToHomeMs = doneAt - fileGiven.at
    rung.clickToHomeMs = outcome.ms
    rung.navigationsTotal = state.navigations
    await sleep(5000)
    const settledAt = Date.now()
    // 5: figures
    try {
      await guarded(c.send('HeapProfiler.enable'), 15000, 'HeapProfiler.enable')
      rung.heapBeforeGcMiB = mib((await guarded(c.send('Runtime.getHeapUsage'), 15000, 'heap before gc')).usedSize)
      await guarded(c.send('HeapProfiler.collectGarbage'), 120000, 'collectGarbage')
      rung.heapAfterGcMiB = mib((await guarded(c.send('Runtime.getHeapUsage'), 15000, 'heap after gc')).usedSize)
    } catch (e) { rung.heapGcError = String(e.message).slice(0, 200) }
    // not yet ok: the census below decides, and the figures are dropped when it does not confirm the imported tree
    rung.status = 'imported'
    rung.window = { fileGivenAt: fileGiven.at, doneAt, settledAt, tNav }
  } catch (e) {
    rung.status = 'failed'
    rung.why = String(e.message).slice(0, 600)
    rung.crashed = cur.crashed
  } finally {
    // stop the samplers, the browser, the server (recorded PIDs only)
    if (heap) await heap.end()
    if (phases) await phases.end()
    if (proc) await proc.end()
    if (h) rung.closed = await closeChrome(h)
    if (server) {
      try { rung.serverRss = serverRss(server.pid) } catch (e) { rung.serverRssError = String(e.message).slice(0, 200) }
      await server.stop()
    }
    live.heap = live.phases = live.proc = live.h = live.server = null
    rung.finishedAt = new Date().toISOString()
  }
  // analysis (after everything is stopped): no figure for a failed rung
  const heapSamples = heap ? heap.samples : []
  const procSamples = proc ? readProcSamples(proc.outFile) : []
  const lines = fs.existsSync(d.reqlog) ? readReqlog(d.reqlog) : []
  if (fs.existsSync(d.reqlog)) fs.copyFileSync(d.reqlog, path.join(runDir, 'requests.jsonl'))
  rung.reqlog = aggregateReqlog(lines, rung.window?.fileGivenAt ?? null)
  rung.phases = phases ? phases.best : []
  rung.samplerErrors = proc ? proc.errors.slice(0, 5) : []
  rung.samplerKilled = proc ? (proc.killed ?? false) : null
  fs.writeFileSync(path.join(runDir, 'phases.json'), JSON.stringify(rung.phases, null, 2))
  if (rung.status === 'imported') {
    const w = rung.window
    const pre = analyseHeap(heapSamples, 0, w.fileGivenAt)
    const during = analyseHeap(heapSamples, w.fileGivenAt, w.settledAt)
    const procPre = analyseProc(procSamples, proc.types, 0, w.fileGivenAt)
    const procDuring = analyseProc(procSamples, proc.types, w.fileGivenAt, w.settledAt)
    // the headline heap figure: the highest heap the page itself noted at an import phase (a lower bound of the true peak)
    const phaseHeaps = rung.phases.map(p => p.heapMiB).filter(v => typeof v === 'number')
    rung.figures = {
      phaseRingPeakHeapMiB: phaseHeaps.length ? Math.max(...phaseHeaps) : null, phaseRingHeapNotes: phaseHeaps.length,
      heapBeforeImport: pre, heapDuringImport: during, processesBeforeImport: procPre, processesDuringImport: procDuring, heapErrors: heap.errors,
    }
    const rendererId = procDuring.pageRendererGuess ? procDuring.pageRendererGuess.id : null
    fs.writeFileSync(path.join(runDir, 'series.json'), JSON.stringify(seriesOf(heapSamples, procSamples, rendererId, w.fileGivenAt, w.settledAt), null, 2))
  }
  // census of the resulting tree against the params, and optionally against the stage 1 tree
  if (rung.status === 'imported' && o.census) {
    const censusCode = await runCensus({ treeDir: d.save, tag: tag + '-census', outRoot: o.outDir, logFile: path.join(runDir, 'census.log') })
    const censusFile = path.join(o.outDir, tag + '-census', 'census.json')
    rung.census = { exitCode: censusCode, file: censusFile }
    if (fs.existsSync(censusFile)) {
      const census = JSON.parse(fs.readFileSync(censusFile, 'utf8'))
      // the census-mismatch knob raises the expected chat count by one: the comparison must then fail the rung
      const wanted = FAULT === 'census-mismatch' ? { ...rung.bin.counts, chats: rung.bin.counts.chats + 1 } : rung.bin.counts
      rung.census.againstParams = compareCensusToParams(census, wanted)
      if (o.stage1Census) rung.census.againstStage1 = compareCensusToTree(census, o.stage1Census)
    } else rung.census.error = 'the census harness wrote no census.json'
  }
  // the verdict (AS4): ok only with a census that exited 0 and equals the .bin's parameters; a skipped census is unverified;
  // anything else is failed and keeps no figure
  if (rung.status === 'imported') {
    // the app emits 'import commit start' but no commit-end phase: the start note must be in the ring, the end is recorded as not emitted
    const commitStart = rung.phases.some(p => /import commit start/.test(p.phase))
    rung.phaseChecks = { importCommitStartPresent: commitStart, commitEndPhaseEmittedByApp: false, phasesSeen: rung.phases.length }
    const dropFigures = () => { rung.figures = null; fs.rmSync(path.join(runDir, 'series.json'), { force: true }) }
    if (!o.census) {
      rung.status = 'unverified'
      rung.why = 'the census was skipped (--no-census): the figures are not checked against the imported tree'
    } else if (rung.census.exitCode !== 0 || rung.census.error || rung.census.againstParams?.equal !== true) {
      rung.status = 'failed'
      rung.why = rung.census.exitCode !== 0 ? 'the census harness exited ' + rung.census.exitCode : rung.census.error ?? 'the imported tree differs from the .bin parameters: ' + JSON.stringify(rung.census.againstParams.fields) + ' ' + JSON.stringify(rung.census.againstParams.problems).slice(0, 300)
      dropFigures()
    } else if (!commitStart) {
      rung.status = 'failed'
      rung.why = 'the phase ring has no "import commit start" note'
      dropFigures()
    } else rung.status = 'ok'
  }
  // provenance and the record
  rung.provenance = {
    head: gitText('rev-parse', 'HEAD'), statusToolsAndSrc: gitText('status', '--short', '--', 'Agents/Tools', 'src').split('\n').filter(Boolean),
    toolSha256: Object.fromEntries([['c806-import.mjs', SELF], ['c806-proc-sampler.ps1', SAMPLER_PS1], ['c806-page.mjs', path.join(HERE, 'c806-page.mjs')], ['c806-server.mjs', path.join(HERE, 'c806-server.mjs')], ['c806-reqlog.cjs', path.join(HERE, 'c806-reqlog.cjs')]].map(([n, f]) => [n, sha256File(f)])),
    cpu: os.cpus()[0].model + ' x' + os.cpus().length, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version, platform: os.platform() + ' ' + os.release(),
    meterSwitches: { 'risu-measure-import': 'on', 'risu-measure-savepass': 'off' },
    proxyHop: 'every page request goes through the launcher loopback proxy (a Node hop); wall times include it',
    hardwareCaveat: 'best-case desktop hardware (i9-13900KF, 64 GiB); diagnostic numbers, not thresholds, nothing about phones or a Pi',
  }
  fs.writeFileSync(path.join(runDir, 'rung.json'), JSON.stringify(rung, null, 2))
  // clean up: the large .bin and the server's save tree (the request log stays)
  rung.binDeleted = false
  if (!o.keepBin) {
    try { fs.rmSync(bin, { force: true }); rung.binDeleted = true } catch {}
  }
  try { fs.rmSync(d.save, { recursive: true, force: true }) } catch {}
  fs.writeFileSync(path.join(runDir, 'rung.json'), JSON.stringify(rung, null, 2))
  return rung
}
//#endregion

//#region ladder
/** The headline figures of a rung that carries any; the heap figure is the page's phase ring, the CDP figure is labelled as between blocks. */
function figureSummary(r) {
  const f = r.figures
  return { phaseRingPeakHeapMiB: f.phaseRingPeakHeapMiB, cdpHeapPeakBetweenBlocksMiB: f.heapDuringImport.cdpHeapPeakBetweenBlocksMiB, rendererPrivatePeakMiB: f.processesDuringImport.pageRendererGuess?.peakPrivateMiB ?? null, maxCdpHeapGapMs: f.heapDuringImport.maxGapMs }
}

function rungLine(r) {
  if (r.status === 'failed' || r.figures === null) return `rung ${r.median}: FAILED (${r.why})`
  const s = figureSummary(r)
  const unchecked = r.status === 'unverified' ? ' [UNVERIFIED: no census]' : ''
  return `rung ${r.median}: ${r.status}${unchecked}, file to home ${Math.round(r.fileToHomeMs / 1000)} s, phase-ring heap peak ${s.phaseRingPeakHeapMiB ?? 'n/a'} MiB, page renderer private peak ${s.rendererPrivatePeakMiB ?? 'n/a'} MiB, CDP heap peak between blocks ${s.cdpHeapPeakBetweenBlocksMiB} MiB, max CDP heap gap ${s.maxCdpHeapGapMs} ms`
}

async function runLadder(o) {
  fs.mkdirSync(o.outDir, { recursive: true })
  const ladder = { startedAt: new Date().toISOString(), rungs: [], stoppedAt: null, stopWhy: null }
  const bins = []
  for (let i = 0; i < o.rungs.length; i++) {
    const median = o.rungs[i]
    if (i > 0) await sleep(SLOT_GAP_MS)
    const slot = await acquireSlot(SLOT_TEXT)
    let rung
    try {
      rung = await runRung(o, median, slot.waitedMs)
    } catch (e) {
      rung = { median, status: 'failed', why: 'tool error: ' + String(e.stack ?? e).slice(0, 600), figures: null }
    } finally {
      releaseSlot()
    }
    ladder.rungs.push({ median, tag: rung.tag, status: rung.status, why: rung.why, fileToHomeMs: rung.status === 'failed' ? null : rung.fileToHomeMs ?? null, censusAgainstParamsEqual: rung.census?.againstParams?.equal ?? null, censusAgainstStage1Equal: rung.census?.againstStage1?.equal ?? null, figures: rung.status !== 'failed' && rung.figures ? figureSummary(rung) : null })
    if (rung.bin) bins.push({ tag: rung.tag, median, fileBytes: rung.bin.fileBytes, sha256: rung.bin.sha256, deleted: rung.binDeleted ?? false })
    fs.writeFileSync(path.join(o.outDir, 'ladder.json'), JSON.stringify(ladder, null, 2))
    fs.writeFileSync(path.join(o.outDir, 'bins.json'), JSON.stringify(bins, null, 2))
    console.log(rungLine(rung))
    if (rung.status === 'failed') { ladder.stoppedAt = median; ladder.stopWhy = rung.why; break }
  }
  ladder.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(o.outDir, 'ladder.json'), JSON.stringify(ladder, null, 2))
  return ladder
}
//#endregion

//#region commands
const argv = process.argv.slice(2)
const arg = (k, fallback = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : fallback }
const has = (k) => argv.includes(k)

function optionsFromArgs(extra = {}) {
  const outDir = scratchPath(arg('--out', path.join(C806_ROOT, 'runs', 'stage4')))
  return {
    rungs: (arg('--rungs', '0.5,1,2,4')).split(',').map(Number), characters: Number(arg('--characters', '1000')), chats: Number(arg('--chats', '20')), modules: Number(arg('--modules', '180')),
    archive: arg('--archive', 'on'), capMs: Math.round(Number(arg('--cap-min', '60')) * 60000), census: !has('--no-census'), keepBin: has('--keep-bin'),
    stage1Census: arg('--stage1-census'), outDir, ...extra,
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const cmd = argv[0]
  process.on('SIGINT', () => { endLiveResources('SIGINT') })
  process.on('SIGTERM', () => { endLiveResources('SIGTERM') })
  if (cmd === 'gen') {
    await genCommand(argv)
  } else if (cmd === 'run') {
    const o = optionsFromArgs()
    const ladder = await runLadder(o)
    console.log(JSON.stringify(ladder.rungs.map(r => ({ median: r.median, status: r.status }))))
    process.exit(ladder.stoppedAt === null ? 0 : 3)
  } else if (cmd === 'selfcheck') {
    // tiny rung: the clean run must pass, a truncated .bin must fail without a figure, a missing sidecar must be refused, a census
    // that disagrees with the parameters must fail the rung without a figure
    const base = optionsFromArgs({ rungs: [3], characters: 5, chats: 2, modules: 8, capMs: Math.round(Number(arg('--cap-min', '1.5')) * 60000), outDir: scratchPath(arg('--out', path.join(C806_ROOT, 'runs', 'stage4', 'selfcheck'))) })
    const outcome = {}
    const knobs = ['', 'truncate-bin', 'no-sidecar', 'census-mismatch']
    for (let i = 0; i < knobs.length; i++) {
      if (i > 0) await sleep(SLOT_GAP_MS)
      const slot = await acquireSlot(SLOT_TEXT + ' (self-check)')
      try {
        // the fault knob is read at module load, so each knob runs as a child process of this file with the same arguments
        const code = await new Promise((resolve) => {
          const child = spawn(process.execPath, [SELF, 'selfcheck-one', '--out', path.join(base.outDir, knobs[i] || 'clean'), '--cap-min', String(base.capMs / 60000)], { stdio: 'inherit', windowsHide: true, env: { ...process.env, C806_FAULT: knobs[i], C806_SELF_SLOT_WAIT: String(slot.waitedMs) } })
          live.selfcheckPid = child.pid
          child.on('exit', (c) => { live.selfcheckPid = null; resolve(c) })
        })
        const file = path.join(base.outDir, knobs[i] || 'clean', 'selfcheck-one.json')
        outcome[knobs[i] || 'clean'] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { exitCode: code, error: 'no result file' }
      } finally {
        releaseSlot()
      }
    }
    const verdict = {
      T4a_clean_passes: outcome.clean?.status === 'ok' && outcome.clean?.figures === true && outcome.clean?.censusEqual === true,
      T4a_truncate_bin_is_a_failed_rung_without_figure: outcome['truncate-bin']?.status === 'failed' && outcome['truncate-bin']?.figures === false,
      T4b_missing_sidecar_is_refused: outcome['no-sidecar']?.status === 'failed' && /sidecar/.test(outcome['no-sidecar']?.why ?? ''),
      T4a_census_mismatch_is_a_failed_rung_without_figure: outcome['census-mismatch']?.status === 'failed' && outcome['census-mismatch']?.figures === false && outcome['census-mismatch']?.censusEqual === false,
    }
    console.log('SELFCHECK ' + JSON.stringify({ verdict, outcome }))
    process.exit(Object.values(verdict).every(Boolean) ? 0 : 1)
  } else if (cmd === 'selfcheck-one') {
    const o = optionsFromArgs({ rungs: [3], characters: 5, chats: 2, modules: 8, capMs: Math.round(Number(arg('--cap-min', '1.5')) * 60000) })
    fs.mkdirSync(o.outDir, { recursive: true })
    const rung = await runRung(o, 3, Number(process.env.C806_SELF_SLOT_WAIT ?? '0'))
    fs.writeFileSync(path.join(o.outDir, 'selfcheck-one.json'), JSON.stringify({ status: rung.status, why: rung.why, figures: rung.figures !== null, censusEqual: rung.census?.againstParams?.equal ?? null }))
    process.exit(0)
  } else {
    console.error('commands: run, selfcheck')
    process.exit(2)
  }
}
//#endregion
